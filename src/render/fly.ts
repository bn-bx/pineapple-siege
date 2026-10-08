import * as THREE from "three";
import type { SimulationSnapshot } from "../types";
import { FLY_COUNT } from "../config";

const turn = (a: number, b: number, alpha: number) =>
  a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * alpha;

/** Shared geometry/materials for the small fixed population of giant houseflies. */
export class FlyView {
  readonly group = new THREE.Group();
  readonly models: THREE.Group[] = [];
  private wings: THREE.Group[][] = [];
  private sphere = new THREE.SphereGeometry(1, 12, 8);
  private leg = new THREE.CylinderGeometry(0.3, 0.45, 1, 5);
  private wing = new THREE.CircleGeometry(1, 16).rotateX(-Math.PI / 2);
  private body = new THREE.MeshStandardMaterial({
    color: "#253334",
    roughness: 0.66,
    metalness: 0.28,
  });
  private stripe = new THREE.MeshStandardMaterial({
    color: "#58605a",
    roughness: 0.75,
  });
  private eye = new THREE.MeshStandardMaterial({
    color: "#b52c24",
    roughness: 0.4,
    metalness: 0.18,
  });
  private membrane = new THREE.MeshStandardMaterial({
    color: "#bfd9d5",
    transparent: true,
    opacity: 0.42,
    side: THREE.DoubleSide,
    depthWrite: false,
    roughness: 0.25,
  });
  constructor() {
    this.group.name = "giant-flies";
    for (let id = 0; id < FLY_COUNT; id++) {
      const model = new THREE.Group();
      model.name = `giant-fly-${id}`;
      const add = (
        geometry: THREE.BufferGeometry,
        material: THREE.Material,
        p: number[],
        scale: number[],
      ) => {
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(p[0], p[1], p[2]);
        mesh.scale.set(scale[0], scale[1], scale[2]);
        mesh.castShadow = material !== this.membrane;
        model.add(mesh);
        return mesh;
      };
      add(this.sphere, this.body, [0, 0, -7], [7, 6, 14]);
      add(this.sphere, this.stripe, [0, 0, 5], [8, 7, 8]);
      add(this.sphere, this.body, [0, 1, 14], [6, 5.5, 7]);
      for (const side of [-1, 1]) {
        add(this.sphere, this.eye, [side * 4.4, 2, 16], [3.4, 4.3, 4.2]);
        const antenna = add(
          this.leg,
          this.body,
          [side * 2.2, 4, 21],
          [0.65, 4, 0.65],
        );
        antenna.rotation.x = -0.8;
        for (let leg = 0; leg < 3; leg++) {
          const root = new THREE.Vector3(side * 5, -3, 7 - leg * 7),
            knee = new THREE.Vector3(side * 11, -8, 10 - leg * 9),
            foot = new THREE.Vector3(side * 13, -12, 13 - leg * 11);
          for (const [a, b] of [
            [root, knee],
            [knee, foot],
          ]) {
            const delta = b.clone().sub(a),
              center = a.clone().add(b).multiplyScalar(0.5);
            const mesh = add(this.leg, this.body, center.toArray(), [
              1,
              delta.length(),
              1,
            ]);
            mesh.quaternion.setFromUnitVectors(
              new THREE.Vector3(0, 1, 0),
              delta.normalize(),
            );
          }
        }
      }
      const wings: THREE.Group[] = [];
      for (const side of [-1, 1]) {
        const hinge = new THREE.Group();
        hinge.name = side < 0 ? "left-wing" : "right-wing";
        hinge.position.set(side * 4, 5, 3);
        const membrane = new THREE.Mesh(this.wing, this.membrane);
        membrane.position.set(side * 7, 0, -4);
        membrane.scale.set(8, 1, 12);
        membrane.rotation.y = side * 0.25;
        hinge.add(membrane);
        // Thin veins make the translucent wings readable against sky and terrain.
        for (let vein = 0; vein < 3; vein++) {
          const mesh = new THREE.Mesh(this.leg, this.stripe);
          mesh.position.set(side * (5 + vein * 2), 0.05, -3);
          mesh.scale.set(0.18, 20 - vein * 3, 0.18);
          mesh.rotation.x = Math.PI / 2;
          mesh.rotation.z = side * (0.1 + vein * 0.2);
          hinge.add(mesh);
        }
        model.add(hinge);
        wings.push(hinge);
      }
      model.visible = false;
      this.group.add(model);
      this.models.push(model);
      this.wings.push(wings);
    }
  }
  reset() {
    for (const model of this.models) model.visible = false;
  }
  update(
    snap: SimulationSnapshot,
    previous: SimulationSnapshot | undefined,
    alpha: number,
    camera: THREE.Vector3,
    distance: number,
  ) {
    for (let id = 0; id < this.models.length; id++) {
      const model = this.models[id],
        f = snap.flies?.[id],
        old = previous?.flies?.[id] ?? f;
      model.visible =
        !!f &&
        f.deathAge < 4 &&
        new THREE.Vector3(...f.p).distanceToSquared(camera) <
          (distance + 50) ** 2;
      if (!f || !old || !model.visible) continue;
      model.position.set(
        ...(f.p.map((v, i) => THREE.MathUtils.lerp(old.p[i], v, alpha)) as [
          number,
          number,
          number,
        ]),
      );
      const yaw = turn(old.yaw, f.yaw, alpha),
        pitch = turn(old.pitch, f.pitch, alpha),
        roll = turn(old.roll, f.roll, alpha);
      const windup = f.mode === "windup" ? 1 - f.timer / 0.6 : 0;
      model.rotation.set(
        -pitch + Math.sin(windup * Math.PI) * 0.3,
        yaw,
        roll,
        "YXZ",
      );
      const scale = f.defeated
        ? Math.min(
            1,
            Math.max(
              0,
              4 - THREE.MathUtils.lerp(old.deathAge, f.deathAge, alpha),
            ),
          )
        : 1;
      model.scale.setScalar(scale);
      const phase = THREE.MathUtils.lerp(old.phase, f.phase, alpha);
      for (let side = 0; side < 2; side++)
        this.wings[id][side].rotation.z =
          (side === 0 ? -1 : 1) *
          (f.defeated ? 0.6 : Math.sin(phase) * (0.45 + windup * 0.3));
    }
  }
}
