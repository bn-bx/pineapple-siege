import { beforeAll, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { CONFIG } from "../src/config";
import { Simulation, initializePhysics } from "../src/sim/simulation";
import { compatible } from "../src/storage";
import type { Entity, NuclearFireState, WorldData } from "../src/types";

const manifest: WorldData = JSON.parse(
  readFileSync("tests/fixtures/legacy-world/world.json", "utf8"),
);
const flat = new Float32Array(CONFIG.grid * CONFIG.grid).fill(10);
const fireState: NuclearFireState = {
  patches: [1, 2].map((id) => ({
    id,
    p: [3000, 10, 3000],
    radius: 24,
    height: 8,
    age: 0,
    seed: id,
  })),
  clock: 0,
  creatureClock: 0,
  exposures: [],
};
beforeAll(initializePhysics);
function create(entities: Entity[] = []) {
  return new Simulation(
    {
      ...manifest,
      entities,
      rivers: [],
      spawn: [1000, 350, 1000],
      civilians: [
        { id: 0, home: "castle", settlement: "castle", p: [3000, 10, 3000] },
      ],
    },
    flat,
    () => {},
  );
}
function advance(s: Simulation, seconds: number) {
  for (let i = 0; i < seconds * 60; i++) (s as any).updateNuclearFire(1 / 60);
}

it("applies creature contact damage once per second, preserves high flyers, and records autosave revisions", () => {
  const s = create();
  try {
    s.fires.restore(fireState);
    const m = s.monsters.states[0];
    m.p = [3000, 10, 3000];
    m.health = 5;
    m.defeated = false;
    const f = s.flies.states[0];
    f.p = [3000, 15, 3000];
    f.health = 3;
    f.defeated = false;
    const high = s.flies.states[1];
    high.p = [3000, 100, 3000];
    high.health = 3;
    high.defeated = false;
    const revision = s.revision;
    (s as any).updateNuclearFire(0);
    expect(s.fires.patches[0].age).toBe(0); // Paused renderer/scheduler advances no fire time.
    advance(s, 2);
    expect(m.health).toBe(3);
    expect(f.health).toBe(1);
    expect(high.health).toBe(3);
    expect(s.civilians.states[0].alive).toBe(false);
    expect(s.revision).toBeGreaterThan(revision);
    expect(s.snapshot().fires).toEqual(s.fires.patches);
    expect(s.snapshot().fires).not.toBe(s.fires.patches);
  } finally {
    s.dispose();
  }
});

it("removes burning wood through existing breakup and schedules loss-of-support collapse", () => {
  const wood: Entity = {
    id: 0,
    p: [3000, 12, 3000],
    s: [2, 2, 2],
    kind: "block",
    material: "wood",
    assembly: "fire-test",
    foundation: true,
    supports: [],
    variant: 0,
  };
  const stone: Entity = {
    ...wood,
    id: 1,
    p: [3000, 16, 3000],
    material: "stone",
    foundation: false,
    supports: [0],
  };
  const s = create([wood, stone]);
  try {
    s.fires.restore(fireState);
    advance(s, 5.4);
    expect(s.removed.has(0)).toBe(true);
    expect(s.removed.has(1)).toBe(false);
    expect(s.supportJobs.some((j) => j.name === "fire-test")).toBe(true);
    for (let i = 0; i < 20 && s.supportJobs.length; i++)
      s.processDestruction(50);
    expect(s.removed.has(1)).toBe(true);
  } finally {
    s.dispose();
  }
});

it("round-trips fire state through ordinary and incremental saves and accepts older saves", () => {
  const s = create();
  let restored: Simulation | undefined;
  try {
    s.fires.restore(fireState);
    advance(s, 2.5);
    const save = s.save();
    expect(compatible(save, manifest.version, manifest.seed)).toBe(true);
    const capture = s.captureSave();
    let next = capture.next();
    while (!next.done) next = capture.next();
    expect(next.value.nuclearFire).toEqual(save.nuclearFire);
    restored = new Simulation(s.world, flat, () => {}, save);
    expect(restored.fires.save()).toEqual(save.nuclearFire);
    const old = { ...save, nuclearFire: undefined };
    expect(compatible(old, manifest.version, manifest.seed)).toBe(true);
    for (const nuclearFire of [
      { ...save.nuclearFire!, clock: NaN },
      {
        ...save.nuclearFire!,
        patches: [{ ...fireState.patches[0], radius: 999 }],
      },
      {
        ...save.nuclearFire!,
        patches: [fireState.patches[0], fireState.patches[0]],
      },
      { ...save.nuclearFire!, exposures: [[0, 2, 999]] },
    ])
      expect(
        compatible({ ...save, nuclearFire }, manifest.version, manifest.seed),
      ).toBe(false);
  } finally {
    restored?.dispose();
    s.dispose();
  }
});

it("creates ground fires from nuclear strikes but leaves high airbursts without ground hazards", () => {
  const s = create();
  try {
    s.detonateNuke([3000, 500, 3000], "valley");
    expect(s.fires.patches).toHaveLength(0);
    s.detonateNuke([3000, 10, 3000], "valley");
    expect(s.fires.patches.length).toBeGreaterThan(0);
  } finally {
    s.dispose();
    expect(s.fires.patches).toHaveLength(0);
  }
});
