import { AltitudeWarning } from "../altitude-warning";
import { GameAudio } from "../audio";
import { normalizePreferences } from "../preferences";
import { GameRenderer } from "../render/renderer";
import { SaveCaptureCoordinator } from "../save-capture";
import { SessionState } from "../session-state";
import { compatible, SaveStore } from "../storage";
import type {
  GameCommand,
  Preferences,
  SaveSnapshot,
  SimulationSnapshot,
  WorkerMessage,
  WorldData,
} from "../types";
import {
  islandLink,
  parseSeedCode,
  seedCode,
  type IslandBaseline,
} from "../world/generator.mjs";
import { IslandPreview } from "../world/preview";
export interface IslandCoordinatorContext {
  destruction: import("../types").DestructionSettings;
  monsterCount: number;
  altitudeWarning: AltitudeWarning;
  saveEpoch: number;
  saveCaptures: SaveCaptureCoordinator;
  worker: Worker;
  view: GameRenderer;
  audio: GameAudio;
  world: WorldData;
  snapshot: SimulationSnapshot | undefined;
  session: SessionState;
  everEntered: boolean;
  savedRevision: number;
  lastSavedHour: number;
  enterButton: HTMLButtonElement;
  $: <T extends HTMLElement = HTMLElement>(id: string) => T;
  canvas: HTMLCanvasElement;
  send: (message: GameCommand, transfer?: Transferable[]) => void;
  extras: Preferences;
  handle: (message: WorkerMessage) => Promise<void>;
  fatal: (message: string, detail?: string) => void;
  debug: boolean;
  installDebug: () => void;
  islandChanging: boolean;
  saveEnabled: boolean;
  store: SaveStore;
  consumeIslandLink: () => void;
  hasSave: boolean;
  initializeWorld: (baseline: IslandBaseline, save?: SaveSnapshot) => void;
  islandPreview: IslandPreview;
  pause: () => void;
  replaceIsland: (baseline: IslandBaseline, reload: boolean) => Promise<void>;
  applyPreferences: (p: Preferences) => void;
  preferences: () => Preferences;
  islandLinkError: string;
  frame: (now: number) => void;
  newIsland: (seed?: number) => Promise<void>;
}
export function consumeIslandLink(ctx: IslandCoordinatorContext): void {
  const url = new URL(location.href);
  url.searchParams.delete("island");
  history.replaceState(null, "", url);
}
export function initializeWorld(
  ctx: IslandCoordinatorContext,
  baseline: IslandBaseline,
  save?: SaveSnapshot,
): void {
  ctx.altitudeWarning.reset();
  ctx.saveEpoch++;
  ctx.saveCaptures.retire();
  ctx.worker?.terminate();
  ctx.view?.dispose();
  ctx.audio.reset();
  ctx.world = baseline.world;
  ctx.snapshot = undefined;
  ctx.session.loading();
  ctx.everEntered = false;
  ctx.savedRevision = -1;
  ctx.lastSavedHour = -1;
  ctx.enterButton.disabled = true;
  ctx.$("enterLabel").textContent = "Loading island…";
  ctx
    .$("currentSeed")
    .setAttribute(
      "value",
      seedCode(ctx.world.seed, ctx.world.generatorVersion),
    );
  ctx.$<HTMLInputElement>("currentSeed").value = seedCode(
    ctx.world.seed,
    ctx.world.generatorVersion,
  );
  ctx.view = new GameRenderer(
    ctx.canvas,
    ctx.world,
    baseline.heights.slice(),
    (s) => {
      if (
        s.epoch !== undefined &&
        s.slot !== undefined &&
        s.packedBodies &&
        s.packedMotion
      )
        ctx.send(
          {
            type: "recycleMotion",
            epoch: s.epoch,
            slot: s.slot,
            bodies: s.packedBodies.buffer,
            actors: s.packedMotion.buffer,
          },
          [s.packedBodies.buffer, s.packedMotion.buffer],
        );
    },
  );
  ctx.view.setQuality(ctx.extras.quality!);
  ctx.view.setRenderDistance(ctx.extras.renderDistance!);
  ctx.view.setReducedEffects(!!ctx.extras.reduceEffects);
  ctx.view.setShake(!ctx.extras.reduceShake);
  ctx.audio.setVolume(ctx.extras.volume!);
  ctx.audio.setMute(!!ctx.extras.mute);
  ctx.worker = new Worker(new URL("../sim/worker.ts", import.meta.url), {
    type: "module",
  });
  ctx.worker.onmessage = (event: MessageEvent<WorkerMessage>) =>
    ctx.handle(event.data);
  ctx.worker.onerror = (e) =>
    ctx.fatal("The simulation worker could not start.", e.message);
  const terrainBytes = baseline.heights.slice().buffer;
  ctx.send(
    {
      type: "init",
      world: ctx.world,
      heights: terrainBytes,
      save,
      debug: ctx.debug,
      destruction: ctx.destruction,
      monsterCount: ctx.monsterCount,
    },
    [terrainBytes],
  );
  if (ctx.debug) ctx.installDebug();
}
export async function replaceIsland(
  ctx: IslandCoordinatorContext,
  baseline: IslandBaseline,
  reload: boolean,
): Promise<void> {
  ctx.islandChanging = true;
  try {
    const deadline = performance.now() + 5000;
    while (ctx.saveCaptures.saving) {
      if (performance.now() > deadline)
        throw Error("A save is still in progress. Try New island again.");
      await new Promise((r) => setTimeout(r, 20));
    }
    ctx.saveEpoch++;
    if (ctx.saveEnabled) await ctx.store.replaceBaseline(baseline);
    ctx.consumeIslandLink();
    ctx.hasSave = false;
    if (ctx.saveEnabled && reload) {
      location.reload();
      return;
    }
    ctx.initializeWorld(baseline);
  } finally {
    if (!reload || !ctx.saveEnabled) ctx.islandChanging = false;
  }
}
export async function newIsland(
  ctx: IslandCoordinatorContext,
  seed?: number,
): Promise<void> {
  if (ctx.islandPreview.dialog.open || ctx.islandChanging) return;
  ctx.pause();
  ctx.session.preview();
  const candidate = await ctx.islandPreview.choose(seed, !!ctx.view, true);
  ctx.session.pause();
  if (!candidate) {
    ctx.consumeIslandLink();
    return;
  }
  try {
    await ctx.replaceIsland(candidate, true);
  } catch (error) {
    ctx.islandChanging = false;
    ctx.$("status").textContent = `Island was not replaced: ${String(error)}`;
  }
}
export async function copyIsland(
  ctx: IslandCoordinatorContext,
  kind: "seed" | "link",
): Promise<void> {
  if (!ctx.world) return;
  const code = seedCode(ctx.world.seed, ctx.world.generatorVersion),
    text = kind === "seed" ? code : islandLink(code, location.href);
  try {
    await navigator.clipboard.writeText(text);
    ctx.$("shareFallback").hidden = true;
    ctx.$("islandShareStatus").textContent =
      kind === "seed"
        ? "Seed copied."
        : "Island link copied. Damage and progress stay private.";
  } catch {
    const field = ctx.$<HTMLInputElement>("shareFallback");
    field.hidden = false;
    field.value = text;
    field.focus();
    field.select();
    ctx.$("islandShareStatus").textContent = "Select and copy the text below.";
  }
}
export async function load(ctx: IslandCoordinatorContext): Promise<void> {
  try {
    let stored: SaveSnapshot | undefined,
      baseline: IslandBaseline | undefined,
      baselineIssue = false;
    try {
      await ctx.store.open();
      ctx.applyPreferences(
        (await ctx.store.preferences()) || normalizePreferences(),
      );
      await ctx.store.writePreferences(ctx.preferences()).catch(() => {
        ctx.$("status").textContent =
          "Settings apply for this session; preference storage is unavailable.";
      });
      stored = await ctx.store.load();
      try {
        baseline = await ctx.store.baseline();
      } catch (error) {
        baselineIssue = true;
        ctx.$("status").textContent = String(error);
      }
    } catch (error) {
      ctx.saveEnabled = false;
      ctx.$("saveStatus").textContent =
        "Local saving unavailable · session only";
      console.warn("Local save unavailable", error);
    }
    let linkedSeed: number | undefined,
      linkError = "";
    const code = new URLSearchParams(location.search).get("island");
    if (code !== null) {
      try {
        linkedSeed = parseSeedCode(code);
      } catch (error) {
        linkError = (error as Error).message;
        ctx.islandLinkError = linkError;
        ctx.consumeIslandLink();
      }
    }
    let save: SaveSnapshot | undefined;
    if (
      baseline &&
      (!stored ||
        compatible(
          stored,
          baseline.world.version,
          baseline.world.seed,
          baseline.world.generatorVersion,
        ))
    ) {
      save = stored;
      ctx.hasSave = !!save;
    } else {
      if (stored || baselineIssue) {
        const action = await new Promise<"temporary" | "replace">((resolve) => {
          ctx.$<HTMLDialogElement>("recovery").oncancel = (e) =>
            e.preventDefault();
          ctx.$<HTMLDialogElement>("recovery").showModal();
          ctx.$("temporary").onclick = () => resolve("temporary");
          ctx.$("replaceSave").onclick = () => resolve("replace");
        });
        ctx.$<HTMLDialogElement>("recovery").close();
        if (action === "temporary") {
          ctx.saveEnabled = false;
          ctx.$("saveStatus").textContent =
            "Temporary island · existing save untouched";
        }
      }
      baseline = (await ctx.islandPreview.choose(
        linkedSeed,
        false,
        ctx.saveEnabled && (!!stored || baselineIssue),
        linkError,
      )) as IslandBaseline;
      if (ctx.saveEnabled) {
        try {
          await ctx.store.replaceBaseline(baseline);
        } catch (error) {
          if (stored || baselineIssue) throw error;
          ctx.saveEnabled = false;
          ctx.$("saveStatus").textContent =
            "Island could not be saved · temporary play";
        }
      }
      ctx.consumeIslandLink();
      linkedSeed = undefined;
    }
    ctx.initializeWorld(baseline, save);
    requestAnimationFrame(ctx.frame);
    if (linkError) ctx.$("islandShareStatus").textContent = linkError;
    if (linkedSeed !== undefined) await ctx.newIsland(linkedSeed);
  } catch (error) {
    ctx.islandChanging = false;
    ctx.fatal(
      "The island could not load. Your previous save has been preserved.",
      String(error),
    );
  }
}
