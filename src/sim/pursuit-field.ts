import type { Vec3 } from "../types";

/** One bounded routing job serves the entire horde, including disconnected land. */
export class PursuitField {
  readonly side: number;
  private valid: Uint8Array;
  private edges: Uint8Array;
  private components: Int32Array;
  private next: Int32Array;
  private workNext: Int32Array;
  private queue: Int32Array;
  private heights: Float32Array;
  private phase:
    | "idle"
    | "nodes"
    | "edges"
    | "components"
    | "goals"
    | "routes" = "idle";
  private cursor = 0;
  private head = 0;
  private tail = 0;
  private component = 0;
  private best: number[] = [];
  private bestDistance: number[] = [];
  private goal: Vec3 = [0, 0, 0];
  private revision = -1;
  private requestedRevision = -1;
  private nextRefresh = -Infinity;
  private goalCell = -1;
  private ready = false;
  private offsets: number[];
  constructor(
    size: number,
    private passable: (x: number, z: number) => boolean,
    private height: (x: number, z: number) => number,
    private clearEdge: (a: Vec3, b: Vec3) => boolean,
    readonly spacing = 64,
  ) {
    this.side = Math.floor(size / spacing) + 1;
    const count = this.side * this.side;
    this.valid = new Uint8Array(count);
    this.edges = new Uint8Array(count);
    this.components = new Int32Array(count);
    this.next = new Int32Array(count).fill(-1);
    this.workNext = new Int32Array(count);
    this.queue = new Int32Array(count);
    this.heights = new Float32Array(count);
    this.offsets = [-1, 1, -this.side, this.side];
  }
  private cell(p: Vec3) {
    const x = Math.max(
      0,
      Math.min(this.side - 1, Math.round(p[0] / this.spacing)),
    );
    const z = Math.max(
      0,
      Math.min(this.side - 1, Math.round(p[2] / this.spacing)),
    );
    return z * this.side + x;
  }
  private point(id: number): Vec3 {
    return [
      (id % this.side) * this.spacing,
      this.heights[id],
      Math.floor(id / this.side) * this.spacing,
    ];
  }
  private neighbor(id: number, d: number) {
    if (
      (d === 0 && id % this.side === 0) ||
      (d === 1 && id % this.side === this.side - 1)
    )
      return -1;
    const n = id + this.offsets[d];
    return n < 0 || n >= this.valid.length ? -1 : n;
  }
  private startGoals(target: Vec3) {
    this.goal = [...target];
    this.goalCell = this.cell(target);
    this.best = [];
    this.bestDistance = [];
    this.workNext.fill(-1);
    this.cursor = 0;
    this.phase = "goals";
  }
  advance(target: Vec3, time: number, revision: number, budgetMS = 2) {
    if (
      (this.phase === "goals" || this.phase === "routes") &&
      time >= this.nextRefresh &&
      this.cell(target) !== this.goalCell
    ) {
      this.nextRefresh = time + 1;
      this.startGoals(target);
    }
    if (
      this.phase === "idle" &&
      time >= this.nextRefresh &&
      (!this.ready ||
        revision !== this.revision ||
        this.cell(target) !== this.goalCell)
    ) {
      this.nextRefresh = time + 1;
      this.requestedRevision = revision;
      this.goal = [...target];
      if (!this.ready || revision !== this.revision) {
        this.phase = "nodes";
        this.cursor = 0;
        this.component = 0;
        this.valid.fill(0);
        this.edges.fill(0);
        this.components.fill(0);
      } else this.startGoals(target);
    }
    const deadline = performance.now() + budgetMS;
    let operations = 0;
    while (
      this.phase !== "idle" &&
      performance.now() < deadline &&
      operations++ < 4096
    ) {
      if (this.phase === "nodes") {
        if (this.cursor === this.valid.length) {
          this.cursor = 0;
          this.phase = "edges";
          continue;
        }
        const id = this.cursor++,
          p = this.point(id);
        this.heights[id] = this.height(p[0], p[2]);
        this.valid[id] = this.passable(p[0], p[2]) ? 1 : 0;
      } else if (this.phase === "edges") {
        if (this.cursor === this.valid.length) {
          this.cursor = 0;
          this.head = this.tail = 0;
          this.phase = "components";
          continue;
        }
        const id = this.cursor++;
        if (!this.valid[id]) continue;
        for (const d of [1, 3]) {
          const n = this.neighbor(id, d);
          if (n < 0 || !this.valid[n]) continue;
          const a = this.point(id),
            b = this.point(n);
          if (
            !this.passable((a[0] + b[0]) / 2, (a[2] + b[2]) / 2) ||
            !this.clearEdge(a, b)
          )
            continue;
          this.edges[id] |= 1 << d;
          this.edges[n] |= 1 << (d === 1 ? 0 : 2);
        }
      } else if (this.phase === "components") {
        if (this.head < this.tail) {
          const id = this.queue[this.head++];
          for (let d = 0; d < 4; d++)
            if (this.edges[id] & (1 << d)) {
              const n = this.neighbor(id, d);
              if (!this.components[n]) {
                this.components[n] = this.component;
                this.queue[this.tail++] = n;
              }
            }
        } else {
          while (
            this.cursor < this.valid.length &&
            (!this.valid[this.cursor] || this.components[this.cursor])
          )
            this.cursor++;
          if (this.cursor === this.valid.length) {
            this.startGoals(target);
            continue;
          }
          this.head = 0;
          this.tail = 1;
          this.queue[0] = this.cursor;
          this.components[this.cursor] = ++this.component;
        }
      } else if (this.phase === "goals") {
        if (this.cursor === this.valid.length) {
          this.head = this.tail = 0;
          for (const id of this.best)
            if (id !== undefined) {
              this.queue[this.tail++] = id;
              this.workNext[id] = id;
            }
          this.phase = "routes";
          continue;
        }
        const id = this.cursor++;
        if (!this.valid[id]) continue;
        const p = this.point(id),
          c = this.components[id],
          d = (p[0] - this.goal[0]) ** 2 + (p[2] - this.goal[2]) ** 2;
        if (d < (this.bestDistance[c] ?? Infinity)) {
          this.bestDistance[c] = d;
          this.best[c] = id;
        }
      } else {
        if (this.head === this.tail) {
          [this.next, this.workNext] = [this.workNext, this.next];
          this.revision = this.requestedRevision;
          this.ready = true;
          this.phase = "idle";
          continue;
        }
        const id = this.queue[this.head++];
        for (let d = 0; d < 4; d++)
          if (this.edges[id] & (1 << d)) {
            const n = this.neighbor(id, d);
            if (this.workNext[n] < 0) {
              this.workNext[n] = id;
              this.queue[this.tail++] = n;
            }
          }
      }
    }
  }
  target(p: Vec3): Vec3 | undefined {
    if (!this.ready) return;
    let id = this.cell(p);
    if (this.next[id] < 0) {
      let distance = Infinity;
      const cx = id % this.side,
        cz = Math.floor(id / this.side);
      for (
        let z = Math.max(0, cz - 2);
        z <= Math.min(this.side - 1, cz + 2);
        z++
      )
        for (
          let x = Math.max(0, cx - 2);
          x <= Math.min(this.side - 1, cx + 2);
          x++
        ) {
          const n = z * this.side + x;
          if (this.next[n] < 0) continue;
          const d =
            (x * this.spacing - p[0]) ** 2 + (z * this.spacing - p[2]) ** 2;
          if (d < distance) {
            distance = d;
            id = n;
          }
        }
    }
    const n = this.next[id];
    if (n < 0) return;
    return this.point(n);
  }
}
