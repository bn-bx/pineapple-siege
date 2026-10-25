import { expect, it } from "vitest";
import * as THREE from "three";
import { WorldBatches } from "../src/render/world-batches";
import { ResourceDisposal } from "../src/render/resource-disposal";
import type { WorldData } from "../src/types";

it("overlaps tree LODs near the transition and preserves complementary shader fading", () => {
  const world = {
    sites: [],
    banners: [],
    entities: [0, 1].map((id) => ({
      id,
      kind: "tree",
      material: "foliage",
      treeSpecies: "pine",
      p: [100 + id * 256, 20, 100],
      s: [4, 10, 4],
      variant: 0.5,
    })),
  } as unknown as WorldData;
  const material = new THREE.MeshStandardMaterial();
  const view = new WorldBatches(new THREE.Scene(), world, {
    foliage: material,
  } as any);
  expect(view.batches).toHaveLength(2);
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(100, 80, 460);
  view.update(camera, 1200, 360, 220);
  const batch = view.batches[0];
  expect(batch.mesh.visible).toBe(true);
  expect(batch.low!.visible).toBe(true);
  const compile = (m: THREE.Material) => {
    const shader = {
      uniforms: {},
      vertexShader: "void main() {\n#include <begin_vertex>\n}",
      fragmentShader: "void main() {}",
    };
    m.onBeforeCompile(shader as any, {} as any);
    return shader;
  };
  const high = compile(batch.mesh.material as THREE.Material);
  const low = compile(batch.low!.material as THREE.Material);
  expect(high.fragmentShader).toContain("treeLODNoise >= treeLODWeight");
  expect(low.fragmentShader).toContain("treeLODNoise < treeLODWeight");
  expect(high.vertexShader).toContain("foliageTime");
  expect(low.vertexShader).toContain("foliageTime");
  expect(high.uniforms).toMatchObject({ treeLODDistance: { value: 360 } });
  camera.position.z = 1500;
  view.update(camera, 1200, 360, 220);
  expect(batch.mesh.visible).toBe(false);
  const resources = new ResourceDisposal();
  view.dispose(resources);
  resources.dispose();
});
it("removes and restores near and distant tree identity without altering generated owners", () => {
  const world = {
    sites: [],
    banners: [],
    entities: [0, 1].map((id) => ({
      id,
      kind: "tree",
      material: "foliage",
      treeSpecies: "pine",
      p: [100 + id * 20, 20, 100],
      s: [4, 10, 4],
      variant: 0.5,
      supports: [],
      foundation: true,
      assembly: "forest",
    })),
  } as unknown as WorldData;
  const original = structuredClone(world);
  const scene = new THREE.Scene(),
    material = new THREE.MeshStandardMaterial();
  const view = new WorldBatches(scene, world, {
    foliage: material,
    wood: material,
  } as any);
  const canopy = view.batches.find((b) => b.kind === "pine")!;
  view.remove(0);
  expect(canopy.ids).toEqual([1]);
  expect(canopy.mesh.count).toBe(1);
  expect(canopy.low?.count).toBe(1);
  expect(view.refs.get(1)?.every((ref) => ref.index === 0)).toBe(true);
  view.restore([1]);
  expect(canopy.ids).toEqual([0]);
  view.restore([]);
  expect(canopy.ids).toEqual([0, 1]);
  expect(canopy.low?.count).toBe(2);
  expect(world).toEqual(original);
  const resources = new ResourceDisposal();
  view.dispose(resources);
  resources.dispose();
  expect(scene.children).toHaveLength(0);
});
