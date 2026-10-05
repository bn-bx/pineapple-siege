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
