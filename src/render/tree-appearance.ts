import type { Entity } from "../types";
import * as THREE from "three";

/** Seed-locked canopy proportions vary silhouettes without changing tree owners. */
export function treeCanopyScale(
  entity: Pick<Entity, "s" | "variant" | "treeSpecies">,
): [number, number, number] {
  const variant = Math.max(0, Math.min(1, entity.variant ?? 0.5)),
    species = entity.treeSpecies ?? "pine",
    phase = variant * Math.PI * 2,
    width =
    species === "riverside"
        ? 0.84 + Math.sin(phase) * 0.14
        : species === "broadleaf"
          ? 0.98 + Math.sin(phase) * 0.22
          : 0.98 + Math.sin(phase) * 0.2,
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
          : 0.98 + Math.sin(phase * 2.3 + 1.1) * 0.12;
  return [
    entity.s[0] * 1.45 * width,
    entity.s[1] * 2 * height,
    entity.s[0] * 1.45 * depth,
  ];
}

/** Muted species palettes keep seed variation visible through every tree LOD. */
export function setTreeCanopyColor(
  color: THREE.Color,
  entity: Pick<Entity, "variant" | "treeSpecies">,
) {
  const variant = Math.max(0, Math.min(1, entity.variant ?? 0.5)),
    species = entity.treeSpecies ?? "pine",
    hue =
      (species === "riverside" ? 0.29 : species === "broadleaf" ? 0.225 : 0.255) +
      (variant - 0.5) * 0.045,
    saturation =
      (species === "broadleaf" ? 0.31 : species === "riverside" ? 0.23 : 0.26) +
      (variant - 0.5) * 0.08;
  return color.setHSL(hue, saturation, 0.77 + variant * 0.16);
}
