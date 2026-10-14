import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ?? "playwright"
);
const out = process.env.STATUE_REACTION_QA_OUTPUT ?? "/tmp/statue-reaction-qa";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH ??
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--enable-unsafe-swiftshader"],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const base = process.env.ISLAND_URL ?? "http://127.0.0.1:5177/";
try {
  await page.goto(`${base}?island=PS4-0000A301#debug`);
  await page.waitForFunction(
    () => !document.getElementById("keepIsland").disabled,
    {},
    { timeout: 90000 },
  );
  await page.locator("#keepIsland").click();
  await page.waitForFunction(
    () => window.lanternVale?.state.ready,
    {},
    { timeout: 90000 },
  );
  const shots = await page.evaluate(() => {
    const s = lanternVale.world.sites.find((s) => s.kind === "pineapple-god");
    const local = (x, y, z) => [
      s.p[0] + Math.cos(s.yaw) * x + Math.sin(s.yaw) * z,
      s.p[1] + y,
      s.p[2] - Math.sin(s.yaw) * x + Math.cos(s.yaw) * z,
    ];
    lanternVale.enter();
    lanternVale.setPlane(local(0, 1050, 700), s.yaw);
    document.getElementById("overlay").hidden = true;
    document.getElementById("perf").hidden = true;
    lanternVale.inspect(local(120, 805, 420), local(0, 780, 0));
    lanternVale.view.setRenderDistance(1200);
    return {
      near: { p: local(120, 805, 420), target: local(0, 780, 0) },
      far: { p: local(1500, 1150, 5000), target: local(0, 650, 0) },
    };
  });
  const kill = await page.evaluate(async () => {
    const save = await lanternVale.snapshot();
    const s = lanternVale.world.sites.find((s) => s.kind === "pineapple-god");
    const m = save.monsters.find(
      (m) => !m.defeated && Math.hypot(m.p[0] - s.p[0], m.p[2] - s.p[2]) > 1800,
    );
    return [m.p[0], m.p[1] + 28, m.p[2]];
  });
  await page.evaluate((p) => lanternVale.blast(p, "valley"), kill);
  await page.waitForFunction(
    () =>
      lanternVale.state.snapshot.statueReaction.eyeGlowRemaining > 0 &&
      [...lanternVale.view.worldView.eyeMaterials].some(
        (m) => m.emissiveIntensity > 0,
      ),
    {},
    { timeout: 30000 },
  );
  await page.waitForTimeout(2600);
  await page.screenshot({ path: `${out}/eyes-near.png` });
  await page.evaluate((shot) => {
    lanternVale.inspect(shot.p, shot.target);
    lanternVale.view.setRenderDistance(600);
  }, shots.far);
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${out}/eyes-far.png` });
  const glowSave = await page.evaluate(() => lanternVale.save());
  assert(glowSave.statueReaction.eyeGlowRemaining > 0);
  assert.equal(glowSave.statueReaction.enraged, false);
  await page.evaluate((shot) => {
    lanternVale.inspect(shot.p, shot.target);
    lanternVale.view.setRenderDistance(1200);
  }, shots.near);
  await page.evaluate(() => {
    const e = lanternVale.world.entities.find(
      (e) => e.visual?.role === "figure",
    );
    lanternVale.blast(e.p, "valley");
  });
  await page.waitForFunction(
    () => lanternVale.state.snapshot.statueReaction.enraged,
    {},
    { timeout: 30000 },
  );
  await page.waitForTimeout(2600);
  await page.screenshot({ path: `${out}/rage-warning.png` });
  const metrics = [];
  for (const count of [120, 400]) {
    await page.evaluate(
      (count) => lanternVale.send({ type: "monsterCount", value: count }),
      count,
    );
    await page.waitForFunction(
      (count) => lanternVale.state.snapshot.monsterCount === count,
      count,
      { timeout: 30000 },
    );
    await page.waitForTimeout(5000);
    metrics.push(
      await page.evaluate(
        (count) => ({
          count,
          fps: lanternVale.state.render.fps,
          monsters: lanternVale.state.performance.stages["sim:monsters"],
          queues: lanternVale.state.performance.queues,
        }),
        count,
      ),
    );
  }
  await page.evaluate(() => lanternVale.pause());
  const saved = await page.evaluate(() => lanternVale.save());
  assert.equal(saved.statueReaction.enraged, true);
  await page.reload();
  await page.waitForFunction(
    () => window.lanternVale?.state.ready,
    {},
    { timeout: 90000 },
  );
  const restored = await page.evaluate(() => lanternVale.snapshot());
  assert.equal(restored.statueReaction.enraged, true);
  const stable = saved.monsters.find(
    (m) => !m.defeated && Math.hypot(m.p[0] - kill[0], m.p[2] - kill[2]) > 1400,
  );
  const same = restored.monsters.find((m) => m.id === stable.id);
  assert(
    Math.abs(same.p[0] - stable.p[0]) < 0.001 &&
      Math.abs(same.p[2] - stable.p[2]) < 0.001,
    "Saved rage position changed on reload",
  );

  assert.deepEqual(errors, []);
  await writeFile(
    `${out}/results.json`,
    JSON.stringify(
      {
        metrics,
        glowSaved: glowSave.statueReaction,
        restored: restored.statueReaction,
        errors,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      out,
      metrics: metrics.map((m) => ({
        count: m.count,
        fps: m.fps,
        monsterP95MS: m.monsters?.p95MS,
      })),
      restored: restored.statueReaction,
      errors,
    }),
  );
} finally {
  await browser.close();
}
