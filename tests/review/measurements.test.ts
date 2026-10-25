import { expect, it } from "vitest";
import { compareLandmarks, maskOverlap } from "../../src/review/measurements";
it("never passes incomplete facial observations", () => {
  const ref = { eye: [10, 10], chin: [20, 20] };
  expect(
    compareLandmarks(ref, { eye: [10, 10] }, Object.keys(ref), 200).pass,
  ).toBe(false);
  expect(compareLandmarks(ref, {}, Object.keys(ref), 200).mean).toBe(null);
});
it("flags one bad landmark even when the average error is small", () => {
  const ref = Object.fromEntries(
    Array.from({ length: 16 }, (_, i) => ["p" + i, [10, 10]]),
  );
  const observed = structuredClone(ref);
  observed.p0 = [15, 10];
  const result = compareLandmarks(ref, observed, Object.keys(ref), 200);
  expect(result.mean).toBeLessThan(0.01);
  expect(result.max).toBeGreaterThan(0.02);
  expect(result.pass).toBe(false);
});
it("checks masked pixels and does not pass empty masks", () => {
  const white = [255, 255, 255, 255],
    black = [0, 0, 0, 255];
  expect(maskOverlap([...white, ...white], [...white, ...black])).toBe(0.5);
  expect(
    maskOverlap(
      [...white, ...white],
      [...white, ...black],
      [...white, ...black],
    ),
  ).toBe(1);
  expect(maskOverlap(black, black)).toBe(0);
  expect(() => maskOverlap(white, [])).toThrow();
});
