import { expect, it } from "vitest";
import { MonsterRagdolls } from "../src/sim/monster-ragdolls";
import { packMotion, bindMotion, motionFrame } from "../src/sim/motion-buffer";
import { CONFIG } from "../src/config";
import type { MonsterState, SimulationSnapshot } from "../src/types";
import type { Terrain } from "../src/sim/terrain";

it("tumbles as one visual pineapple and retains its pose after landing", () => {
  const terrain = {
    sample: () => 0,
    aboveSurface: (a: number[], b: number[], clearance: number) =>
      Math.min(a[1], b[1]) > clearance,
  } as unknown as Terrain;
  const monster: MonsterState = {
    id: 0,
    p: [600, 0, 600],
    yaw: 0,
    health: 0,
    defeated: true,
    phase: 0,
    windup: 0,
    stagger: 0,
  };
  const ragdolls = new MonsterRagdolls(terrain);
  ragdolls.start(monster, [600, 0, 580]);
  ragdolls.start(monster);
  expect(ragdolls.moving.size).toBe(1);
  expect(monster.fragments).toBeUndefined();
  const initial = [...monster.ragdoll!];
  for (let i = 0; i < 180; i++) {
    ragdolls.update(CONFIG.dt);
  }
  expect(Math.abs(monster.ragdoll![0])).toBeGreaterThan(0.2);
  expect(monster.ragdoll).not.toEqual(initial);
  expect(monster.p.every(Number.isFinite)).toBe(true);
  expect(monster.health).toBe(0);
  expect(Math.hypot(monster.p[0] - 600, monster.p[2] - 600)).toBeGreaterThan(
    100,
  );
  for (let i = 0; i < 2400 && ragdolls.moving.size; i++) {
    ragdolls.update(CONFIG.dt);
  }
  expect(ragdolls.moving.size).toBe(0);
  expect(monster.ragdoll).toBeDefined();
  expect(monster.stagger).toBe(0);
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
    cleanupAge: 1.25,
    fragments: [{ part: 1, p: [10, 20, 30], q: [0, 0, 0, 1] }],
  };
  const frame = motionFrame();
  const snapshot = {
    packedMotion: packMotion([], [monster], [], []),
  } as SimulationSnapshot;
  bindMotion(snapshot, frame);
  expect(snapshot.monsters[0].fragments).toEqual(monster.fragments);
  expect(snapshot.monsters[0].ragdoll![0]).toBe(0.5);
  expect(snapshot.monsters[0].cleanupAge).toBe(1.25);
  expect(snapshot.monsters[0].stagger).toBe(0);
  expect(snapshot.monsters[0].ragdoll![3]).toBeCloseTo(Math.sqrt(0.75));
  const next = {
    packedMotion: packMotion(
      [],
      [
        {
          ...monster,
          defeated: false,
          stagger: 0.45,
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
  expect(next.monsters[0].cleanupAge).toBeUndefined();
  expect(next.monsters[0].stagger).toBeCloseTo(0.45);
});

it("bounds mass defeats and suppresses cleared corpses", () => {
  const terrain = {
    sample: () => 0,
    aboveSurface: () => true,
  } as unknown as Terrain;
  const ragdolls = new MonsterRagdolls(terrain);
  const monsters: MonsterState[] = Array.from({ length: 400 }, (_, id) => ({
    id,
    p: [600, 400, 600],
    yaw: 0,
    health: 0,
    defeated: true,
    phase: 0,
    windup: 0,
    stagger: 0,
  }));
  for (const monster of monsters) ragdolls.start(monster, [600, 400, 580]);
  expect(ragdolls.moving.size).toBe(128);
  for (let tick = 0; tick < 360; tick++) ragdolls.update(CONFIG.dt);
  expect(ragdolls.moving.size).toBe(0);
  expect(monsters.every((m) => m.ragdoll && !m.fragments)).toBe(true);
  const cleared = { ...monsters[0], cleared: true };
  ragdolls.start(cleared);
  expect(ragdolls.moving.size).toBe(0);
});
