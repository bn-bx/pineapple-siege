import type { Material, WeaponId } from "../types";

/** Pineapple bucks (₱): every payout and price lives in this one table. */
export const STARTING_BALANCE = 2000;

/** Per-shot ammunition cost. The cannon is always free so you can earn. */
export const AMMO_COST: Record<WeaponId, number> = {
  cannon: 0,
  gravityBomb: 300,
  nuke: 500,
  laser: 1500,
};

/** Payout for each destroyed scenery or structure piece, by material. */
export const MATERIAL_PAYOUT: Record<Material, number> = {
  foliage: 1,
  wood: 2,
  earth: 2,
  plaster: 3,
  roof: 3,
  window: 3,
  stone: 5,
  slate: 5,
  sandstone: 5,
  rock: 5,
  porcelain: 50,
};

/** Bonus once most of a site's structure is gone, by site kind. */
export const SITE_LEVELED_PAYOUT: Record<string, number> = {
  castle: 1500,
  "small-castle": 500,
  hamlet: 200,
  town: 400,
  farm: 150,
  windmill: 150,
  watermill: 150,
  watchtower: 150,
  logging: 150,
  quarry: 150,
  harbor: 150,
  bridge: 100,
  crossing: 100,
};
/** Share of a site's blocks that must be destroyed to count as leveled. */
export const SITE_LEVELED_FRACTION = 0.8;

export const STATUE_PAYOUT = { figure: 20, eye: 250, enraged: 1000 };

export const BOUNTY = {
  monster: 100,
  /** Multiplier while the Pineapple God's rage gives monsters wheels. */
  enraged: 2,
  fly: 40,
  jet: 150,
};

/** Kills within this many seconds of the last one extend the combo. */
export const COMBO_WINDOW = 5;
const COMBO_STEPS = [1, 1.5, 2, 3, 4, 5];
export const comboMultiplier = (chain: number) =>
  COMBO_STEPS[Math.max(0, Math.min(COMBO_STEPS.length - 1, chain - 1))];

/** Destruction pay is pooled and reported at most this often (seconds). */
export const DESTRUCTION_REPORT_INTERVAL = 0.6;

export const formatBucks = (n: number) =>
  `₱${Math.round(n).toLocaleString("en-US")}`;

/** Tiered upgrades: each tier costs `UPGRADE_GROWTH`× the last. */
export const UPGRADE_TIERS = 5;
export const UPGRADE_BASE_PRICE = 1000;
export const UPGRADE_GROWTH = 2.2;
export const UPGRADES = [
  { id: "engine", name: "Engine", effect: "+6% top speed per tier", step: 0.06 },
  { id: "afterburner", name: "Afterburner", effect: "+8% boost speed per tier", step: 0.08 },
  { id: "armor", name: "Hull Armor", effect: "−10% damage taken per tier", step: 0.1 },
  { id: "cannonRate", name: "Cannon Loader", effect: "−12% cannon cooldown per tier", step: 0.12 },
  { id: "cannonBlast", name: "Cannon Charge", effect: "+15% cannon blast radius per tier", step: 0.15 },
  { id: "nukeYield", name: "Nuke Yield", effect: "+10% nuke blast and crater per tier", step: 0.1 },
  { id: "laserSize", name: "Laser Lens", effect: "+10% laser diameter per tier", step: 0.1 },
  { id: "discount", name: "Bulk Discount", effect: "−8% ammo cost per tier", step: 0.08 },
  { id: "bounty", name: "Bounty Hunter", effect: "+10% earnings per tier", step: 0.1 },
] as const;
export type UpgradeId = (typeof UPGRADES)[number]["id"];
export const isUpgradeId = (id: unknown): id is UpgradeId =>
  UPGRADES.some((u) => u.id === id);
/** Price of buying the tier after `owned` (owned 0 → tier 1). */
export const upgradePrice = (owned: number) =>
  Math.round((UPGRADE_BASE_PRICE * UPGRADE_GROWTH ** owned) / 10) * 10;
/** Multiplier applied by `tier` levels of an upgrade: 1 + step × tier. */
export const upgradeBonus = (id: UpgradeId, tier: number) =>
  1 + UPGRADES.find((u) => u.id === id)!.step * tier;

/** One-off island services. */
export const SERVICES = [
  { id: "repair", name: "Full Repair", effect: "Restore the vehicle to full health", price: 400 },
  { id: "shield", name: "Shield", effect: "20 seconds of protection", price: 800 },
  { id: "travel", name: "Fast Travel", effect: "Fly to the map waypoint", price: 600 },
  { id: "wave", name: "Monster Wave", effect: "Bring back up to 10 defeated monsters", price: 1000 },
] as const;
export type ServiceId = (typeof SERVICES)[number]["id"];
export const SHIELD_SERVICE_SECONDS = 20;
export const WAVE_SIZE = 10;

export const GOLD_PAYOUT = 250;
export const GOLD_ALL_BONUS = 10_000;
/** Materials that count toward "destroy stone" contracts. */
export const STONE_MATERIALS = ["stone", "sandstone", "slate", "rock"] as const;

/** Cosmetic and gadget slots; one item per slot is equipped. */
export type ItemSlot =
  | "jetPaint"
  | "truckPaint"
  | "trail"
  | "blast"
  | "cloud"
  | "hud"
  | "gadget"
  | "perk";
export interface ShopItem {
  id: string;
  slot: ItemSlot;
  name: string;
  price: number;
  effect: string;
  /** Only obtainable from Pineapple Crates. */
  crateOnly?: boolean;
  /** Gadgets only: cost per use and seconds between uses. */
  use?: number;
  cooldown?: number;
}
export const SLOT_NAMES: Record<ItemSlot, string> = {
  jetPaint: "Jet paint",
  truckPaint: "Truck paint",
  trail: "Engine flame",
  blast: "Explosions",
  cloud: "Nuke cloud",
  hud: "HUD theme",
  gadget: "Gadget (G)",
  perk: "Perks",
};
export const ITEMS: readonly ShopItem[] = [
  { id: "jet-gold", slot: "jetPaint", name: "Royal Gold", price: 3000, effect: "Gold-plated airframe" },
  { id: "jet-midnight", slot: "jetPaint", name: "Midnight", price: 3000, effect: "Deep navy airframe" },
  { id: "jet-pink", slot: "jetPaint", name: "Hot Pink", price: 5000, effect: "Unmissable pink" },
  { id: "jet-chrome", slot: "jetPaint", name: "Mirror Chrome", price: 8000, effect: "Polished chrome" },
  { id: "truck-red", slot: "truckPaint", name: "Fire Red", price: 3000, effect: "Fire-engine red mixer" },
  { id: "truck-army", slot: "truckPaint", name: "Army Green", price: 3000, effect: "Olive drab mixer" },
  { id: "truck-pearl", slot: "truckPaint", name: "Pearl", price: 5000, effect: "Pearl-white mixer" },
  { id: "trail-plasma", slot: "trail", name: "Plasma Blue", price: 2500, effect: "Blue engine flame" },
  { id: "trail-toxic", slot: "trail", name: "Toxic Green", price: 2500, effect: "Green engine flame" },
  { id: "trail-royal", slot: "trail", name: "Royal Purple", price: 4000, effect: "Purple engine flame" },
  { id: "blast-ice", slot: "blast", name: "Ice Blasts", price: 6000, effect: "Icy blue explosions" },
  { id: "blast-toxic", slot: "blast", name: "Toxic Blasts", price: 6000, effect: "Radioactive green explosions" },
  { id: "blast-inferno", slot: "blast", name: "Inferno Blasts", price: 6000, effect: "Deep red explosions" },
  { id: "cloud-watermelon", slot: "cloud", name: "Watermelon Cloud", price: 10000, effect: "Pink and green mushroom cloud" },
  { id: "cloud-blueberry", slot: "cloud", name: "Blueberry Cloud", price: 10000, effect: "Blue mushroom cloud" },
  { id: "cloud-golden", slot: "cloud", name: "Golden Cloud", price: 15000, effect: "Gleaming gold mushroom cloud" },
  { id: "hud-ruby", slot: "hud", name: "Ruby HUD", price: 2000, effect: "Red-tinted HUD" },
  { id: "hud-mint", slot: "hud", name: "Mint HUD", price: 2000, effect: "Green-tinted HUD" },
  { id: "hud-ice", slot: "hud", name: "Ice HUD", price: 2000, effect: "Blue-tinted HUD" },
  { id: "gadget-decoy", slot: "gadget", name: "Decoy Pineapple", price: 10000, use: 300, cooldown: 15, effect: "Drops a decoy monsters chase for 12 s" },
  { id: "gadget-cluster", slot: "gadget", name: "Cluster Pineapple", price: 15000, use: 400, cooldown: 3, effect: "Fires a spread of 7 cannon shells" },
  { id: "gadget-airstrike", slot: "gadget", name: "Airstrike", price: 40000, use: 800, cooldown: 12, effect: "A carpet of 12 blasts along your heading" },
  { id: "perk-magnet", slot: "perk", name: "Golden Magnet", price: 25000, effect: "Collect golden pineapples from 150 m" },
  { id: "jet-diamond", slot: "jetPaint", name: "Diamond Pineapple", price: 0, crateOnly: true, effect: "LEGENDARY · Crate exclusive" },
  { id: "cloud-rainbow", slot: "cloud", name: "Rainbow Cloud", price: 0, crateOnly: true, effect: "LEGENDARY · Crate exclusive" },
];
export const itemById = (id: unknown) => ITEMS.find((i) => i.id === id);
/** Slots where only one item can be equipped (perks are always on). */
export const EQUIP_SLOTS: ItemSlot[] = [
  "jetPaint",
  "truckPaint",
  "trail",
  "blast",
  "cloud",
  "hud",
  "gadget",
];
export const DECOY_SECONDS = 12;
export const MAGNET_RADIUS = 150;
export const CLUSTER_SHELLS = 7;
export const AIRSTRIKE_BLASTS = 12;

// ---------------------------------------------------------------------------
// Live-service monetization. All of it is a joke: there is no real money.
// ---------------------------------------------------------------------------

/**
 * Dynamic pricing™: prices rise 1% per ₱20,000 you have ever earned, up to
 * +60%. Your success is our success.
 */
export const inflation = (lifetime: number) =>
  1 + Math.min(0.6, Math.floor(lifetime / 20_000) / 100);
export const inflate = (price: number, lifetime: number) =>
  Math.round((price * inflation(lifetime)) / 10) * 10;

/** Golden Gems, bought only with bucks. The "best value" bundle isn't. */
export const GEM_BUNDLES = [
  { id: "gems-s", gems: 7, price: 1000, tag: "" },
  { id: "gems-m", gems: 40, price: 5500, tag: "MOST POPULAR" },
  { id: "gems-l", gems: 85, price: 12000, tag: "BEST VALUE · +6% BONUS!" },
] as const;
export type GemBundleId = (typeof GEM_BUNDLES)[number]["id"];
/** Never a multiple of any bundle, so there are always leftover gems. */
export const CRATE_GEMS = 15;

export type Rarity = "common" | "rare" | "epic" | "legendary";
/** Drop odds, disclosed in the smallest type the law allows. */
export const CRATE_ODDS: Record<Rarity, number> = {
  common: 0.795,
  rare: 0.15,
  epic: 0.05,
  legendary: 0.005,
};
/** Rarity of every crate prize; commons are bucks and dust. */
export const CRATE_POOL: Record<Exclude<Rarity, "common">, string[]> = {
  rare: [
    "jet-gold",
    "jet-midnight",
    "truck-red",
    "truck-army",
    "trail-plasma",
    "trail-toxic",
    "hud-ruby",
    "hud-mint",
    "hud-ice",
  ],
  epic: [
    "jet-pink",
    "jet-chrome",
    "truck-pearl",
    "trail-royal",
    "blast-ice",
    "blast-toxic",
    "blast-inferno",
    "cloud-watermelon",
    "cloud-blueberry",
  ],
  legendary: ["jet-diamond", "cloud-rainbow"],
};
/** Common prizes: a pouch of bucks smaller than the crate cost. */
export const COMMON_PRIZES = [
  { label: "Pouch of bucks", bucks: 150 },
  { label: "Handful of bucks", bucks: 300 },
  { label: "Pineapple Dust", dust: 40 },
] as const;
/** An epic or better is guaranteed after this many crates without one. */
export const PITY_CRATES = 50;
/** Duplicates turn into dust at this share of the item's shop price. */
export const DUPLICATE_DUST = 0.02;
/** The Dust Exchange: this much dust buys a single gem. */
export const DUST_PER_GEM = 1000;

/** Daily login rewards; missing a day resets the streak to day 1. */
export const DAILY_REWARDS = [
  { bucks: 200 },
  { bucks: 300 },
  { gems: 5 },
  { bucks: 500 },
  { bucks: 800 },
  { gems: 10 },
  { gems: CRATE_GEMS, label: "A FREE CRATE'S WORTH OF GEMS" },
] as const;

/** Offered on the death screen: respawn with a shield, "50% off". */
export const REVIVE_BUNDLE = { price: 1200, was: 2400, shield: 30, seconds: 59 };
/** A fake "original" price for anchoring. */
export const wasPrice = (price: number) =>
  price ? Math.ceil((price * 1.7) / 100) * 100 - 1 : 0;
