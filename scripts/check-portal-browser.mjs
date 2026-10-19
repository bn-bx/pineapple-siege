import assert from "node:assert/strict";
const { firefox, chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ?? "playwright"
);
const engine = process.env.PORTAL_BROWSER ?? "firefox";
const browser = await (engine === "firefox" ? firefox : chromium).launch({
  headless: true,
  ...(engine === "chromium"
    ? {
        executablePath:
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        args: ["--enable-unsafe-swiftshader"],
      }
    : {}),
});
const page = await browser.newPage({ viewport: { width: 1000, height: 720 } });
page.setDefaultTimeout(180000);
const errors = [];
page.on("pageerror", (e) => {
  errors.push(e.message);
  console.error(e.message);
});
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
async function dive() {
  await page.evaluate(() => {
    const p = lanternVale.world.portal;
    lanternVale.send({
      type: "setPlane",
      grace: 0,
      plane: {
        p: [p.x, p.y + 45, p.z],
        v: [0, -117, 56],
        yaw: 0,
        pitch: -1.12,
        roll: 0,
        speed: 130,
        crashed: 0,
        boundary: false,
        falling: false,
      },
    });
  });
}
async function arrive(realm) {
  await page.waitForFunction((realm) => {
    const status = document.getElementById("status").textContent;
    if (status.includes("opening failed")) throw Error(status);
    return (
      lanternVale.world.realm === realm &&
      lanternVale.state.active &&
      !document.getElementById("realmFlash").classList.contains("active")
    );
  }, realm);
  const plane = await page.evaluate(() => lanternVale.state.snapshot?.plane);
  assert.equal(plane.crashed, 0);
  assert(plane.pitch > 0);
}
try {
  await page.goto(
    `${process.env.ISLAND_URL ?? "http://127.0.0.1:5177/"}?island=PS4-0000A301&portal-test#debug`,
  );
  await page.waitForFunction(
    () => !document.getElementById("keepIsland").disabled,
  );
  await page.locator("#keepIsland").click();
  await page.waitForFunction(() => window.lanternVale?.state.ready);
  console.log("surface ready");
  await page.evaluate(() => lanternVale.enter());
  await arrive("hell");
  await dive();
  await arrive("surface");
  // Simulate a storage read failure on departure. Save writes live in another
  // worker, so this exercises the transition's recovery after a committed save.
  await page.evaluate(() => {
    const transaction = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (...args) {
      if (this.name === "lantern-vale") {
        IDBDatabase.prototype.transaction = transaction;
        throw Error("Injected portal storage failure");
      }
      return transaction.apply(this, args);
    };
  });
  await dive();
  await page.waitForFunction(
    () =>
      document
        .getElementById("status")
        .textContent.includes("Injected portal storage failure") &&
      !document.getElementById("realmFlash").classList.contains("active"),
  );
  await page.waitForFunction(() => lanternVale.state.snapshot?.plane.pitch > 0);
  const recovered = await page.evaluate(() => ({
    realm: lanternVale.world.realm,
    plane: lanternVale.state.snapshot?.plane,
  }));
  assert.equal(recovered.realm, "surface");
  assert.equal(recovered.plane.crashed, 0);
  await page.evaluate(() => lanternVale.save());
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      engine,
      checks: [
        "surface to hell",
        "hell to surface",
        "failed transfer recovers alive",
        "save completes",
      ],
      recovered,
    }),
  );
} catch (error) {
  console.error(
    await page.evaluate(() => ({
      status: document.getElementById("status")?.textContent,
      fatal: document.getElementById("fatalDetails")?.textContent,
      realm: window.lanternVale?.world.realm,
      ready: window.lanternVale?.state.ready,
    })),
  );
  throw error;
} finally {
  await browser.close();
}
