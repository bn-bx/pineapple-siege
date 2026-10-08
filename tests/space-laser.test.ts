import { CHUNKS } from "../src/config";
import { CONFIG, LASER } from "../src/config";
import { beforeAll, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { Simulation, initializePhysics } from "../src/sim/simulation";
import { discoActive } from "../src/disco";
import { Terrain } from "../src/sim/terrain";
import { GameRenderer } from "../src/render/renderer";
import { rubbleVolume } from "../src/sim/rubble";
import {
  DEFAULT_DESTRUCTION,
  laserProfile,
  normalizeDestruction,
} from "../src/destruction-settings";
import { compatible } from "../src/storage";
import type { Entity, Vec3, WorldData, WorkerMessage } from "../src/types";
const manifest: WorldData = JSON.parse(
  readFileSync("tests/fixtures/legacy-world/world.json", "utf8"),
);
const flat = new Float32Array(CONFIG.grid * CONFIG.grid).fill(10);
beforeAll(initializePhysics);
function create(entities: Entity[] = [], events: WorkerMessage[] = []) {
  return new Simulation(
    { ...manifest, entities, spawn: [1100, 350, 1100] },
    flat,
    (e) => events.push(e),
  );
}
const entity = (
  id: number,
  x: number,
  z: number,
  s: Vec3 = [10, 50, 10],
): Entity => ({
  id,
  kind: "block",
  p: [x, 10 + s[1], z],
  s,
  material: "stone",
  assembly: `test-${id}`,
  supports: [],
  foundation: true,
  variant: 0.5,
});
function drain(s: Simulation) {
  for (
    let i = 0;
    i < 1000 &&
    (s.laserWork.size || s.laserSupport.size || s.pendingJobs.length);
    i++
  ) {
    s.processLaserWork(50);
    s.processDestruction(50);
  }
  expect(s.laserWork.size + s.laserSupport.size + s.pendingJobs.length).toBe(0);
}
it("charges exactly four seconds, burns five, vaporizes entire columns and keeps a 500m dry crater", () => {
  const events: WorkerMessage[] = [];
  const s = create(
    [entity(0, 256, 256), entity(1, 450, 256), entity(2, 500, 256)],
    events,
  );
  s.startLaser([256, 60, 256]);
  expect(discoActive(s.lasers)).toBe(true);
  for (let i = 0; i < 239; i++) s.step();
  expect(s.lasers[0].phase).toBe("charging");
  expect(s.removed.size).toBe(0);
  s.step();
  expect(s.lasers[0].phase).toBe("burning");
  expect(discoActive(s.lasers)).toBe(true);
  for (let i = 0; i < 60; i++) s.step();
  const activeSave = s.save();
  const resumed = new Simulation(s.world, flat, () => {}, activeSave);
  expect(discoActive(resumed.lasers)).toBe(true);
  resumed.dispose();
  expect(s.removed.has(0)).toBe(true);
  expect(s.removed.has(1)).toBe(true);
  expect(s.removed.has(2)).toBe(false);
  expect(s.terrain.sample(256, 256)).toBeLessThan(10);
  for (let i = 0; i < 240; i++) s.step();
  drain(s);
  expect(s.lasers).toHaveLength(0);
  expect(discoActive(s.lasers)).toBe(false);
  expect(s.terrain.sample(256, 256)).toBe(-490);
  expect(s.terrain.sample(446, 256)).toBe(10);
  expect(s.terrain.water(256, 256)).toBe(false);
  expect(s.ruins.size + s.moving.size).toBe(0);
  expect(s.snapshot().bodies).toHaveLength(0);
  expect(s.cooldowns.laser).toBeCloseTo(15, 6);
  expect(events.some((e) => e.type === "vaporize")).toBe(true);
  const save = s.save();
  expect(compatible(save, manifest.version, manifest.seed)).toBe(true);
  const restored = new Simulation(s.world, flat, () => {}, save);
  expect(restored.terrain.sample(256, 256)).toBe(-490);
  expect(restored.terrain.water(256, 256)).toBe(false);
  restored.explode([256, -490, 256]);
  drain(restored);
  expect(restored.terrain.sample(256, 256)).toBe(-490);
  restored.detonateNuke([256, -490, 256], "valley");
  drain(restored);
  expect(restored.terrain.sample(256, 256)).toBe(-490);
  s.dispose();
  restored.dispose();
});
it("defeats a monster inside the beam even as excavation lowers its ground", () => {
  const s = create();
  s.setMonsterCount(3);
  const monster = s.monsters.states[0];
  s.plane.p = [1100, 350, 1100];
  s.startLaser([monster.p[0] + 90, monster.p[1], monster.p[2]]);
  for (let i = 0; i < 540; i++) {
    s.step();
    s.processLaserWork(50);
  }
  expect(s.terrain.sample(monster.p[0], monster.p[2])).toBeLessThan(-50);
  expect(monster.defeated).toBe(true);
  s.dispose();
});
it("locks fresh aimed targets, rejects sky shots and keeps independent cooldowns across switching/respawn", () => {
  const s = create();
  s.weapon = "laser";
  s.input.fire = true;
  s.plane.p = [256, 350, 80];
  s.plane.yaw = 0;
  s.plane.pitch = 0.6;
  s.step();
  expect(s.shots).toBe(0);
  expect(s.cooldowns.laser).toBe(0);
  s.plane.pitch = -0.7;
  s.step();
  expect(s.lasers).toHaveLength(1);
  const p = [...s.lasers[0].p];
  s.plane.yaw = 1;
  s.input.fire = false;
  for (let i = 0; i < 20; i++) s.step();
  expect(s.lasers[0].p).toEqual(p);
  s.weapon = "cannon";
  s.input.fire = true;
  s.step();
  expect(s.projectiles[0].weapon).toBe("cannon");
  expect(s.cooldowns.cannon).toBe(0.25);
  const cooldown = s.cooldowns.laser;
  s.respawn();
  expect(s.cooldowns.laser).toBe(cooldown);
  expect(s.lasers).toHaveLength(1);
  s.dispose();
});
it.each([0, 100])(
  "allows ten overlapping locked strikes per simulated second with rapid fire at size %s",
  (laserSize) => {
    const s = create();
    s.setDestruction({ ...DEFAULT_DESTRUCTION, noCooldown: true, laserSize });
    s.weapon = "laser";
    s.plane.p = [256, 400, 80];
    s.plane.pitch = -0.7;
    s.plane.yaw = 0;
    s.input.fire = true;
    for (let i = 0; i < 60; i++) s.step();
    expect(s.shots).toBe(10);
    expect(s.lasers).toHaveLength(10);
    expect(s.cooldowns.laser).toBeCloseTo(1 / 60);
    expect(s.lasers.every((l) => l.phase === "charging")).toBe(true);
    expect(s.lasers[0].age - s.lasers[9].age).toBeCloseTo(0.9);
    s.dispose();
  },
);
it("coalesces overlapping excavation without exceeding bedrock and resumes unfinished charge/beam saves", () => {
  const s = create();
  s.setDestruction({ ...DEFAULT_DESTRUCTION, noCooldown: true });
  for (let i = 0; i < 12; i++) s.startLaser([256, 10, 256]);
  for (let i = 0; i < 100; i++) s.step();
  const saved = s.save();
  const restored = new Simulation(s.world, flat, () => {}, saved);
  expect(restored.lasers[0].age).toBe(s.lasers[0].age);
  for (let i = 0; i < 200; i++) restored.step();
  expect(
    [...restored.laserWork.values()].every((w) => w.targets.length === 1),
  ).toBe(true);
  const mid = restored.save();
  expect(compatible(mid, manifest.version, manifest.seed)).toBe(true);
  const resumed = new Simulation(s.world, flat, () => {}, mid);
  drain(resumed);
  for (let i = 0; i < 240; i++) resumed.step();
  drain(resumed);
  expect(resumed.terrain.sample(256, 256)).toBe(-490);
  expect(resumed.lasers).toHaveLength(0);
  resumed.startLaser([256, 10, 256]);
  for (let i = 0; i < 540; i++) resumed.step();
  drain(resumed);
  expect(resumed.terrain.sample(256, 256)).toBe(-490);
  s.dispose();
  restored.dispose();
  resumed.dispose();
});
it("removes existing water, clips edge strikes safely and restores the dry mask", () => {
  const base = new Float32Array(CONFIG.grid * CONFIG.grid).fill(-4);
  const t = new Terrain(base);
  expect(t.water(2, 2)).toBe(true);
  const result = t.laserCrater(2, 2, 1, 0);
  expect(result.dry.length).toBeGreaterThan(0);
  expect(t.water(2, 2)).toBe(false);
  expect(t.sample(2, 2)).toBe(-504);
  t.floodChanged(result.patch.indices);
  expect(t.water(2, 2)).toBe(false);
  expect(t.water(400, 400)).toBe(true);
  const restored = new Terrain(base);
  restored.restore([...t.changed], result.dry);
  expect(restored.sample(2, 2)).toBe(-504);
  expect(restored.water(2, 2)).toBe(false);
  t.reset();
  expect(t.water(2, 2)).toBe(true);
  expect(t.sample(2, 2)).toBe(-4);
});
it("does not render compacted rubble again after a laser excavates it", () => {
  // Exercise the real delta consumer without allocating a WebGL context.
  const view = Object.assign(Object.create(GameRenderer.prototype), {
    ruins: new Map(),
    ruinCells: new Map(),
    dirtyRuinBatches: new Set(),
    renderer: { shadowMap: {} },
    terrain: { patch() {}, setDry() {} },
  });
  const events: WorkerMessage[] = [];
  const s = create([], events);
  s.setDestruction({ ...DEFAULT_DESTRUCTION, rubble: 0 });
  const e = entity(0, 650, 650, [8, 5, 7]);
  for (let i = 0; i < 100; i++) (s as any).staticFragment(e);
  // A new material also replaces a queued record without changing its ID.
  (s as any).staticFragment({ ...e, material: "wood" });
  (s as any).flush();
  expect(
    events
      .filter((event) => event.type === "delta")
      .flatMap((event) => event.settled),
  ).toHaveLength(0);
  expect(s.snapshot().bodies).toHaveLength(101);
  const apply = () => {
    for (const event of events.splice(0))
      if (event.type === "delta") view.delta(event);
  };
  apply();
  const renderedBefore = view.ruins.size;
  s.startLaser([650, 10, 650]);
  for (let i = 0; i < 540; i++) s.step();
  drain(s);
  apply();
  expect(s.terrain.sample(650, 650)).toBe(-490);
  expect(s.ruins.size).toBe(0);
  expect(view.ruins.size).toBe(0);
  expect(renderedBefore).toBe(0);
  expect(s.snapshot().bodies).toHaveLength(0);
  s.dispose();
});
it("retains source dimensions and material volume when rubble budgets and saves overflow", () => {
  const s = create();
  s.setDestruction({ ...DEFAULT_DESTRUCTION, rubble: 0 });
  const e = entity(0, 650, 650, [8, 5, 7]);
  for (let i = 0; i < 100; i++) (s as any).staticFragment(e);
  expect(s.ruins.size).toBe(0);
  expect(
    s
      .snapshot()
      .bodies.some((r) => !r.pile && r.s.every((v, i) => v === e.s[i])),
  ).toBe(true);
  const volume = 8 * 8 * 5 * 7;
  expect(
    s.snapshot().bodies.reduce((v, r) => v + rubbleVolume(r), 0),
  ).toBeCloseTo(volume * 100, 5);
  for (let i = 0; i < 20; i++)
    (s as any).spawnBody([650, 150, 650], e.s, "stone", 0, "chunk", [0, 0, 0]);
  const save = s.save();
  expect(save.ruins).toHaveLength(12);
  expect(save.ruins.reduce((v, r) => v + rubbleVolume(r), 0)).toBeCloseTo(
    volume * 120,
    5,
  );
  expect(s.ruins.size).toBe(0);
  expect(s.ballistic.size).toBe(20);
  expect(s.physics.bodies.len()).toBe(0);
  expect(compatible(save, manifest.version, manifest.seed)).toBe(true);
  const restored = new Simulation(s.world, flat, () => {}, save);
  expect(
    [...restored.ruins.values()].reduce((v, r) => v + rubbleVolume(r), 0),
  ).toBeCloseTo(volume * 120, 5);
  s.dispose();
  restored.dispose();
});
it("clears moving and settled debris and suppresses stale deferred fragments inside a burn", () => {
  const e = entity(0, 256, 256);
  const s = create([e]);
  (s as any).staticFragment(e);
  (s as any).spawnBody(
    [256, 180, 256],
    [10, 10, 10],
    "stone",
    0,
    "chunk",
    [0, 0, 0],
  );
  s.startLaser([256, 10, 256]);
  for (let i = 0; i < 300; i++) s.step();
  expect(s.ruins.size + s.moving.size).toBe(0);
  expect(s.snapshot().bodies).toHaveLength(0);
  (s as any).staticFragment(e);
  (s as any).fragment(e, e.p, 20, { n: 0 });
  expect(s.ruins.size + s.moving.size).toBe(0);
  expect(s.snapshot().bodies).toHaveLength(0);
  s.dispose();
});
it("preserves outside wreckage from a vaporized source and simulates debris below -50m", () => {
  const e = entity(0, 256, 256);
  const s = create([e]);
  const outside = (s as any).spawnBody(
    [650, 80, 650],
    [2, 2, 2],
    "stone",
    0,
    "chunk",
    [0, 0, 0],
  );
  s.startLaser([256, 10, 256]);
  for (let i = 0; i < 300; i++) s.step();
  expect(s.snapshot().bodies.some((b) => b.id === outside)).toBe(true);
  for (let i = 0; i < 240; i++) s.step();
  drain(s);
  expect(s.vaporized.has(0)).toBe(true);
  expect(s.snapshot().bodies.some((b) => b.id === outside)).toBe(false);
  const id = (s as any).spawnBody(
    [650, -450, 650],
    [1, 1, 1],
    "rock",
    -1,
    "chunk",
    [0, 0, 0],
  );
  s.step();
  expect(s.ballistic.has(id)).toBe(true);
  expect(s.ballistic.get(id)!.view.p[1]).toBeGreaterThan(-470);
  s.plane.p = [260, 20, 260];
  (s as any).ensureTerrain();
  s.physics.step();
  const hit = s.physics.castRay(
    { origin: { x: 260, y: 20, z: 260 }, dir: { x: 0, y: -1, z: 0 } } as any,
    600,
    true,
  );
  expect(hit).not.toBeNull();
  expect(20 - hit!.timeOfImpact).toBeCloseTo(s.terrain.sample(260, 260), 3);
  s.dispose();
});
it("retires completed strikes while later overlapping beams are still active", () => {
  const s = create();
  s.startLaser([256, 10, 256]);
  const first = s.lasers[0].id;
  for (let i = 0; i < 240; i++) s.step();
  s.startLaser([350, 10, 256]);
  const second = s.lasers[1].id;
  for (let i = 0; i < 300; i++) s.step();
  drain(s);
  expect(s.lasers.some((l) => l.id === first)).toBe(false);
  expect(s.lasers.find((l) => l.id === second)?.phase).toBe("burning");
  expect(s.terrain.sample(256, 256)).toBe(-490);
  s.dispose();
});
it("serializes final excavation acknowledgements and completes them after reload", () => {
  const s = create();
  s.startLaser([256, 10, 256]);
  (s as any).updateLasers(9);
  expect(s.lasers[0].phase).toBe("finishing");
  const saved = s.save();
  expect(saved.laserWork.length).toBeGreaterThan(0);
  expect(saved.lasers[0].pending!.length).toBeGreaterThan(0);
  const restored = new Simulation(s.world, flat, () => {}, saved);
  drain(restored);
  expect(restored.lasers).toHaveLength(0);
  expect(restored.terrain.sample(256, 256)).toBe(-490);
  s.dispose();
  restored.dispose();
});

it("the active laser destroys the aircraft once and allows the normal respawn", () => {
  const s = create();
  s.startLaser([256, 10, 256]);
  s.plane.p = [256, 300, 256];
  s.step();
  expect(s.plane.crashed).toBe(0); // Charging is harmless.
  for (let i = 1; i < 240; i++) s.step();
  s.plane.p = [256, 300, 256];
  s.step();
  expect(s.plane.crashed).toBe(2);
  for (let i = 0; i < 60; i++) s.step();
  expect(s.plane.crashed).toBeCloseTo(1);
  for (let i = 0; i < 61; i++) s.step();
  expect(s.plane.crashed).toBe(0);
  expect(s.plane.p[0]).toBeGreaterThan(1000);
  expect(s.lasers[0].phase).toBe("burning");
});
it("sweeps the finite firing shaft without making the excavation footprint lethal", () => {
  const s = create();
  s.startLaser([256, 10, 256]);
  const hit = (a: Vec3, b: Vec3) => s["laserPlaneHit"](a, b);
  expect(hit([220, 300, 256], [292, 300, 256])).toBeNull();
  s.lasers[0].phase = "burning";
  expect(hit([220, 300, 256], [292, 300, 256])).not.toBeNull();
  expect(hit([300, 300, 256], [300, 300, 257])).toBeNull();
  expect(
    hit([256, LASER.top + 10, 256], [256, LASER.top + 11, 256]),
  ).toBeNull();
  expect(hit([256, -100, 256], [256, -99, 256])).toBeNull();
  s.lasers[0].phase = "finishing";
  expect(hit([256, 300, 256], [256, 300, 257])).toBeNull();
});

it("normalizes laser controls and captures settings independently at launch", () => {
  expect(laserProfile(DEFAULT_DESTRUCTION)).toEqual({
    radius: 190,
    depth: 500,
    beamRadius: 28,
    brightness: 1,
  });
  expect(
    normalizeDestruction({
      laserSize: Infinity,
      laserDepth: -1,
      laserBrightness: 99,
    }),
  ).toMatchObject({ laserSize: 0, laserDepth: 25, laserBrightness: 2 });
  expect(
    laserProfile({ ...DEFAULT_DESTRUCTION, laserSize: 100 }).radius,
  ).toBeCloseTo(CONFIG.worldSize * Math.SQRT2 + CONFIG.spacing);
  const s = create();
  s.startLaser([256, 10, 256]);
  s.setDestruction({
    ...DEFAULT_DESTRUCTION,
    laserSize: 50,
    laserDepth: 100,
    laserBrightness: 0.25,
  });
  s.startLaser([256, 10, 256]);
  expect(s.lasers[0].profile).toEqual(laserProfile(DEFAULT_DESTRUCTION));
  expect(s.lasers[1].profile).toEqual(laserProfile(s.destruction));
  s["scheduleLaser"](s.lasers[0], 1);
  s["scheduleLaser"](s.lasers[1], 1);
  expect(s.laserWork.get(4 * CHUNKS + 4)!.targets).toHaveLength(2);
  s.lasers.forEach((l) => (l.phase = "finishing"));
  const save = s.save();
  const restored = new Simulation(s.world, flat, () => {}, save);
  drain(restored);
  expect(restored.lasers).toHaveLength(0);
  expect(restored.terrain.sample(256, 256)).toBe(-490);
  restored.setDestruction({ ...DEFAULT_DESTRUCTION, laserDepth: 25 });
  restored.startLaser([256, 10, 256]);
  restored["scheduleLaser"](restored.lasers[0], 1);
  drain(restored);
  expect(restored.terrain.sample(256, 256)).toBe(-490);
  s.dispose();
  restored.dispose();
});
it("loads version-5 strikes and excavation work without the new profile fields", () => {
  const s = create();
  s.startLaser([256, 10, 256]);
  s["scheduleLaser"](s.lasers[0], 0.5);
  const save = s.save();
  delete save.lasers[0].profile;
  for (const w of save.laserWork)
    for (const t of w.targets) {
      delete t.radius;
      delete t.depth;
    }
  const restored = new Simulation(s.world, flat, () => {}, save);
  expect(compatible(save, manifest.version, manifest.seed)).toBe(true);
  expect(restored.lasers[0].profile).toEqual(laserProfile(DEFAULT_DESTRUCTION));
  expect([...restored.laserWork.values()][0].targets[0]).toMatchObject({
    radius: 190,
    depth: 500,
  });
  drain(restored);
  expect(restored.terrain.sample(256, 256)).toBe(-240);
  s.dispose();
  restored.dispose();
});
it("maximum size clears all sections and water from a corner, with resumable queued cleanup", () => {
  const base = new Float32Array(CONFIG.grid * CONFIG.grid).fill(-4);
  const entities = [
    entity(0, 0, 0),
    entity(1, 2048, 2048),
    entity(2, 1024, 1024),
  ];
  const s = new Simulation(
    { ...manifest, entities, spawn: [1100, 350, 1100] },
    base,
    () => {},
  );
  s.setDestruction({ ...DEFAULT_DESTRUCTION, laserSize: 100, laserDepth: 100 });
  s.startLaser([0, -4, 0]);
  s.lasers[0].phase = "finishing";
  s.lasers[0].age = 9;
  s["scheduleLaser"](s.lasers[0], 1);
  expect(s.laserWork.size).toBe(CHUNKS * CHUNKS);
  s.processLaserWork(0.01);
  expect(s.laserWork.size).toBeGreaterThan(0);
  const saved = s.save();
  const restored = new Simulation(s.world, base, () => {}, saved);
  drain(restored);
  expect(restored.removed.size).toBe(3);
  expect(restored.ruins.size + restored.moving.size).toBe(0);
  expect(restored.terrain.flooded.some((v) => v !== 0)).toBe(false);
  expect(restored.terrain.laserDry.every((v) => v === 1)).toBe(true);
  expect(restored.terrain.sample(0, 0)).toBe(-104);
  expect(restored.terrain.sample(2048, 2048)).toBeLessThan(-4);
  expect(restored.lasers).toHaveLength(0);
  const reloaded = new Simulation(
    restored.world,
    base,
    () => {},
    restored.save(),
  );
  expect(reloaded.terrain.flooded.some((v) => v !== 0)).toBe(false);
  expect(reloaded.terrain.sample(0, 0)).toBe(-104);
  s.dispose();
  restored.dispose();
  reloaded.dispose();
});
it("scaled aircraft collision matches the captured beam and ignores brightness", () => {
  const s = create();
  s.setDestruction({
    ...DEFAULT_DESTRUCTION,
    laserSize: 100,
    laserBrightness: 0.25,
  });
  s.startLaser([1024, 10, 1024]);
  s.lasers[0].phase = "burning";
  expect(
    s["laserPlaneHit"]([1400, 300, 1024], [1401, 300, 1024]),
  ).not.toBeNull();
  s.setDestruction(DEFAULT_DESTRUCTION);
  expect(
    s["laserPlaneHit"]([1400, 300, 1024], [1401, 300, 1024]),
  ).not.toBeNull();
  expect(s["laserPlaneHit"]([2400, 300, 1024], [2401, 300, 1024])).toBeNull();
  s.dispose();
});
