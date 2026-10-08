import { expect, it, vi } from "vitest";
import * as THREE from "three";
import { MonsterProjectileView } from "../src/render/monster-projectiles";
import { ResourceDisposal } from "../src/render/resource-disposal";
import type { MonsterSpike } from "../src/types";
const shot = (id = 1): MonsterSpike => ({
  id,
  p: [10, 20, 30],
  v: [125, 0, 0],
  age: 1,
});
it("renders a 600-shot volley in three lighting-independent batches", () => {
  const view = new MonsterProjectileView();
  view.update(
    Array.from({ length: 600 }, (_, id) => shot(id)),
    undefined,
    1,
  );
  expect(view.group.children).toHaveLength(3);
  for (const mesh of [view.body, view.core, view.tails]) {
    expect(mesh.count).toBe(600);
    expect(mesh.material).toBeInstanceOf(THREE.MeshBasicMaterial);
    expect((mesh.material as THREE.MeshBasicMaterial).toneMapped).toBe(false);
    expect(mesh.instanceMatrix.updateRanges).toEqual([
      { start: 0, count: 600 * 16 },
    ]);
  }
  expect((view.tails.material as THREE.MeshBasicMaterial).depthWrite).toBe(
    false,
  );
});
it("interpolates by shot identity and trails behind the interpolated direction", () => {
  const view = new MonsterProjectileView(),
    current = shot();
  view.update([current], [{ ...current, p: [0, 20, 30] }], 0.5);
  const body = new THREE.Matrix4(),
    tail = new THREE.Matrix4();
  view.body.getMatrixAt(0, body);
  view.tails.getMatrixAt(0, tail);
  expect(body.elements[12]).toBeCloseTo(5);
  const position = new THREE.Vector3(),
    quaternion = new THREE.Quaternion(),
    scale = new THREE.Vector3();
  tail.decompose(position, quaternion, scale);
  expect(scale.y).toBeCloseTo(12);
  expect(position.x).toBeCloseTo(5 - 5 - 6);
  expect(new THREE.Vector3(0, 1, 0).applyQuaternion(quaternion).x).toBeCloseTo(
    1,
  );
  view.update([{ ...current, id: 2, age: 0 }], [current], 0.5);
  view.body.getMatrixAt(0, body);
  view.tails.getMatrixAt(0, tail);
  expect(body.elements[12]).toBeCloseTo(10);
  expect(new THREE.Vector3().setFromMatrixScale(tail).y).toBe(0);
});
it("removes expired shots, resets on island changes, and disposes all shared resources", () => {
  const view = new MonsterProjectileView();
  view.update([shot()], undefined, 1);
  view.update([], [shot()], 1);
  expect(
    view.group.children.every(
      (mesh) => (mesh as THREE.InstancedMesh).count === 0,
    ),
  ).toBe(true);
  view.update([shot()], undefined, 1);
  view.reset();
  expect(view.body.count).toBe(0);
  expect(view.tails.count).toBe(0);
  const resources = new ResourceDisposal(),
    disposed = vi.fn();
  for (const mesh of [view.body, view.core, view.tails])
    mesh.geometry.addEventListener("dispose", disposed);
  resources.collect(view.group);
  resources.dispose();
  expect(disposed).toHaveBeenCalledTimes(3);
});
