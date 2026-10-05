import { beforeAll, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  generateIsland,
  validateIsland,
  seedCode,
  parseSeedCode,
  islandLink,
} from "../src/world/generator.mjs";
import { Terrain } from "../src/sim/terrain";
import { Simulation, initializePhysics } from "../src/sim/simulation";
import { compatible } from "../src/storage";
import { Monsters } from "../src/sim/monsters";
import { Civilians } from "../src/sim/civilians";
import type { WorldData, Vec3 } from "../src/types";
import * as THREE from "three";
import { treeCrownGeometry, treeCrownLowGeometry } from "../src/render/assets";
const world: WorldData = JSON.parse(readFileSync("public/world.json", "utf8"));
const bytes = readFileSync("public/world.bin");
const heights = new Float32Array(
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
);
beforeAll(() => initializePhysics());
it("round trips every seed boundary and rejects malformed or unsupported shared codes", () => {
  for (const seed of [0, 1, 41729, 4294967295])
    expect(parseSeedCode(seedCode(seed))).toBe(seed);
  expect(parseSeedCode(" ps1-0000a301 ")).toBe(41729);
  for (const code of ["abc", "PS1--1", "PS1-100000000", "PS3-00000001"])
    expect(() => parseSeedCode(code)).toThrow();
  const link = new URL(
    islandLink(seedCode(42), "https://example.test/game/?debug&other=1#debug"),
  );
  expect(link.pathname).toBe("/game/");
  expect(link.searchParams.get("island")).toBe(seedCode(42));
  expect(link.hash).toBe("");
  expect(link.searchParams.has("debug")).toBe(false);
});
it("reproduces the exact exported baseline and stable structural identities", () => {
  const generated = generateIsland(world.seed);
  expect({ ...generated.world, heightFiles: world.heightFiles }).toEqual(world);
  expect(
    Buffer.from(generated.heights.buffer).equals(Buffer.from(heights.buffer)),
  ).toBe(true);
});
it("generates varied valid landscapes across boundary seeds and placement retries", () => {
  let previous = heights;
  for (const seed of [0, 1, 42, 2026, 4294967295]) {
    const candidate = generateIsland(seed),
      result = validateIsland(candidate.world, candidate.heights);
    expect(result.landFraction).toBeGreaterThanOrEqual(0.53);
    expect(result.landFraction).toBeLessThanOrEqual(0.62);
    expect(result.peak).toBeGreaterThanOrEqual(700);
    expect(result.peak).toBeLessThanOrEqual(1000);
    expect(candidate.world.seed).toBe(seed);
    expect(candidate.world.structureCount).toBeLessThanOrEqual(16000);
    expect(candidate.world.civilians).toHaveLength(664);
    expect(candidate.world.castles).toHaveLength(3);
    const endpoints = candidate.world.paths.flatMap((path) => [
      path[0],
      path.at(-1)!,
    ]);
    for (const castle of candidate.world.castles!)
      expect(
        Math.min(
          ...endpoints.map(([x, z]) =>
            Math.hypot(
              x - castle.landmarks.gate[0],
              z - castle.landmarks.gate[2],
            ),
          ),
        ),
      ).toBeLessThan(8);
    for (const [kind, count] of [
      ["hamlet", 12],
      ["farm", 7],
      ["windmill", 5],
      ["watermill", 2],
      ["watchtower", 4],
      ["crossing", 4],
      ["logging", 2],
      ["quarry", 1],
      ["harbor", 2],
      ["lighthouse", 2],
      ["coastal-ruin", 2],
    ] as const)
      expect(candidate.world.sites.filter((s) => s.kind === kind)).toHaveLength(
        count,
      );
    expect(candidate.world.rivers!.length).toBeGreaterThanOrEqual(2);
    expect(candidate.world.rivers!.length).toBeLessThanOrEqual(4);
    const water = new Terrain(candidate.heights, candidate.world.rivers);
    for (const site of candidate.world.sites.filter(
      (s) => s.kind === "bridge" || s.kind === "crossing",
    )) {
      const surface = water.surfaceHeight(site.p[0], site.p[2]);
      expect(surface).toBeDefined();
      const decks = candidate.world.entities.filter(
        (e) => e.assembly === site.id && e.material === "wood",
      );
      expect(decks.length).toBeGreaterThan(10);
      expect(Math.min(...decks.map((e) => e.p[1] - e.s[1]))).toBeGreaterThan(
        surface!,
      );
    }
    const species = new Set(
      candidate.world.entities
        .filter((e) => e.kind === "tree")
        .map((e) => e.treeSpecies),
    );
    expect(species).toEqual(new Set(["pine", "broadleaf", "riverside"]));
    expect(
      candidate.world.entities.filter((e) => e.kind === "tree").length,
    ).toBeLessThanOrEqual(14000);
    expect(
      Buffer.from(candidate.heights.buffer).equals(
        Buffer.from(previous.buffer),
      ),
    ).toBe(false);
    previous = candidate.heights;
  }
}, 30000);
it("keeps residents on dry ground and preserves all three castle home groups", () => {
  const terrain = new Terrain(heights, world.rivers),
    civilians = new Civilians(world, terrain, new Set());
  for (const c of world.civilians!)
    expect(terrain.water(c.p[0], c.p[2])).toBe(false);
  for (const castle of world.castles!) {
    expect(
      civilians.states.filter((c) => world.civilians![c.id].home === castle.id),
    ).toHaveLength(castle.grand ? 64 : 16);
    expect(civilians.settlements.find((s) => s.id === castle.id)).toBeDefined();
  }
});
it("detects elevated rivers, coastal flooding, and dry laser channels through save restoration", () => {
  const terrain = new Terrain(heights, world.rivers);
  const river = world.rivers![0];
  const p = river.points[Math.floor(river.points.length / 3)];
  expect(p[1]).toBeGreaterThan(0);
  // Water queries use 2-meter cells; on angled, sloping reaches their surface
  // can differ from the exact polyline vertex. Verify submerged, elevated water.
  const waterLevel = terrain.surfaceHeight(p[0], p[2]);
  expect(waterLevel).toBeGreaterThan(0);
  expect(waterLevel).toBeGreaterThan(terrain.sample(p[0], p[2]));
  const coastal: [number, number] = [100, 100];
  expect(terrain.surfaceHeight(...coastal)).toBe(0);
  const section = Math.floor(p[2] / 64) * 96 + Math.floor(p[0] / 64),
    edit = terrain.laserCrater(p[0], p[2], 1, section);
  expect(terrain.surfaceHeight(p[0], p[2])).toBeUndefined();
  const restored = new Terrain(heights, world.rivers);
  restored.restore([...terrain.changed], edit.dry);
  expect(restored.water(p[0], p[2])).toBe(false);
  restored.reset();
  expect(restored.water(p[0], p[2])).toBe(true);
});
it("rejects damage belonging to another seed or generator and round trips island damage", () => {
  const sim = new Simulation(world, heights, () => {});
  try {
    sim.explode([...world.castles![1].p] as Vec3, 1);
    const save = sim.save();
    expect(save.removed.length).toBeGreaterThan(0);
    expect(compatible(save, world.version, world.seed)).toBe(true);
    expect(compatible(save, world.version, (world.seed + 1) >>> 0)).toBe(false);
    expect(
      compatible({ ...save, generatorVersion: 1 }, world.version, world.seed),
    ).toBe(false);
    const restored = new Simulation(world, heights, () => {}, save);
    try {
      expect([...restored.removed]).toEqual(save.removed);
      expect(restored.civilians.states.map((c) => c.alive)).toEqual(
        save.civilians!.map((c) => c.alive),
      );
    } finally {
      restored.dispose();
    }
  } finally {
    sim.dispose();
  }
});
it("gives every tree species distinct bounded high and low geometry", () => {
  const bounds = [];
  for (const species of ["pine", "broadleaf", "riverside"] as const) {
    const high = treeCrownGeometry(species),
      low = treeCrownLowGeometry(species);
    high.computeBoundingBox();
    low.computeBoundingBox();
    bounds.push(high.boundingBox!.getSize(new THREE.Vector3()).toArray());
    expect(high.boundingBox!.min.y).toBeGreaterThanOrEqual(-0.001);
    expect(high.boundingBox!.max.y).toBeLessThanOrEqual(1.1);
    expect(low.attributes.position.count).toBeLessThan(
      high.attributes.position.count,
    );
    high.dispose();
    low.dispose();
  }
  expect(bounds[0]).not.toEqual(bounds[1]);
  expect(bounds[1]).not.toEqual(bounds[2]);
});

it("spawns the maximum monster population on usable island land outside every fortress", () => {
  const terrain = new Terrain(heights, world.rivers),
    monsters = new Monsters(world, terrain);
  monsters.setCount(400);
  expect(monsters.states).toHaveLength(400);
  for (const m of monsters.states) {
    expect(terrain.water(m.p[0], m.p[2])).toBe(false);
    expect(m.p[1]).toBeCloseTo(terrain.sample(m.p[0], m.p[2]));
    for (const c of world.castles!)
      expect(
        m.p[0] > c.bounds.min[0] &&
          m.p[0] < c.bounds.max[0] &&
          m.p[2] > c.bounds.min[1] &&
          m.p[2] < c.bounds.max[1],
      ).toBe(false);
  }
});
it("cheers and mourns independently at each generated castle", () => {
  const terrain = new Terrain(heights, world.rivers),
    residents = new Civilians(world, terrain, new Set());
  for (const c of world.castles!) {
    const monster = {
      id: 0,
      p: c.p,
      yaw: 0,
      health: 5,
      defeated: false,
      phase: 0,
      windup: 0,
      stagger: 0,
    };
    const distant = { ...monster, id: 1, p: [0, 0, 0] as Vec3 };
    residents.defeats([monster, distant], [distant]);
    expect(residents.settlements.find((s) => s.id === c.id)!.cheer).toBe(6);
    residents.structureRemoved(
      world.entities.find((e) => c.assemblies.includes(e.assembly))!,
    );
    expect(
      residents.settlements.find((s) => s.id === c.id)!.sad,
    ).toBeGreaterThan(0);
    expect(residents.settlements.find((s) => s.id === c.id)!.cheer).toBe(0);
  }
});
