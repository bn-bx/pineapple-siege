import { expect, it, vi } from "vitest";
import * as THREE from "three";
import { GPUTimer, PerformanceMonitor } from "../src/performance";
import { GameRenderer } from "../src/render/renderer";

it("abandons old context queries without GL calls and reacquires timing support", () => {
  const extension = { TIME_ELAPSED_EXT: 1, GPU_DISJOINT_EXT: 2 };
  const gl = {
    getExtension: vi.fn(() => extension),
    createQuery: vi.fn(() => ({})),
    beginQuery: vi.fn(),
    endQuery: vi.fn(),
    deleteQuery: vi.fn(),
    getParameter: vi.fn(() => false),
    getQueryParameter: vi.fn(() => true),
  };
  const timer = new GPUTimer(gl as any, new PerformanceMonitor());
  timer.begin("gpu");
  timer.end();
  timer.begin("gpu");
  timer.contextLost();
  timer.poll();
  timer.end();
  timer.dispose();
  expect(gl.deleteQuery).not.toHaveBeenCalled();
  expect(gl.getQueryParameter).not.toHaveBeenCalled();
  expect(gl.endQuery).toHaveBeenCalledTimes(1);
  timer.contextRestored();
  expect(gl.getExtension).toHaveBeenCalledTimes(2);
  timer.begin("gpu");
  timer.end();
  timer.poll();
  expect(gl.deleteQuery).toHaveBeenCalledOnce();
});

it("shares paused warmup ownership and restores scene state when interrupted", async () => {
  const mesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(),
    new THREE.MeshBasicMaterial(),
    1,
  );
  mesh.visible = false;
  mesh.count = 0;
  const view = Object.create(GameRenderer.prototype) as any;
  view.scene = new THREE.Scene();
  view.scene.add(mesh);
  view.camera = new THREE.PerspectiveCamera();
  view.terrain = {
    heightTexture: {},
    floodTexture: {},
    fullTextureUpload: vi.fn(),
  };
  view.effects = { prewarm: vi.fn(), prewarmMeshes: [] };
  view.fallenCanopy = vi.fn();
  view.batches = [];
  view.fragmentMaterials = {};
  view.renderer = {
    initTexture: vi.fn(),
    compile: vi.fn(() => new Set([mesh.material])),
    properties: { get: () => ({ currentProgram: { isReady: () => false } }) },
    shadowMap: {},
    render: vi.fn(),
  };
  const a = view.prewarm(),
    b = view.prewarm();
  expect(a).toBe(b);
  expect(view.renderer.compile).toHaveBeenCalledOnce();
  expect(mesh.visible).toBe(true);
  view.graphicsLost = true;
  await a;
  expect(mesh.visible).toBe(false);
  expect(mesh.count).toBe(0);
  expect(view.renderer.render).not.toHaveBeenCalled();
  view.disposed = true;
  await view.prewarm();
  expect(view.renderer.compile).toHaveBeenCalledOnce();
});
