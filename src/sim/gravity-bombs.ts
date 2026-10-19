import { CONFIG, GRAVITY_BOMB as G } from "../config";
import type { GravityBombState, PlaneState, Vec3 } from "../types";

export function gravityRadius(bomb: GravityBombState) {
  return bomb.phase === "falling"
    ? G.capsuleRadius
    : bomb.phase === "bursting"
      ? G.radius
      : G.initialRadius +
        (G.radius - G.initialRadius) * Math.min(1, bomb.age / G.pullSeconds);
}

/** Combine all fields before clamping, so overlapping cores cannot multiply the speed cap. */
export function gravityVelocity(
  p: Vec3,
  v: Vec3,
  pulls: GravityBombState[],
  bursts: GravityBombState[],
  dt: number,
): Vec3 | null {
  const result: Vec3 = [...v];
  let affected = false;
  for (const bomb of [...pulls, ...bursts]) {
    const dx = bomb.p[0] - p[0],
      dy = bomb.p[1] - p[1],
      dz = bomb.p[2] - p[2];
    const distance = Math.hypot(dx, dy, dz),
      radius = gravityRadius(bomb);
    if (distance > radius) continue;
    affected = true;
    const falloff = Math.max(0, 1 - distance / radius);
    const denominator = Math.max(15, distance);
    if (bomb.phase === "bursting") {
      const impulse = G.burstSpeed * falloff;
      const outward: Vec3 =
        distance > 1e-6
          ? [-dx / distance, -dy / distance, -dz / distance]
          : [1, 0, 0];
      const inwardSpeed = Math.min(
        0,
        result.reduce((sum, v, i) => sum + v * outward[i], 0),
      );
      for (let i = 0; i < 3; i++)
        result[i] += outward[i] * (impulse - inwardSpeed);
      result[1] += 1.1 * impulse;
    } else {
      const acceleration = G.acceleration * (0.25 + 0.75 * falloff) * dt;
      result[0] +=
        (dx / denominator - (dz / denominator) * 0.22) * acceleration;
      result[1] += (dy / denominator + 0.65) * acceleration;
      result[2] +=
        (dz / denominator + (dx / denominator) * 0.22) * acceleration;
    }
  }
  if (!affected) return null;
  const speed = Math.hypot(...result);
  if (speed > G.maxSpeed)
    for (let i = 0; i < 3; i++) result[i] *= G.maxSpeed / speed;
  return result;
}

interface Bomb extends GravityBombState {
  v: Vec3;
}
export class GravityBombs {
  readonly bombs: Bomb[] = [];
  private nextId = 1;
  constructor(
    private sweep: (a: Vec3, b: Vec3, radius: number) => Vec3 | null,
  ) {}
  drop(plane: PlaneState) {
    if (this.bombs.length >= G.maxActive) return false;
    this.bombs.push({
      id: this.nextId++,
      p: [plane.p[0], plane.p[1] - 12, plane.p[2]],
      v: [...plane.v],
      age: 0,
      phase: "falling",
    });
    return true;
  }
  /** Returns only newly bursting bombs; the release impulse is applied once. */
  update(dt: number): GravityBombState[] {
    const bursts: GravityBombState[] = [];
    for (let i = this.bombs.length - 1; i >= 0; i--) {
      const bomb = this.bombs[i];
      bomb.age += dt;
      if (bomb.phase === "falling") {
        const next = bomb.p.map((p, axis) => p + bomb.v[axis] * dt) as Vec3;
        const hit = this.sweep(bomb.p, next, G.capsuleRadius);
        if (hit) {
          bomb.p = [hit[0], hit[1] + G.liftHeight, hit[2]];
          bomb.v = [0, 0, 0];
          bomb.age = 0;
          bomb.phase = "pulling";
        } else if (
          bomb.age >= G.lifetime ||
          next[0] < 0 ||
          next[2] < 0 ||
          next[0] > CONFIG.worldSize ||
          next[2] > CONFIG.worldSize
        ) {
          this.bombs.splice(i, 1);
        } else {
          bomb.p = next;
          bomb.v[1] -= CONFIG.debrisGravity * dt;
        }
      } else if (bomb.phase === "pulling" && bomb.age >= G.pullSeconds - 1e-9) {
        bomb.phase = "bursting";
        bomb.age = 0;
        bursts.push(bomb);
      } else if (bomb.phase === "bursting" && bomb.age >= G.burstSeconds - 1e-9)
        this.bombs.splice(i, 1);
    }
    return bursts;
  }
  snapshot(): GravityBombState[] {
    return this.bombs.map(({ id, p, age, phase }) => ({
      id,
      p: [...p],
      age,
      phase,
    }));
  }
  reset() {
    this.bombs.length = 0;
  }
}
