import RAPIER from "@dimforge/rapier3d-compat";
import { MONSTER_SCALE } from "../config";
import {
  MONSTER_FRAGMENT_CENTERS,
  MONSTER_DEFEAT_PARTS,
} from "../monster-fragments";
import type { MonsterFragment, MonsterState, Vec3 } from "../types";
import type { Terrain } from "./terrain";

/** Detached pineapple pieces tumble independently; older whole corpses stay intact. */
export class MonsterRagdolls {
  readonly moving = new Map<
    number,
    {
      monster: MonsterState;
      body: RAPIER.RigidBody;
      age: number;
      resting: number;
      fragment?: MonsterFragment;
    }
  >();
  constructor(
    private physics: RAPIER.World,
    private terrain: Terrain,
  ) {}
  start(monster: MonsterState, origin?: Vec3) {
    if (
      !monster.defeated ||
      [...this.moving.values()].some((r) => r.monster.id === monster.id)
    )
      return;
    if (monster.fragments || !monster.ragdoll) {
      this.startFragments(monster, origin);
      return;
    }
    const restoring = !!monster.ragdoll;
    const q = monster.ragdoll ?? [
      0,
      Math.sin(monster.yaw / 2),
      0,
      Math.cos(monster.yaw / 2),
    ];
    monster.ragdoll = [...q];
    const offset = this.offset(q);
    const body = this.physics.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(
          monster.p[0] + offset[0],
          monster.p[1] + offset[1],
          monster.p[2] + offset[2],
        )
        .setRotation({ x: q[0], y: q[1], z: q[2], w: q[3] })
        .setLinearDamping(0.45)
        .setAngularDamping(0.65)
        .setCcdEnabled(true),
    );
    this.physics.createCollider(
      RAPIER.ColliderDesc.capsule(3 * MONSTER_SCALE, 8 * MONSTER_SCALE)
        .setDensity(0.4)
        .setFriction(0.85)
        .setRestitution(0.12)
        .setCollisionGroups(0x00040007),
      body,
    );
    if (!restoring) {
      const angle = origin
        ? Math.atan2(monster.p[0] - origin[0], monster.p[2] - origin[2])
        : monster.yaw;
      body.setLinvel(
        { x: Math.sin(angle) * 9, y: 4, z: Math.cos(angle) * 9 },
        true,
      );
      body.setAngvel(
        {
          x: Math.cos(angle) * 1.7,
          y: ((monster.id % 3) - 1) * 0.35,
          z: -Math.sin(angle) * 1.7,
        },
        true,
      );
    }
    this.moving.set(monster.id * MONSTER_FRAGMENT_CENTERS.length, {
      monster,
      body,
      age: 0,
      resting: 0,
    });
  }
  private startFragments(monster: MonsterState, origin?: Vec3) {
    const restoring = !!monster.fragments;
    const q: [number, number, number, number] = [
      0,
      Math.sin(monster.yaw / 2),
      0,
      Math.cos(monster.yaw / 2),
    ];
    if (!monster.fragments)
      monster.fragments = MONSTER_DEFEAT_PARTS.map((part) => {
        const center = MONSTER_FRAGMENT_CENTERS[part];
        const [x, y, z] = center.map((v) => v * MONSTER_SCALE);
        const c = Math.cos(monster.yaw),
          s = Math.sin(monster.yaw);
        return {
          part,
          p: [
            monster.p[0] + c * x + s * z,
            monster.p[1] + y,
            monster.p[2] - s * x + c * z,
          ],
          q: [...q],
        };
      });
    monster.ragdoll ??= [...q];
    for (const fragment of monster.fragments) {
      const [x, y, z, w] = fragment.q;
      const body = this.physics.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(...fragment.p)
          .setRotation({ x, y, z, w })
          .setLinearDamping(0.18)
          .setAngularDamping(0.65)
          .setCcdEnabled(true),
      );
      const shape =
        fragment.part >= 4
          ? RAPIER.ColliderDesc.cuboid(
              4.5 * MONSTER_SCALE,
              6 * MONSTER_SCALE,
              7 * MONSTER_SCALE,
            )
          : fragment.part === 0
            ? RAPIER.ColliderDesc.capsule(3 * MONSTER_SCALE, 8 * MONSTER_SCALE)
            : fragment.part === 1
              ? RAPIER.ColliderDesc.cuboid(
                  3 * MONSTER_SCALE,
                  5 * MONSTER_SCALE,
                  3 * MONSTER_SCALE,
                )
              : RAPIER.ColliderDesc.cuboid(
                  5 * MONSTER_SCALE,
                  8 * MONSTER_SCALE,
                  3 * MONSTER_SCALE,
                );
      // Pieces collide with terrain and structures, but not their overlapping siblings.
      this.physics.createCollider(
        shape
          .setDensity(0.4)
          .setFriction(0.85)
          .setRestitution(0.12)
          .setCollisionGroups(0x00020001),
        body,
      );
      if (!restoring) {
        const base = origin
          ? Math.atan2(monster.p[0] - origin[0], monster.p[2] - origin[2])
          : monster.yaw;
        const angle =
          base +
          (fragment.part === 2
            ? -1.4
            : fragment.part === 3
              ? 1.4
              : fragment.part >= 4
                ? (fragment.part - 5.5) * 0.65
                : 0);
        const speed = 46 + ((monster.id * 17 + fragment.part * 13) % 20);
        body.setLinvel(
          {
            x: Math.sin(angle) * speed,
            y: 24 + ((monster.id + fragment.part * 7) % 13),
            z: Math.cos(angle) * speed,
          },
          true,
        );
        body.setAngvel(
          { x: Math.cos(angle) * 1.7, y: 0.4, z: -Math.sin(angle) * 1.7 },
          true,
        );
      }
      this.moving.set(
        monster.id * MONSTER_FRAGMENT_CENTERS.length + fragment.part,
        {
          monster,
          body,
          fragment,
          age: 0,
          resting: 0,
        },
      );
    }
  }
  private offset(
    q: readonly number[],
    center: readonly number[] = [0, 15, 0],
  ): Vec3 {
    const [x, y, z, w] = q,
      [a, b, c] = center.map((v) => v * MONSTER_SCALE);
    return [
      (1 - 2 * (y * y + z * z)) * a +
        2 * (x * y - w * z) * b +
        2 * (x * z + w * y) * c,
      2 * (x * y + w * z) * a +
        (1 - 2 * (x * x + z * z)) * b +
        2 * (y * z - w * x) * c,
      2 * (x * z - w * y) * a +
        2 * (y * z + w * x) * b +
        (1 - 2 * (x * x + y * y)) * c,
    ];
  }
  update(dt: number) {
    for (const [id, ragdoll] of this.moving) {
      const { body, monster, fragment } = ragdoll;
      ragdoll.age += dt;
      const q = body.rotation(),
        p = body.translation();
      // Canonical terrain remains authoritative across streamed collider boundaries.
      const vertical =
        fragment && fragment.part >= 4
          ? [4.5, 6, 7]
          : fragment?.part === 1
            ? [3, 5, 3]
            : fragment && fragment.part > 1
              ? [5, 8, 3]
              : undefined;
      const clearance = vertical
        ? MONSTER_SCALE *
          (vertical[0] * Math.abs(2 * (q.x * q.y + q.w * q.z)) +
            vertical[1] * Math.abs(1 - 2 * (q.x * q.x + q.z * q.z)) +
            vertical[2] * Math.abs(2 * (q.y * q.z - q.w * q.x)))
        : MONSTER_SCALE * (8 + 3 * Math.abs(1 - 2 * (q.x * q.x + q.z * q.z)));
      const floor = this.terrain.sample(p.x, p.z) + clearance;
      if (p.y < floor - 0.2) {
        body.setTranslation({ x: p.x, y: floor, z: p.z }, true);
        const v = body.linvel();
        body.setLinvel(
          { x: v.x * 0.8, y: Math.max(0, -v.y * 0.12), z: v.z * 0.8 },
          true,
        );
        p.y = floor;
      }
      if (fragment) {
        fragment.p = [p.x, p.y, p.z];
        fragment.q = [q.x, q.y, q.z, q.w];
      }
      if (!fragment || fragment.part === 0 || fragment.part === 4) {
        monster.ragdoll = [q.x, q.y, q.z, q.w];
        const offset = this.offset(
          monster.ragdoll,
          fragment && fragment.part >= 4
            ? MONSTER_FRAGMENT_CENTERS[fragment.part]
            : undefined,
        );
        monster.p = [p.x - offset[0], p.y - offset[1], p.z - offset[2]];
        monster.stagger = Math.min(
          1,
          Math.hypot(...Object.values(body.angvel())) / 2,
        );
        monster.phase += dt * 8;
      }
      const velocity = body.linvel(),
        angular = body.angvel();
      const quiet =
        Math.hypot(velocity.x, velocity.y, velocity.z) < 0.4 &&
        Math.hypot(angular.x, angular.y, angular.z) < 0.12;
      ragdoll.resting = quiet ? ragdoll.resting + dt : 0;
      if (ragdoll.age > 2 && (body.isSleeping() || ragdoll.resting > 1)) {
        monster.stagger = 0;
        this.physics.removeRigidBody(body);
        this.moving.delete(id);
      }
    }
  }
}
