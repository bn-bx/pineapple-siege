/** Play worker states on one continuous simulation clock, rather than restarting
 * interpolation whenever a message arrives. A small buffer absorbs tick jitter. */
export class SnapshotTimeline<T extends { time: number }> {
  private states: T[] = [];
  private arrival = 0;
  private warming = true;
  private sampledAt: number | undefined;
  private time: number | undefined;
  constructor(readonly delay = 0.1) {}
  reset() {
    this.states = [];
    this.warming = true;
    this.sampledAt = this.time = undefined;
  }
  receive(state: T, now: number) {
    const last = this.states.at(-1);
    if (last && state.time < last.time) this.reset();
    if (this.states.at(-1)?.time === state.time)
      this.states[this.states.length - 1] = state;
    else this.states.push(state);
    // Bound memory even if the browser stops rendering for a while.
    if (this.states.length > 32) this.states.splice(0, this.states.length - 32);
    this.arrival = now;
  }
  sample(now: number, active: boolean) {
    const latest = this.states.at(-1);
    if (!latest) return undefined;
    if (!active) {
      this.warming = true;
      this.time = latest.time;
      this.sampledAt = now;
      return { previous: latest, current: latest, alpha: 1, time: latest.time };
    }
    const first = this.states[0];
    if (this.time === undefined)
      this.time = Math.max(first.time, latest.time - this.delay);
    const warming = this.warming;
    if (latest.time - this.time >= this.delay - 1e-6) this.warming = false;
    const dt =
      warming || this.sampledAt === undefined
        ? 0
        : Math.max(0, Math.min(0.1, (now - this.sampledAt) / 1000));
    this.sampledAt = now;
    const target =
      latest.time +
      Math.min(0.05, Math.max(0, (now - this.arrival) / 1000)) -
      this.delay;
    // Correct drift gently. Message delivery can never rewind the playback clock.
    const rate = Math.max(0.9, Math.min(1.1, 1 + (target - this.time) * 0.8));
    this.time = Math.max(
      first.time,
      Math.min(latest.time, this.time + dt * rate),
    );
    let index = this.states.findIndex((s) => s.time >= this.time!);
    if (index < 0) index = this.states.length - 1;
    const current = this.states[index];
    const previous = this.states[Math.max(0, index - 1)];
    const interval = current.time - previous.time;
    const alpha =
      interval > 0
        ? Math.max(0, Math.min(1, (this.time - previous.time) / interval))
        : 1;
    if (index > 1) this.states.splice(0, index - 1);
    return { previous, current, alpha, time: this.time };
  }
}
