import { AltitudeWarning } from "../altitude-warning";
import {
  BLAST_COSMETIC_LIMIT,
  BLAST_DEBRIS_LIMIT,
  clamp,
  CONFIG,
  LASER,
  RAPID_FIRE_INTERVAL,
  WEAPONS,
} from "../config";
import { frameStats } from "../frame-stats";
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
  if (now - ctx.lastHUD > 160) {
    ctx.$("speed").textContent = Math.round(p.speed).toString();
    ctx.$("altitude").textContent = Math.max(
      0,
      Math.round(p.p[1] - ctx.view.terrain.sample(p.p[0], p.p[2])),
    ).toString();
    if (p.crashed > 0) ctx.altitudeWarning.reset();
    const ceilingMessage = ctx.altitudeWarning.update(p.p[1]);
    ctx.$("ceilingWarning").hidden =
      !ctx.session.active || p.crashed > 0 || !ceilingMessage;
    ctx.$("ceilingWarning").textContent = ceilingMessage
      ? `${ceilingMessage} · ${Math.round(p.p[1])} M ABOVE SEA LEVEL · LIMIT ${CONFIG.ceiling} M`
      : "";
    ctx.$("throttleFill").style.height =
      clamp(((p.speed - 35) / 85) * 100, 5, 100) + "%";
    ctx.$("clock").textContent =
      `${String(Math.floor(snapshot.hour)).padStart(2, "0")}:${String(Math.floor((snapshot.hour % 1) * 60)).padStart(2, "0")}`;
    const label = {
      local: "Local",
      castle: "Castle-leveling",
      valley: "Valley-scale",
    }[snapshot.nukeYield];
    ctx.$("weaponName").textContent =
      snapshot.weapon === "nuke"
        ? `PINEAPPLE NUKE · ${label} · ${ctx.destruction.nukeScale}×`
        : snapshot.weapon === "laser"
          ? "SPACE LASER · ORBITAL EXCAVATION"
          : "PINEAPPLE CANNON";
    const cooldown = snapshot.cooldowns[snapshot.weapon];
    const strike =
      snapshot.weapon === "laser"
        ? (snapshot.lasers.find((l) => l.phase === "burning") ??
          snapshot.lasers.find((l) => l.phase === "charging") ??
          snapshot.lasers[0])
        : undefined;
    ctx.$("weaponStatus").textContent = strike
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
    for (const weapon of ["cannon", "nuke", "laser"]) {
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
      : p.p[1] > 240
        ? "HIGH ALTITUDE"
        : "ISLAND";
    ctx.$("damage").textContent = snapshot.stats.removed
      ? `Objects destroyed: ${snapshot.stats.removed}`
      : "Objects destroyed: 0";
    ctx.$("monstersRemaining").textContent =
      `Monsters: ${snapshot.monsters.filter((m) => !m.defeated).length}/${snapshot.monsterCount}`;
    const population = snapshot.population;
    ctx.$("populationTotal").textContent = String(population.alive);
    ctx.$("happinessValue").textContent = `${population.happiness} / 100`;
    ctx.$("warning").hidden =
      !ctx.session.active || (!p.boundary && p.crashed <= 0);
    ctx.$("warning").textContent =
      p.crashed > 0
        ? "CRASHED · RESPAWNING"
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
      ctx.lastPerfSummary = now;
    }
    const r = ctx.view.stats;
    ctx.$("perf").textContent =
      `${Math.round(1000 / ctx.avgFrame)} FPS · ${r.width} × ${r.height}\n${snapshot.packedBodies?.count ?? snapshot.bodies.length}/${BLAST_DEBRIS_LIMIT} wreckage · ${snapshot.stats.ballistic} flying pieces\n${r.fragments}/${BLAST_COSMETIC_LIMIT} cosmetic chunks\nPhysics ${snapshot.stats.physicsMS.toFixed(1)} ms · ${r.drawCalls} draws\n${Math.round(r.triangles / 1000)}k triangles · revision ${snapshot.stats.revision}\nDestruction ${snapshot.stats.destructionMS.toFixed(1)} ms · ${snapshot.stats.pendingJobs} jobs${ctx.perfSummary}\nQuality ${ctx.view.visualProfile.name} · simulation ${ctx.view.performance.queues.simulationRatio?.toFixed(3) ?? "—"}×\nTextures ${((ctx.view.performance.queues.residentTextureBytes ?? 0) / 1048576).toFixed(1)} MiB · targets ${((ctx.view.performance.queues.renderTargetBytes ?? 0) / 1048576).toFixed(1)} MiB`;
    ctx.lastHUD = now;
  }
}
