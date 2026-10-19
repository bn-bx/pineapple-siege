import { expect, it } from "vitest";
import * as THREE from "three";
import { GravityBombView } from "../src/render/gravity-bombs";
import { ResourceDisposal } from "../src/render/resource-disposal";
import type { GravityBombState } from "../src/types";
const bomb: GravityBombState = {
  id: 1,
  p: [100, 35, 100],
  age: 2,
  phase: "pulling",
};
it("interpolates matching phases, draws finite inward trails, and reuses pooled models", () => {
  const view = new GravityBombView();
  view.update([bomb], [{ ...bomb, p: [80, 35, 100], age: 1.9 }], 0.5);
  const model = view.group.children[0];
  expect(model.position.x).toBe(90);
  const trails = model.children.find(
    (m) => m instanceof THREE.LineSegments,
  ) as THREE.LineSegments;
  expect(
    [...trails.geometry.getAttribute("position").array].every(Number.isFinite),
  ).toBe(true);
  const wave = model.children[model.children.length - 1] as THREE.Mesh;
  expect(wave.visible).toBe(false);
  view.update([{ ...bomb, phase: "bursting", age: 0.4 }], [bomb], 0.5);
  expect(model.position.x).toBe(100);
  expect(trails.visible).toBe(false);
  expect(wave.visible).toBe(true);
  expect(wave.scale.x).toBeGreaterThan(100);
  view.reset();
  expect(view.count).toBe(0);
  expect(model.visible).toBe(false);
  view.update([bomb], undefined, 1);
  expect(view.group.children[0]).toBe(model);
  const resources = new ResourceDisposal();
  resources.collect(view.group);
  expect(resources.geometries.size).toBe(4);
  resources.dispose();
});
it("bounds pooling at eight and makes unused resources collectable before a shot", () => {
  const view = new GravityBombView();
  const resources = new ResourceDisposal();
  resources.collect(view.group);
  expect(resources.geometries.size).toBe(4);
  view.update(
    Array.from({ length: 12 }, (_, id) => ({ ...bomb, id })),
    undefined,
    1,
  );
  expect(view.count).toBe(8);
  expect(view.group.children).toHaveLength(8);
  resources.collect(view.group);
  resources.dispose();
});
