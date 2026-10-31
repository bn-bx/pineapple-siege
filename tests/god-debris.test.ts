import { expect, it } from "vitest";
import * as THREE from "three";
import { decodeSolid, GodWounds } from "../src/render/god-solid";
import {
  fractureStatueBox,
  SCULPT_PIECE_LIMIT,
  statuePieceBox,
  statuePieceCell,
} from "../src/sim/statue-fracture";
import { packBodies, unpackBodies } from "../src/sim/body-buffer";
import type { BodyView, Vec3 } from "../src/types";

it("names every sculpture piece by a distinct cell that recovers its box", () => {
  const p: Vec3 = [4100.25, 512.5, 4800.75],
    s: Vec3 = [37.5, 91.25, 12.125];
  for (let count = 1; count <= SCULPT_PIECE_LIMIT; count++) {
    const pieces = fractureStatueBox(p, s, count, 0);
    const cells = pieces.map((part) => statuePieceCell(p, s, part.p, part.s));
    expect(new Set(cells.map((c, i) => `${pieces[i].s}:${c}`)).size).toBe(
      pieces.length,
    );
    for (const [i, part] of pieces.entries()) {
      expect(cells[i]).toBeLessThan(SCULPT_PIECE_LIMIT);
      // Packets carry sizes as float32.
      const size = [...Float32Array.from(part.s)] as Vec3;
      const { min, max } = statuePieceBox(p, s, size, cells[i]);
      for (let k = 0; k < 3; k++) {
        expect(min[k]).toBeCloseTo(part.p[k] - part.s[k], 3);
        expect(max[k]).toBeCloseTo(part.p[k] + part.s[k], 3);
      }
    }
  }
});

it("packs sculpture pieces beside roof wedges without confusing them", () => {
  const body = (extra: Partial<BodyView>): BodyView => ({
    id: 1,
    source: 7,
    p: [1, 2, 3],
    q: [0, 0, 0, 1],
    s: [1, 1, 1],
    material: "stone",
    kind: "chunk",
    ...extra,
  });
  const views = [
    body({ id: 1, piece: 0 }),
    body({ id: 2, piece: SCULPT_PIECE_LIMIT - 1, material: "sandstone" }),
    body({ id: 3, material: "roof", roofPart: 3 }),
    body({ id: 4 }),
  ];
  const [a, b, c, d] = unpackBodies(packBodies(views, views.length));
  expect([a.piece, a.roofPart]).toEqual([0, undefined]);
  expect([b.piece, b.roofPart]).toEqual([SCULPT_PIECE_LIMIT - 1, undefined]);
  expect([c.piece, c.roofPart]).toEqual([undefined, 3]);
  expect([d.piece, d.roofPart]).toEqual([undefined, undefined]);
});

it("exposes stone only where a drawn owner borders a broken one", () => {
  // Owners along x: 0 0 1 2, then air. Owner 2 is not drawn in this realm.
  const solid = decodeSolid(
    { revision: "r", size: 5, origin: [0, 0, 0], dims: [5, 1, 1] },
    new Uint16Array([1, 2, 2, 1, 3, 1, 0, 1]),
  );
  expect([...solid.voxels.get(0)!]).toEqual([0, 1]);
  const wounds = new GodWounds(
    solid,
    (owner) => owner !== 2,
    new THREE.MeshBasicMaterial(),
  );
  const triangles = () => {
    wounds.update();
    return (wounds.mesh.geometry.getAttribute("position")?.count ?? 0) / 3;
  };
  expect(triangles()).toBe(0);
  wounds.remove(1);
  // Owner 0's face toward the broken owner; nothing faces undrawn owner 2.
  expect(triangles()).toBe(2);
  const x = wounds.mesh.geometry.getAttribute("position").getX(0);
  expect(Math.abs(x - 10)).toBeLessThanOrEqual(5 * 0.35);
  wounds.remove(2);
  expect(triangles()).toBe(2);
  wounds.remove(0);
  expect(triangles()).toBe(0);
  wounds.reset();
  expect(triangles()).toBe(0);
});
