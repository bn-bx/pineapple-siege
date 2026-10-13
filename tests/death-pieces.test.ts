import { afterEach, expect, it, vi } from "vitest";
import * as THREE from "three";
import { DeathPiecePose } from "../src/render/death-pieces";
import { ActorView } from "../src/render/actors";
import { MonsterFragmentView } from "../src/render/monster";
import { packMotion, bindMotion, motionFrame } from "../src/sim/motion-buffer";
import { ResourceDisposal } from "../src/render/resource-disposal";
import type { MonsterState, SimulationSnapshot, WorldData } from "../src/types";
import type { TerrainView } from "../src/render/terrain-view";
import type { Effects } from "../src/render/effects";

// Projectile textures require a canvas; this test exercises actor snapshots only.
vi.mock("../src/render/projectiles", () => ({
  ProjectileView: class {
    group = new THREE.Group();
    update() {}
    reset() {}
  },
}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("animates detached monster pieces from the worker's packed death timer", () => {
  const context = new Proxy({}, { get: () => () => {} });
  vi.stubGlobal("document", {
    createElement: () => ({
      width: 256,
      height: 256,
      getContext: () => context,
    }),
  });
  const scene = new THREE.Scene();
  const view = new ActorView(
    scene,
    { civilians: [] } as unknown as WorldData,
    { sample: () => 0 } as unknown as TerrainView,
    {} as Effects,
  );
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 100, 100);
  const monster: MonsterState = {
    id: 0,
    p: [0, 100, 0],
    yaw: 0,
    health: 0,
    defeated: true,
    phase: 0,
    windup: 0,
    stagger: 0,
    ragdoll: [0, 0, 0, 1],
    cleanupAge: 0,
    cleanupScale: 1,
  };
  const frame = motionFrame();
  const pieces = vi.spyOn(MonsterFragmentView.prototype, "add");
  const render = (age: number) => {
    monster.cleanupAge = age;
    const snapshot = {
      time: age,
      flies: [],
      civilians: [],
      settlements: [],
      projectiles: [],
      monsterSpikes: [],
      monsters: [],
      packedMotion: packMotion([], [monster], [], []),
    } as unknown as SimulationSnapshot;
    bindMotion(snapshot, frame);
    view.update(snapshot, undefined, 1, camera, 1200, false, 0, 1, false);
    const transforms: number[][] = [];
    scene.traverse((object) => {
      if (object instanceof THREE.InstancedMesh && object.count > 0)
        transforms.push(Array.from(object.instanceMatrix.array));
    });
    return transforms;
  };
  const initial = render(0);
  expect(pieces.mock.calls.map(([part]) => part)).toEqual([
    1, 2, 3, 4, 5, 6, 7,
  ]);
  expect(initial.length).toBeGreaterThan(0);
  expect(render(1)).not.toEqual(initial);
  const resources = new ResourceDisposal();
  resources.collect(scene);
  resources.dispose();
});

it("detaches a few visual pieces from the shared death pose and keeps them above terrain", () => {
  const pose = new DeathPiecePose(),
    root = new THREE.Object3D();
  const position = new THREE.Vector3(100, 50, 100),
    rotation = new THREE.Quaternion();
  pose.apply(
    root,
    position,
    rotation,
    [0, 15, 0],
    [18, 12, -6],
    0,
    2,
    2,
    [5, 5, 5],
    () => 0,
  );
  expect(root.position.toArray()).toEqual([100, 80, 100]);
  pose.apply(
    root,
    position,
    rotation,
    [0, 15, 0],
    [18, 12, -6],
    1,
    2,
    2,
    [5, 5, 5],
    () => 0,
  );
  expect(root.position.x).toBe(118);
  expect(root.quaternion.equals(rotation)).toBe(false);
  pose.apply(
    root,
    new THREE.Vector3(100, -100, 100),
    rotation,
    [0, 15, 0],
    [18, 12, -6],
    3,
    2,
    0.5,
    [5, 5, 5],
    () => 10,
  );
  root.updateMatrix();
  const m = root.matrix.elements;
  expect(
    root.position.y - (Math.abs(m[1]) + Math.abs(m[5]) + Math.abs(m[9])) * 5,
  ).toBeCloseTo(10);
  expect(position.toArray()).toEqual([100, 50, 100]);
  expect(rotation.equals(new THREE.Quaternion())).toBe(true);
});
