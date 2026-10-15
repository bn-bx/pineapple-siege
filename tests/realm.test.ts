import { readFileSync } from "node:fs";
import { beforeAll, expect, it } from "vitest";
import { arrivalPlane, portalIntact, portalSite, realmBaseline } from "../src/realm";
import { Simulation, initializePhysics } from "../src/sim/simulation";
import { compatible } from "../src/storage";
import type { WorkerMessage, WorldData } from "../src/types";
import { generateIsland } from "../src/world/generator.mjs";
import { CONFIG, HELL_LAVA_LEVEL } from "../src/config";

const world = JSON.parse(readFileSync("public/world.json", "utf8")) as WorldData;
const bytes = readFileSync("public/world.bin");
const heights = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
const baseline = { world, heights };
beforeAll(() => initializePhysics());

it("derives the same portal in independent surface and inverted realms", () => {
  const site = portalSite(baseline);
  const surface = realmBaseline(baseline, "surface");
  const hell = realmBaseline(baseline, "hell");
  expect(surface.world.portal).toEqual(hell.world.portal);
  expect(surface.world.portal!.x).toBe(site.x);
  expect(hell.world.civilians).toEqual([]);
  expect(surface.world.civilians!.length).toBeGreaterThan(0);
  expect(surface.world.entities.length).toBe(world.entities.length + 12);
  expect(hell.world.entities.length).toBe(world.entities.length + 12);
  expect(portalIntact(hell.world, new Set())).toBe(true);
  expect(portalIntact(hell.world, new Set([hell.world.portal!.ids[0]]))).toBe(false);
  expect(world.portal).toBeUndefined();
  for (const realm of [surface.world, hell.world]) {
    const cleared = new Set(realm.portal!.clearedTrees);
    for (const entity of realm.entities) {
      if (entity.kind !== "tree") continue;
      const overlaps = Math.hypot(entity.p[0] - site.x, entity.p[2] - site.z) <
        site.radius + 30 + Math.max(entity.s[0], entity.s[2]) * 1.9;
      expect(cleared.has(entity.id)).toBe(overlaps);
      expect(realm.entities[entity.id].id).toBe(entity.id);
    }
  }
});

it("places clear, traversable portals across island seeds", () => {
  for (const seed of [1, 0x1bcdef, 0xdeadbeef]) {
    const generated = generateIsland(seed);
    const site = portalSite(generated);
    expect(site.y).toBeGreaterThan(15);
    expect(generated.world.entities.some((e) =>
      e.kind !== "tree" && Math.hypot(e.p[0] - site.x, e.p[2] - site.z) <
      85 + Math.max(e.s[0], e.s[2]),
    )).toBe(false);
  }
}, 60_000);

it("lets a descending aircraft cross the aperture and preserves a valid save", () => {
  const surface = realmBaseline(baseline, "surface");
  const site = surface.world.portal!;
  const messages: WorkerMessage[] = [];
  const sim = new Simulation(surface.world, heights, (message) => messages.push(message), undefined, true);
  sim.setMonsterCount(0);
  sim.plane.p = [site.x, sim.terrain.sample(site.x, site.z) + 45, site.z];
  sim.plane.yaw = 0;
  sim.plane.pitch = -1.12;
  sim.plane.speed = 130;
  sim.portalGrace = 0;
  for (let i = 0; i < 90 && !messages.some((m) => m.type === "portalEnter"); i++) sim.step();
  const event = messages.find((m) => m.type === "portalEnter");
  expect(event?.type).toBe("portalEnter");
  if (event?.type === "portalEnter") {
    const arrived = arrivalPlane(event.plane, site);
    expect(arrived.p[1]).toBe(site.y + 72);
    expect(arrived.pitch).toBeGreaterThan(0);
    expect(arrived.speed).toBe(event.plane.speed);
  }
  const save = sim.save();
  for (const id of site.clearedTrees ?? []) expect(sim.removed.has(id)).toBe(true);
  const oldSave = { ...save, removed: save.removed.filter((id) => !site.clearedTrees?.includes(id)) };
  const restored = new Simulation(surface.world, heights, () => {}, oldSave, true);
  try {
    for (const id of site.clearedTrees ?? []) expect(restored.removed.has(id)).toBe(true);
  } finally { restored.dispose(); }
  expect(compatible(save, world.version, world.seed)).toBe(true);
  sim.dispose();
});

it("lets the pineapple fly back through the intact matching aperture", () => {
  const hell = realmBaseline(baseline, "hell");
  const site = hell.world.portal!;
  const messages: WorkerMessage[] = [];
  const sim = new Simulation(hell.world, heights, (message) => messages.push(message), undefined, true);
  try {
    sim.setMonsterCount(0);
    sim.plane.p = [site.x, sim.terrain.sample(site.x, site.z) + 45, site.z];
    sim.plane.pitch = -1.12;
    sim.plane.speed = 130;
    sim.portalGrace = 0;
    for (let i = 0; i < 90 && !messages.some((m) => m.type === "portalEnter"); i++) sim.step();
    expect(messages.some((m) => m.type === "portalEnter")).toBe(true);
  } finally {
    sim.dispose();
  }
});

it("locks travel when a portal section is destroyed", () => {
  const surface = realmBaseline(baseline, "surface");
  const site = surface.world.portal!;
  const messages: WorkerMessage[] = [];
  const sim = new Simulation(surface.world, heights, (message) => messages.push(message), undefined, true);
  try {
    sim.setMonsterCount(0);
    sim.removed.add(site.ids[0]);
    sim.plane.p = [site.x, sim.terrain.sample(site.x, site.z) + 45, site.z];
    sim.plane.pitch = -1.12;
    sim.plane.speed = 130;
    sim.portalGrace = 0;
    for (let i = 0; i < 90 && sim.plane.crashed <= 0; i++) sim.step();
    expect(messages.some((m) => m.type === "portalEnter")).toBe(false);
  } finally {
    sim.dispose();
  }
});

it.each([false, true])("kills a pineapple touching the lava ocean (already falling: %s)", (falling) => {
  const hell = realmBaseline(baseline, "hell");
  const events: WorkerMessage[] = [];
  const sim = new Simulation(hell.world, heights, (event) => events.push(event), undefined, true);
  try {
    sim.setMonsterCount(0);
    sim.plane.p = [4608, HELL_LAVA_LEVEL - 4, 4608];
    sim.plane.pitch = 1.12;
    sim.plane.speed = CONFIG.boostSpeed;
    sim.plane.v = [0, 180, 20];
    sim.input.boost = true;
    sim.plane.falling = falling;
    sim.plane.crashed = falling ? CONFIG.respawnDelay : 0;
    for (let i = 0; i < 30 && !(sim.plane.crashed > 0 && !sim.plane.falling); i++) sim.step();
    expect(sim.plane.crashed).toBeGreaterThan(0);
    expect(sim.plane.falling).toBe(false);
    expect(sim.plane.p[1]).toBeCloseTo(HELL_LAVA_LEVEL - 2.2);
    sim.step();
    expect(events.filter((event) => event.type === "explosion" && event.kind === "crash")).toHaveLength(1);
    sim.respawn();
    expect(sim.world.realm).toBe("hell");
    expect(sim.plane.crashed).toBe(0);
    expect(sim.plane.p[1]).toBeLessThan(HELL_LAVA_LEVEL - 2.2);
  } finally { sim.dispose(); }
});

it("keeps ordinary surface flight safe at the same altitude", () => {
  const surface = realmBaseline(baseline, "surface");
  const sim = new Simulation(surface.world, heights, () => {}, undefined, true);
  try {
    sim.setMonsterCount(0);
    sim.plane.p = [4608, HELL_LAVA_LEVEL - 4, 4608];
    sim.plane.pitch = 1.12;
    sim.plane.speed = CONFIG.boostSpeed;
    sim.input.boost = true;
    for (let i = 0; i < 15; i++) sim.step();
    expect(sim.plane.p[1]).toBeGreaterThan(HELL_LAVA_LEVEL);
    expect(sim.plane.crashed).toBe(0);
  } finally { sim.dispose(); }
});
