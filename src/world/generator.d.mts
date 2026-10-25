import type { WorldData, GenerationPreset, GenerationRequest } from "../types";
export const GENERATOR_VERSION: number,
  WORLD_VERSION: number,
  SIZE: number,
  STEP: number,
  GRID: number;
export const PRESETS: Record<
  GenerationPreset,
  {
    name: string;
    profile?: string;
    rivers: number;
    lakes: number;
    forest: number;
    trees: number;
    settlements: number;
  }
>;
export interface IslandBaseline {
  world: WorldData;
  heights: Float32Array;
}
export interface GenerationPlan {
  request: GenerationRequest;
  grid: number;
  step: number;
  size: number;
  heights: Float32Array;
  sites: WorldData["sites"];
  castles: WorldData["castles"];
  rivers: NonNullable<WorldData["rivers"]>;
  lakes: NonNullable<WorldData["lakes"]>;
  waterfalls: NonNullable<WorldData["waterfalls"]>;
  regions: NonNullable<WorldData["regions"]>;
  shapeFamily: string;
  landscapeProfile: string;
  flightCorridors: NonNullable<WorldData["flightCorridors"]>;
  passes: NonNullable<WorldData["passes"]>;
  [key: string]: unknown;
}
export function generationRequest(
  input: number | GenerationRequest,
): GenerationRequest;
export function parseIslandCode(code: string): GenerationRequest;
export function parseSeedCode(code: string): number;
export function seedCode(
  seed: number | GenerationRequest,
  revision?: number,
  preset?: GenerationPreset,
): string;
export function islandLink(code: string, base: string): string;
export function baselineKey(
  world: Pick<
    WorldData,
    "generatorVersion" | "version" | "seed" | "generationPreset"
  >,
): string;
export function supportedIsland(world: WorldData): boolean;
export function hashFor(seed: number): (x: number, z: number) => number;
export function sampleHeight(
  heights: Float32Array,
  x: number,
  z: number,
): number;
export function pathIndex(
  paths: [number, number][][],
  cellSize?: number,
  padding?: number,
): (x: number, z: number) => number;
export function generateIsland(
  request: number | GenerationRequest,
  report?: (label: string, progress: number) => void,
): IslandBaseline;
export function planIsland(
  request: number | GenerationRequest,
  report?: (label: string, progress: number) => void,
): GenerationPlan;
export function materializeIsland(
  plan: GenerationPlan,
  report?: (label: string, progress: number) => void,
): IslandBaseline;
export function validateIsland(
  world: WorldData,
  heights: Float32Array,
): { landFraction: number; peak: number };
