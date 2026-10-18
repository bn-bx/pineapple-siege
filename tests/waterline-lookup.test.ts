import { expect, it } from "vitest";
import { WaterSurfaceLookup } from "../src/render/waterline-lookup";

it("resolves river heights by local segment and ocean height from the wet mask", () => {
  const water = new WaterSurfaceLookup(
    [
      {
        id: "test-river",
        width: 8,
        points: [
          [100, 5, 100],
          [180, 9, 100],
        ],
      },
    ],
    256,
    64,
  );
  expect(water.sample(140, 100, 0, true)).toBeCloseTo(7);
  expect(water.sample(140, 110, 1, true)).toBeUndefined();
  expect(water.sample(20, 20, -5, true)).toBe(0);
  expect(water.sample(20, 20, -5, false)).toBeUndefined();
  expect(water.sample(-1, 20, -5, true)).toBeUndefined();
});

it.each([250, 256])(
  "includes world edges and rejects outside samples for size %i",
  (size) => {
    const water = new WaterSurfaceLookup(
      [
        {
          id: "edge-river",
          width: 8,
          points: [
            [size - 20, 5, size],
            [size, 9, size],
          ],
        },
      ],
      size,
      64,
    );
    expect(water.sample(size, size, 0, true)).toBe(9);
    expect(water.sample(size - 10, size, 0, true)).toBe(7);
    expect(water.sample(size, 20, -5, true)).toBe(0);
    expect(water.sample(20, size, -5, true)).toBe(0);
    expect(water.sample(size + 1, 20, -5, true)).toBeUndefined();
    expect(water.sample(20, size + 1, -5, true)).toBeUndefined();
  },
);
