import { expect, it } from "vitest";
import { consolidateRubble, rubbleVolume } from "../src/sim/rubble";
import type { Ruin, Material } from "../src/types";
// Selection from the pre-optimization implementation, deliberately retaining
// its allocation-heavy filter/reduce/hypot paths as an independent reference.
function reference(incoming: Ruin, existing: Ruin[]) {
  const candidates = existing.filter((r) => r.material === incoming.material);
  if (candidates.length) {
    const piles = candidates.filter((r) => r.pile),
      pool = piles.length ? piles : candidates;
    return [
      incoming,
      pool.reduce((best, r) =>
        Math.hypot(r.p[0] - incoming.p[0], r.p[2] - incoming.p[2]) <
        Math.hypot(best.p[0] - incoming.p[0], best.p[2] - incoming.p[2])
          ? r
          : best,
      ),
    ];
  }
  let pair: Ruin[] = [],
    best = Infinity;
  for (let i = 0; i < existing.length; i++)
    for (let j = i + 1; j < existing.length; j++) {
      if (existing[i].material !== existing[j].material) continue;
      const d = Math.hypot(
        existing[i].p[0] - existing[j].p[0],
        existing[i].p[2] - existing[j].p[2],
      );
      if (d < best) {
        best = d;
        pair = [existing[i], existing[j]];
      }
    }
  return pair;
}
const materials: Material[] = ["stone", "wood", "earth", "rock", "plaster"];
function record(id: number, material: Material, seed: number): Ruin {
  return {
    id,
    source: id,
    material,
    kind: "chunk",
    p: [
      ((id * 19 + seed * 7) % 127) / 2,
      10,
      ((id * 31 + seed * 13) % 113) / 2,
    ],
    s: [1 + (id % 3), 2, 1],
    q: [0, 0, 0, 1],
    pile: id % 7 === 0,
  };
}
it("matches reference merge identities, material, location and volume across full rubble cells", () => {
  for (let seed = 0; seed < 150; seed++) {
    const existing = Array.from({ length: 12 + (seed % 117) }, (_, id) =>
      record(id, materials[id % 5], seed),
    );
    const incoming = record(
      99999,
      seed % 3 ? materials[seed % 5] : "roof",
      seed,
    );
    incoming.roofPart = incoming.material === "roof" ? 2 : undefined;
    const [a, b] = reference(incoming, existing);
    const va = rubbleVolume(a),
      vb = rubbleVolume(b),
      volume = va + vb;
    const actual = consolidateRubble(
      incoming,
      existing,
      (x, z) => x * 0.02 + z * 0.01,
    );
    expect(actual.removed).toBe(b.id);
    expect(actual.ruin.id).toBe(a.id);
    expect(actual.ruin.material).toBe(a.material);
    expect(actual.ruin.volume).toBe(volume);
    expect(actual.ruin.p[0]).toBe((a.p[0] * va + b.p[0] * vb) / volume);
    expect(actual.ruin.p[2]).toBe((a.p[2] * va + b.p[2] * vb) / volume);
    expect(actual.ruin.p[1]).toBe(
      actual.ruin.p[0] * 0.02 + actual.ruin.p[2] * 0.01 + actual.ruin.s[1],
    );
  }
});
