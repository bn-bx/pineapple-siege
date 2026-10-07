import RAPIER from "@dimforge/rapier3d-compat";
import { civilianPopulation } from "../civilian-morale";
import {
  BLAST_DEBRIS_LIMIT,
  CHUNKS,
  CONFIG,
  LASER,
  RAPID_FIRE_INTERVAL,
  WEAPONS,
  WRECKAGE_FADE_SECONDS,
  WRECKAGE_FLIGHT_SECONDS,
  WRECKAGE_LIFETIME,
  clamp,
  lerp,
} from "../config";
import {
  isRoof,
  roofClearance,
  roofParts,
  roofVertices,
} from "../debris-shape";
import {
  BODY_LIMITS,
  CANNON_LIMITS,
  COSMETIC_SCALE,
  DEFAULT_DESTRUCTION,
  RUBBLE_LIMITS,
  laserProfile,
  normalizeDestruction,
  nukeProfile,
  resolvedLaserProfile,
} from "../destruction-settings";
import { discoActive } from "../disco";
import type {
  BlastProfile,
  BodyView,
  ContactSound,
  DestructionJob,
  DestructionSettings,
  Entity,
  Explosion,
  FragmentEffect,
  InputState,
  LaserStrike,
  LaserWork,
  NukeYield,
  PlaneState,
  ProjectileWeapon,
  Quat,
  Ruin,
  SaveSnapshot,
  SimulationSnapshot,
  SupportJob,
  Vec3,
  WeaponId,
  WorkerMessage,
  WorldData,
} from "../types";
import { VERTICAL_LIMITS } from "../world/vertical-limits.mjs";
import {
  advanceDebris,
  orientedSize,
  type BallisticDebris,
} from "./ballistic-debris";
import { BodyPoseCache, DebrisMap } from "./body-pose-cache";
import { Civilians } from "./civilians";
import { DestructionDriver } from "./destruction-driver";
import { MonsterRagdolls } from "./monster-ragdolls";
import { MONSTER_BODY_HEIGHT, Monsters } from "./monsters";
import { packMotion } from "./motion-buffer";
import { consolidateRubble } from "./rubble";
import { SparseIndices } from "./sparse-indices";
import { SparseValues } from "./sparse-values";
import { StaticBlockerIndex } from "./static-blockers";
import { Terrain } from "./terrain";
import { WeaponDriver } from "./weapon-driver";
const vec = (p: Vec3) => ({ x: p[0], y: p[1], z: p[2] });
const identity = { x: 0, y: 0, z: 0, w: 1 };
// Membership in the upper 16 bits, permitted partners in the lower 16 bits.
const WORLD_COLLISIONS = 0x00010007;
const distance = (a: Vec3, b: Vec3) =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
function rand(n: number) {
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
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
  private weaponDriver?: WeaponDriver;
  private destructionDriver?: DestructionDriver;
  private prepareWeapons(): void {
    const sim = this;
    this.weaponDriver ??= new WeaponDriver({
      get weapon() {
        return sim.weapon;
      },
      set weapon(value) {
        sim.weapon = value;
      },
      get input() {
        return sim.input;
      },
      set input(value) {
        sim.input = value;
      },
      get cooldowns() {
        return sim.cooldowns;
      },
      set cooldowns(value) {
        sim.cooldowns = value;
      },
      laserAim: (...args) => sim.laserAim(...args),
      startLaser: (...args) => sim.startLaser(...args),
      get destruction() {
        return sim.destruction;
      },
      set destruction(value) {
        sim.destruction = value;
      },
      get projectiles() {
        return sim.projectiles;
      },
      get pendingJobs() {
        return sim.pendingJobs;
      },
      get shots() {
        return sim.shots;
      },
      set shots(value) {
        sim.shots = value;
      },
      get nextShot() {
        return sim.nextShot;
      },
      set nextShot(value) {
        sim.nextShot = value;
      },
      get nukeYield() {
        return sim.nukeYield;
      },
      set nukeYield(value) {
        sim.nukeYield = value;
      },
      sweep: (...args) => sim.sweep(...args),
      get monsters() {
        return sim.monsters;
      },
      detonateNuke: (...args) => sim.detonateNuke(...args),
      explode: (...args) => sim.explode(...args),
    });
  }

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
  get monsterCount() {
    return this.monsters.count;
  }
  setMonsterCount(value: number) {
    this.monsters.setCount(value);
    this.civilians.rebaseline(this.monsters.active());
    this.bump();
  }
  readonly physics: RAPIER.World;
  readonly monsterRagdolls: MonsterRagdolls;
  readonly removed = new Set<number>();
  readonly ruins = new Map<number, Ruin>();
  private bodyPoses = new BodyPoseCache();
  /** Compatibility counter: blast wreckage no longer owns native bodies. */
  readonly moving = new Map<number, never>();
  readonly ballistic = new DebrisMap<BallisticDebris>(this.bodyPoses);
  private cleanupExpiry = new Map<number, number>();
  private cleanupRemains = new DebrisMap<{
    view: BodyView;
  }>(this.bodyPoses);
  private clearingOldRubble = false;
  readonly entityColliders = new Map<number, RAPIER.Collider>();
  private ruinColliders = new Map<number, RAPIER.Collider>();
  private terrainColliders = new Map<number, RAPIER.Collider>();
  private pendingTerrainColliders = new Set<number>();
  private assemblies = new Map<string, number[]>();
  readonly projectiles: Shot[] = [];
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
    // Blast motion uses a fixed visual pool independent of old physics budgets.
  }
  private trackCleanup(id: number) {
    if (!this.cleanupExpiry.has(id))
      this.cleanupExpiry.set(id, this.time + WRECKAGE_LIFETIME);
  }
  private cleanupScale(id: number) {
    return clamp(
      ((this.cleanupExpiry.get(id) ?? this.time + WRECKAGE_FADE_SECONDS) -
        this.time) /
        WRECKAGE_FADE_SECONDS,
      0,
      1,
    );
  }
  private packSnapshotBodies(reuse?: ArrayBuffer) {
    const packet = this.bodyPoses.pack(reuse);
    const ids = new Int32Array(packet.buffer, 0, packet.count * 2);
    const transforms = new Float32Array(
      packet.buffer,
      packet.count * 8,
      packet.count * 10,
    );
    for (let i = 0; i < packet.count; i++) {
      const scale = this.cleanupScale(ids[i * 2]);
      for (let axis = 0; axis < 3; axis++)
        transforms[i * 10 + 7 + axis] *= scale;
    }
    return packet;
  }
  private updateCleanup(dt: number) {
    if (this.clearingOldRubble) {
      const started = performance.now();
      let removed = 0;
      for (const id of this.ruins.keys()) {
        this.removeRuin(id);
        if (++removed >= 128 || performance.now() - started > 0.5) break;
      }
      this.clearingOldRubble = this.ruins.size > 0;
      if (removed) this.bump();
    }
    for (const [id, expires] of this.cleanupExpiry) {
      const remaining = expires - this.time;
      if (remaining > WRECKAGE_FADE_SECONDS + 1e-9) continue;
      const ballistic = this.ballistic.get(id);
      if (ballistic) {
        this.ballistic.delete(id);
        this.cleanupRemains.set(id, {
          view: ballistic.view,
        });
      }
      if (remaining <= 1e-9) {
        this.cleanupRemains.delete(id);
        this.cleanupExpiry.delete(id);
        this.bump();
      }
    }
    for (const monster of this.monsters.states) {
      if (!monster.defeated || monster.cleared) continue;
      const previousAge = monster.cleanupAge ?? 0;
      const age = (monster.cleanupAge = previousAge + dt);
      monster.cleanupScale = clamp(
        (WRECKAGE_LIFETIME - age) / WRECKAGE_FADE_SECONDS,
        0,
        1,
      );
      if (
        previousAge < WRECKAGE_FLIGHT_SECONDS &&
        age >= WRECKAGE_FLIGHT_SECONDS - 1e-9
      )
        this.monsterRagdolls.stop(monster);
      if (age >= WRECKAGE_LIFETIME - 1e-9) {
        this.monsterRagdolls.stop(monster);
        monster.cleared = true;
        monster.cleanupScale = 0;
        monster.ragdoll = undefined;
        monster.fragments = undefined;
        this.bump();
      }
    }
  }

  cooldowns = { cannon: 0, nuke: 0, laser: 0 };
  readonly lasers: LaserStrike[] = [];
  readonly laserWork = new Map<number, LaserWork>();
  readonly laserSupport = new Set<string>();
  readonly civilians: Civilians;
  readonly vaporized = new Set<number>();
  private burnCells = new Map<number, { p: Vec3; radius: number }[]>();
  private burnZones: { p: Vec3; radius: number }[] = [];
  readonly pendingJobs: DestructionJob[] = [];
  readonly supportJobs: SupportJob[] = [];
  private supportConnected = new WeakMap<SupportJob, Set<number>>();
  private supportClusters = new WeakMap<SupportJob, Map<string, number[]>>();
  destructionMS = 0;
  private dirtyRuins = new Map<number, Ruin | null>();
  private captures = new Map<
    number,
    {
      terrain: SparseValues;
      dry: SparseIndices;
      ruins: Map<number, Ruin | null>;
    }
  >();
  private nextCapture = 1;
  private ruinSection = new Map<number, number>();
  private ruinCells = new Map<number, Set<number>>();
  private queryMarks = new Uint32Array(0);
  private querySerial = 0;
  private streamedStatics = false;
  private maxRuinExtent = 0;
  private ruinShapes = new Map<number, RAPIER.Shape>();
  private staticShapes = new Map<number, RAPIER.Shape>();
  private entityCells = new Map<number, number[]>();
  private civilianBlockers = new StaticBlockerIndex(16, 1, false);
  private monsterBlockers = new StaticBlockerIndex(64, 30, true);
  private blockedCivilian = (p: Vec3) =>
    this.civilianBlockers.blocked(p, this.removed);
  private blockedMonster = (_a: Vec3, p: Vec3) =>
    this.monsterBlockers.blocked(p, this.removed);
  shots = 0;
  physicsMS = 0;
  stepMS = 0;
  private worstStep?: SimulationSnapshot["stats"]["worstStep"];
  stageMS = {
    flight: 0,
    projectiles: 0,
    destruction: 0,
    terrainMaintenance: 0,
    presentationEvents: 0,
    unclassified: 0,
    monsters: 0,
    residents: 0,
    residency: 0,
    physics: 0,
    ballistic: 0,
    lasers: 0,
    colliders: 0,
  };
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
    incremental = false,
  ) {
    this.streamedStatics = incremental;
    this.queryMarks = new Uint32Array(world.entities.length);
    this.terrain = new Terrain(heights, world.rivers, incremental);
    this.monsters = new Monsters(world, this.terrain, save?.monsters);
    this.physics = new RAPIER.World({ x: 0, y: -CONFIG.debrisGravity, z: 0 });
    this.monsterRagdolls = new MonsterRagdolls(this.physics, this.terrain);
    for (const m of this.monsters.states)
      if (
        m.defeated &&
        m.ragdoll &&
        (m.cleanupAge ?? 0) < WRECKAGE_FLIGHT_SECONDS
      )
        this.monsterRagdolls.start(m);
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
      this.supportJobs.push(...structuredClone(save.supportJobs || []));
      for (const r of save.ruins) {
        this.ruins.set(r.id, r);
        this.maxRuinExtent = Math.max(this.maxRuinExtent, ...r.s);
        this.ruinShapes.delete(r.id);
        this.dirtyRuins.set(r.id, r);
        this.ruinSection.set(r.id, this.cell(r.p));
        this.indexRuin(r);
        this.nextBody = Math.max(this.nextBody, r.id + 1);
      }
    }
    this.clearingOldRubble = this.ruins.size > 0;
    this.civilians = new Civilians(world, this.terrain, this.removed, save);
    for (const e of world.entities) {
      for (
        let z = clamp(Math.floor((e.p[2] - e.s[2]) / 64), 0, CHUNKS - 1);
        z <= clamp(Math.floor((e.p[2] + e.s[2]) / 64), 0, CHUNKS - 1);
        z++
      )
        for (
          let x = clamp(Math.floor((e.p[0] - e.s[0]) / 64), 0, CHUNKS - 1);
          x <= clamp(Math.floor((e.p[0] + e.s[0]) / 64), 0, CHUNKS - 1);
          x++
        ) {
          let key = z * CHUNKS + x,
            list = this.entityCells.get(key);
          if (!list) this.entityCells.set(key, (list = []));
          list.push(e.id);
        }

      this.civilianBlockers.add(e);
      this.monsterBlockers.add(e);
      if (e.assembly) {
        let ids = this.assemblies.get(e.assembly);
        if (!ids) this.assemblies.set(e.assembly, (ids = []));
        ids.push(e.id);
      }
      if (!this.streamedStatics && !this.removed.has(e.id))
        this.addEntityCollider(e);
    }
    for (const r of this.ruins.values())
      if (!this.streamedStatics) this.addRuinCollider(r);
    this.ensureTerrain();
    this.ensureStaticColliders();
    if (this.lasers.length) this.updateLasers(0);
    this.physics.step();
    this.respawn();
  }
  private addEntityCollider(e: Entity) {
    const d =
      e.kind === "tree"
        ? RAPIER.ColliderDesc.cylinder(e.s[1], Math.min(2.2, e.s[0] * 0.65))
        : RAPIER.ColliderDesc.cuboid(...e.s);
    d.setTranslation(...e.p)
      .setFriction(0.8)
      .setCollisionGroups(WORLD_COLLISIONS);
    const c = this.physics.createCollider(d);
    this.entityColliders.set(e.id, c);
  }
  private debrisCollider(
    s: Vec3,
    material: BodyView["material"],
    pile = false,
    roofPart = 0,
  ) {
    return isRoof(material) && !pile
      ? RAPIER.ColliderDesc.convexHull(roofVertices(s, roofPart))!
      : RAPIER.ColliderDesc.cuboid(...s);
  }
  private addRuinCollider(r: Ruin) {
    const d = this.debrisCollider(r.s, r.material, r.pile, r.roofPart)
      .setTranslation(...r.p)
      .setRotation({ x: r.q[0], y: r.q[1], z: r.q[2], w: r.q[3] })
      .setFriction(0.95)
      .setCollisionGroups(WORLD_COLLISIONS);
    this.ruinColliders.set(r.id, this.physics.createCollider(d));
  }
  private buildTerrainCollider(id: number) {
    const old = this.terrainColliders.get(id);
    if (old) this.physics.removeCollider(old, true);
    const cx = id % CHUNKS,
      cz = Math.floor(id / CHUNKS),
      heights = new Float32Array(33 * 33);
    // Rapier heightfields are column-major; their triangle diagonal matches our sampler.
    for (let z = 0; z <= 32; z++)
      for (let x = 0; x <= 32; x++)
        heights[x * 33 + z] =
          this.terrain.heights[(cz * 32 + z) * CONFIG.grid + cx * 32 + x];
    const descriptor = RAPIER.ColliderDesc.heightfield(
      32,
      32,
      heights,
      { x: 64, y: 1, z: 64 },
      RAPIER.HeightFieldFlags.FIX_INTERNAL_EDGES,
    )
      .setTranslation(cx * 64 + 32, 0, cz * 64 + 32)
      .setFriction(0.85)
      .setCollisionGroups(WORLD_COLLISIONS);
    this.terrainColliders.set(id, this.physics.createCollider(descriptor));
  }
  private invalidateTerrainCollider(id: number) {
    if (!this.streamedStatics || this.tick === 0) {
      this.buildTerrainCollider(id);
      return;
    }
    const old = this.terrainColliders.get(id);
    if (old) {
      this.physics.removeCollider(old, true);
      this.terrainColliders.delete(id);
    }
    this.pendingTerrainColliders.add(id);
  }
  private processTerrainColliders(budgetMS: number) {
    const start = performance.now();
    while (
      this.pendingTerrainColliders.size &&
      performance.now() - start < budgetMS
    ) {
      const id = this.pendingTerrainColliders.values().next().value!;
      this.pendingTerrainColliders.delete(id);
      this.buildTerrainCollider(id);
    }
    this.stageMS.colliders = performance.now() - start;
  }
  private ensureTerrain() {
    const wanted = new Set<number>();
    const near = (p: Vec3, r: number) => {
      for (
        let z = clamp(Math.floor((p[2] - r) / 64), 0, CHUNKS - 1);
        z <= clamp(Math.floor((p[2] + r) / 64), 0, CHUNKS - 1);
        z++
      )
        for (
          let x = clamp(Math.floor((p[0] - r) / 64), 0, CHUNKS - 1);
          x <= clamp(Math.floor((p[0] + r) / 64), 0, CHUNKS - 1);
          x++
        )
          wanted.add(z * CHUNKS + x);
    };
    near(this.plane.p, 85);
    for (const s of this.projectiles) near(s.p, 12);
    for (const id of wanted)
      if (!this.terrainColliders.has(id)) {
        if (this.streamedStatics && this.tick > 0)
          this.pendingTerrainColliders.add(id);
        else this.buildTerrainCollider(id);
      }
    for (const id of this.pendingTerrainColliders)
      if (!wanted.has(id)) this.pendingTerrainColliders.delete(id);
    for (const [id, c] of this.terrainColliders)
      if (!wanted.has(id)) {
        this.physics.removeCollider(c, true);
        this.terrainColliders.delete(id);
      }
  }
  private nearbyRuinCandidates(p: Vec3, r: number): Ruin[] {
    const result: Ruin[] = [];
    const reach = r + this.maxRuinExtent;
    for (
      let z = clamp(Math.floor((p[2] - reach) / 64), 0, CHUNKS - 1);
      z <= clamp(Math.floor((p[2] + reach) / 64), 0, CHUNKS - 1);
      z++
    )
      for (
        let x = clamp(Math.floor((p[0] - reach) / 64), 0, CHUNKS - 1);
        x <= clamp(Math.floor((p[0] + reach) / 64), 0, CHUNKS - 1);
        x++
      )
        for (const id of this.ruinCells.get(z * CHUNKS + x) || []) {
          const ruin = this.ruins.get(id);
          if (ruin) result.push(ruin);
        }
    return result;
  }
  private ensureStaticColliders() {
    if (!this.streamedStatics) return;
    const wanted = new Set<number>(),
      wantedRuins = new Set<number>();
    const cells = new Map<number, { lo: number; hi: number }>();
    const add = (p: Vec3, r: number) => {
      const reach = r + this.maxRuinExtent;
      for (
        let z = clamp(Math.floor((p[2] - reach) / 64), 0, CHUNKS - 1);
        z <= clamp(Math.floor((p[2] + reach) / 64), 0, CHUNKS - 1);
        z++
      )
        for (
          let x = clamp(Math.floor((p[0] - reach) / 64), 0, CHUNKS - 1);
          x <= clamp(Math.floor((p[0] + reach) / 64), 0, CHUNKS - 1);
          x++
        ) {
          const key = z * CHUNKS + x,
            old = cells.get(key);
          if (old) {
            old.lo = Math.min(old.lo, p[1] - r);
            old.hi = Math.max(old.hi, p[1] + r);
          } else cells.set(key, { lo: p[1] - r, hi: p[1] + r });
        }
    };
    add(this.plane.p, 110);
    for (const [key, range] of cells) {
      for (const id of this.entityCells.get(key) || []) {
        if (this.removed.has(id) || wanted.has(id)) continue;
        const e = this.world.entities[id];
        if (e.p[1] + e.s[1] >= range.lo && e.p[1] - e.s[1] <= range.hi)
          wanted.add(id);
      }
      for (const id of this.ruinCells.get(key) || []) {
        const r = this.ruins.get(id);
        if (
          r &&
          r.p[1] + Math.max(...r.s) >= range.lo &&
          r.p[1] - Math.max(...r.s) <= range.hi
        )
          wantedRuins.add(id);
      }
    }
    for (const id of wantedRuins)
      if (!this.ruinColliders.has(id))
        this.addRuinCollider(this.ruins.get(id)!);
    for (const [id, c] of this.ruinColliders)
      if (!wantedRuins.has(id)) {
        this.physics.removeCollider(c, true);
        this.ruinColliders.delete(id);
      }
    for (const id of wanted)
      if (!this.entityColliders.has(id))
        this.addEntityCollider(this.world.entities[id]);
    for (const [id, c] of this.entityColliders)
      if (!wanted.has(id)) {
        this.physics.removeCollider(c, true);
        this.entityColliders.delete(id);
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
    this.staticShapes.delete(e.id);
    this.civilians.structureRemoved(e);
    this.changedRemoved.push(e.id);
    const c = this.entityColliders.get(e.id);
    if (c) {
      this.physics.removeCollider(c, true);
      this.entityColliders.delete(e.id);
    }
    if (e.assembly) this.dirtyAssemblies.add(e.assembly);
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
    roofPart = 0,
  ) {
    if (
      (!existing && this.vaporized.has(source)) ||
      this.inBeam(p, this.orientedSize(s, q))
    )
      return -1;
    if (this.bodyPoses.size >= BLAST_DEBRIS_LIMIT) return -1;
    const id = this.nextBody++;
    this.addBallistic(
      {
        id,
        p: [...p],
        q: [...q],
        s: [...s],
        material,
        kind,
        source,
        ...(roofPart ? { roofPart } : {}),
      },
      [...impulse],
    );
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
    if (isRoof(e.material)) {
      this.fragmentRoof(e, origin, force, budget);
      return;
    }
    if (budget.n >= limit) {
      this.staticFragment(e, origin, force);
      return;
    }
    // Prepared splits partition the source box.
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
  private fragmentRoof(
    e: Entity,
    origin: Vec3,
    force: number,
    budget = { n: 0, limit: 0 } as { n: number; limit?: number },
  ) {
    for (
      let i = 0;
      i < roofParts.length && this.bodyPoses.size < BLAST_DEBRIS_LIMIT;
      i++
    ) {
      const part = roofParts[i];
      const p = e.p.map((v, k) => v + part.offset[k] * e.s[k]) as Vec3;
      const s = e.s.map((v, k) => v * part.size[k]) as Vec3;
      const velocity = this.scatterVelocity(
        p,
        origin,
        force * (0.85 + rand(e.id * 13 + i) * 0.15),
        e.id + i,
      );
      if (budget.n < (budget.limit ?? this.fragmentLimit)) {
        this.spawnBody(
          p,
          s,
          e.material,
          e.id,
          "chunk",
          velocity,
          [0, 0, 0, 1],
          false,
          i + 1,
        );
        budget.n++;
      } else {
        const view: BodyView = {
          id: this.nextBody++,
          source: e.id,
          kind: "chunk",
          material: e.material,
          p,
          s,
          q: [0, 0, 0, 1],
          roofPart: i + 1,
        };
        if (!this.inBeam(p, s)) this.addBallistic(view, velocity);
      }
    }
  }
  private staticFragment(e: Entity, origin?: Vec3, force = 0) {
    if (this.vaporized.has(e.id) || this.bodyPoses.size >= BLAST_DEBRIS_LIMIT)
      return;
    if (origin && force > 0) {
      if (isRoof(e.material)) {
        this.fragmentRoof(e, origin, force);
        return;
      }
      const tree = e.kind === "tree";
      const size: Vec3 = tree
        ? [Math.min(1, e.s[0] * 0.25), e.s[1], Math.min(1, e.s[2] * 0.25)]
        : [...e.s];
      const yaw = e.kind === "block" ? 0 : e.variant * Math.PI;
      const view: BodyView = {
        id: this.nextBody++,
        p: [...e.p],
        s: size,
        q: [0, Math.sin(yaw), 0, Math.cos(yaw)],
        material: tree ? "wood" : e.material,
        kind: tree ? "tree" : e.kind === "rock" ? "rock" : "chunk",
        source: e.id,
      };
      if (!this.inBeam(view.p, this.orientedSize(view.s, view.q)))
        this.addBallistic(view, this.scatterVelocity(e.p, origin, force, e.id));
      return;
    }
    const x = e.p[0],
      z = e.p[2];
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
      let z = clamp(Math.floor((p[2] - radius) / 64), 0, CHUNKS - 1);
      z <= clamp(Math.floor((p[2] + radius) / 64), 0, CHUNKS - 1);
      z++
    )
      for (
        let x = clamp(Math.floor((p[0] - radius) / 64), 0, CHUNKS - 1);
        x <= clamp(Math.floor((p[0] + radius) / 64), 0, CHUNKS - 1);
        x++
      )
        for (const id of this.ruinCells.get(z * CHUNKS + x) || []) {
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
    for (const m of this.ballistic.values()) {
      const d = distance(m.view.p, p);
      if (d >= radius) continue;
      m.velocity = this.scatterVelocity(
        m.view.p,
        p,
        speed * (1 - (0.65 * d) / radius),
        m.view.id,
      );
      m.grounded = 0;
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
        r.roofPart,
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
        count: Math.min(count, 256),
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
      const x = clamp(p[0] + Math.cos(a) * r, 1, CONFIG.worldSize - 1),
        z = clamp(p[2] + Math.sin(a) * r, 1, CONFIG.worldSize - 1),
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
      clamp(Math.floor(p[2] / 64), 0, CHUNKS - 1) * CHUNKS +
      clamp(Math.floor(p[0] / 64), 0, CHUNKS - 1)
    );
  }
  private indexRuin(r: Ruin) {
    const k = this.cell(r.p);
    let ids = this.ruinCells.get(k);
    if (!ids) this.ruinCells.set(k, (ids = new Set()));
    ids.add(r.id);
  }
  private nearbyEntities(p: Vec3, radius: number) {
    const ids: number[] = [];
    let serial = ++this.querySerial;
    if (serial >= 0xffffffff) {
      this.queryMarks.fill(0);
      serial = this.querySerial = 1;
    }
    for (
      let z = clamp(Math.floor((p[2] - radius) / 64), 0, CHUNKS - 1);
      z <= clamp(Math.floor((p[2] + radius) / 64), 0, CHUNKS - 1);
      z++
    )
      for (
        let x = clamp(Math.floor((p[0] - radius) / 64), 0, CHUNKS - 1);
        x <= clamp(Math.floor((p[0] + radius) / 64), 0, CHUNKS - 1);
        x++
      )
        for (const id of this.entityCells.get(z * CHUNKS + x) || [])
          if (this.queryMarks[id] !== serial) {
            this.queryMarks[id] = serial;
            ids.push(id);
          }
    return ids;
  }
  private insertRuin(r: Ruin) {
    if (this.burnZones.length && this.inBeam(r.p, this.orientedSize(r.s, r.q)))
      return;
    if (
      this.bodyPoses.size >= BLAST_DEBRIS_LIMIT &&
      !this.cleanupExpiry.has(r.id)
    )
      return;
    this.trackCleanup(r.id);
    this.cleanupRemains.set(r.id, { view: r });
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
    this.ruinShapes.delete(id);
    this.dirtyRuins.set(id, null);
    this.changedRubbleRemoved.push(id);
  }
  private addBallistic(view: BodyView, velocity: Vec3, angular?: Vec3) {
    if (
      this.bodyPoses.size >= BLAST_DEBRIS_LIMIT &&
      !this.cleanupExpiry.has(view.id)
    )
      return;
    this.trackCleanup(view.id);
    this.ballistic.set(view.id, {
      view,
      velocity,
      grounded: 0,
      angular: angular ?? [
        (rand(view.id) - 0.5) * 3,
        (rand(view.id + 1) - 0.5) * 3,
        (rand(view.id + 2) - 0.5) * 3,
      ],
    });
  }
  private resolveSupport(
    origin: Vec3,
    coarse = 7,
    dynamicBudget = this.fragmentLimit,
    deferred?: number[][],
  ) {
    if (this.streamedStatics) {
      for (const name of this.dirtyAssemblies) {
        this.supportJobs.push({
          name,
          origin: [...origin],
          coarse,
          budget: dynamicBudget,
          ownerSeed: deferred
            ? this.pendingJobs.find((j) => j.supportQueue === deferred)?.seed
            : undefined,
          phase: "foundations",
          cursor: 0,
          alive: [],
          connected: [],
          clusters: [],
        });
      }
      this.dirtyAssemblies.clear();
      return 0;
    }
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
        const key = isRoof(e.material)
          ? `roof:${e.id}`
          : e.material +
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
        if (isRoof(group[0].material)) {
          const budget = { n: 0, limit: Math.max(0, dynamicBudget) };
          this.fragmentRoof(group[0], origin, 25, budget);
          dynamicBudget -= budget.n;
          spawned += budget.n;
          continue;
        }
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
  private processSupport(deadline: number) {
    while (this.supportJobs.length && performance.now() < deadline) {
      const job = this.supportJobs[0],
        ids = this.assemblies.get(job.name) || [];
      let connected = this.supportConnected.get(job);
      if (!connected)
        this.supportConnected.set(job, (connected = new Set(job.connected)));
      if (job.phase === "foundations") {
        if (job.cursor >= ids.length) {
          job.phase = "links";
          job.cursor = 0;
          continue;
        }
        const id = ids[job.cursor++];
        if (this.removed.has(id)) continue;
        job.alive.push(id);
        const e = this.world.entities[id];
        if (
          e.foundation &&
          this.terrain.sample(e.p[0], e.p[2]) >= e.p[1] - e.s[1] - 1.4
        ) {
          connected.add(id);
          job.connected.push(id);
        }
      } else if (job.phase === "links") {
        if (job.cursor >= job.connected.length) {
          job.phase = "falling";
          job.cursor = 0;
          continue;
        }
        for (const next of this.world.entities[job.connected[job.cursor++]]
          .supports)
          if (!this.removed.has(next) && !connected.has(next)) {
            connected.add(next);
            job.connected.push(next);
          }
      } else if (job.phase === "falling") {
        if (job.cursor >= job.alive.length) {
          job.phase = "emit";
          job.cursor = 0;
          continue;
        }
        const id = job.alive[job.cursor++];
        if (connected.has(id) || this.removed.has(id)) continue;
        const e = this.world.entities[id];
        let clusters = this.supportClusters.get(job);
        if (!clusters) {
          clusters = new Map();
          for (const group of job.clusters) {
            const e = this.world.entities[group[0]];
            clusters.set(
              isRoof(e.material)
                ? "roof:" + e.id
                : e.material +
                    ":" +
                    Math.floor(e.p[0] / job.coarse) +
                    ":" +
                    Math.floor(e.p[1] / (job.coarse * 0.85)) +
                    ":" +
                    Math.floor(e.p[2] / job.coarse),
              group,
            );
          }
          this.supportClusters.set(job, clusters);
        }
        const key = isRoof(e.material)
          ? "roof:" + e.id
          : e.material +
            ":" +
            Math.floor(e.p[0] / job.coarse) +
            ":" +
            Math.floor(e.p[1] / (job.coarse * 0.85)) +
            ":" +
            Math.floor(e.p[2] / job.coarse);
        let cluster = clusters.get(key);
        if (!cluster) {
          clusters.set(key, (cluster = []));
          job.clusters.push(cluster);
        }
        if (job.clusters.length === 1 && cluster.length === 0)
          this.emit({
            type: "explosion",
            p: e.p,
            water: false,
            power: 1,
            seed: this.tick,
            kind: "collapse",
          });
        this.removeEntity(e);
        cluster.push(id);
        this.bump();
      } else {
        if (job.cursor >= job.clusters.length) {
          this.supportJobs.shift();
          this.dirtyAssemblies.delete(job.name);
          continue;
        }
        const group = job.clusters[job.cursor++];
        const owner =
          job.ownerSeed !== undefined
            ? this.pendingJobs.find((j) => j.seed === job.ownerSeed)
            : undefined;
        if (owner) {
          (owner.supportQueue ??= []).push(group);
          continue;
        }
        const first = this.world.entities[group[0]];
        if (isRoof(first.material)) {
          const budget = { n: 0, limit: Math.max(0, job.budget) };
          this.fragmentRoof(first, job.origin, 25, budget);
          job.budget -= budget.n;
          continue;
        }
        const min: Vec3 = [Infinity, Infinity, Infinity],
          max: Vec3 = [-Infinity, -Infinity, -Infinity];
        for (const id of group) {
          const e = this.world.entities[id];
          for (let k = 0; k < 3; k++) {
            min[k] = Math.min(min[k], e.p[k] - e.s[k]);
            max[k] = Math.max(max[k], e.p[k] + e.s[k]);
          }
        }
        const p: Vec3 = [0, 0, 0],
          s: Vec3 = [0, 0, 0];
        for (let k = 0; k < 3; k++) {
          p[k] = (min[k] + max[k]) / 2;
          s[k] = Math.max(0.1, (max[k] - min[k]) / 2);
        }
        if (job.budget-- <= 0)
          this.staticFragment({ ...first, p, s }, job.origin, 25);
        else
          this.spawnBody(p, s, first.material, first.id, "chunk", [
            (p[0] - job.origin[0]) * 0.09,
            1,
            (p[2] - job.origin[2]) * 0.09,
          ]);
      }
    }
  }
  detonateNuke(
    p: Vec3,
    strength: NukeYield = this.nukeYield,
    releasedProfile?: BlastProfile,
  ) {
    const profile = releasedProfile ?? nukeProfile(strength, this.destruction);
    this.damageMonsters(p, profile.damageRadius, 5);
    const chunks: number[] = [];
    for (
      let z = clamp(
        Math.floor((p[2] - profile.craterRadius) / 64),
        0,
        CHUNKS - 1,
      );
      z <= clamp(Math.floor((p[2] + profile.craterRadius) / 64), 0, CHUNKS - 1);
      z++
    )
      for (
        let x = clamp(
          Math.floor((p[0] - profile.craterRadius) / 64),
          0,
          CHUNKS - 1,
        );
        x <=
        clamp(Math.floor((p[0] + profile.craterRadius) / 64), 0, CHUNKS - 1);
        x++
      )
        chunks.push(z * CHUNKS + x);
    chunks.sort(
      (a, b) =>
        Math.hypot(
          (a % CHUNKS) * 64 + 32 - p[0],
          Math.floor(a / CHUNKS) * 64 + 32 - p[2],
        ) -
        Math.hypot(
          (b % CHUNKS) * 64 + 32 - p[0],
          Math.floor(b / CHUNKS) * 64 + 32 - p[2],
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
        this.terrain.water(p[0], p[2]) &&
        p[1] <=
          (this.terrain.surfaceHeight(p[0], p[2]) ?? 0) +
            WEAPONS.nuke.length / 2 +
            1,
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
  processDestruction(budgetMS = 2): void {
    const sim = this;
    this.destructionDriver ??= new DestructionDriver({
      processSupport: (...args) => sim.processSupport(...args),
      get pendingJobs() {
        return sim.pendingJobs;
      },
      bump: (...args) => sim.bump(...args),
      get terrain() {
        return sim.terrain;
      },
      get revision() {
        return sim.revision;
      },
      set revision(value) {
        sim.revision = value;
      },
      get terrainColliders() {
        return sim.terrainColliders;
      },
      set terrainColliders(value) {
        sim.terrainColliders = value;
      },
      invalidateTerrainCollider: (...args) =>
        sim.invalidateTerrainCollider(...args),
      flush: (...args) => sim.flush(...args),
      get world() {
        return sim.world;
      },
      get removed() {
        return sim.removed;
      },
      get plane() {
        return sim.plane;
      },
      set plane(value) {
        sim.plane = value;
      },
      fragment: (...args) => sim.fragment(...args),
      removeEntity: (...args) => sim.removeEntity(...args),
      staticFragment: (...args) => sim.staticFragment(...args),
      emitFragments: (...args) => sim.emitFragments(...args),
      get dirtyAssemblies() {
        return sim.dirtyAssemblies;
      },
      set dirtyAssemblies(value) {
        sim.dirtyAssemblies = value;
      },
      resolveSupport: (...args) => sim.resolveSupport(...args),
      get supportJobs() {
        return sim.supportJobs;
      },
      get destructionMS() {
        return sim.destructionMS;
      },
      set destructionMS(value) {
        sim.destructionMS = value;
      },
    });
    this.destructionDriver.process(budgetMS);
  }
  explode(p: Vec3, power = 1, kind: Explosion["kind"] = "blast") {
    this.bump();
    if (kind === "blast")
      this.damageMonsters(p, CONFIG.damageRadius * power, 1);
    const water =
      this.terrain.water(p[0], p[2]) &&
      p[1] < (this.terrain.surfaceHeight(p[0], p[2]) ?? 0) + 4;
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
        if (this.terrainColliders.has(id)) this.invalidateTerrainCollider(id);
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
    if (this.streamedStatics) {
      const middle: Vec3 = [
        (a[0] + b[0]) / 2,
        (a[1] + b[1]) / 2,
        (a[2] + b[2]) / 2,
      ];
      const envelope = Math.max(radius, halfLength),
        loX = Math.min(a[0], b[0]) - envelope,
        hiX = Math.max(a[0], b[0]) + envelope,
        loY = Math.min(a[1], b[1]) - envelope,
        hiY = Math.max(a[1], b[1]) + envelope,
        loZ = Math.min(a[2], b[2]) - envelope,
        hiZ = Math.max(a[2], b[2]) + envelope,
        sweepShape =
          halfLength > radius
            ? new RAPIER.Capsule(halfLength - radius, radius)
            : new RAPIER.Ball(radius);
      for (const id of this.nearbyEntities(middle, len / 2 + envelope)) {
        if (this.removed.has(id)) continue;
        const e = this.world.entities[id];
        if (
          loX > e.p[0] + e.s[0] ||
          hiX < e.p[0] - e.s[0] ||
          loY > e.p[1] + e.s[1] ||
          hiY < e.p[1] - e.s[1] ||
          loZ > e.p[2] + e.s[2] ||
          hiZ < e.p[2] - e.s[2]
        )
          continue;
        let shape = this.staticShapes.get(id);
        if (!shape) {
          shape =
            e.kind === "tree"
              ? new RAPIER.Cylinder(e.s[1], Math.min(2.2, e.s[0] * 0.65))
              : new RAPIER.Cuboid(...e.s);
          this.staticShapes.set(id, shape);
        }
        const hit =
          radius > 0
            ? sweepShape.castShape(
                vec(a),
                rotation,
                vec(delta),
                shape,
                vec(e.p),
                identity,
                { x: 0, y: 0, z: 0 },
                0,
                best,
                true,
              )?.time_of_impact
            : shape.castRay(
                new RAPIER.Ray(vec(a), vec(delta)),
                vec(e.p),
                identity,
                best,
                true,
              );
        if (hit !== undefined && hit >= 0 && hit < best) best = hit;
      }
      for (const r of this.nearbyRuinCandidates(middle, len / 2 + envelope)) {
        const extent = this.orientedSize(r.s, r.q);
        if (
          loX > r.p[0] + extent[0] ||
          hiX < r.p[0] - extent[0] ||
          loY > r.p[1] + extent[1] ||
          hiY < r.p[1] - extent[1] ||
          loZ > r.p[2] + extent[2] ||
          hiZ < r.p[2] - extent[2]
        )
          continue;
        let shape = this.ruinShapes.get(r.id);
        if (!shape) {
          shape = this.debrisCollider(
            r.s,
            r.material,
            r.pile,
            r.roofPart,
          ).shape;
          this.ruinShapes.set(r.id, shape);
        }
        const q = { x: r.q[0], y: r.q[1], z: r.q[2], w: r.q[3] };
        const hit =
          radius > 0
            ? sweepShape.castShape(
                vec(a),
                rotation,
                vec(delta),
                shape,
                vec(r.p),
                q,
                { x: 0, y: 0, z: 0 },
                0,
                best,
                true,
              )?.time_of_impact
            : shape.castRay(
                new RAPIER.Ray(vec(a), vec(delta)),
                vec(r.p),
                q,
                best,
                true,
              );
        if (hit !== undefined && hit >= 0 && hit < best) best = hit;
      }
    }
    const steps = Math.ceil(len / 1.5);
    for (let i = 0; i <= steps; i++) {
      let t = i / steps;
      if (t >= best) break;
      let x = lerp(a[0], b[0], t),
        y = lerp(a[1], b[1], t),
        z = lerp(a[2], b[2], t);
      if (
        y - extent <=
        Math.max(
          this.terrain.sample(x, z),
          this.terrain.surfaceHeight(x, z) ?? -1e5,
        )
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
    p.boundary =
      p.p[0] < 200 ||
      p.p[0] > CONFIG.worldSize - 200 ||
      p.p[2] < 200 ||
      p.p[2] > CONFIG.worldSize - 200;
    if (p.boundary) {
      let desired = Math.atan2(
          CONFIG.worldSize / 2 - p.p[0],
          CONFIG.worldSize / 2 - p.p[2],
        ),
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
    if (p.p[1] > VERTICAL_LIMITS.assistance)
      p.pitch = Math.min(p.pitch, (CONFIG.ceiling - p.p[1]) * 0.008);
    if (p.p[1] > CONFIG.ceiling) p.pitch = lerp(p.pitch, -0.2, dt * 2);
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
    this.prepareWeapons();
    this.weaponDriver!.fire(p, f);
  }
  private orientedSize(s: Vec3, q: Quat): Vec3 {
    return orientedSize(s, q);
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
    if (!this.burnZones.length) return false;
    const x0 = clamp(Math.floor((p[0] - s[0]) / 64), 0, CHUNKS - 1),
      x1 = clamp(Math.floor((p[0] + s[0]) / 64), 0, CHUNKS - 1);
    const z0 = clamp(Math.floor((p[2] - s[2]) / 64), 0, CHUNKS - 1),
      z1 = clamp(Math.floor((p[2] + s[2]) / 64), 0, CHUNKS - 1);
    for (let z = z0; z <= z1; z++)
      for (let x = x0; x <= x1; x++)
        for (const zone of this.burnCells.get(z * CHUNKS + x) || [])
          if (this.intersects(p, s, zone.p, zone.radius)) return true;
    return false;
  }
  private indexBurnZones() {
    for (const zones of this.burnCells.values()) zones.length = 0;
    for (const zone of this.burnZones) {
      const x0 = clamp(
          Math.floor((zone.p[0] - zone.radius) / 64),
          0,
          CHUNKS - 1,
        ),
        x1 = clamp(Math.floor((zone.p[0] + zone.radius) / 64), 0, CHUNKS - 1);
      const z0 = clamp(
          Math.floor((zone.p[2] - zone.radius) / 64),
          0,
          CHUNKS - 1,
        ),
        z1 = clamp(Math.floor((zone.p[2] + zone.radius) / 64), 0, CHUNKS - 1);
      for (let z = z0; z <= z1; z++)
        for (let x = x0; x <= x1; x++) {
          const key = z * CHUNKS + x;
          let zones = this.burnCells.get(key);
          if (!zones) this.burnCells.set(key, (zones = []));
          zones.push(zone);
        }
    }
    for (const [key, zones] of this.burnCells)
      if (!zones.length) this.burnCells.delete(key);
  }
  /** Each affected object is tested once, even when many shafts overlap. */
  private clearActiveLasers() {
    if (!this.burnZones.length) return;
    const stamp = ++this.querySerial;
    for (const [cell, zones] of this.burnCells) {
      if (!zones.length) continue;
      for (const id of this.entityCells.get(cell) || []) {
        if (this.queryMarks[id] === stamp || this.vaporized.has(id)) continue;
        this.queryMarks[id] = stamp;
        const e = this.world.entities[id];
        if (!this.inBeam(e.p, e.s)) continue;
        this.vaporized.add(id);
        if (!this.removed.has(id)) {
          this.removeEntity(e);
          this.bump();
          if (e.assembly) this.laserSupport.add(e.assembly);
        }
      }
    }
    // Ruins are indexed by center; their oriented bounds may extend across cells.
    for (const r of this.ruins.values())
      if (this.inBeam(r.p, this.orientedSize(r.s, r.q))) {
        this.removeRuin(r.id);
        this.bump();
      }
    for (const m of this.ballistic.values())
      if (this.inBeam(m.view.p, this.orientedSize(m.view.s, m.view.q))) {
        this.ballistic.delete(m.view.id);
        this.bump();
      }
    for (const [id, { view }] of this.cleanupRemains)
      if (this.inBeam(view.p, this.orientedSize(view.s, view.q))) {
        this.cleanupRemains.delete(id);
        this.cleanupExpiry.delete(id);
        this.bump();
      }
    for (const zone of this.burnZones)
      this.emit({ type: "vaporize", p: [...zone.p], radius: zone.radius });
  }
  private damageMonsters(
    p: Vec3,
    radius: number,
    amount: number,
    laserColumn = false,
  ) {
    const before = this.monsters.active();
    this.civilians.blast(p, radius, laserColumn);
    for (const m of laserColumn
      ? this.monsters.burn(p, radius, amount)
      : this.monsters.blast(p, radius, amount)) {
      if (m.defeated) this.monsterRagdolls.start(m, p);
      this.bump();
      this.emit({
        type: "monsterEvent",
        p: [m.p[0], m.p[1] + MONSTER_BODY_HEIGHT, m.p[2]],
        kind: m.defeated ? "defeat" : "hit",
      });
    }
    this.civilians.defeats(before, this.monsters.active());
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
    return monsterHit &&
      (!worldHit || distance(a, monsterHit.p) < distance(a, worldHit))
      ? monsterHit.p
      : worldHit;
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
      ? RAPID_FIRE_INTERVAL
      : WEAPONS.laser.cooldown;
    this.shots++;
    this.bump();
  }
  private scheduleLaser(l: LaserStrike, progress: number) {
    const { radius, depth } = resolvedLaserProfile(l.profile);
    if (progress === 1) l.pending = [];
    for (
      let z =
        radius > 500
          ? 0
          : clamp(Math.floor((l.p[2] - radius) / 64), 0, CHUNKS - 1);
      z <=
      (radius > 500
        ? CHUNKS - 1
        : clamp(Math.floor((l.p[2] + radius) / 64), 0, CHUNKS - 1));
      z++
    )
      for (
        let x =
          radius > 500
            ? 0
            : clamp(Math.floor((l.p[0] - radius) / 64), 0, CHUNKS - 1);
        x <=
        (radius > 500
          ? CHUNKS - 1
          : clamp(Math.floor((l.p[0] + radius) / 64), 0, CHUNKS - 1));
        x++
      ) {
        const section = z * CHUNKS + x;
        if (progress === 1) l.pending!.push(section);
        let work = this.laserWork.get(section);
        if (!work)
          this.laserWork.set(section, (work = { section, targets: [] }));
        const priorIndex = work.targets.findIndex(
          (t) =>
            t.p[0] === l.p[0] &&
            t.p[2] === l.p[2] &&
            (t.radius ?? LASER.radius) === radius &&
            (t.depth ?? LASER.depth) === depth,
        );
        if (priorIndex >= 0) {
          const prior = work.targets[priorIndex];
          if (progress > prior.progress)
            work.targets[priorIndex] = { ...prior, progress };
        } else work.targets.push({ p: [...l.p], progress, radius, depth });
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
      if (this.vaporized.has(id)) continue;
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
          ? this.nearbyRuinCandidates(p, radius)
          : [];
    for (const r of ruins)
      if (this.intersects(r.p, this.orientedSize(r.s, r.q), p, radius)) {
        this.removeRuin(r.id);
        this.bump();
      }
    if (section === undefined)
      for (const m of this.ballistic.values())
        if (
          this.intersects(
            m.view.p,
            this.orientedSize(m.view.s, m.view.q),
            p,
            radius,
          )
        ) {
          this.ballistic.delete(m.view.id);
          this.bump();
        }
    for (const [id, { view }] of this.cleanupRemains)
      if (
        (section === undefined || this.cell(view.p) === section) &&
        this.intersects(view.p, this.orientedSize(view.s, view.q), p, radius)
      ) {
        this.cleanupRemains.delete(id);
        this.cleanupExpiry.delete(id);
        this.bump();
      }
    if (section === undefined)
      this.emit({ type: "vaporize", p: [...p], radius });
  }
  private updateLasers(dt: number) {
    if (!this.lasers.length) {
      this.burnZones.length = 0;
      this.burnCells.clear();
      return;
    }
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
    this.indexBurnZones();
    if (
      sample ||
      this.lasers.some(
        (l) => l.age === LASER.charge || l.age === LASER.charge + LASER.beam,
      )
    )
      this.clearActiveLasers();
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
      this.bump();
      const t = target;
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
          (t.radius ?? LASER.radius) * clamp(t.progress * LASER.beam, 0.03, 1),
          section,
        );
      if (t.progress === 1)
        for (const l of this.lasers) {
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
      for (const id of result.patch.chunks)
        if (this.terrainColliders.has(id)) this.invalidateTerrainCollider(id);
      this.flush(result.patch, undefined, result.dry);
    }
    while (this.laserSupport.size && performance.now() - start < budgetMS) {
      const name = this.laserSupport.values().next().value!;
      this.laserSupport.delete(name);
      this.dirtyAssemblies.clear();
      this.dirtyAssemblies.add(name);
      this.resolveSupport(
        this.world.castles?.find((c) => c.assemblies.includes(name))?.p ??
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
      this.indexBurnZones();
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
      if (monsterHit && (!hit || distance(a, monsterHit.p) < distance(a, hit)))
        hit = monsterHit.p;
      if (hit) {
        this.aim = hit;
        break;
      }
      a = b;
      v[1] -= tuning.gravity * 0.16;
      if (
        a[0] < 0 ||
        a[0] > CONFIG.worldSize ||
        a[2] < 0 ||
        a[2] > CONFIG.worldSize
      )
        break;
    }
  }
  step() {
    const stepStarted = performance.now();
    const dt = CONFIG.dt;
    this.tick++;
    this.time += dt;
    this.updateCleanup(dt);
    if (!this.holdTime) this.hour = (this.hour + dt / 60) % 24;
    for (const weapon of ["cannon", "nuke", "laser"] as const)
      this.cooldowns[weapon] = Math.max(0, this.cooldowns[weapon] - dt);
    const previousPlanePosition = [...this.plane.p] as Vec3;
    const wasCrashed = this.plane.crashed > 0;
    this.fly(dt);
    if (!wasCrashed)
      this.civilians.sweep(previousPlanePosition, this.plane.p, [4, 2, 4]);
    this.stageMS.flight = performance.now() - stepStarted;
    const monstersStarted = performance.now();
    const struck = this.monsters.step(
      dt,
      this.plane.p,
      this.plane.crashed > 0,
      this.blockedMonster,
      discoActive(this.lasers),
      this.plane.v,
    );
    this.stageMS.monsters = performance.now() - monstersStarted;
    for (const p of this.monsters.throws)
      this.emit({
        type: "monsterEvent",
        p: [...p],
        kind: "throw",
      });
    const bodyHit = this.monsters.intersect(
      wasCrashed ? this.plane.p : previousPlanePosition,
      this.plane.p,
      2.2,
    );
    if ((struck || bodyHit) && this.plane.crashed <= 0) {
      if (bodyHit) {
        const before = this.monsters.active();
        const m = bodyHit.monster;
        this.monsters.damage(m, m.health);
        this.monsterRagdolls.start(m, previousPlanePosition);
        this.bump();
        this.emit({
          type: "monsterEvent",
          p: [m.p[0], m.p[1] + MONSTER_BODY_HEIGHT, m.p[2]],
          kind: "defeat",
        });
        this.civilians.defeats(before, this.monsters.active());
        this.plane.p = bodyHit.p;
      }
      this.plane.crashed = CONFIG.respawnDelay;
      this.explode(this.plane.p, 0.65, "crash");
      this.emit({ type: "monsterEvent", p: [...this.plane.p], kind: "swipe" });
    }
    if (this.tick % 60 === 0 && this.monsterCount) this.bump();
    const lasersStarted = performance.now();
    this.updateLasers(dt);
    this.stageMS.lasers = performance.now() - lasersStarted;
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
    const projectilesStarted = performance.now();
    this.prepareWeapons();
    this.weaponDriver!.update(dt);
    this.stageMS.projectiles = performance.now() - projectilesStarted;
    const destructionStarted = performance.now();
    const laserMS = this.processLaserWork(1);
    if (this.tick % 60 === 0)
      for (const z of this.burnZones)
        this.damageMonsters(z.p, z.radius, 1, true);
    this.processDestruction(Math.max(0.25, 2 - laserMS));
    this.destructionMS += laserMS;
    this.stageMS.destruction = performance.now() - destructionStarted;
    const terrainStarted = performance.now();
    if (this.tick % 20 === 0) this.ensureTerrain();
    this.stageMS.terrainMaintenance = performance.now() - terrainStarted;
    const residencyStarted = performance.now();
    if (this.tick % 4 === 1 || this.pendingJobs.length)
      this.ensureStaticColliders();
    this.stageMS.residency = performance.now() - residencyStarted;
    const terrainCollidersStarted = performance.now();
    this.processTerrainColliders(0.5);
    this.stageMS.terrainMaintenance +=
      performance.now() - terrainCollidersStarted;
    const start = performance.now();
    this.physics.step();
    this.monsterRagdolls.update(dt);
    this.stageMS.physics = performance.now() - start;
    this.physicsMS = lerp(this.physicsMS, this.stageMS.physics, 0.05);
    const ballisticStarted = performance.now();
    for (const m of this.ballistic.values()) {
      const resting = advanceDebris(m, this.terrain, dt);
      if (
        this.burnZones.length &&
        this.inBeam(m.view.p, this.orientedSize(m.view.s, m.view.q))
      ) {
        this.ballistic.delete(m.view.id);
        this.bump();
      } else if (resting) {
        this.ballistic.delete(m.view.id);
        this.contact(m.view.p, m.view.material, 0.5, "settle");
        this.insertRuin(m.view);
        this.bump();
      } else this.bodyPoses.update(m.view);
    }
    this.stageMS.ballistic = performance.now() - ballisticStarted;
    const residentsStarted = performance.now();
    this.civilians.step(
      dt,
      this.monsters.active(),
      this.plane.p,
      this.plane.crashed > 0,
      this.blockedCivilian,
    );
    this.stageMS.residents = performance.now() - residentsStarted;
    const eventsStarted = performance.now();
    if (this.civilians.changed) {
      this.bump();
      this.civilians.changed = false;
    }
    this.civilians.flush((p, kind) =>
      this.emit({ type: "settlementEvent", p: [...p], kind }),
    );
    if (this.tick % 12 === 0) this.updateAim();
    this.flush();
    this.stageMS.presentationEvents = performance.now() - eventsStarted;
    this.stepMS = performance.now() - stepStarted;
    // Colliders is nested in terrain maintenance; do not count it twice.
    this.stageMS.unclassified = Math.max(
      0,
      this.stepMS -
        (this.stageMS.flight +
          this.stageMS.monsters +
          this.stageMS.lasers +
          this.stageMS.projectiles +
          this.stageMS.destruction +
          this.stageMS.residency +
          this.stageMS.terrainMaintenance +
          this.stageMS.physics +
          this.stageMS.ballistic +
          this.stageMS.residents +
          this.stageMS.presentationEvents),
    );
    // Keep one bounded record so a short stall survives between snapshots.
    if (!this.worstStep || this.stepMS > this.worstStep.ms)
      this.worstStep = {
        tick: this.tick,
        time: this.time,
        ms: this.stepMS,
        stages: { ...this.stageMS },
      };
  }
  snapshot(
    packed = false,
    reuse?: { bodies?: ArrayBuffer; actors?: ArrayBuffer },
  ): SimulationSnapshot {
    let terrainHeightJournalDataBytes =
      this.terrain.changed.byteLength + this.terrain.dirtySamples.byteLength;
    for (const journal of this.captures.values())
      terrainHeightJournalDataBytes += journal.terrain.byteLength;
    return {
      type: "snapshot",
      population: civilianPopulation(this.civilians.states),
      tick: this.tick,
      time: this.time,
      plane: structuredClone(this.plane),
      hour: this.hour,
      aim: this.aim,
      weapon: this.weapon,
      nukeYield: this.nukeYield,
      cooldowns: { ...this.cooldowns },
      lasers: structuredClone(this.lasers),
      projectiles: packed
        ? []
        : this.projectiles.map((s) => ({
            id: s.id,
            weapon: s.weapon,
            yield: s.yield,
            p: [...s.p],
            v: [...s.v],
          })),
      civilians: packed ? [] : structuredClone(this.civilians.states),
      settlements: structuredClone(this.civilians.settlements),
      monsters: packed
        ? []
        : structuredClone(this.monsters.states.slice(0, this.monsterCount)),
      monsterSpikes: packed ? [] : structuredClone(this.monsters.spikes),
      monsterCount: this.monsterCount,
      packedMotion: packed
        ? packMotion(
            this.civilians.states,
            this.monsters.states.slice(0, this.monsterCount),
            this.projectiles,
            this.monsters.spikes,
            reuse?.actors,
          )
        : undefined,
      bodies: packed
        ? []
        : Array.from(this.bodyPoses.views(), (b) => ({
            ...b,
            p: [...b.p],
            q: [...b.q],
            s: b.s.map((value) => value * this.cleanupScale(b.id)) as Vec3,
          })),
      ...(packed
        ? {
            packedBodies: this.packSnapshotBodies(reuse?.bodies),
          }
        : {}),
      stats: {
        stageMS: { ...this.stageMS },
        worstStep: this.worstStep
          ? { ...this.worstStep, stages: { ...this.worstStep.stages } }
          : undefined,
        stepMS: this.stepMS,
        physicsMS: this.physicsMS,
        destructionMS: this.destructionMS,
        pendingJobs:
          this.pendingJobs.length +
          this.laserWork.size +
          this.laserSupport.size +
          this.supportJobs.length,
        bodies: this.moving.size,
        ballistic: this.ballistic.size,
        ruins: this.ruins.size,
        removed: this.removed.size,
        shots: this.shots,
        revision: this.revision,
        terrainHeightJournalDataBytes,
      },
    };
  }
  acknowledgeSave(capture: number) {
    for (const id of this.captures.keys())
      if (id <= capture) this.captures.delete(id);
  }
  /** Rotate journals in O(1); immutable values survive ticks until storage commits. */
  *captureSave(): Generator<void, SaveSnapshot> {
    if (!this.terrain.trackDirty) {
      this.terrain.dirtySamples = new SparseValues(this.terrain.changed);
      for (const i of this.terrain.dryIndices) this.terrain.dirtyDry.add(i);
      this.terrain.trackDirty = true;
    }
    const capture = this.nextCapture++,
      terrain = this.terrain.dirtySamples,
      dry = this.terrain.dirtyDry,
      ruins = this.dirtyRuins;
    this.terrain.dirtySamples = new SparseValues();
    this.terrain.dirtyDry = new SparseIndices();
    this.dirtyRuins = new Map();
    this.captures.set(capture, { terrain, dry, ruins });
    const startRevision = this.revision;
    const metadata: SaveSnapshot = {
      version: CONFIG.version,
      worldVersion: this.world.version,
      generatorVersion: this.world.generatorVersion,
      seed: this.world.seed,
      capture,
      incremental: true,
      revision: startRevision,
      hour: this.hour,
      destruction: { ...this.destruction },
      terrain: new Float32Array(),
      laserDry: new Uint32Array(),
      ruins: [],
      removed: [...this.removed],
      vaporized: [...this.vaporized],
      laserCooldown: this.cooldowns.laser,
      laserSupport: [...this.laserSupport],
      supportJobs: this.supportJobs.map((j) => ({
        ...j,
        origin: [...j.origin],
        alive: j.alive.slice(),
        connected: j.connected.slice(),
        clusters: j.clusters.map((c) => c.slice()),
      })),
      pendingJobs: this.pendingJobs.map((j) => ({
        ...j,
        p: [...j.p],
        profile: { ...j.profile },
        // Sorted target lists are immutable after enqueueing. Only cursors and
        // mutable support queues advance. Sharing these lists across the
        // capture boundary avoids copying every queued blast's full footprint
        // in one atomic slice; postMessage still serializes an independent save.
        chunks: j.chunks,
        entities: j.entities,
        assemblies: j.assemblies.slice(),
        supportQueue: j.supportQueue?.map((c) => c.slice()),
      })),
      lasers: this.lasers.map((l) => ({
        ...l,
        p: [...l.p],
        profile: l.profile ? { ...l.profile } : undefined,
        pending: l.pending?.slice(),
      })),
      // Targets are immutable after enqueueing; only the containing queue shifts.
      laserWork: [...this.laserWork.values()].map((w) => ({
        section: w.section,
        targets: w.targets.slice(),
      })),
      civilians: this.civilians.states.map((c) => ({ ...c, p: [...c.p] })),
      settlements: this.civilians.settlements.map((s) => ({ ...s })),
      monsters: this.monsters.states.map((m) => ({
        ...m,
        p: [...m.p],
        ragdoll: m.ragdoll ? [...m.ragdoll] : undefined,
        fragments: m.fragments ? structuredClone(m.fragments) : undefined,
      })),
    };
    // Airborne pieces have no permanent record yet. Capture their bounded pose list
    // at the same tick; save-only compaction preserves the running physics state.
    metadata.moving = this.bodyPoses.pack();
    const sections = new Map<
      number,
      {
        terrain: Map<number, number>;
        dry: Set<number>;
        ruins: Map<number, Ruin>;
        removed: Set<number>;
      }
    >();
    const section = (id: number) => {
      let s = sections.get(id);
      if (!s)
        sections.set(
          id,
          (s = {
            terrain: new Map(),
            dry: new Set(),
            ruins: new Map(),
            removed: new Set(),
          }),
        );
      return s;
    };
    let slice = performance.now();
    // Leave room beneath the 2 ms slice limit for the current item and runtime
    // overhead; metadata still captures atomically at one simulation tick.
    const due = () => performance.now() - slice >= 1;
    yield;
    slice = performance.now();
    for (const journal of this.captures.values()) {
      for (const [i, h] of journal.terrain) {
        const s = section(
          Math.min(CHUNKS - 1, Math.floor(i / CONFIG.grid / 32)) * CHUNKS +
            Math.min(CHUNKS - 1, Math.floor((i % CONFIG.grid) / 32)),
        );
        s.terrain.set(i, h);
        if (due()) {
          yield;
          slice = performance.now();
        }
      }
      for (const i of journal.dry) {
        section(
          Math.min(CHUNKS - 1, Math.floor(i / CONFIG.grid / 32)) * CHUNKS +
            Math.min(CHUNKS - 1, Math.floor((i % CONFIG.grid) / 32)),
        ).dry.add(i);
        if (due()) {
          yield;
          slice = performance.now();
        }
      }
      for (const [id, r] of journal.ruins) {
        const s = section(r ? this.cell(r.p) : (this.ruinSection.get(id) ?? 0));
        if (r) {
          s.ruins.set(id, r);
          s.removed.delete(id);
        } else {
          s.ruins.delete(id);
          s.removed.add(id);
        }
        if (due()) {
          yield;
          slice = performance.now();
        }
      }
    }
    // Packed airborne poses are replaced on every commit, then grounded and
    // compacted only during paused restoration. No save-time physics mutation.
    metadata.sections = [];
    for (const [id, s] of sections) {
      const packed = new Float32Array(s.terrain.size * 2);
      let j = 0;
      for (const [i, h] of s.terrain) {
        packed[j++] = i;
        packed[j++] = h;
      }
      metadata.sections.push({
        id,
        terrain: packed,
        dry: Uint32Array.from(s.dry),
        ruins: [...s.ruins.values()],
        removedRuins: [...s.removed],
      });
      if (due()) {
        yield;
        slice = performance.now();
      }
    }
    return metadata;
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
    for (const view of this.bodyPoses.views()) {
      const p: Vec3 = [
        clamp(view.p[0], 8, CONFIG.worldSize - 8),
        0,
        clamp(view.p[2], 8, CONFIG.worldSize - 8),
      ];
      const s: Vec3 = [...view.s];
      let q: Quat = [...view.q];
      if (view.kind === "tree") {
        s[0] = view.s[1];
        s[1] = 0.8;
        s[2] = 0.8;
        q = [0, 0, 0, 1];
      }
      p[1] =
        this.terrain.sample(p[0], p[2]) +
        (isRoof(view.material)
          ? roofClearance(s, q, view.roofPart)
          : this.orientedSize(s, q)[1]);
      if (this.inBeam(p, this.orientedSize(s, q))) continue;
      let r: Ruin = { ...view, p, s, q, kind: "chunk" };
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
      generatorVersion: this.world.generatorVersion,
      seed: this.world.seed,
      revision: this.revision,
      hour: this.hour,
      terrain,
      removed: [...this.removed],
      ruins,
      supportJobs: structuredClone(this.supportJobs),
      pendingJobs: structuredClone(this.pendingJobs),
      lasers: structuredClone(this.lasers),
      laserWork: structuredClone([...this.laserWork.values()]),
      laserSupport: [...this.laserSupport],
      laserCooldown: this.cooldowns.laser,
      laserDry: Uint32Array.from(this.terrain.dryIndices),
      vaporized: [...this.vaporized],
      civilians: structuredClone(this.civilians.states),
      settlements: structuredClone(this.civilians.settlements),
      monsters: structuredClone(this.monsters.states),
    };
  }
  dispose() {
    this.moving.clear();
    this.ballistic.clear();
    this.cleanupRemains.clear();
    this.cleanupExpiry.clear();
    this.bodyPoses.dispose();
    this.physics.free();
  }
}
export async function initializePhysics() {
  await RAPIER.init();
}
