/** Uses authoritative time, resets across pauses/teleports, and ignores startup. */
export class SimulationCadence {
  ratio = 1;
  private wall = NaN;
  private simulation = 0;
  reset() {
    this.wall = NaN;
    this.ratio = 1;
  }
  sample(wallMS: number, simulationSeconds: number, active: boolean) {
    if (!active) {
      this.reset();
      return this.ratio;
    }
    if (!Number.isFinite(this.wall) || simulationSeconds < this.simulation) {
      this.wall = wallMS;
      this.simulation = simulationSeconds;
    } else if (wallMS - this.wall >= 5000) {
      this.ratio =
        ((simulationSeconds - this.simulation) * 1000) / (wallMS - this.wall);
      this.wall = wallMS;
      this.simulation = simulationSeconds;
    }
    return this.ratio;
  }
}
