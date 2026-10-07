import type { Entity } from "../types";

/** Seed-locked canopy proportions vary silhouettes without changing tree owners. */
export function treeCanopyScale(
  entity: Pick<Entity, "s" | "variant" | "treeSpecies">,
): [number, number, number] {
  const variant = Math.max(0, Math.min(1, entity.variant ?? 0.5)),
    species = entity.treeSpecies ?? "pine",
    width =
      species === "riverside"
        ? 0.9 + variant * 0.2
        : species === "broadleaf"
          ? 0.92 + variant * 0.18
          : 0.89 + variant * 0.22,
    depth =
      species === "riverside"
        ? 1.12 - variant * 0.18
        : species === "broadleaf"
          ? 1.1 - variant * 0.2
          : 1.14 - variant * 0.28,
    height = 0.94 + variant * 0.12;
  return [
    entity.s[0] * 1.45 * width,
    entity.s[1] * 2 * height,
    entity.s[0] * 1.45 * depth,
  ];
}
