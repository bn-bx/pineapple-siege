import * as THREE from "three";
import { XMAS } from "../../christmas";

/** Shared festive materials, built once on first use. */
let shared:
  | ReturnType<typeof buildMaterials>
  | undefined;
function buildMaterials() {
  const m = (color: string, extra: THREE.MeshStandardMaterialParameters = {}) =>
    new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...extra });
  return {
    red: m(XMAS.red, { roughness: 0.85 }),
    deepRed: m(XMAS.deepRed),
    green: m(XMAS.green),
    darkGreen: m(XMAS.darkGreen, { roughness: 0.9 }),
    fur: m("#fbfbf7", { roughness: 1 }),
    snow: m("#f4f7fb", { roughness: 0.9 }),
    gold: m(XMAS.gold, { metalness: 0.75, roughness: 0.3, emissive: "#6b4a00", emissiveIntensity: 0.25 }),
    coal: m("#1b1b1d", { roughness: 0.95 }),
    carrot: m("#f07a1a"),
    brown: m("#6b4528", { roughness: 0.9 }),
    antler: m("#c9b08a", { roughness: 0.85 }),
    hoof: m("#2a2420"),
    redNose: m("#ff2a1a", { emissive: "#ff1a0a", emissiveIntensity: 1.6 }),
    sack: m("#8a6a42", { roughness: 1 }),
    candy: new THREE.MeshStandardMaterial({ map: candyStripeTexture(), roughness: 0.35 }),
    star: m("#ffe27a", { emissive: "#ffc83a", emissiveIntensity: 1.8, metalness: 0.3, roughness: 0.3 }),
  };
}
export function festiveMaterials() {
  return (shared ??= buildMaterials());
}

/** Red and white diagonal stripes; wraps into a spiral on a tube or drum. */
export function candyStripeTexture(red: string = XMAS.red, white: string = XMAS.white) {
  const canvas =
    typeof document !== "undefined" ? document.createElement("canvas") : undefined;
  if (!canvas) return new THREE.Texture();
  canvas.width = canvas.height = 128;
  const c = canvas.getContext("2d")!;
  c.fillStyle = white;
  c.fillRect(0, 0, 128, 128);
  c.fillStyle = red;
  for (let k = -2; k < 4; k++) {
    c.beginPath();
    c.moveTo(k * 64, 0);
    c.lineTo(k * 64 + 28, 0);
    c.lineTo(k * 64 + 28 + 128, 128);
    c.lineTo(k * 64 + 128, 128);
    c.closePath();
    c.fill();
  }
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  return map;
}

const mesh = (
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  p: [number, number, number] = [0, 0, 0],
) => {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(...p);
  m.castShadow = true;
  return m;
};

/** A Santa hat whose brim (radius r) sits at y = 0, tip leaning to +z. */
export function santaHat(r = 1, height = 2.2) {
  const f = festiveMaterials();
  const g = new THREE.Group();
  g.name = "santa-hat";
  const cone = mesh(new THREE.ConeGeometry(r * 0.92, height, 14), f.red, [0, height * 0.45, -r * 0.1]);
  cone.rotation.x = -0.32;
  const brim = mesh(new THREE.TorusGeometry(r, r * 0.24, 8, 20), f.fur);
  brim.rotation.x = Math.PI / 2;
  // The cone geometry is centred, so its tip is half its height from the centre.
  const tip = new THREE.Vector3(0, height * 0.5, 0).applyEuler(cone.rotation).add(cone.position);
  const pom = mesh(new THREE.SphereGeometry(r * 0.28, 10, 8), f.fur, [tip.x, tip.y, tip.z]);
  g.add(cone, brim, pom);
  return g;
}

/** Merged santa hat geometry groups for instancing: [red cone, white trim]. */
export function santaHatGeometries(r = 1, height = 2.2) {
  const hat = santaHat(r, height);
  hat.updateMatrixWorld(true);
  const red: THREE.BufferGeometry[] = [],
    white: THREE.BufferGeometry[] = [];
  const f = festiveMaterials();
  hat.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const geo = o.geometry.clone().applyMatrix4(o.matrixWorld);
    // Keep only position/normal so the pieces merge.
    for (const name of Object.keys(geo.attributes))
      if (name !== "position" && name !== "normal") geo.deleteAttribute(name);
    (o.material === f.red ? red : white).push(geo.index ? geo.toNonIndexed() : geo);
  });
  return { red, white };
}

/** A candy cane standing on y = 0, hook at the top curling toward +x. */
export function candyCane(height = 10, radius = 0.5) {
  const f = festiveMaterials();
  const hook = height * 0.18;
  const points = [
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, height - hook, 0),
  ];
  for (let i = 1; i <= 8; i++) {
    const a = (i / 8) * Math.PI;
    points.push(new THREE.Vector3(hook - Math.cos(a) * hook, height - hook + Math.sin(a) * hook, 0));
  }
  points.push(new THREE.Vector3(hook * 2, height - hook * 1.6, 0));
  const curve = new THREE.CatmullRomCurve3(points, false, "catmullrom", 0.2);
  const material = f.candy.clone();
  if (material.map) {
    material.map = material.map.clone();
    material.map.repeat.set(height / (radius * 6), 1);
    material.map.needsUpdate = true;
  }
  const cane = mesh(new THREE.TubeGeometry(curve, 48, radius, 10, false), material);
  const g = new THREE.Group();
  g.name = "candy-cane";
  g.add(cane);
  return g;
}

/** A ribbon bow centred on the origin, loops spreading along x. */
export function bow(size = 1, material?: THREE.Material) {
  const f = festiveMaterials();
  const ribbon = material ?? f.gold;
  const g = new THREE.Group();
  g.name = "bow";
  for (const side of [-1, 1]) {
    const loop = mesh(new THREE.TorusGeometry(size * 0.5, size * 0.16, 8, 16), ribbon, [side * size * 0.5, size * 0.15, 0]);
    loop.scale.set(1, 0.7, 0.6);
    loop.rotation.z = side * 0.35;
    const tail = mesh(new THREE.BoxGeometry(size * 0.25, size * 0.9, size * 0.06), ribbon, [side * size * 0.3, -size * 0.45, 0]);
    tail.rotation.z = side * 0.4;
    g.add(loop, tail);
  }
  g.add(mesh(new THREE.SphereGeometry(size * 0.22, 10, 8), ribbon));
  return g;
}

/** A wrapped present standing on y = 0. */
export function present(w: number, h: number, d: number, paper: THREE.Material, ribbon?: THREE.Material) {
  const f = festiveMaterials();
  const tie = ribbon ?? f.gold;
  const g = new THREE.Group();
  g.name = "present";
  g.add(mesh(new THREE.BoxGeometry(w, h, d), paper, [0, h / 2, 0]));
  const band = Math.min(w, d) * 0.16;
  g.add(mesh(new THREE.BoxGeometry(w * 1.02, h * 1.02, band), tie, [0, h / 2, 0]));
  g.add(mesh(new THREE.BoxGeometry(band, h * 1.02, d * 1.02), tie, [0, h / 2, 0]));
  const b = bow(Math.min(w, d) * 0.35, tie);
  b.position.y = h + Math.min(w, d) * 0.12;
  b.rotation.x = -Math.PI / 2 + 0.6;
  g.add(b);
  return g;
}

/** A holly wreath facing +z, centred on the origin. */
export function wreath(radius = 1) {
  const f = festiveMaterials();
  const g = new THREE.Group();
  g.name = "wreath";
  g.add(mesh(new THREE.TorusGeometry(radius, radius * 0.28, 10, 32), f.darkGreen));
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2,
      leaf = mesh(new THREE.ConeGeometry(radius * 0.12, radius * 0.4, 4), f.green, [
        Math.cos(a) * radius * (1 + ((i % 3) - 1) * 0.18),
        Math.sin(a) * radius * (1 + ((i % 3) - 1) * 0.18),
        radius * 0.2,
      ]);
    leaf.rotation.z = a + Math.PI / 2;
    g.add(leaf);
  }
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + 0.2;
    g.add(mesh(new THREE.SphereGeometry(radius * 0.08, 8, 6), f.red, [Math.cos(a) * radius * 0.95, Math.sin(a) * radius * 0.95, radius * 0.3]));
  }
  const b = bow(radius * 0.45, f.red);
  b.position.set(0, -radius, radius * 0.3);
  g.add(b);
  return g;
}

/** A snowman about 3.4 m tall standing on y = 0, facing +z. */
export function snowman() {
  const f = festiveMaterials();
  const g = new THREE.Group();
  g.name = "snowman";
  g.add(mesh(new THREE.SphereGeometry(1, 14, 10), f.snow, [0, 0.9, 0]));
  g.add(mesh(new THREE.SphereGeometry(0.72, 14, 10), f.snow, [0, 2.15, 0]));
  g.add(mesh(new THREE.SphereGeometry(0.5, 14, 10), f.snow, [0, 3.0, 0]));
  for (const side of [-1, 1])
    g.add(mesh(new THREE.SphereGeometry(0.07, 6, 4), f.coal, [side * 0.18, 3.12, 0.45]));
  for (let i = 0; i < 3; i++)
    g.add(mesh(new THREE.SphereGeometry(0.08, 6, 4), f.coal, [0, 1.95 + i * 0.25, 0.7 - i * 0.04]));
  const nose = mesh(new THREE.ConeGeometry(0.08, 0.5, 8), f.carrot, [0, 3.0, 0.68]);
  nose.rotation.x = Math.PI / 2;
  g.add(nose);
  g.add(mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.05, 16), f.coal, [0, 3.42, 0]));
  g.add(mesh(new THREE.CylinderGeometry(0.3, 0.32, 0.5, 16), f.coal, [0, 3.68, 0]));
  const scarf = mesh(new THREE.TorusGeometry(0.52, 0.1, 6, 16), f.red, [0, 2.6, 0]);
  scarf.rotation.x = Math.PI / 2;
  g.add(scarf);
  g.add(mesh(new THREE.BoxGeometry(0.2, 0.6, 0.06), f.red, [0.3, 2.3, 0.55]));
  for (const side of [-1, 1]) {
    const arm = mesh(new THREE.CylinderGeometry(0.035, 0.05, 1.3, 5), f.brown, [side * 0.95, 2.4, 0]);
    arm.rotation.z = side * -1.0;
    g.add(arm);
  }
  return g;
}

/** A reindeer about 2.4 m long, facing +z, hooves at y = 0. */
export function reindeer(rudolph = false) {
  const f = festiveMaterials();
  const g = new THREE.Group();
  g.name = rudolph ? "rudolph" : "reindeer";
  const body = mesh(new THREE.SphereGeometry(1, 12, 10), f.brown, [0, 1.55, 0]);
  body.scale.set(0.45, 0.48, 1.0);
  g.add(body);
  const legs: THREE.Object3D[] = [];
  for (const x of [-0.25, 0.25])
    for (const z of [-0.65, 0.65]) {
      const hip = new THREE.Group();
      hip.position.set(x, 1.35, z);
      hip.add(mesh(new THREE.CylinderGeometry(0.07, 0.09, 1.3, 6), f.brown, [0, -0.65, 0]));
      hip.add(mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.12, 6), f.hoof, [0, -1.32, 0]));
      hip.name = "leg";
      legs.push(hip);
      g.add(hip);
    }
  const neck = mesh(new THREE.CylinderGeometry(0.17, 0.24, 0.9, 8), f.brown, [0, 2.05, 0.95]);
  neck.rotation.x = 0.7;
  g.add(neck);
  const head = mesh(new THREE.SphereGeometry(0.3, 10, 8), f.brown, [0, 2.45, 1.3]);
  head.scale.set(0.85, 0.85, 1.35);
  g.add(head);
  g.add(mesh(new THREE.SphereGeometry(rudolph ? 0.13 : 0.08, 8, 6), rudolph ? f.redNose : f.coal, [0, 2.4, 1.7]));
  for (const side of [-1, 1]) {
    const beam = mesh(new THREE.CylinderGeometry(0.03, 0.045, 0.8, 5), f.antler, [side * 0.22, 2.95, 1.15]);
    beam.rotation.z = side * -0.5;
    beam.rotation.x = -0.3;
    g.add(beam);
    for (let t = 0; t < 2; t++) {
      const tine = mesh(new THREE.CylinderGeometry(0.02, 0.03, 0.35, 4), f.antler, [side * (0.3 + t * 0.12), 3.05 + t * 0.15, 1.25 - t * 0.08]);
      tine.rotation.x = 0.6;
      g.add(tine);
    }
  }
  const tail = mesh(new THREE.SphereGeometry(0.12, 6, 5), f.fur, [0, 1.75, -1.0]);
  g.add(tail);
  g.userData.legs = legs;
  return g;
}

/** Santa's sleigh about 4 m long, facing +z, runners at y = 0. */
export function sleigh() {
  const f = festiveMaterials();
  const g = new THREE.Group();
  g.name = "sleigh";
  // Side profile, extruded across the width.
  const shape = new THREE.Shape();
  shape.moveTo(-2, 0.5);
  shape.lineTo(1.4, 0.5);
  shape.quadraticCurveTo(2.3, 0.6, 2.2, 1.6);
  shape.quadraticCurveTo(2.1, 2.2, 1.6, 2.1);
  shape.lineTo(1.2, 1.3);
  shape.lineTo(-1.1, 1.3);
  shape.lineTo(-1.5, 2.3);
  shape.lineTo(-2.1, 2.2);
  shape.closePath();
  const body = new THREE.ExtrudeGeometry(shape, { depth: 1.8, bevelEnabled: true, bevelSize: 0.08, bevelThickness: 0.08, bevelSegments: 2 });
  body.translate(0, 0, -0.9);
  body.rotateY(-Math.PI / 2);
  g.add(mesh(body, f.red));
  // Gold trim along the top edges.
  for (const side of [-1, 1]) {
    const rail = mesh(new THREE.BoxGeometry(0.08, 0.1, 3.4), f.gold, [side * 0.98, 1.33, -0.2]);
    g.add(rail);
    const runner = new THREE.CatmullRomCurve3([
      new THREE.Vector3(side * 0.8, 0.05, -2.2),
      new THREE.Vector3(side * 0.8, 0, 1.4),
      new THREE.Vector3(side * 0.8, 0.4, 2.4),
      new THREE.Vector3(side * 0.8, 0.9, 2.1),
    ]);
    g.add(mesh(new THREE.TubeGeometry(runner, 24, 0.07, 6, false), f.gold));
    for (const z of [-1.4, 0.8]) g.add(mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.5, 5), f.gold, [side * 0.8, 0.3, z]));
  }
  // A seat and a bulging sack of presents behind it.
  g.add(mesh(new THREE.BoxGeometry(1.7, 0.25, 0.9), f.deepRed, [0, 1.2, 0.2]));
  const sackMesh = mesh(new THREE.SphereGeometry(0.85, 12, 10), f.sack, [0, 1.9, -1.2]);
  sackMesh.scale.set(1, 1.1, 0.9);
  g.add(sackMesh);
  const presents = [
    [-0.5, 2.5, -1.0, f.green],
    [0.45, 2.6, -1.3, f.red],
    [0.0, 2.85, -1.1, f.gold],
  ] as const;
  for (const [x, y, z, m] of presents) {
    const box = present(0.5, 0.45, 0.5, m, m === f.gold ? f.red : f.gold);
    box.position.set(x, y - 0.2, z);
    box.rotation.y = x * 2;
    g.add(box);
  }
  return g;
}

/**
 * A decorated Christmas tree, `height` tall, standing on y = 0: tiers of
 * cones, gold baubles, and a glowing star on top (named "star").
 */
export function christmasTree(height = 30) {
  const f = festiveMaterials();
  const g = new THREE.Group();
  g.name = "christmas-tree";
  const trunkH = height * 0.12;
  g.add(mesh(new THREE.CylinderGeometry(height * 0.035, height * 0.045, trunkH, 8), f.brown, [0, trunkH / 2, 0]));
  const tiers = 5;
  const baubles = [f.red, f.gold, new THREE.MeshStandardMaterial({ color: "#2f6bff", metalness: 0.6, roughness: 0.25 })];
  for (let i = 0; i < tiers; i++) {
    const t = i / tiers,
      radius = height * 0.3 * (1 - t * 0.75),
      tierH = height * 0.3,
      y = trunkH + t * height * 0.72 + tierH / 2;
    const cone = mesh(new THREE.ConeGeometry(radius, tierH, 14), f.darkGreen, [0, y, 0]);
    cone.receiveShadow = true;
    // Snow on each tier's shoulders.
    cone.material = f.darkGreen;
    g.add(cone);
    const n = Math.round(10 * (1 - t * 0.6));
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + i;
      g.add(mesh(new THREE.SphereGeometry(height * 0.018, 8, 6), baubles[(k + i) % 3], [
        Math.cos(a) * radius * 0.92,
        y - tierH * 0.38,
        Math.sin(a) * radius * 0.92,
      ]));
    }
  }
  const starShape = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2,
      r = (i % 2 ? 0.45 : 1) * height * 0.06;
    if (i) starShape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    else starShape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  const starGeometry = new THREE.ExtrudeGeometry(starShape, { depth: height * 0.02, bevelEnabled: false });
  starGeometry.center();
  const star = mesh(starGeometry, f.star, [0, height * 1.02, 0]);
  star.name = "star";
  g.add(star);
  return g;
}

let glow: THREE.Texture | undefined;
/** A soft round sprite: white centre fading to clear. */
export function glowTexture() {
  if (glow) return glow;
  if (typeof document === "undefined") return (glow = new THREE.Texture());
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const c = canvas.getContext("2d")!;
  const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.3, "rgba(255,255,255,.55)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  c.fillStyle = g;
  c.fillRect(0, 0, 64, 64);
  return (glow = new THREE.CanvasTexture(canvas));
}
