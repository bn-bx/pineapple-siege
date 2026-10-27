import { expect, it } from "vitest";
import * as THREE from "three";
import { buildingFireSites, BuildingFireView } from "../src/render/building-fire";
import { ResourceDisposal } from "../src/render/resource-disposal";
import type { Entity, WorldData } from "../src/types";

it("keeps every building burning beyond the transient fire limit and lifetime", () => {
  const entities = Array.from({ length: 300 }, (_, i) => [
    { id: i * 2, kind: "block", assembly: `house-${i}`, material: "roof", p: [0, 10, -100], s: [4, 2, 4] },
    { id: i * 2 + 1, kind: "block", assembly: `house-${i}`, material: "stone", p: [0, 5, -100], s: [4, 2, 4] },
  ]).flat() as Entity[];
  const world = { entities: [...entities, { ...entities[0], id: 600, assembly: "portal-toilet" }] } as WorldData;
  expect(buildingFireSites(world)).toHaveLength(300);
  const view = new BuildingFireView(world);
  const camera = new THREE.PerspectiveCamera(70, 1, .1, 1000);
  view.update(new Set([0]), camera, 10000, false);
  expect(view.fire.flames.count).toBe(300 * 8);
  expect(view.fire.flames.instanceColor!.getX(0)).toBe(1);
  view.update(new Set([0, 1]), camera, 20000, false);
  expect(view.fire.flames.count).toBe(299 * 8);
  const resources = new ResourceDisposal();
  view.collectResources(resources);
  resources.dispose();
});
