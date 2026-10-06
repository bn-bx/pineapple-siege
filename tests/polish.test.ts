import { expect, it } from "vitest";
import * as THREE from "three";
import { normalizePreferences } from "../src/preferences";
import { CameraRig } from "../src/render/camera-rig";
import { DEFAULT_DESTRUCTION } from "../src/destruction-settings";
import { frameStats } from "../src/frame-stats";
import { GameRenderer } from "../src/render/renderer";
import { SnapshotTimeline } from "../src/render/snapshot-timeline";
import type { SimulationSnapshot } from "../src/types";
it("locks destruction and laser defaults while preserving the cooldown toggle", () => {
  const migrated = normalizePreferences({
    nukeYield: "local",
    destruction: { ...DEFAULT_DESTRUCTION, noCooldown: true, bodies: 4 },
  });
  expect(migrated.nukeYield).toBe("valley");
  expect(migrated.destruction).toMatchObject({ noCooldown: true, bodies: 1 });
  expect(
    normalizePreferences({ ...migrated, nukeYield: "castle" }).nukeYield,
  ).toBe("valley");
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
    nukeYield: "valley",
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
    nukeYield: "valley",
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
it("prepares the actual smoothed camera boom for obstruction checks and resets without dragging across the island", () => {
  const rig = new CameraRig();
  const previous = new THREE.Vector3(0, 10, -30);
  const desired = new THREE.Vector3(0, 10, -5);
  const wall = new THREE.Box3(
    new THREE.Vector3(-4, 0, -24),
    new THREE.Vector3(4, 20, -20),
  );
  rig.prepareBoom(desired, previous, 1 / 60, true);
  const hit = new THREE.Ray(
    new THREE.Vector3(0, 10, 0),
    desired.clone().normalize(),
  ).intersectBox(wall, new THREE.Vector3());
  // Smoothing can put the boom behind a wall even when its requested end
  // was clear. The obstruction pass must receive this smoothed endpoint.
  expect(desired.z).toBeLessThan(-24);
  expect(hit).not.toBeNull();
  expect(previous.toArray()).toEqual([0, 10, -30]);
  const reset = new THREE.Vector3(2000, 200, 2000);
  rig.prepareBoom(reset, previous, 1 / 60, false);
  expect(reset.toArray()).toEqual([2000, 200, 2000]);
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
it("normalizes saved render distance without resetting other preferences", () => {
  expect(normalizePreferences().renderDistance).toBe(1200);
  for (const [value, expected] of [
    [NaN, 1200],
    [Infinity, 1200],
    [-1, 600],
    [5000, 3000],
    [1649, 1600],
    [1650, 1700],
  ]) {
    const preferences = normalizePreferences({
      revision: 3,
      renderDistance: value,
      monsterCount: 7,
      nukeYield: "local",
    });
    expect(preferences.renderDistance).toBe(expected);
    expect(preferences.monsterCount).toBe(7);
    expect(preferences.nukeYield).toBe("valley");
  }
});
it("gives separate settlements independent draw bounds so distant structures can be culled", () => {
  const view = {
    world: {
      entities: [200, 2200].map((z, id) => ({
        id,
        kind: "block",
        material: "stone",
        p: [0, 10, z],
        s: [10, 10, 10],
        variant: 0,
      })),
    },
    scene: new THREE.Scene(),
    refs: new Map(),
    batches: [],
    box: new THREE.BoxGeometry(2, 2, 2),
    materials: { stone: new THREE.MeshStandardMaterial() },
  };
  (GameRenderer.prototype as any).buildBatches.call(view);
  const camera = new THREE.PerspectiveCamera(64, 1, 0.5, 600);
  camera.position.set(0, 10, 0);
  camera.lookAt(0, 10, 1);
  camera.updateMatrixWorld();
  view.scene.updateMatrixWorld();
  const frustum = new THREE.Frustum().setFromProjectionMatrix(
    new THREE.Matrix4().multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse,
    ),
  );
  expect(frustum.intersectsObject(view.refs.get(0)[0].batch.mesh)).toBe(true);
  expect(frustum.intersectsObject(view.refs.get(1)[0].batch.mesh)).toBe(false);
});
it("keeps the near edge of oversized rubble visible inside render distance", () => {
  const view = Object.assign(Object.create(GameRenderer.prototype), {
    scene: new THREE.Scene(),
    camera: { position: new THREE.Vector3(755, 10, 64) },
    renderDistance: 600,
    ruins: new Map(),
    ruinCells: new Map(),
    ruinGroups: new Map(),
    dirtyRuinBatches: new Set(),
    fractureBox: new THREE.BoxGeometry(2, 2, 2),
    fragmentMaterials: { stone: new THREE.MeshStandardMaterial() },
    fragmentColor: new THREE.Color(),
  });
  view.addRuin({
    id: 0,
    source: 0,
    kind: "chunk",
    material: "stone",
    pile: true,
    p: [127, 10, 64],
    q: [0, 0, 0, 1],
    s: [40, 20, 40],
  });
  view.updateRuins();
  const group = [...view.ruinGroups.values()][0] as THREE.Group;
  group.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(group);
  expect(
    view.camera.position.distanceTo(
      bounds.clampPoint(view.camera.position, new THREE.Vector3()),
    ),
  ).toBeLessThan(600);
  expect(group.visible).toBe(true);
  view.camera.position.x = 2000;
  view.updateRuins();
  expect(group.visible).toBe(false);
});
