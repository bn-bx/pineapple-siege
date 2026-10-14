import { CONFIG, clamp } from "../config";
import type { Vec3 } from "../types";

export interface FuelDrop {
  p: Vec3;
  radius: number;
  landed: boolean;
  burning: boolean;
}
interface Spill {
  drops: (FuelDrop & { v: Vec3 })[];
  age: number;
  contactAge?: number;
  impact?: Vec3;
  ignited: boolean;
  exploded: boolean;
}
export interface FuelHost {
  ground(x: number, z: number): number;
  water(x: number, z: number): boolean;
  ignite(p: Vec3): void;
  explode(p: Vec3): void;
}
/** Cosmetic droplets drive one delayed fire/explosion per crash; no fluid bodies. */
export class CrashFuel {
  private spills: Spill[] = [];
  spill(p: Vec3, velocity: Vec3) {
    if (this.spills.length >= 8) this.spills.shift();
    this.spills.push({
      age: 0,
      ignited: false,
      exploded: false,
      drops: Array.from({ length: 36 }, (_, i) => {
        const angle = i * 2.39996;
        return {
          p: [...p] as Vec3,
          radius: 3.5 + (i % 4) * 0.8,
          landed: false,
          burning: false,
          v: [
            velocity[0] + Math.cos(angle) * (14 + i * 0.65),
            velocity[1] + 6 + (i % 4),
            velocity[2] + Math.sin(angle) * (14 + i * 0.65),
          ] as Vec3,
        };
      }),
    });
  }
  step(dt: number, host: FuelHost) {
    if (dt <= 0) return;
    for (const spill of this.spills) {
      spill.age += dt;
      for (const d of spill.drops) {
        if (d.landed) {
          d.p[1] = host.ground(d.p[0], d.p[2]) + 0.2;
          continue;
        }
        d.v[1] -= 22 * dt;
        d.v[0] *= Math.exp(-0.18 * dt);
        d.v[2] *= Math.exp(-0.18 * dt);
        for (let i = 0; i < 3; i++) d.p[i] += d.v[i] * dt;
        d.p[0] = clamp(d.p[0], 1, CONFIG.worldSize - 1);
        d.p[2] = clamp(d.p[2], 1, CONFIG.worldSize - 1);
        const ground = host.ground(d.p[0], d.p[2]);
        if (d.p[1] <= ground + 0.2) {
          d.landed = true;
          // Momentum carries the airborne spray; ground contact absorbs it.
          d.v = [0, 0, 0];
          d.p[1] = ground + 0.2;
          if (!spill.impact && !host.water(d.p[0], d.p[2])) {
            spill.impact = [...d.p];
            spill.contactAge = spill.age;
          }
        }
      }
      if (!spill.impact) continue;
      const elapsed = spill.age - spill.contactAge!;
      if (!spill.ignited && elapsed >= 0.8) {
        spill.ignited = true;
      }
      if (spill.ignited) {
        for (const d of spill.drops) {
          if (d.burning || !d.landed || host.water(d.p[0], d.p[2])) continue;
          d.burning = true;
          host.ignite([...d.p]);
        }
      }
      if (!spill.exploded && elapsed >= 2.5) {
        spill.exploded = true;
        host.explode([...spill.impact]);
      }
    }
    this.spills = this.spills.filter(
      (s) => s.age < 30 && !(s.exploded && s.age - s.contactAge! > 12),
    );
  }
  snapshot(): FuelDrop[] {
    return this.spills.flatMap((s) =>
      s.drops.map((d) => ({
        p: [...d.p] as Vec3,
        radius: d.radius,
        landed: d.landed,
        burning: d.burning,
      })),
    );
  }
  reset() {
    this.spills.length = 0;
  }
}
