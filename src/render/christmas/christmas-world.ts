import * as THREE from "three";
import type { Entity, Explosion, WorldData } from "../../types";
import toiletManifest from "../../world/toilet-manifest.json" with { type: "json" };
import { XMAS } from "../../christmas";
import {
  candyCane,
  christmasTree,
  festiveMaterials,
  glowTexture,
  santaHat,
  snowman,
  wreath,
  bow,
} from "./costumes";
import type { FestiveParticles } from "./festive-particles";

interface Ground {
  sample(x: number, z: number): number;
  waterSurface(x: number, z: number): number | undefined;
}

const TREE_HEIGHT = 30;
const CAROLERS = 8;

/** Simple spatial test: is (x, z) at least `clear` metres from every block? */
class Clearance {
  private cells = new Map<string, Entity[]>();
  constructor(entities: readonly Entity[]) {
    for (const e of entities) {
      if (e.visual) continue;
      const key = `${Math.floor(e.p[0] / 64)},${Math.floor(e.p[2] / 64)}`;
      let list = this.cells.get(key);
      if (!list) this.cells.set(key, (list = []));
      list.push(e);
    }
  }
  free(x: number, z: number, clear: number) {
    const cx = Math.floor(x / 64),
      cz = Math.floor(z / 64);
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++)
        for (const e of this.cells.get(`${cx + dx},${cz + dz}`) ?? []) {
          const ox = Math.max(0, Math.abs(x - e.p[0]) - e.s[0]),
            oz = Math.max(0, Math.abs(z - e.p[2]) - e.s[2]);
          if (ox * ox + oz * oz < clear * clear) return false;
        }
    return true;
  }
}

/** Finds a flat, dry, open spot near (x, z), or undefined. */
function openSpot(
  ground: Ground,
  clearance: Clearance,
  x: number,
  z: number,
  clear: number,
  reach: number,
  size: number,
  salt = 0,
) {
  for (let ring = 0; ring * 6 <= reach; ring++) {
    const r = ring * 6,
      steps = Math.max(1, Math.round((r * Math.PI * 2) / 6));
    for (let k = 0; k < steps; k++) {
      const a = (k / steps) * Math.PI * 2 + salt,
        px = x + Math.cos(a) * r,
        pz = z + Math.sin(a) * r;
      if (px < 20 || pz < 20 || px > size - 20 || pz > size - 20) continue;
      if (!clearance.free(px, pz, clear)) continue;
      const h = ground.sample(px, pz);
      if (h < 3 || ground.waterSurface(px, pz) !== undefined) continue;
      const slope = Math.max(
        Math.abs(ground.sample(px + clear, pz) - ground.sample(px - clear, pz)),
        Math.abs(ground.sample(px, pz + clear) - ground.sample(px, pz - clear)),
      );
      if (slope > clear * 0.5) continue;
      return new THREE.Vector3(px, h, pz);
    }
  }
  return undefined;
}

const blastRadius = (e: Explosion) =>
  e.profile?.damageRadius ?? (e.kind === "nuke" ? 300 : e.kind === "blast" ? 30 : 12);

interface Toppler {
  root: THREE.Object3D;
  base: THREE.Vector3;
  radius: number;
  /** Seconds since it was knocked over, or -1 while standing. */
  fallen: number;
  axis: THREE.Vector3;
}

/**
 * Everything festive that stands in the world rather than on a model: the
 * town Christmas tree and its carolers, snowmen, frozen lakes, sea ice, the
 * portal toilet's wreath and bow, the Pineapple God's Santa hat and
 * candy cane, and hell's naughty list. All of it is cosmetic: blasts knock it
 * over or shatter it, and a reload stands it back up.
 */
export class ChristmasWorld {
  readonly group = new THREE.Group();
  private tree?: Toppler;
  private star?: THREE.Object3D;
  private starVelocity = new THREE.Vector3();
  private starFree = false;
  private carolers: Toppler[] = [];
  private snowmen: Toppler[] = [];
  private lakes: { mesh: THREE.Mesh; x: number; z: number; r: number; level: number }[] = [];
  private floes?: THREE.InstancedMesh;
  private floeData: { x: number; z: number; r: number; yaw: number; alive: boolean }[] = [];
  private floeDirty = true;
  private ownerDecor: { object: THREE.Object3D; ids: number[] }[] = [];
  private removedSize = -1;
  private dummy = new THREE.Object3D();
  private tmp = new THREE.Vector3();
  constructor(
    readonly world: WorldData,
    private ground: Ground,
    private particles: FestiveParticles,
  ) {
    this.group.name = "christmas-world";
    if (world.realm === "hell") {
      this.addNaughtyList();
      return;
    }
    const clearance = new Clearance(world.entities);
    this.addTownTree(clearance);
    this.addSnowmen(clearance);
    this.addLakeIce();
    this.addSeaIce();
    this.addToiletDecor();
    this.addGodDecor();
  }

  private addTownTree(clearance: Clearance) {
    const towns = this.world.sites.filter((s) => s.kind === "hamlet");
    towns.sort(
      (a, b) =>
        Number(!!b.town) - Number(!!a.town) || b.assemblies.length - a.assemblies.length,
    );
    const site = towns[0] ?? this.world.sites.find((s) => s.kind === "castle");
    if (!site) return;
    const spot = openSpot(this.ground, clearance, site.p[0], site.p[2], 16, Math.max(80, site.radius), this.world.size);
    if (!spot) return;
    const tree = christmasTree(TREE_HEIGHT);
    tree.position.copy(spot).y -= 0.3;
    this.group.add(tree);
    this.star = tree.getObjectByName("star");
    this.tree = { root: tree, base: spot.clone(), radius: 12, fallen: -1, axis: new THREE.Vector3(1, 0, 0) };
    // Garland bulbs spiralling round the tree.
    const bulbs = 90,
      positions = new Float32Array(bulbs * 3),
      colors = new Float32Array(bulbs * 3),
      color = new THREE.Color();
    for (let i = 0; i < bulbs; i++) {
      const t = i / bulbs,
        y = TREE_HEIGHT * (0.15 + t * 0.78),
        r = TREE_HEIGHT * 0.3 * (1 - t * 0.85) * 0.95,
        a = t * Math.PI * 2 * 6;
      positions.set([Math.cos(a) * r, y, Math.sin(a) * r], i * 3);
      color.set(XMAS.bulbs[i % XMAS.bulbs.length]);
      colors.set([color.r, color.g, color.b], i * 3);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const garland = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({
        size: 1.6,
        map: glowTexture(),
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
        toneMapped: false,
      }),
    );
    garland.name = "garland";
    tree.add(garland);
    // A ring of villagers in Santa hats singing carols round the tree.
    const f = festiveMaterials();
    const coats = ["#5b3d7a", "#2f5f8a", "#7a5532", "#476b3a", "#8a3a3a"].map(
      (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9 }),
    );
    const skin = new THREE.MeshStandardMaterial({ color: "#e2b08a", roughness: 0.9 });
    for (let i = 0; i < CAROLERS; i++) {
      const a = (i / CAROLERS) * Math.PI * 2,
        x = spot.x + Math.cos(a) * 15,
        z = spot.z + Math.sin(a) * 15;
      const singer = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.55, 1.5, 8), coats[i % coats.length]);
      body.position.y = 0.75;
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), skin);
      head.position.y = 1.8;
      const mouth = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 4), f.coal);
      mouth.position.set(0, 1.72, 0.28);
      mouth.name = "mouth";
      const book = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.32, 0.05), f.deepRed);
      book.position.set(0, 1.25, 0.5);
      book.rotation.x = -0.6;
      const hat = santaHat(0.3, 0.6);
      hat.position.y = 2.0;
      for (const part of [body, head, book]) part.castShadow = true;
      singer.add(body, head, mouth, book, hat);
      singer.position.set(x, this.ground.sample(x, z), z);
      singer.rotation.y = Math.atan2(spot.x - x, spot.z - z);
      singer.userData.phase = i * 0.7;
      this.group.add(singer);
      this.carolers.push({ root: singer, base: singer.position.clone(), radius: 1, fallen: -1, axis: new THREE.Vector3(1, 0, 0) });
    }
  }

  private addSnowmen(clearance: Clearance) {
    const homes = this.world.sites.filter((s) =>
      ["hamlet", "farm", "windmill", "watermill", "harbor", "logging"].includes(s.kind),
    );
    let salt = 0;
    for (const site of homes.slice(0, 40)) {
      for (let k = 0; k < (site.town ? 3 : 1); k++) {
        const spot = openSpot(this.ground, clearance, site.p[0], site.p[2], 4, Math.max(40, site.radius), this.world.size, salt += 1.3);
        if (!spot) continue;
        const man = snowman();
        man.position.copy(spot).y -= 0.15;
        man.rotation.y = salt * 2.1;
        this.group.add(man);
        this.snowmen.push({ root: man, base: spot, radius: 1.2, fallen: -1, axis: new THREE.Vector3(1, 0, 0) });
      }
    }
  }

  private addLakeIce() {
    const ice = new THREE.MeshStandardMaterial({
      color: "#cfe5ef",
      roughness: 0.18,
      metalness: 0.15,
      emissive: "#16303d",
      emissiveIntensity: 0.25,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    for (const lake of this.world.lakes ?? []) {
      if (lake.outline.length < 3) continue;
      const shape = new THREE.Shape(lake.outline.map(([x, z]) => new THREE.Vector2(x, -z)));
      const geometry = new THREE.ShapeGeometry(shape);
      geometry.rotateX(-Math.PI / 2);
      const mesh = new THREE.Mesh(geometry, ice);
      mesh.position.y = lake.level + 0.12;
      mesh.receiveShadow = true;
      mesh.name = "lake-ice";
      this.group.add(mesh);
      this.lakes.push({ mesh, x: lake.center[0], z: lake.center[1], r: lake.radius, level: lake.level });
    }
  }

  private addSeaIce() {
    const size = this.world.size;
    let n = 7;
    const random = () => ((n = (n * 16807) % 2147483647) / 2147483647);
    for (let z = 60; z < size - 60 && this.floeData.length < 220; z += 110)
      for (let x = 60; x < size - 60 && this.floeData.length < 220; x += 110) {
        const px = x + (random() - 0.5) * 90,
          pz = z + (random() - 0.5) * 90,
          h = this.ground.sample(px, pz);
        if (h > -2 || h < -16 || random() < 0.45) continue;
        this.floeData.push({ x: px, z: pz, r: 5 + random() * 14, yaw: random() * 6.3, alive: true });
      }
    if (!this.floeData.length) return;
    const geometry = new THREE.CylinderGeometry(1, 0.9, 1, 7);
    const position = geometry.attributes.position;
    for (let i = 0; i < position.count; i++) {
      const a = Math.atan2(position.getZ(i), position.getX(i)),
        k = 0.8 + 0.25 * Math.sin(a * 3 + 1) * Math.cos(a * 2);
      position.setX(i, position.getX(i) * k);
      position.setZ(i, position.getZ(i) * k);
    }
    geometry.computeVertexNormals();
    this.floes = new THREE.InstancedMesh(
      geometry,
      new THREE.MeshStandardMaterial({ color: "#eef6fb", roughness: 0.55 }),
      this.floeData.length,
    );
    this.floes.receiveShadow = true;
    this.floes.name = "sea-ice";
    this.floes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.group.add(this.floes);
  }

  private addToiletDecor() {
    const portal = this.world.portal;
    if (!portal?.base) return;
    const roles = new Map(toiletManifest.owners.map((o) => [o.ordinal, o.role]));
    const ids = (role: string) =>
      this.world.entities
        .filter((e) => e.visual?.modelOwner !== undefined && roles.get(e.visual.modelOwner) === role)
        .map((e) => e.id);
    const frame = new THREE.Group();
    frame.position.fromArray(portal.base);
    frame.rotation.y = portal.yaw ?? 0;
    this.group.add(frame);
    const w = wreath(48);
    w.position.set(0, 285, -46);
    frame.add(w);
    const b = bow(70, festiveMaterials().red);
    b.position.set(-14, 352, -110);
    frame.add(b);
    this.ownerDecor.push({ object: w, ids: ids("lid") }, { object: b, ids: ids("tank") });
  }

  private addGodDecor() {
    const site = this.world.sites.find((s) => s.kind === "pineapple-god");
    if (!site) return;
    const figure = this.world.entities.filter((e) => e.visual?.role === "figure");
    if (!figure.length) return;
    let crown = figure[0];
    for (const e of figure) if (e.p[1] + e.s[1] > crown.p[1] + crown.s[1]) crown = e;
    // Measured from the statue mesh (local space, facing +z): the top of the
    // head under the leaf crown. The collision boxes are too coarse for this.
    const yaw = site.yaw ?? 0;
    const facing = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const head = new THREE.Vector3(0, 850, -80)
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw)
      .add(new THREE.Vector3().fromArray(site.p));
    // A big Santa hat pulled down over the crown, tip flopping backward.
    const hat = santaHat(98, 330);
    hat.position.copy(head);
    hat.rotation.y = yaw + Math.PI;
    // A roomier cone swallows the leaf crown instead of being pierced by it.
    hat.children[0].scale.set(1.35, 1, 1.35);
    this.group.add(hat);
    const top = crown.p[1] + crown.s[1];
    const crownIds = figure
      .filter((e) => e.p[1] + e.s[1] > top - 60)
      .map((e) => e.id);
    this.ownerDecor.push({ object: hat, ids: crownIds });
    // A giant candy cane propped beside the throne.
    const right = new THREE.Vector3(facing.z, 0, -facing.x);
    const caneAt = new THREE.Vector3(site.p[0], 0, site.p[2])
      .addScaledVector(right, 330)
      .addScaledVector(facing, 120);
    const cane = candyCane(520, 22);
    cane.position.set(caneAt.x, this.ground.sample(caneAt.x, caneAt.z) - 10, caneAt.z);
    cane.rotation.set(0, yaw + Math.PI / 2, 0.12);
    this.group.add(cane);
    const throne = this.world.entities.filter((e) => e.visual?.role === "throne");
    let nearest: Entity | undefined;
    for (const e of throne)
      if (!nearest || (e.p[0] - caneAt.x) ** 2 + (e.p[2] - caneAt.z) ** 2 < (nearest.p[0] - caneAt.x) ** 2 + (nearest.p[2] - caneAt.z) ** 2)
        nearest = e;
    if (nearest && (nearest.p[0] - caneAt.x) ** 2 + (nearest.p[2] - caneAt.z) ** 2 < 140 * 140)
      this.ownerDecor.push({ object: cane, ids: [nearest.id] });
  }

  private addNaughtyList() {
    if (typeof document === "undefined") return;
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 512;
    const c = canvas.getContext("2d")!;
    c.fillStyle = "#f3e6c4";
    c.fillRect(0, 0, 1024, 512);
    c.strokeStyle = "#8e0c1f";
    c.lineWidth = 18;
    c.strokeRect(14, 14, 996, 484);
    c.fillStyle = "#8e0c1f";
    c.textAlign = "center";
    c.font = "bold 110px Georgia, serif";
    c.fillText("NAUGHTY LIST", 512, 150);
    c.font = "56px Georgia, serif";
    c.fillStyle = "#2a1a12";
    const names = ["1. The Pineapple Pilot  ✔", "2. Whoever flushed the portal  ✔", "3. Krampus Jets  ✔"];
    names.forEach((name, i) => c.fillText(name, 512, 260 + i * 80));
    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    const banner = new THREE.Group();
    const cloth = new THREE.Mesh(
      new THREE.PlaneGeometry(220, 110),
      new THREE.MeshStandardMaterial({
        map,
        side: THREE.DoubleSide,
        emissive: "#ffffff",
        emissiveMap: map,
        emissiveIntensity: 0.35,
      }),
    );
    banner.add(cloth);
    const f = festiveMaterials();
    for (const side of [-1, 1]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 150, 8), f.gold);
      pole.position.set(side * 113, -15, 0);
      banner.add(pole);
    }
    const spawn = new THREE.Vector3().fromArray(this.world.spawn);
    const toward = new THREE.Vector3().fromArray(this.world.castle).sub(spawn).setY(0);
    if (toward.lengthSq() < 1) toward.set(0, 0, 1);
    toward.normalize();
    banner.position.copy(spawn).addScaledVector(toward, 420);
    banner.position.y = spawn.y + 30;
    banner.lookAt(spawn.x, banner.position.y, spawn.z);
    banner.name = "naughty-list";
    this.group.add(banner);
  }

  /** Blasts knock over the tree, carolers and snowmen, and shatter ice. */
  explosion(e: Explosion) {
    const r = blastRadius(e);
    const [x, y, z] = e.p;
    const hit = (t: Toppler, extra = 0) => {
      if (t.fallen >= 0) return false;
      const dx = t.base.x - x,
        dz = t.base.z - z,
        dy = t.base.y - y;
      if (dx * dx + dz * dz + dy * dy * 0.25 > (r + t.radius + extra) ** 2) return false;
      this.topple(t, dx, dz);
      return true;
    };
    if (this.tree && hit(this.tree, 8)) {
      for (const c of this.carolers) if (c.fallen < 0) this.topple(c, c.base.x - this.tree.base.x, c.base.z - this.tree.base.z);
      this.particles.puff(this.tree.base.x, this.tree.base.y + TREE_HEIGHT * 0.5, this.tree.base.z, 14, 80);
    }
    for (const c of this.carolers) hit(c);
    for (const s of this.snowmen) if (hit(s)) this.particles.puff(s.base.x, s.base.y + 1.5, s.base.z, 2, 30);
    for (const lake of this.lakes) {
      if (!lake.mesh.visible) continue;
      if ((lake.x - x) ** 2 + (lake.z - z) ** 2 > (lake.r + r) ** 2 || y > lake.level + r) continue;
      lake.mesh.visible = false;
      this.shatter(x, lake.level, z, Math.min(lake.r, 60));
    }
    for (const floe of this.floeData)
      if (floe.alive && (floe.x - x) ** 2 + (floe.z - z) ** 2 < (r + floe.r) ** 2 && y < r + 5) {
        floe.alive = false;
        this.floeDirty = true;
        this.shatter(floe.x, 0.5, floe.z, floe.r);
      }
  }

  private shatter(x: number, y: number, z: number, radius: number) {
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * Math.PI * 2,
        r = Math.random() * radius;
      this.particles.emit(
        x + Math.cos(a) * r, y + 0.5, z + Math.sin(a) * r,
        Math.cos(a) * 6, 8 + Math.random() * 12, Math.sin(a) * 6,
        Math.random() < 0.5 ? "#dff1fa" : "#a9d4ea",
        0.9 + Math.random(), 1.8, 14, 0.2,
      );
    }
  }

  private topple(t: Toppler, dx: number, dz: number) {
    t.fallen = 0;
    // Fall away from the push: rotate about the horizontal axis across it.
    const length = Math.hypot(dx, dz) || 1;
    t.axis.set(dz / length, 0, -dx / length);
  }

  /** Vehicle position: a passing truck or low jet flattens snowmen. */
  update(
    dt: number,
    elapsed: number,
    vehicle: THREE.Vector3 | undefined,
    removed: ReadonlySet<number>,
  ) {
    if (vehicle)
      for (const s of this.snowmen)
        if (s.fallen < 0 && s.base.distanceToSquared(vehicle) < 7 * 7) {
          this.topple(s, s.base.x - vehicle.x, s.base.z - vehicle.z);
          this.particles.puff(s.base.x, s.base.y + 1.5, s.base.z, 2, 30);
        }
    const fall = (t: Toppler, speed: number) => {
      if (t.fallen < 0) return;
      t.fallen += dt;
      const angle = Math.min(Math.PI / 2, t.fallen * t.fallen * speed);
      t.root.quaternion.setFromAxisAngle(t.axis, angle);
    };
    if (this.tree) {
      fall(this.tree, 1.4);
      if (this.tree.fallen >= 0 && !this.starFree && this.star && this.tree.fallen > 0.9)
        this.releaseStar();
    }
    if (this.star && this.starFree && dt > 0) {
      const s = this.star,
        v = this.starVelocity;
      v.y -= 9.8 * dt;
      s.position.addScaledVector(v, dt);
      const floor = this.ground.sample(s.position.x, s.position.z) + TREE_HEIGHT * 0.06;
      if (s.position.y < floor) {
        s.position.y = floor;
        v.y = Math.abs(v.y) * 0.35;
        v.x *= 0.82;
        v.z *= 0.82;
        if (v.y < 1) v.y = 0;
      }
      // Roll like a wheel along the ground.
      const speed = Math.hypot(v.x, v.z);
      if (speed > 0.05) {
        s.rotation.y = Math.atan2(v.x, v.z) + Math.PI / 2;
        s.rotation.z -= (speed * dt) / (TREE_HEIGHT * 0.06);
      }
    }
    for (const c of this.carolers) {
      if (c.fallen >= 0) {
        fall(c, 6);
        continue;
      }
      // Sway and sing.
      const phase = elapsed * 2.4 + (c.root.userData.phase as number);
      c.root.position.y = c.base.y + Math.max(0, Math.sin(phase)) * 0.08;
      const mouth = c.root.getObjectByName("mouth");
      if (mouth) mouth.scale.y = 1 + Math.max(0, Math.sin(phase * 2.3)) * 1.6;
    }
    for (const s of this.snowmen) fall(s, 5);
    if (this.floes && (this.floeDirty || dt > 0)) {
      let n = 0;
      for (const floe of this.floeData) {
        if (!floe.alive) continue;
        this.dummy.position.set(floe.x, 0.25 + Math.sin(elapsed * 0.6 + floe.x) * 0.15, floe.z);
        this.dummy.rotation.set(Math.sin(elapsed * 0.5 + floe.z) * 0.02, floe.yaw + elapsed * 0.004, 0);
        this.dummy.scale.set(floe.r, 1, floe.r);
        this.dummy.updateMatrix();
        this.floes.setMatrixAt(n++, this.dummy.matrix);
      }
      this.floes.count = n;
      this.floes.instanceMatrix.needsUpdate = true;
      this.floeDirty = false;
    }
    if (removed.size !== this.removedSize) {
      this.removedSize = removed.size;
      for (const decor of this.ownerDecor)
        decor.object.visible = !decor.ids.some((id) => removed.has(id));
    }
  }

  private releaseStar() {
    const star = this.star!,
      tree = this.tree!.root;
    star.getWorldPosition(this.tmp);
    tree.remove(star);
    this.group.add(star);
    star.position.copy(this.tmp);
    star.rotation.set(0, 0, 0);
    this.starFree = true;
    // Carry on in the direction the tree fell.
    const away = new THREE.Vector3(-this.tree!.axis.z, 0, this.tree!.axis.x);
    this.starVelocity.copy(away).multiplyScalar(9).setY(4);
  }

  /** Forces decorations to re-check destroyed owners (after loading a save). */
  invalidate() {
    this.removedSize = -1;
  }

  dispose() {
    this.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      mesh.geometry?.dispose();
    });
    this.group.removeFromParent();
  }
}
