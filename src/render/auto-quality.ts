export interface QualityPressure {
  frameMS: number;
  cpuMS: number;
  gpuMS: number;
  workerMS: number;
  lagMS: number;
}
/** Fast reductions and slow recovery avoid oscillation during sustained destruction. */
export class AutoQuality {
  level: number;
  constructor(initialLevel = 1) {
    this.level = Math.max(0, Math.min(4, initialLevel));
  }
  private overload = 0;
  private overloadDebt = 0;
  private previousSample?: number;
  private headroom = 0;
  private changed = -Infinity;
  resume() {
    this.overload = this.headroom = 0;
    this.overloadDebt = 0;
    this.previousSample = undefined;
  }
  update(now: number, p: QualityPressure) {
    const elapsed =
      this.previousSample === undefined
        ? 0
        : Math.max(0, Math.min(100, now - this.previousSample));
    this.previousSample = now;
    const overloaded =
      p.frameMS > 18 ||
      p.cpuMS > 4 ||
      p.gpuMS > 13 ||
      p.workerMS > 8 ||
      p.lagMS > 85;
    const comfortable =
      p.frameMS < 17.4 &&
      p.cpuMS < 3.2 &&
      (!p.gpuMS || p.gpuMS < 10) &&
      p.workerMS < 5 &&
      p.lagMS < 50;
    if (overloaded) {
      // Recurring expensive passes must not be erased by one quieter frame.
      this.overloadDebt = Math.min(450, this.overloadDebt + elapsed);
      this.headroom = 0;
      if (!this.overload) this.overload = now;
      if (
        (now - this.overload >= 450 || this.overloadDebt >= 450) &&
        now - this.changed >= 500 &&
        this.level < 4
      ) {
        this.level++;
        this.changed = now;
        this.overload = 0;
        this.overloadDebt = 0;
        return true;
      }
    } else {
      this.overloadDebt = Math.max(0, this.overloadDebt - elapsed * 0.25);
      this.overload = 0;
      if (comfortable) {
        if (!this.headroom) this.headroom = now;
        if (now - this.headroom >= 15000 && this.level > 0) {
          this.level--;
          this.changed = now;
          this.headroom = 0;
          return true;
        }
      } else this.headroom = 0;
    }
    return false;
  }
  get height() {
    return this.level === 0 ? 1080 : this.level < 4 ? 900 : 720;
  }
  get shadowSize() {
    return this.level < 2 ? 2048 : 1024;
  }
  get shadowInterval() {
    return this.level < 2 ? 1 / 24 : 1 / 12;
  }
  get reflectionInterval() {
    return this.level < 2 ? 1 / 12 : this.level === 2 ? 1 / 6 : 1 / 3;
  }
}
