import * as THREE from "three";
import { installFoliageMotion } from "./foliage-motion";
import { installSceneryLOD, SCENERY_LOD_FADE } from "./scenery-lod";
import { treeCrownLowGeometry } from "./assets";
import { statueRole } from "../statue-reaction";
import type { Entity, Material, WorldData } from "../types";
import { setTreeCanopyColor, treeCanopyScale } from "./tree-appearance";
import { deadTreeGeometry, setDeadTreeColor } from "./dead-tree";
import {
  statueGeometry,
  statueGeometryKey,
  setEntityTransform,
  setEntityColor,
  finishEntityTransform,
} from "./statue-geometry";

interface Coverage {
  allIds: number[];
  kind: string;
  x: number;
  z: number;
  radius: number;
}
/** Whole-island silhouettes are derived views of the same destructible owners. */
export class IslandHorizon {
  private eyeMaterials: THREE.MeshStandardMaterial[] = [];
  readonly group = new THREE.Group();
  private camera = { value: new THREE.Vector2() };
  private detail = { value: 1200 };
  private zero = new THREE.Matrix4().makeScale(0, 0, 0);
  private refs = new Map<
    number,
    { mesh: THREE.InstancedMesh; index: number }
  >();
  private originals = new Map<THREE.InstancedMesh, Float32Array>();
  private coverageGroups: { mesh: THREE.InstancedMesh; owners: Coverage[] }[] =
    [];
  constructor(
    world: WorldData,
    coverage: readonly Coverage[],
    materials: Record<Material, THREE.MeshStandardMaterial>,
    foliageTime = { value: 0 },
  ) {
    const owners = new Map<number, Coverage>();
    for (const batch of coverage)
      if (batch.kind !== "trunk")
        for (const id of batch.allIds) owners.set(id, batch);
    const lists = new Map<string, { kind: string; entities: Entity[] }>();
    for (const entity of world.entities) {
      if (!owners.has(entity.id) || entity.material === "window") continue;
      const key = entity.visual
        ? `statue:${statueGeometryKey(entity)}:${entity.visual.color}:${statueRole(entity, world) === "eye"}`
        : entity.kind === "tree"
          ? `tree:${entity.treeSpecies ?? "pine"}`
          : entity.kind === "rock"
            ? `rock:${entity.material}`
            : entity.material;
      // Whole-island batches force every distant vertex through the GPU even
      // when most of the island is behind the camera. Keep spatial bounds.
      const cell = `${Math.floor(entity.p[0] / 1024)},${Math.floor(entity.p[2] / 1024)}`;
      const spatialKey = `${key}:${cell}`;
      let list = lists.get(spatialKey);
      if (!list) lists.set(spatialKey, (list = { kind: key, entities: [] }));
      list.entities.push(entity);
    }
    const dummy = new THREE.Object3D();
    const canopyColor = new THREE.Color();
    const sharedMaterials = new Map<string, THREE.MeshStandardMaterial>();
    const sharedDepths = new Map<string, THREE.MeshDepthMaterial>();
    for (const { kind: key, entities } of lists.values()) {
      const forest = key.startsWith("tree:");
      const species = key.slice(5);
      const dead = forest && world.realm === "hell";
      const source = forest
        ? (materials.foliage ?? materials[entities[0].material])
        : materials[entities[0].material];
      const statue = !!entities[0].visual;
      const eye = statueRole(entities[0], world) === "eye";
      const geometry = statue
        ? statueGeometry(entities[0])
        : key.startsWith("rock:")
          ? new THREE.DodecahedronGeometry(1, 0)
          : forest
            ? dead
              ? deadTreeGeometry(
                  species as "pine" | "broadleaf" | "riverside",
                  true,
                )
              : treeCrownLowGeometry(
                  species as "pine" | "broadleaf" | "riverside",
                )
            : key === "roof" || key === "slate"
              ? new THREE.ConeGeometry(Math.SQRT2, 2, 4).rotateY(Math.PI / 4)
              : new THREE.BoxGeometry(2, 2, 2);
      const cachedMaterial = sharedMaterials.get(key);
      const material =
        cachedMaterial ??
        new THREE.MeshStandardMaterial({
          color: statue ? "white" : source.color,
          map:
            entities[0].visual?.shape === "portal-stone"
              ? source.map
              : statue
                ? null
                : source.map,
          vertexColors:
            (forest && !dead) ||
            entities[0].visual?.shape === "hero-head" ||
            entities[0].visual?.shape === "portal-stone",
          roughness: 1,
          side: statue ? THREE.DoubleSide : THREE.FrontSide,
          emissive: eye ? "#ff1010" : "black",
          emissiveIntensity: 0,
        });
      if (eye && !cachedMaterial) this.eyeMaterials.push(material);
      if (!cachedMaterial) {
        if (forest && !dead) installFoliageMotion(material, foliageTime);
        installSceneryLOD(material, this.camera, this.detail, false);
        sharedMaterials.set(key, material);
      }
      const mesh = new THREE.InstancedMesh(geometry, material, entities.length);
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.frustumCulled = true;
      mesh.matrixAutoUpdate = false;
      mesh.matrixWorldAutoUpdate = false;
      let depth = sharedDepths.get(key);
      if (!depth) {
        depth = new THREE.MeshDepthMaterial({
          depthPacking: THREE.RGBADepthPacking,
          alphaTest: material.alphaTest,
          side: material.side,
          map: null,
        });
        depth.onBeforeCompile = material.onBeforeCompile;
        depth.customProgramCacheKey = material.customProgramCacheKey;
        sharedDepths.set(key, depth);
      }
      mesh.customDepthMaterial = depth;
      entities.forEach((entity, index) => {
        setEntityTransform(dummy, entity);
        if (forest) {
          dummy.position.y -= entity.s[1];
          dummy.scale.fromArray(treeCanopyScale(entity));
        }
        finishEntityTransform(dummy, entity);
        mesh.setMatrixAt(index, dummy.matrix);
        mesh.setColorAt(
          index,
          forest
            ? dead
              ? setDeadTreeColor(canopyColor, entity)
              : setTreeCanopyColor(canopyColor, entity)
            : setEntityColor(canopyColor, entity),
        );
        this.refs.set(entity.id, { mesh, index });
      });
      // Preserve the original bounds when owners are removed or restored.
      mesh.computeBoundingSphere();
      this.coverageGroups.push({
        mesh,
        owners: [...new Set(entities.map((e) => owners.get(e.id)!))],
      });
      this.originals.set(
        mesh,
        (mesh.instanceMatrix.array as Float32Array).slice(),
      );
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(mesh);
    }
  }
  setView(camera: THREE.Vector3, detailDistance: number) {
    this.camera.value.set(camera.x, camera.z);
    this.detail.value = detailDistance;
    for (const group of this.coverageGroups) {
      // Skip the draw entirely when every owner is already represented nearby.
      // Keep the instances resident so moving away never requires reloading.
      let covered = true;
      for (const owner of group.owners) {
        const dx = owner.x - camera.x,
          dz = owner.z - camera.z;
        const fullyCovered = detailDistance - SCENERY_LOD_FADE - owner.radius;
        if (fullyCovered <= 0 || dx * dx + dz * dz >= fullyCovered ** 2) {
          covered = false;
          break;
        }
      }
      group.mesh.visible = !covered;
    }
  }
  setEyeGlow(intensity: number) {
    for (const material of this.eyeMaterials)
      material.emissiveIntensity = intensity;
  }
  remove(id: number) {
    const ref = this.refs.get(id);
    if (!ref) return;
    ref.mesh.setMatrixAt(ref.index, this.zero);
    ref.mesh.instanceMatrix.addUpdateRange(ref.index * 16, 16);
    ref.mesh.instanceMatrix.needsUpdate = true;
  }
  restore(removed: Iterable<number>) {
    for (const [mesh, original] of this.originals) {
      (mesh.instanceMatrix.array as Float32Array).set(original);
      mesh.instanceMatrix.clearUpdateRanges();
      mesh.instanceMatrix.needsUpdate = true;
    }
    for (const id of removed) this.remove(id);
  }
}
