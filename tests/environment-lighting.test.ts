import { expect, it } from "vitest";
import { EnvironmentLighting } from "../src/render/environment-lighting";

it("coordinates smooth, periodic lighting through sunrise, sunset and night", () => {
  const lighting = new EnvironmentLighting();
  const sun = lighting.sunDirection,
    color = lighting.sunColor;
  lighting.update(12);
  expect(lighting.daylight).toBe(1);
  expect(lighting.night).toBe(0);
  expect(lighting.twilight).toBe(0);
  lighting.update(18);
  expect(lighting.twilight).toBeCloseTo(1);
  expect(lighting.sunColor.r).toBeGreaterThan(lighting.sunColor.b);
  lighting.update(0);
  expect(lighting.daylight).toBe(0);
  expect(lighting.night).toBe(1);
  expect(lighting.ambientIntensity).toBeGreaterThan(0.3);
  const midnight = lighting.horizonColor.clone();
  lighting.update(24);
  expect(lighting.horizonColor.equals(midnight)).toBe(true);
  expect(lighting.sunDirection).toBe(sun);
  expect(lighting.sunColor).toBe(color);
  for (let hour = 0; hour <= 24; hour += 0.01) {
    lighting.update(hour);
    const previous = lighting.sunColor.clone();
    const night = lighting.night;
    lighting.update(hour + 0.001);
    expect(Math.abs(previous.r - lighting.sunColor.r)).toBeLessThan(0.002);
    expect(Math.abs(previous.b - lighting.sunColor.b)).toBeLessThan(0.002);
    expect(Math.abs(night - lighting.night)).toBeLessThan(0.002);
  }
});

it("arcs the sun from east through the southern sky to west", () => {
  const lighting = new EnvironmentLighting();
  const azimuth = () =>
    Math.atan2(lighting.sunDirection.x, lighting.sunDirection.z);
  lighting.update(6.05);
  const rise = lighting.sunDirection.clone().setY(0).normalize();
  lighting.update(17.95);
  const set = lighting.sunDirection.clone().setY(0).normalize();
  // Rises and sets on opposite sides of the sky.
  expect(rise.dot(set)).toBeLessThan(-0.99);
  // The azimuth sweeps steadily instead of sitting still and flipping.
  let previous: number | undefined;
  let travelled = 0;
  for (let hour = 6.1; hour <= 17.9; hour += 0.1) {
    lighting.update(hour);
    const a = azimuth();
    if (previous !== undefined) {
      const step = Math.atan2(Math.sin(a - previous), Math.cos(a - previous));
      expect(Math.abs(step)).toBeLessThan(0.2);
      travelled += step;
    }
    previous = a;
  }
  expect(Math.abs(travelled)).toBeGreaterThan(Math.PI * 0.9);
  // Noon is high in the south, not overhead.
  lighting.update(12);
  expect(lighting.sunDirection.y).toBeGreaterThan(0.85);
  expect(lighting.sunDirection.y).toBeLessThan(0.97);
  // Same moment, two ways: hour 24 of day 0 is hour 0 of day 1.
  lighting.update(24, 0);
  const a = lighting.moonDirection.clone();
  lighting.update(0, 1);
  expect(lighting.moonDirection.distanceTo(a)).toBeLessThan(1e-9);
});
