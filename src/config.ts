import { VERTICAL_LIMITS } from "./world/vertical-limits.mjs";
import type { BlastProfile, NukeYield } from "./types";
export const WORLD_SIZE = 6144;
export const TERRAIN_SPACING = 2;
export const CHUNK_SIZE = 64;
export const CHUNKS = WORLD_SIZE / CHUNK_SIZE;
export const CHUNK_SAMPLES = CHUNK_SIZE / TERRAIN_SPACING;
export const CONFIG = {
  version: 9,
  dt: 1 / 60,
  debrisGravity: 21.6,
  minSpeed: 35,
  maxSpeed: 90,
  boostSpeed: 120,
  turnSpeed: 1.05,
  pitchSpeed: 0.75,
  maxPitch: 1.12,
  ceiling: VERTICAL_LIMITS.ceiling,
  fireCooldown: 1,
  projectileSpeed: 140,
  projectileGravity: 5,
  projectileLifetime: 8,
  craterRadius: 12,
  craterDepth: 5,
  bedrock: 50,
  laserBedrock: 500,
  damageRadius: 24,
  maxBodies: 256,
  maxFragments: 64,
  maxProjectiles: 12,
  maxRubblePerChunk: 36,
  respawnDelay: 2,
  worldSize: WORLD_SIZE,
  grid: WORLD_SIZE / TERRAIN_SPACING + 1,
  spacing: TERRAIN_SPACING,
  chunkSize: CHUNK_SIZE,
};
export const MONSTER_SCALE = 2;
export const RAPID_FIRE_INTERVAL = 0.1;
export const DEFAULT_MONSTER_COUNT = 120;
export const MAX_MONSTER_COUNT = 400;
export const DEFAULT_RENDER_DISTANCE = 1200;
export const normalizeRenderDistance = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.max(600, Math.min(3000, Math.round(value / 100) * 100))
    : DEFAULT_RENDER_DISTANCE;
export const normalizeMonsterCount = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(MAX_MONSTER_COUNT, Math.round(value)))
    : DEFAULT_MONSTER_COUNT;
export const clamp = (v: number, a: number, b: number) =>
  Math.max(a, Math.min(b, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export const NUKE_PROFILES: Record<NukeYield, BlastProfile> = {
  local: {
    damageRadius: 70,
    craterRadius: 52.5,
    depth: 24,
    cloudHeight: 120,
    bodyLimit: 128,
    scatterMin: 50,
    scatterMax: 85,
    ejecta: 720,
  },
  castle: {
    damageRadius: 180,
    craterRadius: 105,
    depth: 40,
    cloudHeight: 240,
    bodyLimit: 128,
    scatterMin: 60,
    scatterMax: 105,
    ejecta: 1000,
  },
  valley: {
    damageRadius: 420,
    craterRadius: 240,
    depth: 50,
    cloudHeight: 400,
    bodyLimit: 128,
    scatterMin: 70,
    scatterMax: 120,
    ejecta: 1200,
  },
};
export const WEAPONS = {
  laser: { cooldown: 24 },
  cannon: {
    cooldown: 0.75,
    length: 6,
    radius: 1.6,
    gravity: 5,
    lifetime: 8,
    launchSpeed: 140,
  },
  nuke: {
    cooldown: 10,
    length: 18,
    radius: 4.8,
    gravity: 18,
    lifetime: 30,
    launchSpeed: 0,
  },
};
export const LASER = {
  beamRadius: 28,
  top: VERTICAL_LIMITS.laserTop,
  charge: 4,
  beam: 5,
  recharge: 15,
  radius: 190,
  depth: 500,
  range: 2400,
};

export const WRECKAGE_FLIGHT_SECONDS = 6;
export const WRECKAGE_FADE_SECONDS = 1;
export const WRECKAGE_LIFETIME =
  WRECKAGE_FLIGHT_SECONDS + WRECKAGE_FADE_SECONDS;

export const BLAST_DEBRIS_LIMIT = 512;
export const BLAST_COSMETIC_LIMIT = 512;
export const CORPSE_MOTION_LIMIT = 128;
