import { beforeAll, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { Simulation, initializePhysics } from "../src/sim/simulation";
import { roofVertices, roofClearance } from "../src/debris-shape";
import { fractureGeometry, roofGeometry } from "../src/render/assets";
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

it("retains a roof's full pointed section through breakup, demotion, packing and save restoration", () => {
  const sim = new Simulation({ ...world, entities: roofs }, flat, () => {});
  let restored: Simulation | undefined;
  try {
    const budget = { n: 0, limit: 8 };
    (sim as any).fragment(roofs[0], [590, 30, 600], 60, budget);
    expect(budget.n).toBe(1);
    const m = [...sim.moving.values()][0];
    expect(m.view.s).toEqual(roofs[0].s);
    expect(m.view.p).toEqual(roofs[0].p);
    expect(m.collider.shapeType()).toBe(RAPIER.ShapeType.ConvexPolyhedron);
    expect(m.collider.volume()).toBeCloseTo((8 * 2 * 3 * 4) / 3, 3);
    (sim as any).settle(m, true);
    (sim as any).fragment(roofs[1], [590, 30, 600], 60, { n: 8, limit: 8 });
    const views = unpackBodies(sim.snapshot(true).packedBodies!);
    expect(views.map((v) => v.material)).toEqual(["roof", "slate"]);
    for (const v of views) expect(v.s).toEqual([2, 3, 4]);
    const save = sim.save();
    restored = new Simulation(
      { ...world, entities: roofs },
      flat,
      () => {},
      save,
    );
    expect([...restored.ruins.values()].map((r) => r.material)).toEqual([
      "roof",
      "slate",
    ]);
    for (const r of restored.ruins.values()) expect(r.s).toEqual([2, 3, 4]);
  } finally {
    sim.dispose();
    restored?.dispose();
  }
});

it("keeps neighboring unsupported roofs separate instead of collapsing them into a box group", () => {
  const sameMaterial = roofs.map((r) => ({ ...r, material: "roof" as const }));
  const sim = new Simulation(
    { ...world, entities: sameMaterial },
    flat,
    () => {},
  );
  try {
    (sim as any).dirtyAssemblies.add("roof-test");
    (sim as any).resolveSupport([590, 30, 600], 100, 0);
    expect(sim.ballistic.size).toBe(2);
    for (const m of sim.ballistic.values()) {
      expect(m.view.s).toEqual([2, 3, 4]);
      expect(m.view.p).toEqual(sameMaterial[m.view.source].p);
    }
  } finally {
    sim.dispose();
  }
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
    }
    view.updateRuins();
    const meshes = [...view.ruinGroups.values()].flatMap(
      (g: any) => g.children,
    );
    expect(meshes).toHaveLength(2);
    expect(meshes.map((m: any) => m.count).sort()).toEqual([1, 8]);
    for (const m of meshes) expect(m.geometry).toBe(geo);
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
