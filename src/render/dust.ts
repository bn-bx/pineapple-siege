import * as THREE from "three";
import type { Explosion, FragmentEffect, Material } from "../types";

export function impactTint(material: Material | "water"): string {
  return material === "water"
    ? "#bad7d4"
    : material === "wood"
      ? "#9d7953"
      : material === "foliage"
        ? "#7b8453"
        : material === "earth"
          ? "#a18a68"
          : material === "roof"
            ? "#a87965"
            : material === "slate"
              ? "#8a9193"
              : material === "sandstone"
                ? "#c4b495"
                : "#adb0aa";
}

/** Fixed, shared pool. These plumes never change damage or saved world data. */
export class GroundDust {
  readonly mesh: THREE.InstancedMesh<
    THREE.PlaneGeometry,
    THREE.MeshBasicMaterial
  >;
  private capacity = 256;
  private next = 0;
  private active = new Set<number>();
  private p = new Float32Array(this.capacity * 3);
  private age = new Float32Array(this.capacity).fill(100);
  private duration = new Float32Array(this.capacity);
  private size = new Float32Array(this.capacity);
  private angle = new Float32Array(this.capacity);
  // 0 = terrain-following dust, 1 = impact at a wall/airborne surface, 2 = water.
  private anchor = new Uint8Array(this.capacity);
  private animation = new Float32Array(this.capacity * 2);
  private dummy = new THREE.Object3D();
  private rotation = new THREE.Quaternion();
  private axis = new THREE.Vector3(0, 0, 1);
  private tint = new THREE.Color();
  private fallback: THREE.Texture;
  constructor() {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 64;
    const c = canvas.getContext("2d")!,
      g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, "rgba(255,255,255,.3)");
    g.addColorStop(0.5, "rgba(255,255,255,.16)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    c.fillStyle = g;
    c.fillRect(0, 0, 64, 64);
    this.fallback = new THREE.CanvasTexture(canvas);
    this.mesh = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        map: this.fallback,
        color: "#ffffff",
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        opacity: 0.42,
      }),
      this.capacity,
    );
    this.mesh.geometry.setAttribute(
      "puffAnimation",
      new THREE.InstancedBufferAttribute(this.animation, 2).setUsage(
        THREE.DynamicDrawUsage,
      ),
    );
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < this.capacity; i++)
      this.mesh.setColorAt(i, this.tint.set("#a18a68"));
    this.mesh.instanceColor!.setUsage(THREE.DynamicDrawUsage);
    this.reset();
  }
  installAtlas(texture: THREE.Texture) {
    this.mesh.material.map = texture;
    this.fallback.dispose();
    this.mesh.material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          "#include <common>\nattribute vec2 puffAnimation;varying vec2 vPuffAnimation;varying vec2 vPuffUv;",
        )
        .replace(
          "#include <begin_vertex>",
          "#include <begin_vertex>\nvPuffAnimation=puffAnimation;vPuffUv=uv;",
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          `#include <common>
          varying vec2 vPuffAnimation;varying vec2 vPuffUv;
          vec2 puffUv(float frame){vec2 cell=vec2(mod(frame,5.),floor(frame/5.));return (cell+(vec2(4.)+vPuffUv*248.)/256.)/5.;}`,
        )
        .replace(
          "#include <map_fragment>",
          `
          float frame=vPuffAnimation.y+vPuffAnimation.x*3.;
          vec4 first=texture2D(map,puffUv(mod(floor(frame),25.)));
          vec4 second=texture2D(map,puffUv(mod(floor(frame)+1.,25.)));
          diffuseColor*=mix(first,second,smoothstep(0.,1.,fract(frame)));
          diffuseColor.a*=sin(clamp(vPuffAnimation.x,0.,1.)*3.14159265);`,
        );
    };
    this.mesh.material.customProgramCacheKey = () => "animated-puff-atlas-v1";
    this.mesh.material.needsUpdate = true;
  }
  private spawn(
    p: number[],
    material: Material | "water",
    seed: number,
    size: number,
    duration: number,
    anchor: number,
  ) {
    const i = this.next++ % this.capacity;
    this.active.add(i);
    this.mesh.visible = true;
    this.p.set(p, i * 3);
    this.age[i] = 0;
    this.duration[i] = duration;
    this.size[i] = size;
    this.angle[i] = seed * 2.399963;
    this.anchor[i] = anchor;
    this.animation[i * 2] = 0;
    this.animation[i * 2 + 1] = Math.abs(Math.floor(seed * 17)) % 25;
    this.mesh.setColorAt(i, this.tint.set(impactTint(material)));
    this.mesh.instanceColor!.needsUpdate = true;
  }
  impact(e: FragmentEffect, reduced: boolean, scale: number) {
    const count = Math.min(
      reduced ? 2 : 6,
      Math.max(1, Math.ceil((e.count * scale) / 8)),
    );
    for (let i = 0; i < count; i++) {
      const a = (e.seed + i) * 2.399963;
      this.spawn(
        [e.p[0] + Math.sin(a) * 0.4, e.p[1], e.p[2] + Math.cos(a) * 0.4],
        e.material,
        e.seed + i,
        1.8 + Math.min(4, e.speed * 0.12),
        1.4 + i * 0.15,
        1,
      );
    }
  }
  emit(
    e: Explosion,
    reduced: boolean,
    ground: (x: number, z: number) => number,
  ) {
    if (e.kind === "impact") {
      this.spawn(
        e.water ? [e.p[0], Math.max(0, e.p[1]), e.p[2]] : e.p,
        e.water ? "water" : "earth",
        e.seed,
        e.water ? 4 : 2,
        1.1,
        e.water ? 2 : 1,
      );
      return;
    }
    const radius = e.profile?.craterRadius || 14;
    if (!e.water && e.p[1] - ground(e.p[0], e.p[2]) > radius) return;
    const count = reduced ? 8 : e.kind === "nuke" ? 64 : 20;
    for (let j = 0; j < count; j++) {
      const angle = j * 2.399963 + e.seed,
        r = Math.sqrt((j + 0.5) / count) * radius,
        x = e.p[0] + Math.cos(angle) * r,
        z = e.p[2] + Math.sin(angle) * r;
      this.spawn(
        [x, e.water ? Math.max(0, e.p[1]) : ground(x, z) + 2, z],
        e.water ? "water" : "earth",
        e.seed + j,
        Math.min(24, 5 + radius * 0.12),
        e.water ? 2.5 : 8 + (j % 8),
        e.water ? 2 : 0,
      );
    }
  }
  update(
    dt: number,
    camera: THREE.Camera,
    ground: (x: number, z: number) => number,
  ) {
    if (!this.active.size) return;
    for (const i of this.active) {
      this.age[i] += dt;
      const t = this.age[i] / this.duration[i];
      this.dummy.scale.setScalar(0);
      if (t < 1) {
        this.p[i * 3] += Math.cos(this.angle[i]) * 0.8 * dt;
        this.p[i * 3 + 2] += Math.sin(this.angle[i]) * 0.8 * dt;
        this.dummy.position.fromArray(this.p, i * 3);
        this.dummy.position.y =
          (this.anchor[i] === 0
            ? ground(this.dummy.position.x, this.dummy.position.z) + 2
            : this.p[i * 3 + 1]) +
          Math.sin(t * Math.PI) * (this.anchor[i] === 2 ? 6 : 4);
        this.rotation.setFromAxisAngle(this.axis, this.angle[i] + t * 0.3);
        this.dummy.quaternion.copy(camera.quaternion).multiply(this.rotation);
        const size = this.size[i] * (1 + t * 2) * Math.min(1, t * 5 + 0.15);
        this.dummy.scale.set(
          size,
          size * (this.anchor[i] === 2 ? 1.3 : 0.85),
          1,
        );
        this.animation[i * 2] = t;
      }
      if (t >= 1) this.active.delete(i);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.mesh.visible = this.active.size > 0;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.geometry.attributes.puffAnimation.needsUpdate = true;
  }
  reset() {
    this.active.clear();
    this.mesh.visible = false;
    this.age.fill(100);
    this.dummy.scale.setScalar(0);
    this.dummy.updateMatrix();
    for (let i = 0; i < this.capacity; i++)
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
