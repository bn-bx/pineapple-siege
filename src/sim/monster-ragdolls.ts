import type RAPIER from "@dimforge/rapier3d-compat";
import {
  CORPSE_MOTION_LIMIT,
  MONSTER_SCALE,
  WRECKAGE_FLIGHT_SECONDS,
} from "../config";
import { advanceDebris, type BallisticDebris } from "./ballistic-debris";
import type { MonsterState, Vec3, Quat } from "../types";
import type { Terrain } from "./terrain";

/** Defeated pineapples use one cheap visual trajectory, with no native contacts. */
export class MonsterRagdolls {
  readonly moving = new Map<
    number,
    BallisticDebris & { monster: MonsterState; age: number }
  >();
  constructor(
    _physics: RAPIER.World,
    private terrain: Terrain,
  ) {}
  private offset(q: Quat): Vec3 {
    const [x, y, z, w] = q,
      height = 15 * MONSTER_SCALE;
    return [
      2 * (x * y - w * z) * height,
      (1 - 2 * (x * x + z * z)) * height,
      2 * (y * z + w * x) * height,
    ];
  }
  start(monster: MonsterState, origin?: Vec3) {
    if (monster.cleared || !monster.defeated || this.moving.has(monster.id))
      return;
    const q: Quat = monster.ragdoll
      ? [...monster.ragdoll]
      : [0, Math.sin(monster.yaw / 2), 0, Math.cos(monster.yaw / 2)];
    monster.ragdoll = q;
    // Older split corpses migrate to a single display pose.
    monster.fragments = undefined;
    if (this.moving.size >= CORPSE_MOTION_LIMIT) return;
    const offset = this.offset(q),
      angle = origin
        ? Math.atan2(monster.p[0] - origin[0], monster.p[2] - origin[2])
        : monster.yaw;
    this.moving.set(monster.id, {
      monster,
      age: monster.cleanupAge ?? 0,
      view: {
        id: monster.id,
        source: -1,
        kind: "chunk",
        material: "foliage",
        p: monster.p.map((v, i) => v + offset[i]) as Vec3,
        q,
        s: [8 * MONSTER_SCALE, 15 * MONSTER_SCALE, 8 * MONSTER_SCALE],
      },
      velocity: origin
        ? [Math.sin(angle) * 60, 40, Math.cos(angle) * 60]
        : [0, 0, 0],
      angular: [Math.cos(angle) * 1.4, 0.3, -Math.sin(angle) * 1.4],
      grounded: 0,
    });
  }
  stop(monster: MonsterState) {
    this.moving.delete(monster.id);
    monster.stagger = 0;
  }
  update(dt: number) {
    for (const [id, m] of this.moving) {
      m.age += dt;
      const resting = advanceDebris(m, this.terrain, dt);
      monsterPose(m.monster, m.view.p, m.view.q, this.offset(m.view.q));
      if (resting || m.age >= WRECKAGE_FLIGHT_SECONDS - 1e-9)
        this.stop(m.monster);
    }
  }
}
function monsterPose(
  monster: MonsterState,
  center: Vec3,
  q: Quat,
  offset: Vec3,
) {
  monster.p = center.map((v, i) => v - offset[i]) as Vec3;
  monster.ragdoll = [...q];
  monster.stagger = 0;
}
