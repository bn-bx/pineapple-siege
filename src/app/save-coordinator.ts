import { SaveCaptureCoordinator } from "../save-capture";
import { SaveWriter } from "../save-writer";
import { SessionState } from "../session-state";
import { SaveStore } from "../storage";
import type { GameCommand, SaveSnapshot, SimulationSnapshot } from "../types";
export interface SaveCoordinatorContext {
  saveCaptures: SaveCaptureCoordinator;
  send: (message: GameCommand, transfer?: Transferable[]) => void;
  session: SessionState;
  saveEnabled: boolean;
  snapshot: SimulationSnapshot | undefined;
  queuedReset: boolean;
  islandChanging: boolean;
  savedRevision: number;
  lastSavedHour: number;
  saveEpoch: number;
  lastSaveAt: number;
  saveNoticeTimer: number;
  $: <T extends HTMLElement = HTMLElement>(id: string) => T;
  saveWriter: SaveWriter;
  worker: Worker;
  hasSave: boolean;
  pause: () => void;
  enterButton: HTMLButtonElement;
  store: SaveStore;
}
export function requestSave(
  ctx: SaveCoordinatorContext,
): Promise<SaveSnapshot> {
  return ctx.saveCaptures.request((request) =>
    ctx.send({ type: "save", request }),
  );
}
export async function saveNow(
  ctx: SaveCoordinatorContext,
  force = false,
): Promise<void> {
  if (
    !ctx.session.ready ||
    !ctx.saveEnabled ||
    ctx.saveCaptures.saving ||
    !ctx.snapshot ||
    ctx.queuedReset ||
    ctx.islandChanging
  )
    return;
  if (
    !force &&
    ctx.snapshot.stats.revision === ctx.savedRevision &&
    Math.abs(ctx.snapshot.hour - ctx.lastSavedHour) < 0.05
  )
    return;
  const epoch = ctx.saveEpoch;
  const owner = ctx.saveCaptures.begin();
  ctx.lastSaveAt = performance.now();
  clearTimeout(ctx.saveNoticeTimer);
  ctx.$("saveStatus").style.opacity = "1";
  ctx.$("saveStatus").textContent = "Saving world…";
  try {
    const save = await ctx.saveWriter.capture((port) =>
      ctx.worker.postMessage(
        { type: "save", request: 0, port } satisfies GameCommand,
        [port],
      ),
    );
    if (epoch !== ctx.saveEpoch) return;
    if (save.capture !== undefined)
      ctx.send({ type: "saveAck", capture: save.capture });
    ctx.savedRevision = save.revision;
    ctx.lastSavedHour = save.hour;
    ctx.hasSave = true;
    ctx.$("saveStatus").textContent = "World saved";
    ctx.saveNoticeTimer = window.setTimeout(() => {
      ctx.$("saveStatus").style.opacity = "0";
    }, 2000);
  } catch (e) {
    if (epoch !== ctx.saveEpoch) return;
    ctx.saveEnabled = false;
    ctx.$("saveStatus").classList.add("save-error");
    ctx.$("saveStatus").textContent =
      "Not saving · browser storage is unavailable";
    ctx.$("status").textContent =
      "Flight is available, but your changes cannot be saved. " + String(e);
  } finally {
    ctx.saveCaptures.finish(owner);
  }
}
export function askReset(ctx: SaveCoordinatorContext): void {
  ctx.pause();
  ctx.$<HTMLDialogElement>("confirm").showModal();
}
export async function resetWorld(ctx: SaveCoordinatorContext): Promise<void> {
  ctx.queuedReset = true;
  ctx.saveEpoch++;
  ctx.saveCaptures.retire();
  ctx.enterButton.disabled = true;
  ctx.$("enterLabel").textContent = "Resetting world…";
  ctx.$<HTMLDialogElement>("confirm").close();
  ctx.savedRevision = -1;
  ctx.lastSavedHour = -1;
  try {
    if (ctx.saveEnabled) await ctx.store.clear();
  } catch {
    ctx.saveEnabled = false;
  }
  ctx.send({ type: "reset" });
}
