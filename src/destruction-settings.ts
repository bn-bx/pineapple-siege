import type {
  BlastProfile,
  DestructionSettings,
  NukeYield,
  LaserProfile,
} from "./types";
import { CONFIG, NUKE_PROFILES, LASER } from "./config";

export const LEVELS = ["Slim", "Standard", "Heavy", "Massive", "Extreme"];
export const BODY_LIMITS = [64, 256, 1024, 4096, 8192];
export const MAX_BODY_LIMIT = Math.max(...BODY_LIMITS);
export const CANNON_LIMITS = [16, 64, 256, 1024, 2048];
export const NUKE_LIMITS = [32, 128, 512, 2048, 4096];
export const COSMETIC_LIMITS = [1024, 4096, 16384, 32768, 65536];
export const COSMETIC_SCALE = [0.25, 1, 3, 6, 12];
export const RUBBLE_LIMITS = [12, 36, 96, 192, 384];
export const DEFAULT_DESTRUCTION: DestructionSettings = {
  bodies: 1,
  fragments: 1,
  cosmetics: 1,
  rubble: 1,
  noCooldown: false,
  nukeScale: 1,
  laserSize: 0,
  laserDepth: 500,
  laserBrightness: 1,
};
export function normalizeDestruction(
  value?: Partial<DestructionSettings> & { noNukeCooldown?: boolean },
): DestructionSettings {
  const level = (n: unknown) =>
    typeof n === "number" && Number.isFinite(n)
      ? Math.max(0, Math.min(4, Math.round(n)))
      : 1;
  const finite = (n: unknown, fallback: number, min: number, max: number) =>
    typeof n === "number" && Number.isFinite(n)
      ? Math.max(min, Math.min(max, n))
      : fallback;
  return {
    laserSize: Math.round(finite(value?.laserSize, 0, 0, 100)),
    laserDepth: Math.round(finite(value?.laserDepth, 500, 25, 500) / 25) * 25,
    laserBrightness:
      Math.round(finite(value?.laserBrightness, 1, 0.25, 2) * 20) / 20,
    bodies: level(value?.bodies),
    fragments: level(value?.fragments),
    cosmetics: level(value?.cosmetics),
    rubble: level(value?.rubble),
    noCooldown:
      value?.noCooldown === true ||
      (value?.noCooldown === undefined && value?.noNukeCooldown === true),
    nukeScale:
      typeof value?.nukeScale === "number" && Number.isFinite(value.nukeScale)
        ? Math.max(1, Math.min(3, value.nukeScale))
        : 1,
  };
}
/** Public game settings are fixed; only rapid fire remains a user preference. */
export function fixedDestruction(
  value?: Partial<DestructionSettings> & { noNukeCooldown?: boolean },
): DestructionSettings {
  return {
    ...DEFAULT_DESTRUCTION,
    noCooldown: normalizeDestruction(value).noCooldown,
  };
}
export function nukeProfile(
  yieldId: NukeYield,
  settings: DestructionSettings,
): BlastProfile {
  const base = NUKE_PROFILES[yieldId],
    scale = settings.nukeScale;
  return {
    ...base,
    damageRadius: base.damageRadius * scale,
    craterRadius: base.craterRadius * scale,
    depth: Math.min(25, base.depth * scale),
    cloudHeight: base.cloudHeight * Math.sqrt(scale),
    bodyLimit: NUKE_LIMITS[settings.fragments],
    ejecta: Math.round(base.ejecta * COSMETIC_SCALE[settings.cosmetics]),
  };
}

export function laserProfile(settings: DestructionSettings): LaserProfile {
  const radius =
    LASER.radius *
    ((CONFIG.worldSize * Math.SQRT2 + CONFIG.spacing) / LASER.radius) **
      (settings.laserSize / 100);
  return {
    radius,
    depth: settings.laserDepth,
    beamRadius: (LASER.beamRadius * radius) / LASER.radius,
    brightness: settings.laserBrightness,
  };
}
export function resolvedLaserProfile(
  profile?: Partial<LaserProfile>,
): LaserProfile {
  const base = laserProfile(DEFAULT_DESTRUCTION);
  return { ...base, ...profile };
}
