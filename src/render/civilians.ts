import { discoActive } from "../disco";
import { visualGeometry } from "./visual-assets";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import * as THREE from "three";
import { DEFAULT_RENDER_DISTANCE } from "../config";
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
    new THREE.Vector3(1.1, 0.32, 1),
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
  private defeated = new Map<number, number>();
  private observedDead = new Set<number>();
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
    this.group.add(this.distant);
  }
  installVisuals(cloth?: { color: THREE.Texture; normal: THREE.Texture }) {
    if (cloth) {
      const material = this.parts[0].material as THREE.MeshStandardMaterial;
      material.map = cloth.color;
      material.normalMap = cloth.normal;
      material.normalScale.set(0.4, 0.4);
      material.needsUpdate = true;
    }
    const old = new Set(this.parts.map((p) => p.geometry));
    this.parts[0].geometry = visualGeometry("human-torso_lod0", () =>
      this.parts[0].geometry.clone(),
    );
    this.parts[1].geometry = visualGeometry("human-head_lod0", () =>
      this.parts[1].geometry.clone(),
    ).scale(2, 2, 2);
    this.parts[7].geometry = visualGeometry("human-hand_lod0", () =>
      this.parts[7].geometry.clone(),
    );
    this.parts[8].geometry = visualGeometry("human-boot_lod0", () =>
      this.parts[8].geometry.clone(),
    );
    const skin = this.parts[1].material as THREE.MeshStandardMaterial;
    skin.vertexColors = !!this.parts[1].geometry.getAttribute("color");
    skin.needsUpdate = true;
    const limb = visualGeometry("human-limb_lod0", () =>
      this.parts[2].geometry.clone(),
    );
    for (const index of [2, 3, 4, 5]) this.parts[index].geometry = limb;
    // One draw at distance retains a head, shoulders, arms and separate legs.
    // Bake the same metre proportions used by the articulated near resident.
    const distantParts: THREE.BufferGeometry[] = [];
    const add = (name: string, p: number[], s: number[], tint = 0xffffff) => {
      const g = visualGeometry(`${name}_lod2`, () => boxFallback(name));
      g.scale(s[0], s[1], s[2]).translate(p[0], p[1], p[2]);
      const authoredColor = g.getAttribute("color");
      for (const key of Object.keys(g.attributes))
        if (!["position", "normal", "uv"].includes(key)) g.deleteAttribute(key);
      const color = new THREE.Color(tint),
        values = new Float32Array(g.attributes.position.count * 3);
      for (let i = 0; i < g.attributes.position.count; i++) {
        const shade = color.clone();
        if (authoredColor)
          shade.multiply(
            new THREE.Color().fromBufferAttribute(authoredColor, i),
          );
        shade.toArray(values, i * 3);
      }
      g.setAttribute("color", new THREE.BufferAttribute(values, 3));
      g.setAttribute(
        "clothMask",
        new THREE.BufferAttribute(
          new Float32Array(g.attributes.position.count).fill(
            tint === 0xffffff ? 1 : 0,
          ),
          1,
        ),
      );
      distantParts.push(g);
    };
    add("human-torso", [0, 2.55, 0], [1.65, 1.85, 0.9]);
    add("human-head", [0, 4.05, 0], [0.8, 0.9, 0.76], 0xe9bd87);
    for (const side of [-1, 1]) {
      add("human-limb", [side * 1.08, 2.55, 0], [0.5, 1.7, 0.6]);
      add("human-limb", [side * 0.45, 0.9, 0], [0.55, 1.8, 0.65], 0x34302c);
      add("human-boot", [side * 0.45, 0.18, 0], [0.52, 0.58, 0.62], 0x34302c);
      add("human-hand", [side * 1.08, 1.5, 0], [0.55, 0.55, 0.6], 0xe9bd87);
    }
    const silhouette = mergeGeometries(distantParts)!;
    distantParts.forEach((g) => g.dispose());
    silhouette.translate(0, -2, 0).scale(1 / 1.7, 1 / 4, 1 / 0.9);
    old.add(this.distant.geometry);
    this.distant.geometry = silhouette;
    const distantMaterial = (
      this.distant.material as THREE.MeshStandardMaterial
    ).clone();
    distantMaterial.vertexColors = true;
    const original = distantMaterial.onBeforeCompile;
    distantMaterial.onBeforeCompile = (shader, renderer) => {
      original(shader, renderer);
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          "#include <common>\nattribute float clothMask;",
        )
        .replace(
          "#include <color_vertex>",
          "#include <color_vertex>\n#ifdef USE_INSTANCING_COLOR\nvColor.rgb=mix(color.rgb,vColor.rgb,clothMask);\n#endif",
        );
    };
    distantMaterial.customProgramCacheKey = () => "resident-clothing-mask-v1";
    this.distant.material = distantMaterial;
    for (const g of old)
      if (
        !this.parts.some((p) => p.geometry === g) &&
        this.distant.geometry !== g
      )
        g.dispose();
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
      far = 0;
    if (viewCamera)
      this.frustum.setFromProjectionMatrix(
        this.projection.multiplyMatrices(
          viewCamera.projectionMatrix,
          viewCamera.matrixWorldInverse,
        ),
      );
    const dancing = discoActive(snap.lasers ?? []);
    for (const c of snap.civilians ?? []) {
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
        sad ? 0.695 : 0.37,
        0.045,
        0.05,
        0.035,
      );
      place(
        6,
        n * 2 + 1,
        0.14,
        sad ? 3.774 : 4.19,
        sad ? 0.695 : 0.37,
        0.045,
        0.05,
        0.035,
      );
      n++;
    }
    this.distant.count = far;
    this.distant.instanceMatrix.clearUpdateRanges();
    if (far) this.distant.instanceMatrix.addUpdateRange(0, far * 16);
    this.distant.instanceMatrix.needsUpdate = true;
    this.distant.instanceColor!.needsUpdate = !!far;
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
    this.distant.count = 0;
    for (const mesh of this.parts) mesh.count = 0;
  }
}
