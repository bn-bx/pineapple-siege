import * as THREE from "three";
import { CONFIG } from "../config";
import type { Vec3, WorldData, Entity } from "../types";

export interface VillageWindow {
  owner: number;
  p: Vec3;
  s: Vec3;
}

/** Decorations derive from existing walls; no generated entities or save IDs change. */
export function villageDecorations(
  world: Pick<WorldData, "entities" | "lights">,
) {
  const houses = new Map<string, Entity[]>();
  for (const e of world.entities) {
    if (!e.assembly.includes("-house") || e.material !== "plaster") continue;
    let walls = houses.get(e.assembly);
    if (!walls) houses.set(e.assembly, (walls = []));
    walls.push(e);
  }
  const windows: VillageWindow[] = [],
    lamps = world.lights.slice();
  for (const walls of houses.values()) {
    const candidates = walls.filter(
      (e) => !e.foundation && e.s[2] <= 1.1 && e.s[0] > 1.5,
    );
    if (!candidates.length) continue;
    const low = Math.min(...candidates.map((e) => e.p[1]));
    const front = Math.min(...candidates.map((e) => e.p[2])),
      back = Math.max(...candidates.map((e) => e.p[2]));
    for (const [z, sign] of [
      [front, -1],
      [back, 1],
    ]) {
      const wall = candidates.find((e) => e.p[1] === low && e.p[2] === z);
      if (!wall) continue;
      const p: Vec3 = [
        wall.p[0],
        wall.p[1],
        wall.p[2] + sign * (wall.s[2] + 0.08),
      ];
      windows.push({ owner: wall.id, p, s: [2.2, 2.4, 0.12] });
      lamps.push({
        owner: wall.id,
        p: [p[0] + 1.8, p[1] - 0.8, p[2] + sign * 0.4],
      });
    }
  }
  // Lower curtain-wall torches light entrances and courtyards, not just rooftops.
  const curtains = new Map<string, Entity[]>();
  for (const e of world.entities) {
    if (
      e.material !== "sandstone" ||
      e.foundation ||
      !/:(front|rear|west|east|inner-west|inner-east|inner-front|middle-front)$/.test(
        e.assembly,
      )
    )
      continue;
    let walls = curtains.get(e.assembly);
    if (!walls) curtains.set(e.assembly, (walls = []));
    walls.push(e);
  }
  for (const walls of curtains.values()) {
    const low = Math.min(...walls.map((e) => e.p[1]));
    const row = walls.filter((e) => e.p[1] === low);
    let previous: Entity | undefined;
    for (const wall of row) {
      if (
        previous &&
        Math.hypot(wall.p[0] - previous.p[0], wall.p[2] - previous.p[2]) < 32
      )
        continue;
      previous = wall;
      const axis = wall.s[0] < wall.s[2] ? 0 : 2;
      for (const sign of [-1, 1]) {
        const p = wall.p.slice() as Vec3;
        p[axis] += sign * (wall.s[axis] + 0.6);
        lamps.push({ owner: wall.id, p });
      }
    }
  }
  return { lamps, windows };
}

/** One instanced lamp draw and four stable, unshadowed local lights. */
export class VillageLighting {
  readonly mesh: THREE.InstancedMesh;
  readonly windows: THREE.InstancedMesh;
  readonly pools: THREE.InstancedMesh;
  readonly lights: THREE.PointLight[] = [];
  private positions: THREE.Vector3[];
  private visible: Uint8Array;
  private nearest = new Int32Array(4).fill(-1);
  private distances = new Float64Array(4);
  private assigned = new Int32Array(4).fill(-1);
  private matrix = new THREE.Matrix4();
  private zero = new THREE.Matrix4().makeScale(0, 0, 0);
  private windowVisible: Uint8Array;
  private windowPositions: THREE.Vector3[];
  private windowMatrices: THREE.Matrix4[];
  constructor(
    private sources: { p: Vec3; owner: number }[],
    readonly windowSources: VillageWindow[] = [],
    heightTexture?: THREE.Texture,
  ) {
    this.mesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.6, 0.8, 0.6),
      new THREE.MeshStandardMaterial({
        color: "#ffe8a1",
        emissive: "#ffbd51",
        emissiveIntensity: 0,
      }),
      sources.length,
    );
    this.pools = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(54, 54, 6, 6).rotateX(-Math.PI / 2),
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: {
          height: { value: heightTexture },
          strength: { value: 0 },
          hasTerrain: { value: !!heightTexture },
        },
        vertexShader: `uniform sampler2D height; uniform bool hasTerrain;
          varying vec2 poolUV; varying float belowLamp;
          void main(){poolUV=uv;vec4 p=instanceMatrix*vec4(position,1.);
          float floorHeight=hasTerrain?texture2D(height,(p.xz/${CONFIG.spacing}.+.5)/${CONFIG.grid}.).r:p.y-2.;
          belowLamp=step(floorHeight,p.y);p.y=floorHeight+.12;
          gl_Position=projectionMatrix*viewMatrix*modelMatrix*p;}`,
        fragmentShader: `uniform float strength; varying vec2 poolUV;varying float belowLamp;
          void main(){float r=length(poolUV-.5)*2.;float glow=pow(max(0.,1.-r),2.);
          gl_FragColor=vec4(vec3(1.,.48,.13)*strength*glow*belowLamp,1.);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          }`,
      }),
      sources.length,
    );
    // Terrain-conforming spill provides distant light without more point lights.
    this.pools.frustumCulled = false;
    this.pools.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.positions = sources.map((s) => new THREE.Vector3(...s.p));
    this.visible = new Uint8Array(sources.length).fill(1);
    for (let i = 0; i < sources.length; i++) {
      this.matrix.makeTranslation(...sources[i].p);
      this.mesh.setMatrixAt(i, this.matrix);
      this.pools.setMatrixAt(i, this.matrix);
    }
    this.mesh.computeBoundingSphere();
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.windows = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({
        color: "#252d32",
        emissive: "#ffc077",
        emissiveIntensity: 0,
        roughness: 0.6,
      }),
      windowSources.length,
    );
    this.windowVisible = new Uint8Array(windowSources.length).fill(1);
    this.windowPositions = windowSources.map((s) => new THREE.Vector3(...s.p));
    this.windowMatrices = windowSources.map((s) =>
      new THREE.Matrix4().makeScale(...s.s).setPosition(...s.p),
    );
    for (let i = 0; i < windowSources.length; i++)
      this.windows.setMatrixAt(i, this.windowMatrices[i]);
    this.windows.computeBoundingSphere();
    this.windows.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < 4; i++)
      this.lights.push(new THREE.PointLight("#ffb65c", 0, 90, 2));
  }
  update(
    camera: THREE.Vector3,
    removed: ReadonlySet<number>,
    night: number,
    distance: number,
    dt: number,
  ) {
    this.nearest.fill(-1);
    this.distances.fill(Infinity);
    let changed = false;
    for (let i = 0; i < this.sources.length; i++) {
      const alive = !removed.has(this.sources[i].owner);
      const d = this.positions[i].distanceToSquared(camera);
      const visible = Number(alive && d < distance * distance);
      if (visible !== this.visible[i]) {
        this.visible[i] = visible;
        this.mesh.setMatrixAt(
          i,
          visible
            ? this.matrix.makeTranslation(...this.sources[i].p)
            : this.zero,
        );
        this.pools.setMatrixAt(
          i,
          visible
            ? this.matrix.makeTranslation(...this.sources[i].p)
            : this.zero,
        );
        changed = true;
      }
      if (!alive || night < 0.001 || d > 160 * 160) continue;
      // A small preference for current sources prevents swapping at equal distances.
      const score = this.assigned.includes(i) ? d * 0.9 : d;
      let at = 0;
      while (at < 4 && this.distances[at] <= score) at++;
      if (at === 4) continue;
      for (let j = 3; j > at; j--) {
        this.nearest[j] = this.nearest[j - 1];
        this.distances[j] = this.distances[j - 1];
      }
      this.nearest[at] = i;
      this.distances[at] = score;
    }
    if (changed) {
      this.mesh.instanceMatrix.needsUpdate = true;
      this.pools.instanceMatrix.needsUpdate = true;
    }
    this.pools.visible = night > 0.001;
    (this.pools.material as THREE.ShaderMaterial).uniforms.strength.value =
      night * 0.18;
    let windowsChanged = false;
    for (let i = 0; i < this.windowSources.length; i++) {
      const visible = Number(
        !removed.has(this.windowSources[i].owner) &&
          this.windowPositions[i].distanceToSquared(camera) <
            distance * distance,
      );
      if (visible === this.windowVisible[i]) continue;
      this.windowVisible[i] = visible;
      this.windows.setMatrixAt(i, visible ? this.windowMatrices[i] : this.zero);
      windowsChanged = true;
    }
    if (windowsChanged) this.windows.instanceMatrix.needsUpdate = true;
    (this.windows.material as THREE.MeshStandardMaterial).emissiveIntensity =
      night * 0.45;
    (this.mesh.material as THREE.MeshStandardMaterial).emissiveIntensity =
      night * 3.5;
    const fade = 1 - Math.exp(-Math.min(dt, 0.1) * 10);
    // Retain sources independently of their rank; fade old ones out before moving.
    for (let i = 0; i < 4; i++) {
      const light = this.lights[i],
        owner = this.assigned[i];
      if (owner >= 0 && removed.has(this.sources[owner].owner)) {
        light.intensity = 0;
        this.assigned[i] = -1;
      } else if (owner >= 0 && !this.nearest.includes(owner)) {
        light.intensity *= 1 - fade;
        if (light.intensity < 0.5) {
          light.intensity = 0;
          this.assigned[i] = -1;
        }
      }
    }
    for (let i = 0; i < 4; i++) {
      const light = this.lights[i];
      if (this.assigned[i] < 0) {
        for (const candidate of this.nearest)
          if (candidate >= 0 && !this.assigned.includes(candidate)) {
            this.assigned[i] = candidate;
            light.position.copy(this.positions[candidate]);
            break;
          }
      }
      if (this.assigned[i] >= 0 && this.nearest.includes(this.assigned[i]))
        light.intensity += (night * 650 - light.intensity) * fade;
    }
  }
}
