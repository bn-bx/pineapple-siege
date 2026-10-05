import type { WorldData } from "../types";
export const GENERATOR_VERSION: number;
export const WORLD_VERSION: number;
export const SIZE: number;
export const STEP: number;
export const GRID: number;
export interface IslandBaseline {
  world: WorldData;
  heights: Float32Array;
}
export function seedCode(seed: number): string;
export function parseSeedCode(code: string): number;
export function islandLink(code: string, base: string): string;
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
  seed: number,
  report?: (label: string, progress: number) => void,
): IslandBaseline;
export function validateIsland(
  world: WorldData,
  heights: Float32Array,
): { landFraction: number; peak: number };
