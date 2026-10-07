import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { DEFAULT_RENDER_DISTANCE } from "../config";
import { discoActive } from "../disco";
import type { SimulationSnapshot } from "../types";

function boxFallback(name: string) {
  return name === "human-head"
    ? new THREE.SphereGeometry(0.5, 8, 6)
    : new THREE.BoxGeometry(1, 1, 1);
}

/** Shared geometry and instanced parts keep the whole population inexpensive. */
export class CivilianView {
  readonly group = new THREE.Group();
  private parts: THREE.InstancedMesh[];
  private distant: THREE.InstancedMesh;
  private hats: THREE.InstancedMesh[];
  private scarves: THREE.InstancedMesh;
  private hair: THREE.InstancedMesh;
  private mouths: THREE.InstancedMesh;
  private fearMouths: THREE.InstancedMesh;
  private eyeWhites: THREE.InstancedMesh;
  private frustum = new THREE.Frustum();
  private projection = new THREE.Matrix4();
  private sphere = new THREE.Sphere(new THREE.Vector3(), 5);
  private colors = [0x9c805c, 0x607e86, 0x796b79, 0x996954, 0x6c785a].map(
    (c) => new THREE.Color(c),
  );
  private dummy = new THREE.Object3D();
  private attachment = new THREE.Matrix4();
  private handTransform = new THREE.Matrix4().compose(
    new THREE.Vector3(0, -0.62, 0),
    new THREE.Quaternion(),
    new THREE.Vector3(1.15, 0.72, 0.8),
  );
  private bootTransform = new THREE.Matrix4().compose(
    new THREE.Vector3(0, -0.4, 0),
    new THREE.Quaternion(),
    new THREE.Vector3(0.95, 0.32, 0.95),
  );
  private skinColors = [0xe9bd87, 0xc99770, 0x9f6d4f, 0xe2b09a, 0x80513c].map(
    (c) => new THREE.Color(c),
  );
  private root = new THREE.Object3D();
  private hatColors = [
    [0x917346, 0x746044, 0xa37f48],
    [0x4a6065, 0x784f42, 0x65734c],
  ].map((colors) => colors.map((color) => new THREE.Color(color)));
  private scarfColors = [0x9b5140, 0x456e79, 0x7d664a, 0x6a7748].map(
    (color) => new THREE.Color(color),
  );
  private hairColors = [0x433029, 0x5b4034, 0x73583d, 0x624331].map(
    (color) => new THREE.Color(color),
  );
  private defeated = new Map<number, number>();
  private observedDead = new Set<number>();
  private reviewDefeated = new Set<number>();
  constructor(count: number) {
    const cloth = new THREE.MeshStandardMaterial({ roughness: 0.9 });
    const skin = new THREE.MeshStandardMaterial({
      color: 0xffffff,
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
      new THREE.InstancedMesh(sphere, skin, count * 2),
      new THREE.InstancedMesh(box, dark, count * 2),
    ];
    const hatGeometry = (wide: boolean) => {
      const brim = new THREE.CylinderGeometry(
          wide ? 0.68 : 0.48,
          wide ? 0.68 : 0.48,
          0.1,
          12,
        ),
        crown = wide
          ? new THREE.CylinderGeometry(0.36, 0.44, 0.4, 10)
          : new THREE.SphereGeometry(
              0.48,
              10,
              6,
              0,
              Math.PI * 2,
              0,
              Math.PI / 2,
            );
      crown.translate(0, wide ? 0.2 : 0.08, 0);
      const geometry = mergeGeometries([brim, crown])!;
      brim.dispose();
      crown.dispose();
      return geometry;
    };
    const hatMaterial = new THREE.MeshStandardMaterial({ roughness: 0.96 });
    this.hats = [
      new THREE.InstancedMesh(hatGeometry(true), hatMaterial, count),
      new THREE.InstancedMesh(hatGeometry(false), hatMaterial, count),
    ];
    for (const hat of this.hats) {
      hat.count = 0;
      hat.frustumCulled = false;
      hat.castShadow = true;
      hat.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    }
    const scarfCollar = new THREE.TorusGeometry(0.31, 0.055, 6, 12).rotateX(
        Math.PI / 2,
      ),
      scarfShape = new THREE.Shape();
    scarfShape.moveTo(-0.32, -0.08);
    scarfShape.lineTo(0.32, -0.08);
    scarfShape.lineTo(0.26, -0.58);
    scarfShape.lineTo(0, -0.82);
    scarfShape.lineTo(-0.26, -0.58);
    scarfShape.closePath();
    const scarfDrape = new THREE.ShapeGeometry(scarfShape).translate(
        0,
        0,
        0.48,
      ),
      scarfGeometry = mergeGeometries([scarfCollar, scarfDrape])!;
    scarfCollar.dispose();
    scarfDrape.dispose();
    this.scarves = new THREE.InstancedMesh(
      scarfGeometry,
      new THREE.MeshStandardMaterial({ roughness: 0.96, side: THREE.DoubleSide }),
      count,
    );
    this.scarves.count = 0;
    this.scarves.frustumCulled = false;
    this.scarves.castShadow = true;
    this.scarves.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.hair = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.78, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshStandardMaterial({ roughness: 0.98 }),
      count,
    );
    this.hair.count = 0;
    this.hair.frustumCulled = false;
    this.hair.castShadow = true;
    this.hair.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const mouthShape = new THREE.Shape();
    mouthShape.moveTo(-0.2, 0.045);
    mouthShape.quadraticCurveTo(0, -0.14, 0.2, 0.045);
    mouthShape.lineTo(0.2, -0.035);
    mouthShape.quadraticCurveTo(0, -0.085, -0.2, -0.035);
    mouthShape.closePath();
    this.mouths = new THREE.InstancedMesh(
      new THREE.ShapeGeometry(mouthShape),
      new THREE.MeshStandardMaterial({
        color: "#382720",
        roughness: 1,
        side: THREE.DoubleSide,
      }),
      count,
    );
    this.mouths.name = "resident-expressions";
    this.mouths.count = 0;
    this.mouths.frustumCulled = false;
    this.mouths.castShadow = false;
    this.mouths.receiveShadow = false;
    this.mouths.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const fearShape = new THREE.Shape();
    fearShape.absellipse(0, 0, 0.14, 0.21, 0, Math.PI * 2, false, 0);
    this.fearMouths = new THREE.InstancedMesh(
      new THREE.ShapeGeometry(fearShape),
      new THREE.MeshStandardMaterial({
        color: "#382720",
        roughness: 1,
        side: THREE.DoubleSide,
      }),
      count,
    );
    this.fearMouths.name = "resident-fear-expressions";
    this.fearMouths.count = 0;
    this.fearMouths.frustumCulled = false;
    this.fearMouths.castShadow = false;
    this.fearMouths.receiveShadow = false;
    this.fearMouths.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.eyeWhites = new THREE.InstancedMesh(
      new THREE.SphereGeometry(1, 10, 8),
      new THREE.MeshStandardMaterial({ color: "#f1e8d8", roughness: 0.92 }),
      count * 2,
    );
    this.eyeWhites.name = "resident-eye-whites";
    this.eyeWhites.count = 0;
    this.eyeWhites.frustumCulled = false;
    this.eyeWhites.castShadow = false;
    this.eyeWhites.receiveShadow = false;
    this.eyeWhites.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.distant = new THREE.InstancedMesh(box, cloth, count);
    this.distant.count = 0;
    this.distant.frustumCulled = false;
    this.distant.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.distant.setColorAt(0, new THREE.Color());
    const colors = [0x9c805c, 0x607e86, 0x796b79, 0x996954, 0x6c785a];
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
    for (const hat of this.hats) this.group.add(hat);
    this.group.add(this.scarves);
    this.group.add(this.hair);
    this.group.add(this.distant);
    this.group.add(this.mouths);
    this.group.add(this.fearMouths);
    this.group.add(this.eyeWhites);
  }
  /** Isolated inspector override; it never edits worker or saved civilian data. */
  setReviewDefeat(id: number, defeated: boolean, time = 0) {
    if (defeated) {
      this.reviewDefeated.add(id);
      this.observedDead.add(id);
      // Hold the actor at the settled defeat pose while the inspector is paused.
      this.defeated.set(id, time - 0.7);
    } else {
      this.reviewDefeated.delete(id);
      this.observedDead.delete(id);
      this.defeated.delete(id);
    }
  }
  update(
    snap: SimulationSnapshot,
    previous: SimulationSnapshot | undefined,
    alpha: number,
    camera: THREE.Vector3,
    renderDistance = DEFAULT_RENDER_DISTANCE,
    viewCamera?: THREE.Camera,
    ground?: (x: number, z: number) => number,
  ) {
    let n = 0,
      mouthCount = 0,
      fearMouthCount = 0,
      far = 0,
      scarfCount = 0,
      hairCount = 0;
    const hatCounts = [0, 0];
    if (viewCamera)
      this.frustum.setFromProjectionMatrix(
        this.projection.multiplyMatrices(
          viewCamera.projectionMatrix,
          viewCamera.matrixWorldInverse,
        ),
      );
    const dancing = discoActive(snap.lasers ?? []);
    for (const source of snap.civilians ?? []) {
      const c = this.reviewDefeated.has(source.id)
        ? { ...source, alive: false }
        : source;
      const old = previous?.civilians?.[c.id];
      if (c.alive) {
        this.observedDead.delete(c.id);
        this.defeated.delete(c.id);
      } else if (!this.observedDead.has(c.id)) {
        this.observedDead.add(c.id);
        // Only present a newly observed casualty, never historical saved deaths.
        if (old?.alive) this.defeated.set(c.id, snap.time);
      }
      const deathTime = this.defeated.get(c.id);
      const age =
        deathTime === undefined ? Infinity : Math.max(0, snap.time - deathTime);
      // Let the face settle with the body so defeat reads as a completed
      // animation, rather than a blank-eyed version of the standing pose.
      const defeatedEyeOpen = c.alive
        ? 1
        : 1 - THREE.MathUtils.smoothstep(age, 0.18, 0.55);
      if (!c.alive && age >= 6) this.defeated.delete(c.id);
      if (
        (!c.alive && age >= 6) ||
        Math.hypot(c.p[0] - camera.x, c.p[2] - camera.z) > renderDistance
      )
        continue;
      const px =
          old?.alive && c.alive
            ? THREE.MathUtils.lerp(old.p[0], c.p[0], alpha)
            : c.p[0],
        py = !c.alive
          ? Math.max(
              ground?.(c.p[0], c.p[2]) ?? c.p[1],
              c.p[1] - 4.9 * age * age,
            )
          : old?.alive
            ? THREE.MathUtils.lerp(old.p[1], c.p[1], alpha)
            : c.p[1],
        pz =
          old?.alive && c.alive
            ? THREE.MathUtils.lerp(old.p[2], c.p[2], alpha)
            : c.p[2];
      if (
        viewCamera &&
        !this.frustum.intersectsSphere(
          this.sphere.center.set(px, py + 2, pz) && this.sphere,
        )
      )
        continue;
      if (
        viewCamera &&
        (px - camera.x) ** 2 + (pz - camera.z) ** 2 > 350 * 350
      ) {
        this.dummy.position.set(px, py + 1, pz);
        this.dummy.rotation.set(0, c.yaw, 0);
        this.dummy.scale.set(0.7, 2, 0.63);
        if (!c.alive) {
          const collapse = THREE.MathUtils.smoothstep(age, 0, 0.7);
          this.root.position.set(px, py + 0.9 * collapse, pz);
          this.root.rotation.set(
            0,
            c.yaw,
            (((c.id % 2 ? 1 : -1) * Math.PI) / 2) * collapse,
          );
          this.root.scale.setScalar(
            1 - THREE.MathUtils.smoothstep(age, 5.5, 6),
          );
          this.root.updateMatrix();
          this.dummy.position.set(0, 2, 0);
          this.dummy.rotation.set(0, 0, 0);
          this.dummy.updateMatrix();
          this.dummy.matrix.premultiply(this.root.matrix);
        } else this.dummy.updateMatrix();
        this.distant.setMatrixAt(far, this.dummy.matrix);
        this.distant.setColorAt(far++, this.colors[c.id % 5]);
        continue;
      }
      const phase = old?.alive
        ? THREE.MathUtils.lerp(old.phase, c.phase, alpha)
        : c.phase;
      for (const part of [0, 2, 3])
        this.parts[part].setColorAt(n, this.colors[c.id % this.colors.length]);
      const skinColor = this.skinColors[c.id % this.skinColors.length];
      this.parts[1].setColorAt(n, skinColor);
      this.parts[7].setColorAt(n * 2, skinColor);
      this.parts[7].setColorAt(n * 2 + 1, skinColor);
      const dance = c.alive && dancing && c.mood !== "flee" && c.mood !== "sad";
      const dancePhase = snap.time * 3 + c.id * 0.7;
      const cheer = c.alive && (c.mood === "cheer" || dance),
        sad = c.mood === "sad",
        flee = c.mood === "flee";
      const walk = c.alive && (c.mood === "walk" || flee);
      const strideWave = Math.sin(phase * 2),
        stride = walk
          ? strideWave * (flee ? 0.65 : 0.35)
          : dance
            ? Math.sin(dancePhase) * 0.26
            : 0,
        armSwing = walk ? strideWave * (flee ? 0.78 : 0.3) : 0;
      this.root.position.set(
        px,
        py + (cheer ? Math.max(0, Math.sin(phase * 3 + c.id * 0.4)) * 0.8 : 0),
        pz,
      );
      this.root.rotation.set(
        sad ? 0.2 : flee ? 0.12 : 0,
        c.yaw,
        dance ? Math.sin(dancePhase) * 0.08 : 0,
      );
      // The authored near parts use a 4.5m presentation rig. Scale it to a
      // grounded 2.25m person and keep shoulder width in human proportion.
      this.root.scale.set(0.5, 0.5, 0.7);
      if (!c.alive) {
        const collapse = THREE.MathUtils.smoothstep(age, 0, 0.7);
        this.root.position.y = py + 0.9 * collapse;
        this.root.rotation.set(
          0,
          c.yaw,
          (((c.id % 2 ? 1 : -1) * Math.PI) / 2) * collapse,
        );
        const shrink = 1 - THREE.MathUtils.smoothstep(age, 5.5, 6);
        this.root.scale.set(shrink * 0.5, shrink * 0.5, shrink * 0.7);
      }
      this.root.updateMatrix();
      const hatStyle = c.id % 4,
        headY = sad ? 3.75 : 4.05,
        headZ = sad ? 0.3 : 0;
      if (hatStyle < 2) {
        const hatIndex = hatCounts[hatStyle]++,
          palette = this.hatColors[hatStyle];
        this.dummy.position.set(0, sad ? 4.22 : 4.52, headZ);
        this.dummy.rotation.set(0, 0, 0);
        this.dummy.scale.set(1, 1, 1);
        this.dummy.updateMatrix();
        this.dummy.matrix.premultiply(this.root.matrix);
        this.hats[hatStyle].setMatrixAt(hatIndex, this.dummy.matrix);
        this.hats[hatStyle].setColorAt(
          hatIndex,
          palette[(Math.floor(c.id / 4) + c.id) % palette.length],
        );
      }
      if (hatStyle >= 2) {
        const hairIndex = hairCount++;
        this.dummy.position.set(0, headY + 0.05, headZ - 0.34);
        this.dummy.rotation.set(0, 0, 0);
        this.dummy.scale.set(0.7, 0.8, 0.75);
        this.dummy.updateMatrix();
        this.dummy.matrix.premultiply(this.root.matrix);
        this.hair.setMatrixAt(hairIndex, this.dummy.matrix);
        this.hair.setColorAt(
          hairIndex,
          this.hairColors[(Math.floor(c.id / 4) + c.id) % this.hairColors.length],
        );
      }
      if (c.id % 3 === 0) {
        const scarfIndex = scarfCount++;
        // Float the shared neck ring clear of the upper torso so it remains
        // readable with every body tint and camera angle.
        this.dummy.position.set(0, 3.45, 0);
        this.dummy.rotation.set(0, 0, 0);
        this.dummy.scale.set(0.95, 1, 0.9);
        this.dummy.updateMatrix();
        this.dummy.matrix.premultiply(this.root.matrix);
        this.scarves.setMatrixAt(scarfIndex, this.dummy.matrix);
        this.scarves.setColorAt(
          scarfIndex,
          this.scarfColors[c.id % this.scarfColors.length],
        );
      }
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
        0.4,
        0.45,
        0.38,
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
        sad ? -0.2 : armSwing,
        sad ? 0.42 : cheer ? -0.65 : 0,
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
        sad ? 0.2 : -armSwing,
        sad ? -0.42 : cheer ? 0.65 : 0,
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
          -Math.PI +
            0.35 +
            Math.sin(dance ? dancePhase : phase * 3) * (dance ? 0.35 : 0.12),
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
          Math.PI -
            0.35 -
            Math.sin(dance ? dancePhase : phase * 3) * (dance ? 0.35 : 0.12),
        );
      }
      place(4, n, -0.45, 0.9, 0, 0.55, 1.8, 0.65, stride);
      place(5, n, 0.45, 0.9, 0, 0.55, 1.8, 0.65, -stride);
      for (let side = 0; side < 2; side++) {
        this.parts[2 + side].getMatrixAt(n, this.attachment);
        this.parts[7].setMatrixAt(
          n * 2 + side,
          this.attachment.multiply(this.handTransform),
        );
        this.parts[4 + side].getMatrixAt(n, this.attachment);
        this.parts[8].setMatrixAt(
          n * 2 + side,
          this.attachment.multiply(this.bootTransform),
        );
      }
      place(
        6,
        n * 2,
        -0.14,
        sad ? 3.774 : 4.19,
        sad ? 0.735 : flee ? 0.42 : 0.405,
        0.025,
        0.032 * defeatedEyeOpen,
        0.022,
      );
      place(
        6,
        n * 2 + 1,
        0.14,
        sad ? 3.774 : 4.19,
        sad ? 0.735 : flee ? 0.42 : 0.405,
        0.025,
        0.032,
        0.022,
      );
      for (let side = 0; side < 2; side++) {
        this.dummy.position.set(
          side === 0 ? -0.14 : 0.14,
          sad ? 3.774 : 4.19,
          sad ? 0.695 : 0.37,
        );
        this.dummy.rotation.set(sad ? 0.3 : 0, 0, 0);
        this.dummy.scale.set(
          flee ? 0.082 : 0.065,
          (flee ? 0.09 : 0.07) * defeatedEyeOpen,
          0.04,
        );
        this.dummy.updateMatrix();
        this.eyeWhites.setMatrixAt(
          n * 2 + side,
          this.dummy.matrix.premultiply(this.root.matrix),
        );
      }
      this.dummy.position.set(
        0,
        flee ? 4.08 : sad ? 3.82 : 3.96,
        flee ? 0.72 : sad ? 0.695 : 0.37,
      );
      // Shared smiles flip into frowns for mourning; fear uses a separate
      // instanced open-mouth shape so it reads as alarm rather than a stretched grin.
      this.dummy.rotation.set(0, 0, sad ? Math.PI : 0);
      this.dummy.scale.set(flee ? 0.8 : 1, flee ? 1.35 : 1, 1);
      if (!c.alive) this.dummy.scale.setScalar(0);
      this.dummy.updateMatrix();
      if (flee)
        this.fearMouths.setMatrixAt(
          fearMouthCount++,
          this.dummy.matrix.premultiply(this.root.matrix),
        );
      else
        this.mouths.setMatrixAt(
          mouthCount++,
          this.dummy.matrix.premultiply(this.root.matrix),
        );
      n++;
    }
    this.distant.count = far;
    this.distant.instanceMatrix.clearUpdateRanges();
    if (far) this.distant.instanceMatrix.addUpdateRange(0, far * 16);
    this.distant.instanceMatrix.needsUpdate = true;
    this.distant.instanceColor!.needsUpdate = !!far;
    for (let i = 0; i < this.hats.length; i++) {
      const hat = this.hats[i];
      hat.count = hatCounts[i];
      hat.instanceMatrix.clearUpdateRanges();
      if (hat.count) hat.instanceMatrix.addUpdateRange(0, hat.count * 16);
      hat.instanceMatrix.needsUpdate = true;
      if (hat.instanceColor) hat.instanceColor.needsUpdate = hat.count > 0;
    }
    this.scarves.count = scarfCount;
    this.scarves.instanceMatrix.clearUpdateRanges();
    if (scarfCount)
      this.scarves.instanceMatrix.addUpdateRange(0, scarfCount * 16);
    this.scarves.instanceMatrix.needsUpdate = true;
    if (this.scarves.instanceColor)
      this.scarves.instanceColor.needsUpdate = scarfCount > 0;
    this.hair.count = hairCount;
    this.hair.instanceMatrix.clearUpdateRanges();
    if (hairCount) this.hair.instanceMatrix.addUpdateRange(0, hairCount * 16);
    this.hair.instanceMatrix.needsUpdate = true;
    if (this.hair.instanceColor) this.hair.instanceColor.needsUpdate = hairCount > 0;
    this.mouths.count = mouthCount;
    this.mouths.instanceMatrix.needsUpdate = true;
    this.mouths.instanceMatrix.clearUpdateRanges();
    if (mouthCount)
      this.mouths.instanceMatrix.addUpdateRange(0, mouthCount * 16);
    this.fearMouths.count = fearMouthCount;
    this.fearMouths.instanceMatrix.needsUpdate = true;
    this.fearMouths.instanceMatrix.clearUpdateRanges();
    if (fearMouthCount)
      this.fearMouths.instanceMatrix.addUpdateRange(0, fearMouthCount * 16);
    this.eyeWhites.count = n * 2;
    this.eyeWhites.instanceMatrix.needsUpdate = true;
    this.eyeWhites.instanceMatrix.clearUpdateRanges();
    if (n) this.eyeWhites.instanceMatrix.addUpdateRange(0, n * 2 * 16);
    for (let k = 0; k < this.parts.length; k++) {
      const mesh = this.parts[k];
      mesh.count = k >= 6 ? n * 2 : n;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceMatrix.clearUpdateRanges();
      mesh.instanceMatrix.addUpdateRange(0, mesh.count * 16);
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }
  reset() {
    this.defeated.clear();
    this.observedDead.clear();
    this.reviewDefeated.clear();
    this.distant.count = 0;
    for (const mesh of this.parts) mesh.count = 0;
    for (const hat of this.hats) hat.count = 0;
    this.scarves.count = 0;
    this.hair.count = 0;
    this.mouths.count = 0;
    this.fearMouths.count = 0;
    this.eyeWhites.count = 0;
  }
}
