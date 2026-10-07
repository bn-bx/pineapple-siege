import RAPIER from "@dimforge/rapier3d-compat";
import { clamp } from "../config";
import type {
  DestructionJob,
  Entity,
  PlaneState,
  SupportJob,
  Vec3,
  WorldData,
} from "../types";
import { Terrain } from "./terrain";
const distance = (a: Vec3, b: Vec3) =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
function rand(n: number) {
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}
export interface DestructionDriverContext {
  processSupport: (deadline: number) => void;
  pendingJobs: DestructionJob[];
  bump: () => void;
  terrain: Terrain;
  revision: number;
  terrainColliders: Map<number, RAPIER.Collider>;
  invalidateTerrainCollider: (id: number) => void;
  flush: (
    terrain?: ReturnType<Terrain["crater"]>,
    flood?: Uint32Array,
    dry?: Uint32Array,
  ) => void;
  world: WorldData;
  removed: Set<number>;
  plane: PlaneState;
  fragment: (
    e: Entity,
    origin: Vec3,
    force: number,
    budget: { n: number; limit?: number },
  ) => void;
  removeEntity: (e: Entity) => void;
  staticFragment: (e: Entity, origin?: Vec3, force?: number) => void;
  emitFragments: (
    p: Vec3,
    origin: Vec3,
    material: Entity["material"],
    count: number,
    speed: number,
    spread?: number,
    seed?: number,
  ) => void;
  dirtyAssemblies: Set<string>;
  resolveSupport: (
    origin: Vec3,
    coarse?: number,
    dynamicBudget?: number,
    deferred?: number[][],
  ) => number;
  supportJobs: SupportJob[];
  destructionMS: number;
}
export class DestructionDriver {
  constructor(private host: DestructionDriverContext) {}
  process(budgetMS = 2): void {
    const start = performance.now();
    this.host.processSupport(start + budgetMS * 0.5);
    while (
      this.host.pendingJobs.length &&
      performance.now() - start < budgetMS
    ) {
      const job = this.host.pendingJobs[0],
        profile = job.profile;
      if (job.phase === "terrain") {
        if (job.cursor >= job.chunks.length) {
          job.phase = "entities";
          job.cursor = 0;
          continue;
        }
        const id = job.chunks[job.cursor++];
        this.host.bump();
        const patch = this.host.terrain.crater(
          job.p[0],
          job.p[2],
          profile.craterRadius,
          profile.depth * job.excavation,
          this.host.revision,
          id,
        );
        const flood = this.host.terrain.floodChanged(patch.indices);
        for (const changed of patch.chunks)
          if (this.host.terrainColliders.has(changed))
            this.host.invalidateTerrainCollider(changed);
        this.host.flush(patch, flood);
      } else if (job.phase === "entities") {
        if (job.cursor >= job.entities.length) {
          job.phase = "support";
          job.cursor = 0;
          job.assemblies = [...new Set(job.assemblies)];
          continue;
        }
        const e = this.host.world.entities[job.entities[job.cursor++]];
        if (this.host.removed.has(e.id)) continue;
        const d = Math.hypot(
          ...e.p.map((v, k) => Math.max(0, Math.abs(v - job.p[k]) - e.s[k])),
        );
        if (e.assembly) job.assemblies.push(e.assembly);
        // Deterministic breakup probability softens only the outer 30% of the blast.
        const strength = clamp(
          (profile.damageRadius - d) / (profile.damageRadius * 0.3),
          0,
          1,
        );
        if (
          d < profile.damageRadius &&
          (e.kind === "tree" || strength > rand(e.id * 31))
        ) {
          this.host.bump();
          const speed =
            profile.scatterMin +
            (profile.scatterMax - profile.scatterMin) * strength;
          if (
            job.fragments < profile.bodyLimit - 24 &&
            distance(e.p, this.host.plane.p) < 700
          ) {
            const budget = { n: job.fragments, limit: profile.bodyLimit - 24 };
            this.host.fragment(e, job.p, speed, budget);
            job.fragments = budget.n;
          } else {
            this.host.removeEntity(e);
            this.host.staticFragment(e, job.p, speed);
          }
          // Bounded effect allocation, distributed over the destroyed structures.
          if (job.cursor <= 40)
            this.host.emitFragments(
              e.p,
              job.p,
              e.kind === "tree" ? "wood" : e.material,
              Math.floor((profile.ejecta * 0.4) / 40),
              speed,
              Math.max(...e.s) * 0.5,
              job.seed + e.id,
            );
        }
      } else {
        const queue = job.supportQueue!;
        if (queue.length) {
          const ids = queue.pop()!,
            e = this.host.world.entities[ids[0]],
            budget = { n: job.fragments, limit: profile.bodyLimit };
          // Assembly connectivity was resolved once; consume its falling clusters incrementally.
          const id = ids.pop()!;
          const part = this.host.world.entities[id];
          if (budget.n < budget.limit)
            this.host.fragment(part, job.p, profile.scatterMin, budget);
          else this.host.staticFragment(part, job.p, profile.scatterMin);
          if (ids.length) queue.push(ids);
          job.fragments = budget.n;
        } else if (job.cursor < job.assemblies.length) {
          this.host.dirtyAssemblies.clear();
          this.host.dirtyAssemblies.add(job.assemblies[job.cursor++]);
          this.host.resolveSupport(job.p, 14, 0, queue);
        } else {
          if (this.host.supportJobs.some((s) => s.ownerSeed === job.seed))
            break;
          this.host.pendingJobs.shift();
          this.host.bump();
          this.host.flush();
          continue;
        }
      }
      // Nuke support work is owned by its serialized job, not an incidental impact.
      this.host.dirtyAssemblies.clear();
    }
    this.host.flush();
    this.host.destructionMS = performance.now() - start;
  }
}
