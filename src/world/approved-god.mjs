import manifest from "./approved-god-manifest.json" with { type: "json" };
import { connectParts } from "./support-graph.mjs";
/** Upgrade complete cached monuments in place. Owner IDs and save format stay stable. */
export function applyApprovedGod(site, parts, sample) {
  if (
    parts.length !== 829 ||
    parts[0]?.visual?.sculptRevision === manifest.revision
  )
    return false;
  const c = Math.cos(site.yaw),
    s = Math.sin(site.yaw);
  for (const owner of manifest.owners) {
    const e = parts[owner.ordinal],
      min = [Infinity, Infinity, Infinity],
      max = [-Infinity, -Infinity, -Infinity];
    for (let mask = 0; mask < 8; mask++) {
      const p = owner.min.map((v, k) => (mask & (1 << k) ? owner.max[k] : v));
      const q = [
        c * p[0] + s * p[2] + site.p[0],
        p[1] + site.p[1],
        -s * p[0] + c * p[2] + site.p[2],
      ];
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], q[k]);
        max[k] = Math.max(max[k], q[k]);
      }
    }
    // Foundation colliders extend into terrain; the visible approved mesh is untouched.
    if (e.foundation && sample)
      min[1] = Math.min(
        min[1],
        sample((min[0] + max[0]) / 2, (min[2] + max[2]) / 2) - 1,
      );
    e.p = min.map((v, k) => (v + max[k]) / 2);
    e.s = min.map((v, k) => Math.max(0.01, (max[k] - v) / 2));
    e.visual.role = owner.role;
    e.visual.sculptOwner = owner.ordinal;
    e.visual.sculptRevision = manifest.revision;
  }
  // Rebuild structural contacts from the approved surface bounds.
  connectParts(parts);
  return true;
}
