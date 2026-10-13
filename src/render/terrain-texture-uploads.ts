import type { TerrainPages } from "./terrain-pages";
import * as THREE from "three";
import { CONFIG, CHUNKS } from "../config";

/** r180 adapter: retain Three's binding cache, but avoid five synchronous GL
 * state queries per section in copyTextureToTexture. DataTexture uploads set
 * their own unpack state, and no GPU data is read back here. */
export function copyTerrainSection(
  renderer: THREE.WebGLRenderer,
  source: THREE.DataTexture,
  destination: THREE.DataTexture,
  position: THREE.Vector2,
) {
  renderer.initTexture(destination);
  const gl = renderer.getContext() as WebGL2RenderingContext;
  const handle = (
    renderer.properties.get(destination) as {
      __webglTexture: WebGLTexture;
    }
  ).__webglTexture;
  renderer.state.bindTexture(gl.TEXTURE_2D, handle);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
  gl.pixelStorei(gl.UNPACK_IMAGE_HEIGHT, 0);
  gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0);
  gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
  gl.pixelStorei(gl.UNPACK_SKIP_IMAGES, 0);
  gl.texSubImage2D(
    gl.TEXTURE_2D,
    0,
    position.x,
    position.y,
    source.image.width,
    source.image.height,
    gl.RED,
    source.type === THREE.FloatType ? gl.FLOAT : gl.UNSIGNED_BYTE,
    source.image.data,
  );
}
/** Small CPU-backed rectangles avoid handing the complete 38 MB field to every GL row upload. */
export class TerrainTextureUploads {
  private heightDirty = new Set<number>();
  private wetDirty = new Set<number>();
  private heightStrip = new THREE.DataTexture(
    new Float32Array(33 * 33),
    32,
    32,
    THREE.RedFormat,
    THREE.FloatType,
  );
  private wetStrip = new THREE.DataTexture(
    new Uint8Array(33 * 33),
    32,
    32,
    THREE.RedFormat,
  );
  private position = new THREE.Vector2();
  lastCalls = 0;
  lastBytes = 0;
  constructor(
    private height: THREE.DataTexture,
    private wet: THREE.DataTexture,
  ) {}
  get pending() {
    return this.heightDirty.size + this.wetDirty.size;
  }
  queue(texture: THREE.DataTexture, indices: Uint32Array) {
    const dirty = texture === this.height ? this.heightDirty : this.wetDirty;
    for (const i of indices)
      dirty.add(
        Math.min(CHUNKS - 1, Math.floor(i / CONFIG.grid / 32)) * CHUNKS +
          Math.min(CHUNKS - 1, Math.floor((i % CONFIG.grid) / 32)),
      );
  }
  flush(
    renderer: Pick<THREE.WebGLRenderer, "copyTextureToTexture">,
    budgetMS: number,
  ) {
    const started = performance.now();
    this.lastCalls = this.lastBytes = 0;
    while (this.pending && performance.now() - started < budgetMS) {
      const wet = this.wetDirty.size > 0,
        dirty = wet ? this.wetDirty : this.heightDirty;
      const id = dirty.values().next().value!,
        x = (id % CHUNKS) * 32,
        z = Math.floor(id / CHUNKS) * 32;
      const width = x + 32 === CONFIG.grid - 1 ? 33 : 32,
        height = z + 32 === CONFIG.grid - 1 ? 33 : 32;
      const source = wet ? this.wet : this.height,
        strip = wet ? this.wetStrip : this.heightStrip;
      const data = source.image.data as Float32Array | Uint8Array,
        target = strip.image.data as Float32Array | Uint8Array;
      const pages = source.userData.terrainPages as TerrainPages | undefined;
      const side = pages?.side ?? CONFIG.grid;
      for (let dz = 0; dz < height; ) {
        const rows = Math.min(height - dz, side - ((z + dz) % side));
        for (let dx = 0; dx < width; ) {
          const columns = Math.min(width - dx, side - ((x + dx) % side));
          for (let row = 0; row < rows; row++) {
            const start = (z + dz + row) * CONFIG.grid + x + dx;
            target.set(data.subarray(start, start + columns), row * columns);
          }
          strip.image.width = columns;
          strip.image.height = rows;
          this.position.set(x + dx, z + dz);
          if (pages && "getContext" in renderer) {
            const r = renderer as THREE.WebGLRenderer;
            r.initTexture(pages.texture);
            const gl = r.getContext() as WebGL2RenderingContext;
            const handle = (
              r.properties.get(pages.texture) as {
                __webglTexture: WebGLTexture;
              }
            ).__webglTexture;
            r.state.bindTexture(gl.TEXTURE_2D_ARRAY, handle);
            gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
            gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
            gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
            gl.pixelStorei(gl.UNPACK_IMAGE_HEIGHT, 0);
            gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0);
            gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
            gl.pixelStorei(gl.UNPACK_SKIP_IMAGES, 0);
            const address = pages.address(x + dx, z + dz);
            gl.texSubImage3D(
              gl.TEXTURE_2D_ARRAY,
              0,
              address.x,
              address.z,
              address.layer,
              columns,
              rows,
              1,
              gl.RED,
              source.type === THREE.FloatType ? gl.FLOAT : gl.UNSIGNED_BYTE,
              target,
            );
          } else if ("getContext" in renderer) {
            copyTerrainSection(
              renderer as THREE.WebGLRenderer,
              strip,
              source,
              this.position,
            );
          } else
            renderer.copyTextureToTexture(strip, source, null, this.position);
          this.lastCalls++;
          this.lastBytes += columns * rows * target.BYTES_PER_ELEMENT;
          dx += columns;
        }
        dz += rows;
      }
      dirty.delete(id);
    }
    return performance.now() - started;
  }
  reset() {
    this.heightDirty.clear();
    this.wetDirty.clear();
  }
  dispose() {
    this.reset();
    this.heightStrip.dispose();
    this.wetStrip.dispose();
  }
}
