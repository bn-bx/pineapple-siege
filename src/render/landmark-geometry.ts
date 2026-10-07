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
  center: Entity["p"];
  axis: Entity["p"];
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
      center,
      axis,
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
