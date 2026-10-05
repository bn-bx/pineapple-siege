import { expect, it } from "vitest";
import * as THREE from "three";
import { roofFragmentGeometry } from "../src/render/assets";
import { GameRenderer } from "../src/render/renderer";
import type { BodyView } from "../src/types";
import {
  packBodies,
  PackedBodyReader,
  PackedBodyLookup,
} from "../src/sim/body-buffer";
import { prepareDebrisMotion } from "../src/render/debris-motion";

function fixture() {
  // Exercise instance packing without requiring a browser/WebGL context.
  const view = Object.create(GameRenderer.prototype) as any;
  const geometry = new THREE.BoxGeometry(2, 2, 2);
  const material = new THREE.MeshBasicMaterial();
  view.scene = new THREE.Scene();
  view.bodyMeshes = new Map([
    ["stone", new THREE.InstancedMesh(geometry, material, 8192)],
  ]);
  view.fallenPines = new THREE.InstancedMesh(geometry, material, 8192);
  view.fallenTrunks = new THREE.InstancedMesh(geometry, material, 8192);
  view.previousBodies = new Map();
  view.debrisRotation = new THREE.Quaternion();
  view.fragmentColor = new THREE.Color();
  view.world = { entities: [{ s: [4, 8, 4] }] };
  return {
    view,
    dispose() {
      for (const mesh of [
        ...view.bodyMeshes.values(),
        view.fallenPines,
        view.fallenTrunks,
      ])
        mesh.dispose();
      geometry.dispose();
      material.dispose();
    },
  };
}
const body = (id: number): BodyView => ({
  id,
  source: 0,
  kind: "chunk",
  material: "stone",
  p: [id, 100, 600],
  s: [1, 1, 1],
  q: [0, 0, 0, 1],
});
it("merges neighboring ruin cells without losing transforms at 256-meter boundaries", () => {
  const { view, dispose } = fixture();
  view.ruins = new Map();
  view.ruinCells = new Map();
  view.ruinGroups = new Map();
  view.dirtyRuinBatches = new Set();
  view.ruinVersions = new Map();
  view.camera = new THREE.PerspectiveCamera();
  view.renderDistance = 1200;
  view.fractureBox = view.bodyMeshes.get("stone").geometry;
  view.fragmentMaterials = { stone: view.bodyMeshes.get("stone").material };
  const records = Array.from({ length: 17 }, (_, id) => ({
    ...body(id),
    p: [
      id < 16 ? (id % 4) * 64 + 32 : 256,
      10,
      id < 16 ? Math.floor(id / 4) * 64 + 32 : 32,
    ] as [number, number, number],
  }));
  try {
    for (const ruin of records) view.addRuin(ruin);
    view.updateRuins();
    expect(view.ruinGroups.size).toBe(2);
    expect(view.ruinGroups.get(0).children[0].count).toBe(16);
    const positions: string[] = [],
      matrix = new THREE.Matrix4();
    for (const group of view.ruinGroups.values())
      for (const mesh of group.children)
        for (let i = 0; i < mesh.count; i++) {
          mesh.getMatrixAt(i, matrix);
          positions.push(matrix.elements.slice(12, 15).join(","));
        }
    expect(positions.sort()).toEqual(records.map((r) => r.p.join(",")).sort());
    view.removeRuin(5);
    view.updateRuins();
    expect(view.ruinGroups.get(0).children[0].count).toBe(15);
    expect(view.ruins.size).toBe(16);
  } finally {
    for (const group of view.ruinGroups.values())
      for (const mesh of group.children) mesh.dispose();
    dispose();
  }
});

it("packs visible roof variants directly from packets without reading body wrappers", () => {
  const { view, dispose } = fixture();
  view.camera = new THREE.PerspectiveCamera(64, 1, 0.5, 2000);
  view.camera.position.set(0, 100, 0);
  view.renderDistance = 1200;
  view.bodyReader = new PackedBodyReader();
  view.oldBodyReader = new PackedBodyReader();
  view.oldBodyLookup = new PackedBodyLookup();
  view.bodyScratch = body(0);
  view.oldBodyScratch = body(0);
  view.bodySphere = new THREE.Sphere();
  view.bodyFrustum = new THREE.Frustum();
  view.bodyProjection = new THREE.Matrix4();
  view.bodyAlpha = { value: 1 };
  view.bodyGPUEnabled = { value: 1 };
  view.fragmentMaterials = { roof: new THREE.MeshBasicMaterial() };
  const records = Array.from(
    { length: 280 },
    (_, i): BodyView => ({
      ...body(i),
      material: "roof",
      roofPart: (i % 4) + 1,
      p: [0, 100, -100],
    }),
  );
  records.push({ ...body(1000), p: [0, 100, -100] });
  records.push({ ...body(1001), p: [5000, 100, -100] });
  const wrappers = new Proxy(new Array(records.length), {
    get(target, key, receiver) {
      if (typeof key === "string" && /^\d+$/.test(key))
        throw Error("body wrapper read");
      return Reflect.get(target, key, receiver);
    },
  });
  prepareDebrisMotion(
    view.bodyMeshes.get("stone"),
    view.bodyAlpha,
    view.bodyGPUEnabled,
  );
  try {
    view.syncBodies(wrappers, 1, packBodies(records, records.length));
    expect(view.bodyMeshes.get("stone").count).toBe(1);
    for (let part = 1; part <= 4; part++) {
      const mesh = view.bodyMeshes.get(`roof:${part}`);
      expect(mesh.count).toBe(70);
      expect(mesh.geometry.getAttribute("motionCurrentQ").getW(69)).toBe(1);
      expect(mesh.instanceMatrix.array[69 * 16 + 14]).toBe(-100);
    }
  } finally {
    for (const mesh of view.bodyMeshes.values()) {
      mesh.geometry.dispose();
      mesh.material.dispose();
      mesh.customDepthMaterial?.dispose();
    }
    for (const geo of view.roofFragments.values()) geo.dispose();
    view.fragmentMaterials.roof.dispose();
    dispose();
  }
});

it("renders overflow stone and trees beyond the rigid-body cap without dropping instances", () => {
  const { view, dispose } = fixture();
  try {
    const bodies = Array.from({ length: 8300 }, (_, i) => body(i));
    bodies.push(
      ...Array.from(
        { length: 8300 },
        (_, i): BodyView => ({ ...body(i + 8300), kind: "tree" }),
      ),
    );
    view.syncBodies(bodies, 1);
    expect(view.bodyMeshes.get("stone").count).toBe(8300);
    expect(view.fallenPines.count).toBe(8300);
    expect(view.fallenTrunks.count).toBe(8300);
    const matrix = new THREE.Matrix4();
    view.bodyMeshes.get("stone").getMatrixAt(8299, matrix);
    expect(matrix.elements[12]).toBe(8299);
    view.fallenTrunks.getMatrixAt(8299, matrix);
    expect(matrix.elements[12]).toBe(16599);
  } finally {
    dispose();
  }
});

it("interpolates debris on successive frames and leaves paused transforms unchanged", () => {
  const { view, dispose } = fixture();
  try {
    const old = body(42),
      current = {
        ...body(42),
        p: [52, 120, 600] as [number, number, number],
        q: [0, 1, 0, 0] as [number, number, number, number],
      };
    view.previousBodies.set(42, old);
    const bodies = [current],
      matrix = new THREE.Matrix4();
    view.syncBodies(bodies, 0.5);
    view.bodyMeshes.get("stone").getMatrixAt(0, matrix);
    expect(matrix.elements[12]).toBe(47);
    expect(matrix.elements[13]).toBe(110);
    expect(matrix.elements[0]).toBeCloseTo(0);
    expect(Math.abs(matrix.elements[2])).toBeCloseTo(1);
    view.syncBodies(bodies, 1);
    view.bodyMeshes.get("stone").getMatrixAt(0, matrix);
    expect(matrix.elements[12]).toBe(52);
    expect(matrix.elements[0]).toBeCloseTo(-1);
    const version = view.bodyMeshes.get("stone").instanceMatrix.version;
    view.syncBodies(bodies, 1);
    expect(view.bodyMeshes.get("stone").instanceMatrix.version).toBe(version);
  } finally {
    dispose();
  }
});

it("instances each roof wedge separately and reuses its settled geometry", () => {
  const { view, dispose } = fixture();
  view.fragmentMaterials = { roof: new THREE.MeshBasicMaterial() };
  try {
    const bodies = Array.from({ length: 280 }, (_, i) => ({
      ...body(i),
      material: "roof" as const,
      roofPart: (i % 4) + 1,
    }));
    view.syncBodies(bodies, 1);
    for (let part = 1; part <= 4; part++) {
      const mesh = view.bodyMeshes.get(`roof:${part}`);
      expect(mesh.count).toBe(70);
      expect(mesh.geometry).toBe(
        view.debrisGeometry({ material: "roof", roofPart: part }),
      );
      expect(Array.from(mesh.geometry.attributes.position.array)).toEqual(
        Array.from(roofFragmentGeometry(part).attributes.position.array),
      );
    }
    view.syncBodies([], 1);
    for (const mesh of view.bodyMeshes.values()) expect(mesh.count).toBe(0);
  } finally {
    for (const geo of view.roofFragments.values()) geo.dispose();
    view.fragmentMaterials.roof.dispose();
    dispose();
  }
});

it("preserves each tree species from falling bodies into settled ruins and clears repaired trees", () => {
  const { view, dispose } = fixture();
  const species = ["pine", "broadleaf", "riverside"] as const;
  view.world.entities = species.map((treeSpecies) => ({
    s: [4, 8, 4],
    treeSpecies,
  }));
  view.materials = {
    foliage: new THREE.MeshBasicMaterial(),
    wood: new THREE.MeshBasicMaterial(),
  };
  view.fallenPines.geometry = view.crownGeometry("pine");
  view.ruins = new Map();
  view.ruinCells = new Map();
  view.ruinGroups = new Map();
  view.dirtyRuinBatches = new Set();
  view.camera = new THREE.PerspectiveCamera();
  view.renderDistance = 2000;
  const trees = species.map(
    (_, source): BodyView => ({
      ...body(source),
      source,
      kind: "tree",
      material: "wood",
      p: [600 + source * 8, 8, 600],
      s: [1, 4, 1],
    }),
  );
  try {
    view.syncBodies(trees, 1);
    expect(view.fallenTrunks.count).toBe(3);
    for (const name of species) {
      const canopy = view.fallenCanopy(name);
      expect(canopy.count).toBe(1);
      expect(canopy.geometry).toBe(view.crownGeometry(name));
    }
    for (const tree of trees) view.addRuin(tree);
    view.syncBodies([], 1);
    view.updateRuins();
    const meshes = [...view.ruinGroups.values()].flatMap(
      (group: THREE.Group) => group.children,
    );
    for (const name of species)
      expect(
        meshes.filter(
          (mesh: THREE.InstancedMesh) =>
            mesh.geometry === view.crownGeometry(name),
        ),
      ).toHaveLength(1);
    for (const tree of trees) view.removeRuin(tree.id);
    view.updateRuins();
    for (const name of species) expect(view.fallenCanopy(name).count).toBe(0);
    expect(
      [...view.ruinGroups.values()].flatMap((g: THREE.Group) => g.children),
    ).toHaveLength(0);
  } finally {
    for (const mesh of view.fallenCanopies.values()) mesh.dispose();
    for (const geometry of view.crownGeometries.values()) geometry.dispose();
    for (const material of Object.values(view.materials) as THREE.Material[])
      material.dispose();
    dispose();
  }
});

it("uses matching trunk and canopy dimensions on both sides of GPU interpolation", () => {
  const { view, dispose } = fixture();
  view.camera = new THREE.PerspectiveCamera(64, 1, 0.5, 2000);
  view.camera.position.set(0, 100, 0);
  view.renderDistance = 1200;
  view.bodyReader = new PackedBodyReader();
  view.oldBodyReader = new PackedBodyReader();
  view.oldBodyLookup = new PackedBodyLookup();
  view.bodyScratch = body(0);
  view.oldBodyScratch = body(0);
  view.bodySphere = new THREE.Sphere();
  view.bodyFrustum = new THREE.Frustum();
  view.bodyProjection = new THREE.Matrix4();
  view.bodyAlpha = { value: 0.5 };
  view.bodyGPUEnabled = { value: 1 };
  const old: BodyView = {
    ...body(42),
    kind: "tree",
    p: [0, 100, -100],
    s: [1, 4, 1],
  };
  const current: BodyView = { ...old, s: [0.5, 2, 0.5] };
  const oldPacket = packBodies([old], 1),
    packet = packBodies([current], 1);
  const original = new Uint8Array(oldPacket.buffer).slice();
  for (const mesh of [view.fallenTrunks, view.fallenPines])
    prepareDebrisMotion(mesh, view.bodyAlpha, view.bodyGPUEnabled);
  try {
    view.syncBodies([current], 0.5, packet, oldPacket);
    const trunk = view.fallenTrunks.geometry.getAttribute("motionPreviousS");
    const canopy = view.fallenPines.geometry.getAttribute("motionPreviousS");
    expect(trunk.getY(0)).toBe(8);
    expect(trunk.getX(0)).toBe(1);
    expect(canopy.getY(0)).toBe(8);
    expect(canopy.getX(0)).toBeCloseTo(2.9);
    expect(
      view.fallenPines.geometry.getAttribute("motionPreviousP").getY(0),
    ).toBe(96);
    expect(view.fallenTrunks.instanceMatrix.array[5]).toBe(4);
    expect(view.fallenPines.instanceMatrix.array[0]).toBeCloseTo(1.45);
    expect(new Uint8Array(oldPacket.buffer)).toEqual(original);
    expect(current.s).toEqual([0.5, 2, 0.5]);
  } finally {
    dispose();
  }
});
