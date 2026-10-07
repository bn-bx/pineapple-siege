import { expect, it } from "vitest";
import * as THREE from "three";
import { makeJet } from "../src/render/assets";
import { jetSurfacePose } from "../src/render/jet-control-surfaces";

it("includes independently named elevator and rudder surfaces on the jet", () => {
  const jet = makeJet();
  for (const name of [
    "aileron-left",
    "aileron-right",
    "elevator-left",
    "elevator-right",
    "rudder-left",
    "rudder-right",
  ])
    expect(jet.getObjectByName(name)).toBeTruthy();
  const geometries = new Set<THREE.BufferGeometry>(),
    materials = new Set<THREE.Material>();
  jet.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    geometries.add(object.geometry);
    for (const material of Array.isArray(object.material)
      ? object.material
      : [object.material])
      materials.add(material);
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
});

it("drives pitch, roll, and wrapped yaw deflection without changing pose", () => {
  expect(
    jetSurfacePose({ pitch: 0.5, roll: 0.6, yaw: -3.12 }, 3.12, 0.1),
  ).toEqual({
    aileronLeft: 0.12,
    aileronRight: -0.12,
    elevator: 0.13,
    rudder: expect.closeTo(0.0238, 4),
  });
  expect(jetSurfacePose({ pitch: 4, roll: 4, yaw: 1 }, undefined, 0)).toEqual({
    aileronLeft: 0.22,
    aileronRight: -0.22,
    elevator: 0.22,
    rudder: 0,
  });
});
