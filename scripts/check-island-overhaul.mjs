/** Release coverage: full fixed corpus, or a larger inexpensive planning sweep. */
import { mkdir, writeFile } from "node:fs/promises";
import { generateIsland, planIsland } from "../src/world/generator.mjs";
import { auditGeography } from "../src/world/generation-validation.mjs";
import { fieldSample } from "../src/world/landscape.mjs";
const coarse = process.argv.includes("--coarse"),
  quick = process.argv.includes("--quick");
const seeds = [
  0,
  1,
  42,
  2026,
  4294967295,
  41729,
  ...Array.from({ length: 26 }, (_, i) => Math.imul(i + 1, 2654435761) >>> 0),
  12,
  20,
  22,
];
const cases = (
  coarse
    ? Array.from({ length: 128 }, (_, i) => Math.imul(i + 31, 2246822519) >>> 0)
    : quick
      ? seeds.slice(0, 6)
      : seeds
).map((seed) => ({ seed, generatorVersion: 7 }));
const rows = [];
let failures = 0;
function check(request) {
  const start = performance.now();
  if (coarse) {
    const p = planIsland(request);
    return {
      ms: Math.round(performance.now() - start),
      attempt: p.attempt,
      shape: p.shapeFamily,
      landmarks: p.sites.length,
    };
  }
  const { world, heights } = generateIsland(request);
  const metrics = auditGeography(world, (x, z) =>
    fieldSample(heights, world.grid, world.step, x, z),
  );
  return {
    ms: Math.round(performance.now() - start),
    ...metrics,
    structures: world.structureCount,
    trees: world.entities.filter((e) => e.kind === "tree").length,
    lakes: world.lakes.length,
    shape: world.shapeFamily,
  };
}
await mkdir("artifacts/island-overhaul", { recursive: true });
for (const request of cases) {
  try {
    rows.push({ ...request, ...check(request) });
  } catch (error) {
    failures++;
    rows.push({ ...request, error: error.message });
  }
  globalThis.gc?.();
  if (rows.length % 8 === 0 || rows.at(-1).error)
    console.log(
      JSON.stringify({
        completed: rows.length,
        total: cases.length,
        failures,
        last: rows.at(-1),
      }),
    );
  await writeFile(
    `artifacts/island-overhaul/variety-${coarse ? "coarse" : "release"}-audit.json`,
    JSON.stringify({ cases: cases.length, failures, rows }, null, 2),
  );
}
console.log(JSON.stringify({ cases: cases.length, failures }));
if (failures) process.exitCode = 1;
