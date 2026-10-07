import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { Simulation, initializePhysics } from "../src/sim/simulation";
import type { WorldData, SaveSnapshot, Vec3 } from "../src/types";
const world: WorldData = JSON.parse(readFileSync("public/world.json", "utf8")),
  bytes = readFileSync("public/world.bin"),
  base = new Float32Array(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  );
const summary = (a: number[]) => {
  const b = a.slice().sort((a, b) => a - b);
  return {
    count: a.length,
    meanMS: a.reduce((s, n) => s + n, 0) / (a.length || 1),
    p95MS: b[Math.floor(b.length * 0.95)] || 0,
    p99MS: b[Math.floor(b.length * 0.99)] || 0,
    maxMS: b.at(-1) || 0,
  };
};
await initializePhysics();
const results: unknown[] = [];
for (const count of [120, 400])
  for (const kind of ["flight", "nuke", "laser"]) {
    const sim = new Simulation(world, base, () => {}, undefined, true);
    sim.setMonsterCount(count);
    sim.plane.p = [world.castle[0], 400, world.castle[2] - 450];
    for (let i = 0; i < 60; i++) sim.step();
    const steps: number[] = [],
      saves: number[] = [],
      snapshots: number[] = [],
      stages: Record<string, number[]> = {
        monsters: [],
        residents: [],
        residency: [],
        physics: [],
      };
    for (let tick = 0; tick < 1800; tick++) {
      if (kind !== "flight" && tick % 6 === 0) {
        const n = tick / 6,
          p: Vec3 = [
            world.castle[0] + Math.sin(n * 0.3) * 80,
            world.castle[1],
            world.castle[2] + Math.cos(n * 0.3) * 80,
          ];
        if (kind === "nuke") sim.detonateNuke(p, "valley");
        else sim.startLaser(p);
      }
      const start = performance.now();
      sim.step();
      steps.push(performance.now() - start);
      for (const [name, ms] of Object.entries(sim.stageMS))
        (stages[name] ??= []).push(ms);
      if (tick % 60 === 0) {
        const generator = sim.captureSave();
        let r: IteratorResult<void, SaveSnapshot>;
        do {
          const start = performance.now();
          r = generator.next();
          saves.push(performance.now() - start);
        } while (!r.done);
        sim.acknowledgeSave(r.value.capture!);
      }
      if (tick % 2 === 0) {
        const start = performance.now();
        sim.snapshot(true);
        snapshots.push(performance.now() - start);
      }
    }
    const result = {
      count,
      kind,
      step: summary(steps),
      saveSlices: summary(saves),
      snapshot: summary(snapshots),
      stages: Object.fromEntries(
        Object.entries(stages).map(([k, a]) => [k, summary(a)]),
      ),
      queues: sim.snapshot().stats,
    };
    results.push(result);
    console.log(JSON.stringify(result));
    sim.dispose();
  }
mkdirSync("artifacts", { recursive: true });
writeFileSync(
  "artifacts/PERFORMANCE_CPU_RESULTS.json",
  JSON.stringify(results, null, 2),
);
