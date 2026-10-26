// Before/after screenshots of fixed views, without Vite or a GPU.
//
//   node scripts/offline/check-views.mjs --base HEAD~1 --out artifacts/views/my-change
//
// Builds a preview of the working tree and of --base (a git ref) with
// build-preview.mjs, serves both, and captures each view in headless Chromium
// with the simulation frozen and the shadow focus pinned to the view, so the
// two sets differ only by the code change. Writes <out>/before/*.png,
// <out>/after/*.png and <out>/views.json (per-view render stats).
//
// Needs Playwright with Chromium (`require("playwright")`). Software rendering
// is slow but colour-accurate; frame times from it mean nothing.
// Options: --views 1,6 (subset by number), --settle seconds (default 20).
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i < 0 ? fallback : args[i + 1];
};
const baseRef = opt("--base");
const out = path.resolve(repo, opt("--out", "artifacts/views/latest"));
const only = opt("--views")?.split(",").map(Number);
const settle = Number(opt("--settle", 20)) * 1000;
const seed = opt("--seed", "PS7-0000A301");

// Each view: hour, target feature, camera bearing (fraction of π) and
// distance/height from it. Names say what the view is for.
export const VIEWS = [
  { name: "1-castle-close", hour: 12, target: "castle", angle: 0.75, dist: 420, up: 140, look: 40 },
  { name: "2-high-over-island", hour: 12, target: "castle", angle: 0.25, dist: 2600, up: 1250, look: 0 },
  { name: "3-golden-hour", hour: 18.2, target: "god", angle: 1.25, dist: 3000, up: 300, look: 300 },
  { name: "4-night", hour: 22.5, target: "castle", angle: 0.75, dist: 420, up: 140, look: 40 },
  { name: "5-god-distant", hour: 15.5, target: "god", angle: 1.6, dist: 4200, up: 420, look: 350 },
  { name: "6-shadows-from-altitude", hour: 16.8, target: "castle", angle: 1.0, dist: 900, up: 600, look: 0 },
  { name: "7-morning-mountains", hour: 7.3, target: "god", angle: 0.4, dist: 3800, up: 500, look: 0 },
  { name: "8-evening-valley", hour: 17.4, target: "castle", angle: 1.75, dist: 2200, up: 350, look: 0 },
  // Sky views: the camera looks straight at the sun or moon from near the castle.
  { name: "9-sun-afternoon", hour: 15.5, target: "castle", angle: 0.5, dist: 300, up: 220, sky: "sun" },
  { name: "10-sun-setting", hour: 17.75, target: "castle", angle: 0.5, dist: 300, up: 220, sky: "sun" },
  { name: "11-moonrise", hour: 19.6, target: "castle", angle: 0.5, dist: 300, up: 220, sky: "moon" },
  { name: "12-moon-and-stars", hour: 23.5, target: "castle", angle: 0.5, dist: 300, up: 220, sky: "moon" },
];

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require("playwright"));
} catch {
  console.error("Playwright is not available; install it or run where it is.");
  process.exit(2);
}

function build(root, dest) {
  execFileSync(process.execPath, [path.join(root, "scripts/generate-world.mjs")], { cwd: root, stdio: "pipe" });
  execFileSync(process.execPath, [path.join(root, "scripts/hash-runtime-assets.mjs")], { cwd: root, stdio: "pipe" });
  execFileSync(process.execPath, [path.join(here, "build-preview.mjs"), root, dest], { cwd: root, stdio: "pipe" });
}
function serve(dir, port) {
  const child = spawn(process.execPath, [path.join(here, "serve.mjs"), dir, String(port)], { stdio: "ignore" });
  return child;
}

async function capture(url, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const browser = await chromium.launch({
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.stack ?? e).slice(0, 600)));
  page.setDefaultTimeout(300000);
  await page.goto(`${url}?island=${seed}#debug`);
  await page.waitForFunction(() => !document.getElementById("keepIsland")?.disabled);
  await page.locator("#keepIsland").click();
  await page.waitForFunction(() => window.lanternVale?.state.ready && !document.getElementById("enter").disabled);
  await page.locator("#crtMode").selectOption("off");
  await page.evaluate(() => {
    lanternVale.setQuality("1440");
    const env = lanternVale.view.environment;
    const update = env.update.bind(env);
    window.__focus = null;
    // Pin the shadow focus (normally the aircraft) to the shot.
    env.update = (snap, camera, position, ...rest) => update(snap, camera, window.__focus ?? position, ...rest);
    lanternVale.send({ type: "holdTime", hold: true });
  });
  const features = await page.evaluate(() => {
    const w = lanternVale.world;
    const statue = w.entities.filter((e) => e.visual && e.visual.shape !== "portal-stone");
    let gx = 0, gz = 0;
    for (const e of statue) { gx += e.p[0]; gz += e.p[2]; }
    return {
      god: statue.length ? [gx / statue.length, 0, gz / statue.length] : w.spawn,
      castle: w.castles?.[0]?.p ?? w.landmarks.keep,
    };
  });
  const rows = [];
  for (const [index, view] of VIEWS.entries()) {
    if (only && !only.includes(index + 1)) continue;
    const pose = await page.evaluate(({ view, target }) => {
      const a = Math.PI * view.angle;
      const x = target[0] + Math.cos(a) * view.dist, z = target[2] + Math.sin(a) * view.dist;
      const ground = Math.max(0, lanternVale.terrain(x, z)), tg = lanternVale.terrain(target[0], target[2]);
      const eye = [x, Math.min(1450, Math.max(ground + view.up, tg + view.up)), z];
      let look = [target[0], tg + (view.look ?? 0), target[2]];
      if (view.sky) {
        // Same sun path as EnvironmentLighting; the moon is swung 0.45 rad.
        const ang = ((view.hour - 6) / 24) * Math.PI * 2;
        let dir = [Math.cos(ang) * 0.8, Math.sin(ang), Math.cos(ang) * 0.5];
        const len = Math.hypot(...dir);
        dir = dir.map((v) => v / len);
        if (view.sky === "moon") {
          const c = Math.cos(0.45), s = Math.sin(0.45), mx = -dir[0], mz = -dir[2];
          dir = [mx * c - mz * s, -dir[1], mx * s + mz * c];
        }
        look = [eye[0] + dir[0] * 1500, eye[1] + dir[1] * 1500, eye[2] + dir[2] * 1500];
      }
      const dx = look[0] - x, dz = look[2] - z, dl = Math.hypot(dx, dz);
      const V = lanternVale.view.camera.position.constructor;
      window.__focus = new V(x + (dx / dl) * 40, eye[1] - 8, z + (dz / dl) * 40);
      lanternVale.send({ type: "hour", hour: view.hour });
      document.getElementById("overlay").hidden = true;
      document.getElementById("perf").hidden = true;
      lanternVale.inspect(eye, look);
      return { eye, look };
    }, { view, target: features[view.target] });
    await page.waitForTimeout(settle);
    await page.evaluate(() => {
      const v = lanternVale.view;
      v.shadowDirty = true;
      v.nextShadow = -Infinity;
    });
    await page.waitForTimeout(3000);
    await page.screenshot({ path: path.join(dir, `${view.name}.png`) });
    const stats = await page.evaluate(() => {
      const v = lanternVale.view, e = v.environment;
      return {
        hour: lanternVale.state.snapshot?.hour,
        shadowHalf: e.sun.shadow.camera.right,
        quality: v.visualProfile.name,
        queues: v.performance.queues,
      };
    });
    rows.push({ ...view, ...pose, stats });
    console.error(`  ${view.name}`);
  }
  await browser.close();
  return { rows, errors };
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "views-"));
const servers = [];
const report = {};
try {
  console.error("Building working tree preview...");
  build(repo, path.join(tmp, "after"));
  servers.push(serve(path.join(tmp, "after"), 5311));
  if (baseRef) {
    const base = path.join(tmp, "base-src");
    execFileSync("git", ["worktree", "add", "--detach", base, baseRef], { cwd: repo, stdio: "pipe" });
    fs.symlinkSync(path.join(repo, "node_modules"), path.join(base, "node_modules"));
    console.error(`Building ${baseRef} preview...`);
    build(base, path.join(tmp, "before"));
    servers.push(serve(path.join(tmp, "before"), 5310));
  }
  await new Promise((r) => setTimeout(r, 800));
  // One browser at a time: two software-GL Chromiums can exhaust memory.
  if (baseRef) {
    console.error("Capturing before...");
    report.before = await capture("http://127.0.0.1:5310/", path.join(out, "before"));
  }
  console.error("Capturing after...");
  report.after = await capture("http://127.0.0.1:5311/", path.join(out, "after"));
} finally {
  for (const s of servers) s.kill();
  if (baseRef) {
    try {
      execFileSync("git", ["worktree", "remove", "--force", path.join(tmp, "base-src")], { cwd: repo, stdio: "pipe" });
    } catch {}
  }
}
fs.writeFileSync(path.join(out, "views.json"), JSON.stringify(report, null, 2));
const errs = [...(report.before?.errors ?? []), ...(report.after?.errors ?? [])];
console.log(`Saved views to ${path.relative(repo, out)}${errs.length ? `; ${errs.length} page error(s) in views.json` : ""}`);
process.exitCode = errs.length ? 1 : 0;
