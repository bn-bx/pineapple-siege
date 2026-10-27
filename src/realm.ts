import { applyApprovedGod } from "./world/approved-god.mjs";
import { refineGod, reconnectGod } from "./world/refine-god.mjs";
import { connectParts } from "./world/support-graph.mjs";
import toilet from "./world/toilet-manifest.json" with { type: "json" };
import { CONFIG } from "./config";
import type { Entity, PlaneState, Vec3, WorldData } from "./types";
import { sampleHeight, type IslandBaseline } from "./world/generator.mjs";

export type Realm = "surface" | "hell";
export interface PortalSite {
  /** Seat-hole centre on the bowl's water plane. */
  x: number;
  z: number;
  y: number;
  radius: number;
  ids: number[];
  clearedTrees?: number[];
  yaw: number;
  /** Pedestal base centre: the toilet's model origin. */
  base: Vec3;
  /** Ceiling of the collision-free dive band above the seat. */
  top: number;
  exit: number;
  water: [number, number];
  /** The old stone ring's ids and anything under the toilet; removed at load. */
  retired: number[];
}
const RADIUS = toilet.hole.halfX;
/** The original stone ring's id count; those slots stay reserved for old saves. */
const RING_SEGMENTS = 12;

function height(heights: Float32Array, x: number, z: number): number {
  const grid = CONFIG.grid;
  const ix = Math.max(0, Math.min(grid - 2, Math.floor(x / CONFIG.spacing)));
  const iz = Math.max(0, Math.min(grid - 2, Math.floor(z / CONFIG.spacing)));
  return heights[iz * grid + ix];
}

/** Model-local metres to world, rotated about the pedestal centre. */
function toWorld(base: Vec3, yaw: number, x: number, y: number, z: number): Vec3 {
  const c = Math.cos(yaw),
    s = Math.sin(yaw);
  return [base[0] + c * x + s * z, base[1] + y, base[2] - s * x + c * z];
}

function toLocal(x: number, z: number, yaw: number, wx: number, wz: number) {
  const c = Math.cos(yaw),
    s = Math.sin(yaw),
    dx = wx - x,
    dz = wz - z;
  return [c * dx - s * dz, s * dx + c * dz];
}

/** Entities under the toilet, with a clearance margin around its footprint. */
function covered(
  entities: readonly Entity[],
  x: number,
  z: number,
  yaw: number,
  margin: number,
) {
  const { min, max } = toilet.bounds;
  return entities.filter((e) => {
    const r = Math.max(e.s[0], e.s[2]) + margin;
    if (Math.hypot(e.p[0] - x, e.p[2] - z) > 260 + r) return false;
    const [lx, lz] = toLocal(x, z, yaw, e.p[0], e.p[2]);
    return (
      lx > min[0] - r && lx < max[0] + r && lz > min[2] - r && lz < max[2] + r
    );
  });
}
const STRUCTURE_MARGIN = 10;

/** Turn and nudge the toilet off the anchor to clear buildings first, then
 * keep the pedestal level and hills out from under the bowl and tank. */
function toiletLayout(
  world: WorldData,
  heights: Float32Array,
  anchorX: number,
  anchorZ: number,
) {
  const { min, max } = toilet.bounds,
    pedestal = toilet.pedestal;
  const nearby = world.entities.filter(
    (e) =>
      e.kind === "block" &&
      Math.hypot(e.p[0] - anchorX, e.p[2] - anchorZ) < 500,
  );
  const offsets: [number, number][] = [[0, 0]];
  for (const distance of [40, 80])
    for (let i = 0; i < 8; i++)
      offsets.push([
        Math.cos((i * Math.PI) / 4) * distance,
        Math.sin((i * Math.PI) / 4) * distance,
      ]);
  let best:
    | { x: number; z: number; yaw: number; y: number; score: number }
    | undefined;
  for (const [dx, dz] of offsets)
    for (let i = 0; i < 16; i++) {
      const x = anchorX + dx,
        z = anchorZ + dz,
        yaw = (i * Math.PI) / 8;
      const blocked = covered(nearby, x, z, yaw, STRUCTURE_MARGIN).length;
      let y = Infinity,
        top = -Infinity;
      for (let lz = pedestal.min[1]; lz <= pedestal.max[1]; lz += 4)
        for (let lx = pedestal.min[0]; lx <= pedestal.max[0]; lx += 4) {
          const [wx, , wz] = toWorld([x, 0, z], yaw, lx, 0, lz);
          const h = height(heights, wx, wz);
          y = Math.min(y, h);
          top = Math.max(top, h);
        }
      // The bowl and tank undersides stay above about 50 m of the pedestal base.
      let intrusion = 0;
      for (let lz = min[2]; lz <= max[2]; lz += 8)
        for (let lx = min[0]; lx <= max[0]; lx += 8) {
          const [wx, , wz] = toWorld([x, 0, z], yaw, lx, 0, lz);
          intrusion += Math.max(0, height(heights, wx, wz) - y - 50);
        }
      const score =
        blocked * 1e6 +
        intrusion +
        Math.max(0, top - y - 12) * 1000 +
        Math.hypot(dx, dz);
      if (!best || score < best.score) best = { x, z, yaw, y, score };
    }
  return best!;
}

/** Stable placement from the accepted baseline; no seed or generator revision changes. */
export function portalSite(baseline: IslandBaseline): PortalSite {
  const { world, heights } = baseline;
  let anchor: [number, number];
  if (world.portalAnchor) {
    anchor = [world.portalAnchor[0], world.portalAnchor[2]];
  } else {
    const seed = world.seed >>> 0;
    let best: { x: number; z: number; score: number } | undefined;
    for (let i = 0; i < 96; i++) {
      const x =
        1152 + ((Math.imul(seed ^ (i + 1), 2654435761) >>> 0) % 108) * 64;
      const z =
        1152 + ((Math.imul(seed + i * 7919, 2246822519) >>> 0) % 108) * 64;
      const y = height(heights, x, z);
      if (y < 16) continue;
      const slope = Math.max(
        ...[
          [x + RADIUS + 10, z],
          [x - RADIUS - 10, z],
          [x, z + RADIUS + 10],
          [x, z - RADIUS - 10],
        ].map(([px, pz]) => Math.abs(height(heights, px, pz) - y)),
      );
      const structure = world.entities.some(
        (e) =>
          e.kind !== "tree" &&
          Math.hypot(e.p[0] - x, e.p[2] - z) <
            RADIUS + 40 + Math.max(e.s[0], e.s[2]),
      );
      if (structure || slope > 18) continue;
      const spawnDistance = Math.hypot(world.spawn[0] - x, world.spawn[2] - z);
      const score = slope * 10 + Math.abs(spawnDistance - 2400) / 200;
      if (!best || score < best.score) best = { x, z, score };
    }
    const site = world.sites.find((s) => s.kind === "quarry") ?? world.sites[0];
    anchor = best ? [best.x, best.z] : [site.p[0], site.p[2]];
  }
  const { x, z, yaw, y } = toiletLayout(world, heights, ...anchor),
    base: Vec3 = [x, y, z],
    hole = toWorld(base, yaw, toilet.hole.x, toilet.waterY, toilet.hole.z);
  return {
    x: hole[0],
    z: hole[2],
    y: hole[1],
    radius: RADIUS,
    ids: [],
    yaw,
    base,
    top: y + toilet.seatTop + 20,
    exit: y + toilet.seatTop + 40,
    water: toilet.waterHalf as [number, number],
    retired: [],
  };
}

function addPortal(
  world: WorldData,
  site: PortalSite,
  heights: Float32Array,
): void {
  // Keep entity indices stable for existing saves, but suppress trunks and any
  // canopy under the toilet or its flight approach.
  const [x, , z] = site.base,
    under = covered(world.entities, x, z, site.yaw, 30);
  site.clearedTrees = under.filter((e) => e.kind === "tree").map((e) => e.id);
  site.retired = under.filter((e) => e.kind === "rock").map((e) => e.id);
  // Rarely a building cannot be avoided; retire it whole rather than leave it floating.
  const blocks = covered(world.entities, x, z, site.yaw, STRUCTURE_MARGIN).filter(
      (e) => e.kind === "block",
    ),
    assemblies = new Set(blocks.map((e) => e.assembly).filter(Boolean));
  for (const e of world.entities)
    if (
      e.kind === "block" &&
      (assemblies.has(e.assembly) || (!e.assembly && blocks.includes(e)))
    )
      site.retired.push(e.id);
  // The stone ring's ids stay reserved and removed, so saves that broke it
  // never mark toilet pieces as destroyed.
  for (let i = 0; i < RING_SEGMENTS; i++) {
    const id = world.entities.length;
    world.entities.push({
      id,
      kind: "block",
      p: [x, site.base[1] - 50, z],
      s: [0.01, 0.01, 0.01],
      material: "stone",
      assembly: "portal-retired",
      foundation: false,
      supports: [],
      variant: i,
    });
    site.retired.push(id);
  }
  const parts: Entity[] = [];
  for (const owner of toilet.owners) {
    const min = [Infinity, Infinity, Infinity],
      max = [-Infinity, -Infinity, -Infinity];
    for (let mask = 0; mask < 8; mask++) {
      const q = toWorld(
        site.base,
        site.yaw,
        ...(owner.min.map((v, k) =>
          mask & (1 << k) ? owner.max[k] : v,
        ) as Vec3),
      );
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], q[k]);
        max[k] = Math.max(max[k], q[k]);
      }
    }
    // Foundation colliders extend into terrain; the visible mesh is untouched.
    const foundation = owner.min[1] < 1.5;
    if (foundation)
      min[1] = Math.min(
        min[1],
        height(heights, (min[0] + max[0]) / 2, (min[2] + max[2]) / 2) - 1,
      );
    const p = min.map((v, k) => (v + max[k]) / 2) as Vec3,
      s = min.map((v, k) => Math.max(0.01, (max[k] - v) / 2)) as Vec3;
    const e: Entity = {
      id: world.entities.length,
      kind: "block",
      p,
      s,
      material: "porcelain",
      assembly: "portal-toilet",
      foundation,
      supports: [],
      variant: owner.ordinal,
      visual: {
        shape: "box",
        band: 0,
        azimuth: 0,
        size: s,
        rotation: [0, 0, 0],
        offset: [0, 0, 0],
        color: world.realm === "hell" ? "#3a3230" : "#ece9e2",
        modelOwner: owner.ordinal,
      },
    };
    world.entities.push(e);
    parts.push(e);
    // Breaking the bowl or seat closes the opening; the tank, lid and handle do not.
    if (owner.role === "bowl" || owner.role === "seat") site.ids.push(e.id);
  }
  connectParts(parts);
  world.portal = site;
}

export function realmBaseline(
  baseline: IslandBaseline,
  realm: Realm,
): IslandBaseline {
  const world = structuredClone(baseline.world) as WorldData;
  const site = portalSite(baseline);
  const god = world.sites.find((s) => s.kind === "pineapple-god");
  if (god) {
    const parts = world.entities.filter((e) => e.assembly === god.id);
    if (refineGod(god, parts)) reconnectGod(parts);
    applyApprovedGod(god, parts, (x, z) =>
      sampleHeight(baseline.heights, x, z),
    );
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

export function portalIntact(
  world: WorldData,
  removed: ReadonlySet<number>,
): boolean {
  return !!world.portal && world.portal.ids.every((id) => !removed.has(id));
}

export function arrivalPlane(
  plane: PlaneState,
  site: NonNullable<WorldData["portal"]>,
): PlaneState {
  // A half turn around the horizontal X axis maps descent to emergence below a ceiling.
  // Local simulations stay Y-up; the rendered hell view is inverted instead.
  const p: Vec3 = [site.x, site.exit ?? site.y + 72, site.z];
  const v: Vec3 = [plane.v[0], -plane.v[1], -plane.v[2]];
  let yaw = Math.PI - plane.yaw;
  // Climb out over the bowl's front lip, never into the raised lid and tank.
  const front = [Math.sin(site.yaw ?? 0), Math.cos(site.yaw ?? 0)],
    heading = [Math.sin(yaw), Math.cos(yaw)],
    facing = heading[0] * front[0] + heading[1] * front[1];
  if (site.yaw !== undefined && facing < 0) {
    const along = v[0] * front[0] + v[2] * front[1];
    v[0] -= 2 * along * front[0];
    v[2] -= 2 * along * front[1];
    yaw = Math.atan2(
      heading[0] - 2 * facing * front[0],
      heading[1] - 2 * facing * front[1],
    );
  }
  return {
    ...plane,
    p,
    v,
    yaw,
    pitch: -plane.pitch,
    roll: -plane.roll,
    crashed: 0,
    falling: false,
    boundary: false,
  };
}
