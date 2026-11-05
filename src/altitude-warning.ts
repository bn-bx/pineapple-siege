import { VERTICAL_LIMITS } from "./world/vertical-limits.mjs";
type Limits = Pick<typeof VERTICAL_LIMITS, "warning" | "assistance" | "hysteresis">;
export class AltitudeWarning {
  warning = false;
  assistance = false;
  /** `limits` defaults to the generation limits; the HUD passes the realm's flight limits. */
  update(altitude: number, limits: Limits = VERTICAL_LIMITS) {
    this.warning =
      altitude >= limits.warning ||
      (this.warning &&
        altitude >= limits.warning - limits.hysteresis);
    this.assistance =
      altitude >= limits.assistance ||
      (this.assistance &&
        altitude >= limits.assistance - limits.hysteresis);
    return this.assistance
      ? "CEILING ASSISTANCE"
      : this.warning
        ? "APPROACHING FLIGHT CEILING"
        : "";
  }
  reset() {
    this.warning = this.assistance = false;
  }
}
