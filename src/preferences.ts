import { normalizeMonsterCount, normalizeRenderDistance } from "./config";
import { fixedDestruction } from "./destruction-settings";
import type { Preferences } from "./types";
export const PREFERENCE_REVISION = 5;
export function normalizePreferences(
  value: Partial<Preferences> = {},
): Preferences {
  const finite = (v: unknown, fallback: number, min: number, max: number) =>
    typeof v === "number" && Number.isFinite(v)
      ? Math.max(min, Math.min(max, v))
      : fallback;
  return {
    revision: PREFERENCE_REVISION,
    crtMode:
      value.crtMode === "off" || value.crtMode === "retro"
        ? value.crtMode
        : "subtle",
    reverseX: value.reverseX === true,
    reverseY: value.reverseY === true,
    sensitivity: finite(value.sensitivity, 1, 0.3, 2.5),
    nukeYield: "valley",
    destruction: fixedDestruction(value.destruction),
    monsterCount: normalizeMonsterCount(value.monsterCount),
    renderDistance: normalizeRenderDistance(value.renderDistance),
    quality: ["auto", "720", "1080", "1440"].includes(value.quality!)
      ? value.quality!
      : "auto",
    reduceEffects: value.reduceEffects === true,
    reduceShake: value.reduceShake === true,
    volume: finite(value.volume, 0.35, 0, 1),
    mute: value.mute === true,
    showPerf: value.showPerf === true,
    holdTime: value.holdTime === true,
  };
}
