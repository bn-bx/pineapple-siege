import { VERTICAL_LIMITS } from "./world/vertical-limits.mjs";
export class AltitudeWarning {
  warning = false;
  assistance = false;
  update(altitude: number) {
    this.warning =
      altitude >= VERTICAL_LIMITS.warning ||
      (this.warning &&
        altitude >= VERTICAL_LIMITS.warning - VERTICAL_LIMITS.hysteresis);
    this.assistance =
      altitude >= VERTICAL_LIMITS.assistance ||
      (this.assistance &&
        altitude >= VERTICAL_LIMITS.assistance - VERTICAL_LIMITS.hysteresis);
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
