import { expect, it } from "vitest";
import * as THREE from "three";
import {
  STATIC_CASCADES,
  STATIC_WORLD_INTERVAL,
  StaticShadows,
  markStaticCaster,
  patchStaticShadowFragment,
  patchStaticShadowVertex,
  staticRedrawReason,
} from "../src/render/static-shadows";
import { WorldBatches } from "../src/render/world-batches";
import { ResourceDisposal } from "../src/render/resource-disposal";
import type { WorldData } from "../src/types";

const near = STATIC_CASCADES[0];
const sun = new THREE.Vector3(-0.8, 0.56, -0.23).normalize();

function state() {
  return {
    ready: true,
    dirty: false,
    center: new THREE.Vector3(0, 0, 0),
    light: sun.clone(),
    worldRevision: 0,
    lastWorldRedraw: 0,
  };
}
const input = (over: Partial<{ light: THREE.Vector3; worldRevision: number; elapsed: number }> = {}) => ({
  light: sun,
  worldRevision: 0,
  elapsed: 10,
  ...over,
});

it("redraws a cascade only when its coverage, the sun or the world changes", () => {
  expect(staticRedrawReason(near, { ...state(), ready: false }, new THREE.Vector3(), input())).toBe("first");
  expect(staticRedrawReason(near, state(), new THREE.Vector3(), input())).toBeUndefined();
  // Small moves stay inside the cascade's inner area.
  const inside = new THREE.Vector3(near.half * near.recenter * 0.9, 0, 0);
  expect(staticRedrawReason(near, state(), inside, input())).toBeUndefined();
  const outside = new THREE.Vector3(near.half * near.recenter * 1.1, 0, 0);
  expect(staticRedrawReason(near, state(), outside, input())).toBe("recenter");
  // The sun turning past the step redraws; a smaller turn does not.
  const turn = (radians: number) =>
    sun.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), radians);
  expect(staticRedrawReason(near, state(), new THREE.Vector3(), input({ light: turn(near.sunStep * 0.5) }))).toBeUndefined();
  expect(staticRedrawReason(near, state(), new THREE.Vector3(), input({ light: turn(near.sunStep * 1.5) }))).toBe("sun");
  // Destruction is grouped: no redraw until the interval since the last one.
  const recent = { ...state(), lastWorldRedraw: 10 - STATIC_WORLD_INTERVAL / 2 };
  expect(staticRedrawReason(near, recent, new THREE.Vector3(), input({ worldRevision: 1 }))).toBeUndefined();
  expect(staticRedrawReason(near, state(), new THREE.Vector3(), input({ worldRevision: 1 }))).toBe("world");
});

it("multiplies only the sun's shadowed light by the cached maps", () => {
  const fragment = patchStaticShadowFragment(
    "void main() {\n#include <lights_fragment_begin>\n}",
  );
  const sunLine = fragment.indexOf("directLight.color *= receiveShadow ? staticSun : 1.0;");
  const dynamicLine = fragment.indexOf("getShadow( directionalShadowMap[ i ]");
  expect(sunLine).toBeGreaterThan(0);
  expect(dynamicLine).toBeGreaterThan(sunLine);
  // Point and spot lights keep their own (unpatched) code paths.
  expect(fragment.match(/staticSun : 1\.0/g)).toHaveLength(1);
  expect(fragment).toContain("uniform sampler2D staticShadowMap3;");
  expect(fragment).not.toContain("#include <lights_fragment_begin>");
  const vertex = patchStaticShadowVertex(
    "void main() {\n#include <shadowmap_vertex>\n}",
  );
  expect(vertex).toContain("vStaticShadowCoord3 = staticShadowMatrix3");
  expect(vertex).toContain("shadowWorldNormal * staticShadowNormalBias.y");
});

it("installs once per lit material with its own program key", () => {
  const shadows = new StaticShadows(new THREE.Scene());
  const material = new THREE.MeshStandardMaterial();
  shadows.install(material);
  shadows.install(material);
  const shader = {
    uniforms: {},
    vertexShader: "void main() {\n#include <shadowmap_vertex>\n}",
    fragmentShader: "void main() {\n#include <lights_fragment_begin>\n}",
  };
  material.onBeforeCompile(shader as never, undefined as never);
  expect(shader.fragmentShader.match(/float staticSun = 1\.0;/g)).toHaveLength(1);
  expect(shader.uniforms).toHaveProperty("staticShadowMap0");
  expect(material.customProgramCacheKey()).toContain("static-shadow-v1");
  const basic = new THREE.MeshBasicMaterial();
  shadows.install(basic);
  expect(basic.customProgramCacheKey()).not.toContain("static-shadow");
});

function fakeScene() {
  const scene = new THREE.Scene();
  const tree = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
  markStaticCaster(tree);
  const plane = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
  plane.castShadow = true;
  scene.add(tree, plane);
  return { scene, tree, plane };
}

function frame(over: Partial<Parameters<StaticShadows["update"]>[2]> = {}) {
  return {
    focus: new THREE.Vector3(),
    ground: 0,
    view: new THREE.Vector3(0, -0.3, -1).normalize(),
    light: sun,
    worldRevision: 0,
    elapsed: 0,
    now: 0,
    ...over,
  };
}

it("casts only static scenery into cached maps, one cascade per frame", () => {
  const { scene, tree, plane } = fakeScene();
  const shadows = new StaticShadows(scene);
  const draws: { cascade: string; tree: boolean; plane: boolean }[] = [];
  const render = (lights: THREE.Light[]) => {
    // Stand in for three: give the light a map so uniforms can bind it.
    const light = lights[0] as THREE.DirectionalLight;
    light.shadow.map ??= new THREE.WebGLRenderTarget(1, 1);
    draws.push({ cascade: light.name, tree: tree.castShadow, plane: plane.castShadow });
  };
  const camera = new THREE.PerspectiveCamera();
  shadows.update(render, camera, frame());
  expect(draws).toEqual([{ cascade: "static-shadow-0-1", tree: true, plane: false }]);
  // Flags are restored for the per-frame map: scenery off, actors on.
  expect(tree.castShadow).toBe(false);
  expect(plane.castShadow).toBe(true);
  shadows.update(render, camera, frame());
  expect(draws.at(-1)!.cascade).toBe("static-shadow-1-1");
  // Settled: nothing to redraw.
  shadows.update(render, camera, frame());
  expect(draws).toHaveLength(2);
  expect(shadows.uniforms.staticShadowReady.value.toArray()).toEqual([1, 1]);
  // Warmup draws everything at once.
  shadows.invalidate();
  shadows.update(render, camera, frame(), true);
  expect(draws).toHaveLength(4);
  shadows.dispose();
});

it("crossfades after a sun step but swaps instantly after re-centring", () => {
  const { scene } = fakeScene();
  const shadows = new StaticShadows(scene);
  const render = (lights: THREE.Light[]) => {
    (lights[0] as THREE.DirectionalLight).shadow.map ??= new THREE.WebGLRenderTarget(1, 1);
  };
  const camera = new THREE.PerspectiveCamera();
  shadows.update(render, camera, frame(), true);
  const turned = sun.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), near.sunStep * 3);
  shadows.update(render, camera, frame({ light: turned, now: 100 }));
  expect(shadows.uniforms.staticShadowFade.value.x).toBe(0);
  shadows.update(render, camera, frame({ light: turned, now: 100.2 }));
  expect(shadows.uniforms.staticShadowFade.value.x).toBeCloseTo(0.5);
  shadows.update(render, camera, frame({ light: turned, now: 101 }));
  expect(shadows.uniforms.staticShadowFade.value.x).toBe(1);
  // Re-centring changes coverage, so it never fades between unlike areas.
  shadows.update(render, camera, frame({ light: turned, now: 102, focus: new THREE.Vector3(5000, 0, 0) }));
  expect(shadows.uniforms.staticShadowFade.value.x).toBe(1);
  shadows.dispose();
});

it("tags scenery batches as static casters", () => {
  const world = {
    sites: [],
    banners: [],
    entities: [
      { id: 0, kind: "tree", material: "foliage", treeSpecies: "pine", p: [100, 20, 100], s: [4, 10, 4], variant: 0.5 },
    ],
  } as unknown as WorldData;
  const view = new WorldBatches(new THREE.Scene(), world, {
    foliage: new THREE.MeshStandardMaterial(),
  } as any);
  view.update(new THREE.PerspectiveCamera(), 1200, 360);
  const batch = view.batches[0];
  for (const mesh of [batch.mesh, batch.low!]) {
    expect(mesh.userData.staticShadow).toBe(true);
    expect(mesh.castShadow).toBe(false);
  }
  view.remove(0);
  expect(view.removedRevision).toBe(1);
  const resources = new ResourceDisposal();
  view.dispose(resources);
  resources.dispose();
});
