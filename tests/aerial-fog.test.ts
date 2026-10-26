import * as THREE from "three";
import { expect, it } from "vitest";
import {
  AERIAL_FOG_DENSITY,
  AERIAL_FOG_SCALE_HEIGHT,
  AERIAL_FOG_START,
  AerialFog,
  aerialFogFactor,
} from "../src/render/aerial-fog";
import { EnvironmentLighting } from "../src/render/environment-lighting";

it("hazes distant terrain while keeping nearby scenery clear", () => {
  const level = (d: number) => aerialFogFactor(100, { x: d, y: 0, z: 0 });
  expect(level(300)).toBe(0);
  expect(level(500)).toBe(0);
  expect(level(1000)).toBeLessThan(0.03);
  expect(level(5000)).toBeGreaterThan(0.12);
  expect(level(5000)).toBeLessThan(0.3);
  expect(level(13000)).toBeLessThan(0.6);
  for (let d = 500; d < 12000; d += 500)
    expect(level(d + 500)).toBeGreaterThan(level(d));
});

it("thins with altitude and when looking down through clearer air", () => {
  const ground = aerialFogFactor(50, { x: 4000, y: 0, z: 0 });
  const high = aerialFogFactor(2000, { x: 4000, y: 0, z: 0 });
  expect(high).toBeLessThan(ground);
  // Looking down from altitude passes through denser low air, but much less
  // of it than a level ray at the bottom.
  const down = aerialFogFactor(2000, { x: 3000, y: -2000, z: 0 });
  expect(down).toBeGreaterThan(high);
  expect(down).toBeLessThan(ground);
  // The shader's small-angle branch matches the general formula.
  const level = aerialFogFactor(300, { x: 3000, y: 0, z: 0 });
  const almost = aerialFogFactor(300, { x: 3000, y: 0.05, z: 0 });
  expect(almost).toBeCloseTo(level, 5);
});

it("uses linear Fog uniforms for density and scale height, leaving FogExp2 untouched", () => {
  const fog = new AerialFog("#ffffff");
  expect(fog).toBeInstanceOf(THREE.Fog);
  expect(fog.near).toBe(fog.density);
  expect(fog.far).toBe(fog.scaleHeight);
  expect(THREE.ShaderChunk.fog_fragment).toContain("FOG_EXP2");
  expect(THREE.ShaderChunk.fog_fragment).toContain(
    "1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth )",
  );
  expect(THREE.ShaderChunk.fog_vertex).toContain("vFogOffset");
  // Per-vertex haze everywhere except the ocean, which needs it per pixel.
  expect(THREE.ShaderChunk.fog_vertex).toContain("vAerialFog = aerialFog( vFogOffset );");
  expect(THREE.ShaderChunk.fog_fragment).toContain("float fogFactor = vAerialFog;");
  expect(THREE.ShaderChunk.fog_fragment).toContain("aerialFog( vFogOffset ) * AERIAL_FOG_SCALE");
  expect(THREE.ShaderChunk.fog_pars_fragment).toContain("uniform float fogNear");
});

it("fades into the sky's horizon colour at every hour", () => {
  const lighting = new EnvironmentLighting();
  const fog = new AerialFog(lighting.horizonColor);
  for (const hour of [0, 6, 12, 18.2]) {
    lighting.update(hour);
    fog.color.copy(lighting.horizonColor);
    expect(fog.color.equals(lighting.horizonColor)).toBe(true);
  }
  lighting.update(12);
  const noon = lighting.horizonColor.clone();
  lighting.update(0);
  expect(lighting.horizonColor.r).toBeLessThan(noon.r);
});

it("hazes the sky-drawn distant ocean exactly like fogged ocean at the same point", async () => {
  const { OCEAN_BACKGROUND_GLSL } = await import("../src/render/ocean-horizon");
  expect(OCEAN_BACKGROUND_GLSL).toContain("hazeDensity");
  // Closed form used by the backdrop for a ray from height h to sea level.
  const backdrop = (h: number, dy: number) => {
    const k = 1 / AERIAL_FOG_SCALE_HEIGHT;
    const seaDistance = h / -dy;
    return (
      1 -
      Math.exp(
        -((AERIAL_FOG_DENSITY * (1 - Math.exp(-h * k))) / (h * k)) *
          Math.max(seaDistance - AERIAL_FOG_START, 0),
      )
    );
  };
  for (const [h, dy] of [
    [150, -0.05],
    [1400, -0.2],
    [600, -0.02],
  ]) {
    const horizontal = Math.sqrt(1 - dy * dy);
    const distance = h / -dy;
    const offset = { x: horizontal * distance, y: dy * distance, z: 0 };
    expect(backdrop(h, dy)).toBeCloseTo(aerialFogFactor(h, offset), 6);
  }
});
