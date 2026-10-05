import { expect, it } from "vitest";
import { SnapshotTimeline } from "../src/render/snapshot-timeline";
const state = (time: number) => ({ time, x: time * 100 });
it("keeps the latest transferable packet owned through repeated resumes", () => {
  const retired: number[] = [];
  const t = new SnapshotTimeline<ReturnType<typeof state>>(0.1, (s) =>
    retired.push(s.time),
  );
  const first = state(1),
    latest = state(1.1);
  t.receive(first, 0);
  t.receive(latest, 100);
  t.reset(latest);
  t.reset(latest);
  expect(retired).toEqual([1]);
  expect(t.sample(300, false)?.current).toBe(latest);
  t.receive(state(1.2), 400);
  t.sample(500, false);
  expect(retired).toEqual([1, 1.1]);
  t.reset();
  expect(retired).toEqual([1, 1.1, 1.2]);
});
const position = (
  p: NonNullable<
    ReturnType<SnapshotTimeline<ReturnType<typeof state>>["sample"]>
  >,
) => p.previous.x + (p.current.x - p.previous.x) * p.alpha;
it("keeps flight motion continuous when physics messages jitter and arrive in batches", () => {
  const timeline = new SnapshotTimeline<ReturnType<typeof state>>();
  // Alternating one/three-tick bursts, with several messages delivered together.
  const arrivals = [
    0, 16, 32, 80, 96, 112, 160, 176, 192, 240, 256, 272, 320, 336, 352, 400,
    416, 432, 480, 496, 512, 560, 576, 592, 640,
  ];
  let delivered = 0,
    last = -Infinity;
  const distances: number[] = [];
  for (let now = 0; now <= 640; now += 8) {
    while (delivered < arrivals.length && arrivals[delivered] <= now) {
      const due = arrivals[delivered++];
      const tick = Math.floor(due / (1000 / 60));
      // Include duplicate command snapshots at the same simulation time.
      timeline.receive(state(tick / 60), due);
      timeline.receive(state(tick / 60), due);
    }
    const p = timeline.sample(now, true)!;
    const x = position(p);
    expect(x).toBeGreaterThanOrEqual(last);
    if (now >= 160) distances.push(x - last);
    last = x;
  }
  expect(Math.min(...distances)).toBeGreaterThan(0.65);
  expect(Math.max(...distances)).toBeLessThan(0.9);
});
it("does not restart a blend or jump forward when a new snapshot arrives", () => {
  const t = new SnapshotTimeline<ReturnType<typeof state>>();
  for (let i = 0; i <= 10; i++) t.receive(state(i / 60), (i * 1000) / 60);
  const before = t.sample(170, true)!;
  t.receive(state(11 / 60), 170);
  const after = t.sample(170, true)!;
  expect(position(after)).toBeCloseTo(position(before), 8);
});
it("freezes on the latest state during pause, resumes without rewinding, and handles reset", () => {
  const t = new SnapshotTimeline<ReturnType<typeof state>>();
  t.receive(state(1), 0);
  t.receive(state(1.1), 100);
  const frozen = t.sample(100, false)!;
  expect(position(t.sample(900, false)!)).toBe(position(frozen));
  expect(position(t.sample(910, true)!)).toBeGreaterThanOrEqual(
    position(frozen),
  );
  t.receive(state(1.2), 1000);
  expect(position(t.sample(1000, true)!)).toBeGreaterThanOrEqual(
    position(frozen),
  );
  t.receive(state(0), 1100);
  expect(position(t.sample(1100, true)!)).toBe(0);
  t.reset();
  expect(t.sample(1200, true)).toBeUndefined();
});
it("bounds prolonged missing updates without extrapolating through collisions", () => {
  const t = new SnapshotTimeline<ReturnType<typeof state>>();
  t.receive(state(0), 0);
  t.receive(state(0.1), 100);
  for (let now = 100; now < 1000; now += 16) t.sample(now, true);
  expect(position(t.sample(1000, true)!)).toBeCloseTo(10, 8);
  t.receive(state(0.2), 1000);
  const resumed = t.sample(1000, true)!;
  expect(position(resumed)).toBeCloseTo(10, 8);
  expect(position(t.sample(1016, true)!)).toBeLessThan(12);
});
