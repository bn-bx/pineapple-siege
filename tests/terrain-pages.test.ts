import { expect, it, vi } from "vitest";
import * as THREE from "three";
import { TerrainPages, terrainGPUTexture } from "../src/render/terrain-pages";
import { waterPrepass } from "../src/render/water-prepass";
it("keeps samples exact across GPU page edges and all world corners", () => {
  const grid = 4609,
    data = new Float32Array(grid * grid);
  const source = new THREE.DataTexture(
    data,
    grid,
    grid,
    THREE.RedFormat,
    THREE.FloatType,
  );
  const pages = new TerrainPages(source, grid);
  expect(pages.side).toBe(1537);
  expect(pages.columns).toBe(3);
  expect(pages.texture.image.depth).toBe(9);
  expect(pages.data.length).toBeLessThan(data.length * 1.001);
  const points = [
    [0, 0],
    [4608, 0],
    [0, 4608],
    [4608, 4608],
    [1536, 1536],
    [1537, 1537],
    [3073, 3073],
    [3074, 3074],
  ];
  const indices = new Uint32Array(
    points.map(([x, z], i) => {
      data[z * grid + x] = i * -12.25;
      return z * grid + x;
    }),
  );
  pages.update(indices, true);
  points.forEach(([x, z], i) =>
    expect(pages.data[pages.address(x, z).index]).toBe(i * -12.25),
  );
  expect(pages.texture.layerUpdates.size).toBeGreaterThan(1);
  expect(terrainGPUTexture(source)).toBe(pages.texture);
  data.fill(12);
  pages.refresh();
  points.forEach(([x, z]) =>
    expect(pages.data[pages.address(x, z).index]).toBe(12),
  );
  const dispose = vi.fn();
  pages.texture.addEventListener("dispose", dispose);
  source.dispose();
  expect(dispose).toHaveBeenCalledOnce();
});
it("uses paged height and flooding in the shared water shader", () => {
  const height = new THREE.DataTexture(
    new Float32Array(9),
    3,
    3,
    THREE.RedFormat,
    THREE.FloatType,
  );
  const wet = new THREE.DataTexture(new Uint8Array(9), 3, 3, THREE.RedFormat);
  const heights = new TerrainPages(height, 3),
    flooding = new TerrainPages(wet, 3);
  const material = new THREE.MeshStandardMaterial();
  waterPrepass(material, height, wet);
  const shader = {
    uniforms: {},
    vertexShader: "#include <common>\n#include <begin_vertex>",
    fragmentShader: "#include <common>\n#include <clipping_planes_fragment>",
  } as THREE.WebGLProgramParametersWithUniforms;
  material.userData.prepassMask(shader);
  expect(shader.uniforms.prepassHeight.value).toBe(heights.texture);
  expect(shader.uniforms.prepassWet.value).toBe(flooding.texture);
  expect(shader.fragmentShader).toContain("sampler2DArray");
  expect(shader.fragmentShader).toContain("texture(prepassWet,sampleUV)");
  height.dispose();
  wet.dispose();
  material.dispose();
});

it("splits streaming uploads at intersecting page boundaries without sending full layers", async () => {
  const { TerrainTextureUploads } = await import(
    "../src/render/terrain-texture-uploads"
  );
  const grid = 4609,
    data = new Float32Array(grid * grid);
  const height = new THREE.DataTexture(
    data,
    grid,
    grid,
    THREE.RedFormat,
    THREE.FloatType,
  );
  const wet = new THREE.DataTexture(
    new Uint8Array(data.length),
    grid,
    grid,
    THREE.RedFormat,
  );
  const pages = new TerrainPages(height, grid);
  new TerrainPages(wet, grid);
  const indices = new Uint32Array([1536 * grid + 1536, 1537 * grid + 1537]);
  data[indices[0]] = -2;
  data[indices[1]] = -1;
  pages.update(indices, false);
  const uploads = new TerrainTextureUploads(height, wet);
  uploads.queue(height, indices);
  const calls: any[][] = [];
  const gl = {
    TEXTURE_2D_ARRAY: 35866,
    RED: 6403,
    FLOAT: 5126,
    UNSIGNED_BYTE: 5121,
    pixelStorei: vi.fn(),
    texSubImage3D: (...args: any[]) => calls.push(args),
  };
  const renderer = {
    initTexture: vi.fn(),
    getContext: () => gl,
    properties: { get: () => ({ __webglTexture: {} }) },
    state: { bindTexture: vi.fn() },
  };
  uploads.flush(renderer as unknown as THREE.WebGLRenderer, 100);
  expect(calls).toHaveLength(4);
  expect(calls.map((c) => [c[2], c[3], c[4], c[5], c[6]])).toEqual([
    [1536, 1536, 0, 1, 1],
    [0, 1536, 1, 31, 1],
    [1536, 0, 3, 1, 31],
    [0, 0, 4, 31, 31],
  ]);
  expect(uploads.lastBytes).toBe(32 * 32 * 4);
  expect(uploads.pending).toBe(0);
  uploads.dispose();
  height.dispose();
  wet.dispose();
});
