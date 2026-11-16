import * as THREE from "three";
import { TRUCK } from "../config";
import type { PlaneState } from "../types";

const smooth = (t: number) => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};
/** Overshoots past 1 and settles, for a springy pop-in. */
const backOut = (t: number) => {
  const x = Math.min(1, Math.max(0, t)),
    c = 1.9;
  return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2);
};

/** Cartoon smoke: a pool of lumpy grey balls that swell and shrink away. */
export class SmokePuffs {
  readonly mesh: THREE.InstancedMesh;
  private readonly capacity = 96;
  private p = new Float32Array(this.capacity * 3);
  private v = new Float32Array(this.capacity * 3);
  private age = new Float32Array(this.capacity).fill(Infinity);
  private life = new Float32Array(this.capacity).fill(1);
  private size = new Float32Array(this.capacity);
  private next = 0;
  private matrix = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();
  private t = new THREE.Vector3();
  constructor() {
    const material = new THREE.MeshStandardMaterial({
      color: "#d8d6d2",
      roughness: 1,
      flatShading: true,
    });
    this.mesh = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(1, 1),
      material,
      this.capacity,
    );
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.castShadow = false;
  }
  emit(at: THREE.Vector3, velocity: THREE.Vector3, size: number, life = 1) {
    const i = this.next++ % this.capacity;
    this.p.set([at.x, at.y, at.z], i * 3);
    this.v.set([velocity.x, velocity.y, velocity.z], i * 3);
    this.age[i] = 0;
    this.life[i] = life;
    this.size[i] = size;
  }
  /** A ring of puffs bursting outward from a point. */
  burst(at: THREE.Vector3, radius: number, count = 22) {
    const dir = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      const a = i * 2.39996,
        y = ((i * 7) % count) / count - 0.35;
      dir.set(Math.cos(a), y, Math.sin(a)).normalize();
      this.emit(
        at.clone().addScaledVector(dir, radius * 0.6),
        dir.multiplyScalar(radius * (2.2 + (i % 3) * 0.6)),
        radius * (0.16 + (i % 4) * 0.05),
        0.7 + (i % 5) * 0.1,
      );
    }
  }
  update(dt: number) {
    let count = 0;
    for (let i = 0; i < this.capacity; i++) {
      if (this.age[i] >= this.life[i]) continue;
      this.age[i] += dt;
      const k = i * 3,
        drag = Math.exp(-dt * 2.5);
      for (let j = 0; j < 3; j++) {
        this.v[k + j] *= drag;
        this.p[k + j] += this.v[k + j] * dt;
      }
      this.v[k + 1] += 2.5 * dt;
      const t = this.age[i] / this.life[i];
      if (t >= 1) continue;
      const scale = this.size[i] * Math.sqrt(Math.sin(Math.PI * Math.min(1, t * 1.15 + 0.08)));
      this.t.set(this.p[k], this.p[k + 1], this.p[k + 2]);
      this.q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, i * 1.3 + t);
      this.s.setScalar(Math.max(0.001, scale));
      this.matrix.compose(this.t, this.q, this.s);
      this.mesh.setMatrixAt(count++, this.matrix);
    }
    this.mesh.count = count;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
  reset() {
    this.age.fill(Infinity);
    this.mesh.count = 0;
  }
}

function canopyTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 64;
  const c = canvas.getContext("2d")!;
  for (let i = 0; i < 12; i++) {
    c.fillStyle = i % 2 ? "#fbf6ec" : "#f26b1d";
    c.fillRect((i * 512) / 12, 0, 512 / 12 + 1, 64);
  }
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  return map;
}

/** Striped round canopy with cords down to the truck's corners. */
export class Parachute {
  readonly group = new THREE.Group();
  private canopy: THREE.Mesh;
  private cords: THREE.LineSegments;
  private cordPositions = new Float32Array(10 * 2 * 3);
  // Roof corners in truck space; the truck group itself is unscaled.
  private anchors = [
    [1.3, 2.6, 3.0],
    [-1.3, 2.6, 3.0],
    [1.3, 2.4, -4.5],
    [-1.3, 2.4, -4.5],
  ].map(([x, y, z]) => new THREE.Vector3(x, y, z).multiplyScalar(TRUCK.scale));
  private rim: THREE.Vector3[] = [];
  private v = new THREE.Vector3();
  constructor() {
    const canopyGeometry = new THREE.SphereGeometry(
      8,
      24,
      8,
      0,
      Math.PI * 2,
      0,
      Math.PI * 0.42,
    );
    this.canopy = new THREE.Mesh(
      canopyGeometry,
      new THREE.MeshStandardMaterial({
        map: canopyTexture(),
        roughness: 0.85,
        side: THREE.DoubleSide,
      }),
    );
    this.canopy.castShadow = true;
    const rimRadius = 8 * Math.sin(Math.PI * 0.42),
      rimDrop = 8 * Math.cos(Math.PI * 0.42);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      this.rim.push(
        new THREE.Vector3(Math.cos(a) * rimRadius, rimDrop, Math.sin(a) * rimRadius),
      );
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(this.cordPositions, 3).setUsage(
        THREE.DynamicDrawUsage,
      ),
    );
    this.cords = new THREE.LineSegments(
      geometry,
      new THREE.LineBasicMaterial({ color: "#3b3732" }),
    );
    this.cords.frustumCulled = false;
    this.group.add(this.canopy, this.cords);
    this.group.visible = false;
  }
  /**
   * `open` 0..1 inflates the canopy; `collapse` 0..1 deflates it and lets it
   * drift away after landing.
   */
  update(truck: THREE.Object3D, open: number, collapse: number, time: number) {
    this.group.visible = open > 0.01 && collapse < 1;
    if (!this.group.visible) return;
    truck.updateMatrixWorld();
    const sway = Math.sin(time * 1.3) * 0.09 * (1 - collapse);
    const height = (15 - collapse * 9) * TRUCK.scale;
    this.canopy.position
      .copy(truck.position)
      .add(this.v.set(collapse * 9, height, collapse * 4));
    this.canopy.rotation.set(sway, 0, Math.cos(time * 1.1) * 0.07 + collapse * 1.2);
    const inflate = smooth(open);
    const size = 1.3;
    this.canopy.scale.set(
      size * (0.25 + 0.75 * inflate),
      size * (0.4 + 0.6 * inflate) * (1 - collapse * 0.85),
      size * (0.25 + 0.75 * inflate),
    );
    this.canopy.updateMatrixWorld();
    for (let i = 0; i < 10; i++) {
      const top = this.v.copy(this.rim[i]).applyMatrix4(this.canopy.matrixWorld);
      this.cordPositions.set([top.x, top.y, top.z], i * 6);
      const end = this.anchors[i % 4].clone().applyMatrix4(truck.matrixWorld);
      // Cords go slack as the canopy falls away.
      if (collapse > 0) end.lerp(top, collapse * 0.6);
      this.cordPositions.set([end.x, end.y, end.z], i * 6 + 3);
    }
    this.cords.geometry.attributes.position.needsUpdate = true;
  }
}

export interface VehicleShow {
  jet: number;
  truck: number;
  rocket: number;
  chuteOpen: number;
  chuteCollapse: number;
  /** 0 = air camera, 1 = ground camera. */
  groundCamera: number;
  /** True on the frame a smoke puff should burst at the vehicle. */
  puff: boolean;
}

/**
 * Timeline for V: the jet puffs into a parachuting truck, and the truck
 * rears up on rockets then puffs into the jet. Respawns and loads snap.
 */
export class VehicleTransition {
  private mode?: string;
  private kind: "none" | "toGround" | "toAir" = "none";
  private age = 0;
  private landedAt = -1;
  private wasChute = false;
  private camera = 0;
  private puffed = false;
  readonly show: VehicleShow = {
    jet: 1,
    truck: 0,
    rocket: 0,
    chuteOpen: 0,
    chuteCollapse: 1,
    groundCamera: 0,
    puff: false,
  };
  /** True while a swap animation is playing. */
  get active() {
    return this.kind !== "none";
  }
  update(plane: PlaneState, dt: number) {
    const mode = plane.mode === "ground" ? "ground" : "air";
    const show = this.show;
    show.puff = false;
    if (this.mode !== mode) {
      if (this.mode && mode === "ground" && plane.chute) {
        this.kind = "toGround";
        this.age = 0;
        this.landedAt = -1;
        this.puffed = false;
      } else if (this.mode && mode === "air" && (plane.launch ?? 0) > 0) {
        this.kind = "toAir";
        this.age = 0;
        this.puffed = false;
      } else {
        this.kind = "none";
        this.camera = mode === "ground" ? 1 : 0;
      }
      this.mode = mode;
    }
    this.age += dt;
    const a = this.age;
    show.rocket = 0;
    if (this.kind === "toGround") {
      if (!this.puffed) {
        show.puff = this.puffed = true;
      }
      show.jet = 1 - smooth(a / 0.3);
      show.truck = backOut((a - 0.12) / 0.45);
      show.chuteOpen = smooth((a - 0.2) / 0.5);
      if (this.wasChute && !plane.chute && this.landedAt < 0) this.landedAt = a;
      show.chuteCollapse =
        this.landedAt < 0 ? 0 : Math.min(1, (a - this.landedAt) / 0.8);
      if (this.landedAt >= 0 && show.chuteCollapse >= 1) this.kind = "none";
    } else if (this.kind === "toAir") {
      show.chuteOpen = 0;
      show.chuteCollapse = 1;
      const swap = 0.45;
      show.rocket = a < swap ? smooth(a / 0.12) : 1 - smooth((a - swap) / 0.25);
      if (a >= swap && !this.puffed) show.puff = this.puffed = true;
      show.truck = a < swap ? 1 : 1 - smooth((a - swap) / 0.25);
      show.jet = a < swap ? 0 : backOut((a - swap - 0.05) / 0.4);
      if (a > swap + 0.6) this.kind = "none";
    } else {
      show.jet = mode === "air" ? 1 : 0;
      show.truck = mode === "ground" ? 1 : 0;
      show.chuteOpen = 0;
      show.chuteCollapse = 1;
    }
    this.wasChute = !!plane.chute;
    const target = mode === "ground" ? 1 : 0;
    this.camera += Math.sign(target - this.camera) * Math.min(Math.abs(target - this.camera), dt / 0.8);
    show.groundCamera = smooth(this.camera);
  }
  reset() {
    this.mode = undefined;
    this.kind = "none";
  }
}
