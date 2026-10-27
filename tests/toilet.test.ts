import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { ToiletView, type PackedToilet } from "../src/render/toilet";
import { ResourceDisposal } from "../src/render/resource-disposal";
import { realmBaseline } from "../src/realm";
import manifest from "../src/world/toilet-manifest.json";
import type { WorldData } from "../src/types";
const world = JSON.parse(
  readFileSync("public/world.json", "utf8"),
) as WorldData;
const heightBytes = readFileSync("public/world.bin");
const heights = new Float32Array(
  heightBytes.buffer.slice(
    heightBytes.byteOffset,
    heightBytes.byteOffset + heightBytes.byteLength,
  ),
);
const packed = JSON.parse(
  readFileSync("public/assets/toilet/mesh.json", "utf8"),
) as PackedToilet;
const bytes = readFileSync("public/assets/toilet/mesh.bin");
const binary = () =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
it("packages a damage-sized toilet whose seat hole matches the aperture", () => {
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(
    manifest.revision,
  );
  expect(packed.revision).toBe(manifest.revision);
  expect(manifest.hole.halfX).toBeCloseTo(54);
  expect(manifest.waterHalf.every((h) => h >= 54)).toBe(true);
  expect(manifest.seatTop).toBeGreaterThan(manifest.waterY);
  expect(packed.chunks.map((c) => c.owner)).toEqual(
    manifest.owners.map((o) => o.ordinal),
  );
  const roles = new Set(manifest.owners.map((o) => o.role));
  for (const role of ["pedestal", "bowl", "tank", "seat", "lid", "handle"])
    expect(roles.has(role)).toBe(true);
  expect(manifest.owners.length).toBeLessThanOrEqual(420);
  for (const o of manifest.owners)
    expect(Math.max(...o.max.map((v, k) => v - o.min[k]))).toBeLessThan(70);
});
it.each(["surface", "hell"] as const)(
  "removes and restores %s toilet pieces before and after loading",
  (realm) => {
    const { world: realmWorld } = realmBaseline({ world, heights }, realm);
    const view = new ToiletView(realmWorld);
    const site = realmWorld.portal!;
    expect(view.group.position.toArray()).toEqual(site.base);
    expect(view.group.rotation.y).toBe(site.yaw);
    const [early, late] = site.ids;
    view.remove(early);
    view.install(packed, binary());
    const mesh = view.group.children[0] as import("three").Mesh;
    const index = mesh.geometry.index!.array as Uint32Array;
    const range = (id: number) => {
      const owner = realmWorld.entities[id].visual!.modelOwner!;
      const c = packed.chunks.find((c) => c.owner === owner)!;
      return index.subarray(c.start, c.start + c.count);
    };
    expect(range(early).every((i) => i === 0)).toBe(true);
    expect(range(late).some((i) => i !== 0)).toBe(true);
    view.remove(late);
    expect(range(late).every((i) => i === 0)).toBe(true);
    view.restore([late]);
    expect(range(early).some((i) => i !== 0)).toBe(true);
    expect(range(late).every((i) => i === 0)).toBe(true);
    expect(view.materials).toHaveLength(1);
    const resources = new ResourceDisposal();
    view.dispose(resources);
    expect(resources.geometries.size).toBe(1);
    expect(view.group.parent).toBeNull();
    resources.dispose();
  },
);
