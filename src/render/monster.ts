import { mergeGeometries as mergeMonsterGeometry } from "three/addons/utils/BufferGeometryUtils.js";
import * as THREE from "three";
import {
  monsterBodyQuarter,
  monsterQuarterCaps,
} from "./monster-fragment-geometry";
import { MONSTER_FRAGMENT_CENTERS } from "../monster-fragments";

let template: THREE.Group | undefined;
const cylinder = (
  a: THREE.Vector3,
  b: THREE.Vector3,
  radius: number,
  material: THREE.Material,
) => {
  const d = b.clone().sub(a);
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.8, radius, d.length(), 7),
    material,
  );
  mesh.position.copy(a).addScaledVector(d, 0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  mesh.castShadow = true;
  return mesh;
};
function build() {
  const g = new THREE.Group();
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const c = canvas.getContext("2d")!;
  c.fillStyle = "#b57524";
  c.fillRect(0, 0, 256, 256);
  for (let y = -20; y < 280; y += 26)
    for (let x = -20; x < 280; x += 28) {
      const offset = (Math.floor(y / 26) & 1) * 14;
      c.fillStyle = (x + y) % 3 ? "#d9992d" : "#e8ad3c";
      c.beginPath();
      c.moveTo(x + offset, y);
      c.lineTo(x + offset + 14, y + 13);
      c.lineTo(x + offset, y + 26);
      c.lineTo(x + offset - 14, y + 13);
      c.closePath();
      c.fill();
      c.strokeStyle = "#784718";
      c.lineWidth = 2;
      c.stroke();
    }
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  const gold = new THREE.MeshStandardMaterial({ map, roughness: 0.9 });
  const leaf = new THREE.MeshStandardMaterial({
    color: "#3a6930",
    roughness: 0.9,
    side: THREE.DoubleSide,
  });
  const limb = new THREE.MeshStandardMaterial({
    color: "#987126",
    roughness: 0.95,
  });
  const dark = new THREE.MeshStandardMaterial({
    color: "#21170f",
    roughness: 0.9,
  });
  const eye = new THREE.MeshStandardMaterial({
    color: "#f34924",
    emissive: "#631807",
    emissiveIntensity: 0.7,
  });
  const nativeEyes = new THREE.Group();
  nativeEyes.name = "native-eyes";
  nativeEyes.visible = false;
  g.add(nativeEyes);
  const ivory = new THREE.MeshStandardMaterial({
    color: "#e7dca9",
    roughness: 0.75,
  });
  const body = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 16), gold);
  body.position.y = 15;
  body.scale.set(9, 12, 8);
  body.castShadow = true;
  g.add(body);
  const crown = new THREE.Group();
  crown.name = "crown";
  crown.position.y = 26;
  for (let i = 0; i < 11; i++) {
    const a = (i * Math.PI * 2) / 11;
    const blade = new THREE.Mesh(
      new THREE.ConeGeometry(1.2, 9 + (i % 3) * 2, 4),
      leaf,
    );
    blade.position.set(Math.sin(a) * 2.8, 3.6, Math.cos(a) * 2.8);
    blade.rotation.z = Math.sin(a) * 0.36;
    blade.rotation.x = Math.cos(a) * 0.36;
    blade.castShadow = true;
    crown.add(blade);
  }
  g.add(crown);
  for (const sign of [-1, 1]) {
    const socket = new THREE.Mesh(new THREE.SphereGeometry(1.55, 9, 8), dark);
    socket.position.set(sign * 3.4, 18.5, 7.1);
    socket.scale.z = 0.55;
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.9, 8, 8), eye);
    pupil.position.set(sign * 3.4, 18.5, 8.15);
    pupil.scale.z = 0.45;
    nativeEyes.add(socket, pupil);
    g.add(
      cylinder(
        new THREE.Vector3(sign * 1.5, 21, 8),
        new THREE.Vector3(sign * 5.2, 19.6, 7.4),
        0.55,
        dark,
      ),
    );
    const arm = new THREE.Group();
    arm.name = sign < 0 ? "leftArm" : "rightArm";
    arm.position.set(sign * 7.5, 19, 0);
    arm.add(
      cylinder(
        new THREE.Vector3(),
        new THREE.Vector3(sign * 6.5, -7.5, 2),
        2.2,
        limb,
      ),
    );
    arm.add(
      cylinder(
        new THREE.Vector3(sign * 6.5, -7.5, 2),
        new THREE.Vector3(sign * 10, -15.5, 6),
        1.8,
        limb,
      ),
    );
    const fist = new THREE.Mesh(new THREE.SphereGeometry(2.1, 10, 8), limb);
    fist.position.set(sign * 10, -15.5, 6);
    fist.castShadow = true;
    arm.add(fist);
    for (let finger = -1; finger <= 1; finger++) {
      const claw = new THREE.Mesh(new THREE.ConeGeometry(0.48, 2.8, 5), ivory);
      claw.position.set(sign * 10 + finger * 1.2, -16.8, 7.3);
      claw.rotation.x = 0.7;
      arm.add(claw);
    }
    g.add(arm);
  }
  const mouth = new THREE.Mesh(
    new THREE.TorusGeometry(2.7, 0.6, 6, 12, Math.PI),
    dark,
  );
  mouth.position.set(0, 13.5, 8);
  mouth.rotation.z = Math.PI;
  g.add(mouth);
  for (const x of [-1.6, 0, 1.6]) {
    const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.52, 2.2, 5), ivory);
    tooth.position.set(x, 12.5, 8.4);
    tooth.rotation.z = Math.PI;
    g.add(tooth);
  }
  g.userData.googlyBounds = [0, 18.5, 0, 7, 5, 8.5];
  return g;
}
export function makeMonster() {
  template ??= build();
  return template.clone(true);
}

let distantTemplate: THREE.Group | undefined;
export function makeDistantMonster() {
  if (!distantTemplate) {
    distantTemplate = new THREE.Group();
    distantTemplate.userData.googlyBounds = [0, 18.5, 0, 7, 5, 8.5];
    const fruit = new THREE.Mesh(
      new THREE.SphereGeometry(1, 8, 6),
      new THREE.MeshLambertMaterial({ color: "#d3962e" }),
    );
    fruit.position.y = 15;
    fruit.scale.set(9, 12, 8);
    distantTemplate.add(fruit);
    const crown = new THREE.Mesh(
      new THREE.ConeGeometry(4, 11, 5),
      new THREE.MeshLambertMaterial({ color: "#3a6930" }),
    );
    crown.position.y = 30;
    distantTemplate.add(crown);
    const armMat = new THREE.MeshLambertMaterial({ color: "#8e6925" });
    for (const sign of [-1, 1]) {
      distantTemplate.add(
        cylinder(
          new THREE.Vector3(sign * 7, 18, 0),
          new THREE.Vector3(sign * 18, 3, 5),
          2,
          armMat,
        ),
      );
    }
  }
  return distantTemplate.clone(true);
}

/** Four shared draws for all distant enemies, including their disco transforms. */
export class DistantMonsterView {
  readonly group = new THREE.Group();
  private faceMesh?: THREE.InstancedMesh;
  private faceLocal = new THREE.Matrix4().compose(
    new THREE.Vector3(0, 18.5, 0),
    new THREE.Quaternion(),
    new THREE.Vector3(7, 5, 8.5),
  );
  readonly parts: THREE.InstancedMesh[];
  private local: THREE.Matrix4[];
  private matrix = new THREE.Matrix4();
  private count = 0;
  constructor(private capacity: number) {
    const template = makeDistantMonster();
    this.local = [];
    this.parts = template.children.map((child) => {
      const mesh = child as THREE.Mesh;
      mesh.updateMatrix();
      this.local.push(mesh.matrix.clone());
      const part = new THREE.InstancedMesh(
        mesh.geometry,
        mesh.material,
        capacity,
      );
      part.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      part.frustumCulled = false;
      part.count = 0;
      this.group.add(part);
      return part;
    });
  }
  get faces() {
    if (!this.faceMesh) {
      const material = new THREE.MeshBasicMaterial();
      material.visible = false;
      const mesh = new THREE.InstancedMesh(
        new THREE.BoxGeometry(2, 2, 2),
        material,
        this.capacity,
      );
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.faceMesh = mesh;
      this.group.add(mesh);
    }
    return this.faceMesh;
  }
  private finishFaces(eyes: boolean) {
    const mesh = this.faceMesh;
    if (!mesh) return;
    mesh.count = eyes ? this.count : 0;
    mesh.visible = eyes;
    mesh.instanceMatrix.clearUpdateRanges();
    if (mesh.count) mesh.instanceMatrix.addUpdateRange(0, mesh.count * 16);
    mesh.instanceMatrix.needsUpdate = true;
  }
  disposeFaces() {
    const mesh = this.faceMesh;
    if (!mesh) return;
    this.group.remove(mesh);
    mesh.dispose();
    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
    this.faceMesh = undefined;
  }
  begin(eyes = false) {
    this.count = 0;
    if (eyes) void this.faces;
  }
  add(root: THREE.Object3D) {
    root.updateMatrix();
    for (let i = 0; i < this.parts.length; i++)
      this.parts[i].setMatrixAt(
        this.count,
        this.matrix.multiplyMatrices(root.matrix, this.local[i]),
      );
    this.faceMesh?.setMatrixAt(
      this.count,
      this.matrix.multiplyMatrices(root.matrix, this.faceLocal),
    );
    this.count++;
  }
  finish(eyes = false) {
    this.finishFaces(eyes);
    for (const part of this.parts) {
      part.count = this.count;
      part.instanceMatrix.clearUpdateRanges();
      if (this.count) part.instanceMatrix.addUpdateRange(0, this.count * 16);
      part.instanceMatrix.needsUpdate = true;
    }
  }
}

/** Animated material/limb batches replace hundreds of cloned render hierarchies. */
export class NearMonsterView {
  readonly group = new THREE.Group();
  readonly parts: {
    mesh: THREE.InstancedMesh;
    limb: string;
    local: THREE.Matrix4;
  }[] = [];
  private faceMesh?: THREE.InstancedMesh;
  private count = 0;
  private matrix = new THREE.Matrix4();
  private pivot = new THREE.Object3D();
  private faceLocal = new THREE.Matrix4().compose(
    new THREE.Vector3(0, 18.5, 0),
    new THREE.Quaternion(),
    new THREE.Vector3(7, 5, 8.5),
  );
  constructor(private capacity: number) {
    const template = makeMonster();
    template.updateMatrixWorld(true);
    const groups = new Map<
      string,
      {
        limb: string;
        local: THREE.Matrix4;
        material: THREE.Material;
        geometries: THREE.BufferGeometry[];
      }
    >();
    for (const child of template.children) {
      const limb = child.name || "body";
      const local =
        child instanceof THREE.Group
          ? child.matrix.clone()
          : new THREE.Matrix4();
      const inverse = local.clone().invert();
      child.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        const material = o.material as THREE.Material,
          key = limb + material.uuid;
        let group = groups.get(key);
        if (!group)
          groups.set(key, (group = { limb, local, material, geometries: [] }));
        group.geometries.push(
          o.geometry
            .clone()
            .applyMatrix4(inverse.clone().multiply(o.matrixWorld)),
        );
      });
    }
    for (const g of groups.values()) {
      const geometry = mergeMonsterGeometry(g.geometries)!;
      for (const piece of g.geometries) piece.dispose();
      const mesh = new THREE.InstancedMesh(geometry, g.material, capacity);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(mesh);
      this.parts.push({ mesh, limb: g.limb, local: g.local });
    }
  }
  get faces() {
    if (!this.faceMesh) {
      const material = new THREE.MeshBasicMaterial();
      material.visible = false;
      const mesh = new THREE.InstancedMesh(
        new THREE.BoxGeometry(2, 2, 2),
        material,
        this.capacity,
      );
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.faceMesh = mesh;
      this.group.add(mesh);
    }
    return this.faceMesh;
  }
  private finishFaces(eyes: boolean) {
    const mesh = this.faceMesh;
    if (!mesh) return;
    mesh.count = eyes ? this.count : 0;
    mesh.visible = eyes;
    mesh.instanceMatrix.clearUpdateRanges();
    if (mesh.count) mesh.instanceMatrix.addUpdateRange(0, mesh.count * 16);
    mesh.instanceMatrix.needsUpdate = true;
  }
  disposeFaces() {
    const mesh = this.faceMesh;
    if (!mesh) return;
    this.group.remove(mesh);
    mesh.dispose();
    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
    this.faceMesh = undefined;
  }
  begin(eyes = false) {
    this.count = 0;
    if (eyes) void this.faces;
  }
  add(root: THREE.Object3D, left: number, right: number, crown: number) {
    root.updateMatrix();
    for (const part of this.parts) {
      this.pivot.matrix.copy(part.local);
      if (
        part.limb === "leftArm" ||
        part.limb === "rightArm" ||
        part.limb === "crown"
      ) {
        part.local.decompose(
          this.pivot.position,
          this.pivot.quaternion,
          this.pivot.scale,
        );
        this.pivot.rotation.z =
          part.limb === "leftArm"
            ? left
            : part.limb === "rightArm"
              ? right
              : crown;
        this.pivot.updateMatrix();
      }
      part.mesh.setMatrixAt(
        this.count,
        this.matrix.multiplyMatrices(root.matrix, this.pivot.matrix),
      );
    }
    this.faceMesh?.setMatrixAt(
      this.count,
      this.matrix.multiplyMatrices(root.matrix, this.faceLocal),
    );
    this.count++;
  }
  finish(eyes: boolean) {
    for (const { mesh, limb } of this.parts) {
      mesh.visible = limb !== "native-eyes" || !eyes;
      mesh.count = this.count;
      mesh.instanceMatrix.clearUpdateRanges();
      if (this.count) mesh.instanceMatrix.addUpdateRange(0, this.count * 16);
      mesh.instanceMatrix.needsUpdate = true;
    }
    this.finishFaces(eyes);
  }
}

/** Detached body, crown and two arms share material batches across all defeats. */
export class MonsterFragmentView {
  readonly group = new THREE.Group();
  private faceMesh?: THREE.InstancedMesh;
  private faceCount = 0;
  private faceMatrix = new THREE.Matrix4();
  private faceLocal = new THREE.Matrix4().compose(
    new THREE.Vector3(0, 3.5, 0),
    new THREE.Quaternion(),
    new THREE.Vector3(7, 5, 8.5),
  );
  private quarterFaceLocal = new THREE.Matrix4().compose(
    new THREE.Vector3(4, -2.5, 0),
    new THREE.Quaternion(),
    new THREE.Vector3(7, 5, 8.5),
  );
  private batches: {
    mesh: THREE.InstancedMesh;
    part: number;
    count: number;
  }[] = [];
  constructor(capacity: number) {
    const template = makeMonster();
    template.updateMatrixWorld(true);
    const groups = new Map<
      string,
      {
        part: number;
        material: THREE.Material;
        geometries: THREE.BufferGeometry[];
      }
    >();
    for (const child of template.children) {
      const part =
        child.name === "crown"
          ? 1
          : child.name === "leftArm"
            ? 2
            : child.name === "rightArm"
              ? 3
              : 0;
      const center = MONSTER_FRAGMENT_CENTERS[part];
      child.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        const material = o.material as THREE.Material;
        const key = `${part}:${material.uuid}`;
        let batch = groups.get(key);
        if (!batch)
          groups.set(key, (batch = { part, material, geometries: [] }));
        const worldGeometry = o.geometry.clone().applyMatrix4(o.matrixWorld);
        if (part === 0)
          for (let quarter = 4; quarter < 8; quarter++) {
            const quarterKey = `${quarter}:${material.uuid}`;
            let quarterBatch = groups.get(quarterKey);
            if (!quarterBatch)
              groups.set(
                quarterKey,
                (quarterBatch = { part: quarter, material, geometries: [] }),
              );
            const piece = monsterBodyQuarter(
                worldGeometry,
                quarter % 2 === 0,
                quarter < 6,
              ),
              origin = MONSTER_FRAGMENT_CENTERS[quarter];
            if (piece.getAttribute("position").count)
              quarterBatch.geometries.push(
                piece.translate(-origin[0], -origin[1], -origin[2]),
              );
            else piece.dispose();
          }
        batch.geometries.push(
          worldGeometry.translate(-center[0], -center[1], -center[2]),
        );
      });
    }
    const flesh = new THREE.MeshStandardMaterial({
      color: "#f7cc64",
      roughness: 0.95,
      side: THREE.DoubleSide,
    });
    for (let part = 4; part < 8; part++) {
      const center = MONSTER_FRAGMENT_CENTERS[part];
      groups.set(`${part}:flesh`, {
        part,
        material: flesh,
        geometries: [
          monsterQuarterCaps(part % 2 === 0, part < 6).translate(
            -center[0],
            -center[1],
            -center[2],
          ),
        ],
      });
    }
    for (const batch of groups.values()) {
      if (!batch.geometries.length) continue;
      const geometry = mergeMonsterGeometry(batch.geometries)!;
      for (const g of batch.geometries) g.dispose();
      const mesh = new THREE.InstancedMesh(geometry, batch.material, capacity);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      mesh.count = 0;
      this.group.add(mesh);
      this.batches.push({ mesh, part: batch.part, count: 0 });
    }
  }
  get faces() {
    if (!this.faceMesh) {
      const material = new THREE.MeshBasicMaterial();
      material.visible = false;
      const mesh = new THREE.InstancedMesh(
        new THREE.BoxGeometry(2, 2, 2),
        material,
        this.batches[0].mesh.instanceMatrix.count,
      );
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.faceMesh = mesh;
      this.group.add(mesh);
    }
    return this.faceMesh;
  }
  disposeFaces() {
    const mesh = this.faceMesh;
    if (!mesh) return;
    this.group.remove(mesh);
    mesh.dispose();
    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
    this.faceMesh = undefined;
  }
  begin(eyes = false) {
    this.faceCount = 0;
    if (eyes) void this.faces;
    for (const batch of this.batches) batch.count = 0;
  }
  add(part: number, root: THREE.Object3D) {
    root.updateMatrix();
    if ((part === 0 || part === 4) && this.faceMesh)
      this.faceMesh.setMatrixAt(
        this.faceCount++,
        this.faceMatrix.multiplyMatrices(
          root.matrix,
          part === 4 ? this.quarterFaceLocal : this.faceLocal,
        ),
      );
    for (const batch of this.batches)
      if (batch.part === part)
        batch.mesh.setMatrixAt(batch.count++, root.matrix);
  }
  finish(eyes = false) {
    const face = this.faceMesh;
    if (face) {
      face.count = eyes ? this.faceCount : 0;
      face.visible = eyes;
      face.instanceMatrix.clearUpdateRanges();
      if (face.count) face.instanceMatrix.addUpdateRange(0, face.count * 16);
      face.instanceMatrix.needsUpdate = true;
    }
    for (const batch of this.batches) {
      batch.mesh.count = batch.count;
      batch.mesh.instanceMatrix.clearUpdateRanges();
      if (batch.count)
        batch.mesh.instanceMatrix.addUpdateRange(0, batch.count * 16);
      batch.mesh.instanceMatrix.needsUpdate = true;
    }
  }
}
