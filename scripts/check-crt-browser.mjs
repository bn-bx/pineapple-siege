// Isolated functional checks and short local timings, not performance certification.
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ?? "playwright"
);
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
const output = process.env.CRT_QA_OUTPUT ?? "/tmp/siege-crt";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath:
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  hasTouch: true,
});
const page = await context.newPage();
page.setDefaultTimeout(120000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
const result = {};
const select = async (mode) => {
  await page.locator("#crtMode").selectOption(mode);
  await page.waitForTimeout(150);
};
const capture = async (label) => {
  const data = await page.evaluate(async () => {
    const b = await lanternVale.view.capture();
    return await new Promise((r) => {
      const f = new FileReader();
      f.onload = () => r(f.result.split(",")[1]);
      f.readAsDataURL(b);
    });
  });
  await writeFile(`${output}/${label}.png`, Buffer.from(data, "base64"));
};
try {
  await page.goto(
    (process.env.ISLAND_URL ?? "http://127.0.0.1:5177/") +
      "?island=PS2-0000A301#debug",
  );
  await page.waitForFunction(
    () => !document.querySelector("#keepIsland").disabled,
  );
  await page.locator("#keepIsland").click();
  await page.waitForFunction(() => window.lanternVale?.state.ready);
  assert.equal(await page.locator("#crtMode").inputValue(), "subtle");
  await page.evaluate(() => {
    lanternVale.inspect([1650, 280, 1250], [1800, 70, 1550]);
    lanternVale.view.setQuality("720");
    window.crtTargets = [
      lanternVale.view.presentation.composer.renderTarget1,
      lanternVale.view.presentation.composer.renderTarget2,
    ];
  });
  for (const hour of [15.5, 22]) {
    await page.locator("#time").evaluate((e, h) => {
      e.value = String(h);
      e.dispatchEvent(new Event("input"));
    }, hour);
    await page.waitForTimeout(200);
    for (const mode of ["off", "subtle", "retro"]) {
      await select(mode);
      await capture(`${hour === 22 ? "night" : "day"}-${mode}`);
    }
  }
  result.sameTargets = await page.evaluate(() =>
    crtTargets.every(
      (t, i) =>
        t ===
        [
          lanternVale.view.presentation.composer.renderTarget1,
          lanternVale.view.presentation.composer.renderTarget2,
        ][i],
    ),
  );
  assert(result.sameTargets);
  await page.locator("#reduceEffects").check();
  assert.equal(
    await page.evaluate(() => lanternVale.view.presentation.crt.enabled),
    true,
  );
  await page.setViewportSize({ width: 390, height: 760 });
  await page.waitForTimeout(300);
  await capture("mobile-retro");
  result.resize = await page.evaluate(() => ({
    uniform:
      lanternVale.view.presentation.crt.uniforms.resolution.value.toArray(),
    buffer: [
      lanternVale.renderer.domElement.width,
      lanternVale.renderer.domElement.height,
    ],
  }));
  assert.deepEqual(result.resize.uniform, result.resize.buffer);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.locator("#time").evaluate((e) => {
    e.value = "15.5";
    e.dispatchEvent(new Event("input"));
  });
  await page.locator("#enter").click();
  await page.waitForFunction(() => lanternVale.state.active);
  await page.evaluate(() => lanternVale.photo());
  await page.waitForFunction(() => document.body.classList.contains("photo"));
  for (const mode of ["off", "subtle", "retro"]) {
    await page.evaluate((m) => lanternVale.view.setCRTMode(m), mode);
    await capture(`photo-${mode}`);
  }
  const download = page.waitForEvent("download");
  await page.locator("#savePhoto").click();
  await (await download).saveAs(`${output}/export-retro.png`);
  await page.evaluate(() => lanternVale.photo());
  await page.waitForFunction(() => lanternVale.state.active);
  await page.evaluate(() => lanternVale.pause());
  await select("retro");
  await page.evaluate(() => {
    window.ext = lanternVale.loseContext();
    ext.loseContext();
  });
  await page.waitForFunction(() =>
    document
      .querySelector("#status")
      .textContent.includes("Waiting for recovery"),
  );
  await page.waitForTimeout(500);
  await page.evaluate(() => ext.restoreContext());
  await page.waitForFunction(() =>
    document.querySelector("#status").textContent.includes("Graphics restored"),
  );
  assert.equal(
    await page.evaluate(
      () => lanternVale.view.presentation.crt.uniforms.retro.value,
    ),
    1,
  );
  await capture("recovery-retro");
  result.recovery = true;
  await page.reload();
  await page.waitForFunction(() => window.lanternVale?.state.ready);
  assert.equal(await page.locator("#crtMode").inputValue(), "retro");
  result.persisted = true;
  await page.locator("#defaultSettings").click();
  assert.equal(await page.locator("#crtMode").inputValue(), "subtle");
  assert.equal(
    await page.evaluate(
      () => lanternVale.view.presentation.crt.uniforms.retro.value,
    ),
    0,
  );
  result.reset = true;
  // Identical frozen scene and quality, with warmup discarded for each mode.
  await page.evaluate(() => {
    lanternVale.inspect([1650, 280, 1250], [1800, 70, 1550]);
    lanternVale.setQuality("720");
  });
  result.timings = {};
  for (const mode of ["off", "subtle", "retro", "off"]) {
    await select(mode);
    await page.waitForTimeout(500);
    await page.evaluate(() => lanternVale.view.performance.reset());
    await page.waitForTimeout(2500);
    const timing = await page.evaluate(
      () => lanternVale.state.performance.stages,
    );
    result.timings[mode] = (result.timings[mode] ?? []).concat([timing]);
  }
  await page.locator("#enter").click();
  await page.waitForFunction(() => lanternVale.state.active);
  await page.evaluate(() => lanternVale.blast([1800, 60, 1550], "local"));
  await page.waitForTimeout(1200);
  await page.evaluate(() => lanternVale.pause());
  for (const mode of ["off", "subtle", "retro"]) {
    await select(mode);
    await capture(`explosion-${mode}`);
  }
  assert.deepEqual(errors, []);
  result.errors = errors;
  await writeFile(`${output}/result.json`, JSON.stringify(result, null, 2));
  console.log(
    "CRT presets, export, resize, persistence, defaults, and recovery passed; timings saved to",
    output,
  );
} catch (e) {
  console.log("CHECK FAILED", e);
  console.log(errors);
  await page.screenshot({ path: `${output}/failure.png` });
  throw e;
} finally {
  await browser.close();
}
