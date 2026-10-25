import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ?? "playwright"
);
const base = process.env.ISLAND_URL ?? "http://127.0.0.1:5177/";
const out = "artifacts/release-integration";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH ??
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: false,
});
const errors = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  page.setDefaultTimeout(120000);
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  const ready = () =>
    page.waitForFunction(
      () =>
        window.lanternVale?.state.ready &&
        lanternVale.state.snapshot &&
        !document.getElementById("enter").disabled,
    );
  await page.goto(`${base}?island=PS7-0000A301#debug`);
  await page.waitForFunction(
    () => !document.getElementById("keepIsland").disabled,
  );
  await page.locator("#keepIsland").click();
  await ready();
  assert.equal(
    await page.evaluate(() => lanternVale.world.generatorVersion),
    7,
  );
  // Odd global indices above 2^24 require the exact Uint32 sidecar through
  // simulation capture, writer transfer, IndexedDB section merge and reload.
  const far = await page.evaluate(async () => {
    const x = 5522,
      z = 7300,
      before = lanternVale.terrain(x, z);
    lanternVale.blast([x, before, z]);
    await lanternVale.step(4);
    const save = await lanternVale.snapshot();
    await lanternVale.save();
    const index = 3650 * 4609 + 2761;
    const section = save.sections?.find((s) =>
      s.terrainIndices?.includes(index),
    );
    const offset = section?.terrainIndices.indexOf(index) ?? -1;
    return {
      x,
      z,
      index,
      before,
      offset,
      after: offset >= 0 ? section.terrain[offset * 2 + 1] : null,
    };
  });
  assert(far.offset >= 0, "far-grid capture must retain the exact odd index");
  assert(far.after < far.before, "blast must excavate the chosen sample");
  await page.reload();
  await ready();
  const restored = await page.evaluate(async ({ x, z, index }) => {
    const save = await lanternVale.snapshot();
    const section = save.sections?.find((s) =>
      s.terrainIndices?.includes(index),
    );
    const offset = section?.terrainIndices.indexOf(index) ?? -1;
    return {
      offset,
      height: lanternVale.terrain(x, z),
      saved: offset >= 0 ? section.terrain[offset * 2 + 1] : null,
    };
  }, far);
  assert(
    restored.offset >= 0,
    "IndexedDB reload must retain the exact odd index",
  );
  assert.equal(restored.saved, far.after);
  assert.equal(restored.height, far.after);
  for (const target of ["hell", "surface"]) {
    await page.evaluate(() => {
      const site = lanternVale.world.portal;
      lanternVale.send({
        type: "setPlane",
        grace: 0,
        plane: {
          ...lanternVale.state.snapshot.plane,
          p: [site.x, lanternVale.terrain(site.x, site.z) + 30, site.z],
          v: [0, -100, 0],
          yaw: 0,
          pitch: -1.12,
          speed: 130,
          crashed: 0,
          falling: false,
        },
      });
      lanternVale.send({ type: "debugStep", steps: 50 });
    });
    await page.waitForFunction(
      (realm) => lanternVale.world.realm === realm && lanternVale.state.ready,
      target,
    );
    await ready();
    await page.evaluate(() => lanternVale.pause());
  }
  assert.equal(
    await page.evaluate(({ x, z }) => lanternVale.terrain(x, z), far),
    far.after,
  );
  await page.evaluate(() => lanternVale.laser(lanternVale.world.castle));
  await page.evaluate(() => lanternVale.step(60));
  await page.screenshot({ path: `${out}/ps7-laser.png` });
  assert.deepEqual(errors, []);
  await writeFile(
    `${out}/result.json`,
    JSON.stringify(
      {
        ok: true,
        far,
        restored,
        checks: [
          "PS7 exact far-grid damage persists through IndexedDB reload",
          "PS7 portal round trip retains surface terrain",
          "laser presentation compiles after realm replacement",
        ],
        errors,
      },
      null,
      2,
    ),
  );
  console.log(
    "PS7 exact terrain save, realm travel and laser integration passed",
  );
} finally {
  await browser.close();
}
