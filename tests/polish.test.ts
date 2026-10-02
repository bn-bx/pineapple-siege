import { expect, it } from "vitest";
import * as THREE from "three";
import { normalizePreferences } from "../src/preferences";
import { CameraRig } from "../src/render/camera-rig";
import { DEFAULT_DESTRUCTION } from "../src/destruction-settings";
import { frameStats } from "../src/frame-stats";
import { GameRenderer } from "../src/render/renderer";
import { SnapshotTimeline } from "../src/render/snapshot-timeline";
import type { SimulationSnapshot } from "../src/types";
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
it("defaults to eyes off and 120 monsters while preserving saved population choices", () => {
  expect(normalizePreferences()).toMatchObject({
    googlyEyes: false,
    monsterCount: 120,
  });
  const migrated = normalizePreferences({
    revision: 1,
    monsterCount: 8,
    nukeYield: "local",
  });
  expect(migrated).toMatchObject({
    googlyEyes: false,
    monsterCount: 8,
    nukeYield: "local",
  });
  expect(
    normalizePreferences({ ...migrated, monsterCount: 8, googlyEyes: false }),
  ).toMatchObject({
    monsterCount: 8,
    googlyEyes: false,
  });
  expect(normalizePreferences({ revision: 1, monsterCount: 3 })).toMatchObject({
    monsterCount: 3,
  });
});
it("turns the old automatic-on eyes off once and preserves later choices", () => {
  const migrated = normalizePreferences({
    revision: 2,
    googlyEyes: true,
    monsterCount: 8,
    nukeYield: "castle",
  });
  expect(migrated).toMatchObject({
    googlyEyes: false,
    monsterCount: 8,
    nukeYield: "castle",
  });
  expect(
    normalizePreferences({ ...migrated, googlyEyes: true }).googlyEyes,
  ).toBe(true);
  expect(
    normalizePreferences({ ...migrated, googlyEyes: false }).googlyEyes,
  ).toBe(false);
});
it("persists integer monster counts across 0–400 and normalizes invalid values", () => {
  for (const monsterCount of [0, 1, 7, 20, 99, 199, 200, 399, 400]) {
    const preferences = normalizePreferences({ revision: 3, monsterCount });
    expect(preferences.monsterCount).toBe(monsterCount);
    expect(normalizePreferences(preferences).monsterCount).toBe(monsterCount);
  }
  expect(normalizePreferences({ monsterCount: -1 }).monsterCount).toBe(0);
  expect(normalizePreferences({ monsterCount: 401 }).monsterCount).toBe(400);
  expect(normalizePreferences({ monsterCount: 7.6 }).monsterCount).toBe(8);
  expect(normalizePreferences({ monsterCount: NaN }).monsterCount).toBe(120);
  expect(normalizePreferences({ monsterCount: Infinity }).monsterCount).toBe(
    120,
  );
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
it("resumes the shared snapshot timeline at the latest state and retains camera snaps across message bursts", () => {
  const snapshot = (time: number, z: number) =>
    ({
      time,
      plane: { p: [0, 100, z], yaw: 0, pitch: 0, roll: 0, crashed: 0 },
    }) as SimulationSnapshot;
  const timeline = new SnapshotTimeline<SimulationSnapshot>();
  const view = { timeline, last: snapshot(1, 60), readyCamera: true };
  timeline.receive(snapshot(0.8, 48), 0);
  timeline.receive(view.last, 200);
  timeline.sample(200, true);
  GameRenderer.prototype.resumeSnapshots.call(view as unknown as GameRenderer);
  expect(timeline.sample(1000, true)?.current).toBe(view.last);
  expect(view.readyCamera).toBe(false);
  view.readyCamera = true;
  GameRenderer.prototype.receive.call(
    view as unknown as GameRenderer,
    snapshot(1.02, 1000),
  );
  GameRenderer.prototype.receive.call(
    view as unknown as GameRenderer,
    snapshot(1.04, 1001),
  );
  expect(view.readyCamera).toBe(false);
  expect(
    timeline.sample(1020, true)?.current.plane.p[2],
  ).toBeGreaterThanOrEqual(1000);
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
