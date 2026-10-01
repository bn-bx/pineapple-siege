import type { BlastProfile, NukeYield } from "./types";
export const CONFIG = {
  version: 6,
  dt: 1 / 60,
  minSpeed: 35,
  maxSpeed: 90,
  boostSpeed: 120,
  turnSpeed: 1.05,
  pitchSpeed: 0.75,
  maxPitch: 1.12,
  ceiling: 500,
  fireCooldown: 1,
  projectileSpeed: 140,
  projectileGravity: 5,
  projectileLifetime: 8,
  craterRadius: 12,
  craterDepth: 5,
  bedrock: 25,
  laserBedrock: 500,
  damageRadius: 24,
  maxBodies: 256,
  maxFragments: 64,
  maxProjectiles: 12,
  maxRubblePerChunk: 36,
  respawnDelay: 2,
  worldSize: 2048,
  grid: 1025,
  spacing: 2,
  chunkSize: 64,
};
export const MONSTER_SCALE = 2;
export const clamp = (v: number, a: number, b: number) =>
  Math.max(a, Math.min(b, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export const NUKE_PROFILES: Record<NukeYield, BlastProfile> = {
  local: {
    damageRadius: 70,
    craterRadius: 35,
    depth: 12,
    cloudHeight: 120,
    bodyLimit: 128,
    scatterMin: 50,
    scatterMax: 85,
    ejecta: 720,
  },
  castle: {
    damageRadius: 180,
    craterRadius: 70,
    depth: 20,
    cloudHeight: 240,
    bodyLimit: 128,
    scatterMin: 60,
    scatterMax: 105,
    ejecta: 1000,
  },
  valley: {
    damageRadius: 420,
    craterRadius: 160,
    depth: 25,
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
    cooldown: 1,
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
  top: 1400,
  charge: 4,
  beam: 5,
  recharge: 15,
  radius: 190,
  depth: 500,
  range: 2400,
};
