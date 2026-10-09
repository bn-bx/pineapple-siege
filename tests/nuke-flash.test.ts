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

it.each([false, true])(
  "has global brightness regardless of camera position or facing (reduced=%s)",
  (reduced) => {
    const flash = new NukeFlash(),
      camera = new THREE.PerspectiveCamera();
    try {
      flash.trigger(blast);
      flash.update(1, camera, reduced);
      const initial = opacity(flash);
      expect(initial).toBeGreaterThan(0);
      for (const position of [
        [0, 0, 2800],
        [6000, 2000, 6000],
        [0, -500, 0],
      ]) {
        camera.position.fromArray(position);
        for (const target of [
          [0, 0, 0],
          [10000, 5000, 10000],
          [-10000, -5000, -10000],
        ]) {
          camera.lookAt(...(target as [number, number, number]));
          flash.update(0, camera, reduced);
          expect(opacity(flash)).toBe(initial);
        }
      }
    } finally {
      dispose(flash);
    }
  },
);

it("preserves yield-dependent fades and uses the strongest overlapping pulse", () => {
  const flash = new NukeFlash(),
    camera = new THREE.PerspectiveCamera();
  try {
    flash.trigger({ ...blast, profile: NUKE_PROFILES.local });
    flash.update(5.2, camera, false);
    expect(opacity(flash)).toBe(0);
    flash.trigger(blast);
    flash.update(5.2, camera, false);
    expect(opacity(flash)).toBeGreaterThan(0);
    flash.trigger(blast);
    flash.update(0, camera, false);
    expect(opacity(flash)).toBe(0.98);
    flash.trigger(blast);
    flash.update(0, camera, false);
    expect(opacity(flash)).toBe(0.98);
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
