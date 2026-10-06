import { expect, it } from "vitest";
import * as THREE from "three";
import { withReflectionDetail } from "../src/render/reflection-detail";

it("restores the main view and saved-owner matrices even when reflection rendering fails", () => {
  const scene = new THREE.Scene(),
    geometry = new THREE.PlaneGeometry(),
    material = new THREE.MeshBasicMaterial(),
    ranges = new THREE.Vector2(19600, 90000),
    decorations = new THREE.Group();
  const mesh = new THREE.InstancedMesh(geometry, material, 2),
    middle = new THREE.InstancedMesh(geometry, material, 2),
    low = new THREE.InstancedMesh(geometry, material, 2),
    trunk = new THREE.InstancedMesh(geometry, material, 2);
  low.setMatrixAt(0, new THREE.Matrix4().makeScale(0, 0, 0)); // destroyed owner
  low.setMatrixAt(1, new THREE.Matrix4().makeTranslation(80, 15, 90));
  const original = low.instanceMatrix.array.slice();
  low.visible = false;
  scene.add(mesh, middle, decorations, trunk);
  const batch = { kind: "pine", mesh, middle, low };
  const distant = {
    kind: "pine",
    mesh: new THREE.InstancedMesh(geometry, material, 1),
    middle: new THREE.InstancedMesh(geometry, material, 1),
    low: new THREE.InstancedMesh(geometry, material, 1),
  };
  for (const object of [distant.mesh, distant.middle, distant.low])
    object.visible = false;
  expect(() =>
    withReflectionDetail(
      scene,
      [batch, distant, { kind: "trunk", mesh: trunk }],
      ranges,
      decorations,
      () => {
        expect(mesh.visible).toBe(false);
        expect(middle.visible).toBe(false);
        expect(decorations.visible).toBe(false);
        expect(trunk.visible).toBe(false);
        expect(low.visible).toBe(true);
        expect(low.parent).toBe(scene);
        expect(distant.low.parent).toBeNull();
        expect(distant.low.visible).toBe(false);
        expect(ranges.toArray()).toEqual([0, 0]);
        expect(low.instanceMatrix.array).toEqual(original);
        throw new Error("reflection context failure");
      },
    ),
  ).toThrow("reflection context failure");
  expect(mesh.visible).toBe(true);
  expect(middle.visible).toBe(true);
  expect(decorations.visible).toBe(true);
  expect(trunk.visible).toBe(true);
  expect(low.visible).toBe(false);
  expect(low.parent).toBeNull();
  expect(distant.low.parent).toBeNull();
  expect(distant.low.visible).toBe(false);
  expect(ranges.toArray()).toEqual([19600, 90000]);
  expect(low.instanceMatrix.array).toEqual(original);
});
