import { expect, it } from "vitest";
import * as THREE from "three";
import { normalizePreferences } from "../src/preferences";
import { CameraRig } from "../src/render/camera-rig";
import { DEFAULT_DESTRUCTION } from "../src/destruction-settings";
import * as flight from "../src/render/flight-pose";
import type { PlaneState } from "../src/types";
import { frameStats } from "../src/frame-stats";
it("migrates valley strength once without changing experimental choices", () => {
  const migrated = normalizePreferences({
    nukeYield: "local",
    destruction: { ...DEFAULT_DESTRUCTION, noCooldown: true, bodies: 4 },
  });
  expect(migrated.nukeYield).toBe("valley");
  expect(migrated.destruction).toMatchObject({ noCooldown: true, bodies: 4 });
  expect(
    normalizePreferences({ ...migrated, nukeYield: "castle" }).nukeYield,
  ).toBe("castle");
});
it("normalizes every persistent setting independently", () => {
  const p = normalizePreferences({
    quality: "invalid",
    volume: NaN,
    reduceEffects: true,
    reduceShake: true,
    mute: true,
    holdTime: true,
    showPerf: true,
  });
  expect(p).toMatchObject({
    quality: "auto",
    volume: 0.35,
    reduceEffects: true,
    reduceShake: true,
    mute: true,
    holdTime: true,
    showPerf: true,
  });
  expect(normalizePreferences({ ...p, volume: 9 }).volume).toBe(1);
});
it("cinematic shots remain finite and cycle with a level target", () => {
  const r = new CameraRig();
  r.toggle();
  const origin = new THREE.Vector3(100, 100, 100),
    forward = new THREE.Vector3(0, 0, 1);
  for (let i = 0; i < 2400; i++) {
    const s = r.cinematic(origin, forward, 1 / 60);
    expect(s.position.distanceTo(origin)).toBeLessThan(80);
    expect(s.target.toArray()).toEqual([100, 100, 106]);
  }
  expect(r.mode).toBe("cinematic");
  r.toggle();
  expect(r.mode).toBe("chase");
});
it("photo movement leaves the original camera untouched until applied and restores cinematic mode", () => {
  const r = new CameraRig(),
    c = new THREE.PerspectiveCamera();
  c.position.set(100, 80, 100);
  r.toggle();
  r.photo(c);
  r.move(new Set(["KeyW"]), 1);
  expect(c.position.z).toBe(100);
  r.applyPhoto(c, () => 0);
  expect(c.position.z).toBe(65);
  r.exitPhoto();
  expect(r.mode).toBe("cinematic");
});
it("photo diagonal speed is normalized and terrain floor constrains camera", () => {
  const a = new CameraRig(),
    b = new CameraRig(),
    ca = new THREE.PerspectiveCamera(),
    cb = new THREE.PerspectiveCamera();
  ca.position.set(100, 20, 100);
  cb.position.copy(ca.position);
  a.photo(ca);
  b.photo(cb);
  a.move(new Set(["KeyW"]), 1);
  b.move(new Set(["KeyW", "KeyD"]), 1);
  a.applyPhoto(ca, () => 0);
  b.applyPhoto(cb, () => 0);
  expect(ca.position.distanceTo(new THREE.Vector3(100, 20, 100))).toBeCloseTo(
    cb.position.distanceTo(new THREE.Vector3(100, 20, 100)),
  );
  b.applyPhoto(cb, () => 50);
  expect(cb.position.y).toBe(51);
});

const planeAt = (time: number): PlaneState => ({
  p: [0, 100, time * 60],
  v: [0, 0, 60],
  yaw: 0,
  pitch: 0,
  roll: 0,
  speed: 60,
  crashed: 0,
  boundary: false,
});
function timeline() {
  return new flight.FlightTimeline(0.05);
}
it("keeps constant-speed flight smooth through irregular and duplicate snapshot arrivals", () => {
  for (const delay of [2 / 60, 0.05]) {
    const clock = new flight.FlightTimeline(delay);
    const arrivals = [0, 25, 40, 55, 85, 90, 110, 140, 145, 160, 185];
    let next = 0;
    for (let now = 0; now <= 190; now += 10) {
      while (next < arrivals.length && arrivals[next] <= now) {
        const time = next++ / 60;
        clock.receive({ time, plane: planeAt(time) });
        clock.receive({ time, plane: planeAt(time) });
      }
      // Constant flight advances 0.6 m per 10 ms once the buffer fills.
      expect(clock.sample(now, true)!.position.z).toBeCloseTo(
        Math.max(0, (now / 1000 - delay) * 60),
        6,
      );
    }
  }
});
it("holds at the latest known position during a worker stall and resumes without a catch-up jump", () => {
  const clock = timeline();
  for (let now = 0; now <= 100; now += 10) {
    clock.receive({ time: now / 1000, plane: planeAt(now / 1000) });
    clock.sample(now, true);
  }
  expect(clock.sample(180, true)!.position.z).toBeCloseTo(6);
  clock.receive({ time: 0.12, plane: planeAt(0.12) });
  expect(clock.sample(220, true)!.position.z).toBeCloseTo(6);
  clock.receive({ time: 0.18, plane: planeAt(0.18) });
  expect(clock.sample(230, true)!.position.z).toBeCloseTo(6.6);
  expect(clock.sample(240, true)!.position.z).toBeCloseTo(7.2);
});
it("restarts interpolation from the frozen plane after pause and a reset simulation clock", () => {
  const clock = timeline();
  clock.receive({ time: 5, plane: planeAt(5) });
  clock.sample(0, true);
  expect(clock.sample(1000, false)!.position.z).toBe(300);
  expect(clock.sample(5000, true)!.position.z).toBe(300);
  clock.receive({ time: 5.02, plane: planeAt(5.02) });
  expect(clock.sample(5020, true)!.position.z).toBe(300);
  clock.reset();
  clock.receive({ time: 0, plane: planeAt(0) });
  expect(clock.sample(6000, true)!.position.z).toBe(0);
  clock.receive({ time: 5, plane: planeAt(5) });
  clock.receive({ time: 0, plane: planeAt(0) });
  expect(clock.sample(6010, true)!.position.z).toBe(0);
});
it("snaps crash changes and same-timestamp respawns instead of buffering them", () => {
  const clock = timeline();
  clock.receive({ time: 1, plane: planeAt(1) });
  clock.sample(0, true);
  clock.receive({ time: 1.01, plane: { ...planeAt(1.01), crashed: 2 } });
  expect(clock.sample(10, true)!.position.z).toBe(60.6);
  const respawn = {
    ...planeAt(1.01),
    p: [1000, 400, 700] as [number, number, number],
  };
  clock.receive({ time: 1.01, plane: respawn });
  expect(clock.sample(20, true)!.position.toArray()).toEqual([1000, 400, 700]);
});
it("resumes forward after a queued snapshot burst evicts the old interpolation bracket", () => {
  const clock = new flight.FlightTimeline();
  clock.receive({ time: 0, plane: planeAt(0) });
  clock.sample(0, true);
  for (let tick = 1; tick <= 20; tick++)
    clock.receive({ time: tick / 100, plane: planeAt(tick / 100) });
  const a = clock.sample(20, true)!.position.z;
  const b = clock.sample(30, true)!.position.z;
  expect(a).toBeGreaterThanOrEqual(7.8);
  expect(b).toBeLessThanOrEqual(12);
  expect(b - a).toBeCloseTo(0.6);
});
it("preserves a teleport's camera snap until rendering consumes it, even after another snapshot", () => {
  const clock = new flight.FlightTimeline();
  clock.receive({ time: 1, plane: planeAt(1) });
  clock.sample(0, true);
  clock.receive({
    time: 1.02,
    plane: { ...planeAt(1.02), p: [1000, 400, 700] },
  });
  clock.receive({
    time: 1.04,
    plane: { ...planeAt(1.04), p: [1000, 400, 701] },
  });
  expect(clock.sample(20, true)!.discontinuity).toBe(true);
  expect(clock.sample(30, true)!.discontinuity).toBe(false);
});
it("reports the mean of the slowest one percent using uncapped recent frame times", () => {
  const samples = [...Array(598).fill(10), 100, 200];
  const stats = frameStats(samples);
  expect(stats.medianMS).toBe(10);
  expect(stats.p95MS).toBe(10);
  expect(stats.worstMS).toBe(200);
  // Six slow frames: 200 + 100 + 4*10 = 340 ms; 6000 / 340 FPS.
  expect(stats.lowFPS).toBeCloseTo(17.6470588235);
  expect(samples.at(-1)).toBe(200);
  expect(frameStats(Array(99).fill(10)).lowFPS).toBeUndefined();
  expect(frameStats([500, ...Array(600).fill(20)]).worstMS).toBe(20);
});
