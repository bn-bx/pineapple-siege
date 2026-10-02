import { Quaternion, Euler, Vector3 } from "three";
import type { PlaneState } from "../types";

/** Interpolate translation and attitude on the same timeline, including yaw wrap. */
export function flightPose(
  previous: PlaneState | undefined,
  current: PlaneState,
  alpha: number,
) {
  const position = new Vector3(...current.p);
  const rotation = new Quaternion().setFromEuler(
    new Euler(-current.pitch, current.yaw, current.roll, "YXZ"),
  );
  const discontinuity =
    !previous ||
    previous.crashed !== current.crashed ||
    position.distanceTo(new Vector3(...previous.p)) >= 30;
  if (!discontinuity && previous) {
    const t = Math.max(0, Math.min(1, alpha));
    position.lerpVectors(new Vector3(...previous.p), position.clone(), t);
    rotation.slerpQuaternions(
      new Quaternion().setFromEuler(
        new Euler(-previous.pitch, previous.yaw, previous.roll, "YXZ"),
      ),
      rotation.clone(),
      t,
    );
  }
  return { position, rotation, discontinuity };
}

type FlightFrame = { time: number; plane: PlaneState };

/** Advance a presentation clock independently of worker message arrival. */
export class FlightTimeline {
  private frames: FlightFrame[] = [];
  private time?: number;
  private lastAt?: number;
  private buffering = false;
  private pendingSnap = true;

  constructor(private delay = 2 / 60) {}

  reset() {
    this.frames = [];
    this.time = this.lastAt = undefined;
    this.buffering = false;
    this.pendingSnap = true;
  }

  receive(frame: FlightFrame) {
    const last = this.frames.at(-1);
    if (
      last &&
      (frame.time < last.time ||
        flightPose(last.plane, frame.plane, 1).discontinuity)
    )
      this.reset();
    if (this.frames.at(-1)?.time === frame.time) this.frames.pop();
    this.frames.push(frame);
    // ponytail: eight samples cover normal delivery jitter; long stalls skip lost history.
    if (this.frames.length > 8) {
      this.frames.shift();
      if (this.time !== undefined)
        this.time = Math.max(this.time, this.frames[0].time);
    }
  }

  sample(now: number, active: boolean) {
    const latest = this.frames.at(-1);
    if (!latest) return;
    if (!active) {
      this.frames = [latest];
      this.time = this.lastAt = undefined;
      this.buffering = false;
      return this.pose(undefined, latest.plane, 1);
    }
    const elapsed =
      this.lastAt === undefined ? 0 : Math.max(0, (now - this.lastAt) / 1000);
    this.lastAt = now;
    this.time ??= latest.time - this.delay;
    if (!this.buffering || latest.time - this.time >= this.delay) {
      this.buffering = false;
      this.time += elapsed;
      if (this.time > latest.time) {
        this.time = latest.time;
        this.buffering = true;
      }
    }
    while (this.frames.length > 2 && this.frames[1].time <= this.time)
      this.frames.shift();
    const first = this.frames[0],
      second = this.frames[1];
    if (!second) return this.pose(undefined, first.plane, 1);
    return this.pose(
      first.plane,
      second.plane,
      (this.time - first.time) / (second.time - first.time),
    );
  }

  private pose(
    previous: PlaneState | undefined,
    current: PlaneState,
    alpha: number,
  ) {
    const pose = flightPose(previous, current, alpha);
    pose.discontinuity ||= this.pendingSnap;
    this.pendingSnap = false;
    return pose;
  }
}
