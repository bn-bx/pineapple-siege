import { GroundDust } from "./dust";
import * as THREE from "three";
import { NukeCloud } from "./nuke-cloud";
import { Fragments } from "./fragments";
import { NukeFlash } from "./nuke-flash";
import { SpaceLaser } from "./space-laser";
import type { Explosion, FragmentEffect } from "../types";
export class Effects {
  readonly laser = new SpaceLaser();
  readonly dust = new GroundDust();
  readonly group = new THREE.Group();
  private capacity = 5000;
  private positions = new Float32Array(this.capacity * 3);
  private colors = new Float32Array(this.capacity * 3);
  private velocity = new Float32Array(this.capacity * 3);
  private life = new Float32Array(this.capacity);
  private totalLife = new Float32Array(this.capacity);
  private next = 0;
  private points: THREE.Points;
  private flashes: {
    mesh: THREE.Mesh;
    life: number;
    water: boolean;
    radius: number;
    duration: number;
    nuke: boolean;
  }[] = [];
  private clouds: NukeCloud[] = [];
  readonly nukeFlash = new NukeFlash();
  readonly fragments = new Fragments((x, z) => this.ground(x, z));
  ground: (x: number, z: number) => number = () => 0;
  fragment(e: FragmentEffect, scale = 1) {
    this.fragments.emit(e, this.reduced ? scale * 0.5 : scale);
  }
  reduced = false;
  shake = 0;
  constructor() {
    const geo = new THREE.BufferGeometry();
    this.positions.fill(-100000);
    geo.setAttribute(
      "position",
      new THREE.BufferAttribute(this.positions, 3).setUsage(
        THREE.DynamicDrawUsage,
      ),
    );
    geo.setAttribute(
      "color",
      new THREE.BufferAttribute(this.colors, 3).setUsage(
        THREE.DynamicDrawUsage,
      ),
    );
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 64;
    const c = canvas.getContext("2d")!,
      g = c.createRadialGradient(32, 32, 1, 32, 32, 32);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.4, "rgba(255,255,255,.7)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    c.fillStyle = g;
    c.fillRect(0, 0, 64, 64);
    this.points = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        size: 1.7,
        map: new THREE.CanvasTexture(canvas),
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        opacity: 0.8,
        blending: THREE.NormalBlending,
      }),
    );
    this.points.frustumCulled = false;
    this.group.add(
      this.laser.group,
      this.points,
      this.fragments.mesh,
      this.nukeFlash.mesh,
      this.dust.mesh,
    );
  }
  explosion(e: Explosion, scale = 1) {
    this.dust.emit(e, this.reduced || scale < 1, this.ground);
    if (e.kind === "nuke") {
      this.nukeFlash.trigger(e);
      if (this.clouds.length >= 3) {
        const oldest = this.clouds.shift()!;
        this.group.remove(oldest.group);
        oldest.dispose();
      }
      if (this.clouds.length >= 2) this.clouds[0].fade();
      const cloud = new NukeCloud(e, this.reduced || scale < 1);
      this.clouds.push(cloud);
      this.group.add(cloud.group);
      this.shake = 1;
    }
    const count = Math.round((e.kind === "collapse" ? 140 : 420) * scale);
    for (let j = 0; j < count; j++) {
      const i = this.next++ % this.capacity,
        a = Math.random() * Math.PI * 2,
        u = Math.random(),
        speed = 4 + Math.random() * 27 * e.power;
      this.positions.set(e.p, i * 3);
      this.velocity.set(
        [
          Math.cos(a) * speed * u,
          (3 + Math.random() * 20) * (e.water ? 1.3 : 1),
          Math.sin(a) * speed * u,
        ],
        i * 3,
      );
      this.life[i] = this.totalLife[i] = 1 + Math.random() * 4;
      const c = new THREE.Color(
        e.water
          ? "#c0e5e1"
          : j % 5 === 0
            ? "#ffd987"
            : j % 3 === 0
              ? "#e78734"
              : "#9f917c",
      );
      c.multiplyScalar(0.7 + Math.random() * 0.4);
      this.colors.set([c.r, c.g, c.b], i * 3);
    }
    if (e.kind !== "impact") {
      if (this.flashes.length >= 32) {
        const old = this.flashes.shift()!;
        this.group.remove(old.mesh);
        old.mesh.geometry.dispose();
        (old.mesh.material as THREE.Material).dispose();
      }
      let material = new THREE.MeshBasicMaterial({
        color: e.kind === "nuke" ? "#ffffff" : e.water ? "#bfebeb" : "#ffe198",
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
        toneMapped: e.kind !== "nuke",
      });
      let mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10), material);
      mesh.position.fromArray(e.p);
      this.group.add(mesh);
      this.flashes.push({
        mesh,
        life: e.kind === "nuke" ? 4.5 : 0.55,
        duration: e.kind === "nuke" ? 4.5 : 0.55,
        nuke: e.kind === "nuke",
        water: e.water,
        radius:
          e.kind === "nuke" ? Math.min(150, e.profile!.craterRadius * 1.2) : 16,
      });
      this.shake = Math.min(1, this.shake + 0.65);
    }
    this.points.geometry.attributes.color.needsUpdate = true;
  }
  trail(p: number[], v: number[]) {
    const i = this.next++ % this.capacity;
    this.positions.set(p, i * 3);
    this.velocity.set(
      v.map((x) => x * 0.1),
      i * 3,
    );
    this.life[i] = 0.32;
    this.colors.set([1, 0.72, 0.22], i * 3);
    this.points.geometry.attributes.color.needsUpdate = true;
  }
  get cloudCount() {
    return this.clouds.length;
  }
  update(dt: number) {
    this.fragments.update(dt);
    for (let i = this.clouds.length - 1; i >= 0; i--) {
      const c = this.clouds[i];
      c.update(dt);
      if (c.finished) {
        this.group.remove(c.group);
        c.dispose();
        this.clouds.splice(i, 1);
      }
    }

    for (let i = 0; i < this.capacity; i++)
      if (this.life[i] > 0) {
        this.life[i] -= dt;
        for (let k = 0; k < 3; k++)
          this.positions[i * 3 + k] += this.velocity[i * 3 + k] * dt;
        this.velocity[i * 3 + 1] -= 6 * dt;
        this.velocity[i * 3] *= 1 - dt * 0.4;
        this.velocity[i * 3 + 2] *= 1 - dt * 0.4;
        if (this.life[i] <= 0) this.positions[i * 3 + 1] = -100000;
      }
    this.points.geometry.attributes.position.needsUpdate = true;
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.life -= dt;
      const progress = 1 - f.life / f.duration;
      const s = (f.nuke ? 0.2 + progress * 0.8 : progress) * f.radius;
      f.mesh.scale.set(s, s * (f.water ? 0.3 : 0.7), s);
      (f.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(
        0,
        (f.life / f.duration) * (f.nuke ? (this.reduced ? 0.45 : 1) : 0.7),
      );
      if (f.nuke)
        (f.mesh.material as THREE.MeshBasicMaterial).color
          .set("#ffffff")
          .lerp(
            new THREE.Color("#ffb54c"),
            THREE.MathUtils.smoothstep(progress, 0.2, 1),
          );
      if (f.life <= 0) {
        this.group.remove(f.mesh);
        f.mesh.geometry.dispose();
        (f.mesh.material as THREE.Material).dispose();
        this.flashes.splice(i, 1);
      }
    }
    this.shake *= Math.exp(-dt * 5);
  }
  reset() {
    this.laser.reset();
    this.dust.reset();
    this.nukeFlash.reset();
    this.fragments.reset();
    for (const c of this.clouds) {
      this.group.remove(c.group);
      c.dispose();
    }
    this.clouds = [];
    this.life.fill(0);
    this.positions.fill(-100000);
    for (const f of this.flashes) {
      this.group.remove(f.mesh);
      f.mesh.geometry.dispose();
      (f.mesh.material as THREE.Material).dispose();
    }
    this.flashes = [];
    this.shake = 0;
  }
}
