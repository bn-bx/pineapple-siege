import { expect, it, vi } from "vitest";
import * as THREE from "three";
import { GameRenderer } from "../src/render/renderer";
it("releases reflection and shadow targets and textures held in shader uniforms", () => {
  const reflection = new THREE.WebGLRenderTarget(8, 8),
    shadow = new THREE.WebGLRenderTarget(8, 8),
    normal = new THREE.DataTexture(new Uint8Array(16), 2, 2);
  const reflectionDisposed = vi.fn(),
    shadowDisposed = vi.fn(),
    normalDisposed = vi.fn();
  reflection.addEventListener("dispose", reflectionDisposed);
  shadow.addEventListener("dispose", shadowDisposed);
  normal.addEventListener("dispose", normalDisposed);
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(),
    new THREE.ShaderMaterial({
      uniforms: {
        mirrorSampler: { value: reflection.texture },
        normalSampler: { value: normal },
      },
    }),
  );
  const view = Object.create(GameRenderer.prototype) as any;
  view.timeline = { reset: vi.fn() };
  view.retired = new Set();
  view.motionFrames = new Map();
  view.scene = new THREE.Scene();
  view.scene.add(water);
  view.water = water;
  view.sun = new THREE.DirectionalLight();
  view.sun.shadow.map = shadow;
  const dispose = vi.fn();
  view.renderer = {
    properties: { get: () => ({ __renderTarget: reflection }) },
    dispose,
  };
  view.gpu = { dispose: vi.fn() };
  view.terrain = {
    dispose: vi.fn(),
    heightTexture: new THREE.Texture(),
    floodTexture: new THREE.Texture(),
  };
  view.effects = { reset: vi.fn(), prewarmMeshes: [] };
  view.batches = [];
  view.ruinGroups = new Map();
  view.eyes = { dispose: vi.fn() };
  view.nearMonsterView = view.distantMonsterView = { disposeFaces: vi.fn() };
  view.dispose();
  expect(reflectionDisposed).toHaveBeenCalledOnce();
  expect(shadowDisposed).toHaveBeenCalledOnce();
  expect(normalDisposed).toHaveBeenCalledOnce();
  expect(dispose).toHaveBeenCalledOnce();
});
