import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import * as THREE from "three";
import { ApprovedGodView, type PackedGod } from "../src/render/approved-god";
import { ResourceDisposal } from "../src/render/resource-disposal";
import { applyApprovedGod } from "../src/world/approved-god.mjs";
import { buildPineappleGod } from "../src/world/pineapple-god.mjs";
import manifest from "../src/world/approved-god-manifest.json";
import type { Entity, WorldData } from "../src/types";
const world = JSON.parse(
  readFileSync("public/world.json", "utf8"),
) as WorldData;
const packed = JSON.parse(
  readFileSync("public/assets/pineapple-god/mesh.json", "utf8"),
) as PackedGod;
const bytes = readFileSync("public/assets/pineapple-god/mesh.bin");
const binary = () =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
it("packages the accepted sculpt with stable owners and verified production bytes", () => {
  const approval = JSON.parse(
    readFileSync("public/review/pineapple-god/visual-acceptance.json", "utf8"),
  );
  expect(manifest.sourceSHA256).toBe(approval.approvedAssetSHA256);
  expect(manifest.sourceRevision).toBe(approval.bodyMeshRevision);
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(packed.hash);
  expect(packed.revision).toBe(manifest.revision);
  expect(manifest.owners).toHaveLength(815);
});
it("upgrades legacy collision owners in place and is idempotent", () => {
  const site = structuredClone(
    world.sites.find((s) => s.kind === "pineapple-god")!,
  );
  const legacy: Entity[] = [];
  buildPineappleGod(
    site,
    legacy,
    () => 0.5,
    () => site.p[1],
    false,
  );
  const ids = legacy.map((e) => e.id);
  expect(applyApprovedGod(site, legacy, () => site.p[1])).toBe(true);
  expect(legacy.map((e) => e.id)).toEqual(ids);
  expect(
    legacy.filter((e) => e.visual?.sculptRevision === manifest.revision),
  ).toHaveLength(815);
  for (const e of legacy) {
    expect(e.s.every((n) => n > 0 && Number.isFinite(n))).toBe(true);
    expect(e.supports.length).toBeGreaterThan(0);
  }
  const serialized = JSON.stringify(legacy);
  expect(applyApprovedGod(site, legacy, () => site.p[1])).toBe(false);
  expect(JSON.stringify(legacy)).toBe(serialized);
});
it("restores damage received before loading, preserves eye emission, and disposes shared resources", () => {
  const view = new ApprovedGodView(world),
    eye = world.entities.find((e) => e.visual?.role === "eye")!;
  view.remove(eye.id);
  view.setEyeGlow(4);
  const textures = {
    head: new THREE.Texture(),
    body: new THREE.Texture(),
    cloth: new THREE.Texture(),
  };
  view.install(packed, binary(), textures);
  expect(
    view.materials.filter(
      (m) => m.emissiveIntensity === 4 && m.emissive.getHex() !== 0,
    ),
  ).toHaveLength(2);
  for (const r of view.refs.get(eye.id)!)
    expect(
      Array.from(
        r.geometry.index!.array.slice(r.start, r.start + r.count),
      ).every((n) => n === 0),
    ).toBe(true);
  let disposed = 0;
  for (const texture of Object.values(textures))
    texture.addEventListener("dispose", () => disposed++);
  const resources = new ResourceDisposal();
  view.dispose(resources);
  view.dispose(resources);
  resources.dispose();
  expect(disposed).toBe(3);
});
it("retains the infernal effigy while upgrading its throne and stairs", () => {
  const view = new ApprovedGodView({ ...world, realm: "hell" });
  view.install(packed, binary());
  for (const id of view.refs.keys())
    expect(["throne", "stairs"]).toContain(world.entities[id].visual?.role);
  expect(view.refs.size).toBe(495);
  const resources = new ResourceDisposal();
  view.dispose(resources);
  resources.dispose();
});
