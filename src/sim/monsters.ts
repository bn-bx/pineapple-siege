import {
  CONFIG,
  DEFAULT_MONSTER_COUNT,
  MAX_MONSTER_COUNT,
  MONSTER_SCALE,
  clamp,
  normalizeMonsterCount,
} from "../config";
import type { MonsterSpike, MonsterState, Vec3, WorldData } from "../types";
import { Terrain } from "./terrain";

const hash = (n: number) => {
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
};
const distanceXZ = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[2] - b[2]);
export const MONSTER_BODY_HEIGHT = 14 * MONSTER_SCALE;
export const MONSTER_BODY_RADIUS = 12 * MONSTER_SCALE;

export class Monsters {
  readonly states: MonsterState[] = [];
  readonly spikes: MonsterSpike[] = [];
  readonly throws: Vec3[] = [];
  private nextSpike = 1;
  private bursts = new Map<number, { remaining: number; timer: number }>();
  count = DEFAULT_MONSTER_COUNT;
  private cooldowns: number[] = [];
  private wander: number[] = [];
  constructor(
    private world: WorldData,
    private terrain: Terrain,
    saved?: MonsterState[],
  ) {
    this.ensureStates(
      Math.min(
        MAX_MONSTER_COUNT,
        Math.max(DEFAULT_MONSTER_COUNT, saved?.length ?? 0),
      ),
      saved,
    );
  }
  private ensureStates(count: number, saved?: MonsterState[]) {
    for (let id = this.states.length; id < count; id++) {
      const p = this.spawn(id);
      const old = saved?.find((m) => m?.id === id);
      this.states.push(
        old
          ? { ...old, p: this.restorePosition(old.p, p), windup: 0, stagger: 0 }
          : {
              id,
              p,
              yaw: hash(id + 300) * Math.PI * 2,
              health: 5,
              defeated: false,
              phase: 0,
              windup: 0,
              stagger: 0,
            },
      );
      this.wander[id] = hash(id + 700) * Math.PI * 2;
      this.cooldowns[id] = 1;
    }
  }
  private restorePosition(saved: Vec3, fallback: Vec3): Vec3 {
    const separation =
      this.states.length < DEFAULT_MONSTER_COUNT
        ? 115
        : MONSTER_BODY_RADIUS * 2 + 16;
    const clear = (x: number, z: number) =>
      this.walkable(x, z) &&
      this.states.every(
        (m) => Math.hypot(m.p[0] - x, m.p[2] - z) >= separation,
      );
    if (clear(saved[0], saved[2]))
      return [saved[0], this.terrain.sample(saved[0], saved[2]), saved[2]];
    for (let radius = 40; radius <= 320; radius += 40)
      for (let i = 0; i < 16; i++) {
        const a = (i * Math.PI) / 8;
        const x = saved[0] + Math.sin(a) * radius;
        const z = saved[2] + Math.cos(a) * radius;
        if (clear(x, z)) return [x, this.terrain.sample(x, z), z];
      }
    return fallback;
  }
  private spawn(id: number): Vec3 {
    const separation =
      id < DEFAULT_MONSTER_COUNT ? 145 : MONSTER_BODY_RADIUS * 2 + 16;
    const clear = (x: number, z: number, spacing: number) =>
      this.walkable(x, z) &&
      this.states.every((m) => Math.hypot(m.p[0] - x, m.p[2] - z) >= spacing);
    for (let attempt = 0; attempt < 1000; attempt++) {
      const settlements = [
        this.world.castle,
        ...this.world.sites.filter((s) => s.kind === "hamlet").map((s) => s.p),
      ];
      const center = settlements[id % settlements.length];
      const angle =
        hash(id * 887 + attempt * 31 + this.world.seed) * Math.PI * 2;
      const radius =
        180 + hash(id * 997 + attempt * 47 + this.world.seed) * 290;
      const x =
        id % 3 !== 2 && attempt < 500
          ? center[0] + Math.sin(angle) * radius
          : 105 +
            hash(id * 887 + attempt * 31 + this.world.seed) *
              (this.world.size - 210);
      const z =
        id % 3 !== 2 && attempt < 500
          ? center[2] + Math.cos(angle) * radius
          : 105 +
            hash(id * 997 + attempt * 47 + this.world.seed) *
              (this.world.size - 210);
      if (!clear(x, z, separation)) continue;
      return [x, this.terrain.sample(x, z), z];
    }
    // A bounded land scan avoids placing large populations outside the valley.
    for (const spacing of [MONSTER_BODY_RADIUS * 2 + 16, 0])
      for (let z = 105; z < CONFIG.worldSize - 105; z += 32)
        for (let x = 105; x < CONFIG.worldSize - 105; x += 32)
          if (clear(x, z, spacing)) return [x, this.terrain.sample(x, z), z];
    const x = clamp(this.world.spawn[0], 75, CONFIG.worldSize - 75);
    const z = clamp(this.world.spawn[2], 75, CONFIG.worldSize - 75);
    return [x, this.terrain.sample(x, z), z];
  }
  private walkable(x: number, z: number): boolean {
    if (
      x < 75 ||
      x > CONFIG.worldSize - 75 ||
      z < 75 ||
      z > CONFIG.worldSize - 75
    )
      return false;
    if (this.terrain.water(x, z)) return false;
    const h = this.terrain.sample(x, z);
    if (!Number.isFinite(h)) return false;
    for (const [dx, dz] of [
      [36, 0],
      [-36, 0],
      [0, 36],
      [0, -36],
    ])
      if (
        this.terrain.water(x + dx, z + dz) ||
        Math.abs(this.terrain.sample(x + dx, z + dz) - h) > 12
      )
        return false;
    if (
      x > this.world.castleBounds.min[0] - 75 &&
      x < this.world.castleBounds.max[0] + 75 &&
      z > this.world.castleBounds.min[1] - 75 &&
      z < this.world.castleBounds.max[1] + 75
    )
      return false;
    if (distanceXZ([x, h, z], this.world.spawn) < 120) return false;
    return !this.world.sites.some(
      (s) => Math.hypot(s.p[0] - x, s.p[2] - z) < s.radius + 60,
    );
  }
  setCount(value: number) {
    this.count = normalizeMonsterCount(value);
    this.ensureStates(this.count);
    this.spikes.length = 0;
    this.bursts.clear();
  }
  active() {
    return this.states.slice(0, this.count).filter((m) => !m.defeated);
  }
  damage(m: MonsterState, amount: number) {
    if (m.defeated || m.id >= this.count) return false;
    m.health = Math.max(0, m.health - amount);
    m.stagger = 0.45;
    m.windup = 0;
    this.bursts.delete(m.id);
    if (m.health === 0) m.defeated = true;
    return true;
  }
  blast(p: Vec3, radius: number, amount: number) {
    const hit: MonsterState[] = [];
    for (const m of this.active()) {
      const d = Math.hypot(
        m.p[0] - p[0],
        m.p[1] + MONSTER_BODY_HEIGHT - p[1],
        m.p[2] - p[2],
      );
      if (d < radius + MONSTER_BODY_RADIUS && this.damage(m, amount))
        hit.push(m);
    }
    return hit;
  }
  burn(p: Vec3, radius: number, amount: number) {
    const hit: MonsterState[] = [];
    for (const m of this.active()) {
      if (
        distanceXZ(m.p, p) < radius + MONSTER_BODY_RADIUS &&
        this.damage(m, amount)
      )
        hit.push(m);
    }
    return hit;
  }
  // Earliest intersection with the body envelope, including projectile radius.
  intersect(a: Vec3, b: Vec3, radius = 0) {
    let best: { monster: MonsterState; t: number; p: Vec3 } | null = null;
    for (const m of this.active()) {
      const center: Vec3 = [m.p[0], m.p[1] + MONSTER_BODY_HEIGHT, m.p[2]];
      const d = b.map((v, i) => v - a[i]) as Vec3;
      const o = a.map((v, i) => v - center[i]) as Vec3;
      const r = MONSTER_BODY_RADIUS + radius;
      const aa = d[0] ** 2 + d[1] ** 2 + d[2] ** 2;
      const bb = 2 * (o[0] * d[0] + o[1] * d[1] + o[2] * d[2]);
      const cc = o[0] ** 2 + o[1] ** 2 + o[2] ** 2 - r * r;
      const disc = bb * bb - 4 * aa * cc;
      if (aa < 1e-8 || disc < 0) continue;
      const t = cc <= 0 ? 0 : (-bb - Math.sqrt(disc)) / (2 * aa);
      if (t >= 0 && t <= 1 && (!best || t < best.t))
        best = { monster: m, t, p: a.map((v, i) => v + d[i] * t) as Vec3 };
    }
    return best;
  }
  step(
    dt: number,
    plane: Vec3,
    crashed: boolean,
    obstacle: (a: Vec3, b: Vec3) => boolean,
    disco = false,
    planeVelocity: Vec3 = [0, 0, 0],
  ) {
    let swipe = false;
    this.throws.length = 0;
    if (disco || crashed) {
      this.spikes.length = 0;
      this.bursts.clear();
    }
    for (const m of this.active()) {
      m.p[1] = this.terrain.sample(m.p[0], m.p[2]);
      m.stagger = Math.max(0, m.stagger - dt);
      this.cooldowns[m.id] = Math.max(0, this.cooldowns[m.id] - dt);
      if (disco) {
        m.windup = 0;
        this.cooldowns[m.id] = Math.max(this.cooldowns[m.id], 0.7);
        m.phase += dt * 12;
        continue;
      }
      if (m.windup > 0) {
        m.windup -= dt;
        if (m.windup <= 0 && !crashed && !m.stagger) {
          const horizontal = distanceXZ(m.p, plane);
          if (horizontal < 54 && plane[1] - m.p[1] < 68) swipe = true;
          else if (horizontal < 500 && plane[1] - m.p[1] < 350) {
            this.bursts.set(m.id, { remaining: 3, timer: 0 });
          }
          this.cooldowns[m.id] = 2.4;
        }
      }
      const burst = this.bursts.get(m.id);
      if (burst && !crashed && !m.stagger) {
        burst.timer -= dt;
        if (burst.timer <= 0) {
          const origin: Vec3 = [m.p[0], m.p[1] + 38, m.p[2]];
          const delta = plane.map((v, i) => v - origin[i]) as Vec3;
          const vv =
            planeVelocity.reduce((sum, v) => sum + v * v, 0) - 125 * 125;
          const dv =
            2 * delta.reduce((sum, v, i) => sum + v * planeVelocity[i], 0);
          const dd = delta.reduce((sum, v) => sum + v * v, 0);
          const discriminant = dv * dv - 4 * vv * dd;
          const roots =
            Math.abs(vv) < 1e-6
              ? [-dd / (dv || 1)]
              : discriminant >= 0
                ? [
                    (-dv - Math.sqrt(discriminant)) / (2 * vv),
                    (-dv + Math.sqrt(discriminant)) / (2 * vv),
                  ]
                : [];
          const flight = Math.min(4, ...roots.filter((t) => t > 0));
          const lead = Number.isFinite(flight)
            ? flight
            : Math.hypot(...delta) / 125;
          const aim = delta.map(
            (v, i) =>
              v + planeVelocity[i] * lead + (i === 1 ? 6 * lead * lead : 0),
          ) as Vec3;
          const length = Math.hypot(...aim) || 1;
          if (this.spikes.length < 600) {
            this.spikes.push({
              id: this.nextSpike++,
              p: origin,
              v: aim.map((v) => (v / length) * 125) as Vec3,
              age: 0,
            });
            this.throws.push([...origin]);
          }
          burst.remaining--;
          burst.timer += 0.15;
          if (!burst.remaining) this.bursts.delete(m.id);
        }
      }
      if (m.stagger > 0 || m.windup > 0) continue;
      const near =
        !crashed && distanceXZ(m.p, plane) < 500 && plane[1] - m.p[1] < 350;
      if (near && this.cooldowns[m.id] <= 0) {
        m.windup = 0.75;
        continue;
      }
      const desired = near
        ? Math.atan2(plane[0] - m.p[0], plane[2] - m.p[2])
        : this.wander[m.id] + Math.sin(m.phase * 0.17 + m.id) * 0.6;
      const turn = Math.atan2(
        Math.sin(desired - m.yaw),
        Math.cos(desired - m.yaw),
      );
      m.yaw += clamp(turn, -dt * 1.1, dt * 1.1);
      const speed = near ? 14 : 4.5;
      const x = m.p[0] + Math.sin(m.yaw) * speed * dt;
      const z = m.p[2] + Math.cos(m.yaw) * speed * dt;
      const next: Vec3 = [x, this.terrain.sample(x, z), z];
      if (this.walkable(x, z) && !obstacle(m.p, next)) m.p = next;
      else {
        this.wander[m.id] += 1.7;
        m.yaw += dt * 2;
      }
      m.phase += dt * speed;
    }
    for (let i = this.spikes.length - 1; i >= 0; i--) {
      const s = this.spikes[i];
      s.age += dt;
      const next = s.p.map((v, k) => v + s.v[k] * dt) as Vec3;
      const d = next.map((v, k) => v - s.p[k]) as Vec3;
      const rel = s.p.map((v, k) => v - plane[k]) as Vec3;
      const t = clamp(
        -d.reduce((sum, v, k) => sum + v * rel[k], 0) /
          (d.reduce((sum, v) => sum + v * v, 0) || 1),
        0,
        1,
      );
      const closest = next.map((_, k) => s.p[k] + d[k] * t) as Vec3;
      if (!crashed && Math.hypot(...closest.map((v, k) => v - plane[k])) < 5) {
        swipe = true;
        this.spikes.splice(i, 1);
      } else if (
        s.age > 7 ||
        next[1] < this.terrain.sample(next[0], next[2]) ||
        next[0] < 0 ||
        next[0] > CONFIG.worldSize ||
        next[2] < 0 ||
        next[2] > CONFIG.worldSize
      )
        this.spikes.splice(i, 1);
      else {
        s.p = next;
        s.v[1] -= 12 * dt;
      }
    }
    return swipe;
  }
}
