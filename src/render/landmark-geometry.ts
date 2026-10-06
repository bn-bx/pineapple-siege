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
