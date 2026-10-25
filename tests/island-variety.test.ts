import { expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  generationRequest,
  generateIsland,
  parseIslandCode,
  planIsland,
  seedCode,
} from "../src/world/generator.mjs";

it("uses one seed identity without a style choice and retains old shared layouts", () => {
  for (const seed of [0, 42, 4294967295]) {
    const request = generationRequest(seed);
    expect(request.generatorVersion).toBe(7);
    expect(request.preset).toBeUndefined();
    expect(parseIslandCode(seedCode(request))).toEqual(request);
    expect(generationRequest({ ...request, preset: "W" })).toEqual(request);
  }
  expect(parseIslandCode("PS5-R-0000002A")).toEqual({
    generatorVersion: 5,
    preset: "R",
    seed: 42,
  });
  expect(parseIslandCode("PS4-0000002A").generatorVersion).toBe(4);
});

it("produces strongly different populated mainlands from consecutive seeds without forced passes", () => {
  const shapes = new Set<string>(),
    profiles = new Set<string>(),
    landFractions: number[] = [],
    foothills: number[] = [],
    fingerprints = new Set<string>();
  for (const seed of [0, 1, 2, 3, 4, 5]) {
    const plan = planIsland(seed);
    shapes.add(plan.shapeFamily);
    profiles.add(plan.landscapeProfile);
    expect(plan.castles).toHaveLength(5);
    expect(plan.passes).toEqual([]);
    expect(plan.flightCorridors.every((c) => c.id.endsWith("-approach"))).toBe(
      true,
    );
    let land = 0,
      hills = 0;
    for (const h of plan.heights) {
      land += Number(h > 0);
      hills += Number(h > 150);
    }
    landFractions.push(land / plan.heights.length);
    foothills.push(hills / land);
    fingerprints.add(
      createHash("sha256")
        .update(new Uint8Array(plan.heights.buffer))
        .digest("hex"),
    );
  }
  expect(shapes.size).toBe(6);
  expect(profiles.size).toBeGreaterThanOrEqual(2);
  expect(fingerprints.size).toBe(6);
  expect(
    Math.max(...landFractions) - Math.min(...landFractions),
  ).toBeGreaterThan(0.07);
  expect(Math.max(...foothills)).toBeGreaterThan(0.3);
  expect(Math.max(...foothills) / Math.min(...foothills)).toBeGreaterThan(1.5);
}, 120000);

it("reproduces geography and inhabitants for a repeated single-generator seed", () => {
  const a = planIsland(3),
    b = planIsland(3);
  expect(a.heights).toEqual(b.heights);
  expect(a.sites).toEqual(b.sites);
  expect(a.rivers).toEqual(b.rivers);
}, 60000);

it.each([12, 20, 22])(
  "materializes difficult single-generator seed %i",
  (seed) => {
    const { world } = generateIsland(seed);
    expect(world.generatorVersion).toBe(7);
    expect(world.castles).toHaveLength(5);
    expect(world.structureCount).toBeLessThanOrEqual(48000);
  },
  60000,
);
