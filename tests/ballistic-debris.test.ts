import { CONFIG } from "../src/config";
import { beforeAll, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { Simulation, initializePhysics } from "../src/sim/simulation";
import {
  advanceDebris,
  orientedSize,
  type BallisticDebris,
} from "../src/sim/ballistic-debris";
import { Terrain } from "../src/sim/terrain";
import { unpackBodies } from "../src/sim/body-buffer";
import { DEFAULT_DESTRUCTION } from "../src/destruction-settings";
import type { Entity, WorldData } from "../src/types";

beforeAll(initializePhysics);
const world: WorldData = JSON.parse(readFileSync("tests/fixtures/legacy-world/world.json", "utf8"));
const flat = new Float32Array(CONFIG.grid * CONFIG.grid);
const entity: Entity = {
  id: 0,
  kind: "block",
  p: [600, 30, 600],
  s: [2, 3, 4],
  material: "stone",
  assembly: "",
  foundation: true,
  supports: [],
  variant: 0,
};
function debris(): BallisticDebris {
  return {
    view: {
      ...entity,
      id: 100000,
      source: 0,
      kind: "chunk",
      q: [0, 0, 0, 1],
      p: [...entity.p],
      s: [...entity.s],
    },
    velocity: [80, 60, 0],
    angular: [1, 2, 3],
    grounded: 0,
  };
}

it("flies continuously, tumbles, bounces and only settles after touching ground", () => {
  const m = debris(),
    terrain = new Terrain(flat);
  const start = [...m.view.p];
  let landed = false,
    bounced = false;
  for (let i = 0; i < 1200 && !landed; i++) {
    const before = [...m.view.p],
      falling = m.velocity[1] < -10;
    landed = advanceDebris(m, terrain, 1 / 60);
    expect(Math.hypot(...m.view.p.map((v, k) => v - before[k]))).toBeLessThan(
      4,
    );
    expect(m.view.p[1]).toBeGreaterThanOrEqual(
      orientedSize(m.view.s, m.view.q)[1] - 1e-6,
    );
    if (falling && m.velocity[1] > 0) bounced = true;
    if (landed)
      expect(m.view.p[1]).toBeCloseTo(orientedSize(m.view.s, m.view.q)[1]);
  }
  expect(landed).toBe(true);
  expect(bounced).toBe(true);
  expect(m.view.p[0] - start[0]).toBeGreaterThan(350);
  expect(Math.hypot(...m.view.q)).toBeCloseTo(1);
});

it("sweeps fast debris against a narrow terrain ridge", () => {
  const heights = flat.slice();
  for (let z = 0; z < CONFIG.grid; z++) heights[z * CONFIG.grid + 305] = 80;
  const m = debris();
  m.view.p = [608, 20, 600];
  m.velocity = [600, -5, 0];
  advanceDebris(m, new Terrain(heights), 1 / 60);
  expect(m.view.p[0]).toBeLessThan(610);
  expect(m.velocity[0]).toBeLessThan(400);
});

it("shows every overflow source at launch and retains it in packed snapshots and saves", () => {
  const entities = Array.from(
    { length: 100 },
    (_, id): Entity => ({
      ...entity,
      id,
      p: [600 + (id % 10) * 5, 30, 600 + Math.floor(id / 10) * 5],
    }),
  );
  const sim = new Simulation({ ...world, entities }, flat, () => {});
  try {
    sim.plane.p = [1000, 400, 1000];
    sim.setDestruction({
      ...DEFAULT_DESTRUCTION,
      bodies: 0,
      fragments: 0,
      rubble: 4,
    });
    sim.detonateNuke([620, 30, 620], "castle");
    while (sim.pendingJobs.length) sim.processDestruction(50);
    expect(sim.removed.size).toBe(100);
    const views = sim.snapshot().bodies;
    for (const e of entities)
      expect(views.some((b) => b.source === e.id)).toBe(true);
    expect(sim.ballistic.size).toBeGreaterThan(60);
    for (const m of sim.ballistic.values())
      expect(m.view.p).toEqual(entities[m.view.source].p);
    const unpacked = unpackBodies(sim.snapshot(true).packedBodies!);
    expect(unpacked.map((b) => [b.id, b.source])).toEqual(
      views.map((b) => [b.id, b.source]),
    );
    for (let i = 0; i < views.length; i++)
      for (const key of ["p", "q", "s"] as const)
        for (let k = 0; k < views[i][key].length; k++)
          expect(unpacked[i][key][k]).toBeCloseTo(views[i][key][k], 3);
    const positions = views.map((b) => [...b.p]);
    const saved = sim.save();
    for (const e of entities)
      expect(saved.ruins.some((r) => r.source === e.id)).toBe(true);
    expect(sim.snapshot().bodies.map((b) => b.p)).toEqual(positions);
    sim.step();
    expect([...sim.ballistic.values()].some((m) => m.view.p[1] > 30)).toBe(
      true,
    );
  } finally {
    sim.dispose();
  }
});

it("demotes an airborne body without snapping and lets it land at its actual endpoint", () => {
  const sim = new Simulation({ ...world, entities: [] }, flat, () => {});
  try {
    const id = (sim as any).spawnBody(
      [600, 30, 600],
      [1, 1, 1],
      "stone",
      -1,
      "chunk",
      [80, 60, 0],
    );
    const body = sim.moving.get(id)!;
    (sim as any).settle(body, true);
    expect(sim.moving.has(id)).toBe(false);
    expect(sim.ruins.has(id)).toBe(false);
    expect(sim.ballistic.get(id)!.view.p).toEqual([600, 30, 600]);
    expect(sim.ballistic.get(id)!.velocity).toEqual([80, 60, 0]);
    for (let i = 0; i < 1000 && !sim.ruins.has(id); i++) sim.step();
    expect(sim.ruins.get(id)!.p[0]).toBeGreaterThan(950);
    expect(sim.ballistic.has(id)).toBe(false);
  } finally {
    sim.dispose();
  }
});

it("reblasts ballistic pieces and vaporizes their oriented footprints", () => {
  const sim = new Simulation({ ...world, entities: [] }, flat, () => {});
  try {
    (sim as any).addBallistic(debris().view, [0, -10, 0], [0, 0, 0]);
    (sim as any).shoveWreckage([590, 30, 600], 50, 100, { n: 0, limit: 0 });
    expect(sim.ballistic.get(100000)!.velocity[0]).toBeGreaterThan(40);
    (sim as any).clearLaser([605, 0, 600], 4);
    expect(sim.ballistic.size).toBe(0);
    expect(sim.snapshot().bodies).toEqual([]);
  } finally {
    sim.dispose();
  }
});
