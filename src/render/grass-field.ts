import * as THREE from "three";

/** What the grass needs from the terrain; TerrainView satisfies it. */
export interface GrassGround {
  sample(x: number, z: number): number;
  baseHeight(x: number, z: number): number;
  waterSurface(x: number, z: number): number | undefined;
  roadDistanceAt(x: number, z: number): number;
  insideCastle(x: number, z: number): boolean;
  editRevisionAt(x: number, z: number): number;
  groundColor(color: THREE.Color, x: number, z: number, slope: number): THREE.Color;
}

export const GRASS_TILE = 12;
export const GRASS_PER_TILE = 84;
const BLADES = 7;
/** Above this height over the ground the blades are sub-pixel, so they are skipped. */
const GRASS_CEILING = 140;
const TILE_BUILDS_PER_FRAME = 6;

/** Blade radius by render quality: Ultra/High 72 m, down to none in Recovery. */
export function grassRadius(treeDistance: number) {
  return treeDistance >= 360 ? 72 : treeDistance >= 300 ? 58 : treeDistance >= 240 ? 42 : 0;
}

/** Deterministic per-tile scatter, so a tile always regrows the same blades. */
function grassHash(x: number, z: number, i: number) {
  let h = Math.imul(x, 374761393) ^ Math.imul(z, 668265263) ^ Math.imul(i, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** A clump of curved, tapered blades in a unit box (ground origin, height 1). */
export function grassClumpGeometry() {
  const positions: number[] = [],
    heights: number[] = [];
  for (let b = 0; b < BLADES; b++) {
    const angle = b * 2.399963 + 0.3,
      reach = 0.1 + (b % 3) * 0.09,
      ox = Math.cos(angle) * reach * 0.5,
      oz = Math.sin(angle) * reach * 0.5,
      // Each blade faces across its lean so the clump reads from every side.
      fx = -Math.sin(angle),
      fz = Math.cos(angle),
      tall = 0.62 + ((b * 7) % 5) * 0.095,
      width = 0.045 + (b % 2) * 0.015,
      lean = 0.18 + (b % 4) * 0.07;
    const point = (t: number, side: number) => {
      const bend = lean * t * t,
        w = width * (1 - t * 0.85) * side;
      return [
        ox + Math.cos(angle) * bend + fx * w,
        tall * t,
        oz + Math.sin(angle) * bend + fz * w,
      ];
    };
    const l0 = point(0, -1),
      r0 = point(0, 1),
      l1 = point(0.5, -1),
      r1 = point(0.5, 1),
      tip = point(1, 0);
    for (const v of [l0, r0, r1, l0, r1, l1, l1, r1, tip]) {
      positions.push(...v);
      heights.push(v[1]);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  // Ground-facing normals light blades exactly like the soil they grow from,
  // so the field blends into the terrain instead of glinting at grazing angles.
  const normals = new Float32Array(positions.length);
  for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute("bladeY", new THREE.Float32BufferAttribute(heights, 1));
  geometry.name = "grass-clump";
  return geometry;
}

interface Tile {
  slot: number;
  revision: number;
}

/**
 * Camera-following 3D grass. Tiles of blade clumps are scattered on grassy,
 * undamaged ground near the camera, sway in a shared wind and shrink away at
 * the edge of the field. Purely presentational: no entities, saves or physics.
 */
export class GrassField {
  readonly mesh: THREE.InstancedMesh;
  readonly time = { value: 0 };
  private camera = { value: new THREE.Vector3() };
  private radius = { value: 0 };
  private tiles = new Map<string, Tile>();
  private free: number[] = [];
  private capacityTiles: number;
  private matrix = new THREE.Matrix4();
  private quaternion = new THREE.Quaternion();
  private position = new THREE.Vector3();
  private scale = new THREE.Vector3();
  private color = new THREE.Color();
  private up = new THREE.Vector3(0, 1, 0);
  private zero = new THREE.Matrix4().makeScale(0, 0, 0);
  private dirtySlots = new Set<number>();
  readonly material: THREE.MeshStandardMaterial;

  constructor(
    private ground: GrassGround,
    radius: number,
    maxRadius = 72,
  ) {
    const span = 2 * Math.ceil((maxRadius + GRASS_TILE) / GRASS_TILE) + 1;
    this.capacityTiles = span * span;
    this.material = new THREE.MeshStandardMaterial({
      roughness: 1,
      metalness: 0,
      side: THREE.DoubleSide,
    });
    this.material.onBeforeCompile = (shader) => {
      shader.uniforms.grassTime = this.time;
      shader.uniforms.grassCamera = this.camera;
      shader.uniforms.grassRadius = this.radius;
      shader.vertexShader = `attribute float bladeY;
uniform float grassTime;
uniform vec3 grassCamera;
uniform float grassRadius;
varying float vBladeY;
${shader.vertexShader}`.replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
vBladeY = bladeY;
vec3 grassOrigin = vec3(0.0);
#ifdef USE_INSTANCING
grassOrigin = instanceMatrix[3].xyz;
#endif
float grassDistance = distance(grassOrigin.xz, grassCamera.xz);
transformed *= 1.0 - smoothstep(grassRadius * 0.62, grassRadius, grassDistance);
// Rolling gusts travel across the field in world space.
float gustPhase = dot(grassOrigin.xz, vec2(0.071, 0.043)) - grassTime * 1.6;
float gust = 0.55 + 0.45 * sin(gustPhase) + 0.18 * sin(gustPhase * 2.7 + grassOrigin.x * 0.21);
vec3 grassWind = vec3(0.8, 0.0, 0.6) * gust * 0.32
  + vec3(sin(grassTime * 3.3 + grassOrigin.z * 0.5), 0.0, cos(grassTime * 2.9 + grassOrigin.x * 0.5)) * 0.05;
#ifdef USE_INSTANCING
mat3 grassBasis = mat3(instanceMatrix);
grassWind = transpose(grassBasis) * grassWind / max(dot(grassBasis[0], grassBasis[0]), 1e-4);
#endif
float grassBend = bladeY * bladeY;
transformed.xz += grassWind.xz * grassBend;
transformed.y -= length(grassWind.xz) * grassBend * 0.25;
`,
      );
      shader.fragmentShader = `varying float vBladeY;
${shader.fragmentShader}`.replace(
        "#include <color_fragment>",
        `#include <color_fragment>
// Shaded roots, sunlit straw-tinted tips.
diffuseColor.rgb *= mix(0.5, 1.12, vBladeY);
diffuseColor.rgb += vec3(0.05, 0.045, 0.0) * smoothstep(0.55, 1.0, vBladeY);
`,
      );
    };
    this.material.customProgramCacheKey = () => "grass-field-v1";
    const geometry = grassClumpGeometry();
    this.mesh = new THREE.InstancedMesh(
      geometry,
      this.material,
      this.capacityTiles * GRASS_PER_TILE,
    );
    this.mesh.name = "grass-field";
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < this.mesh.count; i++) {
      this.mesh.setMatrixAt(i, this.zero);
      this.mesh.setColorAt(i, this.color.setRGB(0, 0, 0));
    }
    this.mesh.instanceColor!.setUsage(THREE.DynamicDrawUsage);
    for (let slot = this.capacityTiles - 1; slot >= 0; slot--) this.free.push(slot);
    this.setRadius(radius);
  }

  get activeTiles() {
    return this.tiles.size;
  }

  setRadius(radius: number) {
    this.radius.value = Math.min(radius, (Math.sqrt(this.capacityTiles) - 1) / 2 * GRASS_TILE - GRASS_TILE);
    if (this.radius.value <= 0) this.clear();
  }

  clear() {
    for (const tile of this.tiles.values()) this.release(tile);
    this.tiles.clear();
    this.flush();
  }

  update(camera: THREE.Vector3, time: number) {
    this.time.value = time;
    this.camera.value.copy(camera);
    const radius = this.radius.value,
      above = camera.y - this.ground.sample(camera.x, camera.z);
    this.mesh.visible = radius > 0 && above < GRASS_CEILING;
    if (!this.mesh.visible) return;
    const reach = radius + GRASS_TILE,
      x0 = Math.floor((camera.x - reach) / GRASS_TILE),
      x1 = Math.floor((camera.x + reach) / GRASS_TILE),
      z0 = Math.floor((camera.z - reach) / GRASS_TILE),
      z1 = Math.floor((camera.z + reach) / GRASS_TILE),
      centre = (t: number) => (t + 0.5) * GRASS_TILE;
    // Drop tiles that fell behind, and regrow tiles whose ground was blasted.
    const wanted: [string, number, number, number][] = [];
    for (const [key, tile] of this.tiles) {
      const [tx, tz] = key.split(",").map(Number);
      const d = Math.hypot(centre(tx) - camera.x, centre(tz) - camera.z);
      if (d > reach + GRASS_TILE) {
        this.release(tile);
        this.tiles.delete(key);
      } else if (this.ground.editRevisionAt(centre(tx), centre(tz)) !== tile.revision) {
        this.release(tile);
        this.tiles.delete(key);
        wanted.push([key, tx, tz, -1]);
      }
    }
    for (let tz = z0; tz <= z1; tz++)
      for (let tx = x0; tx <= x1; tx++) {
        const key = `${tx},${tz}`;
        if (this.tiles.has(key)) continue;
        const d = Math.hypot(centre(tx) - camera.x, centre(tz) - camera.z);
        if (d <= reach) wanted.push([key, tx, tz, d]);
      }
    wanted.sort((a, b) => a[3] - b[3]);
    for (const [key, tx, tz] of wanted.slice(0, TILE_BUILDS_PER_FRAME)) {
      const slot = this.free.pop();
      if (slot === undefined) break;
      this.tiles.set(key, this.build(tx, tz, slot));
    }
    this.flush();
  }

  private release(tile: Tile) {
    const start = tile.slot * GRASS_PER_TILE;
    for (let i = 0; i < GRASS_PER_TILE; i++) this.mesh.setMatrixAt(start + i, this.zero);
    this.free.push(tile.slot);
    this.dirtySlots.add(tile.slot);
  }

  private build(tx: number, tz: number, slot: number): Tile {
    const ground = this.ground,
      start = slot * GRASS_PER_TILE,
      revision = ground.editRevisionAt((tx + 0.5) * GRASS_TILE, (tz + 0.5) * GRASS_TILE);
    for (let i = 0; i < GRASS_PER_TILE; i++) {
      const x = (tx + grassHash(tx, tz, i * 4)) * GRASS_TILE,
        z = (tz + grassHash(tx, tz, i * 4 + 1)) * GRASS_TILE;
      const placed = this.place(x, z, grassHash(tx, tz, i * 4 + 2), grassHash(tx, tz, i * 4 + 3));
      this.mesh.setMatrixAt(start + i, placed ? this.matrix : this.zero);
      if (placed) this.mesh.setColorAt(start + i, this.color);
    }
    this.dirtySlots.add(slot);
    return { slot, revision };
  }

  /** Fills matrix and color for one clump, or returns false where grass cannot grow. */
  private place(x: number, z: number, r1: number, r2: number) {
    const ground = this.ground,
      h = ground.sample(x, z);
    if (h < 1.5 || Math.abs(h - ground.baseHeight(x, z)) > 0.3) return false;
    if (ground.waterSurface(x, z) !== undefined) return false;
    if (ground.roadDistanceAt(x, z) < 4.2 || ground.insideCastle(x, z)) return false;
    const dx = ground.sample(x - 2, z) - ground.sample(x + 2, z),
      dz = ground.sample(x, z - 2) - ground.sample(x, z + 2),
      slope = Math.hypot(dx, dz) * 0.25;
    if (slope > 0.55) return false;
    const c = ground.groundColor(this.color, x, z, slope);
    // Only green ground grows blades: sand, scree, mud and rock stay bare.
    if (c.g < c.r * 1.08 || c.g < c.b * 1.5) return false;
    // Meadow patches: taller, sparser tussocks in some places, short turf in others.
    const meadow =
      0.5 +
      0.3 * Math.sin(x * 0.021 + Math.sin(z * 0.013) * 2.1) * Math.sin(z * 0.017 - x * 0.006) +
      0.2 * Math.sin(x * 0.083 - z * 0.061);
    if (r1 < 0.18 * (1 - meadow)) return false;
    const tall = (0.32 + meadow * 0.75) * (0.7 + r2 * 0.6),
      wide = 0.75 + r1 * 0.7;
    // The terrain multiplies its vertex color by a ~0.74 luminance detail map.
    const tint = 0.72 + (r2 - 0.5) * 0.12,
      dry = Math.max(0, meadow - 0.7) * 0.5;
    c.setRGB(
      c.r * tint * (1 + dry * 0.9),
      c.g * tint * (1 + dry * 0.25),
      c.b * tint * (1 - dry * 0.6),
    );
    this.position.set(x, h - 0.05, z);
    this.quaternion.setFromAxisAngle(this.up, r1 * Math.PI * 2);
    this.scale.set(wide, tall, wide);
    this.matrix.compose(this.position, this.quaternion, this.scale);
    return true;
  }

  private flush() {
    if (!this.dirtySlots.size) return;
    const matrices = this.mesh.instanceMatrix,
      colors = this.mesh.instanceColor!;
    for (const slot of this.dirtySlots) {
      matrices.addUpdateRange(slot * GRASS_PER_TILE * 16, GRASS_PER_TILE * 16);
      colors.addUpdateRange(slot * GRASS_PER_TILE * 3, GRASS_PER_TILE * 3);
    }
    matrices.needsUpdate = true;
    colors.needsUpdate = true;
    this.dirtySlots.clear();
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.mesh.dispose();
  }
}
