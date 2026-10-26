/**
 * Island-wide sun shadows from a coarse height grid ("horizon" shadows).
 *
 * Each texel marches toward the light across the grid; if terrain (or the
 * statue's raised footprint) rises above the ray, the texel is in shadow.
 * Soft edges come from the largest elevation excess along the ray, which
 * stands in for the sun's angular size and the grid's coarseness.
 *
 * Pure and allocation-free when `out` is supplied, so it runs the same in the
 * worker and in tests.
 */
export interface LightDirection {
  x: number;
  y: number;
  z: number;
}

/** Tangent of the elevation excess over which a shadow edge fades. */
export const SUN_MASK_SOFTNESS = 0.02;
/** Lift a texel's own height so smooth slopes do not shadow themselves. */
const SELF_BIAS = 1.5;
/** Below this elevation (as a tangent) the light grazes; treat as very low. */
const MIN_TAN = 0.015;

export function computeSunMask(
  heights: Float32Array,
  n: number,
  cell: number,
  light: LightDirection,
  out = new Uint8Array(n * n),
  maxHeight = maxOf(heights),
) {
  const horizontal = Math.hypot(light.x, light.z);
  // Light straight overhead: nothing can shadow anything else.
  if (horizontal < 1e-4) return out.fill(255);
  const dx = light.x / horizontal,
    dz = light.z / horizontal;
  const tan = Math.max(MIN_TAN, light.y / horizontal);
  const soft = SUN_MASK_SOFTNESS;
  const maxSteps = Math.ceil(n * 1.5);
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const index = j * n + i;
      const base = heights[index] + SELF_BIAS;
      let excess = -Infinity;
      for (let s = 1; s <= maxSteps; s++) {
        const x = i + dx * s,
          z = j + dz * s;
        if (x < 0 || z < 0 || x > n - 1 || z > n - 1) break;
        const distance = s * cell;
        const ray = base + tan * distance;
        // Nothing beyond can rise above the ray once it clears the tallest point.
        if (ray > maxHeight) break;
        const e = (bilinear(heights, n, x, z) - ray) / distance;
        if (e > excess) {
          excess = e;
          if (excess >= soft) break;
        }
      }
      out[index] = excess === -Infinity ? 255 : Math.round(255 * (1 - smoothstep(-soft, soft, excess)));
    }
  return out;
}

export function maxOf(values: ArrayLike<number>) {
  let m = -Infinity;
  for (let i = 0; i < values.length; i++) if (values[i] > m) m = values[i];
  return m;
}

function bilinear(h: Float32Array, n: number, x: number, z: number) {
  const ix = Math.min(n - 2, Math.floor(x)),
    iz = Math.min(n - 2, Math.floor(z)),
    u = x - ix,
    v = z - iz,
    i = iz * n + ix;
  const top = h[i] + (h[i + 1] - h[i]) * u;
  const bottom = h[i + n] + (h[i + n + 1] - h[i + n]) * u;
  return top + (bottom - top) * v;
}

function smoothstep(a: number, b: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Box footprint that raises the caster grid (used for statue parts). */
export interface CasterBox {
  x: number;
  z: number;
  halfWidth: number;
  top: number;
}

/**
 * Raises grid cells under each box to the box's top. Cells are sampled at
 * their centres, (i + 0.5) * cell, matching the mask texture's texel centres.
 */
export function raiseCasters(
  heights: Float32Array,
  n: number,
  cell: number,
  boxes: readonly CasterBox[],
) {
  for (const b of boxes) {
    const i0 = Math.max(0, Math.floor((b.x - b.halfWidth) / cell - 0.5));
    const i1 = Math.min(n - 1, Math.ceil((b.x + b.halfWidth) / cell - 0.5));
    const j0 = Math.max(0, Math.floor((b.z - b.halfWidth) / cell - 0.5));
    const j1 = Math.min(n - 1, Math.ceil((b.z + b.halfWidth) / cell - 0.5));
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const k = j * n + i;
        if (b.top > heights[k]) heights[k] = b.top;
      }
  }
  return heights;
}
