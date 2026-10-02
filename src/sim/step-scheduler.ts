/** Yield between costly physics ticks so explosions cannot monopolize the worker. */
export class StepScheduler {
  private last = 0;
  private accumulator = 0;
  private published = 0;
  reset(now: number) {
    this.last = this.published = now;
    this.accumulator = 0;
  }
  advance(now: number, step: () => void, clock = () => performance.now()) {
    this.accumulator = Math.min(
      0.1,
      this.accumulator + Math.max(0, (now - this.last) / 1000),
    );
    this.last = now;
    const started = clock();
    let steps = 0;
    while (
      this.accumulator + 1e-9 >= 1 / 60 &&
      steps < 2 &&
      (steps === 0 || clock() - started < 8)
    ) {
      step();
      this.accumulator = Math.max(0, this.accumulator - 1 / 60);
      steps++;
    }
    return steps;
  }
  shouldPublish(now: number) {
    if (now - this.published < 1000 / 30) return false;
    this.published = now;
    return true;
  }
}
