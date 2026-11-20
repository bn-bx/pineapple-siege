import type { Entity } from "../types";
import * as THREE from "three";

/** Seed-locked canopy proportions vary silhouettes without changing tree owners. */
export function treeCanopyScale(
  entity: Pick<Entity, "s" | "variant" | "treeSpecies">,
): [number, number, number] {
  const variant = Math.max(0, Math.min(1, entity.variant ?? 0.5)),
    species = entity.treeSpecies ?? "pine",
    phase = variant * Math.PI * 2;
  if (species === "palm")
    // Palms keep their height; only the frond spread and lean vary.
    return [
      entity.s[0] * 2.35 * (0.9 + Math.sin(phase) * 0.18),
      entity.s[1] * 2.45 * (0.94 + Math.cos(phase * 1.9) * 0.1),
      entity.s[0] * 2.35 * (0.9 + Math.cos(phase * 1.3 + 0.4) * 0.18),
    ];
  const width =
      species === "riverside"
        ? 0.84 + Math.sin(phase) * 0.14
        : species === "broadleaf"
          ? 0.98 + Math.sin(phase) * 0.22
          : 0.98 + Math.sin(phase) * 0.32,
    depth =
      species === "riverside"
        ? 1.02 + Math.cos(phase * 1.7 + 0.3) * 0.22
        : species === "broadleaf"
          ? 0.96 + Math.cos(phase * 1.35 + 0.7) * 0.2
          : 0.98 + Math.cos(phase * 1.7 + 0.5) * 0.18,
    height =
      species === "riverside"
        ? 1.08 + Math.sin(phase * 2.2 + 0.7) * 0.1
        : species === "broadleaf"
          ? 0.95 + Math.cos(phase * 2.1 + 0.2) * 0.16
          : 0.98 + Math.sin(phase * 2.3 + 1.1) * 0.22;
  return [
    entity.s[0] * 2.35 * width,
    entity.s[1] * 2.45 * height,
    entity.s[0] * 2.35 * depth,
  ];
}

/** Stable 0–1 value shared by every tree in the same ~150 m stand. */
function standHash(p: readonly number[] | undefined, salt: number) {
  if (!p) return 0.5;
  let h =
    Math.imul(Math.floor(p[0] / 150), 374761393) ^
    Math.imul(Math.floor(p[2] / 150), 668265263) ^
    Math.imul(salt, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const BASE = {
  pine: { hue: 0.295, saturation: 0.43, lightness: 0.25 },
  broadleaf: { hue: 0.225, saturation: 0.46, lightness: 0.3 },
  riverside: { hue: 0.29, saturation: 0.3, lightness: 0.35 },
  palm: { hue: 0.205, saturation: 0.5, lightness: 0.33 },
} as const;

/**
 * Muted species palettes keep seed variation visible through every tree LOD.
 * Neighbouring trees share a stand tint so groves read as one population,
 * with individual variation layered on top.
 */
export function setTreeCanopyColor(
  color: THREE.Color,
  entity: Pick<Entity, "variant" | "treeSpecies"> & { p?: readonly number[] },
) {
  const variant = Math.max(0, Math.min(1, entity.variant ?? 0.5)),
    species = entity.treeSpecies ?? "pine",
    base = BASE[species] ?? BASE.pine,
    stand = standHash(entity.p, species.length),
    // A few broadleaf stands turn early: yellow-green to coppery crowns.
    turning =
      species === "broadleaf" && stand > 0.86 ? (stand - 0.86) / 0.14 : 0,
    // Conifers high on the slopes take a cooler, bluer cast.
    altitude = species === "pine" && entity.p ? Math.min(1, Math.max(0, (entity.p[1] - 200) / 300)) : 0,
    hue =
      base.hue +
      (variant - 0.5) * 0.04 +
      (stand - 0.5) * 0.035 -
      turning * 0.11 +
      altitude * 0.04,
    saturation =
      base.saturation +
      (variant - 0.5) * 0.08 +
      (stand - 0.5) * 0.06 +
      turning * 0.12 -
      altitude * 0.06,
    lightness =
      base.lightness + variant * 0.09 + (stand - 0.5) * 0.05 + turning * 0.06;
  return color.setHSL(hue, saturation, lightness);
}
