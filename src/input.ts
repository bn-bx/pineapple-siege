import { clamp } from "./config";
import type { Preferences } from "./types";
export function pointerSteering(
  x: number,
  y: number,
  dx: number,
  dy: number,
  p: Preferences,
) {
  return {
    x: clamp(x + dx * 0.002 * p.sensitivity * (p.reverseX ? -1 : 1), -1, 1),
    y: clamp(y - dy * 0.002 * p.sensitivity * (p.reverseY ? -1 : 1), -1, 1),
  };
}
