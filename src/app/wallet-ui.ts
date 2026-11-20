import {
  inflate,
  inflation,
  wasPrice,
  ITEMS,
  SLOT_NAMES,
  type ItemSlot,
  SERVICES,
  UPGRADES,
  UPGRADE_TIERS,
  upgradePrice,
  type ServiceId,
  type UpgradeId,
  AMMO_COST,
  BOUNTY,
  COMBO_WINDOW,
  MATERIAL_PAYOUT,
  SITE_LEVELED_PAYOUT,
  STATUE_PAYOUT,
  formatBucks,
} from "../economy/pricing";
import type { Wallet } from "../economy/wallet";
import { renderPremium } from "./monetization-ui";
import type { GameCommand, Vec3, WeaponId } from "../types";

const FEED_LIMIT = 5;
const FEED_SECONDS = 2.4;

/** Floats a "+₱500 CASTLE LEVELED" line above the HUD. */
export function showEarning(amount: number, label: string) {
  const feed = document.getElementById("earnFeed");
  if (!feed) return;
  const line = document.createElement("div");
  line.className =
    "earn-line" +
    (amount < 0 ? " spent" : "") +
    (Math.abs(amount) >= 500 ? " big" : "");
  const value = document.createElement("strong");
  value.textContent =
    amount < 0 ? `−${formatBucks(-amount)}` : `+${formatBucks(amount)}`;
  const text = document.createElement("span");
  text.textContent = label;
  line.append(value, text);
  feed.prepend(line);
  while (feed.children.length > FEED_LIMIT) feed.lastElementChild!.remove();
  setTimeout(() => line.remove(), FEED_SECONDS * 1000);
}

const WEAPON_NAMES: Record<WeaponId, string> = {
  cannon: "Pineapple Cannon",
  gravityBomb: "Gravity Bomb",
  nuke: "Pineapple Nuke",
  laser: "Space Laser",
};

export interface ShopHost {
  send: (command: GameCommand) => void;
  /** The Map tab's chosen landmark, for fast travel. */
  waypoint: () => { name: string; p: Vec3 } | undefined;
}
let host: ShopHost | undefined;

/** Fills the Shop tab's price lists and wires its buy buttons once. */
export function bindShop(shopHost: ShopHost) {
  host = shopHost;
  const upgrades = document.getElementById("shopUpgrades");
  if (upgrades && !upgrades.childElementCount)
    for (const u of UPGRADES)
      upgrades.append(
        buyRow(`upgrade-${u.id}`, u.name, u.effect, () =>
          host?.send({ type: "buyUpgrade", id: u.id }),
        ),
      );
  const services = document.getElementById("shopServices");
  if (services && !services.childElementCount)
    for (const sv of SERVICES)
      services.append(
        buyRow(`service-${sv.id}`, sv.name, sv.effect, () => buyService(sv.id)),
      );
  const items = document.getElementById("shopItems");
  if (items && !items.childElementCount)
    for (const slot of Object.keys(SLOT_NAMES) as ItemSlot[]) {
      const heading = document.createElement("h4");
      heading.textContent = SLOT_NAMES[slot];
      const list = document.createElement("ul");
      list.className = "shop-list";
      for (const item of ITEMS.filter((i) => i.slot === slot))
        list.append(
          buyRow(
            `item-${item.id}`,
            item.name,
            item.use
              ? `${item.effect} · ${formatBucks(item.use)} per use, ${item.cooldown} s cooldown`
              : item.effect,
            () => itemAction(item.id),
          ),
        );
      items.append(heading, list);
    }
  const ammo = document.getElementById("shopAmmo");
  if (ammo && !ammo.childElementCount)
    for (const weapon of ["cannon", "gravityBomb", "nuke", "laser"] as const)
      ammo.append(row(WEAPON_NAMES[weapon], ammoLabel(AMMO_COST[weapon]), `ammo-${weapon}`));
  const earn = document.getElementById("shopEarn");
  if (earn && !earn.childElementCount) {
    const m = MATERIAL_PAYOUT;
    earn.append(
      row("Pineapple monster", formatBucks(BOUNTY.monster)),
      row("Wheeled (enraged) monster", formatBucks(BOUNTY.monster * BOUNTY.enraged)),
      row("Fly", formatBucks(BOUNTY.fly)),
      row("Jet (abyss)", formatBucks(BOUNTY.jet)),
      row(`Kill combo (within ${COMBO_WINDOW} s)`, "up to ×5"),
      row("Grand castle leveled", formatBucks(SITE_LEVELED_PAYOUT.castle)),
      row("Castle leveled", formatBucks(SITE_LEVELED_PAYOUT["small-castle"])),
      row("Town / hamlet leveled", `${formatBucks(SITE_LEVELED_PAYOUT.town)} / ${formatBucks(SITE_LEVELED_PAYOUT.hamlet)}`),
      row("Farm, mill, tower, harbor leveled", formatBucks(SITE_LEVELED_PAYOUT.farm)),
      row("Pineapple God angered", formatBucks(STATUE_PAYOUT.enraged)),
      row("God's eye / figure piece", `${formatBucks(STATUE_PAYOUT.eye)} / ${formatBucks(STATUE_PAYOUT.figure)}`),
      row("Stone · plaster · wood · foliage", `${m.stone} · ${m.plaster} · ${m.wood} · ${m.foliage}`),
      row("Toilet", formatBucks(m.porcelain)),
    );
  }
}

let currentWallet: Wallet | undefined;
function itemAction(id: string) {
  const item = ITEMS.find((i) => i.id === id)!;
  const wallet = currentWallet;
  if (!wallet?.owned.includes(id)) host?.send({ type: "buyItem", id });
  else if (item.slot === "perk") return;
  else if (wallet.equipped[item.slot] === id)
    host?.send({ type: "equip", slot: item.slot });
  else host?.send({ type: "equip", slot: item.slot, id });
}

function buyService(id: ServiceId) {
  const status = document.getElementById("shopStatus");
  if (id === "travel") {
    const target = host?.waypoint();
    if (!target) {
      if (status)
        status.textContent = "Choose a landmark on the Map tab to fast travel.";
      return;
    }
    if (status) status.textContent = `Travelling to ${target.name}.`;
    host?.send({ type: "service", id, to: [target.p[0], target.p[2]] });
    return;
  }
  host?.send({ type: "service", id });
}

/** Called for every spend; confirms the purchase in the Shop. */
export function noteSpend(label: string, amount: number) {
  const status = document.getElementById("shopStatus");
  if (status) status.textContent = `Bought ${label.toLowerCase()} for ${formatBucks(amount)}.`;
}

function buyRow(id: string, name: string, effect: string, buy: () => void) {
  const item = document.createElement("li");
  item.className = "shop-buy";
  const text = document.createElement("div");
  const title = document.createElement("span");
  title.textContent = name;
  const tier = document.createElement("em");
  tier.id = `${id}-tier`;
  const detail = document.createElement("small");
  detail.textContent = effect;
  title.append(tier);
  text.append(title, detail);
  const button = document.createElement("button");
  button.type = "button";
  button.id = id;
  button.onclick = buy;
  item.append(text, button);
  return item;
}

/** "Buy ₱X" with a crossed-out, entirely fictional original price. */
function priceButton(button: HTMLButtonElement, price: number) {
  const was = document.createElement("s");
  was.textContent = formatBucks(wasPrice(price));
  button.replaceChildren(was, ` Buy ${formatBucks(price)}`);
}

export function renderWallet(wallet: Wallet) {
  currentWallet = wallet;
  const price = (base: number) => inflate(base, wallet.lifetime);
  const button = (id: string) =>
    document.getElementById(id) as HTMLButtonElement | null;
  for (const item of ITEMS) {
    const b = button(`item-${item.id}`);
    if (!b) continue;
    const owned = wallet.owned.includes(item.id),
      equipped = wallet.equipped[item.slot] === item.id,
      cost = price(item.price);
    if (!owned && item.crateOnly) {
      b.textContent = "Crate exclusive";
      b.disabled = true;
    } else if (!owned) {
      priceButton(b, cost);
      b.disabled = wallet.balance < cost;
    } else {
      b.textContent =
        item.slot === "perk" ? "Owned" : equipped ? "Unequip" : "Equip";
      b.disabled = item.slot === "perk";
    }
    b.classList.toggle("equipped", equipped);
  }
  const set = (id: string, text: string) => {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  };
  set("shopBalance", formatBucks(wallet.balance));
  set("shopLifetime", formatBucks(wallet.lifetime));
  set("shopSpent", formatBucks(wallet.spent));
  const markup = Math.round((inflation(wallet.lifetime) - 1) * 100);
  set(
    "shopInflation",
    markup
      ? `Prices adjusted +${markup}% for your success ❤ (Dynamic Pricing™)`
      : "",
  );
  for (const u of UPGRADES) {
    const owned = wallet.upgrades[u.id as UpgradeId] ?? 0,
      maxed = owned >= UPGRADE_TIERS,
      cost = price(upgradePrice(owned));
    set(`upgrade-${u.id}-tier`, ` · ${owned}/${UPGRADE_TIERS}`);
    const b = button(`upgrade-${u.id}`);
    if (!b) continue;
    if (maxed) b.textContent = "Maxed";
    else priceButton(b, cost);
    b.disabled = maxed || wallet.balance < cost;
  }
  const discount = UPGRADES.find((u) => u.id === "discount")!.step;
  for (const weapon of ["cannon", "gravityBomb", "nuke", "laser"] as const)
    set(
      `ammo-${weapon}`,
      ammoLabel(
        price(
          AMMO_COST[weapon] * (1 - discount * (wallet.upgrades.discount ?? 0)),
        ),
      ),
    );
  for (const sv of SERVICES) {
    const b = button(`service-${sv.id}`);
    if (!b) continue;
    priceButton(b, price(sv.price));
    b.disabled = wallet.balance < price(sv.price);
  }
  renderPremium(wallet);
}

const ammoLabel = (cost: number) =>
  cost ? `${formatBucks(cost)} / shot` : "Free";

function row(name: string, value: string, id?: string) {
  const item = document.createElement("li");
  const label = document.createElement("span");
  label.textContent = name;
  const price = document.createElement("strong");
  if (id) price.id = id;
  price.textContent = value;
  item.append(label, price);
  return item;
}
