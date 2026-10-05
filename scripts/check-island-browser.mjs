// Local integration QA. PLAYWRIGHT_MODULE may point to an installed Playwright package.
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
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
const context = await browser.newContext({
  viewport: { width: 1100, height: 850 },
});
const page = await context.newPage(),
  errors = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});
await mkdir("/tmp/island-qa", { recursive: true });
const base = process.env.ISLAND_URL ?? "http://127.0.0.1:5177/";
const ready = () =>
  page.waitForFunction(
    () => window.lanternVale?.state.ready,
    {},
    { timeout: 90000 },
  );
async function choose(code) {
  await page.locator("#previewSeed").fill(code);
  await page.locator("#previewSeedForm button").click();
  await page.locator("#keepIsland").waitFor({ state: "visible" });
  await page.waitForFunction(
    () => !document.getElementById("keepIsland").disabled,
    {},
    { timeout: 45000 },
  );
}
try {
  await page.goto(`${base}?island=PS1-0000A301#debug`);
  await page.waitForFunction(
    () => !document.getElementById("keepIsland").disabled,
    {},
    { timeout: 60000 },
  );
  assert.equal(await page.locator("#previewSeed").inputValue(), "PS1-0000A301");
  await page
    .locator("#islandPreview")
    .screenshot({ path: "/tmp/island-qa/preview.png" });
  await page.locator("#keepIsland").click();
  await ready();
  assert.equal(await page.evaluate(() => lanternVale.world.seed), 41729);
  assert(!new URL(page.url()).searchParams.has("island"));
  await page.locator("#copyIslandLink").click();
  await page.locator("#enter").click();
  await page.waitForFunction(
    () => lanternVale.state.active,
    {},
    { timeout: 15000 },
  );
  await page.evaluate(() => lanternVale.pause());
  await page.evaluate(() => {
    document.getElementById("overlay").hidden = true;
    document.getElementById("perf").hidden = true;
    const c = lanternVale.world.castles[0];
    lanternVale.inspect(
      [c.p[0] + 380, c.p[1] + 190, c.p[2] - 440],
      [c.p[0], c.p[1] + 65, c.p[2]],
    );
  });
  await page.waitForTimeout(3500);
  await page.screenshot({ path: "/tmp/island-qa/aerial.png" });
  await page.evaluate(() => {
    document.getElementById("overlay").hidden = false;
  });
  // Disable GPU drawing for save/worker lifecycle checks after capturing actual rendering.
  await page.evaluate(() => {
    lanternVale.renderer.render = () => {};
  });
  const main = await page.evaluate(() => lanternVale.world.castles[0].p);
  await page.evaluate((p) => lanternVale.blast(p, "local"), main);
  await page.evaluate(() => lanternVale.step(4));
  const saved = await page.evaluate(() => lanternVale.save());
  assert(saved.removed.length > 0);
  await page.reload();
  await ready();
  assert.equal(await page.evaluate(() => lanternVale.world.seed), 41729);
  assert(
    (await page.evaluate(() => lanternVale.state.snapshot.stats.removed)) > 0,
  );
  await page.evaluate(() => {
    lanternVale.renderer.render = () => {};
  });
  await page.locator("#createIsland").click();
  await choose("PS1-0000002A");
  await page.locator("#keepIsland").click();
  assert(await page.locator("#islandReplacePrompt").isVisible());
  await page.locator("#backToIsland").click();
  await page.locator("#cancelIsland").click();
  assert.equal(await page.evaluate(() => lanternVale.world.seed), 41729);
  await page.locator("#createIsland").click();
  await page.locator("#previewSeed").fill("PS1-00000000");
  await page.locator("#previewSeedForm button").click();
  await choose("PS1-00000001");
  assert.equal(await page.locator("#previewSeed").inputValue(), "PS1-00000001");
  await page.locator("#cancelIsland").click();
  await page.evaluate(() => {
    window.originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      const request = window.originalPut.call(this, value, key);
      if (key === "baseline") this.transaction.abort();
      return request;
    };
  });
  await page.locator("#createIsland").click();
  await choose("PS1-0000002A");
  await page.locator("#keepIsland").click();
  await page.locator("#confirmIsland").click();
  await page.waitForFunction(() =>
    document.getElementById("status").textContent.includes("not replaced"),
  );
  assert.equal(await page.evaluate(() => lanternVale.world.seed), 41729);
  await page.evaluate(() => {
    IDBObjectStore.prototype.put = window.originalPut;
  });
  // A malformed pasted seed does not discard the valid candidate or saved world.
  await page.locator("#createIsland").click();
  await choose("PS1-0000002A");
  await page.locator("#previewSeed").fill("PS2-0000002A");
  await page.locator("#previewSeedForm button").click();
  assert.match(
    await page.locator("#islandPreviewStatus").innerText(),
    /unsupported/,
  );
  await choose("PS1-0000002A");
  await page.locator("#keepIsland").click();
  await page.locator("#confirmIsland").click();
  await page.waitForEvent("load");
  await ready();
  assert.equal(await page.evaluate(() => lanternVale.world.seed), 42);
  assert.equal(
    await page.evaluate(() => lanternVale.state.snapshot.stats.removed),
    0,
  );
  await page.evaluate(() => {
    lanternVale.renderer.render = () => {};
  });
  await page.locator("#reset").click();
  await page.locator("#confirmReset").click();
  await ready();
  assert.equal(await page.evaluate(() => lanternVale.world.seed), 42);
  // Shared links never replace a stored island without accepting its preview.
  await page.goto(`${base}?island=PS1-00000001#debug`);
  await page.waitForFunction(
    () => document.getElementById("islandPreview").open,
    {},
    { timeout: 60000 },
  );
  await page.locator("#cancelIsland").click();
  await ready();
  assert.equal(await page.evaluate(() => lanternVale.world.seed), 42);
  assert(!new URL(page.url()).searchParams.has("island"));
  const screenshots = [];
  for (const seed of ["PS1-00000000", "PS1-00000001"]) {
    await page.locator("#createIsland").click();
    await choose(seed);
    const name = `/tmp/island-qa/preview-${seed.slice(-8)}.png`;
    await page.locator("#islandPreview").screenshot({ path: name });
    screenshots.push(name);
    await page.locator("#cancelIsland").click();
  }
  await page.setViewportSize({ width: 390, height: 760 });
  await page.locator("#createIsland").click();
  await choose("PS1-0000002A");
  await page
    .locator("#islandPreview")
    .screenshot({ path: "/tmp/island-qa/preview-mobile.png" });
  assert(
    await page.evaluate(
      () =>
        document.getElementById("islandPreview").getBoundingClientRect()
          .width <= 390,
    ),
  );
  await page.locator("#cancelIsland").click();
  // A failed generation leaves Keep disabled and the existing island intact.
  await page.setViewportSize({ width: 1100, height: 850 });
  await page.evaluate(() => {
    window.RealWorker = window.Worker;
    window.Worker = class extends window.RealWorker {
      constructor(url, options) {
        super(url, options);
        if (String(url).includes("generation-worker"))
          setTimeout(
            () =>
              this.dispatchEvent(
                new MessageEvent("message", {
                  data: {
                    type: "error",
                    message: "Simulated generation failure",
                  },
                }),
              ),
            0,
          );
      }
    };
  });
  await page.locator("#createIsland").click();
  await page.waitForFunction(() =>
    document
      .getElementById("islandPreviewStatus")
      .textContent.includes("Simulated generation failure"),
  );
  assert(await page.locator("#keepIsland").isDisabled());
  await page.locator("#cancelIsland").click();
  assert.equal(await page.evaluate(() => lanternVale.world.seed), 42);
  await page.evaluate(() => {
    window.Worker = window.RealWorker;
  });
  // Storage-disabled sessions can enter and replace islands without touching prior browser saves.
  const temporaryContext = await browser.newContext({
    viewport: { width: 960, height: 720 },
  });
  await temporaryContext.addInitScript(() => {
    IDBFactory.prototype.open = function () {
      throw Error("Simulated unavailable storage");
    };
  });
  const temporary = await temporaryContext.newPage();
  temporary.on("pageerror", (error) => errors.push(error.message));
  await temporary.goto(`${base}?island=PS1-00000011#debug`);
  await temporary.waitForFunction(
    () => !document.getElementById("keepIsland").disabled,
    {},
    { timeout: 60000 },
  );
  await temporary.locator("#keepIsland").click();
  await temporary.waitForFunction(
    () => window.lanternVale?.state.ready,
    {},
    { timeout: 90000 },
  );
  assert.equal(
    await temporary.evaluate(() => lanternVale.state.saveEnabled),
    false,
  );
  await temporary.evaluate(() => {
    lanternVale.renderer.render = () => {};
  });
  await temporary.locator("#createIsland").click();
  await temporary.locator("#previewSeed").fill("PS1-0000002A");
  await temporary.locator("#previewSeedForm button").click();
  await temporary.waitForFunction(
    () => !document.getElementById("keepIsland").disabled,
    {},
    { timeout: 60000 },
  );
  await temporary.locator("#keepIsland").click();
  await temporary.locator("#confirmIsland").click();
  await temporary.waitForFunction(
    () => lanternVale.world.seed === 42 && lanternVale.state.ready,
    {},
    { timeout: 90000 },
  );
  assert.equal(
    await temporary.evaluate(() => lanternVale.state.saveEnabled),
    false,
  );
  await temporaryContext.close();
  // Version-7 recovery offers temporary play without replacing the protected save.
  const legacyContext = await browser.newContext({
      viewport: { width: 960, height: 720 },
    }),
    legacyPage = await legacyContext.newPage();
  legacyPage.on("pageerror", (error) => errors.push(error.message));
  await legacyPage.goto(`${base}?island=PS1-00000011#debug`);
  await legacyPage.waitForFunction(
    () => document.getElementById("islandPreview").open,
  );
  await legacyPage.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open("lantern-vale", 1);
        request.onsuccess = () => {
          const db = request.result,
            tx = db.transaction("worlds", "readwrite");
          tx.objectStore("worlds").put(
            {
              version: 7,
              worldVersion: 7,
              seed: 41729,
              marker: "protected-legacy",
            },
            "current",
          );
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
  );
  await legacyPage.reload();
  await legacyPage.locator("#recovery").waitFor({ state: "visible" });
  await legacyPage.keyboard.press("Escape");
  assert(await legacyPage.locator("#recovery").isVisible());
  await legacyPage.locator("#temporary").click();
  await legacyPage.waitForFunction(
    () => !document.getElementById("keepIsland").disabled,
    {},
    { timeout: 60000 },
  );
  await legacyPage.locator("#keepIsland").click();
  await legacyPage.waitForFunction(
    () => window.lanternVale?.state.ready,
    {},
    { timeout: 90000 },
  );
  assert.equal(
    await legacyPage.evaluate(() => lanternVale.state.saveEnabled),
    false,
  );
  assert.equal(
    await legacyPage.evaluate(
      () =>
        new Promise((resolve) => {
          const request = indexedDB.open("lantern-vale", 1);
          request.onsuccess = () => {
            const db = request.result,
              r = db.transaction("worlds").objectStore("worlds").get("current");
            r.onsuccess = () => {
              db.close();
              resolve(r.result.marker);
            };
          };
        }),
    ),
    "protected-legacy",
  );
  await legacyContext.close();
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      ok: true,
      seed: 42,
      savedDamage: saved.removed.length,
      screenshots,
      errors,
    }),
  );
} catch (error) {
  await page.screenshot({ path: "/tmp/island-qa/failure.png" }).catch(() => {});
  console.error("Browser errors:", errors);
  throw error;
} finally {
  await browser.close();
}
