import type {
  CivilianState,
  MonsterState,
  MonsterSpike,
  SimulationSnapshot,
  Vec3,
  Quat,
  PackedMotion,
} from "../types";
import { bindBodies, type BodyFrame } from "./body-buffer";
const STRIDE = 12;
const moods = ["walk", "flee", "cheer", "sad"] as const;
export function packMotion(
  civilians: CivilianState[],
  monsters: MonsterState[],
  projectiles: SimulationSnapshot["projectiles"],
  spikes: MonsterSpike[],
  reuse?: ArrayBuffer,
): PackedMotion {
  const counts = [
    civilians.length,
    monsters.length,
    projectiles.length,
    spikes.length,
  ] as [number, number, number, number];
  const bytes = counts.reduce((a, b) => a + b, 0) * STRIDE * 4;
  const buffer =
    reuse && reuse.byteLength >= bytes
      ? reuse
      : new ArrayBuffer(Math.max(256, 2 ** Math.ceil(Math.log2(bytes || 1))));
  const data = new Float32Array(buffer);
  let offset = 0;
  for (const c of civilians) {
    data[offset] = c.id;
    data[offset + 1] = c.p[0];
    data[offset + 2] = c.p[1];
    data[offset + 3] = c.p[2];
    data[offset + 4] = c.yaw;
    data[offset + 5] = +c.alive;
    data[offset + 6] = moods.indexOf(c.mood);
    data[offset + 7] = c.phase;
    offset += STRIDE;
  }
  for (const m of monsters) {
    data[offset] = m.id;
    data[offset + 1] = m.p[0];
    data[offset + 2] = m.p[1];
    data[offset + 3] = m.p[2];
    data[offset + 4] = m.yaw;
    data[offset + 5] = m.health;
    data[offset + 6] = +m.defeated;
    data[offset + 7] = m.phase;
    data[offset + 8] = m.windup;
    data[offset + 9] = m.stagger;
    offset += STRIDE;
  }
  for (const p of projectiles) {
    data[offset] = p.id;
    data[offset + 1] = p.p[0];
    data[offset + 2] = p.p[1];
    data[offset + 3] = p.p[2];
    data[offset + 4] = p.v[0];
    data[offset + 5] = p.v[1];
    data[offset + 6] = p.v[2];
    data[offset + 7] = p.weapon === "nuke" ? 1 : 0;
    data[offset + 8] = p.yield === "valley" ? 2 : p.yield === "castle" ? 1 : 0;
    offset += STRIDE;
  }
  for (const s of spikes) {
    data[offset] = s.id;
    data[offset + 1] = s.p[0];
    data[offset + 2] = s.p[1];
    data[offset + 3] = s.p[2];
    data[offset + 4] = s.v[0];
    data[offset + 5] = s.v[1];
    data[offset + 6] = s.v[2];
    data[offset + 7] = s.age;
    offset += STRIDE;
  }
  return { buffer, counts };
}
/** Stable vector wrappers borrow the transferable Float32 storage without copying poses. */
export class PacketVector {
  private data!: Float32Array;
  private offset = 0;
  constructor(readonly length: number) {}
  bind(data: Float32Array, offset: number) {
    this.data = data;
    this.offset = offset;
    return this;
  }
  get 0() {
    return this.data[this.offset];
  }
  get 1() {
    return this.data[this.offset + 1];
  }
  get 2() {
    return this.data[this.offset + 2];
  }
  get 3() {
    return this.data[this.offset + 3];
  }
  *[Symbol.iterator]() {
    for (let i = 0; i < this.length; i++) yield this.data[this.offset + i];
  }
  map<T>(fn: (v: number, k: number) => T) {
    const a: T[] = [];
    for (let i = 0; i < this.length; i++)
      a.push(fn(this.data[this.offset + i], i));
    return a;
  }
}
export interface MotionFrame extends BodyFrame {
  civilians: CivilianState[];
  monsters: MonsterState[];
  projectiles: SimulationSnapshot["projectiles"];
  spikes: MonsterSpike[];
  civilianPool: CivilianState[];
  monsterPool: MonsterState[];
  projectilePool: SimulationSnapshot["projectiles"];
  spikePool: MonsterSpike[];
}
export function motionFrame(): MotionFrame {
  return {
    bodies: [],
    bodyPool: [],
    civilians: [],
    monsters: [],
    projectiles: [],
    spikes: [],
    civilianPool: [],
    monsterPool: [],
    projectilePool: [],
    spikePool: [],
  };
}
const vector = (n = 3) => new PacketVector(n) as unknown as Vec3 & Quat;
export function bindMotion(
  snapshot: SimulationSnapshot,
  frame: MotionFrame,
  bodyRecords = true,
) {
  if (snapshot.packedBodies) {
    if (bodyRecords) snapshot.bodies = bindBodies(snapshot.packedBodies, frame);
    else {
      frame.bodies.length = snapshot.packedBodies.count;
      snapshot.bodies = frame.bodies;
    }
  }
  const motion = snapshot.packedMotion;
  if (!motion) return;
  const data = new Float32Array(motion.buffer);
  let offset = 0;
  const pools = [
      frame.civilianPool,
      frame.monsterPool,
      frame.projectilePool,
      frame.spikePool,
    ],
    arrays = [frame.civilians, frame.monsters, frame.projectiles, frame.spikes];
  for (let kind = 0; kind < 4; kind++) {
    const count = motion.counts[kind],
      pool = pools[kind] as any[],
      array = arrays[kind] as any[];
    array.length = count;
    for (let i = 0; i < count; i++, offset += STRIDE) {
      let v = pool[i];
      if (!v)
        pool[i] = v = { p: vector(), ...(kind > 1 ? { v: vector() } : {}) };
      array[i] = v;
      v.id = data[offset];
      (v.p as unknown as PacketVector).bind(data, offset + 1);
      if (kind === 0) {
        v.yaw = data[offset + 4];
        v.alive = !!data[offset + 5];
        v.mood = moods[data[offset + 6]];
        v.phase = data[offset + 7];
      } else if (kind === 1) {
        v.yaw = data[offset + 4];
        v.health = data[offset + 5];
        v.defeated = !!data[offset + 6];
        v.phase = data[offset + 7];
        v.windup = data[offset + 8];
        v.stagger = data[offset + 9];
      } else {
        (v.v as unknown as PacketVector).bind(data, offset + 4);
        if (kind === 2) {
          v.weapon = data[offset + 7] ? "nuke" : "cannon";
          v.yield = ["local", "castle", "valley"][data[offset + 8]];
        } else v.age = data[offset + 7];
      }
    }
  }
  snapshot.civilians = frame.civilians;
  snapshot.monsters = frame.monsters;
  snapshot.projectiles = frame.projectiles;
  snapshot.monsterSpikes = frame.spikes;
}
