import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { createArchitecture } from "../src/world/architecture.mjs";
import {
  baselineKey,
  parseIslandCode,
  planIsland,
  seedCode,
} from "../src/world/generator.mjs";

it("preserves PS6 geography while giving new islands distinct identity and rolling lowlands", () => {
  const old = planIsland(parseIslandCode("PS6-0000A301"));
  const current = planIsland(41729);
  expect(
    createHash("sha256")
      .update(new Uint8Array((old.baseHeights as Float32Array).buffer))
      .digest("hex"),
  ).toBe("1d43028b89a5499935ba51083a3985d5fd99b85d25f007a59e33548727eb8b09");
  expect(seedCode(current.request)).toBe("PS7-0000A301");
  expect(parseIslandCode(seedCode(current.request))).toEqual(current.request);
  expect(
    baselineKey({ seed: 41729, generatorVersion: 7, version: 13 }),
  ).not.toBe(baselineKey({ seed: 41729, generatorVersion: 6, version: 12 }));

  // Measure actual lowland slopes before roads and terraces alter the surface.
  // Raising a flat plateau or adding isolated peaks cannot satisfy this check.
  const lowlandSlope = (p: typeof current) => {
    const h = p.baseHeights as Float32Array;
    let sum = 0,
      count = 0;
    for (let z = 1; z < p.grid - 1; z++)
      for (let x = 1; x < p.grid - 1; x++) {
        const i = z * p.grid + x;
        if (h[i] <= 5 || h[i] >= 150) continue;
        sum +=
          Math.hypot(h[i + 1] - h[i - 1], h[i + p.grid] - h[i - p.grid]) /
          (2 * p.step);
        count++;
      }
    expect(count).toBeGreaterThan(20000);
    return sum / count;
  };
  expect(lowlandSlope(current)).toBeGreaterThan(lowlandSlope(old) * 1.4);
  expect(current.castles).toHaveLength(5);
}, 60000);

it("keeps watchtower rails attached when road grading changes the reserved site height", () => {
  const layout = {
    sites: [{ id: "watchtower-1", kind: "watchtower", p: [100, 250, 100] }],
    castles: [],
  };
  const { entities } = createArchitecture(
    layout,
    () => 200,
    () => 0.5,
    true,
  );
  const reached = new Set(
    entities.filter((e) => e.foundation).map((e) => e.id),
  );
  for (let pass = 0; pass < entities.length; pass++)
    for (const e of entities)
      if (reached.has(e.id))
        for (const support of e.supports) reached.add(support);
  expect(reached.size).toBe(entities.length);
  expect(entities.slice(-2).map((e) => e.p[1])).toEqual([236, 236]);
  // Existing shared codes retain their original fixture coordinates.
  expect(
    createArchitecture(
      layout,
      () => 200,
      () => 0.5,
    )
      .entities.slice(-2)
      .map((e) => e.p[1]),
  ).toEqual([286, 286]);
});
