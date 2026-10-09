import { CONFIG, clamp } from "../config";
import type {
  CivilianState,
  Entity,
  MonsterState,
  SaveSnapshot,
  SettlementState,
  Vec3,
  WorldData,
} from "../types";
import type { Terrain } from "./terrain";

const distance = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[2] - b[2]);

/** Lightweight worker-owned residents; no extra physics bodies or contact pairs. */
export class Civilians {
  readonly states: CivilianState[];
  readonly settlements: SettlementState[];
  private centers = new Map<string, Vec3>();
  private homes = new Map<string, number[]>();
  private entityHomes = new Map<number, string>();
  private lost = new Map<string, number>();
  private cells = new Map<number, Set<CivilianState>>();
  private pending = new Map<string, "cheer" | "sad">();
  private phase = 0;
  private tick = 0;
  private groundCache = new Map<
    number,
    { x: number; z: number; version: number; h: number; water: boolean }
  >();
  private ground(c: CivilianState) {
    const version = this.terrain.trackDirty
      ? this.terrain.sectionVersions[this.terrain.sectionAt(c.p[0], c.p[2])]
      : -1;
    let cached = this.groundCache.get(c.id);
    if (!cached) {
      cached = { x: NaN, z: NaN, version: -2, h: 0, water: false };
      this.groundCache.set(c.id, cached);
    }
    if (
      version < 0 ||
      cached.version !== version ||
      cached.x !== c.p[0] ||
      cached.z !== c.p[2]
    ) {
      cached.h = this.terrain.sample(c.p[0], c.p[2]);
      cached.water = this.terrain.water(c.p[0], c.p[2], cached.h);
      cached.x = c.p[0];
      cached.z = c.p[2];
      cached.version = version;
    }
    return cached;
  }
  private membership = new Map<number, number>();
  private cellCeilings = new Float64Array(96 * 96).fill(-Infinity);
  private monsterHeads = new Int32Array(32 * 32).fill(-1);
  private monsterNext = new Int32Array(0);
  private indexedMonsters: MonsterState[] = [];
  private settlementById = new Map<string, SettlementState>();
  private nearbyMonster(p: Vec3, radius: number) {
    for (
      let z = Math.max(0, Math.floor((p[2] - radius) / 192));
      z <= Math.min(31, Math.floor((p[2] + radius) / 192));
      z++
    )
      for (
        let x = Math.max(0, Math.floor((p[0] - radius) / 192));
        x <= Math.min(31, Math.floor((p[0] + radius) / 192));
        x++
      )
        for (
          let i = this.monsterHeads[z * 32 + x];
          i !== -1;
          i = this.monsterNext[i]
        ) {
          const m = this.indexedMonsters[i];
          if ((m.p[0] - p[0]) ** 2 + (m.p[2] - p[2]) ** 2 < radius ** 2)
            return m;
        }
    return undefined;
  }
  changed = false;
  constructor(
    private world: WorldData,
    private terrain: Terrain,
    removed: Set<number>,
    save?: SaveSnapshot,
  ) {
    const spawns = world.civilians ?? [];
    this.states = spawns.map((c) => {
      const old = save?.civilians?.find((s) => s.id === c.id);
      return old
        ? structuredClone(old)
        : {
            id: c.id,
            p: [...c.p],
            yaw: c.id * 2.399963,
            alive: true,
            mood: "walk",
            phase: 0,
          };
    });
    for (const s of world.sites) this.centers.set(s.id, s.p);
    this.centers.set("castle", world.castle);
    for (const c of world.castles ?? []) this.centers.set(c.id, c.p);
    const names = new Set(spawns.map((c) => c.home));
    const siteAssemblies = new Set(world.sites.flatMap((s) => s.assemblies));
    for (const e of world.entities) {
      if (e.kind !== "block" || !e.assembly) continue;
      const castle = world.castles?.find((c) =>
        c.assemblies.includes(e.assembly),
      );
      const home =
        castle?.id ??
        (names.has(e.assembly)
          ? e.assembly
          : !siteAssemblies.has(e.assembly) && e.assembly !== "bridge"
            ? "castle"
            : undefined);
      if (!home) continue;
      this.entityHomes.set(e.id, home);
      const ids = this.homes.get(home) ?? [];
      ids.push(e.id);
      this.homes.set(home, ids);
      if (removed.has(e.id))
        this.lost.set(home, (this.lost.get(home) ?? 0) + 1);
    }
    this.settlements = [...new Set(spawns.map((c) => c.settlement))].map(
      (id) => {
        const old = save?.settlements?.find((s) => s.id === id);
        return old ? { ...old } : { id, cheer: 0, sad: 0, threatened: false };
      },
    );
    for (const s of this.settlements) this.settlementById.set(s.id, s);
    this.index();
  }
  private index() {
    for (const c of this.states) this.reindex(c);
  }
  private reindex(c: CivilianState) {
    const key = Math.floor(c.p[2] / 64) * 96 + Math.floor(c.p[0] / 64),
      old = this.membership.get(c.id);
    if (c.alive)
      this.cellCeilings[key] = Math.max(this.cellCeilings[key], c.p[1] + 4);
    if (c.alive && old === key) return;
    if (old !== undefined) this.cells.get(old)?.delete(c);
    if (!c.alive) {
      this.membership.delete(c.id);
      return;
    }
    let cell = this.cells.get(key);
    if (!cell) this.cells.set(key, (cell = new Set()));
    cell.add(c);
    this.membership.set(c.id, key);
  }
  private *near(a: Vec3, b: Vec3, sx: number, sz: number) {
    for (
      let z = Math.max(0, Math.floor((Math.min(a[2], b[2]) - sz - 1) / 64));
      z <=
      Math.min(
        CONFIG.worldSize / 64 - 1,
        Math.floor((Math.max(a[2], b[2]) + sz + 1) / 64),
      );
      z++
    )
      for (
        let x = Math.max(0, Math.floor((Math.min(a[0], b[0]) - sx - 1) / 64));
        x <=
        Math.min(
          CONFIG.worldSize / 64 - 1,
          Math.floor((Math.max(a[0], b[0]) + sx + 1) / 64),
        );
        x++
      )
        yield* this.cells.get(z * 96 + x) ?? [];
  }
  private react(id: string, kind: "cheer" | "sad") {
    const s = this.settlements.find((s) => s.id === id);
    if (!s) return;
    if (kind === "sad") {
      const starting = s.sad <= 0;
      s.sad = 10;
      s.cheer = 0;
      if (starting) this.pending.set(id, "sad");
      else if (this.pending.get(id) === "cheer") this.pending.delete(id);
    } else if (
      s.sad <= 0 &&
      !this.states.some(
        (c) =>
          c.alive &&
          this.spawn(c).settlement === id &&
          this.ruined(this.spawn(c).home),
      )
    ) {
      s.cheer = 6;
      this.pending.set(id, "cheer");
    }
  }
  private spawn(c: CivilianState) {
    return this.world.civilians![c.id];
  }
  private ruined(home: string) {
    return (
      (this.lost.get(home) ?? 0) >=
      (this.homes.get(home)?.length ?? Infinity) * 0.25
    );
  }
  private kill(c: CivilianState) {
    if (!c.alive) return;
    c.alive = false;
    this.reindex(c);
    this.changed = true;
    for (const s of this.settlements)
      if (
        s.id === this.spawn(c).settlement ||
        distance(this.centers.get(s.id)!, c.p) < 160
      )
        this.react(s.id, "sad");
  }
  burn(touches: (p: Vec3, size: Vec3) => boolean) {
    for (const c of this.states)
      if (c.alive && touches([c.p[0], c.p[1] + 2, c.p[2]], [1, 2, 1]))
        this.kill(c);
  }
  blast(p: Vec3, radius: number, column = false) {
    for (const c of this.near(p, p, radius, radius)) {
      const d = column
        ? distance(c.p, p)
        : Math.hypot(c.p[0] - p[0], c.p[1] + 2 - p[1], c.p[2] - p[2]);
      if (c.alive && d < radius + 1) this.kill(c);
    }
  }
  maySweep(a: Vec3, b: Vec3, radius: number) {
    const x0 = Math.max(
        0,
        Math.floor((Math.min(a[0], b[0]) - radius - 1) / 64),
      ),
      x1 = Math.min(95, Math.floor((Math.max(a[0], b[0]) + radius + 1) / 64));
    const z0 = Math.max(
        0,
        Math.floor((Math.min(a[2], b[2]) - radius - 1) / 64),
      ),
      z1 = Math.min(95, Math.floor((Math.max(a[2], b[2]) + radius + 1) / 64));
    for (let z = z0; z <= z1; z++)
      for (let x = x0; x <= x1; x++)
        if (
          this.cellCeilings[z * 96 + x] >= Math.min(a[1], b[1]) - radius &&
          this.cells.get(z * 96 + x)?.size
        )
          return true;
    return false;
  }
  /** Swept expanded box prevents fast aircraft and wreckage tunneling through residents. */
  sweep(a: Vec3, b: Vec3, size: Vec3) {
    for (const c of this.near(a, b, size[0], size[2])) {
      if (!c.alive) continue;
      let enter = 0,
        leave = 1;
      for (let k = 0; k < 3; k++) {
        const center = c.p[k] + (k === 1 ? 2 : 0),
          r = size[k] + (k === 1 ? 2 : 1),
          d = b[k] - a[k];
        if (Math.abs(d) < 1e-8) {
          if (Math.abs(a[k] - center) > r) {
            leave = -1;
            break;
          }
        } else {
          const t0 = (center - r - a[k]) / d,
            t1 = (center + r - a[k]) / d;
          enter = Math.max(enter, Math.min(t0, t1));
          leave = Math.min(leave, Math.max(t0, t1));
        }
      }
      if (enter <= leave) this.kill(c);
    }
  }
  structureRemoved(e: Entity) {
    const home = this.entityHomes.get(e.id);
    if (home) {
      this.lost.set(home, (this.lost.get(home) ?? 0) + 1);
      for (const c of this.states)
        if (
          c.alive &&
          (this.spawn(c).home === home || distance(c.p, e.p) < 120)
        )
          this.react(this.spawn(c).settlement, "sad");
    }
    this.sweep(e.p, e.p, e.s);
  }
  defeats(before: MonsterState[], after: MonsterState[]) {
    if (!before.length) return;
    for (const s of this.settlements) {
      const center = this.centers.get(s.id)!;
      const localBefore = before.some((m) => distance(m.p, center) < 500);
      const localAfter = after.some((m) => distance(m.p, center) < 500);
      s.threatened = localAfter;
      if ((localBefore && !localAfter) || !after.length)
        this.react(s.id, "cheer");
    }
  }
  rebaseline(monsters: MonsterState[]) {
    for (const s of this.settlements) {
      const center = this.centers.get(s.id)!;
      s.threatened = monsters.some(
        (m) =>
          (m.p[0] - center[0]) ** 2 + (m.p[2] - center[2]) ** 2 < 500 * 500,
      );
    }
  }
  step(
    dt: number,
    monsters: MonsterState[],
    plane: Vec3,
    crashed: boolean,
    blocked: (p: Vec3) => boolean,
  ) {
    this.tick++;
    this.monsterHeads.fill(-1);
    this.indexedMonsters = monsters;
    if (this.monsterNext.length < monsters.length)
      this.monsterNext = new Int32Array(
        2 ** Math.ceil(Math.log2(monsters.length)),
      );
    for (let i = monsters.length - 1; i >= 0; i--) {
      const m = monsters[i];
      const key = Math.floor(m.p[2] / 192) * 32 + Math.floor(m.p[0] / 192);
      this.monsterNext[i] = this.monsterHeads[key];
      this.monsterHeads[key] = i;
    }
    this.phase += dt;
    if (this.tick % 6 === 1) this.rebaseline(monsters);
    for (const s of this.settlements) {
      s.cheer = Math.max(0, s.cheer - dt);
      s.sad = Math.max(0, s.sad - dt);
    }
    for (const c of this.states) {
      if (!c.alive) continue;
      const spawn = this.spawn(c),
        s = this.settlementById.get(spawn.settlement)!;
      const ground = this.ground(c),
        h = ground.h;
      if (ground.water || c.p[1] - h > 8) {
        this.kill(c);
        continue;
      }
      c.p[1] = h;
      const range = (c.p[0] - plane[0]) ** 2 + (c.p[2] - plane[2]) ** 2;
      c.phase += dt * (c.mood === "flee" ? 8 : 3);
      let danger: Vec3 | undefined;
      if (
        !crashed &&
        (c.p[0] - plane[0]) ** 2 + (c.p[2] - plane[2]) ** 2 < 150 * 150 &&
        plane[1] - h < 350
      )
        danger = plane;
      const monster = this.nearbyMonster(c.p, 180);
      if (monster && !danger) danger = monster.p;
      const period =
        danger || range < 300 * 300 || c.mood === "flee"
          ? 1
          : range < 900 * 900
            ? 2
            : 6;
      const navDT = dt * period;
      const sad = s.sad > 0 || this.ruined(spawn.home);
      c.mood = danger ? "flee" : sad ? "sad" : s.cheer > 0 ? "cheer" : "walk";
      if ((this.tick + c.id) % period && dt <= 1 / 30) continue;
      if (c.mood === "walk" || danger) {
        const desired = danger
          ? Math.atan2(c.p[0] - danger[0], c.p[2] - danger[2])
          : Math.atan2(
              spawn.p[0] + Math.sin(this.phase * 0.2 + c.id) * 9 - c.p[0],
              spawn.p[2] + Math.cos(this.phase * 0.17 + c.id) * 9 - c.p[2],
            );
        const turn = Math.atan2(
          Math.sin(desired - c.yaw),
          Math.cos(desired - c.yaw),
        );
        c.yaw += clamp(turn, -navDT * 3, navDT * 3);
        const speed = danger ? 5 : 1.6;
        const x = clamp(
            c.p[0] + Math.sin(c.yaw) * speed * navDT,
            3,
            CONFIG.worldSize - 3,
          ),
          z = clamp(
            c.p[2] + Math.cos(c.yaw) * speed * navDT,
            3,
            CONFIG.worldSize - 3,
          );
        const next: Vec3 = [x, this.terrain.sample(x, z), z];
        if (
          (next[0] - spawn.p[0]) ** 2 + (next[2] - spawn.p[2]) ** 2 < 75 * 75 &&
          !this.terrain.water(x, z, next[1]) &&
          Math.abs(next[1] - h) < 1.5 &&
          !blocked(next)
        ) {
          c.p = next;
          this.reindex(c);
          ground.x = x;
          ground.z = z;
          ground.h = next[1];
          ground.water = false;
          if (this.terrain.trackDirty)
            ground.version =
              this.terrain.sectionVersions[this.terrain.sectionAt(x, z)];
        }
      }
    }
  }
  flush(emit: (p: Vec3, kind: "cheer" | "sad") => void) {
    // Losses late in the frame override celebrations queued by an earlier defeat.
    for (const [id, kind] of this.pending) {
      const s = this.settlements.find((s) => s.id === id)!;
      if (
        this.states.some((c) => c.alive && this.spawn(c).settlement === id) &&
        (kind !== "cheer" || s.sad <= 0)
      )
        emit(this.centers.get(id)!, kind);
    }
    this.pending.clear();
  }
}
