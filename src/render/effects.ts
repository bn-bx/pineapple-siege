import { softenParticles, type ParticleDepth } from "./soft-particles";
import { GroundDust } from "./dust";
import * as THREE from "three";
import { NukeCloud } from "./nuke-cloud";
import { Fragments } from "./fragments";
import { NukeFlash } from "./nuke-flash";
import { SpaceLaser } from "./space-laser";
import {
  explosionFlashStyle,
  explosionParticleTint,
} from "./explosion-palette";
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
  private activeParticles = new Set<number>();
  private points: THREE.Points;
  private vaporRegions = new Map<
    string,
    { p: [number, number, number]; radius: number }
  >();
  private flashPool: THREE.Mesh<
    THREE.SphereGeometry,
    THREE.MeshBasicMaterial
  >[] = [];
  private flashGeometry = new THREE.SphereGeometry(1, 16, 10);
  private blastColor = new THREE.Color();
  private cloudsPool: NukeCloud[] = [];
  private particleDepth?: ParticleDepth;
  private puffAtlas?: THREE.Texture;
  installParticles(texture: THREE.Texture) {
    this.puffAtlas = texture;
    this.dust.installAtlas(texture);
    for (const cloud of [...this.clouds, ...this.cloudsPool])
      cloud.installAtlas(texture);
    if (this.particleDepth) this.setParticleDepth(this.particleDepth);
  }
  setParticleDepth(depth: ParticleDepth) {
    this.particleDepth = depth;
    softenParticles(this.dust.mesh.material, depth);
    softenParticles(this.points.material as THREE.PointsMaterial, depth, 1.5);
    for (const cloud of [...this.clouds, ...this.cloudsPool])
      cloud.setParticleDepth(depth);
  }
  private flashes: {
    mesh: THREE.Mesh;
    life: number;
    water: boolean;
    radius: number;
    duration: number;
    nuke: boolean;
    intensity: number;
  }[] = [];
  private clouds: NukeCloud[] = [];
  readonly nukeFlash = new NukeFlash();
  readonly fragments = new Fragments((x, z) => this.ground(x, z));
  ground: (x: number, z: number) => number = () => 0;
  fragment(e: FragmentEffect, scale = 1) {
    this.fragments.emit(e, this.reduced ? scale * 0.5 : scale);
    this.dust.impact(e, this.reduced, scale);
  }
  setEnvironment(day: number, direction: THREE.Vector3, camera: THREE.Camera) {
    for (const cloud of this.clouds)
      cloud.setEnvironment(day, direction, camera);
    (this.dust.mesh.material as THREE.MeshBasicMaterial).color.setRGB(
      0.42 + day * 0.24,
      0.38 + day * 0.23,
      0.3 + day * 0.2,
    );
  }
  reduced = false;
  private lastReduced = false;
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
      this.dust.ripples,
    );
  }
  vaporize(p: [number, number, number], radius: number) {
    const key = p[0] + ":" + p[2];
    const prior = this.vaporRegions.get(key);
    if (!prior || radius > prior.radius)
      this.vaporRegions.set(key, { p, radius });
  }
  get prewarmMeshes(): THREE.Object3D[] {
    return [...this.flashPool, ...this.cloudsPool.map((c) => c.group)];
  }
  prewarm() {
    while (this.flashPool.length < 8)
      this.flashPool.push(
        new THREE.Mesh(
          this.flashGeometry,
          new THREE.MeshBasicMaterial({
            transparent: true,
            depthWrite: false,
            toneMapped: this.flashPool.length % 2 === 0,
          }),
        ),
      );
    const event: Explosion = {
      type: "explosion",
      p: [0, 0, 0],
      water: false,
      power: 1,
      seed: 1,
      kind: "nuke",
      profile: {
        damageRadius: 420,
        craterRadius: 240,
        depth: 50,
        cloudHeight: 400,
        bodyLimit: 128,
        scatterMin: 70,
        scatterMax: 120,
        ejecta: 1200,
      },
    };
    for (const reduced of [false, true]) {
      const count =
        this.cloudsPool.filter((c) => c.reduced === reduced).length +
        this.clouds.filter((c) => c.reduced === reduced).length;
      for (let i = count; i < 3; i++)
        this.cloudsPool.push(this.makeCloud(event, reduced));
    }
  }
  private makeCloud(event: Explosion, reduced: boolean) {
    const cloud = new NukeCloud(event, reduced);
    if (this.puffAtlas) cloud.installAtlas(this.puffAtlas);
    if (this.particleDepth) cloud.setParticleDepth(this.particleDepth);
    return cloud;
  }
  private takeCloud(event: Explosion, reduced: boolean) {
    const index = this.cloudsPool.findIndex((c) => c.reduced === reduced);
    return index < 0
      ? this.makeCloud(event, reduced)
      : this.cloudsPool.splice(index, 1)[0];
  }
  disposePools() {
    this.flashGeometry.dispose();
    for (const m of this.flashPool) m.material.dispose();
    this.flashPool.length = 0;
    for (const c of this.cloudsPool) c.dispose();
    this.cloudsPool.length = 0;
  }
  explosion(e: Explosion, scale = 1) {
    this.dust.emit(e, this.reduced || scale < 1, this.ground);
    if (e.kind === "nuke") {
      this.nukeFlash.trigger(e);
      const reduced = this.reduced || scale < 1;
      const overlap =
        reduced &&
        this.clouds.find(
          (c) =>
            c.reduced === reduced &&
            c.age < 12 &&
            !c.ending &&
            c.event.water === e.water &&
            (c.event.p[0] - e.p[0]) ** 2 + (c.event.p[2] - e.p[2]) ** 2 <
              (e.profile!.damageRadius * 0.65) ** 2,
        );
      if (!overlap) {
        if (this.clouds.length >= 3) {
          const oldest = this.clouds.shift()!;
          this.group.remove(oldest.group);
          this.cloudsPool.push(oldest);
        }
        if (this.clouds.length >= 2) this.clouds[0].fade();
        const cloud = this.takeCloud(e, reduced);
        cloud.restart(e);
        this.clouds.push(cloud);
        this.group.add(cloud.group);
      }
      this.shake = 1;
    }
    const count = Math.round((e.kind === "collapse" ? 140 : 420) * scale);
    for (let j = 0; j < count; j++) {
      const i = this.next++ % this.capacity,
        a = Math.random() * Math.PI * 2,
        u = Math.random(),
        speed = 4 + Math.random() * 27 * e.power;
      this.activeParticles.add(i);
      this.points.visible = true;
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
      const c = this.blastColor.set(explosionParticleTint(e.kind, e.water, j));
      c.multiplyScalar(0.7 + Math.random() * 0.4);
      this.colors.set([c.r, c.g, c.b], i * 3);
    }
    const overlappingFlash =
      e.kind === "nuke" &&
      (this.reduced || scale < 1) &&
      this.flashes.some(
        (f) =>
          f.nuke &&
          f.water === e.water &&
          (f.mesh.position.x - e.p[0]) ** 2 +
            (f.mesh.position.z - e.p[2]) ** 2 <
            150 * 150,
      );
    if (e.kind !== "impact" && !overlappingFlash) {
      if (this.flashes.length >= 32) {
        const old = this.flashes.shift()!;
        this.group.remove(old.mesh);
        this.flashPool.push(
          old.mesh as THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>,
        );
      }
      const mesh =
        this.flashPool.pop() ??
        new THREE.Mesh(
          this.flashGeometry,
          new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false }),
        );
      const flashStyle = explosionFlashStyle(
        e.kind,
        e.water,
        e.profile?.craterRadius,
      );
      mesh.material.color.set(flashStyle.color);
      mesh.material.opacity = 0.85;
      mesh.material.toneMapped = e.kind !== "nuke";
      mesh.position.fromArray(e.p);
      this.group.add(mesh);
      this.flashes.push({
        mesh,
        life: e.kind === "nuke" ? 4.5 : 0.55,
        duration: e.kind === "nuke" ? 4.5 : 0.55,
        nuke: e.kind === "nuke",
        water: e.water,
        radius: flashStyle.radius,
        intensity: flashStyle.intensity,
      });
      this.shake = Math.min(1, this.shake + 0.65);
    }
    this.points.geometry.attributes.color.needsUpdate = true;
  }
  trail(p: number[], v: number[]) {
    const i = this.next++ % this.capacity;
    this.activeParticles.add(i);
    this.points.visible = true;
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
  get cloudFaces() {
    return this.clouds.map((cloud) => cloud.face);
  }
  update(dt: number) {
    if (this.vaporRegions.size) {
      this.fragments.vaporizeMany([...this.vaporRegions.values()]);
      this.vaporRegions.clear();
    }
    if (this.lastReduced !== this.reduced) {
      this.lastReduced = this.reduced;
      this.fragments.setLimit(this.reduced ? 1024 : 4096);
    }
    this.fragments.update(dt);
    for (let i = this.clouds.length - 1; i >= 0; i--) {
      const c = this.clouds[i];
      c.update(dt);
      if (c.finished) {
        this.group.remove(c.group);
        this.cloudsPool.push(c);
        this.clouds.splice(i, 1);
      }
    }

    let first = this.capacity,
      last = -1;
    for (const i of this.activeParticles) {
      this.life[i] -= dt;
      for (let k = 0; k < 3; k++)
        this.positions[i * 3 + k] += this.velocity[i * 3 + k] * dt;
      this.velocity[i * 3 + 1] -= 6 * dt;
      this.velocity[i * 3] *= 1 - dt * 0.4;
      this.velocity[i * 3 + 2] *= 1 - dt * 0.4;
      if (this.life[i] <= 0) {
        this.positions[i * 3 + 1] = -100000;
        this.activeParticles.delete(i);
      }
      first = Math.min(first, i);
      last = Math.max(last, i);
    }
    if (last >= first) {
      const position = this.points.geometry.attributes
        .position as THREE.BufferAttribute;
      // Three clears ranges after upload. Retain dirty slots while the whole
      // pool is hidden, so expired particles cannot reappear on its next use.
      position.addUpdateRange(first * 3, (last - first + 1) * 3);
      position.needsUpdate = true;
    }
    this.points.visible = this.activeParticles.size > 0;
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.life -= dt;
      const progress = 1 - f.life / f.duration;
      const s = (f.nuke ? 0.2 + progress * 0.8 : progress) * f.radius;
      f.mesh.scale.set(s, s * (f.water ? 0.3 : 0.7), s);
      (f.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(
        0,
        (f.life / f.duration) *
          (f.nuke ? (this.reduced ? 0.45 : 1) : f.intensity),
      );
      if (f.nuke)
        (f.mesh.material as THREE.MeshBasicMaterial).color
          .set("#ffffff")
          .lerp(
            this.blastColor.set("#ffb54c"),
            THREE.MathUtils.smoothstep(progress, 0.2, 1),
          );
      if (f.life <= 0) {
        this.group.remove(f.mesh);
        this.flashPool.push(
          f.mesh as THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>,
        );
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
      this.cloudsPool.push(c);
    }
    this.clouds = [];
    this.activeParticles.clear();
    this.points.visible = false;
    this.life.fill(0);
    this.positions.fill(-100000);
    const position = this.points.geometry.attributes
      .position as THREE.BufferAttribute;
    position.clearUpdateRanges();
    position.addUpdateRange(0, this.capacity * 3);
    this.points.geometry.attributes.position.needsUpdate = true;
    for (const f of this.flashes) {
      this.group.remove(f.mesh);
      this.flashPool.push(
        f.mesh as THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>,
      );
    }
    this.flashes = [];
    this.shake = 0;
  }
}
