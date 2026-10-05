import { expect, it } from "vitest";
import * as THREE from "three";
import { Effects } from "../src/render/effects";
import type { Explosion } from "../src/types";
it("prewarms both cloud qualities and reuses the requested presentation without pool growth", () => {
  const effects = Object.create(Effects.prototype) as any;
  effects.flashPool = [];
  effects.cloudsPool = [];
  effects.clouds = [];
  effects.flashGeometry = new THREE.SphereGeometry(1, 8, 6);
  effects.prewarm();
  expect(effects.cloudsPool).toHaveLength(6);
  const event: Explosion = effects.cloudsPool[0].event;
  const full = effects.takeCloud(event, false),
    reduced = effects.takeCloud(event, true);
  effects.clouds.push(full, reduced);
  expect(full.reduced).toBe(false);
  expect(reduced.reduced).toBe(true);
  expect(reduced.smoke.count).toBeLessThan(full.smoke.count * 0.6);
  effects.prewarm();
  expect(effects.cloudsPool.length + effects.clouds.length).toBe(6);
  effects.cloudsPool.push(...effects.clouds.splice(0));
  for (let i = 0; i < 80; i++) {
    const requested = i % 2 === 0;
    const c = effects.takeCloud(event, requested);
    expect(c.reduced).toBe(requested);
    c.restart(event);
    effects.cloudsPool.push(c);
  }
  expect(effects.cloudsPool).toHaveLength(6);
  effects.disposePools();
});
