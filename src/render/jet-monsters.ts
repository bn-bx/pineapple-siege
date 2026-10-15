import * as THREE from "three";
import { MAX_MONSTER_COUNT, MONSTER_SCALE } from "../config";
import type { SimulationSnapshot } from "../types";
import { bakeMaterialGroups, makeInfernalJet } from "./infernal-jet";

const pose = new THREE.Object3D();
const JET_SCALE = 1.7;
export class JetMonsterView {
  readonly group = new THREE.Group();
  readonly mesh: THREE.InstancedMesh;
  private batches: THREE.InstancedMesh[];
  constructor() {
    this.batches = bakeMaterialGroups(makeInfernalJet()).map(({ geometry, material }) => {
      const mesh = new THREE.InstancedMesh(geometry, material, MAX_MONSTER_COUNT);
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      this.group.add(mesh);
      return mesh;
    });
    this.mesh = this.batches[0];
  }
  update(snapshot: SimulationSnapshot, previous: SimulationSnapshot | undefined, alpha: number) {
    let count = 0;
    for (const m of snapshot.monsters) {
      if (m.defeated || m.cleared || count >= MAX_MONSTER_COUNT) continue;
      const old = previous?.monsters[m.id];
      pose.position.set(
        old ? THREE.MathUtils.lerp(old.p[0], m.p[0], alpha) : m.p[0],
        (old ? THREE.MathUtils.lerp(old.p[1], m.p[1], alpha) : m.p[1]) + 14 * MONSTER_SCALE,
        old ? THREE.MathUtils.lerp(old.p[2], m.p[2], alpha) : m.p[2],
      );
      // Tail against the terrain, nose away from it. Yaw turns around the upright
      // body; in hell the terrain is the ceiling and the jets hang beneath it.
      pose.rotation.set(-Math.PI / 2 + (m.windup > 0 ? -.08 : 0), m.yaw,
        m.stagger > 0 ? Math.sin(m.stagger * 16) * .09 : 0, "YXZ");
      pose.scale.setScalar(JET_SCALE * (m.stagger > 0 ? 1.08 : 1));
      pose.updateMatrix();
      for (const mesh of this.batches) mesh.setMatrixAt(count, pose.matrix);
      count++;
    }
    for (const mesh of this.batches) {
      mesh.count = count;
      mesh.instanceMatrix.clearUpdateRanges();
      if (count) mesh.instanceMatrix.addUpdateRange(0, count * 16);
      mesh.instanceMatrix.needsUpdate = true;
    }
  }
}
