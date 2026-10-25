import { expect, it } from "vitest";
import { Color, Matrix4, Texture } from "three";
import { terrainSurfaceColor } from "../src/render/terrain-colors";

const surface = (height: number, slope = 0.1) => {
  const color = new Color();
  terrainSurfaceColor(color, 80, 120, height, slope);
  return color;
};

it("gives gentle shores warm sand and darkens the wet waterline", () => {
  const beach = surface(5),
    wet = surface(0),
    inland = surface(40);
  expect(beach.r).toBeGreaterThan(beach.g);
  expect(beach.g).toBeGreaterThan(beach.b);
  expect(beach.r).toBeGreaterThan(inland.r * 2);
  expect(wet.r).toBeLessThan(beach.r);
});

it("keeps steep coastal faces rocky instead of painting them as beaches", () => {
  const beach = surface(5),
    cliff = surface(5, 1.2);
  expect(cliff.r).toBeLessThan(beach.r);
  expect(cliff.b / cliff.r).toBeGreaterThan(beach.b / beach.r);
});

it("keeps the new shoreline palette below inland elevations", () => {
  const lowland = surface(150),
    upland = surface(200);
  expect(lowland.toArray()).toEqual(upland.toArray());
});

import { CoastlineView, shorelineSegments } from "../src/render/coastline";
import type { TerrainView } from "../src/render/terrain-view";
import { ResourceDisposal } from "../src/render/resource-disposal";

it("traces concave and detached shores rather than creating a circular beach", () => {
  const height = (x: number, z: number) =>
    Math.max(
      55 - Math.hypot(x - 80, z - 110),
      25 - Math.hypot(x - 205, z - 160),
    );
  const segments = shorelineSegments(256, height, 8);
  expect(segments.length).toBeGreaterThan(40);
  expect(segments.some((s) => s[0][0] > 190)).toBe(true);
  for (const segment of segments)
    for (const [x, z] of segment)
      expect(Math.abs(height(x, z))).toBeLessThan(1);
});

it("builds wide beach geometry and real rock instances, then follows excavation and reset", () => {
  const base = new Float32Array();
  let damage = 0;
  const terrain = {
    world: { size: 256, seed: 1 },
    base,
    surfaceRevision: 0,
    heightTexture: new Texture(),
    floodTexture: new Texture(),
    sample: (x: number, _z: number, field?: Float32Array) =>
      (x - 128) * 0.25 - (field === base ? 0 : damage),
  } as unknown as TerrainView;
  const coast = new CoastlineView(terrain);
  const positions = coast.beach.geometry.getAttribute("position");
  const original = positions.getY(0);
  const xs = Array.from({ length: positions.count }, (_, i) =>
    positions.getX(i),
  );
  expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(40);
  expect(coast.rocks.count).toBeGreaterThan(10);
  expect(coast.beach.geometry.index!.count).toBeGreaterThan(100);
  coast.update();
  const matrix = new Matrix4();
  coast.rocks.getMatrixAt(0, matrix);
  const rockY = matrix.elements[13];
  damage = 12;
  terrain.surfaceRevision++;
  coast.update();
  expect(positions.getY(0)).toBeCloseTo(original - 12);
  coast.rocks.getMatrixAt(0, matrix);
  expect(matrix.elements[13]).toBeCloseTo(rockY - 12);
  damage = 0;
  terrain.surfaceRevision++;
  coast.update();
  expect(positions.getY(0)).toBeCloseTo(original);
  coast.rocks.getMatrixAt(0, matrix);
  expect(matrix.elements[13]).toBeCloseTo(rockY);
  const resources = new ResourceDisposal();
  resources.collect(coast.group);
  expect(resources.geometries.size).toBe(4);
  resources.dispose();
});
