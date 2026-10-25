import { expect, it } from "vitest";
import * as THREE from "three";
import { treeCrownGeometry, treeCrownLowGeometry } from "../src/render/assets";
import { IslandHorizon } from "../src/render/island-horizon";
import type { WorldData } from "../src/types";

it("preserves each species silhouette and baked crown shading beyond the detail distance", () => {
  const entities = (["pine", "broadleaf", "riverside"] as const).map(
    (treeSpecies, id) => ({
      id,
      kind: "tree",
      material: "foliage",
      treeSpecies,
      p: [3000 + id * 30, 30, 3000],
      s: [3, 12, 3],
      variant: 0.5,
    }),
  );
  const horizon = new IslandHorizon(
    { entities } as unknown as WorldData,
    [{ allIds: [0, 1, 2], kind: "pine", x: 3030, z: 3000, radius: 100 }],
    { foliage: new THREE.MeshStandardMaterial() } as any,
  );
  for (const [index, entity] of entities.entries()) {
    const high = treeCrownGeometry(entity.treeSpecies);
    const low = treeCrownLowGeometry(entity.treeSpecies);
    const distant = horizon.group.children[index] as THREE.InstancedMesh<
      THREE.BufferGeometry,
      THREE.MeshStandardMaterial
    >;
    expect(distant.geometry.attributes.position.array).toEqual(
      low.attributes.position.array,
    );
    expect(distant.geometry.attributes.color.array).toEqual(
      low.attributes.color.array,
    );
    expect(distant.material.vertexColors).toBe(true);
    // Keep the whole-island pass bounded even with 30,000 trees.
    expect(low.attributes.position.count / 3).toBeLessThanOrEqual(90);
    expect(low.attributes.position.count).toBeLessThan(
      high.attributes.position.count,
    );
    for (const geometry of [high, low]) {
      geometry.computeBoundingBox();
      expect(geometry.boundingBox!.min.y).toBeGreaterThanOrEqual(-0.00001);
      expect(geometry.boundingBox!.max.y).toBeLessThanOrEqual(1.1);
      expect(geometry.attributes.color.count).toBe(
        geometry.attributes.position.count,
      );
      geometry.dispose();
    }
    distant.geometry.dispose();
    distant.material.dispose();
  }
});

it("moves leaf tips while keeping bark rigid and composes wind with existing shader hooks", async () => {
  const { installFoliageMotion } = await import("../src/render/foliage-motion");
  const clock = { value: 3 };
  const material = new THREE.MeshStandardMaterial();
  material.onBeforeCompile = (shader) => {
    shader.uniforms.existing = { value: 7 };
  };
  installFoliageMotion(material, clock);
  const shader = {
    uniforms: {},
    vertexShader: "void main() {\n#include <begin_vertex>\n}",
  } as any;
  material.onBeforeCompile(shader, {} as any);
  expect(shader.uniforms.existing.value).toBe(7);
  expect(shader.uniforms.foliageTime).toBe(clock);
  clock.value = 4;
  expect(shader.uniforms.foliageTime.value).toBe(4);
  expect(shader.vertexShader).toContain("instanceMatrix[3].xz");
  expect(shader.vertexShader).toContain("breeze * foliageFlex");
  for (const species of ["pine", "broadleaf", "riverside"] as const) {
    const geometry = treeCrownGeometry(species);
    const flex = geometry.attributes.foliageFlex;
    const colors = geometry.attributes.color;
    let movingLeaves = 0;
    for (let i = 0; i < flex.count; i++) {
      if (colors.getY(i) < colors.getX(i) * 0.9) expect(flex.getX(i)).toBe(0);
      else if (flex.getX(i) > 0.1) movingLeaves++;
    }
    expect(movingLeaves).toBeGreaterThan(0);
    geometry.dispose();
  }
  material.dispose();
});
