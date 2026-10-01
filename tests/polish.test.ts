import { expect, it } from "vitest";
import * as THREE from "three";
import { normalizePreferences } from "../src/preferences";
import { CameraRig } from "../src/render/camera-rig";
import { DEFAULT_DESTRUCTION } from "../src/destruction-settings";
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
