import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { TRUCK } from "../config";
import { bakeMaterialGroups } from "./infernal-jet";
import { crownLeaf, rindTexture } from "./pineapple-aircraft";

/**
 * Monster concrete mixer, modelled at base proportions and scaled up by
 * TRUCK.scale. Origin is TRUCK.rideHeight above the ground, +Z forward,
 * +Y up, +X to the truck's left.
 */
export const TRUCK_TYRE_RADIUS = 1.95;
/** Ride height in model units, before TRUCK.scale. */
const BASE_RIDE = TRUCK.rideHeight / TRUCK.scale;
const WHEEL_Y = -BASE_RIDE + TRUCK_TYRE_RADIUS;
const WHEEL_X = 2.35;
const AXLES = [3.2, -3.3];
const DRUM_TILT = 0.2;

type V3 = [number, number, number];

/** Rounded truck tyre: lathe carcass plus chunky chevron tread blocks. */
function tyreGeometry() {
  const r = TRUCK_TYRE_RADIUS;
  const profile = [
    [1.05, -0.74],
    [1.5, -0.82],
    [1.78, -0.79],
    [r - 0.04, -0.64],
    [r, -0.42],
    [r, 0.42],
    [r - 0.04, 0.64],
    [1.78, 0.79],
    [1.5, 0.82],
    [1.05, 0.74],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const carcass = new THREE.LatheGeometry(profile, 44);
  const parts: THREE.BufferGeometry[] = [carcass];
  const blocks = 26;
  for (let i = 0; i < blocks; i++)
    for (const side of [-1, 1]) {
      // Radial x, axial y, circumferential z; each half angles inward (chevron).
      const lug = new THREE.BoxGeometry(0.16, 0.62, 0.34);
      lug.rotateX(side * 0.45);
      lug.translate(r + 0.05, side * 0.3, 0);
      // Stagger the two halves so the tread reads as blocks.
      lug.rotateY(((i + (side > 0 ? 0.5 : 0)) / blocks) * Math.PI * 2);
      parts.push(lug);
    }
  const tyre = mergeGeometries(
    parts.map((p) => (p.index ? p.toNonIndexed() : p)),
  )!;
  for (const part of parts) part.dispose();
  // Axle along X.
  tyre.rotateZ(Math.PI / 2);
  tyre.computeVertexNormals();
  return tyre;
}

/** Drum stripes and the company name, wrapped around the lathe UVs. */
function drumTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 512;
  const c = canvas.getContext("2d")!;
  c.fillStyle = "#f4f1ea";
  c.fillRect(0, 0, 1024, 512);
  // Diagonal stripes become a spiral once wrapped around the drum.
  c.fillStyle = "#f07a12";
  for (let k = -4; k < 12; k++) {
    const x = k * 128;
    c.beginPath();
    c.moveTo(x, 0);
    c.lineTo(x + 46, 0);
    c.lineTo(x + 46 + 300, 512);
    c.lineTo(x + 300, 512);
    c.closePath();
    c.fill();
  }
  // Canvas X wraps around the drum and Y runs front to back, so the
  // lettering is drawn turned a quarter, in a clean band on each side.
  for (const [u, turn] of [
    [0.25, Math.PI / 2],
    [0.75, -Math.PI / 2],
  ]) {
    c.fillStyle = "#f4f1ea";
    c.fillRect(u * 1024 - 70, 70, 140, 380);
    c.save();
    c.translate(u * 1024, 260);
    c.rotate(turn);
    c.fillStyle = "#1d2a33";
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.font = "bold 50px Arial, Helvetica, sans-serif";
    c.fillText("PINEAPPLE", 0, -26);
    c.font = "bold 34px Arial, Helvetica, sans-serif";
    c.fillText("CONCRETE CO.", 0, 26);
    c.restore();
  }
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  return map;
}

/** Door logo: a pineapple badge and the company name on cab yellow. */
function doorTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 384;
  const c = canvas.getContext("2d")!;
  c.fillStyle = "#f2b705";
  c.fillRect(0, 0, 512, 384);
  c.fillStyle = "#1d2a33";
  c.beginPath();
  c.arc(256, 150, 92, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = "#e5a72a";
  c.beginPath();
  c.ellipse(256, 168, 44, 58, 0, 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = "#8a5a12";
  c.lineWidth = 4;
  for (let i = -3; i <= 3; i++) {
    c.beginPath();
    c.moveTo(256 + i * 16 - 40, 120);
    c.lineTo(256 + i * 16 + 40, 220);
    c.stroke();
    c.beginPath();
    c.moveTo(256 + i * 16 + 40, 120);
    c.lineTo(256 + i * 16 - 40, 220);
    c.stroke();
  }
  c.fillStyle = "#4f9a3c";
  for (const a of [-0.6, -0.2, 0.2, 0.6]) {
    c.beginPath();
    c.ellipse(256 + a * 40, 92, 9, 34, a, 0, Math.PI * 2);
    c.fill();
  }
  c.fillStyle = "#1d2a33";
  c.font = "bold 46px Arial, Helvetica, sans-serif";
  c.textAlign = "center";
  c.fillText("PINEAPPLE", 256, 300);
  c.font = "bold 34px Arial, Helvetica, sans-serif";
  c.fillText("CONCRETE CO.", 256, 345);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  return map;
}

/** Side profile (z forward, y up) of a short-hood mixer cab, extruded across X. */
function cabShell(width: number) {
  const outline: [number, number][] = [
    [1.55, -0.55],
    [5.0, -0.55],
    [5.12, 0.15],
    [5.0, 0.95],
    [3.85, 1.08],
    [3.62, 2.42],
    [3.4, 2.58],
    [1.7, 2.58],
    [1.55, 2.42],
  ];
  const shape = new THREE.Shape();
  shape.moveTo(...outline[0]);
  for (const point of outline.slice(1)) shape.lineTo(...point);
  shape.closePath();
  const bevel = 0.14;
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: width - bevel * 2,
    bevelEnabled: true,
    bevelSize: bevel,
    bevelThickness: bevel,
    bevelSegments: 3,
    curveSegments: 4,
  });
  geometry.rotateY(-Math.PI / 2);
  geometry.translate(width / 2 - bevel, 0, 0);
  geometry.computeVertexNormals();
  return geometry;
}

/** Half-annulus arch over a tyre, extruded across X. */
function fenderArch(inner: number, outer: number, width: number) {
  const shape = new THREE.Shape();
  shape.absarc(0, 0, outer, -0.15, Math.PI + 0.15, false);
  shape.absarc(0, 0, inner, Math.PI + 0.15, -0.15, true);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: width,
    bevelEnabled: false,
    curveSegments: 18,
  });
  geometry.translate(0, 0, -width / 2);
  // Shape X becomes forward Z; extrusion becomes the width across X.
  geometry.rotateY(-Math.PI / 2);
  return geometry;
}

export interface ConcreteTruck {
  group: THREE.Group;
  /** Signed ground speed (m/s), steering (-1..1), frame time. */
  update(speed: number, steer: number, dt: number): void;
  setPour(on: boolean): void;
  /** Turret yaw relative to the heading (+ is left) and barrel pitch (+ up). */
  setAim(yaw: number, pitch: number): void;
  /** Rocket flame strength, 0..1. */
  setRocket(level: number): void;
  /** World position of the chute's lip, where poured concrete leaves. */
  chuteTip(out: THREE.Vector3): THREE.Vector3;
  /** World direction the chute points. */
  chuteDirection(out: THREE.Vector3): THREE.Vector3;
  reset(): void;
}

export function makeConcreteTruck(): ConcreteTruck {
  const group = new THREE.Group();
  const model = new THREE.Group();
  model.scale.setScalar(TRUCK.scale);
  group.add(model);
  const body = new THREE.Group();
  const frame = new THREE.Group();

  const yellow = new THREE.MeshStandardMaterial({
    color: "#f2b705",
    roughness: 0.42,
    metalness: 0.15,
  });
  const darkSteel = new THREE.MeshStandardMaterial({
    color: "#2c2f33",
    roughness: 0.6,
    metalness: 0.5,
  });
  // Low metalness keeps bare metal bright without an environment map.
  const steel = new THREE.MeshStandardMaterial({
    color: "#b4b9c0",
    roughness: 0.4,
    metalness: 0.3,
  });
  const chrome = new THREE.MeshStandardMaterial({
    color: "#f4f6f8",
    roughness: 0.18,
    metalness: 0.55,
  });
  const glass = new THREE.MeshStandardMaterial({
    color: "#6f93a8",
    roughness: 0.08,
    metalness: 0.35,
    emissive: "#1c3442",
    emissiveIntensity: 0.4,
  });
  const black = new THREE.MeshStandardMaterial({
    color: "#1b1c1e",
    roughness: 0.8,
  });
  const lamp = new THREE.MeshStandardMaterial({
    color: "#fff4d6",
    emissive: "#ffe6a8",
    emissiveIntensity: 1.6,
  });
  const amber = new THREE.MeshStandardMaterial({
    color: "#ffb02e",
    emissive: "#ff9a1a",
    emissiveIntensity: 1.4,
  });
  const tail = new THREE.MeshStandardMaterial({
    color: "#b3201a",
    emissive: "#ff2a1a",
    emissiveIntensity: 1,
  });
  const spring = new THREE.MeshStandardMaterial({
    color: "#ff6a12",
    roughness: 0.4,
    metalness: 0.3,
  });
  const door = new THREE.MeshStandardMaterial({
    map: doorTexture(),
    roughness: 0.42,
    metalness: 0.15,
  });
  const map = rindTexture();
  const rind = new THREE.MeshStandardMaterial({
    map,
    bumpMap: map,
    bumpScale: 0.08,
    color: "#f3ca66",
    roughness: 0.7,
  });
  const sheet = new THREE.MeshStandardMaterial({
    color: "#b9bec5",
    roughness: 0.45,
    metalness: 0.25,
    side: THREE.DoubleSide,
  });
  const leafGreen = new THREE.MeshStandardMaterial({
    color: "#3a7a4c",
    roughness: 0.6,
    side: THREE.DoubleSide,
  });

  const add = (
    parent: THREE.Object3D,
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    p: V3 = [0, 0, 0],
  ) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(...p);
    parent.add(mesh);
    return mesh;
  };
  const box = (parent: THREE.Object3D, size: V3, m: THREE.Material, p: V3) =>
    add(parent, new THREE.BoxGeometry(...size), m, p);
  const cylinder = (
    parent: THREE.Object3D,
    radius: number,
    length: number,
    m: THREE.Material,
    p: V3,
    axis: "x" | "y" | "z" = "y",
    segments = 16,
  ) => {
    const g = new THREE.CylinderGeometry(radius, radius, length, segments);
    if (axis === "x") g.rotateZ(Math.PI / 2);
    if (axis === "z") g.rotateX(Math.PI / 2);
    return add(parent, g, m, p);
  };

  // ---------------- Cab ----------------
  const cabWidth = 2.9;
  add(body, cabShell(cabWidth), yellow);
  // Windshield set into the raked front of the cab.
  const windshield = box(body, [2.5, 1.25, 0.06], glass, [0, 1.76, 3.79]);
  windshield.rotation.x = -0.17;
  for (const side of [-1, 1]) {
    // Door window and the logo panel below it.
    box(body, [0.04, 1.0, 1.45], glass, [side * 1.46, 1.8, 2.6]);
    const logo = add(
      body,
      new THREE.PlaneGeometry(1.5, 1.1),
      door,
      [side * 1.465, 0.42, 2.6],
    );
    logo.rotation.y = side * (Math.PI / 2);
    // Door seam and handle.
    box(body, [0.03, 2.4, 0.04], darkSteel, [side * 1.465, 0.95, 1.8]);
    box(body, [0.06, 0.07, 0.3], chrome, [side * 1.48, 1.12, 2.0]);
    // Side mirrors on chrome arms.
    box(body, [0.5, 0.06, 0.06], chrome, [side * 1.7, 1.55, 3.6]);
    box(body, [0.12, 0.75, 0.32], black, [side * 1.98, 1.55, 3.55]);
    // Steps below the door.
    box(body, [0.3, 0.06, 0.8], steel, [side * 1.55, -0.85, 2.5]);
    box(body, [0.3, 0.06, 0.8], steel, [side * 1.55, -0.25, 2.5]);
  }
  // Grille, bumper and lamps.
  box(body, [1.8, 1.05, 0.08], chrome, [0, 0.35, 5.12]);
  for (let i = 0; i < 6; i++)
    box(body, [1.6, 0.06, 0.1], darkSteel, [0, -0.05 + i * 0.16, 5.15]);
  box(body, [3.1, 0.45, 0.5], steel, [0, -0.72, 5.2]);
  for (const side of [-1, 1]) {
    cylinder(body, 0.22, 0.12, lamp, [side * 1.18, 0.55, 5.1], "z", 18);
    box(body, [0.22, 0.12, 0.08], amber, [side * 1.2, 0.22, 5.12]);
  }
  // Roof: amber beacon bar, air horns and the turret ring.
  box(body, [1.4, 0.16, 0.3], amber, [0, 2.8, 3.15]);
  box(body, [1.55, 0.06, 0.36], darkSteel, [0, 2.7, 3.15]);
  for (const side of [-1, 1])
    cylinder(body, 0.07, 0.7, chrome, [side * 1.1, 2.72, 2.0], "z", 10);
  cylinder(body, 0.62, 0.22, darkSteel, [0, 2.72, 2.3], "y", 24);
  // Exhaust stack behind the cab.
  cylinder(body, 0.17, 3.6, chrome, [-1.15, 1.25, 1.35]);
  cylinder(body, 0.19, 0.2, black, [-1.15, 3.12, 1.35]);
  // Water tank between cab and drum.
  cylinder(body, 0.48, 2.0, steel, [0, 0.25, 1.15], "x", 20);

  // ---------------- Pineapple cannon turret ----------------
  // Yaws on the roof ring; the pineapple head pitches with the barrel.
  const turretYaw = new THREE.Group();
  turretYaw.position.set(0, 2.83, 2.3);
  const turretPitch = new THREE.Group();
  turretPitch.position.y = 0.45;
  turretYaw.add(turretPitch);
  cylinder(turretYaw, 0.5, 0.2, yellow, [0, 0.08, 0], "y", 20);
  const head = add(turretPitch, new THREE.SphereGeometry(0.5, 20, 14), rind);
  head.scale.set(1, 1.3, 1);
  for (const y of [-0.25, 0.25]) {
    const band = add(
      turretPitch,
      new THREE.TorusGeometry(0.47, 0.035, 6, 24),
      chrome,
      [0, y, 0],
    );
    band.rotation.x = Math.PI / 2;
  }
  for (let i = 0; i < 9; i++) {
    const leaf = add(turretPitch, crownLeaf(0.6, 0.11, 0.25), leafGreen, [
      0,
      0.55,
      0,
    ]);
    leaf.rotation.y = i * 2.39996;
  }
  cylinder(turretPitch, 0.13, 2.1, darkSteel, [0, 0, 1.25], "z", 14);
  cylinder(turretPitch, 0.18, 0.3, chrome, [0, 0, 2.25], "z", 14);
  cylinder(turretPitch, 0.2, 0.4, darkSteel, [0, 0, 0.45], "z", 14);
  turretYaw.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = o.receiveShadow = true;
  });

  // ---------------- Chassis ----------------
  for (const side of [-1, 1]) {
    box(frame, [0.28, 0.42, 10.0], darkSteel, [side * 0.62, -0.85, 0]);
    // Chrome fuel tank under the door.
    cylinder(frame, 0.42, 1.3, chrome, [side * 1.18, -1.15, 1.05], "z", 20);
  }
  for (const z of [-4.8, -2.9, -0.6, 1.4, 4.4])
    box(frame, [1.5, 0.22, 0.22], darkSteel, [0, -0.9, z]);
  // Rear bumper, tail lamps and rocket nozzles.
  box(frame, [3.0, 0.4, 0.4], steel, [0, -0.85, -5.35]);
  for (const side of [-1, 1]) {
    box(frame, [0.4, 0.22, 0.08], tail, [side * 1.15, -0.55, -5.56]);
    cylinder(frame, 0.32, 0.6, darkSteel, [side * 0.75, -0.25, -5.35], "z");
  }
  // Axles, coil-over shocks and differentials.
  for (const z of AXLES) {
    cylinder(frame, 0.2, WHEEL_X * 2, darkSteel, [0, WHEEL_Y, z], "x", 12);
    add(frame, new THREE.SphereGeometry(0.42, 14, 10), darkSteel, [0, WHEEL_Y, z]);
    for (const side of [-1, 1]) {
      const bottom = new THREE.Vector3(side * 1.45, WHEEL_Y, z);
      const top = new THREE.Vector3(side * 0.85, -0.75, z + (z > 0 ? -0.35 : 0.35));
      const axis = top.clone().sub(bottom);
      const length = axis.length();
      const q = new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        axis.normalize(),
      );
      const mid = bottom.clone().add(top).multiplyScalar(0.5);
      const shaft = cylinder(frame, 0.08, length, chrome, [mid.x, mid.y, mid.z]);
      shaft.quaternion.copy(q);
      const coil = new THREE.CatmullRomCurve3(
        Array.from({ length: 49 }, (_, i) => {
          const t = i / 48,
            a = t * Math.PI * 2 * 7;
          return new THREE.Vector3(
            Math.cos(a) * 0.2,
            (t - 0.5) * length * 0.7,
            Math.sin(a) * 0.2,
          );
        }),
      );
      const helix = add(
        frame,
        new THREE.TubeGeometry(coil, 160, 0.045, 5, false),
        spring,
        [mid.x, mid.y, mid.z],
      );
      helix.quaternion.copy(q);
    }
  }
  // Arches hugging each tyre, with a mud flap behind the rear pair.
  for (const side of [-1, 1]) {
    for (const z of AXLES)
      add(
        frame,
        fenderArch(TRUCK_TYRE_RADIUS + 0.12, TRUCK_TYRE_RADIUS + 0.3, 1.75),
        black,
        [side * WHEEL_X, WHEEL_Y, z],
      );
    box(frame, [1.4, 1.2, 0.06], black, [side * WHEEL_X, -1.3, -5.5]);
  }

  // ---------------- Drum ----------------
  const drumTilt = new THREE.Group();
  drumTilt.position.set(0, 0.95, 1.05);
  drumTilt.rotation.x = DRUM_TILT;
  const drumSpin = new THREE.Group();
  drumTilt.add(drumSpin);
  const drumProfile = [
    [0.05, 0],
    [0.55, 0.04],
    [1.05, 0.4],
    [1.42, 1.4],
    [1.48, 2.4],
    [1.42, 3.4],
    [1.15, 4.7],
    [0.78, 5.7],
    [0.66, 6.0],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const drumGeometry = new THREE.LatheGeometry(drumProfile, 40);
  // Lathe Y runs front to back along the drum's axis (local -Z).
  drumGeometry.rotateX(-Math.PI / 2);
  const drum = add(
    drumSpin,
    drumGeometry,
    new THREE.MeshStandardMaterial({
      map: drumTexture(),
      roughness: 0.38,
      metalness: 0.1,
      side: THREE.DoubleSide,
    }),
  );
  drum.castShadow = drum.receiveShadow = true;
  // Rolled lip around the rear opening and the mixing fin inside it.
  const lip = add(
    drumSpin,
    new THREE.TorusGeometry(0.66, 0.06, 8, 32),
    steel,
    [0, 0, -6.0],
  );
  lip.castShadow = true;
  const fin = new THREE.CatmullRomCurve3(
    Array.from({ length: 41 }, (_, i) => {
      const t = i / 40,
        a = t * Math.PI * 5;
      return new THREE.Vector3(
        Math.cos(a) * 0.48,
        Math.sin(a) * 0.48,
        -4.6 - t * 1.35,
      );
    }),
  );
  add(drumSpin, new THREE.TubeGeometry(fin, 120, 0.07, 5, false), darkSteel);
  // Drum pedestals: a front A-frame and a rear roller stand.
  box(frame, [2.0, 1.6, 0.22], darkSteel, [0, -0.15, 1.45]);
  for (const side of [-1, 1]) {
    const leg = box(frame, [0.22, 3.3, 0.26], darkSteel, [side * 0.75, 0.2, -4.2]);
    leg.rotation.z = side * 0.18;
  }
  box(frame, [1.9, 0.24, 0.5], darkSteel, [0, 1.75, -4.3]);
  // Hopper funnel and the discharge chute behind the drum.
  const rearAxis = new THREE.Vector3(0, 0, -6.0).applyEuler(drumTilt.rotation)
    .add(drumTilt.position);
  const hopper = add(
    frame,
    new THREE.CylinderGeometry(0.95, 0.45, 0.95, 20, 1, true),
    sheet,
    [0, rearAxis.y + 1.05, rearAxis.z - 0.25],
  );
  hopper.rotation.x = -0.35;
  // Ladder up to the hopper platform.
  for (const x of [0.95, 1.4]) box(frame, [0.06, 3.6, 0.06], steel, [x, 0.55, -5.55]);
  for (let i = 0; i < 9; i++) box(frame, [0.5, 0.05, 0.05], steel, [1.18, -1 + i * 0.4, -5.55]);
  box(frame, [1.8, 0.08, 0.7], steel, [0.4, 2.35, -5.4]);

  const chutePivot = new THREE.Group();
  chutePivot.position.set(0, rearAxis.y - 0.55, rearAxis.z - 0.45);
  // Half-pipe trough running back along -Z with its open side up.
  const chute = add(
    chutePivot,
    new THREE.CylinderGeometry(0.42, 0.42, 2.4, 14, 1, true, -Math.PI / 2, Math.PI)
      .rotateX(Math.PI / 2)
      .translate(0, 0, -1.2),
    sheet,
  );
  const tip = new THREE.Object3D();
  tip.position.set(0, 0.1, -2.4);
  chutePivot.add(tip);

  // ---------------- Rocket flames ----------------
  const flames: THREE.Mesh[] = [];
  for (const side of [-1, 1]) {
    for (const [radius, length, color, opacity] of [
      [0.32, 3.2, "#ff9a3a", 0.75],
      [0.16, 2.2, "#fff2c0", 0.9],
    ] as const) {
      const cone = new THREE.Mesh(
        // Wide at the nozzle, tapering to a point behind it.
        new THREE.ConeGeometry(radius, length, 12).translate(0, length / 2, 0),
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          fog: false,
        }),
      );
      // Local +Y (the flame's length) points backward along -Z.
      cone.rotation.x = -Math.PI / 2;
      cone.position.set(side * 0.75, -0.25, -5.65);
      cone.visible = false;
      flames.push(cone);
    }
  }

  // ---------------- Wheels ----------------
  const tyre = tyreGeometry();
  const tyreMaterial = new THREE.MeshStandardMaterial({
    color: "#1c1d1f",
    roughness: 0.95,
  });
  const rimDish = new THREE.CylinderGeometry(1.0, 1.0, 0.18, 28).rotateZ(Math.PI / 2);
  const rimRing = new THREE.TorusGeometry(1.0, 0.08, 8, 28).rotateY(Math.PI / 2);
  const hub = new THREE.CylinderGeometry(0.34, 0.4, 0.34, 16).rotateZ(Math.PI / 2);
  const lugs = mergeGeometries(
    Array.from({ length: 8 }, (_, i) => {
      const a = (i / 8) * Math.PI * 2;
      return new THREE.CylinderGeometry(0.06, 0.06, 0.12, 6)
        .rotateZ(Math.PI / 2)
        .translate(0, Math.cos(a) * 0.55, Math.sin(a) * 0.55);
    }),
  )!;
  const wheels: { steer: THREE.Group; spin: THREE.Group; front: boolean }[] = [];
  for (const z of AXLES)
    for (const side of [-1, 1]) {
      const steer = new THREE.Group();
      steer.position.set(side * WHEEL_X, WHEEL_Y, z);
      const spin = new THREE.Group();
      const t = new THREE.Mesh(tyre, tyreMaterial);
      spin.add(t);
      const face = side * 0.62;
      for (const [geometry, material, offset] of [
        [rimDish, yellow, 0],
        [rimRing, chrome, 0.06],
        [hub, chrome, 0.12],
        [lugs, chrome, 0.12],
      ] as const) {
        const m = new THREE.Mesh(geometry, material);
        m.position.x = face + side * offset;
        spin.add(m);
      }
      spin.traverse((o) => {
        if (o instanceof THREE.Mesh) o.castShadow = o.receiveShadow = true;
      });
      steer.add(spin);
      model.add(steer);
      wheels.push({ steer, spin, front: z > 0 });
    }

  // Bake the static parts into one mesh per material.
  const bake = (source: THREE.Group, target: THREE.Group) => {
    for (const { geometry, material } of bakeMaterialGroups(source)) {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = mesh.receiveShadow = true;
      target.add(mesh);
    }
  };
  const bodyMesh = new THREE.Group();
  bake(body, bodyMesh);
  const frameMesh = new THREE.Group();
  bake(frame, frameMesh);
  // The cab and drum ride on the springs above the chassis and wheels.
  const sprung = new THREE.Group();
  sprung.add(bodyMesh, drumTilt);
  sprung.add(turretYaw);
  model.add(sprung, frameMesh, chutePivot, ...flames);
  chute.castShadow = true;
  group.name = "concrete-truck";

  let spin = 0,
    drumAngle = 0,
    drumRate = 0.6,
    steerAngle = 0,
    lastSpeed = 0,
    pitch = 0,
    pitchVelocity = 0,
    roll = 0,
    pouring = false,
    chuteAngle = 1.15,
    rocket = 0,
    flicker = 0;
  return {
    group,
    update(speed, steer, dt) {
      if (dt <= 0) return;
      spin = (spin + (speed / TRUCK_TYRE_RADIUS) * dt) % (Math.PI * 2);
      // +X is the truck's left, so a right turn yaws the wheels negative.
      steerAngle += (-steer * 0.5 - steerAngle) * (1 - Math.exp(-dt * 10));
      for (const wheel of wheels) {
        wheel.spin.rotation.x = spin;
        wheel.steer.rotation.y = wheel.front ? steerAngle : 0;
      }
      // Mixers turn slowly to keep the load moving and reverse to discharge.
      const targetRate = pouring ? -4 : 0.6 + Math.abs(speed) * 0.04;
      drumRate += (targetRate - drumRate) * (1 - Math.exp(-dt * 2));
      drumAngle = (drumAngle + drumRate * dt) % (Math.PI * 2);
      drumSpin.rotation.z = drumAngle;
      // Chute folds up for the road and swings down to pour.
      chuteAngle += ((pouring ? -0.45 : 1.15) - chuteAngle) * (1 - Math.exp(-dt * 4));
      chutePivot.rotation.x = chuteAngle;
      // Positive X rotation dips the nose, so acceleration lifts it.
      const accel = (speed - lastSpeed) / dt;
      lastSpeed = speed;
      const targetPitch = THREE.MathUtils.clamp(-accel * 0.004, -0.08, 0.08);
      const step = Math.min(dt, 0.05);
      pitchVelocity += ((targetPitch - pitch) * 60 - pitchVelocity * 7) * step;
      pitch += pitchVelocity * step;
      const targetRoll = THREE.MathUtils.clamp(
        -steer * Math.abs(speed) * 0.002,
        -0.07,
        0.07,
      );
      roll += (targetRoll - roll) * (1 - Math.exp(-dt * 4));
      sprung.rotation.set(pitch, 0, roll);
      flicker += dt * 40;
      for (const [i, flame] of flames.entries()) {
        flame.visible = rocket > 0.02;
        flame.scale.set(
          rocket,
          rocket * (0.85 + 0.25 * Math.sin(flicker + i * 1.7)),
          rocket,
        );
      }
    },
    setPour(on) {
      pouring = on;
    },
    setAim(yaw, pitch) {
      turretYaw.rotation.y = yaw;
      // Positive X rotation dips the barrel.
      turretPitch.rotation.x = -pitch;
    },
    setRocket(level) {
      rocket = THREE.MathUtils.clamp(level, 0, 1);
    },
    chuteTip(out) {
      group.updateMatrixWorld(true);
      return tip.getWorldPosition(out);
    },
    chuteDirection(out) {
      group.updateMatrixWorld(true);
      return out
        .set(0, 0, -1)
        .transformDirection(chutePivot.matrixWorld);
    },
    reset() {
      spin = steerAngle = lastSpeed = pitch = pitchVelocity = roll = 0;
      drumAngle = 0;
      drumRate = 0.6;
      pouring = false;
      chuteAngle = 1.15;
      rocket = 0;
      sprung.rotation.set(0, 0, 0);
      for (const flame of flames) flame.visible = false;
    },
  };
}
