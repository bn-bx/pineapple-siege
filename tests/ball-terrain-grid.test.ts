import { expect, it } from "vitest";
import { ballTerrainGrid } from "../src/sim/ball-terrain-grid";
it("reduces flat and planar terrain to 8 m collision samples with identical heights", () => {
  const fine = new Float32Array(33 * 33);
  for (let x = 0; x <= 32; x++)
    for (let z = 0; z <= 32; z++) fine[x * 33 + z] = x * 0.25 + z * 0.5;
  const result = ballTerrainGrid(fine);
  expect(result.samples).toBe(8);
  expect(result.heights).toHaveLength(9 * 9);
  for (let x = 0; x <= 8; x++)
    for (let z = 0; z <= 8; z++)
      expect(result.heights[x * 9 + z]).toBe(fine[x * 4 * 33 + z * 4]);
});
it("uses 4 m samples when 8 m interpolation would exceed 25 cm", () => {
  const fine = new Float32Array(33 * 33);
  for (let x = 0; x <= 32; x++)
    for (let z = 0; z <= 32; z++)
      fine[x * 33 + z] = x % 4 === 2 ? 0.4 : x % 2 ? 0.2 : 0;
  expect(ballTerrainGrid(fine).samples).toBe(16);
});
it("retains the fine mesh for narrow ridges, deep holes and sharp edits", () => {
  for (const height of [12, -500]) {
    const fine = new Float32Array(33 * 33);
    fine[15 * 33 + 17] = height;
    const result = ballTerrainGrid(fine);
    expect(result.samples).toBe(32);
    expect(result.heights).toBe(fine);
  }
});
