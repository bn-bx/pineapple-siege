import { expect, it } from "vitest";
import { MonsterCrowd, MONSTER_CLEARANCE } from "../src/sim/monster-crowd";
import { Monsters } from "../src/sim/monsters";
import type { MonsterState, Vec3, WorldData } from "../src/types";
import type { Terrain } from "../src/sim/terrain";
const state = (id: number, x: number, z: number): MonsterState => ({
  id,
  p: [x, 10, z],
  yaw: 0,
  phase: 0,
  health: 5,
  defeated: false,
  windup: 0,
  stagger: 0,
});
const world = {
  size: 9216,
  seed: 42,
  castle: [4608, 10, 4608],
  castleBounds: { min: [0, 0], max: [0, 0] },
  sites: [],
  spawn: [100, 350, 100],
} as unknown as WorldData;
const terrain = { sample: () => 10, water: () => false } as unknown as Terrain;
function simulation(positions: Vec3[]) {
  const sim = new Monsters(world, terrain);
  sim.setCount(positions.length);
  sim.enraged = true;
  positions.forEach((p, i) => {
    sim.states[i].p = [...p];
    sim.states[i].yaw = 0;
  });
  return sim;
}
function nearest(states: MonsterState[]) {
  let min = Infinity;
  for (let i = 0; i < states.length; i++)
    for (let j = i + 1; j < states.length; j++)
      min = Math.min(
        min,
        Math.hypot(
          states[i].p[0] - states[j].p[0],
          states[i].p[2] - states[j].p[2],
        ),
      );
  return min;
}
it("reserves movement immediately and checks swept body clearance", () => {
  const crowd = new MonsterCrowd();
  const a = state(0, 1000, 1000),
    b = state(1, 1000, 1054);
  crowd.rebuild([a, b]);
  expect(crowd.permits(a, [1000, 10, 1006])).toBe(false);
  expect(crowd.permits(a, [1000, 10, 1004])).toBe(true);
  a.p = [1000, 10, 1004];
  crowd.update(a);
  expect(crowd.permits(b, [1000, 10, 1050])).toBe(false);
  expect(crowd.permits(b, [1004, 10, 1054])).toBe(true);
});
it("unwinds legacy overlaps but refuses movement that increases their total penetration", () => {
  const crowd = new MonsterCrowd(),
    a = state(0, 1000, 1000),
    b = state(1, 1000, 1000);
  crowd.rebuild([a, b]);
  expect(crowd.permits(a, [1004, 10, 1000])).toBe(true);
  a.p = [1004, 10, 1000];
  crowd.update(a);
  expect(crowd.permits(a, [1002, 10, 1000])).toBe(false);
  expect(crowd.permits(a, [1008, 10, 1000])).toBe(true);
});
it("keeps distinct nearby attack positions without changing the player position", () => {
  const crowd = new MonsterCrowd(),
    monsters = Array.from({ length: 400 }, (_, i) => state(i, 1000, 1000));
  crowd.rebuild(monsters);
  const player: Vec3 = [4608, 500, 4608];
  const slots = monsters.map((m) => crowd.approach(m, player));
  expect(
    nearest(slots.map((p, i) => ({ ...monsters[i], p }))),
  ).toBeGreaterThanOrEqual(64);
  expect(
    Math.max(
      ...slots.map((p) => Math.hypot(p[0] - player[0], p[2] - player[2])),
    ),
  ).toBeLessThan(750);
  expect(player).toEqual([4608, 500, 4608]);
});
it("slows followers, keeps isolated driving at full speed, and ignores distant cells", () => {
  const crowd = new MonsterCrowd(),
    a = state(0, 1000, 1000),
    b = state(1, 1000, 1060);
  crowd.rebuild([a, b]);
  expect(crowd.steer(a, [1000, 10, 1500]).speed).toBeLessThan(1);
  b.p = [8000, 10, 8000];
  crowd.update(b);
  expect(crowd.steer(a, [1000, 10, 1500]).speed).toBe(1);
});
it("two opposing drivers pass without intersecting or triggering terrain recovery", () => {
  const sim = simulation([
    [1000, 10, 1000],
    [1000, 10, 1130],
  ]);
  // Explicit opposing targets exercise live reservations independently of the global player goal.
  const crowd = (sim as any).crowd as MonsterCrowd;
  for (let i = 0; i < 180; i++) {
    crowd.rebuild(sim.states.slice(0, 2));
    for (const [m, target] of [
      [sim.states[0], [1000, 10, 1300]],
      [sim.states[1], [1000, 10, 800]],
    ] as [MonsterState, Vec3][]) {
      const steering = crowd.steer(m, target);
      const angle = steering.angle;
      (sim as any).drive(m, angle, steering.speed, () => false);
    }
    expect(nearest(sim.states.slice(0, 2))).toBeGreaterThanOrEqual(
      MONSTER_CLEARANCE - 0.001,
    );
  }
  expect(sim.states[0].p[2]).toBeGreaterThan(sim.states[1].p[2]);
  expect(sim.states[0].p[2]).toBeGreaterThan(1050);
  expect(sim.states[1].p[2]).toBeLessThan(1080);
});
it("an existing pile spreads gradually while respecting river banks and obstacles", () => {
  const positions = Array.from({ length: 20 }, () => [1500, 10, 1500] as Vec3);
  const sim = simulation(positions);
  const obstacle = (_a: Vec3, b: Vec3) => b[0] < 1450;
  for (let i = 0; i < 900; i++) {
    const before = sim.states.slice(0, 20).map((m) => [...m.p]);
    sim.step(1 / 60, [1600, 500, 1700], false, obstacle);
    for (let j = 0; j < 20; j++) {
      expect(
        Math.hypot(
          sim.states[j].p[0] - before[j][0],
          sim.states[j].p[2] - before[j][2],
        ),
      ).toBeLessThanOrEqual(2.001);
      expect(sim.states[j].p[0]).toBeGreaterThanOrEqual(1450);
    }
  }
  expect(nearest(sim.states.slice(0, 20))).toBeGreaterThanOrEqual(
    MONSTER_CLEARANCE - 0.001,
  );
  expect(sim.navigationRevision).toBeLessThan(8);
});
it("keeps a 400-monster horde separated with bounded step cost", () => {
  const positions = Array.from(
    { length: 400 },
    (_, i) =>
      [2500 + (i % 20) * 64, 10, 2500 + Math.floor(i / 20) * 64] as Vec3,
  );
  const sim = simulation(positions);
  let worst = 0;
  for (let i = 0; i < 240; i++) {
    const at = performance.now();
    sim.step(1 / 60, [3100, 500, 3100], false, () => false);
    worst = Math.max(worst, performance.now() - at);
  }
  expect(nearest(sim.states.slice(0, 400))).toBeGreaterThanOrEqual(
    MONSTER_CLEARANCE - 0.001,
  );
  expect(worst).toBeLessThan(100);
});

it("queues behind a stationary monster in a narrow passage without rebuilding terrain routes", () => {
  const sim = simulation([
    [1500, 10, 1000],
    [1500, 10, 1050],
  ]);
  sim.states[1].stagger = 10;
  const obstacle = (_a: Vec3, b: Vec3) => Math.abs(b[0] - 1500) > 8;
  for (let i = 0; i < 180; i++) {
    sim.step(1 / 60, [1500, 500, 3000], false, obstacle);
    expect(nearest(sim.states.slice(0, 2))).toBeGreaterThanOrEqual(
      MONSTER_CLEARANCE - 0.001,
    );
  }
  expect(sim.states[0].p[2]).toBeLessThan(1001);
  expect(sim.navigationRevision).toBe(0);
});

it("spreads a legacy overlap even at a route endpoint on a disconnected shore", () => {
  const sim = simulation([
    [1500, 10, 1500],
    [1500, 10, 1500],
  ]);
  (sim as any).navigation = { advance() {}, target: (p: Vec3) => [...p] };
  (sim as any).terrain = { sample: () => 10, water: (x: number) => x > 1700 };
  for (let i = 0; i < 600; i++)
    sim.step(1 / 60, [2000, 500, 1500], false, () => false);
  expect(nearest(sim.states.slice(0, 2))).toBeGreaterThanOrEqual(
    MONSTER_CLEARANCE - 0.001,
  );
  expect(sim.states.slice(0, 2).every((m) => m.p[0] <= 1664)).toBe(true);
});
