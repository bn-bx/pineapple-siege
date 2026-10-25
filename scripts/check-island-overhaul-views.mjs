import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ?? "playwright"
);
const out = fileURLToPath(
    new URL("../artifacts/island-overhaul/", import.meta.url),
  ),
  base = process.env.ISLAND_URL ?? "http://127.0.0.1:5177/";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH ??
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: process.env.HEADLESS === "1",
});
const rows = [],
  errors = [];
try {
  for (const seed of (process.env.ISLAND_VIEW_SEEDS ?? "0,2,3")
    .split(",")
    .map(Number)) {
    const context = await browser.newContext({
        viewport: { width: 1280, height: 900 },
      }),
      page = await context.newPage();
    page.setDefaultTimeout(120000);
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(
      `${base}?island=PS7-${seed.toString(16).padStart(8, "0")}#debug`,
    );
    await page.waitForFunction(
      () => !document.getElementById("keepIsland").disabled,
    );
    await page.locator("#keepIsland").click();
    await page.waitForFunction(
      () =>
        window.lanternVale?.state.ready &&
        !document.getElementById("enter").disabled,
    );
    await page.locator("#crtMode").selectOption("off");
    const features = await page.evaluate(() => {
      const w = lanternVale.world,
        l = w.lakes[0],
        f = [...w.waterfalls].sort(
          (a, b) => b.top[1] - b.bottom[1] - (a.top[1] - a.bottom[1]),
        )[0];
      let mountain = [0, -Infinity, 0];
      for (let z = 256; z < w.size - 256; z += 64)
        for (let x = 256; x < w.size - 256; x += 64) {
          const h = lanternVale.terrain(x, z);
          if (h > mountain[1]) mountain = [x, h, z];
        }
      return {
        mountain,
        castle: w.castles[0].p,
        coast: w.sites.find((s) => s.kind === "harbor").p,
        lake: [l.center[0], l.level, l.center[1]],
        waterfall: [f.bottom[0], (f.top[1] + f.bottom[1]) / 2, f.bottom[2]],
      };
    });
    for (const [name, p] of Object.entries(features)) {
      await page.evaluate(
        ({ name, p }) => {
          document.getElementById("overlay").hidden = true;
          document.getElementById("perf").hidden = true;
          const distance =
            name === "mountain"
              ? 1500
              : name === "castle"
                ? 700
                : name === "coast"
                  ? 500
                  : 200;
          let eye,
            score = Infinity;
          for (const [dx, dz] of [
            [1, -1],
            [-1, -1],
            [1, 1],
            [-1, 1],
          ]) {
            const x = p[0] + dx * distance,
              z = p[2] + dz * distance,
              ground = lanternVale.terrain(x, z);
            if (ground < score) {
              score = ground;
              eye = [
                x,
                Math.max(
                  p[1] +
                    (name === "castle" ? 450 : name === "mountain" ? 120 : 180),
                  ground + 130,
                ),
                z,
              ];
            }
          }
          lanternVale.inspect(eye, [
            p[0],
            p[1] + (name === "castle" ? 65 : 10),
            p[2],
          ]);
        },
        { name, p },
      );
      await page.waitForTimeout(3000);
      await page.screenshot({ path: `${out}/variety-${seed}-${name}.png` });
    }
    rows.push({ seed, captures: Object.keys(features) });
    await context.close();
    console.log(JSON.stringify(rows.at(-1)));
  }
  await writeFile(
    `${out}/variety-view-qa.json`,
    JSON.stringify({ rows, errors }, null, 2),
  );
  if (errors.length) throw Error(errors.join("\n"));
} finally {
  await browser.close();
}
