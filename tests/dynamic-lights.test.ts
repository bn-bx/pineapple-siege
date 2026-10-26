import * as THREE from "three";
import { expect, it } from "vitest";
import {
  DYNAMIC_LIGHT_CANDIDATES,
  DYNAMIC_LIGHT_SLOTS,
  DynamicLights,
  MUZZLE_FLASH_TIME,
  MuzzleFlashes,
  dynamicLightFalloff,
  explosionLight,
  fireLight,
  fuelLight,
} from "../src/render/dynamic-lights";
import { TerrainSunMask } from "../src/render/terrain-sun-mask";
import { qualityProfile } from "../src/render/quality-profile";
import { WindowGlow } from "../src/render/window-glow";
import type { Entity } from "../src/types";

function camera() {
  const c = new THREE.PerspectiveCamera(60, 16 / 9, 1, 20000);
  c.position.set(0, 100, 0);
  c.lookAt(0, 100, -1);
  c.updateMatrixWorld();
  return c;
}

it("patches standard materials once, after the sun mask and before AO", () => {
  const lights = new DynamicLights();
  const mask = new TerrainSunMask(9216, { surfaceRevision: 0, sample: () => 0 }, [], false);
  const material = new THREE.MeshStandardMaterial();
  const key = material.customProgramCacheKey();
  mask.install(material);
  lights.install(material);
  lights.install(material);
  expect(material.customProgramCacheKey()).toBe(`${key}:sun-mask-v1:dynamic-lights-v1`);
  const shader = {
    uniforms: {} as Record<string, THREE.IUniform>,
    vertexShader: "void main(){\n#include <project_vertex>\n}",
    fragmentShader:
      "void main(){\n#include <lights_fragment_end>\n#include <aomap_fragment>\n#include <opaque_fragment>\n}",
  };
  material.onBeforeCompile(shader as never, undefined as never);
  const f = shader.fragmentShader;
  expect(f).toContain("uniform int dynamicLightCount;");
  expect(f.indexOf("reflectedLight.directDiffuse *= sunMask")).toBeLessThan(
    f.indexOf("dynamicLightColor[ i ]"),
  );
  expect(f.indexOf("dynamicLightColor[ i ]")).toBeLessThan(f.indexOf("#include <aomap_fragment>"));
  expect(f).toContain("if ( i >= dynamicLightCount ) break;");
  // Uniforms are shared objects, so one upload per frame reaches every material.
  expect(shader.uniforms.dynamicLightCount).toBe(lights.uniforms.dynamicLightCount);
  // Unlit materials are left alone.
  const basic = new THREE.MeshBasicMaterial();
  const basicKey = basic.customProgramCacheKey();
  lights.install(basic);
  expect(basic.customProgramCacheKey()).toBe(basicKey);
  mask.dispose();
});

it("fills the slots with the brightest lights in view and uploads them in view space", () => {
  const lights = new DynamicLights();
  const cam = camera();
  lights.begin();
  // Ahead of the camera: near/bright, far/dim, and one behind the camera.
  lights.add(0, 100, -200, "#ffffff", 8, 60);
  lights.add(0, 100, -3000, "#ffffff", 2, 60);
  lights.add(0, 100, 900, "#ffffff", 50, 60);
  for (let i = 0; i < 12; i++) lights.add(40 * i, 100, -600, "#ff8800", 3, 50);
  lights.commit(cam, 4);
  expect(lights.uniforms.dynamicLightCount.value).toBe(4);
  expect(lights.chosen[0]).toBe(0);
  expect(lights.chosen).not.toContain(2); // behind the camera
  expect(lights.chosen).not.toContain(1); // far and dim
  const p = lights.uniforms.dynamicLightPosition.value[0];
  expect(p.x).toBeCloseTo(0, 4);
  expect(p.y).toBeCloseTo(0, 4);
  expect(p.z).toBeCloseTo(-200, 3);
  expect(p.w).toBe(60);
  expect(lights.uniforms.dynamicLightColor.value[0].x).toBeCloseTo(8);
  // Fewer slots on lower quality, never more than the shader has.
  lights.commit(cam, 2);
  expect(lights.uniforms.dynamicLightCount.value).toBe(2);
  lights.commit(cam, 99);
  expect(lights.uniforms.dynamicLightCount.value).toBeLessThanOrEqual(DYNAMIC_LIGHT_SLOTS);
  lights.commit(cam, 0);
  expect(lights.uniforms.dynamicLightCount.value).toBe(0);
  lights.clear();
  expect(lights.uniforms.dynamicLightCount.value).toBe(0);
});

it("ignores dark lights, caps candidates, and scales by strength", () => {
  const lights = new DynamicLights();
  lights.begin();
  lights.add(0, 0, 0, "#fff", 0, 10);
  lights.add(0, 0, 0, "#fff", 1, 0);
  expect(lights.count).toBe(0);
  for (let i = 0; i < DYNAMIC_LIGHT_CANDIDATES + 20; i++) lights.add(0, 0, 0, "#fff", 1, 10);
  expect(lights.count).toBe(DYNAMIC_LIGHT_CANDIDATES);
  lights.begin();
  lights.strength = 0.5;
  lights.add(0, 0, 0, "#ffffff", 4, 10);
  expect(lights.candidates[0].r).toBeCloseTo(2);
});

it("draws halos only for fires", () => {
  const lights = new DynamicLights();
  const cam = camera();
  lights.begin();
  lights.add(0, 100, -200, "#ffffff", 8, 60); // explosion: has its own flash
  lights.add(10, 100, -200, "#ff7428", 3, 60, true);
  lights.add(5000, 100, -200, "#ff7428", 3, 60, true); // off-screen still glows if in view later
  lights.commit(cam, 8, 1);
  expect(lights.halos.points.geometry.drawRange.count).toBe(2);
  lights.commit(cam, 8, 0);
  expect(lights.halos.points.geometry.drawRange.count).toBe(0);
});

it("falls off smoothly to zero at the range", () => {
  expect(dynamicLightFalloff(0, 50)).toBe(1);
  expect(dynamicLightFalloff(50, 50)).toBe(0);
  expect(dynamicLightFalloff(80, 50)).toBe(0);
  let last = 1;
  for (let d = 1; d <= 50; d++) {
    const v = dynamicLightFalloff(d, 50);
    expect(v).toBeLessThanOrEqual(last);
    last = v;
  }
  // Nearly flat close in, so a light lifted above the ground has no hot spot.
  expect(dynamicLightFalloff(5, 50)).toBeGreaterThan(0.98);
});

it("gives nukes the widest, brightest light and fades every flash out", () => {
  const nuke = explosionLight("nuke", false, 150, 1);
  const blast = explosionLight("blast", false, 12, 1);
  const fuel = explosionLight("fuel", false, 80, 1);
  expect(nuke.intensity).toBeGreaterThan(fuel.intensity);
  expect(nuke.intensity).toBeGreaterThan(blast.intensity);
  // Fuel burns longer and wider; a cannon blast is a brief, brighter pop.
  expect(fuel.range * fuel.intensity).toBeGreaterThan(blast.range * blast.intensity);
  expect(nuke.range).toBeGreaterThanOrEqual(900);
  expect(fuel.range).toBeGreaterThan(blast.range);
  for (const kind of ["nuke", "fuel", "blast", "crash"] as const)
    expect(explosionLight(kind, false, 20, 0).intensity).toBe(0);
  // Dust from collapses and small impacts does not glow.
  expect(explosionLight("collapse", false, 8, 1).intensity).toBe(0);
  expect(explosionLight("impact", false, 7, 1).intensity).toBe(0);
  // Water splashes are dimmer and cooler.
  const splash = explosionLight("blast", true, 12, 1);
  expect(splash.intensity).toBeLessThan(blast.intensity);
  // A nuke starts white and ends orange.
  const start = new THREE.Color(explosionLight("nuke", false, 150, 1).color);
  const end = new THREE.Color(explosionLight("nuke", false, 150, 0.05).color);
  expect(start.b).toBeGreaterThan(end.b);
});

it("flickers fires within bounds and fades them with remaining life", () => {
  const patch = { p: [100, 20, 50] as [number, number, number], radius: 20, height: 12, seed: 3 };
  let min = Infinity,
    max = 0;
  for (let t = 0; t < 10; t += 0.05) {
    const l = fireLight(patch, t);
    min = Math.min(min, l.intensity);
    max = Math.max(max, l.intensity);
    expect(l.y).toBeGreaterThan(patch.p[1]);
  }
  expect(max - min).toBeGreaterThan(0.2);
  expect(max).toBeLessThanOrEqual(3.2);
  expect(fireLight(patch, 1, 0).intensity).toBe(0);
  expect(fireLight(patch, 1, 0.5).intensity).toBeCloseTo(fireLight(patch, 1, 1).intensity / 2);
  expect(fireLight(patch, 1, 1, true).y).toBeLessThan(patch.p[1]);
  expect(fuelLight({ radius: 2, landed: true, burning: false })).toBeUndefined();
  expect(fuelLight({ radius: 2, landed: true, burning: true })!.range).toBeGreaterThanOrEqual(18);
});

it("flashes once per new cannon shot and keeps a glow on nukes in flight", () => {
  const lights = new DynamicLights();
  const muzzle = new MuzzleFlashes();
  const shot = { id: 1, p: [0, 50, 0], weapon: "cannon" };
  lights.begin();
  muzzle.update([shot], 0.016, lights);
  expect(lights.count).toBe(1);
  let frames = 0;
  for (let t = 0; t < 0.5; t += 0.016) {
    lights.begin();
    muzzle.update([shot], 0.016, lights);
    if (lights.count) frames++;
  }
  expect(frames).toBeLessThanOrEqual(Math.ceil(MUZZLE_FLASH_TIME / 0.016));
  lights.begin();
  muzzle.update([{ id: 2, p: [0, 50, 0], weapon: "nuke" }], 0.016, lights);
  expect(lights.count).toBe(1);
  lights.begin();
  muzzle.update([{ id: 2, p: [0, 60, 0], weapon: "nuke" }], 0.016, lights);
  expect(lights.count).toBe(1);
  muzzle.reset();
});

it("gives each quality level a fixed light budget", () => {
  const counts = [0, 1, 2, 3, 4].map((level) => qualityProfile("auto", level).dynamicLights);
  expect(counts[0]).toBe(DYNAMIC_LIGHT_SLOTS);
  for (let i = 1; i < counts.length; i++) expect(counts[i]).toBeLessThanOrEqual(counts[i - 1]);
  expect(counts[4]).toBeGreaterThan(0);
});

it("glows intact windows at night only", () => {
  const block = (id: number, material: string, visual = false) =>
    ({
      id,
      kind: "block",
      p: [id * 10, 5, 0],
      s: [1, 1.5, 0.2],
      material,
      ...(visual ? { visual: { shape: "box" } } : {}),
    }) as unknown as Entity;
  const glow = new WindowGlow([
    block(1, "window"),
    block(2, "window"),
    block(3, "stone"),
    block(4, "window", true),
  ]);
  expect(glow.windows.length).toBe(2);
  const removed = new Set<number>();
  glow.update(0, removed, 800);
  expect(glow.count).toBe(2);
  expect(glow.points.visible).toBe(false);
  glow.update(1, removed, 800);
  expect(glow.points.visible).toBe(true);
  removed.add(1);
  glow.update(1, removed, 800);
  expect(glow.count).toBe(1);
  expect(glow.points.geometry.attributes.position.array[0]).toBe(20);
  removed.clear();
  removed.add(2);
  glow.invalidate();
  glow.update(1, removed, 800);
  expect(glow.points.geometry.attributes.position.array[0]).toBe(10);
});
