import { expect, it } from "vitest";
import { CONFIG } from "../src/config";
import { BLAST_DRY_DEPTH, Terrain } from "../src/sim/terrain";

it("dries river water where a blast digs into it, and nowhere else", () => {
  // Flat land at 20 m with a straight river whose surface sits at 21 m.
  const base = new Float32Array(CONFIG.grid * CONFIG.grid).fill(20);
  const river = {
    id: "r",
    width: 10,
    widths: [10, 10],
    points: [
      [200, 21, 400],
      [600, 21, 400],
    ],
  };
  const terrain = new Terrain(base, [river] as any, false, {
    lakes: [],
    generatorVersion: 7,
  });
  expect(terrain.surfaceHeight(400, 400)).toBeCloseTo(21);
  expect(terrain.surfaceHeight(300, 400)).toBeCloseTo(21);

  const patch = terrain.crater(400, 400, 12, 5);
  const dried = terrain.drainInland(patch.indices);
  expect(dried.length).toBeGreaterThan(0);
  for (const i of dried) {
    expect(terrain.heights[i]).toBeLessThan(base[i] - BLAST_DRY_DEPTH);
    expect(terrain.rivers.cells.has(i)).toBe(true);
  }
  // The blast centre is dry; the river away from it still flows.
  expect(terrain.surfaceHeight(400, 400)).toBeUndefined();
  expect(terrain.riverSurface(400, 400)).toBeUndefined();
  expect(terrain.surfaceHeight(300, 400)).toBeCloseTo(21);
  // The renderer's mask agrees, so a reload shows the same thing.
  const mask = terrain.waterMask();
  expect(mask[terrain.rivers.index(400, 400)]).toBe(0);
  expect(mask[terrain.rivers.index(300, 400)]).toBe(255);
  // Damage away from water dries nothing.
  const dryLand = terrain.crater(1500, 1500, 12, 5);
  expect(terrain.drainInland(dryLand.indices).length).toBe(0);
});
