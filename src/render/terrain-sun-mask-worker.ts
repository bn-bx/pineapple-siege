/// <reference lib="webworker" />
import { computeSunMask, maxOf } from "./terrain-sun-mask-core";

/** Keeps the latest caster grid; each request only sends heights when they change. */
let heights: Float32Array | undefined;
let maxHeight = 0;
self.onmessage = (event: MessageEvent) => {
  const m = event.data as {
    id: number;
    n: number;
    cell: number;
    light: { x: number; y: number; z: number };
    heights?: Float32Array;
  };
  if (m.heights) {
    heights = m.heights;
    maxHeight = maxOf(heights);
  }
  if (!heights) return;
  const started = performance.now();
  const mask = computeSunMask(heights, m.n, m.cell, m.light, undefined, maxHeight);
  (self as unknown as Worker).postMessage(
    { id: m.id, mask, ms: performance.now() - started },
    [mask.buffer],
  );
};
