import { readFileSync } from "node:fs";
import { Simulation, initializePhysics } from "../src/sim/simulation";
import type { WorldData } from "../src/types";
const world = JSON.parse(
  readFileSync("public/world.json", "utf8"),
) as WorldData;
const bytes = readFileSync("public/world.bin");
const base = new Float32Array(
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
);
const summarize = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    mean: +(values.reduce((a, b) => a + b, 0) / values.length).toFixed(2),
    p95: +sorted[Math.floor(sorted.length * 0.95)].toFixed(2),
  };
};
await initializePhysics();
for (const population of [120, 400]) {
  const sim = new Simulation(world, base, () => {});
  sim.setMonsterCount(population);
  sim.plane.p = [world.castle[0], 400, world.castle[2] - 450];
  for (let i = 0; i < 30; i++) sim.step();
  const measure = (ticks: number) => {
    const samples: number[] = [];
    for (let i = 0; i < ticks; i++) {
      const start = performance.now();
      sim.step();
      samples.push(performance.now() - start);
    }
    return summarize(samples);
  };
  const flight = measure(120);
  sim.detonateNuke(world.castle, "valley");
  const siege = measure(180);
  const snap = sim.snapshot();
  console.log(
    JSON.stringify({
      population,
      worldSize: world.size,
      civilians: sim.civilians.states.length,
      flightMS: flight,
      siegeMS: siege,
      bodies: snap.stats.bodies,
      ballistic: snap.stats.ballistic,
      pendingJobs: snap.stats.pendingJobs,
    }),
  );
  sim.dispose();
}
