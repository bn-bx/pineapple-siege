import { CONFIG } from "../src/config";
import { beforeAll, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { Simulation, initializePhysics } from "../src/sim/simulation";
import { pointerSteering } from "../src/input";
import { NUKE_PROFILES } from "../src/config";
import { compatible } from "../src/storage";
import type { WorldData, NukeYield } from "../src/types";
const world: WorldData = JSON.parse(readFileSync("public/world.json", "utf8"));
const b = readFileSync("public/world.bin"),
  base = new Float32Array(
    b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
  );
beforeAll(initializePhysics);
function sim() {
  return new Simulation(world, base, () => {});
}
it("maps pointer motion and each independent reversal predictably", () => {
  for (const reverseX of [false, true])
    for (const reverseY of [false, true]) {
      const p = pointerSteering(0, 0, 100, -100, {
        reverseX,
        reverseY,
        sensitivity: 1,
        nukeYield: "local",
      });
      expect(Math.sign(p.x)).toBe(reverseX ? -1 : 1);
      expect(Math.sign(p.y)).toBe(reverseY ? -1 : 1);
    }
});
it("turns screen-right for positive pointer or D input and retains boundary assistance", () => {
  const s = sim();
  s.plane.p = [1024, 350, 700];
  s.plane.yaw = 0;
  s.plane.pitch = 0;
  s.input.x = 1;
  s.step();
  expect(s.plane.yaw).toBeLessThan(0);
  expect(s.plane.roll).toBeGreaterThan(0);
  s.plane.yaw = 0;
  s.input.x = 0;
  s.input.bank = 1;
  s.step();
  expect(s.plane.yaw).toBeLessThan(0);
  s.plane.p = [100, 350, 1024];
  s.plane.yaw = 0;
  s.step();
  expect(s.plane.yaw).toBeGreaterThan(0);
  s.dispose();
});
it("selects independent weapons, captures yield on release and retains cooldown across respawn", () => {
  const s = sim();
  s.plane.p = [1024, 400, 650];
  s.plane.pitch = 0;
  s.weapon = "nuke";
  s.nukeYield = "valley";
  s.input.fire = true;
  s.step();
  expect(s.projectiles[0].weapon).toBe("nuke");
  expect(s.projectiles[0].yield).toBe("valley");
  expect(s.projectiles[0].v[1]).toBeLessThan(0);
  expect(Math.hypot(s.projectiles[0].v[0], s.projectiles[0].v[2])).toBeLessThan(
    100,
  );
  expect(s.cooldowns.nuke).toBe(10);
  s.nukeYield = "local";
  s.weapon = "cannon";
  s.step();
  expect(s.projectiles.some((p) => p.weapon === "cannon")).toBe(true);
  expect(s.projectiles.find((p) => p.weapon === "nuke")!.yield).toBe("valley");
  const remaining = s.cooldowns.nuke;
  s.respawn();
  expect(s.cooldowns.nuke).toBe(remaining);
  s.dispose();
});
it("builds a grand supported fortress within its component budget", () => {
  expect(world.castleCount).toBeLessThanOrEqual(5000);
  expect(world.structureCount).toBeLessThanOrEqual(8000);
  expect(world.castleBounds.max[0] - world.castleBounds.min[0]).toBe(500);
  expect(
    Math.max(
      ...world.entities
        .filter((e) => e.assembly === "keep")
        .map((e) => e.p[1] + e.s[1]),
    ),
  ).toBeGreaterThan(195);
  expect(world.landmarks.towers).toHaveLength(12);
  const s = sim();
  const original = s.removed.size;
  (s as any).dirtyAssemblies = new Set(
    world.entities.filter((e) => e.assembly).map((e) => e.assembly),
  );
  (s as any).resolveSupport(world.castle);
  expect(
    s.removed.size,
    JSON.stringify(
      [...s.removed].map((id) => ({
        assembly: world.entities[id].assembly,
        p: world.entities[id].p,
      })),
    ),
  ).toBe(original);
  // A neutral approach must clear the new keep instead of repeatedly respawning into it.
  for (let i = 0; i < 600; i++) {
    s.step();
    expect(s.plane.crashed).toBe(0);
  }
  s.dispose();
});
it("applies each nuke profile, limits bedrock and completes serialized pending work", () => {
  for (const strength of ["local", "castle", "valley"] as NukeYield[]) {
    const s = sim(),
      p: [number, number, number] = [world.castle[0], 10, world.castle[2]];
    const old = s.terrain.sample(p[0], p[2]);
    s.detonateNuke(p, strength);
    s.processDestruction(0.01);
    const saved = s.save();
    expect(saved.pendingJobs.length).toBe(1);
    expect(compatible(saved, world.version, world.seed)).toBe(true);
    const restored = new Simulation(world, base, () => {}, saved);
    while (restored.pendingJobs.length) restored.processDestruction(50);
    while (s.pendingJobs.length) s.processDestruction(50);
    expect(restored.terrain.sample(p[0], p[2])).toBeCloseTo(
      old - NUKE_PROFILES[strength].depth,
      3,
    );
    expect([...restored.removed].sort((a, b) => a - b)).toEqual(
      [...s.removed].sort((a, b) => a - b),
    );
    expect(restored.terrain.changed.size).toBe(s.terrain.changed.size);
    expect(s.moving.size).toBeLessThanOrEqual(256);
    const inner = world.entities.filter(
      (e) =>
        e.kind === "block" &&
        Math.hypot(
          ...e.p.map((v, k) => Math.max(0, Math.abs(v - p[k]) - e.s[k])),
        ) <
          NUKE_PROFILES[strength].damageRadius * 0.7,
    );
    expect(inner.length).toBeGreaterThan(0);
    expect(inner.every((e) => s.removed.has(e.id))).toBe(true);
    s.dispose();
    restored.dispose();
  }
}, 30000);

it("sweeps a falling nuke into the river and retains its released yield", () => {
  const events: any[] = [];
  const s = new Simulation(world, base, (e) => {
    if (e.type === "explosion") events.push(e);
  });
  // Choose a flooded canonical sample, clear of the bridge and shoreline.
  let river = -1;
  for (let i = 0; i < s.terrain.flooded.length; i++) {
    const x = (i % CONFIG.grid) * 2,
      z = Math.floor(i / CONFIG.grid) * 2;
    if (
      x > 800 &&
      x < 1000 &&
      z > 700 &&
      z < 900 &&
      base[i] < -3 &&
      s.terrain.flooded[i]
    ) {
      river = i;
      break;
    }
  }
  expect(river).toBeGreaterThan(-1);
  const x = (river % CONFIG.grid) * 2,
    z = Math.floor(river / CONFIG.grid) * 2;
  s.projectiles.push({
    id: 99,
    weapon: "nuke",
    yield: "local",
    p: [x, 60, z],
    v: [0, -160, 0],
    age: 0,
  });
  s.nukeYield = "valley";
  for (let i = 0; i < 45; i++) s.step();
  const blast = events.find((e) => e.kind === "nuke");
  expect(blast).toBeDefined();
  expect(blast.water).toBe(true);
  expect(blast.yield).toBe("local");
  expect(blast.profile.damageRadius).toBe(70);
  expect(s.projectiles).toHaveLength(0);
  while (s.pendingJobs.length) s.processDestruction(50);
  expect(s.terrain.sample(x, z)).toBeLessThan(base[river] - 10);
  expect(s.terrain.water(x, z)).toBe(true);
  s.dispose();
});

it("fires three normal cannon rounds in 1.7 seconds with the faster cooldown", () => {
  const s = sim();
  s.setMonsterCount(0);
  s.plane.p = [1024, 700, 650];
  s.input.fire = true;
  for (let i = 0; i < 102; i++) s.step();
  expect(s.snapshot().stats.shots).toBe(3);
  expect(s.projectiles).toHaveLength(3);
  s.dispose();
});
