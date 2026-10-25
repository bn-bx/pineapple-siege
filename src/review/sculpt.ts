import * as THREE from "three";
import { ResourceDisposal } from "../render/resource-disposal";
import { applyReferenceSurface } from "./surface-material";
import { toCreasedNormals } from "three/addons/utils/BufferGeometryUtils.js";
export interface SculptPart {
  id: string;
  region: string;
  damageOwner: string;
  material: string;
  vertices: number[][];
  triangles: number[][];
  triangleMaterials: string[];
  bounds: { min: number[]; max: number[] };
  uv?: number[][];
  projectionWeights?: number[];
  surface?: "body" | "cloth";
}
export interface SculptAsset {
  schemaVersion: number;
  headApprovalPreserved?: boolean;
  meshRevision: string;
  status: string;
  camera: {
    position: number[];
    target: number[];
    fov: number;
    near: number;
    far: number;
    width: number;
    height: number;
  };
  lighting: {
    ambient: number;
    sunIntensity: number;
    sunPosition: number[];
    exposure: number;
    time: number;
    crt: "off" | "subtle" | "retro";
  };
  materials: Record<
    string,
    { color: string; roughness: number; metalness: number }
  >;
  parts: SculptPart[];
  surfaceProjection?: {
    texture: string;
    crop: number[];
    scope: string;
    bakedLightingRemains: boolean;
  };
  bodyProjection?: SculptAsset["surfaceProjection"];
  clothProjection?: SculptAsset["surfaceProjection"];
  notes: string[];
}
/** Review asset and future collision owners share these exact vertices. */
export type SurfaceMode = "photo" | "material" | "clay";
export function createSculpt(
  asset: SculptAsset,
  referenceTexture?: THREE.Texture,
  bodyTexture?: THREE.Texture,
  clothTexture?: THREE.Texture,
) {
  const group = new THREE.Group();
  group.name = "unapproved-reference-sculpt";
  const materials = new Map<string, THREE.MeshStandardMaterial>();
  for (const [name, settings] of Object.entries(asset.materials))
    materials.set(
      name,
      new THREE.MeshStandardMaterial({
        ...settings,
        side: THREE.DoubleSide,
        flatShading: name !== "face",
      }),
    );
  const projectionStrengths: { value: number }[] = [];
  if (referenceTexture) {
    const surface = materials.get("face")!.clone();
    surface.flatShading = false;
    projectionStrengths.push(applyReferenceSurface(surface, referenceTexture));
    materials.set("reference-surface", surface);
  }
  for (const [surfaceId, texture] of [
    ["body", bodyTexture],
    ["cloth", clothTexture],
  ] as const) {
    if (!texture) continue;
    const bases = new Set(
      asset.parts
        .filter((p) => p.surface === surfaceId)
        .flatMap((p) => p.triangleMaterials),
    );
    for (const name of bases) {
      const surface = materials.get(name)!.clone();
      surface.flatShading = false;
      projectionStrengths.push(applyReferenceSurface(surface, texture));
      materials.set(surfaceId + "-reference-" + name, surface);
    }
  }
  const originals = new Map(
    [...materials].map(([name, m]) => [
      name,
      {
        color: m.color.clone(),
        roughness: m.roughness,
        metalness: m.metalness,
      },
    ]),
  );
  for (const part of asset.parts) {
    let geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(part.vertices.flat(), 3),
    );
    if (part.uv)
      geometry.setAttribute(
        "uv",
        new THREE.Float32BufferAttribute(part.uv.flat(), 2),
      );
    if (part.projectionWeights)
      geometry.setAttribute(
        "surfaceWeight",
        new THREE.Float32BufferAttribute(part.projectionWeights, 1),
      );
    geometry.setIndex(part.triangles.flat());
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const names = [...new Set(part.triangleMaterials)],
      mats = names.map(
        (name) =>
          materials.get(
            part.surface === "cloth" && clothTexture
              ? "cloth-reference-" + name
              : part.surface === "body" && bodyTexture
                ? "body-reference-" + name
                : part.uv && !part.surface && referenceTexture
                  ? "reference-surface"
                  : name,
          )!,
      );
    // Coalesce adjacent triangles using the same material into one draw group.
    let start = 0;
    while (start < part.triangles.length) {
      const material = part.triangleMaterials[start];
      let end = start + 1;
      while (
        end < part.triangles.length &&
        part.triangleMaterials[end] === material
      )
        end++;
      geometry.addGroup(start * 3, (end - start) * 3, names.indexOf(material));
      start = end;
    }
    if (part.region === "head") {
      const source = geometry;
      geometry = toCreasedNormals(source, 1.0);
      source.dispose();
    }
    if (part.id.startsWith("body-")) {
      for (const m of mats) m.flatShading = false;
    }
    const mesh = new THREE.Mesh(geometry, mats);
    mesh.name = part.id;
    mesh.userData = { region: part.region, damageOwner: part.damageOwner };
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
  }
  function setSurfaceMode(mode: SurfaceMode) {
    for (const strength of projectionStrengths)
      strength.value = mode === "photo" ? 1 : 0;
    for (const [name, m] of materials) {
      const saved = originals.get(name)!;
      m.color.copy(mode === "clay" ? new THREE.Color("#b9b7ab") : saved.color);
      m.roughness = mode === "clay" ? 1 : saved.roughness;
      m.metalness = mode === "clay" ? 0 : saved.metalness;
    }
  }
  let disposed = false;
  function dispose() {
    if (disposed) return;
    disposed = true;
    const resources = new ResourceDisposal();
    resources.collect(group);
    for (const material of materials.values())
      resources.materials.add(material);
    resources.dispose();
  }
  return { group, materials, setSurfaceMode, dispose };
}
export function collisionBounds(part: SculptPart) {
  const min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  for (const p of part.vertices)
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], p[k]);
      max[k] = Math.max(max[k], p[k]);
    }
  return { min, max };
}
