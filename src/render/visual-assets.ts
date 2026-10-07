import { plasterSurface } from "./plaster-surface";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import type { Material } from "../types";
import RUNTIME_ASSETS from "../runtime-assets.json";

export type SurfaceFamily =
  | "stone"
  | "wood"
  | "grass"
  | "rock"
  | "soil"
  | "sand"
  | "roof"
  | "bark"
  | "cloth";
export interface VisualAssetFamily {
  name: string;
  levels: readonly string[];
  surface: SurfaceFamily | "fruit" | "foliage" | "metal" | "skin" | "glass";
  bounds: "authored-model-aabb";
  animation: "snapshot-pose" | "shader-wind" | "none";
  destruction: "existing-owner" | "actor-hit-volume";
}
export interface VisualAssetManifest {
  version: number;
  modelLibrary: string;
  fruitSkin: string;
  surfaces: readonly SurfaceFamily[];
  detailLevels: readonly number[];
  ownership: "existing-entity-id";
  animation: "snapshot-timeline";
  families: readonly VisualAssetFamily[];
  decoders: { texture: string; geometry: "bundled-meshopt" };
}
export const VISUAL_ASSETS: VisualAssetManifest = {
  version: 11,
  modelLibrary: RUNTIME_ASSETS.modelLibrary.path,
  fruitSkin: RUNTIME_ASSETS.fruitSkin.path,
  surfaces: [
    "stone",
    "wood",
    "grass",
    "rock",
    "soil",
    "roof",
    "bark",
    "cloth",
    "sand",
  ],
  detailLevels: [0, 1, 2],
  ownership: "existing-entity-id",
  animation: "snapshot-timeline",
  decoders: { texture: RUNTIME_ASSETS.decoders.path, geometry: "bundled-meshopt" },
  families: (
    [
      ["module", "stone"],
      ["coping", "stone"],
      ["door", "wood"],
      ["window", "glass"],
      ["arch-trim", "stone"],
      ["roof", "roof"],
      ["rock", "rock"],
      ["pine", "foliage"],
      ["grass-clump", "foliage"],
      ["broadleaf", "foliage"],
      ["riverside", "foliage"],
      ["fruit", "fruit"],
      ["leaf", "foliage"],
      ["human-head", "skin"],
      ["human-torso", "cloth"],
      ["human-limb", "cloth"],
      ["human-hand", "skin"],
      ["human-boot", "cloth"],
    ] as const
  ).map(([name, surface]) => ({
    name,
    surface,
    levels: [0, 1, 2].map((l) => `${name}_lod${l}`),
    bounds: "authored-model-aabb",
    animation:
      name.includes("human") || name === "fruit"
        ? "snapshot-pose"
        : surface === "foliage"
          ? "shader-wind"
          : "none",
    destruction:
      name.includes("human") || name === "fruit"
        ? "actor-hit-volume"
        : "existing-owner",
  })),
};
const geometryLibrary = new Map<string, THREE.BufferGeometry>();
/** Source meshes remain immutable; owners retain normal renderer disposal. */
export function visualGeometry(
  name: string,
  fallback: () => THREE.BufferGeometry,
) {
  return geometryLibrary.get(name)?.clone() ?? fallback();
}
export class VisualAssets {
  readonly surfaces = new Map<
    SurfaceFamily,
    { color: THREE.Texture; normal: THREE.Texture; orm: THREE.Texture }
  >();
  readonly failures: string[] = [];
  readonly bounds = new Map<string, THREE.Box3>();
  readonly foliage = new Map<string, THREE.Texture>();
  loaded = 0;
  readonly total = 9 + VISUAL_ASSETS.surfaces.length;
  puffAtlas?: THREE.Texture;
  fruitSkin?: THREE.Texture;
  readonly ready: Promise<void>;
  readonly loadingStages: Record<string, number> = {};
  jet?: THREE.Group;
  private cancelled = false;
  private loader: KTX2Loader;
  private ownedTextures = new Set<THREE.Texture>();
  constructor(renderer: THREE.WebGLRenderer) {
    this.loader = new KTX2Loader()
      .setTranscoderPath(VISUAL_ASSETS.decoders.texture)
      .setWorkerLimit(2)
      .detectSupport(renderer);
    this.ready = this.load();
  }
  private async load() {
    const started = performance.now();
    let stageStarted = started;
    const mark = (name: string) => {
      const now = performance.now();
      this.loadingStages[name] = now - stageStarted;
      stageStarted = now;
    };
    const models = new GLTFLoader()
      .setKTX2Loader(this.loader)
      .setMeshoptDecoder(MeshoptDecoder);
    try {
      const gltf = await models.loadAsync(VISUAL_ASSETS.modelLibrary);
      if (this.cancelled) return;
      gltf.scene.updateMatrixWorld(true);
      this.jet = new THREE.Group();
      gltf.scene.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        const geometry = object.geometry.clone();
        // Quantized normalized attributes cannot safely receive baked metre
        // transforms in-place: convert positions/normals before applying them.
        for (const name of ["position", "normal", "uv"]) {
          const attr = geometry.getAttribute(name);
          if (!attr) continue;
          const components = name === "uv" ? 2 : 3;
          const values = new Float32Array(attr.count * components);
          for (let i = 0; i < attr.count; i++) {
            values[i * components] = attr.getX(i);
            values[i * components + 1] = attr.getY(i);
            if (components === 3) values[i * components + 2] = attr.getZ(i);
          }
          geometry.setAttribute(
            name,
            new THREE.BufferAttribute(values, components),
          );
        }
        geometry.applyMatrix4(object.matrixWorld);
        geometry.computeBoundingBox();
        this.bounds.set(object.name, geometry.boundingBox!.clone());
        if (object.name.includes("_lod")) {
          geometryLibrary.get(object.name)?.dispose();
          geometryLibrary.set(object.name, geometry);
        } else {
          const mesh = new THREE.Mesh(geometry, object.material);
          mesh.name = object.name;
          if (object.name === "canopy") {
            const canopy = (
              mesh.material as THREE.MeshStandardMaterial
            ).clone();
            canopy.transparent = true;
            canopy.color.set("#a5d0d7");
            canopy.metalness = 0.2;
            canopy.roughness = 0.2;
            canopy.opacity = 0.34;
            canopy.depthWrite = false;
            mesh.material = canopy;
            mesh.castShadow = false;
          }
          const pivot = object.userData.pivot as number[] | undefined;
          if (pivot) {
            geometry.translate(-pivot[0], -pivot[1], -pivot[2]);
            mesh.position.fromArray(pivot);
          }
          mesh.castShadow = object.name !== "canopy";
          mesh.receiveShadow = true;
          this.jet!.add(mesh);
        }
        object.geometry.dispose();
      });
      this.loaded++;
    } catch {
      this.failures.push("models");
    }
    mark("modelsMS");
    const foliageFamilies = [
      "pine",
      "broadleaf",
      "grass",
      "pine-impostor",
      "broadleaf-impostor",
      "riverside-impostor",
    ];
    // Keep both decoder workers occupied, with the same two-resource bound
    // as surface loading rather than six sequential network/decode waits.
    for (let i = 0; i < foliageFamilies.length; i += 2) {
      if (this.cancelled) break;
      await Promise.all(
        foliageFamilies.slice(i, i + 2).map(async (family) => {
          try {
            const texture = await this.loader.loadAsync(
              RUNTIME_ASSETS.foliage[family as keyof typeof RUNTIME_ASSETS.foliage].path,
            );
            texture.colorSpace = THREE.SRGBColorSpace;
            texture.anisotropy = 4;
            // KTX uploads preserve top-first image rows. Match authored UVs.
            texture.repeat.y = -1;
            texture.offset.y = 1;
            this.ownedTextures.add(texture);
            if (!this.cancelled) {
              this.foliage.set(family, texture);
              this.loaded++;
            } else texture.dispose();
          } catch {
            this.failures.push(`foliage:${family}`);
          }
        }),
      );
    }
    mark("foliageMS");
    try {
      const texture = await this.loader.loadAsync(RUNTIME_ASSETS.puffAtlas.path);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.generateMipmaps = false;
      texture.minFilter = texture.magFilter = THREE.LinearFilter;
      this.ownedTextures.add(texture);
      if (!this.cancelled) {
        this.puffAtlas = texture;
        this.loaded++;
      } else texture.dispose();
    } catch {
      this.failures.push("particles:puff-atlas");
    }
    mark("particlesMS");
    try {
      const texture = await this.loader.loadAsync(VISUAL_ASSETS.fruitSkin);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 4;
      this.ownedTextures.add(texture);
      if (!this.cancelled) {
        this.fruitSkin = texture;
        this.loaded++;
      } else texture.dispose();
    } catch {
      this.failures.push("fruit:skin");
    }
    mark("fruitMS");
    // Two families in flight bound decoder memory and uploads during startup.
    for (let i = 0; i < VISUAL_ASSETS.surfaces.length; i += 2) {
      await Promise.all(
        VISUAL_ASSETS.surfaces.slice(i, i + 2).map(async (family) => {
          const textures: THREE.Texture[] = [];
          try {
            for (const channel of ["color", "normal", "orm"] as const) {
              const texture = await this.loader.loadAsync(
                RUNTIME_ASSETS.surfaces[family][channel].path,
              );
              texture.colorSpace =
                channel === "color" ? THREE.SRGBColorSpace : THREE.NoColorSpace;
              texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
              texture.anisotropy = 4;
              textures.push(texture);
              this.ownedTextures.add(texture);
            }
            if (!this.cancelled) {
              this.surfaces.set(family, {
                color: textures[0],
                normal: textures[1],
                orm: textures[2],
              });
              this.loaded++;
            } else textures.forEach((t) => t.dispose());
          } catch {
            textures.forEach((t) => t.dispose());
            this.failures.push(family);
          }
        }),
      );
      if (this.cancelled) break;
    }
    mark("surfacesMS");
    this.loadingStages.totalMS = performance.now() - started;
  }
  applyMaterials(materials: Record<Material, THREE.MeshStandardMaterial>) {
    const families: Partial<Record<Material, SurfaceFamily>> = {
      stone: "stone",
      sandstone: "stone",

      wood: "wood",
      earth: "soil",
      rock: "rock",
      roof: "roof",
      slate: "roof",
    };
    for (const [name, family] of Object.entries(families)) {
      const surface = this.surfaces.get(family as SurfaceFamily);
      if (!surface) continue;
      const material = materials[name as Material];
      material.map = surface.color;
      material.normalMap = surface.normal;
      material.roughnessMap = material.aoMap = surface.orm;
      material.normalScale.set(0.65, 0.65);
      material.roughness = 0.95;
      material.aoMapIntensity = 0.45;
      material.color.set(
        name === "sandstone"
          ? "#e0d3ba"
          : name === "roof"
            ? "#b38b74"
            : name === "slate"
              ? "#8b9396"
              : "#ffffff",
      );
      material.needsUpdate = true;
    }
    plasterSurface(materials.plaster);
  }
  get residentTextures() {
    return this.ownedTextures.values();
  }
  dispose() {
    this.cancelled = true;
    this.loader.dispose();
    for (const texture of this.ownedTextures) texture.dispose();
    this.ownedTextures.clear();
  }
}
