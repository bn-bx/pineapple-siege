import { expect, it } from "vitest";
import * as THREE from "three";
import {
  DistantMonsterView,
  monsterCombatPose,
} from "../src/render/monster";

it("renders 400 distant monsters in five shared batches, including grounding roots", () => {
  const view = new DistantMonsterView(400);
  const root = new THREE.Object3D();
  root.position.set(4100, 80, 4200);
  root.rotation.set(0, Math.PI / 2, 0.1);
  root.scale.setScalar(0.6);
  view.begin();
  for (let i = 0; i < 400; i++) view.add(root);
  view.finish();
  expect(view.group.children).toHaveLength(5);
  expect(view.parts.every((p) => p.count === 400)).toBe(true);
  view.parts[4].geometry.computeBoundingBox();
  expect(view.parts[4].geometry.boundingBox!.min.y).toBeLessThan(0.5);
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

it("raises a readable attack windup and adds a short stagger recoil", () => {
  const idle = monsterCombatPose(0, 0, 0, 0.2),
    charging = monsterCombatPose(0, 0.75, 0, 0.2),
    staggered = monsterCombatPose(Math.PI / 24, 0, 0.45, 0.2);
  expect(idle.active).toBe(false);
  expect(charging.active).toBe(true);
  expect(charging.left).toBeLessThan(-1.1);
  expect(charging.right).toBeGreaterThan(1.1);
  expect(charging.lean).toBeLessThan(0);
  expect(staggered.active).toBe(true);
  expect(Math.abs(staggered.lean)).toBeGreaterThan(0.08);
  expect(staggered.left).not.toBeCloseTo(idle.left, 2);
  expect(charging.brow).toBeLessThan(idle.brow);
  expect(staggered.brow).toBeGreaterThan(idle.brow);
});
