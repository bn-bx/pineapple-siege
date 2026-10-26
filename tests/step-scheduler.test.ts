import { expect, it } from "vitest";
import { StepScheduler } from "../src/sim/step-scheduler";
it("keeps the intended publication rate when the worker only checks after physics ticks", () => {
  const s = new StepScheduler();
  s.reset(0);
  const deliveries: number[] = [];
  for (let now = 8; now <= 4000; now += 8) {
    const steps = s.advance(
      now,
      () => {},
      () => 0,
    );
    if (steps && s.shouldPublish(now)) deliveries.push(now);
  }
  expect(deliveries).toHaveLength(120);
  expect(deliveries.at(-1)).toBe(4000);
  expect(s.shouldPublish(4000)).toBe(false);
  // A long stall skips deadlines without replaying a backlog of packets.
  expect(s.shouldPublish(10000)).toBe(true);
  expect(s.shouldPublish(10008)).toBe(false);
  expect(s.shouldPublish(10024)).toBe(false);
  expect(s.shouldPublish(10040)).toBe(true);
});
it("keeps 60Hz physics with regular worker scheduling and publishes at most 30Hz", () => {
  const s = new StepScheduler();
  s.reset(0);
  let ticks = 0,
    published = 0;
  for (let now = 8; now <= 1000; now += 8) {
    s.advance(
      now,
      () => ticks++,
      () => 0,
    );
    if (s.shouldPublish(now)) published++;
  }
  expect(ticks).toBe(60);
  expect(published).toBeGreaterThanOrEqual(24);
  expect(published).toBeLessThanOrEqual(30);
});
it("yields after a slow explosion tick instead of doing six costly ticks in a row", () => {
  const s = new StepScheduler();
  s.reset(0);
  let wall = 100,
    ticks = 0;
  expect(
    s.advance(
      100,
      () => {
        ticks++;
        wall += 20;
      },
      () => wall,
    ),
  ).toBe(1);
  expect(ticks).toBe(1);
  // Debt is retained and can finish over subsequent callbacks.
  for (let i = 0; i < 4; i++)
    s.advance(
      100,
      () => ticks++,
      () => 0,
    );
  expect(ticks).toBe(6);
});
it("bounds fast catch-up batches and clears elapsed pause time", () => {
  const s = new StepScheduler();
  s.reset(0);
  let ticks = 0;
  expect(
    s.advance(
      10000,
      () => ticks++,
      () => 0,
    ),
  ).toBe(2);
  s.reset(10000);
  expect(
    s.advance(
      10008,
      () => ticks++,
      () => 0,
    ),
  ).toBe(0);
  expect(
    s.advance(
      10024,
      () => ticks++,
      () => 0,
    ),
  ).toBe(1);
});
