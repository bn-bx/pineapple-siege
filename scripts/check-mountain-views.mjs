// Disposable visual QA: six seeds, terrain landmarks, and high-altitude distance extremes.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ?? "playwright"
);
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH ??
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--enable-unsafe-swiftshader"],
});
const base = process.env.ISLAND_URL ?? "http://127.0.0.1:5177/";
const output = process.env.ISLAND_QA_OUTPUT ?? "/tmp/mountain-qa";
await mkdir(output, { recursive: true });
const errors = [],
  results = [];
try {
  for (const code of [
    "PS2-00000000",
    "PS2-00000003",
    "PS2-0000002A",
    "PS2-00000004",
    "PS2-00000007",
    "PS2-0000A301",
  ]) {
    const context = await browser.newContext({
      viewport: { width: 1100, height: 760 },
    });
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(`${code}: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(`${code}: ${m.text()}`);
    });
    await page.goto(`${base}?island=${code}#debug`);
    await page.waitForFunction(
      () => !document.getElementById("keepIsland").disabled,
      {},
      { timeout: 60000 },
    );
    assert.match(
      await page.locator("#islandLandmarks").innerText(),
      /Highest peak \d+ m/,
    );
    await page
      .locator("#islandPreview")
      .screenshot({ path: `${output}/${code}-preview.png` });
    await page.locator("#keepIsland").click();
    await page.waitForFunction(
      () => window.lanternVale?.state.ready,
      {},
      { timeout: 90000 },
    );
    const shots = await page.evaluate(() => {
      document.getElementById("overlay").hidden = true;
      document.getElementById("perf").hidden = true;
      const w = lanternVale.world,
        h = lanternVale.view.terrain.base;
      let peak = 0;
      for (let i = 0; i < h.length; i++) if (h[i] > h[peak]) peak = i;
      const summit = [
        (peak % w.grid) * w.step,
        h[peak],
        Math.floor(peak / w.grid) * w.step,
      ];
      const harbor = w.sites.find((s) => s.kind === "harbor").p,
        pass = w.passes[0].p;
      const river =
        w.rivers[0].points[Math.floor(w.rivers[0].points.length / 2)];
      const bridge = w.sites.find((s) => s.kind === "crossing").p;
      return [
        {
          name: "coast",
          p: [harbor[0] + 140, harbor[1] + 120, harbor[2] + 160],
          target: harbor,
          distance: 1200,
        },
        {
          name: "mountains",
          p: [summit[0] - 500, summit[1] + 350, summit[2] + 600],
          target: summit,
          distance: 3000,
        },
        {
          name: "pass",
          p: [pass[0] - 260, pass[1] + 220, pass[2] + 300],
          target: pass,
          distance: 1200,
        },
        {
          name: "river",
          p: [river[0] + 100, river[1] + 100, river[2] + 120],
          target: river,
          distance: 1200,
        },
        {
          name: "crossing",
          p: [bridge[0] + 100, bridge[1] + 90, bridge[2] + 120],
          target: bridge,
          distance: 1200,
        },
        ...[600, 3000].map((distance) => ({
          name: `high-${distance}`,
          p: [pass[0], 1400, pass[2] + 100],
          target: pass,
          distance,
        })),
      ];
    });
    for (const shot of shots) {
      const state = await page.evaluate((shot) => {
        const v = lanternVale.view;
        v.setRenderDistance(shot.distance);
        lanternVale.inspect(shot.p, shot.target);
        return {
          far: v.camera.far,
          peak: Math.max(...lanternVale.world.passes.map((p) => p.p[1])),
        };
      }, shot);
      assert(state.far > Math.hypot(shot.distance, 1500));
      await page.waitForTimeout(1600);
      await page.screenshot({ path: `${output}/${code}-${shot.name}.png` });
    }
    results.push({ code, views: shots.map((s) => s.name) });
    console.log(`Captured ${code}: preview and ${shots.length} in-game views`);
    await context.close();
  }
  assert.deepEqual(errors, []);
  await writeFile(
    `${output}/results.json`,
    JSON.stringify({ results, errors }, null, 2),
  );
} finally {
  await browser.close();
}
