import type { Vec3, WorldData } from "../types";

export const GOLD_COUNT = 40;
export const GOLD_SPACING = 250;
/** Fly or drive within this distance (m) of a golden pineapple to collect it. */
export const GOLD_PICKUP_RADIUS = 30;

/** Small deterministic generator, seeded per island. */
export function seeded(seed: number) {
  let n = seed >>> 0 || 1;
  return () => {
    n = (n + 0x6d2b79f5) >>> 0;
    let t = Math.imul(n ^ (n >>> 15), 1 | n);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Golden pineapple positions for an island, from its landmarks only, so the
 * same seed always places them identically. Abyss islands have none.
 */
export function goldenPineapples(world: WorldData): Vec3[] {
  if (world.realm === "hell") return [];
  const fixed: Vec3[] = [];
  const candidates: Vec3[] = [];
  const god = world.sites.find((s) => s.kind === "pineapple-god");
  if (god) {
    let crown: Vec3 | undefined;
    for (const e of world.entities)
      if (god.assemblies.includes(e.assembly)) {
        const y = e.p[1] + e.s[1];
        if (!crown || y > crown[1]) crown = [e.p[0], y, e.p[2]];
      }
    if (crown) fixed.push([crown[0], crown[1] + 40, crown[2]]);
  }
  for (const s of world.sites)
    if (s.kind !== "pineapple-god") candidates.push([s.p[0], s.p[1] + 45, s.p[2]]);
  for (const c of world.castles ?? [])
    for (const t of c.landmarks.towers) candidates.push([t[0], t[1] + 75, t[2]]);
  for (const f of world.waterfalls ?? [])
    candidates.push([
      (f.top[0] + f.bottom[0]) / 2,
      (f.top[1] + f.bottom[1]) / 2 + 6,
      (f.top[2] + f.bottom[2]) / 2,
    ]);
  for (const l of world.lakes ?? [])
    candidates.push([l.center[0], l.level + 12, l.center[1]]);
  for (const r of world.rivers ?? [])
    for (let i = 12; i < r.points.length; i += 25) {
      const p = r.points[i];
      candidates.push([p[0], p[1] + 10, p[2]]);
    }
  const random = seeded(world.seed * 7919 + 17);
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  const chosen = [...fixed];
  for (const c of candidates) {
    if (chosen.length >= GOLD_COUNT) break;
    if (
      c.every(Number.isFinite) &&
      chosen.every(
        (p) => Math.hypot(p[0] - c[0], p[2] - c[2]) >= GOLD_SPACING,
      )
    )
      chosen.push(c);
  }
  return chosen;
}
