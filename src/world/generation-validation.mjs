import { inlandWaterHeight, pointInLake } from "./water-geometry.mjs";
import { onMainland } from "./landscape.mjs";
const distanceTo = (a, b, x, z) => {
  const dx = b[0] - a[0],
    dz = b[2] - a[2],
    l = dx * dx + dz * dz,
    t = l
      ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[2]) * dz) / l))
      : 0;
  return {
    distance: Math.hypot(x - a[0] - dx * t, z - a[2] - dz * t),
    height: a[1] + (b[1] - a[1]) * t,
  };
};
export function auditGeography(world, sample, includeStructures = true) {
  const rivers = world.rivers ?? [],
    lakes = world.lakes ?? [],
    bridges = world.sites.filter(
      (s) => s.kind === "bridge" || s.kind === "crossing",
    );
  const bridgeAt = (x, z) =>
    bridges.find(
      (s) =>
        Math.abs(s.axis === 0 ? z - s.p[2] : x - s.p[0]) < 5.1 &&
        Math.abs(s.axis === 0 ? x - s.p[0] : z - s.p[2]) < s.span / 2 + 4,
    );
  let maxRoadGrade = 0,
    wetRoads = 0,
    unsafeFlight = 0,
    obstructedFlight = 0;
  for (const path of world.paths)
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1],
        b = path[i],
        length = Math.hypot(b[0] - a[0], b[1] - a[1]),
        n = Math.max(1, Math.ceil(length / 8));
      let previous;
      for (let j = 0; j <= n; j++) {
        const t = j / n,
          x = a[0] + (b[0] - a[0]) * t,
          z = a[1] + (b[1] - a[1]) * t,
          bridge = bridgeAt(x, z),
          height = bridge?.deck ?? sample(x, z);
        if (
          !bridge &&
          (height < 0 ||
            Number.isFinite(inlandWaterHeight(rivers, lakes, x, z)))
        )
          wetRoads++;
        // Deck end-courses form a normal one-meter step; grade the dry road itself.
        if (previous && !bridge && !previous.bridge && length > 0)
          maxRoadGrade = Math.max(
            maxRoadGrade,
            Math.abs(height - previous.height) / (length / n),
          );
        previous = { height, bridge };
      }
    }
  for (const corridor of world.flightCorridors ?? [])
    for (let i = 1; i < corridor.points.length; i++) {
      const a = corridor.points[i - 1],
        b = corridor.points[i],
        length = Math.hypot(b[0] - a[0], b[2] - a[2]),
        n = Math.max(1, Math.ceil(length / 16));
      for (let j = 0; j <= n; j++) {
        const t = j / n,
          x = a[0] + (b[0] - a[0]) * t,
          z = a[2] + (b[2] - a[2]) * t;
        if (sample(x, z) + corridor.clearance > a[1] + (b[1] - a[1]) * t + 0.1)
          unsafeFlight++;
      }
      if (includeStructures)
        for (const entity of world.entities ?? []) {
          if (entity.p[1] + entity.s[1] < Math.min(a[1], b[1]) - 20) continue;
          const radius =
            Math.hypot(entity.s[0], entity.s[2]) + corridor.width / 2;
          if (
            entity.p[0] < Math.min(a[0], b[0]) - radius ||
            entity.p[0] > Math.max(a[0], b[0]) + radius ||
            entity.p[2] < Math.min(a[2], b[2]) - radius ||
            entity.p[2] > Math.max(a[2], b[2]) + radius
          )
            continue;
          const nearest = distanceTo(a, b, entity.p[0], entity.p[2]);
          if (
            nearest.distance < radius &&
            entity.p[1] + entity.s[1] > nearest.height - 20
          )
            obstructedFlight++;
        }
    }
  return { maxRoadGrade, wetRoads, unsafeFlight, obstructedFlight };
}
export function validateWaterNetwork(world, sample) {
  for (const river of world.rivers ?? []) {
    if (!river.widths || river.widths.length !== river.points.length)
      throw Error("River widths are incomplete");
    for (let i = 0; i < river.points.length; i++) {
      const p = river.points[i],
        width = river.widths[i];
      if (
        !p.every(Number.isFinite) ||
        !Number.isFinite(width) ||
        width < 1 ||
        width > 32 ||
        (i > 0 &&
          (width < river.widths[i - 1] ||
            p[1] > river.points[i - 1][1] + 0.001))
      )
        throw Error("Invalid downhill river reach");
      if (sample(p[0], p[2]) >= p[1] + 0.01)
        throw Error("River surface is above its carved footprint");
    }
  }
  for (const lake of world.lakes ?? []) {
    if (
      !lake.outline ||
      lake.outline.length < 3 ||
      !Number.isFinite(lake.level) ||
      !lake.outlet?.every(Number.isFinite) ||
      Math.abs(lake.outlet[1] - lake.level) > 0.001 ||
      !pointInLake(lake, ...lake.center) ||
      sample(...lake.center) >= lake.level
    )
      throw Error("Invalid lake basin or outlet");
    if (!world.rivers.some((r) => r.id === lake.riverId))
      throw Error("Lake outlet has no river");
  }
}
export function validatePlayableGeography(world, sample) {
  const regions = world.regions,
    mainland = world.mainland;
  if (
    !regions ||
    !mainland ||
    regions.grid !== 577 ||
    regions.step !== 16 ||
    mainland.grid !== 577 ||
    mainland.step !== 16
  )
    throw Error("Regional fields are incomplete");
  for (const key of ["biome", "coast", "moisture", "exposure", "woodland"])
    if (regions[key]?.length !== regions.grid ** 2)
      throw Error("Regional field is truncated");
  if (mainland.cells?.length !== mainland.grid ** 2)
    throw Error("Mainland field is truncated");
  if (
    !world.portalAnchor ||
    !onMainland(mainland, world.portalAnchor[0], world.portalAnchor[2])
  )
    throw Error("Portal reservation is missing");
  if (
    (world.flightCorridors?.length ?? 0) < (world.generatorVersion >= 6 ? 5 : 7)
  )
    throw Error("Flight approaches are incomplete");
  for (const resident of world.civilians ?? [])
    if (
      !onMainland(mainland, resident.p[0], resident.p[2]) ||
      sample(resident.p[0], resident.p[2]) < 0 ||
      Number.isFinite(
        inlandWaterHeight(
          world.rivers,
          world.lakes,
          resident.p[0],
          resident.p[2],
        ),
      )
    )
      throw Error("Resident lacks dry mainland ground");
  validateWaterNetwork(world, sample);
  const metrics = auditGeography(world, sample);
  if (metrics.wetRoads)
    throw Error(
      "A road leaves its supported crossing: " + JSON.stringify(metrics),
    );
  if (metrics.maxRoadGrade > 0.65) throw Error("A graded road is too steep");
  if (metrics.unsafeFlight || metrics.obstructedFlight)
    throw Error(
      "A flight corridor lacks safe clearance: " + JSON.stringify(metrics),
    );
  return metrics;
}
