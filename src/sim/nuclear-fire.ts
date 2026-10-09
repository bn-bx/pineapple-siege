import { CHUNKS, CONFIG, clamp } from "../config";
import type {
  BlastProfile,
  Entity,
  NuclearFireState,
  FirePatch,
  Vec3,
} from "../types";

export const FIRE_LIMIT = 128;
export const FIRE_LIFETIME = 60;
export interface FireGround {
  ground(x: number, z: number): number;
  water(x: number, z: number): boolean;
}
export interface FireHost extends FireGround {
  ids(cell: number): Iterable<number>;
  entity(id: number): Entity | undefined;
  removed(id: number): boolean;
  burn(entity: Entity): void;
  actors(touches: (p: Vec3, size: Vec3) => boolean, damage: boolean): void;
}
const random = (seed: number) => {
  const v = Math.sin(seed * 127.1 + 31.7) * 43758.5453;
  return v - Math.floor(v);
};

/** Finite ground hazards, independent of cosmetic quality and laser columns. */
export class NuclearFire {
  readonly patches: FirePatch[] = [];
  private cells = new Map<number, FirePatch[]>();
  private exposures = new Map<number, { seconds: number; checked: number }>();
  private nextId = 1;
  private clock = 0;
  private creatureClock = 0;
  private nextScan = 0;
  private scan?: Generator<number>;
  private seen = new Set<number>();

  ignite(
    p: Vec3,
    profile: BlastProfile,
    seed: number,
    coupling: number,
    ground: FireGround,
    fuels: readonly Entity[] = [],
  ) {
    if (coupling <= 0) return;
    const targets = fuels.filter(
      (e) => e.material === "wood" || e.material === "foliage",
    );
    for (let i = 0; i < 32; i++) {
      const angle = random(seed + i * 7) * Math.PI * 2;
      const reach =
        profile.craterRadius * 0.6 +
        random(seed + i * 7 + 1) *
          (profile.damageRadius * 1.2 - profile.craterRadius * 0.6);
      const fuel = i >= 16 ? targets[(i - 16) % targets.length] : undefined;
      const x = fuel?.p[0] ?? p[0] + Math.cos(angle) * reach;
      const z = fuel?.p[2] ?? p[2] + Math.sin(angle) * reach;
      if (
        x < 0 ||
        z < 0 ||
        x > CONFIG.worldSize ||
        z > CONFIG.worldSize ||
        ground.water(x, z)
      )
        continue;
      const radius = 12 + random(seed + i * 7 + 2) * 12;
      const existing = this.patches.find(
        (f) => Math.hypot(f.p[0] - x, f.p[2] - z) < f.radius + radius,
      );
      if (existing) {
        existing.age = 0;
        existing.radius = Math.max(existing.radius, radius);
        existing.height = Math.max(
          existing.height,
          6 + random(seed + i * 7 + 3) * 6,
        );
      } else {
        if (this.patches.length === FIRE_LIMIT) {
          let oldest = 0;
          for (let j = 1; j < this.patches.length; j++)
            if (this.patches[j].age > this.patches[oldest].age) oldest = j;
          this.patches.splice(oldest, 1);
        }
        this.patches.push({
          id: this.nextId++,
          p: [x, ground.ground(x, z), z],
          radius,
          height: 6 + random(seed + i * 7 + 3) * 6,
          age: 0,
          seed: seed + i,
        });
      }
    }
    this.index();
    this.scan = undefined;
    this.nextScan = this.clock;
  }
  private index() {
    this.cells.clear();
    for (const patch of this.patches) {
      for (
        let z = clamp(
          Math.floor((patch.p[2] - patch.radius) / 64),
          0,
          CHUNKS - 1,
        );
        z <= clamp(Math.floor((patch.p[2] + patch.radius) / 64), 0, CHUNKS - 1);
        z++
      )
        for (
          let x = clamp(
            Math.floor((patch.p[0] - patch.radius) / 64),
            0,
            CHUNKS - 1,
          );
          x <=
          clamp(Math.floor((patch.p[0] + patch.radius) / 64), 0, CHUNKS - 1);
          x++
        ) {
          const cell = z * CHUNKS + x;
          let patches = this.cells.get(cell);
          if (!patches) this.cells.set(cell, (patches = []));
          patches.push(patch);
        }
    }
  }
  touches(p: Vec3, size: Vec3 = [0, 0, 0]) {
    for (
      let z = Math.floor((p[2] - size[2]) / 64);
      z <= Math.floor((p[2] + size[2]) / 64);
      z++
    )
      for (
        let x = Math.floor((p[0] - size[0]) / 64);
        x <= Math.floor((p[0] + size[0]) / 64);
        x++
      )
        for (const f of this.cells.get(z * CHUNKS + x) ?? []) {
          if (p[1] + size[1] < f.p[1] || p[1] - size[1] > f.p[1] + f.height)
            continue;
          const dx = Math.max(0, Math.abs(p[0] - f.p[0]) - size[0]);
          const dz = Math.max(0, Math.abs(p[2] - f.p[2]) - size[2]);
          if (dx * dx + dz * dz <= f.radius * f.radius) return true;
        }
    return false;
  }
  /** Sweep an expanded finite cylinder, including the top and bottom caps. */
  sweep(a: Vec3, b: Vec3, extent = 2.2): Vec3 | null {
    let first = Infinity;
    for (const f of this.patches) {
      const dx = b[0] - a[0],
        dz = b[2] - a[2],
        dy = b[1] - a[1];
      const x = a[0] - f.p[0],
        z = a[2] - f.p[2],
        radius = f.radius + extent;
      const aa = dx * dx + dz * dz,
        bb = 2 * (x * dx + z * dz),
        cc = x * x + z * z - radius * radius;
      let enter = 0,
        leave = 1;
      if (aa < 1e-12) {
        if (cc > 0) continue;
      } else {
        const d = bb * bb - 4 * aa * cc;
        if (d < 0) continue;
        enter = Math.max(0, (-bb - Math.sqrt(d)) / (2 * aa));
        leave = Math.min(1, (-bb + Math.sqrt(d)) / (2 * aa));
      }
      const low = f.p[1] - extent,
        high = f.p[1] + f.height + extent;
      if (Math.abs(dy) < 1e-12) {
        if (a[1] < low || a[1] > high) continue;
      } else {
        const t0 = (low - a[1]) / dy,
          t1 = (high - a[1]) / dy;
        enter = Math.max(enter, Math.min(t0, t1));
        leave = Math.min(leave, Math.max(t0, t1));
      }
      if (enter <= leave && enter < first) first = enter;
    }
    return first <= 1
      ? (a.map((v, i) => v + (b[i] - v) * first) as Vec3)
      : null;
  }
  private *candidates(host: FireHost) {
    for (const cell of this.cells.keys())
      for (const id of host.ids(cell)) yield id;
  }

  step(dt: number, host: FireHost, budgetMS = 0.75) {
    if (dt <= 0 || !this.patches.length) return;
    this.clock += dt;
    const oldCount = this.patches.length;
    for (let i = this.patches.length - 1; i >= 0; i--) {
      const f = this.patches[i];
      f.age += dt;
      if (f.age >= FIRE_LIFETIME - 1e-8 || host.water(f.p[0], f.p[2]))
        this.patches.splice(i, 1);
      else f.p[1] = host.ground(f.p[0], f.p[2]);
    }
    if (oldCount !== this.patches.length) {
      this.index();
      this.scan = undefined;
    }
    if (!this.patches.length) {
      this.exposures.clear();
      return;
    }
    this.creatureClock += dt;
    const damage = this.creatureClock >= 1 - 1e-8;
    if (damage)
      this.creatureClock = Math.max(
        0,
        this.creatureClock - Math.floor(this.creatureClock + 1e-8),
      );
    host.actors((p, s) => this.touches(p, s), damage);
    if (!this.scan && this.clock >= this.nextScan) {
      this.seen.clear();
      this.scan = this.candidates(host);
    }
    const deadline = performance.now() + budgetMS;
    let burned = 0;
    while (this.scan && performance.now() < deadline && burned < 4) {
      const next = this.scan.next();
      if (next.done) {
        this.scan = undefined;
        this.nextScan = this.clock + 0.2;
        break;
      }
      const id = next.value;
      if (this.seen.has(id)) continue;
      this.seen.add(id);
      const entity = host.entity(id);
      if (
        !entity ||
        host.removed(id) ||
        (entity.material !== "wood" && entity.material !== "foliage") ||
        !this.touches(entity.p, entity.s)
      ) {
        this.exposures.delete(id);
        continue;
      }
      const exposure = this.exposures.get(id) ?? {
        seconds: 0,
        checked: this.clock - Math.min(0.2, this.clock),
      };
      exposure.seconds += Math.max(0, this.clock - exposure.checked);
      exposure.checked = this.clock;
      if (exposure.seconds >= (entity.material === "foliage" ? 1 : 5) - 1e-8) {
        host.burn(entity);
        burned++;
        this.exposures.delete(id);
      } else this.exposures.set(id, exposure);
    }
    for (const [id, exposure] of this.exposures)
      if (this.clock - exposure.checked > 2) this.exposures.delete(id);
  }
  save(): NuclearFireState {
    return {
      patches: structuredClone(this.patches),
      clock: this.clock,
      creatureClock: this.creatureClock,
      exposures: [...this.exposures].map(([id, e]) => [
        id,
        e.seconds,
        e.checked,
      ]),
    };
  }
  restore(state?: NuclearFireState) {
    this.reset();
    if (!state) return;
    this.patches.push(...structuredClone(state.patches));
    this.clock = state.clock;
    this.creatureClock = state.creatureClock;
    this.nextId = Math.max(1, ...this.patches.map((f) => f.id + 1));
    for (const [id, seconds, checked] of state.exposures)
      this.exposures.set(id, { seconds, checked });
    this.index();
  }
  reset() {
    this.patches.length = 0;
    this.cells.clear();
    this.exposures.clear();
    this.scan = undefined;
    this.seen.clear();
    this.clock = this.creatureClock = this.nextScan = 0;
    this.nextId = 1;
  }
}
