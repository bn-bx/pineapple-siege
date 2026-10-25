import { expect, it } from "vitest";
import * as THREE from "three";
import { IslandHorizon } from "../src/render/island-horizon";
import type { WorldData } from "../src/types";
import { treeCanopyScale } from "../src/render/tree-appearance";
import { WorldBatches } from "../src/render/world-batches";
import { ResourceDisposal } from "../src/render/resource-disposal";

it("culls distant scenery by spatial cell while retaining owner restoration", () => {
  const entities = [0, 1].map((id) => ({
    id,
    kind: "block",
    material: "stone",
    p: [id ? 6000 : 100, 30, 100],
    s: [4, 8, 4],
    variant: 0.5,
  }));
  const view = new IslandHorizon(
    { entities } as unknown as WorldData,
    entities.map((e) => ({
      allIds: [e.id],
      kind: "block",
      x: e.p[0],
      z: e.p[2],
      radius: 20,
    })),
    { stone: new THREE.MeshStandardMaterial() } as any,
  );
  expect(view.group.children).toHaveLength(2);
  const camera = new THREE.PerspectiveCamera(60, 1, 1, 10000);
  camera.position.set(100, 40, 300);
  camera.lookAt(100, 30, 100);
  camera.updateMatrixWorld();
  const frustum = new THREE.Frustum().setFromProjectionMatrix(
    new THREE.Matrix4().multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse,
    ),
  );
  view.group.updateMatrixWorld();
  const [near, side] = view.group.children as THREE.InstancedMesh[];
  expect(near.frustumCulled).toBe(true);
  expect(side.frustumCulled).toBe(true);
  expect(frustum.intersectsObject(near)).toBe(true);
  expect(frustum.intersectsObject(side)).toBe(false);
  const bounds = side.boundingSphere!.clone();
  view.remove(1);
  view.restore([]);
  expect(side.boundingSphere).toEqual(bounds);
  const matrix = new THREE.Matrix4();
  side.getMatrixAt(0, matrix);
  expect(matrix.elements[12]).toBe(6000);
});

it("keeps distant owners aligned with destruction and restored saves without modifying world entities", () => {
  const entities = [0, 1].map((id) => ({
    id,
    kind: "block",
    material: "stone",
    p: [3000 + id * 20, 30, 3000],
    s: [4, 8, 4],
    variant: 0.5,
  }));
  const world = { entities } as unknown as WorldData;
  const before = JSON.stringify(entities);
  const view = new IslandHorizon(
    world,
    [{ allIds: [0, 1], kind: "block", x: 3010, z: 3000, radius: 30 }],
    { stone: new THREE.MeshStandardMaterial() } as any,
  );
  const mesh = view.group.children[0] as THREE.InstancedMesh;
  const first = new THREE.Matrix4(),
    neighbor = new THREE.Matrix4();
  mesh.getMatrixAt(0, first);
  mesh.getMatrixAt(1, neighbor);
  view.remove(0);
  const hidden = new THREE.Matrix4();
  mesh.getMatrixAt(0, hidden);
  expect(hidden.elements[0]).toBe(0);
  const unchanged = new THREE.Matrix4();
  mesh.getMatrixAt(1, unchanged);
  expect(unchanged.elements).toEqual(neighbor.elements);
  view.restore([1]);
  mesh.getMatrixAt(0, unchanged);
  expect(unchanged.elements).toEqual(first.elements);
  mesh.getMatrixAt(1, hidden);
  expect(hidden.elements[0]).toBe(0);
  view.restore([]);
  mesh.getMatrixAt(1, unchanged);
  expect(unchanged.elements).toEqual(neighbor.elements);
  expect(JSON.stringify(entities)).toBe(before);
  expect(mesh.castShadow).toBe(false);
});

it("carries the same species-specific crown proportions into whole-island silhouettes", () => {
  const entities = [0.18, 0.82].map((variant, id) => ({
    id,
    kind: "tree",
    treeSpecies: "pine",
    material: "bark",
    p: [3000 + id * 20, 30, 3000],
    s: [3, 12, 3],
    variant,
  }));
  const view = new IslandHorizon(
    { entities } as unknown as WorldData,
    [{ allIds: [0, 1], kind: "tree", x: 3010, z: 3000, radius: 30 }],
    { bark: new THREE.MeshStandardMaterial() } as any,
  );
  const mesh = view.group.children[0] as THREE.InstancedMesh;
  for (let index = 0; index < entities.length; index++) {
    const matrix = new THREE.Matrix4();
    mesh.getMatrixAt(index, matrix);
    const scale = new THREE.Vector3();
    matrix.decompose(new THREE.Vector3(), new THREE.Quaternion(), scale);
    const expected = treeCanopyScale(entities[index]);
    expect(scale.x).toBeCloseTo(expected[0]);
    expect(scale.y).toBeCloseTo(expected[1]);
    expect(scale.z).toBeCloseTo(expected[2]);
  }
});

it("keeps hell trees bare through every detail level and saved destruction", () => {
  const entities = ["pine", "broadleaf", "riverside"].map(
    (treeSpecies, id) => ({
      id,
      kind: "tree",
      material: "wood",
      treeSpecies,
      p: [3000 + id * 20, 30, 3000],
      s: [3, 12, 3],
      variant: 0.5,
    }),
  );
  const world = {
    realm: "hell",
    entities,
    banners: [],
    sites: [],
  } as unknown as WorldData;
  const scene = new THREE.Scene();
  const materials = {
    wood: new THREE.MeshStandardMaterial({ color: "#5e5149" }),
    foliage: new THREE.MeshStandardMaterial({ color: "#877b6c" }),
  };
  const view = new WorldBatches(scene, world, materials as any);
  for (const batch of view.batches) {
    expect(batch.mesh.geometry.name).toMatch(/^dead-/);
    expect(batch.low!.geometry.name).toMatch(/^dead-.*-low$/);
  }
  for (const mesh of view.horizon.group.children as THREE.InstancedMesh[])
    expect(mesh.geometry.name).toMatch(/^dead-.*-low$/);
  view.remove(0);
  expect(
    view.batches.reduce((count, batch) => count + batch.ids.length, 0),
  ).toBe(2);
  const resources = new ResourceDisposal();
  view.dispose(resources);
  resources.dispose();
});
