import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { pathIndex, sampleHeight } from "../src/world/generator.mjs";
import type { WorldData } from "../src/types";

it("exports dense groves, mixed-age trees and rare giants while keeping roads and spawn clear", () => {
  const world: WorldData = JSON.parse(
    readFileSync("public/world.json", "utf8"),
  );
  const bytes = readFileSync("public/world.bin");
  const heights = new Float32Array(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  );
  const trees = world.entities.filter((e) => e.kind === "tree");
  const road = pathIndex(world.paths);
  const cells = new Map<string, number>();
  let tallest = 0,
    totalHeight = 0,
    giants = 0;
  for (const tree of trees) {
    const [x, y, z] = tree.p;
    const height = tree.s[1] * 2;
    tallest = Math.max(tallest, height);
    totalHeight += height;
    if (height > 70) giants++;
    const key = `${Math.floor(x / 128)},${Math.floor(z / 128)}`;
    cells.set(key, (cells.get(key) ?? 0) + 1);
    expect(y - tree.s[1]).toBeCloseTo(sampleHeight(heights, x, z), 1);
    expect(road(x, z)).toBeGreaterThan(tree.s[0] * 2.6 + 7.9);
    expect(Math.hypot(x - world.spawn[0], z - world.spawn[2])).toBeGreaterThan(
      149,
    );
  }
  expect(trees.length).toBeLessThanOrEqual(30000);
  expect(totalHeight / trees.length).toBeGreaterThan(30);
  expect(tallest).toBeGreaterThan(80);
  expect(giants).toBeGreaterThan(20);
  expect(giants / trees.length).toBeLessThan(0.08);
  expect([...cells.values()].filter((n) => n >= 25).length).toBeGreaterThan(20);
});
