// Offline test runner: runs this project's Vitest files with plain Node and a
// small Vitest stand-in (vitest-shim.mjs), for machines where `npm test`
// cannot run (no npm registry access, or a Node that cannot load Vite's native
// bundler). Requires Node 22.12+ (uses --experimental-transform-types).
//
//   node scripts/offline/run-tests.mjs                   # every tests/*.test.ts
//   node scripts/offline/run-tests.mjs shadow fog         # files whose name matches
//   node scripts/offline/run-tests.mjs --compare HEAD~1   # also run the same files
//                                                          # at another commit and
//                                                          # report regressions
// Options: --jobs N, --json out.json, --skip-setup, --timeout seconds
//
// Results are PASS / FAIL / SKIP. SKIP means the stand-in lacks a Vitest
// feature (fake timers, vi.mock, snapshots); those tests are not verified here.
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  if (i < 0) return fallback;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const flag = (name) => {
  const i = args.indexOf(name);
  if (i >= 0) args.splice(i, 1);
  return i >= 0;
};
const compareRef = opt("--compare");
const jsonOut = opt("--json");
const jobs = Number(opt("--jobs", Math.max(1, Math.min(4, os.cpus().length))));
const timeout = Number(opt("--timeout", 300)) * 1000;
const skipSetup = flag("--skip-setup");
const patterns = args;

function testFiles(root) {
  const all = fs
    .readdirSync(path.join(root, "tests"))
    .filter((f) => f.endsWith(".test.ts"))
    .sort();
  return patterns.length ? all.filter((f) => patterns.some((p) => f.includes(p))) : all;
}

function setup(root) {
  if (skipSetup) return;
  const run = (script) => {
    if (fs.existsSync(path.join(root, script)))
      execFileSync(process.execPath, [script], { cwd: root, stdio: "pipe" });
  };
  // Same generated inputs `npm test` prepares.
  run("scripts/generate-world.mjs");
  run("scripts/generate-legacy-world.mjs");
}

function runFile(root, file) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(
      process.execPath,
      [
        "--experimental-transform-types",
        "--no-warnings",
        "--import",
        path.join(here, "register.mjs"),
        path.join("tests", file),
      ],
      { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
    );
    let out = "",
      err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    const timer = setTimeout(() => child.kill("SIGKILL"), timeout);
    child.on("close", (code) => {
      clearTimeout(timer);
      const line = out.split("\n").find((l) => l.startsWith("@@OFFLINE-RESULTS@@"));
      const ms = Date.now() - started;
      if (line) return resolve({ file, ms, tests: JSON.parse(line.slice(19)) });
      const text = (err || out).trim();
      const unsupported = /offline runner does not support/.test(text);
      const reason = code === null ? `timed out after ${timeout / 1000}s` : text.split("\n").filter(Boolean).slice(-3).join(" | ").slice(0, 400);
      resolve({ file, ms, error: { status: unsupported ? "skip" : "fail", reason } });
    });
  });
}

async function runAll(root, files) {
  const results = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(jobs, files.length) }, async () => {
      while (next < files.length) {
        const file = files[next++];
        const r = await runFile(root, file);
        results.push(r);
        const counts = summarize([r]);
        const mark = counts.fail ? "FAIL" : counts.pass ? "ok  " : "skip";
        process.stderr.write(`${mark} ${file} (${counts.pass}/${counts.total}, ${(r.ms / 1000).toFixed(1)}s)\n`);
      }
    }),
  );
  return results.sort((a, b) => a.file.localeCompare(b.file));
}

function flatten(results) {
  const map = new Map();
  for (const r of results) {
    if (r.error) map.set(`${r.file} :: (file)`, r.error);
    else for (const t of r.tests) map.set(`${r.file} :: ${t.name}`, t);
  }
  return map;
}
function summarize(results) {
  const c = { pass: 0, fail: 0, skip: 0, total: 0 };
  for (const t of flatten(results).values()) {
    c[t.status]++;
    c.total++;
  }
  return c;
}

const files = testFiles(repo);
if (!files.length) {
  console.error("No test files matched.");
  process.exit(2);
}
setup(repo);
console.error(`Running ${files.length} test file(s) with ${jobs} job(s)...`);
const head = await runAll(repo, files);
const headMap = flatten(head);
const report = { files: files.length, head: summarize(head) };

for (const [name, t] of headMap)
  if (t.status === "fail") console.log(`FAIL ${name}\n     ${t.reason}`);
const skipped = [...headMap].filter(([, t]) => t.status === "skip");
if (skipped.length)
  console.log(`\n${skipped.length} skipped (stand-in limits): ${[...new Set(skipped.map(([n]) => n.split(" :: ")[0]))].join(", ")}`);

let regressions = [];
if (compareRef) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "offline-base-"));
  execFileSync("git", ["worktree", "add", "--detach", base, compareRef], { cwd: repo, stdio: "pipe" });
  try {
    fs.symlinkSync(path.join(repo, "node_modules"), path.join(base, "node_modules"));
    setup(base);
    const baseFiles = files.filter((f) => fs.existsSync(path.join(base, "tests", f)));
    console.error(`\nBaseline ${compareRef}: ${baseFiles.length} file(s)...`);
    const baseMap = flatten(await runAll(base, baseFiles));
    report.base = { pass: 0, fail: 0, skip: 0, total: baseMap.size };
    for (const t of baseMap.values()) report.base[t.status]++;
    regressions = [...headMap].filter(([n, t]) => t.status === "fail" && baseMap.get(n)?.status === "pass").map(([n]) => n);
    const fixed = [...headMap].filter(([n, t]) => t.status === "pass" && baseMap.get(n)?.status === "fail").map(([n]) => n);
    const newTests = [...headMap.keys()].filter((n) => !baseMap.has(n));
    console.log(`\nCompared with ${compareRef}: ${regressions.length} regression(s), ${fixed.length} newly passing, ${newTests.length} new test(s).`);
    for (const n of regressions) console.log(`REGRESSION ${n}`);
    report.regressions = regressions;
    report.newlyPassing = fixed;
  } finally {
    execFileSync("git", ["worktree", "remove", "--force", base], { cwd: repo, stdio: "pipe" });
  }
}

const h = report.head;
console.log(`\n${h.pass} passed, ${h.fail} failed, ${h.skip} skipped (${h.total} tests in ${files.length} files)`);
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify({ ...report, results: head }, null, 2));
process.exitCode = compareRef ? (regressions.length ? 1 : 0) : h.fail ? 1 : 0;
