import type { RiverData, LakeData, Vec3 } from "../types";
export function riverHalfWidth(river: RiverData, index: number): number;
export function segmentWater(
  a: Vec3,
  b: Vec3,
  startWidth: number,
  endWidth: number,
  x: number,
  z: number,
): number | undefined;
export function pointInLake(lake: LakeData, x: number, z: number): boolean;
export function inlandWaterHeight(
  rivers: RiverData[],
  lakes: LakeData[],
  x: number,
  z: number,
  riverOnly?: boolean,
): number;
