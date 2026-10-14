import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ?? "playwright"
);
const output = process.env.STATUE_QA_OUTPUT ?? "/tmp/pineapple-god-qa";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH ??
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto(
    `${process.env.ISLAND_URL ?? "http://127.0.0.1:5177/"}?island=PS4-0000A301#debug`,
  );
  await page.waitForFunction(
    () => !document.getElementById("keepIsland").disabled,
    {},
    { timeout: 90000 },
  );
  await page
    .locator("#islandPreview")
    .screenshot({ path: `${output}/preview.png` });
  await page.locator("#keepIsland").click();
  await page.waitForFunction(
    () => window.lanternVale?.state.ready,
    {},
    { timeout: 90000 },
  );
  const shots = await page.evaluate(() => {
    document.getElementById("overlay").hidden = true;
    document.getElementById("perf").hidden = true;
    const s = lanternVale.world.sites.find((s) => s.kind === "pineapple-god");
    const local = (x, y, z) => [
      s.p[0] + Math.cos(s.yaw) * x + Math.sin(s.yaw) * z,
      s.p[1] + y,
      s.p[2] - Math.sin(s.yaw) * x + Math.cos(s.yaw) * z,
    ];
    return [
      {
        name: "front",
        p: local(800, 780, 1800),
        target: local(0, 480, 0),
        distance: 3000,
      },
      {
        name: "face",
        p: local(180, 820, 470),
        target: local(0, 780, 0),
        distance: 1200,
      },
      {
        name: "island",
        p: local(1400, 1500, 7000),
        target: local(0, 350, 0),
        distance: 600,
      },
      {
        name: "castle",
        p: [
          lanternVale.world.castle[0],
          lanternVale.world.castle[1] + 260,
          lanternVale.world.castle[2],
        ],
        target: local(0, 520, 0),
        distance: 1200,
      },
    ];
  });
  const results = [];
  for (const shot of shots) {
    await page.evaluate((shot) => {
      lanternVale.view.setRenderDistance(shot.distance);
      lanternVale.inspect(shot.p, shot.target);
    }, shot);
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${output}/${shot.name}.png` });
    results.push(
      await page.evaluate(
        (name) => ({
          name,
          render: lanternVale.state.render,
          performance: lanternVale.state.performance,
          calls: lanternVale.renderer.info.render.calls,
          triangles: lanternVale.renderer.info.render.triangles,
        }),
        shot.name,
      ),
    );
  }
  await page.evaluate((shot) => {
    lanternVale.view.setRenderDistance(3000);
    lanternVale.inspect(shot.p, shot.target);
    lanternVale.enter();
    const s = lanternVale.world.sites.find((s) => s.kind === "pineapple-god");
    lanternVale.setPlane(
      [
        s.p[0] + Math.sin(s.yaw) * 550,
        s.p[1] + 700,
        s.p[2] + Math.cos(s.yaw) * 550,
      ],
      s.yaw,
    );
    document.getElementById("overlay").hidden = true;
  }, shots[0]);
  await page.waitForTimeout(2000);
  const flight = await page.evaluate(() => ({
    render: lanternVale.state.render,
    performance: lanternVale.state.performance,
  }));
  const before = await page.evaluate(
    () => lanternVale.view.worldView.removed.size,
  );
  await page.evaluate(() => {
    const s = lanternVale.world.sites.find((s) => s.kind === "pineapple-god");
    lanternVale.blast([s.p[0], s.p[1] + 440, s.p[2]], "valley");
  });
  await page.waitForFunction(
    (before) => lanternVale.view.worldView.removed.size > before,
    before,
    { timeout: 30000 },
  );
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${output}/damaged.png` });
  const damage = await page.evaluate(() => {
    const w = lanternVale.world;
    return w.entities.filter(
      (e) => e.visual && lanternVale.view.worldView.removed.has(e.id),
    ).length;
  });
  const collapse = await page.evaluate(() => ({
    render: lanternVale.state.render,
    performance: lanternVale.state.performance,
  }));
  assert(damage > 0);
  assert.deepEqual(errors, []);
  await writeFile(
    `${output}/results.json`,
    JSON.stringify({ results, flight, collapse, damage, errors }, null, 2),
  );
  console.log(
    JSON.stringify({
      output,
      damage,
      errors,
      flightFPS: flight.render.fps,
      collapseFPS: collapse.render.fps,
      views: results.map((r) => ({
        name: r.name,
        calls: r.calls,
        triangles: r.triangles,
      })),
    }),
  );
} finally {
  await browser.close();
}
