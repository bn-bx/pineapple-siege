import { expect, it } from "vitest";
import { AutoQuality, type QualityPressure } from "../src/render/auto-quality";
import { qualityProfile } from "../src/render/quality-profile";

const healthy: QualityPressure = {
  frameMS: 16.67,
  cpuMS: 7,
  gpuMS: 12,
  workerMS: 4,
  lagMS: 0,
};
const load = { ...healthy, frameMS: 24, gpuMS: 20 };
function feed(
  auto: AutoQuality,
  start: number,
  end: number,
  pressure: QualityPressure,
) {
  for (let now = start; now <= end; now += 100) auto.update(now, pressure);
}

it("starts at the same 1440p quality as manual Ultra and stays there at smooth frame rates", () => {
  const auto = new AutoQuality();
  expect(auto.level).toBe(0);
  expect(qualityProfile("auto", auto.level)).toEqual(qualityProfile("1440"));
  feed(auto, 0, 30000, { ...healthy, cpuMS: 13, workerMS: 30, lagMS: 120 });
  expect(auto.level).toBe(0);
});

it("waits for startup and sustained overload, then recovers after five seconds of healthy rendering", () => {
  const auto = new AutoQuality();
  feed(auto, 0, 2900, load);
  expect(auto.level).toBe(0);
  feed(auto, 3000, 4800, load);
  expect(auto.level).toBe(0);
  expect(auto.update(4900, load)).toBe(true);
  expect(auto.level).toBe(1);
  expect(auto.height).toBe(1080);
  feed(auto, 5000, 9800, healthy);
  expect(auto.level).toBe(1);
  expect(auto.update(9900, healthy)).toBe(true);
  expect(auto.height).toBe(1440);
});

it("ignores short blasts and alternating spikes while responding sooner to severe sustained slowdown", () => {
  const auto = new AutoQuality();
  feed(auto, 0, 3000, healthy);
  feed(auto, 3100, 4000, load);
  feed(auto, 4100, 6000, healthy);
  for (let now = 6100; now < 12000; now += 100)
    auto.update(now, now % 200 ? load : healthy);
  expect(auto.level).toBe(0);
  const severe = { ...load, frameMS: 45, gpuMS: 35 };
  auto.update(12000, healthy);
  feed(auto, 12100, 12700, severe);
  expect(auto.level).toBe(0);
  expect(auto.update(12800, severe)).toBe(true);
  expect(auto.level).toBe(1);
});

it("does not reduce graphics for worker-only stalls, but handles missing GPU timers", () => {
  const workerBound = new AutoQuality();
  feed(workerBound, 0, 30000, {
    ...healthy,
    cpuMS: 3,
    gpuMS: 7,
    frameMS: 40,
    workerMS: 30,
    lagMS: 120,
  });
  expect(workerBound.level).toBe(0);
  const noTimer = new AutoQuality();
  feed(noTimer, 0, 4900, { ...load, gpuMS: 0 });
  expect(noTimer.level).toBe(1);
});

it("discards paused wall time and requires fresh overload or recovery evidence", () => {
  const auto = new AutoQuality(2);
  feed(auto, 0, 7000, healthy);
  expect(auto.level).toBe(2);
  auto.resume();
  expect(auto.update(100000, healthy)).toBe(false);
  feed(auto, 100100, 107800, healthy);
  expect(auto.level).toBe(2);
  expect(auto.update(107900, healthy)).toBe(true);
  feed(auto, 108000, 109000, load);
  auto.resume();
  feed(auto, 200000, 204800, load);
  expect(auto.level).toBe(1);
  expect(auto.update(204900, load)).toBe(true);
  expect(auto.level).toBe(2);
});

it("bounds degradation and shares resolution and shadow budgets with the render profile", () => {
  const auto = new AutoQuality();
  feed(auto, 0, 30000, load);
  expect(auto.level).toBe(4);
  for (let level = 0; level <= 4; level++) {
    const a = new AutoQuality(level),
      profile = qualityProfile("auto", level);
    expect(a.height).toBe(profile.height);
    expect(a.shadowSize).toBe(profile.shadowSize);
    expect(a.shadowInterval).toBe(profile.shadowInterval);
  }
});

it("responds to recurring GPU misses hidden by a healthy average without dropping object detail", () => {
  const auto = new AutoQuality();
  let changedAt = 0;
  for (let frame = 0; frame < 900; frame++) {
    const missed = frame % 30 === 0;
    if (
      auto.update((frame * 1000) / 60, {
        ...healthy,
        frameMS: 17.2,
        frameSampleMS: missed ? 33.3 : 16.67,
        gpuMS: missed ? 25 : 12,
      })
    ) {
      changedAt = (frame * 1000) / 60;
      break;
    }
  }
  expect(changedAt).toBeGreaterThan(5000);
  expect(auto.level).toBe(1);
  const ultra = qualityProfile("auto", 0),
    high = qualityProfile("auto", 1);
  expect(high.height).toBeLessThan(ultra.height);
  for (const key of [
    "treeDistance",
    "shadowSize",
    "debrisShadows",
    "cosmetics",
  ] as const)
    expect(high[key]).toBe(ultra[key]);
  for (let now = changedAt + 17; now < changedAt + 14000; now += 17)
    auto.update(now, { ...healthy, frameSampleMS: 16.67 });
  expect(auto.level).toBe(1); // Avoid immediately reallocating the larger buffers.
});

it("keeps isolated frame spikes and recurring worker-only stalls from reducing resolution", () => {
  for (const workerOnly of [false, true]) {
    const auto = new AutoQuality();
    for (let frame = 0; frame < 1800; frame++) {
      const missed = workerOnly ? frame % 30 === 0 : frame === 300;
      auto.update((frame * 1000) / 60, {
        ...healthy,
        frameSampleMS: missed ? 33.3 : 16.67,
        gpuMS: workerOnly ? 7 : missed ? 30 : 12,
        workerMS: workerOnly ? 30 : 4,
        lagMS: workerOnly ? 120 : 0,
      });
    }
    expect(auto.level).toBe(0);
  }
});
