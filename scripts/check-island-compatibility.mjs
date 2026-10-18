// Historical layouts belong to recovery. Verify temporary play preserves every
// protected record byte-for-byte using a genuine revision-1 baseline fixture.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { seedCode } from "../src/world/generator.mjs";
import { VERTICAL_LIMITS } from "../src/world/vertical-limits.mjs";

assert(
  process.env.ISLAND_V1_WORLD && process.env.ISLAND_V1_HEIGHTS,
  "Supply ISLAND_V1_WORLD and ISLAND_V1_HEIGHTS fixture paths",
);
const world = JSON.parse(await readFile(process.env.ISLAND_V1_WORLD, "utf8"));
const bytes = await readFile(process.env.ISLAND_V1_HEIGHTS);
assert.equal(world.generatorVersion, 1);
assert.equal(bytes.byteLength, world.grid ** 2 * 4);
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
const errors = [];
let page;
try {
  const context = await browser.newContext({
    viewport: { width: 1100, height: 760 },
  });
  page = await context.newPage();
  page.setDefaultTimeout(90000);
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.route("**/qa-v1-world.bin", (route) =>
    route.fulfill({ body: bytes, contentType: "application/octet-stream" }),
  );
  await page.goto(
    `${process.env.ISLAND_URL ?? "http://127.0.0.1:5177/"}?island=${seedCode(41729)}#debug`,
  );
  await page.locator("#islandPreview").waitFor({ state: "visible" });
  // Install before accepting any candidate, so no active worker can overwrite
  // the historical snapshot through blur/pagehide captures.
  await page.evaluate(async (world) => {
    const heights = new Float32Array(
      await (await fetch("/qa-v1-world.bin")).arrayBuffer(),
    );
    const index = Math.floor(heights.length / 2);
    await new Promise((resolve, reject) => {
      const request = indexedDB.open("lantern-vale", 1);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction("worlds", "readwrite");
        const store = tx.objectStore("worlds");
        store.put({ world, heights }, "baseline");
        store.put(
          {
            version: 8,
            worldVersion: world.version,
            generatorVersion: 1,
            seed: world.seed,
            marker: "protected-historical-damage",
            removed: [0],
            terrain: new Float32Array([index, heights[index] - 5]),
            laserDry: new Uint32Array([index]),
            sectioned: true,
          },
          "current",
        );
        // Incompatible sections must remain opaque and protected as well.
        store.put({ marker: "protected-historical-section" }, "section:0");
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
      request.onerror = () => reject(request.error);
    });
  }, world);
  const fingerprints = () =>
    page.evaluate(async () => {
      const records = await new Promise((resolve, reject) => {
        const request = indexedDB.open("lantern-vale", 1);
        request.onsuccess = () => {
          const db = request.result;
          const store = db.transaction("worlds").objectStore("worlds");
          const keys = store.getAllKeys(),
            values = store.getAll();
          values.onsuccess = () => {
            db.close();
            resolve(keys.result.map((key, i) => [key, values.result[i]]));
          };
          values.onerror = () => reject(values.error);
        };
        request.onerror = () => reject(request.error);
      });
      const digest = async (data) =>
        Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", data)))
          .map((n) => n.toString(16).padStart(2, "0"))
          .join("");
      const result = {};
      for (const [key, value] of records) {
        if (key === "preferences") continue;
        const encoded = JSON.stringify(value, (field, item) =>
          field === "heights"
            ? undefined
            : ArrayBuffer.isView(item)
              ? [...item]
              : item,
        );
        result[key] = await digest(new TextEncoder().encode(encoded));
        if (value.heights)
          result[key + ":heights"] = await digest(value.heights);
      }
      return result;
    });
  const protectedRecords = await fingerprints();
  await page.reload();
  await page.locator("#recovery").waitFor({ state: "visible" });
  await page.keyboard.press("Escape");
  assert(await page.locator("#recovery").isVisible());
  assert.deepEqual(await fingerprints(), protectedRecords);
  await page.locator("#temporary").click();
  await page.waitForFunction(
    () => !document.getElementById("keepIsland").disabled,
  );
  await page.locator("#keepIsland").click();
  await page.waitForFunction(() => window.lanternVale?.state.ready);
  assert.equal(await page.evaluate(() => lanternVale.state.saveEnabled), false);
  await page.evaluate(() => lanternVale.enter());
  const center = await page.evaluate(() => lanternVale.world.castle);
  await page.evaluate(
    ({ center, warning }) =>
      lanternVale.setPlane([center[0], warning + 10, center[2]], 0, 0),
    { center, warning: VERTICAL_LIMITS.warning },
  );
  await page.waitForFunction(
    () => !document.getElementById("ceilingWarning").hidden,
  );
  assert.match(
    await page.locator("#ceilingWarning").innerText(),
    /APPROACHING FLIGHT CEILING.*ABOVE SEA LEVEL/,
  );
  await page.evaluate(
    ({ center, assistance }) =>
      lanternVale.setPlane([center[0], assistance + 10, center[2]], 0, 0),
    { center, assistance: VERTICAL_LIMITS.assistance },
  );
  await page.waitForFunction(() =>
    document
      .getElementById("ceilingWarning")
      .textContent.includes("CEILING ASSISTANCE"),
  );
  await page.evaluate(() => lanternVale.pause());
  assert(await page.locator("#ceilingWarning").isHidden());
  await page.evaluate(async () => {
    lanternVale.blast(lanternVale.world.castle, "valley");
    await lanternVale.step(4);
    await lanternVale.save();
    await lanternVale.reset();
    await lanternVale.save();
  });
  assert.deepEqual(await fingerprints(), protectedRecords);
  await page.reload();
  await page.locator("#recovery").waitFor({ state: "visible" });
  assert.deepEqual(await fingerprints(), protectedRecords);
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      ok: true,
      checks: [
        "historical baseline and damage require recovery",
        "Escape cannot bypass recovery",
        "temporary play disables saves",
        "warning and assistance use sea-level labels",
        "temporary damage, reset, save and reload preserve historical records",
      ],
      errors,
    }),
  );
} catch (error) {
  if (page) {
    await page
      .screenshot({ path: "/tmp/island-compatibility-failure.png" })
      .catch(() => {});
    console.error(
      await page
        .evaluate(() => ({
          status: document.getElementById("status")?.textContent,
          preview: document.getElementById("islandPreviewStatus")?.textContent,
          fatal: document.getElementById("fatalMessage")?.textContent,
          errors: document.getElementById("fatalDetails")?.textContent,
        }))
        .catch(() => ({})),
    );
  }
  throw error;
} finally {
  await browser.close();
}
