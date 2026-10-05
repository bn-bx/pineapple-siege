import { CHUNKS } from "../src/config";
import { CONFIG } from "../src/config";
import { beforeAll, describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { Terrain } from "../src/sim/terrain";
import { Simulation, initializePhysics } from "../src/sim/simulation";
import type { WorldData } from "../src/types";
const world = JSON.parse(
  readFileSync("tests/fixtures/legacy-world/world.json", "utf8"),
) as WorldData;
const bytes = readFileSync("tests/fixtures/legacy-world/world.bin");
const base = new Float32Array(
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
);
beforeAll(async () => {
  await initializePhysics();
}, 30000);
describe("terrain authority", () => {
  it("edits shared chunk edges and clamps repeated damage to bedrock", () => {
    const t = new Terrain(base),
      x = 1088,
      z = 1024,
      i = (z / 2) * CONFIG.grid + x / 2;
    const patch = t.crater(x, z);
    expect(patch.chunks.length).toBeGreaterThanOrEqual(4);
    expect(t.sample(x, z)).toBeCloseTo(base[i] - 5, 3);
    for (let n = 0; n < 20; n++) t.crater(x, z);
    expect(t.sample(x, z)).toBeCloseTo(base[i] - CONFIG.bedrock, 3);
    expect([...t.changed.values()].every(Number.isFinite)).toBe(true);
  });
  it("floods connected river edits but not isolated craters", () => {
    const t = new Terrain(base);
    t.crater(1118, 1044, 12, 30);
    t.floodChanged(new Uint32Array([...t.changed.keys()]));
    expect(t.water(1118, 1044)).toBe(false);
    expect(t.water(1030, 988)).toBe(true);
  });
});
describe("destruction authority", () => {
  it("breaks real colliders, collapses unsupported masonry and bounds active bodies", () => {
    const messages: any[] = [];
    const sim = new Simulation(world, base, (m) => messages.push(m));
    const tower = world.entities.filter((e) => e.assembly === "tower--1--1");
    const p: [number, number, number] = [
      world.landmarks.towers[0][0],
      11,
      world.landmarks.towers[0][2],
    ];
    sim.explode(p);
    const removed = tower.filter((e) => sim.removed.has(e.id));
    expect(removed.length).toBeGreaterThan(tower.length * 0.7);
    expect(removed.some((e) => e.p[1] > 25)).toBe(true);
    for (const e of removed) expect(sim.entityColliders.has(e.id)).toBe(false);
    for (let n = 0; n < 20; n++)
      sim.explode([
        1118 + ((n % 3) - 1) * 15,
        10,
        1044 + Math.floor(n / 3) * 5,
      ]);
    expect(sim.moving.size).toBeLessThanOrEqual(256);
    expect(sim.terrain.changed.size).toBeGreaterThan(0);
    expect(messages.some((m) => m.kind === "collapse")).toBe(true);
    sim.dispose();
  }, 30000);
  it("clears wreckage and round trips persistent terrain damage", () => {
    const sim = new Simulation(world, base, () => {});
    sim.explode([
      world.landmarks.towers[0][0],
      10,
      world.landmarks.towers[0][2],
    ]);
    sim.plane.p = [900, 300, 900];
    // Faster wreckage can trigger delayed neighboring collapses; allow those fragments to settle too.
    for (let i = 0; i < 1800; i++) {
      sim.plane.p = [900, 450, 700];
      sim.step();
    }
    const save = sim.save();
    expect(sim.moving.size).toBeLessThan(30);
    expect(save.ruins).toHaveLength(0);
    const other = new Simulation(world, base, () => {}, save);
    expect(other.removed.size).toBe(sim.removed.size);
    expect(
      other.terrain.sample(
        world.landmarks.towers[0][0],
        world.landmarks.towers[0][2],
      ),
    ).toBeCloseTo(
      sim.terrain.sample(
        world.landmarks.towers[0][0],
        world.landmarks.towers[0][2],
      ),
      5,
    );
    expect(other.ruins.size).toBe(save.ruins.length);
    sim.dispose();
    other.dispose();
  }, 30000);
});
describe("flight and collision", () => {
  it("matches rendered terrain triangles with rigid-body terrain ray hits", () => {
    const sim = new Simulation(world, base, () => {});
    sim.plane.p = [978, 200, 840];
    (sim as any).ensureTerrain();
    sim.physics.step();
    for (const [x, z] of [
      [978, 840],
      [970.7, 847.3],
      [984.2, 854.9],
    ]) {
      const R = sim.physics;
      const hit = R.castRay(
        {
          origin: { x, y: 200, z },
          dir: { x: 0, y: -1, z: 0 },
          pointAt(t: number) {
            return { x, y: 200 - t, z };
          },
        } as any,
        300,
        true,
      );
      expect(hit).not.toBeNull();
      expect(200 - hit!.timeOfImpact).toBeCloseTo(sim.terrain.sample(x, z), 3);
    }
    sim.dispose();
  });
  it("sweeps aircraft into thin walls and respawns without restoring damage", () => {
    const sim = new Simulation(world, base, () => {});
    sim.plane.p = [world.castle[0] - 45, 18, world.castleBounds.min[1] - 15];
    sim.plane.yaw = 0;
    sim.plane.pitch = 0;
    sim.plane.speed = 120;
    sim.input.boost = true;
    for (let n = 0; n < 20 && sim.plane.crashed === 0; n++) sim.step();
    expect(sim.plane.crashed).toBeGreaterThan(0);
    const damage = sim.removed.size;
    expect(damage).toBeGreaterThan(0);
    sim.respawn();
    expect(sim.plane.crashed).toBe(0);
    expect(sim.removed.size).toBe(damage);
    expect(sim.plane.p[1]).toBeGreaterThan(
      sim.terrain.sample(
        ...([sim.plane.p[0], sim.plane.p[2]] as [number, number]),
      ) + 50,
    );
    sim.dispose();
  });
  it("real fired projectiles strike masonry and topple trees", () => {
    const sim = new Simulation(world, base, () => {});
    sim.plane.p = [world.castle[0] - 105, 75, world.castleBounds.min[1] - 95];
    sim.plane.yaw = 0;
    sim.plane.pitch = -0.31;
    sim.input.fire = true;
    for (let n = 0; n < 150; n++) sim.step();
    expect(sim.shots).toBeGreaterThanOrEqual(1);
    expect(sim.removed.size).toBeGreaterThan(0);
    const tree = world.entities.find(
      (e) => e.kind === "tree" && !sim.removed.has(e.id),
    )!;
    sim.explode([tree.p[0], tree.p[1] - tree.s[1] + 1, tree.p[2]]);
    expect(sim.removed.has(tree.id)).toBe(true);
    expect([...sim.moving.values()].some((m) => m.view.kind === "tree")).toBe(
      true,
    );
    expect(sim.moving.size).toBeLessThanOrEqual(256);
    sim.dispose();
  }, 20000);
});

it("preserves supported neighbors, breaches bridge collision, and clears old wreckage", () => {
  const sim = new Simulation(world, base, () => {});
  const opposite = world.entities.filter((e) => e.assembly === "tower-1-1");
  sim.explode([world.landmarks.towers[0][0], 11, world.landmarks.towers[0][2]]);
  expect(opposite.length).toBeGreaterThan(0);
  expect(opposite.every((e) => !sim.removed.has(e.id))).toBe(true);
  const bridge = world.entities.filter((e) => e.assembly === "bridge");
  sim.explode([world.bridge[0], 2, world.bridge[1]]);
  const breached = bridge.filter((e) => sim.removed.has(e.id));
  expect(breached.length).toBeGreaterThan(5);
  expect(breached.every((e) => !sim.entityColliders.has(e.id))).toBe(true);
  sim.plane.p = [900, 300, 900];
  // Faster wreckage can trigger delayed neighboring collapses; allow those fragments to settle too.
  for (let i = 0; i < 1800; i++) {
    sim.plane.p = [900, 450, 700];
    sim.step();
  }
  expect(sim.ruins.size).toBe(0);
  expect(sim.snapshot().bodies).toHaveLength(0);
  sim.dispose();
}, 30000);

it("preserves airborne tree transforms when the debris budget demotes them", () => {
  const sim = new Simulation(world, base, () => {});
  const tree = world.entities.find((e) => e.kind === "tree")!;
  sim.explode([tree.p[0], tree.p[1] - tree.s[1] + 1, tree.p[2]]);
  const moving = [...sim.moving.values()].find(
    (m) => m.view.source === tree.id && m.view.kind === "tree",
  )!;
  expect(moving).toBeDefined();
  const p = [...moving.view.p],
    q = [...moving.view.q];
  const v = moving.body.linvel();
  (sim as any).settle(moving, true);
  const debris = sim.ballistic.get(moving.view.id)!;
  expect(sim.ruins.has(moving.view.id)).toBe(false);
  for (let i = 0; i < 3; i++) expect(debris.view.p[i]).toBeCloseTo(p[i], 3);
  for (let i = 0; i < 4; i++) expect(debris.view.q[i]).toBeCloseTo(q[i], 5);
  expect(debris.velocity).toEqual([v.x, v.y, v.z]);
  sim.dispose();
});
