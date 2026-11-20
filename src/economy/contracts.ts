import type { WorldData } from "../types";
import { seeded } from "./collectibles";
import { SITE_LEVELED_PAYOUT, comboMultiplier } from "./pricing";

export type ContractKind =
  | "level"
  | "kills"
  | "truckKills"
  | "stone"
  | "gold"
  | "combo";

export interface Contract {
  kind: ContractKind;
  text: string;
  goal: number;
  progress: number;
  reward: number;
  /** The site to level, for "level" contracts. */
  site?: number;
}

export const ACTIVE_CONTRACTS = 3;

export interface ContractContext {
  world: WorldData;
  /** Sites still standing that pay a leveling bonus. */
  standingSites: number[];
  goldRemaining: number;
  /** Kinds already active, to keep the board varied. */
  active: ContractKind[];
}

export function siteLabel(world: WorldData, index: number) {
  const s = world.sites[index];
  const kind = s.kind === "hamlet" && s.town ? "town" : s.kind;
  const name =
    {
      castle: "the grand castle",
      "small-castle": "the castle",
      town: "the town",
      hamlet: "the hamlet",
    }[kind] ?? `the ${kind.replaceAll("-", " ")}`;
  const number = s.id === "castle" ? "1" : s.id.split("-").at(-1);
  return `${name} ${number}`;
}

/** The `counter`-th contract on an island; the same inputs give the same contract. */
export function generateContract(
  context: ContractContext,
  seed: number,
  counter: number,
): Contract {
  const random = seeded(seed * 4099 + counter * 131 + 7);
  const int = (lo: number, hi: number) => lo + Math.floor(random() * (hi - lo + 1));
  const hell = context.world.realm === "hell";
  const kinds: ContractKind[] = ["kills", "stone", "combo"];
  if (!hell) kinds.push("truckKills");
  if (context.standingSites.length) kinds.push("level", "level");
  if (context.goldRemaining >= 2) kinds.push("gold");
  const fresh = kinds.filter((k) => !context.active.includes(k));
  const pool = fresh.length ? fresh : kinds;
  const kind = pool[Math.floor(random() * pool.length)];
  const enemy = hell ? "jets" : "monsters";
  switch (kind) {
    case "level": {
      const site =
        context.standingSites[Math.floor(random() * context.standingSites.length)];
      const s = context.world.sites[site];
      const payout =
        SITE_LEVELED_PAYOUT[s.kind === "hamlet" && s.town ? "town" : s.kind] ?? 150;
      return {
        kind,
        site,
        text: `Level ${siteLabel(context.world, site)}`,
        goal: 1,
        progress: 0,
        reward: Math.round((payout * 2 + 500) / 50) * 50,
      };
    }
    case "kills": {
      const goal = int(5, 12);
      return { kind, text: `Defeat ${goal} ${enemy}`, goal, progress: 0, reward: goal * 150 };
    }
    case "truckKills": {
      const goal = int(3, 6);
      return {
        kind,
        text: `Defeat ${goal} monsters while driving the truck`,
        goal,
        progress: 0,
        reward: goal * 400,
      };
    }
    case "stone": {
      const goal = int(4, 12) * 50;
      return { kind, text: `Destroy ${goal} stone pieces`, goal, progress: 0, reward: goal * 3 };
    }
    case "gold": {
      const goal = Math.min(context.goldRemaining, int(2, 5));
      return {
        kind,
        text: `Collect ${goal} golden pineapples`,
        goal,
        progress: 0,
        reward: goal * 400,
      };
    }
    case "combo": {
      // Chain lengths 4, 5 and 6 reach the ×3, ×4 and ×5 multipliers.
      const goal = int(4, 6);
      return {
        kind,
        text: `Reach a ×${comboMultiplier(goal)} kill combo`,
        goal,
        progress: 0,
        reward: [1500, 2500, 4000][goal - 4],
      };
    }
  }
}
