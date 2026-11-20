import { beforeAll, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { Simulation, initializePhysics } from "../src/sim/simulation";
import { CONFIG, TRUCK, VEHICLE } from "../src/config";
import type { Entity, InputState, WorldData } from "../src/types";

const world = JSON.parse(
  readFileSync("public/world.json", "utf8"),
) as WorldData;
beforeAll(initializePhysics);

const idle: InputState = {
  x: 0,
  y: 0,
  throttle: 0,
  bank: 0,
  boost: false,
  fire: false,
};
const GROUND = 10;
const tree = (id: number, x: number, z: number, s: Entity["s"]): Entity => ({
  id,
  kind: "tree",
  p: [x, GROUND + s[1], z],
  s,
  material: "wood",
  assembly: "",
  foundation: true,
  supports: [],
  variant: 0,
});
const block = (id: number, x: number, z: number): Entity => ({
  id,
  kind: "block",
  p: [x, 40, z],
  s: [20, 30, 20],
  material: "stone",
  assembly: "",
  foundation: true,
  supports: [],
  variant: 0,
});
function makeSim(entities: Entity[], events: { type: string }[] = []) {
  const heights = new Float32Array(CONFIG.grid * CONFIG.grid).fill(GROUND);
  const sim = new Simulation(
    { ...world, entities, civilians: [], rivers: [], portal: undefined },
    heights,
    (e: { type: string }) => events.push(e),
    undefined,
    true,
  );
  sim.setMonsterCount(0);
  return sim;
}
function land(sim: Simulation) {
  sim.plane.p = [3000, 300, 3000];
  expect(sim.setVehicleMode("ground")).toBe(true);
  sim.input = idle;
  for (let i = 0; i < 900; i++) sim.step();
  expect(sim.plane.chute).toBe(false);
  sim.plane.shield = 0;
}
const run = (sim: Simulation, input: Partial<InputState>, steps: number) => {
  sim.input = { ...idle, ...input };
  for (let i = 0; i < steps && sim.plane.crashed <= 0; i++) sim.step();
};

it("boosts through a short tree without crashing", () => {
  const sim = makeSim([tree(0, 3000, 3150, [2, 1.2, 2])]);
  try {
    land(sim);
    sim.plane.yaw = 0;
    run(sim, { throttle: 1, boost: true }, 300);
    expect(sim.plane.crashed).toBe(0);
    expect(sim["removed"].has(0)).toBe(true);
    expect(sim.plane.p[2]).toBeGreaterThan(3150);
  } finally {
    sim.dispose();
  }
});

it("slides sideways into a tree without crashing", () => {
  const sim = makeSim([tree(0, 3040, 3000, [3, 12, 3])]);
  try {
    land(sim);
    sim.plane.yaw = 0;
    for (let i = 0; i < 40 && sim.plane.crashed <= 0; i++) {
      // Hold a fast sideways slide toward the trunk.
      sim.plane.v = [110, sim.plane.v[1], 0];
      run(sim, {}, 1);
    }
    expect(sim.plane.crashed).toBe(0);
    expect(sim["removed"].has(0)).toBe(true);
  } finally {
    sim.dispose();
  }
});

it("starts every life at full health", () => {
  const sim = makeSim([]);
  try {
    land(sim);
    expect(sim.plane.health).toBe(VEHICLE.maxHealth);
  } finally {
    sim.dispose();
  }
});

it("survives a slow ram into a building, losing health", () => {
  const sim = makeSim([block(0, 3000, 3080)]);
  try {
    land(sim);
    sim.plane.yaw = 0;
    run(sim, { throttle: 1 }, 400);
    expect(sim.plane.crashed).toBe(0);
    expect(sim.plane.health!).toBeLessThan(VEHICLE.maxHealth);
    expect(sim.plane.health!).toBeGreaterThan(0);
  } finally {
    sim.dispose();
  }
});

it("refills health after a quiet spell", () => {
  const sim = makeSim([]);
  try {
    land(sim);
    sim.plane.health = 40;
    sim.plane.hurtAge = 0;
    run(sim, {}, Math.round(VEHICLE.regenDelay * 60) - 10);
    expect(sim.plane.health).toBe(40);
    run(sim, {}, 120);
    expect(sim.plane.health!).toBeGreaterThan(55);
  } finally {
    sim.dispose();
  }
});

it("wrecks on a boosted ram, burns, and its tank cooks off", () => {
  const events: { type: string; kind?: string }[] = [];
  const sim = makeSim([block(0, 3000, 3200)], events);
  try {
    land(sim);
    sim.plane.yaw = 0;
    run(sim, { throttle: 1, boost: true }, 400);
    expect(sim.plane.crashed).toBeGreaterThan(0);
    expect(sim.plane.health).toBe(0);
    expect(sim.fires.patches.length).toBeGreaterThan(0);
    events.length = 0;
    sim.input = idle;
    for (let i = 0; i < Math.ceil(TRUCK.cookOffDelay * 60) + 2; i++) sim.step();
    expect(
      events.some((e) => e.type === "explosion" && e.kind === "fuel"),
    ).toBe(true);
  } finally {
    sim.dispose();
  }
});
