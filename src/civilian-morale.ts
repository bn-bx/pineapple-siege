import type { CivilianState } from "./types";
export interface CivilianPopulation {
  total: number;
  alive: number;
  lost: number;
  cheering: number;
  sad: number;
  frightened: number;
  /** Mood contributes to morale; every casualty imposes lasting grief. */
  happiness: number;
}
export function civilianPopulation(
  states: readonly CivilianState[],
): CivilianPopulation {
  let alive = 0,
    cheering = 0,
    sad = 0,
    frightened = 0,
    score = 0;
  for (const c of states) {
    if (!c.alive) continue;
    alive++;
    if (c.mood === "cheer") {
      cheering++;
      score += 100;
    } else if (c.mood === "sad") {
      sad++;
      score += 10;
    } else if (c.mood === "flee") {
      frightened++;
      score += 25;
    } else score += 65;
  }
  return {
    total: states.length,
    alive,
    lost: states.length - alive,
    cheering,
    sad,
    frightened,
    happiness: states.length
      ? Math.max(0, Math.round(score / states.length) - (states.length - alive))
      : 0,
  };
}
