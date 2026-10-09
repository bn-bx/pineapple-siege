import { expect, it, vi } from "vitest";
import * as THREE from "three";
import { ResourceDisposal } from "../src/render/resource-disposal";
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
  effects.group = new THREE.Group();
  effects.reset = () => {};
  const resources = new ResourceDisposal();
  effects.dispose(resources);
  resources.dispose();
  expect(effects.cloudsPool).toHaveLength(0);
});

it.each([false, true, "mixed"] as const)(
  "retains eight overlapping clouds for 20 seconds and recycles the oldest (%s)",
  (quality) => {
    vi.stubGlobal("document", {
      createElement: () => ({
        getContext: () => ({
          createRadialGradient: () => ({ addColorStop() {} }),
          fillRect() {},
        }),
      }),
    });
    const effects = new Effects();
    const state = effects as any;
    const resources = new ResourceDisposal();
    try {
      effects.prewarm();
      const event: Explosion = {
        ...state.cloudsPool[0].event,
        p: [100, 0, 100],
      };
      const emit = (seed: number) => {
        effects.reduced = quality === "mixed" ? seed % 2 === 1 : quality;
        effects.explosion({ ...event, seed });
      };
      for (let i = 0; i < 8; i++) {
        emit(i);
        effects.update(1);
      }
      expect(effects.cloudCount).toBe(8);
      const original = [...state.clouds];
      expect(original.every((cloud) => !cloud.ending)).toBe(true);
      expect(original[0].age).toBe(8);
      const ages = original.map((cloud) => cloud.age);
      effects.update(0);
      expect(state.clouds.map((cloud: any) => cloud.age)).toEqual(ages);
      const oldest = original[0];
      emit(8);
      expect(effects.cloudCount).toBe(8);
      expect(state.clouds.map((cloud: any) => cloud.event.seed)).toEqual([
        1, 2, 3, 4, 5, 6, 7, 8,
      ]);
      expect(state.clouds[7]).toBe(oldest);
      expect(oldest.age).toBe(0);
      expect(
        original
          .slice(1)
          .every((cloud) => cloud.group.parent === effects.group),
      ).toBe(true);
      effects.update(12.9);
      expect(effects.cloudCount).toBe(8);
      effects.update(0.2);
      expect(effects.cloudCount).toBe(7);
      expect(original[1].group.parent).toBe(null);
      effects.update(7);
      expect(effects.cloudCount).toBe(0);
      const allocated = state.cloudsPool.length;
      for (let i = 0; i < 40; i++) emit(i);
      expect(effects.cloudCount).toBe(8);
      effects.reset();
      expect(effects.cloudCount).toBe(0);
      expect(state.cloudsPool).toHaveLength(allocated);
      expect(
        state.cloudsPool.every((cloud: any) => cloud.group.parent === null),
      ).toBe(true);
      const disposed = vi.fn();
      for (const cloud of state.cloudsPool)
        cloud.smoke.geometry.addEventListener("dispose", disposed);
      effects.dispose(resources);
      resources.dispose();
      expect(disposed).toHaveBeenCalledTimes(allocated);
      expect(state.cloudsPool).toHaveLength(0);
    } finally {
      effects.dispose(resources);
      resources.dispose();
      vi.unstubAllGlobals();
    }
  },
);
