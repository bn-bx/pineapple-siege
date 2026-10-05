import { beforeAll, expect, it } from "vitest";
import RAPIER from "@dimforge/rapier3d-compat";
import { MonsterRagdolls } from "../src/sim/monster-ragdolls";
import { packMotion, bindMotion, motionFrame } from "../src/sim/motion-buffer";
import { CONFIG } from "../src/config";
import type { MonsterState, SimulationSnapshot } from "../src/types";
import type { Terrain } from "../src/sim/terrain";

beforeAll(() => RAPIER.init());
it("tumbles onto terrain, sleeps, retains its pose, and releases the physics body", () => {
  const physics = new RAPIER.World({ x: 0, y: -CONFIG.debrisGravity, z: 0 });
  physics.timestep = CONFIG.dt;
  physics.createCollider(
    RAPIER.ColliderDesc.cuboid(500, 1, 500).setTranslation(0, -1, 0),
  );
  const terrain = { sample: () => 0 } as unknown as Terrain;
  const monster: MonsterState = {
    id: 0,
    p: [0, 0, 0],
    yaw: 0,
    health: 0,
    defeated: true,
    phase: 0,
    windup: 0,
    stagger: 0,
  };
  const ragdolls = new MonsterRagdolls(physics, terrain);
  try {
    ragdolls.start(monster, [0, 0, -20]);
    ragdolls.start(monster);
    expect(ragdolls.moving.size).toBe(4);
    expect(monster.fragments?.map((f) => f.part)).toEqual([0, 1, 2, 3]);
    const initial = [...monster.ragdoll!];
    for (let i = 0; i < 180; i++) {
      physics.step();
      ragdolls.update(CONFIG.dt);
    }
    expect(Math.abs(monster.ragdoll![0])).toBeGreaterThan(0.2);
    expect(monster.ragdoll).not.toEqual(initial);
    expect(monster.p.every(Number.isFinite)).toBe(true);
    expect(monster.health).toBe(0);
    expect(
      Math.hypot(
        ...monster.fragments![2].p.map(
          (v, i) => v - monster.fragments![3].p[i],
        ),
      ),
    ).toBeGreaterThan(50);
    for (let i = 0; i < 2400 && ragdolls.moving.size; i++) {
      physics.step();
      ragdolls.update(CONFIG.dt);
    }
    expect(ragdolls.moving.size).toBe(0);
    expect(monster.ragdoll).toBeDefined();
    expect(monster.stagger).toBe(0);
  } finally {
    physics.free();
  }
});
it("transfers corpse orientations and clears them when a packet slot is reused", () => {
  const monster: MonsterState = {
    id: 0,
    p: [1, 2, 3],
    yaw: 0,
    health: 0,
    defeated: true,
    phase: 0,
    windup: 0,
    stagger: 0,
    ragdoll: [0.5, 0, 0, Math.sqrt(0.75)],
    fragments: [{ part: 1, p: [10, 20, 30], q: [0, 0, 0, 1] }],
  };
  const frame = motionFrame();
  const snapshot = {
    packedMotion: packMotion([], [monster], [], []),
  } as SimulationSnapshot;
  bindMotion(snapshot, frame);
  expect(snapshot.monsters[0].fragments).toEqual(monster.fragments);
  expect(snapshot.monsters[0].ragdoll![0]).toBe(0.5);
  expect(snapshot.monsters[0].ragdoll![3]).toBeCloseTo(Math.sqrt(0.75));
  const next = {
    packedMotion: packMotion(
      [],
      [
        {
          ...monster,
          defeated: false,
          ragdoll: undefined,
          fragments: undefined,
        },
      ],
      [],
      [],
      snapshot.packedMotion!.buffer,
    ),
  } as SimulationSnapshot;
  bindMotion(next, frame);
  expect(next.monsters[0].ragdoll).toBeUndefined();
  expect(next.monsters[0].fragments).toBeUndefined();
});
