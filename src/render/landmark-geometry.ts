import * as THREE from "three";
import type { Entity, WorldData } from "../types";

export function isLoggingCampLog(
  entity: Pick<Entity, "kind" | "material" | "assembly">,
) {
  return (
    entity.kind === "block" &&
    entity.material === "wood" &&
    /-stack-\d+$/.test(entity.assembly)
  );
}

/** Frame a logging-camp stack so its round timbers and side chocks read together. */
export function loggingCampReviewCamera(owner: Entity, distance: number) {
  const target: Entity["p"] = [owner.p[0], owner.p[1] - 0.28, owner.p[2]];
  return {
    eye: [
      // The generated shed is on the +X side of the stack; look out into the
      // clearing so its wall cannot occlude this close review.
      target[0] - distance * 0.72,
      target[1] + distance * 0.2,
      target[2] + distance * 0.68,
    ] as Entity["p"],
    target,
  };
}

/** Narrow vertical members in generated harbor docks are driven timber piles. */
export function isHarborDockPile(
  entity: Pick<Entity, "kind" | "material" | "assembly" | "s">,
) {
  return (
    entity.kind === "block" &&
    entity.material === "wood" &&
    /harbor-\d+-dock$/.test(entity.assembly) &&
    entity.s[0] <= 0.8 &&
    entity.s[2] <= 0.8 &&
    entity.s[1] >= 0.7
  );
}

/** Slightly tapered, driven piles replace square dock supports in presentation. */
export function harborDockPileGeometry() {
  const geometry = new THREE.CylinderGeometry(0.92, 0.62, 2, 10, 1, false);
  geometry.computeBoundingBox();
  return geometry;
}

/** Stable owner for the quarry hoist: the middle upper scaffold crossbeam. */
export function quarryHoistOwner(parts: readonly Entity[]) {
  const beams = parts
    .filter(
      (part) =>
        part.kind === "block" &&
        part.material === "wood" &&
        part.s[0] >= 5 &&
        part.s[1] <= 1.2 &&
        part.s[2] >= 2,
    )
    .slice()
    .sort((a, b) => a.p[0] - b.p[0]);
  return beams[Math.floor(beams.length / 2)];
}

/** Frame the quarry's raised hoist above the cut without the foreground spoil pile. */
export function quarryHoistReviewCamera(owner: Entity, distance: number) {
  const target: Entity["p"] = [
    owner.p[0],
    owner.p[1] - 6.3,
    owner.p[2] + owner.s[2] * 0.38,
  ];
  return {
    eye: [
      // Stand high and beyond the scaffold's front edge, aiming beneath its
      // outer rail so the frame does not cover the hanging payload.
      target[0] + distance * 0.1,
      target[1] + distance,
      target[2] + distance * 1.4,
    ] as Entity["p"],
    target,
  };
}

/** Frame the isolated freight staging beside a generated warehouse. */
export function warehouseCargoReviewCamera(
  center: Entity["p"],
  buildingCenter: Entity["p"],
  distance: number,
) {
  const target: Entity["p"] = [center[0], center[1] + 0.35, center[2]],
    dx = target[0] - buildingCenter[0],
    dz = target[2] - buildingCenter[2],
    length = Math.hypot(dx, dz) || 1;
  return {
    eye: [
      target[0] + (dx / length) * distance * 1.25,
      target[1] + distance * 0.85,
      target[2] + (dz / length) * distance * 1.25,
    ] as Entity["p"],
    target,
  };
}

/** Pick dry, level, unobstructed room beside the warehouse for freight. */
export function warehouseStagingSpot(
  base: Entity["p"],
  assembly: string,
  entities: readonly Entity[],
  sample: (x: number, z: number) => number,
  isWet: (x: number, z: number) => boolean,
  roadDistance: (x: number, z: number) => number,
) {
  const members = entities.filter((entity) => entity.assembly === assembly);
  if (!members.length) return undefined;
  const minX = Math.min(...members.map((entity) => entity.p[0] - entity.s[0])),
    maxX = Math.max(...members.map((entity) => entity.p[0] + entity.s[0])),
    minZ = Math.min(...members.map((entity) => entity.p[2] - entity.s[2])),
    maxZ = Math.max(...members.map((entity) => entity.p[2] + entity.s[2])),
    centerX = (minX + maxX) / 2,
    outside = 3.25,
    endOffsets = [-8, 0, 8],
    offsets: [number, number][] = [
      [maxX - base[0] + outside, 0],
      [maxX - base[0] + outside, 8],
      [maxX - base[0] + outside, -8],
      [centerX - base[0] - 8, minZ - base[2] - outside],
      [centerX - base[0], minZ - base[2] - outside],
      [centerX - base[0] + 8, minZ - base[2] - outside],
      [centerX - base[0] - 8, maxZ - base[2] + outside],
      [centerX - base[0], maxZ - base[2] + outside],
      [centerX - base[0] + 8, maxZ - base[2] + outside],
      ...endOffsets.flatMap((dz) => [
        [minX - base[0] - outside, dz],
        [maxX - base[0] + outside, dz],
      ] as [number, number][]),
    ],
    candidates = offsets
      .map(([dx, dz]) => {
        const x = base[0] + dx,
          z = base[2] + dz,
          y = sample(x, z),
          obstructed = entities.some(
            (entity) =>
              entity.kind === "block" &&
              entity.assembly !== assembly &&
              Math.abs(x - entity.p[0]) < entity.s[0] + 2.9 &&
              Math.abs(z - entity.p[2]) < entity.s[2] + 2.9,
          );
        return { x, y, z, obstructed };
      })
      .filter(
        (candidate) =>
          candidate.y >= 2 &&
          !candidate.obstructed &&
          !isWet(candidate.x, candidate.z) &&
          Math.abs(candidate.y - sample(candidate.x + 2, candidate.z)) <= 0.8,
      );
  const spot =
    candidates.find(
      (candidate) => roadDistance(candidate.x, candidate.z) >= 6,
    ) ??
    candidates[0];
  return spot
    ? ([spot.x, spot.y, spot.z] as Entity["p"])
    : undefined;
}

/** Frame the owner-bound signal brazier on a watchtower roof. */
export function watchtowerBeaconReviewCamera(owner: Entity, distance: number) {
  const target: Entity["p"] = [
    owner.p[0],
    owner.p[1] + owner.s[1] + 1.5,
    owner.p[2],
  ];
  return {
    eye: [
      target[0] + distance * 0.72,
      target[1] + distance * 0.55,
      target[2] + distance * 0.72,
    ] as Entity["p"],
    target,
  };
}

/** Aim the isolated harbor review down a dock so its driven supports stay visible. */
export function harborDockReviewCamera(decks: readonly Pick<Entity, "p">[]) {
  if (decks.length < 2) return undefined;
  const rangeX =
      Math.max(...decks.map((deck) => deck.p[0])) -
      Math.min(...decks.map((deck) => deck.p[0])),
    rangeZ =
      Math.max(...decks.map((deck) => deck.p[2])) -
      Math.min(...decks.map((deck) => deck.p[2])),
    axis: 0 | 2 = rangeX >= rangeZ ? 0 : 2,
    direction = Math.sign(decks.at(-1)!.p[axis] - decks[0].p[axis]) || 1,
    center = decks[Math.floor((decks.length - 1) * 0.68)],
    dx = axis === 0 ? direction : 0,
    dz = axis === 2 ? direction : 0,
    sideX = axis === 0 ? 0 : 1,
    sideZ = axis === 2 ? 0 : 1;
  return {
    eye: [
      center.p[0] + dx * 22 + sideX * 10,
      center.p[1] + 7,
      center.p[2] + dz * 22 + sideZ * 10,
    ] as Entity["p"],
    target: [center.p[0], center.p[1] - 1.5, center.p[2]] as Entity["p"],
  };
}

/** Raise and reduce the lighthouse cap in presentation only, uncovering the lantern room. */
export function lighthouseRoofPresentation(
  entity: Pick<Entity, "assembly" | "material" | "p" | "s">,
) {
  if (!entity.assembly.startsWith("lighthouse-") || entity.material !== "roof")
    return undefined;
  return {
    p: [entity.p[0], entity.p[1] + 3.5, entity.p[2]] as Entity["p"],
    s: [5.2, 1.5, 5.2] as Entity["s"],
  };
}

/** Large square window block used as the lighthouse's lantern-room glazing. */
export function isLighthouseLanternGlazing(
  entity: Pick<Entity, "assembly" | "kind" | "material" | "s">,
) {
  return (
    entity.assembly.startsWith("lighthouse-") &&
    entity.kind === "block" &&
    entity.material === "window" &&
    entity.s[0] >= 3.5 &&
    entity.s[2] >= 3.5 &&
    entity.s[0] > entity.s[1] &&
    entity.s[2] > entity.s[1]
  );
}

/** Tall, narrow wooden bridge blocks are parapet owners, rendered as joinery. */
export function isBridgeRailingPart(
  entity: Pick<Entity, "assembly" | "kind" | "material" | "s">,
  bridgeAssemblies: ReadonlySet<string>,
) {
  return (
    entity.kind === "block" &&
    entity.material === "wood" &&
    bridgeAssemblies.has(entity.assembly) &&
    Math.abs(entity.s[1] - 1) < 0.05 &&
    ((entity.s[2] < 0.8 && entity.s[0] > 2.5) ||
      (entity.s[0] < 0.8 && entity.s[2] > 2.5))
  );
}

/** Thin rendered bridge decking while keeping its original top plane aligned. */
export function bridgeDeckPresentation(
  entity: Pick<Entity, "assembly" | "kind" | "material" | "p" | "s">,
  bridgeAssemblies: ReadonlySet<string>,
) {
  if (
    entity.kind !== "block" ||
    entity.material !== "wood" ||
    !bridgeAssemblies.has(entity.assembly) ||
    Math.abs(entity.s[1] - 1) > 0.05 ||
    entity.s[0] <= 2.5 ||
    entity.s[2] <= 2.5
  )
    return undefined;
  const halfHeight = 0.38;
  return {
    p: [entity.p[0], entity.p[1] + entity.s[1] - halfHeight, entity.p[2]] as Entity["p"],
    s: [entity.s[0], halfHeight, entity.s[2]] as Entity["s"],
  };
}

/** Find level, dry bank anchors for presentation-only stone bridge abutments. */
export function bridgeAbutmentPlacements(
  decks: readonly Entity[],
  sample: (x: number, z: number) => number,
  waterLevel: number,
) {
  if (!decks.length) return [];
  const ordered = decks.slice(),
    runsAlongX = ordered[0].s[0] < ordered[0].s[2],
    alongAxis = runsAlongX ? 0 : 2,
    crossAxis = runsAlongX ? 2 : 0;
  ordered.sort((a, b) => a.p[alongAxis] - b.p[alongAxis]);
  const ends = [ordered[0], ordered.at(-1)!],
    placements: { owner: Entity; p: Entity["p"]; s: Entity["s"] }[] = [];
  for (const [endIndex, deck] of ends.entries()) {
    const side = endIndex === 0 ? -1 : 1,
      top = deck.p[1] + deck.s[1] - 0.76,
      crossHalf = deck.s[crossAxis] * 0.82;
    for (let offset = 0.8; offset <= 9.2; offset += 1.4) {
      const p: Entity["p"] = [...deck.p];
      p[alongAxis] += side * (deck.s[alongAxis] + offset);
      const ground = sample(p[0], p[2]),
        crossLow: Entity["p"] = [...p],
        crossHigh: Entity["p"] = [...p];
      crossLow[crossAxis] -= crossHalf;
      crossHigh[crossAxis] += crossHalf;
      const crossSlope =
        Math.max(ground, sample(crossLow[0], crossLow[2]), sample(crossHigh[0], crossHigh[2])) -
        Math.min(ground, sample(crossLow[0], crossLow[2]), sample(crossHigh[0], crossHigh[2])),
        height = top - ground;
      if (
        ground < waterLevel + 0.25 ||
        height < 1.5 ||
        height > 8.5 ||
        crossSlope > 2.5
      )
        continue;
      p[1] = (ground + top) / 2;
      const s: Entity["s"] = [1.2, height / 2, 1.2];
      s[crossAxis] = deck.s[crossAxis] + 0.7;
      placements.push({ owner: deck, p, s });
      break;
    }
  }
  return placements;
}

/** Horizontal sawn timber; entity scale and destruction ownership are unchanged. */
export function loggingCampLogGeometry() {
  const geometry = new THREE.CylinderGeometry(1, 1, 2, 12, 1, false);
  geometry.rotateZ(Math.PI / 2);
  geometry.computeBoundingBox();
  return geometry;
}

export interface WindmillRotor {
  center: Entity["p"];
  hubOwner: number;
  hubCapCenter: Entity["p"];
  blades: Entity[];
  phase: number;
  speed: number;
}

/** Find the four replaceable sail bars from their stable generated layout. */
export function windmillRotors(
  world: Pick<WorldData, "entities" | "sites">,
): WindmillRotor[] {
  const byAssembly = new Map<string, Entity[]>();
  for (const entity of world.entities) {
    const parts = byAssembly.get(entity.assembly);
    if (parts) parts.push(entity);
    else byAssembly.set(entity.assembly, [entity]);
  }
  const rotors: WindmillRotor[] = [];
  for (const site of world.sites) {
    if (site.kind !== "windmill") continue;
    const parts = byAssembly.get(site.id) ?? [];
    const hub = parts.find(
      (part) =>
        part.kind === "block" &&
        part.material === "wood" &&
        Math.abs(part.p[0] - site.p[0]) < 0.1 &&
        Math.abs(part.p[2] - site.p[2] + 6) < 0.1 &&
        Math.abs(part.s[0] - 1.8) < 0.1,
    );
    if (!hub) continue;
    const blades = parts
      .filter(
        (part) =>
          part.kind === "block" &&
          part.material === "wood" &&
          Math.abs(part.p[2] - hub.p[2] + 1) < 0.1 &&
          Math.abs(part.p[0] - hub.p[0]) < 10 &&
          Math.abs(part.p[1] - hub.p[1]) < 10 &&
          part.s[2] < 0.75 &&
          ((part.s[0] >= 7.5 && part.s[1] <= 1.8) ||
            (part.s[1] >= 7.5 && part.s[0] <= 1.8)),
      )
      .sort(
        (a, b) =>
          Math.atan2(a.p[1] - hub.p[1], a.p[0] - hub.p[0]) -
          Math.atan2(b.p[1] - hub.p[1], b.p[0] - hub.p[0]),
      );
    // Leave unexpected or older layouts untouched rather than hiding pieces.
    if (blades.length !== 4) continue;
    const hash = [...site.id].reduce(
      (value, char) => (value * 31 + char.charCodeAt(0)) >>> 0,
      0,
    );
    rotors.push({
      center: [hub.p[0], hub.p[1], hub.p[2] - 1],
      hubOwner: hub.id,
      hubCapCenter: [
        hub.p[0],
        hub.p[1],
        hub.p[2] - hub.s[2] - 0.275,
      ],
      blades,
      phase: (hash % 628) / 100,
      speed: 0.2 + (hash % 9) * 0.012,
    });
  }
  return rotors;
}

export function windmillRotorBladeIds(
  world: Pick<WorldData, "entities" | "sites">,
) {
  return new Set(
    windmillRotors(world).flatMap((rotor) =>
      rotor.blades.map((blade) => blade.id),
    ),
  );
}

export interface WaterwheelRotor {
  siteId: string;
  center: Entity["p"];
  axis: Entity["p"];
  hubOwner: number;
  hubCapCenter: Entity["p"];
  paddles: Entity[];
  spokes: Entity[];
  phase: number;
  speed: number;
}

export function waterwheelRotors(
  world: Pick<WorldData, "entities" | "sites">,
): WaterwheelRotor[] {
  const byAssembly = new Map<string, Entity[]>();
  for (const entity of world.entities) {
    const parts = byAssembly.get(entity.assembly);
    if (parts) parts.push(entity);
    else byAssembly.set(entity.assembly, [entity]);
  }
  const rotors: WaterwheelRotor[] = [];
  for (const site of world.sites) {
    if (site.kind !== "watermill") continue;
    const parts = byAssembly.get(`${site.id}-mill`) ?? [];
    const paddles = parts.filter(
      (part) =>
        part.kind === "block" &&
        part.material === "wood" &&
        part.s.every((extent) => Math.abs(extent - 1.6) < 0.01),
    );
    if (paddles.length !== 16) continue;
    const center: Entity["p"] = [0, 0, 0];
    for (const paddle of paddles)
      for (let axis = 0; axis < 3; axis++)
        center[axis] += paddle.p[axis] / paddles.length;
    const spokes = parts.filter(
      (part) =>
        !paddles.includes(part) &&
        part.kind === "block" &&
        part.material === "wood" &&
        Math.abs(part.p[0] - center[0]) < 0.1 &&
        Math.abs(part.p[1] - center[1]) < 0.1 &&
        Math.abs(part.p[2] - center[2]) < 0.1 &&
        Math.max(...part.s) >= 6.5 &&
        Math.min(...part.s) < 0.8 &&
        part.s.filter((extent) => extent < 1.1).length >= 2,
    );
    const hub = parts.find(
      (part) =>
        !paddles.includes(part) &&
        !spokes.includes(part) &&
        part.kind === "block" &&
        part.material === "wood" &&
        Math.max(...part.s) >= 3.9 &&
        Math.max(...part.s) <= 4.1 &&
        part.s.filter((extent) => extent < 1.1).length >= 2 &&
        Math.max(...part.s.filter((extent) => extent < 1.1)) < 1.1 &&
        Math.hypot(
          part.p[0] - center[0],
          part.p[1] - center[1],
          part.p[2] - center[2],
        ) >= 2.5 &&
        Math.hypot(
          part.p[0] - center[0],
          part.p[1] - center[1],
          part.p[2] - center[2],
        ) <= 3.5,
    );
    if (spokes.length !== 2 || !hub) continue;
    const delta: Entity["p"] = [
      center[0] - hub.p[0],
      center[1] - hub.p[1],
      center[2] - hub.p[2],
    ];
    const length = Math.hypot(...delta);
    if (length < 2.5 || length > 3.5) continue;
    const axis: Entity["p"] = delta.map(
      (value) => value / length,
    ) as Entity["p"];
    const hash = [...site.id].reduce(
      (value, char) => (value * 31 + char.charCodeAt(0)) >>> 0,
      0,
    );
    rotors.push({
      siteId: site.id,
      center,
      axis,
      hubOwner: hub.id,
      hubCapCenter: [
        hub.p[0] + axis[0] * (hub.s[0] + 0.275),
        hub.p[1] + axis[1] * (hub.s[1] + 0.275),
        hub.p[2] + axis[2] * (hub.s[2] + 0.275),
      ],
      paddles,
      spokes,
      phase: (hash % 628) / 100,
      speed: 0.16 + (hash % 7) * 0.01,
    });
  }
  return rotors;
}

export function waterwheelPartIds(
  world: Pick<WorldData, "entities" | "sites">,
) {
  return new Set(
    waterwheelRotors(world).flatMap((rotor) => [
      ...rotor.paddles.map((part) => part.id),
      ...rotor.spokes.map((part) => part.id),
    ]),
  );
}
