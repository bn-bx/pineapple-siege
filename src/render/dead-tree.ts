import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { Entity } from "../types";

type Species = "pine" | "broadleaf" | "riverside";

/** Leafless geometry uses the same ground-origin, unit-height space as crowns. */
export function deadTreeGeometry(species: Species, low = false) {
  const pieces: THREE.BufferGeometry[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  const limb = (from: THREE.Vector3, to: THREE.Vector3, base: number, tip: number, sides = 3) => {
    const direction = to.clone().sub(from);
    const geometry = new THREE.CylinderGeometry(tip, base, direction.length(), sides, 1, true);
    geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, direction.normalize()));
    geometry.translate(...from.clone().add(to).multiplyScalar(.5).toArray());
    pieces.push(geometry);
  };
  const lean = species === "riverside" ? .12 : species === "broadleaf" ? -.06 : .025;
  const stem = (t: number) => new THREE.Vector3(lean * t * t, t, Math.sin(t * 5) * .025);
  const stemParts = low ? 2 : 4;
  for (let i = 0; i < stemParts; i++) {
    const a = i / stemParts, b = (i + 1) / stemParts;
    limb(stem(a), stem(b), .12 * (1 - a) + .02, .12 * (1 - b) + .02, low ? 3 : 5);
  }
  const count = low ? 4 : 9;
  for (let i = 0; i < count; i++) {
    const t = .3 + i / count * .58;
    const a = i * 2.399963 + (species === "riverside" ? .8 : .2);
    const reach = (species === "broadleaf" ? .62 : species === "pine" ? .44 : .52) * (1 - t * .55);
    const base = stem(t);
    const joint = base.clone().add(new THREE.Vector3(Math.cos(a) * reach * .68, .04, Math.sin(a) * reach * .68));
    const tip = base.clone().add(new THREE.Vector3(Math.cos(a) * reach, .13 + (i % 3) * .025, Math.sin(a) * reach));
    if (low) limb(base, tip, .045, .01);
    else {
      limb(base, joint, .06 * (1 - t * .4), .028);
      limb(joint, tip, .028, .008);
      if (i % 2 === 0) {
        const fork = joint.clone().add(new THREE.Vector3(Math.cos(a + .8) * reach * .36, .13, Math.sin(a + .8) * reach * .36));
        limb(joint, fork, .022, .006);
      }
    }
  }
  const result = mergeGeometries(pieces)!;
  for (const piece of pieces) piece.dispose();
  result.name = `dead-${species}${low ? "-low" : ""}`;
  return result;
}

export function setDeadTreeColor(color: THREE.Color, entity: Pick<Entity, "variant">) {
  const ash = .62 + Math.max(0, Math.min(1, entity.variant ?? .5)) * .27;
  return color.setRGB(ash, ash * .94, ash * .86);
}
