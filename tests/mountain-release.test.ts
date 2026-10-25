import { beforeAll, expect, it } from "vitest";
import { Color } from "three";
import { readFileSync } from "node:fs";
import {
  generateIsland,
  parseIslandCode,
  validateIsland,
  sampleHeight,
  parseSeedCode,
  seedCode,
} from "../src/world/generator.mjs";
import { AltitudeWarning } from "../src/altitude-warning";
import { terrainSurfaceColor } from "../src/render/terrain-colors";
import { CONFIG, LASER } from "../src/config";
import { Simulation, initializePhysics } from "../src/sim/simulation";
import { compatible } from "../src/storage";
import type { WorldData } from "../src/types";

it("rejects old shared layouts and identifies the new generator", () => {
  expect(() => parseSeedCode("PS1-0000002A")).toThrow(/older/);
  expect(seedCode(parseIslandCode("PS4-0000002A"))).toBe("PS4-0000002A");
  expect(seedCode(42, 1)).toBe("PS1-0000002A");
  expect(() => parseSeedCode("PS2-0000002A")).toThrow();
  expect(() => parseSeedCode("PS3-0000002A")).toThrow(/older/);
});
it("uses sea-level ceiling warnings with independent 25-meter hysteresis", () => {
  const warning = new AltitudeWarning();
  expect(warning.update(1249)).toBe("");
  expect(warning.update(1250)).toBe("APPROACHING FLIGHT CEILING");
  expect(warning.update(1225)).toBe("APPROACHING FLIGHT CEILING");
  expect(warning.update(1224)).toBe("");
  expect(warning.update(1350)).toBe("CEILING ASSISTANCE");
  expect(warning.update(1325)).toBe("CEILING ASSISTANCE");
  expect(warning.update(1324)).toBe("APPROACHING FLIGHT CEILING");
  warning.reset();
  expect(warning.update(1200)).toBe("");
  expect(CONFIG.ceiling).toBe(1500);
  expect(LASER.top).toBeGreaterThan(CONFIG.ceiling);
});
it("exposes rock on steep faces and scree on elevated slopes without whitening lowlands", () => {
  const grass = new Color(),
    cliff = new Color(),
    scree = new Color(),
    peak = new Color();
  terrainSurfaceColor(grass, 123, 456, 50, 0.05);
  terrainSurfaceColor(cliff, 123, 456, 50, 1.2);
  terrainSurfaceColor(scree, 123, 456, 500, 0.35);
  terrainSurfaceColor(peak, 123, 456, 900, 0.05);
  expect(grass.g).toBeGreaterThan(grass.r);
  expect(cliff.b).toBeGreaterThan(grass.b);
  expect(scree.b).toBeGreaterThan(grass.b);
  expect(peak.b).toBeGreaterThan(scree.b);
});
const seeds = [
  0,
  1,
  42,
  2026,
  4294967295,
  41729,
  ...Array.from({ length: 26 }, (_, i) => Math.imul(i + 1, 2654435761) >>> 0),
];
const mountainCounts = new Set<number>();
const summits: [number, number][] = [];
// Bound each seed independently instead of timing all 32 layouts as one test.
it.each(seeds)(
  "generates safe mountains and the Pineapple God for seed %i",
  (seed) => {
    const { world, heights } = generateIsland(seed);
    const metrics = validateIsland(world, heights);
    expect(metrics.landFraction, `seed ${seed}`).toBeGreaterThanOrEqual(0.35);
    expect(metrics.landFraction, `seed ${seed}`).toBeLessThanOrEqual(0.72);
    expect(metrics.peak, `seed ${seed}`).toBeGreaterThanOrEqual(700);
    expect(metrics.peak).toBeLessThanOrEqual(1000);
    const gods = world.sites.filter((s) => s.kind === "pineapple-god");
    expect(gods).toHaveLength(1);
    const god = gods[0];
    for (const e of world.entities.filter((e) => e.visual)) {
      expect(e.p[1] + e.s[1]).toBeLessThan(CONFIG.ceiling);
      if (e.foundation)
        expect(sampleHeight(heights, e.p[0], e.p[2])).toBeGreaterThanOrEqual(
          e.p[1] - e.s[1] - 1.4,
        );
    }
    for (const s of world.sites.filter((s) => s !== god))
      expect(Math.hypot(s.p[0] - god.p[0], s.p[2] - god.p[2])).toBeGreaterThan(
        god.radius + s.radius,
      );
    // Measure the resulting geography, not just the random layout parameters.
    const side = world.size / 64 + 1,
      mask = new Uint8Array(side * side);
    let highest = -Infinity,
      summit: [number, number] = [0, 0];
    for (let z = 0; z < side; z++)
      for (let x = 0; x < side; x++) {
        const h = sampleHeight(heights, x * 64, z * 64);
        mask[z * side + x] = h >= 450 ? 1 : 0;
        if (h > highest) {
          highest = h;
          summit = [x * 64, z * 64];
        }
      }
    let groups = 0;
    for (let id = 0; id < mask.length; id++) {
      if (!mask[id]) continue;
      const queue = [id];
      mask[id] = 0;
      for (let head = 0; head < queue.length; head++) {
        const at = queue[head],
          x = at % side,
          z = Math.floor(at / side);
        for (let dz = -1; dz <= 1; dz++)
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx,
              nz = z + dz,
              next = nz * side + nx;
            if (nx >= 0 && nx < side && nz >= 0 && nz < side && mask[next]) {
              mask[next] = 0;
              queue.push(next);
            }
          }
      }
      if (queue.length >= 6) groups++;
    }
    mountainCounts.add(groups);
    summits.push(summit);
    expect(world.passes).toEqual([]);
    expect(
      world.spawn[1] - sampleHeight(heights, world.spawn[0], world.spawn[2]),
    ).toBeGreaterThanOrEqual(100);
    expect(world.spawn[1]).toBeLessThan(1350);
    for (const river of world.rivers!) {
      for (let i = 1; i < river.points.length; i++) {
        expect(river.points[i][1]).toBeLessThanOrEqual(
          river.points[i - 1][1] + 0.001,
        );
        const [x, h, z] = river.points[i];
        expect(
          sampleHeight(heights, x, z),
          `river bed seed ${seed}`,
        ).toBeLessThan(h);
      }
      const end = river.points.at(-1)!;
      expect(
        end[1] === 0 ||
          world.rivers!.some(
            (other) =>
              other !== river &&
              other.points.some(
                (p) =>
                  Math.hypot(p[0] - end[0], p[2] - end[2]) < 0.01 &&
                  Math.abs(p[1] - end[1]) < 0.01,
              ),
          ),
      ).toBe(true);
    }
    const trees = world.entities.filter((e) => e.kind === "tree");
    expect(trees.every((e) => e.p[1] - e.s[1] <= 650)).toBe(true);
  },
  60000,
);
it("retains varied mountain groups and summit positions across the fixed seeds", () => {
  expect(mountainCounts.size).toBeGreaterThanOrEqual(4);
  for (const axis of [0, 1]) {
    const positions = summits.map((p) => p[axis]);
    expect(Math.max(...positions) - Math.min(...positions)).toBeGreaterThan(
      2000,
    );
  }
});

beforeAll(() => initializePhysics());
it("flies over high terrain and applies ceiling assistance at the revised limits", () => {
  const world = JSON.parse(
    readFileSync("public/world.json", "utf8"),
  ) as WorldData;
  const bytes = readFileSync("public/world.bin");
  const heights = new Float32Array(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  );
  const sim = new Simulation(world, heights, () => {});
  try {
    sim.plane.p = [3072, 1200, 3072];
    sim.plane.pitch = 0.5;
    sim.step();
    expect(sim.plane.pitch).toBeGreaterThan(0.45);
    expect(sim.plane.crashed).toBe(0);
    sim.plane.p[1] = 1490;
    sim.plane.pitch = 0.5;
    sim.step();
    expect(sim.plane.pitch).toBeLessThanOrEqual(0.081);
    sim.plane.p[1] = 1510;
    sim.plane.pitch = 0.5;
    sim.step();
    expect(sim.plane.pitch).toBeLessThan(0);
    const save = sim.save();
    expect(
      compatible(
        { ...save, generatorVersion: 1 },
        world.version,
        world.seed,
        1,
      ),
    ).toBe(false);
    expect(
      compatible(
        { ...save, generatorVersion: 1 },
        world.version,
        world.seed,
        2,
      ),
    ).toBe(false);
    expect(() =>
      validateIsland({ ...world, generatorVersion: 1 }, heights),
    ).toThrow(/incomplete/);
    expect(() =>
      validateIsland({ ...world, generatorVersion: 2 }, heights),
    ).toThrow(/incomplete/);
  } finally {
    sim.dispose();
  }
});
