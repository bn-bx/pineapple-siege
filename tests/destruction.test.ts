import { beforeAll, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { Simulation, initializePhysics } from "../src/sim/simulation";
import { CONFIG, NUKE_PROFILES } from "../src/config";
import { compatible } from "../src/storage";
import type { WorldData, WorkerMessage } from "../src/types";
const world: WorldData = JSON.parse(
  readFileSync("tests/fixtures/legacy-world/world.json", "utf8"),
);
const b = readFileSync("tests/fixtures/legacy-world/world.bin"),
  base = new Float32Array(
    b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
  );
beforeAll(initializePhysics);
it("distributes all requested targets with stable assemblies and bounded structure counts", () => {
  const counts: Record<string, number> = {};
  for (const s of world.sites) {
    counts[s.kind] = (counts[s.kind] || 0) + 1;
    expect(s.assemblies.length).toBeGreaterThan(0);
    expect(s.p[0]).toBeGreaterThan(100);
    expect(s.p[2]).toBeLessThan(CONFIG.worldSize - 100);
  }
  expect(counts).toEqual({
    hamlet: 12,
    farm: 7,
    windmill: 5,
    watermill: 2,
    watchtower: 4,
    crossing: 4,
    logging: 2,
    quarry: 1,
  });
  expect(world.castleBounds.max[1] - world.castleBounds.min[1]).toBe(550);
  expect(world.castleCount).toBeLessThanOrEqual(5000);
  expect(world.structureCount).toBeLessThanOrEqual(8000);
  for (const site of world.sites.filter((s) => s.kind === "hamlet"))
    expect(site.assemblies.length).toBe(5);
});
it("breaks every landmark and leaves distant neighbors supported", () => {
  const s = new Simulation(world, base, () => {});
  for (const site of world.sites) {
    const members = world.entities.filter((e) =>
      site.assemblies.includes(e.assembly),
    );
    const e = members.find((e) => e.foundation)!;
    s.explode([e.p[0], e.p[1] - e.s[1] + 1, e.p[2]]);
    expect(
      members.some((e) => s.removed.has(e.id)),
      site.id,
    ).toBe(true);
  }
  expect(s.moving.size).toBeLessThanOrEqual(256);
  expect(
    world.entities.filter((e) => e.assembly === "keep" && s.removed.has(e.id)),
  ).toHaveLength(0);
  s.dispose();
});
it("partitions modules, ejects earth and respects each blast body/effect budget", () => {
  for (const weapon of ["cannon", "nuke"]) {
    const events: WorkerMessage[] = [];
    const s = new Simulation(world, base, (m) => events.push(m));
    const p = [...world.castle] as [number, number, number];
    s.plane.p = [p[0], 280, p[2]];
    if (weapon === "nuke") {
      s.detonateNuke(p, "valley");
      while (s.pendingJobs.length) s.processDestruction(50);
    } else s.explode(p);
    expect(s.moving.size).toBeLessThanOrEqual(weapon === "nuke" ? 128 : 64);
    expect(
      [...s.ballistic.values()].some((m) => m.view.material === "earth"),
    ).toBe(true);
    const sources = new Map<number, number>();
    for (const m of s.ballistic.values())
      if (m.view.source >= 0)
        sources.set(m.view.source, (sources.get(m.view.source) || 0) + 1);
    expect([...sources.values()].some((n) => n >= 2 && n <= 6)).toBe(true);
    const effects = events.filter((e) => e.type === "fragments");
    expect(effects.reduce((n, e) => n + e.count, 0)).toBeLessThanOrEqual(
      weapon === "nuke" ? 1200 : 256,
    );
    expect(effects.some((e) => e.material === "earth")).toBe(true);
    const speeds = [...s.ballistic.values()].map((m) =>
      Math.hypot(...m.velocity),
    );
    expect(Math.max(...speeds)).toBeGreaterThan(weapon === "nuke" ? 85 : 40);
    s.dispose();
  }
});
it("reblasts temporary wreckage without creating native bodies", () => {
  const s = new Simulation(world, base, () => {}),
    p: [number, number, number] = [700, base[600 * CONFIG.grid + 350], 1200];
  const id = (s as any).spawnBody(
    [p[0] + 15, p[1] + 20, p[2]],
    [1, 1, 1],
    "stone",
    -1,
    "chunk",
    [0, 0, 0],
  );
  const m = s.ballistic.get(id)!;
  (s as any).insertRuin({
    id: 99999,
    p: [p[0] + 10, p[1] + 1, p[2]],
    s: [1, 1, 1],
    q: [0, 0, 0, 1],
    material: "stone",
    kind: "chunk",
    source: -1,
  });
  s.detonateNuke(p, "valley");
  expect(s.ruins.has(99999)).toBe(false);
  expect(m.velocity[0]).toBeGreaterThan(70);
  expect(s.physics.bodies.len()).toBe(0);
  s.dispose();
});
it("saves resolved parameters and partially processed support groups without cancelling damage", () => {
  const s = new Simulation(world, base, () => {});
  s.detonateNuke(world.castle, "valley");
  let sawSupport = false;
  for (let i = 0; i < 10000 && s.pendingJobs.length; i++) {
    s.processDestruction(0.001);
    if (s.pendingJobs[0]?.supportQueue?.length) {
      sawSupport = true;
      break;
    }
  }
  expect(sawSupport).toBe(true);
  const save = s.save();
  expect(compatible(save, world.version, world.seed)).toBe(true);
  expect(save.pendingJobs[0].profile.scatterMax).toBe(120);
  const restored = new Simulation(world, base, () => {}, save);
  while (s.pendingJobs.length) s.processDestruction(50);
  while (restored.pendingJobs.length) restored.processDestruction(50);
  expect([...restored.removed].sort()).toEqual([...s.removed].sort());
  expect(restored.terrain.changed.size).toBe(s.terrain.changed.size);
  expect(
    compatible({ ...save, worldVersion: 3 }, world.version, world.seed),
  ).toBe(false);
  s.dispose();
  restored.dispose();
});
it("attenuates airborne excavation and preserves bedrock across irregular section seams", () => {
  const s = new Simulation(world, base, () => {}),
    p = [...world.castle] as [number, number, number];
  s.detonateNuke([p[0], p[1] + 200, p[2]], "local");
  while (s.pendingJobs.length) s.processDestruction(50);
  expect(s.terrain.changed.size).toBe(0);
  for (let i = 0; i < 3; i++) {
    s.detonateNuke(p, "valley");
    while (s.pendingJobs.length) s.processDestruction(50);
  }
  expect(s.terrain.sample(p[0], p[2])).toBeCloseTo(p[1] - CONFIG.bedrock, 3);
  for (const [i, h] of s.terrain.changed)
    expect(h).toBeGreaterThanOrEqual(base[i] - CONFIG.bedrock - 0.00001);
  s.dispose();
});
it("lets visual chunks pass through structures without secondary damage", () => {
  const wall = {
    id: 0,
    kind: "block" as const,
    p: [600, 250, 600] as [number, number, number],
    s: [0.25, 50, 20] as [number, number, number],
    material: "stone" as const,
    assembly: "",
    foundation: true,
    supports: [],
    variant: 0,
  };
  const s = new Simulation({ ...world, entities: [wall] }, base, () => {});
  const id = (s as any).spawnBody(
    [560, 250, 600],
    [0.4, 0.4, 0.4],
    "stone",
    -1,
    "chunk",
    [120, 0, 0],
  );
  let maxX = 0;
  for (let i = 0; i < 90; i++) {
    s.step();
    maxX = Math.max(maxX, s.ballistic.get(id)?.view.p[0] ?? 0);
  }
  expect(maxX).toBeGreaterThan(600);
  expect(s.removed.has(wall.id)).toBe(false);
  expect(s.physics.bodies.len()).toBe(0);
  s.dispose();
});
it("carries representative nuke chunks hundreds of meters and collides with terrain", () => {
  const s = new Simulation({ ...world, entities: [] }, base, () => {}),
    start: [number, number, number] = [650, 240, 600];
  const id = (s as any).spawnBody(
    start,
    [1, 1, 1],
    "stone",
    -1,
    "chunk",
    [90, 65, 0],
  );
  let travel = 0;
  for (let i = 0; i < 650; i++) {
    s.plane.p = [900, 450, 700];
    s.step();
    const m = s.ballistic.get(id);
    if (m) {
      travel = Math.max(
        travel,
        Math.hypot(m.view.p[0] - start[0], m.view.p[2] - start[2]),
      );
      expect(m.view.p[1]).toBeGreaterThan(
        s.terrain.sample(m.view.p[0], m.view.p[2]) - 3,
      );
    }
  }
  expect(travel).toBeGreaterThan(200);
  expect(travel).toBeLessThan(1000);
  s.dispose();
});
