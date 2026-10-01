import { normalizeDestruction } from "./destruction-settings";
import type { Preferences } from "./types";
export const PREFERENCE_REVISION = 3;
export function normalizePreferences(
  value: Partial<Preferences> = {},
): Preferences {
  const finite = (v: unknown, fallback: number, min: number, max: number) =>
    typeof v === "number" && Number.isFinite(v)
      ? Math.max(min, Math.min(max, v))
      : fallback;
  return {
    revision: PREFERENCE_REVISION,
    reverseX: value.reverseX === true,
    reverseY: value.reverseY === true,
    sensitivity: finite(value.sensitivity, 1, 0.3, 2.5),
    nukeYield:
      [1, 2, PREFERENCE_REVISION].includes(value.revision!) &&
      ["local", "castle", "valley"].includes(value.nukeYield!)
        ? value.nukeYield!
        : "valley",
    destruction: normalizeDestruction(value.destruction),
    monsterCount:
      (value.revision ?? 0) < 2 && value.monsterCount === 8
        ? 20
        : [0, 3, 8, 20].includes(value.monsterCount!)
          ? value.monsterCount
          : 20,
    googlyEyes:
      value.revision === PREFERENCE_REVISION && value.googlyEyes === true,
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
