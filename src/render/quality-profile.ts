export interface RenderQualityProfile {
  name: string;
  height: number;
  shadowSize: number;
  shadowInterval: number;
  debrisShadows: boolean;
  treeDistance: number;
  cosmetics: number;
}
export const VISUAL_BUDGET = Object.freeze({
  textureBytes: 192 * 1024 ** 2,
  targetBytes: 64 * 1024 ** 2,
});
/** Presentation budgets never change simulation or saved damage. */
export function qualityProfile(
  selection = "auto",
  pressure = 1,
): RenderQualityProfile {
  const level =
    selection === "auto"
      ? Math.max(0, Math.min(4, Math.round(pressure)))
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
    treeDistance: [360, 360, 300, 240, 160][level],
    cosmetics: [1, 1, 0.75, 0.5, 0.35][level],
  };
}
