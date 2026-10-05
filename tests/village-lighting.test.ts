import { expect, it } from "vitest";
import * as THREE from "three";
import {
  VillageLighting,
  villageDecorations,
} from "../src/render/village-lighting";

it("batches lamps, fades local lighting and immediately extinguishes destroyed sources", () => {
  const village = new VillageLighting([
    { owner: 1, p: [0, 2, 0] },
    { owner: 2, p: [400, 2, 0] },
  ]);
  const removed = new Set<number>();
  const camera = new THREE.Vector3();
  expect(village.mesh.count).toBe(2);
  expect(village.lights).toHaveLength(4);
  expect(village.lights.every((l) => !l.castShadow)).toBe(true);
  village.update(camera, removed, 1, 600, 0.016);
  expect(village.lights[0].intensity).toBeGreaterThan(0);
  expect(village.lights[0].intensity).toBeLessThan(650);
  removed.add(1);
  village.update(camera, removed, 1, 600, 0.016);
  expect(village.lights.every((l) => l.intensity === 0)).toBe(true);
  const m = new THREE.Matrix4();
  village.mesh.getMatrixAt(0, m);
  expect(m.elements[0]).toBe(0);
  removed.clear();
  village.update(camera, removed, 1, 600, 0.016);
  village.mesh.getMatrixAt(0, m);
  expect(m.elements[0]).toBe(1);
  const before = village.lights[0].intensity;
  camera.x = 400;
  village.update(camera, removed, 1, 600, 0.016);
  expect(village.lights[0].position.x).toBe(0);
  expect(village.lights[0].intensity).toBeLessThan(before);
  for (let i = 0; i < 80; i++) village.update(camera, removed, 1, 600, 0.016);
  expect(
    village.lights.some((l) => l.position.x === 400 && l.intensity > 600),
  ).toBe(true);
  village.update(camera, removed, 0, 600, 0.016);
  expect(
    (village.mesh.material as THREE.MeshStandardMaterial).emissiveIntensity,
  ).toBe(0);
  village.mesh.geometry.dispose();
  (village.mesh.material as THREE.Material).dispose();
  village.mesh.dispose();
});

it("retains nearest lights when their distance ranking changes and culls distant lamps", () => {
  const village = new VillageLighting(
    Array.from({ length: 6 }, (_, i) => ({
      owner: i,
      p: [i * 20, 2, 0] as [number, number, number],
    })),
  );
  const removed = new Set<number>();
  const camera = new THREE.Vector3();
  for (let i = 0; i < 80; i++) village.update(camera, removed, 1, 600, 0.016);
  const positions = village.lights.map((l) => l.position.clone());
  camera.x = 20;
  village.update(camera, removed, 1, 600, 0.016);
  expect(village.lights.every((l, i) => l.position.equals(positions[i]))).toBe(
    true,
  );
  camera.x = 2000;
  village.update(camera, removed, 1, 600, 0.016);
  const m = new THREE.Matrix4();
  village.mesh.getMatrixAt(0, m);
  expect(m.elements[0]).toBe(0);
  village.mesh.geometry.dispose();
  (village.mesh.material as THREE.Material).dispose();
  village.mesh.dispose();
});

it("adds house decorations from existing walls and removes them with their owners", () => {
  const walls = [-1, 1].map((side, i) => ({
    id: 10 + i,
    assembly: "hamlet-1-house-0",
    material: "plaster",
    foundation: false,
    p: [0, 6, side * 10],
    s: [2.6, 2, 1],
  }));
  const world = { lights: [], entities: walls } as any;
  const decor = villageDecorations(world);
  expect(decor.windows).toHaveLength(2);
  expect(decor.lamps).toHaveLength(2);
  expect(decor.windows.map((w) => w.owner)).toEqual([10, 11]);
  expect(world.lights).toHaveLength(0);
  expect(world.entities).toHaveLength(2);
  const village = new VillageLighting(decor.lamps, decor.windows);
  village.update(new THREE.Vector3(), new Set(), 1, 600, 0.016);
  expect(
    (village.windows.material as THREE.MeshStandardMaterial).emissiveIntensity,
  ).toBe(2.4);
  village.update(new THREE.Vector3(), new Set([10]), 1, 600, 0.016);
  const matrix = new THREE.Matrix4();
  village.windows.getMatrixAt(0, matrix);
  expect(matrix.elements[0]).toBe(0);
  for (const mesh of [village.mesh, village.windows]) {
    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
    mesh.dispose();
  }
});

it("adds low castle wall lanterns without changing world IDs and extinguishes ground spill", () => {
  const entities = [0, 16, 40].map((x, i) => ({
    id: i,
    assembly: "castle:front",
    material: "sandstone",
    foundation: false,
    p: [x, 8, 0],
    s: [8, 3, 2],
  }));
  const decor = villageDecorations({ entities, lights: [] } as any);
  expect(decor.lamps).toHaveLength(4);
  const village = new VillageLighting(decor.lamps);
  expect(village.pools.count).toBe(4);
  village.update(new THREE.Vector3(), new Set([0]), 1, 600, 0.016);
  const matrix = new THREE.Matrix4();
  village.pools.getMatrixAt(0, matrix);
  expect(matrix.elements[0]).toBe(0);
  village.update(new THREE.Vector3(), new Set(), 0, 600, 0.016);
  expect(village.pools.visible).toBe(false);
});
