import { beforeAll, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { Simulation, initializePhysics } from "../src/sim/simulation";
import { CONFIG } from "../src/config";
import type { Entity, WorldData, WorkerMessage } from "../src/types";
const world = JSON.parse(
  readFileSync("public/world.json", "utf8"),
) as WorldData;
const flat = new Float32Array(CONFIG.grid * CONFIG.grid).fill(10);
beforeAll(initializePhysics);
it.each(["terrain", "structure", "laser", "fire", "enemy", "fly"])(
  "keeps a %s wreck frozen after impact until explicit respawn while the world continues",
  (kind) => {
    const entities: Entity[] =
      kind === "structure"
        ? [
            {
              id: 0,
              kind: "block",
              p: [1000, 310, 1000],
              s: [20, 30, 20],
              material: "stone",
              assembly: "",
              foundation: true,
              supports: [],
              variant: 0,
            },
          ]
        : [];
    const events: WorkerMessage[] = [];
    const sim = new Simulation(
      { ...world, entities, civilians: [] },
      flat,
      (event) => events.push(event),
      undefined,
      true,
    );
    try {
      sim.setMonsterCount(0);
      sim.plane.p = [1000, kind === "terrain" ? 11 : 300, 1000];
      if (kind === "laser") {
        sim.startLaser([1000, 10, 1000]);
        sim.lasers[0].age = 4;
        sim.lasers[0].phase = "burning";
      }
      if (kind === "fire") {
        sim.plane.p[1] = 20;
        sim.fires.restore({
          patches: [
            {
              id: 1,
              p: [1000, 10, 1000],
              radius: 30,
              height: 30,
              age: 0,
              seed: 1,
            },
          ],
          clock: 0,
          creatureClock: 0,
          exposures: [],
        });
      }
      if (kind === "enemy") {
        sim.setMonsterCount(1);
        const monster = sim.monsters.states[0];
        monster.p = [1000, 10, 1000];
        monster.defeated = false;
        monster.stagger = 1;
        sim.plane.p[1] = 40;
      }
      if (kind === "fly") {
        (sim.flies as any).protection = 0;
        const fly = sim.flies.states[0];
        fly.p = [1000, 300, 1000];
        fly.v = [0, 0, 0];
        fly.mode = "recovery";
        fly.timer = 1;
      }
      for (let i = 0; i < 60 && sim.plane.crashed <= 0; i++) sim.step();
      expect(sim.plane.crashed).toBeGreaterThan(0);
      const airborne = !!sim.plane.falling;
      const hitPosition = [...sim.plane.p];
      const shotsBeforeDescent = sim.shots;
      sim.input = { x: 1, y: 1, throttle: 1, bank: 1, boost: true, fire: true };
      if (airborne) {
        expect(sim.crashFuel.snapshot()).toHaveLength(0);
        expect(
          events.some((e) => e.type === "explosion" && e.kind === "crash"),
        ).toBe(false);
        for (let i = 0; i < 720 && sim.plane.falling; i++) sim.step();
        expect(sim.plane.falling).toBe(false);
        expect(sim.plane.p).not.toEqual(hitPosition);
        expect(sim.plane.p[1]).toBeLessThan(hitPosition[1]);
        expect(sim.plane.roll).not.toBe(0);
        expect(sim.shots).toBe(shotsBeforeDescent);
      }
      expect(sim.crashFuel.snapshot()).toHaveLength(36);
      const death = [...sim.plane.p],
        time = sim.time,
        shots = sim.shots;
      sim.input = { x: 1, y: 1, throttle: 1, bank: 1, boost: true, fire: true };
      for (let i = 0; i < 240; i++) sim.step();
      expect(sim.plane.p).toEqual(death);
      expect(sim.plane.crashed).toBeGreaterThan(0);
      expect(sim.time).toBeGreaterThan(time + 3);
      expect(sim.shots).toBe(shots);
      expect(
        events.filter((e) => e.type === "explosion" && e.kind === "crash"),
      ).toHaveLength(1);
      sim.respawn();
      expect(sim.plane.crashed).toBe(0);
      expect(sim.plane.falling).toBe(false);
      expect(sim.input.fire).toBe(false);
      expect(sim.plane.p).not.toEqual(death);
    } finally {
      sim.dispose();
    }
  },
);
