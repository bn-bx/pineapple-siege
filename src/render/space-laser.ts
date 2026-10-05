import * as THREE from "three";
import { resolvedLaserProfile } from "../destruction-settings";
import { LASER, clamp } from "../config";
import type { LaserStrike, Vec3 } from "../types";

/** Fixed rendering cost even when unrestricted fire creates hundreds of strikes. */
export class SpaceLaser {
  readonly group = new THREE.Group();
  private capacity = 64;
  private core: THREE.InstancedMesh;
  private halo: THREE.InstancedMesh;
  private aura: THREE.InstancedMesh;
  private rings: THREE.InstancedMesh;
  private impacts: THREE.InstancedMesh;
  private distant: THREE.InstancedMesh;
  private arcs: THREE.LineSegments;
  private arcPositions = new Float32Array(12 * 32 * 2 * 3);
  private light = new THREE.PointLight("#ffffff", 0, 650, 1.3);
  private dummy = new THREE.Object3D();
  private color = new THREE.Color();
  private hot = new Map<
    number,
    { p: Vec3; life: number; scale: number; brightness: number }
  >();
  private prior = new Map<number, LaserStrike>();
  reduced = false;
  constructor() {
    const cylinder = new THREE.CylinderGeometry(1, 1, 1, 12, 1, true);
    const material = (color: string, opacity: number) =>
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        toneMapped: false,
      });
    this.core = new THREE.InstancedMesh(
      cylinder,
      material("#ffffff", 0.95),
      this.capacity,
    );
    this.halo = new THREE.InstancedMesh(
      cylinder,
      material("#ffffff", 0.42),
      this.capacity,
    );
    this.aura = new THREE.InstancedMesh(
      cylinder,
      material("#ffffff", 0.12),
      this.capacity,
    );
    this.rings = new THREE.InstancedMesh(
      new THREE.TorusGeometry(1, 0.007, 4, 80),
      material("#ffffff", 0.85),
      this.capacity * 6,
    );
    this.impacts = new THREE.InstancedMesh(
      new THREE.CircleGeometry(1, 48),
      material("#ffffff", 0.45),
      this.capacity,
    );
    this.distant = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(1, 1, 1, 6, 1, true),
      material("#ffffff", 0.7),
      256,
    );
    this.distant.setColorAt(0, new THREE.Color());
    this.distant.count = 0;
    this.distant.frustumCulled = false;
    const arcGeo = new THREE.BufferGeometry();
    arcGeo.setAttribute(
      "position",
      new THREE.BufferAttribute(this.arcPositions, 3).setUsage(
        THREE.DynamicDrawUsage,
      ),
    );
    this.arcs = new THREE.LineSegments(
      arcGeo,
      new THREE.LineBasicMaterial({
        color: "#ffffff",
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    for (const mesh of [
      this.core,
      this.halo,
      this.aura,
      this.rings,
      this.impacts,
    ]) {
      mesh.setColorAt(0, new THREE.Color());
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    }
    this.arcs.frustumCulled = false;
    this.group.add(
      this.core,
      this.halo,
      this.aura,
      this.rings,
      this.impacts,
      this.distant,
      this.arcs,
      this.light,
    );
  }
  private place(
    mesh: THREE.InstancedMesh,
    index: number,
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
    flat = false,
  ) {
    this.dummy.position.set(x, y, z);
    this.dummy.rotation.set(flat ? -Math.PI / 2 : 0, 0, 0);
    this.dummy.scale.set(sx, sy, sz);
    this.dummy.updateMatrix();
    mesh.setMatrixAt(index, this.dummy.matrix);
  }
  update(
    strikes: LaserStrike[],
    dt: number,
    time: number,
    camera: THREE.Vector3,
    ground: (x: number, z: number) => number,
  ) {
    const visible = strikes.filter((l) => l.phase !== "finishing");
    const live = new Set(visible.map((l) => l.id));
    for (const [id, l] of this.prior)
      if (!live.has(id) && l.phase !== "charging")
        this.hot.set(id, {
          p: l.p,
          life: 4,
          scale: resolvedLaserProfile(l.profile).radius / LASER.radius,
          brightness: resolvedLaserProfile(l.profile).brightness,
        });
    this.prior = new Map(visible.map((l) => [l.id, l]));
    for (const [id, glow] of this.hot) {
      glow.life -= dt;
      if (glow.life <= 0) this.hot.delete(id);
    }
    // Bound aftermath storage as well as draw instances.
    while (this.hot.size > this.capacity)
      this.hot.delete(this.hot.keys().next().value!);
    const representatives = new Map<string, LaserStrike>();
    for (const l of visible) {
      const profile = resolvedLaserProfile(l.profile),
        key = `${l.phase}:${Math.floor(l.p[0] / Math.max(4, profile.beamRadius))}:${Math.floor(l.p[2] / Math.max(4, profile.beamRadius))}`;
      const old = representatives.get(key);
      if (!old || l.age > old.age) representatives.set(key, l);
    }
    const ordered = [...representatives.values()].sort(
      (a, b) =>
        Math.hypot(a.p[0] - camera.x, a.p[2] - camera.z) -
        Math.hypot(b.p[0] - camera.x, b.p[2] - camera.z),
    );
    const embellishmentLimit = this.reduced ? 8 : this.capacity;
    const selected = ordered.slice(0, embellishmentLimit),
      distant = ordered.slice(embellishmentLimit);
    if (distant.length > this.distant.instanceMatrix.count) {
      const previous = this.distant;
      this.distant = new THREE.InstancedMesh(
        previous.geometry,
        previous.material,
        2 ** Math.ceil(Math.log2(distant.length)),
      );
      this.distant.frustumCulled = false;
      this.group.remove(previous);
      previous.dispose();
      this.group.add(this.distant);
    }
    distant.forEach((l, i) => {
      const profile = resolvedLaserProfile(l.profile),
        scale = profile.radius / LASER.radius;
      const bottom = l.phase === "charging" ? l.p[1] : ground(l.p[0], l.p[2]),
        height = LASER.top - bottom;
      const radius =
        l.phase === "charging"
          ? (0.6 + clamp(l.age / LASER.charge, 0, 1) ** 2 * 6) * scale
          : profile.beamRadius;
      this.place(
        this.distant,
        i,
        l.p[0],
        bottom + height / 2,
        l.p[2],
        radius,
        height,
        radius,
      );
      this.color
        .setHSL((time * 0.12 + l.id * 0.19) % 1, 0.9, 0.6)
        .multiplyScalar(
          (l.phase === "charging" ? 1 : profile.brightness) *
            (this.reduced ? 0.7 : 1),
        );
      this.distant.setColorAt(i, this.color);
    });
    this.distant.count = distant.length;
    this.distant.instanceMatrix.needsUpdate = true;
    if (this.distant.instanceColor)
      this.distant.instanceColor.needsUpdate = true;
    let beamCount = 0,
      ringCount = 0,
      impactCount = 0,
      arcCount = 0;
    this.light.intensity = 0;
    for (const l of selected) {
      const profile = resolvedLaserProfile(l.profile),
        scale = profile.radius / LASER.radius;
      const baseColor = new THREE.Color().setHSL(
        (time * 0.12 + l.id * 0.19) % 1,
        0.95,
        0.62,
      );
      const charge = l.phase === "charging",
        progress = clamp(l.age / LASER.charge, 0, 1);
      const [x, targetY, z] = l.p;
      const bottom = charge ? targetY : ground(x, z);
      const top = LASER.top,
        height = top - bottom;
      const pulse = 1 + 0.06 * Math.sin(time * 37 + l.id);
      const strength =
        profile.brightness *
        (charge ? 0.08 + progress * progress * 0.65 : this.reduced ? 0.7 : 1.7);
      const radius = charge
        ? (0.6 + progress * progress * 6) * scale
        : profile.beamRadius * pulse;
      this.place(
        this.core,
        beamCount,
        x,
        bottom + height / 2,
        z,
        radius,
        height,
        radius,
      );
      this.place(
        this.halo,
        beamCount,
        x,
        bottom + height / 2,
        z,
        radius * 2.8,
        height,
        radius * 2.8,
      );
      this.place(
        this.aura,
        beamCount,
        x,
        bottom + height / 2,
        z,
        radius * 5,
        height,
        radius * 5,
      );
      this.color.copy(baseColor).multiplyScalar(strength);
      this.core.setColorAt(beamCount, this.color);
      this.halo.setColorAt(beamCount, this.color);
      this.aura.setColorAt(beamCount, this.color);
      beamCount++;
      const rimY = charge
        ? targetY + 2
        : Math.max(
            ground(x + profile.radius, z),
            ground(x - profile.radius, z),
          ) + 2;
      for (let r = 0; r < (this.reduced ? 1 : 3); r++) {
        const rr =
          profile.radius *
          (charge ? 0.5 + 0.25 * r : 0.65 + 0.17 * r) *
          (1 + 0.015 * Math.sin(time * 6 + r));
        this.place(
          this.rings,
          ringCount,
          x,
          rimY + r * 0.8,
          z,
          rr,
          rr,
          rr,
          true,
        );
        this.color
          .copy(baseColor)
          .multiplyScalar(charge ? 0.25 + progress * 0.75 : 0.9);
        this.rings.setColorAt(ringCount++, this.color);
      }
      for (let r = 0; r < (this.reduced ? 0 : 2); r++) {
        const y = bottom + ((time * (charge ? 150 : 280) + r * 500) % height);
        const rr = charge
          ? (18 + progress * 45) * scale
          : (65 + 15 * Math.sin(time * 8 + r)) * scale;
        this.place(this.rings, ringCount, x, y, z, rr, rr, rr, true);
        this.rings.setColorAt(ringCount++, this.color);
      }
      const beamAge = l.age - LASER.charge;
      if (!this.reduced && !charge && beamAge < 1) {
        const rr = (20 + clamp(beamAge, 0, 1) * LASER.radius * 1.5) * scale;
        this.place(this.rings, ringCount, x, rimY + 4, z, rr, rr, rr, true);
        this.color.copy(baseColor).multiplyScalar(1 - beamAge);
        this.rings.setColorAt(ringCount++, this.color);
      }
      this.place(
        this.impacts,
        impactCount,
        x,
        bottom + 1,
        z,
        (charge ? 8 + progress * 35 : 90 * pulse) * scale,
        (charge ? 8 + progress * 35 : 90 * pulse) * scale,
        1,
        true,
      );
      this.color.copy(baseColor).multiplyScalar(strength);
      this.impacts.setColorAt(impactCount++, this.color);
      if (!charge && this.light.intensity === 0) {
        this.light.color.copy(baseColor);
        this.light.position.set(x, rimY + 30, z);
        this.light.distance = 650 * scale;
        this.light.intensity = (this.reduced ? 50 : 220) * profile.brightness;
      }
      if (beamCount <= 12 && !this.reduced)
        for (let segment = 0; segment < 32; segment++) {
          for (let end = 0; end < 2; end++) {
            const t = (segment + end) / 32,
              angle = t * Math.PI * 10 + time * 7 + l.id;
            const spread =
              (charge ? 12 + progress * 55 : 60) *
              scale *
              (0.6 + 0.4 * Math.sin(t * 51 + time * 17));
            this.arcPositions.set(
              [
                x + Math.cos(angle) * spread,
                bottom + t * height,
                z + Math.sin(angle) * spread,
              ],
              arcCount * 6 + end * 3,
            );
          }
          arcCount++;
        }
    }
    for (const glow of [...this.hot.values()].slice(
      0,
      embellishmentLimit - impactCount,
    )) {
      this.place(
        this.impacts,
        impactCount,
        glow.p[0],
        ground(glow.p[0], glow.p[2]) + 1,
        glow.p[2],
        110 * glow.scale,
        110 * glow.scale,
        1,
        true,
      );
      this.color.setRGB(glow.life / 4, glow.life / 8, 0.05);
      this.color.multiplyScalar(glow.brightness * (this.reduced ? 0.7 : 1));
      this.impacts.setColorAt(impactCount++, this.color);
    }
    for (const [mesh, count] of [
      [this.core, beamCount],
      [this.halo, beamCount],
      [this.aura, this.reduced ? 0 : beamCount],
      [this.rings, ringCount],
      [this.impacts, impactCount],
    ] as const) {
      mesh.count = count;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    this.arcs.geometry.setDrawRange(0, arcCount * 2);
    (this.arcs.material as THREE.LineBasicMaterial).color.setHSL(
      (time * 0.12) % 1,
      0.9,
      0.7,
    );
    this.arcs.geometry.getAttribute("position").needsUpdate = true;
  }
  reset() {
    this.prior.clear();
    this.hot.clear();
    this.light.intensity = 0;
    for (const mesh of [
      this.core,
      this.halo,
      this.aura,
      this.rings,
      this.impacts,
    ])
      mesh.count = 0;
    this.distant.count = 0;
    this.arcs.geometry.setDrawRange(0, 0);
  }
}
