import { expect, it } from "vitest";
import * as THREE from "three";
import { GooglyEyes } from "../src/render/googly-eyes";
import type { SimulationSnapshot } from "../src/types";

const snapshot = {
  plane: { p: [30, 100, 40] },
  projectiles: [],
  lasers: [],
} as unknown as SimulationSnapshot;

it("shares debris transforms, follows live counts, and retires without disposing the source buffer", () => {
  const faces = new GooglyEyes();
  const source = new THREE.InstancedMesh(
    new THREE.BoxGeometry(),
    new THREE.MeshBasicMaterial(),
    8192,
  );
  source.count = 4096;
  faces.update([source], snapshot);
  const eyes = source.getObjectByName("googly-eyes") as THREE.InstancedMesh;
  expect(eyes.instanceMatrix).toBe(source.instanceMatrix);
  expect(eyes.count).toBe(4096);
  source.count = 0;
  faces.update([source], snapshot);
  expect(eyes.count).toBe(0);
  source.count = 8192;
  faces.update([source], snapshot);
  expect(eyes.count).toBe(8192);
  let borrowedBufferDisposed = false;
  eyes.addEventListener("dispose", () => {
    borrowedBufferDisposed = eyes.instanceMatrix === source.instanceMatrix;
  });
  faces.update([], snapshot);
  expect(source.children).toHaveLength(0);
  expect(borrowedBufferDisposed).toBe(false);
  source.geometry.dispose();
  (source.material as THREE.Material).dispose();
  source.dispose();
});

it("toggles existing and newly created faces without changing source visibility", () => {
  const faces = new GooglyEyes();
  const first = new THREE.Mesh(
    new THREE.BoxGeometry(),
    new THREE.MeshBasicMaterial(),
  );
  const next = first.clone();
  faces.update([first], snapshot);
  expect(faces.count).toBe(1);
  faces.setEnabled(false);
  expect(first.getObjectByName("googly-eyes")!.visible).toBe(false);
  expect(first.visible).toBe(true);
  faces.update([first, next], snapshot);
  expect(next.getObjectByName("googly-eyes")!.visible).toBe(false);
  expect(faces.count).toBe(0);
  faces.setEnabled(true);
  expect(first.getObjectByName("googly-eyes")!.visible).toBe(true);
  expect(next.getObjectByName("googly-eyes")!.visible).toBe(true);
  expect(faces.count).toBe(2);
  faces.update([], snapshot);
  first.geometry.dispose();
  (first.material as THREE.Material).dispose();
});

it("gives cloned characters one face, respects ancestor visibility, and keeps a paused target fixed", () => {
  const faces = new GooglyEyes();
  const template = new THREE.Group();
  template.userData.googlyBounds = [0, 15, 0, 7, 5, 8];
  template.add(
    new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()),
  );
  const monster = template.clone(true);
  const parent = new THREE.Group();
  parent.add(monster);
  faces.update([monster], snapshot);
  expect(faces.count).toBe(1);
  const eyes = monster.getObjectByName("googly-eyes") as THREE.Mesh;
  const uniforms = (eyes.material as THREE.ShaderMaterial).uniforms;
  expect(uniforms.boundsCenter.value.toArray()).toEqual([0, 15, 0]);
  faces.update([monster], snapshot);
  expect(uniforms.jet.value.toArray()).toEqual(snapshot.plane.p);
  expect(
    monster.children.filter((child) => child.name === "googly-eyes"),
  ).toHaveLength(1);
  expect(monster.children[0].children).toHaveLength(0);
  parent.visible = false;
  expect(faces.count).toBe(0);
  faces.update([], snapshot);
  const limb = template.children[0] as THREE.Mesh;
  limb.geometry.dispose();
  (limb.material as THREE.Material).dispose();
});

it("locks onto the interpolated jet even with nearby weapons", () => {
  const faces = new GooglyEyes();
  const source = new THREE.Mesh(
    new THREE.BoxGeometry(),
    new THREE.MeshBasicMaterial(),
  );
  faces.update(
    [source],
    {
      ...snapshot,
      lasers: [{ id: 1, p: [1, 2, 3], age: 10, phase: "finishing" }],
      projectiles: [
        { id: 2, p: [5, 6, 7], v: [0, -1, 0], weapon: "nuke", yield: "valley" },
      ],
    },
    new THREE.Vector3(31, 101, 41),
  );
  const eyes = source.getObjectByName("googly-eyes") as THREE.Mesh;
  const uniforms = (eyes.material as THREE.ShaderMaterial).uniforms;
  expect(uniforms.jet.value.toArray()).toEqual([31, 101, 41]);
  faces.update([source], snapshot);
  expect(uniforms.jet.value.toArray()).toEqual(snapshot.plane.p);
  faces.update([], snapshot);
  source.geometry.dispose();
  (source.material as THREE.Material).dispose();
});
