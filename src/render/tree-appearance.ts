import type { Entity } from "../types";

/** Seed-locked canopy proportions vary silhouettes without changing tree owners. */
export function treeCanopyScale(
  entity: Pick<Entity, "s" | "variant" | "treeSpecies">,
): [number, number, number] {
  const variant = Math.max(0, Math.min(1, entity.variant ?? 0.5)),
    species = entity.treeSpecies ?? "pine",
    width =
    species === "riverside"
        ? 0.84 + variant * 0.32
        : species === "broadleaf"
          ? 0.78 + variant * 0.44
          : 0.8 + variant * 0.4,
    depth =
    species === "riverside"
        ? 1.17 - variant * 0.34
        : species === "broadleaf"
          ? 1.24 - variant * 0.48
          : 1.22 - variant * 0.44,
    height =
      species === "riverside"
        ? 0.9 + variant * 0.2
        : species === "broadleaf"
          ? 0.82 + variant * 0.36
          : 0.86 + variant * 0.28;
  return [
    entity.s[0] * 1.45 * width,
    entity.s[1] * 2 * height,
    entity.s[0] * 1.45 * depth,
  ];
}
