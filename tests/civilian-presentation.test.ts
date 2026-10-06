import { expect, it } from "vitest";
import * as THREE from "three";
import { CivilianView } from "../src/render/civilians";
import type { SimulationSnapshot } from "../src/types";

const snapshot = (time: number, alive: boolean) =>
  ({
    time,
    civilians: [
      { id: 0, p: [0, 10, 0], yaw: 0, alive, mood: "walk", phase: 0 },
    ],
    lasers: [],
  }) as unknown as SimulationSnapshot;
const camera = new THREE.Vector3(0, 20, 20);
function torso(view: CivilianView) {
  const mesh = view.group.children[0] as THREE.InstancedMesh;
  const matrix = new THREE.Matrix4();
  if (mesh.count) mesh.getMatrixAt(0, matrix);
  return { count: mesh.count, matrix };
}

it("collapses new casualties on simulation time, follows excavated terrain and retires without replay", () => {
  const view = new CivilianView(1),
    alive = snapshot(1, true),
    dead = snapshot(2, false);
  view.update(dead, alive, 1, camera, 1200, undefined, () => 10);
  expect(torso(view).count).toBe(1);
  const later = snapshot(3, false);
  view.update(later, dead, 1, camera, 1200, undefined, () => 10);
  const paused = torso(view).matrix.clone();
  view.update(later, dead, 0, camera, 1200, undefined, () => 10);
  expect(torso(view).matrix.elements).toEqual(paused.elements);
  view.update(snapshot(4, false), dead, 1, camera, 1200, undefined, () => -20);
  expect(torso(view).matrix.elements[13]).toBeLessThan(paused.elements[13]);
  view.update(snapshot(8, false), alive, 1, camera);
  expect(torso(view).count).toBe(0);
  // A retained previous snapshot cannot restart the expired presentation.
  view.update(snapshot(9, false), alive, 1, camera);
  expect(torso(view).count).toBe(0);
});

it("does not replay saved casualties and clears defeat presentation on reset or restoration", () => {
  const view = new CivilianView(1),
    alive = snapshot(1, true),
    dead = snapshot(2, false);
  view.update(dead, undefined, 1, camera);
  expect(torso(view).count).toBe(0);
  view.reset();
  view.update(dead, alive, 1, camera);
  expect(torso(view).count).toBe(1);
  view.reset();
  expect(torso(view).count).toBe(0);
  view.update(dead, undefined, 1, camera);
  expect(torso(view).count).toBe(0);
  view.update(alive, dead, 1, camera);
  expect(torso(view).count).toBe(1);
  view.update(snapshot(10, false), alive, 1, camera);
  expect(torso(view).count).toBe(1);
});
it("keeps cheering hands above the head and clothing identity after culling", () => {
  const view = new CivilianView(2);
  const cheering = snapshot(1, true);
  cheering.civilians[0].mood = "cheer";
  view.update(cheering, undefined, 1, camera);
  const matrix = new THREE.Matrix4();
  const hands = view.group.children[7] as THREE.InstancedMesh;
  hands.getMatrixAt(0, matrix);
  expect(matrix.elements[13]).toBeGreaterThan(14.5);
  expect(hands.count).toBe(2);
  const boots = view.group.children[8] as THREE.InstancedMesh;
  expect(boots.count).toBe(2);
  const selected = snapshot(2, true);
  selected.civilians[0].p[0] = 500;
  selected.civilians.push({
    ...selected.civilians[0],
    id: 1,
    p: [0, 10, 0],
    mood: "walk",
  });
  view.update(selected, undefined, 1, camera, 120);
  const color = new THREE.Color();
  (view.group.children[0] as THREE.InstancedMesh).getColorAt(0, color);
  expect(color.getHex()).toBe(0x607e86);
  (view.group.children[1] as THREE.InstancedMesh).getColorAt(0, color);
  expect(color.getHex()).toBe(0xc99770);
});
it("limits distant clothing tint to garments and retains hands and boots", () => {
  const view = new CivilianView(1);
  view.installVisuals();
  const far = view.group.children.at(-1) as THREE.InstancedMesh;
  const mask = far.geometry.getAttribute("clothMask");
  expect(Array.from(mask.array)).toContain(0);
  expect(Array.from(mask.array)).toContain(1);
  const shader = { uniforms: {}, vertexShader: "#include <common>\n#include <color_vertex>", fragmentShader: "" } as any;
  (far.material as THREE.Material).onBeforeCompile(shader, {} as any);
  expect(shader.vertexShader).toContain("mix(color.rgb,vColor.rgb,clothMask)");
  expect(view.group.children).toHaveLength(10);
});
