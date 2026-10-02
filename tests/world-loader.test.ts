import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { loadTerrain } from "../src/world-loader";
import type { WorldData } from "../src/types";

it("reassembles generated terrain exactly and keeps each production part below 25 MiB", async () => {
  const world: WorldData = JSON.parse(
    readFileSync("public/world.json", "utf8"),
  );
  expect(world.heightFiles!.length).toBeGreaterThan(1);
  const request = async (url: string | URL | Request) => {
    const part = readFileSync(`public/${url}`);
    expect(part.byteLength).toBeLessThan(25 * 1024 * 1024);
    return new Response(part);
  };
  const data = await loadTerrain(world, "", request);
  expect(Buffer.from(data).equals(readFileSync("public/world.bin"))).toBe(true);
});
it("rejects missing parts and truncated terrain", async () => {
  const world = { grid: 2, heightFiles: ["a", "b"] } as WorldData;
  await expect(
    loadTerrain(world, "", async () => new Response(null, { status: 404 })),
  ).rejects.toThrow("did not load");
  await expect(
    loadTerrain(world, "", async () => new Response(new Uint8Array(4))),
  ).rejects.toThrow("incomplete");
});
it("supports older manifests using the unsplit terrain file", async () => {
  const world = { grid: 2 } as WorldData;
  const data = new Uint8Array(16);
  const result = await loadTerrain(world, "./", async (url) => {
    expect(url).toBe("./world.bin");
    return new Response(data);
  });
  expect(new Uint8Array(result)).toEqual(data);
});
