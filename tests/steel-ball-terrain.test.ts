import { expect, it } from "vitest";
import { CONFIG } from "../src/config";
import { Terrain } from "../src/sim/terrain";
it("makes shallow continuous baseline-relative tracks, bounded overlapping dents, and preserves deeper excavation", () => {
  const terrain = new Terrain(
    new Float32Array(CONFIG.grid * CONFIG.grid),
    [],
    true,
  );
  const a = [1000, 30, 1000],
    b = [1100, 30, 1000];
  const patch = terrain.steelBallTrack(a, b, 10, 1);
  expect(patch.indices.length).toBeGreaterThan(0);
  for (let x = 1000; x <= 1100; x += 2)
    expect(terrain.sample(x, 1000)).toBe(-1);
  expect(terrain.sample(1050, 1012)).toBe(0);
  expect(terrain.sample(1050, 1004)).toBeLessThan(0);
  expect(terrain.sample(1050, 1004)).toBeGreaterThan(-1);
  expect(terrain.steelBallTrack(a, b, 10, 1).indices).toHaveLength(0);
  expect(terrain.dirtySamples.size).toBe(patch.indices.length);
  for (const id of patch.chunks)
    expect(terrain.sectionVersions[id]).toBeGreaterThan(0);
  terrain.steelBallTrack(a, a, 30, 2);
  expect(terrain.sample(1000, 1000)).toBe(-2);
  expect(terrain.steelBallTrack(a, a, 30, 2).indices).toHaveLength(0);
  terrain.crater(1000, 1000, 15, 10);
  const deep = terrain.sample(1000, 1000);
  terrain.steelBallTrack(a, b, 10, 1);
  terrain.steelBallTrack(a, a, 30, 2);
  expect(terrain.sample(1000, 1000)).toBe(deep);
  expect(deep).toBeLessThan(-2);
});
it("marks flooded shoreline samples and water revisions after a landing dent", () => {
  const heights = new Float32Array(CONFIG.grid * CONFIG.grid).fill(0.5);
  for (let z = 0; z < CONFIG.grid; z++)
    for (let x = 0; x <= 30; x++) heights[z * CONFIG.grid + x] = -1;
  const terrain = new Terrain(heights);
  expect(terrain.water(64, 1000)).toBe(false);
  const patch = terrain.steelBallTrack([70, 0, 1000], [70, 0, 1000], 30, 2);
  const flooded = terrain.floodChanged(patch.indices);
  expect(flooded.length).toBeGreaterThan(0);
  expect(terrain.water(64, 1000)).toBe(true);
  expect(terrain.surfaceHeight(64, 1000)).toBe(0);
});
