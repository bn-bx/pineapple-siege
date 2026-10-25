import { beforeAll, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { BLAST_DEBRIS_LIMIT, CONFIG } from "../src/config";
import { Simulation, initializePhysics } from "../src/sim/simulation";
import { WorldBatches } from "../src/render/world-batches";
import { ResourceDisposal } from "../src/render/resource-disposal";
import { MapNavigation } from "../src/app/map-navigation";
import { compatible } from "../src/storage";
import { GENERATOR_VERSION, WORLD_VERSION } from "../src/world/generator.mjs";
import {
  setEntityTransform,
  finishEntityTransform,
} from "../src/render/statue-geometry";
import type { WorldData, Vec3 } from "../src/types";
const world: WorldData = JSON.parse(readFileSync("public/world.json", "utf8"));
const bytes = readFileSync("public/world.bin");
const heights = new Float32Array(
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
);
const site = world.sites.find((s) => s.kind === "pineapple-god")!;
const parts = world.entities.filter((e) => e.visual);
function expectCompleteStatueDebris(sim: Simulation) {
  const volumes = new Map<number, number>();
  for (const m of sim.ballistic.values()) {
    const v = m.view,
      owner = world.entities[v.source];
    if (!owner?.visual) continue;
    volumes.set(
      v.source,
      (volumes.get(v.source) ?? 0) + 8 * v.s[0] * v.s[1] * v.s[2],
    );
    for (let k = 0; k < 3; k++)
      expect(Math.abs(v.p[k] - owner.p[k]) + v.s[k]).toBeLessThanOrEqual(
        owner.s[k] + 0.000001,
      );
  }
  expect(volumes.size).toBeGreaterThan(0);
  for (const [source, volume] of volumes) {
    const size = world.entities[source].s;
    expect(volume).toBeCloseTo(8 * size[0] * size[1] * size[2], 3);
  }
}
beforeAll(initializePhysics);
it("reserves one mountain monument at reference scale and rejects PS3 saves", () => {
  const release = JSON.parse(readFileSync("public/release.json", "utf8"));
  expect(release.generatorVersion).toBe(world.generatorVersion);
  expect(release.worldVersion).toBe(world.version);
  expect(release.includes).toContain("giant-destructible-pineapple-god");
  expect(world.generatorVersion).toBe(GENERATOR_VERSION);
  expect(world.version).toBe(WORLD_VERSION);
  expect(world.sites.filter((s) => s.kind === "pineapple-god")).toHaveLength(1);
  const top = Math.max(...parts.map((e) => e.p[1] + e.s[1]));
  expect(top - site.p[1]).toBeGreaterThan(1000);
  expect(top).toBeLessThan(CONFIG.ceiling);
  expect(world.structureCount).toBeLessThanOrEqual(48000);
  for (const other of world.sites.filter((s) => s !== site))
    expect(
      Math.hypot(other.p[0] - site.p[0], other.p[2] - site.p[2]),
    ).toBeGreaterThan(site.radius + other.radius);
  expect(site.yaw).toBeCloseTo(
    Math.atan2(world.castle[0] - site.p[0], world.castle[2] - site.p[2]),
  );
  const map = new MapNavigation();
  map.setIsland(world);
  expect(map.landmarks.find((l) => l.id === site.id)?.name).toBe(
    "Pineapple God",
  );
});
it("keeps sculpted vertices inside collision bounds, preserves both views after damage, and releases resources", () => {
  const scene = new THREE.Scene();
  const fixture = { ...world, entities: parts, banners: [] } as WorldData;
  // The renderer restores by ID; use a complete sparse owner lookup for this isolated fixture.
  const view = new WorldBatches(scene, fixture, {
    stone: new THREE.MeshStandardMaterial(),
    sandstone: new THREE.MeshStandardMaterial(),
  } as any);
  const dummy = new THREE.Object3D(),
    point = new THREE.Vector3();
  for (const batch of view.batches)
    for (const id of batch.allIds) {
      const e = world.entities[id];
      setEntityTransform(dummy, e);
      finishEntityTransform(dummy, e);
      const vertices = batch.mesh.geometry.getAttribute("position");
      for (let i = 0; i < vertices.count; i++) {
        point.fromBufferAttribute(vertices, i).applyMatrix4(dummy.matrix);
        for (let k = 0; k < 3; k++)
          expect(Math.abs(point.getComponent(k) - e.p[k])).toBeLessThanOrEqual(
            e.s[k] + 0.001,
          );
      }
    }
  fixture.entities = world.entities;
  const packed = JSON.parse(
    readFileSync("public/assets/pineapple-god/mesh.json", "utf8"),
  );
  const meshBytes = readFileSync("public/assets/pineapple-god/mesh.bin");
  view.approvedGod.install(
    packed,
    meshBytes.buffer.slice(
      meshBytes.byteOffset,
      meshBytes.byteOffset + meshBytes.byteLength,
    ),
  );
  const transform = new THREE.Matrix4().makeRotationY(site.yaw!);
  transform.setPosition(...site.p);
  for (const [id, refs] of view.approvedGod.refs)
    for (const ref of refs) {
      const e = world.entities[id],
        vertices = ref.geometry.getAttribute("position");
      for (let i = ref.start; i < ref.start + ref.count; i++) {
        point
          .fromBufferAttribute(vertices, ref.original[i])
          .applyMatrix4(transform);
        for (let k = 0; k < 3; k++)
          expect(
            Math.abs(point.getComponent(k) - e.p[k]),
            String(id),
          ).toBeLessThanOrEqual(e.s[k] + 0.002);
      }
    }
  expect(view.approvedGod.refs.size).toBe(815);
  expect(
    view.approvedGod.group.children.reduce(
      (n, m) => n + (m as THREE.Mesh).geometry.groups.length,
      0,
    ),
  ).toBeLessThan(20);
  const id = parts.find((e) => e.visual?.shape === "hero-head")!.id;
  const refs = view.approvedGod.refs.get(id)!;
  const invisible = () =>
    refs.every((r) =>
      Array.from(
        r.geometry.index!.array.slice(r.start, r.start + r.count),
      ).every((v) => v === 0),
    );
  view.remove(id);
  expect(invisible()).toBe(true);
  // The same mesh serves near and distant views; no secondary horizon copy can reappear.
  expect((view.horizon as any).refs.has(id)).toBe(false);
  view.restore([id]);
  expect(invisible()).toBe(true);
  view.restore([]);
  for (const r of refs)
    expect(r.geometry.index!.array.slice(r.start, r.start + r.count)).toEqual(
      r.original.slice(r.start, r.start + r.count),
    );
  const resources = new ResourceDisposal();
  view.dispose(resources);
  resources.dispose();
  expect(scene.children).toHaveLength(0);
});
it("destroys local face sections, reloads damage, and collapses a severed head within existing debris limits", () => {
  const sim = new Simulation(world, heights, () => {});
  try {
    const face = parts.find((e) => e.visual?.role === "eye")!;
    sim.explode(face.p);
    expect(parts.some((e) => sim.removed.has(e.id))).toBe(true);
    expect(parts.filter((e) => sim.removed.has(e.id)).length).toBeLessThan(
      parts.length / 2,
    );
    const save = sim.save();
    expect(
      compatible({ ...save, generatorVersion: 3 }, world.version, world.seed),
    ).toBe(false);
    const restored = new Simulation(world, heights, () => {}, save);
    expect(restored.removed.has(face.id)).toBe(true);
    restored.dispose();
    // Cut every section at the neck, then allow the authoritative support graph to collapse.
    for (const e of parts)
      if (
        e.p[1] + e.s[1] >= site.p[1] + 670 &&
        e.p[1] - e.s[1] <= site.p[1] + 680
      )
        (sim as any).removeEntity(e);
    (sim as any).resolveSupport(site.p, 7, 32);
    for (let i = 0; i < 200 && sim.supportJobs.length; i++)
      sim.processDestruction(50);
    expect(
      parts
        .filter(
          (e) => e.visual?.shape === "hero-head" && e.p[1] > site.p[1] + 690,
        )
        .every((e) => sim.removed.has(e.id)),
    ).toBe(true);
    expect(sim.physics.bodies.len()).toBe(0);
    expect(sim.snapshot().bodies.length).toBeLessThanOrEqual(
      BLAST_DEBRIS_LIMIT,
    );
    expectCompleteStatueDebris(sim);
  } finally {
    sim.dispose();
  }
});
it("removes monument sections under laser and nuclear strikes", () => {
  for (const weapon of ["laser", "nuke"]) {
    const sim = new Simulation(world, heights, () => {});
    try {
      const p = [site.p[0], site.p[1] + 440, site.p[2]] as Vec3;
      if (weapon === "nuke") sim.detonateNuke(p, "valley");
      else {
        sim.startLaser(p);
        for (let i = 0; i < 300; i++) sim.step();
      }
      for (
        let i = 0;
        i < 1000 &&
        (sim.pendingJobs.length ||
          sim.laserWork.size ||
          sim.laserSupport.size ||
          sim.supportJobs.length);
        i++
      ) {
        sim.processLaserWork(50);
        sim.processDestruction(50);
      }
      expect(
        parts.some((e) => sim.removed.has(e.id)),
        weapon,
      ).toBe(true);
      expect(sim.physics.bodies.len()).toBe(0);
      expect(sim.snapshot().bodies.length).toBeLessThanOrEqual(
        BLAST_DEBRIS_LIMIT,
      );
      if (weapon === "nuke") expectCompleteStatueDebris(sim);
    } finally {
      sim.dispose();
    }
  }
}, 30000);
it("partitions direct hits and budget overflow without shrinking or discarding statue volume", () => {
  const sim = new Simulation(world, heights, () => {});
  try {
    const largest = parts.reduce((a, b) =>
      Math.max(...a.s) > Math.max(...b.s) ? a : b,
    );
    (sim as any).fragment(largest, largest.p, 25, { n: 0, limit: 6 });
    expectCompleteStatueDebris(sim);
    const overflow = parts.find(
      (e) => e.id !== largest.id && Math.max(...e.s) > 50,
    )!;
    (sim as any).fragment(overflow, overflow.p, 25, { n: 6, limit: 6 });
    expectCompleteStatueDebris(sim);
    expect(
      [...sim.ballistic.values()].some((m) => m.view.source === overflow.id),
    ).toBe(true);
    (sim as any).staticFragment(overflow);
    expectCompleteStatueDebris(sim);
    const castle = world.entities.find((e) => e.kind === "block" && !e.visual)!;
    const id = (sim as any).spawnBody(
      castle.p,
      [80, 40, 20],
      castle.material,
      castle.id,
      "chunk",
      [0, 0, 0],
    );
    expect(sim.ballistic.get(id)!.view.s).toEqual([80, 40, 20]);
  } finally {
    sim.dispose();
  }
});
it("represents every unsupported section of a whole-statue collapse without losing its collision-solid volume", () => {
  const sim = new Simulation(world, heights, () => {});
  try {
    for (const e of parts.filter((e) => e.foundation))
      (sim as any).removeEntity(e);
    (sim as any).resolveSupport(site.p, 7, 0);
    for (let i = 0; i < 500 && sim.supportJobs.length; i++)
      sim.processDestruction(50);
    const sources = new Set(
      [...sim.ballistic.values()].map((m) => m.view.source),
    );
    for (const e of parts.filter((e) => !e.foundation)) {
      expect(sim.removed.has(e.id)).toBe(true);
      expect(sources.has(e.id)).toBe(true);
    }
    expect(sim.ballistic.size).toBeGreaterThan(2048);
    expect(sim.ballistic.size).toBeLessThanOrEqual(8192);
    expectCompleteStatueDebris(sim);
    expect(sim.physics.bodies.len()).toBe(0);
  } finally {
    sim.dispose();
  }
});
