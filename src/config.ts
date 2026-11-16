import { VERTICAL_LIMITS } from "./world/vertical-limits.mjs";
import type { BlastProfile, NukeYield } from "./types";
export const WORLD_SIZE = 9216;
export const TERRAIN_SPACING = 2;
export const CHUNK_SIZE = 64;
export const CHUNKS = WORLD_SIZE / CHUNK_SIZE;
export const CHUNK_SAMPLES = CHUNK_SIZE / TERRAIN_SPACING;
// Local +Y points down into the abyss when the hell view is inverted.
export const HELL_LAVA_LEVEL = 1450;
export const CONFIG = {
  version: 10,
  dt: 1 / 60,
  debrisGravity: 21.6,
  minSpeed: 35,
  maxSpeed: 180,
  boostSpeed: 240,
  turnSpeed: 1.05,
  pitchSpeed: 0.75,
  maxPitch: 1.12,
  ceiling: VERTICAL_LIMITS.ceiling,
  craterRadius: 12,
  craterDepth: 5,
  bedrock: 500,
  laserBedrock: 500,
  damageRadius: 24,
  maxBodies: 256,
  maxProjectiles: 40,
  respawnDelay: 2,
  worldSize: WORLD_SIZE,
  grid: WORLD_SIZE / TERRAIN_SPACING + 1,
  spacing: TERRAIN_SPACING,
  chunkSize: CHUNK_SIZE,
};
/** Monster concrete truck handling (metres, seconds, radians). */
/** Size of the monster concrete truck relative to its modelled proportions. */
const TRUCK_SCALE = 1.6;
export const TRUCK = Object.freeze({
  scale: TRUCK_SCALE,
  maxSpeed: 45,
  reverseSpeed: 15,
  /** Jet-boost top speed (Shift), its thrust, and the fade after release. */
  boostSpeed: 130,
  boostAccel: 45,
  boostFade: 14,
  accel: 14,
  brake: 40,
  coast: 6,
  /** Yaw rate used to read steering back from motion on the render side. */
  turnRate: 1.6,
  /** Axle-to-axle length for the bicycle steering model. */
  axleSpan: 6.5 * TRUCK_SCALE,
  /** Front-wheel lock at a standstill; it narrows as speed builds. */
  maxSteer: 0.7,
  /** Speed (m/s) at which the available lock has halved. */
  steerFalloff: 26,
  /** How fast the wheel turns toward the key, and back to centre. */
  steerRate: 7,
  steerReturn: 6,
  /** Yaw rate at full lock while airborne (rad/s), whatever the speed. */
  airTurnRate: 0.9,
  /** Slowest yaw rate while pivoting at walking pace. */
  pivotRate: 1.0,
  /** Ceiling on the ground turn rate, so boost speed isn't twitchy. */
  maxYawRate: 1.5,
  /** Gravity while rising, and a heavier pull on the way down so jumps
   * launch high but land with weight instead of floating. */
  gravity: 32,
  fallGravity: 48,
  /** Upward speed a ramp can throw the truck (m/s). */
  maxLaunch: 32,
  /** Below this upward speed the truck stays glued over crests and bumps. */
  launchThreshold: 10,
  /** Steepest drop (rise per run) the truck follows down instead of flying. */
  stickSlope: 0.9,
  /** Within this height of the ground the tyres still steer. */
  tyreReach: 1,
  /** Rubble piles up to this tall are mounds to drive up and jump off. */
  rubbleMax: 7,
  /** Run of a rubble mound's slope per metre of its height. */
  rubbleRamp: 1.6,
  /** Body for knocking trees: overall length, sphere radius, and lift. */
  length: 11 * TRUCK_SCALE,
  bodyRadius: 3 * TRUCK_SCALE,
  bodyLift: 0.8 * TRUCK_SCALE,
  /** Height of the collision centre above the ground. */
  rideHeight: 4 * TRUCK_SCALE,
  radius: 2.6 * TRUCK_SCALE,
  /** Half the axle spacing and half the track width, for terrain sampling. */
  wheelBase: 3.25 * TRUCK_SCALE,
  track: 2.35 * TRUCK_SCALE,
  /** Rise per metre beyond which ground ahead acts as a wall. */
  maxClimb: 2.0,
  /** Water deeper than this is too deep to wade (used for parking). */
  drownDepth: 2.5,
  /** Afloat, the truck sits this far below the surface (tyres half under). */
  draft: 1.2 * TRUCK_SCALE,
  /** Top speed fraction on water without the jet boost. */
  waterSpeed: 0.5,
  /** Impacts faster than this wreck it rather than bouncing off. */
  crashSpeed: 52,
  /** Seconds pinned with the throttle held before the truck hops free. */
  unstickAfter: 1.5,
  hopSpeed: 14,
  /** Protection after a respawn or vehicle swap. */
  shield: 3,
  /** Rocket climb out of the truck into the aircraft. */
  launchSpeed: 70,
  launchPitch: 0.7,
  launchTime: 1,
  /** Upward tilt of the cannon so shots clear the ground. */
  aimTilt: 0.06,
  /** Mouse aim limits for the roof turret (radians, relative to level). */
  aimPitchMin: -1.4,
  aimPitchMax: 1.4,
  /** Chase camera: distance behind the turret, and how far it looks down. */
  cameraDistance: 36,
  cameraLift: 0.22,
  /** Seconds without mouse movement before the view drifts back behind. */
  aimReturnDelay: 2,
  /** Air brake deceleration while holding S off the ground (m/s²). */
  airBrake: 30,
  /** Roof turret muzzle height above the collision centre. */
  turretHeight: 3.2 * TRUCK_SCALE,
});
/**
 * Where the aircraft may fly. Island generation keeps using VERTICAL_LIMITS;
 * these only bound flight.
 * - Normal islands: 5 km of open sea beyond the terrain square on every side,
 *   and a ceiling well above the cloud layer (see CLOUD_ALTITUDE).
 * - Hell: unchanged, since its lava sits just below VERTICAL_LIMITS.ceiling
 *   and nothing exists outside the terrain square.
 */
export interface FlightLimits {
  /** Distance (m) beyond each edge of the terrain square. */
  margin: number;
  ceiling: number;
  assistance: number;
  warning: number;
  hysteresis: number;
}
export const SURFACE_FLIGHT: FlightLimits = Object.freeze({
  margin: 5000,
  ceiling: 4500,
  assistance: 4350,
  warning: 4250,
  hysteresis: 25,
});
export const HELL_FLIGHT: FlightLimits = Object.freeze({
  margin: 0,
  ceiling: VERTICAL_LIMITS.ceiling,
  assistance: VERTICAL_LIMITS.assistance,
  warning: VERTICAL_LIMITS.warning,
  hysteresis: VERTICAL_LIMITS.hysteresis,
});
export const flightLimits = (realm?: string): FlightLimits =>
  realm === "hell" ? HELL_FLIGHT : SURFACE_FLIGHT;
/** True inside the generated terrain square (outside is open sea). */
export const insideTerrain = (x: number, z: number) =>
  x >= 0 && z >= 0 && x <= WORLD_SIZE && z <= WORLD_SIZE;
export const FLY_COUNT = 6;
export const MAX_MONSTER_SPIKES = 600;
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
    depth: 48,
    cloudHeight: 120,
    bodyLimit: 128,
    scatterMin: 50,
    scatterMax: 85,
    ejecta: 720,
  },
  castle: {
    damageRadius: 180,
    craterRadius: 105,
    depth: 80,
    cloudHeight: 240,
    bodyLimit: 128,
    scatterMin: 60,
    scatterMax: 105,
    ejecta: 1000,
  },
  valley: {
    damageRadius: 420,
    craterRadius: 240,
    depth: 100,
    cloudHeight: 400,
    bodyLimit: 128,
    scatterMin: 70,
    scatterMax: 120,
    ejecta: 1200,
  },
};
export const GRAVITY_BOMB = {
  radius: 1000,
  initialRadius: 30,
  pullSeconds: 4,
  burstSeconds: 0.75,
  liftHeight: 35,
  maxActive: 8,
  capsuleRadius: 3,
  lifetime: 20,
  acceleration: 95,
  burstSpeed: 180,
  maxSpeed: 120,
};
export const WEAPONS = {
  gravityBomb: { cooldown: 8 },
  laser: { cooldown: 24 },
  cannon: {
    cooldown: 0.25,
    length: 6,
    radius: 1.6,
    gravity: 5,
    lifetime: 8,
    launchSpeed: 420,
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

export const BLAST_DEBRIS_LIMIT = 8192;
export const BLAST_COSMETIC_LIMIT = 512;
export const CORPSE_MOTION_LIMIT = 128;
