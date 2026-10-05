import { isRoof } from "../debris-shape";
import type { Ruin, Vec3 } from "../types";

export const rubbleVolume = (
  r: Pick<Ruin, "s" | "volume" | "material" | "roofPart" | "pile">,
) =>
  r.volume ??
  8 *
    r.s[0] *
    r.s[1] *
    r.s[2] *
    (isRoof(r.material) && !r.pile ? (r.roofPart ? 1 / 6 : 1 / 3) : 1);

/** Bounded records, retained material. Consolidation never caps accumulated volume. */
export function consolidateRubble(
  incoming: Ruin,
  existing: Ruin[],
  ground: (x: number, z: number) => number,
): { ruin: Ruin; removed: number } {
  // There are seven materials and at least twelve records per cell, so a full
  // cell always has a mergeable material pair, even if incoming has a new material.
  let a = incoming,
    b: Ruin | undefined,
    nearest = Infinity,
    preferPile = false;
  for (const r of existing) {
    if (r.material !== incoming.material) continue;
    if (r.pile && !preferPile) {
      preferPile = true;
      nearest = Infinity;
      b = undefined;
    }
    if (preferPile && !r.pile) continue;
    const d = (r.p[0] - a.p[0]) ** 2 + (r.p[2] - a.p[2]) ** 2;
    if (!b || d < nearest) {
      b = r;
      nearest = d;
    }
  }
  if (!b) {
    let pair: [Ruin, Ruin] | undefined,
      best = Infinity;
    for (let i = 0; i < existing.length; i++)
      for (let j = i + 1; j < existing.length; j++) {
        if (existing[i].material !== existing[j].material) continue;
        const d =
          (existing[i].p[0] - existing[j].p[0]) ** 2 +
          (existing[i].p[2] - existing[j].p[2]) ** 2;
        if (d < best) {
          pair = [existing[i], existing[j]];
          best = d;
        }
      }
    if (!pair) throw new Error("Rubble cell has no mergeable material pair");
    [a, b] = pair;
  }
  const va = rubbleVolume(a),
    vb = rubbleVolume(b),
    volume = va + vb;
  const p: Vec3 = [
    (a.p[0] * va + b.p[0] * vb) / volume,
    0,
    (a.p[2] * va + b.p[2] * vb) / volume,
  ];
  const unit = Math.cbrt(volume / (8 * 1.4 * 0.65 * 1.4));
  const s: Vec3 = [unit * 1.4, unit * 0.65, unit * 1.4];
  p[1] = ground(p[0], p[2]) + s[1];
  return {
    removed: b.id,
    ruin: {
      ...a,
      p,
      s,
      volume,
      pile: true,
      roofPart: undefined,
      kind: "chunk",
      q: [0, 0, 0, 1],
    },
  };
}
