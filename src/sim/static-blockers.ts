import { CONFIG, clamp } from "../config";
import type { Entity, Vec3 } from "../types";

/** Immutable horizontal candidates; removal is checked against authoritative IDs. */
export class StaticBlockerIndex {
  private cells = new Map<number, Entity[]>();
  private width: number;
  constructor(
    private spacing: number,
    private padding: number,
    private monster: boolean,
  ) {
    this.width = Math.ceil(CONFIG.worldSize / spacing);
  }
  add(e: Entity) {
    if (e.kind === "tree") return;
    const x0 = clamp(
        Math.floor((e.p[0] - e.s[0] - this.padding) / this.spacing),
        0,
        this.width - 1,
      ),
      x1 = clamp(
        Math.floor((e.p[0] + e.s[0] + this.padding) / this.spacing),
        0,
        this.width - 1,
      ),
      z0 = clamp(
        Math.floor((e.p[2] - e.s[2] - this.padding) / this.spacing),
        0,
        this.width - 1,
      ),
      z1 = clamp(
        Math.floor((e.p[2] + e.s[2] + this.padding) / this.spacing),
        0,
        this.width - 1,
      );
    for (let z = z0; z <= z1; z++)
      for (let x = x0; x <= x1; x++) {
        const key = z * this.width + x;
        let list = this.cells.get(key);
        if (!list) this.cells.set(key, (list = []));
        list.push(e);
      }
  }
  blocked(p: Vec3, removed: ReadonlySet<number>) {
    const x = Math.floor(p[0] / this.spacing),
      z = Math.floor(p[2] / this.spacing);
    if (x < 0 || z < 0 || x >= this.width || z >= this.width) return false;
    const candidates = this.cells.get(z * this.width + x);
    if (!candidates) return false;
    for (const e of candidates) {
      if (removed.has(e.id)) continue;
      if (
        Math.abs(e.p[0] - p[0]) < e.s[0] + this.padding &&
        Math.abs(e.p[2] - p[2]) < e.s[2] + this.padding &&
        e.p[1] + e.s[1] > p[1] + (this.monster ? 2 : 0) &&
        (this.monster || e.p[1] - e.s[1] < p[1] + 4)
      )
        return true;
    }
    return false;
  }
}
