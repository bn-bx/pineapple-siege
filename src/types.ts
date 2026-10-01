export type ProjectileWeapon = "cannon" | "nuke";
export type WeaponId = ProjectileWeapon | "laser";
export interface LaserProfile {
  radius: number;
  depth: number;
  beamRadius: number;
  brightness: number;
}
export interface LaserStrike {
  profile?: LaserProfile;
  id: number;
  p: Vec3;
  age: number;
  phase: "charging" | "burning" | "finishing";
  pending?: number[];
}
export interface LaserWork {
  section: number;
  targets: { p: Vec3; progress: number; radius?: number; depth?: number }[];
}
export type NukeYield = "local" | "castle" | "valley";
export interface DestructionSettings {
  bodies: number;
  fragments: number;
  cosmetics: number;
  rubble: number;
  noCooldown: boolean;
  nukeScale: number;
  laserSize: number;
  laserDepth: number;
  laserBrightness: number;
}
export interface BlastProfile {
  damageRadius: number;
  craterRadius: number;
  depth: number;
  cloudHeight: number;
  bodyLimit: number;
  scatterMin: number;
  scatterMax: number;
  ejecta: number;
}
export type CameraMode = "chase" | "cinematic" | "photo";
export interface Preferences {
  revision?: number;
  quality?: string;
  reduceEffects?: boolean;
  reduceShake?: boolean;
  volume?: number;
  mute?: boolean;
  showPerf?: boolean;
  holdTime?: boolean;
  reverseX: boolean;
  reverseY: boolean;
  sensitivity: number;
  nukeYield: NukeYield;
  destruction?: DestructionSettings;
  monsterCount?: 0 | 3 | 8 | 20;
}
export interface MonsterState {
  id: number;
  p: Vec3;
  yaw: number;
  health: number;
  defeated: boolean;
  phase: number;
  windup: number;
  stagger: number;
}
export interface MonsterSpike {
  p: Vec3;
  v: Vec3;
}
export interface DestructionJob {
  p: Vec3;
  yield: NukeYield;
  phase: "terrain" | "entities" | "support";
  cursor: number;
  chunks: number[];
  entities: number[];
  assemblies: string[];
  fragments: number;
  profile: BlastProfile;
  seed: number;
  excavation: number;
  supportQueue?: number[][];
}
export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];
export type Material =
  | "stone"
  | "wood"
  | "foliage"
  | "earth"
  | "rock"
  | "plaster"
  | "roof";
export interface Entity {
  id: number;
  kind: "block" | "tree" | "rock";
  p: Vec3;
  s: Vec3;
  material: Material;
  assembly: string;
  foundation: boolean;
  supports: number[];
  variant: number;
}
export interface WorldData {
  version: number;
  seed: number;
  size: number;
  step: number;
  grid: number;
  chunkSize: number;
  castle: Vec3;
  castleBounds: { min: [number, number]; max: [number, number] };
  landmarks: { gate: Vec3; keep: Vec3; towers: Vec3[] };
  banners: { owner: number; p: Vec3; s: Vec3 }[];
  bridge: [number, number];
  spawn: Vec3;
  paths: [number, number][][];
  lights: { owner: number; p: Vec3 }[];
  structureCount: number;
  castleCount: number;
  sites: {
    id: string;
    kind: string;
    p: Vec3;
    radius: number;
    bounds: { min: [number, number]; max: [number, number] };
    assemblies: string[];
  }[];
  entities: Entity[];
}
export interface InputState {
  x: number;
  y: number;
  throttle: number;
  bank: number;
  boost: boolean;
  fire: boolean;
}
export interface PlaneState {
  p: Vec3;
  v: Vec3;
  yaw: number;
  pitch: number;
  roll: number;
  speed: number;
  crashed: number;
  boundary: boolean;
}
export interface BodyView {
  id: number;
  p: Vec3;
  q: Quat;
  s: Vec3;
  material: Material;
  kind: "chunk" | "tree" | "rock";
  source: number;
}
export interface TerrainPatch {
  indices: Uint32Array;
  values: Float32Array;
  chunks: number[];
  revision: number;
}
export interface Ruin {
  id: number;
  p: Vec3;
  q: Quat;
  s: Vec3;
  material: Material;
  kind: "chunk" | "tree" | "rock";
  source: number;
  // Material volume survives pile consolidation, including during save capture.
  volume?: number;
  pile?: boolean;
}
export interface WorldDelta {
  type: "delta";
  revision: number;
  removed: number[];
  terrain?: TerrainPatch;
  settled: Ruin[];
  rubbleRemoved: number[];
  flood?: Uint32Array;
  dry?: Uint32Array;
}
export interface Explosion {
  type: "explosion";
  p: Vec3;
  water: boolean;
  power: number;
  seed: number;
  kind: "blast" | "crash" | "collapse" | "impact" | "nuke";
  profile?: BlastProfile;
  yield?: NukeYield;
}
export interface FragmentEffect {
  type: "fragments";
  p: Vec3;
  origin: Vec3;
  material: Material;
  seed: number;
  count: number;
  speed: number;
  spread: number;
}
export interface SimulationSnapshot {
  type: "snapshot";
  tick: number;
  time: number;
  plane: PlaneState;
  hour: number;
  aim: Vec3 | null;
  weapon: WeaponId;
  nukeYield: NukeYield;
  cooldowns: Record<WeaponId, number>;
  lasers: LaserStrike[];
  projectiles: {
    id: number;
    p: Vec3;
    v: Vec3;
    weapon: ProjectileWeapon;
    yield: NukeYield;
  }[];
  monsters: MonsterState[];
  monsterSpikes: MonsterSpike[];
  monsterCount: number;
  bodies: BodyView[];
  stats: {
    physicsMS: number;
    destructionMS: number;
    pendingJobs: number;
    bodies: number;
    ruins: number;
    removed: number;
    shots: number;
    revision: number;
  };
}
export interface SaveSnapshot {
  destruction?: DestructionSettings;
  version: number;
  worldVersion: number;
  seed: number;
  revision: number;
  hour: number;
  // Packed [sample index, height, ...]; accept older version-3 tuple saves on read.
  terrain: Float32Array | [number, number][];
  removed: number[];
  ruins: Ruin[];
  pendingJobs: DestructionJob[];
  lasers: LaserStrike[];
  laserWork: LaserWork[];
  laserSupport: string[];
  laserCooldown: number;
  laserDry: Uint32Array;
  vaporized: number[];
  monsters?: MonsterState[];
}
export type GameCommand =
  | {
      type: "init";
      world: WorldData;
      heights: ArrayBuffer;
      save?: SaveSnapshot;
      debug?: boolean;
      destruction?: DestructionSettings;
      monsterCount?: number;
    }
  | { type: "input"; input: InputState }
  | { type: "pause"; paused: boolean }
  | { type: "weapon"; weapon: WeaponId }
  | { type: "nukeYield"; value: NukeYield }
  | { type: "destructionSettings"; value: DestructionSettings }
  | { type: "monsterCount"; value: 0 | 3 | 8 | 20 }
  | { type: "respawn" }
  | { type: "reset" }
  | { type: "save"; request: number }
  | { type: "hour"; hour: number }
  | { type: "holdTime"; hold: boolean }
  | { type: "debugBlast"; p: Vec3; yield?: NukeYield }
  | { type: "debugLaser"; p: Vec3 }
  | { type: "debugPlane"; p: Vec3; yaw: number; pitch: number }
  | { type: "debugStep"; steps: number };
export interface ContactSound {
  type: "contactSound";
  p: Vec3;
  material: Material;
  energy: number;
  action: "fracture" | "impact" | "settle";
}
export type WorkerMessage =
  | { type: "vaporize"; p: Vec3; radius: number }
  | { type: "monsterEvent"; p: Vec3; kind: "hit" | "defeat" | "throw" | "swipe" }
  | ContactSound
  | { type: "paused"; snapshot: SimulationSnapshot }
  | WorldDelta
  | Explosion
  | FragmentEffect
  | SimulationSnapshot
  | {
      type: "ready";
      removed: number[];
      ruins: Ruin[];
      heights: ArrayBuffer;
      flood: Uint32Array;
      hour: number;
    }
  | { type: "saved"; request: number; save: SaveSnapshot }
  | { type: "error"; message: string }
  | { type: "resetDone" }
  | { type: "debugResult"; state: unknown };
