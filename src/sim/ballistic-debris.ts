import type { BodyView, Quat, Vec3 } from "../types";
import type { Terrain } from "./terrain";
import { CONFIG } from "../config";
import { isRoof, roofClearance } from "../debris-shape";

/** Overflow wreckage keeps moving without adding Rapier contact pairs. */
export interface BallisticDebris {
  view: BodyView;
  velocity: Vec3;
  angular: Vec3;
  grounded: number;
}

export function orientedSize(s: Vec3, q: Quat): Vec3 {
  const [x, y, z, w] = q;
  return [
    Math.abs(1 - 2 * (y * y + z * z)) * s[0] +
      Math.abs(2 * (x * y - z * w)) * s[1] +
      Math.abs(2 * (x * z + y * w)) * s[2],
    Math.abs(2 * (x * y + z * w)) * s[0] +
      Math.abs(1 - 2 * (x * x + z * z)) * s[1] +
      Math.abs(2 * (y * z - x * w)) * s[2],
    Math.abs(2 * (x * z - y * w)) * s[0] +
      Math.abs(2 * (y * z + x * w)) * s[1] +
      Math.abs(1 - 2 * (x * x + y * y)) * s[2],
  ];
}

/** Returns true only after resting on the current terrain. Never lands by timeout. */
export function advanceDebris(
  m: BallisticDebris,
  terrain: Terrain,
  dt: number,
) {
  const { p, q, s } = m.view;
  const v = m.velocity,
    a = m.angular;
  const [x, y, z, w] = q;
  const half = dt * 0.5;
  q[0] += half * (a[0] * w + a[1] * z - a[2] * y);
  q[1] += half * (-a[0] * z + a[1] * w + a[2] * x);
  q[2] += half * (a[0] * y - a[1] * x + a[2] * w);
  q[3] += half * (-a[0] * x - a[1] * y - a[2] * z);
  const length = Math.hypot(...q);
  for (let k = 0; k < 4; k++) q[k] /= length;

  const height = isRoof(m.view.material)
    ? roofClearance(s, q, m.view.roofPart)
    : orientedSize(s, q)[1];
  const next: Vec3 = [p[0] + v[0] * dt, p[1] + v[1] * dt, p[2] + v[2] * dt];
  const steps = terrain.aboveSurface(p, next, height)
    ? 1
    : Math.max(1, Math.ceil((Math.hypot(...v) * dt) / 1.5));
  const step = dt / steps;
  let contact = false;
  for (let i = 0; i < steps; i++) {
    for (let k = 0; k < 3; k++) p[k] += v[k] * step;
    v[1] -= CONFIG.debrisGravity * step;
    for (const k of [0, 2]) {
      if (p[k] < 8 || p[k] > 2040) {
        p[k] = Math.max(8, Math.min(2040, p[k]));
        v[k] *= -0.25;
      }
    }
    const floor = terrain.sample(p[0], p[2]) + height;
    if (p[1] <= floor || (p[1] - floor < 0.02 && v[1] < 1)) {
      p[1] = floor;
      v[1] = v[1] < -2 ? -v[1] * 0.2 : 0;
      v[0] *= 0.6;
      v[2] *= 0.6;
      for (let k = 0; k < 3; k++) a[k] *= 0.5;
      contact = true;
      break;
    }
  }
  const damping = Math.exp(-0.06 * dt);
  for (let k = 0; k < 3; k++) v[k] *= damping;
  m.grounded = contact && Math.hypot(...v) < 2 ? m.grounded + dt : 0;
  return m.grounded >= 0.15;
}
