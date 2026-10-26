import { expect, it } from "vitest";
import { EnvironmentLighting } from "../src/render/environment-lighting";
import { OCEAN_BACKGROUND_GLSL } from "../src/render/ocean-horizon";
import { SKY_BODIES_GLSL, SUN_RADIUS, MOON_RADIUS } from "../src/render/sky-bodies";

it("gives the moon its own path instead of mirroring the sun", () => {
  const l = new EnvironmentLighting();
  for (let hour = 0; hour < 24; hour += 0.5) {
    l.update(hour);
    const sun = l.sunDirection, moon = l.moonDirection;
    expect(Math.abs(moon.length() - 1)).toBeLessThan(1e-6);
    // Roughly opposite (so it rises as the sun sets), but never exactly.
    const dot = sun.dot(moon);
    expect(dot).toBeLessThan(-0.6);
    // (Overhead sun or moon is the one exactly opposite case.)
    if (Math.abs(sun.y) < 0.95) expect(dot).toBeGreaterThan(-0.9999);
    // Up exactly when the sun is down.
    expect(moon.y * sun.y).toBeLessThanOrEqual(0);
    expect(Math.abs(moon.y + sun.y)).toBeLessThan(1e-9);
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
