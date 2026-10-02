import { beforeAll, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { Simulation, initializePhysics } from "../src/sim/simulation";
import { roofVertices, roofClearance, roofParts } from "../src/debris-shape";
import {
  fractureGeometry,
  roofGeometry,
  roofFragmentGeometry,
} from "../src/render/assets";
import { GameRenderer } from "../src/render/renderer";
import { unpackBodies } from "../src/sim/body-buffer";
import { Terrain } from "../src/sim/terrain";
import {
  advanceDebris,
  type BallisticDebris,
} from "../src/sim/ballistic-debris";
import { CONFIG } from "../src/config";
import type { Entity, Ruin, WorldData } from "../src/types";

beforeAll(initializePhysics);
const world: WorldData = JSON.parse(readFileSync("public/world.json", "utf8"));
const flat = new Float32Array(1025 * 1025);
const roofs: Entity[] = ["roof", "slate"].map((material, id) => ({
  id,
  kind: "block",
  p: [600 + id * 5, 30, 600],
  s: [2, 3, 4],
  material: material as Entity["material"],
  assembly: "roof-test",
  foundation: false,
  supports: [],
  variant: 0,
}));

it("fractures roofs into matching solid wedges through physics overflow, packing, demotion and save restoration", () => {
  const sim = new Simulation({ ...world, entities: roofs }, flat, () => {});
  let restored: Simulation | undefined;
  try {
    const budget = { n: 0, limit: 2 };
    (sim as any).fragment(roofs[0], [590, 30, 600], 60, budget);
    expect(budget.n).toBe(2);
    expect(sim.moving.size).toBe(2);
    expect(sim.ballistic.size).toBe(2);
    for (const m of [...sim.moving.values()]) {
      expect(m.collider.shapeType()).toBe(RAPIER.ShapeType.ConvexPolyhedron);
      expect(m.collider.volume()).toBeCloseTo((8 * 2 * 3 * 4) / 12, 3);
      (sim as any).settle(m, true);
    }
    (sim as any).fragment(roofs[1], [590, 30, 600], 60, { n: 8, limit: 8 });
    const packed = sim.snapshot(true).packedBodies!;
    expect(packed.buffer.byteLength).toBe(8 * 50);
    const views = unpackBodies(packed);
    for (const material of ["roof", "slate"]) {
      expect(
        views
          .filter((v) => v.material === material)
          .map((v) => v.roofPart)
          .sort(),
      ).toEqual([1, 2, 3, 4]);
    }
    const save = sim.save();
    restored = new Simulation(
      { ...world, entities: roofs },
      flat,
      () => {},
      save,
    );
    expect(restored.ruins.size).toBe(8);
    for (const r of restored.ruins.values()) {
      expect(r.roofPart).toBeGreaterThan(0);
      const collider = (restored as any).ruinColliders.get(r.id);
      expect(collider.volume()).toBeCloseTo(16, 3);
    }
    const r = [...restored.ruins.values()][0];
    (restored as any).shoveWreckage(r.p, 1, 20, { n: 0, limit: 1 });
    expect([...restored.moving.values()][0].view.roofPart).toBe(r.roofPart);
  } finally {
    sim.dispose();
    restored?.dispose();
  }
});

it("fractures unsupported roofs even with no remaining rigid-body budget", () => {
  const sameMaterial = roofs.map((r) => ({ ...r, material: "roof" as const }));
  const sim = new Simulation(
    { ...world, entities: sameMaterial },
    flat,
    () => {},
  );
  try {
    (sim as any).dirtyAssemblies.add("roof-test");
    (sim as any).resolveSupport([590, 30, 600], 100, 0);
    expect(sim.ballistic.size).toBe(8);
    for (const m of sim.ballistic.values())
      expect(m.view.roofPart).toBeGreaterThan(0);
  } finally {
    sim.dispose();
  }
});

it("reconstructs the exact roof from four closed, outward-facing render and collision wedges", () => {
  let volume = 0;
  for (let part = 1; part <= 4; part++) {
    const shape = roofParts[part - 1],
      geo = roofFragmentGeometry(part);
    const pos = geo.attributes.position;
    const hull = roofVertices([2, 3, 4], part);
    const q = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(0.8, 0.2, 1.1),
    );
    let lowest = Infinity;
    for (let i = 0; i < pos.count; i += 3) {
      const pts = [0, 1, 2].map((j) =>
        new THREE.Vector3().fromBufferAttribute(pos, i + j),
      );
      const center = new THREE.Vector3()
        .addVectors(pts[0], pts[1])
        .add(pts[2])
        .divideScalar(3);
      const centroid = new THREE.Vector3(
        ...shape.vertices.reduce(
          (sum, v) =>
            sum.map((n, k) => n + v[k] / 4) as [number, number, number],
          [0, 0, 0],
        ),
      );
      const normal = new THREE.Vector3()
        .subVectors(pts[1], pts[0])
        .cross(new THREE.Vector3().subVectors(pts[2], pts[0]));
      expect(normal.dot(center.sub(centroid))).toBeGreaterThan(0);
      volume +=
        (pts[0].dot(new THREE.Vector3().crossVectors(pts[1], pts[2])) / 6) *
        shape.size[0] *
        shape.size[1] *
        shape.size[2];
      for (const pt of pts) {
        const index = shape.vertices.findIndex(
          (v) => pt.distanceTo(new THREE.Vector3(...v)) < 1e-6,
        );
        expect(index).toBeGreaterThanOrEqual(0);
        expect([pt.x * 2, pt.y * 3, pt.z * 4]).toEqual(
          Array.from(hull.slice(index * 3, index * 3 + 3)),
        );
        const original = pt
          .clone()
          .multiply(new THREE.Vector3(...shape.size))
          .add(new THREE.Vector3(...shape.offset));
        expect(Math.abs(original.x)).toBeLessThanOrEqual(
          (1 - original.y) / 2 + 1e-6,
        );
        expect(Math.abs(original.z)).toBeLessThanOrEqual(
          (1 - original.y) / 2 + 1e-6,
        );
        lowest = Math.min(
          lowest,
          pt
            .clone()
            .multiply(new THREE.Vector3(2, 3, 4))
            .applyQuaternion(q).y,
        );
      }
    }
    expect(roofClearance([2, 3, 4], q.toArray(), part)).toBeCloseTo(-lowest, 5);
    geo.dispose();
  }
  expect(volume).toBeCloseTo(8 / 3, 6);
});

it("matches the roof render vertices and ground clearance for tilted and inverted pieces", () => {
  const geometry = roofGeometry(),
    points = geometry.attributes.position;
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.8, 0.2, 1.1));
  let lowest = Infinity;
  for (let i = 0; i < points.count; i++) {
    const p = new THREE.Vector3(
      points.getX(i) * 2,
      points.getY(i) * 3,
      points.getZ(i) * 4,
    ).applyQuaternion(q);
    lowest = Math.min(lowest, p.y);
  }
  expect(roofClearance([2, 3, 4], q.toArray())).toBeCloseTo(-lowest, 5);
  expect(roofVertices([2, 3, 4])).toHaveLength(15);
  geometry.dispose();
});

it("renders settled roof and slate pieces with pointed geometry, including compacted piles", () => {
  const view = Object.create(GameRenderer.prototype) as any;
  const geo = fractureGeometry(roofGeometry()),
    box = fractureGeometry(),
    material = new THREE.MeshBasicMaterial();
  view.scene = new THREE.Scene();
  view.camera = new THREE.PerspectiveCamera();
  view.ruins = new Map();
  view.ruinCells = new Map();
  view.ruinGroups = new Map();
  view.dirtyRuinBatches = new Set();
  view.fractureRoof = geo;
  view.fractureBox = box;
  view.fragmentColor = new THREE.Color();
  view.fragmentMaterials = { roof: material, slate: material };
  try {
    for (const e of roofs) {
      const r: Ruin = {
        ...e,
        kind: "chunk",
        id: 100000 + e.id,
        source: e.id,
        q: [0, 0, 0, 1],
        pile: e.id === 1,
      };
      view.addRuin(r);
      if (!r.pile) view.addRuin({ ...r, id: r.id + 10, roofPart: 2 });
    }
    view.updateRuins();
    const meshes = [...view.ruinGroups.values()].flatMap(
      (g: any) => g.children,
    );
    expect(meshes).toHaveLength(3);
    expect(meshes.map((m: any) => m.count).sort()).toEqual([1, 1, 8]);
    const shard = meshes.find((m: any) => m.geometry !== geo);
    expect(shard.geometry).toBe(
      view.debrisGeometry({ material: "roof", roofPart: 2 }),
    );
    expect(shard.geometry.attributes.position.count).toBe(12);
  } finally {
    for (const g of view.ruinGroups.values())
      for (const m of g.children) m.dispose();
    geo.dispose();
    box.dispose();
    material.dispose();
  }
});

it("uses the slightly stronger gravity for both rigid and overflow debris", () => {
  const sim = new Simulation({ ...world, entities: [] }, flat, () => {});
  try {
    expect(sim.physics.gravity.y).toBe(-CONFIG.debrisGravity);
    const m: BallisticDebris = {
      view: {
        id: 1,
        source: -1,
        kind: "chunk",
        material: "stone",
        p: [600, 100, 600],
        s: [1, 1, 1],
        q: [0, 0, 0, 1],
      },
      velocity: [0, 0, 0],
      angular: [0, 0, 0],
      grounded: 0,
    };
    const terrain = new Terrain(flat);
    for (let i = 0; i < 60; i++) advanceDebris(m, terrain, 1 / 60);
    expect(m.view.p[1]).toBeLessThan(90);
    expect(m.view.p[1]).toBeGreaterThan(89);
  } finally {
    sim.dispose();
  }
});
