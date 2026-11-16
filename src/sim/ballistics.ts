import type { Vec3 } from "../types";

/**
 * Launch velocity (relative to a moving carrier) of the given speed that
 * carries a projectile under `gravity` from `from` to `to`, taking the
 * flatter of the two arcs. The projectile's world velocity is the result
 * plus `carrier`. Returns null when the target is out of range.
 */
export function solveLaunch(
  from: Vec3,
  to: Vec3,
  speed: number,
  gravity: number,
  carrier: Vec3 = [0, 0, 0],
): Vec3 | null {
  const d: Vec3 = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
  const distance = Math.hypot(...d);
  if (distance < 1e-6 || speed <= 0) return null;
  // Fixed-point iteration on flight time: start with the straight-line time
  // and stretch it until the required launch speed matches `speed`.
  let t = distance / speed;
  let u: Vec3 = [0, 0, 0];
  for (let i = 0; i < 24; i++) {
    u = [
      d[0] / t - carrier[0],
      (d[1] + 0.5 * gravity * t * t) / t - carrier[1],
      d[2] / t - carrier[2],
    ];
    const m = Math.hypot(...u);
    if (Math.abs(m - speed) < speed * 1e-4) return u;
    t *= m / speed;
    if (!Number.isFinite(t) || t <= 0 || t > 120) return null;
  }
  const m = Math.hypot(...u);
  return Math.abs(m - speed) < speed * 0.02
    ? (u.map((v) => (v * speed) / m) as Vec3)
    : null;
}

/** A lob speed that reaches `distance` comfortably under `gravity`. */
export function lobSpeed(distance: number, gravity: number, min: number, max: number) {
  // sqrt(g d) is the minimum speed for a flat-ground shot; add headroom.
  return Math.min(max, Math.max(min, Math.sqrt(gravity * Math.max(1, distance)) * 1.15));
}
