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
  "is brighter facing the blast but remains global without distance attenuation (reduced=%s)",
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
        camera.lookAt(0, 0, 0);
        flash.update(0, camera, reduced);
        expect(opacity(flash)).toBeCloseTo(initial, 10);
        camera.lookAt(camera.position.clone().multiplyScalar(2));
        flash.update(0, camera, reduced);
        expect(opacity(flash)).toBeCloseTo(initial * 0.45, 10);
        expect(flash.mesh.visible).toBe(true);
      }
      camera.position.set(0, 0, 1000);
      camera.lookAt(1000, 0, 1000);
      flash.update(0, camera, reduced);
      expect(opacity(flash)).toBeGreaterThan(initial * 0.45);
      expect(opacity(flash)).toBeLessThan(initial);
    } finally {
      dispose(flash);
    }
  },
);

it("uses each blast direction when combining overlapping flashes", () => {
  const flash = new NukeFlash(),
    camera = new THREE.PerspectiveCamera();
  try {
    camera.position.set(0, 0, 1000);
    camera.lookAt(0, 0, 0);
    flash.trigger(blast);
    flash.update(0, camera, false);
    expect(opacity(flash)).toBe(0.98);
    camera.lookAt(0, 0, 2000);
    flash.update(0, camera, false);
    expect(opacity(flash)).toBeCloseTo(1.15 * 0.45, 10);
    flash.trigger({ ...blast, p: [0, 0, 2000] });
    flash.update(0, camera, false);
    expect(opacity(flash)).toBe(0.98);
  } finally {
    dispose(flash);
  }
});

it("preserves yield-dependent fades and uses the strongest overlapping pulse", () => {
  const flash = new NukeFlash(),
    camera = new THREE.PerspectiveCamera();
  try {
    flash.trigger({ ...blast, profile: NUKE_PROFILES.local });
    flash.update(1.9, camera, false);
    expect(opacity(flash)).toBe(0);
    flash.trigger(blast);
    flash.update(1.9, camera, false);
    expect(opacity(flash)).toBeGreaterThan(0);
    flash.update(0.1, camera, false);
    expect(opacity(flash)).toBe(0);
    expect(flash.mesh.visible).toBe(false);
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
