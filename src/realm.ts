import { CONFIG } from "./config";
import type { Entity, PlaneState, Vec3, WorldData } from "./types";
import type { IslandBaseline } from "./world/generator.mjs";

export type Realm = "surface" | "hell";
export interface PortalSite { x: number; z: number; y: number; radius: number; ids: number[]; clearedTrees?: number[] }
const RADIUS = 45;

function height(heights: Float32Array, x: number, z: number): number {
  const grid = CONFIG.grid;
  const ix = Math.max(0, Math.min(grid - 2, Math.floor(x / CONFIG.spacing)));
  const iz = Math.max(0, Math.min(grid - 2, Math.floor(z / CONFIG.spacing)));
  return heights[iz * grid + ix];
}

/** Stable placement from the accepted baseline; no seed or generator revision changes. */
export function portalSite(baseline: IslandBaseline): PortalSite {
  const { world, heights } = baseline;
  const seed = world.seed >>> 0;
  let best: { x: number; z: number; y: number; score: number } | undefined;
  for (let i = 0; i < 96; i++) {
    const x = 1152 + (((Math.imul(seed ^ (i + 1), 2654435761) >>> 0) % 108) * 64);
    const z = 1152 + (((Math.imul(seed + i * 7919, 2246822519) >>> 0) % 108) * 64);
    const y = height(heights, x, z);
    if (y < 16) continue;
    const slope = Math.max(
      ...[[x + 55, z], [x - 55, z], [x, z + 55], [x, z - 55]].map(
        ([px, pz]) => Math.abs(height(heights, px, pz) - y),
      ),
    );
    const structure = world.entities.some(
      (e) => e.kind !== "tree" && Math.hypot(e.p[0] - x, e.p[2] - z) < 85 + Math.max(e.s[0], e.s[2]),
    );
    if (structure || slope > 18) continue;
    const spawnDistance = Math.hypot(world.spawn[0] - x, world.spawn[2] - z);
    const score = slope * 10 + Math.abs(spawnDistance - 2400) / 200;
    if (!best || score < best.score) best = { x, z, y, score };
  }
  if (!best) {
    const site = world.sites.find((s) => s.kind === "quarry") ?? world.sites[0];
    best = { x: site.p[0], z: site.p[2], y: height(heights, site.p[0], site.p[2]), score: 0 };
  }
  return { x: best.x, z: best.z, y: best.y, radius: RADIUS, ids: [] };
}

function addPortal(world: WorldData, site: PortalSite): void {
  // Keep entity indices stable for existing saves, but suppress trunks and any
  // canopy that could overhang the ring or its flight approach.
  site.clearedTrees = world.entities.filter((e) =>
    e.kind === "tree" && Math.hypot(e.p[0] - site.x, e.p[2] - site.z) <
      site.radius + 30 + Math.max(e.s[0], e.s[2]) * 1.9,
  ).map((e) => e.id);
  const start = world.entities.length;
  const segments = 12;
  for (let i = 0; i < segments; i++) {
    const angle = i * Math.PI * 2 / segments;
    const e: Entity = {
      id: start + i,
      kind: "block",
      p: [site.x + Math.cos(angle) * (RADIUS + 10), site.y + 4, site.z + Math.sin(angle) * (RADIUS + 10)],
      s: [9, 4, 9], material: "stone", assembly: "portal-ring", foundation: true,
      supports: [], variant: i,
    };
    world.entities.push(e);
    site.ids.push(e.id);
  }
  world.portal = site;
}

export function realmBaseline(baseline: IslandBaseline, realm: Realm): IslandBaseline {
  const world = structuredClone(baseline.world) as WorldData;
  const site = portalSite(baseline);
  world.realm = realm;
  if (realm === "hell") {
    world.civilians = [];
    world.lights = world.lights.map((light) => ({ ...light }));
    for (const e of world.entities) {
      if (!e.visual) continue;
      // Preserve fracture owners while turning the god into a dark aircraft effigy.
      e.visual.color = e.visual.role === "eye" ? "#ff5a19" : "#3f424b";
      if (e.visual.shape === "pineapple") e.visual.shape = "ellipsoid";
      if (e.visual.shape === "leaf") e.visual.shape = "diamond";
    }
  }
  addPortal(world, site);
  return { world, heights: baseline.heights };
}

export function portalIntact(world: WorldData, removed: ReadonlySet<number>): boolean {
  return !!world.portal && world.portal.ids.every((id) => !removed.has(id));
}

export function arrivalPlane(plane: PlaneState, site: PortalSite): PlaneState {
  // A half turn around the horizontal X axis maps descent to emergence below a ceiling.
  // Local simulations stay Y-up; the rendered hell view is inverted instead.
  const p: Vec3 = [site.x, site.y + 72, site.z];
  return {
    ...plane, p, v: [plane.v[0], -plane.v[1], -plane.v[2]],
    yaw: Math.PI - plane.yaw, pitch: -plane.pitch, roll: -plane.roll,
    crashed: 0, falling: false, boundary: false,
  };
}
