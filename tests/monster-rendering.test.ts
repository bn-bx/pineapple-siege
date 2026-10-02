import { expect, it } from "vitest";
import * as THREE from "three";
import { DistantMonsterView } from "../src/render/monster";

it("renders 400 distant monsters in four shared batches and clears hidden enemies", () => {
  const view = new DistantMonsterView(400);
  const root = new THREE.Object3D();
  root.position.set(4100, 80, 4200);
  root.rotation.set(0, Math.PI / 2, 0.1);
  root.scale.setScalar(0.6);
  view.begin();
  for (let i = 0; i < 400; i++) view.add(root);
  view.finish();
  expect(view.group.children).toHaveLength(4);
  expect(view.parts.every((p) => p.count === 400)).toBe(true);
  const actual = new THREE.Matrix4();
  view.parts[0].getMatrixAt(399, actual);
  const expected = new THREE.Matrix4().compose(
    new THREE.Vector3(0, 15, 0),
    new THREE.Quaternion(),
    new THREE.Vector3(9, 12, 8),
  );
  const combined = root.matrix.clone().multiply(expected);
  actual.elements.forEach((v, i) =>
    expect(v).toBeCloseTo(combined.elements[i], 3),
  );
  view.begin();
  view.finish();
  expect(view.parts.every((p) => p.count === 0)).toBe(true);
});
