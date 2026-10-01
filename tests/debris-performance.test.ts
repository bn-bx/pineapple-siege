import { beforeAll, expect, it } from "vitest";
import * as THREE from "three";
import { readFileSync } from "node:fs";
import { packBodies, unpackBodies } from "../src/sim/body-buffer";
import { Terrain } from "../src/sim/terrain";
import { Simulation, initializePhysics } from "../src/sim/simulation";
import { Fragments } from "../src/render/fragments";
import {
  DEFAULT_DESTRUCTION,
  MAX_BODY_LIMIT,
  COSMETIC_LIMITS,
} from "../src/destruction-settings";
import type {
  BodyView,
  Material,
  WorldData,
  FragmentEffect,
} from "../src/types";

beforeAll(initializePhysics);
const world: WorldData = JSON.parse(readFileSync("public/world.json", "utf8"));
const bytes = readFileSync("public/world.bin");
const base = new Float32Array(
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
);
const burst = (x = 0): FragmentEffect => ({
  type: "fragments",
  p: [x, 100, 0],
  origin: [x, 0, 0],
  material: "sandstone",
  count: 1,
  speed: 120,
  spread: 0,
  seed: 1,
});
function dispose(f: Fragments) {
  f.mesh.dispose();
  f.mesh.geometry.dispose();
  (f.mesh.material as THREE.Material).dispose();
}

it("transfers every debris material and kind while retaining integer identities and negative sources", () => {
  const materials: Material[] = [
    "stone",
    "wood",
    "foliage",
    "earth",
    "rock",
    "plaster",
    "roof",
    "sandstone",
    "slate",
    "window",
  ];
  const bodies: BodyView[] = materials.map((material, i) => ({
    id: 16777217 + i,
    source: i ? i : -1,
    material,
    kind: (["chunk", "tree", "rock"] as const)[i % 3],
    p: [1024.12345, -500.1, 2047.9],
    q: [0, Math.SQRT1_2, 0, Math.SQRT1_2],
    s: [0.1, 10, 50],
  }));
  const packed = packBodies(bodies, bodies.length);
  expect(packed.buffer.byteLength).toBe(bodies.length * 50);
  const sent = structuredClone(packed, { transfer: [packed.buffer] });
  expect(packed.buffer.byteLength).toBe(0);
  const restored = unpackBodies(sent);
  for (let i = 0; i < bodies.length; i++) {
    expect(restored[i]).toMatchObject({
      id: bodies[i].id,
      source: bodies[i].source,
      material: bodies[i].material,
      kind: bodies[i].kind,
    });
    for (const key of ["p", "q", "s"] as const)
      for (let j = 0; j < bodies[i][key].length; j++)
        expect(restored[i][key][j]).toBeCloseTo(bodies[i][key][j], 3);
  }
  expect(unpackBodies(packBodies([], 0))).toEqual([]);
});

it("makes detached snapshots without changing live physics or save records", () => {
  const sim = new Simulation({ ...world, entities: [] }, base, () => {});
  try {
    (sim as any).spawnBody(
      [600, 300, 600],
      [1, 1, 1],
      "slate",
      -1,
      "chunk",
      [20, 30, 0],
    );
    const ordinary = sim.snapshot();
    const packet = sim.snapshot(true);
    expect(packet.bodies).toEqual([]);
    const sent = structuredClone(packet, {
      transfer: [packet.packedBodies!.buffer],
    });
    const bodies = unpackBodies(sent.packedBodies!);
    expect(bodies).toEqual(ordinary.bodies);
    sim.step();
    expect(bodies[0].p).toEqual([600, 300, 600]);
    expect(sim.snapshot().bodies[0].p).not.toEqual(bodies[0].p);
    expect(sim.save().ruins[0].material).toBe("slate");
  } finally {
    sim.dispose();
  }
});

it("keeps 8192 independent physical castle pieces and evicts only the oldest at capacity", () => {
  const sim = new Simulation({ ...world, entities: [] }, base, () => {});
  try {
    sim.setDestruction({ ...DEFAULT_DESTRUCTION, bodies: 4, rubble: 4 });
    const spawn = () =>
      (sim as any).spawnBody(
        [600, 300, 600],
        [1, 1, 1],
        "stone",
        -1,
        "chunk",
        [0, 0, 0],
      );
    const first = spawn();
    for (let i = 1; i < MAX_BODY_LIMIT; i++) spawn();
    expect(sim.moving.size).toBe(8192);
    const last = spawn();
    expect(sim.moving.size).toBe(MAX_BODY_LIMIT);
    expect(sim.moving.has(first)).toBe(false);
    expect(sim.moving.has(last)).toBe(true);
    expect(sim.ruins.has(first)).toBe(false);
    expect(sim.ballistic.get(first)!.view.p).toEqual([600, 300, 600]);
    expect(unpackBodies(sim.snapshot(true).packedBodies!)).toHaveLength(
      MAX_BODY_LIMIT + 1,
    );
  } finally {
    sim.dispose();
  }
});

it("keeps terrain sweeps active at hills and shared section edges, including after excavation", () => {
  const heights = new Float32Array(1025 * 1025);
  heights[32 * 1025 + 32] = 100;
  const terrain = new Terrain(heights);
  expect(terrain.aboveSurface([10, 101, 10], [120, 101, 120], 2)).toBe(false);
  expect(terrain.aboveSurface([10, 103, 10], [120, 103, 120], 2)).toBe(true);
  expect(terrain.aboveSurface([63, 50, 64], [65, 50, 64], 1)).toBe(false);
  expect(terrain.aboveSurface([200, 5, 200], [220, 5, 220], 1)).toBe(true);
  terrain.crater(64, 64, 30, 25);
  expect(terrain.aboveSurface([63, 50, 64], [65, 50, 64], 1)).toBe(false);
  expect(terrain.aboveSurface([-10, -1, -10], [0, -1, 0], 1)).toBe(false);
});

it("renders all 65536 cosmetic slots and never resurrects trimmed or expired pieces", () => {
  const f = new Fragments(() => 0);
  try {
    f.setLimit(COSMETIC_LIMITS[4]);
    f.emit({ ...burst(), count: 1000000 });
    f.update(0);
    expect(f.count).toBe(65536);
    expect(f.mesh.instanceMatrix.updateRanges).toEqual([
      { start: 0, count: 65536 * 16 },
    ]);
    f.setLimit(1024);
    f.setLimit(COSMETIC_LIMITS[4]);
    expect(f.count).toBe(1024);
    for (let i = 0; i < 220; i++) f.update(0.08);
    expect(f.count).toBe(0);
    f.emit(burst());
    f.update(0);
    expect(f.count).toBe(1);
    expect(f.mesh.instanceMatrix.updateRanges).toEqual([
      { start: 0, count: 16 },
    ]);
  } finally {
    dispose(f);
  }
});

it("compacts vaporized slots without losing surviving transforms and keeps fast chips above terrain", () => {
  const f = new Fragments(() => 0),
    matrix = new THREE.Matrix4();
  try {
    f.emit(burst(10));
    f.emit(burst(100));
    f.emit(burst(200));
    f.update(0);
    f.vaporize([10, 0, 0], 5);
    f.update(0);
    expect(f.count).toBe(2);
    const positions: number[] = [];
    for (let i = 0; i < f.count; i++) {
      f.mesh.getMatrixAt(i, matrix);
      positions.push(matrix.elements[12]);
    }
    expect(positions.sort((a, b) => a - b)).toEqual([100, 200]);
    for (let tick = 0; tick < 180; tick++) {
      f.update(0.08);
      for (let i = 0; i < f.count; i++) {
        f.mesh.getMatrixAt(i, matrix);
        expect(matrix.elements[13]).toBeGreaterThanOrEqual(0);
        expect(matrix.determinant()).toBeGreaterThan(0);
      }
    }
  } finally {
    dispose(f);
  }
});

it("bounds mutual chip contacts during big collapses while retaining world/major collisions and restoring full detail", () => {
  const sim = new Simulation({ ...world, entities: [] }, base, () => {});
  try {
    sim.setDestruction({ ...DEFAULT_DESTRUCTION, bodies: 4 });
    const large = (sim as any).spawnBody(
      [600, 300, 600],
      [6, 6, 6],
      "stone",
      -1,
      "chunk",
      [0, 0, 0],
    );
    for (let i = 0; i < 600; i++)
      (sim as any).spawnBody(
        [700 + (i % 30) * 3, 300, 700 + Math.floor(i / 30) * 3],
        [0.5, 0.5, 0.5],
        "stone",
        -1,
        "chunk",
        [0, 0, 0],
      );
    (sim as any).updateDebrisCollisions();
    const major = sim.moving.get(large)!;
    const chips = [...sim.moving.values()].filter((m) => !m.major);
    expect([...sim.moving.values()].filter((m) => m.major)).toHaveLength(128);
    const collides = (a: number, b: number) =>
      ((a >>> 16) & b) !== 0 && ((b >>> 16) & a) !== 0;
    expect(
      collides(
        chips[0].collider.collisionGroups(),
        chips[1].collider.collisionGroups(),
      ),
    ).toBe(false);
    expect(
      collides(
        chips[0].collider.collisionGroups(),
        major.collider.collisionGroups(),
      ),
    ).toBe(true);
    expect(collides(chips[0].collider.collisionGroups(), 0x00010007)).toBe(
      true,
    );
    // Laser cleanup maintains the major count too; once population is small,
    // every surviving body's mutual collision detail is restored.
    (sim as any).clearLaser([600, 0, 600], 20);
    for (const m of [...sim.moving.values()].slice(0, 350))
      (sim as any).settle(m, true);
    (sim as any).updateDebrisCollisions();
    expect(sim.moving.size).toBe(250);
    const survivors = [...sim.moving.values()];
    expect(survivors.every((m) => m.major)).toBe(true);
    expect(
      collides(
        survivors[0].collider.collisionGroups(),
        survivors[1].collider.collisionGroups(),
      ),
    ).toBe(true);
  } finally {
    sim.dispose();
  }
});
