import type {
  Entity,
  StatueRole,
  Vec3,
  WeaponId,
  WorkerMessage,
  WorldData,
} from "../types";
import {
  AMMO_COST,
  BOUNTY,
  COMBO_WINDOW,
  DESTRUCTION_REPORT_INTERVAL,
  GOLD_ALL_BONUS,
  GOLD_PAYOUT,
  STONE_MATERIALS,
  MAGNET_RADIUS,
  COMMON_PRIZES,
  CRATE_GEMS,
  CRATE_ODDS,
  CRATE_POOL,
  DAILY_REWARDS,
  DUPLICATE_DUST,
  DUST_PER_GEM,
  GEM_BUNDLES,
  PITY_CRATES,
  REVIVE_BUNDLE,
  inflate,
  type GemBundleId,
  type Rarity,
  itemById,
  type ItemSlot,
  type ShopItem,
  MATERIAL_PAYOUT,
  SITE_LEVELED_FRACTION,
  SITE_LEVELED_PAYOUT,
  SERVICES,
  STATUE_PAYOUT,
  UPGRADES,
  UPGRADE_TIERS,
  comboMultiplier,
  upgradeBonus,
  upgradePrice,
  type ServiceId,
  type UpgradeId,
} from "./pricing";
import {
  islandKey,
  normalizeWallet,
  type IslandProgress,
  type Wallet,
} from "./wallet";
import { GOLD_PICKUP_RADIUS, goldenPineapples } from "./collectibles";
import {
  ACTIVE_CONTRACTS,
  generateContract,
  type Contract,
  type ContractKind,
} from "./contracts";

export interface CrateResult {
  rarity: Rarity;
  label: string;
  itemId?: string;
  duplicate?: boolean;
  dust?: number;
  bucks?: number;
}

export interface EconomyView {
  balance: number;
  /** Total ever earned; drives Dynamic Pricing™. */
  lifetime: number;
  /** Current kill chain length; 0 when no combo is running. */
  combo: number;
  /** Seconds left before the combo lapses. */
  comboTime: number;
  /** Per-shot cost of each weapon after discounts. */
  costs: Record<WeaponId, number>;
  contracts: Contract[];
  gold: { collected: number; total: number };
  /** The equipped gadget and seconds until it can be used again. */
  gadget?: { id: string; name: string; use: number; cooldown: number };
  /** Where an active decoy pineapple sits. */
  decoy?: Vec3;
}

const WALLET_REPORT_INTERVAL = 0.25;

/**
 * Worker-side owner of the pineapple-bucks wallet. Destruction, kills and
 * firing all happen in the simulation, so earning and spending are decided
 * here and mirrored to the page through `wallet` messages.
 */
export class Economy {
  readonly wallet: Wallet;
  private siteOf = new Map<number, number>();
  private siteTotal: number[] = [];
  private siteRemoved: number[] = [];
  private siteLeveled: boolean[] = [];
  private pooled = 0;
  private pooledAt?: Vec3;
  private poolClock = 0;
  private walletClock = 0;
  private walletDirty = true;
  private chain = 0;
  private chainTime = 0;
  /** Golden pineapple positions on this island. */
  readonly gold: Vec3[];
  private island: IslandProgress;
  private gadgetCooldown = 0;

  constructor(
    private world: WorldData,
    removed: ReadonlySet<number>,
    wallet: Wallet,
    private emit: (message: WorkerMessage) => void,
  ) {
    this.wallet = normalizeWallet(wallet);
    const siteByAssembly = new Map<string, number>();
    world.sites.forEach((site, index) => {
      if (site.kind === "pineapple-god") return;
      for (const a of site.assemblies) siteByAssembly.set(a, index);
      this.siteTotal[index] = 0;
      this.siteRemoved[index] = 0;
    });
    for (const e of world.entities) {
      if (e.kind !== "block") continue;
      const site = siteByAssembly.get(e.assembly);
      if (site === undefined) continue;
      this.siteOf.set(e.id, site);
      this.siteTotal[site]++;
      if (removed.has(e.id)) this.siteRemoved[site]++;
    }
    world.sites.forEach((_, index) => {
      this.siteLeveled[index] =
        !this.siteTotal[index] ||
        this.siteRemoved[index] / this.siteTotal[index] >=
          SITE_LEVELED_FRACTION;
    });
    this.gold = goldenPineapples(world);
    const key = islandKey(world);
    this.island = this.wallet.islands[key] ??= {
      gold: [],
      contracts: [],
      counter: 0,
    };
    this.island.gold = this.island.gold.filter((i) => i < this.gold.length);
    // Drop contracts that can no longer be completed on this island.
    this.island.contracts = this.island.contracts.filter(
      (c) =>
        c.kind !== "level" ||
        (c.site !== undefined && this.standingSites().includes(c.site)),
    );
    this.fillContracts();
  }

  private standingSites() {
    const standing: number[] = [];
    this.world.sites.forEach((s, index) => {
      const kind = s.kind === "hamlet" && s.town ? "town" : s.kind;
      if (!this.siteLeveled[index] && SITE_LEVELED_PAYOUT[kind])
        standing.push(index);
    });
    return standing;
  }
  private fillContracts() {
    while (this.island.contracts.length < ACTIVE_CONTRACTS) {
      this.island.contracts.push(
        generateContract(
          {
            world: this.world,
            standingSites: this.standingSites().filter(
              (i) => !this.island.contracts.some((c) => c.site === i),
            ),
            goldRemaining:
              this.gold.length -
              this.island.gold.length -
              this.island.contracts
                .filter((c) => c.kind === "gold")
                .reduce((n, c) => n + c.goal - c.progress, 0),
            active: this.island.contracts.map((c) => c.kind),
          },
          this.world.seed,
          this.island.counter++,
        ),
      );
      this.walletDirty = true;
    }
  }
  /** Advances matching contracts and pays out any that complete. */
  private advance(
    kind: ContractKind,
    amount = 1,
    match: (c: Contract) => boolean = () => true,
  ) {
    let completed = false;
    for (const c of this.island.contracts) {
      if (c.kind !== kind || !match(c)) continue;
      c.progress =
        kind === "combo"
          ? Math.max(c.progress, amount)
          : Math.min(c.goal, c.progress + amount);
      this.walletDirty = true;
      if (c.progress < c.goal) continue;
      completed = true;
      this.award(c.reward, `CONTRACT · ${c.text.toUpperCase()}`);
    }
    if (!completed) return;
    this.island.contracts = this.island.contracts.filter(
      (c) => c.progress < c.goal,
    );
    this.fillContracts();
  }

  /** Collects any golden pineapple within reach of `p`. */
  collect(p: Vec3) {
    const r2 =
      (this.owns("perk-magnet") ? MAGNET_RADIUS : GOLD_PICKUP_RADIUS) ** 2;
    for (let i = 0; i < this.gold.length; i++) {
      const g = this.gold[i];
      const dx = g[0] - p[0],
        dy = g[1] - p[1],
        dz = g[2] - p[2];
      if (dx * dx + dy * dy + dz * dz > r2 || this.island.gold.includes(i))
        continue;
      this.island.gold.push(i);
      const found = this.island.gold.length;
      this.award(
        GOLD_PAYOUT,
        `GOLDEN PINEAPPLE ${found}/${this.gold.length}`,
        [...g],
      );
      if (found === this.gold.length)
        this.award(GOLD_ALL_BONUS, "EVERY GOLDEN PINEAPPLE FOUND", [...g]);
      this.announceGold();
      this.advance("gold");
    }
  }
  /** Sends golden pineapple positions and which are collected. */
  announceGold() {
    this.emit({
      type: "gold",
      points: this.gold.map((g) => [...g] as Vec3),
      collected: [...this.island.gold],
    });
  }

  view(): EconomyView {
    return {
      balance: this.wallet.balance,
      lifetime: this.wallet.lifetime,
      combo: this.chainTime > 0 ? this.chain : 0,
      comboTime: Math.max(0, this.chainTime),
      costs: {
        cannon: this.cost("cannon"),
        gravityBomb: this.cost("gravityBomb"),
        nuke: this.cost("nuke"),
        laser: this.cost("laser"),
      },
      contracts: this.island.contracts.map((c) => ({ ...c })),
      gold: { collected: this.island.gold.length, total: this.gold.length },
      gadget: (() => {
        const item = itemById(this.wallet.equipped.gadget);
        return item
          ? {
              id: item.id,
              name: item.name,
              use: this.price(item.use ?? 0),
              cooldown: Math.max(0, this.gadgetCooldown),
            }
          : undefined;
      })(),
    };
  }

  tier(id: UpgradeId) {
    return this.wallet.upgrades[id] ?? 0;
  }
  /** The upgrade's stat multiplier at the owned tier (1 when unowned). */
  bonus(id: UpgradeId) {
    return upgradeBonus(id, this.tier(id));
  }
  /** A base price after Dynamic Pricing™. */
  price(base: number) {
    return inflate(base, this.wallet.lifetime);
  }
  cost(weapon: WeaponId) {
    const discount = UPGRADES.find((u) => u.id === "discount")!.step;
    return this.price(
      AMMO_COST[weapon] * (1 - discount * this.tier("discount")),
    );
  }
  buyGems(id: GemBundleId) {
    const bundle = GEM_BUNDLES.find((b) => b.id === id);
    if (!bundle || !this.pay(this.price(bundle.price), `${bundle.gems} GEMS`))
      return false;
    this.wallet.gems += bundle.gems;
    this.flush();
    return true;
  }
  /** Opens a Pineapple Crate for gems; `random` returns values in [0, 1). */
  openCrate(random: () => number = Math.random): CrateResult | undefined {
    const w = this.wallet;
    if (w.gems < CRATE_GEMS) return undefined;
    w.gems -= CRATE_GEMS;
    w.crates++;
    w.pity++;
    let roll = random(),
      rarity: Rarity = "common";
    for (const r of ["legendary", "epic", "rare", "common"] as Rarity[]) {
      if (roll < CRATE_ODDS[r]) {
        rarity = r;
        break;
      }
      roll -= CRATE_ODDS[r];
    }
    if (w.pity >= PITY_CRATES && (rarity === "common" || rarity === "rare"))
      rarity = "epic";
    if (rarity === "epic" || rarity === "legendary") w.pity = 0;
    let result: CrateResult;
    if (rarity === "common") {
      const prize = COMMON_PRIZES[Math.floor(random() * COMMON_PRIZES.length)];
      if ("bucks" in prize) {
        w.balance += prize.bucks;
        w.lifetime += prize.bucks;
        result = { rarity, label: prize.label, bucks: prize.bucks };
      } else {
        w.dust += prize.dust;
        result = { rarity, label: prize.label, dust: prize.dust };
      }
    } else {
      const pool = CRATE_POOL[rarity];
      const id = pool[Math.floor(random() * pool.length)];
      const item = itemById(id)!;
      if (this.owns(id)) {
        const dust = Math.max(
          rarity === "legendary" ? 500 : 5,
          Math.round(item.price * DUPLICATE_DUST),
        );
        w.dust += dust;
        result = { rarity, label: item.name, itemId: id, duplicate: true, dust };
      } else {
        w.owned.push(id);
        w.equipped[item.slot] = id;
        result = { rarity, label: item.name, itemId: id };
      }
    }
    this.flush();
    this.emit({ type: "crate", result });
    return result;
  }
  /** The Dust Exchange: a whole gem for a mere thousand dust. */
  exchangeDust() {
    if (this.wallet.dust < DUST_PER_GEM) return false;
    this.wallet.dust -= DUST_PER_GEM;
    this.wallet.gems++;
    this.flush();
    return true;
  }
  /** Claims today's login reward; a missed day restarts the streak. */
  claimDaily(day: number) {
    const streak = this.wallet.streak;
    if (!Number.isInteger(day) || day <= streak.day) return false;
    streak.count =
      day === streak.day + 1 ? (streak.count % DAILY_REWARDS.length) + 1 : 1;
    streak.day = day;
    const reward = DAILY_REWARDS[streak.count - 1];
    if ("bucks" in reward) {
      this.wallet.balance += reward.bucks;
      this.wallet.lifetime += reward.bucks;
    } else this.wallet.gems += reward.gems;
    this.emit({
      type: "daily",
      count: streak.count,
      bucks: "bucks" in reward ? reward.bucks : 0,
      gems: "gems" in reward ? reward.gems : 0,
    });
    this.flush();
    return true;
  }
  /** The death-screen "flash sale": respawn shielded, at "50% off". */
  payRevive() {
    const ok = this.pay(this.price(REVIVE_BUNDLE.price), "REVIVE BUNDLE");
    if (ok) this.flush();
    return ok;
  }
  /** Buys the next tier of an upgrade; false if maxed or unaffordable. */
  buyUpgrade(id: UpgradeId) {
    const owned = this.tier(id);
    if (owned >= UPGRADE_TIERS) return false;
    const name = UPGRADES.find((u) => u.id === id)!.name;
    if (
      !this.pay(
        this.price(upgradePrice(owned)),
        `${name.toUpperCase()} ${owned + 1}`,
      )
    )
      return false;
    this.wallet.upgrades[id] = owned + 1;
    this.flush();
    return true;
  }
  owns(id: string) {
    return this.wallet.owned.includes(id);
  }
  /** Buys a cosmetic, gadget or perk once, equipping it straight away. */
  buyItem(id: string) {
    const item = itemById(id);
    if (!item || item.crateOnly || this.owns(id)) return false;
    if (!this.pay(this.price(item.price), item.name.toUpperCase())) return false;
    this.wallet.owned.push(id);
    if (item.slot !== "perk") this.wallet.equipped[item.slot] = id;
    this.flush();
    return true;
  }
  /** Equips an owned item, or restores the slot's default with no id. */
  equip(slot: ItemSlot, id?: string) {
    if (id === undefined) delete this.wallet.equipped[slot];
    else {
      const item = itemById(id);
      if (!item || item.slot !== slot || !this.owns(id)) return false;
      this.wallet.equipped[slot] = id;
    }
    this.flush();
    return true;
  }
  /** The equipped gadget, if it is ready and affordable; pays for one use. */
  useGadget(): ShopItem | undefined {
    const item = itemById(this.wallet.equipped.gadget);
    if (!item || this.gadgetCooldown > 0) return undefined;
    if (!this.pay(this.price(item.use ?? 0), item.name.toUpperCase()))
      return undefined;
    this.gadgetCooldown = item.cooldown ?? 0;
    return item;
  }
  /** Pays for a service; the simulation applies its effect on success. */
  payService(id: ServiceId) {
    const service = SERVICES.find((s) => s.id === id)!;
    if (!this.pay(this.price(service.price), service.name.toUpperCase()))
      return false;
    this.flush();
    return true;
  }
  private pay(price: number, label: string) {
    if (this.wallet.balance < price) return false;
    this.wallet.balance -= price;
    this.wallet.spent += price;
    this.walletDirty = true;
    this.emit({ type: "earn", amount: -price, label });
    return true;
  }
  canAfford(weapon: WeaponId) {
    return this.wallet.balance >= this.cost(weapon);
  }
  /** Deducts a shot's cost; returns false and charges nothing if short. */
  charge(weapon: WeaponId) {
    const cost = this.cost(weapon);
    if (this.wallet.balance < cost) return false;
    if (!cost) return true;
    this.wallet.balance -= cost;
    this.wallet.spent += cost;
    this.walletDirty = true;
    return true;
  }

  private credit(amount: number) {
    amount = Math.round(amount * this.bonus("bounty"));
    if (amount <= 0) return 0;
    this.wallet.balance += amount;
    this.wallet.lifetime += amount;
    this.walletDirty = true;
    return amount;
  }
  /** Credits and announces a named payout immediately. */
  award(amount: number, label: string, p?: Vec3) {
    const paid = this.credit(amount);
    if (paid) this.emit({ type: "earn", amount: paid, label, p });
    return paid;
  }

  entityRemoved(e: Entity, role?: StatueRole) {
    if (role === "eye") this.award(STATUE_PAYOUT.eye, "GOD'S EYE SHATTERED", [...e.p]);
    else if (role === "figure") this.pool(STATUE_PAYOUT.figure, e.p);
    else this.pool(MATERIAL_PAYOUT[e.material] ?? 1, e.p);
    if ((STONE_MATERIALS as readonly string[]).includes(e.material))
      this.advance("stone");
    const site = this.siteOf.get(e.id);
    if (site === undefined || this.siteLeveled[site]) return;
    this.siteRemoved[site]++;
    if (this.siteRemoved[site] / this.siteTotal[site] < SITE_LEVELED_FRACTION)
      return;
    this.siteLeveled[site] = true;
    const s = this.world.sites[site];
    const kind = s.kind === "hamlet" && s.town ? "town" : s.kind;
    const payout = SITE_LEVELED_PAYOUT[kind];
    if (payout) this.award(payout, `${siteName(kind)} LEVELED`, [...s.p]);
    this.advance("level", 1, (c) => c.site === site);
  }

  private pool(amount: number, p: Vec3) {
    if (!this.pooledAt) this.poolClock = 0;
    this.pooled += amount;
    this.pooledAt = [...p];
  }

  statueEnraged(p?: Vec3) {
    this.award(STATUE_PAYOUT.enraged, "PINEAPPLE GOD ANGERED", p);
  }

  /** Pays a bounty with the running combo multiplier. */
  defeated(
    kind: "monster" | "fly",
    p: Vec3,
    enraged = false,
    driving = false,
  ) {
    const base =
      kind === "fly"
        ? BOUNTY.fly
        : this.world.realm === "hell"
          ? BOUNTY.jet
          : BOUNTY.monster * (enraged ? BOUNTY.enraged : 1);
    this.chain = this.chainTime > 0 ? this.chain + 1 : 1;
    this.chainTime = COMBO_WINDOW;
    const multiplier = comboMultiplier(this.chain);
    const name =
      kind === "fly" ? "FLY" : this.world.realm === "hell" ? "JET" : "MONSTER";
    this.award(
      base * multiplier,
      multiplier > 1 ? `${name} · COMBO ×${multiplier}` : `${name} BOUNTY`,
      p,
    );
    if (kind === "monster") {
      this.advance("kills");
      if (driving) this.advance("truckKills");
    }
    this.advance("combo", this.chain);
  }

  step(dt: number) {
    this.gadgetCooldown -= dt;
    this.chainTime -= dt;
    if (this.chainTime <= 0) this.chain = 0;
    this.poolClock += dt;
    if (this.pooledAt && this.poolClock >= DESTRUCTION_REPORT_INTERVAL) {
      const paid = this.credit(this.pooled);
      if (paid)
        this.emit({
          type: "earn",
          amount: paid,
          label: "DESTRUCTION",
          p: this.pooledAt,
        });
      this.pooled = 0;
      this.pooledAt = undefined;
      this.poolClock = 0;
    }
    this.walletClock += dt;
    if (this.walletDirty && this.walletClock >= WALLET_REPORT_INTERVAL)
      this.flush();
  }

  /** Sends the wallet to the page for storage. */
  flush() {
    this.walletDirty = false;
    this.walletClock = 0;
    this.emit({ type: "wallet", wallet: { ...this.wallet } });
  }
}

function siteName(kind: string) {
  return (
    {
      castle: "GRAND CASTLE",
      "small-castle": "CASTLE",
      town: "TOWN",
      hamlet: "HAMLET",
    }[kind] ?? kind.toUpperCase()
  );
}
