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
