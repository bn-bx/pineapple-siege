import * as THREE from "three";
import type { Entity } from "../types";
import { statueShape } from "../world/statue-shapes.mjs";
const sectorRotation = new THREE.Matrix4();

export function statueGeometryKey(e: Entity) {
  const v = e.visual!;
  return `${v.shape}:${v.band}${v.shape.startsWith("hero-") ? ":" + v.azimuth : ""}`;
}
export function statueGeometry(e: Entity) {
  const v = e.visual!;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(
      statueShape(v.shape, v.band, v.azimuth),
      3,
    ),
  );
  const positions = geometry.getAttribute("position");
  if (v.shape === "hero-head" || v.shape === "portal-stone") {
    const colors = new Float32Array(positions.count * 3),
      uv = new Float32Array(positions.count * 2);
    for (let i = 0; i < positions.count; i++) {
      const px = positions.getX(i),
        y = positions.getY(i),
        pz = positions.getZ(i);
      let shade = 1;
      if (v.shape === "hero-head") {
        const x = px * Math.cos(v.azimuth) + pz * Math.sin(v.azimuth),
          z = -px * Math.sin(v.azimuth) + pz * Math.cos(v.azimuth);
        const curve = -0.35 - 0.015 * (Math.abs(x) / 0.33) ** 2;
        const line =
          Math.exp(-(((y - curve) / 0.022) ** 2)) *
          Math.exp(-((x / 0.32) ** 6));
        if (z > 0.5) shade = 1 - line * 0.82;
      } else {
        const r = Math.hypot(px, pz),
          angle = Math.abs(Math.atan2(pz, px));
        shade = angle > Math.PI / 12 - 0.008 || r > 0.99 || r < 0.73 ? 0.58 : 1;
        uv[i * 2] = px * 6;
        uv[i * 2 + 1] = pz * 6;
      }
      colors.set([shade, shade, shade], i * 3);
    }
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    if (v.shape === "portal-stone")
      geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  }
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
  if (!e.visual) return color.setHSL(0.12, 0.06, 0.77 + e.variant * 0.16);
  const v = e.visual;
  // Hell's authored override colors retain their existing appearance.
  const palette: Record<string, string> = {
    "#777b67": "#858674",
    "#cf9e38": "#c79842",
    "#4e5143": "#30372f",
    "#626d45": "#4b6340",
  };
  color.set(palette[v.color] ?? v.color);
  if (v.shape === "leaf" && palette[v.color])
    color.set(v.color === "#cf9e38" ? "#92904a" : "#3e603e");
  if (v.shape === "pineapple" && palette[v.color])
    color.multiplyScalar(0.94 + (v.band % 2) * 0.09);
  return color;
}
/** Rotate sectors before ellipsoid scaling, so neighboring carved slices meet exactly. */
export function finishEntityTransform(dummy: THREE.Object3D, e: Entity) {
  dummy.updateMatrix();
  if (e.visual?.azimuth)
    dummy.matrix.multiply(sectorRotation.makeRotationY(e.visual.azimuth));
}
