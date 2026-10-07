import { expect, it } from "vitest";
import { createReviewSnapshot } from "../src/render/review-snapshot";
import type { SimulationSnapshot } from "../src/types";
it("keeps inspection data intact when the worker's original slot is recycled", () => {
  const buffer = new ArrayBuffer(16);
  new Float32Array(buffer)[0] = 42;
  const source = {
    epoch: 1,
    slot: 2,
    packedBodies: { buffer },
    lasers: [],
  } as unknown as SimulationSnapshot;
  const review = createReviewSnapshot(source, { lasers: [] });
  structuredClone(buffer, { transfer: [buffer] });
  expect(buffer.byteLength).toBe(0);
  expect(review.epoch).toBeUndefined();
  expect(review.slot).toBeUndefined();
  expect(new Float32Array(review.packedBodies!.buffer)[0]).toBe(42);
});
