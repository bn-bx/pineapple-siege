import { expect, it } from "vitest";
import * as THREE from "three";
import { DiscoEnvelope, DiscoShow } from "../src/render/disco-show";
import { ResourceDisposal } from "../src/render/resource-disposal";
import type { LaserStrike } from "../src/types";
const strike = (phase: LaserStrike["phase"], age: number) =>
  ({ id: 1, phase, age, p: [0, 0, 0] }) as LaserStrike;
it("builds from charging, freezes at the same simulation time, and fades after removed strikes", () => {
  const show = new DiscoEnvelope();
  expect(show.update([], 0)).toBe(0);
  expect(show.update([strike("charging", 0)], 1)).toBe(0);
  expect(show.update([strike("charging", 2)], 3)).toBeCloseTo(0.5);
  expect(show.update([strike("burning", 5)], 6)).toBe(1);
  expect(show.update([strike("burning", 5)], 6)).toBe(1);
  expect(show.update([], 10)).toBe(1);
  expect(show.update([], 10.5)).toBeCloseTo(0.5);
  expect(show.update([], 11)).toBe(0);
});
it("restores finishing fades, does not stack beams, and keeps tails under new charges", () => {
  const show = new DiscoEnvelope();
  expect(show.update([strike("finishing", 9.5)], 30)).toBeCloseTo(0.5);
  show.reset();
  expect(
    show.update(
      Array.from({ length: 200 }, () => strike("burning", 8)),
      8,
    ),
  ).toBe(1);
  expect(show.update([strike("charging", 1.5)], 9.5)).toBeCloseTo(0.5);
  expect(show.update([strike("charging", 2)], 10)).toBeCloseTo(0.5);
  show.reset();
  expect(show.update([], 10)).toBe(0);
  expect(show.update([strike("burning", 5)], 20)).toBe(1);
  expect(show.update([], 0)).toBe(0);
});
it("bounds disco rendering across strike counts and quality changes, and releases resources", () => {
  const show = new DiscoShow(9216);
  expect(show.group.position.toArray()).toEqual([4608, 1900, 4608]);
  const count = () => {
    let n = 0;
    show.group.traverse(() => n++);
    return n;
  };
  const initial = count();
  show.update(
    Array.from({ length: 500 }, () => strike("burning", 5)),
    5,
    false,
  );
  expect(show.group.visible).toBe(true);
  expect(count()).toBe(initial);
  const instances: THREE.InstancedMesh[] = [];
  show.group.traverse((o) => {
    if (o instanceof THREE.InstancedMesh) instances.push(o);
  });
  expect(instances.map((o) => o.count)).toEqual([1152, 32]);
  show.update([strike("burning", 5)], 5, true);
  expect(instances.map((o) => o.count)).toEqual([288, 12]);
  expect(show.uniforms.discoTime.value).toBe(5);
  show.reset();
  expect(show.group.visible).toBe(false);
  expect(show.uniforms.discoStrength.value).toBe(0);
  const resources = new ResourceDisposal();
  resources.collect(show.group);
  expect(resources.geometries.size).toBe(3);
  const disposed: number[] = [];
  for (const geo of resources.geometries)
    geo.addEventListener("dispose", () => disposed.push(1));
  resources.dispose();
  expect(disposed).toHaveLength(3);
});
it("chains receiving-material shader hooks without duplicating projections", () => {
  const show = new DiscoShow(9216),
    material = new THREE.MeshStandardMaterial();
  let priorCalls = 0;
  material.onBeforeCompile = () => {
    priorCalls++;
  };
  show.install(material);
  show.install(material);
  const shader = {
    uniforms: {},
    vertexShader: "void main(){#include <project_vertex>}",
    fragmentShader: "void main(){#include <opaque_fragment>}",
  };
  material.onBeforeCompile(shader as any, {} as any);
  expect(priorCalls).toBe(1);
  expect(shader.uniforms).toHaveProperty(
    "discoStrength",
    show.uniforms.discoStrength,
  );
  expect(shader.vertexShader).toContain("instanceMatrix * discoPosition");
  expect(shader.fragmentShader).toContain("outgoingLight +=");
});
