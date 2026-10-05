import { expect, it } from "vitest";
import { StaticBlockerIndex } from "../src/sim/static-blockers";
import type { Entity, Vec3 } from "../src/types";

it("keeps exact navigation clearance across cells, overhangs and removed buildings", () => {
  const entities: Entity[] = Array.from({ length: 80 }, (_, id) => ({
    id,
    kind: id % 13 === 0 ? "tree" : "block",
    material: "stone",
    p: [
      1000 + (id % 8) * 19,
      (id % 3) * 12 + 5,
      1000 + Math.floor(id / 8) * 17,
    ],
    s: [(id % 5) + 2, (id % 7) + 1, (id % 9) + 3],
    variant: 0,
    assembly: "test",
    foundation: true,
    supports: [],
  }));
  const removed = new Set<number>();
  const civilian = new StaticBlockerIndex(16, 1, false),
    monster = new StaticBlockerIndex(64, 30, true);
  for (const e of entities) {
    civilian.add(e);
    monster.add(e);
  }
  const brute = (p: Vec3, monsters: boolean) =>
    entities.some(
      (e) =>
        e.kind !== "tree" &&
        !removed.has(e.id) &&
        Math.abs(e.p[0] - p[0]) < e.s[0] + (monsters ? 30 : 1) &&
        Math.abs(e.p[2] - p[2]) < e.s[2] + (monsters ? 30 : 1) &&
        e.p[1] + e.s[1] > p[1] + (monsters ? 2 : 0) &&
        (monsters || e.p[1] - e.s[1] < p[1] + 4),
    );
  for (let round = 0; round < 2; round++) {
    for (let i = 0; i < 2400; i++) {
      const p: Vec3 = [
        960 + (i % 53) * 4,
        (i % 9) * 5,
        960 + Math.floor(i / 53) * 5,
      ];
      expect(civilian.blocked(p, removed)).toBe(brute(p, false));
      expect(monster.blocked(p, removed)).toBe(brute(p, true));
    }
    for (const e of entities) if (e.id % 2) removed.add(e.id);
  }
  for (const e of entities) removed.add(e.id);
  expect(civilian.blocked(entities[1].p, removed)).toBe(false);
  expect(monster.blocked(entities[1].p, removed)).toBe(false);
});
