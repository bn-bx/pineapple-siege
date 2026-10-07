import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { HarborLadders, harborLadderPlacements } from "../src/render/harbor-ladders";

function harborWorld() {
  return {
    sites: [
      { id: "harbor-1", kind: "harbor", p: [0, 0, 0] },
      { id: "harbor-2", kind: "harbor", p: [100, 0, 0] },
    ],
    entities: [
      ...[
        { id: 1, p: [4, 5, 0] },
        { id: 2, p: [8, 5, 0] },
      ].map((part) => ({
        ...part,
        kind: "block",
        material: "wood",
        s: [2, 0.5, 5],
        assembly: "harbor-1-dock",
      })),
      ...[
        { id: 3, p: [104, 5, 0] },
        { id: 4, p: [108, 5, 0] },
      ].map((part) => ({
        ...part,
        kind: "block",
        material: "wood",
        s: [2, 0.5, 5],
        assembly: "harbor-2-dock",
      })),
    ],
  } as any;
}

describe("harbor water access", () => {
  it("places ladders only at the far wet dock end and rejects distant water", () => {
    const world = harborWorld(),
      placements = harborLadderPlacements(world, (x) =>
        x > 9 && x <= 10 ? 0 : undefined,
      );
    expect(placements).toHaveLength(1);
    expect(placements[0]).toMatchObject({
      owner: 2,
      alongX: true,
      direction: 1,
      height: expect.closeTo(5.28, 2),
    });
  });

  it("follows the terminal deck owner through removal and restoration", () => {
    const world = harborWorld(),
      ladders = new HarborLadders(
        world,
        { waterSurface: (x: number) => (x > 9 && x <= 11 ? 0 : undefined) } as any,
        new THREE.MeshStandardMaterial({ color: "#76583b" }),
      );
    ladders.refresh();
    expect(ladders.group.children).toHaveLength(2);
    const meshes = ladders.group.children as THREE.InstancedMesh[],
      camera = new THREE.Vector3(100, 12, 0);
    ladders.update(camera, new Set([2]), 1200);
    expect(meshes.every((mesh) => !mesh.visible)).toBe(true);
    ladders.update(camera, new Set(), 1200);
    expect(meshes.every((mesh) => mesh.visible)).toBe(true);
    expect(meshes[1].count).toBeGreaterThan(8);
    ladders.dispose();
  });

  it("finds the actual wet terminal decks in the reference island", async () => {
    const [{ generateIsland }, { Terrain }] = await Promise.all([
      import("../src/world/generator.mjs"),
      import("../src/sim/terrain"),
    ]);
    const { world, heights } = generateIsland(41729),
      terrain = new Terrain(heights, world.rivers);
    terrain.initializeFlood();
    const placements = harborLadderPlacements(world, (x, z) =>
      terrain.surfaceHeight(x, z),
    );
    expect(placements.length).toBeGreaterThan(0);
    expect(placements.every((placement) => placement.height > 1.1)).toBe(true);
    expect(placements.map((placement) => placement.owner)).toEqual([
      11808, 11973,
    ]);
    const ladders = new HarborLadders(
      world,
      { waterSurface: (x: number, z: number) => terrain.surfaceHeight(x, z) } as any,
      new THREE.MeshStandardMaterial(),
    );
    ladders.refresh();
    expect(ladders.group.children).toHaveLength(placements.length * 2);
    ladders.dispose();
  });
});
