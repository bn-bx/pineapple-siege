import { expect, it } from "vitest";
import * as THREE from "three";
import { NukeFlash } from "../src/render/nuke-flash";
import { NUKE_PROFILES } from "../src/config";
import type { Explosion } from "../src/types";

const blast: Explosion = {
  type: "explosion",
  kind: "nuke",
  p: [0, 0, 0],
  water: false,
  seed: 0,
  power: 1,
  profile: NUKE_PROFILES.valley,
};
const opacity = (flash: NukeFlash) =>
  flash.mesh.material.uniforms.opacity.value as number;
function dispose(f: NukeFlash) {
  f.mesh.geometry.dispose();
  f.mesh.material.dispose();
}

it("lights the view across the map, including when the blast is behind the camera", () => {
  const flash = new NukeFlash(),
    camera = new THREE.PerspectiveCamera();
  try {
    camera.position.set(0, 0, 2800);
    flash.trigger(blast);
    flash.update(0, camera, false);
    const toward = opacity(flash);
    expect(toward).toBeGreaterThan(0.7);
    camera.lookAt(0, 0, 5000);
    flash.update(0, camera, false);
    expect(opacity(flash)).toBeGreaterThan(0.3);
    expect(opacity(flash)).toBeLessThan(toward);
  } finally {
    dispose(flash);
  }
});

it("keeps reduced effects dim, preserves pauses, and fully clears after fading", () => {
  const flash = new NukeFlash(),
    camera = new THREE.PerspectiveCamera();
  try {
    camera.position.set(0, 0, 1500);
    flash.trigger(blast);
    flash.update(0, camera, true);
    expect(opacity(flash)).toBeLessThanOrEqual(0.12);
    const initial = opacity(flash);
    flash.update(0, camera, true);
    expect(opacity(flash)).toBe(initial);
    flash.update(2, camera, true);
    expect(opacity(flash)).toBe(0);
    flash.reset();
    expect(flash.mesh.visible).toBe(false);
    flash.trigger(blast);
    flash.update(9, camera, false);
    expect(flash.mesh.visible).toBe(false);
  } finally {
    dispose(flash);
  }
});
