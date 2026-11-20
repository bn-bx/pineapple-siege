import { AltitudeWarning } from "../altitude-warning";
import {
  BLAST_COSMETIC_LIMIT,
  BLAST_DEBRIS_LIMIT,
  clamp,
  flightLimits,
  GRAVITY_BOMB,
  LASER,
  RAPID_FIRE_INTERVAL,
  TRUCK,
  VEHICLE,
  WEAPONS,
} from "../config";
import { frameStats } from "../frame-stats";
import { AMMO_COST, comboMultiplier, formatBucks } from "../economy/pricing";
import type { Contract } from "../economy/contracts";
import { updateFlashSale } from "./monetization-ui";
import { GameRenderer } from "../render/renderer";
import { SessionState } from "../session-state";
import type { Preferences, SimulationSnapshot, WorldData } from "../types";
export interface HudContext {
  lastHUD: number;
  $: <T extends HTMLElement = HTMLElement>(id: string) => T;
  view: GameRenderer;
  altitudeWarning: AltitudeWarning;
  session: SessionState;
  snapshot: SimulationSnapshot | undefined;
  destruction: {
    bodies: number;
    fragments: number;
    cosmetics: number;
    rubble: number;
    noCooldown: boolean;
    nukeScale: number;
    laserSize: number;
    laserDepth: number;
    laserBrightness: number;
  };
  world: WorldData;
  debug: boolean;
  extras: Preferences;
  lastPerfSummary: number;
  frameTimes: number[];
  perfSummary: string;
  avgFrame: number;
}
export function updateHUD(ctx: HudContext, now: number): void {
  const snapshot = ctx.snapshot;
  if (!snapshot) return;
  const p = snapshot.plane;
  const hell = ctx.world.realm === "hell";
  if (now - ctx.lastHUD > 160) {
    const driving = p.mode === "ground";
    ctx.$("altitudeLabel").textContent = driving
      ? "TRUCK AIRTIME M"
      : hell
        ? "CEILING CLEARANCE M"
        : "HEIGHT AGL M";
    ctx.$("touchVehicle").textContent = driving ? "Fly" : "Drive";
    ctx.$("deathTitle").textContent = driving ? "MIXER WRECKED" : "AIRCRAFT LOST";
    ctx.$("populationPanel").hidden = hell;
    ctx.$("speed").textContent = Math.round(p.speed).toString();
    const health =
      p.crashed > 0 ? 0 : Math.round(p.health ?? VEHICLE.maxHealth),
      fraction = health / VEHICLE.maxHealth,
      meter = ctx.$("health");
    ctx.$("healthLabel").textContent = `${driving ? "TRUCK" : "HULL"} ${health}%`;
    ctx.$("healthFill").style.width = `${fraction * 100}%`;
    meter.setAttribute("aria-valuenow", String(health));
    meter.classList.toggle("warn", fraction <= 0.6 && fraction > 0.3);
    meter.classList.toggle("low", fraction <= 0.3);
    meter.classList.toggle("hit", (p.hurtAge ?? Infinity) < 0.4);
    // The truck floats, so measure its airtime from the water surface too.
    const ground = ctx.view.terrain.sample(p.p[0], p.p[2]),
      water = ctx.view.terrain.waterSurface(p.p[0], p.p[2]);
    const floor =
      driving && water !== undefined && water !== null
        ? Math.max(ground, water - TRUCK.draft)
        : ground;
    ctx.$("altitude").textContent = Math.max(
      0,
      Math.round(p.p[1] - floor - (driving ? TRUCK.rideHeight : 0)),
    ).toString();
    if (p.crashed > 0 || driving) ctx.altitudeWarning.reset();
    const limits = flightLimits(ctx.world.realm);
    const ceilingMessage = driving
      ? undefined
      : ctx.altitudeWarning.update(p.p[1], limits);
    ctx.$("ceilingWarning").hidden =
      !ctx.session.active || p.crashed > 0 || !ceilingMessage;
    ctx.$("ceilingWarning").textContent = ceilingMessage
      ? `${ceilingMessage} · ${Math.round(p.p[1])} M ${hell ? "FROM CEILING" : "ABOVE SEA LEVEL"} · LIMIT ${limits.ceiling} M`
      : "";
    ctx.$("throttleFill").style.height =
      clamp(
        driving
          ? (p.speed / TRUCK.boostSpeed) * 100
          : ((p.speed - 35) / 85) * 100,
        5,
        100,
      ) + "%";
    ctx.$("clock").textContent =
      `${String(Math.floor(snapshot.hour)).padStart(2, "0")}:${String(Math.floor((snapshot.hour % 1) * 60)).padStart(2, "0")}`;
    const label = {
      local: "Local",
      castle: "Castle-leveling",
      valley: "Valley-scale",
    }[snapshot.nukeYield];
    ctx.$("weaponName").textContent = hell
      ? snapshot.weapon === "nuke" ? `JET NUKE · ${label}`
        : snapshot.weapon === "laser" ? "ENGINE LASER"
        : snapshot.weapon === "gravityBomb" ? `GRAVITY BOMB · ${GRAVITY_BOMB.radius.toLocaleString("en-US")} M`
        : "JET CANNON"
      : snapshot.weapon === "nuke"
        ? `PINEAPPLE NUKE · ${label} · ${ctx.destruction.nukeScale}×`
        : snapshot.weapon === "laser"
          ? "SPACE LASER · ORBITAL EXCAVATION"
          : snapshot.weapon === "gravityBomb"
            ? `GRAVITY BOMB · ${GRAVITY_BOMB.radius.toLocaleString("en-US")} M`
            : "PINEAPPLE CANNON";
    const cooldown = snapshot.cooldowns[snapshot.weapon];
    const economy = snapshot.economy;
    const cost = economy?.costs[snapshot.weapon] ?? AMMO_COST[snapshot.weapon];
    const broke = !!economy && economy.balance < cost;
    ctx.$("wallet").hidden = !economy;
    if (economy) {
      ctx.$("walletBalance").textContent = formatBucks(economy.balance);
      const combo = ctx.$("walletCombo");
      combo.hidden = economy.combo < 2;
      combo.textContent = `COMBO ×${comboMultiplier(economy.combo)}`;
      ctx.$("walletGold").textContent = economy.gold.total
        ? `Golden pineapples ${economy.gold.collected}/${economy.gold.total}`
        : "";
      renderContracts(economy.contracts);
      const gadget = economy.gadget;
      ctx.$("walletGadget").textContent = gadget
        ? `G · ${gadget.name} · ${
            gadget.cooldown > 0.05
              ? `${gadget.cooldown.toFixed(1)} s`
              : economy.balance < gadget.use
                ? `need ${formatBucks(gadget.use)}`
                : formatBucks(gadget.use)
          }`
        : "";
    }
    if (economy)
      updateFlashSale(
        p.crashed > 0 && !p.falling,
        economy.balance,
        economy.lifetime,
      );
    ctx.$("ammo").textContent = !economy ? "∞" : cost ? formatBucks(cost) : "FREE";
    ctx.$("ammo").classList.toggle("broke", broke);
    const strike =
      snapshot.weapon === "laser"
        ? (snapshot.lasers.find((l) => l.phase === "burning") ??
          snapshot.lasers.find((l) => l.phase === "charging") ??
          snapshot.lasers[0])
        : undefined;
    ctx.$("weaponStatus").textContent = broke && !strike
      ? `NEED ${formatBucks(cost)} · HAVE ${formatBucks(economy!.balance)}`
      : strike
      ? (strike.phase === "charging"
          ? `CHARGING · ${Math.max(0, LASER.charge - strike.age).toFixed(1)} S`
          : strike.phase === "burning"
            ? `FIRING · ${Math.max(0, LASER.charge + LASER.beam - strike.age).toFixed(1)} S`
            : "EXCAVATING") +
        (snapshot.lasers.length > 1
          ? ` · ${snapshot.lasers.length} STRIKES`
          : "")
      : snapshot.weapon === "laser" && !snapshot.aim && cooldown <= 0.01
        ? "NO TARGET · AIM AT A SURFACE"
        : snapshot.weapon === "gravityBomb" && (snapshot.gravityBombs?.length ?? 0) >= 8
          ? "8 BOMBS ACTIVE"
        : cooldown > 0.01
          ? `READY IN ${cooldown.toFixed(1)} S`
          : !ctx.destruction.noCooldown &&
              snapshot.weapon === "nuke" &&
              snapshot.stats.pendingJobs +
                snapshot.projectiles.filter((p) => p.weapon === "nuke")
                  .length >=
                8
            ? "PROCESSING DAMAGE"
            : ctx.destruction.noCooldown
              ? "READY · 0.1 S"
              : "READY";
    ctx.$("cooldownFill").style.width =
      `${100 * Math.max(0, 1 - cooldown / (ctx.destruction.noCooldown ? RAPID_FIRE_INTERVAL : WEAPONS[snapshot.weapon].cooldown))}%`;
    for (const weapon of ["cannon", "nuke", "laser", "gravityBomb"]) {
      const button = ctx.$("select-" + weapon);
      button.classList.toggle("selected", snapshot.weapon === weapon);
      button.setAttribute("aria-pressed", String(snapshot.weapon === weapon));
    }
    const castle = ctx.world.castles?.find(
      (c) =>
        p.p[0] >= c.bounds.min[0] &&
        p.p[0] <= c.bounds.max[0] &&
        p.p[2] >= c.bounds.min[1] &&
        p.p[2] <= c.bounds.max[1],
    );
    ctx.$("region").textContent = castle
      ? castle.grand
        ? "GRAND CASTLE"
        : "CASTLE"
      : hell ? "ABYSS"
      : p.p[1] > 240
        ? "HIGH ALTITUDE"
        : "ISLAND";
    ctx.$("damage").textContent = snapshot.stats.removed
      ? `Objects destroyed: ${snapshot.stats.removed}`
      : "Objects destroyed: 0";
    ctx.$("monstersRemaining").textContent =
      `${hell ? "Jets" : "Monsters"}: ${snapshot.monsters.filter((m) => !m.defeated).length}/${snapshot.monsterCount}`;
    const population = snapshot.population;
    ctx.$("populationTotal").textContent = String(population.alive);
    ctx.$("happinessValue").textContent = `${population.happiness} / 100`;
    const rageNotice = (snapshot.statueRageNoticeRemaining ?? 0) > 0;
    ctx.$("warning").hidden =
      !ctx.session.active || p.crashed > 0 || (!p.boundary && !rageNotice);
    ctx.$("warning").textContent = rageNotice
      ? hell
        ? "Jet God angered — jets are racing toward you"
        : "Pineapple God angered — wheeled monsters are racing toward you"
      : p.boundary
        ? "MAP BOUNDARY · TURNING BACK"
        : "";
    if (
      (ctx.debug || ctx.extras.showPerf) &&
      now - ctx.lastPerfSummary > 1000 &&
      ctx.frameTimes.length
    ) {
      const stats = frameStats(ctx.frameTimes);
      const low =
        stats.lowFPS === undefined
          ? "warming up"
          : `${stats.lowFPS.toFixed(1)} FPS`;
      ctx.perfSummary = `\nFrame median ${stats.medianMS.toFixed(1)} ms · p95 ${stats.p95MS.toFixed(1)} ms\n1% low ${low} · worst ${stats.worstMS.toFixed(1)} ms`;
      const stages = ctx.view.performance.stats.stages;
      ctx.perfSummary += `\nCPU p95 ${(stages.prepare?.p95MS ?? 0).toFixed(1)} ms · draw ${(stages.submit?.p95MS ?? 0).toFixed(1)} ms\nTerrain ${(stages.terrain?.p95MS ?? 0).toFixed(1)} ms · worker ${ctx.view.terrain.workerMS.toFixed(1)} ms · queue ${ctx.view.terrain.queueDepth}`;
      ctx.lastPerfSummary = now;
    }
    const r = ctx.view.stats;
    ctx.$("perf").textContent =
      `${Math.round(1000 / ctx.avgFrame)} FPS · ${r.width} × ${r.height}\n${snapshot.packedBodies?.count ?? snapshot.bodies.length}/${BLAST_DEBRIS_LIMIT} wreckage · ${snapshot.stats.ballistic} flying pieces\n${r.fragments}/${BLAST_COSMETIC_LIMIT} cosmetic chunks\nPhysics ${snapshot.stats.physicsMS.toFixed(1)} ms · ${r.drawCalls} draws\n${Math.round(r.triangles / 1000)}k triangles · revision ${snapshot.stats.revision}\nDestruction ${snapshot.stats.destructionMS.toFixed(1)} ms · ${snapshot.stats.pendingJobs} jobs${ctx.perfSummary}\nQuality ${ctx.view.visualProfile.name} · simulation ${ctx.view.performance.queues.simulationRatio?.toFixed(3) ?? "—"}×\nTextures ${((ctx.view.performance.queues.residentTextureBytes ?? 0) / 1048576).toFixed(1)} MiB · targets ${((ctx.view.performance.queues.renderTargetBytes ?? 0) / 1048576).toFixed(1)} MiB`;
    ctx.lastHUD = now;
  }
}

let contractsShown = "";
/** Lists active contracts on the HUD and in the Shop, rebuilding only on change. */
function renderContracts(contracts: Contract[]) {
  const key = JSON.stringify(contracts);
  if (key === contractsShown) return;
  contractsShown = key;
  const hud = document.getElementById("walletContracts");
  const shop = document.getElementById("shopContracts");
  const line = (c: Contract, detailed: boolean) => {
    const item = document.createElement("li");
    const text = document.createElement("span");
    text.textContent =
      c.goal > 1 && c.kind !== "combo"
        ? `${c.text} · ${c.progress}/${c.goal}`
        : c.text;
    const reward = document.createElement("strong");
    reward.textContent = formatBucks(c.reward);
    item.append(text, reward);
    if (detailed && c.goal > 1 && c.kind !== "combo") {
      const bar = document.createElement("i");
      bar.style.width = `${(100 * c.progress) / c.goal}%`;
      item.append(bar);
    }
    return item;
  };
  hud?.replaceChildren(...contracts.map((c) => line(c, true)));
  shop?.replaceChildren(...contracts.map((c) => line(c, false)));
}
