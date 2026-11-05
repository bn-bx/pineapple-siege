import * as THREE from "three";
import { expect, it } from "vitest";
import {
  CLOUD_ALTITUDE,
  CloudLayer,
  cloudNoiseData,
} from "../src/render/clouds";
import { OCEAN_BACKGROUND_GLSL } from "../src/render/ocean-horizon";
import { EnvironmentLighting } from "../src/render/environment-lighting";
import { SURFACE_FLIGHT } from "../src/config";

it("builds a deterministic noise texture that tiles without seams", () => {
  const size = 64;
  const a = cloudNoiseData(size),
    b = cloudNoiseData(size);
  expect(a).toEqual(b);
  // Uses the full range so coverage thresholds behave.
  for (const channel of [0, 1]) {
    const values = [...a].filter((_, i) => i % 4 === channel);
    expect(Math.min(...values)).toBe(0);
    expect(Math.max(...values)).toBe(255);
  }
  // Across the wrap, neighbours differ no more than they do anywhere else.
  const texel = (x: number, y: number, c: number) => a[(y * size + x) * 4 + c];
  for (const c of [0, 1]) {
    let edge = 0,
      inner = 0;
    for (let y = 0; y < size; y++) {
      edge += Math.abs(texel(size - 1, y, c) - texel(0, y, c));
      for (let x = 1; x < size; x++) inner += Math.abs(texel(x, y, c) - texel(x - 1, y, c));
    }
    expect(edge / size).toBeLessThan((inner / (size * (size - 1))) * 1.6);
  }
});

it("sits well inside the flight envelope and follows the sky's light", () => {
  // Room to fly both under and well over the layer.
  expect(CLOUD_ALTITUDE).toBeGreaterThan(1500);
  expect(SURFACE_FLIGHT.ceiling).toBeGreaterThan(CLOUD_ALTITUDE + 1500);
  expect(OCEAN_BACKGROUND_GLSL).toContain("vec3 skyClouds(vec3 d, vec3 sky)");
  const layer = new CloudLayer();
  const lighting = new EnvironmentLighting();
  lighting.update(12);
  layer.update(100, lighting);
  const noon = layer.uniforms.cloudLit.value.clone();
  expect(layer.uniforms.cloudCover.value).toBeGreaterThan(0.25);
  expect(layer.uniforms.cloudCover.value).toBeLessThan(0.7);
  lighting.update(0);
  layer.update(100, lighting);
  expect(layer.uniforms.cloudLit.value.r).toBeLessThan(noon.r * 0.3);
  // Drift moves with time.
  const offset = layer.uniforms.cloudOffset.value.clone();
  layer.update(160, lighting);
  expect(layer.uniforms.cloudOffset.value.distanceTo(offset)).toBeGreaterThan(100);
  layer.dispose();
});

it("draws no clouds in Hell", () => {
  const layer = new CloudLayer(false);
  const lighting = new EnvironmentLighting();
  lighting.update(12);
  layer.update(50, lighting);
  expect(layer.uniforms.cloudCover.value).toBe(0);
  expect(layer.texture).toBeInstanceOf(THREE.DataTexture);
  layer.dispose();
});

it("shows the deck from above, hands over to the sky with distance, and whites out inside", () => {
  const layer = new CloudLayer();
  const lighting = new EnvironmentLighting();
  lighting.update(12);
  layer.update(0, lighting);
  const camera = new THREE.PerspectiveCamera(60, 1, 0.5, 20000);
  camera.position.set(4000, 1000, 4000);
  layer.place(camera);
  expect(layer.deck.visible).toBe(false);
  camera.position.y = CLOUD_ALTITUDE + 1500;
  layer.place(camera);
  expect(layer.deck.visible).toBe(true);
  expect(layer.deck.position.x).toBe(4000);
  expect(layer.uniforms.cloudFadeFar.value).toBeLessThan(camera.far);
  expect(layer.uniforms.cloudFadeNear.value).toBeLessThan(layer.uniforms.cloudFadeFar.value);
  expect(layer.whiteout.visible).toBe(false);
  // Find a thick spot and fly into it.
  let x = 0;
  while (layer.densityAt(x, 0) < 0.9 && x < 40000) x += 50;
  camera.position.set(x, CLOUD_ALTITUDE + 10, 0);
  layer.place(camera);
  expect(layer.whiteout.visible).toBe(true);
  expect(layer.whiteout.material.uniforms.whiteout.value).toBeGreaterThan(0.6);
  // Clear sky at the same height: no veil.
  let clear = 0;
  while (layer.densityAt(clear, 0) > 0 && clear < 40000) clear += 50;
  camera.position.set(clear, CLOUD_ALTITUDE, 0);
  layer.place(camera);
  expect(layer.whiteout.visible).toBe(false);
  layer.dispose();
  // Hell never shows the deck.
  const hell = new CloudLayer(false);
  camera.position.set(4000, CLOUD_ALTITUDE + 500, 4000);
  hell.place(camera);
  expect(hell.deck.visible).toBe(false);
  hell.dispose();
});
