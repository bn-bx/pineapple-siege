import { expect, it } from "vitest";
import * as THREE from "three";
import {
  GRASS_PER_TILE,
  GRASS_TILE,
  GrassField,
  grassClumpGeometry,
  grassRadius,
  type GrassGround,
} from "../src/render/grass-field";

/** Flat green meadow at 20 m, with a road along x = 500 and sand below 2 m to the west. */
function meadow(overrides: Partial<GrassGround> = {}) {
  let revision = 0;
  const ground: GrassGround & { blast(): void } = {
    sample: (x) => (x < 100 ? 1 : 20),
    baseHeight: (x) => (x < 100 ? 1 : 20),
    waterSurface: () => undefined,
    roadDistanceAt: (x) => Math.abs(x - 500),
    insideCastle: () => false,
    editRevisionAt: () => revision,
    groundColor: (color) => color.setRGB(0.2, 0.36, 0.09),
    blast() {
      revision++;
    },
    ...overrides,
  };
  return ground;
}

function placed(field: GrassField) {
  const m = new THREE.Matrix4(),
    p = new THREE.Vector3(),
    out: THREE.Vector3[] = [];
  for (let i = 0; i < field.mesh.count; i++) {
    field.mesh.getMatrixAt(i, m);
    if (m.elements[5] !== 0) out.push(p.setFromMatrixPosition(m).clone());
  }
  return out;
}

it("maps render quality to a grass radius and builds a small blade clump", () => {
  expect(grassRadius(360)).toBe(72);
  expect(grassRadius(300)).toBeLessThan(72);
  expect(grassRadius(160)).toBe(0);
  const clump = grassClumpGeometry();
  clump.computeBoundingBox();
  expect(clump.boundingBox!.min.y).toBeGreaterThanOrEqual(0);
  expect(clump.boundingBox!.max.y).toBeLessThanOrEqual(1.05);
  expect(clump.attributes.position.count / 3).toBeLessThanOrEqual(24);
  expect(clump.attributes.bladeY.count).toBe(clump.attributes.position.count);
});

it("grows deterministic grass near the camera and skips roads and bare ground", () => {
  const camera = new THREE.Vector3(500, 30, 500);
  const first = new GrassField(meadow(), 48);
  for (let i = 0; i < 40; i++) first.update(camera, i / 60);
  const blades = placed(first);
  expect(blades.length).toBeGreaterThan(GRASS_PER_TILE * 10);
  for (const b of blades) {
    expect(Math.hypot(b.x - camera.x, b.z - camera.z)).toBeLessThan(48 + 3 * GRASS_TILE);
    expect(Math.abs(b.x - 500)).toBeGreaterThanOrEqual(4.2);
    expect(b.y).toBeCloseTo(19.95);
  }
  const second = new GrassField(meadow(), 48);
  for (let i = 0; i < 40; i++) second.update(camera, i / 60);
  expect(placed(second).map((v) => v.toArray()).sort()).toEqual(
    blades.map((v) => v.toArray()).sort(),
  );
  // Sand and rock (not green) grow nothing.
  const bare = new GrassField(
    meadow({ groundColor: (c) => c.setRGB(0.7, 0.6, 0.4) }),
    48,
  );
  for (let i = 0; i < 40; i++) bare.update(camera, i / 60);
  expect(placed(bare)).toHaveLength(0);
  for (const f of [first, second, bare]) f.dispose();
});

it("hides when flying high, regrows after a blast, and releases tiles left behind", () => {
  const ground = meadow(),
    field = new GrassField(ground, 48),
    camera = new THREE.Vector3(800, 30, 800);
  for (let i = 0; i < 40; i++) field.update(camera, 0);
  const tiles = field.activeTiles;
  expect(field.mesh.visible).toBe(true);
  field.update(new THREE.Vector3(800, 400, 800), 0);
  expect(field.mesh.visible).toBe(false);
  // A crater changes the terrain; blades over changed ground disappear.
  ground.sample = (x, z) => (Math.hypot(x - 800, z - 800) < 20 ? 14 : 20);
  ground.blast();
  for (let i = 0; i < 60; i++) field.update(camera, 0);
  expect(field.activeTiles).toBe(tiles);
  expect(
    placed(field).some((b) => Math.hypot(b.x - 800, b.z - 800) < 19),
  ).toBe(false);
  // Fly away: old tiles are released and reused.
  for (let i = 0; i < 60; i++) field.update(new THREE.Vector3(3000, 30, 3000), 0);
  // Tile alignment at the circle's edge varies by a few tiles between positions.
  expect(Math.abs(field.activeTiles - tiles)).toBeLessThanOrEqual(4);
  expect(placed(field).every((b) => Math.hypot(b.x - 3000, b.z - 3000) < 120)).toBe(true);
  field.setRadius(0);
  expect(field.activeTiles).toBe(0);
  field.dispose();
});
