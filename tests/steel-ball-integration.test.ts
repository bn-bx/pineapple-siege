import RAPIER from "@dimforge/rapier3d-compat";
import { beforeAll, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { CONFIG } from "../src/config";
import { Simulation, initializePhysics } from "../src/sim/simulation";
import type { Entity, WorldData, WorkerMessage } from "../src/types";
const world: WorldData = JSON.parse(
  readFileSync("tests/fixtures/legacy-world/world.json", "utf8"),
);
const flat = new Float32Array(CONFIG.grid * CONFIG.grid);
beforeAll(initializePhysics);
const entity = (
  id: number,
  p: Entity["p"],
  kind: Entity["kind"] = "block",
): Entity => ({
  id,
  p,
  s: [1, 2, 1],
  kind,
  material: kind === "tree" ? "wood" : "stone",
  assembly: "",
  foundation: true,
  supports: [],
  variant: 0,
});
it("crushes a swept path, defeats actors, shoves rubble, and saves only the resulting destruction", () => {
  const entities = [
    entity(0, [1025, 60, 1000]),
    entity(1, [1040, 60, 1000], "tree"),
    entity(2, [1025, 60, 1100]),
    { ...entity(3, [1110, 60, 1000]), s: [60, 2, 1] as Entity["s"] },
  ];
  const events: WorkerMessage[] = [];
  const sim = new Simulation(
    {
      ...world,
      entities,
      civilians: [
        { id: 0, p: [1030, 58, 1000], home: "", settlement: world.sites[0].id },
      ],
    },
    flat,
    (e) => events.push(e),
  );
  try {
    sim.plane.p = [2000, 400, 2000];
    sim.steelBalls.drop({
      ...sim.plane,
      p: [1000, 126, 1000],
      v: [3000, 0, 0],
    });
    const monster = sim.monsters.states[0];
    monster.p = [1035, 0, 1000];
    monster.defeated = false;
    monster.health = 3;
    (sim as any).insertRuin({
      id: 900000,
      source: -1,
      p: [1020, 60, 1000],
      s: [1, 1, 1],
      q: [0, 0, 0, 1],
      material: "stone",
      kind: "chunk",
    });
    sim.step();
    expect([...sim.removed]).toEqual([0, 1, 3]);
    expect(sim.civilians.states[0].alive).toBe(false);
    expect(monster.defeated).toBe(true);
    expect(sim.ruins.has(900000)).toBe(false);
    expect([...sim.ballistic.values()].some((b) => b.view.source === -1)).toBe(
      true,
    );
    sim.terrain.changed.forEach((h) => expect(h).toBeGreaterThanOrEqual(-2));
    expect(sim.snapshot().steelBalls).toHaveLength(1);
    expect(sim.snapshot(true).steelBalls).toHaveLength(1);
    const save = sim.save();
    expect(save.removed).toContain(0);
    expect(save.removed).toContain(1);
    expect(save).not.toHaveProperty("steelBalls");
    expect(
      events.some((e) => e.type === "monsterEvent" && e.kind === "defeat"),
    ).toBe(true);
    const restored = new Simulation(
      { ...world, entities },
      flat,
      () => {},
      save,
    );
    expect(restored.removed.has(0)).toBe(true);
    expect(restored.steelBalls.snapshot()).toEqual([]);
    restored.dispose();
  } finally {
    sim.dispose();
  }
});
it("keeps streamed terrain and obstacles resident around balls far from the plane", () => {
  const sim = new Simulation(
    { ...world, entities: [entity(0, [1070, 80, 1000])] },
    flat,
    () => {},
    undefined,
    true,
  );
  try {
    sim.plane.p = [3000, 400, 3000];
    sim.steelBalls.drop({ ...sim.plane, p: [1000, 146, 1000], v: [0, 0, 0] });
    sim.step();
    const ballChunk =
      Math.floor(1000 / 64) * (CONFIG.worldSize / 64) + Math.floor(1000 / 64);
    expect((sim as any).terrainColliders.has(ballChunk)).toBe(true);
    expect((sim as any).entityColliders.has(0)).toBe(true);
    expect((sim as any).pendingTerrainColliders.has(ballChunk)).toBe(false);
    sim.plane.p = [4000, 400, 4000];
    for (let i = 0; i < 50; i++) sim.step();
    expect(sim.steelBalls.snapshot()[0].p[1]).toBeGreaterThan(57.5);
    expect(sim.terrain.changed.size).toBe(0);
  } finally {
    sim.dispose();
  }
});

it("publishes shallow damage, updates streamed collision chunks, and restores saved terrain", () => {
  const events: WorkerMessage[] = [];
  const sim = new Simulation(
    { ...world, entities: [], civilians: [] },
    flat,
    (e) => events.push(e),
    undefined,
    true,
  );
  try {
    sim.plane.p = [3000, 400, 3000];
    sim.steelBalls.drop({ ...sim.plane, p: [1000, 136, 1000], v: [20, 0, 0] });
    for (let i = 0; i < 120; i++) sim.step();
    expect(sim.terrain.changed.size).toBeGreaterThan(0);
    sim.terrain.changed.forEach((h) => expect(h).toBeGreaterThanOrEqual(-2));
    expect(
      events.some(
        (e) => e.type === "delta" && e.terrain && e.terrain.indices.length,
      ),
    ).toBe(true);
    const p = sim.steelBalls.snapshot()[0].p;
    expect(p[1]).toBeGreaterThan(sim.terrain.sample(p[0], p[2]) + 59);
    const save = sim.save();
    expect(save.terrain.length).toBeGreaterThan(0);
    const restored = new Simulation(
      { ...world, entities: [], civilians: [] },
      flat,
      () => {},
      save,
    );
    expect(restored.terrain.sample(1000, 1000)).toBe(
      sim.terrain.sample(1000, 1000),
    );
    expect(restored.steelBalls.snapshot()).toEqual([]);
    restored.dispose();
  } finally {
    sim.dispose();
  }
});

it("keeps ball terrain separate from exact projectile queries and releases it after cleanup", () => {
  const sim = new Simulation(
    { ...world, entities: [], civilians: [] },
    flat,
    () => {},
    undefined,
    true,
  );
  try {
    sim.plane.p = [3000, 400, 3000];
    sim.steelBalls.drop({ ...sim.plane, p: [1000, 160, 1000], v: [35, 0, 0] });
    sim.step();
    const map = (sim as any).ballTerrainColliders as Map<number, any>;
    expect(map.size).toBeGreaterThan(0);
    expect([...map.values()].every((c) => c.shape.nrows === 8)).toBe(true);
    for (const c of map.values()) expect(c.collisionGroups()).toBe(0x00080004);
    // A coarse surface must never create an early hit for cannon/plane queries.
    const decoy = sim.physics.createCollider(
      RAPIER.ColliderDesc.cuboid(10, 10, 10)
        .setTranslation(1200, 100, 1200)
        .setCollisionGroups(0x00080004),
    );
    sim.physics.step();
    expect(
      sim.physics.castRay(
        new RAPIER.Ray({ x: 1200, y: 120, z: 1200 }, { x: 0, y: -40, z: 0 }),
        1,
        true,
      )?.collider.handle,
    ).toBe(decoy.handle);
    expect((sim as any).sweep([1200, 120, 1200], [1200, 80, 1200], 1)).toBe(
      null,
    );
    expect((sim as any).sweep([1200, 120, 1200], [1200, 80, 1200], 0)).toBe(
      null,
    );
    sim.physics.removeCollider(decoy, true);
    sim.steelBalls.reset();
    (sim as any).ensureTerrain();
    expect(map.size).toBe(0);
  } finally {
    sim.dispose();
  }
});

it("loads ball collision coverage and destroys targets in the expanded far corner", () => {
  const events: WorkerMessage[] = [];
  const sim = new Simulation(
    { ...world, entities: [entity(0, [8515, 60, 8500])], civilians: [] },
    flat,
    (e) => events.push(e),
    undefined,
    true,
  );
  try {
    sim.plane.p = [1000, 500, 1000];
    sim.steelBalls.drop({ ...sim.plane, p: [8500, 126, 8500], v: [120, 0, 0] });
    sim.step();
    expect(sim.removed.has(0)).toBe(true);
    expect(sim.terrainColliders.size).toBeGreaterThan(0);
    expect(
      [...sim.terrainColliders.keys()].some(
        (id) => Math.floor(id / (CONFIG.worldSize / 64)) > 128,
      ),
    ).toBe(true);
    expect(sim.steelBalls.snapshot()).toHaveLength(1);
  } finally {
    sim.dispose();
  }
});
