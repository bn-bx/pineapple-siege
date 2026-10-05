import { beforeAll, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { Simulation, initializePhysics } from "../src/sim/simulation";
import {
  DEFAULT_DESTRUCTION,
  fixedDestruction,
  normalizeDestruction,
  nukeProfile,
  NUKE_LIMITS,
  COSMETIC_SCALE,
} from "../src/destruction-settings";
import { Fragments } from "../src/render/fragments";
import { flightPose } from "../src/render/flight-pose";
import { compatible } from "../src/storage";
import type { WorldData, WorkerMessage, Vec3 } from "../src/types";
const world: WorldData = JSON.parse(
  readFileSync("tests/fixtures/legacy-world/world.json", "utf8"),
);
const bytes = readFileSync("tests/fixtures/legacy-world/world.bin");
const base = new Float32Array(
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
);
beforeAll(initializePhysics);

it("fixes every removed control at its default even when old preferences override it", () => {
  expect(
    fixedDestruction({
      bodies: 4,
      fragments: 4,
      cosmetics: 4,
      rubble: 4,
      nukeScale: 3,
      laserSize: 100,
      laserDepth: 25,
      laserBrightness: 2,
      noCooldown: true,
    }),
  ).toEqual({ ...DEFAULT_DESTRUCTION, noCooldown: true });
  expect(fixedDestruction({ noCooldown: false, noNukeCooldown: true })).toEqual(
    DEFAULT_DESTRUCTION,
  );
});

it("migrates absent preferences and bounds experimental values", () => {
  expect(normalizeDestruction()).toEqual(DEFAULT_DESTRUCTION);
  expect(normalizeDestruction({ noNukeCooldown: true }).noCooldown).toBe(true);
  expect(
    normalizeDestruction({ noCooldown: false, noNukeCooldown: true })
      .noCooldown,
  ).toBe(false);
  expect(
    normalizeDestruction({
      bodies: 99,
      fragments: -3,
      cosmetics: NaN,
      nukeScale: Infinity,
    }),
  ).toMatchObject({ bodies: 4, fragments: 0, cosmetics: 1, nukeScale: 1 });
  expect(
    nukeProfile("valley", { ...DEFAULT_DESTRUCTION, nukeScale: 3 }),
  ).toMatchObject({ damageRadius: 1260, craterRadius: 720, depth: 50 });
});

it("uses 0.1-second rapid fire without projectile admission limits and captures strength at release", () => {
  const s = new Simulation(world, base, () => {});
  s.plane.p = [1024, 400, 650];
  s.plane.pitch = 0;
  s.weapon = "nuke";
  s.input.fire = true;
  s.step();
  expect(s.cooldowns.nuke).toBe(10);
  s.setDestruction({
    ...DEFAULT_DESTRUCTION,
    noCooldown: true,
    nukeScale: 3,
    fragments: 4,
  });
  s.step();
  expect(s.cooldowns.nuke).toBe(0.1);
  const released = s.projectiles[1];
  expect(released.profile).toMatchObject({
    damageRadius: 210,
    bodyLimit: NUKE_LIMITS[4],
  });
  s.setDestruction({ ...DEFAULT_DESTRUCTION, noCooldown: true });
  for (let i = 0; i < 20; i++) s.step();
  expect(s.shots).toBe(6);
  expect(s.projectiles).toHaveLength(6);
  expect(released.profile!.damageRadius).toBe(210);
  s.weapon = "cannon";
  s.cooldowns.cannon = 0.9;
  s.setDestruction({ ...DEFAULT_DESTRUCTION, noCooldown: true });
  for (let i = 0; i < 60; i++) s.step();
  expect(s.shots).toBe(16);
  expect(s.cooldowns.cannon).toBeCloseTo(1 / 60);
  expect(s.projectiles.length).toBeGreaterThan(12);
  s.setDestruction(DEFAULT_DESTRUCTION);
  s.projectiles.length = 0;
  s.weapon = "nuke";
  s.cooldowns.nuke = 0;
  s.step();
  expect(s.cooldowns.nuke).toBe(10);
  s.dispose();
});

it("keeps shooting through a full damage queue and accepts the queued save", () => {
  const s = new Simulation(world, base, () => {});
  s.plane.p = [1024, 400, 650];
  s.plane.pitch = 0;
  s.setDestruction({ ...DEFAULT_DESTRUCTION, noCooldown: true });
  for (let i = 0; i < 10; i++) s.detonateNuke([500, 400, 500], "local");
  const saved = s.save();
  expect(saved.pendingJobs).toHaveLength(10);
  expect(compatible(saved, world.version, world.seed)).toBe(true);
  s.weapon = "nuke";
  s.input.fire = true;
  s.step();
  expect(s.shots).toBe(1);
  s.dispose();
});

it("bounds visual output, preserves amplified pending jobs and bedrock", () => {
  const events: WorkerMessage[] = [];
  const s = new Simulation(world, base, (e) => events.push(e));
  s.plane.p = [1210, 280, 1070];
  s.setDestruction({
    ...DEFAULT_DESTRUCTION,
    bodies: 3,
    fragments: 4,
    cosmetics: 4,
    rubble: 4,
    nukeScale: 2,
  });
  s.detonateNuke(world.castle, "local");
  const save = s.save();
  expect(compatible(save, world.version, world.seed)).toBe(true);
  expect(save.pendingJobs[0].profile).toMatchObject({
    damageRadius: 140,
    bodyLimit: NUKE_LIMITS[4],
    ejecta: 720 * COSMETIC_SCALE[4],
  });
  const restored = new Simulation(world, base, () => {}, save);
  restored.plane.p = [...s.plane.p];
  while (s.pendingJobs.length) s.processDestruction(50);
  while (restored.pendingJobs.length) restored.processDestruction(50);
  expect([...restored.removed].sort()).toEqual([...s.removed].sort());
  expect(s.moving.size).toBe(0);
  expect(s.ballistic.size).toBeGreaterThan(256);
  expect(s.snapshot().bodies.length).toBeLessThanOrEqual(512);
  expect(s.moving.size).toBeLessThanOrEqual(s.bodyLimit);
  expect(
    events
      .filter((e) => e.type === "fragments")
      .reduce((n, e) => n + e.count, 0),
  ).toBeGreaterThan(0);
  for (const [i, height] of s.terrain.changed)
    expect(height).toBeGreaterThanOrEqual(base[i] - 50.001);
  s.setDestruction({ ...DEFAULT_DESTRUCTION, bodies: 0 });
  const trimTicks = Math.ceil((s.moving.size - 64) / 16) + 120;
  for (let i = 0; i < trimTicks && s.moving.size > 64; i++) s.step();
  expect(s.moving.size).toBeLessThanOrEqual(64);
  s.dispose();
  restored.dispose();
}, 30000);

it("retains original module dimensions in temporary wreckage at Extreme", () => {
  const s = new Simulation({ ...world, entities: [] }, base, () => {});
  s.setDestruction({ ...DEFAULT_DESTRUCTION, rubble: 4 });
  const entity = {
    ...world.entities.find((e) => e.kind === "block")!,
    p: [650, 150, 650] as Vec3,
    s: [8, 5, 7] as Vec3,
  };
  (s as any).staticFragment(entity);
  expect(s.snapshot().bodies[0].s).toEqual(entity.s);
  for (let i = 0; i < 400; i++) (s as any).staticFragment(entity);
  expect(s.snapshot().bodies).toHaveLength(401);
  expect(s.ruins.size).toBe(0);
  expect(s.save().ruins.length).toBe(384);
  s.dispose();
});

it("resizes cosmetic budgets without reallocating or retaining hidden live pieces", () => {
  const f = new Fragments(() => 0);
  f.setLimit(16384);
  f.emit({
    type: "fragments",
    p: [0, 20, 0],
    origin: [0, 0, 0],
    material: "stone",
    seed: 1,
    count: 18000,
    speed: 50,
    spread: 2,
  });
  f.update(0);
  expect(f.count).toBe(512);
  f.setLimit(128);
  expect(f.count).toBe(128);
  f.setLimit(16384);
  expect(f.count).toBe(128);
  f.mesh.geometry.dispose();
  (f.mesh.material as any).dispose();
});

it("interpolates turning and position together, takes the short yaw path and snaps respawns", () => {
  const old = {
    p: [0, 100, 0] as Vec3,
    v: [0, 0, 60] as Vec3,
    yaw: Math.PI - 0.1,
    pitch: 0,
    roll: 0,
    speed: 60,
    crashed: 0,
    boundary: false,
  };
  const next = {
    ...old,
    p: [1, 100, 1] as Vec3,
    yaw: -Math.PI + 0.1,
    roll: 0.4,
  };
  const a = flightPose(old, next, 0),
    b = flightPose(old, next, 0.5),
    c = flightPose(old, next, 1);
  expect(b.position.x).toBe(0.5);
  expect(a.rotation.angleTo(b.rotation)).toBeCloseTo(
    b.rotation.angleTo(c.rotation),
    5,
  );
  expect(a.rotation.angleTo(c.rotation)).toBeLessThan(0.5);
  const respawn = flightPose(old, { ...next, p: [1000, 400, 700] }, 0);
  expect(respawn.discontinuity).toBe(true);
  expect(respawn.position.x).toBe(1000);
});
