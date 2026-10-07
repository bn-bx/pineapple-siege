import type { Explosion } from "../types";

const WATER = ["#d8efed", "#a9d8d6", "#82aaa8"] as const;
const COLLAPSE = ["#c8c0b4", "#948b7f", "#746e66", "#b1a595"] as const;
const CRASH = ["#ffe6ad", "#f2a44e", "#ad542c", "#85898a"] as const;
const IMPACT = ["#c0ad8e", "#a18a68", "#766b5c", "#b7a17f"] as const;
const NUKE = ["#fff0bd", "#ffc15e", "#e87532", "#98715c"] as const;

export interface ExplosionFlashStyle {
  color: string;
  intensity: number;
  radius: number;
}

export function explosionFlashStyle(
  kind: Explosion["kind"],
  water: boolean,
  craterRadius = 80,
): ExplosionFlashStyle {
  if (kind === "nuke")
    return {
      color: "#ffffff",
      intensity: 1,
      radius: Math.min(150, craterRadius * 1.2),
    };
  if (water)
    return {
      color: "#bfebeb",
      intensity: kind === "collapse" ? 0.5 : 0.65,
      radius: kind === "crash" ? 9 : kind === "collapse" ? 10 : 12,
    };
  if (kind === "crash")
    return { color: "#fff0dc", intensity: 0.68, radius: 9 };
  if (kind === "collapse")
    return { color: "#d0c5b2", intensity: 0.38, radius: 8 };
  if (kind === "impact")
    return { color: "#e2c9a0", intensity: 0.4, radius: 7 };
  return { color: "#ffe198", intensity: 0.7, radius: 12 };
}

/** Color the shared blast particles by event so rubble, crashes, and hot blasts read differently. */
export function explosionParticleTint(
  kind: Explosion["kind"],
  water: boolean,
  index: number,
): string {
  if (water) return WATER[index % WATER.length];
  if (kind === "blast")
    return index % 5 === 0
      ? "#ffd987"
      : index % 3 === 0
        ? "#e78734"
        : "#9f917c";
  const palette =
    kind === "collapse"
      ? COLLAPSE
      : kind === "crash"
        ? CRASH
        : kind === "impact"
          ? IMPACT
          : NUKE;
  return palette[index % palette.length];
}
