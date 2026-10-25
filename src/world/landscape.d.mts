import type {
  RegionFields,
  MainlandMask,
  FlightCorridor,
  Vec3,
  GenerationPreset,
} from "../types";
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
export const REGION_NAMES: string[], COAST_NAMES: string[];
export function fieldSample(
  field: ArrayLike<number>,
  grid: number,
  step: number,
  x: number,
  z: number,
): number;
export function regionAt(
  fields: RegionFields | undefined,
  x: number,
  z: number,
): {
  moisture: number;
  exposure: number;
  woodland: number;
  biome: number;
  coast: number;
};
export function onMainland(mask: MainlandMask, x: number, z: number): boolean;
export function flightDistance(
  corridors: FlightCorridor[] | undefined,
  x: number,
  z: number,
): number;
