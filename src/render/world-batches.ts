import * as THREE from "three";
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
  readonly batches: Batch[] = [];
  readonly refs = new Map<number, { batch: Batch; index: number }[]>();
  readonly removed = new Set<number>();
  readonly flagGroup = new THREE.Group();
  readonly horizon: IslandHorizon;
  private fragmentColor = new THREE.Color();
  private box = new THREE.BoxGeometry(2, 2, 2);
  private roof = roofGeometry();
  private geometries = new Set<THREE.BufferGeometry>([this.box, this.roof]);
  constructor(
    private scene: THREE.Scene,
    readonly world: WorldData,
    private materials: Record<Material, THREE.MeshStandardMaterial>,
  ) {
    this.buildBatches();
    this.addBanners();
    this.scene.add(this.flagGroup);
    this.horizon = new IslandHorizon(world, this.batches, materials);
    this.scene.add(this.horizon.group);
  }
  private crownGeometry(species: "pine" | "broadleaf" | "riverside") {
    return treeCrownGeometry(species);
  }
  private buildBatches() {
    const grouped = new Map<string, Entity[]>();
    for (const e of this.world.entities) {
      // Larger construction batches reduce CPU draw submission while retaining
      // spatial bounds, owner lookup and the original collision entities.
      // Match construction to the existing forest/rock spatial grid. Fewer
      // material batches reduce submission work; owner references and the
      // batch-derived distant-coverage boundary are rebuilt together.
      const size = 512;
      const cell = `${Math.floor(e.p[0] / size)},${Math.floor(e.p[2] / size)}`;
      const key = e.kind + e.material + (e.treeSpecies ?? "pine") + cell;
      if (e.kind === "tree") {
        const trunkKey = "trunk" + cell;
        let trunks = grouped.get(trunkKey);
        if (!trunks) grouped.set(trunkKey, (trunks = []));
        trunks.push(e);
      }
      let list = grouped.get(key);
      if (!list) grouped.set(key, (list = []));
      list.push(e);
    }
    const pine = pineGeometry(),
      low = new THREE.ConeGeometry(1, 1, 7, 1);
    low.translate(0, 0.5, 0);
    const roof = this.roof;
    const trunk = new THREE.CylinderGeometry(0.8, 1, 1, 6),
      rock = new THREE.DodecahedronGeometry(1, 0);
    for (const geometry of [pine, low, trunk, rock])
      this.geometries.add(geometry);
    for (const [groupKey, list] of grouped) {
      let e = list[0];
      const add = (
        geo: THREE.BufferGeometry,
        material: THREE.Material,
        kind: string,
        lowGeo?: THREE.BufferGeometry,
      ) => {
        let mesh = new THREE.InstancedMesh(geo, material, list.length);
        mesh.castShadow = mesh.receiveShadow = true;
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
          this.scene.add(batch.low);
        }
        list.forEach((e, i) => {
          dummy.position.fromArray(e.p);
          dummy.rotation.set(0, e.kind === "block" ? 0 : e.variant * 6.28, 0);
          dummy.scale.fromArray(e.s);
          if (kind === "pine") {
            dummy.position.y -= e.s[1];
            dummy.scale.fromArray(treeCanopyScale(e));
          }
          if (kind === "trunk") {
            dummy.position.y -= e.s[1] * 0.4;
            dummy.scale.set(0.65, e.s[1] * 1.2, 0.65);
          }
          dummy.updateMatrix();
          mesh.setMatrixAt(i, dummy.matrix);
          batch.low?.setMatrixAt(i, dummy.matrix);
          const color =
            kind === "pine"
              ? setTreeCanopyColor(new THREE.Color(), e)
              : new THREE.Color().setHSL(0.12, 0.06, 0.77 + e.variant * 0.16);
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
      if (groupKey.startsWith("trunk")) {
        add(trunk, this.materials.wood, "trunk");
        continue;
      }
      if (e.kind === "tree") {
        const species = e.treeSpecies ?? "pine";
        add(
          species === "pine" ? pine : this.crownGeometry(species),
          this.materials.foliage,
          "pine",
          species === "pine" ? low : treeCrownLowGeometry(species),
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
        dummy.position.fromArray(e.p);
        dummy.rotation.set(0, e.kind === "block" ? 0 : e.variant * 6.28, 0);
        dummy.scale.fromArray(e.s);
        if (batch.kind === "pine") {
          dummy.position.y -= e.s[1];
          dummy.scale.fromArray(treeCanopyScale(e));
        }
        if (batch.kind === "trunk") {
          dummy.position.y -= e.s[1] * 0.4;
          dummy.scale.set(0.65, e.s[1] * 1.2, 0.65);
        }
        dummy.updateMatrix();
        batch.mesh.setMatrixAt(i, dummy.matrix);
        batch.low?.setMatrixAt(i, dummy.matrix);
        const color =
          batch.kind === "pine"
            ? setTreeCanopyColor(this.fragmentColor, e)
            : this.fragmentColor.setHSL(0.12, 0.06, 0.77 + e.variant * 0.16);
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
      } else if (b.kind === "trunk")
        b.mesh.visible = d < Math.min(700, renderDistance + 90);
      else b.mesh.visible = d < renderDistance + b.radius;
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
    this.batches.length = 0;
  }
}
