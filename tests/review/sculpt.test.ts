import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  createSculpt,
  collisionBounds,
  type SculptAsset,
} from "../../src/review/sculpt";
import * as THREE from "three";
import { ResourceDisposal } from "../../src/render/resource-disposal";
const root = "public/review/pineapple-god/";
const asset = JSON.parse(
  readFileSync(root + "sculpt.json", "utf8"),
) as SculptAsset;
it("preserves the original supplied image byte-for-byte", () => {
  const provenance = JSON.parse(
    readFileSync(root + "reference-provenance.json", "utf8"),
  );
  expect(
    createHash("sha256")
      .update(readFileSync(root + "reference.png"))
      .digest("hex"),
  ).toBe(provenance.sha256);
  expect(provenance.modified).toBe(false);
  expect([provenance.width, provenance.height]).toEqual([1145, 1374]);
  expect(provenance.sha256).toBe(
    "10975841ad577b91044616b95ce760f62e9d913b11607cbf3258ac24da89e163",
  );
});
it("uses finite, closed, consistently wound polygon owners with exact shared collision bounds", () => {
  expect(new Set(asset.parts.map((p) => p.damageOwner)).size).toBe(
    asset.parts.length,
  );
  for (const part of asset.parts) {
    expect(part.triangleMaterials).toHaveLength(part.triangles.length);
    expect(collisionBounds(part), part.id).toEqual(part.bounds);
    const edges = new Map<string, number[]>();
    for (let i = 0; i < part.triangles.length; i++) {
      const f = part.triangles[i];
      if (f.length !== 3 || !asset.materials[part.triangleMaterials[i]])
        throw new Error(`Invalid triangle or material in ${part.id}`);
      for (let j = 0; j < 3; j++) {
        const a = f[j],
          b = f[(j + 1) % 3];
        if (!Number.isInteger(a) || a < 0 || a >= part.vertices.length)
          throw new Error(`Invalid vertex index in ${part.id}`);
        const key = [Math.min(a, b), Math.max(a, b)].join(":");
        const list = edges.get(key) ?? [];
        list.push(a < b ? 1 : -1);
        edges.set(key, list);
      }
    }
    for (const [key, users] of edges) {
      if (users.length !== 2 || users[0] + users[1] !== 0)
        throw new Error(
          `Open/nonmanifold or inconsistently wound edge ${part.id}:${key}`,
        );
    }
    if (!part.vertices.every((p) => p.every(Number.isFinite)))
      throw new Error(`Nonfinite vertices in ${part.id}`);
  }
});
it("renders an inspectable geometry-only mode and releases all owned resources", () => {
  const view = createSculpt(asset);
  expect(view.group.children).toHaveLength(asset.parts.length);
  for (const material of view.materials.values())
    expect(material.map).toBe(null);
  const resources = new ResourceDisposal();
  resources.collect(view.group);
  expect(resources.geometries.size).toBe(asset.parts.length);
  let disposed = 0;
  for (const g of resources.geometries)
    g.addEventListener("dispose", () => disposed++);
  resources.dispose();
  expect(disposed).toBe(asset.parts.length);
});
it("keeps source review geometry separate from the packed production integration", () => {
  expect(asset.status).toBe("candidate-awaiting-visual-acceptance");
  for (const file of [
    "src/world/pineapple-god.mjs",
    "src/world/refine-god.mjs",
    "src/realm.ts",
    "src/render/renderer.ts",
  ]) {
    expect(readFileSync(file, "utf8")).not.toMatch(/review\/|sculpt\.json/);
  }
});

it("uses one connected, volumetric head and neck with fixed reference-space UVs", () => {
  const heads = asset.parts.filter((p) => p.region === "head");
  expect(heads).toHaveLength(1);
  const head = heads[0];
  expect(head.id).toBe("head-neck-sculpt");
  expect(head.uv).toHaveLength(head.vertices.length);
  expect(head.projectionWeights).toHaveLength(head.vertices.length);
  const adjacency = new Map<number, Set<number>>();
  for (const triangle of head.triangles)
    for (const a of triangle)
      for (const b of triangle) {
        if (!adjacency.has(a)) adjacency.set(a, new Set());
        adjacency.get(a)!.add(b);
      }
  const visited = new Set<number>();
  const pending = [0];
  while (pending.length) {
    const i = pending.pop()!;
    if (visited.has(i)) continue;
    visited.add(i);
    pending.push(...adjacency.get(i)!);
  }
  expect(visited.size).toBe(head.vertices.length);
  expect(head.bounds.max[2] - head.bounds.min[2]).toBeGreaterThan(200);
  const focal = 1374 / (2 * Math.tan(Math.PI / 8));
  for (let i = 0; i < head.vertices.length; i++) {
    const weight = head.projectionWeights![i];
    expect(weight).toBeGreaterThanOrEqual(0);
    expect(weight).toBeLessThanOrEqual(1);
    if (!weight) continue;
    const [x, y, z] = head.vertices[i];
    const px = 1145 / 2 + (x * focal) / (1800 - z),
      py = 1374 / 2 - ((y - 400) * focal) / (1800 - z);
    expect(head.uv![i][0] * 245 + 460).toBeCloseTo(px, 4);
    expect((1 - head.uv![i][1]) * 294 + 184).toBeCloseTo(py, 4);
  }
});
it("owns the shared reference texture once, including clay mode and cleanup", () => {
  const texture = new THREE.Texture();
  let disposed = 0;
  texture.addEventListener("dispose", () => disposed++);
  const view = createSculpt(asset, texture);
  const head = view.group.children.find(
    (m) => m.name === "head-neck-sculpt",
  ) as THREE.Mesh;
  const material = (head.material as THREE.MeshStandardMaterial[])[0];
  expect(material.map).toBe(texture);
  expect(head.geometry.getAttribute("uv").count).toBe(
    head.geometry.getAttribute("position").count,
  );
  view.setSurfaceMode("clay");
  expect(material.color.getHexString()).toBe("b9b7ab");
  view.setSurfaceMode("photo");
  expect(material.color.getHexString()).toBe(
    asset.materials.face.color.slice(1),
  );
  const resources = new ResourceDisposal();
  resources.collect(view.group);
  resources.dispose();
  expect(disposed).toBe(1);
  const provenance = JSON.parse(
    readFileSync(root + "surface-provenance.json", "utf8"),
  );
  expect(provenance.cameraFacingBillboard).toBe(false);
  expect(provenance.sourceModified).toBe(false);
  expect(asset.surfaceProjection?.bakedLightingRemains).toBe(true);
});

it("disposes unused palette materials and the texture exactly once", () => {
  const texture = new THREE.Texture();
  const view = createSculpt(asset, texture);
  let textureEvents = 0,
    materialEvents = 0;
  texture.addEventListener("dispose", () => textureEvents++);
  for (const material of view.materials.values())
    material.addEventListener("dispose", () => materialEvents++);
  view.dispose();
  view.dispose();
  expect(textureEvents).toBe(1);
  expect(materialEvents).toBe(view.materials.size);
});

it("keeps the accepted head and its texture unchanged during body work", () => {
  const snapshot = JSON.parse(
    readFileSync(root + "accepted-head.json", "utf8"),
  );
  expect(asset.parts.find((p) => p.id === "head-neck-sculpt")).toEqual(
    snapshot.head,
  );
  const acceptance = JSON.parse(
    readFileSync(root + "visual-acceptance.json", "utf8"),
  );
  expect(
    createHash("sha256")
      .update(readFileSync(root + "head-surface.png"))
      .digest("hex"),
  ).toBe(acceptance.headSurfaceSHA256);
  expect(snapshot.headGeometrySHA256).toBe(acceptance.headGeometrySHA256);
});
it("uses connected body regions instead of floating chest, abs, or limb plates", () => {
  const bodies = asset.parts.filter((p) => p.id.startsWith("body-"));
  expect(bodies.map((p) => p.id)).toEqual([
    "body-upper-sculpt",
    "body-left-leg-sculpt",
    "body-right-leg-sculpt",
  ]);
  expect(
    asset.parts.some((p) =>
      /^(pectoral|abs-|deltoid|upper-arm|forearm|palm|finger|thigh|shin)/.test(
        p.id,
      ),
    ),
  ).toBe(false);
  for (const part of bodies) {
    const parent = Int32Array.from(part.vertices, (_, i) => i);
    function root(i: number): number {
      while (parent[i] !== i) {
        parent[i] = parent[parent[i]];
        i = parent[i];
      }
      return i;
    }
    for (const [a, b, c] of part.triangles) {
      parent[root(a)] = root(b);
      parent[root(c)] = root(b);
    }
    const roots = new Set(parent.map((_, i) => root(i)));
    expect(roots.size, part.id).toBe(1);
    expect(part.uv).toHaveLength(part.vertices.length);
    expect(part.projectionWeights).toHaveLength(part.vertices.length);
  }
});
it("keeps body and reconstructed cloth surfaces separate and disposes shared maps once", () => {
  const head = new THREE.Texture(),
    body = new THREE.Texture(),
    cloth = new THREE.Texture();
  const view = createSculpt(asset, head, body, cloth);
  let events = 0;
  for (const texture of [head, body, cloth])
    texture.addEventListener("dispose", () => events++);
  for (const child of view.group.children) {
    const mesh = child as THREE.Mesh;
    if (mesh.name.startsWith("body-"))
      expect((mesh.material as THREE.MeshStandardMaterial[])[0].map).toBe(body);
    if (mesh.name === "cloth-drapery")
      expect((mesh.material as THREE.MeshStandardMaterial[])[0].map).toBe(
        cloth,
      );
  }
  view.setSurfaceMode("clay");
  view.setSurfaceMode("photo");
  view.dispose();
  view.dispose();
  expect(events).toBe(3);
  const provenance = JSON.parse(
    readFileSync(root + "body-surface-provenance.json", "utf8"),
  );
  expect(provenance.sourceModified).toBe(false);
  expect(provenance.occlusion).toContain("reconstructed");
});
