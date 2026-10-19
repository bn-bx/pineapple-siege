import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ?? "playwright"
);
const out = process.env.GRAVITY_QA_OUTPUT ?? "/tmp/gravity-bomb-qa";
const base = process.env.ISLAND_URL ?? "http://127.0.0.1:5177/";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH ??
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
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
  const target = await page.evaluate(async () => {
    const game = window.lanternVale;
    const site =
      game.world.sites.find((s) => s.kind === "town") ??
      game.world.sites.find((s) => s.kind === "castle") ??
      game.world.sites[0];
    const p = [site.p[0], game.terrain(site.p[0], site.p[2]), site.p[2]];
    game.enter();
    game.pause();
    game.setPlane([p[0], p[1] + 70, p[2] - 60]);
    game.send({ type: "weapon", weapon: "gravityBomb" });
    game.send({
      type: "input",
      input: { x: 0, y: 0, throttle: 0, bank: 0, boost: false, fire: true },
    });
    await game.step(1);
    game.send({
      type: "input",
      input: { x: 0, y: 0, throttle: 0, bank: 0, boost: false, fire: false },
    });
    document.getElementById("overlay").hidden = true;
    game.inspect([p[0] + 330, p[1] + 190, p[2] + 360], [p[0], p[1] + 40, p[2]]);
    game.view.setRenderDistance(1200);
    return p;
  });
  await page.waitForFunction(
    () =>
      lanternVale.state.snapshot.weapon === "gravityBomb" &&
      lanternVale.state.snapshot.gravityBombs.length === 1,
  );
  await page.waitForFunction(() =>
    document.getElementById("weaponName").textContent.includes("GRAVITY BOMB"),
  );
  for (let i = 0; i < 100; i++) {
    if (
      await page.evaluate(() =>
        lanternVale.state.snapshot.gravityBombs.some(
          (b) => b.phase === "pulling",
        ),
      )
    )
      break;
    await page.evaluate(() => lanternVale.step(3));
  }
  await page.waitForFunction(() =>
    lanternVale.state.snapshot.gravityBombs.some((b) => b.phase === "pulling"),
  );
  await page.evaluate(() => lanternVale.step(150));
  await page.evaluate(() =>
    lanternVale.view.render(0, false, performance.now()),
  );
  await page.screenshot({ path: `${out}/pull.png` });
  const pulling = await page.evaluate(() => ({
    bomb: lanternVale.state.snapshot.gravityBombs[0],
    bodies: lanternVale.state.snapshot.bodies.length,
    stats: lanternVale.state.snapshot.stats,
  }));
  assert.equal(pulling.bomb.phase, "pulling");
  assert(pulling.bodies > 0, "gravity should create moving wreckage");
  const framesToBurst = Math.ceil((4 - pulling.bomb.age) * 60) + 5;
  await page.evaluate((steps) => lanternVale.step(steps), framesToBurst);
  await page.waitForFunction(
    () => lanternVale.state.snapshot.gravityBombs[0]?.phase === "bursting",
  );
  await page.evaluate(() =>
    lanternVale.view.render(0, false, performance.now()),
  );
  await page.screenshot({ path: `${out}/burst.png` });
  await page.evaluate(() => lanternVale.step(50));
  await page.waitForFunction(
    () => lanternVale.state.snapshot.gravityBombs.length === 0,
  );
  const beforeReset = await page.evaluate(() => lanternVale.state.audio);
  await page.evaluate(() => lanternVale.reset());
  await page.waitForFunction(
    () => lanternVale.state.snapshot.gravityBombs.length === 0,
  );
  assert.equal(
    await page.evaluate(() => lanternVale.state.audio.gravityVoices),
    0,
  );
  assert.deepEqual(errors, []);
  await writeFile(
    `${out}/report.json`,
    JSON.stringify({ target, pulling, beforeReset, errors }, null, 2),
  );
  console.log(
    JSON.stringify({
      screenshots: [`${out}/pull.png`, `${out}/burst.png`],
      bodies: pulling.bodies,
      errors,
    }),
  );
} finally {
  await browser.close();
}
