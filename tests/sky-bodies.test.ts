import { expect, it } from "vitest";
import { EnvironmentLighting } from "../src/render/environment-lighting";
import { OCEAN_BACKGROUND_GLSL } from "../src/render/ocean-horizon";
import { SKY_BODIES_GLSL, SUN_RADIUS, MOON_RADIUS } from "../src/render/sky-bodies";

it("gives the moon its own orbit instead of mirroring the sun", () => {
  const l = new EnvironmentLighting();
  // First hour after `from` at which the moon clears the horizon.
  const moonrise = (day: number, from = 0) => {
    let wasUp = true;
    for (let h = from; h < from + 30; h += 0.02) {
      l.update(h % 24, day + Math.floor(h / 24));
      const up = l.moonDirection.y > 0;
      if (up && !wasUp) return h;
      wasUp = up;
    }
    return NaN;
  };
  const day0 = moonrise(0),
    day1 = moonrise(1);
  // About 3 hours later each day (24 h / 8-day cycle).
  expect(day1 - day0).toBeGreaterThan(2);
  expect(day1 - day0).toBeLessThan(4.5);
  let mirrored = true,
    upByDay = false;
  const phases = new Set<number>();
  for (let day = 0; day < 8; day++)
    for (let hour = 0; hour < 24; hour += 0.5) {
      l.update(hour, day);
      const sun = l.sunDirection,
        moon = l.moonDirection;
      expect(Math.abs(moon.length() - 1)).toBeLessThan(1e-6);
      if (Math.abs(moon.y + sun.y) > 0.05) mirrored = false;
      if (sun.y > 0.3 && moon.y > 0.1) upByDay = true;
      phases.add(Math.round(l.moonIllumination * 4));
    }
  expect(mirrored).toBe(false);
  expect(upByDay).toBe(true);
  // New through full over the cycle.
  expect(phases).toEqual(new Set([0, 1, 2, 3, 4]));
});

it("keeps nights dark at new moon", () => {
  const l = new EnvironmentLighting();
  // Elongation 95 deg + 45 deg/day: new moon (360 deg) falls on day 5 + 21 h.
  for (let hour = 0; hour < 5.5; hour += 0.5) {
    l.update(hour, 6);
    expect(l.moonIllumination).toBeLessThan(0.05);
    expect(l.sunIntensity).toBeLessThan(0.03);
  }
});

it("lights the night from the moon and fades stars in only in darkness", () => {
  const l = new EnvironmentLighting();
  l.update(12);
  expect(l.lightDirection.equals(l.sunDirection)).toBe(true);
  expect(l.starStrength).toBe(0);
  l.update(0);
  expect(l.lightDirection.equals(l.moonDirection)).toBe(true);
  expect(l.lightDirection.y).toBeGreaterThan(0);
  expect(l.starStrength).toBe(1);
  l.update(18.4); // just after sunset: not yet starry
  expect(l.starStrength).toBeLessThan(0.5);
});

it("warms the sun toward orange near the horizon", () => {
  const l = new EnvironmentLighting();
  l.update(12);
  const noon = l.sunTint.clone();
  l.update(17.9);
  const low = l.sunTint.clone();
  expect(noon.b / noon.r).toBeGreaterThan(0.7);
  expect(low.b / low.r).toBeLessThan(0.4);
});

it("draws sun, moon and stars in the sky but skips them for open water", () => {
  expect(OCEAN_BACKGROUND_GLSL).toContain(SKY_BODIES_GLSL);
  expect(OCEAN_BACKGROUND_GLSL).toContain("if(sea<1.) sky=skyBodies(d,sky);");
  expect(OCEAN_BACKGROUND_GLSL).toContain("return skyClouds(d,mix(sky,water,sea))");
  // The old flat dot (the sun mirrored as the moon) is gone.
  expect(OCEAN_BACKGROUND_GLSL).not.toContain("sun.y>=0.?sun:-sun");
  expect(SUN_RADIUS).toBeGreaterThan(0.004);
  expect(MOON_RADIUS).toBeGreaterThan(SUN_RADIUS);
  // The lit side faces the viewer's side of the moon (full when opposite the sun).
  expect(SKY_BODIES_GLSL).toContain("-moon*sqrt(max(1.-rr,0.))");
  // Derivatives are taken once, outside the branches.
  expect(SKY_BODIES_GLSL.match(/fwidth/g)).toHaveLength(1);
});

it("fades the light out and back in as it hands over from sun to moon", () => {
  const l = new EnvironmentLighting();
  let previous: number[] | undefined;
  let worstJump = 0;
  for (let hour = 17; hour <= 19.5; hour += 0.002) {
    l.update(hour);
    // The shadow-casting light as a vector: direction scaled by intensity.
    const v = [l.lightDirection.x, l.lightDirection.y, l.lightDirection.z].map((c) => c * l.sunIntensity);
    if (previous) worstJump = Math.max(worstJump, Math.hypot(...v.map((c, i) => c - previous![i])));
    previous = v;
  }
  expect(worstJump).toBeLessThan(0.05);
  l.update(18);
  expect(l.sunIntensity).toBeLessThan(0.05);
});
