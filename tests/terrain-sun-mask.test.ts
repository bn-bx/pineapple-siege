import * as THREE from "three";
import { expect, it } from "vitest";
import {
  computeSunMask,
  raiseCasters,
} from "../src/render/terrain-sun-mask-core";
import { SUN_MASK_SIZE, TerrainSunMask } from "../src/render/terrain-sun-mask";
import type { Entity } from "../src/types";

const n = 64,
  cell = 10;
/** A flat plain with one tall square block at the centre. */
function plainWithTower(height = 200, half = 3) {
  const h = new Float32Array(n * n).fill(10);
  for (let j = 32 - half; j < 32 + half; j++)
    for (let i = 32 - half; i < 32 + half; i++) h[j * n + i] = height;
  return h;
}
const sun = (elevationDeg: number, azimuthDeg: number) => {
  const e = (elevationDeg * Math.PI) / 180,
    a = (azimuthDeg * Math.PI) / 180;
  return { x: Math.cos(e) * Math.cos(a), y: Math.sin(e), z: Math.cos(e) * Math.sin(a) };
};
const at = (m: Uint8Array, i: number, j: number) => m[j * n + i];

it("casts a shadow away from the sun, with length set by sun elevation", () => {
  const h = plainWithTower();
  // Sun in +x: the shadow falls toward -x.
  const low = computeSunMask(h, n, cell, sun(20, 0));
  expect(at(low, 32 + 10, 32)).toBe(255); // sunward side lit
  expect(at(low, 32 - 10, 32)).toBe(0); // behind the tower
  expect(at(low, 32, 32 + 15)).toBe(255); // off to the side lit
  // tan(20°)≈0.36: a 190 m tower shades ~520 m, past the grid's west edge.
  expect(at(low, 0, 32)).toBe(0);
  const high = computeSunMask(h, n, cell, sun(60, 0));
  // tan(60°)≈1.73: only ~110 m (11 texels).
  expect(at(high, 32 - 3 - 8, 32)).toBe(0);
  expect(at(high, 32 - 3 - 16, 32)).toBe(255);
});

it("follows the sun's azimuth", () => {
  const h = plainWithTower();
  const north = computeSunMask(h, n, cell, sun(25, 90)); // sun toward +z
  expect(at(north, 32, 32 - 12)).toBe(0);
  expect(at(north, 32, 32 + 12)).toBe(255);
  const diagonal = computeSunMask(h, n, cell, sun(25, 45));
  expect(at(diagonal, 32 - 9, 32 - 9)).toBe(0);
  expect(at(diagonal, 32 + 9, 32 + 9)).toBe(255);
});

it("leaves flat or gently sloped ground fully lit and an overhead sun casts nothing", () => {
  const flat = new Float32Array(n * n).fill(25);
  expect(computeSunMask(flat, n, cell, sun(10, 30)).every((v) => v === 255)).toBe(true);
  const slope = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) slope[j * n + i] = i * 2;
  // Ground rising toward the sun at a gentler angle than the sun stays lit.
  expect(computeSunMask(slope, n, cell, sun(30, 0)).every((v) => v === 255)).toBe(true);
  const tower = plainWithTower();
  expect(computeSunMask(tower, n, cell, { x: 0, y: 1, z: 0 }).every((v) => v === 255)).toBe(true);
});

it("fades monotonically from deep shadow back to full light", () => {
  const h = plainWithTower();
  const m = computeSunMask(h, n, cell, sun(60, 0));
  const row = Array.from({ length: n }, (_, i) => at(m, i, 32));
  // (Edges are as sharp as one texel here; the GPU's linear filtering
  // blends across a texel, 18 m in game.)
  const tail = row.slice(0, 32 - 3).reverse();
  for (let i = 1; i < tail.length; i++) expect(tail[i]).toBeGreaterThanOrEqual(tail[i - 1]);
  expect(tail[0]).toBe(0);
  expect(tail.at(-1)).toBe(255);
});

it("raises statue footprints so they cast like terrain", () => {
  const h = new Float32Array(n * n).fill(0);
  raiseCasters(h, n, cell, [{ x: 320, z: 320, halfWidth: 25, top: 400 }]);
  expect(h[32 * n + 32]).toBe(400);
  expect(h[32 * n + 40]).toBe(0);
  const m = computeSunMask(h, n, cell, sun(35, 180)); // sun toward -x
  expect(at(m, 32 + 15, 32)).toBe(0);
  expect(at(m, 32 - 15, 32)).toBe(255);
});

it("recomputes only when the light turns, the terrain changes, or statue parts fall", () => {
  const heights = plainWithTower();
  const terrain = {
    surfaceRevision: 0,
    sample: (x: number, z: number) => {
      // The real mask grid is 512²; map it onto the small test plain.
      const i = Math.min(n - 1, Math.floor((x / 9216) * n));
      const j = Math.min(n - 1, Math.floor((z / 9216) * n));
      return heights[j * n + i];
    },
  };
  const statue = [
    { id: 7, p: [1000, 300, 1000], s: [100, 600, 100] } as unknown as Entity,
  ];
  const mask = new TerrainSunMask(9216, terrain, statue, false);
  const light = new THREE.Vector3().copy(sun(30, 10) as THREE.Vector3);
  const removed = new Set<number>();
  // Height rebuilds are spread over frames (64 of 512 rows each).
  const settle = (t: number) => {
    let frames = 0;
    do {
      mask.update(light, t, removed);
      frames++;
    } while (mask.rebuilding);
    return frames;
  };
  expect(settle(0)).toBe(8);
  expect(mask.frameSampleMS).toBeLessThan(mask.sampleMS);
  expect(mask.jobs).toBe(1);
  mask.update(light, 0.1, removed);
  expect(mask.jobs).toBe(1);
  // A quarter degree is below the refresh step; one degree is above it.
  light.applyAxisAngle(new THREE.Vector3(0, 1, 0), (0.25 * Math.PI) / 180);
  mask.update(light, 0.2, removed);
  expect(mask.jobs).toBe(1);
  light.applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 180);
  mask.update(light, 0.3, removed);
  expect(mask.jobs).toBe(2);
  // Terrain edits are coalesced to one rebuild per two seconds.
  terrain.surfaceRevision++;
  mask.update(light, 0.4, removed);
  expect(mask.jobs).toBe(2);
  settle(2.5);
  expect(mask.jobs).toBe(3);
  removed.add(7);
  settle(2.6);
  expect(mask.jobs).toBe(4);
  const data = mask.texture.image.data as Uint8Array;
  expect(data.length).toBe(SUN_MASK_SIZE * SUN_MASK_SIZE);
  expect(data.some((v) => v < 255)).toBe(true);
  mask.dispose();
});

it("darkens only direct light in installed standard materials", () => {
  const terrain = { surfaceRevision: 0, sample: () => 0 };
  const mask = new TerrainSunMask(9216, terrain, [], false);
  const material = new THREE.MeshStandardMaterial();
  const before = material.customProgramCacheKey();
  mask.install(material);
  mask.install(material);
  expect(material.customProgramCacheKey()).toBe(`${before}:sun-mask-v1`);
  const shader = {
    uniforms: {} as Record<string, THREE.IUniform>,
    vertexShader: "void main(){\n#include <project_vertex>\n}",
    fragmentShader: "void main(){\n#include <lights_fragment_end>\n#include <opaque_fragment>\n}",
  };
  material.onBeforeCompile(shader as never, undefined as never);
  expect(shader.uniforms.sunMaskMap.value).toBe(mask.texture);
  expect(shader.vertexShader).toContain("vSunMaskXZ = (modelMatrix * sunMaskPosition).xz;");
  expect(shader.fragmentShader).toContain("reflectedLight.directDiffuse *= sunMask;");
  expect(shader.fragmentShader).not.toContain("indirectDiffuse *= sunMask");
  // Excluded materials (water) and basic (unlit) materials are left alone.
  const water = new THREE.MeshStandardMaterial();
  const waterKey = water.customProgramCacheKey();
  mask.exclude(water);
  mask.install(water);
  expect(water.customProgramCacheKey()).toBe(waterKey);
  const basic = new THREE.MeshBasicMaterial();
  const key = basic.customProgramCacheKey();
  mask.install(basic);
  expect(basic.customProgramCacheKey()).toBe(key);
  mask.dispose();
});
