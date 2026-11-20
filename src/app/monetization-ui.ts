/**
 * The live-service storefront: gems, Pineapple Crates, the daily streak and
 * the death-screen flash sale. Satire throughout; nothing costs real money.
 */
import type { CrateResult } from "../economy/earnings";
import {
  CRATE_GEMS,
  CRATE_ODDS,
  DAILY_REWARDS,
  DUST_PER_GEM,
  GEM_BUNDLES,
  PITY_CRATES,
  REVIVE_BUNDLE,
  formatBucks,
  inflate,
  wasPrice,
  type Rarity,
} from "../economy/pricing";
import type { Wallet } from "../economy/wallet";
import type { GameCommand } from "../types";

export interface PremiumHost {
  send: (command: GameCommand) => void;
  respawn: () => void;
}
let host: PremiumHost | undefined;
let wallet: Wallet | undefined;
const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T | null;

const RARITY_NAMES: Record<Rarity, string> = {
  common: "Common",
  rare: "Rare",
  epic: "Epic",
  legendary: "LEGENDARY",
};

/** Local calendar day number, for the login streak. */
export function today(now = new Date()) {
  return Math.floor(
    (now.getTime() - now.getTimezoneOffset() * 60_000) / 86_400_000,
  );
}

export function bindPremium(premiumHost: PremiumHost) {
  host = premiumHost;
  const bundles = $("shopGemBundles");
  if (bundles && !bundles.childElementCount)
    for (const b of GEM_BUNDLES) {
      const item = document.createElement("li");
      item.className = "shop-buy gem-bundle";
      const text = document.createElement("div");
      const title = document.createElement("span");
      title.textContent = `💎 ${b.gems} Golden Gems`;
      text.append(title);
      if (b.tag) {
        const tag = document.createElement("mark");
        tag.textContent = b.tag;
        text.append(tag);
      }
      const button = document.createElement("button");
      button.type = "button";
      button.id = `bundle-${b.id}`;
      button.onclick = () => host?.send({ type: "buyGems", id: b.id });
      item.append(text, button);
      bundles.append(item);
    }
  const crate = $<HTMLButtonElement>("openCrate");
  if (crate) crate.onclick = () => host?.send({ type: "openCrate" });
  const dust = $<HTMLButtonElement>("exchangeDust");
  if (dust) dust.onclick = () => host?.send({ type: "exchangeDust" });
  const odds = $("crateOdds");
  if (odds)
    odds.textContent =
      "Drop rates: " +
      (Object.keys(CRATE_ODDS) as Rarity[])
        .map((r) => `${RARITY_NAMES[r]} ${(CRATE_ODDS[r] * 100).toFixed(1)}%`)
        .join(" · ") +
      `. Duplicates convert to Pineapple Dust. Epic or better guaranteed within ${PITY_CRATES} crates. Crates have no cash value. Gems are non-refundable. Fun is not guaranteed.`;
  const buy = $<HTMLButtonElement>("flashBuy");
  if (buy)
    buy.onclick = () => {
      host?.send({ type: "revive" });
      host?.respawn();
      flash.declined = true;
    };
  const decline = $<HTMLButtonElement>("flashDecline");
  if (decline)
    decline.onclick = () => {
      flash.declined = true;
      $("flashSale")!.hidden = true;
    };
}

export function renderPremium(w: Wallet) {
  wallet = w;
  const set = (id: string, text: string) => {
    const el = $(id);
    if (el) el.textContent = text;
  };
  set("shopGems", `💎 ${w.gems}`);
  set("shopDust", `${w.dust.toLocaleString("en-US")} dust`);
  for (const b of GEM_BUNDLES) {
    const button = $<HTMLButtonElement>(`bundle-${b.id}`);
    if (!button) continue;
    const price = inflate(b.price, w.lifetime);
    const was = document.createElement("s");
    was.textContent = formatBucks(wasPrice(price));
    button.replaceChildren(was, ` ${formatBucks(price)}`);
    button.disabled = w.balance < price;
  }
  const crate = $<HTMLButtonElement>("openCrate");
  if (crate) {
    crate.disabled = w.gems < CRATE_GEMS;
    crate.textContent =
      w.gems < CRATE_GEMS
        ? `Open crate · 💎 ${CRATE_GEMS} (need ${CRATE_GEMS - w.gems} more!)`
        : `Open Pineapple Crate · 💎 ${CRATE_GEMS}`;
  }
  set(
    "cratePity",
    `Epic or better GUARANTEED in ${PITY_CRATES - w.pity} crates! You're so close!`,
  );
  const dust = $<HTMLButtonElement>("exchangeDust");
  if (dust) {
    dust.disabled = w.dust < DUST_PER_GEM;
    dust.textContent = `Dust Exchange: ${DUST_PER_GEM.toLocaleString("en-US")} dust → 💎 1`;
  }
  set(
    "shopStreak",
    w.streak.count
      ? `🔥 Day ${w.streak.count} login streak. Don't break it!`
      : "",
  );
}

/** The crate reel: it always slows down right next to a legendary. */
export function showCrate(result: CrateResult) {
  const dialog = modal();
  const tiles = 48,
    landing = 40,
    reel = document.createElement("div");
  reel.className = "crate-reel";
  const strip = document.createElement("div");
  strip.className = "crate-strip";
  const pick = (i: number): Rarity => {
    if (i === landing) return result.rarity;
    // The near miss: the tile just past the pointer is always legendary.
    if (i === landing + 1 && result.rarity !== "legendary") return "legendary";
    const r = (i * 7919) % 100;
    return r < 3 ? "legendary" : r < 15 ? "epic" : r < 40 ? "rare" : "common";
  };
  for (let i = 0; i < tiles; i++) {
    const tile = document.createElement("i");
    tile.className = `tile ${pick(i)}`;
    tile.textContent = pick(i) === "legendary" ? "💎" : "🍍";
    strip.append(tile);
  }
  const pointer = document.createElement("b");
  pointer.className = "crate-pointer";
  reel.append(strip, pointer);
  const title = document.createElement("h2");
  title.textContent = "Opening Pineapple Crate…";
  const prize = document.createElement("p");
  prize.className = "crate-prize";
  const close = document.createElement("button");
  close.type = "button";
  close.textContent = "Collect";
  close.disabled = true;
  close.onclick = () => dialog.close();
  const again = document.createElement("button");
  again.type = "button";
  again.className = "secondary";
  again.textContent = `Open another · 💎 ${CRATE_GEMS}`;
  again.disabled = true;
  again.onclick = () => {
    dialog.close();
    host?.send({ type: "openCrate" });
  };
  dialog.replaceChildren(title, reel, prize, close, again);
  dialog.showModal();
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  requestAnimationFrame(() => {
    const tile = strip.children[landing] as HTMLElement;
    // Stop at the tile's far edge, a hair away from the legendary.
    const target =
      tile.offsetLeft + tile.offsetWidth * 0.93 - reel.clientWidth / 2;
    strip.style.transition = reduced
      ? "none"
      : "transform 5.2s cubic-bezier(0.05, 0.7, 0.1, 1)";
    strip.style.transform = `translateX(${-target}px)`;
  });
  setTimeout(
    () => {
      title.textContent =
        result.rarity === "legendary"
          ? "✨ LEGENDARY! ✨"
          : result.rarity === "common"
            ? "So close!"
            : `${RARITY_NAMES[result.rarity]}!`;
      prize.textContent = result.duplicate
        ? `${result.label} (duplicate) → ${result.dust} Pineapple Dust`
        : result.bucks
          ? `${result.label}: ${formatBucks(result.bucks)}`
          : result.dust
            ? `${result.label} ×${result.dust}`
            : `${result.label} unlocked and equipped!`;
      prize.dataset.rarity = result.rarity;
      close.disabled = false;
      again.disabled = (wallet?.gems ?? 0) < CRATE_GEMS;
      if (again.disabled) again.textContent = "Out of gems? Get more in the Shop!";
    },
    reduced ? 200 : 5400,
  );
}

export function showDaily(count: number, bucks: number, gems: number) {
  const dialog = modal();
  const title = document.createElement("h2");
  title.textContent = `🔥 Day ${count} login streak!`;
  const reward = document.createElement("p");
  reward.className = "crate-prize";
  reward.textContent = bucks ? `+${formatBucks(bucks)}` : `+💎 ${gems}`;
  const days = document.createElement("ol");
  days.className = "daily-days";
  DAILY_REWARDS.forEach((r, i) => {
    const day = document.createElement("li");
    day.className = i + 1 < count ? "done" : i + 1 === count ? "today" : "";
    day.textContent =
      `Day ${i + 1}\n` +
      ("bucks" in r ? formatBucks(r.bucks) : `💎 ${r.gems}`);
    days.append(day);
  });
  const warning = document.createElement("p");
  warning.className = "help-note";
  warning.textContent =
    "Come back tomorrow! Miss a single day and your streak resets to Day 1. Forever.";
  const ok = document.createElement("button");
  ok.type = "button";
  ok.textContent = "I'll be back. I promise.";
  ok.onclick = () => dialog.close();
  dialog.replaceChildren(title, reward, days, warning, ok);
  dialog.showModal();
}

/** The death-screen flash sale and its endlessly renewing countdown. */
const flash = { shownAt: 0, declined: false, visible: false };
export function updateFlashSale(dead: boolean, balance: number, lifetime: number) {
  const sale = $("flashSale");
  if (!sale || !host) return;
  if (!dead) {
    flash.visible = flash.declined = false;
    sale.hidden = true;
    return;
  }
  if (!flash.visible) {
    flash.visible = true;
    flash.shownAt = performance.now();
  }
  sale.hidden = flash.declined;
  const left =
    REVIVE_BUNDLE.seconds -
    (Math.floor((performance.now() - flash.shownAt) / 1000) %
      (REVIVE_BUNDLE.seconds + 1));
  const price = inflate(REVIVE_BUNDLE.price, lifetime);
  const set = (id: string, text: string) => {
    const el = $(id);
    if (el && el.textContent !== text) el.textContent = text;
  };
  set("flashWas", formatBucks(inflate(REVIVE_BUNDLE.was, lifetime)));
  set("flashPrice", formatBucks(price));
  set("flashTimer", `0:${String(left).padStart(2, "0")}`);
  const buy = $<HTMLButtonElement>("flashBuy");
  if (buy) buy.disabled = balance < price;
}

function modal() {
  let dialog = $<HTMLDialogElement>("premiumModal");
  if (!dialog) {
    dialog = document.createElement("dialog");
    dialog.id = "premiumModal";
    dialog.className = "premium-modal";
    document.body.append(dialog);
  }
  if (dialog.open) dialog.close();
  return dialog;
}
