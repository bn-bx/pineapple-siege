// Compare the working generator with a Git revision, without changing either checkout.
import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { generateIsland, GENERATOR_VERSION } from "../src/world/generator.mjs";
const ref = process.env.ISLAND_BASE_REF ?? "HEAD";
const directory = await mkdtemp(join(tmpdir(), "island-generation-benchmark-"));
const seeds = [
  0,
  1,
  42,
  2026,
  4294967295,
  41729,
  ...Array.from({ length: 26 }, (_, i) => Math.imul(i + 1, 2654435761) >>> 0),
];
const median = (values) => {
  const sorted = values.toSorted((a, b) => a - b);
  return (sorted[(sorted.length - 1) >> 1] + sorted[sorted.length >> 1]) / 2;
};
try {
  for (const name of ["generator.mjs", "architecture.mjs"])
    await writeFile(
      join(directory, name),
      execFileSync("git", ["show", `${ref}:src/world/${name}`]),
    );
  for (const name of ["vertical-limits.mjs", "mountains.mjs"]) {
    try {
      await writeFile(
        join(directory, name),
        execFileSync("git", ["show", `${ref}:src/world/${name}`], {
          stdio: ["ignore", "pipe", "ignore"],
        }),
      );
    } catch {
      /* Earlier generators do not have these modules. */
    }
  }
  const baseline = await import(
    pathToFileURL(join(directory, "generator.mjs")).href
  );
  baseline.generateIsland(42);
  generateIsland(42);
  const rows = [];
  for (const seed of seeds) {
    const row = { seed };
    for (const [name, fn] of [
      ["baseline", baseline.generateIsland],
      ["current", generateIsland],
    ]) {
      let retries = 0;
      const start = performance.now();
      fn(seed, (label) => {
        if (label.startsWith("Refining")) retries++;
      });
      row[name] = { ms: Math.round(performance.now() - start), retries };
    }
    rows.push(row);
  }
  const baselineMedianMS = median(rows.map((r) => r.baseline.ms)),
    currentMedianMS = median(rows.map((r) => r.current.ms));
  const report = {
    baseCommit: execFileSync("git", ["rev-parse", ref], {
      encoding: "utf8",
    }).trim(),
    baselineRevision: baseline.GENERATOR_VERSION,
    currentRevision: GENERATOR_VERSION,
    node: process.version,
    seeds: seeds.length,
    baselineMedianMS,
    currentMedianMS,
    medianRatio: currentMedianMS / baselineMedianMS,
    baselineRetries: rows.reduce((n, r) => n + r.baseline.retries, 0),
    currentRetries: rows.reduce((n, r) => n + r.current.retries, 0),
    withinTarget: currentMedianMS <= baselineMedianMS * 1.25,
    rows,
  };
  await writeFile(
    process.env.ISLAND_BENCHMARK_OUTPUT ??
      "/tmp/island-generation-benchmark.json",
    JSON.stringify(report, null, 2),
  );
  const { rows: details, ...summary } = report;
  console.log(JSON.stringify(summary));
  if (!report.withinTarget) process.exitCode = 1;
} finally {
  await rm(directory, { recursive: true, force: true });
}
