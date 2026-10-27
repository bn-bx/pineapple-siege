import { readFileSync } from "node:fs";
import { beforeAll, expect, it } from "vitest";
import { arrivalPlane, portalIntact, portalSite, realmBaseline } from "../src/realm";
import { Simulation, initializePhysics } from "../src/sim/simulation";
import { compatible } from "../src/storage";
import type { WorkerMessage, WorldData } from "../src/types";
import { generateIsland } from "../src/world/generator.mjs";
import { CONFIG, HELL_LAVA_LEVEL } from "../src/config";
import toilet from "../src/world/toilet-manifest.json" with { type: "json" };

const world = JSON.parse(readFileSync("public/world.json", "utf8")) as WorldData;
const bytes = readFileSync("public/world.bin");
const heights = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
const baseline = { world, heights };
beforeAll(() => initializePhysics());

const role = (realm: WorldData, id: number) =>
  toilet.owners[realm.entities[id].visual!.modelOwner!].role;
const toiletIds = (realm: WorldData) =>
  realm.entities.filter((e) => e.visual?.modelOwner !== undefined).map((e) => e.id);
/** Model-local coordinates relative to the toilet's pedestal centre. */
function local(site: NonNullable<WorldData["portal"]>, x: number, z: number) {
  const c = Math.cos(site.yaw!), s = Math.sin(site.yaw!), dx = x - site.base![0], dz = z - site.base![2];
  return [c * dx - s * dz, s * dx + c * dz];
}
function dive(sim: Simulation, site: NonNullable<WorldData["portal"]>) {
  // At full dive the aircraft drifts about 45 m, so start over the back of the
  // seat hole and head down through it toward the bowl's front lip.
  const front = [Math.sin(site.yaw!), Math.cos(site.yaw!)];
  sim.plane.p = [site.x - front[0] * 30, site.top! - 5, site.z - front[1] * 30];
  sim.plane.yaw = site.yaw!;
  sim.plane.pitch = -1.35;
  sim.plane.speed = 130;
  sim.portalGrace = 0;
}

it("derives the same toilet portal in independent surface and inverted realms", () => {
  const site = portalSite(baseline);
  const surface = realmBaseline(baseline, "surface");
  const hell = realmBaseline(baseline, "hell");
  expect(surface.world.portal).toEqual(hell.world.portal);
  expect(surface.world.portal!.x).toBe(site.x);
  expect(site.radius).toBe(54);
  const ids = toiletIds(surface.world);
  expect(ids).toHaveLength(toilet.owners.length);
  expect(surface.world.portal!.ids.length).toBeGreaterThan(0);
  for (const id of surface.world.portal!.ids) expect(["bowl", "seat"]).toContain(role(surface.world, id));
  expect(ids.filter((id) => ["bowl", "seat"].includes(role(surface.world, id)))).toEqual(surface.world.portal!.ids);
  expect(hell.world.civilians).toEqual([]);
  expect(surface.world.civilians!.length).toBeGreaterThan(0);
  expect(surface.world.entities.length).toBe(world.entities.length + 12 + toilet.owners.length);
  expect(hell.world.entities.length).toBe(surface.world.entities.length);
  // The stone ring's ids stay reserved, so saves that broke it leave the toilet whole.
  for (let id = world.entities.length; id < world.entities.length + 12; id++)
    expect(surface.world.portal!.retired).toContain(id);
  expect(portalIntact(hell.world, new Set())).toBe(true);
  expect(portalIntact(hell.world, new Set([hell.world.portal!.ids[0]]))).toBe(false);
  expect(portalIntact(hell.world, new Set(surface.world.portal!.retired))).toBe(true);
  expect(world.portal).toBeUndefined();
  for (const realm of [surface.world, hell.world]) {
    const cleared = new Set(realm.portal!.clearedTrees);
    for (const entity of realm.entities) {
      expect(realm.entities[entity.id].id).toBe(entity.id);
      if (entity.kind !== "tree") continue;
      const [lx, lz] = local(realm.portal!, entity.p[0], entity.p[2]);
      if (lx > toilet.bounds.min[0] - 30 && lx < toilet.bounds.max[0] + 30 &&
        lz > toilet.bounds.min[2] - 30 && lz < toilet.bounds.max[2] + 30)
        expect(cleared.has(entity.id)).toBe(true);
    }
  }
});

it("seats the toilet with its hole over the bowl water and connects every piece to the ground", () => {
  const surface = realmBaseline(baseline, "surface"), site = surface.world.portal!;
  expect(site.y).toBeCloseTo(site.base![1] + toilet.waterY);
  expect(site.top).toBeGreaterThan(site.y + 60);
  const [lx, lz] = local(site, site.x, site.z);
  expect(lx).toBeCloseTo(toilet.hole.x);
  expect(lz).toBeCloseTo(toilet.hole.z);
  const parts = toiletIds(surface.world).map((id) => surface.world.entities[id]);
  const grounded = new Set(parts.filter((e) => e.foundation).map((e) => e.id));
  expect(grounded.size).toBeGreaterThan(0);
  const queue = [...grounded];
  while (queue.length)
    for (const next of surface.world.entities[queue.pop()!].supports)
      if (!grounded.has(next)) { grounded.add(next); queue.push(next); }
  expect(grounded.size).toBe(parts.length);
});

it("places clear, traversable toilets across island seeds", () => {
  for (const seed of [1, 0x1bcdef, 0xdeadbeef]) {
    const generated = realmBaseline(generateIsland(seed), "surface");
    const site = generated.world.portal!;
    expect(site.y).toBeGreaterThan(15);
    // The yaw search avoids buildings; only the stone ring's slots and rocks are retired.
    expect(site.retired.filter((id) => generated.world.entities[id].kind === "block" &&
      generated.world.entities[id].assembly !== "portal-retired")).toEqual([]);
  }
}, 120_000);

it("keeps terrain below the bowl and tank of the shipped island", () => {
  const site = portalSite(baseline), { min, max } = toilet.bounds;
  const c = Math.cos(site.yaw), s = Math.sin(site.yaw);
  for (let lz = min[2]; lz <= max[2]; lz += 4)
    for (let lx = min[0]; lx <= max[0]; lx += 4) {
      const x = site.base[0] + c * lx + s * lz, z = site.base[2] - s * lx + c * lz;
      const ix = Math.floor(x / CONFIG.spacing), iz = Math.floor(z / CONFIG.spacing);
      expect(heights[iz * CONFIG.grid + ix]).toBeLessThan(site.base[1] + 50);
    }
});

it("lets a descending aircraft cross the seat hole into the bowl and preserves a valid save", () => {
  const surface = realmBaseline(baseline, "surface");
  const site = surface.world.portal!;
  const messages: WorkerMessage[] = [];
  const sim = new Simulation(surface.world, heights, (message) => messages.push(message), undefined, true);
  sim.setMonsterCount(0);
  dive(sim, site);
  for (let i = 0; i < 90 && !messages.some((m) => m.type === "portalEnter"); i++) sim.step();
  const event = messages.find((m) => m.type === "portalEnter");
  expect(event?.type).toBe("portalEnter");
  expect(sim.plane.crashed).toBe(0);
  if (event?.type === "portalEnter") {
    expect(event.plane.p[1]).toBeLessThan(site.y + 5);
    const arrived = arrivalPlane(event.plane, site);
    expect(arrived.p[1]).toBe(site.exit);
    expect(arrived.pitch).toBeGreaterThan(0);
    expect(arrived.speed).toBe(event.plane.speed);
    // Leave over the front lip, away from the raised lid.
    expect(Math.sin(arrived.yaw) * Math.sin(site.yaw!) + Math.cos(arrived.yaw) * Math.cos(site.yaw!)).toBeGreaterThanOrEqual(0);
  }
  const save = sim.save();
  for (const id of [...(site.clearedTrees ?? []), ...site.retired!]) expect(sim.removed.has(id)).toBe(true);
  const oldSave = { ...save, removed: save.removed.filter((id) => !site.clearedTrees?.includes(id)) };
  const restored = new Simulation(surface.world, heights, () => {}, oldSave, true);
  try {
    for (const id of site.clearedTrees ?? []) expect(restored.removed.has(id)).toBe(true);
  } finally { restored.dispose(); }
  expect(compatible(save, world.version, world.seed)).toBe(true);
  sim.dispose();
});

it("turns an arrival heading toward the tank back out over the bowl", () => {
  const site = realmBaseline(baseline, "surface").world.portal!;
  const toward = Math.atan2(-Math.sin(site.yaw!), -Math.cos(site.yaw!));
  // This dive's half-turn emergence would head straight at the tank.
  const arrived = arrivalPlane({
    p: [0, 0, 0], v: [0, -100, 0], yaw: Math.PI - toward, pitch: -1.2, roll: 0,
    speed: 130, crashed: 0, boundary: false, falling: false,
  }, site);
  expect(Math.sin(arrived.yaw) * Math.sin(site.yaw!) + Math.cos(arrived.yaw) * Math.cos(site.yaw!)).toBeCloseTo(1);
});

it("lets a vertical approach cross anywhere inside the seat hole", () => {
  const surface = realmBaseline(baseline, "surface"), site = surface.world.portal!;
  const messages: WorkerMessage[] = [];
  const sim = new Simulation(surface.world, heights, m => messages.push(m), undefined, true);
  try {
    sim.setMonsterCount(0);
    // 43 m sideways, inside the 48 m travel radius and the 54 m seat hole.
    sim.plane.p = [site.x + Math.cos(site.yaw!) * 43, site.y + 18, site.z - Math.sin(site.yaw!) * 43];
    sim.plane.pitch = -Math.PI / 2;
    sim.plane.yaw = 0;
    sim.plane.speed = 130;
    sim.portalGrace = 0;
    for (let i = 0; i < 45 && !messages.some(m => m.type === "portalEnter"); i++) sim.step();
    expect(messages.some(m => m.type === "portalEnter")).toBe(true);
  } finally { sim.dispose(); }
});

it("lets the pineapple fly back through the intact matching bowl", () => {
  const hell = realmBaseline(baseline, "hell");
  const site = hell.world.portal!;
  const messages: WorkerMessage[] = [];
  const sim = new Simulation(hell.world, heights, (message) => messages.push(message), undefined, true);
  try {
    sim.setMonsterCount(0);
    dive(sim, site);
    for (let i = 0; i < 90 && !messages.some((m) => m.type === "portalEnter"); i++) sim.step();
    expect(messages.some((m) => m.type === "portalEnter")).toBe(true);
  } finally {
    sim.dispose();
  }
});

it("locks travel when the seat is broken but not when the tank or handle is", () => {
  const surface = realmBaseline(baseline, "surface");
  const site = surface.world.portal!;
  const ids = toiletIds(surface.world);
  const seat = ids.find((id) => role(surface.world, id) === "seat")!;
  const bowl = ids.find((id) => role(surface.world, id) === "bowl")!;
  const spare = ids.filter((id) => ["tank", "handle", "lid"].includes(role(surface.world, id)));
  expect(portalIntact(surface.world, new Set(spare))).toBe(true);
  expect(portalIntact(surface.world, new Set([bowl]))).toBe(false);
  const messages: WorkerMessage[] = [];
  const sim = new Simulation(surface.world, heights, (message) => messages.push(message), undefined, true);
  try {
    sim.setMonsterCount(0);
    sim.removed.add(seat);
    dive(sim, site);
    for (let i = 0; i < 90 && sim.plane.crashed <= 0; i++) sim.step();
    expect(messages.some((m) => m.type === "portalEnter")).toBe(false);
  } finally {
    sim.dispose();
  }
});

it("crashes an aircraft that flies into the porcelain", () => {
  const surface = realmBaseline(baseline, "surface");
  const site = surface.world.portal!;
  const messages: WorkerMessage[] = [];
  const sim = new Simulation(surface.world, heights, (message) => messages.push(message), undefined, true);
  try {
    sim.setMonsterCount(0);
    // Level flight at bowl height, from in front of the toilet toward its tank.
    const front = [Math.sin(site.yaw!), Math.cos(site.yaw!)];
    sim.plane.p = [site.x + front[0] * 260, site.base![1] + 150, site.z + front[1] * 260];
    sim.plane.yaw = site.yaw! + Math.PI;
    sim.plane.pitch = 0;
    sim.plane.speed = 130;
    sim.portalGrace = 0;
    for (let i = 0; i < 180 && sim.plane.crashed <= 0; i++) sim.step();
    expect(sim.plane.crashed).toBeGreaterThan(0);
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
