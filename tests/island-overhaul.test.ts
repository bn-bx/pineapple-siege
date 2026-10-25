import { beforeAll, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  generateIsland,
  planIsland,
  materializeIsland,
  parseIslandCode,
  seedCode,
  baselineKey,
  validateIsland,
  PRESETS,
  sampleHeight,
} from "../src/world/generator.mjs";
import { onMainland } from "../src/world/landscape.mjs";
import { inlandWaterHeight } from "../src/world/water-geometry.mjs";
import { Terrain } from "../src/sim/terrain";
import { RiverField } from "../src/world/rivers";
import { WaterSurfaceLookup } from "../src/render/waterline-lookup";
import { compatible } from "../src/storage";
import { Simulation, initializePhysics } from "../src/sim/simulation";
import type { GenerationPreset, LakeData, RiverData } from "../src/types";
const digest = (data: Uint8Array | string) =>
  createHash("sha256").update(data).digest("hex");
beforeAll(initializePhysics);
it("retains the exact PS4 terrain and structural output behind version dispatch", () => {
  const baseline = generateIsland({ seed: 42, generatorVersion: 4 });
  expect(digest(new Uint8Array(baseline.heights.buffer))).toBe(
    "6def8861d5d5d7a1e795cdd6a49760a37660265b14616a2223b50c49de0ba0c1",
  );
  expect(digest(JSON.stringify(baseline.world))).toBe(
    "7017e02e9e8f1673bbac1be15eacf85b5458f9413ad5b5cc3869cd8c716738dc",
  );
  expect(validateIsland(baseline.world, baseline.heights).peak).toBeGreaterThan(
    700,
  );
  const sim = new Simulation(
    baseline.world,
    baseline.heights,
    () => {},
    undefined,
    true,
  );
  try {
    sim.explode([...baseline.world.castle], 1);
    const save = sim.save();
    expect(save.removed.length).toBeGreaterThan(0);
    expect(compatible(save, 10, 42, 4)).toBe(true);
    const restored = new Simulation(
      baseline.world,
      baseline.heights,
      () => {},
      save,
      true,
    );
    try {
      expect([...restored.removed]).toEqual(save.removed);
    } finally {
      restored.dispose();
    }
  } finally {
    sim.dispose();
  }
}, 60_000);
it("shares each preset and revision independently of the currently selected island", () => {
  for (const preset of Object.keys(PRESETS) as GenerationPreset[])
    for (const seed of [0, 1, 4294967295]) {
      const request = { seed, generatorVersion: 5, preset };
      expect(parseIslandCode(seedCode(request))).toEqual(request);
    }
  expect(seedCode(parseIslandCode(" ps4-0000002a "))).toBe("PS4-0000002A");
  for (const code of [
    "PS5-X-00000001",
    "PS5-B-100000000",
    "PS5-00000001",
    "PS3-00000001",
  ])
    expect(() => parseIslandCode(code)).toThrow();
  expect(
    baselineKey({
      version: 11,
      generatorVersion: 5,
      seed: 42,
      generationPreset: "H",
    }),
  ).not.toBe(
    baselineKey({
      version: 11,
      generatorVersion: 5,
      seed: 42,
      generationPreset: "B",
    }),
  );
});
it.each(["B", "H", "R", "W"] as GenerationPreset[])(
  "plans and materializes valid distinct %s geography with persistent identity",
  (preset) => {
    const request = { seed: 42, preset, generatorVersion: 5 };
    const plan = planIsland(request),
      again = planIsland(request);
    expect(digest(new Uint8Array(plan.heights.buffer))).toBe(
      digest(new Uint8Array(again.heights.buffer)),
    );
    expect(plan.sites).toEqual(again.sites);
    expect(plan.heights.byteLength).toBeLessThan(2 * 1024 * 1024);
    const baseline = materializeIsland(plan),
      { world, heights } = baseline;
    if (preset === "B") {
      expect(digest(new Uint8Array(heights.buffer))).toBe(
        "3d0a7c7d7085e23423a2a7e7f3a9db4aad57cddf61cee3102686a019cedcf6a8",
      );
      expect(digest(JSON.stringify(world))).toBe(
        "72eed14ec8d345f01e144c9a9e25114e21626894132b8650aaa0fb64c31d3dae",
      );
    }
    expect(world.generationPreset).toBe(preset);
    expect(validateIsland(world, heights).peak).toBeGreaterThanOrEqual(700);
    expect(world.castles).toHaveLength(5);
    expect(world.lakes!.length).toBeGreaterThan(0);
    expect(world.waterfalls!.length).toBeGreaterThan(0);
    expect(
      new Set(world.castles!.map((c) => (c as any).layout)).size,
    ).toBeGreaterThan(1);
    expect(world.structureCount).toBeLessThanOrEqual(48000);
    for (const e of world.entities.slice(0, world.structureCount))
      if (e.foundation)
        expect(e.p[1] - e.s[1]).toBeLessThanOrEqual(
          sampleHeight(heights, e.p[0], e.p[2]) + 1.4,
        );
    expect(
      world.entities.filter((e) => e.kind === "tree").length,
    ).toBeLessThanOrEqual(30000);
    for (const resident of world.civilians!)
      expect(onMainland(world.mainland!, resident.p[0], resident.p[2])).toBe(
        true,
      );
    for (const river of world.rivers!) {
      expect(river.widths).toHaveLength(river.points.length);
      for (let i = 1; i < river.points.length; i++) {
        expect(river.widths![i]).toBeGreaterThanOrEqual(river.widths![i - 1]);
        expect(river.points[i][1]).toBeLessThanOrEqual(
          river.points[i - 1][1] + 0.001,
        );
      }
    }
    const sim = new Simulation(world, heights, () => {}, undefined, true);
    try {
      sim.setMonsterCount(400);
      expect(sim.monsters.states).toHaveLength(400);
      for (const monster of sim.monsters.states)
        expect(onMainland(world.mainland!, monster.p[0], monster.p[2])).toBe(
          true,
        );
      if (preset === "R") sim.terrain.crater(8002, 8000, 4, 2);
      const save = sim.save();
      if (preset === "R") {
        const i = 4000 * 4609 + 4001;
        expect(save.terrainIndices).toContain(i);
        const capture = sim.captureSave();
        let next = capture.next();
        while (!next.done) next = capture.next();
        expect(
          next.value.sections!.some((s) => s.terrainIndices?.includes(i)),
        ).toBe(true);
        const restored = new Terrain(heights, world.rivers, false, world);
        restored.restore(save.terrain, save.laserDry, save.terrainIndices);
        expect(restored.heights[i]).toBe(sim.terrain.heights[i]);
      }
      expect(compatible(save, 11, 42, 5, preset)).toBe(true);
      expect(compatible(save, 11, 42, 5, preset === "B" ? "H" : "B")).toBe(
        false,
      );
      const lake = world.lakes![0],
        water = sim.terrain.surfaceHeight(...lake.center);
      expect(water).toBeCloseTo(lake.level);
      expect(sim.terrain.riverSurface(...lake.center)).toBeUndefined();
    } finally {
      sim.dispose();
    }
  },
  60_000,
);
it("uses matching variable river and lake footprints in queries and effects", () => {
  const rivers: RiverData[] = [
    {
      id: "river",
      width: 12,
      widths: [3, 12],
      points: [
        [100, 10, 100],
        [200, 4, 100],
      ],
    },
  ];
  const lake: LakeData = {
    id: "lake",
    center: [260, 100],
    radius: 30,
    level: 4,
    outline: [
      [230, 70],
      [290, 70],
      [290, 130],
      [230, 130],
    ],
    outlet: [290, 4, 100],
    riverId: "river",
  };
  const field = new RiverField(rivers, [lake]),
    lookup = new WaterSurfaceLookup(rivers, 9216, 64, [lake]);
  for (const [x, z] of [
    [105, 108],
    [195, 108],
    [260, 100],
    [310, 100],
  ]) {
    const expected = field.surface(x, z);
    const wet = expected !== undefined;
    expect(lookup.sample(x, z, 0, wet)).toBe(expected);
    const direct = inlandWaterHeight(
      rivers,
      [lake],
      Math.round(x / 2) * 2,
      Math.round(z / 2) * 2,
    );
    expect(Number.isFinite(direct) ? direct : undefined).toBe(expected);
  }
  expect(field.surface(105, 108)).toBeUndefined();
  expect(field.surface(195, 108)).toBeDefined();
  expect(field.lakeCells.has(field.index(260, 100))).toBe(true);
});
it("floods only ocean-connected PS5 depressions while preserving legacy behavior", () => {
  const base = new Float32Array(4609 ** 2).fill(10),
    pocket = 1000 * 4609 + 1000;
  base[0] = base[1] = -2;
  base[pocket] = -3;
  const current = new Terrain(base, [], false, { generatorVersion: 5 });
  expect(current.flooded[0]).toBe(1);
  expect(current.flooded[1]).toBe(1);
  expect(current.flooded[pocket]).toBe(0);
  const legacy = new Terrain(base);
  expect(legacy.flooded[pocket]).toBe(1);
});
