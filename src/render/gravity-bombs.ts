import * as THREE from "three";
import { GRAVITY_BOMB as G } from "../config";
import type { GravityBombState } from "../types";
import { gravityRadius } from "../sim/gravity-bombs";

/** Bounded reusable models; Actors owns and disposes every GPU resource. */
export class GravityBombView {
  readonly group = new THREE.Group();
  count = 0;
  private models: {
    group: THREE.Group;
    core: THREE.Mesh;
    rings: THREE.Mesh[];
    trails: THREE.LineSegments;
    wave: THREE.Mesh;
  }[] = [];
  private coreGeometry = new THREE.IcosahedronGeometry(1, 2);
  private ringGeometry = new THREE.TorusGeometry(1, 0.035, 6, 64);
  private waveGeometry = new THREE.SphereGeometry(1, 24, 12);
  constructor() {
    this.grow();
    this.reset();
  }
  private grow() {
    const group = new THREE.Group();
    const core = new THREE.Mesh(
      this.coreGeometry,
      new THREE.MeshBasicMaterial({ color: 0x100c22 }),
    );
    const rings = [0x9855ff, 0x55edff, 0xa56cff].map((color) => {
      const mesh = new THREE.Mesh(
        this.ringGeometry,
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.9,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          // Additive glow would add haze colour if fogged.
          fog: false,
        }),
      );
      group.add(mesh);
      return mesh;
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(48 * 2 * 3), 3),
    );
    const trails = new THREE.LineSegments(
      geometry,
      new THREE.LineBasicMaterial({
        color: 0x77dfff,
        transparent: true,
        opacity: 0.65,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        // Additive glow would add haze colour if fogged.
        fog: false,
      }),
    );
    trails.frustumCulled = false;
    const wave = new THREE.Mesh(
      this.waveGeometry,
      new THREE.MeshBasicMaterial({
        color: 0xb486ff,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        wireframe: true,
        blending: THREE.AdditiveBlending,
        // Additive glow would add haze colour if fogged.
        fog: false,
      }),
    );
    group.add(core, trails, wave);
    this.group.add(group);
    this.models.push({ group, core, rings, trails, wave });
  }
  update(
    bombs: GravityBombState[],
    previous: GravityBombState[] | undefined,
    alpha: number,
  ) {
    this.count = Math.min(bombs.length, G.maxActive);
    while (this.models.length < this.count) this.grow();
    for (let i = 0; i < this.models.length; i++) {
      const model = this.models[i],
        bomb = bombs[i];
      model.group.visible = i < this.count;
      if (!model.group.visible) continue;
      const old = previous?.find(
        (b) => b.id === bomb.id && b.phase === bomb.phase,
      );
      model.group.position.fromArray(bomb.p);
      if (old)
        model.group.position.lerpVectors(
          new THREE.Vector3(...old.p),
          model.group.position,
          alpha,
        );
      const age = old
        ? THREE.MathUtils.lerp(old.age, bomb.age, alpha)
        : bomb.age;
      const falling = bomb.phase === "falling",
        bursting = bomb.phase === "bursting";
      const progress = Math.min(1, age / G.burstSeconds),
        fade = bursting ? 1 - progress : 1;
      const coreSize = falling
        ? G.capsuleRadius
        : 9 + Math.min(1, age / G.pullSeconds) * 8;
      model.core.scale.setScalar(coreSize * fade);
      for (let j = 0; j < model.rings.length; j++) {
        const ring = model.rings[j];
        ring.scale.setScalar((coreSize + 8 + j * 15) * fade);
        ring.rotation.set(
          age * (0.7 + j * 0.3) + j,
          age * (1.2 - j * 0.2),
          age * 0.9 + j,
        );
      }
      model.trails.visible = !falling && !bursting;
      if (model.trails.visible) {
        const positions = model.trails.geometry.getAttribute(
          "position",
        ) as THREE.BufferAttribute;
        const radius = gravityRadius({ ...bomb, age });
        for (let trail = 0; trail < 48; trail++) {
          const theta = trail * 2.399963 + age * 0.55;
          const elevation = Math.sin(trail * 1.7) * 0.55;
          const cycle = (trail / 48 + age * 0.45) % 1;
          for (let end = 0; end < 2; end++) {
            const r =
              coreSize +
              (radius - coreSize) * Math.max(0, 1 - cycle - end * 0.06);
            positions.setXYZ(
              trail * 2 + end,
              Math.cos(theta) * r,
              elevation * r,
              Math.sin(theta) * r,
            );
          }
        }
        positions.needsUpdate = true;
      }
      model.wave.visible = bursting;
      model.wave.scale.setScalar(10 + G.radius * progress);
      (model.wave.material as THREE.MeshBasicMaterial).opacity = fade * 0.5;
    }
  }
  reset() {
    this.count = 0;
    for (const model of this.models) model.group.visible = false;
  }
}
