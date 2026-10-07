import * as THREE from "three";
import type { WorldData } from "../types";
import type { TerrainView } from "./terrain-view";

export interface HarborLadderPlacement {
  owner: number;
  alongX: boolean;
  direction: number;
  x: number;
  y: number;
  z: number;
  height: number;
}

/** Find the outer, water-facing end of each dock and its real water surface. */
export function harborLadderPlacements(
  world: WorldData,
  waterSurface: (x: number, z: number) => number | undefined,
): HarborLadderPlacement[] {
  const placements: HarborLadderPlacement[] = [];
  for (const site of world.sites.filter((entry) => entry.kind === "harbor")) {
    const assembly = `${site.id}-dock`;
    const decks = world.entities.filter(
      (entity) =>
        entity.kind === "block" &&
        entity.material === "wood" &&
        entity.assembly === assembly &&
        entity.s[1] <= 0.8 &&
        Math.min(entity.s[0], entity.s[2]) >= 1.8 &&
        Math.max(entity.s[0], entity.s[2]) >= 4.5,
    );
    if (decks.length < 2) continue;
    const xSpan = Math.max(...decks.map((part) => part.p[0])) -
        Math.min(...decks.map((part) => part.p[0])),
      zSpan = Math.max(...decks.map((part) => part.p[2])) -
        Math.min(...decks.map((part) => part.p[2])),
      alongX = xSpan >= zSpan,
      axis = alongX ? 0 : 2,
      shore = site.p[axis],
      ordered = decks.slice().sort((a, b) => a.p[axis] - b.p[axis]),
      first = ordered[0],
      last = ordered.at(-1)!,
      deck = Math.abs(first.p[axis] - shore) > Math.abs(last.p[axis] - shore)
        ? first
        : last,
      direction = Math.sign(deck.p[axis] - shore);
    if (!direction) continue;

    const endX = deck.p[0] + (alongX ? direction * deck.s[0] : 0),
      endZ = deck.p[2] + (!alongX ? direction * deck.s[2] : 0);
    let surface: number | undefined,
      offset = 0,
      crossOffset = 0;
    // Check only the terminal deck and its immediate edge. A more distant
    // water sample would make a ladder hang over dry ground.
    for (let distance = 0; distance <= 1.5 && surface === undefined; distance += 0.5)
      for (const cross of [0, -0.7, 0.7]) {
        const x = endX + (alongX ? distance * direction : cross),
          z = endZ + (!alongX ? distance * direction : cross),
          candidate = waterSurface(x, z);
        if (candidate !== undefined) {
          surface = candidate;
          offset = distance;
          crossOffset = cross;
          break;
        }
      }
    if (surface === undefined) continue;

    const top = deck.p[1] + deck.s[1],
      bottom = surface + 0.22,
      height = top - bottom;
    if (height < 1.1 || height > 14) continue;
    placements.push({
      owner: deck.id,
      alongX,
      direction,
      x: endX + (alongX ? offset * direction : crossOffset),
      y: (top + bottom) / 2,
      z: endZ + (!alongX ? offset * direction : crossOffset),
      height,
    });
  }
  return placements;
}

/** Two batched ladders connect generated harbor decks to their actual waterline. */
export class HarborLadders {
  readonly group = new THREE.Group();
  private readonly geometry = new THREE.BoxGeometry(1, 1, 1);
  private readonly material: THREE.MeshStandardMaterial;
  private readonly rungMaterial = new THREE.MeshStandardMaterial({
    color: "#777568",
    metalness: 0.48,
    roughness: 0.72,
  });
  private entries: {
    owner: number;
    meshes: THREE.InstancedMesh[];
    p: THREE.Vector3;
  }[] = [];

  constructor(
    private readonly world: WorldData,
    private readonly terrain: TerrainView,
    timber: THREE.MeshStandardMaterial,
  ) {
    this.group.name = "harbor-water-access";
    this.material = timber.clone();
    this.material.color.multiplyScalar(0.58);
  }

  /** Called after the generated flood mask is restored or a test world loads. */
  refresh() {
    for (const entry of this.entries) {
      for (const mesh of entry.meshes) {
        this.group.remove(mesh);
        mesh.dispose();
      }
    }
    this.entries = [];
    const placements = harborLadderPlacements(this.world, (x, z) =>
      this.terrain.waterSurface(x, z),
    );
    const piece = new THREE.Object3D();
    for (const placement of placements) {
      const top = placement.y + placement.height / 2,
        bottom = placement.y - placement.height / 2,
        face = placement.alongX
          ? placement.x + placement.direction * 0.55
          : placement.z + placement.direction * 0.55,
        rails: {
          x: number;
          y: number;
          z: number;
          sx: number;
          sy: number;
          sz: number;
          atFace: boolean;
        }[] = [];
      for (const cross of [-0.46, 0.46]) {
        rails.push({
          x: placement.x + (placement.alongX ? 0 : cross),
          y: placement.y,
          z: placement.z + (placement.alongX ? cross : 0),
          sx: 0.14,
          sy: placement.height + 0.38,
          sz: 0.14,
          atFace: true,
        });
        rails.push({
          x: placement.x + (placement.alongX ? placement.direction * 0.25 : cross),
          y: top - 0.22,
          z: placement.z + (placement.alongX ? cross : placement.direction * 0.25),
          sx: placement.alongX ? 0.72 : 0.14,
          sy: 0.14,
          sz: placement.alongX ? 0.14 : 0.72,
          atFace: false,
        });
      }
      const rungs: {
        x: number;
        y: number;
        z: number;
        sx: number;
        sy: number;
        sz: number;
        atFace: boolean;
      }[] = [];
      for (let y = bottom + 0.35; y < top - 0.1; y += 0.46)
        rungs.push({
          x: placement.x,
          y,
          z: placement.z,
          sx: placement.alongX ? 0.14 : 0.92,
          sy: 0.14,
          sz: placement.alongX ? 0.92 : 0.14,
          atFace: true,
        });

      const makeBatch = (
        name: string,
        material: THREE.Material,
        parts: typeof rails,
      ) => {
        const mesh = new THREE.InstancedMesh(
          this.geometry,
          material,
          parts.length,
        );
        mesh.name = `${name}:${placement.owner}`;
        mesh.castShadow = mesh.receiveShadow = true;
        mesh.frustumCulled = false;
        parts.forEach((part, index) => {
          piece.position.set(part.x, part.y, part.z);
          if (part.atFace) {
            if (placement.alongX) piece.position.x = face;
            else piece.position.z = face;
          }
          piece.scale.set(part.sx, part.sy, part.sz);
          piece.updateMatrix();
          mesh.setMatrixAt(index, piece.matrix);
        });
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
        mesh.userData.owner = placement.owner;
        this.group.add(mesh);
        return mesh;
      };
      const meshes = [
        makeBatch("harbor-ladder-rails", this.material, rails),
        makeBatch("harbor-ladder-rungs", this.rungMaterial, rungs),
      ];
      this.entries.push({
        owner: placement.owner,
        meshes,
        p: new THREE.Vector3(placement.x, placement.y, placement.z),
      });
    }
  }

  update(camera: THREE.Vector3, removed: Set<number>, distance: number) {
    const limit = distance * distance;
    for (const entry of this.entries)
      for (const mesh of entry.meshes)
        mesh.visible =
          !removed.has(entry.owner) &&
          camera.distanceToSquared(entry.p) <= limit;
  }

  dispose() {
    for (const entry of this.entries)
      for (const mesh of entry.meshes) mesh.dispose();
    this.entries = [];
    this.group.clear();
    this.geometry.dispose();
    this.material.dispose();
    this.rungMaterial.dispose();
  }
}
