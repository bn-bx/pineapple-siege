/** Compare isolated, warmed PS4 and PS5 processes on the same machine. */
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { generateIsland, planIsland } from "../src/world/generator.mjs";
const worker = process.argv
  .find((arg) => arg.startsWith("--worker="))
  ?.split("=")[1];
const seeds = [0, 1, 42, 2026, 4294967295, 41729];
const percentile = (values, p) => {
  const sorted = values.toSorted((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)];
};
const median = (values) => {
  const sorted = values.toSorted((a, b) => a - b);
  return (sorted[(sorted.length - 1) >> 1] + sorted[sorted.length >> 1]) / 2;
};
if (worker) {
  const revision = worker === "ps4" ? 4 : 5,
    rows = [];
  // Warm code and collect immediately; no accepted baseline survives between cases.
  generateIsland({ seed: 42, generatorVersion: revision, preset: "B" });
  globalThis.gc?.();
  const measure = (request) => {
    const start = performance.now();
    generateIsland(request);
    return performance.now() - start;
  };
  for (const preset of revision === 4 ? [undefined] : ["B", "H", "R", "W"])
    for (const seed of seeds) {
      const ms = measure({ seed, generatorVersion: revision, preset });
      rows.push({ seed, preset, ms });
      globalThis.gc?.();
    }
  const shortlists = [];
  if (revision === 5)
    for (let group = 0; group < 4; group++) {
      const start = performance.now();
      for (const seed of seeds.slice(group, group + 3))
        planIsland({
          seed,
          generatorVersion: 5,
          preset: ["B", "H", "R", "W"][group],
        });
      shortlists.push(performance.now() - start);
      globalThis.gc?.();
    }
  console.log(
    JSON.stringify({
      rows,
      shortlists,
      medianMS: median(rows.map((r) => r.ms)),
      p95MS: percentile(
        rows.map((r) => r.ms),
        0.95,
      ),
      peakRSS: process.resourceUsage().maxRSS * 1024,
    }),
  );
} else {
  const run = (name) => {
    const result = spawnSync(
      process.execPath,
      ["--expose-gc", import.meta.filename, `--worker=${name}`],
      { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
    );
    if (result.status !== 0)
      throw Error(result.stderr || result.stdout || `Benchmark ${name} failed`);
    return JSON.parse(result.stdout.trim().split("\n").at(-1));
  };
  const ps4 = run("ps4"),
    ps5 = run("ps5"),
    shortlistMedianMS = median(ps5.shortlists);
  const gates = {
    median: ps5.medianMS <= ps4.medianMS,
    p95: ps5.p95MS <= ps4.p95MS * 1.25,
    memory: ps5.peakRSS <= ps4.peakRSS * 1.25,
    shortlist: shortlistMedianMS < ps4.medianMS,
  };
  const report = { node: process.version, ps4, ps5, shortlistMedianMS, gates };
  mkdirSync("artifacts/island-overhaul", { recursive: true });
  writeFileSync(
    "artifacts/island-overhaul/generation-benchmark.json",
    JSON.stringify(report, null, 2),
  );
  console.log(
    JSON.stringify({
      ps4MedianMS: ps4.medianMS,
      ps5MedianMS: ps5.medianMS,
      ps4P95MS: ps4.p95MS,
      ps5P95MS: ps5.p95MS,
      shortlistMedianMS,
      ps4PeakRSS: ps4.peakRSS,
      ps5PeakRSS: ps5.peakRSS,
      gates,
    }),
  );
  if (Object.values(gates).some((pass) => !pass)) process.exitCode = 1;
}
