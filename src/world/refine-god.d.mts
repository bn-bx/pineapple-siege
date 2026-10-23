import type { Entity, WorldData } from "../types";
export function refineGod(
  site: WorldData["sites"][number],
  parts: Entity[],
): boolean;
export function reconnectGod(parts: Entity[]): void;
