import {
  EQUIP_SLOTS,
  itemById,
  type ItemSlot,
  STARTING_BALANCE,
  UPGRADES,
  UPGRADE_TIERS,
  type UpgradeId,
} from "./pricing";
import type { Contract, ContractKind } from "./contracts";

/** Golden pineapples and contracts for one island. */
export interface IslandProgress {
  /** Indices of collected golden pineapples. */
  gold: number[];
  contracts: Contract[];
  /** How many contracts this island has generated. */
  counter: number;
}
const ISLAND_LIMIT = 40;
const CONTRACT_KINDS: ContractKind[] = [
  "level",
  "kills",
  "truckKills",
  "stone",
  "gold",
  "combo",
];
export const islandKey = (world: { seed: number; realm?: string }) =>
  `${world.realm ?? "surface"}:${world.seed}`;

/** The global pineapple-bucks wallet, shared by every island and realm. */
export interface Wallet {
  version: 1;
  balance: number;
  /** Total ever earned, never reduced by spending. */
  lifetime: number;
  /** Total spent on ammunition and purchases. */
  spent: number;
  /** Owned tier (0..UPGRADE_TIERS) of each upgrade. */
  upgrades: Partial<Record<UpgradeId, number>>;
  /** Bought cosmetics, gadgets and perks, by item id. */
  owned: string[];
  /** The equipped item id in each slot; absent means the default look. */
  equipped: Partial<Record<ItemSlot, string>>;
  /** Golden Gems, the premium currency. */
  gems: number;
  /** Pineapple Dust from crate duplicates. */
  dust: number;
  /** Crates opened since the last epic or legendary. */
  pity: number;
  /** Total crates opened. */
  crates: number;
  /** Daily login streak: last claimed day number and streak length. */
  streak: { day: number; count: number };
  /** Per-island progress, keyed by `islandKey`. */
  islands: Record<string, IslandProgress>;
}

export const WALLET_KEY = "siege-wallet-v1";

const amount = (v: unknown, fallback: number) =>
  typeof v === "number" && Number.isFinite(v) && v >= 0
    ? Math.floor(v)
    : fallback;

export function normalizeWallet(value: unknown): Wallet {
  const v = (value && typeof value === "object" ? value : {}) as Partial<Wallet>;
  const wallet: Wallet = {
    version: 1,
    balance: amount(v.balance, STARTING_BALANCE),
    lifetime: amount(v.lifetime, 0),
    spent: amount(v.spent, 0),
    upgrades: Object.fromEntries(
      UPGRADES.map((u) => [
        u.id,
        Math.min(UPGRADE_TIERS, amount(v.upgrades?.[u.id], 0)),
      ]).filter(([, tier]) => tier),
    ),
    owned: Array.isArray(v.owned)
      ? [...new Set(v.owned.filter((id) => !!itemById(id)))]
      : [],
    equipped: {},
    gems: amount(v.gems, 0),
    dust: amount(v.dust, 0),
    pity: amount(v.pity, 0),
    crates: amount(v.crates, 0),
    streak: {
      day: amount(v.streak?.day, 0),
      count: amount(v.streak?.count, 0),
    },
    islands: normalizeIslands(v.islands),
  };
  for (const slot of EQUIP_SLOTS) {
    const id = (v.equipped as Record<string, unknown> | undefined)?.[slot];
    const item = itemById(id);
    if (item && item.slot === slot && wallet.owned.includes(item.id))
      wallet.equipped[slot] = item.id;
  }
  return wallet;
}

function normalizeIslands(value: unknown): Record<string, IslandProgress> {
  if (!value || typeof value !== "object") return {};
  const out: Record<string, IslandProgress> = {};
  for (const [key, raw] of Object.entries(value).slice(-ISLAND_LIMIT)) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Partial<IslandProgress>;
    out[key] = {
      gold: Array.isArray(r.gold)
        ? [...new Set(r.gold.filter((i) => Number.isInteger(i) && i >= 0))]
        : [],
      contracts: Array.isArray(r.contracts)
        ? r.contracts
            .filter(
              (c): c is Contract =>
                !!c &&
                CONTRACT_KINDS.includes(c.kind) &&
                typeof c.text === "string" &&
                amount(c.goal, 0) > 0 &&
                amount(c.reward, -1) >= 0,
            )
            .map((c) => ({
              kind: c.kind,
              text: c.text,
              goal: amount(c.goal, 1),
              progress: Math.min(amount(c.goal, 1), amount(c.progress, 0)),
              reward: amount(c.reward, 0),
              ...(Number.isInteger(c.site) ? { site: c.site } : {}),
            }))
            .slice(0, 3)
        : [],
      counter: amount(r.counter, 0),
    };
  }
  return out;
}

export function loadWallet(): Wallet {
  try {
    const raw = localStorage.getItem(WALLET_KEY);
    return normalizeWallet(raw ? JSON.parse(raw) : undefined);
  } catch {
    return normalizeWallet(undefined);
  }
}

export function storeWallet(wallet: Wallet): void {
  try {
    localStorage.setItem(WALLET_KEY, JSON.stringify(wallet));
  } catch {
    // Storage can be blocked or full; the wallet still works this session.
  }
}
