import { expect, it } from "vitest";
import { treeCanopyScale } from "../src/render/tree-appearance";

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
    expect(first[0]).toBeGreaterThan(3 * 1.45 * 0.88);
    expect(first[0]).toBeLessThan(3 * 1.45 * 1.12);
    expect(first[1]).toBeGreaterThan(12 * 2 * 0.93);
    expect(first[1]).toBeLessThan(12 * 2 * 1.07);
    expect(first[2]).toBeGreaterThan(3 * 1.45 * 0.85);
    expect(first[2]).toBeLessThan(3 * 1.45 * 1.16);
  },
);
