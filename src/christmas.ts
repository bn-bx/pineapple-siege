/**
 * The Christmas look: snow, lights, festive costumes. It is presentation
 * only, so saves, island codes and the simulation never see it.
 *
 * The choice lives in localStorage (read synchronously, before the renderer
 * builds its scene) rather than in the IndexedDB preferences, and changing
 * it reloads the page. Without storage (tests, Node) it defaults to off; in
 * a browser it defaults to on.
 */
export type ChristmasMode = "off" | "on" | "sleigh";

const KEY = "pineapple-siege.christmas";

function read(): ChristmasMode {
  try {
    if (typeof localStorage === "undefined") return "off";
    const value = localStorage.getItem(KEY);
    return value === "off" || value === "on" || value === "sleigh"
      ? value
      : "on";
  } catch {
    return typeof window === "undefined" ? "off" : "on";
  }
}

let mode: ChristmasMode = read();

/** Whether the Christmas look is on. */
export const christmas = () => mode !== "off";
/** "sleigh" also swaps the aircraft for Santa's sleigh and reindeer. */
export const christmasMode = () => mode;

export function setChristmasMode(next: ChristmasMode) {
  mode = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    // Applies for this session only.
  }
}

/** Christmas palette shared by the decorations. */
export const XMAS = {
  red: "#c8102e",
  deepRed: "#8e0c1f",
  green: "#1f7a3a",
  darkGreen: "#0f4d26",
  gold: "#f2c14e",
  white: "#f6f8fb",
  snow: "#eef3f8",
  bulbs: ["#ff3030", "#2fdc5a", "#ffd23a", "#3a8bff", "#ff8a1e", "#ff4fd8"],
} as const;
