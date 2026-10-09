import { expect, it, vi } from "vitest";
import { CHUNKS, NUKE_PROFILES } from "../src/config";
import {
  NuclearFire,
  FIRE_LIMIT,
  type FireHost,
} from "../src/sim/nuclear-fire";
import type { Entity, FirePatch, NuclearFireState } from "../src/types";

const patch = (id = 1, x = 100): FirePatch => ({
  id,
  p: [x, 0, 100],
  radius: 12,
  height: 8,
  age: 0,
  seed: id,
});
const state = (patches = [patch()]): NuclearFireState => ({
  patches,
  clock: 0,
  creatureClock: 0,
  exposures: [],
});
function host(entities: Entity[] = []): FireHost {
  return {
    ground: () => 0,
    water: () => false,
    ids: () => entities.map((e) => e.id),
    entity: (id) => entities.find((e) => e.id === id),
    removed: () => false,
    burn: vi.fn(),
    actors: vi.fn(),
  };
}
const entity = (id: number, material: Entity["material"]): Entity => ({
  id,
  kind: "block",
  material,
  p: [100, 2, 100],
  s: [1, 2, 1],
  assembly: "",
  foundation: false,
  supports: [],
  variant: 0,
});
function advance(fire: NuclearFire, h: FireHost, seconds: number) {
  for (let i = 0; i < Math.round(seconds * 60); i++) fire.step(1 / 60, h, 100);
}

it("places deterministic bounded dry patches and excludes high airbursts and water", () => {
  const a = new NuclearFire(),
    b = new NuclearFire(),
    h = host();
  a.ignite([2000, 0, 2000], NUKE_PROFILES.valley, 44, 1, h);
  b.ignite([2000, 0, 2000], NUKE_PROFILES.valley, 44, 1, h);
  expect(a.patches).toEqual(b.patches);
  expect(a.patches.length).toBeGreaterThan(8);
  expect(a.patches.length).toBeLessThanOrEqual(32);
  expect(
    a.patches.every(
      (f) =>
        f.radius >= 12 && f.radius <= 24 && f.height >= 6 && f.height <= 12,
    ),
  ).toBe(true);
  const empty = new NuclearFire();
  empty.ignite([2000, 400, 2000], NUKE_PROFILES.valley, 44, 0, h);
  empty.ignite([2000, 0, 2000], NUKE_PROFILES.valley, 44, 1, {
    ...h,
    water: () => true,
  });
  expect(empty.patches).toHaveLength(0);
});

it("merges overlapping repeated strikes, refreshes age, and replaces the oldest at the cap", () => {
  const fire = new NuclearFire(),
    h = host();
  fire.ignite([2000, 0, 2000], NUKE_PROFILES.valley, 44, 1, h);
  const count = fire.patches.length;
  advance(fire, h, 10);
  fire.ignite([2000, 0, 2000], NUKE_PROFILES.valley, 44, 1, h);
  expect(fire.patches).toHaveLength(count);
  expect(fire.patches.every((f) => f.age === 0)).toBe(true);
  const full = Array.from({ length: FIRE_LIMIT }, (_, id) => ({
    ...patch(id + 1, 100 + id * 40),
    age: id === 0 ? 50 : 1,
  }));
  fire.restore(state(full));
  fire.ignite([2000, 0, 4000], NUKE_PROFILES.valley, 100, 1, h);
  expect(fire.patches).toHaveLength(FIRE_LIMIT);
  expect(fire.patches.some((f) => f.id === 1)).toBe(false);
});

it("burns foliage and wood over time without stacking overlap or damaging nonflammable material", () => {
  const fire = new NuclearFire(),
    foliage = entity(1, "foliage"),
    wood = entity(2, "wood"),
    rock = entity(3, "rock"),
    stone = entity(4, "stone");
  const h = host([foliage, wood, rock, stone]),
    removed = new Set<number>();
  h.removed = (id) => removed.has(id);
  h.burn = vi.fn((e) => removed.add(e.id));
  fire.restore(state([patch(1), patch(2)]));
  advance(fire, h, 0.8);
  expect(h.burn).not.toHaveBeenCalled();
  advance(fire, h, 0.5);
  expect(removed.has(1)).toBe(true);
  expect(removed.has(2)).toBe(false);
  advance(fire, h, 4);
  expect(removed).toEqual(new Set([1, 2]));
  expect(h.burn).toHaveBeenCalledTimes(2);
});

it("freezes on pause, follows excavation, extinguishes in water and expires at 60 seconds", () => {
  const fire = new NuclearFire(),
    h = host();
  fire.restore(state());
  fire.step(0, h);
  expect(fire.patches[0].age).toBe(0);
  h.ground = () => -50;
  fire.step(0.5, h);
  expect(fire.patches[0].p[1]).toBe(-50);
  h.water = () => true;
  fire.step(0.1, h);
  expect(fire.patches).toHaveLength(0);
  h.water = () => false;
  fire.restore(state());
  advance(fire, h, 59.9);
  expect(fire.patches).toHaveLength(1);
  advance(fire, h, 0.1);
  expect(fire.patches).toHaveLength(0);
});

it("sweeps fast movement against finite flames while keeping high passes and outside segments safe", () => {
  const fire = new NuclearFire();
  fire.restore(state());
  expect(fire.sweep([0, 4, 100], [200, 4, 100])?.[0]).toBeCloseTo(85.8);
  expect(fire.sweep([0, 20, 100], [200, 20, 100])).toBe(null);
  expect(fire.sweep([100, 30, 100], [100, 0, 100])?.[1]).toBeCloseTo(10.2);
  expect(fire.sweep([0, 4, 0], [200, 4, 0])).toBe(null);
  expect(fire.sweep([100, 4, 100], [100, 4, 100])).toEqual([100, 4, 100]);
  expect(fire.touches([100, 20, 100], [1, 1, 1])).toBe(false);
});

it("preserves unfinished burn exposure and creature timing through save/reload", () => {
  const fire = new NuclearFire(),
    h = host([entity(1, "wood")]);
  fire.restore(state());
  advance(fire, h, 2.5);
  const saved = fire.save(),
    resumed = new NuclearFire();
  resumed.restore(saved);
  expect(resumed.save()).toEqual(saved);
  advance(resumed, h, 2.8);
  expect(h.burn).toHaveBeenCalled();
  resumed.reset();
  expect(resumed.patches).toHaveLength(0);
  resumed.restore();
  expect(resumed.patches).toHaveLength(0);
});

it("runs one creature damage tick per second and bounds structural work per frame", () => {
  const fire = new NuclearFire(),
    h = host();
  fire.restore(state([patch(1), patch(2)]));
  advance(fire, h, 2);
  expect(
    (h.actors as any).mock.calls.filter((call: any[]) => call[1]).length,
  ).toBe(2);
  const plants = Array.from({ length: 40 }, (_, i) => entity(i, "foliage"));
  const crowded = host(plants);
  fire.restore({
    ...state(),
    clock: 2,
    exposures: plants.map((e) => [e.id, 0.99, 1.9]),
  });
  fire.step(1 / 60, crowded, 100);
  expect(crowded.burn).toHaveBeenCalledTimes(4);
  const blocked = new NuclearFire();
  blocked.restore(state());
  const idleHost = host(plants);
  blocked.step(1 / 60, idleHost, 0);
  expect(idleHost.burn).not.toHaveBeenCalled();
});
