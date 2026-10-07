import { visualGeometry } from "./visual-assets";
import { crownSurface, fruitSurface } from "./fruit-surface";
import { roofParts } from "../debris-shape";
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { Material } from "../types";
function random(seed: number) {
  let v = Math.sin(seed * 127.1 + 43.7) * 43758.5453;
  return v - Math.floor(v);
}
function texture(draw: (c: CanvasRenderingContext2D) => void) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const c = canvas.getContext("2d")!;
  draw(c);
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}
export function createMaterials() {
  const stone = texture((c) => {
    c.fillStyle = "#656a63";
    c.fillRect(0, 0, 256, 256);
    for (let y = 0; y < 8; y++)
      for (let x = -1; x < 4; x++) {
        const a = random(y * 17 + x);
        c.fillStyle = `hsl(${40 + a * 14},${8 + a * 6}%,${44 + a * 15}%)`;
        c.fillRect(x * 76 + (y % 2) * 38 + 2, y * 32 + 2, 72, 28);
        c.fillStyle = "rgba(255,250,220,.08)";
        c.fillRect(x * 76 + (y % 2) * 38 + 3, y * 32 + 2, 70, 2);
      }
    for (let i = 0; i < 5000; i++) {
      c.fillStyle = i % 2 ? "rgba(10,15,12,.04)" : "rgba(250,230,200,.04)";
      c.fillRect(random(i) * 256, random(i + 7000) * 256, 2, 2);
    }
  });
  const wood = texture((c) => {
    c.fillStyle = "#685034";
    c.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 180; i++) {
      c.strokeStyle = `rgba(27,16,8,${0.05 + random(i) * 0.15})`;
      c.beginPath();
      c.moveTo(random(i) * 256, 0);
      c.bezierCurveTo(
        random(i) * 256 + 7,
        60,
        random(i) * 256 - 4,
        190,
        random(i) * 256,
        256,
      );
      c.stroke();
    }
    for (let i = 0; i < 4; i++) {
      c.fillStyle = "#3c3024";
      c.fillRect(i * 64, 0, 2, 256);
    }
  });
  const foliage = texture((c) => {
    c.fillStyle = "#547e46";
    c.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 2500; i++) {
      c.strokeStyle = `hsla(${95 + random(i) * 25},30%,${18 + random(i + 1) * 32}%,.45)`;
      const x = random(i + 2) * 256,
        y = random(i + 3) * 256;
      c.beginPath();
      c.moveTo(x, y);
      c.lineTo(x + 3, y + 12);
      c.stroke();
    }
  });
  const grass = texture((c) => {
    c.fillStyle = "#c1c5aa";
    c.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 14000; i++) {
      let v = 120 + random(i) * 100;
      c.fillStyle = `rgba(${v},${v},${v - 20},.18)`;
      c.fillRect(
        random(i + 1) * 256,
        random(i + 2) * 256,
        1 + random(i) * 5,
        1 + random(i + 3) * 4,
      );
    }
  });
  grass.repeat.set(1, 1);
  const materials: Record<Material, THREE.MeshStandardMaterial> = {
    stone: new THREE.MeshStandardMaterial({ map: stone, roughness: 0.92 }),
    wood: new THREE.MeshStandardMaterial({ map: wood, roughness: 0.85 }),
    foliage: new THREE.MeshStandardMaterial({
      map: foliage,
      roughness: 1,
      side: THREE.DoubleSide,
    }),
    earth: new THREE.MeshStandardMaterial({
      color: "#826646",
      map: grass,
      roughness: 1,
    }),
    rock: new THREE.MeshStandardMaterial({
      color: "#a2aaa0",
      map: grass,
      roughness: 0.95,
    }),
    plaster: new THREE.MeshStandardMaterial({
      color: "#d7c59a",
      map: stone,
      roughness: 0.9,
    }),
    roof: new THREE.MeshStandardMaterial({
      color: "#75464a",
      map: wood,
      roughness: 0.8,
    }),
    sandstone: new THREE.MeshStandardMaterial({
      color: "#d9af75",
      map: stone,
      roughness: 0.94,
    }),
    slate: new THREE.MeshStandardMaterial({
      color: "#394954",
      map: wood,
      roughness: 0.83,
    }),
    window: new THREE.MeshStandardMaterial({
      color: "#252d32",
      emissive: "#ffc077",
      emissiveIntensity: 0,
      roughness: 0.55,
      metalness: 0.08,
    }),
  };
  return { materials, grass };
}
export function pineGeometry() {
  const pieces: THREE.BufferGeometry[] = [];
  for (let tier = 0; tier < 5; tier++) {
    let g = new THREE.ConeGeometry(1 - tier * 0.14, 0.36, 9, 3);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i),
        a = Math.atan2(pos.getZ(i), pos.getX(i));
      let irregular =
        1 + 0.16 * Math.sin(a * 5 + tier) + 0.09 * Math.cos(a * 11 - y * 23);
      pos.setX(i, pos.getX(i) * irregular);
      pos.setZ(i, pos.getZ(i) * irregular);
    }
    g.translate(0, 0.19 + tier * 0.145, 0);
    g.computeVertexNormals();
    pieces.push(g);
  }
  return mergeGeometries(pieces);
}
export function makeJet() {
  const g = new THREE.Group(),
    body = new THREE.MeshStandardMaterial({
      color: "#d4e0d9",
      metalness: 0.48,
      roughness: 0.32,
    }),
    dark = new THREE.MeshStandardMaterial({
      color: "#263c44",
      metalness: 0.55,
      roughness: 0.3,
    }),
    gold = new THREE.MeshStandardMaterial({
      color: "#efad40",
      metalness: 0.3,
      roughness: 0.32,
    });
  const canopy = new THREE.MeshStandardMaterial({
    color: "#62b9cf",
    metalness: 0.7,
    roughness: 0.12,
    emissive: "#102b33",
  });
  const add = (
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    p: THREE.Vector3,
  ) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(p);
    m.castShadow = true;
    g.add(m);
    return m;
  };
  let fuselage = add(
    new THREE.CylinderGeometry(0.85, 1.25, 8, 12),
    body,
    new THREE.Vector3(0, 0, 0),
  );
  fuselage.rotation.x = Math.PI / 2;
  let nose = add(
    new THREE.ConeGeometry(0.85, 4, 12),
    dark,
    new THREE.Vector3(0, 0, 6),
  );
  nose.rotation.x = Math.PI / 2;
  let glass = add(
    new THREE.SphereGeometry(1, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2),
    canopy,
    new THREE.Vector3(0, 0.75, 2),
  );
  glass.scale.set(0.67, 0.63, 1.7);
  glass.name = "canopy-glass";
  const canopyFrame = add(
    new THREE.TorusGeometry(0.67, 0.045, 8, 32)
      .rotateX(Math.PI / 2)
      .scale(1, 1, 1.7 / 0.67),
    dark,
    new THREE.Vector3(0, 0.77, 2),
  );
  canopyFrame.name = "canopy-frame";
  const cockpit = new THREE.Group();
  cockpit.name = "cockpit-details";
  const instrumentPanel = new THREE.MeshStandardMaterial({
    color: "#203238",
    metalness: 0.38,
    roughness: 0.48,
  });
  const instrumentFace = new THREE.MeshBasicMaterial({ color: "#7bc7b2" });
  const displayFace = new THREE.MeshBasicMaterial({
    color: "#75cfc3",
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
  });
  const pilotSuit = new THREE.MeshStandardMaterial({
    color: "#40514c",
    metalness: 0.08,
    roughness: 0.86,
  });
  const pilotTrim = new THREE.MeshStandardMaterial({
    color: "#c99b55",
    metalness: 0.44,
    roughness: 0.48,
  });
  const detail = (
    name: string,
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    position: [number, number, number],
  ) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.position.set(...position);
    mesh.castShadow = true;
    cockpit.add(mesh);
    return mesh;
  };
  const console = detail(
    "instrument-coaming",
    new THREE.BoxGeometry(1.02, 0.23, 0.18),
    instrumentPanel,
    [0, 0.78, 2.41],
  );
  console.rotation.x = -0.16;
  const bezels: THREE.BufferGeometry[] = [],
    faces: THREE.BufferGeometry[] = [],
    needles: THREE.BufferGeometry[] = [];
  for (const x of [-0.36, -0.18, 0.18, 0.36]) {
    const bezel = new THREE.CylinderGeometry(0.072, 0.072, 0.018, 14);
    bezel.rotateX(Math.PI / 2).translate(x, 0.84, 2.51);
    bezels.push(bezel);
    const face = new THREE.CircleGeometry(0.058, 14);
    face.translate(x, 0.84, 2.522);
    faces.push(face);
    const needle = new THREE.BoxGeometry(0.008, 0.038, 0.004);
    needle.rotateZ(x * 1.4).translate(x, 0.84, 2.53);
    needles.push(needle);
  }
  detail(
    "flight-instrument-bezels",
    mergeGeometries(bezels)!,
    dark,
    [0, 0, 0],
  );
  detail(
    "flight-instrument-faces",
    mergeGeometries(faces)!,
    instrumentFace,
    [0, 0, 0],
  );
  detail(
    "flight-instrument-needles",
    mergeGeometries(needles)!,
    gold,
    [0, 0, 0],
  );
  const display = detail(
    "multifunction-display",
    new THREE.BoxGeometry(0.16, 0.115, 0.012),
    displayFace,
    [0, 0.84, 2.516],
  );
  display.rotation.x = -0.16;
  const sideConsoleGeometries = [-1, 1].map((side) =>
    new THREE.BoxGeometry(0.16, 0.17, 0.72)
      .translate(side * 0.48, 0.67, 1.86),
  );
  detail(
    "side-consoles",
    mergeGeometries(sideConsoleGeometries)!,
    instrumentPanel,
    [0, 0, 0],
  );
  detail(
    "pilot-torso",
    new THREE.SphereGeometry(1, 14, 10).scale(0.27, 0.39, 0.18),
    pilotSuit,
    [0, 0.82, 1.52],
  );
  const harnessGeometries = [-1, 1].map((side) =>
    new THREE.BoxGeometry(0.055, 0.43, 0.035)
      .rotateZ(side * -0.22)
      .translate(side * 0.12, 0.85, 1.69),
  );
  detail(
    "pilot-harness",
    mergeGeometries(harnessGeometries)!,
    pilotTrim,
    [0, 0, 0],
  );
  detail(
    "hud-combiner",
    new THREE.BoxGeometry(0.3, 0.19, 0.014),
    new THREE.MeshBasicMaterial({
      color: "#8de0dd",
      transparent: true,
      opacity: 0.27,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
    [0, 1.17, 2.87],
  );
  g.add(cockpit);
  const panelPoints: THREE.Vector3[] = [],
    segment = (a: [number, number, number], b: [number, number, number]) =>
      panelPoints.push(new THREE.Vector3(...a), new THREE.Vector3(...b));
  for (const side of [-1, 1]) {
    for (const u of [0.27, 0.5, 0.73])
      segment(
        [side * 7 * u, 0.025, 2 - 3.8 * u],
        [side * 6.5 * u, 0.025, -2.5 - 0.8 * u],
      );
    segment(
      [side * 2.35, 0.025, -2.5 - (0.8 * 2.35) / 6.5 + 0.48],
      [side * 5.9, 0.025, -2.5 - (0.8 * 5.9) / 6.5 + 0.48],
    );
    const aileron = add(
      new THREE.BoxGeometry(2.15, 0.06, 0.46),
      body,
      new THREE.Vector3(side * 4.1, 0.045, -2.85),
    );
    aileron.name = side < 0 ? "aileron-left" : "aileron-right";
  }
  const panelSeams = new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints(panelPoints),
    new THREE.LineBasicMaterial({
      color: "#536166",
      transparent: true,
      opacity: 0.48,
      depthWrite: false,
    }),
  );
  panelSeams.name = "wing-panel-seams";
  g.add(panelSeams);
  function wing(side: number, z: number, size: number) {
    const shape = new THREE.Shape();
    shape.moveTo(0, 2);
    shape.lineTo(side * size, -1.8);
    shape.lineTo(side * (size - 0.5), -3.3);
    shape.lineTo(0, -2.5);
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: 0.18,
      bevelEnabled: false,
    });
    geo.rotateX(Math.PI / 2);
    const m = add(geo, body, new THREE.Vector3(0, 0, z));
    return m;
  }
  wing(-1, 0, 7);
  wing(1, 0, 7);
  wing(-1, -5, 3.2);
  wing(1, -5, 3.2);
  for (const side of [-1, 1]) {
    const elevator = add(
      new THREE.BoxGeometry(2.25, 0.07, 0.62),
      body,
      new THREE.Vector3(side * 1.2, 0.06, -6.02),
    );
    elevator.name = side < 0 ? "elevator-left" : "elevator-right";
    const hinge = add(
      new THREE.CylinderGeometry(0.035, 0.035, 2.1, 8),
      dark,
      new THREE.Vector3(side * 1.2, 0.1, -5.68),
    );
    hinge.rotation.z = Math.PI / 2;
    hinge.name = side < 0 ? "elevator-hinge-left" : "elevator-hinge-right";
    const rudder = add(
      new THREE.BoxGeometry(0.08, 1.2, 0.58),
      body,
      new THREE.Vector3(side * 0.88, 1.55, -4.62),
    );
    rudder.name = side < 0 ? "rudder-left" : "rudder-right";
  }
  for (const side of [-1, 1]) {
    let fin = add(
      new THREE.BoxGeometry(0.15, 2.6, 2.6),
      dark,
      new THREE.Vector3(side * 0.8, 1.25, -3.6),
    );
    fin.rotation.x = -0.3;
    fin.rotation.z = side * -0.25;
    let stripe = add(
      new THREE.BoxGeometry(2.7, 0.06, 0.55),
      gold,
      new THREE.Vector3(side * 4, 0.12, -0.3),
    );
    stripe.rotation.y = side * 0.25;
    let engine = add(
      new THREE.CylinderGeometry(0.52, 0.6, 2, 12),
      dark,
      new THREE.Vector3(side * 0.85, -0.3, -4.3),
    );
    engine.rotation.x = Math.PI / 2;
    let flame = add(
      new THREE.ConeGeometry(0.5, 3.2, 10),
      new THREE.MeshBasicMaterial({
        color: "#86d7ff",
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
      new THREE.Vector3(side * 0.85, -0.3, -6.6),
    );
    flame.rotation.x = -Math.PI / 2;
    flame.name = "flame";
    const core = add(
      new THREE.ConeGeometry(0.23, 2.4, 8),
      new THREE.MeshBasicMaterial({
        color: "#e7f5ff",
        transparent: true,
        opacity: 0.6,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
      new THREE.Vector3(side * 0.85, -0.3, -6.85),
    );
    core.rotation.x = -Math.PI / 2;
    core.name = "flame-core";
  }
  g.userData.googlyBounds = [0, 1, 1.5, 1.4, 0.9, 3];
  return g;
}
export function upgradePineapple(group: THREE.Group, texture?: THREE.Texture) {
  const fruit = group.children[0] as THREE.Mesh;
  fruitSurface(fruit.material as THREE.MeshStandardMaterial, texture);
  if (pineappleTemplate && group !== pineappleTemplate)
    upgradePineapple(pineappleTemplate, texture);
  if (group.userData.visualUpgrade) return;
  group.userData.visualUpgrade = true;
  fruit.geometry = visualGeometry("fruit_lod1", () =>
    fruit.geometry.clone(),
  ).scale(0.85, 0.85, 0.85);
  for (const object of group.children.slice(1)) {
    const mesh = object as THREE.Mesh;
    crownSurface(mesh.material as THREE.MeshStandardMaterial, 0.625, 0.18);
    mesh.geometry = visualGeometry("leaf_lod1", () =>
      mesh.geometry.clone(),
    ).scale(0.18, 0.625, 0.18);
  }
}
let pineappleTemplate: THREE.Group | undefined;
export function makePineapple(length = 6): THREE.Group {
  if (pineappleTemplate) {
    const clone = pineappleTemplate.clone();
    clone.scale.setScalar(length / 3.3);
    return clone;
  }
  const group = new THREE.Group();
  const map = texture((c) => {
    c.fillStyle = "#e7a327";
    c.fillRect(0, 0, 256, 256);
    for (let y = 0; y < 8; y++)
      for (let x = 0; x < 8; x++) {
        let xx = x * 36 + (y % 2) * 18,
          yy = y * 34;
        c.fillStyle = "#9e641b";
        c.beginPath();
        c.moveTo(xx, yy - 14);
        c.lineTo(xx + 16, yy);
        c.lineTo(xx, yy + 14);
        c.lineTo(xx - 16, yy);
        c.closePath();
        c.fill();
        c.fillStyle = "#f3c34a";
        c.fillRect(xx - 5, yy - 6, 10, 10);
      }
  });
  const fruit = new THREE.Mesh(
    new THREE.SphereGeometry(0.85, 12, 12),
    new THREE.MeshStandardMaterial({ map, roughness: 0.6, color: "#ffcb4a" }),
  );
  fruit.scale.y = 1.4;
  group.add(fruit);
  const leafMat = new THREE.MeshStandardMaterial({
    color: "#478341",
    roughness: 0.7,
    side: THREE.DoubleSide,
  });
  for (let i = 0; i < 7; i++) {
    let leaf = new THREE.Mesh(new THREE.ConeGeometry(0.17, 1.25, 3), leafMat),
      a = (i * Math.PI * 2) / 7;
    leaf.position.set(Math.sin(a) * 0.3, 1.45, Math.cos(a) * 0.3);
    leaf.rotation.z = Math.sin(a) * 0.4;
    leaf.rotation.x = Math.cos(a) * 0.4;
    group.add(leaf);
  }
  for (const child of group.children) child.position.y -= 0.45;
  group.userData.googlyBounds = [0, -0.45, 0, 0.85, 1.1, 0.85];
  pineappleTemplate = group;
  return makePineapple(length);
}

export function roofGeometry() {
  const geo = new THREE.ConeGeometry(Math.SQRT2, 2, 4);
  geo.rotateY(Math.PI / 4);
  return geo;
}

/** Closed roof wedges: original sloped face plus distinct exposed cuts. */
export function roofFragmentGeometry(part: number) {
  const shape = roofParts[part - 1];
  const positions: number[] = [],
    uvs: number[] = [],
    colors: number[] = [];
  shape.faces.forEach((face, i) => {
    for (const index of face) {
      const v = shape.vertices[index];
      positions.push(...v);
      const cut = i >= 2;
      uvs.push((v[0] + 1) * 0.245 + (cut ? 0.51 : 0), (v[1] + 1) / 2);
      colors.push(...(cut ? [1, 0.98, 0.94] : [0.9, 0.9, 0.88]));
    }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}

// Shared prepared fragment faces: pale exposed cuts contrast with weathered sides.
export function fractureGeometry(
  geo: THREE.BufferGeometry = new THREE.BoxGeometry(2, 2, 2),
) {
  const normals = geo.attributes.normal;
  const colors = new Float32Array(normals.count * 3);
  for (let i = 0; i < normals.count; i++) {
    const cut = normals.getY(i) > 0.5 || normals.getX(i) < -0.5;
    colors.set(cut ? [1, 0.98, 0.94] : [0.9, 0.9, 0.88], i * 3);
    geo.attributes.uv.setX(
      i,
      geo.attributes.uv.getX(i) * 0.49 + (cut ? 0.51 : 0),
    );
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geo;
}

export function fractureMaterials(
  source: Record<Material, THREE.MeshStandardMaterial>,
) {
  return Object.fromEntries(
    Object.entries(source).map(([key, original]) => {
      const m = original.clone();
      if (key === "window") {
        m.emissive.set(0);
        m.emissiveIntensity = 0;
      }
      m.vertexColors = true;
      const atlas = document.createElement("canvas");
      atlas.width = 512;
      atlas.height = 256;
      const c = atlas.getContext("2d")!;
      if (original.map) c.drawImage(original.map.image, 0, 0, 256, 256);
      else {
        c.fillStyle = "#d0c4ac";
        c.fillRect(0, 0, 256, 256);
      }
      c.fillStyle =
        key === "wood" ? "#a1815e" : key === "roof" ? "#916f54" : "#8f8b7d";
      c.fillRect(256, 0, 256, 256);
      for (let i = 0; i < 5000; i++) {
        const v = random(i + 900);
        c.fillStyle = `rgba(${v > 0.5 ? "255,244,222" : "49,44,35"},${0.04 + v * 0.12})`;
        c.fillRect(
          256 + random(i) * 256,
          random(i + 100) * 256,
          key === "wood" ? 1 : 2,
          key === "wood" ? 12 : 2,
        );
      }
      m.map = new THREE.CanvasTexture(atlas);
      m.map.colorSpace = THREE.SRGBColorSpace;
      m.map.anisotropy = 4;
      return [key, m];
    }),
  ) as Record<Material, THREE.MeshStandardMaterial>;
}

/** Normalized crowns share the existing base-to-tip tree transform and wreckage bounds. */
export function treeCrownGeometry(
  species: "pine" | "broadleaf" | "riverside" = "pine",
) {
  if (species === "pine") return pineGeometry();
  const pieces: THREE.BufferGeometry[] = [];
  const lobes =
    species === "broadleaf"
      ? [
          [0, 0.66, 0, 0.72, 0.3],
          [0.4, 0.62, 0, 0.55, 0.24],
          [-0.36, 0.6, 0.18, 0.55, 0.24],
          [0, 0.83, -0.2, 0.48, 0.19],
        ]
      : [
          [0, 0.68, 0, 0.48, 0.32],
          [0.24, 0.62, 0.1, 0.36, 0.25],
          [-0.22, 0.65, -0.1, 0.36, 0.25],
          [0, 0.87, 0, 0.28, 0.13],
        ];
  for (const [x, y, z, r, h] of lobes) {
    const g = new THREE.IcosahedronGeometry(1, 1);
    g.scale(r, h, r);
    g.translate(x, y, z);
    pieces.push(g);
  }
  return mergeGeometries(pieces);
}
export function treeCrownLowGeometry(
  species: "pine" | "broadleaf" | "riverside" = "pine",
) {
  if (species === "pine") {
    const g = new THREE.ConeGeometry(1, 1, 7);
    g.translate(0, 0.5, 0);
    return g;
  }
  const g = new THREE.IcosahedronGeometry(1, 0);
  g.scale(
    species === "broadleaf" ? 0.95 : 0.52,
    0.36,
    species === "broadleaf" ? 0.8 : 0.52,
  );
  g.translate(0, 0.64, 0);
  return g;
}
