import { expect, it } from "vitest";
import * as THREE from "three";
import { IslandHorizon } from "../src/render/island-horizon";
import type { WorldData } from "../src/types";
import { treeCanopyScale } from "../src/render/tree-appearance";

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
