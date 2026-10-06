import { it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { SparseIndices } from "../src/sim/sparse-indices";
import { AutoQuality } from "../src/render/auto-quality";
import { packMotion, bindMotion, motionFrame } from "../src/sim/motion-buffer";
import { packBodies } from "../src/sim/body-buffer";
import { Simulation, initializePhysics } from "../src/sim/simulation";
import type { SimulationSnapshot, WorldData } from "../src/types";
import { SnapshotTimeline } from "../src/render/snapshot-timeline";
beforeAll(initializePhysics);
it("does not scan wreckage when no laser is burning", () => {
  const sim = Object.create(Simulation.prototype) as any;
  sim.lasers = [];
  sim.burnZones = [];
  sim.burnCells = new Map();
  // Throwing iterators represent large debris collections that must stay untouched.
  const untouched = {
    values() {
      throw Error("inactive laser scanned wreckage");
    },
  };
  sim.ruins = sim.moving = sim.ballistic = untouched;
  sim.clearActiveLasers();
  sim.updateLasers(1 / 60);
  sim.lasers.push({ id: 1, p: [100, 10, 100], age: 0, phase: "charging" });
  sim.tick = 6;
  sim.updateLasers(1 / 60);
  expect(sim.lasers[0].phase).toBe("charging");
  expect(sim.burnCells.size).toBe(0);
});
const world: WorldData = JSON.parse(readFileSync("public/world.json", "utf8"));
const bytes = readFileSync("public/world.bin");
const base = new Float32Array(
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
);
it("retains an isolated worst worker-step breakdown without adding save or motion data", () => {
  const sim = new Simulation(
    { ...world, entities: [], civilians: [] },
    base,
    () => {},
    undefined,
    true,
  );
  try {
    sim.step();
    const first = sim.snapshot(true);
    expect(first.stats.worstStep?.tick).toBe(1);
    expect(first.stats.worstStep?.ms).toBeGreaterThanOrEqual(0);
    expect(first.stats.stageMS?.projectiles).toBeGreaterThanOrEqual(0);
    first.stats.worstStep!.stages.projectiles = -123;
    expect(
      sim.snapshot(true).stats.worstStep?.stages.projectiles,
    ).toBeGreaterThanOrEqual(0);
    expect(first.packedMotion).toBeDefined();
    expect(sim.save()).not.toHaveProperty("worstStep");
  } finally {
    sim.dispose();
  }
});
it("stores dry cells compactly and enumerates bit 31 without duplicating indices", () => {
  const indices = new SparseIndices();
  for (const i of [0, 31, 32, 1023, 1024, 31, 9440000]) indices.add(i);
  expect([...indices]).toEqual([0, 31, 32, 1023, 1024, 9440000]);
  expect(indices.size).toBe(6);
  expect(indices.has(31)).toBe(true);
  indices.clear();
  expect([...indices]).toEqual([]);
});
it("reacts within half a second and requires 15 seconds of headroom to recover", () => {
  const auto = new AutoQuality();
  const load = { frameMS: 22, cpuMS: 8, gpuMS: 20, workerMS: 4, lagMS: 0 };
  auto.update(100, load);
  expect(auto.update(550, load)).toBe(true);
  expect(auto.level).toBe(2);
  const idle = { frameMS: 16.67, cpuMS: 2, gpuMS: 7, workerMS: 2, lagMS: 0 };
  auto.update(600, idle);
  expect(auto.update(15599, idle)).toBe(false);
  expect(auto.update(15600, idle)).toBe(true);
  expect(auto.height).toBe(900);
});
it("requires fresh active headroom and overload intervals after a pause", () => {
  const auto = new AutoQuality();
  const idle = { frameMS: 16.67, cpuMS: 2, gpuMS: 7, workerMS: 2, lagMS: 0 };
  auto.update(100, idle);
  auto.resume();
  expect(auto.update(20000, idle)).toBe(false);
  expect(auto.update(34999, idle)).toBe(false);
  expect(auto.update(35000, idle)).toBe(true);
  const load = { frameMS: 22, cpuMS: 8, gpuMS: 20, workerMS: 4, lagMS: 0 };
  auto.update(40000, load);
  auto.resume();
  expect(auto.update(100000, load)).toBe(false);
  expect(auto.update(100449, load)).toBe(false);
  expect(auto.update(100450, load)).toBe(true);
});
it("reduces quality for recurring GPU spikes without reacting to one isolated pass", () => {
  const idle = { frameMS: 16.67, cpuMS: 2, gpuMS: 9, workerMS: 2, lagMS: 0 };
  const spike = { ...idle, gpuMS: 16 };
  const isolated = new AutoQuality(2);
  isolated.update(100, idle);
  isolated.update(116, spike);
  for (let now = 132; now < 2000; now += 16) isolated.update(now, idle);
  expect(isolated.level).toBe(2);
  const recurring = new AutoQuality(2);
  for (let i = 0; i < 120; i++)
    recurring.update(100 + i * 16, i % 2 ? idle : spike);
  expect(recurring.level).toBeGreaterThan(2);
  recurring.resume();
  const pausedLevel = recurring.level;
  expect(recurring.update(100000, spike)).toBe(false);
  expect(recurring.level).toBe(pausedLevel);
});
it("borrows packed transforms, reuses record identity, and preserves all actor flags", () => {
  const frame = motionFrame();
  const body = {
    id: 123456,
    source: 5,
    p: [1, 2, 3],
    q: [0, 0, 0, 1],
    s: [2, 3, 4],
    material: "stone",
    kind: "chunk",
  } as const;
  const civilian = {
    id: 0,
    p: [4, 5, 6],
    yaw: 0.2,
    alive: false,
    mood: "sad",
    phase: 3,
  } as any;
  const monster = {
    id: 0,
    p: [7, 8, 9],
    yaw: 0.4,
    health: 2,
    defeated: false,
    phase: 4,
    windup: 0.5,
    stagger: 0.6,
  } as any;
  const packet = {
    packedBodies: packBodies([body as any], 1),
    packedMotion: packMotion([civilian], [monster], [], []),
  } as SimulationSnapshot;
  bindMotion(packet, frame);
  expect([...packet.bodies[0].p]).toEqual([1, 2, 3]);
  expect(packet.bodies[0].id).toBe(123456);
  expect(packet.civilians[0].mood).toBe("sad");
  expect(packet.monsters[0].windup).toBe(0.5);
  const old = packet.bodies[0];
  const next = {
    packedBodies: packBodies([{ ...body, p: [10, 20, 30] } as any], 1),
    packedMotion: packMotion([], [], [], [], packet.packedMotion!.buffer),
  } as SimulationSnapshot;
  bindMotion(next, frame);
  expect(next.bodies[0]).toBe(old);
  expect([...next.bodies[0].p]).toEqual([10, 20, 30]);
  expect(next.civilians).toEqual([]);
});
it("retires every obsolete packet including paused states and replacements", () => {
  const retired: number[] = [];
  const timeline = new SnapshotTimeline<{ time: number; id: number }>(
    0.1,
    (s) => retired.push(s.id),
  );
  timeline.receive({ time: 1, id: 1 }, 0);
  timeline.receive({ time: 1, id: 2 }, 1);
  timeline.receive({ time: 2, id: 3 }, 2);
  timeline.sample(3, false);
  expect(retired).toEqual([1, 2]);
  timeline.reset();
  expect(retired).toEqual([1, 2, 3]);
});
it("journals terrain and dry changes until commit without rescanning pristine grids", () => {
  const sim = new Simulation(
    { ...world, entities: [], civilians: [] },
    base,
    () => {},
    undefined,
    true,
  );
  const capture = () => {
    const g = sim.captureSave();
    let n = g.next();
    while (!n.done) n = g.next();
    return n.value;
  };
  try {
    const first = capture();
    expect(first.sections).toEqual([]);
    sim.acknowledgeSave(first.capture!);
    sim.terrain.crater(world.castle[0], world.castle[2], 8, 2);
    const dirty = capture();
    expect(dirty.sections!.some((s) => s.terrain.length)).toBe(true);
    const retry = capture();
    expect(retry.sections).toEqual(dirty.sections);
    sim.acknowledgeSave(retry.capture!);
    expect(capture().sections).toEqual([]);
  } finally {
    sim.dispose();
  }
});
it("keeps exact global shape queries when static colliders are outside the resident set", () => {
  const e = {
    id: 0,
    kind: "block",
    p: [200, 100, 200],
    s: [5, 10, 5],
    material: "stone",
    assembly: "test",
    foundation: true,
    supports: [],
    variant: 0,
  } as any;
  const sim = new Simulation(
    {
      ...world,
      entities: [e, { ...e, id: 1, p: [200, 100, 240] }],
      civilians: [],
    },
    base,
    () => {},
    undefined,
    true,
  );
  try {
    expect(sim.entityColliders.has(0)).toBe(false);
    // Same broad-phase cells, but outside the swept capsule's lateral bounds.
    (sim as any).staticShapes.set(1, {
      castShape() {
        throw Error("off-axis exact cast");
      },
    });
    const hit = (sim as any).sweep([180, 100, 200], [220, 100, 200], 1);
    expect(hit).not.toBeNull();
    expect(hit[0]).toBeCloseTo(194, 2);
  } finally {
    sim.dispose();
  }
});
it("captures immutable laser jobs while later excavation advances", () => {
  const sim = new Simulation(
    { ...world, entities: [], civilians: [] },
    base,
    () => {},
    undefined,
    true,
  );
  try {
    sim.startLaser([world.castle[0], 100, world.castle[2]]);
    const strike = sim.lasers[0];
    (sim as any).scheduleLaser(strike, 0.25);
    const generator = sim.captureSave();
    generator.next();
    const before = [...sim.laserWork.values()][0].targets[0];
    (sim as any).scheduleLaser(strike, 1);
    expect(before.progress).toBe(0.25);
    let result = generator.next();
    while (!result.done) result = generator.next();
    expect(result.value.laserWork[0].targets[0].progress).toBe(0.25);
  } finally {
    sim.dispose();
  }
});
it("leaves packed body transforms in their buffers on the rendering path", () => {
  const frame = motionFrame();
  const packet = {
    packedBodies: packBodies(
      [
        {
          id: 1,
          source: 2,
          p: [1, 2, 3],
          q: [0, 0, 0, 1],
          s: [1, 1, 1],
          material: "stone",
          kind: "chunk",
        },
      ],
      1,
    ),
    packedMotion: packMotion([], [], [], []),
  } as SimulationSnapshot;
  bindMotion(packet, frame, false);
  expect(packet.bodies.length).toBe(1);
  expect(frame.bodyPool.length).toBe(0);
});
it("rejects resident collision searches above occupied cells and refreshes bounds for vertical movement", () => {
  const sim = new Simulation(
    { ...world, entities: [] },
    base,
    () => {},
    undefined,
    true,
  );
  try {
    const c = sim.civilians.states[0],
      air: [number, number, number] = [c.p[0], c.p[1] + 100, c.p[2]];
    expect(sim.civilians.maySweep(air, air, 1)).toBe(false);
    expect(sim.civilians.maySweep(c.p, c.p, 10)).toBe(true);
    c.p[1] += 100;
    (sim.civilians as any).reindex(c);
    expect(sim.civilians.maySweep(c.p, c.p, 1)).toBe(true);
  } finally {
    sim.dispose();
  }
});
it("bounds previous-body lookup storage by population rather than the largest identity", async () => {
  const { PackedBodyLookup } = await import("../src/sim/body-buffer");
  const lookup = new PackedBodyLookup(),
    body = {
      source: 2,
      p: [1, 2, 3],
      q: [0, 0, 0, 1],
      s: [1, 1, 1],
      material: "stone",
      kind: "chunk",
    } as any;
  lookup.build(
    packBodies(
      [
        { ...body, id: 1 },
        { ...body, id: 100000001 },
        { ...body, id: 300000002 },
      ],
      3,
    ),
  );
  expect(lookup.capacity).toBe(8);
  expect(lookup.get(100000001)).toBe(2);
  expect(lookup.get(300000002)).toBe(3);
  expect(lookup.get(9)).toBe(0);
  lookup.build(packBodies([{ ...body, id: 7 }], 1));
  expect(lookup.get(100000001)).toBe(0);
  expect(lookup.get(7)).toBe(1);
});

it("keeps captured destruction progress stable while immutable targets are shared", () => {
  const sim = new Simulation(
    { ...world, entities: [], civilians: [] },
    base,
    () => {},
    undefined,
    true,
  );
  try {
    const job = {
      p: [100, 30, 100] as [number, number, number],
      yield: "local" as const,
      phase: "terrain" as const,
      cursor: 0,
      chunks: Object.freeze([1, 2, 3]),
      entities: Object.freeze([4, 5]),
      assemblies: ["wall"],
      fragments: 0,
      profile: {
        damageRadius: 20,
        craterRadius: 10,
        depth: 2,
        cloudHeight: 20,
        bodyLimit: 8,
        scatterMin: 1,
        scatterMax: 3,
        ejecta: 4,
      },
      seed: 1,
      excavation: 1,
      supportQueue: [[4, 5]],
    };
    sim.pendingJobs.push(job);
    const generator = sim.captureSave();
    generator.next();
    job.cursor = 2;
    job.assemblies.push("tower");
    job.supportQueue[0].pop();
    let result = generator.next();
    while (!result.done) result = generator.next();
    const saved = structuredClone(result.value).pendingJobs[0];
    expect(saved.cursor).toBe(0);
    expect(saved.chunks).toEqual([1, 2, 3]);
    expect(saved.entities).toEqual([4, 5]);
    expect(saved.assemblies).toEqual(["wall"]);
    expect(saved.supportQueue).toEqual([[4, 5]]);
  } finally {
    sim.dispose();
  }
});
