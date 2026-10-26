import { expect, it } from "vitest";
import * as THREE from "three";
import { WorldBatches } from "../src/render/world-batches";
import { ResourceDisposal } from "../src/render/resource-disposal";
import type { WorldData } from "../src/types";

it("matches distant crown materials and keeps nearby windows tied to day/night lighting", () => {
  const world = {
    sites: [],
    banners: [],
    entities: [
      {
        id: 0,
        kind: "tree",
        material: "bark",
        treeSpecies: "pine",
        p: [100, 20, 100],
        s: [4, 10, 4],
        variant: 0.5,
      },
      {
        id: 1,
        kind: "block",
        material: "window",
        p: [120, 20, 100],
        s: [1, 1, 1],
        variant: 0.5,
      },
    ],
  } as unknown as WorldData;
  const foliage = new THREE.MeshStandardMaterial({
    color: "#487539",
    map: new THREE.Texture(),
  });
  const window = new THREE.MeshStandardMaterial({
    emissive: "#ffc077",
    emissiveIntensity: 0,
  });
  const view = new WorldBatches(new THREE.Scene(), world, {
    foliage,
    window,
    bark: new THREE.MeshStandardMaterial({ color: "#514230" }),
  } as any);
  const far = (view.horizon.group.children[0] as THREE.Mesh)
    .material as THREE.MeshStandardMaterial;
  expect(far.color).toEqual(foliage.color);
  expect(far.map).toBe(foliage.map);
  window.emissiveIntensity = 0.45;
  view.update(new THREE.PerspectiveCamera(), 1200, 360, 220);
  const nearWindow = view.batches.find((b) => b.allIds.includes(1))!.mesh
    .material as THREE.MeshStandardMaterial;
  expect(nearWindow.emissiveIntensity).toBe(0.45);
  window.emissiveIntensity = 0;
  view.update(new THREE.PerspectiveCamera(), 1200, 360, 220);
  expect(nearWindow.emissiveIntensity).toBe(0);
  const resources = new ResourceDisposal();
  view.dispose(resources);
  resources.dispose();
});

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
  expect(high.fragmentShader).toContain("sceneryLODNoise >= sceneryLODWeight");
  const distant = view.horizon.group.children[0] as THREE.InstancedMesh;
  const far = compile(distant.material as THREE.Material);
  expect(far.fragmentShader).toContain("sceneryLODNoise < sceneryLODWeight");
  expect(far.vertexShader).toContain("instanceMatrix[3].xyz");
  expect(far.vertexShader).not.toContain("horizonCoverage");
  expect(high.vertexShader).toContain("foliageTime");
  expect(low.vertexShader).toContain("foliageTime");
  const photo = { ...low, fragmentShader: "void main() {}" };
  (batch.low!.material as THREE.Material).userData.prepassMask(photo, {});
  expect(photo.fragmentShader).toBe(low.fragmentShader);
  expect(high.uniforms).toMatchObject({ treeLODDistance: { value: 360 } });
  // Batch membership can change outside the fade band without hiding an owner
  // which is still transitioning at the edge of the detailed radius.
  camera.position.z = 1370;
  view.update(camera, 1200, 360, 220);
  expect(batch.low!.parent).not.toBeNull();
  expect(distant.visible).toBe(true);
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
