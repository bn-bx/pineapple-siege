// Native foreground measurements. Run one browser at a time.
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ?? "playwright"
);
import { writeFile, mkdir } from "node:fs/promises";
const [label = "baseline", mode = "matrix"] = process.argv.slice(2);
const out = `/tmp/siege-simplification/${label}`;
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH ??
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: false,
  args: ["--autoplay-policy=no-user-gesture-required"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.setDefaultTimeout(180000);
let progress;
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto(
    (process.env.SIEGE_BENCHMARK_URL ?? "http://127.0.0.1:5177") +
      "/performance.html",
  );
  await page.waitForFunction(
    () => !document.querySelector("#run").disabled,
    null,
    { timeout: 120000 },
  );
  await page.screenshot({ path: `${out}/castle.png` });
  const results = [];
  if (mode === "soak") {
    await page.bringToFront();
    await page.locator("#soak").click();
    progress = setInterval(async () => {
      try {
        console.log(await page.locator("#status").textContent());
      } catch {}
    }, 60000);
    await page.waitForFunction(
      () => !document.querySelector("#soak").disabled,
      null,
      { timeout: 1100000 },
    );
    clearInterval(progress);
    results.push(JSON.parse(await page.locator("#report").textContent()));
  } else {
    for (const i of [0, 1, 2, 3, 4, 5]) {
      await page.locator("#case").selectOption(String(i));
      await page.bringToFront();
      await page.locator("#run").click();
      await page.waitForFunction(
        () => document.querySelector("#run").disabled,
        null,
        { timeout: 10000 },
      );
      await page.waitForFunction(
        () => !document.querySelector("#run").disabled,
        null,
        { timeout: 180000 },
      );
      results.push(JSON.parse(await page.locator("#report").textContent()));
      await writeFile(`${out}/matrix.json`, JSON.stringify(results, null, 2));
      console.log(`${label} case ${i} complete`);
    }
  }
  await writeFile(
    `${out}/${mode}.json`,
    JSON.stringify({ results, errors }, null, 2),
  );
  await page.screenshot({ path: `${out}/final.png` });
  console.log(JSON.stringify({ label, mode, errors }));
} finally {
  clearInterval(progress);
  await browser.close();
}
