import { expect, it } from "vitest";
import * as THREE from "three";
import { setTreeCanopyColor, treeCanopyScale } from "../src/render/tree-appearance";

it.each(["pine", "broadleaf", "riverside"] as const)(
  "varies %s crown proportions deterministically within a restrained range",
  (treeSpecies) => {
    const tree = {
        s: [3, 12, 3] as [number, number, number],
        treeSpecies,
        variant: 0.37,
      },
      first = treeCanopyScale(tree),
      repeated = treeCanopyScale(tree),
      other = treeCanopyScale({ ...tree, variant: 0.83 });
    expect(repeated).toEqual(first);
    expect(other).not.toEqual(first);
    expect(first[0]).toBeGreaterThan(3 * 1.45 * 0.76);
    expect(first[0]).toBeLessThan(3 * 1.45 * 1.24);
    expect(first[1]).toBeGreaterThan(12 * 2 * 0.8);
    expect(first[1]).toBeLessThan(12 * 2 * 1.2);
    expect(first[2]).toBeGreaterThan(3 * 1.45 * 0.74);
    expect(first[2]).toBeLessThan(3 * 1.45 * 1.26);
  },
);

it("keeps tree color variation deterministic and distinct across species and seeds", () => {
  const color = new THREE.Color(),
    pineA = setTreeCanopyColor(color.clone(), {
      treeSpecies: "pine",
      variant: 0.22,
    }),
    pineB = setTreeCanopyColor(color.clone(), {
      treeSpecies: "pine",
      variant: 0.82,
    }),
    broadleaf = setTreeCanopyColor(color.clone(), {
      treeSpecies: "broadleaf",
      variant: 0.22,
    });
  expect(pineA.equals(pineB)).toBe(false);
  expect(pineA.equals(broadleaf)).toBe(false);
  expect(pineA.getHSL({ h: 0, s: 0, l: 0 }).s).toBeGreaterThan(0.2);
});
