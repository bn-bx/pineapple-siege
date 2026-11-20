import { expect, it } from "vitest";
import * as THREE from "three";
import {
  setTreeCanopyColor,
  treeCanopyScale,
} from "../src/render/tree-appearance";

it.each(["pine", "broadleaf", "riverside", "palm"] as const)(
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
    expect(first[0]).toBeGreaterThan(3 * 2.35 * 0.65);
    expect(first[0]).toBeLessThan(3 * 2.35 * 1.31);
    expect(first[1]).toBeGreaterThan(12 * 2.45 * 0.75);
    expect(first[1]).toBeLessThan(12 * 2.45 * 1.3);
    expect(first[2]).toBeGreaterThan(3 * 2.35 * 0.65);
    expect(first[2]).toBeLessThan(3 * 2.35 * 1.31);
  },
);

it.each(["pine", "broadleaf", "riverside", "palm"] as const)(
  "keeps %s crown width, depth, and height variation independent",
  (treeSpecies) => {
    const crowns = Array.from({ length: 16 }, (_, i) =>
      treeCanopyScale({
        s: [3, 12, 3],
        treeSpecies,
        variant: i / 15,
      }),
    );
    expect(
      new Set(crowns.map((shape) => shape.join(":"))).size,
    ).toBeGreaterThan(12);
    for (const shape of crowns)
      expect(shape.every((scale) => Number.isFinite(scale) && scale > 0)).toBe(
        true,
      );
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

it("gives neighbouring trees a shared stand tint and distant stands a different one", () => {
  const hsl = (p: number[], variant = 0.5) =>
    setTreeCanopyColor(new THREE.Color(), {
      treeSpecies: "broadleaf",
      variant,
      p,
    }).getHSL({ h: 0, s: 0, l: 0 });
  const a = hsl([1010, 40, 1010]),
    neighbour = hsl([1040, 40, 1045]);
  expect(neighbour).toEqual(a);
  const stands = new Set(
    Array.from({ length: 12 }, (_, i) => hsl([i * 400 + 10, 40, 2010]).h.toFixed(4)),
  );
  expect(stands.size).toBeGreaterThan(6);
  // Unplaced trees (no position) still color deterministically.
  expect(
    setTreeCanopyColor(new THREE.Color(), { treeSpecies: "palm", variant: 0.3 }),
  ).toEqual(setTreeCanopyColor(new THREE.Color(), { treeSpecies: "palm", variant: 0.3 }));
});
