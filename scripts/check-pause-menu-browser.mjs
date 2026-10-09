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
  "crtMode",
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
    ["short-laptop", { width: 1280, height: 600 }],
  ]) {
    const context = await browser.newContext({
      viewport,
      permissions: ["clipboard-read", "clipboard-write"],
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
    assert.equal(await page.locator("#menuHome").isVisible(), true);
    assert.equal(await page.locator("#menuSettings").isVisible(), false);
    await page.locator("#enter").click();
    await page.waitForFunction(() => lanternVale.state.active);
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !lanternVale.state.active);
    assert.equal(await page.locator("#enterLabel").textContent(), "Resume");
    // Debug instrumentation is enabled for state assertions; capture the player menu.
    await page.locator("#perf").evaluate((e) => (e.hidden = true));
    await page.screenshot({ path: `${output}/${label}-home.png` });
    await page.locator("#openControls").click();
    assert.equal(await page.locator("#menuControls").isVisible(), true);
    await page.keyboard.press("Escape");
    assert.equal(
      await page
        .locator("#openControls")
        .evaluate((e) => e === document.activeElement),
      true,
    );
    await page.locator("#openSettings").click();
    for (const group of ["flight", "graphics", "audio", "world"]) {
      await page.locator("#tab-" + group).click();
      assert.equal(
        await page.locator("#settings > section:not([hidden])").count(),
        1,
      );
      const panel = page.locator("#panel-" + group);
      for (const id of ids) {
        const control = panel.locator("#" + id);
        if (!(await control.count())) continue;
        assert.equal(
          await control.isVisible(),
          true,
          `${label}: ${id} missing`,
        );
        assert.equal(
          await control.isEnabled(),
          true,
          `${label}: ${id} disabled`,
        );
        await control.scrollIntoViewIfNeeded();
        const box = await control.boundingBox();
        assert.ok(
          box.x >= 0 && box.x + box.width <= viewport.width + 1,
          `${label}: ${id} clipped`,
        );
      }
      await page.screenshot({ path: `${output}/${label}-${group}.png` });
    }
    await page.locator("#tab-flight").click();
    await page.locator("#tab-flight").focus();
    await page.keyboard.press("ArrowRight");
    assert.equal(
      await page.locator("#tab-graphics").getAttribute("aria-selected"),
      "true",
    );
    const advanced = page.locator(".advanced > summary");
    await advanced.click();
    assert.equal(await page.locator("#showPerf").isVisible(), true);
    await page.locator("#tab-audio").click();
    await page.locator("#mute").check();
    await page.locator("#tab-flight").click();
    await page.locator("#noCooldown").check();
    await page.locator("#tab-world").click();
    await page.locator("#copySeed").click();
    await page.waitForFunction(
      () => document.querySelector("#islandShareStatus").textContent.length > 0,
    );
    await page.locator("#copyIslandLink").click();
    await page.waitForFunction(
      () => document.querySelector("#islandShareStatus").textContent.length > 0,
    );
    await page.locator("#reset").click();
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("#confirm").isVisible(), false);
    assert.equal(await page.locator("#panel-world").isVisible(), true);
    await page.locator("#createIsland").click();
    await page.waitForFunction(
      () => !document.querySelector("#keepIsland").disabled,
    );
    await page.locator("#keepIsland").click();
    assert.equal(await page.locator("#islandReplacePrompt").isVisible(), true);
    await page.locator("#backToIsland").click();
    await page.locator("#cancelIsland").click();
    await page.locator("#backFromSettings").click();
    await page.locator("#enter").click();
    await page.waitForFunction(() => lanternVale.state.active);
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !lanternVale.state.active);
    assert.equal(await page.locator("#mute").isChecked(), true);
    assert.equal(await page.locator("#noCooldown").isChecked(), true);
    await page.reload();
    await page.waitForFunction(() => window.lanternVale?.state.ready);
    await page.locator("#openSettings").click();
    assert.equal(await page.locator("#panel-flight").isVisible(), true);
    assert.equal(await page.locator("#noCooldown").isChecked(), true);
    await page.locator("#tab-audio").click();
    assert.equal(await page.locator("#mute").isChecked(), true);
    await page.locator("#defaultSettings").click();
    assert.equal(await page.locator("#mute").isChecked(), false);
    await page.locator("#tab-flight").click();
    assert.equal(await page.locator("#noCooldown").isChecked(), false);
    assert.deepEqual(errors, []);
    await context.close();
    console.log(
      `${label}: category navigation, help, keyboard, dialogs, Advanced, resume/pause, and retained settings pass`,
    );
  }
} finally {
  await browser.close();
}
