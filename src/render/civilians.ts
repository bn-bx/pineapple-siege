import * as THREE from "three";
import { DEFAULT_RENDER_DISTANCE } from "../config";
import type { SimulationSnapshot } from "../types";

/** Shared geometry and instanced parts keep the whole population inexpensive. */
export class CivilianView {
  readonly group = new THREE.Group();
  private parts: THREE.InstancedMesh[];
  private dummy = new THREE.Object3D();
  private root = new THREE.Object3D();
  constructor(count: number) {
    const cloth = new THREE.MeshStandardMaterial({ roughness: 0.9 });
    const skin = new THREE.MeshStandardMaterial({
      color: 0xe9bd87,
      roughness: 0.9,
    });
    const dark = new THREE.MeshStandardMaterial({
      color: 0x34302c,
      roughness: 0.9,
    });
    const box = new THREE.BoxGeometry(1, 1, 1);
    const sphere = new THREE.SphereGeometry(1, 8, 6);
    this.parts = [
      new THREE.InstancedMesh(box, cloth, count),
      new THREE.InstancedMesh(sphere, skin, count),
      new THREE.InstancedMesh(box, cloth, count),
      new THREE.InstancedMesh(box, cloth, count),
      new THREE.InstancedMesh(box, dark, count),
      new THREE.InstancedMesh(box, dark, count),
      new THREE.InstancedMesh(sphere, dark, count * 2),
    ];
    const colors = [0xe2ac4a, 0x67a5b9, 0x9670b3, 0xc97462, 0x73a16e];
    for (let i = 0; i < count; i++)
      for (const k of [0, 2, 3])
        this.parts[k].setColorAt(i, new THREE.Color(colors[i % colors.length]));
    for (const mesh of this.parts) {
      mesh.count = 0;
      mesh.castShadow = true;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(mesh);
    }
  }
  update(
    snap: SimulationSnapshot,
    previous: SimulationSnapshot | undefined,
    alpha: number,
    camera: THREE.Vector3,
    renderDistance = DEFAULT_RENDER_DISTANCE,
  ) {
    let n = 0;
    for (const c of snap.civilians ?? []) {
      if (
        !c.alive ||
        Math.hypot(c.p[0] - camera.x, c.p[2] - camera.z) > renderDistance
      )
        continue;
      const old = previous?.civilians?.[c.id];
      const p = old?.alive
        ? old.p.map((v, k) => THREE.MathUtils.lerp(v, c.p[k], alpha))
        : c.p;
      const phase = old?.alive
        ? THREE.MathUtils.lerp(old.phase, c.phase, alpha)
        : c.phase;
      const cheer = c.mood === "cheer",
        sad = c.mood === "sad",
        flee = c.mood === "flee";
      const walk = c.mood === "walk" || flee;
      const stride = walk ? Math.sin(phase * 2) * (flee ? 0.65 : 0.35) : 0;
      this.root.position.set(
        p[0],
        p[1] +
          (cheer ? Math.max(0, Math.sin(phase * 3 + c.id * 0.4)) * 0.8 : 0),
        p[2],
      );
      this.root.rotation.set(sad ? 0.15 : 0, c.yaw, 0);
      this.root.updateMatrix();
      const place = (
        part: number,
        index: number,
        x: number,
        y: number,
        z: number,
        sx: number,
        sy: number,
        sz: number,
        rx = 0,
        rz = 0,
      ) => {
        this.dummy.position.set(x, y, z);
        this.dummy.scale.set(sx, sy, sz);
        this.dummy.rotation.set(rx, 0, rz);
        this.dummy.updateMatrix();
        this.parts[part].setMatrixAt(
          index,
          this.dummy.matrix.premultiply(this.root.matrix),
        );
      };
      place(0, n, 0, 2.55, 0, 1.65, 1.85, 0.9);
      place(
        1,
        n,
        0,
        sad ? 3.75 : 4.05,
        sad ? 0.3 : 0,
        0.85,
        0.9,
        0.8,
        sad ? 0.3 : 0,
      );
      place(
        2,
        n,
        -1.08,
        cheer ? 3.15 : 2.55,
        0,
        0.5,
        1.7,
        0.6,
        sad ? -0.2 : stride,
        cheer ? -0.65 : 0,
      );
      place(
        3,
        n,
        1.08,
        cheer ? 3.15 : 2.55,
        0,
        0.5,
        1.7,
        0.6,
        sad ? -0.2 : -stride,
        cheer ? 0.65 : 0,
      );
      // Raised forearms make the cheering silhouette readable from flight height.
      if (cheer) {
        place(
          2,
          n,
          -1.35,
          3.95,
          0,
          0.5,
          2.1,
          0.6,
          0,
          0.35 + Math.sin(phase * 3) * 0.12,
        );
        place(
          3,
          n,
          1.35,
          3.95,
          0,
          0.5,
          2.1,
          0.6,
          0,
          -0.35 - Math.sin(phase * 3) * 0.12,
        );
      }
      place(4, n, -0.45, 0.9, 0, 0.55, 1.8, 0.65, stride);
      place(5, n, 0.45, 0.9, 0, 0.55, 1.8, 0.65, -stride);
      place(
        6,
        n * 2,
        -0.28,
        sad ? 3.87 : 4.22,
        sad ? 0.96 : 0.73,
        0.1,
        0.12,
        0.1,
      );
      place(
        6,
        n * 2 + 1,
        0.28,
        sad ? 3.87 : 4.22,
        sad ? 0.96 : 0.73,
        0.1,
        0.12,
        0.1,
      );
      n++;
    }
    for (let k = 0; k < this.parts.length; k++) {
      const mesh = this.parts[k];
      mesh.count = k === 6 ? n * 2 : n;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceMatrix.clearUpdateRanges();
      mesh.instanceMatrix.addUpdateRange(0, mesh.count * 16);
    }
  }
  reset() {
    for (const mesh of this.parts) mesh.count = 0;
  }
}
