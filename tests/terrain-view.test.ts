import { CHUNKS, CONFIG } from "../src/config";
import { it, expect } from "vitest";
import * as THREE from "three";
import { TerrainView } from "../src/render/terrain-view";
import { Terrain } from "../src/sim/terrain";
import { readFileSync } from "node:fs";
it("stitches unequal terrain detail levels with identical shared heights and normals after excavation", () => {
  const bytes = readFileSync("public/world.bin");
  const base = new Float32Array(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  );
  const view = new TerrainView(
    JSON.parse(readFileSync("public/world.json", "utf8")),
    base.slice(),
    new THREE.Texture(),
  );
  const terrain = new Terrain(base);
  view.patch(terrain.crater(1088, 1030));
  const a = view.chunks[16 * CHUNKS + 16],
    b = view.chunks[16 * CHUNKS + 17];
  (view as any).build(a, 2);
  (view as any).build(b, 8);
  const edge = (mesh: THREE.Mesh) => {
    const p = mesh.geometry.getAttribute("position"),
      n = mesh.geometry.getAttribute("normal"),
      values: number[][] = [];
    for (let i = 0; i < p.count; i++)
      if (p.getX(i) === 1088)
        values.push([p.getZ(i), p.getY(i), n.getX(i), n.getY(i), n.getZ(i)]);
    return values.sort((a, b) => a[0] - b[0]);
  };
  expect(edge(a.mesh)).toHaveLength(33);
  expect(edge(b.mesh)).toEqual(edge(a.mesh));
  const geometry = a.mesh.geometry;
  const patch = terrain.crater(1088, 1030, 35, 12);
  expect(patch.chunks).toContain(a.id);
  expect(patch.chunks).toContain(b.id);
  view.patch(patch);
  (view as any).refresh(a);
  (view as any).refresh(b);
  expect(a.mesh.geometry).toBe(geometry);
  expect(edge(b.mesh)).toEqual(edge(a.mesh));
  for (const [z, y] of edge(a.mesh))
    expect(y).toBeCloseTo(terrain.sample(1088, z), 5);
  // The five-hundred-meter shaft must share exact edges and normals at mixed LOD.
  for (let section = 0; section < CHUNKS * CHUNKS; section++) {
    const result = terrain.laserCrater(1088, 1030, 1, section);
    if (result.patch.indices.length) view.patch(result.patch);
  }
  (view as any).refresh(a);
  (view as any).refresh(b);
  expect(edge(b.mesh)).toEqual(edge(a.mesh));
  for (const [z, y] of edge(a.mesh))
    expect(y).toBeCloseTo(terrain.sample(1088, z), 4);
  view.restore(base);
  (view as any).refresh(a);
  expect(a.mesh.geometry.getAttribute("color").array).toEqual(a.baseColors);
  // Draw tiles must include authoritative edits and replace their stale copies.
  (view as any).batch([
    { c: a, d: 0 },
    { c: b, d: 64 },
  ]);
  expect(view.group.children).toHaveLength(1);
  const tile = view.group.children[0] as THREE.Mesh;
  expect(tile.geometry.getAttribute("position").count).toBe(
    a.mesh.geometry.getAttribute("position").count +
      b.mesh.geometry.getAttribute("position").count,
  );
  const oldTileGeometry = tile.geometry;
  view.patch(terrain.crater(1088, 1030, 20, 6));
  (view as any).refresh(a);
  (view as any).refresh(b);
  (view as any).batch([
    { c: a, d: 0 },
    { c: b, d: 64 },
  ]);
  expect(tile.geometry).not.toBe(oldTileGeometry);
  const merged = tile.geometry.getAttribute("position");
  for (let i = 0; i < merged.count; i++)
    expect(merged.getY(i)).toBeCloseTo(
      view.sample(merged.getX(i), merged.getZ(i)),
      4,
    );
  // GPU updates stay within rows and avoid re-uploading the whole 38MB field.
  view.heightTexture.onUpdate?.(view.heightTexture);
  view.heightTexture.clearUpdateRanges();
  view.patch({
    indices: new Uint32Array([3, 5, CONFIG.grid + 2]),
    values: new Float32Array([10, 11, 12]),
    chunks: [],
  });
  expect(view.heightTexture.updateRanges).toEqual([
    { start: 3, count: 3 },
    { start: CONFIG.grid + 2, count: 1 },
  ]);
  view.floodTexture.onUpdate?.(view.floodTexture);
  view.setFlood(new Uint32Array([CONFIG.grid + 3]));
  expect(view.floodTexture.updateRanges).toEqual([
    { start: CONFIG.grid + 3, count: 1 },
  ]);
  view.setFlood(new Uint32Array(), true);
  expect(view.floodTexture.updateRanges).toEqual([]);
  expect(view.flood[CONFIG.grid + 3]).toBe(0);
  view.fullTextureUpload();
  expect(view.heightTexture.updateRanges).toEqual([]);
  tile.geometry.dispose();
  for (const chunk of view.chunks) chunk.mesh.geometry.dispose();
  view.material.dispose();
  view.heightTexture.dispose();
  view.floodTexture.dispose();
});
it("removes distant terrain draw tiles when range shrinks and restores them when increased", () => {
  const bytes = readFileSync("public/world.bin");
  const base = new Float32Array(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  );
  const view = new TerrainView(
    JSON.parse(readFileSync("public/world.json", "utf8")),
    base,
    new THREE.Texture(),
  );
  const chunk = view.chunks[16 * CHUNKS + 16];
  (view as any).build(chunk, 16);
  const camera = new THREE.Vector3(1056, 200, 156);
  const hasDistantTerrain = () =>
    view.group.children.some((child) => {
      const positions = (child as THREE.Mesh).geometry.getAttribute("position");
      for (let i = 0; i < positions.count; i++)
        if (positions.getX(i) === 1056 && positions.getZ(i) === 1056)
          return true;
      return false;
    });
  view.update(camera, 600);
  expect(hasDistantTerrain()).toBe(false);
  view.update(camera, 1800);
  expect(hasDistantTerrain()).toBe(true);
  for (const child of view.group.children)
    (child as THREE.Mesh).geometry.dispose();
  for (const chunk of view.chunks) chunk.mesh.geometry.dispose();
  view.material.dispose();
  view.heightTexture.dispose();
  view.floodTexture.dispose();
});
