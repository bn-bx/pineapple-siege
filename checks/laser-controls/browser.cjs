const {
  chromium,
} = require("/Users/bradenbax/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const fs = require("node:fs");
(async () => {
  const browser = await chromium.launch({
    executablePath:
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
    args: ["--enable-webgl", "--ignore-gpu-blocklist"],
  });
  const page = await browser.newPage({
    viewport: { width: 1920, height: 1080 },
  });
  const errors = [],
    checks = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  const check = (name, passed, detail) => {
    checks.push({ name, passed: !!passed, detail });
    console.log(JSON.stringify(checks.at(-1)));
    if (!passed) throw Error(name);
  };
  const ready = () =>
    page.waitForFunction(() => window.lanternVale?.state.ready, null, {
      timeout: 60000,
    });
  const slider = (id, value) =>
    page.locator("#" + id).evaluate((el, value) => {
      el.value = value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }, String(value));
  try {
    await page.goto("http://127.0.0.1:4206/#debug");
    await ready();
    await page.locator("#quality").selectOption("1080");
    check(
      "Default controls",
      await page.evaluate(
        () =>
          document.querySelector("#laserSize").value === "0" &&
          document.querySelector("#laserDepth").value === "500" &&
          document.querySelector("#laserBrightness").value === "1",
      ),
    );
    await slider("laserSize", 100);
    await slider("laserDepth", 100);
    await slider("laserBrightness", 0.25);
    check(
      "Entire-map diameter label",
      await page
        .locator("#laserSizeValue")
        .textContent()
        .then((t) => t.includes("Entire map") && t.includes("6,000")),
    );
    await page.locator("#heading-laser").scrollIntoViewIfNeeded();
    await page.screenshot({ path: "checks/laser-controls/settings.png" });
    await page.evaluate(async () => {
      lanternVale.laser([0, 10, 0]);
      await lanternVale.step(30);
      await lanternVale.save();
    });
    await page.reload();
    await ready();
    check(
      "Preferences and charging strike survive reload",
      await page.evaluate(
        () =>
          document.querySelector("#laserSize").value === "100" &&
          document.querySelector("#laserDepth").value === "100" &&
          document.querySelector("#laserBrightness").value === "0.25" &&
          lanternVale.state.snapshot.lasers[0].profile.radius > 2999 &&
          lanternVale.state.snapshot.lasers[0].profile.depth === 100,
      ),
    );
    await page.locator("#defaultSettings").evaluate((el) => el.click());
    check(
      "Reset defaults preserves launched strike settings",
      await page.evaluate(
        () =>
          document.querySelector("#laserSize").value === "0" &&
          document.querySelector("#laserDepth").value === "500" &&
          document.querySelector("#laserBrightness").value === "1" &&
          lanternVale.state.snapshot.lasers[0].profile.depth === 100,
      ),
    );
    await page.evaluate(() => lanternVale.reset());
    for (const hour of [12, 0])
      for (const brightness of [0.25, 1, 2]) {
        await slider("laserBrightness", brightness);
        await page.evaluate(async (hour) => {
          const a = lanternVale;
          a.pause();
          await a.reset();
          await new Promise((r) => setTimeout(r, 50));
          a.pause();
          a.send({ type: "hour", hour });
          a.laser([1320, 10, 1070]);
          await a.step(270);
          a.inspect([1700, 350, 1450], [1320, 250, 1070]);
          document.querySelector("#overlay").hidden = true;
        }, hour);
        await page.waitForTimeout(250);
        await page.screenshot({
          path: `checks/laser-controls/beam-${hour === 12 ? "day" : "night"}-${brightness}.png`,
        });
        check(
          `Beam at hour ${hour}, brightness ${brightness}`,
          await page.evaluate(
            (b) =>
              lanternVale.state.snapshot.lasers[0].profile.brightness === b &&
              lanternVale.state.snapshot.lasers[0].phase === "burning",
            brightness,
          ),
        );
      }
    const age = await page.evaluate(
      () => lanternVale.state.snapshot.lasers[0].age,
    );
    await page.waitForTimeout(250);
    check(
      "Pause freezes strike age",
      await page.evaluate(
        (age) => lanternVale.state.snapshot.lasers[0].age === age,
        age,
      ),
    );
    await page.locator("#reduceEffects").evaluate((el) => {
      el.checked = true;
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.waitForTimeout(100);
    await page.screenshot({ path: "checks/laser-controls/beam-reduced.png" });
    await page.evaluate(() => lanternVale.enter());
    await page.evaluate(() => lanternVale.photo());
    await page.waitForFunction(() => lanternVale.state.cameraMode === "photo");
    const photoAge = await page.evaluate(
      () => lanternVale.state.snapshot.lasers[0].age,
    );
    await page.waitForTimeout(250);
    check(
      "Photo mode freezes strike age",
      await page.evaluate(
        (age) => lanternVale.state.snapshot.lasers[0].age === age,
        photoAge,
      ),
    );
    await page.evaluate(() => {
      lanternVale.photo();
      lanternVale.pause();
    });
    await page.evaluate(() => lanternVale.reset());
    check(
      "Reset clears strikes",
      await page.evaluate(() => lanternVale.state.snapshot.lasers.length === 0),
    );
    await page.evaluate(() => {
      document.querySelector("#overlay").hidden = false;
    });
    await page.locator("#defaultSettings").evaluate((el) => el.click());
    await slider("laserSize", 100);
    await page.locator("#quality").selectOption("1080");
    await page.evaluate(() => lanternVale.enter());
    await page.evaluate(() => {
      const a = lanternVale;
      a.inspect([1800, 450, 1750], [1024, 150, 1024]);
      a.send({ type: "holdTime", hold: true });
      a.send({ type: "hour", hour: 12 });
      const d = (window.controlStress = {
        start: performance.now(),
        frames: [],
        samples: [],
        stage: 0,
        phase: "baseline",
        done: false,
        last: performance.now(),
      });
      const timer = setInterval(() => {
        const elapsed = (performance.now() - d.start) / 1000;
        if (elapsed >= 4 && d.stage === 0) {
          d.stage = 1;
          d.phase = "maximum single";
          a.laser([1024, 10, 1024]);
        }
        if (elapsed >= 17 && d.stage === 1) {
          d.stage = 2;
          d.phase = "maximum overlap";
          for (const p of [
            [0, 10, 0],
            [2048, 10, 0],
            [0, 10, 2048],
            [2048, 10, 2048],
          ])
            for (let i = 0; i < 3; i++) a.laser(p);
        }
        const s = a.state.snapshot;
        d.samples.push({
          elapsed,
          lasers: s.lasers.length,
          jobs: s.stats.pendingJobs,
          destructionMS: s.stats.destructionMS,
          heap: performance.memory?.usedJSHeapSize ?? null,
        });
        if (
          elapsed > 31 &&
          s.lasers.length === 0 &&
          s.stats.pendingJobs === 0
        ) {
          d.done = true;
          clearInterval(timer);
        }
      }, 250);
      function frame(now) {
        d.frames.push({ phase: d.phase, ms: now - d.last });
        d.last = now;
        if (!d.done) requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    });
    for (let i = 0; i < 75; i++) {
      await page.waitForTimeout(1000);
      if (await page.evaluate(() => controlStress.done)) break;
      if (i % 10 === 0)
        console.log(
          "Stress",
          await page.evaluate(() => controlStress.samples.at(-1)),
        );
    }
    const stress = await page.evaluate(async () => {
      lanternVale.pause();
      const saved = await lanternVale.save(),
        d = controlStress;
      const phases = {};
      for (const phase of ["baseline", "maximum single", "maximum overlap"]) {
        const v = d.frames
          .filter((f) => f.phase === phase && f.ms > 0)
          .map((f) => f.ms)
          .sort((a, b) => a - b);
        phases[phase] = {
          frames: v.length,
          median: v[Math.floor(v.length * 0.5)],
          p95: v[Math.floor(v.length * 0.95)],
          worst: v.at(-1),
        };
      }
      return {
        done: d.done,
        wallSeconds: (performance.now() - d.start) / 1000,
        phases,
        peakLasers: Math.max(...d.samples.map((s) => s.lasers)),
        peakJobs: Math.max(...d.samples.map((s) => s.jobs)),
        peakMainThreadHeap: Math.max(...d.samples.map((s) => s.heap || 0)),
        peakDestructionMS: Math.max(...d.samples.map((s) => s.destructionMS)),
        saveBytes:
          saved.terrain.byteLength +
          saved.laserDry.byteLength +
          JSON.stringify({ ...saved, terrain: [], laserDry: [] }).length,
        drySamples: saved.laserDry.length,
        removed: saved.removed.length,
        entityCount: lanternVale.world.entities.length,
        settings: saved.destruction,
        render: lanternVale.state.render,
        ruins: saved.ruins.length,
        remainingStrikes: saved.lasers.length,
        remainingWork:
          saved.laserWork.length +
          saved.laserSupport.length +
          saved.pendingJobs.length,
        center: lanternVale.terrain(1024, 1024),
        samples: d.samples,
      };
    });
    check(
      "Whole-map strike and overlapping cleanup complete",
      stress.done &&
        stress.removed === stress.entityCount &&
        stress.ruins === 0 &&
        stress.drySamples === 1025 * 1025 &&
        stress.remainingWork === 0,
      {
        removed: stress.removed,
        entities: stress.entityCount,
        dry: stress.drySamples,
      },
    );
    await page.evaluate(
      () => (document.querySelector("#overlay").hidden = true),
    );
    await page.screenshot({ path: "checks/laser-controls/whole-map.png" });
    await page.reload();
    await ready();
    check(
      "Whole-map save reload retains crater and removes all structures",
      await page.evaluate(
        () =>
          lanternVale.state.snapshot.stats.ruins === 0 &&
          lanternVale.state.snapshot.stats.pendingJobs === 0 &&
          lanternVale.terrain(1024, 1024) < -300,
      ),
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator("#heading-laser").scrollIntoViewIfNeeded();
    await page.screenshot({
      path: "checks/laser-controls/settings-mobile.png",
    });
    check(
      "Mobile controls fit without horizontal overflow",
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    check("No browser errors", errors.length === 0, errors);
    fs.writeFileSync(
      "checks/laser-controls/report.json",
      JSON.stringify(
        { browser: await browser.version(), checks, stress, errors },
        null,
        2,
      ),
    );
    console.log(JSON.stringify({ ...stress, samples: undefined }, null, 2));
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
