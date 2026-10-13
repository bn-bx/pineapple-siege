import * as THREE from "three";
import { expect, it } from "vitest";
import { CrashWreckView } from "../src/render/crash-wreck";
import type { PlaneState } from "../src/types";
const plane = (crashed: number): PlaneState => ({
  p: [1000, 100, 1000],
  v: [100, 0, 0],
  yaw: 0,
  pitch: 0,
  roll: 0,
  speed: 100,
  crashed,
  boundary: false,
});
it("keeps the body after death and respawn, lands above terrain and eventually removes it", () => {
  const source = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ color: "#ffffff" });
  source.add(new THREE.Mesh(new THREE.BoxGeometry(4, 4, 12), material));
  const flame = new THREE.Mesh(new THREE.BoxGeometry(), material);
  flame.name = "flame";
  source.add(flame);
  const view = new CrashWreckView(source);
  view.update(plane(1), 0, () => 10);
  expect(view.group.children).toHaveLength(1);
  const wreck = view.group.children[0];
  expect(wreck.getObjectByName("flame")!.visible).toBe(false);
  expect(material.color.getHex()).toBe(0xffffff);
  view.update(plane(1), 1, () => 10);
  expect(view.group.children).toHaveLength(1);
  view.update(plane(0), 5, () => 10);
  expect(wreck.visible).toBe(true);
  expect(wreck.position.y).toBe(12);
  view.update(plane(0), 60, () => 10);
  expect(wreck.visible).toBe(false);
  view.reset();
  expect(wreck.visible).toBe(false);
});
it("reuses a bounded wreck pool across repeated respawns and clears on reset", () => {
  const view = new CrashWreckView(new THREE.Group());
  for (let i = 0; i < 20; i++) {
    view.update(plane(0), i * 2, () => 10);
    view.update(plane(1), i * 2 + 1, () => 10);
  }
  expect(view.group.children).toHaveLength(8);
  view.reset();
  expect(view.group.children.every((c) => !c.visible)).toBe(true);
});
