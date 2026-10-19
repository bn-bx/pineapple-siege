import RAPIER from "@dimforge/rapier3d-compat";
import { readFileSync } from "node:fs";
import { beforeAll, expect, it, vi } from "vitest";
import { CONFIG, HELL_LAVA_LEVEL } from "../src/config";
import { Simulation, initializePhysics } from "../src/sim/simulation";
import type { Entity, WorldData } from "../src/types";
const world: WorldData = JSON.parse(
  readFileSync("tests/fixtures/legacy-world/world.json", "utf8"),
);
const flat = new Float32Array(CONFIG.grid * CONFIG.grid);
beforeAll(initializePhysics);
const entity = (id: number, x: number): Entity => ({
  id,
  p: [x, 10, 1000],
  s: [2, 10, 2],
  kind: "block",
  material: "stone",
  assembly: "",
  foundation: true,
  supports: [],
  variant: 0,
});
function setup(
  entities: Entity[] = [],
  civilians: WorldData["civilians"] = [],
) {
  return new Simulation(
    { ...world, entities, civilians },
    flat,
    () => {},
    undefined,
    true,
  );
}
function activate(sim: Simulation, age = 2) {
  sim.gravityBombs.drop({ ...sim.plane, p: [1000, 13, 1000], v: [0, -60, 0] });
  (sim as any).updateGravityBombs(CONFIG.dt);
  expect(sim.gravityBombs.bombs[0].phase).toBe("pulling");
  sim.gravityBombs.bombs[0].age = age;
}
it("fragments nearest targets within one shared 16-operation budget across eight cores", () => {
  const sim = setup(
    Array.from({ length: 40 }, (_, i) => entity(i, 1020 + i * 2)),
  );
  try {
    for (let i = 0; i < 8; i++)
      sim.gravityBombs.drop({
        ...sim.plane,
        p: [1000, 13, 1000],
        v: [0, -60, 0],
      });
    // Initial 30m field misses these boxes vertically; full radius admits all targets.
    for (const bomb of sim.gravityBombs.bombs) {
      bomb.phase = "pulling";
      bomb.p = [1000, 35, 1000];
      bomb.age = 3.9;
    }
    const fragment = vi.spyOn(sim as any, "fragment");
    (sim as any).updateGravityBombs(CONFIG.dt);
    expect(fragment).toHaveBeenCalledTimes(16);
    expect([...sim.removed]).toEqual(Array.from({ length: 16 }, (_, i) => i));
    expect(sim.terrain.changed.size).toBe(0);
  } finally {
    sim.dispose();
  }
});
it("reactivates settled debris, pulls ballistic and sleeping physics bodies, and leaves the plane untouched", () => {
  const sim = setup();
  try {
    activate(sim);
    (sim as any).insertRuin({
      id: 90000,
      source: -1,
      p: [1040, 5, 1000],
      s: [1, 1, 1],
      q: [0, 0, 0, 1],
      material: "stone",
      kind: "chunk",
    });
    const body = sim.physics.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(1040, 5, 1000),
    );
    body.sleep();
    const plane = structuredClone(sim.plane);
    (sim as any).updateGravityBombs(CONFIG.dt);
    expect(sim.ballistic.get(90000)?.velocity[0]).toBeLessThan(0);
    expect(sim.ballistic.get(90000)?.velocity[1]).toBeGreaterThan(0);
    expect(body.linvel().x).toBeLessThan(0);
    expect(body.isSleeping()).toBe(false);
    expect(sim.plane).toEqual(plane);
    const debris = sim.ballistic.get(90000)!;
    debris.velocity = [-120, 0, 0];
    sim.gravityBombs.bombs[0].age = 4 - CONFIG.dt;
    (sim as any).updateGravityBombs(CONFIG.dt);
    expect(debris.velocity[0]).toBeGreaterThan(0);
    const released = [...debris.velocity];
    (sim as any).updateGravityBombs(CONFIG.dt);
    expect(debris.velocity).toEqual(released);
    expect(sim.snapshot().gravityBombs?.[0].phase).toBe("bursting");
    expect(sim.snapshot(true).gravityBombs).toHaveLength(1);
  } finally {
    sim.dispose();
  }
});
it("damages nearby actors and saves destruction without active bombs or terrain changes", () => {
  const sim = setup(
    [entity(0, 1020)],
    [{ id: 0, p: [1020, 0, 1000], home: "", settlement: world.sites[0].id }],
  );
  try {
    activate(sim);
    const monster = sim.monsters.states[0];
    monster.p = [1020, 0, 1000];
    monster.health = 3;
    monster.defeated = false;
    sim.gravityBombs.bombs[0].age = 4 - CONFIG.dt;
    (sim as any).updateGravityBombs(CONFIG.dt);
    expect(monster.defeated).toBe(true);
    expect(sim.civilians.states[0].alive).toBe(false);
    const save = sim.save();
    expect(save.removed).toContain(0);
    expect(save.terrain).toHaveLength(0);
    expect(save).not.toHaveProperty("gravityBombs");
    const restored = new Simulation(
      { ...world, entities: [entity(0, 1020)], civilians: [] },
      flat,
      () => {},
      save,
      true,
    );
    try {
      expect(restored.removed.has(0)).toBe(true);
      expect(restored.gravityBombs.snapshot()).toEqual([]);
    } finally {
      restored.dispose();
    }
  } finally {
    sim.dispose();
  }
});
it("activates against streamed scenery far from the aircraft and against water", () => {
  const sim = setup([entity(0, 8500)]);
  try {
    sim.plane.p = [1000, 500, 1000];
    sim.gravityBombs.drop({
      ...sim.plane,
      p: [8500, 40, 1000],
      v: [0, -1200, 0],
    });
    (sim as any).updateGravityBombs(CONFIG.dt);
    expect(sim.gravityBombs.bombs[0].phase).toBe("pulling");
    expect(sim.gravityBombs.bombs[0].p[1]).toBeGreaterThan(50);
    sim.gravityBombs.reset();
    vi.spyOn(sim.terrain, "surfaceHeight").mockReturnValue(20);
    sim.gravityBombs.drop({
      ...sim.plane,
      p: [2000, 40, 2000],
      v: [0, -1200, 0],
    });
    (sim as any).updateGravityBombs(CONFIG.dt);
    expect(sim.gravityBombs.bombs[0].phase).toBe("pulling");
    expect(sim.terrain.changed.size).toBe(0);
  } finally {
    sim.dispose();
  }
});

it("activates above the lava surface in the second realm without changing terrain", () => {
  const sim = new Simulation(
    { ...world, realm: "hell", entities: [], civilians: [] },
    flat,
    () => {},
    undefined,
    true,
  );
  try {
    sim.gravityBombs.drop({
      ...sim.plane,
      p: [1000, HELL_LAVA_LEVEL + 40, 1000],
      v: [0, -2400, 0],
    });
    (sim as any).updateGravityBombs(CONFIG.dt);
    expect(sim.gravityBombs.bombs[0].phase).toBe("pulling");
    expect(sim.gravityBombs.bombs[0].p[1]).toBe(HELL_LAVA_LEVEL + 3 + 35);
    expect(sim.terrain.changed.size).toBe(0);
  } finally {
    sim.dispose();
  }
});

it("keeps rapid fire bounded through a dense-scene pull and release cycle", () => {
  const entities = Array.from({ length: 512 }, (_, id) => ({
    ...entity(id, 940 + (id % 24) * 5),
    p: [940 + (id % 24) * 5, 10, 945 + Math.floor(id / 24) * 5] as Entity["p"],
  }));
  const sim = setup(entities);
  try {
    sim.setDestruction({ ...sim.destruction, noCooldown: true });
    sim.weapon = "gravityBomb";
    sim.plane.p = [1000, 110, 940];
    sim.plane.yaw = 0;
    sim.plane.pitch = 0;
    sim.plane.v = [0, 0, 60];
    const fragment = vi.spyOn(sim as any, "fragment");
    let maxActive = 0;
    for (let i = 0; i < 600; i++) {
      // Clear the bombing run before lifted wreckage can collide with the aircraft.
      if (i === 70) sim.plane.p = [3000, 500, 3000];
      sim.input.fire = i < 70;
      const before = fragment.mock.calls.length;
      sim.step();
      expect(fragment.mock.calls.length - before).toBeLessThanOrEqual(16);
      maxActive = Math.max(maxActive, sim.gravityBombs.bombs.length);
      expect(sim.gravityBombs.bombs.length).toBeLessThanOrEqual(8);
      for (const m of sim.ballistic.values()) {
        expect(m.velocity.every(Number.isFinite)).toBe(true);
        expect(m.view.p.every(Number.isFinite)).toBe(true);
      }
    }
    expect(maxActive).toBe(8);
    expect(sim.shots).toBe(8);
    expect(sim.removed.size).toBeGreaterThan(100);
    expect(sim.gravityBombs.snapshot()).toEqual([]);
    expect(sim.terrain.changed.size).toBe(0);
  } finally {
    sim.dispose();
  }
});
