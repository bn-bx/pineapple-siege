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
  const a = view.chunks[16 * 32 + 16],
    b = view.chunks[16 * 32 + 17];
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
  for (let section = 0; section < 1024; section++) {
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
  for (const chunk of view.chunks) chunk.mesh.geometry.dispose();
  view.material.dispose();
  view.heightTexture.dispose();
  view.floodTexture.dispose();
});
