import { readFileSync } from "node:fs";
import { Simulation, initializePhysics } from "../src/sim/simulation";
import { DEFAULT_DESTRUCTION } from "../src/destruction-settings";
import { unpackBodies } from "../src/sim/body-buffer";
import { Fragments } from "../src/render/fragments";
import { Terrain } from "../src/sim/terrain";
import {
  advanceDebris,
  type BallisticDebris,
} from "../src/sim/ballistic-debris";
const world = JSON.parse(readFileSync("public/world.json", "utf8"));
const bytes = readFileSync("public/world.bin");
const base = new Float32Array(
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
);
const summary = (a: number[]) => {
  a.sort((a, b) => a - b);
  return {
    mean: +(a.reduce((a, b) => a + b, 0) / a.length).toFixed(3),
    p95: +a[Math.floor(a.length * 0.95)].toFixed(3),
  };
};
await initializePhysics();
for (const count of [1024, 2048, 8192]) {
  const sim = new Simulation(world, base, () => {});
  sim.setMonsterCount(0);
  sim.setDestruction({ ...DEFAULT_DESTRUCTION, bodies: 4, fragments: 4 });
  // Excess requests exercise the fixed visual pool rather than enlarging it.
  sim.plane.p = [1024, 700, 700];
  for (let i = 0; i < count; i++)
    (sim as any).spawnBody(
      [
        700 + (i % 64) * 3,
        350 + Math.floor(i / 4096) * 3,
        700 + (Math.floor(i / 64) % 64) * 3,
      ],
      [0.7, 0.7, 0.7],
      "stone",
      -1,
      "chunk",
      [30, 45, 10],
    );
  const step: number[] = [],
    snapshot: number[] = [],
    unpack: number[] = [];
  for (let i = 0; i < 180; i++) {
    const start = performance.now();
    sim.step();
    const stepped = performance.now();
    const snap = sim.snapshot(true);
    const sentSnapshot = structuredClone(snap, {
      transfer: snap.packedBodies ? [snap.packedBodies.buffer] : [],
    });
    const sent = performance.now();
    const decodedBodies = sentSnapshot.packedBodies
      ? unpackBodies(sentSnapshot.packedBodies)
      : sentSnapshot.bodies;
    if (decodedBodies.length !== snap.packedBodies!.count)
      throw new Error("Incomplete body snapshot");
    const decoded = performance.now();
    if (i >= 30) {
      step.push(stepped - start);
      snapshot.push(sent - stepped);
      unpack.push(decoded - sent);
    }
  }
  console.log(
    JSON.stringify({
      requestedPieces: count,
      nativeBodies: sim.physics.bodies.len(),
      stepMS: summary(step),
      snapshotMS: summary(snapshot),
      decodeMS: summary(unpack),
      physicsMS: +sim.physicsMS.toFixed(3),
      remaining: sim.snapshot().bodies.length,
    }),
  );
  sim.dispose();
}
for (const count of [4096, 16384]) {
  const terrain = new Terrain(base);
  const debris: BallisticDebris[] = Array.from({ length: count }, (_, id) => ({
    view: {
      id,
      source: -1,
      kind: "chunk",
      material: "stone",
      p: [700 + (id % 64) * 3, 350, 700 + (Math.floor(id / 64) % 64) * 3],
      s: [1, 1, 1],
      q: [0, 0, 0, 1],
    },
    velocity: [30, 45, 10],
    angular: [1, 2, 1],
    grounded: 0,
  }));
  const times: number[] = [];
  for (let tick = 0; tick < 180; tick++) {
    const start = performance.now();
    for (const m of debris) advanceDebris(m, terrain, 1 / 60);
    if (tick >= 30) times.push(performance.now() - start);
  }
  console.log(
    JSON.stringify({ ballisticPieces: count, updateMS: summary(times) }),
  );
}
for (const count of [16384, 65536]) {
  const f = new Fragments(() => 0);
  f.setLimit(count);
  f.emit({
    type: "fragments",
    p: [0, 200, 0],
    origin: [0, 0, 0],
    material: "stone",
    seed: 1,
    count,
    speed: 120,
    spread: 20,
  });
  const update: number[] = [];
  for (let i = 0; i < 180; i++) {
    const start = performance.now();
    f.update(1 / 60);
    if (i >= 30) update.push(performance.now() - start);
  }
  console.log(
    JSON.stringify({
      cosmeticRequested: count,
      actual: f.count,
      updateMS: summary(update),
    }),
  );
  f.mesh.geometry.dispose();
  (f.mesh.material as any).dispose();
}

// Representative bounded visual castle collapse, measured separately from air.
{
  const sim = new Simulation(world, base, () => {});
  sim.setMonsterCount(0);
  sim.setDestruction({
    ...DEFAULT_DESTRUCTION,
    bodies: 4,
    fragments: 4,
    cosmetics: 4,
    rubble: 4,
  });
  sim.plane.p = [world.castle[0], 500, world.castle[2]];
  sim.detonateNuke(world.castle, "castle");
  while (sim.pendingJobs.length) sim.processDestruction(50);
  const initialBodies = sim.snapshot().bodies.length,
    step: number[] = [];
  for (let i = 0; i < 120; i++) {
    const start = performance.now();
    sim.step();
    step.push(performance.now() - start);
  }
  console.log(
    JSON.stringify({
      scenario: "castle-collapse",
      initialBodies,
      remainingBodies: sim.snapshot().bodies.length,
      physicsMS: +sim.physicsMS.toFixed(3),
      stepMS: summary(step),
    }),
  );
  sim.dispose();
}
