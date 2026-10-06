import * as THREE from "three";
import type { Entity } from "../types";

export function isLoggingCampLog(
  entity: Pick<Entity, "kind" | "material" | "assembly">,
) {
  return (
    entity.kind === "block" &&
    entity.material === "wood" &&
    /-stack-\d+$/.test(entity.assembly)
  );
}

/** Horizontal sawn timber; entity scale and destruction ownership are unchanged. */
export function loggingCampLogGeometry() {
  const geometry = new THREE.CylinderGeometry(1, 1, 2, 12, 1, false);
  geometry.rotateZ(Math.PI / 2);
  geometry.computeBoundingBox();
  return geometry;
}
