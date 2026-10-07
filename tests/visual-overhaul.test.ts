import { expect, it, vi } from "vitest";
import * as THREE from "three";
import { textureBytes, sceneResources } from "../src/render/resource-budget";
import { qualityProfile, VISUAL_BUDGET } from "../src/render/quality-profile";
import { SimulationCadence } from "../src/simulation-cadence";
import { CONFIG } from "../src/config";
it("estimates shared and detached resident resources once, including shader textures", () => {
  const texture = new THREE.DataTexture(new Uint8Array(64), 4, 4);
  texture.generateMipmaps = false;
  const scene = new THREE.Scene(),
    geometry = new THREE.BoxGeometry();
  scene.add(
    new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ map: texture })),
    new THREE.Mesh(
      geometry,
      new THREE.ShaderMaterial({ uniforms: { shared: { value: texture } } }),
    ),
  );
  expect(textureBytes(texture)).toBe(64);
  expect(sceneResources(scene, [texture, texture]).residentTextureBytes).toBe(
    64,
  );
  expect(sceneResources(scene).geometryBytes).toBeGreaterThan(0);
  expect(VISUAL_BUDGET.targetBytes).toBe(64 * 1048576);
});
it("measures sustained simulation speed and discards paused/reset wall time", () => {
  const cadence = new SimulationCadence();
  cadence.sample(0, 0, true);
  expect(cadence.sample(5000, 5, true)).toBe(1);
  expect(cadence.sample(10000, 9, true)).toBeCloseTo(0.8);
  cadence.sample(20000, 9, false);
  cadence.sample(25000, 9, true);
  expect(cadence.sample(30000, 14, true)).toBe(1);
  cadence.sample(31000, 0, true);
  expect(cadence.sample(36000, 5, true)).toBe(1);
});
