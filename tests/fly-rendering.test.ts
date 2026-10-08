import { expect, it } from "vitest";
import * as THREE from "three";
import { FlyView } from "../src/render/fly";
import { ResourceDisposal } from "../src/render/resource-disposal";
import type { FlyState, SimulationSnapshot } from "../src/types";
const state = (): FlyState => ({
  id: 0,
  p: [0, 100, 0],
  v: [0, 0, 0],
  yaw: 0,
  pitch: 0,
  roll: 0,
  health: 3,
  defeated: false,
  mode: "roam",
  timer: 0,
  deathAge: 0,
  phase: 0,
});
const snap = (f: FlyState) => ({ flies: [f] }) as SimulationSnapshot;
it("shares fly resources and renders approximately three jet lengths and wingspans", () => {
  const view = new FlyView();
  expect(view.models).toHaveLength(6);
  const size = new THREE.Box3()
    .setFromObject(view.models[0])
    .getSize(new THREE.Vector3());
  expect(size.z).toBeGreaterThan(40);
  expect(size.z).toBeLessThan(48);
  expect(size.x).toBeGreaterThan(38);
  expect(size.x).toBeLessThan(48);
  expect((view.models[0].children[0] as THREE.Mesh).geometry).toBe(
    (view.models[1].children[0] as THREE.Mesh).geometry,
  );
  const resources = new ResourceDisposal();
  resources.collect(view.group);
  expect(resources.geometries.size).toBe(3);
  expect(resources.materials.size).toBe(4);
  resources.dispose();
});
it("interpolates poses and wrapped angles, animates wings, culls, and resets", () => {
  const view = new FlyView(),
    old = state(),
    current = state();
  old.yaw = Math.PI - 0.1;
  current.yaw = -Math.PI + 0.1;
  current.p[0] = 20;
  current.phase = Math.PI;
  view.update(
    snap(current),
    snap(old),
    0.5,
    new THREE.Vector3(0, 100, 0),
    1200,
  );
  const model = view.models[0];
  expect(model.visible).toBe(true);
  expect(model.position.x).toBe(10);
  expect(model.rotation.y).toBeCloseTo(Math.PI);
  expect(model.getObjectByName("left-wing")!.rotation.z).not.toBe(0);
  const idle = model.rotation.x;
  current.mode = "windup";
  current.timer = 0.3;
  view.update(
    snap(current),
    snap(old),
    0.5,
    new THREE.Vector3(0, 100, 0),
    1200,
  );
  expect(model.rotation.x).not.toBe(idle);
  current.defeated = true;
  current.deathAge = 3.5;
  view.update(snap(current), undefined, 1, new THREE.Vector3(0, 100, 0), 1200);
  expect(model.scale.x).toBe(0.5);
  current.deathAge = 4;
  view.update(snap(current), undefined, 1, new THREE.Vector3(0, 100, 0), 1200);
  expect(model.visible).toBe(false);
  current.deathAge = 0;
  view.update(
    snap(current),
    undefined,
    1,
    new THREE.Vector3(5000, 100, 0),
    1200,
  );
  expect(model.visible).toBe(false);
  view.reset();
  expect(view.models.every((m) => !m.visible)).toBe(true);
});
