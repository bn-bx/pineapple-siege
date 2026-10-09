import { CONFIG, FLY_COUNT, clamp } from "../config";
import type { Entity, FlyState, Vec3, WorldData } from "../types";
import { Terrain } from "./terrain";

export { FLY_COUNT } from "../config";
export const FLY_BODY_EXTENTS: Vec3 = [8, 7, 21];
export const FLY_CLEARANCE = 25;
const distance = (a: Vec3, b: Vec3) => Math.hypot(...a.map((v, i) => v - b[i]));
const hash = (n: number) => {
  const v = Math.sin(n * 127.1 + 43.7) * 43758.5453;
  return v - Math.floor(v);
};
const angle = (a: number, b: number) =>
  Math.atan2(Math.sin(b - a), Math.cos(b - a));

/** Segment against an oriented body ellipsoid, optionally in relative motion. */
export function flyBodyHit(
  a: Vec3,
  b: Vec3,
  fly: FlyState,
  radius = 0,
  old = fly.p,
): number | null {
  const local = (p: Vec3, center: Vec3): Vec3 => {
    const x = p[0] - center[0],
      y = p[1] - center[1],
      z = p[2] - center[2];
    const sideways = x * Math.cos(fly.yaw) - z * Math.sin(fly.yaw);
    const forward = x * Math.sin(fly.yaw) + z * Math.cos(fly.yaw);
    return [
      sideways / (FLY_BODY_EXTENTS[0] + radius),
      (y * Math.cos(fly.pitch) - forward * Math.sin(fly.pitch)) /
        (FLY_BODY_EXTENTS[1] + radius),
      (y * Math.sin(fly.pitch) + forward * Math.cos(fly.pitch)) /
        (FLY_BODY_EXTENTS[2] + radius),
    ];
  };
  const start = local(a, old),
    end = local(b, fly.p);
  const d = end.map((v, i) => v - start[i]);
  const c = start.reduce((n, v) => n + v * v, -1);
  if (c <= 0) return 0;
  const aa = d.reduce((n, v) => n + v * v, 0);
  const bb = 2 * start.reduce((n, v, i) => n + v * d[i], 0);
  const disc = bb * bb - 4 * aa * c;
  if (aa < 1e-12 || disc < 0) return null;
  const t = (-bb - Math.sqrt(disc)) / (2 * aa);
  return t >= 0 && t <= 1 ? t : null;
}

export class Flies {
  readonly states: FlyState[] = [];
  private cells = new Map<string, Entity[]>();
  private protection = 5;
  private time = 0;
  constructor(
    private world: WorldData,
    private terrain: Terrain,
    private removed: ReadonlySet<number>,
    saved?: FlyState[],
  ) {
    for (const e of world.entities) {
      for (
        let x = Math.floor((e.p[0] - e.s[0] - 25) / 64);
        x <= Math.floor((e.p[0] + e.s[0] + 25) / 64);
        x++
      )
        for (
          let z = Math.floor((e.p[2] - e.s[2] - 25) / 64);
          z <= Math.floor((e.p[2] + e.s[2] + 25) / 64);
          z++
        ) {
          const key = `${x},${z}`;
          const list = this.cells.get(key) ?? [];
          list.push(e);
          this.cells.set(key, list);
        }
    }
    for (let id = 0; id < FLY_COUNT; id++) {
      const seed = world.seed + id * 97;
      let x = 100 + hash(seed) * (world.size - 200),
        z = 100 + hash(seed + 1) * (world.size - 200);
      // The first fly is encountered shortly after leaving the spawn region.
      if (id === 0) {
        x = clamp(world.spawn[0] + Math.sin(0.65) * 420, 50, world.size - 50);
        z = clamp(world.spawn[2] + Math.cos(0.65) * 420, 50, world.size - 50);
      }
      for (
        let attempt = 0;
        attempt < 100 &&
        (Math.hypot(x - world.spawn[0], z - world.spawn[2]) < 320 ||
          this.states.some((f) => Math.hypot(x - f.p[0], z - f.p[2]) < 150));
        attempt++
      ) {
        x = 50 + hash(seed + attempt * 17 + 3) * (world.size - 100);
        z = 50 + hash(seed + attempt * 19 + 4) * (world.size - 100);
      }
      const old = saved?.find((f) => f.id === id);
      const p: Vec3 = old ? [...old.p] : [x, this.floor(x, z) + 75, z];
      p[0] = clamp(p[0], 25, world.size - 25);
      p[2] = clamp(p[2], 25, world.size - 25);
      p[1] = clamp(
        Math.max(p[1], this.floor(p[0], p[2])),
        25,
        CONFIG.ceiling - 25,
      );
      this.states.push({
        id,
        p,
        v: [0, 0, 0],
        yaw: old?.yaw ?? hash(seed + 5) * Math.PI * 2,
        pitch: 0,
        roll: 0,
        health: old?.health ?? 3,
        defeated: old?.defeated ?? false,
        mode: "roam",
        timer: 0,
        deathAge: old?.defeated ? 4 : 0,
        phase: id * 1.7,
      });
    }
  }
  private floor(x: number, z: number): number {
    let height = Math.max(
      this.terrain.sample(x, z),
      this.terrain.surfaceHeight(x, z) ?? -1e5,
    );
    for (const e of this.cells.get(
      `${Math.floor(x / 64)},${Math.floor(z / 64)}`,
    ) ?? [])
      if (
        !this.removed.has(e.id) &&
        Math.abs(x - e.p[0]) <= e.s[0] + 25 &&
        Math.abs(z - e.p[2]) <= e.s[2] + 25
      )
        height = Math.max(height, e.p[1] + e.s[1]);
    return height + FLY_CLEARANCE;
  }
  protect() {
    this.protection = 5;
  }
  intersect(a: Vec3, b: Vec3, radius = 0) {
    let first = Infinity,
      fly: FlyState | undefined;
    for (const f of this.states) {
      if (f.defeated) continue;
      const t = flyBodyHit(a, b, f, radius);
      if (t !== null && t < first) {
        first = t;
        fly = f;
      }
    }
    return fly
      ? { fly, p: a.map((v, i) => v + (b[i] - v) * first) as Vec3 }
      : null;
  }
  damage(p: Vec3, radius: number, amount: number, column = false) {
    return this.damageMatching(f => {
      const separation = column
        ? Math.hypot(f.p[0] - p[0], f.p[2] - p[2])
        : distance(f.p, p);
      return separation <= radius + 21;
    }, amount);
  }
  damageMatching(touches: (fly: FlyState) => boolean, amount: number) {
    const hit: FlyState[] = [];
    for (const f of this.states) {
      if (f.defeated || !touches(f)) continue;
      f.health = Math.max(0, f.health - amount);
      f.defeated = f.health === 0;
      if (f.defeated) f.deathAge = 0;
      hit.push(f);
    }
    return hit;
  }
  step(
    dt: number,
    from: Vec3,
    jet: Vec3,
    velocity: Vec3,
    crashed: boolean,
    sweep: (a: Vec3, b: Vec3, radius: number) => Vec3 | null,
  ): Vec3 | null {
    this.time += dt;
    this.protection = Math.max(0, this.protection - dt);
    let contact: Vec3 | null = null,
      first = Infinity;
    for (const f of this.states) {
      const old: Vec3 = [...f.p];
      f.phase += dt * 35;
      if (f.defeated) {
        f.deathAge += dt;
        if (f.deathAge < 4) {
          f.v[1] -= 35 * dt;
          f.p = f.p.map((v, i) => v + f.v[i] * dt) as Vec3;
          f.p[0] = clamp(f.p[0], 25, this.world.size - 25);
          f.p[2] = clamp(f.p[2], 25, this.world.size - 25);
          f.p[1] = Math.max(f.p[1], this.floor(f.p[0], f.p[2]) - 18);
          f.roll += dt * 4;
          f.pitch += dt * 2;
        }
        continue;
      }
      const range = distance(f.p, jet),
        safe = crashed || this.protection > 0;
      if (safe || range > 900) {
        f.mode = "roam";
        f.timer = 0;
      } else if (f.mode === "roam" && range < 650) f.mode = "chase";
      if (f.mode === "chase" && range < 100) {
        f.mode = "windup";
        f.timer = 0.6;
      }
      if (f.mode === "windup" || f.mode === "lunge" || f.mode === "recovery") {
        f.timer -= dt;
        if (f.timer <= 1e-9) {
          if (f.mode === "windup") {
            f.mode = "lunge";
            f.timer = 1;
            const target = jet.map(
              (v, i) => v + velocity[i] * Math.min(0.5, range / 140),
            );
            const delta = target.map((v, i) => v - f.p[i]);
            const length = Math.hypot(...delta) || 1;
            f.v = delta.map((v) => (v / length) * 140) as Vec3;
          } else if (f.mode === "lunge") {
            f.mode = "recovery";
            f.timer = 2;
          } else {
            f.mode = "chase";
            f.timer = 0;
          }
        }
      }
      if (f.mode !== "lunge") {
        let target: Vec3 =
          f.mode === "chase" || f.mode === "windup"
            ? [...jet]
            : [
                f.p[0] +
                  Math.sin(f.yaw + Math.sin(this.time * 0.3 + f.id) * 0.5) *
                    160,
                this.floor(f.p[0], f.p[2]) +
                  75 +
                  Math.sin(this.time + f.id) * 15,
                f.p[2] +
                  Math.cos(f.yaw + Math.sin(this.time * 0.3 + f.id) * 0.5) *
                    160,
              ];
        if (
          f.p[0] < 120 ||
          f.p[0] > this.world.size - 120 ||
          f.p[2] < 120 ||
          f.p[2] > this.world.size - 120
        )
          target = [this.world.size / 2, f.p[1], this.world.size / 2];
        for (const other of this.states)
          if (other !== f && !other.defeated && distance(f.p, other.p) < 80) {
            target[0] += (f.p[0] - other.p[0]) * 4;
            target[2] += (f.p[2] - other.p[2]) * 4;
          }
        const turn = clamp(
          angle(f.yaw, Math.atan2(target[0] - f.p[0], target[2] - f.p[2])),
          -dt * 1.8,
          dt * 1.8,
        );
        f.yaw += turn;
        f.roll +=
          (clamp((-turn / (dt || 1)) * 0.3, -0.55, 0.55) - f.roll) *
          Math.min(1, dt * 5);
        const desiredPitch = Math.atan2(
          target[1] - f.p[1],
          Math.hypot(target[0] - f.p[0], target[2] - f.p[2]),
        );
        f.pitch += clamp(desiredPitch - f.pitch, -dt * 1.5, dt * 1.5);
        const speed = f.mode === "chase" ? 95 : f.mode === "windup" ? 12 : 45;
        f.v = [
          Math.sin(f.yaw) * Math.cos(f.pitch) * speed,
          Math.sin(f.pitch) * speed,
          Math.cos(f.yaw) * Math.cos(f.pitch) * speed,
        ];
      } else {
        f.yaw = Math.atan2(f.v[0], f.v[2]);
        f.pitch = Math.atan2(f.v[1], Math.hypot(f.v[0], f.v[2]));
      }
      let next = f.p.map((v, i) => v + f.v[i] * dt) as Vec3;
      next[0] = clamp(next[0], 25, this.world.size - 25);
      next[2] = clamp(next[2], 25, this.world.size - 25);
      next[1] = clamp(
        next[1],
        this.floor(next[0], next[2]),
        CONFIG.ceiling - 25,
      );
      // Anticipate obstacles and climb in place rather than stepping through them.
      const ahead: Vec3 = [
        f.p[0] + f.v[0] * 0.8,
        f.p[1],
        f.p[2] + f.v[2] * 0.8,
      ];
      if (this.floor(ahead[0], ahead[2]) > f.p[1] || sweep(old, next, 21)) {
        next = [
          old[0],
          Math.min(CONFIG.ceiling - 25, old[1] + 60 * dt),
          old[2],
        ];
        if (sweep(old, next, 21)) next = old;
        f.yaw += dt;
        f.mode = "recovery";
        f.timer = 2;
      }
      f.p = next;
      if (!safe) {
        const t = flyBodyHit(from, jet, f, 2.2, old);
        if (t !== null && t < first) {
          first = t;
          contact = from.map((v, i) => v + (jet[i] - v) * t) as Vec3;
        }
      }
    }
    return contact;
  }
}
