export interface RenderQualityProfile {
  name: string;
  height: number;
  shadowSize: number;
  shadowInterval: number;
  debrisShadows: boolean;
  surfaceNormals: boolean;
  reflectionInterval: number;
  reflectionWidth: number;
  reflectionHeight: number;
  reflectionFoliageDetail: boolean;
  foliageDistance: number;
  nearFoliageDistance: number;
  middleFoliageDistance: number;
  detail: number;
  ambientOcclusion: boolean;
  bloom: boolean;
  antialias: boolean;
  heatDistortion: boolean;
  cosmetics: number;
}

export const VISUAL_BUDGET = Object.freeze({
  textureBytes: 192 * 1024 ** 2,
  targetBytes: 64 * 1024 ** 2,
});
/** Presentation only: never sent to the authoritative simulation. */
export function qualityProfile(
  selection = "auto",
  pressure = 1,
): RenderQualityProfile {
  const level =
    selection === "auto"
      ? Math.max(0, Math.min(4, pressure))
      : selection === "720"
        ? 3
        : selection === "1440"
          ? 0
          : 1;
  return {
    name: ["Ultra", "High", "Balanced", "Performance", "Recovery"][level],
    height:
      selection === "auto"
        ? level === 0
          ? 1080
          : level === 4
            ? 720
            : 900
        : Number(selection) || 900,
    shadowSize: level < 2 ? 2048 : 1024,
    shadowInterval: level < 2 ? 1 / 24 : level === 4 ? 1 / 8 : 1 / 12,
    debrisShadows: level < 2,
    surfaceNormals: level < 3,
    reflectionInterval:
      level === 0 ? 1 / 12 : level === 1 ? 1 / 6 : level === 4 ? 1 : 1 / 3,
    reflectionWidth: [1024, 768, 512, 384, 256][level],
    reflectionHeight: [576, 432, 288, 216, 144][level],
    reflectionFoliageDetail: level < 2,
    foliageDistance: [120, 120, 90, 65, 45][level],
    nearFoliageDistance: [180, 180, 140, 100, 0][level],
    middleFoliageDistance: [420, 360, 300, 240, 160][level],
    detail: [1.25, 1, 0.85, 0.75, 0.6][level],
    ambientOcclusion: level < 2,
    bloom: level < 3,
    antialias: true,
    heatDistortion: level === 0,
    cosmetics: [1, 1, 0.75, 0.5, 0.35][level],
  };
}
