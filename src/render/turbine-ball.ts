import * as THREE from "three";
import { bakeMaterialGroups, sweptPlate } from "./infernal-jet";

/** An exposed double-ended turbine; the fans remain visible through the housing. */
export function makeTurbineBall(radius: number) {
  const source = new THREE.Group(), result = new THREE.Group(), r = radius;
  const steel = new THREE.MeshStandardMaterial({ color: "#9da9ad", metalness: .78, roughness: .4, transparent: true });
  const shell = new THREE.MeshStandardMaterial({ color: "#3b4a52", metalness: .72, roughness: .49, side: THREE.DoubleSide, transparent: true });
  const brass = new THREE.MeshStandardMaterial({ color: "#b39258", metalness: .65, roughness: .42, transparent: true });
  const dark = new THREE.MeshStandardMaterial({ color: "#131e24", metalness: .5, roughness: .54, transparent: true });
  const hot = new THREE.MeshStandardMaterial({ color: "#ff8e32", emissive: "#fa4c0d", emissiveIntensity: 2.1, side: THREE.DoubleSide, transparent: true });
  const add = (geometry: THREE.BufferGeometry, material: THREE.Material, p: [number, number, number] = [0, 0, 0]) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(...p); source.add(mesh); return mesh;
  };
  add(new THREE.CylinderGeometry(r * .85, r * .85, r * 1.22, 32, 1, true).rotateX(Math.PI / 2), shell);
  add(new THREE.TorusGeometry(r * .94, r * .055, 8, 48), brass);
  for (let i = 0; i < 16; i++) {
    const a = i * Math.PI / 8;
    const rib = add(new THREE.BoxGeometry(r * .075, r * .1, r * 1.15), i % 4 ? shell : brass,
      [Math.sin(a) * r * .86, Math.cos(a) * r * .86, 0]);
    rib.rotation.z = -a;
    for (const z of [-.48, .48])
      add(new THREE.SphereGeometry(r * .024, 5, 4), steel,
        [Math.sin(a) * r * .88, Math.cos(a) * r * .88, z * r]);
  }
  for (const end of [-1, 1]) {
    const z = end * r * .62;
    add(new THREE.TorusGeometry(r * .85, r * .08, 8, 48), steel, [0, 0, z]);
    add(new THREE.TorusGeometry(r * .72, r * .035, 6, 40), dark, [0, 0, z + end * r * .025]);
    add(new THREE.CircleGeometry(r * .72, 32), hot, [0, 0, z - end * r * .13]);
    for (let i = 0; i < 16; i++) {
      const blade = sweptPlate([[r * .16, 0], [r * .68, r * .04], [r * .7, r * .2], [r * .23, r * .16]], r * .025)
        .rotateX(-Math.PI / 2).rotateZ(i * Math.PI / 8);
      add(blade, steel, [0, 0, z]);
    }
    const hub = add(new THREE.ConeGeometry(r * .21, r * .34, 16), brass, [0, 0, z + end * r * .08]);
    hub.rotation.x = end * Math.PI / 2;
    add(new THREE.TorusGeometry(r * .25, r * .028, 6, 24), dark, [0, 0, z]);
  }
  for (const { geometry, material } of bakeMaterialGroups(source)) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = mesh.receiveShadow = true;
    result.add(mesh);
  }
  return result;
}
