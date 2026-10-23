import type { Entity, WorldData } from "../types";
export function applyApprovedGod(
  site: WorldData["sites"][number],
  parts: Entity[],
  sample?: (x: number, z: number) => number,
): boolean;
