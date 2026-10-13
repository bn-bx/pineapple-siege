import RAPIER from "@dimforge/rapier3d-compat";
import { beforeAll, expect, it, vi } from "vitest";
import { CONFIG } from "../src/config";
import { SteelBalls, sweptSphereTouches } from "../src/sim/steel-balls";
import {
  WeaponDriver,
  type WeaponDriverContext,
} from "../src/sim/weapon-driver";
import type { PlaneState } from "../src/types";
import type { Terrain } from "../src/sim/terrain";

beforeAll(() => RAPIER.init());
const plane = (p = [1000, 200, 1000], v = [60, 0, 0]) =>
  ({ p, v }) as PlaneState;
function setup(slope = 0, water?: number) {
  const physics = new RAPIER.World({ x: 0, y: -CONFIG.debrisGravity, z: 0 });
  physics.timestep = CONFIG.dt;
  const heights = new Float32Array([
    500 * slope,
    500 * slope,
    -500 * slope,
    -500 * slope,
  ]);
  physics.createCollider(
    RAPIER.ColliderDesc.heightfield(1, 1, heights, { x: 1000, y: 1, z: 1000 })
      .setTranslation(1000, 0, 1000)
      .setFriction(0.85)
      .setCollisionGroups(0x00010007),
  );
  const terrain = {
    sample: (x: number) => (1000 - x) * slope,
    surfaceHeight: () => water,
  } as unknown as Terrain;
  const crush = vi.fn(() => 0),
    impact = vi.fn();
  const balls = new SteelBalls(physics, terrain, crush, impact);
  const step = (n = 1) => {
    for (let i = 0; i < n; i++) {
      balls.beforeStep(CONFIG.dt);
      physics.step();
      balls.afterStep(CONFIG.dt);
    }
  };
  return { physics, balls, crush, impact, step };
}
it("inherits all velocity components and clears the plane", () => {
  const s = setup();
  expect(s.balls.drop(plane([1000, 200, 1000], [90, 12, -40]))).toBe(true);
  expect(s.balls.snapshot()[0].p).toEqual([1000, 134, 1000]);
  expect(s.balls.balls[0].body.linvel()).toEqual({ x: 90, y: 12, z: -40 });
  for (let i = 0; i < 7; i++) s.balls.drop(plane());
  expect(s.balls.drop(plane())).toBe(true);
  expect(s.balls.balls).toHaveLength(9);
  s.balls.reset();
  expect(s.balls.snapshot()).toEqual([]);
  expect(s.physics.bodies.len()).toBe(0);
  s.physics.free();
});
it("uses independent five-second cooldown and replaces the oldest ball during rapid drops", () => {
  const s = setup();
  const host = {
    weapon: "steelBall",
    input: { fire: true },
    cooldowns: { cannon: 0, nuke: 0, laser: 0, steelBall: 0 },
    destruction: { noCooldown: false },
    shots: 0,
    dropSteelBall: (p: PlaneState) => s.balls.drop(p),
  } as unknown as WeaponDriverContext;
  const driver = new WeaponDriver(host);
  driver.fire(plane(), [0, 0, 1]);
  expect(host.cooldowns.steelBall).toBe(5);
  driver.fire(plane(), [0, 0, 1]);
  expect(s.balls.balls).toHaveLength(1);
  host.destruction.noCooldown = true;
  for (let i = 0; i < 24; i++) {
    host.cooldowns.steelBall = 0;
    driver.fire(plane(), [0, 0, 1]);
  }
  expect(s.balls.balls).toHaveLength(20);
  expect(s.balls.snapshot().map((b) => b.id)).toEqual(
    Array.from({ length: 20 }, (_, i) => i + 6),
  );
  expect(s.physics.bodies.len()).toBe(20);
  expect(s.physics.colliders.len()).toBe(21);
  expect(host.shots).toBe(25);
  s.physics.free();
});
it("sweeps thin targets at speed without crushing objects beyond the round footprint", () => {
  expect(
    sweptSphereTouches([0, 10, 0], [100, 10, 0], [50, 10, 0], [0.1, 1, 1], 10),
  ).toBe(true);
  expect(
    sweptSphereTouches([0, 10, 0], [100, 10, 0], [50, 10, 12], [1, 1, 1], 10),
  ).toBe(false);
  expect(
    sweptSphereTouches([0, 0, 0], [0, 0, 0], [9, 9, 0], [1, 1, 1], 10),
  ).toBe(false);
  expect(
    sweptSphereTouches([0, 0, 0], [0, 0, 0], [11, 0, 0], [1, 1, 1], 10),
  ).toBe(true);
});
it("lands with a restrained rebound, rolls with visible rotation, and settles then fades", () => {
  const s = setup();
  s.balls.drop(plane([700, 140, 1000], [30, 0, 0]));
  let rebound = 0,
    landed = false;
  for (let i = 0; i < 600; i++) {
    s.step();
    const b = s.balls.balls[0];
    if (!b) break;
    const p = b.body.translation(),
      v = b.body.linvel();
    expect(p.y).toBeGreaterThan(59.5);
    if (p.y < 61) landed = true;
    if (landed) rebound = Math.max(rebound, v.y);
  }
  expect(landed).toBe(true);
  expect(rebound).toBeLessThan(12);
  expect(s.balls.snapshot()[0].p[0]).toBeGreaterThan(730);
  expect(s.balls.balls[0].body.linvel().x).toBeGreaterThan(15);
  expect(Math.abs(s.balls.snapshot()[0].q[2])).toBeGreaterThan(0.01);
  s.step(4800);
  expect(s.balls.balls).toHaveLength(0);
  expect(s.impact).toHaveBeenCalled();
  s.physics.free();
});
it("accelerates downhill while retaining forward momentum", () => {
  const s = setup(0.4);
  s.balls.drop(plane([1000, 134, 1000], [15, 0, 0]));
  s.step(360);
  const b = s.balls.balls[0];
  expect(b.body.linvel().x).toBeGreaterThan(15);
  expect(b.body.translation().x).toBeGreaterThan(1000);
  s.physics.free();
});
it("loses bounded momentum while crushing and cleans up water, expiry and out-of-bounds balls", () => {
  const s = setup();
  s.crush.mockReturnValue(100);
  s.balls.drop(plane([1000, 300, 1000], [100, 0, 0]));
  s.balls.beforeStep(CONFIG.dt);
  expect(s.balls.balls[0].body.linvel().x).toBeCloseTo(99.5);
  s.balls.balls[0].body.setTranslation({ x: -1, y: 100, z: 1000 }, true);
  s.balls.afterStep(CONFIG.dt);
  expect(s.balls.balls).toHaveLength(0);
  s.balls.drop(plane());
  s.balls.balls[0].age = 120;
  s.balls.afterStep(CONFIG.dt);
  expect(s.balls.snapshot()[0].fade).toBeGreaterThan(0);
  s.balls.afterStep(1);
  expect(s.balls.balls).toHaveLength(0);
  s.physics.free();
  const wet = setup(0, 200);
  wet.balls.drop(plane([1000, 140, 1000], [0, 0, 0]));
  wet.step();
  expect(wet.balls.snapshot()[0].fade).toBeGreaterThan(0);
  wet.step(61);
  expect(wet.balls.balls).toHaveLength(0);
  wet.physics.free();
});
it("fades while still rolling below 10 m/s and resets the timer on speed recovery or flight", () => {
  const s = setup();
  s.balls.drop(plane([1000, 126, 1000], [1, 0, 0]));
  s.step(30);
  const ball = s.balls.balls[0];
  expect(ball.rest).toBeGreaterThan(0);
  expect(ball.fade).toBe(0);
  ball.body.setLinvel({ x: 15, y: 0, z: 0 }, true);
  s.step();
  expect(ball.rest).toBe(0);
  ball.body.setTranslation({ x: 1000, y: 160, z: 1000 }, true);
  ball.body.setLinvel({ x: 1, y: 0, z: 0 }, true);
  s.step(30);
  expect(ball.rest).toBe(0);
  expect(ball.fade).toBe(0);
  ball.body.setTranslation({ x: 1000, y: 60, z: 1000 }, true);
  ball.body.setLinvel({ x: 1, y: 0, z: 0 }, true);
  s.step(70);
  expect(ball.fade).toBeGreaterThan(0);
  expect(ball.body.linvel().x).toBeGreaterThan(0);
  s.step(65);
  expect(s.balls.balls).toHaveLength(0);
  s.physics.free();
});
it("only requests terrain damage on real heightfield contacts, then sweeps grounded movement", () => {
  const s = setup();
  const damage = vi.fn();
  const balls = new SteelBalls(
    s.physics,
    { sample: () => 0, surfaceHeight: () => undefined } as unknown as Terrain,
    () => 0,
    () => {},
    damage,
  );
  balls.drop(plane([1000, 210, 1000], [20, 0, 0]));
  const step = () => {
    balls.beforeStep(CONFIG.dt);
    s.physics.step();
    balls.afterStep(CONFIG.dt);
  };
  for (let i = 0; i < 20; i++) step();
  expect(damage).not.toHaveBeenCalled();
  for (let i = 0; i < 240; i++) step();
  expect(damage.mock.calls.some((c) => c[2] === true)).toBe(true);
  expect(
    damage.mock.calls.some((c) => c[2] === false && c[0][0] !== c[1][0]),
  ).toBe(true);
  s.physics.free();
});

it("preserves slow-removal progress through short contact gaps but resets on sustained flight", () => {
  const s = setup();
  s.balls.drop(plane([1000, 126, 1000], [6, 0, 0]));
  s.step(30);
  const ball = s.balls.balls[0];
  const progress = ball.rest;
  expect(progress).toBeGreaterThan(0);
  ball.body.setTranslation({ x: 1000, y: 160, z: 1000 }, true);
  ball.body.setLinvel({ x: 6, y: 0, z: 0 }, true);
  s.step(10);
  expect(ball.rest).toBeCloseTo(progress);
  expect(ball.fade).toBe(0);
  s.step(15);
  expect(ball.rest).toBe(0);
  s.physics.free();
});
it("retains momentum through dense structures and keeps the loss bounded across both sweeps", () => {
  const s = setup();
  s.crush.mockReturnValue(20);
  s.balls.drop(plane([1000, 300, 1000], [100, 0, 0]));
  s.balls.beforeStep(CONFIG.dt);
  expect(s.balls.balls[0].body.linvel().x).toBeCloseTo(99.8);
  s.balls.afterStep(CONFIG.dt);
  expect(s.balls.balls[0].body.linvel().x).toBeCloseTo(99.6);
  s.crush.mockReturnValue(1000);
  s.balls.beforeStep(CONFIG.dt);
  const afterFirst = s.balls.balls[0].body.linvel().x;
  s.balls.afterStep(CONFIG.dt);
  expect(s.balls.balls[0].body.linvel().x).toBeCloseTo(afterFirst);
  s.physics.free();
});
