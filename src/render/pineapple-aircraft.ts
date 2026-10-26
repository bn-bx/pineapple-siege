import * as THREE from "three";
import { bakeMaterialGroups, sweptPlate } from "./infernal-jet";

function rindTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 512;
  const c = canvas.getContext("2d")!;
  c.fillStyle = "#806128";
  c.fillRect(0, 0, 512, 512);
  for (let row = -1; row < 13; row++) for (let col = -1; col < 13; col++) {
    const x = col * 44 + (row % 2) * 22, y = row * 43;
    const glow = c.createRadialGradient(x - 5, y - 7, 1, x, y, 25);
    glow.addColorStop(0, "#f4d46b");
    glow.addColorStop(.45, "#cf9b39");
    glow.addColorStop(1, "#735121");
    c.fillStyle = glow;
    c.beginPath();
    c.moveTo(x, y - 21); c.lineTo(x + 21, y); c.lineTo(x, y + 21); c.lineTo(x - 21, y);
    c.closePath(); c.fill();
    c.strokeStyle = "#705322"; c.lineWidth = 2; c.stroke();
    c.fillStyle = "#74572d";
    c.beginPath(); c.ellipse(x, y, 3.2, 5, .6, 0, Math.PI * 2); c.fill();
    c.fillStyle = "#fff0a0"; c.fillRect(x - 3, y - 5, 2, 4);
  }
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  return map;
}

/** Curved leaf with a raised center ridge, rather than a cone-shaped crown. */
function crownLeaf(length: number, width: number, bend: number) {
  const vertices: number[] = [], uv: number[] = [], indices: number[] = [];
  const steps = 8;
  for (let row = 0; row <= steps; row++) {
    const t = row / steps;
    const spread = Math.pow(Math.sin(Math.PI * t), .7) * width + .015;
    for (const side of [-1, 0, 1]) {
      vertices.push(side * spread, t * length, t * t * bend - (side === 0 ? .1 : 0));
      uv.push((side + 1) / 2, t);
    }
    if (row < steps) for (let side = 0; side < 2; side++) {
      const a = row * 3 + side, b = a + 3;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export function makePineappleAircraft() {
  const aircraft = new THREE.Group(), frame = new THREE.Group();
  const map = rindTexture();
  const rind = new THREE.MeshStandardMaterial({
    map, bumpMap: map, bumpScale: .16, color: "#f3ca66", roughness: .78,
    emissive: "#715015", emissiveIntensity: .12,
  });
  const bronze = new THREE.MeshStandardMaterial({ color: "#b08a4e", metalness: .72, roughness: .36 });
  const dark = new THREE.MeshStandardMaterial({ color: "#293b3d", metalness: .6, roughness: .48 });
  const green = new THREE.MeshStandardMaterial({ color: "#356d46", roughness: .58, side: THREE.DoubleSide });
  const fresh = new THREE.MeshStandardMaterial({ color: "#74a84b", roughness: .62, side: THREE.DoubleSide });
  const vein = new THREE.MeshStandardMaterial({ color: "#a3bd60", roughness: .7 });
  const glass = new THREE.MeshStandardMaterial({
    color: "#4bafa6", emissive: "#236861", emissiveIntensity: .55, metalness: .7, roughness: .17,
  });
  const hot = new THREE.MeshStandardMaterial({ color: "#92e8df", emissive: "#48c7c6", emissiveIntensity: 1.7 });
  const add = (geometry: THREE.BufferGeometry, material: THREE.Material,
    p: [number, number, number] = [0, 0, 0]) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(...p); mesh.castShadow = mesh.receiveShadow = true;
    frame.add(mesh); return mesh;
  };
  const fruit = add(new THREE.SphereGeometry(2.55, 32, 24), rind);
  fruit.scale.y = 1.36;
  for (const y of [-1.5, 1.5]) {
    const band = add(new THREE.TorusGeometry(2.33, .13, 6, 48), bronze, [0, y, 0]);
    band.rotation.x = Math.PI / 2;
  }
  for (const side of [-1, 1]) {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(side * 1.35, -2.8, -1.2),
      new THREE.Vector3(side * 1.65, -1.5, -2),
      new THREE.Vector3(side * 1.7, 0, -2),
      new THREE.Vector3(side * 1.5, 1.8, -1.6),
      new THREE.Vector3(side * .8, 2.8, -1),
    ]);
    add(new THREE.TubeGeometry(curve, 12, .1, 5, false), dark);
    const wing = [[2, 1.8], [7, -1.4], [6.6, -3], [2, -1.8]] as [number, number][];
    add(sweptPlate(wing.map(([x, z]) => [side * x, z]), .16), dark, [0, -.8, 0]);
    add(sweptPlate([[side * 2.5, 1], [side * 6.5, -1.5], [side * 5.8, -2], [side * 2.5, -.9]], .1), green, [0, -.95, 0]);
    add(new THREE.BoxGeometry(1.3, .12, .25), bronze, [side * 5.1, -.99, -1.3]);
    const engine = add(new THREE.CylinderGeometry(.72, .88, 4.6, 14).rotateX(Math.PI / 2), dark, [side * 3.5, -.8, -1.2]);
    engine.name = "engine";
    for (const z of [-3.6, .95]) {
      add(new THREE.TorusGeometry(.72, .12, 6, 20), bronze, [side * 3.5, -.8, z]);
      add(new THREE.CircleGeometry(.62, 18), z < 0 ? hot : dark, [side * 3.5, -.8, z - .02]);
    }
    for (let fin = 0; fin < 6; fin++) {
      const a = fin * Math.PI / 3;
      const rib = add(new THREE.BoxGeometry(.12, .55, 2.8), bronze,
        [side * 3.5 + Math.sin(a) * .72, -.8 + Math.cos(a) * .72, -1]);
      rib.rotation.z = -a;
    }
    add(new THREE.SphereGeometry(.16, 6, 4), hot, [side * 6.5, -.8, -2.2]);
  }
  const bezel = add(new THREE.SphereGeometry(1, 18, 10), bronze, [0, .3, -2.37]);
  bezel.scale.set(1.1, .65, .48);
  const canopy = add(new THREE.SphereGeometry(1, 18, 10), glass, [0, .36, -2.64]);
  canopy.scale.set(.9, .48, .3);
  add(new THREE.BoxGeometry(.1, .95, .1), dark, [0, .36, -2.92]);
  for (let i = 0; i < 13; i++) {
    const a = i * 2.39996, outer = i < 8;
    const length = outer ? 3.1 + (i % 3) * .42 : 4.4 + (i % 2) * .45;
    const leaf = add(crownLeaf(length, outer ? .47 : .35, outer ? 2 : .7), i % 3 ? green : fresh,
      [Math.sin(a) * .38, 2.75, Math.cos(a) * .38]);
    leaf.rotation.y = a;
    leaf.rotation.z = Math.sin(a) * .12;
    const ridge = new THREE.CatmullRomCurve3(Array.from({ length: 6 }, (_, j) => {
      const t = j / 5;
      return new THREE.Vector3(0, t * length, t * t * (outer ? 2 : .7) - .12);
    }));
    const rib = add(new THREE.TubeGeometry(ridge, 8, .025, 3, false), vein, [leaf.position.x, 2.75, leaf.position.z]);
    rib.rotation.copy(leaf.rotation);
  }
  // Screen-up in the inverted realm points toward local -Y.
  frame.rotation.z = Math.PI;
  for (const { geometry, material } of bakeMaterialGroups(frame)) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = mesh.receiveShadow = true;
    aircraft.add(mesh);
  }
  for (const side of [-1, 1]) {
    const flame = new THREE.Mesh(new THREE.ConeGeometry(.6, 3, 10), new THREE.MeshBasicMaterial({
      color: "#60d9d1", transparent: true, opacity: .75, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    }));
    flame.position.set(side * 3.5, .8, -5.1);
    flame.rotation.x = -Math.PI / 2;
    flame.name = "flame";
    aircraft.add(flame);
    const core = new THREE.Mesh(new THREE.ConeGeometry(.25, 2.2, 8), new THREE.MeshBasicMaterial({
      color: "#e0fff0", transparent: true, opacity: .8, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    }));
    core.position.copy(flame.position); core.rotation.copy(flame.rotation); core.name = "flame-core";
    aircraft.add(core);
  }
  aircraft.name = "pineapple-aircraft";
  return aircraft;
}
