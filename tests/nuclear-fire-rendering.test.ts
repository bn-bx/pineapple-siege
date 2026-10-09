import { expect, it, vi } from "vitest";
import * as THREE from "three";
import { NuclearFireView } from "../src/render/nuclear-fire";
import { ResourceDisposal } from "../src/render/resource-disposal";
import { FIRE_LIMIT } from "../src/sim/nuclear-fire";
import { NUKE_PROFILES } from "../src/config";
import type { FirePatch, Explosion } from "../src/types";
const event: Explosion = {
  type: "explosion",
  kind: "nuke",
  p: [100, 0, 100],
  water: false,
  power: 1,
  seed: 1,
  profile: NUKE_PROFILES.valley,
};
const patches: FirePatch[] = Array.from({ length: FIRE_LIMIT }, (_, i) => ({
  id: i + 1,
  p: [i * 30, 10, 100],
  radius: 18,
  height: 10,
  age: 2,
  seed: i,
}));

it("uses fixed sprite pools and reduces particle counts without modifying authoritative fire state", () => {
  const fire = new NuclearFireView(),
    matrix = new THREE.Matrix4(),
    resources = new ResourceDisposal();
  try {
    const before = structuredClone(patches);
    fire.update(patches, 0, false, 2);
    expect(fire.flames.count).toBe(FIRE_LIMIT * 8);
    expect(fire.smoke.count).toBe(FIRE_LIMIT * 8);
    fire.flames.getMatrixAt(0, matrix);
    expect(matrix.elements[13]).toBeGreaterThan(10);
    expect(matrix.elements[13]).toBeLessThan(20);
    fire.update(patches, 0, true, 2);
    expect(fire.flames.count).toBe(FIRE_LIMIT * 4);
    expect(fire.smoke.count).toBe(FIRE_LIMIT * 4);
    expect(patches).toEqual(before);
    fire.update([{ ...patches[0], age: 59 }], 0, false, 59);
    expect(fire.flames.instanceColor!.getX(0)).toBeCloseTo(1 / 8);
    fire.reset();
    expect(fire.flames.count).toBe(0);
    expect(fire.smoke.visible).toBe(false);
  } finally {
    fire.collectResources(resources);
    resources.dispose();
  }
});

it("bounds and reuses orange fireballs, freezes their age on pause, and disposes pooled resources", () => {
  const fire = new NuclearFireView(),
    resources = new ResourceDisposal();
  for (let i = 0; i < 40; i++) fire.trigger(event);
  expect(fire.group.children).toHaveLength(10);
  fire.update([], 0.5, false, 0.5);
  const balls = fire.group.children.filter(
    (o) => o instanceof THREE.Mesh && !(o instanceof THREE.InstancedMesh),
  ) as THREE.Mesh[];
  const scales = balls.map((b) => b.scale.x);
  fire.update([], 0, false, 0.5);
  expect(balls.map((b) => b.scale.x)).toEqual(scales);
  expect(
    (balls[0].material as THREE.MeshBasicMaterial).color.getHexString(),
  ).toBe("ff791d");
  fire.update([], 2, false, 2.5);
  expect(fire.group.children).toHaveLength(2);
  fire.trigger(event);
  expect(fire.group.children).toHaveLength(3);
  const disposed = vi.fn();
  balls[0].geometry.addEventListener("dispose", disposed);
  fire.reset();
  fire.collectResources(resources);
  resources.dispose();
  expect(disposed).toHaveBeenCalledOnce();
});
