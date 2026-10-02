import { readFileSync } from "node:fs";
import { beforeAll, expect, it } from "vitest";
import * as THREE from "three";
import { CHUNKS, CONFIG } from "../src/config";
import { Terrain } from "../src/sim/terrain";
import { TerrainView } from "../src/render/terrain-view";
import { laserProfile, DEFAULT_DESTRUCTION } from "../src/destruction-settings";
import { Simulation, initializePhysics } from "../src/sim/simulation";
import { compatible } from "../src/storage";
import type { Vec3, WorldData } from "../src/types";
const world = JSON.parse(
  readFileSync("public/world.json", "utf8"),
) as WorldData;
const bytes = readFileSync("public/world.bin");
const base = new Float32Array(
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
);
beforeAll(() => initializePhysics());
it("generates the expanded terrain and populated settlements at the requested density", () => {
  expect(world.civilians).toHaveLength(600);
  expect(world.size).toBe(6144);
  expect(world.grid).toBe(3073);
  expect(base.length).toBe(world.grid ** 2);
  expect(CHUNKS).toBe(96);
  expect(world.sites.filter((s) => s.kind === "hamlet")).toHaveLength(12);
  expect(world.sites.filter((s) => s.kind === "farm")).toHaveLength(7);
  expect(world.sites.filter((s) => s.kind === "windmill")).toHaveLength(5);
  expect(world.sites.filter((s) => s.kind === "crossing")).toHaveLength(4);
  expect(
    world.civilians!.filter((c) => c.settlement === "castle"),
  ).toHaveLength(64);
  const homes = new Set(
    world.civilians!.filter((c) => c.home !== "castle").map((c) => c.home),
  );
  for (const home of homes)
    expect(world.civilians!.filter((c) => c.home === home)).toHaveLength(8);
  for (const c of world.civilians!) {
    expect(
      base[Math.round(c.p[2] / 2) * world.grid + Math.round(c.p[0] / 2)],
    ).toBeGreaterThan(0);
    expect(
      world.entities.some(
        (e) =>
          e.kind === "block" &&
          Math.abs(e.p[0] - c.p[0]) < e.s[0] + 1 &&
          Math.abs(e.p[2] - c.p[2]) < e.s[2] + 1 &&
          e.p[1] + e.s[1] > c.p[1] &&
          e.p[1] - e.s[1] < c.p[1] + 4,
      ),
    ).toBe(false);
  }
});
it("edits and restores all four corners, distant section edges, and laser dry samples", () => {
  const t = new Terrain(base);
  for (const [x, z] of [
    [0, 0],
    [6144, 0],
    [0, 6144],
    [6144, 6144],
    [4096, 4096],
  ]) {
    const old = t.sample(x, z);
    const patch = t.crater(x, z, 12, 5);
    expect(t.sample(x, z)).toBeCloseTo(old - 5, 2);
    expect(patch.indices.length).toBeGreaterThan(0);
    expect(patch.chunks.every((c) => c >= 0 && c < CHUNKS ** 2)).toBe(true);
  }
  const section = 64 * CHUNKS + 64;
  const result = t.laserCrater(4098, 4098, 1, section);
  expect(result.dry.length).toBeGreaterThan(0);
  expect(t.sample(4098, 4098)).toBeCloseTo(
    base[2049 * world.grid + 2049] - 500,
    2,
  );
  const restored = new Terrain(base);
  restored.restore([...t.changed], result.dry);
  expect(restored.sample(4098, 4098)).toBe(t.sample(4098, 4098));
  expect(restored.water(4098, 4098)).toBe(false);
  const radius = laserProfile({
    ...DEFAULT_DESTRUCTION,
    laserSize: 100,
  }).radius;
  expect(radius).toBeGreaterThanOrEqual(
    Math.hypot(CONFIG.worldSize, CONFIG.worldSize),
  );
});
it("rebuilds distant damaged terrain from authoritative heights after unloading", () => {
  const terrain = new Terrain(base),
    view = new TerrainView(world, base.slice(), new THREE.Texture());
  const id = 64 * CHUNKS + 64,
    c = view.chunks[id];
  expect(c.step).toBe(0);
  view.patch(terrain.crater(4128, 4128, 20, 5));
  for (let i = 0; i < 12 && !c.step; i++)
    view.update(new THREE.Vector3(4128, 100, 4128));
  expect(c.step).toBeGreaterThan(0);
  const attr = c.mesh.geometry.getAttribute("position");
  for (let i = 0; i < attr.count; i++)
    expect(attr.getY(i)).toBeCloseTo(
      terrain.sample(attr.getX(i), attr.getZ(i)),
      2,
    );
  view.update(new THREE.Vector3(500, 100, 500));
  expect(c.step).toBe(0);
  for (let i = 0; i < 12 && !c.step; i++)
    view.update(new THREE.Vector3(4128, 100, 4128));
  expect(c.step).toBeGreaterThan(0);
  for (const c of view.chunks) c.mesh.geometry.dispose();
  view.material.dispose();
  view.heightTexture.dispose();
  view.floodTexture.dispose();
});
it("streams distant collision terrain and persists civilian casualties without accepting old saves", () => {
  const sim = new Simulation(world, base, () => {});
  sim.setMonsterCount(0);
  const p: Vec3 = [4600, sim.terrain.sample(4600, 4600) + 100, 4600];
  sim.plane.p = p;
  sim["ensureTerrain"]();
  expect(sim["terrainColliders"].has(71 * CHUNKS + 71)).toBe(true);
  const resident = sim.civilians.states[0];
  sim.explode([resident.p[0], resident.p[1] + 2, resident.p[2]]);
  expect(resident.alive).toBe(false);
  const save = sim.save();
  expect(compatible(save, world.version, world.seed)).toBe(true);
  expect(compatible({ ...save, version: 6 }, world.version, world.seed)).toBe(
    false,
  );
  expect(
    compatible(
      { ...save, civilians: [{ ...resident, p: [NaN, 0, 0] }] },
      world.version,
      world.seed,
    ),
  ).toBe(false);
  const restored = new Simulation(world, base, () => {}, save);
  expect(restored.civilians.states[0].alive).toBe(false);
  restored.dispose();
  sim.dispose();
});
