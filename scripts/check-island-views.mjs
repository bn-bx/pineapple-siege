import { mkdir } from "node:fs/promises";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ?? "playwright"
);
const code = process.env.ISLAND_CODE ?? "PS2-0000A301";
const output = `/tmp/island-qa/${code}`;
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH ??
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--enable-unsafe-swiftshader"],
});
const context = await browser.newContext({
    viewport: { width: 1100, height: 760 },
  }),
  page = await context.newPage(),
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
await mkdir(output, { recursive: true });
try {
  await page.goto(
    `${process.env.ISLAND_URL ?? "http://127.0.0.1:5177/"}?island=${encodeURIComponent(code)}#debug`,
  );
  await page.waitForFunction(
    () => !document.getElementById("keepIsland").disabled,
    {},
    { timeout: 60000 },
  );
  await page.locator("#keepIsland").click();
  await page.waitForFunction(
    () => window.lanternVale?.state.ready,
    {},
    { timeout: 90000 },
  );
  await page.evaluate(() => {
    document.getElementById("overlay").hidden = true;
    document.getElementById("perf").hidden = true;
  });
  const shots = await page.evaluate(() => {
    const w = lanternVale.world,
      river = w.rivers[0],
      r = river.points[Math.floor(river.points.length / 3)],
      port = w.sites.find((s) => s.kind === "harbor"),
      lamp = w.sites.find((s) => s.kind === "lighthouse"),
      tree = w.entities.find((e) => e.treeSpecies === "broadleaf"),
      c = w.castles[1];
    const heights = lanternVale.view.terrain.base;
    let peak = 0;
    for (let i = 0; i < heights.length; i++)
      if (heights[i] > heights[peak]) peak = i;
    const mountain = [
      (peak % 3073) * 2,
      heights[peak],
      Math.floor(peak / 3073) * 2,
    ];
    return [
      {
        name: "harbor",
        p: [
          port.p[0] + (port.dockAxis === 0 ? port.dockSign * 140 : -120),
          port.p[1] + 90,
          port.p[2] + (port.dockAxis === 1 ? port.dockSign * 140 : -120),
        ],
        target: [port.p[0], port.p[1] + 8, port.p[2]],
      },
      {
        name: "lighthouse",
        p: [lamp.p[0] + 120, lamp.p[1] + 80, lamp.p[2] + 130],
        target: [lamp.p[0], lamp.p[1] + 24, lamp.p[2]],
      },
      { name: "river", p: [r[0] + 100, r[1] + 70, r[2] + 120], target: r },
      {
        name: "forest",
        p: [tree.p[0] + 100, tree.p[1] + 35, tree.p[2] + 90],
        target: tree.p,
      },
      {
        name: "mountains",
        p: [mountain[0] - 420, 450, mountain[2] + 460],
        target: mountain,
      },
      {
        name: "small-castle",
        p: [c.p[0] + 230, c.p[1] + 150, c.p[2] - 270],
        target: [c.p[0], c.p[1] + 35, c.p[2]],
      },
    ];
  });
  for (const shot of shots) {
    await page.evaluate((shot) => {
      const v = lanternVale.view;
      lanternVale.inspect(shot.p, shot.target);
      v.camera.position.fromArray(shot.p);
      v.camera.lookAt(...shot.target);
      for (let i = 0; i < 360; i++) v.terrain.update(v.camera.position, 1200);
    }, shot);
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${output}/${shot.name}.png` });
    console.log("Captured", shot.name);
  }
  console.log(JSON.stringify({ errors }));
  if (errors.length) throw Error(errors.join("\n"));
} finally {
  await browser.close();
}
