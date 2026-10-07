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
    owner.p[1] + owner.s[1] / 2 + 0.62,
    owner.p[2] + owner.s[2] * 0.38,
  ];
  return {
    eye: [
      target[0] + distance * 0.62,
      target[1] + distance * 0.3,
      target[2] + distance,
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
