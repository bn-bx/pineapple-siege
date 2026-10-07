import { expect, it } from "vitest";
import * as THREE from "three";
import { WorldBatches } from "../src/render/world-batches";
import { ResourceDisposal } from "../src/render/resource-disposal";
import type { WorldData } from "../src/types";
it("removes and restores near and distant tree identity without altering generated owners", () => {
  const world = {
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
