// Isolated functional checks; this headless run is not a performance certification.
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ?? "playwright"
);
import assert from "node:assert/strict";
import { writeFile, mkdir } from "node:fs/promises";
await mkdir("/tmp/siege-simplification", { recursive: true });
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH ??
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
  await page.screenshot({ path: "/tmp/siege-simplification/menu.png" });
  await page.locator("#enter").click();
  await page.waitForFunction(() => lanternVale.state.active);
  await page.evaluate(() => lanternVale.pause());
  await page.setViewportSize({ width: 390, height: 760 });
  await page.locator("#enter").tap();
  await page.waitForFunction(() => lanternVale.state.active);
  const cdp = await context.newCDPSession(page);
  const boxes = await Promise.all(
    ["[data-stick]", '[data-key="Space"]', '[data-key="ShiftLeft"]'].map((s) =>
      page.locator(s).boundingBox(),
    ),
  );
  const points = boxes.map((r, i) => ({
    id: i + 1,
    x: r.x + r.width * (i === 0 ? 0.8 : 0.5),
    y: r.y + r.height * 0.5,
  }));
  const shots = await page.evaluate(
    () => lanternVale.state.snapshot.stats.shots,
  );
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: points,
  });
  await page.waitForTimeout(400);
  assert.equal(await page.locator(".held").count(), 2);
  assert.notEqual(
    await page
      .locator("[data-stick]")
      .evaluate((e) => e.style.getPropertyValue("--stick-x")),
    "0px",
  );
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await page.waitForTimeout(200);
  assert.equal(await page.locator(".held").count(), 0);
  assert.equal(
    await page
      .locator("[data-stick]")
      .evaluate((e) => e.style.getPropertyValue("--stick-x")),
    "0px",
  );
  assert(
    (await page.evaluate(() => lanternVale.state.snapshot.stats.shots)) > shots,
  );
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.keyboard.press("c");
  assert.equal(
    await page.evaluate(() => lanternVale.state.cameraMode),
    "cinematic",
  );
  await page.keyboard.press("p");
  await page.waitForFunction(() => document.body.classList.contains("photo"));
  const time = await page.evaluate(() => lanternVale.state.snapshot.time);
  await page.waitForTimeout(700);
  assert.equal(
    await page.evaluate(() => lanternVale.state.snapshot.time),
    time,
  );
  const originalCamera = await page.evaluate(() => lanternVale.camera.position);
  await page.keyboard.down("w");
  await page.waitForTimeout(300);
  await page.keyboard.up("w");
  assert.notDeepEqual(
    await page.evaluate(() => lanternVale.camera.position),
    originalCamera,
  );
  await page.locator("#photoFocus").evaluate((e) => (e.value = "100"));
  await page.locator("#photoFocus").dispatchEvent("input");
  const download = page.waitForEvent("download");
  await page.locator("#savePhoto").click();
  await (await download).saveAs("/tmp/siege-simplification/photo.png");
  await page.keyboard.press("p");
  await page.waitForFunction(() => lanternVale.state.active);
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !lanternVale.state.active);
  const paused = await page.evaluate(() => lanternVale.state.snapshot.time);
  await page.waitForTimeout(700);
  assert.equal(
    await page.evaluate(() => lanternVale.state.snapshot.time),
    paused,
  );
  await page.evaluate(() => {
    window.graphicsExtension = lanternVale.loseContext();
    graphicsExtension.loseContext();
  });
  await page.waitForFunction(() =>
    document
      .querySelector("#status")
      .textContent.includes("Waiting for recovery"),
  );
  await page.waitForTimeout(1000);
  await page.evaluate(() => graphicsExtension.restoreContext());
  await page.waitForFunction(() =>
    document.querySelector("#status").textContent.includes("Graphics restored"),
  );
  assert.equal(await page.evaluate(() => lanternVale.state.ready), true);
  await page.screenshot({ path: "/tmp/siege-simplification/recovery.png" });
  assert.deepEqual(errors, []);
  await writeFile(
    "/tmp/siege-simplification/controls.json",
    JSON.stringify(
      {
        ok: true,
        touchSimultaneous: true,
        photoFreeze: true,
        pauseFreeze: true,
        export: true,
        graphicsRecovery: true,
        errors,
      },
      null,
      2,
    ),
  );
  console.log("Controls/photo/recovery passed");
} catch (e) {
  console.log(
    JSON.stringify(
      await page.evaluate(() => ({
        status: document.querySelector("#status").textContent,
        fatal: document.querySelector("#fatalDetails").textContent,
        ready: lanternVale.state.ready,
        warmup: lanternVale.view.warmupStages,
        graphicsLost: lanternVale.view.graphicsLost,
        contextLost: lanternVale.renderer.getContext().isContextLost(),
      })),
    ),
  );
  console.log(errors);
  throw e;
} finally {
  await browser.close();
}
