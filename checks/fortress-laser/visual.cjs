const {
  chromium,
} = require("/Users/bradenbax/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const fs = require("node:fs");
const path = require("node:path");
const dir = path.resolve("checks/fortress-laser");
(async () => {
  const browser = await chromium.launch({
    executablePath:
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
    args: ["--enable-webgl", "--ignore-gpu-blocklist"],
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto("http://127.0.0.1:4206/#debug");
  await page.waitForFunction(() => window.lanternVale?.state.ready, null, {
    timeout: 60000,
  });
  await page.evaluate(() => {
    document.getElementById("overlay").hidden = true;
    document.getElementById("flightHUD").hidden = false;
  });
  await page.evaluate(() => {
    const a = window.lanternVale;
    a.send({ type: "hour", hour: 12 });
    a.inspect([1700, 370, 600], [1320, 85, 1070]);
  });
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(dir, "castle.png") });
  await page.evaluate(() => {
    const a = window.lanternVale;
    a.setPlane([900, 420, 700], 0, 0);
    a.send({ type: "weapon", weapon: "laser" });
    a.laser([1320, 10, 1070]);
  });
  await page.evaluate(() => window.lanternVale.step(180));
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(dir, "charge.png") });
  await page.evaluate(() => lanternVale.send({ type: "hour", hour: 0 }));
  await page.waitForTimeout(350);
  await page.screenshot({ path: path.join(dir, "charge-night.png") });
  await page.evaluate(() => lanternVale.send({ type: "hour", hour: 12 }));
  await page.evaluate(() => window.lanternVale.step(90));
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(dir, "beam.png") });
  await page.evaluate(() => lanternVale.send({ type: "hour", hour: 0 }));
  await page.waitForTimeout(350);
  await page.screenshot({ path: path.join(dir, "beam-night.png") });
  await page.evaluate(() => lanternVale.send({ type: "hour", hour: 12 }));
  await page.evaluate(() => window.lanternVale.step(270));
  for (let i = 0; i < 10; i++) {
    if (
      await page.evaluate(
        () => window.lanternVale.state.snapshot.stats.pendingJobs === 0,
      )
    )
      break;
    await page.evaluate(() => window.lanternVale.step(30));
  }
  await page.evaluate(() =>
    window.lanternVale.inspect([1520, 320, 720], [1320, -180, 1070]),
  );
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(dir, "crater.png") });
  const state = await page.evaluate(async () => {
    const a = window.lanternVale,
      s = await a.snapshot();
    return {
      stats: a.state.snapshot.stats,
      render: a.state.render,
      depth: a.terrain(1320, 1070),
      drySamples: s.laserDry.length,
      lasers: s.lasers.length,
      saveBytes:
        s.terrain.byteLength +
        s.laserDry.byteLength +
        JSON.stringify({ ...s, terrain: [], laserDry: [] }).length,
    };
  });
  fs.writeFileSync(
    path.join(dir, "visual-report.json"),
    JSON.stringify({ ...state, errors }, null, 2),
  );
  console.log(JSON.stringify({ ...state, errors }, null, 2));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
