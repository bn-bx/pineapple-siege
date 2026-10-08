import { beforeAll, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { CONFIG, RAPID_FIRE_INTERVAL } from "../src/config";
import {
  WeaponDriver,
  type WeaponDriverContext,
} from "../src/sim/weapon-driver";
import { Simulation, initializePhysics } from "../src/sim/simulation";
import { Monsters } from "../src/sim/monsters";
import { Terrain } from "../src/sim/terrain";
import type { PlaneState, WorldData } from "../src/types";

function weapons() {
  const host = {
    weapon: "cannon",
    input: { fire: true },
    cooldowns: { cannon: 0, nuke: 0, laser: 0 },
    destruction: { noCooldown: false },
    projectiles: [],
    pendingJobs: [],
    shots: 0,
    nextShot: 1,
    nukeYield: "local",
    sweep: () => null,
    monsters: { intersect: () => null },
    explode: vi.fn(),
    detonateNuke: vi.fn(),
  } as unknown as WeaponDriverContext;
  const plane: PlaneState = {
    p: [1000, 1000, 100],
    v: [0, 0, 35],
    yaw: 0,
    pitch: 0,
    roll: 0,
    speed: 35,
    crashed: 0,
    boundary: false,
  };
  return { host, plane, driver: new WeaponDriver(host) };
}
it("launches faster shots with inherited aircraft speed and sustains four shots per second", () => {
  const { host, plane, driver } = weapons();
  // Reserve all eight allowed nuclear slots while firing the cannon.
  for (let id = 0; id < 8; id++)
    host.projectiles.push({
      id: 100 + id,
      weapon: "nuke",
      yield: "local",
      p: [1000, 1000, 100],
      v: [0, 0, 0],
      age: 0,
    });
  for (let tick = 0; tick < 600; tick++) {
    host.cooldowns.cannon = Math.max(0, host.cooldowns.cannon - CONFIG.dt);
    driver.fire(plane, [0, 0, 1]);
    if (tick === 0) {
      expect(host.projectiles.at(-1)!.v[2]).toBe(455);
      expect(host.cooldowns.cannon).toBe(0.25);
    }
    driver.update(CONFIG.dt);
    expect(host.projectiles.length).toBeLessThanOrEqual(40);
  }
  expect(host.shots).toBe(40);
  expect(
    host.projectiles.filter((p) => p.weapon === "cannon").length,
  ).toBeGreaterThanOrEqual(30);
});
it("preserves the 0.1-second rapid-fire override", () => {
  const { host, plane, driver } = weapons();
  host.destruction.noCooldown = true;
  for (let tick = 0; tick < 60; tick++) {
    host.cooldowns.cannon = Math.max(0, host.cooldowns.cannon - CONFIG.dt);
    driver.fire(plane, [0, 0, 1]);
    driver.update(CONFIG.dt);
  }
  expect(host.shots).toBe(10);
  expect(RAPID_FIRE_INTERVAL).toBe(0.1);
});
const world = JSON.parse(
  readFileSync("tests/fixtures/legacy-world/world.json", "utf8"),
) as WorldData;
const bytes = readFileSync("tests/fixtures/legacy-world/world.bin");
const base = new Float32Array(
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
);
beforeAll(initializePhysics);
it("reaches the new throttle and boost limits with smooth acceleration", () => {
  const sim = new Simulation(world, base, () => {});
  sim.setMonsterCount(0);
  sim.input.throttle = 1;
  for (let tick = 0; tick < 600; tick++) {
    sim.plane.p = [3000, 1200, 3000];
    sim.plane.pitch = 0;
    sim.step();
  }
  expect(sim.plane.speed).toBeCloseTo(180, 2);
  const normal = sim.plane.speed;
  sim.input.boost = true;
  sim.plane.p = [3000, 1200, 3000];
  sim.step();
  expect(sim.plane.speed).toBeGreaterThan(normal);
  expect(sim.plane.speed).toBeLessThan(240);
  for (let tick = 0; tick < 300; tick++) {
    sim.plane.p = [3000, 1200, 3000];
    sim.step();
  }
  expect(sim.plane.speed).toBeCloseTo(240, 2);
  sim.plane.p = [3000, 1200, CONFIG.worldSize - 280];
  sim.plane.yaw = 0;
  sim.plane.pitch = 0;
  for (let tick = 0; tick < 300; tick++) {
    sim.step();
    expect(sim.plane.p[2]).toBeLessThan(CONFIG.worldSize);
    expect(sim.plane.crashed).toBe(0);
  }
  expect(sim.plane.boundary).toBe(false);
  sim.dispose();
});
it("sweeps enemy shots against jet motion without changing their five-unit hit radius", () => {
  const monsters = new Monsters(world, new Terrain(base));
  monsters.setCount(0);
  monsters.spikes.push({ id: 1, p: [1000, 300, 1000], v: [0, 0, 0], age: 0 });
  // Both endpoints are outside the hit radius, but the jet passes through the shot.
  expect(
    monsters.step(
      0.1,
      [1006, 300, 1000],
      false,
      () => false,
      false,
      [120, 0, 0],
      [994, 300, 1000],
    ),
  ).toBe(true);
  expect(monsters.spikes).toHaveLength(0);
});
