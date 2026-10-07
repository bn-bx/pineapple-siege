import * as THREE from "three";
import type { PlaneState } from "../types";

/** Presentation-only tail/wing deflection from the same flight snapshot. */
export function jetSurfacePose(
  plane: Pick<PlaneState, "pitch" | "roll" | "yaw">,
  previousYaw?: number,
  dt = 0,
) {
  const yawStep =
    previousYaw === undefined
      ? 0
      : Math.atan2(
          Math.sin(plane.yaw - previousYaw),
          Math.cos(plane.yaw - previousYaw),
        );
  const yawRate = dt > 0 ? yawStep / dt : 0;
  return {
    aileronLeft: THREE.MathUtils.clamp(plane.roll * 0.2, -0.22, 0.22),
    aileronRight: THREE.MathUtils.clamp(-plane.roll * 0.2, -0.22, 0.22),
    elevator: THREE.MathUtils.clamp(plane.pitch * 0.26, -0.22, 0.22),
    rudder: THREE.MathUtils.clamp(yawRate * 0.055, -0.22, 0.22),
  };
}
