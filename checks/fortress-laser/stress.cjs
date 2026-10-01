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
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  try {
    await page.goto("http://127.0.0.1:4206/#debug");
    await page.waitForFunction(() => window.lanternVale?.state.ready, null, {
      timeout: 60000,
    });
    await page.locator("#quality").selectOption("1080");
    await page.locator("#enter").click();
    await page.evaluate(() => {
      const a = lanternVale;
      a.inspect([1700, 370, 600], [1320, 85, 1070]);
      a.send({ type: "holdTime", hold: true });
      a.send({ type: "hour", hour: 12 });
      const input = {
        x: 0,
        y: 0,
        throttle: 0,
        bank: 0,
        boost: false,
        fire: false,
      };
      a.controls(input);
      a.setPlane([950, 420, 680], 0.75, -0.6);
      const start = performance.now(),
        simStart = a.state.snapshot.time;
      const data = (window.laserStress = {
        start,
        simStart,
        frames: [],
        samples: [],
        phase: "baseline",
        last: start,
        stage: 0,
        done: false,
      });
      const timer = setInterval(() => {
        const seconds = (performance.now() - start) / 1000;
        a.setPlane([950, 420, 680], 0.75, -0.6);
        if (seconds >= 12 && data.stage === 0) {
          data.stage = 1;
          data.phase = "single laser";
          a.laser([1320, 10, 1070]);
        }
        if (seconds >= 30 && data.stage === 1) {
          data.stage = 2;
          data.phase = "unrestricted";
          a.send({
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
          a.send({ type: "weapon", weapon: "laser" });
          a.controls({ ...input, fire: true });
        }
        if (seconds >= 50 && data.stage === 2) {
          data.stage = 3;
          data.phase = "settling";
          a.controls(input);
        }
        const s = a.state;
        data.samples.push({
          seconds,
          sim: s.snapshot.time - simStart,
          phase: data.phase,
          lasers: s.snapshot.lasers.length,
          jobs: s.snapshot.stats.pendingJobs,
          shots: s.snapshot.stats.shots,
          bodies: s.snapshot.stats.bodies,
          ruins: s.snapshot.stats.ruins,
          destructionMS: s.snapshot.stats.destructionMS,
          heap: performance.memory?.usedJSHeapSize ?? null,
          draws: s.render.drawCalls,
          triangles: s.render.triangles,
          quality: s.render.quality,
          active: s.active,
        });
        if (seconds >= 65) {
          clearInterval(timer);
          data.done = true;
        }
      }, 300);
      const frame = (now) => {
        data.frames.push({ ms: now - data.last, phase: data.phase });
        data.last = now;
        if (!data.done) requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
    for (let i = 0; i < 90; i++) {
      await page.waitForTimeout(1000);
      if (await page.evaluate(() => laserStress.done)) break;
      if (i % 15 === 0)
        console.log(await page.evaluate(() => laserStress.samples.at(-1)));
    }
    const report = await page.evaluate(async () => {
      const d = laserStress,
        a = lanternVale,
        before = a.state.snapshot;
      a.controls({
        x: 0,
        y: 0,
        throttle: 0,
        bank: 0,
        boost: false,
        fire: false,
      });
      a.pause();
      const saved = await a.save(),
        phases = {};
      for (const phase of [
        "baseline",
        "single laser",
        "unrestricted",
        "settling",
      ]) {
        const values = d.frames
          .filter((f) => f.phase === phase && f.ms > 0)
          .map((f) => f.ms)
          .sort((x, y) => x - y);
        phases[phase] = {
          count: values.length,
          median: values[Math.floor(values.length * 0.5)],
          p95: values[Math.floor(values.length * 0.95)],
          worst: values.at(-1),
        };
      }
      return {
        wallSeconds: (performance.now() - d.start) / 1000,
        simSeconds: before.time - d.simStart,
        phases,
        peakLasers: Math.max(...d.samples.map((s) => s.lasers)),
        peakJobs: Math.max(...d.samples.map((s) => s.jobs)),
        peakMainThreadHeap: Math.max(...d.samples.map((s) => s.heap ?? 0)),
        peakDestructionMS: Math.max(...d.samples.map((s) => s.destructionMS)),
        unexpectedPauses: d.samples.filter((s) => !s.active).length,
        shots: before.stats.shots,
        remainingLasers: saved.lasers.length,
        remainingJobs:
          saved.pendingJobs.length +
          saved.laserWork.length +
          saved.laserSupport.length,
        drySamples: saved.laserDry.length,
        saveBytes:
          saved.terrain.byteLength +
          saved.laserDry.byteLength +
          JSON.stringify({ ...saved, terrain: [], laserDry: [] }).length,
        samples: d.samples,
      };
    });
    report.browser = await browser.version();
    report.errors = errors;
    fs.writeFileSync(
      "checks/fortress-laser/stress-report.json",
      JSON.stringify(report, null, 2),
    );
    await page.screenshot({ path: "checks/fortress-laser/stress-final.png" });
    console.log(JSON.stringify({ ...report, samples: undefined }, null, 2));
    if (!(await page.evaluate(() => laserStress.done)) || errors.length)
      process.exitCode = 1;
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
