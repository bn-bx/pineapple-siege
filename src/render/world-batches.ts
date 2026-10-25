import * as THREE from "three";
import { installFoliageMotion } from "./foliage-motion";
import { ApprovedGodView } from "./approved-god";
import { statueRole } from "../statue-reaction";
import type { StatueReaction } from "../types";
import { isRoof } from "../debris-shape";
import type { Entity, Material, WorldData } from "../types";
import {
  pineGeometry,
  roofGeometry,
  treeCrownGeometry,
  treeCrownLowGeometry,
} from "./assets";
import { IslandHorizon } from "./island-horizon";
import type { ResourceDisposal } from "./resource-disposal";
import { setTreeCanopyColor, treeCanopyScale } from "./tree-appearance";
import { deadTreeGeometry, setDeadTreeColor } from "./dead-tree";
import {
  statueGeometry,
  statueGeometryKey,
  setEntityTransform,
  setEntityColor,
  finishEntityTransform,
} from "./statue-geometry";
export interface Batch {
  mesh: THREE.InstancedMesh;
  low?: THREE.InstancedMesh;
  ids: number[];
  allIds: number[];
  kind: string;
  x: number;
  z: number;
  radius: number;
}
const dummy = new THREE.Object3D();
export class WorldBatches {
  private foliageMaterials: THREE.Material[] = [];
  private eyeMaterials = new Set<THREE.MeshStandardMaterial>();
  readonly batches: Batch[] = [];
  readonly foliageTime = { value: 0 };
  readonly refs = new Map<number, { batch: Batch; index: number }[]>();
  readonly removed = new Set<number>();
  readonly flagGroup = new THREE.Group();
  readonly horizon: IslandHorizon;
  readonly approvedGod: ApprovedGodView;
  private fragmentColor = new THREE.Color();
  private box = new THREE.BoxGeometry(2, 2, 2);
  private roof = roofGeometry();
  private geometries = new Set<THREE.BufferGeometry>([this.box, this.roof]);
  constructor(
    private scene: THREE.Scene,
    readonly world: WorldData,
    private materials: Record<Material, THREE.MeshStandardMaterial>,
  ) {
    this.approvedGod = new ApprovedGodView(world);
    this.scene.add(this.approvedGod.group);
    this.buildBatches();
    this.addBanners();
    this.scene.add(this.flagGroup);
    this.horizon = new IslandHorizon(world, this.batches, materials, this.foliageTime);
    this.scene.add(this.horizon.group);
  }

  private buildBatches() {
    const grouped = new Map<string, Entity[]>();
    const livingFoliage = this.world.realm === "hell"
      ? this.materials.foliage
      : this.materials.foliage?.clone() ?? new THREE.MeshStandardMaterial();
    const foliageDepth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
    this.foliageMaterials.push(livingFoliage, foliageDepth);
    if (this.world.realm !== "hell") {
      const source = this.materials.foliage ?? livingFoliage;
      livingFoliage.onBeforeCompile = source.onBeforeCompile;
      const sourceKey = source.customProgramCacheKey();
      livingFoliage.customProgramCacheKey = () => sourceKey;
      installFoliageMotion(livingFoliage, this.foliageTime);
      installFoliageMotion(foliageDepth, this.foliageTime);
    }

    const statueGeometries = new Map<string, THREE.BufferGeometry>();
    const statueMaterials = new Map<string, THREE.MeshStandardMaterial>();
    const crowns = new Map<string, THREE.BufferGeometry>();
    const crown = (species: "pine" | "broadleaf" | "riverside", low = false) => {
      const key = `${species}:${low}`;
      let geometry = crowns.get(key);
      if (!geometry) {
        geometry = low ? treeCrownLowGeometry(species) : treeCrownGeometry(species);
        crowns.set(key, geometry);
        this.geometries.add(geometry);
      }
      return geometry;
    };
    const deadGeometries = new Map<string, THREE.BufferGeometry>();
    const deadGeometry = (species: "pine" | "broadleaf" | "riverside", low = false) => {
      const key = `${species}:${low}`;
      let geometry = deadGeometries.get(key);
      if (!geometry) {
        geometry = deadTreeGeometry(species, low);
        deadGeometries.set(key, geometry);
        this.geometries.add(geometry);
      }
      return geometry;
    };
    for (const e of this.world.entities) {
      if (e.visual?.sculptOwner !== undefined) continue;
      if (this.world.realm === "hell" && e.visual && (e.visual.role === "figure" || e.visual.role === "eye")) continue;
      // Larger construction batches reduce CPU draw submission while retaining
      // spatial bounds, owner lookup and the original collision entities.
      // Match construction to the existing forest/rock spatial grid. Fewer
      // material batches reduce submission work; owner references and the
      // batch-derived distant-coverage boundary are rebuilt together.
      const size = 512;
      const cell = `${Math.floor(e.p[0] / size)},${Math.floor(e.p[2] / size)}`;
      const key = e.visual
        ? `statue:${statueGeometryKey(e)}:${e.visual.color}:${statueRole(e, this.world) === "eye"}:${cell}`
        : e.kind + e.material + (e.treeSpecies ?? "pine") + cell;
      let list = grouped.get(key);
      if (!list) grouped.set(key, (list = []));
      list.push(e);
    }
    const pine = pineGeometry(),
      low = treeCrownLowGeometry("pine");
    const roof = this.roof;
    const rock = new THREE.DodecahedronGeometry(1, 0);
    for (const geometry of [pine, low, rock])
      this.geometries.add(geometry);
    for (const list of grouped.values()) {
      let e = list[0];
      const add = (
        geo: THREE.BufferGeometry,
        material: THREE.Material,
        kind: string,
        lowGeo?: THREE.BufferGeometry,
      ) => {
        let mesh = new THREE.InstancedMesh(geo, material, list.length);
        mesh.castShadow = mesh.receiveShadow = true;
        if (kind === "pine" && this.world.realm !== "hell") mesh.customDepthMaterial = foliageDepth;
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        let batch: Batch = {
          mesh,
          ids: list.map((e) => e.id),
          allIds: list.map((e) => e.id),
          kind,
          x: e.p[0],
          z: e.p[2],
          radius: 0,
        };
        if (lowGeo) {
          batch.low = new THREE.InstancedMesh(lowGeo, material, list.length);
          batch.low.receiveShadow = true;
          if (kind === "pine" && this.world.realm !== "hell") batch.low.customDepthMaterial = foliageDepth;
          this.scene.add(batch.low);
        }
        list.forEach((e, i) => {
          setEntityTransform(dummy, e);
          if (kind === "pine") {
            dummy.position.y -= e.s[1];
            dummy.scale.fromArray(treeCanopyScale(e));
          }
          finishEntityTransform(dummy, e);
          mesh.setMatrixAt(i, dummy.matrix);
          batch.low?.setMatrixAt(i, dummy.matrix);
          const color =
            kind === "pine"
              ? this.world.realm === "hell" ? setDeadTreeColor(new THREE.Color(), e) : setTreeCanopyColor(new THREE.Color(), e)
              : setEntityColor(new THREE.Color(), e);
          mesh.setColorAt(i, color);
          batch.low?.setColorAt(i, color);
          let refs = this.refs.get(e.id);
          if (!refs) this.refs.set(e.id, (refs = []));
          refs.push({ batch, index: i });
        });
        mesh.computeBoundingSphere();
        batch.x = mesh.boundingSphere!.center.x;
        batch.z = mesh.boundingSphere!.center.z;
        batch.radius = mesh.boundingSphere!.radius;
        batch.low?.computeBoundingSphere();
        mesh.matrixAutoUpdate = false;
        mesh.matrixWorldAutoUpdate = false;
        if (batch.low) {
          batch.low.matrixAutoUpdate = false;
          batch.low.matrixWorldAutoUpdate = false;
        }
        this.scene.add(mesh);
        this.batches.push(batch);
      };
      if (e.visual) {
        const key = statueGeometryKey(e);
        let geo = statueGeometries.get(key);
        if (!geo) {
          geo = statueGeometry(e);
          statueGeometries.set(key, geo);
          this.geometries.add(geo);
        }
        // Neutral base material keeps authored stone and gold instance colors intact.
        const eye = statueRole(e, this.world) === "eye",
          materialKey = e.visual.color + ":" + eye + ":" + (e.visual.shape === "hero-head" || e.visual.shape === "portal-stone");
        let mat = statueMaterials.get(materialKey);
        if (!mat) {
          mat = new THREE.MeshStandardMaterial({
            color: "white",
            vertexColors: e.visual.shape === "hero-head" || e.visual.shape === "portal-stone",
            map: e.visual.shape === "portal-stone" ? this.materials.stone.map : null,
            roughness: 0.9,
            metalness: e.visual.color === "#cf9e38" ? 0.2 : 0,
            side: THREE.DoubleSide,
            emissive: eye ? "#ff1010" : "black",
            emissiveIntensity: 0,
          });
          statueMaterials.set(materialKey, mat);
          if (eye) this.eyeMaterials.add(mat);
        }
        add(geo, mat, "statue");
      } else if (e.kind === "tree") {
        const species = e.treeSpecies ?? "pine";
        if (this.world.realm === "hell") {
          add(deadGeometry(species), this.materials.foliage, "pine", deadGeometry(species, true));
          continue;
        }
        add(
          species === "pine" ? pine : crown(species),
          livingFoliage,
          "pine",
          species === "pine" ? low : crown(species, true),
        );
      } else
        add(
          e.kind === "rock" ? rock : isRoof(e.material) ? roof : this.box,
          this.materials[e.material],
          e.kind,
        );
    }
  }
  private addBanners() {
    const mat = new THREE.MeshStandardMaterial({
      color: "#bd4c42",
      side: THREE.DoubleSide,
      roughness: 0.9,
    });
    const depth = new THREE.MeshDepthMaterial({
      depthPacking: THREE.RGBADepthPacking,
      side: THREE.DoubleSide,
    });
    for (const banner of this.world.banners) {
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(banner.s[0], banner.s[1]),
        mat,
      );
      mesh.position.fromArray(banner.p);
      mesh.rotation.y = banner.yaw ?? 0;
      mesh.updateMatrix();
      mesh.matrixAutoUpdate = false;
      mesh.customDepthMaterial = depth;
      mesh.userData.owner = banner.owner;
      this.flagGroup.add(mesh);
    }
  }
  remove(id: number) {
    this.removed.add(id);
    this.approvedGod.remove(id);
    this.horizon.remove(id);
    const refs = this.refs.get(id);
    if (!refs) return;
    for (const ref of refs) {
      const batch = ref.batch,
        last = batch.ids.length - 1;
      if (ref.index !== last) {
        const moved = batch.ids[last];
        batch.ids[ref.index] = moved;
        for (const mesh of [batch.mesh, batch.low])
          if (mesh) {
            mesh.getMatrixAt(last, dummy.matrix);
            mesh.setMatrixAt(ref.index, dummy.matrix);
            if (mesh.instanceColor) {
              mesh.getColorAt(last, this.fragmentColor);
              mesh.setColorAt(ref.index, this.fragmentColor);
              mesh.instanceColor.addUpdateRange(ref.index * 3, 3);
              mesh.instanceColor.needsUpdate = true;
            }
          }
        const movedRef = this.refs.get(moved)!.find((r) => r.batch === batch)!;
        movedRef.index = ref.index;
      }
      batch.ids.pop();
      for (const mesh of [batch.mesh, batch.low])
        if (mesh) {
          mesh.count = batch.ids.length;
          mesh.instanceMatrix.addUpdateRange(ref.index * 16, 16);
          mesh.instanceMatrix.needsUpdate = true;
        }
    }
    this.refs.delete(id);
  }
  restore(removed: number[]) {
    this.removed.clear();
    this.approvedGod.restore(removed);
    this.horizon.restore([]);
    this.refs.clear();
    for (const batch of this.batches) {
      batch.ids = batch.allIds.slice();
      batch.mesh.count = batch.ids.length;
      if (batch.low) batch.low.count = batch.ids.length;
      batch.ids.forEach((id, i) => {
        let refs = this.refs.get(id);
        if (!refs) this.refs.set(id, (refs = []));
        refs.push({ batch, index: i });
        const e = this.world.entities[id];
        setEntityTransform(dummy, e);
        if (batch.kind === "pine") {
          dummy.position.y -= e.s[1];
          dummy.scale.fromArray(treeCanopyScale(e));
        }
        finishEntityTransform(dummy, e);
        batch.mesh.setMatrixAt(i, dummy.matrix);
        batch.low?.setMatrixAt(i, dummy.matrix);
        const color =
          batch.kind === "pine"
            ? setTreeCanopyColor(this.fragmentColor, e)
            : setEntityColor(this.fragmentColor, e);
        batch.mesh.setColorAt(i, color);
        batch.low?.setColorAt(i, color);
        if (batch.mesh.instanceColor)
          batch.mesh.instanceColor.needsUpdate = true;
        if (batch.low?.instanceColor)
          batch.low.instanceColor.needsUpdate = true;
        batch.mesh.instanceMatrix.needsUpdate = true;
        if (batch.low) batch.low.instanceMatrix.needsUpdate = true;
      });
    }
    for (const id of removed) this.remove(id);
  }
  setStatueReaction(state?: StatueReaction) {
    const intensity = (state?.eyeGlowRemaining ?? 0) > 0 ? 4 : 0;
    for (const material of this.eyeMaterials)
      material.emissiveIntensity = intensity;
    this.horizon.setEyeGlow(intensity);
    this.approvedGod.setEyeGlow(intensity);
  }
  update(
    camera: THREE.PerspectiveCamera,
    renderDistance: number,
    treeDistance: number,
    shadowDistance: number,
  ) {
    for (const b of this.batches) {
      let d = Math.hypot(b.x - camera.position.x, b.z - camera.position.z);
      b.mesh.castShadow = d < shadowDistance;
      if (b.low) {
        b.mesh.visible = d < treeDistance + b.radius;
        b.low.visible = !b.mesh.visible && d < renderDistance + b.radius;
      } else b.mesh.visible = d < renderDistance + b.radius;
      for (const mesh of [b.mesh, b.low])
        if (mesh) {
          if (mesh.visible && mesh.count && !mesh.parent) this.scene.add(mesh);
          else if ((!mesh.visible || !mesh.count) && mesh.parent)
            this.scene.remove(mesh);
        }
    }
    this.horizon.setView(camera.position, renderDistance);

    for (const flag of this.flagGroup.children)
      flag.visible = !this.removed.has(flag.userData.owner);
  }

  dispose(resources: ResourceDisposal) {
    for (const material of this.foliageMaterials) resources.materials.add(material);
    this.approvedGod.dispose(resources);
    for (const batch of this.batches) {
      resources.collect(batch.mesh);
      if (batch.low) resources.collect(batch.low);
      batch.mesh.removeFromParent();
      batch.low?.removeFromParent();
    }
    for (const geometry of this.geometries) resources.geometries.add(geometry);
    resources.collect(this.flagGroup);
    resources.collect(this.horizon.group);
    this.flagGroup.removeFromParent();
    this.horizon.group.removeFromParent();
    this.refs.clear();
    this.removed.clear();
    this.eyeMaterials.clear();
    this.batches.length = 0;
  }
}
