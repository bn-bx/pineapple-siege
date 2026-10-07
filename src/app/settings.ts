import { GameAudio } from "../audio";
import {
  DEFAULT_MONSTER_COUNT,
  normalizeMonsterCount,
  normalizeRenderDistance,
} from "../config";
import { COSMETIC_LIMITS, fixedDestruction } from "../destruction-settings";
import { normalizePreferences } from "../preferences";
import { GameRenderer } from "../render/renderer";
import { SaveStore } from "../storage";
import type { GameCommand, NukeYield, Preferences } from "../types";
export interface SettingsContext {
  extras: Preferences;
  reversedX: boolean;
  inverted: boolean;
  store: SaveStore;
  preferences: () => Preferences;
  $: <T extends HTMLElement = HTMLElement>(id: string) => T;
  sensitivity: number;
  nukeYield: NukeYield;
  monsterCount: number;
  view: GameRenderer;
  updateRenderDistanceUI: () => void;
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
  updateDestructionUI: () => void;
  updateMonsterCountUI: () => void;
  debug: boolean;
  send: (message: GameCommand, transfer?: Transferable[]) => void;
  savePreferences: () => void;
  applyDestruction: () => void;
  resetFrameStats: () => void;
  applyPreferences: (p: Preferences) => void;
  audio: GameAudio;
  saveNow: (force?: boolean) => Promise<void>;
}
export function preferences(ctx: SettingsContext): Preferences {
  return {
    ...ctx.extras,
    reverseX: ctx.reversedX,
    reverseY: ctx.inverted,
    sensitivity: ctx.sensitivity,
    nukeYield: ctx.nukeYield,
    monsterCount: ctx.monsterCount,
    destruction: ctx.destruction,
  };
}
export function savePreferences(ctx: SettingsContext): void {
  ctx.store.writePreferences(ctx.preferences()).catch(() => {
    ctx.$("status").textContent =
      "Settings apply for this session; storage is unavailable.";
  });
}
export function applyPreferences(ctx: SettingsContext, p: Preferences): void {
  ctx.extras = normalizePreferences(p);
  ctx.reversedX = p.reverseX;
  ctx.inverted = p.reverseY;
  ctx.sensitivity = p.sensitivity;
  ctx.nukeYield = p.nukeYield;
  ctx.monsterCount = ctx.extras.monsterCount ?? DEFAULT_MONSTER_COUNT;
  ctx.view?.setRenderDistance(ctx.extras.renderDistance!);
  ctx.updateRenderDistanceUI();
  ctx.destruction = fixedDestruction(p.destruction);
  ctx.updateDestructionUI();
  ctx.$<HTMLInputElement>("reverseX").checked = ctx.reversedX;
  ctx.$<HTMLInputElement>("invert").checked = ctx.inverted;
  ctx.$<HTMLInputElement>("sensitivity").value = String(ctx.sensitivity);
  ctx.updateMonsterCountUI();
  for (const id of [
    "reduceEffects",
    "reduceShake",
    "mute",
    "showPerf",
    "holdTime",
  ] as const)
    ctx.$<HTMLInputElement>(id).checked = !!ctx.extras[id];
  ctx.$<HTMLInputElement>("volume").value = String(ctx.extras.volume);
  ctx.$<HTMLSelectElement>("quality").value = ctx.extras.quality!;
  ctx.$("perf").hidden = !(ctx.extras.showPerf || ctx.debug);
}
export function updateMonsterCountUI(ctx: SettingsContext): void {
  ctx.$<HTMLInputElement>("monsterCount").value = String(ctx.monsterCount);
  ctx.$("monsterCountValue").textContent =
    ctx.monsterCount === 0 ? "Off" : String(ctx.monsterCount);
}
export function updateRenderDistanceUI(ctx: SettingsContext): void {
  const input = ctx.$<HTMLInputElement>("renderDistance");
  input.value = String(ctx.extras.renderDistance);
  input.setAttribute(
    "aria-valuetext",
    `${ctx.extras.renderDistance!.toLocaleString()} meters`,
  );
  ctx.$("renderDistanceValue").textContent =
    `${ctx.extras.renderDistance!.toLocaleString()} m`;
}
export function updateDestructionUI(ctx: SettingsContext): void {
  ctx.$<HTMLInputElement>("noCooldown").checked = ctx.destruction.noCooldown;
}
export function applyDestruction(ctx: SettingsContext): void {
  ctx.destruction = fixedDestruction(ctx.destruction);
  ctx.updateDestructionUI();
  ctx.view?.effects.fragments.setLimit(
    COSMETIC_LIMITS[ctx.destruction.cosmetics],
  );
  ctx.send({ type: "destructionSettings", value: ctx.destruction });
  ctx.savePreferences();
}

export function bind(ctx: SettingsContext): void {
  ctx.$<HTMLInputElement>("noCooldown").onchange = (e) => {
    ctx.destruction.noCooldown = (e.target as HTMLInputElement).checked;
    ctx.applyDestruction();
  };
  ctx.$("defaultSettings").onclick = () => {
    ctx.resetFrameStats();
    ctx.applyPreferences(normalizePreferences());
    ctx.view?.setQuality(ctx.extras.quality!);
    ctx.view?.setReducedEffects(!!ctx.extras.reduceEffects);
    ctx.view?.setShake(!ctx.extras.reduceShake);
    ctx.audio.setVolume(ctx.extras.volume!);
    ctx.audio.setMute(!!ctx.extras.mute);
    ctx.$("perf").hidden = !ctx.extras.showPerf;
    ctx.send({ type: "nukeYield", value: ctx.nukeYield });
    ctx.send({ type: "holdTime", hold: !!ctx.extras.holdTime });
    ctx.send({ type: "monsterCount", value: ctx.monsterCount });
    ctx.$<HTMLInputElement>("time").value = "15.5";
    ctx.send({ type: "hour", hour: 15.5 });
    ctx.$("status").textContent =
      "Settings reset to defaults. World damage preserved.";
    ctx.applyDestruction();
    void ctx.saveNow(true);
  };
  ctx.$<HTMLInputElement>("monsterCount").oninput = (event) => {
    ctx.monsterCount = normalizeMonsterCount(
      Number((event.target as HTMLInputElement).value),
    );
    ctx.extras.monsterCount = ctx.monsterCount;
    ctx.updateMonsterCountUI();
    ctx.send({ type: "monsterCount", value: ctx.monsterCount });
    ctx.savePreferences();
  };
  ctx.$<HTMLSelectElement>("quality").onchange = (e) => {
    ctx.resetFrameStats();
    ctx.extras.quality = (e.target as HTMLSelectElement).value;
    ctx.view?.setQuality(ctx.extras.quality);
    ctx.savePreferences();
  };
  ctx.$<HTMLInputElement>("renderDistance").oninput = (e) => {
    ctx.extras.renderDistance = normalizeRenderDistance(
      Number((e.target as HTMLInputElement).value),
    );
    ctx.view?.setRenderDistance(ctx.extras.renderDistance);
    ctx.updateRenderDistanceUI();
    ctx.resetFrameStats();
    ctx.savePreferences();
  };
  ctx.$<HTMLInputElement>("sensitivity").oninput = (e) => {
    ctx.sensitivity = +(e.target as HTMLInputElement).value;
    ctx.savePreferences();
  };
  ctx.$<HTMLInputElement>("invert").onchange = (e) => {
    ctx.inverted = (e.target as HTMLInputElement).checked;
    ctx.savePreferences();
  };
  ctx.$<HTMLInputElement>("reverseX").onchange = (e) => {
    ctx.reversedX = (e.target as HTMLInputElement).checked;
    ctx.savePreferences();
  };
  for (const id of [
    "reduceEffects",
    "reduceShake",
    "mute",
    "showPerf",
    "holdTime",
  ] as const) {
    ctx.$<HTMLInputElement>(id).onchange = (e) => {
      if (id === "showPerf") ctx.resetFrameStats();
      ctx.extras[id] = (e.target as HTMLInputElement).checked;
      ctx.view?.setReducedEffects(!!ctx.extras.reduceEffects);
      ctx.view?.setShake(!ctx.extras.reduceShake);
      ctx.audio.setMute(!!ctx.extras.mute);
      ctx.$("perf").hidden = !ctx.extras.showPerf;
      ctx.send({ type: "holdTime", hold: !!ctx.extras.holdTime });
      ctx.savePreferences();
    };
  }
  ctx.$<HTMLInputElement>("time").oninput = (e) =>
    ctx.send({ type: "hour", hour: +(e.target as HTMLInputElement).value });
  ctx.$<HTMLInputElement>("volume").oninput = (e) => {
    ctx.extras.volume = +(e.target as HTMLInputElement).value;
    ctx.audio.setVolume(ctx.extras.volume);
    ctx.savePreferences();
  };
}
