import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { Flies, flyBodyHit } from "../src/sim/flies";
import { Terrain } from "../src/sim/terrain";
import { Simulation, initializePhysics } from "../src/sim/simulation";
import { compatible } from "../src/storage";
import type { Vec3, WorldData } from "../src/types";

const flat = {
  sample: () => 0,
  surfaceHeight: () => undefined,
} as unknown as Terrain;
const emptyWorld = {
  seed: 123,
  size: 6144,
  spawn: [3000, 100, 3000],
  entities: [],
} as unknown as WorldData;
const clear = () => null;
function setup() {
  const flies = new Flies(emptyWorld, flat, new Set());
  flies.step(5, [3000, 100, 3000], [3000, 100, 3000], [0, 0, 0], true, clear);
  for (const f of flies.states.slice(1)) f.defeated = true;
  const f = flies.states[0];
  f.p = [1000, 100, 1000];
  f.yaw = 0;
  f.pitch = 0;
  f.mode = "roam";
  return { flies, f };
}

describe("giant flies", () => {
  it("spawns six deterministic, separated flies outside the jet safety radius", () => {
    const a = new Flies(emptyWorld, flat, new Set()),
      b = new Flies(emptyWorld, flat, new Set());
    expect(a.states).toEqual(b.states);
    expect(a.states).toHaveLength(6);
    for (const f of a.states) {
      expect(Math.hypot(f.p[0] - 3000, f.p[2] - 3000)).toBeGreaterThan(300);
      expect(f.p[1]).toBeGreaterThan(25);
      expect(
        a.states.filter(
          (other) =>
            other !== f &&
            Math.hypot(f.p[0] - other.p[0], f.p[2] - other.p[2]) < 150,
        ),
      ).toHaveLength(0);
    }
    expect(
      Math.hypot(a.states[0].p[0] - 3000, a.states[0].p[2] - 3000),
    ).toBeCloseTo(420);
  });
  it("telegraphs a fixed-direction lunge, recovers, and disengages", () => {
    const { flies, f } = setup();
    const jet: Vec3 = [1000, 100, 1080];
    flies.step(1 / 60, jet, jet, [0, 0, 60], false, clear);
    expect(f.mode).toBe("windup");
    for (let i = 0; i < 34; i++)
      flies.step(1 / 60, jet, jet, [0, 0, 60], false, clear);
    expect(f.mode).toBe("windup");
    for (let i = 0; i < 2; i++)
      flies.step(1 / 60, jet, jet, [0, 0, 60], false, clear);
    expect(f.mode).toBe("lunge");
    expect(Math.hypot(...f.v)).toBeCloseTo(140);
    const heading = [...f.v];
    flies.step(1 / 60, jet, [1100, 100, 1080], [120, 0, 0], false, clear);
    expect(f.v).toEqual(heading);
    for (let i = 0; i < 60; i++)
      flies.step(1 / 60, jet, jet, [0, 0, 0], false, clear);
    expect(f.mode).toBe("recovery");
    flies.step(0.1, jet, [5000, 100, 5000], [0, 0, 0], false, clear);
    expect(f.mode).toBe("roam");
  });
  it("checks body-only swept collisions, including relative motion", () => {
    const { f } = setup();
    expect(flyBodyHit([1000, 100, 900], [1000, 100, 1100], f)).toBeCloseTo(
      0.395,
    );
    expect(flyBodyHit([1018, 100, 900], [1018, 100, 1100], f)).toBeNull();
    f.p = [1050, 100, 1000];
    expect(
      flyBodyHit(
        [1000, 100, 1000],
        [1000, 100, 1000],
        f,
        2.2,
        [950, 100, 1000],
      ),
    ).toBeCloseTo(0.398);
    f.yaw = Math.PI / 2;
    expect(flyBodyHit([950, 100, 1000], [1150, 100, 1000], f)).toBeCloseTo(
      0.395,
    );
  });
  it("protects the jet after respawn and keeps the attacker alive", () => {
    const { flies, f } = setup();
    const from: Vec3 = [1000, 100, 900],
      jet: Vec3 = [1000, 100, 1100];
    flies.protect();
    expect(flies.step(0.01, from, jet, [0, 0, 0], false, clear)).toBeNull();
    flies.step(5, jet, jet, [0, 0, 0], true, clear);
    f.p = [1000, 100, 1000];
    f.yaw = 0;
    expect(flies.step(0.01, from, jet, [0, 0, 0], false, clear)).not.toBeNull();
    expect(f.health).toBe(3);
    expect(f.defeated).toBe(false);
  });
  it("stays within boundaries, climbs before structures, and ignores removed structures", () => {
    const entity = {
      id: 0,
      kind: "block",
      p: [1000, 150, 1050],
      s: [20, 100, 20],
    };
    const removed = new Set<number>();
    const flies = new Flies(
      { ...emptyWorld, entities: [entity] } as WorldData,
      flat,
      removed,
    );
    const f = flies.states[0];
    f.p = [1000, 100, 990];
    f.yaw = 0;
    flies.step(
      0.1,
      [5000, 100, 5000],
      [5000, 100, 5000],
      [0, 0, 0],
      true,
      clear,
    );
    expect(f.p[2]).toBe(990);
    expect(f.p[1]).toBeGreaterThan(100);
    removed.add(0);
    flies.step(
      0.1,
      [5000, 100, 5000],
      [5000, 100, 5000],
      [0, 0, 0],
      true,
      clear,
    );
    expect(f.p[2]).toBeGreaterThan(990);
    f.p = [25, 100, 25];
    for (let i = 0; i < 600; i++)
      flies.step(
        1 / 60,
        [5000, 100, 5000],
        [5000, 100, 5000],
        [0, 0, 0],
        true,
        clear,
      );
    expect(f.p.every(Number.isFinite)).toBe(true);
    expect(f.p[0]).toBeGreaterThanOrEqual(25);
    expect(f.p[2]).toBeGreaterThanOrEqual(25);
  });
  it("takes three hits, falls, clears, and retains defeats when loaded", () => {
    const { flies, f } = setup();
    for (let i = 0; i < 3; i++) flies.damage([...f.p], 0, 1);
    expect(f.health).toBe(0);
    expect(f.defeated).toBe(true);
    flies.step(
      0.1,
      [3000, 100, 3000],
      [3000, 100, 3000],
      [0, 0, 0],
      true,
      clear,
    );
    expect(f.p[1]).toBeLessThan(100);
    expect(f.roll).not.toBe(0);
    flies.step(4, [3000, 100, 3000], [3000, 100, 3000], [0, 0, 0], true, clear);
    const restored = new Flies(
      emptyWorld,
      flat,
      new Set(),
      structuredClone(flies.states),
    );
    expect(restored.states[0].defeated).toBe(true);
    expect(restored.states[0].deathAge).toBe(4);
  });
});

const world = JSON.parse(
  readFileSync("tests/fixtures/legacy-world/world.json", "utf8"),
) as WorldData;
const bytes = readFileSync("tests/fixtures/legacy-world/world.bin");
const base = new Float32Array(
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
);
beforeAll(initializePhysics);
it("preserves flies across packed snapshots and both save capture paths; accepts older saves", () => {
  const sim = new Simulation(world, base, () => {});
  sim.flies.states[0].health = 0;
  sim.flies.states[0].defeated = true;
  sim.flies.states[1].mode = "lunge";
  const snapshot = sim.snapshot(true);
  expect(snapshot.flies).toHaveLength(6);
  expect(snapshot.packedMotion).toBeDefined();
  expect(structuredClone(snapshot).flies![0].defeated).toBe(true);
  const capture = sim.captureSave();
  let captured = capture.next();
  while (!captured.done) captured = capture.next();
  expect(captured.value.flies).toEqual(sim.flies.states);
  const save = sim.save();
  expect(save.flies).toHaveLength(6);
  expect(compatible(save, world.version, world.seed)).toBe(true);
  const restored = new Simulation(world, base, () => {}, save);
  expect(restored.flies.states[0].defeated).toBe(true);
  expect(restored.flies.states[1].mode).toBe("roam");
  const malformed = structuredClone(save);
  malformed.flies![1].p[0] = NaN;
  expect(compatible(malformed, world.version, world.seed)).toBe(false);
  delete save.flies;
  expect(compatible(save, world.version, world.seed)).toBe(true);
  const legacy = new Simulation(world, base, () => {}, save);
  expect(legacy.flies.states.every((f) => f.health === 3)).toBe(true);
  sim.dispose();
  restored.dispose();
  legacy.dispose();
});

it("integrates cannon, nuclear, and laser damage and prioritizes flies in targeting", () => {
  const sim = new Simulation(world, base, () => {});
  const f = sim.flies.states[0];
  f.p = [2000, 1200, 2080];
  f.yaw = 0;
  f.pitch = 0;
  sim.plane.p = [2000, 1200, 2000];
  sim.plane.yaw = 0;
  sim.plane.pitch = 0;
  const aim = (sim as any).laserAim() as Vec3;
  expect(aim[2]).toBeCloseTo(2059);
  sim.explode([...f.p]);
  expect(f.health).toBe(2);
  (sim as any).damageMonsters([2000, 0, 2080], 10, 1, true);
  expect(f.health).toBe(1);
  sim.detonateNuke([...f.p], "local");
  expect(f.defeated).toBe(true);
  expect(
    sim.flies.intersect([2000, 1200, 2000], [2000, 1200, 2200]),
  ).toBeNull();
  sim.dispose();
});

it("lets a boosting jet escape a telegraphed lunge and subsequent pursuit", () => {
  const { flies, f } = setup();
  let jet: Vec3 = [1000, 100, 1080];
  let hits = 0;
  for (let tick = 0; tick < 1800; tick++) {
    const from: Vec3 = [...jet];
    jet = [jet[0], jet[1], jet[2] + 120 / 60];
    if (flies.step(1 / 60, from, jet, [0, 0, 120], false, clear)) hits++;
  }
  expect(hits).toBe(0);
  expect(Math.hypot(...f.p.map((v, i) => v - jet[i]))).toBeGreaterThan(900);
  expect(f.mode).toBe("roam");
});

it("finishes recovery with a valid nonnegative save timer", () => {
  const { flies, f } = setup();
  f.mode = "recovery";
  f.timer = 0.001;
  const jet: Vec3 = [1000, 100, 1300];
  flies.step(1 / 60, jet, jet, [0, 0, 0], false, clear);
  expect(f.mode).toBe("chase");
  expect(f.timer).toBe(0);
});
