// Check real menu visibility and interaction; use an isolated browser/save origin.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ?? "playwright"
);
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH ??
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const output = process.env.MENU_QA_OUTPUT ?? "/tmp/siege-pause-menu";
await mkdir(output, { recursive: true });
const ids = [
  "sensitivity",
  "reverseX",
  "invert",
  "reduceShake",
  "noCooldown",
  "quality",
  "renderDistance",
  "reduceEffects",
  "volume",
  "mute",
  "currentSeed",
  "copySeed",
  "copyIslandLink",
  "createIsland",
  "monsterCount",
  "time",
  "holdTime",
  "reset",
  "defaultSettings",
];
try {
  for (const [label, viewport] of [
    ["desktop", { width: 1280, height: 900 }],
    ["mobile", { width: 390, height: 844 }],
  ]) {
    const context = await browser.newContext({
      viewport,
      hasTouch: label === "mobile",
    });
    const page = await context.newPage();
    page.setDefaultTimeout(90000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(
      (process.env.ISLAND_URL ?? "http://127.0.0.1:5177/") +
        "?island=PS2-0000A301#debug",
    );
    await page.waitForFunction(
      () => !document.querySelector("#keepIsland").disabled,
    );
    await page.locator("#keepIsland").click();
    await page.waitForFunction(() => window.lanternVale?.state.ready);
    assert.equal(await page.locator("#settings > details[open]").count(), 4);
    await page.locator("#enter").click();
    await page.waitForFunction(() => lanternVale.state.active);
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !lanternVale.state.active);
    assert.equal(await page.locator("#enterLabel").textContent(), "Resume");
    // Debug instrumentation is enabled for state assertions; capture the player menu.
    await page.locator("#perf").evaluate((e) => (e.hidden = true));
    for (const id of ids) {
      const control = page.locator("#" + id);
      assert.equal(await control.isVisible(), true, `${label}: ${id} missing`);
      assert.equal(await control.isEnabled(), true, `${label}: ${id} disabled`);
      await control.scrollIntoViewIfNeeded();
      const box = await control.boundingBox();
      assert.ok(
        box.x >= 0 && box.x + box.width <= viewport.width + 1,
        `${label}: ${id} clipped horizontally`,
      );
    }
    for (const group of ["flight", "graphics", "audio", "world"]) {
      const details = page.locator(".settings-" + group);
      const summary = details.locator(":scope > summary");
      const child = details.locator("input, select, button").first();
      await summary.click();
      assert.equal(await child.isVisible(), false, `${group}: collapse failed`);
      await summary.focus();
      await page.keyboard.press("Enter");
      assert.equal(
        await child.isVisible(),
        true,
        `${group}: keyboard expansion failed`,
      );
      assert.equal(
        await summary.evaluate((e) => getComputedStyle(e, "::after").content),
        '"−"',
      );
      await page.screenshot({ path: `${output}/${label}-${group}.png` });
    }
    const advanced = page.locator(".advanced > summary");
    await advanced.click();
    assert.equal(await page.locator("#showPerf").isVisible(), true);
    await page.locator("#mute").check();
    await page.locator("#noCooldown").check();
    await page.locator("#enter").click();
    await page.waitForFunction(() => lanternVale.state.active);
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !lanternVale.state.active);
    assert.equal(await page.locator("#mute").isChecked(), true);
    assert.equal(await page.locator("#noCooldown").isChecked(), true);
    assert.deepEqual(errors, []);
    await context.close();
    console.log(
      `${label}: all settings visible and enabled; disclosures, keyboard, Advanced, resume/pause, and retained settings pass`,
    );
  }
} finally {
  await browser.close();
}
