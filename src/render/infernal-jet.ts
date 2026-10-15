import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

/** A bevelled wing in the XZ plane; aircraft face +Z. */
export function sweptPlate(points: readonly (readonly [number, number])[], depth: number) {
  const shape = new THREE.Shape();
  points.forEach(([x, z], i) => i ? shape.lineTo(x, z) : shape.moveTo(x, z));
  shape.closePath();
  return new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: true, bevelSize: depth * 0.35,
    bevelThickness: depth * 0.3, bevelSegments: 1, steps: 1,
  }).rotateX(Math.PI / 2).translate(0, depth / 2, 0);
}

export type JetStyle = "hunter" | "god" | "projectile";

/** Shared aircraft design, with individual sections retained for the god's damage. */
export function makeInfernalJet(style: JetStyle = "hunter") {
  const group = new THREE.Group();
  const god = style === "god", walking = style === "hunter";
  const hull = new THREE.MeshStandardMaterial({
    color: god ? "#4b5260" : "#697783", metalness: 0.65, roughness: 0.43,
  });
  const armor = new THREE.MeshStandardMaterial({
    color: god ? "#ddd2ab" : "#c4c9bb", metalness: 0.45, roughness: 0.5,
  });
  const dark = new THREE.MeshStandardMaterial({ color: "#18232b", metalness: 0.5, roughness: 0.54 });
  const brass = new THREE.MeshStandardMaterial({ color: "#bc8747", metalness: 0.7, roughness: 0.38 });
  const hot = new THREE.MeshStandardMaterial({
    color: "#ff6326", emissive: "#ff3b0c", emissiveIntensity: 2.4,
    metalness: 0.15, roughness: 0.28,
  });
  const glass = new THREE.MeshStandardMaterial({
    color: "#264c58", emissive: "#40978c", emissiveIntensity: 0.55,
    metalness: 0.72, roughness: 0.18,
  });
  const add = (geometry: THREE.BufferGeometry, material: THREE.Material,
    p: [number, number, number] = [0, 0, 0], section = 0) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(...p);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.userData.section = section;
    group.add(mesh);
    return mesh;
  };
  const cylinder = (front: number, rear: number, length: number, open = false) =>
    new THREE.CylinderGeometry(front, rear, length, 12, 1, open).rotateX(Math.PI / 2);
  const ring = (radius: number, tube: number) => new THREE.TorusGeometry(radius, tube, 5, 20);

  const profile = [[0.9, -12], [2, -10], [2.4, -5], [2.15, 2], [1.35, 8], [0.35, 13], [0, 15]];
  add(new THREE.LatheGeometry(profile.map(([r, z]) => new THREE.Vector2(r, z)), 14)
    .rotateX(Math.PI / 2), hull);
  add(cylinder(1.25, 1.8, 6), armor, [0, 0.1, 7], 1);
  add(new THREE.ConeGeometry(1.25, 6, 12).rotateX(Math.PI / 2), dark, [0, 0.1, 13], 1);
  const canopy = add(new THREE.SphereGeometry(1, 14, 8), dark, [0, 1.8, 3.6], 1);
  canopy.scale.set(1.35, 0.95, 3.1);
  const window = add(new THREE.SphereGeometry(1, 12, 8), glass, [0, 2.13, 3.8], 1);
  window.scale.set(1.05, 0.72, 2.4);
  add(sweptPlate([[-.14, 7], [.14, 7], [.14, -8], [-.14, -8]], .13), brass, [0, 2.25, 0]);

  for (const side of [-1, 1]) {
    const section = side < 0 ? 2 : 3;
    const wing = (points: [number, number][], thickness: number, mat: THREE.Material, y = 0) =>
      add(sweptPlate(points.map(([x, z]) => [x * side, z]), thickness), mat, [0, y, 0], section);
    wing([[2, 3], [17, -7], [15, -11], [4, -7], [2, -8]], .4, hull);
    wing([[4, 0], [14.8, -7.2], [13.6, -8.7], [5, -5.2]], .12, armor, .34);
    wing([[5, -6], [14, -10], [10, -10.3], [4, -7.8]], .15, dark, .38);
    wing([[2, 9], [6.2, 5.3], [5.8, 3.6], [2, 5.3]], .22, armor, .1);
    wing([[2, -9], [8, -12], [7, -14.5], [1.5, -12]], .25, hull, .5);
    wing([[13, -7], [16.5, -8], [15.2, -9.3], [12.4, -8.4]], .12, brass, .43);
    add(new THREE.SphereGeometry(.3, 6, 4), hot, [side * 15.7, .5, -8.4], section);
    const fin = sweptPlate([[0, -5], [4.7, -10], [3.4, -13], [0, -11]], .25).rotateZ(Math.PI / 2);
    add(fin, dark, [side * 3.8, .8, 0], section);

    const engine = side < 0 ? 4 : 5;
    add(cylinder(1.55, 1.8, 11), hull, [side * 4.5, -.9, -6], engine);
    add(cylinder(1.55, 1.55, 1.2, true), brass, [side * 4.5, -.9, -.2], engine);
    add(new THREE.CircleGeometry(1.45, 16), dark, [side * 4.5, -.9, .45], engine);
    add(ring(1.25, .18), brass, [side * 4.5, -.9, .5], engine);
    for (let blade = 0; blade < 8; blade++) {
      const a = blade * Math.PI / 4;
      const vane = add(new THREE.BoxGeometry(.18, 1.1, .14), hull,
        [side * 4.5 + Math.sin(a) * .7, -.9 + Math.cos(a) * .7, .55], engine);
      vane.rotation.z = -a + .45;
    }
    for (let z = -4; z >= -10; z -= 3)
      add(ring(1.76, .13), dark, [side * 4.5, -.9, z], engine);
    add(cylinder(1.8, 1.3, 1.3, true), dark, [side * 4.5, -.9, -12], engine);
    add(ring(1.2, .2), hot, [side * 4.5, -.9, -12.75], engine);
    add(new THREE.SphereGeometry(.92, 8, 6), hot, [side * 4.5, -.9, -12.6], engine);
    for (let z = -3; z >= -7; z -= 2)
      add(new THREE.BoxGeometry(.22, .15, 1.1), dark, [side * 2.6, 1.4, z]);

    if (walking) for (const z of [-4, 5]) {
      const strut = add(new THREE.CylinderGeometry(.35, .55, 3.5, 6), brass, [side * 4, -3, z], section);
      strut.rotation.z = side * .3;
      add(new THREE.SphereGeometry(.65, 6, 4), dark, [side * 4.4, -4.4, z], section);
      add(sweptPlate([[2.8, z + 1], [6, z + 1], [6.5, z - 2.4], [4.1, z - .6]], .45), dark, [0, -5, 0], section)
        .scale.x = side;
    }
  }
  if (god) {
    add(ring(17.8, .32), brass, [0, 1.5, -5]);
    add(ring(16.8, .12), hot, [0, 1.5, -5.1]);
    for (let i = 0; i < 16; i++) {
      const angle = i * Math.PI / 8;
      const tooth = add(new THREE.ConeGeometry(.48, i % 2 ? 2 : 3.3, 4), armor,
        [Math.sin(angle) * 18.8, 1.5 + Math.cos(angle) * 18.8, -5]);
      tooth.rotation.z = -angle;
    }
    add(new THREE.SphereGeometry(.9, 12, 8), hot, [0, 3, 6], 1);
    for (const side of [-1, 1]) for (let i = 0; i < 3; i++) {
      const spear = add(new THREE.ConeGeometry(.45, 7 + i * 2, 5), brass,
        [side * (9 + i * 2), 1, -8 - i], side < 0 ? 2 : 3);
      spear.rotation.x = -Math.PI / 2;
    }
  }
  group.name = `infernal-${style}`;
  return group;
}

/** Collapse static detail into one draw per material without losing its silhouette. */
export function bakeMaterialGroups(root: THREE.Group) {
  root.updateMatrixWorld(true);
  const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const originals = new Set<THREE.BufferGeometry>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const material = object.material as THREE.Material;
    const geometry = object.geometry.index ? object.geometry.toNonIndexed() : object.geometry.clone();
    geometry.applyMatrix4(object.matrixWorld);
    let list = buckets.get(material);
    if (!list) buckets.set(material, list = []);
    list.push(geometry);
    originals.add(object.geometry);
  });
  const result = [...buckets].map(([material, geometries]) => {
    const geometry = mergeGeometries(geometries)!;
    for (const part of geometries) part.dispose();
    return { geometry, material };
  });
  for (const geometry of originals) geometry.dispose();
  return result;
}
