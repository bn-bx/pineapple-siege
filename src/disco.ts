import type { LaserStrike } from "./types";

/** Finishing strikes can continue excavation without extending the show. */
export const discoActive = (strikes: readonly LaserStrike[]) =>
  strikes.some((strike) => strike.phase === "charging" || strike.phase === "burning");
