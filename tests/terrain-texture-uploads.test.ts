import { expect, it } from "vitest";
import * as THREE from "three";
import { CHUNKS, CONFIG } from "../src/config";
import { TerrainTextureUploads } from "../src/render/terrain-texture-uploads";

it("coalesces changed cells into bounded packed uploads and prioritizes dry masks", () => {
  const h = new Float32Array(CONFIG.grid * CONFIG.grid);
  const wet = new Uint8Array(h.length);
  const heightTexture = new THREE.DataTexture(
    h,
    CONFIG.grid,
    CONFIG.grid,
    THREE.RedFormat,
    THREE.FloatType,
  );
  const wetTexture = new THREE.DataTexture(
    wet,
    CONFIG.grid,
    CONFIG.grid,
    THREE.RedFormat,
  );
  const uploads = new TerrainTextureUploads(heightTexture, wetTexture);
  const first = 32 * CONFIG.grid + 64;
  h[first] = 12;
  h[first + CONFIG.grid + 31] = -8;
  wet[first] = 255;
  uploads.queue(
    heightTexture,
    new Uint32Array([first, first + 1, first + CONFIG.grid + 31]),
  );
  uploads.queue(wetTexture, new Uint32Array([first]));
  expect(uploads.pending).toBe(2);
  const calls: any[] = [];
  const renderer = {
    copyTextureToTexture: (
      source: THREE.DataTexture,
      dest: THREE.DataTexture,
      _region: unknown,
      p: THREE.Vector2,
    ) => {
      calls.push({
        dest,
        width: source.image.width,
        height: source.image.height,
        data: source.image.data.slice(),
        p: p.clone(),
      });
    },
  } as unknown as THREE.WebGLRenderer;
  uploads.flush(renderer, 0);
  expect(calls).toHaveLength(0);
  uploads.flush(renderer, 100);
  expect(calls).toHaveLength(2);
  expect(calls[0].dest).toBe(wetTexture);
  expect(calls[0].data[0]).toBe(255);
  expect(calls[1].dest).toBe(heightTexture);
  expect(calls[1].p.toArray()).toEqual([64, 32]);
  expect(calls[1].data[0]).toBe(12);
  expect(calls[1].data[63]).toBe(-8);
  expect(calls[1].data.byteLength).toBeLessThanOrEqual(4356);
  expect(heightTexture.version).toBe(0);
  expect(uploads.pending).toBe(0);
  uploads.dispose();
  heightTexture.dispose();
  wetTexture.dispose();
});
it("includes the final grid edge and releases obsolete uploads on reset", () => {
  const h = new Float32Array(CONFIG.grid * CONFIG.grid);
  const last = h.length - 1;
  h[last] = -500;
  const height = new THREE.DataTexture(
    h,
    CONFIG.grid,
    CONFIG.grid,
    THREE.RedFormat,
    THREE.FloatType,
  );
  const wet = new THREE.DataTexture(
    new Uint8Array(h.length),
    CONFIG.grid,
    CONFIG.grid,
    THREE.RedFormat,
  );
  const uploads = new TerrainTextureUploads(height, wet);
  let calls = 0;
  const renderer = {
    copyTextureToTexture: (
      source: THREE.DataTexture,
      _dest: unknown,
      _region: unknown,
      p: THREE.Vector2,
    ) => {
      calls++;
      expect(p.toArray()).toEqual([(CHUNKS - 1) * 32, (CHUNKS - 1) * 32]);
      expect([source.image.width, source.image.height]).toEqual([33, 33]);
      expect(source.image.data[1088]).toBe(-500);
    },
  } as unknown as THREE.WebGLRenderer;
  uploads.queue(height, new Uint32Array([last]));
  uploads.flush(renderer, 100);
  expect(calls).toBe(1);
  uploads.queue(height, new Uint32Array([0]));
  uploads.reset();
  uploads.flush(renderer, 100);
  expect(calls).toBe(1);
  expect(uploads.pending).toBe(0);
  uploads.dispose();
  height.dispose();
  wet.dispose();
});
it("uploads without querying GL state and keeps Three texture bindings coherent", async () => {
  const { copyTerrainSection } = await import(
    "../src/render/terrain-texture-uploads"
  );
  const pixels = new Float32Array(32 * 32),
    source = new THREE.DataTexture(
      pixels,
      32,
      32,
      THREE.RedFormat,
      THREE.FloatType,
    ),
    destination = source.clone();
  const calls: unknown[][] = [],
    handle = {};
  const gl = {
    TEXTURE_2D: 1,
    RED: 2,
    FLOAT: 3,
    UNSIGNED_BYTE: 4,
    UNPACK_ALIGNMENT: 5,
    UNPACK_FLIP_Y_WEBGL: 6,
    UNPACK_PREMULTIPLY_ALPHA_WEBGL: 7,
    UNPACK_ROW_LENGTH: 8,
    UNPACK_IMAGE_HEIGHT: 9,
    UNPACK_SKIP_PIXELS: 10,
    UNPACK_SKIP_ROWS: 11,
    UNPACK_SKIP_IMAGES: 12,
    pixelStorei: (...a: unknown[]) => calls.push(a),
    texSubImage2D: (...a: unknown[]) => calls.push(a),
  };
  let initialized = false,
    bound = false;
  const renderer = {
    initTexture: (t: unknown) => {
      expect(t).toBe(destination);
      initialized = true;
    },
    getContext: () => gl,
    properties: { get: () => ({ __webglTexture: handle }) },
    state: {
      bindTexture: (type: unknown, t: unknown) => {
        expect(type).toBe(1);
        expect(t).toBe(handle);
        bound = true;
      },
    },
  } as unknown as THREE.WebGLRenderer;
  copyTerrainSection(renderer, source, destination, new THREE.Vector2(64, 96));
  expect(initialized && bound).toBe(true);
  expect(calls.at(-1)).toEqual([1, 0, 64, 96, 32, 32, 2, 3, pixels]);
  source.dispose();
  destination.dispose();
});
