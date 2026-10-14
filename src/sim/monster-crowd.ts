import type { MonsterState, Vec3 } from "../types";

export const MONSTER_CLEARANCE = 50;
const COMFORT = 64;
const CELL = 96;

/** A transient, live spatial grid: moved monsters immediately reserve their space. */
export class MonsterCrowd {
  private cells = new Map<number, Set<MonsterState>>();
  private members = new Map<number, number>();
  private count = 0;
  private key(x: number, z: number) {
    return Math.floor(x / CELL) + Math.floor(z / CELL) * 1024;
  }
  rebuild(monsters: MonsterState[]) {
    this.cells.clear();
    this.members.clear();
    this.count = monsters.length;
    for (const m of monsters) this.update(m);
  }
  update(m: MonsterState) {
    const key = this.key(m.p[0], m.p[2]);
    const old = this.members.get(m.id);
    if (old === key) return;
    if (old !== undefined) this.cells.get(old)?.delete(m);
    let cell = this.cells.get(key);
    if (!cell) this.cells.set(key, (cell = new Set()));
    cell.add(m);
    this.members.set(m.id, key);
  }
  private *neighbors(m: MonsterState) {
    const cx = Math.floor(m.p[0] / CELL),
      cz = Math.floor(m.p[2] / CELL);
    for (let z = cz - 1; z <= cz + 1; z++)
      for (let x = cx - 1; x <= cx + 1; x++)
        for (const other of this.cells.get(x + z * 1024) ?? [])
          if (other.id !== m.id) yield other;
  }
  approach(m: MonsterState, plane: Vec3): Vec3 {
    if (this.count <= 1) return [...plane];
    let slot = m.id,
      ring = 0,
      radius = 80;
    while (slot >= Math.floor((2 * Math.PI * radius) / COMFORT)) {
      slot -= Math.floor((2 * Math.PI * radius) / COMFORT);
      radius += COMFORT;
      ring++;
    }
    const capacity = Math.floor((2 * Math.PI * radius) / COMFORT);
    const angle = ((slot + (ring % 2) * 0.5) * 2 * Math.PI) / capacity;
    return [
      plane[0] + Math.sin(angle) * radius,
      0,
      plane[2] + Math.cos(angle) * radius,
    ];
  }
  steer(m: MonsterState, target: Vec3) {
    const dx = target[0] - m.p[0],
      dz = target[2] - m.p[2];
    const distance = Math.hypot(dx, dz);
    const fx = distance > 0.01 ? dx / distance : Math.sin(m.yaw);
    const fz = distance > 0.01 ? dz / distance : Math.cos(m.yaw);
    let pushX = 0,
      pushZ = 0,
      speed = 1;
    for (const other of this.neighbors(m)) {
      let x = m.p[0] - other.p[0],
        z = m.p[2] - other.p[2];
      const d = Math.hypot(x, z);
      if (d >= CELL) continue;
      if (d < 0.01) {
        // Antisymmetric pair directions let legacy stacks unwind without teleporting.
        const lo = Math.min(m.id, other.id),
          hi = Math.max(m.id, other.id);
        const angle =
          (((lo * 73856093) ^ (hi * 19349663)) >>> 0) * 2.399963229728653;
        const sign = m.id < other.id ? 1 : -1;
        x = Math.sin(angle) * sign;
        z = Math.cos(angle) * sign;
      } else {
        x /= d;
        z /= d;
      }
      const weight = Math.max(0, 1 - d / COMFORT);
      pushX += x * weight * 2.5;
      pushZ += z * weight * 2.5;
      const ahead = (other.p[0] - m.p[0]) * fx + (other.p[2] - m.p[2]) * fz;
      const lateral = Math.abs(
        (other.p[0] - m.p[0]) * fz - (other.p[2] - m.p[2]) * fx,
      );
      if (ahead > 0 && lateral < MONSTER_CLEARANCE && d >= MONSTER_CLEARANCE) {
        const gap =
          ahead - Math.sqrt(Math.max(0, MONSTER_CLEARANCE ** 2 - lateral ** 2));
        speed = Math.min(speed, Math.max(0, Math.min(1, gap / 24)));
        // Both opposing drivers keep right rather than choosing the same passing side.
        const urgency = Math.max(0, 1 - gap / 40);
        pushX += fz * urgency;
        pushZ -= fx * urgency;
      }
    }
    const pressure = Math.hypot(pushX, pushZ);
    if (pressure > 2.5) {
      pushX *= 2.5 / pressure;
      pushZ *= 2.5 / pressure;
    }
    return {
      angle: Math.atan2(fx + pushX, fz + pushZ),
      speed: Math.max(0.15, speed),
      pressure,
    };
  }
  permits(m: MonsterState, next: Vec3) {
    let currentOverlap = 0,
      nextOverlap = 0;
    const vx = next[0] - m.p[0],
      vz = next[2] - m.p[2];
    const length2 = vx * vx + vz * vz;
    for (const other of this.neighbors(m)) {
      const x = m.p[0] - other.p[0],
        z = m.p[2] - other.p[2];
      const current = Math.hypot(x, z);
      if (current >= CELL) continue;
      const end = Math.hypot(next[0] - other.p[0], next[2] - other.p[2]);
      if (current >= MONSTER_CLEARANCE - 0.001) {
        const t = length2
          ? Math.max(0, Math.min(1, -(x * vx + z * vz) / length2))
          : 0;
        if (Math.hypot(x + vx * t, z + vz * t) < MONSTER_CLEARANCE - 0.001)
          return false;
      } else {
        currentOverlap += (MONSTER_CLEARANCE - current) ** 2;
        nextOverlap += Math.max(0, MONSTER_CLEARANCE - end) ** 2;
      }
    }
    return currentOverlap === 0 || nextOverlap < currentOverlap - 0.00001;
  }
}
