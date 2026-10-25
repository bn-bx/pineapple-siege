import type { Color } from "three";
import type { RegionFields } from "../types";
import { regionAt } from "../world/landscape.mjs";
import { clamp } from "../config";

/** Smooth center and shoulder masks for the existing canonical road distance. */
export function terrainRoadWeights(distance: number): [number, number] {
  const smoothstep = (low: number, high: number) => {
    const t = clamp((distance - low) / (high - low), 0, 1);
    return t * t * (3 - 2 * t);
  };
  return [1 - smoothstep(2.2, 3.2), 0.34 * (1 - smoothstep(3.2, 6.2))];
}

/** World-space shading shared by streamed meshes and immediate damage refresh. */
export function terrainSurfaceColor(
  color: Color,
  x: number,
  z: number,
  height: number,
  slope: number,
  regions?: RegionFields,
  surfaceGrain = true,
) {
  const grain = surfaceGrain
    ? Math.sin(x * 0.04 + z * 0.019) * Math.sin(z * 0.063 - x * 0.02) * 0.5 +
      0.5
    : 0.5;
  color.setRGB(0.18 + grain * 0.1, 0.31 + grain * 0.13, 0.075 + grain * 0.045);
  const region = regions ? regionAt(regions, x, z) : undefined;
  if (region) {
    const forest = region.woodland,
      wet = Math.max(0, (region.moisture - 0.62) * 2.6);
    color.r = color.r * (1 - forest * 0.3) + 0.035 * (1 - forest);
    color.g *= 1 - forest * 0.16;
    color.b += wet * 0.055;
    color.r *= 1 - wet * 0.3;
  }
  const rock = Math.max(
    clamp((slope - 0.45) * 1.6, 0, 1),
    clamp((height - 550) / 300, 0, 1),
  );
  const scree =
    clamp((height - 250) / 350, 0, 1) * clamp((slope - 0.2) / 0.35, 0, 1);
  const blend = Math.max(rock, scree * 0.65);
  const grey = 0.39 + grain * 0.13;
  color.r += (grey - color.r) * blend;
  color.g += (grey * 1.02 - color.g) * blend;
  color.b += (grey * 0.95 - color.b) * blend;

  // Broad, warm beaches on gentle shores; exposed slopes retain stone faces.
  // This shared path shades both the horizon mesh and streamed terrain tiles.
  const coastal = !region || region.coast > 0;
  if (coastal && height < 130) {
    const beach =
      clamp((16 - height) / 9, 0, 1) * (1 - clamp((slope - 0.32) / 0.48, 0, 1));
    const wetSand = clamp((3 - height) / 4, 0, 1);
    const sand = 0.78 + grain * 0.09 - wetSand * 0.19;
    color.r += (sand - color.r) * beach;
    color.g += (sand * 0.84 - color.g) * beach;
    color.b += (sand * 0.53 - color.b) * beach;
    const cliff =
      clamp((slope - 0.48) / 0.65, 0, 1) * clamp((130 - height) / 45, 0, 1);
    const strata = Math.sin(height * 0.6 + Math.sin(x * 0.018 + z * 0.023) * 2);
    const stone = 0.38 + grain * 0.14 + strata * 0.035;
    color.r += (stone - color.r) * cliff;
    color.g += (stone * 0.94 - color.g) * cliff;
    color.b += (stone * 0.8 - color.b) * cliff;
  }
}

export function terrainScarColor(
  color: Color,
  x: number,
  z: number,
  h: number,
  damage: number,
  slope: number,
) {
  const strata = 0.5 + 0.5 * Math.sin(h * 0.8 + x * 0.025 + z * 0.035);
  const grain =
    0.5 + 0.5 * Math.sin(x * 0.73 + z * 0.29) * Math.cos(z * 0.51 - x * 0.23);
  const rock = clamp((slope - 0.65) * 0.45 + damage / 32, 0, 1);
  color.setRGB(
    0.3 + strata * 0.1 + grain * 0.045,
    0.19 + strata * 0.075 + grain * 0.04,
    0.115 + strata * 0.055 + grain * 0.035,
  );
  const grey = 0.32 + grain * 0.12 + strata * 0.055;
  color.r += (grey - color.r) * rock;
  color.g += (grey * 0.97 - color.g) * rock;
  color.b += (grey * 0.87 - color.b) * rock;
  // Char the exposed surface; deep blast scars retain a mottled charcoal tone.
  color.multiplyScalar(1 - 0.7 * clamp(damage / 2, 0, 1));
}
