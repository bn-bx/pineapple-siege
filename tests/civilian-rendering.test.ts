import { expect, it } from "vitest";
import * as THREE from "three";
import { CivilianView } from "../src/render/civilians";
import type { SimulationSnapshot } from "../src/types";
it("freezes resident poses with a paused snapshot and removes casualties from every part batch", () => {
  const view = new CivilianView(2);
  const snapshot = {
    civilians: [
      {
        id: 0,
        p: [3000, 10, 3000],
        yaw: 0,
        alive: true,
        mood: "cheer",
        phase: 2,
      },
      {
        id: 1,
        p: [3010, 10, 3000],
        yaw: 1,
        alive: true,
        mood: "sad",
        phase: 3,
      },
    ],
  } as SimulationSnapshot;
  const camera = new THREE.Vector3(3000, 40, 3000);
  view.update(snapshot, undefined, 1, camera);
  const matrices = view.group.children.map((mesh) =>
    Array.from((mesh as THREE.InstancedMesh).instanceMatrix.array),
  );
  view.update(snapshot, undefined, 1, camera);
  expect(
    view.group.children.map((mesh) =>
      Array.from((mesh as THREE.InstancedMesh).instanceMatrix.array),
    ),
  ).toEqual(matrices);
  snapshot.civilians[0].alive = false;
  view.update(snapshot, undefined, 1, camera);
  for (const mesh of view.group.children.slice(0, 6))
    expect((mesh as THREE.InstancedMesh).count).toBe(1);
  expect((view.group.children[6] as THREE.InstancedMesh).count).toBe(2);
  view.reset();
  expect(
    view.group.children.every(
      (mesh) => (mesh as THREE.InstancedMesh).count === 0,
    ),
  ).toBe(true);
});
it("hides distant residents at a short render distance and restores them when increased", () => {
  const view = new CivilianView(1);
  const snapshot = {
    civilians: [
      { id: 0, p: [900, 10, 0], yaw: 0, alive: true, mood: "sad", phase: 0 },
    ],
  } as SimulationSnapshot;
  const camera = new THREE.Vector3(0, 40, 0);
  view.update(snapshot, undefined, 1, camera, 600);
  expect((view.group.children[0] as THREE.InstancedMesh).count).toBe(0);
  view.update(snapshot, undefined, 1, camera, 1800);
  expect((view.group.children[0] as THREE.InstancedMesh).count).toBe(1);
});
