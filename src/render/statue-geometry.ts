import * as THREE from "three";
import type { Entity } from "../types";
import { statueShape } from "../world/statue-shapes.mjs";
const sectorRotation = new THREE.Matrix4();

export function statueGeometryKey(e: Entity) {
  return `${e.visual!.shape}:${e.visual!.band}`;
}
export function statueGeometry(e: Entity) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(
      statueShape(e.visual!.shape, e.visual!.band),
      3,
    ),
  );
  geometry.computeVertexNormals();
  return geometry;
}
export function setEntityTransform(dummy: THREE.Object3D, e: Entity) {
  dummy.position.fromArray(e.p);
  if (e.visual) {
    dummy.position.add(new THREE.Vector3().fromArray(e.visual.offset));
    dummy.scale.fromArray(e.visual.size);
    const [x, y, z] = e.visual.rotation;
    dummy.rotation.set(x, y, z, "YXZ");
  } else {
    dummy.scale.fromArray(e.s);
    dummy.rotation.set(0, e.kind === "block" ? 0 : e.variant * 6.28, 0, "XYZ");
  }
}
export function setEntityColor(color: THREE.Color, e: Entity) {
  return e.visual
    ? color.set(e.visual.color)
    : color.setHSL(0.12, 0.06, 0.77 + e.variant * 0.16);
}
/** Rotate sectors before ellipsoid scaling, so neighboring carved slices meet exactly. */
export function finishEntityTransform(dummy: THREE.Object3D, e: Entity) {
  dummy.updateMatrix();
  if (e.visual?.azimuth)
    dummy.matrix.multiply(sectorRotation.makeRotationY(e.visual.azimuth));
}
