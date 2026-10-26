import * as THREE from "three";
import { expect, it } from "vitest";
import {
  SHADOW_HALF_EXTENTS,
  leadShadowCenter,
  shadowBias,
  shadowExtentIndex,
  snapShadowCenter,
} from "../src/render/shadow-frame";
import { qualityProfile } from "../src/render/quality-profile";
import { EnvironmentLighting } from "../src/render/environment-lighting";

it("keeps the original 440 m box near the ground and grows with altitude", () => {
  expect(SHADOW_HALF_EXTENTS[0]).toBe(220);
  expect(shadowExtentIndex(0, 950)).toBe(0);
  expect(shadowExtentIndex(80, 950)).toBe(0);
  // Ordinary low flight keeps the original box and caster cost.
  expect(shadowExtentIndex(240, 950)).toBe(0);
  const sizes = [0, 200, 400, 800, 1500, 4000].map(
    (h) => SHADOW_HALF_EXTENTS[shadowExtentIndex(h, 950)],
  );
  for (let i = 1; i < sizes.length; i++)
    expect(sizes[i]).toBeGreaterThanOrEqual(sizes[i - 1]);
  expect(sizes.at(-1)).toBe(950);
});

it("respects each quality profile's shadow reach", () => {
  for (let level = 0; level <= 4; level++) {
    const { shadowReach } = qualityProfile("auto", level);
    const half = SHADOW_HALF_EXTENTS[shadowExtentIndex(10000, shadowReach)];
    expect(half).toBeLessThanOrEqual(shadowReach);
  }
  expect(qualityProfile("auto", 4).shadowReach).toBe(220);
  expect(qualityProfile("auto", 0).shadowReach).toBe(460);
  expect(qualityProfile("auto", 0).shadowReach).toBe(
    qualityProfile("auto", 1).shadowReach,
  );
});

it("uses hysteresis so hovering at a threshold does not resize every frame", () => {
  let index = 0;
  const changes: number[] = [];
  for (let frame = 0; frame < 600; frame++) {
    // Oscillate around the altitude that first requests a larger box.
    const height = 270 + Math.sin(frame * 0.3) * 30;
    const next = shadowExtentIndex(height, 950, index);
    if (next !== index) changes.push(frame);
    index = next;
  }
  expect(changes.length).toBeLessThanOrEqual(1);
  // A clear descent still shrinks the box, but only past the margin.
  expect(shadowExtentIndex(0, 950, 4)).toBe(0);
  expect(shadowExtentIndex(200, 950, 1)).toBe(1);
  expect(shadowExtentIndex(150, 950, 1)).toBe(0);
});

it("snaps the box centre to whole texels in the light's view plane", () => {
  const lighting = new EnvironmentLighting();
  for (const hour of [7, 9.5, 12, 15, 17.8, 23]) {
    lighting.update(hour);
    const dir = lighting.lightDirection.clone();
    const texel = 440 / 2048;
    const basis = new THREE.Matrix4().lookAt(
      dir,
      new THREE.Vector3(),
      new THREE.Vector3(0, 1, 0),
    );
    const right = new THREE.Vector3().setFromMatrixColumn(basis, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(basis, 1);
    for (let i = 0; i < 20; i++) {
      const p = new THREE.Vector3(1234.567 + i * 3.71, 88.2, 4567.89 - i * 1.3);
      const before = p.clone();
      snapShadowCenter(p, dir, texel);
      // Only moves within the light plane, by at most half a texel per axis.
      expect(Math.abs(p.clone().sub(before).dot(dir))).toBeLessThan(1e-6);
      expect(p.distanceTo(before)).toBeLessThanOrEqual(texel * Math.SQRT1_2 + 1e-6);
      for (const axis of [right, up]) {
        const t = p.dot(axis) / texel;
        expect(Math.abs(t - Math.round(t))).toBeLessThan(1e-4);
      }
    }
  }
});

it("matches Three's shadow camera basis so snapped texels stay put as the box moves", () => {
  const lighting = new EnvironmentLighting();
  lighting.update(10);
  const dir = lighting.lightDirection;
  const half = 460,
    size = 2048,
    texel = (half * 2) / size;
  const light = new THREE.DirectionalLight();
  light.shadow.mapSize.set(size, size);
  Object.assign(light.shadow.camera, {
    left: -half,
    right: half,
    top: half,
    bottom: -half,
    near: 1,
    far: 4600,
  });
  light.shadow.camera.updateProjectionMatrix();
  const world = new THREE.Vector3(2001.3, 120, 3010.7);
  const texelOf = (center: THREE.Vector3) => {
    light.position.copy(center).addScaledVector(dir, 3000);
    light.target.position.copy(center);
    light.updateMatrixWorld();
    light.target.updateMatrixWorld();
    light.shadow.updateMatrices(light);
    const uv = world.clone().applyMatrix4(light.shadow.matrix);
    return [uv.x * size, uv.y * size];
  };
  const a = texelOf(
    snapShadowCenter(new THREE.Vector3(1990.11, 100, 3000.42), dir, texel),
  );
  const b = texelOf(
    snapShadowCenter(new THREE.Vector3(2017.93, 100, 2981.05), dir, texel),
  );
  // A fixed world point lands on the same sub-texel position in both frames.
  for (const axis of [0, 1]) {
    const shift = a[axis] - b[axis];
    expect(Math.abs(shift - Math.round(shift))).toBeLessThan(1e-3);
  }
});

it("leads larger boxes along the view but keeps the aircraft inside", () => {
  const half = 660;
  const level = leadShadowCenter(
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0, -1),
    half,
  );
  expect(level.z).toBeCloseTo(-half * 0.5);
  expect(Math.abs(level.z)).toBeLessThan(half);
  const down = leadShadowCenter(
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, -1, 0),
    half,
  );
  expect(down.length()).toBe(0);
  const near = leadShadowCenter(
    new THREE.Vector3(5, 0, 5),
    new THREE.Vector3(1, 0, 0),
    SHADOW_HALF_EXTENTS[0],
  );
  expect(near.x).toBe(5); // The original box is not moved.
});

it("keeps the original world-space bias for the smallest box and scales it up", () => {
  const small = shadowBias(440 / 2048),
    large = shadowBias(1900 / 2048);
  expect(small.normalBias).toBeCloseTo(0.5);
  expect(small.bias * 4600).toBeCloseTo(-0.00015 * 2000);
  expect(large.normalBias).toBeGreaterThan(small.normalBias);
  expect(large.bias).toBeLessThan(small.bias);
  expect(large.normalBias).toBeLessThanOrEqual(1.25);
});
