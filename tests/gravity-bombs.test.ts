import { expect, it, vi } from "vitest";
import { CONFIG, GRAVITY_BOMB as G } from "../src/config";
import { GravityBombs, gravityVelocity } from "../src/sim/gravity-bombs";
import {
  WeaponDriver,
  type WeaponDriverContext,
} from "../src/sim/weapon-driver";
import type { GravityBombState, PlaneState, Vec3 } from "../src/types";
const plane = { p: [1000, 200, 1000], v: [60, 12, -40] } as PlaneState;
const field = (
  phase: GravityBombState["phase"] = "pulling",
): GravityBombState => ({ id: 1, p: [1000, 35, 1000], age: 4, phase });
it("inherits aircraft momentum, snapshots independent poses, and rejects a full pool", () => {
  const bombs = new GravityBombs(() => null);
  expect(bombs.drop(plane)).toBe(true);
  expect(bombs.bombs[0].p).toEqual([1000, 188, 1000]);
  expect(bombs.bombs[0].v).toEqual(plane.v);
  bombs.update(0.1);
  expect(bombs.bombs[0].p).toEqual([1006, 189.2, 996]);
  expect(bombs.bombs[0].v[1]).toBeCloseTo(12 - CONFIG.debrisGravity * 0.1);
  const snapshot = bombs.snapshot();
  snapshot[0].p[0] = -100;
  expect(bombs.bombs[0].p[0]).toBe(1006);
  for (let i = 1; i < G.maxActive; i++) bombs.drop(plane);
  expect(bombs.drop(plane)).toBe(false);
  expect(bombs.bombs.map((b) => b.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
});
it("anchors on first contact, pulls for four seconds, bursts exactly once, then fades", () => {
  const sweep = vi.fn(() => [1000, 10, 1000] as Vec3);
  const bombs = new GravityBombs(sweep);
  bombs.drop(plane);
  bombs.update(CONFIG.dt);
  expect(bombs.snapshot()[0]).toMatchObject({
    p: [1000, 45, 1000],
    age: 0,
    phase: "pulling",
  });
  let burstCount = 0;
  for (let i = 0; i < 240; i++) burstCount += bombs.update(1 / 60).length;
  expect(burstCount).toBe(1);
  expect(bombs.snapshot()[0].phase).toBe("bursting");
  expect(sweep).toHaveBeenCalledTimes(1);
  expect(bombs.update(0.7)).toEqual([]);
  expect(bombs.bombs).toHaveLength(1);
  bombs.update(0.05);
  expect(bombs.bombs).toHaveLength(0);
  bombs.drop(plane);
  expect(bombs.bombs[0].id).toBe(2);
  bombs.reset();
  expect(bombs.snapshot()).toEqual([]);
});
it("expires missed capsules and drops beyond the world boundary", () => {
  const bombs = new GravityBombs(() => null);
  bombs.drop({ ...plane, v: [0, 0, 0] });
  bombs.update(20);
  expect(bombs.bombs).toHaveLength(0);
  bombs.drop({
    ...plane,
    p: [CONFIG.worldSize - 1, 200, 1000],
    v: [100, 0, 0],
  });
  bombs.update(1);
  expect(bombs.bombs).toHaveLength(0);
});
it("consumes cooldown only for accepted drops and preserves rapid fire", () => {
  const bombs = new GravityBombs(() => null);
  const host = {
    weapon: "gravityBomb",
    input: { fire: true },
    cooldowns: { gravityBomb: 0 },
    shots: 0,
    destruction: { noCooldown: false },
    dropGravityBomb: (p: PlaneState) => bombs.drop(p),
  } as unknown as WeaponDriverContext;
  const driver = new WeaponDriver(host);
  driver.fire(plane, [0, 0, 1]);
  expect(host.cooldowns.gravityBomb).toBe(8);
  driver.fire(plane, [0, 0, 1]);
  expect(host.shots).toBe(1);
  host.destruction.noCooldown = true;
  for (let i = 1; i < 8; i++) {
    host.cooldowns.gravityBomb = 0;
    driver.fire(plane, [0, 0, 1]);
    expect(host.cooldowns.gravityBomb).toBe(0.1);
  }
  host.cooldowns.gravityBomb = 0;
  driver.fire(plane, [0, 0, 1]);
  expect(host.cooldowns.gravityBomb).toBe(0);
  expect(host.shots).toBe(8);
});
it("pulls inward and upward, releases outward, and combines fields before the speed cap", () => {
  const pull = gravityVelocity(
    [1080, 0, 1000],
    [0, 0, 0],
    [field()],
    [],
    1 / 60,
  )!;
  expect(pull[0]).toBeLessThan(0);
  expect(pull[1]).toBeGreaterThan(0);
  expect(pull[2]).not.toBe(0);
  const burst = gravityVelocity(
    [1080, 35, 1000],
    [-120, 0, 0],
    [],
    [field("bursting")],
    1 / 60,
  )!;
  expect(burst[0]).toBeGreaterThan(0);
  expect(burst[1]).toBeGreaterThan(0);
  expect(
    gravityVelocity(
      [1000, 0, 1000],
      [0, 0, 0],
      [],
      [field("bursting")],
      1 / 60,
    )![1],
  ).toBeGreaterThan(0);
  for (const p of [
    [1000, 35, 1000],
    [1000.001, 35, 1000],
    [1100, 35, 1000],
  ] as Vec3[]) {
    const v = gravityVelocity(
      p,
      [120, -120, 120],
      Array(8).fill(field()),
      Array(8).fill(field("bursting")),
      1 / 60,
    )!;
    expect(v.every(Number.isFinite)).toBe(true);
    expect(Math.hypot(...v)).toBeLessThanOrEqual(120.000001);
  }
  expect(
    gravityVelocity([1300, 0, 1000], [1, 2, 3], [field()], [], 1),
  ).toBeNull();
  const early = { ...field(), age: 0 };
  expect(
    gravityVelocity([1080, 35, 1000], [0, 0, 0], [early], [], 1),
  ).toBeNull();
});
