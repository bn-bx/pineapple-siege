import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  MONSTER_BODY_HEIGHT,
  MONSTER_BODY_RADIUS,
  Monsters,
} from "../src/sim/monsters";
import { CONFIG, DEFAULT_MONSTER_COUNT } from "../src/config";
import { discoActive } from "../src/disco";
import { Terrain } from "../src/sim/terrain";
import { Simulation, initializePhysics } from "../src/sim/simulation";
import { compatible } from "../src/storage";
import type { Vec3, WorldData } from "../src/types";

const world = JSON.parse(
  readFileSync("tests/fixtures/legacy-world/world.json", "utf8"),
) as WorldData;
const bytes = readFileSync("tests/fixtures/legacy-world/world.bin");
const base = new Float32Array(
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
);
beforeAll(async () => initializePhysics(), 30000);

describe("giant pineapple monsters", () => {
  it("uses stable, separated land spawns without reviving defeated monsters when counts change", () => {
    const monsters = new Monsters(world, new Terrain(base));
    expect(monsters.states).toHaveLength(DEFAULT_MONSTER_COUNT);
    for (const m of monsters.states) {
      expect(Number.isFinite(m.p[1])).toBe(true);
      expect(
        monsters.states.filter(
          (other) =>
            other !== m &&
            Math.hypot(other.p[0] - m.p[0], other.p[2] - m.p[2]) < 140,
        ),
      ).toHaveLength(0);
    }
    const p = monsters.states[0].p;
    monsters.damage(monsters.states[0], 5);
    expect(monsters.states[0].defeated).toBe(true);
    monsters.setCount(0);
    expect(monsters.active()).toHaveLength(0);
    monsters.setCount(20);
    expect(monsters.active()).toHaveLength(19);
    expect(new Monsters(world, new Terrain(base)).states[0].p).toEqual(p);
  });

  it("grows to 400 separated land monsters, supports every slider count, and retains hidden defeats", () => {
    const terrain = new Terrain(base);
    const monsters = new Monsters(world, terrain);
    const original = structuredClone(monsters.states);
    monsters.setCount(400);
    expect(monsters.states.slice(0, DEFAULT_MONSTER_COUNT)).toEqual(original);
    expect(monsters.active()).toHaveLength(400);
    for (const m of monsters.states) {
      expect(m.p.every(Number.isFinite)).toBe(true);
      expect(m.p[0]).toBeGreaterThanOrEqual(75);
      expect(m.p[0]).toBeLessThanOrEqual(CONFIG.worldSize - 75);
      expect(m.p[2]).toBeGreaterThanOrEqual(75);
      expect(m.p[2]).toBeLessThanOrEqual(CONFIG.worldSize - 75);
      expect(terrain.water(m.p[0], m.p[2])).toBe(false);
      expect(
        monsters.states.some(
          (other) =>
            other !== m &&
            Math.hypot(other.p[0] - m.p[0], other.p[2] - m.p[2]) < 64,
        ),
      ).toBe(false);
    }
    monsters.damage(monsters.states[399], 5);
    for (let count = 0; count <= 400; count++) {
      monsters.setCount(count);
      expect(monsters.active()).toHaveLength(count === 400 ? 399 : count);
    }
    monsters.step(1 / 60, [90, 400, 90], false, () => false);
    expect(
      monsters.states.every(
        (m) => m.p.every(Number.isFinite) && Number.isFinite(m.yaw),
      ),
    ).toBe(true);
    expect(
      new Monsters(world, new Terrain(base), structuredClone(monsters.states))
        .states[399].defeated,
    ).toBe(true);
    monsters.setCount(401);
    expect(monsters.count).toBe(400);
    monsters.setCount(-1);
    expect(monsters.count).toBe(0);
  });

  it("preserves saves with the default population and restores a grown population even when hidden", () => {
    const sim = new Simulation(world, base, () => {});
    const oldSave = sim.save();
    expect(oldSave.monsters).toHaveLength(DEFAULT_MONSTER_COUNT);
    expect(compatible(oldSave, world.version, world.seed)).toBe(true);
    const earlierSave = {
      ...oldSave,
      monsters: oldSave.monsters!.slice(0, 60),
      civilians: oldSave.civilians!.slice(0, 225),
    };
    earlierSave.monsters[0].defeated = true;
    earlierSave.monsters[0].health = 0;
    earlierSave.civilians[0].alive = false;
    expect(compatible(earlierSave, world.version, world.seed)).toBe(true);
    const upgraded = new Simulation(world, base, () => {}, earlierSave);
    expect(upgraded.monsters.states).toHaveLength(DEFAULT_MONSTER_COUNT);
    expect(upgraded.monsters.states[0].defeated).toBe(true);
    expect(upgraded.civilians.states).toHaveLength(600);
    expect(upgraded.civilians.states[0].alive).toBe(false);
    expect(upgraded.civilians.states[225].alive).toBe(true);
    upgraded.dispose();
    sim.setMonsterCount(400);
    sim.monsters.damage(sim.monsters.states[399], 5);
    sim.setMonsterCount(7);
    const save = sim.save();
    expect(save.monsters).toHaveLength(400);
    expect(compatible(save, world.version, world.seed)).toBe(true);
    const restored = new Simulation(world, base, () => {}, save);
    restored.setMonsterCount(400);
    expect(restored.snapshot().monsters).toHaveLength(400);
    expect(restored.monsters.active()).toHaveLength(399);
    expect(restored.monsters.states[399].defeated).toBe(true);
    expect(
      compatible(
        {
          ...save,
          monsters: [...save.monsters!, { ...save.monsters![0], id: 400 }],
        },
        world.version,
        world.seed,
      ),
    ).toBe(false);
    restored.step();
    expect(
      restored.snapshot().monsters.every((m) => m.p.every(Number.isFinite)),
    ).toBe(true);
    sim.dispose();
    restored.dispose();
  });

  it("winds up, throws a spike, and can swipe a low jet", () => {
    const monsters = new Monsters(world, new Terrain(base));
    monsters.setCount(3);
    const m = monsters.states[0];
    const distant: Vec3 = [m.p[0] + 110, m.p[1] + 55, m.p[2]];
    for (let i = 0; i < 250 && !monsters.spikes.length; i++)
      monsters.step(1 / 60, distant, false, () => false);
    expect(monsters.spikes.length).toBeGreaterThan(0);
    monsters.spikes.length = 0;
    const low: Vec3 = [m.p[0], m.p[1] + 25, m.p[2] + 18];
    let swiped = false;
    for (let i = 0; i < 300 && !swiped; i++)
      swiped = monsters.step(1 / 60, low, false, () => false);
    expect(swiped).toBe(true);
    monsters.setCount(0);
    monsters.spikes.push({
      id: 0,
      age: 0,
      p: [m.p[0] - 8, m.p[1] + 40, m.p[2]],
      v: [160, 0, 0],
    });
    const jet: Vec3 = [m.p[0] - 6, m.p[1] + 40, m.p[2]];
    expect(monsters.step(1 / 60, jet, false, () => false)).toBe(true);
    expect(monsters.spikes).toHaveLength(0);
  });

  it("uses the doubled body envelope and relocates saved monsters that no longer fit", () => {
    const monsters = new Monsters(world, new Terrain(base));
    monsters.setCount(8);
    const m = monsters.states[0];
    const across: Vec3 = [m.p[0] - 50, m.p[1] + MONSTER_BODY_HEIGHT, m.p[2]];
    const end: Vec3 = [m.p[0] + 50, across[1], m.p[2]];
    expect(monsters.intersect(across, end)?.monster.id).toBe(0);
    expect(MONSTER_BODY_RADIUS).toBe(24);
    const saved = structuredClone(monsters.states);
    saved[0].p = [...world.castle];
    saved[0].health = 2;
    const restored = new Monsters(world, new Terrain(base), saved);
    expect(restored.states[0].p).not.toEqual(saved[0].p);
    expect(restored.states[0].health).toBe(2);
    expect(restored.states[0].defeated).toBe(false);
  });

  it("makes every living monster dance while strikes charge or burn, suppressing attacks", () => {
    const monsters = new Monsters(world, new Terrain(base));
    monsters.setCount(3);
    const m = monsters.states[0];
    const before = [...m.p];
    m.windup = 0.4;
    monsters.spikes.push({
      id: 0,
      age: 0,
      p: [m.p[0], m.p[1] + 50, m.p[2]],
      v: [0, 0, 0],
    });
    const near: Vec3 = [m.p[0], m.p[1] + 35, m.p[2] + 12];
    expect(monsters.step(1 / 60, near, false, () => false, true)).toBe(false);
    expect(m.p).toEqual(before);
    expect(m.windup).toBe(0);
    expect(m.phase).toBeGreaterThan(0);
    expect(monsters.spikes).toHaveLength(0);
    const strike = { id: 1, p: near, age: 0, phase: "charging" as const };
    expect(discoActive([strike])).toBe(true);
    expect(
      discoActive([
        { ...strike, phase: "finishing" },
        { ...strike, id: 2, phase: "burning" },
      ]),
    ).toBe(true);
    expect(discoActive([{ ...strike, phase: "finishing" }])).toBe(false);
  });

  it("kills a full-health monster on plane impact and saves its defeat", () => {
    const events: unknown[] = [];
    const sim = new Simulation(world, base, (e) => events.push(e));
    sim.setMonsterCount(2);
    const m = sim.monsters.states[0];
    m.stagger = 1; // Keep the target still and prevent an attack during impact.
    sim.plane.p = [m.p[0], m.p[1] + MONSTER_BODY_HEIGHT, m.p[2] - 27];
    sim.plane.yaw = 0;
    sim.plane.pitch = 0;
    sim.plane.speed = 120;
    sim.step();
    expect(m.health).toBe(0);
    expect(m.defeated).toBe(true);
    expect(sim.monsters.states[1].health).toBe(5);
    expect(sim.plane.crashed).toBeGreaterThan(0);
    expect(
      events.filter((e: any) => e.type === "monsterEvent" && e.kind === "defeat"),
    ).toHaveLength(1);
    const restored = new Simulation(world, base, () => {}, sim.save());
    expect(restored.monsters.states[0].defeated).toBe(true);
    sim.step();
    expect(
      events.filter((e: any) => e.type === "monsterEvent" && e.kind === "defeat"),
    ).toHaveLength(1);
    restored.dispose();
    sim.dispose();
  });

  it("does not kill a monster when its spike hits the plane", () => {
    const sim = new Simulation(world, base, () => {});
    sim.setMonsterCount(1);
    const m = sim.monsters.states[0];
    m.stagger = 1;
    sim.plane.p = [m.p[0], m.p[1] + MONSTER_BODY_HEIGHT + 80, m.p[2]];
    sim.plane.pitch = 0;
    sim.monsters.spikes.push({
      id: 0,
      age: 0,
      p: [...sim.plane.p],
      v: [0, 0, 0],
    });
    sim.step();
    expect(sim.plane.crashed).toBeGreaterThan(0);
    expect(m.health).toBe(5);
    expect(m.defeated).toBe(false);
    sim.dispose();
  });

  it("takes five cannon blasts, one nuke, and laser damage, then saves defeat", () => {
    const events: unknown[] = [];
    const sim = new Simulation(world, base, (e) => events.push(e));
    sim.setMonsterCount(8);
    const m = sim.monsters.states[0];
    const p: Vec3 = [m.p[0], m.p[1] + 14, m.p[2]];
    sim.explode(p);
    expect(m.health).toBe(4);
    for (let i = 0; i < 4; i++) sim.explode(p);
    expect(m.defeated).toBe(true);
    const n = sim.monsters.states[1];
    sim.detonateNuke([n.p[0], n.p[1] + 14, n.p[2]], "local");
    expect(n.defeated).toBe(true);
    const save = sim.save();
    expect(compatible(save, world.version, world.seed)).toBe(true);
    const restored = new Simulation(world, base, () => {}, save);
    expect(restored.monsters.states[0].defeated).toBe(true);
    expect(restored.monsters.states[1].defeated).toBe(true);
    const older = { ...save, monsters: undefined };
    expect(compatible(older, world.version, world.seed)).toBe(true);
    const upgraded = new Simulation(world, base, () => {}, older);
    expect(upgraded.monsters.states[0].defeated).toBe(false);
    expect(
      events.some((e: any) => e.type === "monsterEvent" && e.kind === "defeat"),
    ).toBe(true);
    sim.dispose();
    restored.dispose();
    upgraded.dispose();
  });

  it("damages a monster under a sustained laser and advances 20 monsters through destruction", () => {
    const sim = new Simulation(world, base, () => {});
    sim.setMonsterCount(20);
    const m = sim.monsters.states[19];
    sim.plane.p = [90, 400, 90];
    sim.startLaser([m.p[0], m.p[1] + 14, m.p[2]]);
    for (let i = 0; i < 510; i++) sim.step();
    expect(m.defeated).toBe(true);
    expect(sim.snapshot().monsters).toHaveLength(20);
    expect(sim.snapshot().stats.physicsMS).toBeGreaterThanOrEqual(0);
    sim.dispose();
  }, 30000);
});

it("fires three velocity-led spikes at spaced intervals and bounds their lifetime", () => {
  const monsters = new Monsters(world, new Terrain(base));
  monsters.setCount(1);
  const m = monsters.states[0];
  m.windup = 1 / 60;
  const plane: Vec3 = [m.p[0], m.p[1] + 100, m.p[2] + 230];
  monsters.step(1 / 60, plane, false, () => false, false, [60, 0, 0]);
  expect(monsters.spikes).toHaveLength(1);
  expect(monsters.spikes[0].v[0]).toBeGreaterThan(0);
  const launchVelocity = [...monsters.spikes[0].v];
  launchVelocity[1] += 12 / 60; // Undo gravity applied during the first tick.
  expect(Math.hypot(...launchVelocity)).toBeCloseTo(125);
  for (let i = 0; i < 19; i++)
    monsters.step(1 / 60, plane, false, () => false, false, [60, 0, 0]);
  expect(monsters.spikes).toHaveLength(3);
  for (const spike of monsters.spikes) spike.age = 7;
  monsters.step(1 / 60, plane, false, () => false);
  expect(monsters.spikes).toHaveLength(0);
});
it("cancels the remaining volley on stagger and during disco", () => {
  for (const disco of [false, true]) {
    const monsters = new Monsters(world, new Terrain(base));
    monsters.setCount(1);
    const m = monsters.states[0];
    m.windup = 1 / 60;
    const plane: Vec3 = [m.p[0], m.p[1] + 100, m.p[2] + 230];
    monsters.step(1 / 60, plane, false, () => false);
    expect(monsters.spikes).toHaveLength(1);
    if (disco) monsters.step(1 / 60, plane, false, () => false, true);
    else monsters.damage(m, 1);
    const fired = monsters.spikes.length;
    for (let i = 0; i < 20; i++)
      monsters.step(1 / 60, plane, false, () => false);
    expect(monsters.spikes.length).toBeLessThanOrEqual(fired);
  }
});
