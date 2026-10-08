import { CONFIG } from "../config";

/** Speed-driven exhaust profile for the two fixed jet nozzles. */
export function jetExhaustProfile(speed: number, phase: number) {
  const t = Math.max(0, Math.min(1, (speed - 45) / (CONFIG.boostSpeed - 45)));
  const thrust = t * t * (3 - 2 * t);
  const pulse = Math.sin(phase) * 0.035;
  return {
    outerLength: 0.72 + thrust * 0.98 + pulse,
    outerOpacity: 0.42 + thrust * 0.4,
    coreLength: 0.52 + thrust * 0.58 + pulse * 0.6,
    coreOpacity: 0.48 + thrust * 0.45,
  };
}
