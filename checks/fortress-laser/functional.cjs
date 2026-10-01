const {
  chromium,
} = require("/Users/bradenbax/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const fs = require("node:fs");
const url = "http://127.0.0.1:4206/#debug";
(async () => {
  const browser = await chromium.launch({
    executablePath:
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
    args: ["--enable-webgl", "--ignore-gpu-blocklist"],
  });
  const checks = [],
    errors = [];
  const check = (name, passed, detail) => {
    const r = { name, passed: !!passed, detail };
    checks.push(r);
    console.log(JSON.stringify(r));
  };
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
  });
  page.on("pageerror", (e) => errors.push(e.message));
  const ready = () =>
    page.waitForFunction(() => window.lanternVale?.state.ready, null, {
      timeout: 60000,
    });
  const settled = async () => {
    for (let i = 0; i < 20; i++) {
      if (
        await page.evaluate(
          () => lanternVale.state.snapshot.stats.pendingJobs === 0,
        )
      )
        return;
      await page.evaluate(() => lanternVale.step(30));
    }
  };
  try {
    await page.goto(url);
    await ready();
    check(
      "Version-5 fortress, twelve towers and third weapon selector",
      await page.evaluate(
        () =>
          lanternVale.world.version === 5 &&
          lanternVale.world.landmarks.towers.length === 12 &&
          document.getElementById("select-laser").textContent.includes("3"),
      ),
    );
    await page.locator("#quality").selectOption("720");
    await page.locator("#enter").click();
    await page.keyboard.press("3");
    await page.waitForFunction(
      () => lanternVale.state.snapshot.weapon === "laser",
    );
    await page.evaluate(() =>
      lanternVale.setPlane([950, 420, 680], 0.75, -0.6),
    );
    await page.keyboard.press("Space");
    await page.waitForFunction(
      () => lanternVale.state.snapshot.lasers.length > 0,
    );
    check(
      "Key 3 and Space lock a charging strike with independent cooldown",
      await page.evaluate(
        () =>
          lanternVale.state.snapshot.weapon === "laser" &&
          lanternVale.state.snapshot.lasers[0].phase === "charging" &&
          lanternVale.state.snapshot.cooldowns.laser > 20 &&
          lanternVale.state.snapshot.cooldowns.cannon === 0,
      ),
    );
    await page.waitForTimeout(200);
    check(
      "HUD reports charge and spatial laser audio is active",
      await page.evaluate(
        () =>
          document
            .getElementById("weaponStatus")
            .textContent.includes("CHARGING") &&
          lanternVale.state.audio.laserVoices > 0,
      ),
    );
    await page.evaluate(() => lanternVale.pause());
    await page.waitForTimeout(100);
    const frozen = await page.evaluate(() => ({
      tick: lanternVale.state.snapshot.tick,
      l: lanternVale.state.snapshot.lasers[0],
    }));
    await page.waitForTimeout(350);
    check(
      "Pause freezes charge clock and fixed target",
      await page.evaluate(
        (f) =>
          lanternVale.state.snapshot.tick === f.tick &&
          JSON.stringify(lanternVale.state.snapshot.lasers[0]) ===
            JSON.stringify(f.l),
        frozen,
      ),
    );
    const charging = await page.evaluate(() => lanternVale.save());
    await page.reload();
    await ready();
    check(
      "Charging strike and recharge restore at their saved time",
      await page.evaluate(
        (saved) =>
          JSON.stringify(lanternVale.state.snapshot.lasers[0]) ===
            JSON.stringify(saved.lasers[0]) &&
          lanternVale.state.snapshot.cooldowns.laser === saved.laserCooldown,
        charging,
      ),
    );
    await page.evaluate(() => {
      const a = lanternVale;
      a.send({ type: "weapon", weapon: "laser" });
      a.send({
        type: "input",
        input: { x: 0, y: 0, throttle: 0, bank: 0, boost: false, fire: false },
      });
    });
    await page.evaluate(() =>
      lanternVale.step(
        Math.round((4.5 - lanternVale.state.snapshot.lasers[0].age) * 60),
      ),
    );
    const burning = await page.evaluate(() => lanternVale.save());
    check(
      "Beam progressively excavates before its completion",
      burning.lasers[0].phase === "burning" &&
        burning.terrain.length > 0 &&
        burning.laserDry.length > 0,
    );
    await page.reload();
    await ready();
    check(
      "Burning strike and deep edits recover before play resumes",
      await page.evaluate(
        (saved) =>
          lanternVale.state.snapshot.lasers[0].phase === "burning" &&
          lanternVale.state.snapshot.lasers[0].age === saved.lasers[0].age &&
          lanternVale.state.snapshot.stats.pendingJobs === 0,
        burning,
      ),
    );
    await page.locator("#enter").click();
    await page.keyboard.press("3");
    await page.keyboard.press("p");
    await page.waitForFunction(() => lanternVale.state.cameraMode === "photo");
    const photo = await page.evaluate(() => ({
      tick: lanternVale.state.snapshot.tick,
      age: lanternVale.state.snapshot.lasers[0].age,
      effect: lanternVale.state.render.effectTime,
    }));
    await page.waitForTimeout(350);
    check(
      "Photo mode freezes laser, simulation and effect clocks",
      await page.evaluate(
        (f) =>
          lanternVale.state.snapshot.tick === f.tick &&
          lanternVale.state.snapshot.lasers[0].age === f.age &&
          lanternVale.state.render.effectTime === f.effect,
        photo,
      ),
    );
    await page.keyboard.press("Escape");
    await page.waitForTimeout(100);
    await page.evaluate(() =>
      lanternVale.step(
        Math.ceil((9 - lanternVale.state.snapshot.lasers[0].age) * 60),
      ),
    );
    await settled();
    const crater = await page.evaluate(async () => {
      const s = await lanternVale.save();
      return {
        save: s,
        floor: lanternVale.terrain(s.laserWork[0]?.targets[0]?.p[0] ?? 0, 0),
      };
    });
    const target = burning.lasers[0].p;
    check(
      "Completed crater reaches baseline minus 500m and has no active strike",
      await page.evaluate(
        (p) =>
          Math.abs(lanternVale.terrain(p[0], p[2]) + 490) < 0.02 &&
          lanternVale.state.snapshot.lasers.length === 0,
        target,
      ),
    );
    await page.reload();
    await ready();
    check(
      "Completed deep dry crater persists across reload",
      await page.evaluate(async (p) => {
        const s = await lanternVale.snapshot();
        return (
          Math.abs(lanternVale.terrain(p[0], p[2]) + 490) < 0.02 &&
          s.laserDry.length > 0 &&
          s.lasers.length === 0
        );
      }, target),
    );
    await page.locator("#newWorld").click();
    await page.locator("#confirmReset").click();
    await page.waitForFunction(
      () =>
        lanternVale.state.ready &&
        !document.getElementById("enter").disabled &&
        lanternVale.state.snapshot.stats.removed === 0,
    );
    await page.waitForFunction(() => lanternVale.state.active);
    await page.evaluate(() => lanternVale.pause());
    await page.waitForTimeout(150);
    check(
      "Reset clears laser edits, dry mask, strikes and audio",
      await page.evaluate(async () => {
        const s = await lanternVale.snapshot();
        return (
          !s.laserDry.length &&
          !s.lasers.length &&
          !s.laserWork.length &&
          !s.vaporized.length &&
          lanternVale.state.audio.laserVoices === 0
        );
      }),
    );
    await page.evaluate(() => {
      lanternVale.send({
        type: "destructionSettings",
        value: {
          bodies: 1,
          fragments: 1,
          cosmetics: 1,
          rubble: 1,
          noCooldown: true,
          nukeScale: 1,
        },
      });
      lanternVale.send({ type: "weapon", weapon: "laser" });
      lanternVale.setPlane([600, 400, 200], 0, -0.7);
      lanternVale.send({
        type: "input",
        input: { x: 0, y: 0, throttle: 0, bank: 0, boost: false, fire: true },
      });
    });
    await page.evaluate(() => lanternVale.step(60));
    const unrestricted = await page.evaluate(() => ({
      shots: lanternVale.state.snapshot.stats.shots,
      strikes: lanternVale.state.snapshot.lasers.length,
      cooldown: lanternVale.state.snapshot.cooldowns.laser,
    }));
    check(
      "Unrestricted laser releases sixty independent strikes in sixty ticks",
      unrestricted.shots === 60 &&
        unrestricted.strikes === 60 &&
        unrestricted.cooldown === 0,
      unrestricted,
    );
    await page.evaluate(() =>
      lanternVale.send({
        type: "input",
        input: { x: 0, y: 0, throttle: 0, bank: 0, boost: false, fire: false },
      }),
    );
    await page.evaluate(() => lanternVale.step(600));
    await settled();
    check(
      "Overlapping strikes finish, drain work and keep the 500m limit",
      await page.evaluate(async () => {
        const s = await lanternVale.snapshot();
        return (
          !s.lasers.length &&
          !s.laserWork.length &&
          s.terrain.every((v, i) => i % 2 === 0 || v >= -560)
        );
      }),
    );
    check(
      "No WebGL error",
      await page.evaluate(
        () => lanternVale.renderer.getContext().getError() === 0,
      ),
    );
    // Navigate to a script-free fixture before injecting old data: the game
    // intentionally requests a final save on pagehide, which must finish first.
    await page.route("**/save-fixture", (r) =>
      r.fulfill({
        contentType: "text/html",
        body: "<!doctype html><title>Save fixture</title>",
      }),
    );
    await page.goto("http://127.0.0.1:4206/save-fixture");
    await page.waitForTimeout(300);
    // Upgrade paths use an isolated browser database, never the user's profile.
    await page.evaluate(async () => {
      const db = await new Promise((resolve) => {
        const r = indexedDB.open("lantern-vale", 1);
        r.onsuccess = () => resolve(r.result);
      });
      await new Promise((resolve) => {
        const tx = db.transaction("worlds", "readwrite");
        tx.objectStore("worlds").put(
          { version: 4, worldVersion: 4, marker: "protected-old-world" },
          "current",
        );
        tx.oncomplete = resolve;
      });
      db.close();
    });
    await page.goto(url);
    await page.waitForFunction(() => document.getElementById("recovery").open);
    await page.locator("#temporary").click();
    await ready();
    check(
      "Temporary play preserves the old save and disables world saving",
      await page.evaluate(async () => {
        const db = await new Promise((resolve) => {
          const r = indexedDB.open("lantern-vale", 1);
          r.onsuccess = () => resolve(r.result);
        });
        const s = await new Promise((resolve) => {
          const r = db
            .transaction("worlds")
            .objectStore("worlds")
            .get("current");
          r.onsuccess = () => resolve(r.result);
        });
        db.close();
        return (
          !lanternVale.state.saveEnabled && s.marker === "protected-old-world"
        );
      }),
    );
    await page.reload();
    await page.waitForFunction(() => document.getElementById("recovery").open);
    await page.locator("#replaceSave").click();
    await ready();
    check(
      "Explicit new-world choice restores saving and keeps preferences",
      await page.evaluate(
        () =>
          lanternVale.state.saveEnabled &&
          lanternVale.state.snapshot.stats.removed === 0 &&
          document.getElementById("quality").value === "720",
      ),
    );
    check("No page errors", errors.length === 0, errors);
    fs.writeFileSync(
      "checks/fortress-laser/functional-report.json",
      JSON.stringify(
        { browser: await browser.version(), checks, errors },
        null,
        2,
      ),
    );
    if (checks.some((c) => !c.passed)) process.exitCode = 1;
  } finally {
    fs.writeFileSync(
      "checks/fortress-laser/functional-report.json",
      JSON.stringify(
        { browser: await browser.version(), checks, errors },
        null,
        2,
      ),
    );
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
