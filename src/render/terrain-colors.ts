import type { Color } from "three";
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
) {
  const grain =
    Math.sin(x * 0.04 + z * 0.019) * Math.sin(z * 0.063 - x * 0.02) * 0.5 + 0.5;
  color.setRGB(0.18 + grain * 0.1, 0.31 + grain * 0.13, 0.075 + grain * 0.045);
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
