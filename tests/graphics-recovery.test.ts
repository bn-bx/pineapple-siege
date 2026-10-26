import { expect, it, vi } from "vitest";
import * as THREE from "three";
import { GPUTimer, PerformanceMonitor } from "../src/performance";
import { AutoQuality } from "../src/render/auto-quality";
import { GameRenderer } from "../src/render/renderer";

it("abandons old context queries without GL calls and reacquires timing support", () => {
  const extension = { TIME_ELAPSED_EXT: 1, GPU_DISJOINT_EXT: 2 };
  const gl = {
    QUERY_RESULT_AVAILABLE: 3,
    QUERY_RESULT: 4,
    getExtension: vi.fn(() => extension),
    createQuery: vi.fn(() => ({})),
    beginQuery: vi.fn(),
    endQuery: vi.fn(),
    deleteQuery: vi.fn(),
    getParameter: vi.fn(() => false),
    getQueryParameter: vi.fn(
      (_query: unknown, _parameter: number): boolean | number => true,
    ),
  };
  const monitor = new PerformanceMonitor();
  const timer = new GPUTimer(gl as any, monitor);
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
  timer.begin("gpu", "gpuShadowFrame");
  timer.end();
  timer.poll();
  expect(gl.deleteQuery).toHaveBeenCalledOnce();
  expect(monitor.stats.stages.gpuShadowFrame).toEqual(monitor.stats.stages.gpu);
  const frameTime = timer.lastMS;
  gl.getQueryParameter.mockImplementation(
    (_query: unknown, parameter: number) =>
      parameter === gl.QUERY_RESULT_AVAILABLE ? true : 5_000_000,
  );
  timer.begin("gpuPass:scene");
  timer.end();
  timer.poll();
  expect(monitor.stats.stages["gpuPass:scene"].meanMS).toBe(5);
  expect(timer.lastMS).toBe(frameTime);
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
    prewarm: vi.fn(async () => {}),
  };
  view.effects = { prewarm: vi.fn(), prewarmMeshes: [] };
  view.fallenCanopy = vi.fn();
  view.worldView = {
    batches: [],
    approvedGod: { load: async () => {}, materials: [] },
  };
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
  await vi.waitFor(() => expect(view.renderer.compile).toHaveBeenCalledOnce());
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

it("prepares active and inactive effect-light variants before flight and restores ownership", async () => {
  const view = Object.create(GameRenderer.prototype) as any;
  const light = new THREE.PointLight(),
    group = new THREE.Group();
  group.add(light);
  group.visible = false;
  view.scene = new THREE.Scene();
  view.scene.add(group);
  view.camera = new THREE.PerspectiveCamera();
  view.terrain = {
    heightTexture: {},
    floodTexture: {},
    prewarm: async () => {},
  };
  view.effects = { group, prewarm() {}, prewarmMeshes: [] };
  view.fallenCanopy = () => {};
  view.worldView = {
    batches: [],
    approvedGod: { load: async () => {}, materials: [] },
  };
  view.fragmentMaterials = {};
  const rendered: boolean[] = [];
  view.renderer = {
    initTexture() {},
    compile: () => new Set(),
    shadowMap: {},
    render: () => rendered.push(group.visible && light.visible),
  };
  await view.prewarm();
  expect(rendered).toContain(true);
  expect(rendered).toContain(false);
  expect(group.visible).toBe(false);
  expect(light.visible).toBe(true);
});

it("warms the mapped non-instanced terrain shadow layout before tiles arrive", async () => {
  const view = Object.create(GameRenderer.prototype) as any;
  const terrainMaterial = new THREE.MeshStandardMaterial({
    map: new THREE.Texture(),
    vertexColors: true,
  });
  const transitionMaterial = terrainMaterial.clone();
  const transitionDepthMaterial = new THREE.MeshDepthMaterial();
  const disposed = vi.fn();
  let proxy: THREE.Mesh | undefined;
  view.scene = new THREE.Scene();
  view.camera = new THREE.PerspectiveCamera();
  view.terrain = {
    heightTexture: {},
    floodTexture: {},
    material: terrainMaterial,
    transitionMaterial,
    transitionDepthMaterial,
    prewarm: async () => {},
  };
  view.effects = { group: new THREE.Group(), prewarm() {}, prewarmMeshes: [] };
  view.fallenCanopy = () => {};
  view.worldView = {
    batches: [],
    approvedGod: { load: async () => {}, materials: [] },
  };
  view.fragmentMaterials = {};
  view.renderer = {
    initTexture() {},
    compile: () => new Set(),
    shadowMap: {},
    render: () => {
      proxy = view.scene.children.find(
        (o: THREE.Object3D) => (o as THREE.Mesh).material === terrainMaterial,
      );
      expect(proxy?.castShadow).toBe(true);
      expect((proxy as THREE.InstancedMesh).isInstancedMesh).toBeUndefined();
      expect(proxy!.geometry.getAttribute("color").count).toBe(4);
      const transitioning = view.scene.children.find(
        (o: THREE.Object3D) =>
          (o as THREE.Mesh).material === transitionMaterial,
      ) as THREE.Mesh;
      expect(transitioning.castShadow).toBe(true);
      expect(transitioning.customDepthMaterial).toBe(transitionDepthMaterial);
      expect(transitioning.geometry.getAttribute("terrainBlend").count).toBe(4);
      proxy!.geometry.addEventListener("dispose", disposed);
    },
  };
  await view.prewarm();
  expect(proxy?.parent).toBeNull();
  expect(disposed).toHaveBeenCalledOnce();
});

it("retries Ultra when selecting Auto and clears automatic reduced effects when selecting manual quality", () => {
  const view = Object.create(GameRenderer.prototype) as any;
  view.auto = new AutoQuality(4);
  view.quality = "auto";
  view.reducedEffects = false;
  view.effects = { reduced: true };
  view.environment = { sun: new THREE.DirectionalLight() };
  view.renderer = { shadowMap: {} };
  view.resize = vi.fn();
  view.qualityResourcesPending = true;
  view.setQuality("1440");
  expect(view.qualityResourcesPending).toBe(false);
  expect(view.effects.reduced).toBe(false);
  view.setQuality("auto");
  expect(view.auto.level).toBe(0);
  expect(view.targetHeight).toBe(1440);
  view.setReducedEffects(true);
  view.setQuality("1080");
  expect(view.effects.reduced).toBe(true);
});

it("resizes the drawing buffer once and avoids resetting unchanged canvas dimensions", () => {
  vi.stubGlobal("devicePixelRatio", 2);
  vi.stubGlobal("innerWidth", 800);
  vi.stubGlobal("innerHeight", 600);
  const view = Object.create(GameRenderer.prototype) as any;
  const drawing = new THREE.Vector2(1600, 1200);
  view.targetHeight = 1080;
  view.effects = { setRenderScale: vi.fn() };
  view.camera = new THREE.PerspectiveCamera();
  view.presentation = {
    size: [1600, 1200],
    resize: vi.fn((w, h) => {
      view.presentation.size = [w, h];
    }),
  };
  view.renderer = {
    domElement: { style: { width: "800px", height: "600px" } },
    getDrawingBufferSize: (target: THREE.Vector2) => target.copy(drawing),
    setDrawingBufferSize: vi.fn((w, h, ratio) =>
      drawing.set(Math.floor(w * ratio), Math.floor(h * ratio)),
    ),
    setPixelRatio: vi.fn(),
    setSize: vi.fn(),
  };
  try {
    view.resize();
    expect(view.renderer.setDrawingBufferSize).toHaveBeenCalledWith(
      800,
      600,
      1.8,
    );
    expect(view.presentation.size).toEqual([1440, 1080]);
    expect(view.camera.aspect).toBe(800 / 600);
    view.resize();
    expect(view.renderer.setDrawingBufferSize).toHaveBeenCalledOnce();
    expect(view.presentation.resize).toHaveBeenCalledOnce();
    expect(view.renderer.setPixelRatio).not.toHaveBeenCalled();
    expect(view.renderer.setSize).not.toHaveBeenCalled();
    // Auto can lower scene resolution repeatedly without resetting the canvas.
    view.quality = "auto";
    drawing.set(1600, 1200);
    view.renderer.setDrawingBufferSize.mockClear();
    view.targetHeight = 900;
    view.resize();
    expect(view.presentation.size).toEqual([1200, 900]);
    view.targetHeight = 720;
    view.resize();
    expect(view.presentation.size).toEqual([960, 720]);
    expect(view.renderer.setDrawingBufferSize).not.toHaveBeenCalled();
    expect(view.effects.setRenderScale).toHaveBeenLastCalledWith(0.6);
  } finally {
    vi.unstubAllGlobals();
  }
});
