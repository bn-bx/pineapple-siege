import { expect, it, vi } from "vitest";
import * as THREE from "three";
import { GameRenderer } from "../src/render/renderer";
import { qualityProfile } from "../src/render/quality-profile";
it("releases shadow targets and shared textures held in shader uniforms", () => {
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
  view.spikeGeometry = new THREE.BoxGeometry();
  view.spikeMaterial = new THREE.MeshStandardMaterial();
  const spikeGeometryDisposed = vi.fn(),
    spikeMaterialDisposed = vi.fn();
  view.spikeGeometry.addEventListener("dispose", spikeGeometryDisposed);
  view.spikeMaterial.addEventListener("dispose", spikeMaterialDisposed);
  view.scene.add(
    new THREE.Mesh(view.spikeGeometry, view.spikeMaterial),
    new THREE.Mesh(view.spikeGeometry, view.spikeMaterial),
  );
  view.water = water;
  view.environment = {
    sun: new THREE.DirectionalLight(),
    dispose() {
      this.sun.shadow.dispose();
    },
  };
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
  view.effects = { dispose: vi.fn() };
  view.actors = { dispose: vi.fn() };
  view.worldView = { dispose: vi.fn() };
  view.ruinGroups = new Map();
  view.eyes = { dispose: vi.fn() };
  view.nearMonsterView = view.distantMonsterView = { disposeFaces: vi.fn() };
  view.dispose();
  expect(spikeGeometryDisposed).toHaveBeenCalledOnce();
  expect(spikeMaterialDisposed).toHaveBeenCalledOnce();
  expect(reflectionDisposed).not.toHaveBeenCalled();
  expect(shadowDisposed).toHaveBeenCalledOnce();
  expect(normalDisposed).toHaveBeenCalledOnce();
  expect(dispose).toHaveBeenCalledOnce();
});
