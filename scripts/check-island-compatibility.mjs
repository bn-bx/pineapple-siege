// Run against genuine revision-1 fixture files exported before updating generation.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ?? "playwright"
);
assert(
  process.env.ISLAND_V1_WORLD && process.env.ISLAND_V1_HEIGHTS,
  "Supply ISLAND_V1_WORLD and ISLAND_V1_HEIGHTS fixture paths",
);
const world = JSON.parse(await readFile(process.env.ISLAND_V1_WORLD, "utf8"));
const bytes = await readFile(process.env.ISLAND_V1_HEIGHTS);
assert.equal(world.generatorVersion, 1);
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH ??
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--enable-unsafe-swiftshader"],
});
const errors = [];
try {
  const context = await browser.newContext({
    viewport: { width: 1100, height: 760 },
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.route("**/qa-v1-world.bin", (route) =>
    route.fulfill({ body: bytes, contentType: "application/octet-stream" }),
  );
  await page.goto(
    `${process.env.ISLAND_URL ?? "http://127.0.0.1:5177/"}?island=PS2-0000A301#debug`,
  );
  await page.waitForFunction(
    () => !document.getElementById("keepIsland").disabled,
    {},
    { timeout: 60000 },
  );
  await page.locator("#keepIsland").click();
  await page.waitForFunction(
    () => window.lanternVale?.state.ready,
    {},
    { timeout: 90000 },
  );
  await page.evaluate(() => lanternVale.enter());
  await page.evaluate(() => lanternVale.setPlane([3072, 1260, 3072], 0, 0));
  await page.waitForFunction(
    () => !document.getElementById("ceilingWarning").hidden,
  );
  assert.match(
    await page.locator("#ceilingWarning").innerText(),
    /APPROACHING FLIGHT CEILING.*ABOVE SEA LEVEL/,
  );
  await page.evaluate(() => lanternVale.setPlane([3072, 1360, 3072], 0, 0));
  await page.waitForFunction(() =>
    document
      .getElementById("ceilingWarning")
      .textContent.includes("CEILING ASSISTANCE"),
  );
  await page.evaluate(() => lanternVale.pause());
  assert(await page.locator("#ceilingWarning").isHidden());
  console.log("HUD verified");
  await page.evaluate(() => lanternVale.save());
  const pristine = await page.evaluate(() => lanternVale.snapshot());
  // Isolate fixture installation from pagehide/blur captures by the outgoing world.
  await page.evaluate(() => {
    const original = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (message, ...args) {
      if (message.type === "capture") {
        queueMicrotask(() =>
          this.dispatchEvent(
            new MessageEvent("message", {
              data: {
                id: message.id,
                commit: { revision: 0, hour: 15, slices: [], storageMS: 0 },
              },
            }),
          ),
        );
        return;
      }
      return original.call(this, message, ...args);
    };
  });
  await page.evaluate(
    async ({ world, pristine }) => {
      const heights = new Float32Array(
        await (await fetch("/qa-v1-world.bin")).arrayBuffer(),
      );
      const index = 1500 * world.grid + 1500;
      const saved = {
        ...pristine,
        version: 8,
        worldVersion: 8,
        generatorVersion: 1,
        seed: world.seed,
        sectioned: undefined,
        moving: undefined,
        civilians: undefined,
        settlements: undefined,
        monsters: undefined,
        removed: [0],
        laserDry: new Uint32Array(),
        terrain: new Float32Array([index, heights[index] - 5]),
        ruins: [],
        pendingJobs: [],
        lasers: [],
        laserWork: [],
        laserSupport: [],
      };
      await new Promise((resolve, reject) => {
        const request = indexedDB.open("lantern-vale", 1);
        request.onsuccess = () => {
          const db = request.result,
            tx = db.transaction("worlds", "readwrite"),
            store = tx.objectStore("worlds");
          // Clear revision-2 section deltas before installing the historical save.
          const cursor = store.openCursor();
          cursor.onsuccess = () => {
            const c = cursor.result;
            if (c) {
              if (String(c.key).startsWith("section:")) c.delete();
              c.continue();
            }
          };
          store.put({ world, heights }, "baseline");
          store.put(saved, "current");
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
        request.onerror = () => reject(request.error);
      });
    },
    { world, pristine },
  );
  console.log("Historical fixture installed; reloading");
  await page.reload();
  await page.waitForFunction(
    () => window.lanternVale?.state.ready,
    {},
    { timeout: 90000 },
  );
  assert.equal(
    await page.evaluate(() => lanternVale.world.generatorVersion),
    1,
  );
  assert(await page.locator("#recovery").evaluate((e) => !e.open));
  console.log("Historical world ready");
  const restored = await page.evaluate(() => lanternVale.snapshot());
  assert.equal(restored.generatorVersion, 1);
  assert(restored.removed.includes(0));
  assert.equal(
    await page.evaluate(() => lanternVale.world.entities.length),
    world.entities.length,
  );
  console.log("Historical damage verified");
  await page.locator("#copySeed").click();
  assert.equal(
    await page.evaluate(() => navigator.clipboard.readText()),
    "PS1-0000A301",
  );
  const sample = await page.evaluate(() => lanternVale.terrain(3000, 3000));
  const baselineHeight = bytes.readFloatLE((1500 * world.grid + 1500) * 4);
  assert(Math.abs(sample - (baselineHeight - 5)) < 0.001);
  console.log("Historical sharing verified; resetting");
  await page.evaluate(() => lanternVale.reset());
  assert(
    Math.abs(
      (await page.evaluate(() => lanternVale.terrain(3000, 3000))) -
        baselineHeight,
    ) < 0.001,
  );
  assert.equal(
    await page.evaluate(() => lanternVale.world.generatorVersion),
    1,
  );
  assert.equal(
    (await page.evaluate(() => lanternVale.snapshot())).removed.length,
    0,
  );
  await page.evaluate(() => lanternVale.save());
  await page.reload();
  await page.waitForFunction(
    () => window.lanternVale?.state.ready,
    {},
    { timeout: 90000 },
  );
  assert.equal(
    await page.evaluate(() => lanternVale.world.generatorVersion),
    1,
  );
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      ok: true,
      checks: [
        "sea-level warning labels",
        "assistance indicator",
        "pause hides warning",
        "revision-1 reload and damage",
        "revision-1 seed sharing",
        "reset retains exact historical terrain",
        "revision-1 save round trip",
      ],
      errors,
    }),
  );
} catch (error) {
  console.log("Browser errors:", errors);
  throw error;
} finally {
  await browser.close();
}
