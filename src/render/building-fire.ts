import * as THREE from "three";
import type { Entity, FirePatch, WorldData } from "../types";
import { NuclearFireView } from "./nuclear-fire";
import type { ResourceDisposal } from "./resource-disposal";

/** Every structure burns; large assemblies receive several independent fires. */
export function buildingFireSites(world: WorldData) {
  const cells = new Map<string, Entity[]>();
  for (const e of world.entities) {
    if (e.kind !== "block" || !e.assembly || e.assembly === "portal-ring" || e.visual) continue;
    const key = `${e.assembly}:${Math.floor(e.p[0] / 48)}:${Math.floor(e.p[2] / 48)}`;
    let list = cells.get(key);
    if (!list) cells.set(key, list = []);
    list.push(e);
  }
  return [...cells.values()].map((owners) => {
    owners.sort((a, b) => b.p[1] + b.s[1] - a.p[1] - a.s[1]);
    const top = owners[0];
    const patch: FirePatch = {
      id: -top.id - 1, p: [...top.p],
      radius: Math.min(18, Math.max(9, top.s[0] * 1.5)),
      height: 7, age: 0, seed: top.id * .19,
    };
    return { owners, patch };
  });
}

export class BuildingFireView {
  private sites: ReturnType<typeof buildingFireSites>;
  readonly fire: NuclearFireView;
  private frustum = new THREE.Frustum();
  private projection = new THREE.Matrix4();
  private bounds = new THREE.Sphere(new THREE.Vector3(), 110);
  constructor(world: WorldData) {
    this.sites = buildingFireSites(world);
    this.fire = new NuclearFireView({ capacity: Math.max(1, this.sites.length), flamesPerPatch: 8, smokePerPatch: 2 });
    this.fire.inverted = true;
  }
  get group() { return this.fire.group; }
  update(removed: ReadonlySet<number>, camera: THREE.PerspectiveCamera, time: number, reduced: boolean) {
    camera.updateMatrixWorld();
    this.frustum.setFromProjectionMatrix(this.projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const visible: FirePatch[] = [];
    for (const { owners, patch } of this.sites) {
      // Fire survives a roof being shot away and follows the remaining structure.
      const owner = owners.find((entity) => !removed.has(entity.id));
      if (!owner) continue;
      patch.p[0] = owner.p[0];
      patch.p[1] = owner.p[1] + owner.s[1];
      patch.p[2] = owner.p[2];
      // Cycle smoke motion without ever approaching the transient fire fade age.
      patch.age = time % (1 / .13);
      this.bounds.center.set(patch.p[0], patch.p[1] - 25, patch.p[2]);
      if (this.frustum.intersectsSphere(this.bounds)) visible.push(patch);
    }
    this.fire.update(visible, 0, reduced, time);
  }
  collectResources(resources: ResourceDisposal) { this.fire.collectResources(resources); }
}
