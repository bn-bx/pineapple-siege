const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ?? "playwright"
);
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
const out = fileURLToPath(
  new URL("../artifacts/island-overhaul/", import.meta.url),
);
const base = process.env.ISLAND_URL ?? "http://127.0.0.1:5177/";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH ??
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: process.env.HEADLESS === "1",
  args: [
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-timer-throttling",
  ],
});
const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  }),
  page = await context.newPage(),
  errors = [];
page.setDefaultTimeout(120000);
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
const state = async () =>
  page.evaluate(() => ({
    status: document.getElementById("islandPreviewStatus")?.textContent,
    fatal: document.getElementById("fatalDetail")?.textContent,
  }));
async function exact(code) {
  await page.locator("#islandSeedDetails").evaluate((e) => (e.open = true));
  await page.locator("#previewSeed").fill(code);
  await page.locator("#previewSeedForm button").click();
  await page.waitForFunction(
    () => !document.getElementById("keepIsland").disabled,
  );
}
async function ready() {
  await page.waitForFunction(
    () =>
      window.lanternVale?.state.ready &&
      window.lanternVale.state.snapshot &&
      !document.getElementById("enter").disabled,
  );
}
try {
  await page.goto(`${base}#debug`);
  await page.locator("#islandPreview").waitFor({ state: "visible" });
  await page.locator("#rerollIsland").click();
  await page.locator("#rerollIsland").click();
  await page.waitForFunction(
    () => !document.getElementById("keepIsland").disabled,
  );
  assert.equal(await page.locator("#islandPreset, #islandLayouts").count(), 0);
  assert(await page.locator("#islandMap").isVisible());
  assert(!(await page.locator("#previewSeed").isVisible()));
  await page
    .locator("#islandPreview")
    .screenshot({ path: out + "/single-island-preview.png" });
  await page.locator("#keepIsland").click();
  await ready();
  assert.equal(
    await page.evaluate(() => lanternVale.world.generatorVersion),
    7,
  );
  await page.evaluate(() =>
    lanternVale.blast(lanternVale.world.castle, "local"),
  );
  await page.evaluate(() => lanternVale.step(4));
  const freshSave = await page.evaluate(() => lanternVale.save());
  assert(freshSave.removed.length > 0);
  await page.reload();
  await ready();
  assert.equal(
    await page.evaluate(() => lanternVale.world.generatorVersion),
    7,
  );
  assert(
    (await page.evaluate(() => lanternVale.state.snapshot.stats.removed)) > 0,
  );
  await page.locator("#createIsland").click();
  await exact("PS5-R-0000002A");
  await page
    .locator("#islandPreview")
    .screenshot({ path: out + "/riverlands-final-preview.png" });
  await page.locator("#keepIsland").click();
  await Promise.all([
    page.waitForEvent("domcontentloaded"),
    page.locator("#confirmIsland").click(),
  ]);
  await ready();
  assert.equal(
    await page.evaluate(() => lanternVale.world.generationPreset),
    "R",
  );
  const renderer = await page.evaluate(() => {
    const gl = document.querySelector("#world").getContext("webgl2"),
      ext = gl?.getExtension("WEBGL_debug_renderer_info");
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : "unavailable";
  });
  await page.locator("#crtMode").selectOption("off");
  await page.locator("#enter").click();
  await page.waitForFunction(() => lanternVale.state.active);
  await page.evaluate(() => lanternVale.pause());
  const features = await page.evaluate(() => ({
    lake: lanternVale.world.lakes[0],
    castle: lanternVale.world.castles[0],
    fall: [...lanternVale.world.waterfalls].sort(
      (a, b) => b.top[1] - b.bottom[1] - (a.top[1] - a.bottom[1]),
    )[0],
  }));
  for (const [name, feature] of Object.entries(features)) {
    const p =
      name === "lake"
        ? [feature.center[0], feature.level, feature.center[1]]
        : name === "fall"
          ? feature.bottom
          : feature.p;
    await page.evaluate(
      ({ p, name, feature }) => {
        document.getElementById("overlay").hidden = true;
        document.getElementById("perf").hidden = true;
        const distance = name === "castle" ? 700 : 220,
          ground = lanternVale.terrain(p[0] + distance, p[2] - distance);
        const altitude =
          name === "castle"
            ? p[1] + 450
            : Math.max(
                p[1] + 170,
                ground + 120,
                name === "fall" ? feature.top[1] + 150 : 0,
              );
        lanternVale.inspect(
          [p[0] + distance, altitude, p[2] - distance],
          [p[0], name === "castle" ? p[1] + 65 : p[1] + 12, p[2]],
        );
      },
      { p, name, feature },
    );
    await page.waitForTimeout(2500);
    await page.screenshot({ path: out + `/riverlands-${name}.png` });
  }
  await page.evaluate(() => {
    document.getElementById("overlay").hidden = false;
    lanternVale.blast(lanternVale.world.castle, "local");
  });
  await page.evaluate(() => lanternVale.step(4));
  const saved = await page.evaluate(async () => {
    while (
      document.getElementById("saveStatus").textContent === "Saving world…"
    )
      await new Promise((r) => setTimeout(r, 20));
    return lanternVale.save();
  });
  console.log(
    "save",
    saved.removed.length,
    saved.revision,
    await page.evaluate(() => ({
      savedRevision: lanternVale.state.savedRevision,
      saveEnabled: lanternVale.state.saveEnabled,
      status: document.getElementById("saveStatus").textContent,
    })),
  );
  assert(saved.removed.length > 0);
  assert.equal(saved.generationPreset, "R");
  await page.reload();
  await ready();
  console.log(
    "reload",
    await page.evaluate(() => ({
      revision: lanternVale.state.snapshot.stats.revision,
      removed: lanternVale.state.snapshot.stats.removed,
      saveEnabled: lanternVale.state.saveEnabled,
      preset: lanternVale.world.generationPreset,
    })),
  );
  assert.equal(
    await page.evaluate(() => lanternVale.world.generationPreset),
    "R",
  );
  assert(
    (await page.evaluate(() => lanternVale.state.snapshot.stats.removed)) > 0,
  );
  for (const destination of ["hell", "surface"]) {
    await page.evaluate(() => {
      const site = lanternVale.world.portal,
        plane = {
          ...lanternVale.state.snapshot.plane,
          p: [site.x, site.y + 30, site.z],
          v: [0, -100, 0],
          yaw: 0,
          pitch: -1.12,
          speed: 130,
          crashed: 0,
          falling: false,
        };
      lanternVale.send({ type: "setPlane", plane, grace: 0 });
      lanternVale.send({ type: "debugStep", steps: 50 });
    });
    await page.waitForFunction(
      (realm) => lanternVale.world.realm === realm && lanternVale.state.ready,
      destination,
    );
    await ready();
    await page.evaluate(() => lanternVale.pause());
  }
  await page.locator("#createIsland").click();
  await exact("PS4-0000002A");
  await page.locator("#keepIsland").click();
  assert(await page.locator("#islandReplacePrompt").isVisible());
  await page.locator("#backToIsland").click();
  await page.locator("#cancelIsland").click();
  assert.equal(
    await page.evaluate(() => lanternVale.world.generationPreset),
    "R",
  );
  await page.locator("#createIsland").click();
  await exact("PS4-0000002A");
  await page.locator("#keepIsland").click();
  await Promise.all([
    page.waitForEvent("domcontentloaded"),
    page.locator("#confirmIsland").click(),
  ]);
  await ready();
  assert.equal(
    await page.evaluate(() => lanternVale.world.generatorVersion),
    4,
  );
  await page.evaluate(() => {
    lanternVale.blast(lanternVale.world.castle, "local");
  });
  await page.evaluate(() => lanternVale.step(4));
  const oldSave = await page.evaluate(() => lanternVale.save());
  assert(oldSave.removed.length > 0);
  await page.reload();
  await ready();
  assert.equal(
    await page.evaluate(() => lanternVale.world.generatorVersion),
    4,
  );
  assert(
    (await page.evaluate(() => lanternVale.state.snapshot.stats.removed)) > 0,
  );
  await context.newPage().then(async (touch) => {
    await touch.setViewportSize({ width: 390, height: 844 });
    await touch.goto(`${base}?island=PS7-00000005#debug`);
    await touch.locator("#islandPreview").waitFor({ state: "visible" });
    await touch.waitForFunction(
      () => !document.getElementById("keepIsland").disabled,
    );
    await touch
      .locator("#islandPreview")
      .screenshot({ path: out + "/mobile-preview.png" });
    await touch.locator("#cancelIsland").click();
    await touch.close();
  });
  assert.deepEqual(errors, []);
  await writeFile(
    out + "/browser-qa.json",
    JSON.stringify(
      {
        ok: true,
        renderer,
        checks: [
          "single-island flow and rapid cancellation",
          "collapsed seed import",
          "revision-7 destruction save and reload",
          "PS5 save reload",
          "PS5 round-trip realm travel",
          "replacement cancellation",
          "PS4 save reload",
          "mobile preview",
        ],
        errors,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ ok: true, renderer, errors }));
} catch (error) {
  console.error(error, await state());
  await page.screenshot({ path: out + "/browser-failure.png" });
  await writeFile(
    out + "/browser-failure.json",
    JSON.stringify(
      { message: error.message, errors, state: await state() },
      null,
      2,
    ),
  );
  process.exitCode = 1;
} finally {
  await browser.close();
}
