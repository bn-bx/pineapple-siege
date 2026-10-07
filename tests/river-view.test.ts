import { expect, it } from "vitest";
import * as THREE from "three";
import {
  makeRivers,
  riverBendReviewCamera,
  riverCrossSections,
} from "../src/render/river-view";

it("joins adjacent reaches with bounded miters at a sharp river bend", () => {
  const offsets = riverCrossSections(
    [
      [0, 12, 0],
      [40, 10, 0],
      [40, 8, 40],
    ],
    8,
  );
  expect(offsets[0][0]).toBeCloseTo(0);
  expect(offsets[0][1]).toBe(8);
  expect(offsets[2][0]).toBe(-8);
  expect(offsets[2][1]).toBeCloseTo(0);
  expect(Math.abs(offsets[1][0])).toBeCloseTo(8);
  expect(Math.abs(offsets[1][1])).toBeCloseTo(8);
  expect(Math.hypot(...offsets[1])).toBeLessThanOrEqual(8 * 1.6);
});

it("falls back to a finite river bank normal through a hairpin", () => {
  const offsets = riverCrossSections(
    [
      [0, 0, 0],
      [20, 0, 0],
      [0, 0, 0],
    ],
    6,
  );
  expect(offsets[1].every(Number.isFinite)).toBe(true);
  expect(Math.hypot(...offsets[1])).toBe(6);
});

it("targets the sharpest river bend for isolated visual review", () => {
  const camera = riverBendReviewCamera(
    [
      [0, 12, 0],
      [40, 10, 0],
      [40, 8, 40],
      [80, 6, 40],
    ],
    18,
  );
  expect(camera?.index).toBe(1);
  expect(camera?.curvature).toBeGreaterThan(0.9);
  expect(camera?.eye[1]).toBeGreaterThan(camera?.target[1] ?? Infinity);
  expect(riverBendReviewCamera([[0, 0, 0], [1, 0, 0]])).toBeUndefined();
});

it("retains batched river geometry and continuous flow attributes through bends", () => {
  const points = [
    [0, 12, 0],
    [40, 10, 0],
    [40, 8, 40],
  ];
  const world = { rivers: [{ points, width: 8 }] } as any;
  const terrain = {
    heightTexture: new THREE.Texture(),
    floodTexture: new THREE.Texture(),
  } as any;
  const group = makeRivers(world, terrain);
  expect(group.children).toHaveLength(1);
  const mesh = group.children[0] as THREE.Mesh;
  const flow = mesh.geometry.getAttribute("flow");
  expect(flow.count).toBe(mesh.geometry.getAttribute("position").count);
  for (let i = 0; i < flow.count; i++)
    expect(Math.hypot(flow.getX(i), flow.getY(i))).toBeCloseTo(1);
  expect(points).toEqual([
    [0, 12, 0],
    [40, 10, 0],
    [40, 8, 40],
  ]);
  expect((mesh.material as THREE.Material).transparent).toBe(false);
  mesh.geometry.dispose();
  (mesh.material as THREE.Material).dispose();
});
