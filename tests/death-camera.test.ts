import { expect, it } from "vitest";
import * as THREE from "three";
import { DeathCamera, clearDeathCamera } from "../src/render/death-camera";
import { CameraRig } from "../src/render/camera-rig";
const camera = () => {
  const camera = new THREE.PerspectiveCamera(64);
  camera.position.set(500, 50, 470);
  camera.lookAt(500, 40, 500);
  return camera;
};
it("pulls back smoothly for 1.5 seconds, then holds a captured focus and pose", () => {
  const view = camera(),
    death = new THREE.Vector3(500, 30, 500);
  const shot = new DeathCamera(death, view, 0);
  expect(shot.position.equals(view.position)).toBe(true);
  const clear = (p: THREE.Vector3, old: THREE.Vector3) =>
    clearDeathCamera(p, old, 9216, () => 0, []);
  shot.frame(0.75, clear);
  expect(shot.position.z).toBeCloseTo(335);
  expect(shot.fov).toBe(68);
  const paused = shot.position.clone();
  shot.frame(0, clear);
  expect(shot.position.equals(paused)).toBe(true);
  death.set(1000, 600, 1000);
  shot.frame(0.75, clear);
  expect(shot.position.toArray()).toEqual([500, 180, 200]);
  expect(shot.target.toArray()).toEqual([500, 30, 500]);
  expect(shot.fov).toBe(72);
  const pose = shot.position.clone();
  shot.frame(20, clear);
  expect(shot.position.equals(pose)).toBe(true);
});
it("frames high airborne deaths over the ground and clears its transient state on chase", () => {
  const rig = new CameraRig(),
    view = camera();
  rig.beginDeath(new THREE.Vector3(500, 900, 500), view, 100);
  const shot = rig.deathShot!;
  expect(shot.focus.y).toBe(130);
  rig.beginDeath(new THREE.Vector3(800, 50, 800), view, 0);
  expect(rig.deathShot).toBe(shot);
  shot.frame(2, () => {});
  expect(shot.position.y).toBe(980);
  rig.toggle();
  rig.photo(view);
  expect(rig.mode).toBe("death");
  rig.chase();
  expect(rig.mode).toBe("chase");
  expect(rig.deathShot).toBeUndefined();
});
it("clears swept buildings, terrain ridges, water and world bounds without shortening the shot", () => {
  const old = new THREE.Vector3(500, 20, 500),
    desired = new THREE.Vector3(500, 40, 200);
  const wall = new THREE.Box3(
    new THREE.Vector3(490, 0, 300),
    new THREE.Vector3(510, 80, 350),
  );
  const taller = new THREE.Box3(
    new THREE.Vector3(490, 65, 250),
    new THREE.Vector3(510, 140, 280),
  );
  clearDeathCamera(desired, old, 9216, () => 0, [wall, taller]);
  expect(desired.y).toBeGreaterThanOrEqual(150);
  expect(desired.z).toBe(200);
  const ridge = new THREE.Vector3(500, 40, 200);
  clearDeathCamera(
    ridge,
    old,
    9216,
    (_x, z) => (z < 350 && z > 300 ? 200 : 0),
    [],
  );
  expect(ridge.y).toBeGreaterThan(200);
  const edge = new THREE.Vector3(-50, -40, 9500);
  clearDeathCamera(edge, new THREE.Vector3(3, 20, 9213), 9216, () => 0, []);
  expect(edge.toArray()).toEqual([3, 10, 9213]);
});
