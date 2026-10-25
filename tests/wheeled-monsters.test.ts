import { expect, it } from "vitest";
import * as THREE from "three";
import { Monsters } from "../src/sim/monsters";
import { Terrain } from "../src/sim/terrain";
import type { Vec3, WorldData } from "../src/types";
import { MonsterWheelView } from "../src/render/monster-wheels";
import { WheelSpray } from "../src/render/wheel-spray";

const world = {
  size: 9216,
  seed: 42,
  castle: [4608, 10, 4608],
  sites: [],
  spawn: [100, 350, 100],
  castleBounds: { min: [0, 0], max: [0, 0] },
} as unknown as WorldData;
function setup(width = 200, wet = true) {
  const river = (x: number) => x >= 1100 && x <= 1100 + width;
  const terrain = {
    sample: (x: number) => (river(x) ? -30 : 10),
    water: (x: number) => x >= 2000 || (wet && river(x)),
    riverSurface: (x: number) => (wet && river(x) ? 10 : undefined),
  } as unknown as Terrain;
  const monsters = new Monsters(world, terrain);
  monsters.setCount(1);
  monsters.states[0].p = [1024, 10, 1024];
  monsters.states[0].yaw = Math.PI / 2;
  return { monsters, terrain };
}
it.each([20, 200])(
  "crosses a %i m river at full speed on its surface",
  (width) => {
    const { monsters } = setup(width);
    monsters.enraged = true;
    for (let i = 0; i < 420; i++) {
      monsters.step(1 / 60, [1800, 500, 1024], false, () => false);
      expect(monsters.states[0].p[1]).toBe(10);
    }
    expect(monsters.states[0].p[0]).toBeCloseTo(1444, 1);
    expect(monsters.states[0].health).toBe(5);
  },
);
it("keeps calm monsters away from rivers, rejects ocean, and applies dry-channel slopes", () => {
  const { monsters } = setup();
  expect((monsters as any).walkable(1080, 1024, false)).toBe(false);
  expect((monsters as any).walkable(1200, 1024, true)).toBe(true);
  expect((monsters as any).walkable(2010, 1024, true)).toBe(false);
  const dry = setup(200, false).monsters as any;
  expect(dry.ground(1200, 1024, true)).toBe(-30);
  expect(dry.walkable(1100, 1024, true)).toBe(false);
});
it("restores an enraged save over a river without moving it to land", () => {
  const { monsters, terrain } = setup();
  monsters.states[0].p = [1200, -30, 1024];
  const restored = new Monsters(
    world,
    terrain,
    monsters.states,
    undefined,
    true,
  );
  expect(restored.states[0].p).toEqual([1200, 10, 1024]);
});
it("honors active river cells and laser drying in the terrain surface helper", () => {
  const terrain = {
    rivers: {
      index: () => 0,
      cells: new Map([[0, 10]]),
      riverCells: new Map([[0, 10]]),
      lakeCells: new Set<number>(),
    },
    laserDry: new Uint8Array(1),
    sample: () => -30,
  };
  expect(
    Terrain.prototype.riverSurface.call(terrain as unknown as Terrain, 0, 0),
  ).toBe(10);
  terrain.laserDry[0] = 1;
  expect(
    Terrain.prototype.riverSurface.call(terrain as unknown as Terrain, 0, 0),
  ).toBeUndefined();
  terrain.laserDry[0] = 0;
  expect(
    Terrain.prototype.riverSurface.call(
      terrain as unknown as Terrain,
      0,
      0,
      11,
    ),
  ).toBeUndefined();
});
it("checks movement segments of at most 4 m and cannot cross a thin blocking wall", () => {
  const { monsters } = setup();
  monsters.enraged = true;
  const segments: number[] = [];
  const wall = (a: Vec3, b: Vec3) => {
    segments.push(Math.hypot(b[0] - a[0], b[2] - a[2]));
    return Math.min(a[0], b[0]) <= 1040 && Math.max(a[0], b[0]) >= 1040;
  };
  (monsters as any).drive(monsters.states[0], Math.PI / 2, 60, wall);
  expect(Math.max(...segments)).toBeLessThanOrEqual(4.00001);
  expect(monsters.states[0].p[0]).toBeLessThan(1040);
});
it("bounds horde stuck refreshes and resumes after an obstacle is removed", () => {
  const { monsters } = setup();
  monsters.setCount(400);
  monsters.enraged = true;
  for (let i = 0; i < 250; i++)
    monsters.step(1 / 60, [1800, 500, 1024], false, () => true);
  expect(monsters.navigationRevision).toBeGreaterThan(0);
  expect(monsters.navigationRevision).toBeLessThanOrEqual(3);
  expect((monsters as any).stuck.get(0).recovering).toBe(true);
  const before = [...monsters.states[0].p];
  for (let i = 0; i < 60; i++)
    monsters.step(1 / 60, [1800, 500, 1024], false, () => false);
  expect(monsters.states[0].p[0]).toBeGreaterThan(before[0]);
});
it("turns at 3 rad/s and stays still during attack windups", () => {
  const { monsters } = setup();
  monsters.enraged = true;
  monsters.states[0].yaw = 0;
  monsters.step(0.1, [1500, 100, 1024], false, () => false);
  expect(monsters.states[0].yaw).toBeCloseTo(0.3);
  const before = [...monsters.states[0].p];
  monsters.states[0].windup = 0.75;
  monsters.step(0.1, [1500, 100, 1024], false, () => false);
  expect(monsters.states[0].p).toEqual(before);
});
it("renders 400 pairs in two batches, maintains tire contact, and clears hidden wheels", () => {
  const view = new MonsterWheelView(400);
  const root = new THREE.Object3D();
  root.scale.setScalar(2);
  view.begin();
  for (let i = 0; i < 400; i++) view.add(root, 1, 0);
  view.finish();
  expect(view.parts.map((p) => p.count)).toEqual([800, 800]);
  view.parts[0].geometry.computeBoundingBox();
  const matrix = new THREE.Matrix4();
  view.parts[0].getMatrixAt(0, matrix);
  const bounds = view.parts[0].geometry
    .boundingBox!.clone()
    .applyMatrix4(matrix);
  expect(bounds.min.y).toBeCloseTo(0, 4);
  expect(bounds.max.y).toBeCloseTo(24, 4);
  view.begin();
  view.add(root, 0, 0);
  view.finish();
  expect(view.parts.every((p) => p.count === 0)).toBe(true);
});
it("caps spray at 256 particles and clears it on reset", () => {
  const spray = new WheelSpray();
  for (let i = 0; i < 400; i++) spray.emit([100, 10, 100], 0);
  spray.update(0.1);
  expect(spray.mesh.geometry.attributes.position.count).toBe(256);
  expect(spray.mesh.visible).toBe(true);
  spray.update(1);
  expect(spray.mesh.visible).toBe(false);
  spray.emit([100, 10, 100], 0);
  spray.reset();
  expect(spray.mesh.visible).toBe(false);
});
