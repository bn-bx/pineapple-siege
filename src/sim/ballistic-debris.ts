import type { BodyView, Quat, Vec3 } from "../types";
import type { Terrain } from "./terrain";
import { CONFIG } from "../config";
import { isRoof, roofClearance } from "../debris-shape";

/** Overflow wreckage keeps moving without adding Rapier contact pairs. */
const scratchNext: Vec3 = [0, 0, 0];
const damping60 = Math.exp(-0.06 * CONFIG.dt);
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
  const length = Math.sqrt(
    q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3],
  );
  q[0] /= length;
  q[1] /= length;
  q[2] /= length;
  q[3] /= length;

  const height = isRoof(m.view.material)
    ? roofClearance(s, q, m.view.roofPart)
    : Math.abs(2 * (q[0] * q[1] + q[2] * q[3])) * s[0] +
      Math.abs(1 - 2 * (q[0] * q[0] + q[2] * q[2])) * s[1] +
      Math.abs(2 * (q[1] * q[2] - q[0] * q[3])) * s[2];
  const next = scratchNext;
  next[0] = p[0] + v[0] * dt;
  next[1] = p[1] + v[1] * dt;
  next[2] = p[2] + v[2] * dt;
  const above = terrain.aboveSurface(p, next, height);
  const steps = above
    ? 1
    : Math.max(1, Math.ceil((Math.hypot(...v) * dt) / 1.5));
  const step = dt / steps;
  let contact = false;
  for (let i = 0; i < steps; i++) {
    p[0] += v[0] * step;
    p[1] += v[1] * step;
    p[2] += v[2] * step;
    v[1] -= CONFIG.debrisGravity * step;
    if (p[0] < 8 || p[0] > CONFIG.worldSize - 8) {
      p[0] = Math.max(8, Math.min(CONFIG.worldSize - 8, p[0]));
      v[0] *= -0.25;
    }
    if (p[2] < 8 || p[2] > CONFIG.worldSize - 8) {
      p[2] = Math.max(8, Math.min(CONFIG.worldSize - 8, p[2]));
      v[2] *= -0.25;
    }
    const floor = above ? -Infinity : terrain.sample(p[0], p[2]) + height;
    if (p[1] <= floor || (p[1] - floor < 0.02 && v[1] < 1)) {
      p[1] = floor;
      v[1] = v[1] < -2 ? -v[1] * 0.2 : 0;
      v[0] *= 0.6;
      v[2] *= 0.6;
      a[0] *= 0.5;
      a[1] *= 0.5;
      a[2] *= 0.5;
      contact = true;
      break;
    }
  }
  const damping = dt === CONFIG.dt ? damping60 : Math.exp(-0.06 * dt);
  v[0] *= damping;
  v[1] *= damping;
  v[2] *= damping;
  m.grounded =
    contact && v[0] * v[0] + v[1] * v[1] + v[2] * v[2] < 4
      ? m.grounded + dt
      : 0;
  return m.grounded >= 0.15;
}
