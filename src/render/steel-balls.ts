import * as THREE from "three";
import { STEEL_BALL } from "../config";
import type { SteelBallState } from "../types";

/** Growing pool of reusable models, with seams and rivets that make rotation legible. */
export class SteelBallView {
  readonly group = new THREE.Group();
  count = 0;
  private models: THREE.Group[] = [];
  private oldRotation = new THREE.Quaternion();
  private currentRotation = new THREE.Quaternion();
  private sphere: THREE.SphereGeometry;
  private seam: THREE.TorusGeometry;
  private rivet: THREE.SphereGeometry;
  constructor() {
    this.sphere = new THREE.SphereGeometry(STEEL_BALL.radius, 32, 24);
    this.seam = new THREE.TorusGeometry(
      STEEL_BALL.radius * 1.002,
      STEEL_BALL.radius * 0.008,
      6,
      64,
    );
    this.rivet = new THREE.SphereGeometry(STEEL_BALL.radius * 0.022, 6, 4);
    this.grow(1);
  }
  private grow(needed: number) {
    while (this.models.length < needed) {
      const model = new THREE.Group();
      const steel = new THREE.MeshStandardMaterial({
        color: 0x88949d,
        metalness: 0.8,
        roughness: 0.32,
        transparent: true,
      });
      const dark = new THREE.MeshStandardMaterial({
        color: 0x303a43,
        metalness: 0.65,
        roughness: 0.5,
        transparent: true,
      });
      const body = new THREE.Mesh(this.sphere, steel);
      model.add(body);
      const rings = new THREE.InstancedMesh(this.seam, dark, 3);
      const bolts = new THREE.InstancedMesh(this.rivet, dark, 12);
      const part = new THREE.Object3D();
      for (let axis = 0; axis < 3; axis++) {
        part.rotation.set(
          axis === 1 ? Math.PI / 2 : 0,
          axis === 2 ? Math.PI / 2 : 0,
          0,
        );
        part.updateMatrix();
        rings.setMatrixAt(axis, part.matrix);
      }
      part.rotation.set(0, 0, 0);
      for (let j = 0; j < 12; j++) {
        const angle = (j * Math.PI) / 6;
        part.position.set(
          Math.cos(angle) * STEEL_BALL.radius,
          Math.sin(angle) * STEEL_BALL.radius,
          0,
        );
        part.updateMatrix();
        bolts.setMatrixAt(j, part.matrix);
      }
      model.add(rings, bolts);
      model.visible = false;
      this.models.push(model);
      this.group.add(model);
    }
  }
  update(
    balls: SteelBallState[],
    previous: SteelBallState[] | undefined,
    alpha: number,
  ) {
    this.grow(balls.length);
    this.count = balls.length;
    for (let i = 0; i < this.models.length; i++) {
      const model = this.models[i],
        ball = balls[i];
      model.visible = !!ball;
      if (!ball) continue;
      const old = previous?.find((b) => b.id === ball.id);
      model.position.fromArray(ball.p);
      model.quaternion.fromArray(ball.q);
      if (old) {
        model.position.set(
          ...(ball.p.map((v, k) =>
            THREE.MathUtils.lerp(old.p[k], v, alpha),
          ) as [number, number, number]),
        );
        model.quaternion.slerpQuaternions(
          this.oldRotation.fromArray(old.q),
          this.currentRotation.fromArray(ball.q),
          alpha,
        );
      }
      const fade = old
        ? THREE.MathUtils.lerp(old.fade, ball.fade, alpha)
        : ball.fade;
      for (const child of model.children as THREE.Mesh[]) {
        const material = child.material as THREE.MeshStandardMaterial;
        material.opacity = Math.max(0, 1 - fade);
        material.depthWrite = fade <= 0;
      }
    }
  }
  reset() {
    this.count = 0;
    for (const model of this.models) model.visible = false;
  }
}
