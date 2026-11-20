import { beforeAll, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { Economy } from "../src/economy/earnings";
import {
  AMMO_COST,
  AIRSTRIKE_BLASTS,
  BOUNTY,
  CRATE_GEMS,
  DUST_PER_GEM,
  GEM_BUNDLES,
  PITY_CRATES,
  REVIVE_BUNDLE,
  inflate,
  inflation,
  wasPrice,
  CLUSTER_SHELLS,
  COMBO_WINDOW,
  DECOY_SECONDS,
  itemById,
  GOLD_ALL_BONUS,
  GOLD_PAYOUT,
  MATERIAL_PAYOUT,
  SITE_LEVELED_PAYOUT,
  STARTING_BALANCE,
  UPGRADE_TIERS,
  comboMultiplier,
  upgradePrice,
} from "../src/economy/pricing";
import { WEAPONS } from "../src/config";
import {
  GOLD_COUNT,
  GOLD_SPACING,
  goldenPineapples,
} from "../src/economy/collectibles";
import { ACTIVE_CONTRACTS } from "../src/economy/contracts";
import * as THREE from "three";
import { applyCosmetics } from "../src/render/cosmetics";
import { normalizeWallet } from "../src/economy/wallet";
import { Simulation, initializePhysics } from "../src/sim/simulation";
import {
  WeaponDriver,
  type WeaponDriverContext,
} from "../src/sim/weapon-driver";
import type { PlaneState, WorkerMessage, WorldData } from "../src/types";

const world: WorldData = JSON.parse(
  readFileSync("tests/fixtures/legacy-world/world.json", "utf8"),
);
const b = readFileSync("tests/fixtures/legacy-world/world.bin"),
  base = new Float32Array(
    b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
  );
beforeAll(initializePhysics);

const wallet = (balance: number) => ({ ...normalizeWallet({}), balance });

it("normalizes missing and corrupt wallets to the starting balance", () => {
  expect(normalizeWallet(undefined)).toEqual({
    version: 1,
    balance: STARTING_BALANCE,
    lifetime: 0,
    spent: 0,
    upgrades: {},
    owned: [],
    equipped: {},
    gems: 0,
    dust: 0,
    pity: 0,
    crates: 0,
    streak: { day: 0, count: 0 },
    islands: {},
  });
  expect(normalizeWallet({ balance: -5, lifetime: "x", spent: NaN })).toEqual(
    normalizeWallet(undefined),
  );
  expect(normalizeWallet({ balance: 1234.9, lifetime: 9000 }).balance).toBe(
    1234,
  );
});

it("pools destruction pay by material and reports it once", () => {
  const messages: WorkerMessage[] = [];
  const economy = new Economy(world, new Set(), wallet(0), (m) =>
    messages.push(m),
  );
  const stone = world.entities.find((e) => e.material === "sandstone")!;
  const tree = world.entities.find((e) => e.material === "foliage")!;
  economy.entityRemoved(stone);
  economy.entityRemoved(tree);
  expect(economy.wallet.balance).toBe(0);
  economy.step(1);
  const expected = MATERIAL_PAYOUT.sandstone + MATERIAL_PAYOUT.foliage;
  expect(economy.wallet.balance).toBe(expected);
  expect(economy.wallet.lifetime).toBe(expected);
  expect(messages.filter((m) => m.type === "earn")).toEqual([
    expect.objectContaining({ amount: expected, label: "DESTRUCTION" }),
  ]);
  expect(messages.at(-1)).toMatchObject({
    type: "wallet",
    wallet: { balance: expected },
  });
});

it("pays a site bonus once when most of it is destroyed", () => {
  const messages: WorkerMessage[] = [];
  const economy = new Economy(world, new Set(), wallet(0), (m) =>
    messages.push(m),
  );
  const hamlet = world.sites.find((s) => s.kind === "hamlet" && !s.town)!;
  const blocks = world.entities.filter(
    (e) => e.kind === "block" && hamlet.assemblies.includes(e.assembly),
  );
  for (const e of blocks) economy.entityRemoved(e);
  const bonuses = messages.filter(
    (m) => m.type === "earn" && m.label === "HAMLET LEVELED",
  );
  expect(bonuses).toHaveLength(1);
  expect(bonuses[0]).toMatchObject({ amount: SITE_LEVELED_PAYOUT.hamlet });
});

it("does not pay for sites that were already destroyed in the save", () => {
  const hamlet = world.sites.find((s) => s.kind === "hamlet")!;
  const blocks = world.entities.filter(
    (e) => e.kind === "block" && hamlet.assemblies.includes(e.assembly),
  );
  const removed = new Set(blocks.map((e) => e.id));
  const messages: WorkerMessage[] = [];
  const economy = new Economy(world, removed, wallet(0), (m) =>
    messages.push(m),
  );
  economy.entityRemoved(blocks[0]);
  expect(messages.some((m) => m.type === "earn" && /LEVELED/.test(m.label))).toBe(
    false,
  );
});

it("multiplies bounties for quick kill chains and lets the combo lapse", () => {
  const economy = new Economy(world, new Set(), wallet(0), () => {});
  economy.defeated("monster", [0, 0, 0]);
  economy.defeated("monster", [0, 0, 0]);
  economy.defeated("fly", [0, 0, 0], false);
  expect(economy.wallet.balance).toBe(
    BOUNTY.monster + BOUNTY.monster * comboMultiplier(2) +
      BOUNTY.fly * comboMultiplier(3),
  );
  expect(economy.view().combo).toBe(3);
  economy.step(6);
  expect(economy.view().combo).toBe(0);
  const before = economy.wallet.balance;
  economy.defeated("monster", [0, 0, 0], true);
  expect(economy.wallet.balance - before).toBe(BOUNTY.monster * BOUNTY.enraged);
});

it("refuses unaffordable shots without consuming the cooldown", () => {
  const charge = vi.fn();
  const host = {
    weapon: "nuke",
    input: { fire: true },
    cooldowns: { cannon: 0, nuke: 0, laser: 0, gravityBomb: 0 },
    destruction: { noCooldown: false },
    projectiles: [],
    pendingJobs: [],
    shots: 0,
    nextShot: 1,
    nukeYield: "local",
    sweep: () => null,
    monsters: { intersect: () => null },
    explode: vi.fn(),
    detonateNuke: vi.fn(),
    canAfford: () => false,
    charge,
  } as unknown as WeaponDriverContext;
  const plane: PlaneState = {
    p: [1000, 1000, 100],
    v: [0, 0, 35],
    yaw: 0,
    pitch: 0,
    roll: 0,
    speed: 35,
    crashed: 0,
    boundary: false,
  };
  const driver = new WeaponDriver(host);
  driver.fire(plane, [0, 0, 1]);
  expect(host.projectiles).toHaveLength(0);
  expect(host.cooldowns.nuke).toBe(0);
  expect(charge).not.toHaveBeenCalled();
  host.canAfford = () => true;
  driver.fire(plane, [0, 0, 1]);
  expect(host.projectiles).toHaveLength(1);
  expect(charge).toHaveBeenCalledWith("nuke");
});

it("charges nukes from the simulation wallet and keeps weapons free without one", () => {
  const free = new Simulation(world, base, () => {});
  expect(free.economy).toBeUndefined();
  expect(free.snapshot().economy).toBeUndefined();
  free.dispose();

  const s = new Simulation(world, base, () => {});
  s.setWallet(wallet(AMMO_COST.nuke + 10));
  s.weapon = "nuke";
  s.input = { ...s.input, fire: true };
  s.step();
  expect(s.economy!.wallet.balance).toBe(10);
  expect(s.economy!.wallet.spent).toBe(AMMO_COST.nuke);
  expect(s.projectiles).toHaveLength(1);
  s.dispose();

  const broke = new Simulation(world, base, () => {});
  broke.setWallet(wallet(10));
  broke.weapon = "nuke";
  broke.input = { ...broke.input, fire: true };
  for (let i = 0; i < 5; i++) broke.step();
  expect(broke.projectiles).toHaveLength(0);
  expect(broke.cooldowns.nuke).toBe(0);
  expect(broke.economy!.wallet.spent).toBe(0);
  broke.dispose();
});

it("pays for destruction caused in play", () => {
  const s = new Simulation(world, base, () => {});
  s.setWallet(wallet(0));
  const site = world.sites.find((x) => x.kind === "hamlet")!;
  const e = world.entities.find(
    (e) => e.foundation && site.assemblies.includes(e.assembly),
  )!;
  s.explode([e.p[0], e.p[1] - e.s[1] + 1, e.p[2]]);
  for (let i = 0; i < 60; i++) s.step();
  expect(s.economy!.wallet.balance).toBeGreaterThan(0);
  expect(s.snapshot().economy!.balance).toBe(s.economy!.wallet.balance);
  s.dispose();
});

it("sells upgrade tiers at rising prices and stops at the max tier", () => {
  const messages: WorkerMessage[] = [];
  const economy = new Economy(world, new Set(), wallet(1_000_000), (m) =>
    messages.push(m),
  );
  let spent = 0;
  for (let tier = 0; tier < UPGRADE_TIERS; tier++) {
    expect(economy.buyUpgrade("armor")).toBe(true);
    spent += upgradePrice(tier);
  }
  expect(economy.buyUpgrade("armor")).toBe(false);
  expect(economy.tier("armor")).toBe(UPGRADE_TIERS);
  expect(economy.wallet.balance).toBe(1_000_000 - spent);
  expect(upgradePrice(0)).toBe(1000);
  expect(upgradePrice(1)).toBe(2200);
  expect(messages.at(-1)).toMatchObject({
    type: "wallet",
    wallet: { upgrades: { armor: UPGRADE_TIERS } },
  });
  const poor = new Economy(world, new Set(), wallet(999), () => {});
  expect(poor.buyUpgrade("engine")).toBe(false);
  expect(poor.wallet.balance).toBe(999);
});

it("applies the discount to ammo and the bounty bonus to earnings", () => {
  const economy = new Economy(
    world,
    new Set(),
    { ...wallet(0), upgrades: { discount: 5, bounty: 5 } },
    () => {},
  );
  expect(economy.cost("nuke")).toBe(Math.round(AMMO_COST.nuke * 0.6));
  expect(economy.view().costs.cannon).toBe(0);
  economy.defeated("monster", [0, 0, 0]);
  expect(economy.wallet.balance).toBe(BOUNTY.monster * 1.5);
});

it("keeps upgrades through wallet normalization and drops bad tiers", () => {
  expect(
    normalizeWallet({ upgrades: { engine: 3, laserSize: 99, bogus: 2, armor: -1 } })
      .upgrades,
  ).toEqual({ engine: 3, laserSize: UPGRADE_TIERS });
});

it("only charges for services that can apply", () => {
  const s = new Simulation(world, base, () => {});
  s.setWallet(wallet(5000));
  expect(s.buyService("repair")).toBe(false);
  expect(s.buyService("wave")).toBe(false);
  expect(s.economy!.wallet.balance).toBe(5000);
  s.plane.health = 40;
  expect(s.buyService("repair")).toBe(true);
  expect(s.plane.health).toBe(100);
  expect(s.buyService("shield")).toBe(true);
  expect(s.plane.shield).toBeGreaterThanOrEqual(20);
  expect(s.buyService("travel", [3000, 3000])).toBe(true);
  expect(s.plane.p[0]).toBe(3000);
  expect(s.plane.p[2]).toBe(3000);
  expect(s.plane.p[1]).toBeGreaterThan(s.terrain.sample(3000, 3000));
  expect(s.economy!.wallet.balance).toBe(5000 - 400 - 800 - 600);
  s.dispose();
});

it("revives cleaned-up monsters for a paid wave", () => {
  const s = new Simulation(world, base, () => {});
  s.setWallet(wallet(5000));
  const dead = s.monsters.states.slice(0, 3);
  for (const m of dead) Object.assign(m, { defeated: true, cleared: true });
  expect(s.buyService("wave")).toBe(true);
  for (const m of dead) {
    expect(m.defeated).toBe(false);
    expect(m.health).toBeGreaterThan(0);
  }
  expect(s.economy!.wallet.balance).toBe(4000);
  s.dispose();
});

it("upgrades speed up the cannon and enlarge nukes and lasers", () => {
  const s = new Simulation(world, base, () => {});
  s.setWallet({
    ...wallet(100_000),
    upgrades: { cannonRate: 5, nukeYield: 5, laserSize: 5 },
  });
  s.input = { ...s.input, fire: true };
  s.weapon = "cannon";
  s.step();
  expect(s.cooldowns.cannon).toBeLessThan(WEAPONS.cannon.cooldown * 0.5);
  s.input = { ...s.input, fire: false };
  s.startLaser([4000, 0, 4000]);
  const free = new Simulation(world, base, () => {});
  free.startLaser([4000, 0, 4000]);
  expect(s.lasers.at(-1)!.profile!.radius).toBeCloseTo(
    free.lasers.at(-1)!.profile!.radius * 1.5,
  );
  free.dispose();
  s.weapon = "nuke";
  s.input = { ...s.input, fire: true };
  s.step();
  const nuke = s.projectiles.find((p) => p.weapon === "nuke");
  expect(nuke?.profile).toBeDefined();
  s.dispose();
});

it("places golden pineapples deterministically, spaced apart, none in the abyss", () => {
  const a = goldenPineapples(world);
  expect(a.length).toBeGreaterThan(10);
  expect(a.length).toBeLessThanOrEqual(GOLD_COUNT);
  expect(goldenPineapples(world)).toEqual(a);
  for (let i = 0; i < a.length; i++)
    for (let j = i + 1; j < a.length; j++)
      expect(
        Math.hypot(a[i][0] - a[j][0], a[i][2] - a[j][2]),
      ).toBeGreaterThanOrEqual(GOLD_SPACING);
  expect(goldenPineapples({ ...world, seed: world.seed + 1 })).not.toEqual(a);
  expect(goldenPineapples({ ...world, realm: "hell" })).toEqual([]);
});

it("collects each golden pineapple once and remembers it per island", () => {
  const messages: WorkerMessage[] = [];
  const economy = new Economy(world, new Set(), wallet(0), (m) =>
    messages.push(m),
  );
  const g = economy.gold[0];
  economy.collect([g[0] + 5, g[1], g[2]]);
  economy.collect([g[0], g[1], g[2]]);
  expect(economy.wallet.balance).toBe(GOLD_PAYOUT);
  expect(economy.view().gold).toEqual({ collected: 1, total: economy.gold.length });
  expect(messages.find((m) => m.type === "gold")).toMatchObject({
    collected: [0],
  });
  const again = new Economy(world, new Set(), economy.wallet, () => {});
  again.collect([g[0], g[1], g[2]]);
  expect(again.wallet.balance).toBe(GOLD_PAYOUT);
  const elsewhere = new Economy(
    { ...world, seed: world.seed + 1 },
    new Set(),
    economy.wallet,
    () => {},
  );
  expect(elsewhere.view().gold.collected).toBe(0);
});

it("pays a bonus for every golden pineapple", () => {
  const economy = new Economy(world, new Set(), wallet(0), () => {});
  for (const g of economy.gold) economy.collect(g);
  expect(economy.wallet.balance).toBeGreaterThanOrEqual(
    economy.gold.length * GOLD_PAYOUT + GOLD_ALL_BONUS,
  );
});

it("keeps three deterministic contracts and pays and replaces completed ones", () => {
  const a = new Economy(world, new Set(), wallet(0), () => {});
  const b = new Economy(world, new Set(), wallet(0), () => {});
  expect(a.view().contracts).toHaveLength(ACTIVE_CONTRACTS);
  expect(a.view().contracts).toEqual(b.view().contracts);
  const kills = a.view().contracts.find((c) => c.kind === "kills");
  const stone = a.view().contracts.find((c) => c.kind === "stone");
  const target = kills ?? stone;
  expect(target).toBeDefined();
  const block = world.entities.find((e) => e.material === "sandstone")!;
  for (let i = 0; i < target!.goal; i++) {
    if (target!.kind === "kills") {
      a.step(COMBO_WINDOW + 1);
      a.defeated("monster", [0, 0, 0]);
    } else a.entityRemoved(block);
  }
  a.step(1);
  expect(a.wallet.lifetime).toBeGreaterThanOrEqual(target!.reward);
  expect(a.view().contracts).toHaveLength(ACTIVE_CONTRACTS);
  expect(a.view().contracts).not.toContainEqual(
    expect.objectContaining({ text: target!.text, progress: target!.goal }),
  );
});

it("completes a level contract when its site is leveled", () => {
  const messages: WorkerMessage[] = [];
  let economy: Economy | undefined;
  // Find a seed whose board includes a level contract.
  for (let seed = 1; seed < 200 && !economy; seed++) {
    const candidate = new Economy(
      { ...world, seed },
      new Set(),
      wallet(0),
      (m) => messages.push(m),
    );
    if (candidate.view().contracts.some((c) => c.kind === "level"))
      economy = candidate;
  }
  expect(economy).toBeDefined();
  const contract = economy!.view().contracts.find((c) => c.kind === "level")!;
  const site = world.sites[contract.site!];
  for (const e of world.entities)
    if (e.kind === "block" && site.assemblies.includes(e.assembly))
      economy!.entityRemoved(e);
  expect(
    messages.some(
      (m) => m.type === "earn" && m.label === `CONTRACT · ${contract.text.toUpperCase()}`,
    ),
  ).toBe(true);
});

it("drops malformed island progress when normalizing", () => {
  const w = normalizeWallet({
    islands: {
      "surface:1": {
        gold: [1, 1, -2, "x", 3],
        contracts: [
          { kind: "kills", text: "Defeat 5 monsters", goal: 5, progress: 9, reward: 750 },
          { kind: "bogus", text: "x", goal: 1, progress: 0, reward: 1 },
        ],
        counter: 4,
      },
      broken: 7,
    },
  });
  expect(w.islands).toEqual({
    "surface:1": {
      gold: [1, 3],
      contracts: [
        { kind: "kills", text: "Defeat 5 monsters", goal: 5, progress: 5, reward: 750 },
      ],
      counter: 4,
    },
  });
});

it("buys cosmetics once, equips them and lets them be unequipped", () => {
  const economy = new Economy(world, new Set(), wallet(10_000), () => {});
  expect(economy.buyItem("jet-gold")).toBe(true);
  expect(economy.buyItem("jet-gold")).toBe(false);
  expect(economy.buyItem("nonsense")).toBe(false);
  expect(economy.wallet.balance).toBe(7000);
  expect(economy.wallet.equipped.jetPaint).toBe("jet-gold");
  expect(economy.equip("jetPaint")).toBe(true);
  expect(economy.wallet.equipped.jetPaint).toBeUndefined();
  expect(economy.equip("jetPaint", "jet-pink")).toBe(false);
  expect(economy.equip("truckPaint", "jet-gold")).toBe(false);
  expect(economy.equip("jetPaint", "jet-gold")).toBe(true);
  const poor = new Economy(world, new Set(), wallet(100), () => {});
  expect(poor.buyItem("gadget-airstrike")).toBe(false);
});

it("only keeps owned, known items equipped in their own slot", () => {
  const w = normalizeWallet({
    owned: ["jet-gold", "jet-gold", "bogus", "perk-magnet"],
    equipped: { jetPaint: "jet-gold", truckPaint: "jet-gold", trail: "trail-plasma" },
  });
  expect(w.owned).toEqual(["jet-gold", "perk-magnet"]);
  expect(w.equipped).toEqual({ jetPaint: "jet-gold" });
});

it("charges per gadget use and enforces its cooldown", () => {
  const s = new Simulation(world, base, () => {});
  s.setWallet({
    ...wallet(2000),
    owned: ["gadget-cluster"],
    equipped: { gadget: "gadget-cluster" },
  });
  const before = s.projectiles.length;
  expect(s.useGadget()).toBe(true);
  expect(s.projectiles.length - before).toBe(CLUSTER_SHELLS);
  expect(s.economy!.wallet.balance).toBe(2000 - itemById("gadget-cluster")!.use!);
  expect(s.useGadget()).toBe(false);
  expect(s.snapshot().economy!.gadget).toMatchObject({ id: "gadget-cluster" });
  for (let i = 0; i < 60 * 3 + 5; i++) s.step();
  expect(s.economy!.view().gadget!.cooldown).toBe(0);
  s.dispose();
  const none = new Simulation(world, base, () => {});
  none.setWallet(wallet(2000));
  expect(none.useGadget()).toBe(false);
  expect(none.economy!.wallet.balance).toBe(2000);
  none.dispose();
});

it("drops a decoy that expires and calls in a delayed airstrike", () => {
  const messages: WorkerMessage[] = [];
  const s = new Simulation(world, base, (m) => messages.push(m));
  s.setWallet({
    ...wallet(5000),
    owned: ["gadget-decoy", "gadget-airstrike"],
    equipped: { gadget: "gadget-decoy" },
  });
  expect(s.useGadget()).toBe(true);
  expect(s.snapshot().economy!.decoy).toBeDefined();
  for (let i = 0; i < 60 * (DECOY_SECONDS + 0.5); i++) s.step();
  expect(s.decoy).toBeUndefined();
  // Gadgets share one cooldown; wait out the decoy's.
  const cooldown = itemById("gadget-decoy")!.cooldown!;
  for (let i = 0; i < 60 * (cooldown - DECOY_SECONDS); i++) s.step();
  s.equip("gadget", "gadget-airstrike");
  s.plane.p = [4600, 400, 4600];
  s.plane.v = [0, 0, 100];
  messages.length = 0;
  expect(s.useGadget()).toBe(true);
  const blasts = () =>
    messages.filter((m) => m.type === "explosion" && m.kind === "blast").length;
  expect(blasts()).toBe(0);
  for (let i = 0; i < 60 * 3; i++) s.step();
  expect(blasts()).toBeGreaterThanOrEqual(AIRSTRIKE_BLASTS);
  s.dispose();
});

it("widens golden pineapple pickup with the magnet perk", () => {
  const plain = new Economy(world, new Set(), wallet(0), () => {});
  const g = plain.gold[0];
  plain.collect([g[0] + 100, g[1], g[2]]);
  expect(plain.view().gold.collected).toBe(0);
  const magnet = new Economy(
    world,
    new Set(),
    { ...wallet(0), owned: ["perk-magnet"] },
    () => {},
  );
  magnet.collect([g[0] + 100, g[1], g[2]]);
  expect(magnet.view().gold.collected).toBe(1);
});

it("repaints only the matching base material and restores it", () => {
  const body = new THREE.MeshStandardMaterial({ color: "#d4e0d9" });
  const other = new THREE.MeshStandardMaterial({ color: "#263c44" });
  const flameMaterial = new THREE.MeshBasicMaterial({ color: "#ffaa33" });
  const jet = new THREE.Group();
  const flame = new THREE.Mesh(new THREE.BoxGeometry(), flameMaterial);
  flame.name = "flame";
  jet.add(
    new THREE.Mesh(new THREE.BoxGeometry(), body),
    new THREE.Mesh(new THREE.BoxGeometry(), other),
    flame,
  );
  applyCosmetics({ jet }, { jetPaint: "jet-pink", trail: "trail-plasma" });
  expect(`#${body.color.getHexString()}`).toBe("#ff5fa2");
  expect(`#${other.color.getHexString()}`).toBe("#263c44");
  expect(`#${flameMaterial.color.getHexString()}`).toBe("#4fb8ff");
  applyCosmetics({ jet }, {});
  expect(`#${body.color.getHexString()}`).toBe("#d4e0d9");
  expect(`#${flameMaterial.color.getHexString()}`).toBe("#ffaa33");
});

it("sells gems in bundles where 'best value' is the worst deal", () => {
  const perGem = GEM_BUNDLES.map((b) => b.price / b.gems);
  const best = GEM_BUNDLES.findIndex((b) => b.tag.startsWith("BEST VALUE"));
  expect(perGem[best]).toBeGreaterThan(Math.min(...perGem));
  for (const b of GEM_BUNDLES) expect(b.gems % CRATE_GEMS).not.toBe(0);
  const economy = new Economy(world, new Set(), wallet(1000), () => {});
  expect(economy.buyGems("gems-s")).toBe(true);
  expect(economy.wallet.gems).toBe(7);
  expect(economy.buyGems("gems-s")).toBe(false);
});

it("rolls crates by the published odds, with dust for duplicates and pity", () => {
  const messages: WorkerMessage[] = [];
  const economy = new Economy(
    world,
    new Set(),
    { ...wallet(0), gems: CRATE_GEMS * 60 },
    (m) => messages.push(m),
  );
  const rolls = (...values: number[]) => () => values.shift() ?? 0;
  const legendary = economy.openCrate(rolls(0, 0))!;
  expect(legendary.rarity).toBe("legendary");
  expect(economy.owns(legendary.itemId!)).toBe(true);
  expect(economy.wallet.equipped[itemById(legendary.itemId!)!.slot]).toBe(
    legendary.itemId,
  );
  const again = economy.openCrate(rolls(0, 0))!;
  expect(again).toMatchObject({ itemId: legendary.itemId, duplicate: true });
  expect(economy.wallet.dust).toBe(again.dust);
  expect(messages.filter((m) => m.type === "crate")).toHaveLength(2);
  // Commons until the pity timer forces an epic.
  let forced: string | undefined;
  for (let i = 0; i < PITY_CRATES && !forced; i++) {
    const r = economy.openCrate(rolls(0.99, 0))!;
    if (r.rarity === "epic") forced = r.itemId;
    else expect(r.rarity).toBe("common");
  }
  expect(forced).toBeDefined();
  expect(economy.wallet.pity).toBe(0);
  const broke = new Economy(world, new Set(), wallet(0), () => {});
  expect(broke.openCrate()).toBeUndefined();
});

it("exchanges a thousand dust for one gem", () => {
  const economy = new Economy(
    world,
    new Set(),
    { ...wallet(0), dust: DUST_PER_GEM + 5 },
    () => {},
  );
  expect(economy.exchangeDust()).toBe(true);
  expect(economy.wallet).toMatchObject({ dust: 5, gems: 1 });
  expect(economy.exchangeDust()).toBe(false);
});

it("pays daily streak rewards and resets after a missed day", () => {
  const economy = new Economy(world, new Set(), wallet(0), () => {});
  expect(economy.claimDaily(100)).toBe(true);
  expect(economy.claimDaily(100)).toBe(false);
  expect(economy.wallet.streak).toEqual({ day: 100, count: 1 });
  for (let d = 101; d <= 107; d++) economy.claimDaily(d);
  expect(economy.wallet.streak.count).toBe(1); // day 8 wraps to day 1
  economy.claimDaily(108);
  expect(economy.wallet.streak.count).toBe(2);
  economy.claimDaily(111);
  expect(economy.wallet.streak.count).toBe(1);
  expect(economy.wallet.gems).toBe(5 + 10 + CRATE_GEMS);
});

it("raises prices as lifetime earnings grow and hides crate exclusives", () => {
  expect(inflation(0)).toBe(1);
  expect(inflation(200_000)).toBeCloseTo(1.1);
  expect(inflation(1e9)).toBeCloseTo(1.6);
  const rich = new Economy(
    world,
    new Set(),
    { ...wallet(100_000), lifetime: 200_000 },
    () => {},
  );
  expect(rich.cost("nuke")).toBe(inflate(AMMO_COST.nuke, 200_000));
  expect(rich.cost("nuke")).toBeGreaterThan(AMMO_COST.nuke);
  expect(rich.buyItem("jet-diamond")).toBe(false);
  expect(wasPrice(1000)).toBeGreaterThan(1000);
});

it("sells a shielded revive only while wrecked", () => {
  const s = new Simulation(world, base, () => {});
  s.setWallet(wallet(5000));
  expect(s.buyRevive()).toBe(false);
  s.plane.crashed = 1;
  expect(s.buyRevive()).toBe(true);
  expect(s.buyRevive()).toBe(false);
  expect(s.economy!.wallet.balance).toBe(5000 - REVIVE_BUNDLE.price);
  s.respawn();
  s.applyRevive();
  expect(s.plane.crashed).toBe(0);
  expect(s.plane.shield).toBeGreaterThanOrEqual(REVIVE_BUNDLE.shield);
  s.dispose();
});
