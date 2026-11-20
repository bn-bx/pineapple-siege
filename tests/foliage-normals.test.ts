import { expect, it } from "vitest";
import * as THREE from "three";
import { treeCrownGeometry, treeCrownLowGeometry } from "../src/render/assets";
import { deadTreeGeometry } from "../src/render/dead-tree";
import { grassClumpGeometry } from "../src/render/grass-field";
import { DYNAMIC_LIGHTS_FRAGMENT } from "../src/render/dynamic-lights";

// A zero normal becomes NaN after normalize() in the shader and renders black,
// most visibly under fire light.
it.each(["pine", "broadleaf", "riverside", "palm"] as const)(
  "gives every %s tree vertex a finite, non-zero normal at every detail level",
  (species) => {
    for (const geometry of [
      treeCrownGeometry(species),
      treeCrownLowGeometry(species),
      deadTreeGeometry(species),
      deadTreeGeometry(species, true),
    ]) {
      if (!geometry.attributes.normal) geometry.computeVertexNormals();
      const normals = geometry.attributes.normal,
        n = new THREE.Vector3();
      for (let i = 0; i < normals.count; i++) {
        n.fromBufferAttribute(normals, i);
        expect(Number.isFinite(n.x + n.y + n.z)).toBe(true);
        expect(n.length()).toBeGreaterThan(0.5);
      }
      geometry.dispose();
    }
  },
);

it("keeps grass normals defined", () => {
  const normals = grassClumpGeometry().attributes.normal;
  for (let i = 0; i < normals.count; i++) expect(normals.getY(i)).toBe(1);
});

it("guards fire lighting against NaN on fully rough surfaces", () => {
  // shine must stay positive (pow(0, 0) is undefined) and the half-vector
  // must never be normalized from zero.
  expect(DYNAMIC_LIGHTS_FRAGMENT).toMatch(/shine = max\(/);
  expect(DYNAMIC_LIGHTS_FRAGMENT).toMatch(/inversesqrt\( max\(/);
  expect(DYNAMIC_LIGHTS_FRAGMENT).not.toMatch(/normalize\( l \+ geometryViewDir \)/);
});
