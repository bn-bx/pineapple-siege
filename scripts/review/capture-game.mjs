import fs from "node:fs/promises";
import { homedir } from "node:os";
import { pathToFileURL } from "node:url";
const { chromium } = await import(
  pathToFileURL(
    process.env.PLAYWRIGHT_MODULE ??
      `${homedir()}/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs`,
  ).href
);
const output = "public/review/pineapple-god/game-captures";
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath:
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({
    viewport: { width: 1145, height: 1374 },
    deviceScaleFactor: 1,
  }),
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
try {
  await page.goto(
    (process.env.ISLAND_URL ?? "http://127.0.0.1:5184/") +
      "?island=PS4-0000A301#debug",
  );
  await page.waitForFunction(
    () => !document.getElementById("keepIsland").disabled,
    null,
    { timeout: 90000 },
  );
  await page.locator("#keepIsland").click();
  await page.waitForFunction(() => window.lanternVale?.state.ready, null, {
    timeout: 90000,
  });
  await page.evaluate(() => {
    lanternVale.pause();
    document.getElementById("overlay").hidden = true;
    document.getElementById("perf").hidden = true;
    lanternVale.view.camera.fov = 45;
    lanternVale.view.camera.updateProjectionMatrix();
  });
  for (const [name, p, target] of [
    ["matched", [0, 400, 1800], [0, 400, 0]],
    ["three", [1200, 650, 1500], [0, 470, 0]],
    ["side", [1800, 600, 0], [0, 450, 0]],
  ]) {
    await page.evaluate(
      ({ p, target }) => {
        const s = lanternVale.world.sites.find(
          (s) => s.kind === "pineapple-god",
        );
        const local = (v) => {
          const x = v[0] * 0.9,
            y = v[1] * 0.9 + 15.5,
            z = v[2] * 0.9;
          return [
            s.p[0] + Math.cos(s.yaw) * x + Math.sin(s.yaw) * z,
            s.p[1] + y,
            s.p[2] - Math.sin(s.yaw) * x + Math.cos(s.yaw) * z,
          ];
        };
        const position = local(p),
          look = local(target);
        lanternVale.view.camera.position.fromArray(position);
        lanternVale.view.camera.lookAt(...look);
        lanternVale.view.rig.photo(lanternVale.view.camera);
        lanternVale.view.rig.fov = 45;
        lanternVale.inspect(position, look);
      },
      { p, target },
    );
    await page.waitForTimeout(750);
    await page.screenshot({ path: output + "/" + name + ".png" });
  }
  const info = await page.evaluate(() => {
    const v = lanternVale.view.worldView.approvedGod;
    return {
      owners: v.refs.size,
      batches: v.group.children.length,
      drawGroups: v.group.children.reduce(
        (a, m) => a + m.geometry.groups.length,
        0,
      ),
      materials: v.materials.length,
      removed: lanternVale.view.worldView.removed.size,
      camera: lanternVale.camera,
    };
  });
  await fs.writeFile(
    output + "/report.json",
    JSON.stringify(
      {
        info,
        errors,
        notes: [
          "Actual game renderer and environment; CRT enabled.",
          "Matched view uses the approved scale and camera. Background and lighting differ from the source.",
          "User acceptance of the integrated result remains pending.",
        ],
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ info, errors }));
  if (errors.length) process.exitCode = 1;
} finally {
  await browser.close();
}
