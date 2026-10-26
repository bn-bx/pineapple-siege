import { afterEach, expect, it, vi } from "vitest";
import { CHUNKS } from "../src/config";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("reuses alternate terrain LODs, invalidates edits and clears old-world geometry", async () => {
  vi.resetModules();
  const host = { onmessage: undefined as any },
    post = vi.fn();
  vi.stubGlobal("self", host);
  vi.stubGlobal("postMessage", post);
  const { TerrainMesher } = await import("../src/render/terrain-mesher");
  const build = vi.spyOn(TerrainMesher.prototype, "build");
  await import("../src/render/terrain-mesh-worker");
  host.onmessage({
    data: {
      type: "init",
      world: { paths: [], castleBounds: { min: [-10, -10], max: [-5, -5] } },
    },
  });
  let serial = 0;
  const mesh = (step: number, revision = 0, epoch = 1) => {
    host.onmessage({
      data: {
        type: "mesh",
        job: {
          epoch,
          tile: 0,
          serial: ++serial,
          sections: [
            {
              id: CHUNKS + 1,
              originX: 30,
              originZ: 30,
              width: 37,
              heights: new Float32Array(37 * 37).fill(revision ? 60 : 80),
              base: new Float32Array(37 * 37).fill(80),
              step,
              revision,
            },
          ],
        },
      },
    });
    return post.mock.calls.at(-1)![0];
  };
  const fine = mesh(2);
  mesh(4);
  const returned = mesh(2);
  expect(build).toHaveBeenCalledTimes(2);
  expect(returned.position).toEqual(fine.position);
  expect(returned.cacheHits).toBe(1);
  expect(returned.cacheBytes).toBeGreaterThan(0);
  expect(returned.cacheBytes).toBeLessThanOrEqual(32 * 1024 * 1024);
  const edited = mesh(2, 1);
  expect(build).toHaveBeenCalledTimes(3);
  expect(edited.position[1]).toBe(60);
  mesh(4, 1);
  expect(build).toHaveBeenCalledTimes(4);
  const geometry = build.mock.calls.at(-1)![0].mesh.geometry;
  const disposed = vi.fn();
  geometry.addEventListener("dispose", disposed);
  const reset = mesh(2, 0, 2);
  expect(build).toHaveBeenCalledTimes(5);
  expect(reset.position[1]).toBe(80);
  expect(reset.cacheHits).toBe(0);
  expect(reset.meshesBuilt).toBe(1);
  expect(disposed).toHaveBeenCalledOnce();
});
