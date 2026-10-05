import { readFileSync, writeFileSync } from "node:fs";
import { Simulation, initializePhysics } from "../src/sim/simulation";
const world = JSON.parse(readFileSync("public/world.json", "utf8"));
const bytes = readFileSync("public/world.bin");
const base = new Float32Array(
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
);
await initializePhysics();
const variant = "simple";
const sim = new Simulation(world, base, () => {}, undefined, true);
sim.setMonsterCount(120);
sim.plane.p = [world.castle[0], 400, world.castle[2] - 350];
for (let i = 0; i < 120; i++) sim.step();
sim.physics.profilerEnabled = true;
const series: any = {
  tick: [],
  physics: [],
  narrow: [],
  solver: [],
  ccd: [],
  residency: [],
  colliders: [],
  ballistic: [],
  residents: [],
  destruction: [],
};
const summary = (a: number[]) => {
  const b = a.slice().sort((x, y) => x - y);
  return {
    mean: a.reduce((x, y) => x + y, 0) / a.length,
    p95: b[Math.floor(b.length * 0.95)],
    max: b.at(-1),
  };
};
const impact = [
  world.castle[0],
  sim.terrain.sample(world.castle[0], world.castle[2]),
  world.castle[2],
];
const t = performance.now();
sim.detonateNuke(impact, "valley");
const detonateMS = performance.now() - t;
const report: any = { variant, detonateMS, windows: [] };
for (let i = 0; i < 540; i++) {
  sim.plane.p = [world.castle[0], 400, world.castle[2] - 350];
  const t = performance.now();
  sim.step();
  series.tick.push(performance.now() - t);
  for (const k of [
    "physics",
    "residency",
    "colliders",
    "ballistic",
    "residents",
  ])
    series[k].push(sim.stageMS[k]);
  series.narrow.push(sim.physics.timingNarrowPhase());
  series.solver.push(sim.physics.timingSolver());
  series.ccd.push(sim.physics.timingCcd());
  series.destruction.push(sim.destructionMS);
  if ((i + 1) % 60 === 0) {
    const row = {
      second: (i + 1) / 60,
      timings: Object.fromEntries(
        Object.entries(series).map(([k, v]) => [k, summary(v as number[])]),
      ),
      counts: {
        moving: sim.moving.size,
        ballistic: sim.ballistic.size,
        monster: sim.monsterRagdolls.moving.size,
        statics: sim.entityColliders.size,
        terrain: sim.terrainColliders.size,
        jobs: sim.pendingJobs.length,
      },
    };
    report.windows.push(row);
    console.log(JSON.stringify(row));
    for (const v of Object.values(series)) (v as number[]).length = 0;
  }
}
writeFileSync("docs/SIMPLE_BLAST_CPU.json", JSON.stringify(report, null, 2));
sim.dispose();
