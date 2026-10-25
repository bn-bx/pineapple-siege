import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { pathToFileURL } from "node:url";
const modulePath =
  process.env.PLAYWRIGHT_MODULE ??
  `${homedir()}/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs`;
const { chromium } = await import(pathToFileURL(modulePath).href);
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH ??
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--enable-unsafe-swiftshader"],
});
const output = "public/review/pineapple-god/captures";
await mkdir(output, { recursive: true });
const page = await browser.newPage({
  viewport: { width: 1600, height: 1100 },
  deviceScaleFactor: 1,
});
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
const save = async (name, url) =>
  writeFile(`${output}/${name}.png`, Buffer.from(url.split(",")[1], "base64"));
try {
  await page.goto(
    `${process.env.REVIEW_URL ?? "http://127.0.0.1:5183"}/statue-review.html`,
  );
  await page.waitForFunction(() => window.statueReview?.ready, null, {
    timeout: 60000,
  });
  await page.screenshot({
    path: `${output}/review-dashboard.png`,
    fullPage: true,
  });
  for (const view of ["whole", "three", "side", "head-three", "head-side"]) {
    await page.evaluate((v) => window.statueReview.setView(v), view);
    await save(view, await page.evaluate(() => window.statueReview.capture()));
  }
  for (const mode of ["clay", "material"]) {
    await page.evaluate((m) => window.statueReview.setSurfaceMode(m), mode);
    for (const view of ["whole", "three", "side", "head-three", "head-side"]) {
      await page.evaluate((v) => window.statueReview.setView(v), view);
      await save(
        `${mode}-${view}`,
        await page.evaluate(() => window.statueReview.capture()),
      );
    }
  }
  await page.evaluate(() => window.statueReview.setSurfaceMode("photo"));
  await page.evaluate(() => window.statueReview.setView("whole"));
  await save(
    "head-mask",
    await page.evaluate(() => window.statueReview.mask("head")),
  );
  await save(
    "body-mask",
    await page.evaluate(() => window.statueReview.mask()),
  );
  const report = await page.evaluate(() => window.statueReview.report());
  report.browserErrors = errors;
  await writeFile(
    `${output}/measurements.json`,
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({
      headIoU: report.headIoU,
      bodyIoU: report.bodyIoU,
      face: report.face,
      browserErrors: errors,
    }),
  );
  if (errors.length) process.exitCode = 1;
} finally {
  await browser.close();
}
