import { beforeAll, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { Color } from "three";
import { Fragments } from "../src/render/fragments";
import { Simulation, initializePhysics } from "../src/sim/simulation";
import { DEFAULT_DESTRUCTION, nukeProfile } from "../src/destruction-settings";
import { unpackBodies } from "../src/sim/body-buffer";
import { bindMotion, motionFrame } from "../src/sim/motion-buffer";
import { Terrain } from "../src/sim/terrain";
import { terrainScarColor } from "../src/render/terrain-colors";
import type { BodyView, WorldData } from "../src/types";
const world: WorldData = JSON.parse(
  readFileSync("tests/fixtures/legacy-world/world.json", "utf8"),
);
const bytes = readFileSync("tests/fixtures/legacy-world/world.bin");
const base = new Float32Array(
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
);
beforeAll(initializePhysics);
function simulation() {
  const sim = new Simulation(
    { ...world, entities: [], civilians: [] },
    base,
    () => {},
  );
  sim.setMonsterCount(0);
  return sim;
}
const debris = (id: number): BodyView => ({
  id,
  source: -1,
  p: [600, 400, 600],
  s: [2, 2, 2],
  q: [0, 0, 0, 1],
  material: "stone",
  kind: "chunk",
});
function ticks(sim: Simulation, count: number) {
  for (let i = 0; i < count; i++) sim.step();
}
it("releases rigid and ballistic physics before shrinking, then removes every pose without permanent rubble", () => {
  const sim = simulation(),
    internal = sim as any;
  try {
    const rigid = internal.spawnBody(
      [600, 400, 600],
      [2, 2, 2],
      "stone",
      -1,
      "chunk",
      [0, 0, 0],
    );
    internal.addBallistic(debris(900001), [1, 1, 0], [0, 0, 0]);
    internal.insertRuin(debris(900002));
    ticks(sim, 350);
    expect(sim.moving.has(rigid)).toBe(true);
    expect(sim.snapshot().bodies).toHaveLength(3);
    ticks(sim, 40);
    expect(sim.moving.size).toBe(0);
    expect(sim.ballistic.size).toBe(0);
    const bodies = unpackBodies(sim.snapshot(true).packedBodies!);
    expect(bodies).toHaveLength(3);
    for (const body of bodies) expect(body.s[0]).toBeCloseTo(1, 3);
    for (const [i, body] of sim.snapshot().bodies.entries())
      for (let axis = 0; axis < 3; axis++)
        expect(body.s[axis]).toBeCloseTo(bodies[i].s[axis], 5);
    // Saving must retain authoritative dimensions rather than the display shrink.
    const capture = sim.captureSave();
    let result = capture.next();
    while (!result.done) result = capture.next();
    const saved = unpackBodies(result.value.moving!);
    expect(saved.every((b) => b.s[0] === 2)).toBe(true);
    ticks(sim, 31);
    expect(sim.snapshot().bodies).toHaveLength(0);
    expect(sim.snapshot(true).packedBodies!.count).toBe(0);
    expect(sim.ruins.size).toBe(0);
    expect(sim.physics.bodies.len()).toBe(0);
  } finally {
    sim.dispose();
  }
});
it("clears defeated pineapple bodies and packets without reviving them on reload", () => {
  const sim = simulation();
  try {
    const monster = sim.monsters.states[0];
    monster.defeated = true;
    monster.health = 0;
    monster.p = [600, 400, 600];
    sim.setMonsterCount(1);
    sim.monsterRagdolls.start(monster, [600, 400, 580]);
    expect(sim.monsterRagdolls.moving.size).toBe(7);
    ticks(sim, 390);
    expect(sim.monsterRagdolls.moving.size).toBe(0);
    expect(monster.cleanupScale).toBeCloseTo(0.5, 3);
    const packet = sim.snapshot(true);
    bindMotion(packet, motionFrame());
    expect(packet.monsters[0].cleanupScale).toBeCloseTo(0.5, 3);
    const duringFade = new Simulation(
      { ...world, entities: [], civilians: [] },
      base,
      () => {},
      sim.save(),
    );
    expect(duringFade.monsterRagdolls.moving.size).toBe(0);
    duringFade.dispose();
    ticks(sim, 31);
    expect(monster.cleared).toBe(true);
    expect(monster.defeated).toBe(true);
    expect(monster.fragments).toBeUndefined();
    const saved = sim.save();
    const restored = new Simulation(
      { ...world, entities: [], civilians: [] },
      base,
      () => {},
      saved,
    );
    expect(restored.monsterRagdolls.moving.size).toBe(0);
    expect(restored.monsters.states[0].cleared).toBe(true);
    const finalPacket = sim.snapshot(true);
    bindMotion(finalPacket, motionFrame());
    expect(finalPacket.monsters[0].cleared).toBe(true);
    expect(finalPacket.packedMotion!.fragmentCount).toBe(0);
    restored.dispose();
  } finally {
    sim.dispose();
  }
});
it("keeps cleanup permanent when destruction preferences change", () => {
  const sim = simulation();
  try {
    (sim as any).insertRuin(debris(900001));
    ticks(sim, 390);
    sim.setDestruction(DEFAULT_DESTRUCTION);
    ticks(sim, 31);
    expect(sim.snapshot().bodies).toHaveLength(0);
    expect(sim.ruins.size).toBe(0);
  } finally {
    sim.dispose();
  }
});
it("preserves cleanup deadlines across rigid-to-ballistic handoff", () => {
  const sim = simulation(),
    internal = sim as any;
  try {
    const id = internal.spawnBody(
      [600, 400, 600],
      [2, 2, 2],
      "stone",
      -1,
      "chunk",
      [0, 0, 0],
    );
    ticks(sim, 120);
    internal.settle(sim.moving.get(id), true);
    expect(sim.ballistic.has(id)).toBe(true);
    ticks(sim, 301);
    expect(sim.snapshot().bodies).toHaveLength(0);
  } finally {
    sim.dispose();
  }
});
it("enlarges nuke craters and chars their exposed terrain", () => {
  expect(nukeProfile("valley", DEFAULT_DESTRUCTION).craterRadius).toBe(240);
  const shallow = new Color(),
    deep = new Color();
  terrainScarColor(shallow, 100, 100, 20, 0.2, 0);
  terrainScarColor(deep, 100, 100, 20, 10, 0);
  expect(deep.r + deep.g + deep.b).toBeLessThan(
    (shallow.r + shallow.g + shallow.b) * 0.5,
  );
});

it("excavates a 50-meter valley crater across chunk edges and preserves depth on reload", () => {
  const terrain = new Terrain(base);
  const x = 1088,
    z = 1024;
  const original = terrain.sample(x, z);
  const profile = nukeProfile("valley", DEFAULT_DESTRUCTION);
  const patch = terrain.crater(x, z, profile.craterRadius, profile.depth);
  expect(patch.chunks.length).toBeGreaterThan(4);
  expect(terrain.sample(x, z)).toBeCloseTo(original - 50, 3);
  const restored = new Terrain(base);
  restored.restore([...terrain.changed]);
  expect(restored.sample(x, z)).toBeCloseTo(original - 50, 3);
});

it("gives cosmetic wreckage six seconds of motion and one second of shrinking", () => {
  const fragments = new Fragments(() => -10000);
  fragments.emit({
    type: "fragments",
    p: [0, 400, 0],
    origin: [0, 0, 0],
    material: "stone",
    count: 1,
    speed: 20,
    spread: 0,
    seed: 1,
  });
  for (let i = 0; i < 360; i++) fragments.update(1 / 60);
  expect(fragments.count).toBe(1);
  const position = Array.from(fragments.mesh.instanceMatrix.array).slice(
    12,
    15,
  );
  for (let i = 0; i < 30; i++) fragments.update(1 / 60);
  expect(Array.from(fragments.mesh.instanceMatrix.array).slice(12, 15)).toEqual(
    position,
  );
  for (let i = 0; i < 32; i++) fragments.update(1 / 60);
  expect(fragments.count).toBe(0);
  fragments.mesh.dispose();
  fragments.mesh.geometry.dispose();
  (fragments.mesh.material as any).dispose();
});
