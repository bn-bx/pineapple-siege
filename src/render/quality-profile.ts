export interface RenderQualityProfile {
  name: string;
  height: number;
  shadowSize: number;
  shadowInterval: number;
  /** Largest sun shadow-box half-extent (m) used when flying high. */
  shadowReach: number;
  debrisShadows: boolean;
  treeDistance: number;
  cosmetics: number;
}
/** Presentation budgets never change simulation or saved damage. */
export function qualityProfile(
  selection = "auto",
  pressure = 0,
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
        ? [1440, 1080, 900, 720, 720][level]
        : Number(selection) || 900,
    shadowSize: level < 2 ? 2048 : 1024,
    shadowInterval: level < 2 ? 1 / 24 : level === 4 ? 1 / 8 : 1 / 12,
    shadowReach: [460, 460, 320, 220, 220][level],
    debrisShadows: level < 2,
    treeDistance: [360, 360, 300, 240, 160][level],
    cosmetics: [1, 1, 0.75, 0.5, 0.35][level],
  };
}
