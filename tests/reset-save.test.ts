import { afterEach, expect, it, vi } from "vitest";
import {
  resetWorld,
  saveNow,
  type SaveCoordinatorContext,
} from "../src/app/save-coordinator";
import { SaveCaptureCoordinator } from "../src/save-capture";
import { SessionState } from "../src/session-state";

afterEach(() => vi.unstubAllGlobals());

function fixture() {
  vi.stubGlobal("window", { setTimeout: vi.fn(() => 0) });
  const elements = new Map<string, unknown>();
  const session = new SessionState();
  session.loaded();
  const ctx = {
    session,
    saveCaptures: new SaveCaptureCoordinator(),
    saveEnabled: true,
    islandChanging: false,
    saveEpoch: 0,
    savedRevision: 1,
    snapshot: { stats: { revision: 2 }, hour: 15 },
    send: vi.fn(),
    worker: { postMessage: vi.fn() },
    saveWriter: { capture: vi.fn() },
    $(id: string) {
      if (!elements.has(id))
        elements.set(id, {
          textContent: "",
          style: {},
          classList: { add: vi.fn() },
        });
      return elements.get(id);
    },
  } as unknown as SaveCoordinatorContext;
  return ctx;
}

it("cancels an autosave during reset without disabling future saves or starting another capture", async () => {
  const ctx = fixture();
  let cancel!: (error: Error) => void;
  let finishReset!: () => void;
  vi.mocked(ctx.saveWriter.capture).mockImplementationOnce(
    () =>
      new Promise((_, reject) => {
        cancel = reject;
      }),
  );
  const saving = saveNow(ctx, true);
  expect(ctx.saveCaptures.saving).toBe(true);
  const resetting = resetWorld(ctx, async () => {
    cancel(Error("Save interrupted by reset"));
    await saving;
    await saveNow(ctx, true);
    await new Promise<void>((resolve) => {
      finishReset = resolve;
    });
  });
  await saving;
  expect(ctx.saveEnabled).toBe(true);
  expect(ctx.savedRevision).toBe(1);
  expect(ctx.$("saveStatus").classList.add).not.toHaveBeenCalled();
  await resetWorld(ctx, async () => {
    throw Error("Duplicate reset");
  });
  expect(ctx.saveWriter.capture).toHaveBeenCalledOnce();
  // Let the reset continuation reach its deferred storage completion.
  await Promise.resolve();
  finishReset();
  await resetting;
  vi.mocked(ctx.saveWriter.capture).mockResolvedValueOnce({
    revision: 3,
    hour: 15,
    capture: 7,
    slices: [],
    storageMS: 1,
  });
  await saveNow(ctx, true);
  expect(ctx.saveEnabled).toBe(true);
  expect(ctx.savedRevision).toBe(3);
  expect(ctx.send).toHaveBeenCalledWith({ type: "saveAck", capture: 7 });
  expect(ctx.saveCaptures.saving).toBe(false);
});

it("releases the save gate after a failed reset", async () => {
  const ctx = fixture();
  await expect(
    resetWorld(ctx, async () => {
      throw Error("Storage unavailable");
    }),
  ).rejects.toThrow("Storage unavailable");
  expect(ctx.islandChanging).toBe(false);
  expect(ctx.saveEnabled).toBe(true);
});
