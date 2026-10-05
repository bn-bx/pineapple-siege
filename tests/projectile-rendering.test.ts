import { it, expect, vi } from "vitest";
import * as THREE from "three";
vi.mock("../src/render/assets", () => ({
  makePineapple: () => {
    const group = new THREE.Group(),
      fruit = new THREE.Mesh(
        new THREE.SphereGeometry(1),
        new THREE.MeshStandardMaterial(),
      );
    fruit.position.y = -0.45;
    fruit.scale.y = 1.4;
    group.add(fruit);
    const leafGeometry = new THREE.ConeGeometry(0.17, 1.25, 3),
      material = new THREE.MeshStandardMaterial();
    for (let i = 0; i < 7; i++) {
      const leaf = new THREE.Mesh(leafGeometry, material);
      leaf.position.set(Math.sin(i) * 0.3, 1, Math.cos(i) * 0.3);
      group.add(leaf);
    }
    return group;
  },
}));
import { ProjectileView } from "../src/render/projectiles";
it("renders unlimited rapid-fire pineapples in two growing batches, preserving interpolation and crowns", () => {
  const view = new ProjectileView();
  const shots = Array.from(
    { length: 80 },
    (_, id) =>
      ({
        id,
        p: [10, 20, 30],
        v: [0, 1, 0],
        weapon: "nuke",
        yield: "valley",
      }) as any,
  );
  const previous = new Map([[0, { ...shots[0], p: [0, 20, 30] }]]);
  view.update(shots, previous, 0.5);
  expect(view.group.children).toHaveLength(2);
  const [body, leaves] = view.group.children as THREE.InstancedMesh[];
  expect(body.count).toBe(80);
  expect(leaves.count).toBe(560);
  const matrix = new THREE.Matrix4();
  body.getMatrixAt(0, matrix);
  expect(matrix.elements[12]).toBeCloseTo(5);
  expect(matrix.elements[13]).toBeCloseTo(20 - (0.45 * 18) / 3.3, 4);
  view.reset();
  expect(body.count).toBe(0);
  expect(leaves.count).toBe(0);
  expect(view.count).toBe(0);
});
