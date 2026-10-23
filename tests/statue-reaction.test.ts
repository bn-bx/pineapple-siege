import { beforeAll, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { statueRole, validStatueReaction } from "../src/statue-reaction";
import { Simulation, initializePhysics } from "../src/sim/simulation";
import { WorldBatches } from "../src/render/world-batches";
import { ResourceDisposal } from "../src/render/resource-disposal";
import { compatible } from "../src/storage";
import type { Entity, WorldData, WorkerMessage } from "../src/types";
const world: WorldData = JSON.parse(readFileSync("public/world.json", "utf8"));
const bytes = readFileSync("public/world.bin");
const heights = new Float32Array(
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
);
const parts = world.entities.filter((e) => e.visual);
beforeAll(initializePhysics);
it("classifies every legacy PS4 part without changing its baseline or structural identities", () => {
  const legacy = structuredClone(world);
  for (const e of legacy.entities) if (e.visual) delete e.visual.role;
  for (const e of parts)
    expect(statueRole(legacy.entities[e.id], legacy), String(e.id)).toBe(
      e.visual!.role,
    );
  expect(parts.filter((e) => e.visual?.role === "eye")).toHaveLength(2);
});
it("flashes only on new ground pineapple defeats, restarts ten seconds, and restores the remaining timer", () => {
  const sim = new Simulation(world, heights, () => {});
  sim.setMonsterCount(2);
  try {
    const [one, two] = sim.monsters.active();
    sim.monsters.damage(one, 1);
    expect(sim.statueReaction.eyeGlowRemaining).toBe(0);
    sim.monsters.damage(one, 4);
    expect(sim.statueReaction.eyeGlowRemaining).toBe(10);
    for (let i = 0; i < 120; i++) sim.step();
    expect(sim.statueReaction.eyeGlowRemaining).toBeCloseTo(8);
    sim.monsters.damage(one, 5);
    expect(sim.statueReaction.eyeGlowRemaining).toBeCloseTo(8);
    sim.monsters.damage(two, 5);
    expect(sim.statueReaction.eyeGlowRemaining).toBe(10);
    const paused = sim.statueReaction.eyeGlowRemaining;
    sim.snapshot();
    sim.snapshot();
    expect(sim.statueReaction.eyeGlowRemaining).toBe(paused);
    for (let i = 0; i < 120; i++) sim.step();
    const save = sim.save();
    expect(save.statueReaction?.eyeGlowRemaining).toBeCloseTo(8);
    const restored = new Simulation(world, heights, () => {}, save);
    expect(restored.statueReaction.eyeGlowRemaining).toBeCloseTo(8);
    expect(restored.statueReaction.enraged).toBe(false);
    restored.dispose();
    for (let i = 0; i < 481; i++) sim.step();
    expect(sim.statueReaction.eyeGlowRemaining).toBe(0);
  } finally {
    sim.dispose();
  }
});
it("ignores throne, stairs, and rocks, triggers once on figure damage, and retains rage across death, counts, and saves", () => {
  const events: WorkerMessage[] = [];
  const sim = new Simulation(world, heights, (m) => events.push(m));
  try {
    for (const role of ["throne", "stairs", "rock"])
      (sim as any).removeEntity(parts.find((e) => e.visual?.role === role)!);
    expect(sim.statueReaction.enraged).toBe(false);
    (sim as any).removeEntity(parts.find((e) => e.visual?.role === "figure")!);
    (sim as any).removeEntity(parts.find((e) => e.visual?.role === "eye")!);
    expect(events.filter((e) => e.type === "statueRage")).toHaveLength(1);
    expect(sim.monsters.enraged).toBe(true);
    sim.plane.crashed = 1;
    sim.step();
    sim.respawn();
    expect(sim.statueReaction.enraged).toBe(true);
    sim.setMonsterCount(400);
    expect(sim.monsters.enraged).toBe(true);
    const save = sim.save();
    expect(compatible(save, world.version, world.seed)).toBe(true);
    const restoredEvents: WorkerMessage[] = [];
    const restored = new Simulation(
      world,
      heights,
      (e) => restoredEvents.push(e),
      save,
    );
    expect(restored.statueReaction.enraged).toBe(true);
    expect(restored.monsters.enraged).toBe(true);
    expect(restoredEvents.filter((e) => e.type === "statueRage")).toHaveLength(
      0,
    );
    restored.dispose();
    const fresh = new Simulation(world, heights, () => {});
    expect(fresh.statueReaction).toEqual({
      eyeGlowRemaining: 0,
      enraged: false,
    });
    fresh.dispose();
  } finally {
    sim.dispose();
  }
});
it("restores rage from legacy figure damage while not replaying old kills or decorative damage", () => {
  const original = new Simulation(world, heights, () => {});
  const save = original.save();
  original.dispose();
  delete save.statueReaction;
  save.monsters![0].defeated = true;
  save.monsters![0].health = 0;
  save.removed = [parts.find((e) => e.visual?.role === "stairs")!.id];
  const calm = new Simulation(world, heights, () => {}, save);
  expect(calm.statueReaction).toEqual({ eyeGlowRemaining: 0, enraged: false });
  calm.dispose();
  save.removed.push(parts.find((e) => e.visual?.role === "eye")!.id);
  const rage = new Simulation(world, heights, () => {}, save);
  expect(rage.statueReaction).toEqual({ eyeGlowRemaining: 0, enraged: true });
  rage.dispose();
});
it("drives dedicated near and distant eye emission and never leaves a glow after both eyes are removed", () => {
  const eyes = parts.filter((e) => e.visual?.role === "eye");
  const other = parts.find(
    (e) => e.visual?.color === eyes[0].visual!.color && e.visual.role !== "eye",
  )!;
  const fixture = {
    ...world,
    entities: [...eyes, other],
    banners: [],
  } as WorldData;
  const view = new WorldBatches(new THREE.Scene(), fixture, {
    stone: new THREE.MeshStandardMaterial(),
    sandstone: new THREE.MeshStandardMaterial(),
  } as any);
  try {
    const packed = JSON.parse(
      readFileSync("public/assets/pineapple-god/mesh.json", "utf8"),
    );
    const bytes = readFileSync("public/assets/pineapple-god/mesh.bin");
    view.approvedGod.install(
      packed,
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    );
    const near = view.approvedGod.materials.filter(
      (m) => m.emissive.getHex() !== 0,
    );
    const far = near; // One shared geometry/material set at every distance.
    expect(near).toHaveLength(2);
    view.setStatueReaction({ eyeGlowRemaining: 10, enraged: false });
    for (const mat of near) {
      expect(mat.emissiveIntensity).toBe(4);
      expect(mat.emissive.r).toBeGreaterThan(mat.emissive.g);
    }
    for (const mat of view.approvedGod.materials.filter(
      (m) => m.emissive.getHex() === 0,
    ))
      expect(mat.emissiveIntensity).toBe(1);
    view.remove(eyes[0].id);
    const visible = (e: Entity) =>
      view.approvedGod.refs
        .get(e.id)!
        .some((r) =>
          Array.from(
            r.geometry.index!.array.slice(r.start, r.start + r.count),
          ).some((n) => n !== 0),
        );
    expect(visible(eyes[1])).toBe(true);
    view.remove(eyes[1].id);
    for (const e of eyes) expect(visible(e)).toBe(false);
    view.setStatueReaction({ eyeGlowRemaining: 0, enraged: true });
    for (const mat of [...near, ...far]) expect(mat.emissiveIntensity).toBe(0);
  } finally {
    const resources = new ResourceDisposal();
    view.dispose(resources);
    resources.dispose();
  }
});
it("rejects malformed reaction saves while allowing old saves without the field", () => {
  expect(validStatueReaction(undefined)).toBe(true);
  for (const value of [
    null,
    {},
    { enraged: true, eyeGlowRemaining: NaN },
    { enraged: "yes", eyeGlowRemaining: 1 },
    { enraged: true, eyeGlowRemaining: 11 },
  ])
    expect(validStatueReaction(value)).toBe(false);
});
it("retains reaction state in incremental save capture metadata", () => {
  const sim = new Simulation(world, heights, () => {});
  try {
    sim.statueReaction.eyeGlowRemaining = 7;
    sim.statueReaction.enraged = true;
    const iterator = sim.captureSave();
    let next = iterator.next();
    while (!next.done) next = iterator.next();
    const capture = next.value;
    expect(capture.statueReaction).toEqual({
      eyeGlowRemaining: 7,
      enraged: true,
    });
  } finally {
    sim.dispose();
  }
});
it.each(["cannon", "nuke", "laser"])(
  "activates rage through real %s statue damage",
  (weapon) => {
    const sim = new Simulation(world, heights, () => {});
    sim.setMonsterCount(0);
    try {
      const part = parts.find((e) => e.visual?.role === "eye")!;
      if (weapon === "cannon") sim.explode(part.p);
      else if (weapon === "nuke") {
        sim.detonateNuke(part.p, "valley");
        for (let i = 0; i < 1000 && sim.pendingJobs.length; i++)
          sim.processDestruction(50);
      } else {
        sim.startLaser(part.p);
        for (let i = 0; i < 245; i++) sim.step();
        for (
          let i = 0;
          i < 1000 && (sim.laserWork.size || sim.laserSupport.size);
          i++
        ) {
          sim.processLaserWork(50);
          sim.processDestruction(50);
        }
      }
      expect(sim.statueReaction.enraged).toBe(true);
      expect(sim.snapshot().statueReaction?.enraged).toBe(true);
    } finally {
      sim.dispose();
    }
  },
  30000,
);
it("flashes on blast and laser kills without treating flying enemy defeats as pineapple monster kills", () => {
  const sim = new Simulation(world, heights, () => {});
  sim.setMonsterCount(2);
  try {
    const m = sim.monsters.active()[0];
    (sim as any).damageMonsters([m.p[0], m.p[1] + 28, m.p[2]], 1, 5);
    expect(sim.statueReaction.eyeGlowRemaining).toBe(10);
    sim.statueReaction.eyeGlowRemaining = 2;
    const other = sim.monsters.active()[0];
    (sim as any).damageMonsters(other.p, 1, 5, true);
    expect(sim.statueReaction.eyeGlowRemaining).toBe(10);
    sim.statueReaction.eyeGlowRemaining = 0;
    const fly = sim.flies.states[0];
    sim.flies.damage(fly.p, 1, 100);
    expect(sim.statueReaction.eyeGlowRemaining).toBe(0);
  } finally {
    sim.dispose();
  }
});
