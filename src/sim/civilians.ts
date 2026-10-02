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
  private cells = new Map<string, CivilianState[]>();
  private pending = new Map<string, "cheer" | "sad">();
  private phase = 0;
  private monsterCells = new Map<string, MonsterState[]>();
  private settlementById = new Map<string, SettlementState>();
  private nearbyMonster(p: Vec3, radius: number) {
    for (
      let z = Math.floor((p[2] - radius) / 192);
      z <= Math.floor((p[2] + radius) / 192);
      z++
    )
      for (
        let x = Math.floor((p[0] - radius) / 192);
        x <= Math.floor((p[0] + radius) / 192);
        x++
      )
        for (const m of this.monsterCells.get(`${x},${z}`) ?? [])
          if ((m.p[0] - p[0]) ** 2 + (m.p[2] - p[2]) ** 2 < radius ** 2)
            return m;
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
    const names = new Set(spawns.map((c) => c.home));
    const siteAssemblies = new Set(world.sites.flatMap((s) => s.assemblies));
    for (const e of world.entities) {
      if (e.kind !== "block" || !e.assembly) continue;
      const home = names.has(e.assembly)
        ? e.assembly
        : !siteAssemblies.has(e.assembly) && e.assembly !== "bridge"
          ? "castle"
          : undefined;
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
    this.cells.clear();
    for (const c of this.states)
      if (c.alive) {
        const key = `${Math.floor(c.p[0] / 64)},${Math.floor(c.p[2] / 64)}`;
        const list = this.cells.get(key) ?? [];
        list.push(c);
        this.cells.set(key, list);
      }
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
        yield* this.cells.get(`${x},${z}`) ?? [];
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
    this.changed = true;
    for (const s of this.settlements)
      if (
        s.id === this.spawn(c).settlement ||
        distance(this.centers.get(s.id)!, c.p) < 160
      )
        this.react(s.id, "sad");
  }
  blast(p: Vec3, radius: number, column = false) {
    for (const c of this.near(p, p, radius, radius)) {
      const d = column
        ? distance(c.p, p)
        : Math.hypot(c.p[0] - p[0], c.p[1] + 2 - p[1], c.p[2] - p[2]);
      if (c.alive && d < radius + 1) this.kill(c);
    }
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
    for (const s of this.settlements)
      s.threatened = monsters.some(
        (m) => distance(m.p, this.centers.get(s.id)!) < 500,
      );
  }
  step(
    dt: number,
    monsters: MonsterState[],
    plane: Vec3,
    crashed: boolean,
    blocked: (p: Vec3) => boolean,
  ) {
    this.monsterCells.clear();
    for (const m of monsters) {
      const key = `${Math.floor(m.p[0] / 192)},${Math.floor(m.p[2] / 192)}`;
      const cell = this.monsterCells.get(key) ?? [];
      cell.push(m);
      this.monsterCells.set(key, cell);
    }
    this.phase += dt;
    this.rebaseline(monsters);
    for (const s of this.settlements) {
      s.cheer = Math.max(0, s.cheer - dt);
      s.sad = Math.max(0, s.sad - dt);
    }
    for (const c of this.states) {
      if (!c.alive) continue;
      const spawn = this.spawn(c),
        s = this.settlementById.get(spawn.settlement)!;
      const h = this.terrain.sample(c.p[0], c.p[2]);
      if (this.terrain.water(c.p[0], c.p[2]) || c.p[1] - h > 8) {
        this.kill(c);
        continue;
      }
      c.p[1] = h;
      let danger: Vec3 | undefined;
      if (!crashed && distance(c.p, plane) < 150 && plane[1] - h < 350)
        danger = plane;
      const monster = this.nearbyMonster(c.p, 180);
      if (monster && !danger) danger = monster.p;
      const sad = s.sad > 0 || this.ruined(spawn.home);
      c.mood = danger ? "flee" : sad ? "sad" : s.cheer > 0 ? "cheer" : "walk";
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
        c.yaw += clamp(turn, -dt * 3, dt * 3);
        const speed = danger ? 5 : 1.6;
        const x = clamp(
            c.p[0] + Math.sin(c.yaw) * speed * dt,
            3,
            CONFIG.worldSize - 3,
          ),
          z = clamp(
            c.p[2] + Math.cos(c.yaw) * speed * dt,
            3,
            CONFIG.worldSize - 3,
          );
        const next: Vec3 = [x, this.terrain.sample(x, z), z];
        if (
          distance(next, spawn.p) < 75 &&
          !this.terrain.water(x, z) &&
          Math.abs(next[1] - h) < 1.5 &&
          !blocked(next)
        )
          c.p = next;
      }
      c.phase += dt * (danger ? 8 : 3);
    }
    this.index();
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
