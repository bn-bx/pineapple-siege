import type { VillageWindow } from "./village-lighting";
import { CONFIG } from "../config";
import * as THREE from "three";
import type { WorldData, Entity } from "../types";
import type { TerrainView } from "./terrain-view";
import { pathIndex } from "../world/generator.mjs";
import {
  bridgeDeckPresentation,
  isBridgeRailingPart,
  isLighthouseLanternGlazing,
  lighthouseRoofPresentation,
} from "./landmark-geometry";
import { visualGeometry } from "./visual-assets";

interface Piece {
  owner: number;
  offset: number;
  p: THREE.Vector3;
  matrix: THREE.Matrix4;
}
/** Presentation pieces have no independent saved identity or collision authority. */
export class Scenery {
  readonly group = new THREE.Group();
  private batches: {
    mesh: THREE.InstancedMesh;
    pieces: Piece[];
    cells: Map<string, Piece[]>;
    ground: boolean;
  }[] = [];
  private dummy = new THREE.Object3D();
  private next = -Infinity;
  private wind = { value: 0 };
  constructor(
    world: WorldData,
    private terrain: TerrainView,
    materials: Record<string, THREE.MeshStandardMaterial>,
    grass?: THREE.Texture,
    windowSources: readonly VillageWindow[] = [],
  ) {
    const lists = new Map<
      string,
      {
        material: THREE.Material;
        geometry: THREE.BufferGeometry;
        pieces: Piece[];
        ground: boolean;
      }
    >();
    const box = visualGeometry(
      "module_lod1",
      () => new THREE.BoxGeometry(2, 2, 2),
    );
    const rock = visualGeometry(
      "rock_lod1",
      () => new THREE.IcosahedronGeometry(1),
    );
    const clump = visualGeometry("grass-clump_lod0", () =>
      new THREE.PlaneGeometry(0.08, 0.6).translate(0, 0.3, 0),
    );
    const foliage = new THREE.MeshStandardMaterial({
      vertexColors: !!clump.getAttribute("color"),
      alphaTest: 0.45,
      side: THREE.DoubleSide,
      roughness: 1,
      color: "#6d7849",
    });
    const reedMaterial = foliage.clone();
    reedMaterial.color.set("#93885d");
    const cropMaterial = foliage.clone();
    // The authored leaf mesh has no vertex-color attribute. Keep the forest
    // grass's vertex-color variant for clumps and give crops their own tint.
    cropMaterial.vertexColors = false;
    cropMaterial.color.set("#567d36");
    cropMaterial.emissive.set("#101b08");
    cropMaterial.emissiveIntensity = 0.16;
    const understoryMaterial = foliage.clone();
    understoryMaterial.vertexColors = false;
    understoryMaterial.color.set("#607b49");
    const broadleafShrub = visualGeometry(
      "broadleaf_lod1",
      () => new THREE.IcosahedronGeometry(0.7, 1),
    );
    const riversideShrub = visualGeometry("riverside_lod1", () =>
      broadleafShrub.clone(),
    );
    const structuralTimber = materials.wood.clone();
    structuralTimber.color.multiplyScalar(0.52);
    structuralTimber.onBeforeCompile = materials.wood.onBeforeCompile;
    structuralTimber.customProgramCacheKey =
      materials.wood.customProgramCacheKey.bind(materials.wood);
    const iron = new THREE.MeshStandardMaterial({
      color: "#303333",
      metalness: 0.65,
      roughness: 0.75,
    });
    const lighthouseBrass = new THREE.MeshStandardMaterial({
      color: "#78643d",
      metalness: 0.72,
      roughness: 0.42,
    });
    const lighthouseLens = new THREE.MeshPhysicalMaterial({
      color: "#e4c88d",
      emissive: "#b87926",
      emissiveIntensity: 0.16,
      metalness: 0.08,
      roughness: 0.18,
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const lighthouseGlass = new THREE.MeshPhysicalMaterial({
      color: "#94acb0",
      metalness: 0.04,
      roughness: 0.12,
      transparent: true,
      opacity: 0.18,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    foliage.onBeforeCompile = (shader) => {
      shader.uniforms.grassWind = this.wind;
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          "#include <common>\nuniform float grassWind;",
        )
        .replace(
          "#include <begin_vertex>",
          "#include <begin_vertex>\ntransformed.x+=sin(grassWind*1.7+instanceMatrix[3].x*.3+instanceMatrix[3].z*.2)*.08*position.y*position.y;",
        );
    };
    foliage.customProgramCacheKey = () => "grass-wind-v1";
    reedMaterial.onBeforeCompile = foliage.onBeforeCompile;
    reedMaterial.customProgramCacheKey = () => "grass-wind-v1";
    const add = (
      key: string,
      owner: Entity,
      p: number[],
      scale: number[],
      material: THREE.Material,
      geometry = box,
      ground = false,
      yaw = 0,
      roll = 0,
    ) => {
      let list = lists.get(key);
      if (!list)
        lists.set(key, (list = { material, geometry, pieces: [], ground }));
      this.dummy.position.fromArray(p);
      this.dummy.scale.fromArray(scale);
      this.dummy.rotation.set(0, yaw, roll);
      this.dummy.updateMatrix();
      list.pieces.push({
        owner: owner.id,
        offset: ground ? p[1] - terrain.sample(p[0], p[2]) : 0,
        p: this.dummy.position.clone(),
        matrix: this.dummy.matrix.clone(),
      });
    };
    const arch = visualGeometry(
      "arch-trim_lod1",
      () => new THREE.RingGeometry(1, 1.18, 8, 1, 0, Math.PI),
    );
    const slitShape = new THREE.Shape();
    slitShape.moveTo(-0.24, -0.68);
    slitShape.lineTo(0.24, -0.68);
    slitShape.lineTo(0.24, 0.2);
    slitShape.quadraticCurveTo(0.24, 0.62, 0, 0.88);
    slitShape.quadraticCurveTo(-0.24, 0.62, -0.24, 0.2);
    slitShape.closePath();
    const arrowSlit = visualGeometry(
      "watchtower-arrow-slit_lod0",
      () => new THREE.ShapeGeometry(slitShape),
    );
    const slitMaterial = new THREE.MeshStandardMaterial({
      color: "#182022",
      roughness: 0.96,
    });
    const lighthouseLensGlass = visualGeometry(
      "lighthouse-fresnel-drum_lod0",
      () => new THREE.CylinderGeometry(1, 1, 2, 20, 1, true),
    );
    const lighthouseLensHoop = visualGeometry(
      "lighthouse-fresnel-hoop_lod0",
      () => new THREE.TorusGeometry(1, 0.055, 6, 20).rotateX(Math.PI / 2),
    );
    const lighthouseGlassPane = visualGeometry(
      "lighthouse-lantern-glass_lod0",
      () => new THREE.PlaneGeometry(2, 2),
    );
    const addBeam = (
      key: string,
      owner: Entity,
      from: THREE.Vector3,
      to: THREE.Vector3,
      thickness: number,
      material: THREE.Material,
      ground = false,
    ) => {
      const direction = to.clone().sub(from);
      add(
        key,
        owner,
        from.clone().add(to).multiplyScalar(0.5).toArray(),
        [thickness, direction.length() / 2, thickness],
        material,
        box,
        ground,
      );
      const piece = lists.get(key)!.pieces.at(-1)!;
      piece.matrix.compose(
        piece.p,
        new THREE.Quaternion().setFromUnitVectors(
          new THREE.Vector3(0, 1, 0),
          direction.normalize(),
        ),
        new THREE.Vector3(thickness, from.distanceTo(to) / 2, thickness),
      );
    };
    const addWindow = (e: Entity) => {
      const [sx, sy, sz] = e.s;
      if (sx > sy && sz > sy) return; // Lighthouse glazing belongs to its lantern room.
      const axis = sx < sz ? 0 : 2,
        horizontal = axis === 2;
      const width = horizontal ? sx : sz,
        cap = sy * 0.38;
      const stone = !e.assembly.includes("house"),
        frameMaterial = stone
          ? (materials.stone ?? materials.wood)
          : materials.wood;
      // Both faces are finished, including the reverse side of a broken wall.
      for (const outward of [-1, 1]) {
        const face = e.p.slice();
        face[axis] += outward * (e.s[axis] + 0.08);
        for (const sign of [-1, 1]) {
          const p = face.slice();
          p[horizontal ? 0 : 2] += sign * width;
          p[1] -= cap * 0.5;
          add(
            stone ? "stone-window-frame" : "window-frame",
            e,
            p,
            [0.16, sy - cap * 0.5, 0.16],
            frameMaterial,
          );
        }
        const sill = face.slice();
        sill[1] -= sy;
        add(
          stone ? "stone-window-frame" : "window-frame",
          e,
          sill,
          horizontal ? [sx + 0.16, 0.16, 0.18] : [0.18, 0.16, sz + 0.16],
          frameMaterial,
        );
        const top = face.slice();
        top[1] += sy - cap;
        add(
          stone ? "stone-window-arch" : "timber-window-arch",
          e,
          top,
          [width, cap, 1],
          frameMaterial,
          arch,
          false,
          horizontal ? 0 : Math.PI / 2,
        );
        if (!stone) {
          for (const sign of [-1, 1]) {
            const panel = face.slice();
            const axisIndex = horizontal ? 0 : 2,
              panelWidth = width * 0.42;
            panel[axisIndex] += sign * width * 1.65;
            add(
              "timber-shutters",
              e,
              panel,
              horizontal
                ? [width * 0.42, sy * 0.8, 0.1]
                : [0.1, sy * 0.8, width * 0.42],
              structuralTimber,
            );
            // A diagonal rail and paired iron straps turn plain shutter slabs
            // into fitted joinery. They stay on the same window owner.
            const braceFace = face.slice();
            braceFace[axis] += outward * 0.085;
            const lower = braceFace.slice(),
              upper = braceFace.slice();
            lower[axisIndex] += sign * width * 1.65 - sign * panelWidth * 0.3;
            lower[1] -= sy * 0.18;
            upper[axisIndex] += sign * width * 1.65 + sign * panelWidth * 0.3;
            upper[1] += sy * 0.18;
            addBeam(
              "shutter-diagonal-braces",
              e,
              new THREE.Vector3(...lower as [number, number, number]),
              new THREE.Vector3(...upper as [number, number, number]),
              0.075,
              materials.wood,
            );
            for (const lift of [-0.25, 0.25]) {
              const hinge = face.slice();
              hinge[axisIndex] += sign * width * 1.65 - sign * panelWidth * 0.34;
              hinge[axis] += outward * 0.06;
              hinge[1] += lift * sy;
              add(
                "window-hinges",
                e,
                hinge,
                horizontal
                  ? [panelWidth * 0.58, 0.055, 0.045]
                  : [0.045, 0.055, panelWidth * 0.58],
                iron,
              );
            }
          }
        }
        add(
          "window-frame",
          e,
          face,
          horizontal ? [0.09, sy, 0.12] : [0.12, sy, 0.09],
          materials.wood,
        );
        const transom = face.slice();
        transom[1] += sy * 0.25;
        add(
          "window-frame",
          e,
          transom,
          horizontal ? [width, 0.07, 0.12] : [0.12, 0.07, width],
          materials.wood,
        );
        // A central muntin turns the otherwise open slot into readable panes.
        // Keep it on both faces and with the window owner so damage and repair
        // follow the same saved structure as the surrounding frame.
        if (width > 0.55 && sy > 0.7)
          add(
            "window-muntins",
            e,
            face,
            horizontal
              ? [0.09, sy * 0.82, 0.12]
              : [0.12, sy * 0.82, 0.09],
            frameMaterial,
          );
      }
    };
    const roads = pathIndex(world.paths);
    const bridgeAssemblies = new Set(
      (world.sites ?? [])
        .filter((site) => site.kind === "bridge" || site.kind === "crossing")
        .map((site) => site.id),
    );
    const bridgeRail = visualGeometry("bridge-handrail_lod0", () =>
      new THREE.CylinderGeometry(0.22, 0.22, 2, 8).rotateZ(Math.PI / 2),
    );
    const bridgeDecks = new Map<string, Entity[]>();
    for (const entity of world.entities) {
      if (!bridgeDeckPresentation(entity, bridgeAssemblies)) continue;
      const deck = bridgeDecks.get(entity.assembly);
      if (deck) deck.push(entity);
      else bridgeDecks.set(entity.assembly, [entity]);
    }
    for (const decks of bridgeDecks.values()) {
      const runsAlongX = decks[0].s[0] < decks[0].s[2];
      decks.sort((a, b) => a.p[runsAlongX ? 0 : 2] - b.p[runsAlongX ? 0 : 2]);
      for (const deck of decks) {
        const profile = bridgeDeckPresentation(deck, bridgeAssemblies)!,
          [x, y, z] = profile.p,
          [sx, sy, sz] = profile.s,
          beamY = y - sy - 0.24,
          halfSpan = (runsAlongX ? sx : sz) - 0.18,
          crossOffset = (runsAlongX ? sz : sx) + 0.08;
        for (const side of [-1, 1])
          addBeam(
            "bridge-main-girders",
            deck,
            runsAlongX
              ? new THREE.Vector3(x - halfSpan, beamY, z + side * crossOffset)
              : new THREE.Vector3(x + side * crossOffset, beamY, z - halfSpan),
            runsAlongX
              ? new THREE.Vector3(x + halfSpan, beamY, z + side * crossOffset)
              : new THREE.Vector3(x + side * crossOffset, beamY, z + halfSpan),
            0.36,
            structuralTimber,
          );
        addBeam(
          "bridge-cross-joists",
          deck,
          runsAlongX
            ? new THREE.Vector3(x, beamY, z - crossOffset)
            : new THREE.Vector3(x - crossOffset, beamY, z),
          runsAlongX
            ? new THREE.Vector3(x, beamY, z + crossOffset)
            : new THREE.Vector3(x + crossOffset, beamY, z),
          0.24,
          materials.wood,
        );
      }
    }
    const dockDecks = new Map<string, Entity[]>();
    for (const entity of world.entities) {
      if (
        entity.kind !== "block" ||
        !/-dock$/.test(entity.assembly) ||
        entity.s[1] > 0.8 ||
        Math.min(entity.s[0], entity.s[2]) < 1.8 ||
        Math.max(entity.s[0], entity.s[2]) < 4.5
      )
        continue;
      const parts = dockDecks.get(entity.assembly);
      if (parts) parts.push(entity);
      else dockDecks.set(entity.assembly, [entity]);
    }
    const mooringOwners = new Set<number>();
    for (const decks of dockDecks.values()) {
      const runsAlongX = decks[0].s[0] < decks[0].s[2];
      decks.sort((a, b) => a.p[runsAlongX ? 0 : 2] - b.p[runsAlongX ? 0 : 2]);
      for (let i = 0; i < decks.length; i += 6) mooringOwners.add(decks[i].id);
      if (decks.length > 1) mooringOwners.add(decks.at(-1)!.id);
    }
    const mooringRing = visualGeometry(
      "mooring-ring_lod0",
      () => new THREE.TorusGeometry(0.34, 0.07, 6, 12),
    );
    for (const e of world.entities) {
      const [x, y, z] = e.p,
        [sx, sy, sz] = e.s;
      const bridgeRailOwner = isBridgeRailingPart(e, bridgeAssemblies),
        bridgeAxis = sz < 0.8 ? 0 : sx < 0.8 ? 1 : undefined;
      if (bridgeRailOwner && bridgeAxis !== undefined) {
        const runsAlongX = bridgeAxis === 0,
          deckY = y - 2,
          halfSpan = (runsAlongX ? sx : sz) - 0.16,
          railTransform = (lift: number) =>
            runsAlongX
              ? [[x, deckY + lift, z], [halfSpan, 1, 1], 0] as const
              : [[x, deckY + lift, z], [halfSpan, 1, 1], Math.PI / 2] as const;
        const [topPosition, topScale, yaw] = railTransform(2.55),
          [lowerPosition, lowerScale] = railTransform(1.55);
        add(
          "bridge-handrails",
          e,
          [...topPosition],
          [...topScale],
          structuralTimber,
          bridgeRail,
          false,
          yaw,
        );
        add(
          "bridge-lower-handrails",
          e,
          [...lowerPosition],
          [...lowerScale],
          structuralTimber,
          bridgeRail,
          false,
          yaw,
        );
        add(
          "bridge-railing-posts",
          e,
          [x, deckY + 1.88, z],
          runsAlongX ? [0.14, 0.88, 0.14] : [0.14, 0.88, 0.14],
          structuralTimber,
        );
        const from = (along: number, lift: number) =>
            runsAlongX
              ? new THREE.Vector3(x + along, deckY + lift, z)
              : new THREE.Vector3(x, deckY + lift, z + along),
          braceEnd = halfSpan * 0.86;
        addBeam(
          "bridge-railing-braces",
          e,
          from(-braceEnd, 1.08),
          from(braceEnd, 2.42),
          0.085,
          materials.wood,
        );
        addBeam(
          "bridge-railing-braces",
          e,
          from(-braceEnd, 2.42),
          from(braceEnd, 1.08),
          0.085,
          materials.wood,
        );
      }
      if (mooringOwners.has(e.id)) {
        const runsAlongX = sx < sz;
        for (const side of [-1, 1]) {
          const p: number[] = runsAlongX
            ? [x, y + sy + 0.55, z + side * (sz - 0.48)]
            : [x + side * (sx - 0.48), y + sy + 0.55, z];
          add("dock-bollards", e, p, [0.22, 0.55, 0.22], structuralTimber);
          if (runsAlongX) p[2] += side * 0.23;
          else p[0] += side * 0.23;
          p[1] -= 0.06;
          add(
            "dock-mooring-rings",
            e,
            p,
            [1, 1, 1],
            iron,
            mooringRing,
            false,
            runsAlongX ? 0 : Math.PI / 2,
          );
        }
      }
      if (e.kind === "tree") {
        const riverside = e.treeSpecies === "riverside";
        // Ground dressing is attached to its authoritative tree and resampled
        // after excavation. No plants appear on roads, steep faces or water.
        for (let i = 0; i < 4; i++) {
          const angle = (e.variant * 17 + i) * 2.399963,
            radius = 3 + (i * 7 + (e.id % 13));
          const px = x + Math.cos(angle) * radius,
            pz = z + Math.sin(angle) * radius;
          const h = terrain.sample(px, pz);
          if (
            h < 2 ||
            this.wet(px, pz) ||
            roads(px, pz) < 6 ||
            Math.abs(h - terrain.sample(px + 2, pz)) > 1.4 ||
            Math.abs(h - terrain.sample(px, pz + 2)) > 1.4
          )
            continue;
          add(
            riverside ? "riverside-reeds" : "grass",
            e,
            [px, h, pz],
            riverside ? [3.4, 3.2, 3.4] : [0.8, 0.75, 1],
            riverside ? reedMaterial : foliage,
            clump,
            true,
            angle,
          );
          if (i === 0)
            add(
              "ground-rock",
              e,
              [px + 1, h + 0.2, pz],
              [0.5, 0.25, 0.4],
              materials.rock,
              rock,
              true,
              angle,
            );
          if (i === 1)
            add(
              "fallen-branch",
              e,
              [px, h + 0.15, pz],
              [2, 0.12, 0.12],
              materials.wood,
              box,
              true,
              angle,
            );
        }
        // Broadleaf and riverside shrubs fill the open ground under larger
        // crowns. A small, seed-locked count keeps density stable between runs.
        const shrubKind =
            e.treeSpecies === "riverside" ? "riverside" : "broadleaf",
          shrub = shrubKind === "riverside" ? riversideShrub : broadleafShrub;
        for (let i = 0; i < 2; i++) {
          const angle =
            (e.variant * 29 + i * 3.7 + e.id * 0.13) % (Math.PI * 2);
          const radius = Math.max(sx, sz) + 4 + ((e.id * 3 + i * 7) % 6);
          const px = x + Math.cos(angle) * radius;
          const pz = z + Math.sin(angle) * radius;
          const h = terrain.sample(px, pz);
          if (
            h < 2 ||
            this.wet(px, pz) ||
            roads(px, pz) < 8 ||
            Math.abs(h - terrain.sample(px + 1.5, pz)) > 1 ||
            Math.abs(h - terrain.sample(px - 1.5, pz)) > 1 ||
            Math.abs(h - terrain.sample(px, pz + 1.5)) > 1 ||
            Math.abs(h - terrain.sample(px, pz - 1.5)) > 1
          )
            continue;
          const size = 0.9 + ((e.id + i * 3) % 5) * 0.12;
          add(
            `forest-understory-${shrubKind}`,
            e,
            [px, h + 0.85, pz],
            [size, 0.95 + size * 0.35, size],
            understoryMaterial,
            shrub,
            true,
            angle,
          );
        }
        continue;
      }
      if (e.kind === "rock") {
        // Break up isolated boulders with deterministic, owner-linked scree.
        // Reuse the existing rock batch, surface and authored geometry.
        for (let i = 0; i < 6; i++) {
          const angle = e.variant * Math.PI * 2 + i * 2.399963;
          const radius = Math.max(sx, sz) + 2 + ((i * 7 + e.id) % 9);
          const px = x + Math.cos(angle) * radius;
          const pz = z + Math.sin(angle) * radius;
          const h = terrain.sample(px, pz);
          const size = 0.3 + ((i * 3 + e.id) % 7) * 0.12;
          const halfHeight = size * 0.55;
          if (
            h < 2 ||
            this.wet(px, pz) ||
            roads(px, pz) < 7 ||
            Math.abs(h - terrain.sample(px + size, pz)) > halfHeight ||
            Math.abs(h - terrain.sample(px - size, pz)) > halfHeight ||
            Math.abs(h - terrain.sample(px, pz + size)) > halfHeight ||
            Math.abs(h - terrain.sample(px, pz - size)) > halfHeight
          )
            continue;
          add(
            "ground-rock",
            e,
            [px, h + halfHeight * 0.6, pz],
            [size, halfHeight, size * (0.65 + (i % 3) * 0.15)],
            materials.rock,
            rock,
            true,
            angle,
          );
        }
        continue;
      }
      if (e.kind !== "block") continue;
      if (
        e.material === "wood" &&
        /dock|bridge|logging|watchtower|windmill|watermill/.test(e.assembly)
      ) {
        if (sy > 2 && sx <= 2.1 && sz <= 2.1) {
          for (const sign of [-1, 1])
            add(
              "iron-straps",
              e,
              [x, y + sign * (sy - 0.4), z],
              [sx + 0.06, 0.09, sz + 0.06],
              iron,
            );
        } else if (sx > 2.3 && sy <= 1.5 && sz <= 1.5) {
          for (const sign of [-1, 1])
            add(
              "iron-straps",
              e,
              [x + sign * (sx - 0.35), y, z],
              [0.09, sy + 0.04, sz + 0.04],
              iron,
            );
        } else if (sz > 2.3 && sx <= 1.5 && sy <= 1.5) {
          for (const sign of [-1, 1])
            add(
              "iron-straps",
              e,
              [x, y, z + sign * (sz - 0.35)],
              [sx + 0.04, sy + 0.04, 0.09],
              iron,
            );
        }
      }
      if (
        e.material === "wood" &&
        /-(house|warehouse|barn|mill|shed)(-|$)/.test(e.assembly) &&
        sy > 1.2 &&
        Math.min(sx, sz) >= 0.7 &&
        Math.min(sx, sz) <= 1.2 &&
        Math.max(sx, sz) > 2.4
      ) {
        const horizontal = sz < sx;
        const extent = horizontal ? sx : sz;
        // Each wall course owns its posts, plates and braces, so a broken
        // course cannot leave a full-height decorative skeleton standing.
        const bays = Math.max(1, Math.ceil((extent * 2) / 4.5));
        const width = (extent * 2) / bays;
        for (const outward of [-1, 1]) {
          const face = horizontal
            ? z + outward * (sz + 0.1)
            : x + outward * (sx + 0.1);
          for (const lift of [-sy + 0.14, sy - 0.14])
            add(
              "wood-wall-plates",
              e,
              horizontal ? [x, y + lift, face] : [face, y + lift, z],
              horizontal ? [extent, 0.14, 0.14] : [0.14, 0.14, extent],
              structuralTimber,
            );
          for (let bay = 0; bay <= bays; bay++) {
            const offset = -extent + bay * width;
            add(
              "wood-wall-posts",
              e,
              horizontal ? [x + offset, y, face] : [face, y, z + offset],
              [0.14, sy, 0.14],
              structuralTimber,
            );
          }
          for (let bay = 0; bay < bays; bay++) {
            const start = -extent + bay * width + 0.18;
            const end = start + width - 0.36;
            const rising = (bay + e.id) % 2 === 0;
            const bottom = y - sy + 0.22,
              top = y + sy - 0.22;
            addBeam(
              "wood-wall-braces",
              e,
              horizontal
                ? new THREE.Vector3(x + start, rising ? bottom : top, face)
                : new THREE.Vector3(face, rising ? bottom : top, z + start),
              horizontal
                ? new THREE.Vector3(x + end, rising ? top : bottom, face)
                : new THREE.Vector3(face, rising ? top : bottom, z + end),
              0.11,
              structuralTimber,
            );
          }
        }
      }
      if (e.foundation && e.material !== "plaster") continue;
      if (e.material === "window" && !isLighthouseLanternGlazing(e)) {
        addWindow(e);
      } else if (e.material === "roof" || e.material === "slate") {
        const cap = lighthouseRoofPresentation(e),
          roofX = cap?.p[0] ?? x,
          roofY = cap?.p[1] ?? y,
          roofZ = cap?.p[2] ?? z,
          roofSX = cap?.s[0] ?? sx,
          roofSY = cap?.s[1] ?? sy,
          roofSZ = cap?.s[2] ?? sz;
        // Eaves and fascia follow every roof owner, from farms to warehouses.
        for (const sign of [-1, 1])
          add(
            "roof-fascia",
            e,
            [roofX, roofY - roofSY + 0.12, roofZ + sign * roofSZ],
            [roofSX, 0.18, 0.14],
            materials.wood,
          );
        for (const sign of [-1, 1])
          add(
            "roof-fascia",
            e,
            [roofX + sign * roofSX, roofY - roofSY + 0.12, roofZ],
            [0.14, 0.18, roofSZ],
            materials.wood,
          );
        // Hip caps follow the authored roof's four sloping edges. Their
        // transforms are derived from the existing owner, never new collision.
        for (const a of [-1, 1])
          for (const b of [-1, 1])
            addBeam(
              "roof-hip-caps",
              e,
              new THREE.Vector3(
                roofX + a * roofSX,
                roofY - roofSY + 0.18,
                roofZ + b * roofSZ,
              ),
              new THREE.Vector3(roofX, roofY + roofSY + 0.12, roofZ),
              0.16,
              materials[e.material] ?? materials.stone ?? materials.wood,
            );
      } else if (
        e.material === "plaster" &&
        sy > 1.2 &&
        (sx < 1.2 || sz < 1.2)
      ) {
        const horizontal = sz < sx;
        add(
          "timber-joints",
          e,
          [x, y - sy + 0.12, z],
          horizontal ? [sx, 0.12, sz + 0.06] : [sx + 0.06, 0.12, sz],
          structuralTimber,
        );
        add(
          "timber-joints",
          e,
          [x, y + sy - 0.12, z],
          horizontal ? [sx, 0.12, sz + 0.06] : [sx + 0.06, 0.12, sz],
          structuralTimber,
        );
        for (const outward of [-1, 1]) {
          for (const side of [-1, 1]) {
            const face = horizontal
              ? z + outward * (sz + 0.04)
              : x + outward * (sx + 0.04);
            const extent = horizontal ? sx : sz;
            const post = side * Math.max(0, extent - 0.13);
            add(
              "timber-posts",
              e,
              horizontal ? [x + post, y, face] : [face, y, z + post],
              [0.12, sy, 0.12],
              structuralTimber,
            );
            const span = Math.min(0.8, extent * 0.3, sy * 0.55);
            add(
              "timber-knee-braces",
              e,
              horizontal
                ? [x + post - side * span * 0.5, y + sy - span * 0.5, face]
                : [face, y + sy - span * 0.5, z + post - side * span * 0.5],
              [0.09, span * Math.SQRT2 * 0.5, 0.09],
              structuralTimber,
              box,
              false,
              horizontal ? 0 : Math.PI / 2,
              (side * Math.PI) / 4,
            );
          }
        }
        if (e.id % 3 === 0)
          add(
            "timber-joints",
            e,
            [x, y, z],
            horizontal ? [0.14, sy, sz + 0.07] : [sx + 0.07, sy, 0.14],
            structuralTimber,
          );
      } else if (e.material === "wood" && sy > 0.7 && e.id % 3 === 0) {
        // Pegs/joints add construction detail to docks, mills and logging camps.
        add(
          "joinery",
          e,
          [x + sx + 0.025, y, z],
          [0.08, 0.12, Math.min(sz, 0.32)],
          materials.rock,
        );
      }
    }
    // Working settlements receive small stacks beside their side walls. One
    // existing foundation owns each stack; roads and entrances remain clear.
    const dressed = new Set<string>();
    const assemblies = new Map<string, Entity[]>();
    for (const e of world.entities) {
      const parts = assemblies.get(e.assembly);
      if (parts) parts.push(e);
      else assemblies.set(e.assembly, [e]);
    }
    for (const castle of world.castles ?? []) {
      const gate = castle.landmarks?.gate,
        walls = assemblies
          .get(`${castle.id}:front`)
          ?.filter(
            (part) =>
              part.kind === "block" && part.material === "sandstone",
          );
      if (!gate || !walls?.length) continue;
      const xExtent = Math.max(...walls.map((part) => part.p[0])) -
          Math.min(...walls.map((part) => part.p[0])),
        zExtent = Math.max(...walls.map((part) => part.p[2])) -
          Math.min(...walls.map((part) => part.p[2])),
        alongAxis = xExtent >= zExtent ? 0 : 2,
        normalAxis = alongAxis === 0 ? 2 : 0,
        along = (part: Entity) => part.p[alongAxis],
        candidates = walls
          .filter(
            (part) =>
              along(part) !== gate[alongAxis] &&
              Math.abs(part.p[1] - (gate[1] + 2.4)) < 2,
          )
          .sort(
            (a, b) =>
              Math.abs(along(a) - gate[alongAxis]) -
              Math.abs(along(b) - gate[alongAxis]),
          ),
        left = candidates.find((part) => along(part) < gate[alongAxis]),
        right = candidates.find((part) => along(part) > gate[alongAxis]);
      if (!left || !right) continue;
      const radius = THREE.MathUtils.clamp(
          (Math.abs(along(left) - gate[alongAxis]) - left.s[alongAxis] +
            Math.abs(along(right) - gate[alongAxis]) - right.s[alongAxis]) /
            2,
          6,
          12,
        ),
        wallNormal = (left.p[normalAxis] + right.p[normalAxis]) / 2,
        wallDepth = Math.max(left.s[normalAxis], right.s[normalAxis]);
      for (const outward of [-1, 1]) {
        const face = wallNormal + outward * (wallDepth + 0.08),
          point = (t: number) => {
            const angle = Math.PI - t * Math.PI,
              result = new THREE.Vector3();
            result.setComponent(
              alongAxis,
              gate[alongAxis] + Math.cos(angle) * radius,
            );
            result.y = gate[1] + radius + Math.sin(angle) * radius;
            result.setComponent(normalAxis, face);
            return result;
          };
        for (let i = 0; i < 16; i++) {
          const from = point(i / 16),
            to = point((i + 1) / 16),
            owner = (from.getComponent(alongAxis) +
              to.getComponent(alongAxis)) /
              2 <
            gate[alongAxis]
              ? left
              : right;
          addBeam(
            "castle-gate-voussoirs",
            owner,
            from,
            to,
            0.34,
            materials.sandstone ?? materials.stone ?? materials.rock,
          );
        }
      }
    }
    for (const [name, parts] of assemblies) {
      if (!/coastal-ruin/.test(name)) continue;
      for (const owner of parts) {
        if (
          owner.kind !== "block" ||
          owner.material !== "stone" ||
          !owner.foundation
        )
          continue;
        for (let i = 0; i < 5; i++) {
          const angle = ((owner.id * 17 + i * 137.5) * Math.PI) / 180,
            radius =
              Math.max(owner.s[0], owner.s[2]) +
              0.8 +
              ((owner.id + i * 3) % 5) * 0.55,
            px = owner.p[0] + Math.cos(angle) * radius,
            pz = owner.p[2] + Math.sin(angle) * radius,
            h = terrain.sample(px, pz),
            size = 0.45 + ((owner.id * 3 + i * 7) % 6) * 0.14,
            halfHeight = size * (0.35 + (i % 3) * 0.12);
          if (
            h < 2 ||
            this.wet(px, pz) ||
            roads(px, pz) < 6 ||
            Math.abs(h - terrain.sample(px + size, pz)) > halfHeight ||
            Math.abs(h - terrain.sample(px - size, pz)) > halfHeight ||
            Math.abs(h - terrain.sample(px, pz + size)) > halfHeight ||
            Math.abs(h - terrain.sample(px, pz - size)) > halfHeight
          )
            continue;
          add(
            "coastal-ruin-rubble",
            owner,
            [px, h + halfHeight * 0.52, pz],
            [size, halfHeight, size * (0.65 + (i % 3) * 0.12)],
            materials.rock ?? materials.stone,
            rock,
            true,
            angle,
          );
        }
      }
    }
    for (const [name, parts] of assemblies) {
      if (!/-scaffold$/.test(name)) continue;
      const posts = parts
        .filter(
          (part) =>
            part.kind === "block" &&
            part.material === "wood" &&
            part.s[1] >= 8 &&
            part.s[0] <= 0.8 &&
            part.s[2] <= 0.8,
        )
        .sort((a, b) => a.p[0] - b.p[0]);
      const beams = parts.filter(
        (part) =>
          part.kind === "block" &&
          part.material === "wood" &&
          part.s[0] >= 5 &&
          part.s[1] <= 1.2 &&
          part.s[2] >= 2,
      );
      for (let i = 0; i < posts.length - 1; i++) {
        const left = posts[i],
          right = posts[i + 1],
          span = right.p[0] - left.p[0];
        if (span < 5 || span > 16) continue;
        const owner = beams.reduce<Entity | undefined>(
          (nearest, beam) =>
            !nearest ||
            Math.abs(beam.p[0] - (left.p[0] + right.p[0]) * 0.5) <
              Math.abs(nearest.p[0] - (left.p[0] + right.p[0]) * 0.5)
              ? beam
              : nearest,
          undefined,
        );
        if (!owner) continue;
        const low = Math.max(
            left.p[1] - left.s[1] + 1.1,
            right.p[1] - right.s[1] + 1.1,
          ),
          high = Math.min(
            left.p[1] + left.s[1] - 1.1,
            right.p[1] + right.s[1] - 1.1,
          );
        for (const side of [-1, 1]) {
          const face = owner.p[2] + side * (owner.s[2] + 0.06);
          addBeam(
            "quarry-scaffold-braces",
            owner,
            new THREE.Vector3(left.p[0] + 0.8, low, face),
            new THREE.Vector3(right.p[0] - 0.8, high, face),
            0.16,
            structuralTimber,
          );
          addBeam(
            "quarry-scaffold-braces",
            owner,
            new THREE.Vector3(left.p[0] + 0.8, high, face),
            new THREE.Vector3(right.p[0] - 0.8, low, face),
            0.16,
            structuralTimber,
          );
        }
      }
    }
    const door = visualGeometry(
      "door_lod0",
      () => new THREE.BoxGeometry(2, 2, 0.1),
    );
    const coping = visualGeometry(
      "coping_lod0",
      () => new THREE.BoxGeometry(2, 2, 2),
    );
    const crop = visualGeometry("leaf_lod0", () => {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(
          [-0.45, 0, 0, 0, 0.55, 0.08, 0.45, 0, 0, 0, 0.55, 0.08],
          3,
        ),
      );
      geometry.setAttribute(
        "uv",
        new THREE.Float32BufferAttribute(
          [0, 0, 0.5, 1, 1, 0, 0, 0, 1, 0.5, 0, 1],
          2,
        ),
      );
      geometry.setIndex([0, 1, 2, 3, 4, 5]);
      geometry.computeVertexNormals();
      return geometry;
    });
    // Authored leaf blades are centered vertically; seat their roots on the
    // field rows so the lower half does not disappear beneath the terrain.
    crop.translate(0, 1, 0);
    const chimneyMasonry = (materials.stone ?? materials.rock).clone();
    chimneyMasonry.color.multiplyScalar(0.78);
    const ventMaterial = (materials.wood ?? materials.rock).clone();
    ventMaterial.color.multiplyScalar(0.72);
    for (const [name, parts] of assemblies) {
      // Give ordinary roofs family-specific silhouettes. These pieces are
      // presentation only and share the roof entity's removal lifetime.
      const rooflineFamily = name.match(
        /-(house|barn|shed|warehouse|mill)(?:-\d+)?$/,
      )?.[1];
      if (rooflineFamily) {
        const roofOwner = parts
          .filter(
            (part) =>
              part.kind === "block" &&
              (part.material === "roof" || part.material === "slate"),
          )
          .sort((a, b) => b.p[2] - a.p[2])[0];
        if (roofOwner) {
          const [x, y, z] = roofOwner.p;
          const roofPeak = y + roofOwner.s[1];
          if (
            rooflineFamily === "house" ||
            rooflineFamily === "barn" ||
            rooflineFamily === "shed"
          ) {
            const stackY = roofPeak + 0.72;
            add(
              "roof-chimney-stack",
              roofOwner,
              [x, stackY, z],
              [0.58, 1.8, 0.58],
              chimneyMasonry,
            );
            for (const lift of [0.2, 1.15])
              add(
                "roof-chimney-courses",
                roofOwner,
                [x, roofPeak + lift, z],
                [0.64, 0.09, 0.64],
                materials.stone ?? materials.rock,
              );
            for (const [sideX, sideZ, sx, sz] of [
              [0, -0.59, 0.24, 0.035],
              [0, 0.59, 0.24, 0.035],
              [-0.59, 0, 0.035, 0.24],
              [0.59, 0, 0.035, 0.24],
            ])
              add(
                "roof-chimney-flues",
                roofOwner,
                [x + sideX, roofPeak + 1.98, z + sideZ],
                [sx, 0.18, sz],
                iron,
              );
            add(
              "roof-chimney-cap",
              roofOwner,
              [x, roofPeak + 2.64, z],
              [0.82, 0.14, 0.82],
              chimneyMasonry,
            );
          } else {
            // Working buildings use a restrained louvered cupola rather than
            // a domestic flue; mills and warehouses remain legible at range.
            add(
              "roof-vent-cupola",
              roofOwner,
              [x, roofPeak + 0.42, z],
              [1.02, 0.52, 1.02],
              ventMaterial,
            );
            for (const side of [-1, 1]) {
              add(
                "roof-vent-louvers",
                roofOwner,
                [x, roofPeak + 0.3, z + side * 1.04],
                [0.7, 0.07, 0.035],
                iron,
              );
              add(
                "roof-vent-louvers",
                roofOwner,
                [x + side * 1.04, roofPeak + 0.3, z],
                [0.035, 0.07, 0.7],
                iron,
              );
            }
            add(
              "roof-vent-cap",
              roofOwner,
              [x, roofPeak + 1.08, z],
              [1.24, 0.12, 1.24],
              materials.wood,
            );
          }
        }
      }
      // The farm remains readable as a working landscape, not just a barn and
      // fence. Beds follow the canonical ground, are excluded from wet/road
      // areas, and use the barn's existing foundation owner for removal.
      if (/(?:^|-)farm-\d+-barn$/.test(name)) {
        const barn = parts.find((part) => part.kind === "block");
        const owner = parts.find(
          (part) => part.kind === "block" && part.foundation,
        );
        if (barn && owner) {
          const [bx, , bz] = barn.p;
          const across = Math.max(8, Math.min(15, barn.s[0] * 0.58));
          const rowCount = 5;
          for (let row = 0; row < rowCount; row++) {
            // Keep the field beyond the barn's front doorway and courtyard.
            const z = bz - 32 - row * 2.5;
            const left = bx - across;
            const right = bx + across;
            const middle = (left + right) / 2;
            const ground = terrain.sample(middle, z);
            if (
              ground < 2 ||
              this.wet(middle, z) ||
              roads(middle, z) < 5 ||
              Math.abs(ground - terrain.sample(middle + 2, z)) > 0.8 ||
              Math.abs(ground - terrain.sample(middle, z + 2)) > 0.8
            )
              continue;
            add(
              "farm-beds",
              owner,
              [middle, ground + 0.06, z],
              [across, 0.06, 0.48],
              materials.earth,
              box,
              true,
            );
            const count = Math.floor((right - left) / 2.4);
            for (let plant = 0; plant <= count; plant++) {
              const px = left + (plant + 0.5) * ((right - left) / (count + 1));
              const h = terrain.sample(px, z);
              if (
                h < 2 ||
                this.wet(px, z) ||
                roads(px, z) < 5 ||
                Math.abs(h - terrain.sample(px + 1, z)) > 0.7 ||
                Math.abs(h - terrain.sample(px, z + 1)) > 0.7
              )
                continue;
              const variant = (owner.id * 17 + row * 31 + plant * 13) % 7;
              const height = 0.85 + variant * 0.045;
              for (let blade = 0; blade < 3; blade++) {
                const yaw = ((variant + blade) * Math.PI) / 3;
                add(
                  "farm-crops",
                  owner,
                  [px, h + height * 0.5, z],
                  [0.42, height, 0.42],
                  cropMaterial,
                  crop,
                  true,
                  yaw,
                );
              }
            }
          }
          // Three-sided split rails frame the crop rows while leaving the
          // barn-side entrance open. Each piece follows the existing barn
          // foundation owner and remains presentation-only scenery.
          const fieldLeft = bx - across - 2,
            fieldRight = bx + across + 2,
            fieldBack = bz - 29,
            fieldFront = bz - 45,
            fencePoint = (x: number, z: number) => {
              const h = terrain.sample(x, z);
              return {
                x,
                z,
                h,
                clear: h >= 2 && !this.wet(x, z) && roads(x, z) >= 5,
              };
            },
            fenceLine = (points: { x: number; z: number }[]) => {
              const sampled = points.map((point) =>
                  fencePoint(point.x, point.z),
                ),
                connected = sampled.slice(0, -1).map((point, index) => {
                  const next = sampled[index + 1];
                  if (
                    !point.clear ||
                    !next.clear ||
                    Math.abs(point.h - next.h) > 1.2
                  )
                    return false;
                  for (const t of [0.25, 0.5, 0.75]) {
                    const x = THREE.MathUtils.lerp(point.x, next.x, t),
                      z = THREE.MathUtils.lerp(point.z, next.z, t),
                      h = terrain.sample(x, z);
                    if (
                      h < 2 ||
                      this.wet(x, z) ||
                      roads(x, z) < 5 ||
                      Math.abs(h - THREE.MathUtils.lerp(point.h, next.h, t)) >
                        0.8
                    )
                      return false;
                  }
                  return true;
                });
              for (let i = 0; i < sampled.length; i++) {
                if (
                  !sampled[i].clear ||
                  (!connected[i - 1] && !connected[i])
                )
                  continue;
                add(
                  "farm-fence-posts",
                  owner,
                  [sampled[i].x, sampled[i].h + 0.68, sampled[i].z],
                  [0.16, 0.68, 0.16],
                  materials.wood,
                  box,
                  true,
                );
              }
              for (let i = 0; i < connected.length; i++) {
                if (!connected[i]) continue;
                const from = sampled[i],
                  to = sampled[i + 1];
                for (const height of [0.52, 1.02])
                  addBeam(
                    "farm-fence-rails",
                    owner,
                    new THREE.Vector3(from.x, from.h + height, from.z),
                    new THREE.Vector3(to.x, to.h + height, to.z),
                    0.065,
                    materials.wood,
                    true,
                  );
              }
            };
          const sidePoints = (x: number) => {
            const points: { x: number; z: number }[] = [];
            for (let z = fieldBack; z > fieldFront; z -= 5)
              points.push({ x, z });
            points.push({ x, z: fieldFront });
            return points;
          };
          fenceLine(sidePoints(fieldLeft));
          fenceLine(sidePoints(fieldRight));
          const frontPoints: { x: number; z: number }[] = [];
          for (let x = fieldLeft; x < fieldRight; x += 5)
            frontPoints.push({ x, z: fieldFront });
          frontPoints.push({ x: fieldRight, z: fieldFront });
          fenceLine(frontPoints);
        }
      }
      if (
        !name.includes(":") &&
        !/watchtower|coastal-ruin|lighthouse|bridge/.test(name)
      )
        continue;
      const tops = new Map<string, Entity>();
      for (const part of parts) {
        if (part.kind !== "block") continue;
        const key = `${Math.round(part.p[0] * 2)}:${Math.round(part.p[2] * 2)}`;
        const prior = tops.get(key);
        if (!prior || part.p[1] + part.s[1] > prior.p[1] + prior.s[1])
          tops.set(key, part);
      }
      for (const owner of tops.values()) {
        if (owner.material !== "sandstone" && owner.material !== "stone")
          continue;
        const [x, y, z] = owner.p,
          [sx, sy, sz] = owner.s;
        add(
          "stone-coping",
          owner,
          [x, y + sy + 0.1, z],
          [sx + 0.12, 0.16, sz + 0.12],
          materials[owner.material] ?? materials.stone,
          coping,
        );
      }
    }
    for (const [name, parts] of assemblies) {
      if (!/-(house|warehouse|barn|mill|shed)(-|$)/.test(name)) continue;
      const walls = parts.filter(
        (part) =>
          part.kind === "block" &&
          part.foundation &&
          part.s[2] <= 1.05 &&
          part.s[0] > 1.2 &&
          part.material !== "window",
      );
      if (walls.length < 2) continue;
      const front = Math.min(...walls.map((wall) => wall.p[2]));
      const pair = walls
        .filter((wall) => Math.abs(wall.p[2] - front) < 0.05)
        .sort((a, b) => a.p[0] - b.p[0]);
      if (pair.length !== 2) continue;
      const [left, right] = pair;
      const hinge = left.p[0] + left.s[0],
        end = right.p[0] - right.s[0];
      const halfWidth = (end - hinge) / 2;
      const base = Math.max(left.p[1] - left.s[1], right.p[1] - right.s[1]);
      const halfHeight = Math.min(left.s[1], right.s[1]);
      if (halfWidth < 0.6 || halfWidth > 4 || halfHeight < 1) continue;
      const face = front - Math.max(left.s[2], right.s[2]) - 0.14;
      const angle = Math.PI * 0.59;
      const doorCenter = [
        hinge + Math.cos(angle) * halfWidth,
        base + halfHeight,
        face - Math.sin(angle) * halfWidth,
      ];
      add(
        "open-plank-doors",
        left,
        doorCenter,
        [halfWidth * 0.97, halfHeight * 0.97, 1],
        materials.wood,
        door,
        false,
        angle,
      );
      const doorPoint = (localX: number, localY: number, localZ: number) =>
        new THREE.Vector3(
          doorCenter[0] + Math.cos(angle) * localX + Math.sin(angle) * localZ,
          doorCenter[1] + localY,
          doorCenter[2] - Math.sin(angle) * localX + Math.cos(angle) * localZ,
        );
      // The open leaf has the same timber cross rails and diagonal brace on
      // both faces. A small iron ring latch sits near its free edge; every
      // fitting inherits the original hinge-wall owner for damage and restore.
      for (const outward of [-1, 1]) {
        const z = outward * 0.075;
        for (const lift of [-0.62, 0.62])
          addBeam(
            "door-cross-rails",
            left,
            doorPoint(-halfWidth * 0.82, halfHeight * lift, z),
            doorPoint(halfWidth * 0.82, halfHeight * lift, z),
            0.11,
            structuralTimber,
          );
        addBeam(
          "door-diagonal-braces",
          left,
          doorPoint(-halfWidth * 0.76, -halfHeight * 0.72, z),
          doorPoint(halfWidth * 0.76, halfHeight * 0.72, z),
          0.12,
          materials.wood,
        );
        const latch = doorPoint(halfWidth * 0.7, 0, z + outward * 0.025);
        add(
          "door-latch-plates",
          left,
          latch.toArray(),
          [0.09, 0.13, 0.025],
          iron,
          box,
          false,
          angle,
        );
        add(
          "door-ring-handles",
          left,
          doorPoint(halfWidth * 0.7, -0.13, z + outward * 0.06).toArray(),
          [1, 1, 1],
          iron,
          visualGeometry("door-ring-handle_lod0", () =>
            new THREE.TorusGeometry(0.12, 0.025, 6, 12),
          ),
          false,
          angle,
        );
      }
      for (const [owner, px] of [
        [left, hinge - 0.13],
        [right, end + 0.13],
      ] as const)
        add(
          "entrance-timber",
          owner,
          [px, base + halfHeight, face],
          [0.13, halfHeight, 0.14],
          materials.wood,
        );
      const middle = hinge + halfWidth;
      const header =
        parts.find(
          (part) =>
            part.kind === "block" &&
            !part.foundation &&
            Math.abs(part.p[0] - middle) < 0.1 &&
            Math.abs(part.p[2] - front) < 0.1,
        ) ?? left;
      add(
        "entrance-timber",
        header,
        [middle, base + halfHeight * 2 + 0.08, face],
        [halfWidth + 0.25, 0.14, 0.14],
        materials.wood,
      );
      for (const lift of [0.48, halfHeight * 2 - 0.48])
        add(
          "door-hinges",
          left,
          [hinge - 0.03, base + lift, face - 0.035],
          [0.09, 0.16, 0.11],
          materials.rock,
        );
      const ground = terrain.sample(middle, face - 0.4);
      if (Math.abs(ground - base) < 0.6 && !this.wet(middle, face - 0.4))
        add(
          "entrance-thresholds",
          left,
          [middle, ground + 0.09, face - 0.4],
          [halfWidth, 0.09, 0.38],
          materials.stone ?? materials.rock,
          box,
          true,
        );
    }
    for (const [name, parts] of assemblies) {
      const watchtower = /watchtower/.test(name),
        castleKeep = /:keep$/.test(name),
        castleCurtainWall = /:(?:front|rear|west|east)$/.test(name);
      if (castleCurtainWall) {
        const masonry = parts.filter(
          (part) =>
            part.kind === "block" &&
            part.material === "sandstone" &&
            !part.foundation,
        );
        if (masonry.length >= 8) {
          const minX = Math.min(...masonry.map((part) => part.p[0])),
            maxX = Math.max(...masonry.map((part) => part.p[0])),
            minZ = Math.min(...masonry.map((part) => part.p[2])),
            maxZ = Math.max(...masonry.map((part) => part.p[2])),
            alongAxis = maxX - minX >= maxZ - minZ ? 0 : 2,
            normalAxis = alongAxis === 0 ? 2 : 0,
            courses = masonry.filter(
              (part) =>
                part.s[1] >= 1.6 &&
                part.s[1] <= 4.1 &&
                part.s[alongAxis] >= 3.5 &&
                part.s[normalAxis] >= 1.5 &&
                part.s[alongAxis] >= part.s[normalAxis] * 1.35,
            ),
            levels = [
              ...new Set(courses.map((part) => Math.round(part.p[1] * 100))),
            ].sort((a, b) => a - b),
            middleLevel = levels[Math.floor(levels.length / 2)],
            slitOwners = courses
              .filter((part) => Math.round(part.p[1] * 100) === middleLevel)
              .sort((a, b) => a.p[alongAxis] - b.p[alongAxis]);
          for (let i = 1; i < slitOwners.length - 1; i += 3) {
            const owner = slitOwners[i];
            for (const outward of [-1, 1]) {
              const position = owner.p.slice();
              position[normalAxis] += outward * (owner.s[normalAxis] + 0.06);
              add(
                "castle-curtain-wall-arrow-slits",
                owner,
                position,
                [0.86, 1.42, 1],
                slitMaterial,
                arrowSlit,
                false,
                normalAxis === 2
                  ? outward < 0
                    ? Math.PI
                    : 0
                  : outward * Math.PI * 0.5,
              );
            }
          }
        }
      }
      if (!watchtower && !castleKeep) continue;
      const masonry = parts
        .filter(
          (part) =>
            part.kind === "block" &&
            (watchtower
              ? part.material === "stone"
              : part.material === "sandstone" &&
                !part.foundation &&
                part.id % 4 === 0) &&
            part.s[0] >= 4 &&
            part.s[2] >= 4 &&
            part.s[1] >= (watchtower ? 3 : 2.5) &&
            (watchtower || part.s[1] <= 6),
        )
        .sort((a, b) => a.p[1] - b.p[1]);
      for (const owner of masonry) {
        const [x, y, z] = owner.p,
          [sx, , sz] = owner.s;
        const key = watchtower
          ? "watchtower-arrow-slits"
          : "castle-keep-arrow-slits";
        const slitScale = watchtower ? [1, 1, 1] : [0.72, 1.12, 1];
        for (const side of [-1, 1]) {
          add(
            key,
            owner,
            [x + side * (sx + 0.035), y, z],
            slitScale,
            slitMaterial,
            arrowSlit,
            false,
            side * Math.PI * 0.5,
          );
          add(
            key,
            owner,
            [x, y, z + side * (sz + 0.035)],
            slitScale,
            slitMaterial,
            arrowSlit,
            false,
            side < 0 ? Math.PI : 0,
          );
        }
      }
      if (castleKeep) {
        const keepWall = parts.filter(
          (part) =>
            part.kind === "block" &&
            part.material === "sandstone" &&
            !part.foundation &&
            part.s[0] >= 4 &&
            part.s[2] >= 4 &&
            part.s[1] >= 2.8 &&
            part.s[1] <= 3.4,
        );
        if (keepWall.length >= 8) {
          const minX = Math.min(...keepWall.map((part) => part.p[0] - part.s[0])),
            maxX = Math.max(...keepWall.map((part) => part.p[0] + part.s[0])),
            minZ = Math.min(...keepWall.map((part) => part.p[2] - part.s[2])),
            maxZ = Math.max(...keepWall.map((part) => part.p[2] + part.s[2])),
            baseY = Math.min(...keepWall.map((part) => part.p[1] - part.s[1])),
            topY = Math.max(...keepWall.map((part) => part.p[1] + part.s[1])),
            ownerNear = (x: number, y: number, z: number) =>
              keepWall.reduce((best, part) => {
                const distance =
                    (part.p[0] - x) ** 2 +
                    (part.p[2] - z) ** 2 +
                    2 * (part.p[1] - y) ** 2,
                  prior =
                    (best.p[0] - x) ** 2 +
                    (best.p[2] - z) ** 2 +
                    2 * (best.p[1] - y) ** 2;
                return distance < prior ? part : best;
              });
          let course = 0;
          for (let y = baseY + 4; y < topY; y += 8, course++) {
            const halfWidth = course === 0 ? 2.2 : course % 2 ? 1.7 : 1.9;
            for (const [x, z] of [
              [minX - 0.25, minZ - 0.25],
              [minX - 0.25, maxZ + 0.25],
              [maxX + 0.25, minZ - 0.25],
              [maxX + 0.25, maxZ + 0.25],
            ])
              add(
                "castle-keep-corner-buttresses",
                ownerNear(x, y, z),
                [x, y, z],
                [halfWidth, 4, halfWidth],
                materials.sandstone ?? materials.stone ?? materials.rock,
                box,
              );
          }
        }
      }
      if (watchtower) {
        const supports = parts.filter(
          (part) =>
            part.kind === "block" &&
            part.material === "wood" &&
            part.s[1] >= 3 &&
            part.s[0] <= 1.5 &&
            part.s[2] >= 5,
        );
        if (supports.length >= 2) {
          const centerX =
              supports.reduce((sum, part) => sum + part.p[0], 0) /
              supports.length,
            centerZ =
              supports.reduce((sum, part) => sum + part.p[2], 0) /
              supports.length,
            supportTop = Math.max(
              ...supports.map((part) => part.p[1] + part.s[1]),
            ),
            deckLevel = supportTop - 1.5,
            ownerNear = (x: number, y: number, z: number) =>
              supports.reduce((best, part) => {
                const score =
                    (part.p[0] - x) ** 2 +
                    (part.p[2] - z) ** 2 +
                    (part.p[1] - y) ** 2 * 2,
                  prior =
                    (best.p[0] - x) ** 2 +
                    (best.p[2] - z) ** 2 +
                    (best.p[1] - y) ** 2 * 2;
                return score < prior ? part : best;
              });
          add(
            "watchtower-gallery-deck",
            ownerNear(centerX, deckLevel, centerZ),
            [centerX, deckLevel + 0.22, centerZ],
            [11, 0.22, 9.5],
            structuralTimber,
          );
          const rails = [
            [centerX, centerZ - 9.2, 10.5, 0.12, 0.12],
            [centerX, centerZ + 9.2, 10.5, 0.12, 0.12],
            [centerX - 10.7, centerZ, 0.12, 0.12, 9],
            [centerX + 10.7, centerZ, 0.12, 0.12, 9],
          ] as const;
          for (const [x, z, sx, sy, sz] of rails)
            for (const lift of [0.65, 1.55])
              add(
                "watchtower-gallery-rails",
                ownerNear(x, deckLevel + lift, z),
                [x, deckLevel + lift, z],
                [sx, sy, sz],
                structuralTimber,
              );
          for (const x of [centerX - 10.7, centerX + 10.7])
            for (const z of [centerZ - 9.2, centerZ + 9.2])
              add(
                "watchtower-gallery-posts",
                ownerNear(x, deckLevel + 0.78, z),
                [x, deckLevel + 0.78, z],
                [0.16, 0.78, 0.16],
                structuralTimber,
              );
        }
      }
    }
    for (const [name, parts] of assemblies) {
      if (!/:(?:tower|gate|flank|rear)-/.test(name)) continue;
      const masonry = parts.filter(
        (part) =>
          part.kind === "block" &&
          part.material === "sandstone" &&
          !part.foundation &&
          part.s[0] >= 2 &&
          part.s[1] >= 2.5 &&
          part.s[2] >= 2,
      );
      if (masonry.length < 8) continue;
      const minX = Math.min(...masonry.map((part) => part.p[0] - part.s[0])),
        maxX = Math.max(...masonry.map((part) => part.p[0] + part.s[0])),
        minZ = Math.min(...masonry.map((part) => part.p[2] - part.s[2])),
        maxZ = Math.max(...masonry.map((part) => part.p[2] + part.s[2])),
        baseY = Math.min(...masonry.map((part) => part.p[1] - part.s[1])),
        topY = Math.max(...masonry.map((part) => part.p[1] + part.s[1])),
        centerX = (minX + maxX) * 0.5,
        centerZ = (minZ + maxZ) * 0.5;
      const ownerNear = (x: number, y: number, z: number) =>
        masonry.reduce((best, part) => {
          const score =
            (part.p[0] - x) ** 2 +
            (part.p[2] - z) ** 2 +
            (part.p[1] - y) ** 2 * 2;
          const prior =
            (best.p[0] - x) ** 2 +
            (best.p[2] - z) ** 2 +
            (best.p[1] - y) ** 2 * 2;
          return score < prior ? part : best;
        });
      for (let y = baseY + 12; y < topY - 8; y += 16) {
        const faces: [number, number, number, [number, number, number]][] = [
          [centerX, y, minZ - 0.08, [(maxX - minX) / 2 + 0.14, 0.12, 0.11]],
          [centerX, y, maxZ + 0.08, [(maxX - minX) / 2 + 0.14, 0.12, 0.11]],
          [minX - 0.08, y, centerZ, [0.11, 0.12, (maxZ - minZ) / 2 + 0.14]],
          [maxX + 0.08, y, centerZ, [0.11, 0.12, (maxZ - minZ) / 2 + 0.14]],
        ];
        for (const [x, courseY, z, size] of faces)
          add(
            "castle-tower-string-courses",
            ownerNear(x, courseY, z),
            [x, courseY, z],
            size,
            materials.sandstone ?? materials.stone ?? materials.rock,
            box,
          );
      }
      // Open-topped towers receive a destructible crenellation ring. Roofed
      // towers keep their existing slate silhouette clear.
      const hasRoof = parts.some(
        (part) => part.kind === "block" && part.material === "slate",
      );
      if (!hasRoof) {
        const addMerlons = (start: number, end: number, z: number, alongX: boolean) => {
          for (let along = start + 2.5; along < end - 2.5; along += 4.8) {
            const x = alongX ? along : z,
              faceZ = alongX ? z : along,
              owner = ownerNear(x, topY, faceZ);
            add(
              "castle-tower-merlons",
              owner,
              [x, topY + 1.15, faceZ],
              [0.95, 1.15, 0.95],
              materials.sandstone ?? materials.stone ?? materials.rock,
              box,
            );
          }
        };
        addMerlons(minX, maxX, minZ, true);
        addMerlons(minX, maxX, maxZ, true);
        addMerlons(minZ, maxZ, minX, false);
        addMerlons(minZ, maxZ, maxX, false);
      }
    }
    for (const [name, parts] of assemblies) {
      if (!/lighthouse/.test(name)) continue;
      const lanterns = parts.filter(isLighthouseLanternGlazing);
      for (const owner of lanterns) {
        const [x, y, z] = owner.p,
          [sx, sy, sz] = owner.s,
          inset = 0.035,
          lensRadius = Math.min(sx, sz) * 0.29,
          lensHeight = sy * 0.68;
        for (const sideX of [-1, 1])
          for (const sideZ of [-1, 1])
            add(
              "lighthouse-lantern-frames",
              owner,
              [x + sideX * (sx + inset), y, z + sideZ * (sz + inset)],
              [0.12, sy, 0.12],
              iron,
            );
        for (const side of [-1, 1]) {
          add(
            "lighthouse-lantern-glazing",
            owner,
            [x, y, z + side * (sz + 0.018)],
            [sx, sy, 1],
            lighthouseGlass,
            lighthouseGlassPane,
          );
          add(
            "lighthouse-lantern-glazing",
            owner,
            [x + side * (sx + 0.018), y, z],
            [sz, sy, 1],
            lighthouseGlass,
            lighthouseGlassPane,
            false,
            Math.PI / 2,
          );
        }
        for (const lift of [-1, 1]) {
          const railY = y + lift * (sy - 0.08);
          for (const side of [-1, 1]) {
            add(
              "lighthouse-lantern-frames",
              owner,
              [x, railY, z + side * (sz + inset)],
              [sx + 0.12, 0.08, 0.08],
              iron,
            );
            add(
              "lighthouse-lantern-frames",
              owner,
              [x + side * (sx + inset), railY, z],
              [0.08, 0.08, sz + 0.12],
              iron,
            );
          }
        }
        // A compact Fresnel drum gives the lantern room a readable focal
        // element. Its glass and brass fittings belong to the existing
        // glazing block, so damage and restoration remain authoritative.
        add(
          "lighthouse-fresnel-glass",
          owner,
          [x, y, z],
          [lensRadius, lensHeight * 0.5, lensRadius],
          lighthouseLens,
          lighthouseLensGlass,
        );
        for (const lift of [-0.38, 0, 0.38])
          add(
            "lighthouse-fresnel-hoops",
            owner,
            [x, y + lensHeight * lift, z],
            [lensRadius * 1.08, 1, lensRadius * 1.08],
            lighthouseBrass,
            lighthouseLensHoop,
          );
        for (let rib = 0; rib < 8; rib++) {
          const angle = (rib * Math.PI) / 4;
          add(
            "lighthouse-fresnel-cage",
            owner,
            [
              x + Math.sin(angle) * lensRadius * 1.05,
              y,
              z + Math.cos(angle) * lensRadius * 1.05,
            ],
            [0.045, lensHeight * 0.46, 0.045],
            lighthouseBrass,
            box,
            false,
            angle,
          );
        }
      }
    }
    for (const e of world.entities) {
      if (
        e.kind !== "block" ||
        !e.foundation ||
        dressed.has(e.assembly) ||
        !/-(house|warehouse)(-|$)/.test(e.assembly)
      )
        continue;
      const siblings = assemblies.get(e.assembly)!;
      const roofs = siblings.filter(
        (part) => part.material === "roof" || part.material === "slate",
      );
      if (!roofs.length) continue;
      dressed.add(e.assembly);
      const x =
        Math.max(...siblings.map((part) => part.p[0] + part.s[0])) + 2.5;
      const z = roofs.reduce((sum, part) => sum + part.p[2], 0) / roofs.length;
      const h = terrain.sample(x, z);
      if (
        h < 2 ||
        this.wet(x, z) ||
        roads(x, z) < 6 ||
        Math.abs(h - terrain.sample(x + 2, z)) > 0.8
      )
        continue;
      for (let i = 0; i < 3; i++) {
        const px = x + (i === 2 ? 0 : i * 1.65),
          py = h + (i === 2 ? 2.1 : 0.7),
          pz = z + (i === 2 ? 0.12 : 0);
        add(
          "settlement-crates",
          e,
          [px, py, pz],
          [0.72, 0.7, 0.65],
          materials.wood,
          box,
          true,
        );
        for (const sign of [-1, 1])
          add(
            "crate-straps",
            e,
            [px + sign * 0.43, py, pz],
            [0.055, 0.73, 0.68],
            materials.rock,
            box,
            true,
          );
      }
    }
    const owners = new Map(world.entities.map((entity) => [entity.id, entity]));
    for (const window of windowSources) {
      const owner = owners.get(window.owner);
      if (!owner) continue;
      addWindow({
        ...owner,
        p: window.p,
        s: window.s.map((value) => value / 2) as Entity["s"],
        material: "window",
      });
    }
    for (const [key, list] of lists) {
      const mesh = new THREE.InstancedMesh(
        list.geometry,
        list.material,
        list.pieces.length,
      );
      mesh.name = `scenery:${key}`;
      list.pieces.forEach((piece, i) => mesh.setMatrixAt(i, piece.matrix));
      mesh.count = 0;
      mesh.matrixAutoUpdate = false;
      mesh.frustumCulled = false;
      mesh.receiveShadow = true;
      const cells = new Map<string, Piece[]>();
      for (const piece of list.pieces) {
        const key = `${Math.floor(piece.p.x / 128)}:${Math.floor(piece.p.z / 128)}`;
        let entries = cells.get(key);
        if (!entries) cells.set(key, (entries = []));
        entries.push(piece);
      }
      this.batches.push({
        mesh,
        pieces: list.pieces,
        cells,
        ground: list.ground,
      });
      this.group.add(mesh);
    }
  }
  private wet(x: number, z: number) {
    const gx = Math.round(x / CONFIG.spacing),
      gz = Math.round(z / CONFIG.spacing);
    return (
      gx >= 0 &&
      gz >= 0 &&
      gx < CONFIG.grid &&
      gz < CONFIG.grid &&
      !!this.terrain.flood?.[gz * CONFIG.grid + gx]
    );
  }
  update(
    camera: THREE.Vector3,
    removed: Set<number>,
    distance: number,
    foliageDistance: number,
    time: number,
    force = false,
  ) {
    this.wind.value = time;
    if (!force && time < this.next) return;
    this.next = time + 0.25;
    for (const batch of this.batches) {
      let count = 0;
      const range = batch.ground
        ? Math.min(120, foliageDistance)
        : Math.min(450, distance);
      for (
        let z = Math.floor((camera.z - range) / 128);
        z <= Math.floor((camera.z + range) / 128);
        z++
      )
        for (
          let x = Math.floor((camera.x - range) / 128);
          x <= Math.floor((camera.x + range) / 128);
          x++
        )
          for (const piece of batch.cells.get(`${x}:${z}`) ?? []) {
            if (
              removed.has(piece.owner) ||
              Math.abs(piece.p.x - camera.x) > range ||
              Math.abs(piece.p.z - camera.z) > range ||
              piece.p.distanceToSquared(camera) > range * range
            )
              continue;
            if (batch.ground) {
              const h = this.terrain.sample(piece.p.x, piece.p.z);
              if (
                h < 2 ||
                this.wet(piece.p.x, piece.p.z) ||
                Math.abs(h - (piece.p.y - piece.offset)) > 2
              )
                continue;
              piece.matrix.elements[13] = h + piece.offset;
            }
            batch.mesh.setMatrixAt(count++, piece.matrix);
          }
      batch.mesh.count = count;
      batch.mesh.visible = count > 0;
      batch.mesh.instanceMatrix.needsUpdate = true;
      batch.mesh.instanceMatrix.clearUpdateRanges();
      if (count) batch.mesh.instanceMatrix.addUpdateRange(0, count * 16);
    }
  }
}
