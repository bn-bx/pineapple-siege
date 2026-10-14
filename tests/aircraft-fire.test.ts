import * as THREE from "three";
import { expect, it } from "vitest";
import { AircraftFireView } from "../src/render/aircraft-fire";
import { ResourceDisposal } from "../src/render/resource-disposal";

it("follows the burning aircraft, leaves bounded smoke, freezes on pause and clears after impact", () => {
  const view = new AircraftFireView();
  const position = new THREE.Vector3(1000, 300, 1000);
  const rotation = new THREE.Quaternion();
  for (let i = 0; i < 200; i++) {
    position.x += 5;
    view.update(true, position, rotation, i * 0.06);
  }
  expect(view.flames.count).toBe(6);
  expect(view.smoke.count).toBeGreaterThan(20);
  expect(view.smoke.count).toBeLessThanOrEqual(40);
  const transform = new THREE.Matrix4();
  view.flames.getMatrixAt(0, transform);
  expect(transform.elements[12]).toBeCloseTo(position.x - 1.8);
  const paused = view.smoke.instanceMatrix.array.slice();
  view.update(true, position, rotation, 199 * 0.06);
  expect(view.smoke.instanceMatrix.array).toEqual(paused);
  view.update(false, position, rotation, 12);
  expect(view.flames.count).toBe(0);
  expect(view.smoke.count).toBeGreaterThan(0);
  view.update(false, position, rotation, 15);
  expect(view.smoke.count).toBe(0);
  view.update(true, position, rotation, 16);
  view.reset();
  expect(view.flames.count).toBe(0);
  expect(view.smoke.count).toBe(0);
  const resources = new ResourceDisposal();
  resources.collect(view.group);
  resources.dispose();
});
