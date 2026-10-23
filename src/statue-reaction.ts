import manifest from "./world/approved-god-manifest.json" with { type: "json" };
import type { Entity, StatueReaction, StatueRole, WorldData } from "./types";

/** Old PS4 baselines have the same authored anchors but no semantic role tags. */
export function statueRole(
  e: Entity,
  world: WorldData,
): StatueRole | undefined {
  if (!e.visual) return;
  if (e.visual.role) return e.visual.role;
  if (e.visual.sculptOwner !== undefined) {
    const owner = manifest.owners.find(
      (o) => o.ordinal === e.visual!.sculptOwner,
    );
    if (owner) return owner.role as StatueRole;
  }
  const site = world.sites?.find(
    (s) => s.kind === "pineapple-god" && s.assemblies.includes(e.assembly),
  );
  if (!site) return;
  const yaw = site.yaw ?? 0;
  const dx = e.p[0] + e.visual.offset[0] - site.p[0],
    dz = e.p[2] + e.visual.offset[2] - site.p[2];
  const x = Math.cos(yaw) * dx - Math.sin(yaw) * dz,
    z = Math.sin(yaw) * dx + Math.cos(yaw) * dz;
  const y = e.p[1] + e.visual.offset[1] - site.p[1];
  const near = (a: number, b: number) => Math.abs(a - b) < 0.1;
  if (
    e.visual.shape === "rock" ||
    (e.visual.shape === "ellipsoid" && Math.hypot(x, z) > 400)
  )
    return "rock";
  if (z >= 300 && Math.abs(x) < 181) return "stairs";
  if (e.visual.shape !== "box") return "figure";
  if (near(Math.abs(x), 42) && near(y, 795) && (near(z, 104) || near(z, 82)))
    return "eye";
  if (
    (near(x, -290) && near(z, 165)) ||
    (near(y, 270) && near(z, 192)) ||
    (near(y, 544) && near(z, 150)) ||
    (near(y, 728) && (near(z, 101) || near(z, 83)))
  )
    return "figure";
  return "throne";
}
export function restoreStatueReaction(value?: StatueReaction): StatueReaction {
  return {
    eyeGlowRemaining: Math.max(0, Math.min(10, value?.eyeGlowRemaining ?? 0)),
    enraged: value?.enraged === true,
  };
}
export function validStatueReaction(value: unknown) {
  if (value === undefined) return true;
  if (!value || typeof value !== "object") return false;
  const v = value as StatueReaction;
  return (
    typeof v.enraged === "boolean" &&
    Number.isFinite(v.eyeGlowRemaining) &&
    v.eyeGlowRemaining >= 0 &&
    v.eyeGlowRemaining <= 10
  );
}
