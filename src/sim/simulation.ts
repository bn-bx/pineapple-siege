import {
  DEFAULT_DESTRUCTION,
  normalizeDestruction,
  nukeProfile,
  laserProfile,
  resolvedLaserProfile,
  BODY_LIMITS,
  CANNON_LIMITS,
  COSMETIC_SCALE,
  RUBBLE_LIMITS,
} from "../destruction-settings";
import RAPIER from "@dimforge/rapier3d-compat";
import { CONFIG, LASER, WEAPONS, clamp, lerp } from "../config";
import { Terrain } from "./terrain";
import { Monsters } from "./monsters";
import { MONSTER_BODY_HEIGHT } from "./monsters";
import { discoActive } from "../disco";
import { consolidateRubble } from "./rubble";
import type {
  Vec3,
  Quat,
  WorldData,
  Entity,
  InputState,
  PlaneState,
  BodyView,
  Ruin,
  SaveSnapshot,
  WorkerMessage,
  SimulationSnapshot,
  Explosion,
  WeaponId,
  NukeYield,
  DestructionJob,
  FragmentEffect,
  DestructionSettings,
  BlastProfile,
  ContactSound,
  ProjectileWeapon,
  LaserStrike,
  LaserWork,
} from "../types";
const vec = (p: Vec3) => ({ x: p[0], y: p[1], z: p[2] });
const arr = (p: { x: number; y: number; z: number }): Vec3 => [p.x, p.y, p.z];
const identity = { x: 0, y: 0, z: 0, w: 1 };
const distance = (a: Vec3, b: Vec3) =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
function rand(n: number) {
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}
interface Moving {
  view: BodyView;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  age: number;
  lastImpact: number;
  ccd: boolean;
}
interface Shot {
  profile?: BlastProfile;
  weapon: ProjectileWeapon;
  yield: NukeYield;
  id: number;
  p: Vec3;
  v: Vec3;
  age: number;
}
export class Simulation {
  private soundCells = new Set<string>();
  private soundTick = -1;
  private contact(
    p: Vec3,
    material: ContactSound["material"],
    energy: number,
    action: ContactSound["action"],
  ) {
    const tick = Math.floor(this.tick / 6);
    if (tick !== this.soundTick) {
      this.soundCells.clear();
      this.soundTick = tick;
    }
    const key = `${Math.floor(p[0] / 32)},${Math.floor(p[2] / 32)},${material},${action}`;
    if (this.soundCells.has(key) || this.soundCells.size >= 8) return;
    this.soundCells.add(key);
    this.emit({ type: "contactSound", p: [...p], material, energy, action });
  }
  readonly terrain: Terrain;
  readonly monsters: Monsters;
  get monsterCount() { return this.monsters.count; }
  setMonsterCount(value: number) { this.monsters.setCount(value); this.bump(); }
  readonly physics: RAPIER.World;
  readonly removed = new Set<number>();
  readonly ruins = new Map<number, Ruin>();
  readonly moving = new Map<number, Moving>();
  readonly entityColliders = new Map<number, RAPIER.Collider>();
  private colliderMoving = new Map<number, number>();
  private colliderEntities = new Map<number, number>();
  private ruinColliders = new Map<number, RAPIER.Collider>();
  private terrainColliders = new Map<number, RAPIER.Collider>();
  private assemblies = new Map<string, number[]>();
  readonly projectiles: Shot[] = [];
  readonly events = new RAPIER.EventQueue(true);
  input: InputState = {
    x: 0,
    y: 0,
    throttle: 0,
    bank: 0,
    boost: false,
    fire: false,
  };
  plane: PlaneState;
  hour = 15.5;
  holdTime = false;
  tick = 0;
  time = 0;
  revision = 0;
  paused = true;
  weapon: WeaponId = "cannon";
  nukeYield: NukeYield = "local";
  destruction = { ...DEFAULT_DESTRUCTION };
  get bodyLimit() {
    return BODY_LIMITS[this.destruction.bodies];
  }
  get fragmentLimit() {
    return CANNON_LIMITS[this.destruction.fragments];
  }
  get rubbleLimit() {
    return RUBBLE_LIMITS[this.destruction.rubble];
  }
  setDestruction(value: DestructionSettings) {
    this.destruction = normalizeDestruction(value);
    if (this.destruction.noCooldown)
      this.cooldowns = { cannon: 0, nuke: 0, laser: 0 };
    // Lower budgets settle gradually in step(), rather than blocking the settings UI.
  }
  cooldowns = { cannon: 0, nuke: 0, laser: 0 };
  readonly lasers: LaserStrike[] = [];
  readonly laserWork = new Map<number, LaserWork>();
  readonly laserSupport = new Set<string>();
  readonly vaporized = new Set<number>();
  private burnZones: { p: Vec3; radius: number }[] = [];
  readonly pendingJobs: DestructionJob[] = [];
  destructionMS = 0;
  private ruinCells = new Map<number, Set<number>>();
  private entityCells = new Map<number, number[]>();
  shots = 0;
  physicsMS = 0;
  private nextBody = 100000;
  private nextShot = 1;
  private throttle = 0.48;
  private changedRemoved: number[] = [];
  private changedSettled: Ruin[] = [];
  private changedRubbleRemoved: number[] = [];
  private aim: Vec3 | null = null;
  private dirtyAssemblies = new Set<string>();
  constructor(
    readonly world: WorldData,
    heights: Float32Array,
    readonly emit: (message: WorkerMessage) => void,
    save?: SaveSnapshot,
  ) {
    this.terrain = new Terrain(heights);
    this.monsters = new Monsters(world, this.terrain, save?.monsters);
    this.physics = new RAPIER.World({ x: 0, y: -18, z: 0 });
    this.physics.timestep = CONFIG.dt;
    this.physics.numSolverIterations = 4;
    this.plane = {
      p: [...world.spawn],
      v: [0, 0, 0],
      yaw: 0.65,
      pitch: -0.09,
      roll: 0,
      speed: 62,
      crashed: 0,
      boundary: false,
    };
    if (save) {
      this.destruction = normalizeDestruction(save.destruction);
      this.terrain.restore(save.terrain, save.laserDry);
      this.lasers.push(
        ...structuredClone(save.lasers).map((l) => ({
          ...l,
          profile: resolvedLaserProfile(l.profile),
        })),
      );
      for (const work of save.laserWork)
        this.laserWork.set(work.section, {
          ...structuredClone(work),
          targets: work.targets.map((t) => ({
            ...t,
            radius: t.radius ?? LASER.radius,
            depth: t.depth ?? LASER.depth,
          })),
        });
      for (const name of save.laserSupport) this.laserSupport.add(name);
      for (const id of save.vaporized) this.vaporized.add(id);
      this.cooldowns.laser = save.laserCooldown;
      this.nextShot = Math.max(1, ...this.lasers.map((l) => l.id + 1));
      for (const id of save.removed) this.removed.add(id);
      this.hour = save.hour;
      this.revision = save.revision;
      this.pendingJobs.push(...structuredClone(save.pendingJobs || []));
      for (const r of save.ruins) {
        this.ruins.set(r.id, r);
        this.indexRuin(r);
        this.nextBody = Math.max(this.nextBody, r.id + 1);
      }
    }
    for (const e of world.entities) {
      for (
        let z = clamp(Math.floor((e.p[2] - e.s[2]) / 64), 0, 31);
        z <= clamp(Math.floor((e.p[2] + e.s[2]) / 64), 0, 31);
        z++
      )
        for (
          let x = clamp(Math.floor((e.p[0] - e.s[0]) / 64), 0, 31);
          x <= clamp(Math.floor((e.p[0] + e.s[0]) / 64), 0, 31);
          x++
        ) {
          let key = z * 32 + x,
            list = this.entityCells.get(key);
          if (!list) this.entityCells.set(key, (list = []));
          list.push(e.id);
        }

      if (e.assembly) {
        let ids = this.assemblies.get(e.assembly);
        if (!ids) this.assemblies.set(e.assembly, (ids = []));
        ids.push(e.id);
      }
      if (!this.removed.has(e.id)) this.addEntityCollider(e);
    }
    for (const r of this.ruins.values()) this.addRuinCollider(r);
    this.ensureTerrain();
    if (this.lasers.length) this.updateLasers(0);
    this.physics.step();
    this.respawn();
  }
  private addEntityCollider(e: Entity) {
    const d =
      e.kind === "tree"
        ? RAPIER.ColliderDesc.cylinder(e.s[1], Math.min(2.2, e.s[0] * 0.65))
        : RAPIER.ColliderDesc.cuboid(...e.s);
    d.setTranslation(...e.p).setFriction(0.8);
    const c = this.physics.createCollider(d);
    this.entityColliders.set(e.id, c);
    this.colliderEntities.set(c.handle, e.id);
  }
  private addRuinCollider(r: Ruin) {
    const d = RAPIER.ColliderDesc.cuboid(...r.s)
      .setTranslation(...r.p)
      .setRotation({ x: r.q[0], y: r.q[1], z: r.q[2], w: r.q[3] })
      .setFriction(0.95);
    this.ruinColliders.set(r.id, this.physics.createCollider(d));
  }
  private buildTerrainCollider(id: number) {
    const old = this.terrainColliders.get(id);
    if (old) this.physics.removeCollider(old, true);
    const cx = id % 32,
      cz = Math.floor(id / 32),
      heights = new Float32Array(33 * 33);
    // Rapier heightfields are column-major; their triangle diagonal matches our sampler.
    for (let z = 0; z <= 32; z++)
      for (let x = 0; x <= 32; x++)
        heights[x * 33 + z] =
          this.terrain.heights[(cz * 32 + z) * 1025 + cx * 32 + x];
    const descriptor = RAPIER.ColliderDesc.heightfield(
      32,
      32,
      heights,
      { x: 64, y: 1, z: 64 },
      RAPIER.HeightFieldFlags.FIX_INTERNAL_EDGES,
    )
      .setTranslation(cx * 64 + 32, 0, cz * 64 + 32)
      .setFriction(0.85);
    this.terrainColliders.set(id, this.physics.createCollider(descriptor));
  }
  private ensureTerrain() {
    const wanted = new Set<number>();
    const near = (p: Vec3, r: number) => {
      for (
        let z = clamp(Math.floor((p[2] - r) / 64), 0, 31);
        z <= clamp(Math.floor((p[2] + r) / 64), 0, 31);
        z++
      )
        for (
          let x = clamp(Math.floor((p[0] - r) / 64), 0, 31);
          x <= clamp(Math.floor((p[0] + r) / 64), 0, 31);
          x++
        )
          wanted.add(z * 32 + x);
    };
    near(this.plane.p, 85);
    for (const m of this.moving.values()) near(m.view.p, 38);
    for (const s of this.projectiles) near(s.p, 12);
    for (const id of wanted)
      if (!this.terrainColliders.has(id)) this.buildTerrainCollider(id);
    for (const [id, c] of this.terrainColliders)
      if (!wanted.has(id)) {
        this.physics.removeCollider(c, true);
        this.terrainColliders.delete(id);
      }
  }
  private bump() {
    this.revision++;
  }
  private flush(
    terrain?: ReturnType<Terrain["crater"]>,
    flood?: Uint32Array,
    dry?: Uint32Array,
  ) {
    if (
      !terrain &&
      !this.changedRemoved.length &&
      !this.changedSettled.length &&
      !this.changedRubbleRemoved.length
    )
      return;
    if (terrain) terrain.revision = this.revision;
    this.emit({
      type: "delta",
      revision: this.revision,
      removed: this.changedRemoved.splice(0),
      // Compaction can remove or replace queued pieces before this update.
      settled: this.changedSettled
        .splice(0)
        .filter((r) => this.ruins.get(r.id) === r),
      rubbleRemoved: this.changedRubbleRemoved.splice(0),
      terrain,
      flood,
      dry,
    });
  }
  private removeEntity(e: Entity) {
    if (this.removed.has(e.id)) return;
    this.removed.add(e.id);
    this.changedRemoved.push(e.id);
    const c = this.entityColliders.get(e.id);
    if (c) {
      this.colliderEntities.delete(c.handle);
      this.physics.removeCollider(c, true);
      this.entityColliders.delete(e.id);
    }
    if (e.assembly) this.dirtyAssemblies.add(e.assembly);
  }
  private makeRoom() {
    if (this.moving.size < this.bodyLimit) return;
    let chosen: Moving | undefined;
    for (const m of this.moving.values())
      if (!chosen || m.age > chosen.age) chosen = m;
    if (chosen) this.settle(chosen, true);
  }
  private spawnBody(
    p: Vec3,
    s: Vec3,
    material: BodyView["material"],
    source: number,
    kind: BodyView["kind"],
    impulse: Vec3,
    q: Quat = [0, 0, 0, 1],
    existing = false,
  ) {
    if (
      (!existing && this.vaporized.has(source)) ||
      this.inBeam(p, this.orientedSize(s, q))
    )
      return -1;
    this.makeRoom();
    const id = this.nextBody++,
      desc = RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(...p)
        .setRotation({ x: q[0], y: q[1], z: q[2], w: q[3] })
        .setLinearDamping(0.06)
        .setAngularDamping(0.45)
        .setCanSleep(true)
        .setCcdEnabled(true);
    const body = this.physics.createRigidBody(desc);
    const collider = this.physics.createCollider(
      RAPIER.ColliderDesc.cuboid(...s)
        .setFriction(0.85)
        .setRestitution(0.16)
        .setDensity(material === "wood" || material === "foliage" ? 0.5 : 1.8)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      body,
    );
    body.setLinvel(vec(impulse), true);
    body.setAngvel(
      {
        x: (rand(id) - 0.5) * 3,
        y: (rand(id + 1) - 0.5) * 3,
        z: (rand(id + 2) - 0.5) * 3,
      },
      true,
    );
    const view: BodyView = {
      id,
      p: [...p],
      q: [...q],
      s: [...s],
      material,
      kind,
      source,
    };
    this.colliderMoving.set(collider.handle, id);
    this.moving.set(id, {
      view,
      body,
      collider,
      age: 0,
      lastImpact: -10,
      ccd: true,
    });
    return id;
  }
  private scatterVelocity(
    p: Vec3,
    origin: Vec3,
    speed: number,
    seed: number,
  ): Vec3 {
    const angle =
      Math.atan2(p[2] - origin[2], p[0] - origin[0]) + (rand(seed) - 0.5) * 0.5;
    const up = 0.4 + rand(seed + 7) * 0.35;
    const horizontal = Math.sqrt(1 - up * up) * speed;
    return [
      Math.cos(angle) * horizontal,
      speed * up,
      Math.sin(angle) * horizontal,
    ];
  }
  private fragment(
    e: Entity,
    origin: Vec3,
    force: number,
    budget: { n: number; limit?: number },
  ) {
    if (this.vaporized.has(e.id)) return;
    this.removeEntity(e);
    this.contact(e.p, e.material, 1, "fracture");
    const limit = budget.limit ?? this.fragmentLimit;
    if (budget.n >= limit) {
      this.staticFragment(e, origin, force);
      return;
    }
    // Prepared splits partition the source box, avoiding overlapping rigid pieces.
    const tree = e.kind === "tree",
      axis = tree ? 1 : e.s.indexOf(Math.max(...e.s));
    const count = Math.min(limit - budget.n, tree ? 2 : 2 + (e.id % 3) * 2);
    for (let i = 0; i < count; i++) {
      const p = [...e.p] as Vec3,
        size = [...e.s] as Vec3;
      if (tree) {
        size[0] = Math.min(1, e.s[0] * 0.25);
        size[2] = size[0];
      }
      size[axis] /= count;
      p[axis] += (i + 0.5) * size[axis] * 2 - e.s[axis];
      const speed = force * (0.85 + rand(e.id * 13 + i) * 0.15);
      this.spawnBody(
        p,
        size,
        tree ? "wood" : e.material,
        e.id,
        tree && i === count - 1 ? "tree" : e.kind === "rock" ? "rock" : "chunk",
        this.scatterVelocity(p, origin, speed, e.id + i),
      );
      budget.n++;
    }
  }
  private staticFragment(e: Entity, origin?: Vec3, force = 0) {
    if (this.vaporized.has(e.id)) return;
    let x = e.p[0],
      z = e.p[2];
    if (origin && force > 0) {
      const v = this.scatterVelocity(e.p, origin, force, e.id),
        flight = (2 * v[1]) / 18;
      // Cheap authoritative landing approximation for excess distant wreckage.
      x = clamp(x + v[0] * flight * 0.72, 8, 2040);
      z = clamp(z + v[2] * flight * 0.72, 8, 2040);
    }
    const size: Vec3 = e.kind === "tree" ? [e.s[1], 0.8, 0.8] : [...e.s];
    const p: Vec3 = [x, this.terrain.sample(x, z) + size[1], z];
    const r: Ruin = {
      id: this.nextBody++,
      p,
      q: [0, Math.sin(e.variant * 3), 0, Math.cos(e.variant * 3)],
      s: size,
      material: e.kind === "tree" ? "wood" : e.material,
      kind: "chunk",
      source: e.id,
    };
    this.insertRuin(r);
  }
  private nearbyRuins(p: Vec3, radius: number) {
    const result: Ruin[] = [];
    for (
      let z = clamp(Math.floor((p[2] - radius) / 64), 0, 31);
      z <= clamp(Math.floor((p[2] + radius) / 64), 0, 31);
      z++
    )
      for (
        let x = clamp(Math.floor((p[0] - radius) / 64), 0, 31);
        x <= clamp(Math.floor((p[0] + radius) / 64), 0, 31);
        x++
      )
        for (const id of this.ruinCells.get(z * 32 + x) || []) {
          const r = this.ruins.get(id)!;
          if (distance(r.p, p) < radius) result.push(r);
        }
    return result.sort(
      (a, b) => distance(a.p, this.plane.p) - distance(b.p, this.plane.p),
    );
  }
  private shoveWreckage(
    p: Vec3,
    radius: number,
    speed: number,
    budget: { n: number; limit: number },
  ) {
    for (const m of this.moving.values()) {
      const pos = arr(m.body.translation()),
        d = distance(pos, p);
      if (d < radius && m.age > 0.1) {
        const v = this.scatterVelocity(
          pos,
          p,
          speed * (1 - (0.65 * d) / radius),
          m.view.id,
        );
        m.body.setLinvel(vec(v), true);
      }
    }
    for (const r of this.nearbyRuins(p, radius).slice(
      0,
      Math.min(16, budget.limit - budget.n),
    )) {
      this.removeRuin(r.id);
      this.spawnBody(
        r.p,
        r.s,
        r.material,
        r.source,
        r.kind,
        this.scatterVelocity(r.p, p, speed, r.id),
        r.q,
        true,
      );
      budget.n++;
    }
  }
  private emitFragments(
    p: Vec3,
    origin: Vec3,
    material: Entity["material"],
    count: number,
    speed: number,
    spread = 0,
    seed = this.tick,
  ) {
    if (count > 0)
      this.emit({
        type: "fragments",
        p: [...p],
        origin: [...origin],
        material,
        count,
        speed,
        spread,
        seed,
      } as FragmentEffect);
  }
  private earthBurst(
    p: Vec3,
    radius: number,
    speed: number,
    budget: { n: number; limit: number },
    count: number,
  ) {
    for (let i = 0; i < count && budget.n < budget.limit; i++) {
      const a = rand(this.tick + i * 31) * Math.PI * 2,
        r = rand(i * 43 + this.tick) * radius * 0.7;
      const x = clamp(p[0] + Math.cos(a) * r, 1, 2047),
        z = clamp(p[2] + Math.sin(a) * r, 1, 2047),
        size = 0.7 + rand(i * 59 + this.tick) * 1.4;
      const pos: Vec3 = [x, this.terrain.sample(x, z) + size + 2, z];
      this.spawnBody(
        pos,
        [size, size * 0.7, size * 0.9],
        i % 3 ? "earth" : "rock",
        -1,
        "rock",
        this.scatterVelocity(pos, p, speed, this.tick + i),
      );
      budget.n++;
    }
  }
  private cell(p: Vec3) {
    return (
      clamp(Math.floor(p[2] / 64), 0, 31) * 32 +
      clamp(Math.floor(p[0] / 64), 0, 31)
    );
  }
  private indexRuin(r: Ruin) {
    const k = this.cell(r.p);
    let ids = this.ruinCells.get(k);
    if (!ids) this.ruinCells.set(k, (ids = new Set()));
    ids.add(r.id);
  }
  private nearbyEntities(p: Vec3, radius: number) {
    const ids = new Set<number>();
    for (
      let z = clamp(Math.floor((p[2] - radius) / 64), 0, 31);
      z <= clamp(Math.floor((p[2] + radius) / 64), 0, 31);
      z++
    )
      for (
        let x = clamp(Math.floor((p[0] - radius) / 64), 0, 31);
        x <= clamp(Math.floor((p[0] + radius) / 64), 0, 31);
        x++
      )
        for (const id of this.entityCells.get(z * 32 + x) || []) ids.add(id);
    return [...ids];
  }
  private insertRuin(r: Ruin) {
    if (this.inBeam(r.p, this.orientedSize(r.s, r.q))) return;
    const id = this.cell(r.p),
      existing = [...(this.ruinCells.get(id) || [])].map(
        (id) => this.ruins.get(id)!,
      );
    if (existing.length >= this.rubbleLimit) {
      const merged = consolidateRubble(r, existing, (x, z) =>
        this.terrain.sample(x, z),
      );
      this.removeRuin(merged.removed);
      if (merged.ruin.id !== r.id) {
        this.removeRuin(merged.ruin.id);
        this.insertRuin(merged.ruin);
      } else r = merged.ruin;
    }
    this.ruins.set(r.id, r);
    this.indexRuin(r);
    this.addRuinCollider(r);
    this.changedSettled.push(r);
  }
  private removeRuin(id: number) {
    const c = this.ruinColliders.get(id);
    if (c) {
      this.physics.removeCollider(c, true);
      this.ruinColliders.delete(id);
    }
    const r = this.ruins.get(id);
    if (r) this.ruinCells.get(this.cell(r.p))?.delete(id);
    this.ruins.delete(id);
    this.changedRubbleRemoved.push(id);
  }
  private settle(m: Moving, force = false) {
    if (!force) this.contact(m.view.p, m.view.material, 0.5, "settle");
    const q = m.body.rotation();
    let r: Ruin = {
      ...m.view,
      p: arr(m.body.translation()),
      q: [q.x, q.y, q.z, q.w],
    };
    if (force) {
      r.p[0] = clamp(r.p[0], 8, 2040);
      r.p[2] = clamp(r.p[2], 8, 2040);
      const ground = this.terrain.sample(r.p[0], r.p[2]);
      // A time/budget-forced tree must remain a fallen trunk, not stand back up.
      if (r.kind === "tree") r.q = [0, 0, Math.SQRT1_2, Math.SQRT1_2];
      r.p[1] = ground + this.orientedSize(r.s, r.q)[1];
    }
    this.colliderMoving.delete(m.collider.handle);
    this.physics.removeRigidBody(m.body);
    this.moving.delete(m.view.id);
    this.insertRuin(r);
    this.bump();
  }
  private resolveSupport(
    origin: Vec3,
    coarse = 7,
    dynamicBudget = this.fragmentLimit,
    deferred?: number[][],
  ) {
    let spawned = 0;
    const groups = [...this.dirtyAssemblies];
    this.dirtyAssemblies.clear();
    for (const name of groups) {
      const ids = this.assemblies.get(name) || [],
        alive = ids.filter((i) => !this.removed.has(i)),
        connected = new Set<number>(),
        queue: number[] = [];
      for (const id of alive) {
        const e = this.world.entities[id];
        if (
          e.foundation &&
          this.terrain.sample(e.p[0], e.p[2]) >= e.p[1] - e.s[1] - 1.4
        ) {
          connected.add(id);
          queue.push(id);
        }
      }
      for (let h = 0; h < queue.length; h++)
        for (const next of this.world.entities[queue[h]].supports)
          if (!this.removed.has(next) && !connected.has(next)) {
            connected.add(next);
            queue.push(next);
          }
      const falling = alive.filter((i) => !connected.has(i));
      if (!falling.length) continue;
      this.emit({
        type: "explosion",
        p: this.world.entities[falling[0]].p,
        water: false,
        power: Math.min(2, falling.length / 20),
        seed: this.tick,
        kind: "collapse",
      });
      const clusters = new Map<string, Entity[]>();
      for (const id of falling) {
        const e = this.world.entities[id];
        this.removeEntity(e);
        const key =
          e.material +
          ":" +
          Math.floor(e.p[0] / coarse) +
          ":" +
          Math.floor(e.p[1] / (coarse * 0.85)) +
          ":" +
          Math.floor(e.p[2] / coarse);
        let group = clusters.get(key);
        if (!group) clusters.set(key, (group = []));
        group.push(e);
      }
      const ordered = [...clusters.values()].sort(
        (a, b) =>
          distance(a[0].p, this.plane.p) - distance(b[0].p, this.plane.p),
      );
      if (deferred) {
        deferred.push(...ordered.map((g) => g.map((e) => e.id)));
        this.dirtyAssemblies.clear();
        continue;
      }
      for (const group of ordered) {
        const min: Vec3 = [Infinity, Infinity, Infinity],
          max: Vec3 = [-Infinity, -Infinity, -Infinity];
        for (const e of group)
          for (let k = 0; k < 3; k++) {
            min[k] = Math.min(min[k], e.p[k] - e.s[k]);
            max[k] = Math.max(max[k], e.p[k] + e.s[k]);
          }
        const p = min.map((v, k) => (v + max[k]) / 2) as Vec3,
          s = min.map((v, k) => Math.max(0.1, (max[k] - v) / 2)) as Vec3;
        if (dynamicBudget-- <= 0) {
          this.staticFragment({ ...group[0], p, s }, origin, 25);
          continue;
        }
        this.spawnBody(p, s, group[0].material, group[0].id, "chunk", [
          (p[0] - origin[0]) * 0.09,
          1,
          (p[2] - origin[2]) * 0.09,
        ]);
        spawned++;
      }
      this.dirtyAssemblies.clear();
    }
    return spawned;
  }
  detonateNuke(
    p: Vec3,
    strength: NukeYield = this.nukeYield,
    releasedProfile?: BlastProfile,
  ) {
    const profile = releasedProfile ?? nukeProfile(strength, this.destruction);
    this.damageMonsters(p, profile.damageRadius, 3);
    const chunks: number[] = [];
    for (
      let z = clamp(Math.floor((p[2] - profile.craterRadius) / 64), 0, 31);
      z <= clamp(Math.floor((p[2] + profile.craterRadius) / 64), 0, 31);
      z++
    )
      for (
        let x = clamp(Math.floor((p[0] - profile.craterRadius) / 64), 0, 31);
        x <= clamp(Math.floor((p[0] + profile.craterRadius) / 64), 0, 31);
        x++
      )
        chunks.push(z * 32 + x);
    chunks.sort(
      (a, b) =>
        Math.hypot(
          (a % 32) * 64 + 32 - p[0],
          Math.floor(a / 32) * 64 + 32 - p[2],
        ) -
        Math.hypot(
          (b % 32) * 64 + 32 - p[0],
          Math.floor(b / 32) * 64 + 32 - p[2],
        ),
    );
    const ids = this.nearbyEntities(p, profile.damageRadius).filter(
      (id) => !this.removed.has(id),
    );
    ids.sort(
      (a, b) =>
        distance(this.world.entities[a].p, p) -
        distance(this.world.entities[b].p, p),
    );
    this.pendingJobs.push({
      p: [...p],
      yield: strength,
      phase: "terrain",
      cursor: 0,
      chunks,
      entities: ids,
      assemblies: [],
      fragments: 0,
      profile: { ...profile },
      seed: this.tick,
      excavation: clamp(
        1 -
          Math.max(
            0,
            p[1] -
              WEAPONS.nuke.radius * 2 -
              Math.max(0, this.terrain.sample(p[0], p[2])),
          ) /
            profile.craterRadius,
        0,
        1,
      ),
      supportQueue: [],
    });
    this.bump();
    this.emit({
      type: "explosion",
      kind: "nuke",
      p: [...p],
      water:
        this.terrain.water(p[0], p[2]) && p[1] <= WEAPONS.nuke.length / 2 + 1,
      power: 1,
      seed: this.tick,
      profile,
      yield: strength,
    });
    const job = this.pendingJobs[this.pendingJobs.length - 1],
      budget = { n: 0, limit: profile.bodyLimit };
    this.shoveWreckage(p, profile.damageRadius, profile.scatterMax, budget);
    if (job.excavation > 0) {
      this.earthBurst(p, profile.craterRadius, profile.scatterMax, budget, 24);
      this.emitFragments(
        p,
        p,
        "earth",
        Math.floor(profile.ejecta * 0.6 * job.excavation),
        profile.scatterMax,
        profile.craterRadius * 0.7,
        job.seed,
      );
    }
    job.fragments = budget.n;
  }
  processDestruction(budgetMS = 2) {
    const start = performance.now();
    while (this.pendingJobs.length && performance.now() - start < budgetMS) {
      const job = this.pendingJobs[0],
        profile = job.profile;
      if (job.phase === "terrain") {
        if (job.cursor >= job.chunks.length) {
          job.phase = "entities";
          job.cursor = 0;
          continue;
        }
        const id = job.chunks[job.cursor++];
        this.bump();
        const patch = this.terrain.crater(
          job.p[0],
          job.p[2],
          profile.craterRadius,
          profile.depth * job.excavation,
          this.revision,
          id,
        );
        const flood = this.terrain.floodChanged(patch.indices);
        for (const changed of patch.chunks)
          if (this.terrainColliders.has(changed))
            this.buildTerrainCollider(changed);
        this.flush(patch, flood);
      } else if (job.phase === "entities") {
        if (job.cursor >= job.entities.length) {
          job.phase = "support";
          job.cursor = 0;
          job.assemblies = [...new Set(job.assemblies)];
          continue;
        }
        const e = this.world.entities[job.entities[job.cursor++]];
        if (this.removed.has(e.id)) continue;
        const d = Math.hypot(
          ...e.p.map((v, k) => Math.max(0, Math.abs(v - job.p[k]) - e.s[k])),
        );
        if (e.assembly) job.assemblies.push(e.assembly);
        // Deterministic breakup probability softens only the outer 30% of the blast.
        const strength = clamp(
          (profile.damageRadius - d) / (profile.damageRadius * 0.3),
          0,
          1,
        );
        if (
          d < profile.damageRadius &&
          (e.kind === "tree" || strength > rand(e.id * 31))
        ) {
          this.bump();
          const speed =
            profile.scatterMin +
            (profile.scatterMax - profile.scatterMin) * strength;
          if (
            job.fragments < profile.bodyLimit - 24 &&
            distance(e.p, this.plane.p) < 700
          ) {
            const budget = { n: job.fragments, limit: profile.bodyLimit - 24 };
            this.fragment(e, job.p, speed, budget);
            job.fragments = budget.n;
          } else {
            this.removeEntity(e);
            this.staticFragment(e, job.p, speed);
          }
          // Bounded effect allocation, distributed over the destroyed structures.
          if (job.cursor <= 40)
            this.emitFragments(
              e.p,
              job.p,
              e.kind === "tree" ? "wood" : e.material,
              Math.floor((profile.ejecta * 0.4) / 40),
              speed,
              Math.max(...e.s) * 0.5,
              job.seed + e.id,
            );
        }
      } else {
        const queue = job.supportQueue!;
        if (queue.length) {
          const ids = queue.pop()!,
            e = this.world.entities[ids[0]],
            budget = { n: job.fragments, limit: profile.bodyLimit };
          // Assembly connectivity was resolved once; consume its falling clusters incrementally.
          for (const id of ids) {
            const part = this.world.entities[id];
            if (budget.n < budget.limit)
              this.fragment(part, job.p, profile.scatterMin, budget);
            else this.staticFragment(part, job.p, profile.scatterMin);
          }
          job.fragments = budget.n;
        } else if (job.cursor < job.assemblies.length) {
          this.dirtyAssemblies.clear();
          this.dirtyAssemblies.add(job.assemblies[job.cursor++]);
          this.resolveSupport(job.p, 14, 0, queue);
        } else {
          this.pendingJobs.shift();
          this.bump();
          this.flush();
          continue;
        }
      }
      // Nuke support work is owned by its serialized job, not an incidental impact.
      this.dirtyAssemblies.clear();
    }
    this.flush();
    this.destructionMS = performance.now() - start;
  }
  explode(p: Vec3, power = 1, kind: Explosion["kind"] = "blast") {
    this.bump();
    if (kind === "blast") this.damageMonsters(p, CONFIG.damageRadius * power, 1);
    const water = this.terrain.water(p[0], p[2]) && p[1] < 4;
    this.emit({
      type: "explosion",
      p: [...p],
      water,
      power,
      seed: this.tick + this.shots * 39,
      kind,
    });
    const ground = this.terrain.sample(p[0], p[2]),
      height = Math.max(0, p[1] - ground);
    let terrain: ReturnType<Terrain["crater"]> | undefined,
      flood: Uint32Array | undefined;
    if (height < 20) {
      terrain = this.terrain.crater(
        p[0],
        p[2],
        CONFIG.craterRadius * power,
        CONFIG.craterDepth * power * (1 - clamp(height / 24, 0, 0.9)),
        this.revision,
      );
      flood = this.terrain.floodChanged(terrain.indices);
      for (const id of terrain.chunks)
        if (this.terrainColliders.has(id)) this.buildTerrainCollider(id);
    }
    const budget = { n: 0, limit: this.fragmentLimit };
    this.shoveWreckage(p, CONFIG.damageRadius * power, 50, budget);
    if (terrain?.indices.length)
      this.earthBurst(p, CONFIG.craterRadius, 50, budget, 12);
    if (terrain?.indices.length)
      this.emitFragments(
        p,
        p,
        "earth",
        Math.round(128 * COSMETIC_SCALE[this.destruction.cosmetics]),
        45,
        CONFIG.craterRadius * 0.7,
      );
    const candidates = this.nearbyEntities(p, CONFIG.damageRadius * power + 30)
      .map((id) => this.world.entities[id])
      .filter(
        (e) =>
          !this.removed.has(e.id) &&
          Math.hypot(e.p[0] - p[0], e.p[2] - p[2]) <
            CONFIG.damageRadius * power + Math.max(...e.s),
      );
    candidates.sort((a, b) => distance(a.p, p) - distance(b.p, p));
    for (const e of candidates) {
      let d = Math.hypot(
        Math.max(0, Math.abs(e.p[0] - p[0]) - e.s[0]),
        Math.max(0, Math.abs(e.p[1] - p[1]) - e.s[1]),
        Math.max(0, Math.abs(e.p[2] - p[2]) - e.s[2]),
      );
      let limit = CONFIG.damageRadius * power * (e.kind === "tree" ? 1 : 0.76);
      if (d < limit)
        this.fragment(e, p, (1 - d / Math.max(1, limit)) * 30 + 25, budget);
      if (e.assembly && terrain) this.dirtyAssemblies.add(e.assembly);
    }
    for (const [name, ids] of this.assemblies)
      if (
        terrain &&
        ids.some(
          (id) =>
            !this.removed.has(id) &&
            Math.hypot(
              this.world.entities[id].p[0] - p[0],
              this.world.entities[id].p[2] - p[2],
            ) <
              CONFIG.craterRadius * power + 4,
        )
      )
        this.dirtyAssemblies.add(name);
    this.resolveSupport(p, 7, Math.max(0, budget.limit - budget.n));
    for (const e of candidates.slice(0, 16))
      if (this.removed.has(e.id))
        this.emitFragments(
          e.p,
          p,
          e.kind === "tree" ? "wood" : e.material,
          Math.round(8 * COSMETIC_SCALE[this.destruction.cosmetics]),
          50,
          2,
          this.tick + e.id,
        );
    this.ensureTerrain();
    this.flush(terrain, flood);
  }
  private sweep(
    a: Vec3,
    b: Vec3,
    radius = 0,
    halfLength = radius,
  ): Vec3 | null {
    const delta: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]],
      len = Math.hypot(...delta);
    if (!len) return null;
    let best = 1.01;
    const dir = delta.map((v) => v / len),
      qlen = Math.hypot(dir[2], -dir[0], 1 + dir[1]);
    const rotation =
      qlen < 0.0001
        ? { x: 1, y: 0, z: 0, w: 0 }
        : { x: dir[2] / qlen, y: 0, z: -dir[0] / qlen, w: (1 + dir[1]) / qlen };
    const extent = radius + Math.max(0, halfLength - radius) * Math.abs(dir[1]);
    const shapeHit =
      radius > 0
        ? this.physics.castShape(
            vec(a),
            rotation,
            vec(delta),
            halfLength > radius
              ? new RAPIER.Capsule(halfLength - radius, radius)
              : new RAPIER.Ball(radius),
            0,
            1,
            true,
          )
        : null;
    const rayHit =
      radius === 0
        ? this.physics.castRay(new RAPIER.Ray(vec(a), vec(delta)), 1, true)
        : null;
    if (shapeHit) best = shapeHit.time_of_impact;
    if (rayHit) best = rayHit.timeOfImpact;
    const steps = Math.ceil(len / 1.5);
    for (let i = 0; i <= steps; i++) {
      let t = i / steps;
      if (t >= best) break;
      let x = lerp(a[0], b[0], t),
        y = lerp(a[1], b[1], t),
        z = lerp(a[2], b[2], t);
      if (
        y - extent <=
        Math.max(this.terrain.sample(x, z), this.terrain.water(x, z) ? 0 : -1e5)
      ) {
        best = t;
        break;
      }
    }
    return best <= 1
      ? [a[0] + delta[0] * best, a[1] + delta[1] * best, a[2] + delta[2] * best]
      : null;
  }
  respawn() {
    let p: Vec3 = [...this.world.spawn];
    p[1] = Math.max(p[1], this.terrain.sample(p[0], p[2]) + 65);
    for (let i = 0; i < 8; i++) {
      let clear = true;
      for (const e of this.world.entities)
        if (
          !this.removed.has(e.id) &&
          distance(e.p, p) < Math.max(...e.s) + 25
        ) {
          clear = false;
          break;
        }
      if (clear) break;
      p[1] += 30;
    }
    Object.assign(this.plane, {
      p,
      v: [0, 0, 0],
      yaw: 0.65,
      pitch: -0.09,
      roll: 0,
      speed: 62,
      crashed: 0,
      boundary: false,
    });
    this.throttle = 0.48;
    this.input.fire = false;
  }
  private laserPlaneHit(from: Vec3, to: Vec3): Vec3 | null {
    // Sweep the same aircraft collision envelope used for terrain against
    // each active shaft. Targeting rings and the wider excavation are harmless.

    let first = Infinity;
    for (const strike of this.lasers) {
      if (strike.phase !== "burning") continue;
      const radius =
        resolvedLaserProfile(strike.profile).beamRadius * 1.06 + 2.2;
      const x = from[0] - strike.p[0],
        z = from[2] - strike.p[2];
      const dx = to[0] - from[0],
        dz = to[2] - from[2];
      const a = dx * dx + dz * dz,
        b = 2 * (x * dx + z * dz);
      const c = x * x + z * z - radius * radius;
      let enter = 0,
        leave = 1;
      if (a < 1e-12) {
        if (c > 0) continue;
      } else {
        const discriminant = b * b - 4 * a * c;
        if (discriminant < 0) continue;
        const root = Math.sqrt(discriminant);
        enter = Math.max(enter, (-b - root) / (2 * a));
        leave = Math.min(leave, (-b + root) / (2 * a));
      }
      const bottom = this.terrain.sample(strike.p[0], strike.p[2]) - 2.2;
      const top = LASER.top + 2.2,
        dy = to[1] - from[1];
      if (Math.abs(dy) < 1e-12) {
        if (from[1] < bottom || from[1] > top) continue;
      } else {
        const t0 = (bottom - from[1]) / dy,
          t1 = (top - from[1]) / dy;
        enter = Math.max(enter, Math.min(t0, t1));
        leave = Math.min(leave, Math.max(t0, t1));
      }
      if (enter <= leave) first = Math.min(first, enter);
    }
    return Number.isFinite(first)
      ? (from.map((v, i) => v + (to[i] - v) * first) as Vec3)
      : null;
  }
  private fly(dt: number) {
    const p = this.plane;
    if (p.crashed > 0) {
      p.crashed -= dt;
      if (p.crashed <= 0) this.respawn();
      return;
    }
    this.throttle = clamp(
      this.throttle + this.input.throttle * dt * 0.35,
      0,
      1,
    );
    p.speed = lerp(
      p.speed,
      this.input.boost
        ? CONFIG.boostSpeed
        : lerp(CONFIG.minSpeed, CONFIG.maxSpeed, this.throttle),
      1 - Math.exp(-dt * 2),
    );
    let turn = clamp(this.input.x + this.input.bank * 0.8, -1, 1),
      pitch = clamp(this.input.y, -1, 1);
    p.boundary = p.p[0] < 200 || p.p[0] > 1848 || p.p[2] < 200 || p.p[2] > 1848;
    if (p.boundary) {
      let desired = Math.atan2(1024 - p.p[0], 1024 - p.p[2]),
        diff = Math.atan2(Math.sin(desired - p.yaw), Math.cos(desired - p.yaw));
      turn = clamp(diff * 2, -1, 1);
    }
    if (!p.boundary) turn = -turn;
    p.yaw += turn * CONFIG.turnSpeed * dt;
    p.pitch = clamp(
      p.pitch + pitch * CONFIG.pitchSpeed * dt,
      -CONFIG.maxPitch,
      CONFIG.maxPitch,
    );
    if (!pitch) p.pitch = lerp(p.pitch, 0, dt * 0.08);
    if (p.p[1] > 450) p.pitch = Math.min(p.pitch, (500 - p.p[1]) * 0.008);
    if (p.p[1] > 500) p.pitch = lerp(p.pitch, -0.2, dt * 2);
    p.roll = lerp(p.roll, -turn * 0.95, 1 - Math.exp(-dt * 5));
    let f: Vec3 = [
      Math.sin(p.yaw) * Math.cos(p.pitch),
      Math.sin(p.pitch),
      Math.cos(p.yaw) * Math.cos(p.pitch),
    ];
    p.v = f.map((v) => v * p.speed) as Vec3;
    const next = p.p.map((v, i) => v + p.v[i] * dt) as Vec3;
    const hit = this.sweep(p.p, next, 2.2);
    if (hit) {
      p.p = hit;
      p.crashed = CONFIG.respawnDelay;
      this.explode(hit, 0.65, "crash");
      return;
    }
    p.p = next;
    const weapon = this.weapon;
    if (weapon === "laser") {
      if (this.input.fire && this.cooldowns.laser <= 0) {
        const target = this.laserAim();
        if (target) this.startLaser(target);
      }
      return;
    }
    const tuning = WEAPONS[weapon];
    if (
      this.input.fire &&
      this.cooldowns[weapon] <= 0 &&
      (this.destruction.noCooldown ||
        (this.projectiles.length < CONFIG.maxProjectiles &&
          (weapon !== "nuke" ||
            this.pendingJobs.length +
              this.projectiles.filter((p) => p.weapon === "nuke").length <
              8)))
    ) {
      this.cooldowns[weapon] = this.destruction.noCooldown
        ? 0
        : tuning.cooldown;
      this.shots++;
      this.projectiles.push({
        id: this.nextShot++,
        weapon,
        yield: this.nukeYield,
        profile:
          weapon === "nuke"
            ? nukeProfile(this.nukeYield, this.destruction)
            : undefined,
        p:
          weapon === "cannon"
            ? (p.p.map((v, i) => v + f[i] * 12) as Vec3)
            : [p.p[0], p.p[1] - 12, p.p[2]],
        v:
          weapon === "cannon"
            ? (f.map((v) => v * (p.speed + tuning.launchSpeed)) as Vec3)
            : [p.v[0], p.v[1] - 8, p.v[2]],
        age: 0,
      });
    }
  }
  private orientedSize(s: Vec3, q: Quat): Vec3 {
    const [x, y, z, w] = q;
    return [
      Math.abs(1 - 2 * (y * y + z * z)) * s[0] +
        Math.abs(2 * (x * y - z * w)) * s[1] +
        Math.abs(2 * (x * z + y * w)) * s[2],
      Math.abs(2 * (x * y + z * w)) * s[0] +
        Math.abs(1 - 2 * (x * x + z * z)) * s[1] +
        Math.abs(2 * (y * z - x * w)) * s[2],
      Math.abs(2 * (x * z - y * w)) * s[0] +
        Math.abs(2 * (y * z + x * w)) * s[1] +
        Math.abs(1 - 2 * (x * x + y * y)) * s[2],
    ];
  }
  private intersects(p: Vec3, s: Vec3, center: Vec3, radius: number) {
    return (
      Math.hypot(
        Math.max(0, Math.abs(p[0] - center[0]) - s[0]),
        Math.max(0, Math.abs(p[2] - center[2]) - s[2]),
      ) < radius
    );
  }
  private inBeam(p: Vec3, s: Vec3) {
    return this.burnZones.some((z) => this.intersects(p, s, z.p, z.radius));
  }
  private damageMonsters(p: Vec3, radius: number, amount: number, laserColumn = false) {
    for (const m of laserColumn
      ? this.monsters.burn(p, radius, amount)
      : this.monsters.blast(p, radius, amount)) {
      this.bump();
      this.emit({ type: "monsterEvent", p: [m.p[0], m.p[1] + MONSTER_BODY_HEIGHT, m.p[2]], kind: m.defeated ? "defeat" : "hit" });
    }
  }
  private laserAim(): Vec3 | null {
    const p = this.plane,
      f: Vec3 = [
        Math.sin(p.yaw) * Math.cos(p.pitch),
        Math.sin(p.pitch),
        Math.cos(p.yaw) * Math.cos(p.pitch),
      ];
    const a = p.p.map((v, i) => v + f[i] * 12) as Vec3;
    let length = LASER.range;
    for (const axis of [0, 2]) {
      if (Math.abs(f[axis]) > 1e-6)
        length = Math.min(
          length,
          ((f[axis] > 0 ? CONFIG.worldSize : 0) - a[axis]) / f[axis],
        );
    }
    if (length <= 0) return null;
    const b = a.map((v, i) => v + f[i] * length) as Vec3;
    const worldHit = this.sweep(a, b, 0);
    const monsterHit = this.monsters.intersect(a, b);
    return monsterHit && (!worldHit || distance(a, monsterHit.p) < distance(a, worldHit))
      ? monsterHit.p : worldHit;
  }
  startLaser(p: Vec3) {
    if (
      !p.every(Number.isFinite) ||
      p[0] < 0 ||
      p[0] > CONFIG.worldSize ||
      p[2] < 0 ||
      p[2] > CONFIG.worldSize
    )
      return;
    this.lasers.push({
      id: this.nextShot++,
      profile: laserProfile(this.destruction),
      p: [...p],
      age: 0,
      phase: "charging",
    });
    this.cooldowns.laser = this.destruction.noCooldown
      ? 0
      : WEAPONS.laser.cooldown;
    this.shots++;
    this.bump();
  }
  private scheduleLaser(l: LaserStrike, progress: number) {
    const { radius, depth } = resolvedLaserProfile(l.profile);
    if (progress === 1) l.pending = [];
    for (
      let z =
        radius > 500 ? 0 : clamp(Math.floor((l.p[2] - radius) / 64), 0, 31);
      z <=
      (radius > 500 ? 31 : clamp(Math.floor((l.p[2] + radius) / 64), 0, 31));
      z++
    )
      for (
        let x =
          radius > 500 ? 0 : clamp(Math.floor((l.p[0] - radius) / 64), 0, 31);
        x <=
        (radius > 500 ? 31 : clamp(Math.floor((l.p[0] + radius) / 64), 0, 31));
        x++
      ) {
        const section = z * 32 + x;
        if (progress === 1) l.pending!.push(section);
        let work = this.laserWork.get(section);
        if (!work)
          this.laserWork.set(section, (work = { section, targets: [] }));
        const prior = work.targets.find(
          (t) =>
            t.p[0] === l.p[0] &&
            t.p[2] === l.p[2] &&
            (t.radius ?? LASER.radius) === radius &&
            (t.depth ?? LASER.depth) === depth,
        );
        if (prior) prior.progress = Math.max(prior.progress, progress);
        else work.targets.push({ p: [...l.p], progress, radius, depth });
      }
  }
  private clearLaser(p: Vec3, radius: number, section?: number) {
    // Large footprints use the existing section work queue for static cleanup.
    const ids =
      section !== undefined
        ? this.entityCells.get(section) || []
        : radius <= 500
          ? this.nearbyEntities(p, radius)
          : [];
    for (const id of ids) {
      const e = this.world.entities[id];
      if (!this.intersects(e.p, e.s, p, radius)) continue;
      this.vaporized.add(id);
      if (!this.removed.has(id)) {
        this.removeEntity(e);
        this.bump();
        if (e.assembly) this.laserSupport.add(e.assembly);
      }
    }
    // Include oriented footprint bounds, not center-only sphere tests: tall
    // towers and debris at the bottom of the shaft belong to the same column.
    const ruins =
      section !== undefined
        ? [...(this.ruinCells.get(section) || [])]
            .map((id) => this.ruins.get(id)!)
            .filter(Boolean)
        : radius <= 500
          ? [...this.ruins.values()]
          : [];
    for (const r of ruins)
      if (this.intersects(r.p, this.orientedSize(r.s, r.q), p, radius)) {
        this.removeRuin(r.id);
        this.bump();
      }
    if (section === undefined)
      for (const m of [...this.moving.values()])
        if (
          this.intersects(
            arr(m.body.translation()),
            this.orientedSize(m.view.s, m.view.q),
            p,
            radius,
          )
        ) {
          this.colliderMoving.delete(m.collider.handle);
          this.physics.removeRigidBody(m.body);
          this.moving.delete(m.view.id);
          this.bump();
        }
    if (section === undefined)
      this.emit({ type: "vaporize", p: [...p], radius });
  }
  private updateLasers(dt: number) {
    const zones = new Map<string, { p: Vec3; radius: number }>();
    const sample = this.tick % 6 === 0;
    for (const l of this.lasers) {
      const old = l.age;
      l.age += dt;
      // Avoid floating point delaying transitions by a simulation tick.
      if (Math.abs(l.age - LASER.charge) < 1e-8) l.age = LASER.charge;
      if (Math.abs(l.age - LASER.charge - LASER.beam) < 1e-8)
        l.age = LASER.charge + LASER.beam;
      if (l.age < LASER.charge) continue;
      const finished = l.age >= LASER.charge + LASER.beam;
      const transitioned =
        l.phase === "charging" || (finished && l.phase !== "finishing");
      l.phase = finished ? "finishing" : "burning";
      const progress = clamp((l.age - LASER.charge) / LASER.beam, 0, 1);
      if ((!finished && sample) || transitioned)
        this.scheduleLaser(l, progress);
      const radius =
        resolvedLaserProfile(l.profile).radius *
        clamp(l.age - LASER.charge, 0.03, 1);
      const key = `${l.p[0]},${l.p[2]}`;
      const prior = zones.get(key);
      if (!prior || prior.radius < radius) zones.set(key, { p: l.p, radius });
      if (old < LASER.charge) this.bump();
    }
    this.burnZones = [...zones.values()];
    if (
      sample ||
      this.lasers.some(
        (l) => l.age === LASER.charge || l.age === LASER.charge + LASER.beam,
      )
    )
      for (const z of this.burnZones) this.clearLaser(z.p, z.radius);
    if (this.lasers.length && dt > 0) this.bump();
  }
  processLaserWork(budgetMS = 1) {
    const start = performance.now();
    while (this.laserWork.size && performance.now() - start < budgetMS) {
      const [section, work] = this.laserWork.entries().next().value!;
      this.laserWork.delete(section);
      // Yield between independent targets too, so overlapping strikes cannot
      // turn one terrain section into an unbounded simulation task.
      const target = work.targets.shift()!;
      if (work.targets.length) this.laserWork.set(section, work);
      const changed = new Set<number>(),
        dry: number[] = [];
      const updates = new Map<number, number>();
      this.bump();
      for (const t of [target]) {
        const result = this.terrain.laserCrater(
          t.p[0],
          t.p[2],
          t.progress,
          section,
          this.revision,
          t.radius ?? LASER.radius,
          t.depth ?? LASER.depth,
        );
        if ((t.radius ?? LASER.radius) > 500)
          this.clearLaser(
            t.p,
            (t.radius ?? LASER.radius) *
              clamp(t.progress * LASER.beam, 0.03, 1),
            section,
          );
        result.patch.indices.forEach((i, k) =>
          updates.set(i, result.patch.values[k]),
        );
        for (const c of result.patch.chunks) changed.add(c);
        dry.push(...result.dry);
        if (t.progress === 1)
          for (const l of this.lasers)
            if (
              l.phase === "finishing" &&
              l.p[0] === t.p[0] &&
              l.p[2] === t.p[2] &&
              resolvedLaserProfile(l.profile).radius ===
                (t.radius ?? LASER.radius) &&
              resolvedLaserProfile(l.profile).depth === (t.depth ?? LASER.depth)
            )
              l.pending = l.pending?.filter((id) => id !== section);
      }
      for (const id of changed)
        if (this.terrainColliders.has(id)) this.buildTerrainCollider(id);
      this.flush(
        {
          indices: new Uint32Array(updates.keys()),
          values: new Float32Array(updates.values()),
          chunks: [...changed],
          revision: this.revision,
        },
        undefined,
        new Uint32Array(dry),
      );
    }
    while (this.laserSupport.size && performance.now() - start < budgetMS) {
      const name = this.laserSupport.values().next().value!;
      this.laserSupport.delete(name);
      this.dirtyAssemblies.clear();
      this.dirtyAssemblies.add(name);
      this.resolveSupport(
        this.world.castle,
        20,
        Math.min(16, this.fragmentLimit),
      );
      this.dirtyAssemblies.clear();
    }
    {
      for (let i = this.lasers.length - 1; i >= 0; i--)
        if (
          this.lasers[i].phase === "finishing" &&
          !this.lasers[i].pending?.length
        ) {
          this.clearLaser(
            this.lasers[i].p,
            resolvedLaserProfile(this.lasers[i].profile).radius,
          );
          this.lasers.splice(i, 1);
          this.bump();
        }
      this.burnZones = this.burnZones.filter((z) =>
        this.lasers.some(
          (l) =>
            l.phase !== "charging" && l.p[0] === z.p[0] && l.p[2] === z.p[2],
        ),
      );
    }
    this.flush();
    return performance.now() - start;
  }
  private updateAim() {
    if (this.weapon === "laser") {
      this.aim = this.laserAim();
      return;
    }
    const p = this.plane;
    const weapon = this.weapon,
      tuning = WEAPONS[weapon],
      f: Vec3 = [
        Math.sin(p.yaw) * Math.cos(p.pitch),
        Math.sin(p.pitch),
        Math.cos(p.yaw) * Math.cos(p.pitch),
      ];
    let a: Vec3 =
        weapon === "cannon"
          ? (p.p.map((v, i) => v + f[i] * 12) as Vec3)
          : [p.p[0], p.p[1] - 12, p.p[2]],
      v: Vec3 =
        weapon === "cannon"
          ? (f.map((v) => v * (p.speed + tuning.launchSpeed)) as Vec3)
          : [p.v[0], p.v[1] - 8, p.v[2]];
    this.aim = null;
    for (let t = 0; t < tuning.lifetime; t += 0.16) {
      let b = a.map((x, i) => x + v[i] * 0.16) as Vec3;
      let hit = this.sweep(a, b, tuning.radius, tuning.length / 2);
      const monsterHit = this.monsters.intersect(a, b, tuning.radius);
      if (monsterHit && (!hit || distance(a, monsterHit.p) < distance(a, hit))) hit = monsterHit.p;
      if (hit) {
        this.aim = hit;
        break;
      }
      a = b;
      v[1] -= tuning.gravity * 0.16;
      if (a[0] < 0 || a[0] > 2048 || a[2] < 0 || a[2] > 2048) break;
    }
  }
  step() {
    const dt = CONFIG.dt;
    this.tick++;
    this.time += dt;
    if (!this.holdTime) this.hour = (this.hour + dt / 60) % 24;
    for (const weapon of ["cannon", "nuke", "laser"] as const)
      this.cooldowns[weapon] = Math.max(0, this.cooldowns[weapon] - dt);
    for (let i = 0; i < 16 && this.moving.size > this.bodyLimit; i++)
      this.makeRoom();
    const previousPlanePosition = [...this.plane.p] as Vec3;
    const wasCrashed = this.plane.crashed > 0;
    this.fly(dt);
    const previousSpikeCount = this.monsters.spikes.length;
    const struck = this.monsters.step(dt, this.plane.p, this.plane.crashed > 0, (_a, b) =>
      this.nearbyEntities(b, 36).some((id) => {
        const e = this.world.entities[id];
        return !this.removed.has(id) && e.kind !== "tree" &&
          Math.abs(e.p[0] - b[0]) < e.s[0] + 30 &&
          Math.abs(e.p[2] - b[2]) < e.s[2] + 30 &&
          e.p[1] + e.s[1] > b[1] + 2;
      }),
      discoActive(this.lasers),
    );
    if (this.monsters.spikes.length > previousSpikeCount)
      this.emit({ type: "monsterEvent", p: [...this.monsters.spikes.at(-1)!.p], kind: "throw" });
    const bodyHit = this.monsters.intersect(wasCrashed ? this.plane.p : previousPlanePosition, this.plane.p, 2.2);
    if ((struck || bodyHit) && this.plane.crashed <= 0) {
      this.plane.crashed = CONFIG.respawnDelay;
      this.explode(this.plane.p, 0.65, "crash");
      this.emit({ type: "monsterEvent", p: [...this.plane.p], kind: "swipe" });
    }
    if (this.tick % 60 === 0 && this.monsterCount) this.bump();
    this.updateLasers(dt);
    if (this.plane.crashed <= 0) {
      const hit = this.laserPlaneHit(
        wasCrashed ? this.plane.p : previousPlanePosition,
        this.plane.p,
      );
      if (hit) {
        this.plane.p = hit;
        this.plane.crashed = CONFIG.respawnDelay;
        this.explode(hit, 0.65, "crash");
      }
    }
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const s = this.projectiles[i];
      let next = s.p.map((v, k) => v + s.v[k] * dt) as Vec3,
        hit = this.sweep(
          s.p,
          next,
          WEAPONS[s.weapon].radius,
          WEAPONS[s.weapon].length / 2,
        );
      const monsterHit = this.monsters.intersect(s.p, next, WEAPONS[s.weapon].radius);
      if (monsterHit && (!hit || distance(s.p, monsterHit.p) < distance(s.p, hit))) hit = monsterHit.p;
      s.age += dt;
      if (hit) {
        this.projectiles.splice(i, 1);
        if (s.weapon === "nuke") this.detonateNuke(hit, s.yield, s.profile);
        else this.explode(hit);
      } else if (
        s.age > WEAPONS[s.weapon].lifetime ||
        next[0] < 0 ||
        next[0] > 2048 ||
        next[2] < 0 ||
        next[2] > 2048
      )
        this.projectiles.splice(i, 1);
      else {
        s.p = next;
        s.v[1] -= WEAPONS[s.weapon].gravity * dt;
      }
    }
    const laserMS = this.processLaserWork(1);
    if (this.tick % 60 === 0)
      for (const z of this.burnZones) this.damageMonsters(z.p, z.radius, 1, true);
    this.processDestruction(Math.max(0.25, 2 - laserMS));
    this.destructionMS += laserMS;
    if (this.tick % 20 === 0) this.ensureTerrain();
    const start = performance.now();
    this.physics.step(this.events);
    this.physicsMS = lerp(this.physicsMS, performance.now() - start, 0.05);
    const cascade = new Set<number>();
    this.events.drainCollisionEvents((h1, h2, started) => {
      if (!started) return;
      const movingId =
        this.colliderMoving.get(h1) ?? this.colliderMoving.get(h2);
      const contactBody =
        movingId === undefined ? undefined : this.moving.get(movingId);
      if (contactBody && contactBody.age > 0.2) {
        const v = contactBody.body.linvel();
        const speed = Math.hypot(v.x, v.y, v.z);
        if (speed > 2)
          this.contact(
            arr(contactBody.body.translation()),
            contactBody.view.material,
            Math.min(2, speed / 20),
            "impact",
          );
      }
      let id = this.colliderEntities.get(h1),
        other = h2;
      if (id === undefined) {
        id = this.colliderEntities.get(h2);
        other = h1;
      }
      if (id === undefined) return;
      const bodyId = this.colliderMoving.get(other);
      const m = bodyId === undefined ? undefined : this.moving.get(bodyId);
      if (m && m.age > 0.2 && this.time - m.lastImpact > 0.3) {
        const v = m.body.linvel();
        if (Math.hypot(v.x, v.y, v.z) > 7) {
          cascade.add(id);
          m.lastImpact = this.time;
        }
      }
    });
    if (cascade.size) {
      this.bump();
      const budget = { n: 0 };
      for (const id of [...cascade].slice(0, 8)) {
        const e = this.world.entities[id];
        if (!this.removed.has(id)) this.fragment(e, e.p, 3, budget);
      }
      this.resolveSupport(this.plane.p);
    }
    for (const m of [...this.moving.values()]) {
      m.age += dt;
      const velocity = m.body.linvel(),
        needsCCD =
          Math.hypot(velocity.x, velocity.y, velocity.z) * dt >
          Math.min(...m.view.s) * 0.7;
      if (needsCCD !== m.ccd) {
        m.body.enableCcd(needsCCD);
        m.ccd = needsCCD;
      }
      const nextPosition = arr(m.body.translation()),
        previous = m.view.p;
      const steps = Math.max(
          1,
          Math.ceil(distance(previous, nextPosition) / 1.5),
        ),
        clearance = Math.min(...m.view.s) * 0.8;
      // Canonical terrain sweep also covers fast fragments crossing a streamed collider boundary.
      for (let i = 1; i <= steps; i++) {
        const t = i / steps,
          x = lerp(previous[0], nextPosition[0], t),
          z = lerp(previous[2], nextPosition[2], t),
          y = lerp(previous[1], nextPosition[1], t),
          floor = this.terrain.sample(x, z) + clearance;
        if (y < floor) {
          if (Math.abs(velocity.y) > 2)
            this.contact(
              [x, floor, z],
              m.view.material,
              Math.min(2, Math.abs(velocity.y) / 20),
              "impact",
            );
          m.body.setTranslation({ x, y: floor, z }, true);
          const v = m.body.linvel();
          m.body.setLinvel(
            { x: v.x * 0.65, y: Math.max(0, -v.y * 0.2), z: v.z * 0.65 },
            true,
          );
          break;
        }
      }
      m.view.p = arr(m.body.translation());
      const q = m.body.rotation();
      m.view.q = [q.x, q.y, q.z, q.w];
      if (m.body.isSleeping() && m.age > 2) this.settle(m);
      else if (
        m.age > [8, 12, 18, 24, 30][this.destruction.bodies] ||
        m.view.p[1] <
          this.terrain.sample(m.view.p[0], m.view.p[2]) -
            Math.max(...m.view.s) * 2 -
            10
      )
        this.settle(m, true);
    }
    if (this.tick % 12 === 0) this.updateAim();
    this.flush();
  }
  snapshot(): SimulationSnapshot {
    return {
      type: "snapshot",
      tick: this.tick,
      time: this.time,
      plane: structuredClone(this.plane),
      hour: this.hour,
      aim: this.aim,
      weapon: this.weapon,
      nukeYield: this.nukeYield,
      cooldowns: { ...this.cooldowns },
      lasers: structuredClone(this.lasers),
      projectiles: this.projectiles.map((s) => ({
        id: s.id,
        weapon: s.weapon,
        yield: s.yield,
        p: [...s.p],
        v: [...s.v],
      })),
      monsters: structuredClone(this.monsters.states.slice(0, this.monsterCount)),
      monsterSpikes: structuredClone(this.monsters.spikes),
      monsterCount: this.monsterCount,
      bodies: [...this.moving.values()].map((m) => structuredClone(m.view)),
      stats: {
        physicsMS: this.physicsMS,
        destructionMS: this.destructionMS,
        pendingJobs:
          this.pendingJobs.length +
          this.laserWork.size +
          this.laserSupport.size,
        bodies: this.moving.size,
        ruins: this.ruins.size,
        removed: this.removed.size,
        shots: this.shots,
        revision: this.revision,
      },
    };
  }
  save(): SaveSnapshot {
    // Capture moving pieces into a separate record map with the same bounded,
    // volume-preserving compactor; saving never changes the running physics world.
    const captured = new Map<number, Ruin>(
      [...this.ruins.values()].map((r) => [r.id, structuredClone(r)]),
    );
    const cells = new Map<number, Set<number>>();
    for (const r of captured.values()) {
      const k = this.cell(r.p);
      let ids = cells.get(k);
      if (!ids) cells.set(k, (ids = new Set()));
      ids.add(r.id);
    }
    for (const m of this.moving.values()) {
      const p: Vec3 = [
        clamp(m.view.p[0], 8, 2040),
        0,
        clamp(m.view.p[2], 8, 2040),
      ];
      const s: Vec3 = [...m.view.s];
      let q: Quat = [...m.view.q];
      if (m.view.kind === "tree") {
        s[0] = m.view.s[1];
        s[1] = 0.8;
        s[2] = 0.8;
        q = [0, 0, 0, 1];
      }
      p[1] = this.terrain.sample(p[0], p[2]) + this.orientedSize(s, q)[1];
      if (this.inBeam(p, this.orientedSize(s, q))) continue;
      let r: Ruin = { ...m.view, p, s, q, kind: "chunk" };
      const k = this.cell(p);
      let ids = cells.get(k);
      if (!ids) cells.set(k, (ids = new Set()));
      if (ids.size >= this.rubbleLimit) {
        const merged = consolidateRubble(
          r,
          [...ids].map((id) => captured.get(id)!),
          (x, z) => this.terrain.sample(x, z),
        );
        captured.delete(merged.removed);
        ids.delete(merged.removed);
        if (merged.ruin.id !== r.id) captured.set(merged.ruin.id, merged.ruin);
        else r = merged.ruin;
      }
      captured.set(r.id, r);
      ids.add(r.id);
    }
    const ruins = [...captured.values()];
    const terrain = new Float32Array(this.terrain.changed.size * 2);
    let offset = 0;
    this.terrain.changed.forEach((height, index) => {
      terrain[offset++] = index;
      terrain[offset++] = height;
    });
    return {
      destruction: { ...this.destruction },
      version: CONFIG.version,
      worldVersion: this.world.version,
      seed: this.world.seed,
      revision: this.revision,
      hour: this.hour,
      terrain,
      removed: [...this.removed],
      ruins,
      pendingJobs: structuredClone(this.pendingJobs),
      lasers: structuredClone(this.lasers),
      laserWork: structuredClone([...this.laserWork.values()]),
      laserSupport: [...this.laserSupport],
      laserCooldown: this.cooldowns.laser,
      laserDry: Uint32Array.from(
        this.terrain.laserDry.reduce((a: number[], v, i) => {
          if (v) a.push(i);
          return a;
        }, []),
      ),
      vaporized: [...this.vaporized],
      monsters: structuredClone(this.monsters.states),
    };
  }
  dispose() {
    this.events.free();
    this.physics.free();
  }
}
export async function initializePhysics() {
  await RAPIER.init();
}
