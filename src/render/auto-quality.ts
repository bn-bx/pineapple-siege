import { qualityProfile } from "./quality-profile";

export interface QualityPressure {
  frameMS: number;
  cpuMS: number;
  gpuMS: number;
  workerMS: number;
  lagMS: number;
}
/** Start at Ultra and reduce only for sustained rendering pressure. */
export class AutoQuality {
  level: number;
  constructor(initialLevel = 0) {
    this.level = Math.max(0, Math.min(4, initialLevel));
  }
  private overloadDebt = 0;
  private previousSample?: number;
  private settlingUntil?: number;
  private headroom = 0;
  private changed = -Infinity;
  resume() {
    this.headroom = this.overloadDebt = 0;
    this.previousSample = this.settlingUntil = undefined;
  }
  update(now: number, p: QualityPressure) {
    const elapsed =
      this.previousSample === undefined
        ? 0
        : Math.max(0, Math.min(100, now - this.previousSample));
    this.previousSample = now;
    this.settlingUntil ??= now + 3000;
    if (now < this.settlingUntil) return false;

    // Worker stalls alone do not improve when graphics are reduced. Require
    // missed frame budget plus renderer pressure; use frames as a fallback
    // when GPU timers are unavailable and simulation is keeping up.
    const overloaded =
      p.frameMS > 20 &&
      (p.cpuMS > 12 ||
        p.gpuMS > 16 ||
        (!(p.gpuMS > 0) && p.workerMS < 12 && p.lagMS < 85));
    const comfortable =
      p.frameMS < 18 && p.cpuMS < 10 && (!(p.gpuMS > 0) || p.gpuMS < 14);
    if (overloaded) {
      this.headroom = 0;
      this.overloadDebt = Math.min(2000, this.overloadDebt + elapsed);
      const severe = p.frameMS > 35 && (p.cpuMS > 24 || p.gpuMS > 25);
      if (
        this.overloadDebt >= (severe ? 750 : 2000) &&
        now - this.changed >= 3000 &&
        this.level < 4
      ) {
        this.level++;
        this.changed = now;
        this.overloadDebt = 0;
        return true;
      }
    } else {
      this.overloadDebt = Math.max(0, this.overloadDebt - elapsed * 2);
      this.headroom = comfortable ? this.headroom + elapsed : 0;
      if (
        this.headroom >= 5000 &&
        now - this.changed >= 5000 &&
        this.level > 0
      ) {
        this.level--;
        this.changed = now;
        this.headroom = this.overloadDebt = 0;
        return true;
      }
    }
    return false;
  }
  get height() {
    return qualityProfile("auto", this.level).height;
  }
  get shadowSize() {
    return qualityProfile("auto", this.level).shadowSize;
  }
  get shadowInterval() {
    return qualityProfile("auto", this.level).shadowInterval;
  }
}
