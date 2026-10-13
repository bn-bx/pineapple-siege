import { expect, it, vi } from "vitest";
import { CrashFuel } from "../src/sim/crash-fuel";
import { CrashFuelView } from "../src/render/crash-fuel";
import { NuclearFire, FIRE_LIMIT } from "../src/sim/nuclear-fire";
const host = (water = false) => ({
  ground: () => 10,
  water: () => water,
  ignite: vi.fn(),
  explode: vi.fn(),
});
const advance = (
  fuel: CrashFuel,
  h: ReturnType<typeof host>,
  seconds: number,
) => {
  for (let i = 0; i < seconds * 60; i++) fuel.step(1 / 60, h);
};
it("spills with momentum, ignites after landing, explodes exactly once, then cleans up", () => {
  const fuel = new CrashFuel(),
    h = host();
  fuel.spill([1000, 12, 1000], [100, 0, 0]);
  fuel.step(0.1, h);
  expect(fuel.snapshot().every((d) => d.p[0] > 1000)).toBe(true);
  expect(h.ignite).not.toHaveBeenCalled();
  advance(fuel, h, 5);
  expect(h.ignite).toHaveBeenCalled();
  expect(h.explode).toHaveBeenCalledOnce();
  expect(h.explode.mock.calls[0][0][1]).toBeCloseTo(10.2);
  advance(fuel, h, 16);
  expect(h.explode).toHaveBeenCalledOnce();
  expect(fuel.snapshot()).toHaveLength(0);
});
it("waits for airborne fuel to land, and pause freezes the sequence", () => {
  const fuel = new CrashFuel(),
    h = host();
  fuel.spill([1000, 300, 1000], [0, 0, 0]);
  advance(fuel, h, 2);
  expect(h.ignite).not.toHaveBeenCalled();
  const before = fuel.snapshot();
  fuel.step(0, h);
  expect(fuel.snapshot()).toEqual(before);
  advance(fuel, h, 7);
  expect(h.explode).toHaveBeenCalledOnce();
});
it("extinguishes ocean spills and bounds repeated crashes and reset", () => {
  const fuel = new CrashFuel(),
    h = host(true);
  for (let i = 0; i < 20; i++) fuel.spill([1000, 12, 1000], [0, 0, 0]);
  expect(fuel.snapshot()).toHaveLength(288);
  advance(fuel, h, 31);
  expect(h.ignite).not.toHaveBeenCalled();
  expect(h.explode).not.toHaveBeenCalled();
  expect(fuel.snapshot()).toHaveLength(0);
  fuel.spill([1000, 12, 1000], [0, 0, 0]);
  fuel.reset();
  advance(fuel, h, 5);
  expect(h.explode).not.toHaveBeenCalled();
});
it("renders pooled droplets and flat puddles and clears them", () => {
  const fuel = new CrashFuel(),
    view = new CrashFuelView();
  fuel.spill([1000, 12, 1000], [0, 0, 0]);
  advance(fuel, host(), 3);
  view.update(fuel.snapshot());
  expect(view.mesh.count).toBe(36);
  expect(view.mesh.visible).toBe(true);
  expect(view.mesh.instanceMatrix.array[5]).toBeCloseTo(0.45);
  view.reset();
  expect(view.mesh.visible).toBe(false);
  view.mesh.geometry.dispose();
  (view.mesh.material as any).dispose();
});
it("reuses bounded fire patches, finite hazards and fire save support", () => {
  const fire = new NuclearFire();
  fire.igniteFuel([1000, 10, 1000]);
  fire.igniteFuel([1001, 10, 1000]);
  expect(fire.patches).toHaveLength(1);
  expect(fire.touches([1000, 12, 1000])).toBe(true);
  const restored = new NuclearFire();
  restored.restore(fire.save());
  expect(restored.patches).toEqual(fire.patches);
  for (let i = 0; i < 150; i++) fire.igniteFuel([i * 20, 10, 1000]);
  expect(fire.patches).toHaveLength(FIRE_LIMIT);
});

it("gives the fuel explosion a large visible fireball and flash", async () => {
  const { NuclearFireView } = await import("../src/render/nuclear-fire");
  const { explosionFlashStyle } = await import(
    "../src/render/explosion-palette"
  );
  const view = new NuclearFireView();
  view.trigger({
    type: "explosion",
    p: [1000, 10, 1000],
    power: 4,
    water: false,
    seed: 1,
    kind: "fuel",
  });
  view.update([], 0.8, false, 0.8);
  const sphere = view.group.children[2];
  expect(sphere.scale.x).toBe(75);
  expect(explosionFlashStyle("fuel", false).radius).toBe(80);
  view.reset();
  expect(view.group.children).toHaveLength(2);
});
