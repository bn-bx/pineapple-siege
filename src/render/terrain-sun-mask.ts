import * as THREE from "three";
import type { Entity, WorldData } from "../types";
import { statueRole } from "../statue-reaction";
import {
  computeSunMask,
  raiseCasters,
  type CasterBox,
  type LightDirection,
} from "./terrain-sun-mask-core";

/** Mask texels per side; 9,216 m / 512 = 18 m per texel. */
export const SUN_MASK_SIZE = 512;
/** Recompute after the light turns this far (radians, ~0.5°). */
const ANGLE_STEP = 0.5 * (Math.PI / 180);
/** Terrain edits (craters) are coalesced into one rebuild per interval. */
const EDIT_INTERVAL = 2;
/** Height-grid rows sampled per frame (~1.5 ms), so rebuilds never stall. */
const ROWS_PER_FRAME = 64;

interface HeightSource {
  sample(x: number, z: number): number;
  surfaceRevision: number;
}

/**
 * Long, island-wide sun shadows from mountains and the Pineapple God, beyond
 * the reach of the sun's shadow map. The mask is computed off the main thread
 * from a coarse height grid and darkens direct sunlight on every installed
 * standard material. It refreshes when the sun moves about half a degree,
 * after terrain edits, and when statue parts are destroyed.
 */
export class TerrainSunMask {
  readonly texture: THREE.DataTexture;
  readonly uniforms = {
    sunMaskMap: { value: null as unknown as THREE.DataTexture },
    sunMaskWorldSize: { value: 1 },
  };
  /** Milliseconds the last mask took to compute (worker or inline). */
  computeMS = 0;
  /** Main-thread milliseconds spent sampling the last height grid, in total. */
  sampleMS = 0;
  /** Largest per-frame share of that sampling. */
  frameSampleMS = 0;
  jobs = 0;
  private readonly n = SUN_MASK_SIZE;
  private readonly cell: number;
  private readonly heights: Float32Array;
  private worker?: Worker;
  private installed = new WeakSet<THREE.Material>();
  private excluded = new WeakSet<THREE.Material>();
  private requested = new THREE.Vector3(0, -1, 0);
  private pending = false;
  private pendingId = 0;
  private heightsDirty = true;
  private sentHeights = false;
  private terrainRevision = -1;
  private lastEdit = -Infinity;
  private statueIds: readonly number[];
  private removedStatue = -1;
  /** Next row to sample while a rebuild is spread across frames. */
  private row = -1;

  constructor(
    worldSize: number,
    private terrain: HeightSource,
    private statue: readonly Entity[],
    useWorker = typeof Worker !== "undefined",
  ) {
    this.cell = worldSize / this.n;
    this.heights = new Float32Array(this.n * this.n);
    const data = new Uint8Array(this.n * this.n).fill(255);
    this.texture = new THREE.DataTexture(
      data,
      this.n,
      this.n,
      THREE.RedFormat,
      THREE.UnsignedByteType,
    );
    this.texture.magFilter = this.texture.minFilter = THREE.LinearFilter;
    this.texture.wrapS = this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.needsUpdate = true;
    this.uniforms.sunMaskMap.value = this.texture;
    this.uniforms.sunMaskWorldSize.value = worldSize;
    this.statueIds = statue.map((e) => e.id);
    if (useWorker) {
      this.worker = new Worker(
        new URL("./terrain-sun-mask-worker.ts", import.meta.url),
        { type: "module" },
      );
      this.worker.onmessage = (event) => {
        const { id, mask, ms } = event.data as {
          id: number;
          mask: Uint8Array;
          ms: number;
        };
        if (id !== this.pendingId) return;
        this.apply(mask, ms);
      };
    }
  }

  /** True while a height-grid rebuild is being spread across frames. */
  get rebuilding() {
    return this.row >= 0;
  }

  /** Statue parts are the only scenery tall enough to matter at 18 m texels. */
  static statueParts(world: WorldData) {
    return world.entities.filter((e) => statueRole(e, world) !== undefined);
  }

  /**
   * Call once per frame. `elapsed` is presentation time in seconds and
   * `removed` the set of destroyed entity ids.
   */
  update(light: LightDirection, elapsed: number, removed: ReadonlySet<number>) {
    if (this.terrain.surfaceRevision !== this.terrainRevision) {
      if (this.terrainRevision < 0 || elapsed - this.lastEdit >= EDIT_INTERVAL) {
        this.terrainRevision = this.terrain.surfaceRevision;
        this.lastEdit = elapsed;
        this.heightsDirty = true;
      }
    }
    let gone = 0;
    for (const id of this.statueIds) if (removed.has(id)) gone++;
    if (gone !== this.removedStatue) {
      this.removedStatue = gone;
      this.heightsDirty = true;
    }
    if (this.pending) return;
    if (this.heightsDirty && this.row < 0) {
      // Edits that arrive mid-scan set the flag again and trigger another pass.
      this.heightsDirty = false;
      this.row = 0;
    }
    if (this.row >= 0) {
      // Rebuilding: finish the grid before requesting a mask from it.
      if (!this.sampleRows(removed)) return;
      this.requested.copy(normalized(light));
      this.request();
      return;
    }
    const turned =
      this.requested.y < -0.5 ||
      Math.acos(
        Math.min(1, this.requested.dot(normalized(light))),
      ) >= ANGLE_STEP;
    if (!turned) return;
    this.requested.copy(normalized(light));
    this.request();
  }

  /** Samples the next block of rows; returns true once the grid is complete. */
  private sampleRows(removed: ReadonlySet<number>) {
    const started = performance.now();
    const { n, cell, heights } = this;
    if (this.row === 0) this.sampleMS = 0;
    const end = Math.min(n, this.row + ROWS_PER_FRAME);
    for (let j = this.row; j < end; j++) {
      const z = (j + 0.5) * cell;
      for (let i = 0; i < n; i++)
        heights[j * n + i] = Math.max(0, this.terrain.sample((i + 0.5) * cell, z));
    }
    this.row = end;
    this.frameSampleMS = performance.now() - started;
    this.sampleMS += this.frameSampleMS;
    if (end < n) return false;
    this.row = -1;
    const boxes: CasterBox[] = [];
    for (const e of this.statue) {
      if (removed.has(e.id)) continue;
      boxes.push({
        x: e.p[0],
        z: e.p[2],
        // Parts can be rotated; the inscribed half-width avoids overstating them.
        halfWidth: Math.min(e.s[0], e.s[2]) / 2,
        top: e.p[1] + e.s[1] / 2,
      });
    }
    raiseCasters(heights, n, cell, boxes);
    this.sentHeights = false;
    return true;
  }

  private request() {
    const light = {
      x: this.requested.x,
      y: this.requested.y,
      z: this.requested.z,
    };
    this.jobs++;
    if (!this.worker) {
      const started = performance.now();
      const mask = computeSunMask(this.heights, this.n, this.cell, light);
      this.apply(mask, performance.now() - started);
      return;
    }
    this.pending = true;
    const id = ++this.pendingId;
    const message: Record<string, unknown> = {
      id,
      n: this.n,
      cell: this.cell,
      light,
    };
    if (!this.sentHeights) {
      // Copy: the worker keeps its own grid between requests.
      message.heights = this.heights.slice();
      this.sentHeights = true;
    }
    this.worker.postMessage(message);
  }

  private apply(mask: Uint8Array, ms: number) {
    (this.texture.image.data as Uint8Array).set(mask);
    this.texture.needsUpdate = true;
    this.computeMS = ms;
    this.pending = false;
  }

  /**
   * Keeps a material out of the mask. Used for water: a coarse shadow reads
   * as a hard dark slab on the sea, where reflected sky dominates.
   */
  exclude(material: THREE.Material) {
    this.excluded.add(material);
  }

  /** Darkens direct light (diffuse and specular) by the mask. */
  install(material: THREE.Material) {
    if (
      !(material instanceof THREE.MeshStandardMaterial) ||
      this.installed.has(material) ||
      this.excluded.has(material)
    )
      return;
    this.installed.add(material);
    const prior = material.onBeforeCompile,
      key = material.customProgramCacheKey();
    material.onBeforeCompile = (shader, renderer) => {
      prior.call(material, shader, renderer);
      Object.assign(shader.uniforms, this.uniforms);
      if (shader.vertexShader.includes("varying vec2 vSunMaskXZ;")) return;
      shader.vertexShader =
        `varying vec2 vSunMaskXZ;\n${shader.vertexShader}`.replace(
          "#include <project_vertex>",
          `#include <project_vertex>
        vec4 sunMaskPosition = vec4(transformed, 1.);
        #ifdef USE_BATCHING
          sunMaskPosition = batchingMatrix * sunMaskPosition;
        #endif
        #ifdef USE_INSTANCING
          sunMaskPosition = instanceMatrix * sunMaskPosition;
        #endif
        vSunMaskXZ = (modelMatrix * sunMaskPosition).xz;`,
        );
      shader.fragmentShader = `varying vec2 vSunMaskXZ;
        uniform sampler2D sunMaskMap;
        uniform float sunMaskWorldSize;
        ${shader.fragmentShader}`.replace(
        "#include <lights_fragment_end>",
        `#include <lights_fragment_end>
        float sunMask = texture2D(sunMaskMap, vSunMaskXZ / sunMaskWorldSize).r;
        reflectedLight.directDiffuse *= sunMask;
        reflectedLight.directSpecular *= sunMask;`,
      );
    };
    material.customProgramCacheKey = () => `${key}:sun-mask-v1`;
    material.needsUpdate = true;
  }

  dispose() {
    this.worker?.terminate();
    this.worker = undefined;
    this.texture.dispose();
  }
}

const scratch = new THREE.Vector3();
function normalized(v: LightDirection) {
  return scratch.set(v.x, v.y, v.z).normalize();
}
