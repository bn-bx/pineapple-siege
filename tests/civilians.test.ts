import { describe, expect, it } from "vitest";
import { Civilians } from "../src/sim/civilians";
import type { Terrain } from "../src/sim/terrain";
import type {
  Entity,
  MonsterState,
  SaveSnapshot,
  Vec3,
  WorldData,
} from "../src/types";

const ground = { sample: () => 10, water: () => false } as unknown as Terrain;
const entities: Entity[] = Array.from({ length: 8 }, (_, id) => ({
  id,
  kind: "block",
  p: [id < 4 ? 3000 : 4800, 15, 3000],
  s: [1, 5, 1],
  material: "plaster",
  assembly: id < 4 ? "house-a" : "house-b",
  foundation: true,
  supports: [],
  variant: 0,
}));
const world = {
  size: 6144,
  castle: [1000, 10, 1000],
  entities,
  sites: [
    { id: "a", p: [3000, 10, 3000], assemblies: ["house-a"] },
    { id: "b", p: [4800, 10, 3000], assemblies: ["house-b"] },
  ],
  civilians: [
    { id: 0, home: "house-a", settlement: "a", p: [3020, 10, 3000] },
    { id: 1, home: "house-a", settlement: "a", p: [3025, 10, 3000] },
    { id: 2, home: "house-b", settlement: "b", p: [4820, 10, 3000] },
  ],
} as unknown as WorldData;
const monster = (id: number, p: Vec3): MonsterState => ({
  id,
  p,
  yaw: 0,
  health: 5,
  defeated: false,
  phase: 0,
  windup: 0,
  stagger: 0,
});
const events = (c: Civilians) => {
  const result: string[] = [];
  c.flush((p, kind) => result.push(`${p[0]}:${kind}`));
  return result;
};

describe("townspeople", () => {
  it("immediately wakes distant navigation when a threat arrives between ambient ticks", () => {
    const c = new Civilians(world, ground, new Set());
    c.step(1 / 60, [], [0, 400, 0], true, () => false);
    const before = [...c.states[0].p];
    c.step(
      1 / 60,
      [monster(0, [3100, 10, 3000])],
      [0, 400, 0],
      true,
      () => false,
    );
    expect(c.states[0].mood).toBe("flee");
    expect(c.states[0].p).not.toEqual(before);
  });
  it("celebrates local clears and the final defeat, but never loading or population baselines", () => {
    const c = new Civilians(world, ground, new Set());
    const a = monster(0, [3100, 10, 3000]),
      b = monster(1, [4900, 10, 3000]);
    c.rebaseline([a, b]);
    expect(events(c)).toEqual([]);
    c.defeats([a, b], [b]);
    expect(events(c)).toEqual(["3000:cheer"]);
    expect(c.settlements[0].cheer).toBe(6);
    expect(c.settlements[1].cheer).toBe(0);
    c.defeats([b], []);
    expect(events(c)).toEqual(["3000:cheer", "4800:cheer"]);
    c.rebaseline([]);
    expect(events(c)).toEqual([]);
  });
  it("lets destruction override a simultaneous celebration and mourns a ruined home persistently", () => {
    const removed = new Set<number>();
    const c = new Civilians(world, ground, removed);
    c.defeats([monster(0, [3100, 10, 3000])], []);
    removed.add(0);
    c.structureRemoved(entities[0]);
    expect(events(c)).toEqual(["3000:sad", "4800:cheer"]);
    c.step(11, [], [0, 400, 0], true, () => false);
    expect(c.states[0].mood).toBe("sad");
    expect(c.settlements[0].sad).toBe(0);
    c.defeats([monster(1, [3100, 10, 3000])], []);
    expect(events(c)).not.toContain("3000:cheer");
  });
  it("uses swept wreckage/aircraft bounds, mourns neighbors, and keeps casualties dead across saves", () => {
    const c = new Civilians(world, ground, new Set());
    c.sweep([3000, 12, 3000], [3022, 12, 3000], [1, 1, 1]);
    expect(c.states[0].alive).toBe(false);
    expect(c.states[1].alive).toBe(true);
    expect(c.states[2].alive).toBe(true);
    expect(events(c)).toEqual(["3000:sad"]);
    c.step(0.1, [], [0, 400, 0], true, () => false);
    expect(c.states[1].mood).toBe("sad");
    const save = {
      civilians: c.states,
      settlements: c.settlements,
    } as SaveSnapshot;
    const restored = new Civilians(world, ground, new Set(), save);
    expect(restored.states).toEqual(c.states);
    expect(restored.settlements).toEqual(c.settlements);
    expect(events(restored)).toEqual([]);
    expect(
      new Civilians(world, ground, new Set()).states.every((c) => c.alive),
    ).toBe(true);
  });
  it("kills residents in a laser column, keeps distant residents alive, and expires temporary mourning", () => {
    const c = new Civilians(world, ground, new Set());
    c.blast([3020, 1000, 3000], 2, true);
    expect(c.states[0].alive).toBe(false);
    expect(c.states[1].alive).toBe(true);
    c.step(5, [], [0, 400, 0], true, () => false);
    expect(c.states[1].mood).toBe("sad");
    c.step(6, [], [0, 400, 0], true, () => false);
    expect(c.states[1].mood).toBe("walk");
    expect(c.states[2].alive).toBe(true);
  });
  it("flees low aircraft while avoiding obstructed movement and water", () => {
    const c = new Civilians(world, ground, new Set());
    const start = [...c.states[0].p];
    c.step(0.1, [], [3020, 50, 2980], false, () => true);
    expect(c.states[0].mood).toBe("flee");
    expect(c.states[0].p).toEqual(start);
    c.step(0.1, [], [3020, 50, 2980], false, () => false);
    expect(c.states[0].p).not.toEqual(start);
    const watery = {
      sample: () => 10,
      water: (x: number) => x > 3010,
    } as unknown as Terrain;
    const drowned = new Civilians(world, watery, new Set());
    drowned.step(0.1, [], [0, 400, 0], true, () => false);
    expect(drowned.states[0].alive).toBe(false);
  });
});

it("retains casualties when new residents are appended to an existing world save", () => {
  const old = new Civilians(world, ground, new Set());
  old.states[0].alive = false;
  const expanded = {
    ...world,
    civilians: [
      ...world.civilians!,
      { id: 3, home: "house-a", settlement: "a", p: [3040, 10, 3000] as Vec3 },
    ],
  };
  const restored = new Civilians(expanded, ground, new Set(), {
    civilians: old.states,
    settlements: old.settlements,
  } as SaveSnapshot);
  expect(restored.states).toHaveLength(4);
  expect(restored.states[0].alive).toBe(false);
  expect(restored.states[3].alive).toBe(true);
});
it("finds threats on both sides of spatial cell boundaries and ignores distant monsters", () => {
  const c = new Civilians(world, ground, new Set());
  c.step(0.1, [monster(0, [3073, 10, 3000])], [0, 400, 0], true, () => true);
  expect(c.states[0].mood).toBe("flee");
  expect(c.states[2].mood).toBe("walk");
});

it("runs away from ordinary-altitude flybys, even while mourning", () => {
  const c = new Civilians(world, ground, new Set());
  c.structureRemoved(entities[0]);
  const start = [...c.states[0].p];
  c.step(0.1, [], [3020, 240, 2980], false, () => false);
  expect(c.states[0].mood).toBe("flee");
  expect(c.states[0].p).not.toEqual(start);
  expect(c.states[0].phase).toBeGreaterThan(0);
  c.step(0.1, [], [0, 400, 0], true, () => false);
  expect(c.states[0].mood).toBe("sad");
});
