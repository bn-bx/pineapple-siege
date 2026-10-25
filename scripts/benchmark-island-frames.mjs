import assert from "node:assert/strict";
import { GENERATOR_VERSION } from "../src/world/generator.mjs";
const comparedRevision = Number(
  process.env.ISLAND_REVISION ?? GENERATOR_VERSION,
);
assert([5, 6, 7].includes(comparedRevision), "Unsupported benchmark revision");
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ?? "playwright"
);
const out = fileURLToPath(
    new URL("../artifacts/island-overhaul/", import.meta.url),
  ),
  base = process.env.ISLAND_URL ?? "http://127.0.0.1:5177/";
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH ??
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: false,
  args: [
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
  ],
});
const rows = [],
  errors = [];
const percentile = (values, p) =>
  values.toSorted((a, b) => a - b)[Math.ceil(values.length * p) - 1];
await mkdir(out, { recursive: true });
try {
  for (const count of [120, 400])
    for (const revision of [4, comparedRevision]) {
      const context = await browser.newContext({
          viewport: { width: 1280, height: 900 },
        }),
        page = await context.newPage();
      page.setDefaultTimeout(120000);
      page.on("pageerror", (error) => errors.push(error.message));
      const code = revision === 5 ? "PS5-B-0000002A" : `PS${revision}-0000002A`;
      await page.goto(`${base}?island=${code}#debug`);
      await page.waitForFunction(
        () => !document.getElementById("keepIsland").disabled,
      );
      await page.locator("#keepIsland").click();
      await page.waitForFunction(
        () =>
          window.lanternVale?.state.ready &&
          !document.getElementById("enter").disabled,
      );
      await page.locator("#quality").selectOption("1080");
      await page.locator("#crtMode").selectOption("off");
      const environment = await page.evaluate((count) => {
        const input = document.getElementById("monsterCount");
        input.value = String(count);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        lanternVale.send({ type: "holdTime", hold: true });
        lanternVale.send({ type: "hour", hour: 15.5 });
        const w = lanternVale.world,
          c = w.castle,
          god = w.sites.find((s) => s.kind === "pineapple-god");
        let route,
          best = Infinity;
        for (let turn = 0; turn < 4; turn++) {
          const yaw = (turn * Math.PI) / 2,
            radius = 130 / (1.05 * 0.5),
            x = c[0] + Math.sin(yaw) * 450,
            z = c[2] + Math.cos(yaw) * 450,
            cx = x + Math.cos(yaw) * radius,
            cz = z - Math.sin(yaw) * radius;
          if (
            cx - radius < 300 ||
            cx + radius > w.size - 300 ||
            cz - radius < 300 ||
            cz + radius > w.size - 300 ||
            Math.hypot(cx - god.p[0], cz - god.p[2]) < radius + 700
          )
            continue;
          let highest = 0;
          for (let dz = -radius - 130; dz <= radius + 130; dz += 48)
            for (let dx = -radius - 130; dx <= radius + 130; dx += 48) {
              if (Math.hypot(dx, dz) <= radius + 130)
                highest = Math.max(
                  highest,
                  lanternVale.terrain(cx + dx, cz + dz),
                );
            }
          if (highest < best) {
            best = highest;
            route = { x, z, yaw, height: Math.max(900, highest + 180) };
          }
        }
        if (!route) throw Error("No safe benchmark orbit");
        const plane = {
          ...lanternVale.state.snapshot.plane,
          p: [route.x, route.height, route.z],
          v: [0, 0, 130],
          yaw: route.yaw,
          pitch: 0,
          roll: 0,
          speed: 130,
          crashed: 0,
          falling: false,
        };
        lanternVale.send({ type: "setPlane", plane, grace: 10 });
        lanternVale.controls({
          x: -0.5,
          y: 0,
          throttle: 0,
          bank: 0,
          boost: false,
          fire: false,
        });
        const gl = lanternVale.renderer.getContext(),
          extension = gl.getExtension("WEBGL_debug_renderer_info");
        return {
          renderer: extension
            ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL)
            : "unavailable",
          route,
          width: gl.drawingBufferWidth,
          height: gl.drawingBufferHeight,
        };
      }, count);
      assert(
        !/swiftshader|software|llvmpipe|unavailable/i.test(
          environment.renderer,
        ),
        "Native GPU required",
      );
      await page.bringToFront();
      // Fixed debug controls drive the orbit; use the supported drag fallback so
      // browser mouse-capture permission changes cannot pause a measurement.
      await page.evaluate(async () => {
        document.querySelector("#world").requestPointerLock = async () => {
          throw Error("Benchmark uses fixed controls without mouse capture");
        };
        await lanternVale.enter();
      });
      await page.waitForFunction(() => lanternVale.state.active);
      await page.waitForTimeout(15000);
      const start = await page.evaluate(() => lanternVale.samples.length);
      await page.waitForTimeout(20000);
      const measured = await page.evaluate(
        (start) => ({
          samples: lanternVale.samples.slice(start),
          crashed: lanternVale.state.snapshot.plane.crashed,
          active: lanternVale.state.active,
          visible: document.visibilityState,
          monsters: lanternVale.state.snapshot.monsterCount,
          render: lanternVale.state.render,
        }),
        start,
      );
      assert.equal(measured.crashed, 0);
      assert(measured.active);
      assert.equal(measured.visible, "visible");
      assert(measured.samples.length >= 100);
      assert.equal(measured.monsters, count);
      const row = {
        revision,
        count,
        ...environment,
        samples: measured.samples.length,
        medianMS: percentile(measured.samples, 0.5),
        p95MS: percentile(measured.samples, 0.95),
        render: measured.render,
      };
      rows.push(row);
      console.log(JSON.stringify(row));
      await context.close();
    }
  const gates = [120, 400].map((count) => {
    const before = rows.find((r) => r.count === count && r.revision === 4),
      after = rows.find(
        (r) => r.count === count && r.revision === comparedRevision,
      );
    return {
      count,
      ratio: after.p95MS / before.p95MS,
      passed: after.p95MS <= before.p95MS * 1.1,
    };
  });
  await writeFile(
    `${out}/frame-benchmark.json`,
    JSON.stringify({ rows, gates, errors }, null, 2),
  );
  assert.deepEqual(errors, []);
  assert(
    gates.every((g) => g.passed),
    "Frame p95 regression exceeds 10%",
  );
} finally {
  await browser.close();
}
