import { expect, it } from "vitest";
import { PursuitField } from "../src/sim/pursuit-field";
import { Monsters } from "../src/sim/monsters";
import type { Terrain } from "../src/sim/terrain";
import type { Vec3, WorldData } from "../src/types";
import { MONSTER_BODY_HEIGHT } from "../src/sim/monsters";
function finish(field: PursuitField, goal: Vec3, time = 0, revision = 0) {
  for (let i = 0; i < 200; i++) field.advance(goal, time, revision, 20);
}
it("routes around walls without corner cutting and retargets a moving player", () => {
  const valid = (x: number, z: number) =>
    x >= 64 && x <= 960 && z >= 64 && z <= 960 && !(x === 512 && z < 768);
  const field = new PursuitField(
    1024,
    valid,
    () => 10,
    (a, b) => valid((a[0] + b[0]) / 2, (a[2] + b[2]) / 2),
  );
  finish(field, [896, 200, 128]);
  let p: Vec3 = [128, 10, 128];
  const seen: Vec3[] = [];
  for (let i = 0; i < 100; i++) {
    const n = field.target(p)!;
    expect(valid(n[0], n[2])).toBe(true);
    seen.push(n);
    if (n[0] === p[0] && n[2] === p[2]) break;
    p = n;
  }
  expect(p).toEqual([896, 10, 128]);
  expect(seen.some((p) => p[2] >= 768)).toBe(true);
  finish(field, [128, 200, 896], 2);
  for (let i = 0; i < 100; i++) {
    const n = field.target(p)!;
    if (n[0] === p[0] && n[2] === p[2]) break;
    p = n;
  }
  expect(p).toEqual([128, 10, 896]);
});
it("chooses the closest reachable shore on each disconnected component and rebuilds after destruction", () => {
  let opening = false;
  const valid = (x: number, z: number) =>
    x >= 64 && x <= 960 && z >= 64 && z <= 960 && (opening || x !== 512);
  const field = new PursuitField(
    1024,
    valid,
    () => 10,
    (a, b) => valid((a[0] + b[0]) / 2, (a[2] + b[2]) / 2),
  );
  finish(field, [896, 1000, 512]);
  let p: Vec3 = [128, 10, 512];
  for (let i = 0; i < 50; i++) {
    const n = field.target(p)!;
    if (n[0] === p[0] && n[2] === p[2]) break;
    p = n;
  }
  expect(p[0]).toBe(448);
  opening = true;
  finish(field, [896, 1000, 512], 2, 1);
  for (let i = 0; i < 50; i++) {
    const n = field.target(p)!;
    if (n[0] === p[0] && n[2] === p[2]) break;
    p = n;
  }
  expect(p[0]).toBe(896);
});
it("processes large fields incrementally rather than finishing all navigation in one step", () => {
  let probes = 0;
  const field = new PursuitField(
    9216,
    () => {
      probes++;
      return true;
    },
    () => 10,
    () => true,
  );
  field.advance([8000, 1000, 8000], 0, 0, 0.2);
  expect(probes).toBeLessThan(field.side ** 2);
  expect(field.target([128, 10, 128])).toBeUndefined();
  finish(field, [8000, 1000, 8000]);
  expect(field.target([128, 10, 128])).toBeDefined();
});
const terrain = { sample: () => 10, water: () => false } as unknown as Terrain;
const world = {
  size: 9216,
  seed: 42,
  castle: [4608, 10, 4608],
  sites: [],
  spawn: [100, 350, 100],
  castleBounds: { min: [0, 0], max: [0, 0] },
} as unknown as WorldData;
function monster() {
  const m = new Monsters(world, terrain);
  m.setCount(1);
  m.states[0].p = [1024, 10, 1024];
  m.states[0].yaw = Math.PI / 2;
  return m;
}
it("pursues beyond normal detection at 60 m/s, follows new targets, and keeps rage through crashes and laser dancing", () => {
  const m = monster();
  m.enraged = true;
  for (let i = 0; i < 60; i++)
    m.step(1 / 60, [3000, 500, 1024], false, () => false);
  expect(m.states[0].p[0] - 1024).toBeCloseTo(60, 1);
  const before = [...m.states[0].p];
  m.step(1 / 60, [3000, 500, 1024], false, () => false, true);
  expect(m.states[0].p).toEqual(before);
  expect(m.enraged).toBe(true);
  for (let i = 0; i < 180; i++)
    m.step(1 / 60, [1024, 500, 3000], true, () => false);
  expect(m.states[0].p[2]).toBeGreaterThan(1024);
  expect(m.enraged).toBe(true);
  expect(m.spikes).toHaveLength(0);
});
it("extends attacks to 750 m with 1.68 s cooldowns while retaining health, windup, damage, and high-altitude escape", () => {
  const m = monster();
  m.enraged = true;
  for (let i = 0; i < 140; i++)
    m.step(1 / 60, [1724, 100, 1024], false, () => false);
  expect(m.spikes.length).toBeGreaterThan(0);
  expect(m.states[0].health).toBe(5);
  expect((m as any).cooldowns[0]).toBeLessThanOrEqual(1.68);
  const high = monster();
  high.enraged = true;
  for (let i = 0; i < 180; i++)
    high.step(1 / 60, [1724, 10 + 351, 1024], false, () => false);
  expect(high.spikes).toHaveLength(0);
  const calm = monster();
  for (let i = 0; i < 180; i++)
    calm.step(1 / 60, [1724, 100, 1024], false, () => false);
  expect(calm.spikes).toHaveLength(0);
});
it("keeps movement blocked by real obstacles while allowing pursuit through formerly excluded settlements", () => {
  const m = monster();
  m.enraged = true;
  const p = [...m.states[0].p];
  for (let i = 0; i < 60; i++)
    m.step(1 / 60, [3000, 500, 1024], false, () => true);
  expect(m.states[0].p).toEqual(p);
});
it("allows enraged monsters to approach within the old settlement exclusion radius", () => {
  const town = {
    ...world,
    sites: [{ kind: "hamlet", p: [1024, 10, 1024], radius: 200 }],
  } as unknown as WorldData;
  const m = new Monsters(town, terrain);
  m.setCount(1);
  m.states[0].p = [1024, 10, 1024];
  m.states[0].yaw = Math.PI / 2;
  m.enraged = true;
  for (let i = 0; i < 60; i++)
    m.step(1 / 60, [3000, 500, 1024], false, () => false);
  expect(m.states[0].p[0]).toBeGreaterThan(1040);
});
it.each([120, 400])(
  "bounds routing work and moves a %i-monster horde without teleporting",
  (count) => {
    const m = new Monsters(world, terrain);
    m.setCount(count);
    m.enraged = true;
    const old = m.states.map((s) => [...s.p]);
    let worst = 0;
    for (let i = 0; i < 90; i++) {
      const start = performance.now();
      m.step(1 / 60, [4608, 1000, 4608], false, () => false);
      worst = Math.max(worst, performance.now() - start);
    }
    for (let i = 0; i < count; i++)
      expect(
        Math.hypot(m.states[i].p[0] - old[i][0], m.states[i].p[2] - old[i][2]),
      ).toBeLessThanOrEqual(91);
    expect(worst).toBeLessThan(100);
  },
);
it("restores a pursuing crowd inside a settlement without relocating its saved members", () => {
  const town = {
    ...world,
    sites: [{ kind: "hamlet", p: [1024, 10, 1024], radius: 200 }],
  } as unknown as WorldData;
  const original = new Monsters(town, terrain);
  original.states[0].p = [1024, 10, 1024];
  original.states[1].p = [1025, 10, 1024];
  const restored = new Monsters(
    town,
    terrain,
    original.states,
    undefined,
    true,
  );
  expect(restored.states[0].p).toEqual([1024, 10, 1024]);
  expect(restored.states[1].p).toEqual([1025, 10, 1024]);
  expect(restored.enraged).toBe(true);
});
