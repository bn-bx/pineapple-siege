import { applyApprovedGod } from "./world/approved-god.mjs";
import { refineGod, reconnectGod } from "./world/refine-god.mjs";
import { statueShape, rotateStatuePoint } from "./world/statue-shapes.mjs";
import { CONFIG } from "./config";
import type { Entity, PlaneState, Vec3, WorldData } from "./types";
import { sampleHeight, type IslandBaseline } from "./world/generator.mjs";

export type Realm = "surface" | "hell";
export interface PortalSite { x: number; z: number; y: number; radius: number; ids: number[]; clearedTrees?: number[] }
const RADIUS = 54;

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
      ...[[x + RADIUS + 10, z], [x - RADIUS - 10, z], [x, z + RADIUS + 10], [x, z - RADIUS - 10]].map(
        ([px, pz]) => Math.abs(height(heights, px, pz) - y),
      ),
    );
    const structure = world.entities.some(
      (e) => e.kind !== "tree" && Math.hypot(e.p[0] - x, e.p[2] - z) < RADIUS + 40 + Math.max(e.s[0], e.s[2]),
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
  // Cover every terrain vertex under the entire stone surround, not just four
  // slope probes. The aperture must never be intersected by a grassy wedge.
  let top = best.y;
  const extent = RADIUS + 24;
  for (let dz = -extent; dz <= extent; dz += CONFIG.spacing)
    for (let dx = -extent; dx <= extent; dx += CONFIG.spacing)
      if (Math.hypot(dx,dz) <= extent) top = Math.max(top,height(heights,best.x+dx,best.z+dz));
  return { x: best.x, z: best.z, y: top + 1, radius: RADIUS, ids: [] };
}

function addPortal(world: WorldData, site: PortalSite, heights: Float32Array): void {
  // Keep entity indices stable for existing saves, but suppress trunks and any
  // canopy that could overhang the ring or its flight approach.
  site.clearedTrees = world.entities.filter((e) =>
    e.kind === "tree" && Math.hypot(e.p[0] - site.x, e.p[2] - site.z) <
      site.radius + 30 + Math.max(e.s[0], e.s[2]) * 1.9,
  ).map((e) => e.id);
  const start = world.entities.length;
  const segments = 12;
  let bottom = site.y - 4;
  for (let i=0;i<48;i++) {
    const a=i*Math.PI/24;
    bottom=Math.min(bottom,height(heights,site.x+Math.cos(a)*64,site.z+Math.sin(a)*64)-2);
  }
  const top = site.y + 7, centerY = (bottom + top) / 2;
  for (let i = 0; i < segments; i++) {
    const angle = i * Math.PI * 2 / segments;
    const size: Vec3 = [site.radius + 20, (top - bottom) / 2, site.radius + 20];
    const rotation: Vec3 = [0, -angle, 0];
    const vertices = statueShape("portal-stone");
    const min = [Infinity, Infinity, Infinity], max = [-Infinity,-Infinity,-Infinity];
    for (let j=0;j<vertices.length;j+=3) {
      const p = rotateStatuePoint(vertices.slice(j,j+3).map((n,k)=>n*size[k]), rotation);
      for(let k=0;k<3;k++){min[k]=Math.min(min[k],p[k]);max[k]=Math.max(max[k],p[k]);}
    }
    const center=min.map((n,k)=>(n+max[k])/2);
    const e: Entity = {
      id: start + i, kind: "block",
      p: [site.x+center[0],centerY+center[1],site.z+center[2]],
      s: min.map((n,k)=>(max[k]-n)/2) as Vec3,
      material: "stone", assembly: "portal-ring", foundation: true,
      supports: [], variant: i,
      visual: { shape: "portal-stone", band: 0, azimuth: 0, size, rotation,
        offset: center.map(n=>-n) as Vec3, color: world.realm === "hell" ? "#453a37" : "#596269" },
    };
    world.entities.push(e);
    site.ids.push(e.id);
  }
  world.portal = site;
}

export function realmBaseline(baseline: IslandBaseline, realm: Realm): IslandBaseline {
  const world = structuredClone(baseline.world) as WorldData;
  const site = portalSite(baseline);
  const god = world.sites.find(s=>s.kind === "pineapple-god");
  if (god) {
    const parts = world.entities.filter(e=>e.assembly === god.id);
    if (refineGod(god,parts)) reconnectGod(parts);
    applyApprovedGod(god,parts,(x,z)=>sampleHeight(baseline.heights,x,z));
  }
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
  addPortal(world, site, baseline.heights);
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
