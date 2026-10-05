import { SaveStore } from "./storage";
import type { SaveWriteRequest, SaveWriteResult } from "./save-writer";
import type { SaveSnapshot } from "./types";
let store: SaveStore | undefined,
  opened: Promise<void> | undefined,
  epoch = 0;
const captures = new Set<{ port: MessagePort; reject(error: Error): void }>();
self.onmessage = async (event: MessageEvent<SaveWriteRequest>) => {
  const message = event.data;
  let commit: SaveWriteResult["commit"];
  try {
    if (message.type === "open") {
      store = new SaveStore(message.name);
      opened = store.open();
      await opened;
    } else {
      if (!opened || !store) throw Error("Save worker is not open");
      await opened;
      if (message.type === "retire") {
        epoch = message.epoch;
        for (const capture of captures) {
          capture.port.close();
          capture.reject(Error("Island changed during save capture"));
        }
        captures.clear();
        store.retirePendingWrites();
      } else {
        if (message.epoch !== epoch) throw Error("Obsolete island save");
        if (message.type === "capture") {
          const captured = await new Promise<{
            save: SaveSnapshot;
            slices: number[];
          }>((resolve, reject) => {
            const pending = { port: message.port, reject };
            let payload: { save: SaveSnapshot; slices: number[] } | undefined;
            captures.add(pending);
            const finish = () => {
              captures.delete(pending);
              message.port.close();
            };
            message.port.onmessage = (event) => {
              const data = event.data;
              if (data.type === "saved" && !payload) {
                payload = { save: data.save, slices: data.slices ?? [] };
                return;
              }
              finish();
              if (
                data.error ||
                data.type !== "saveDispatch" ||
                !payload ||
                !Number.isFinite(data.ms)
              )
                reject(Error(data.error || "Invalid save capture"));
              else
                resolve({
                  save: payload.save,
                  slices: [...payload.slices, data.ms],
                });
            };
            message.port.onmessageerror = () => {
              finish();
              reject(Error("Save capture could not be decoded"));
            };
          });
          if (message.epoch !== epoch) throw Error("Obsolete island save");
          const started = performance.now();
          await store.write(captured.save);
          commit = {
            capture: captured.save.capture,
            revision: captured.save.revision,
            hour: captured.save.hour,
            slices: captured.slices,
            storageMS: performance.now() - started,
          };
        } else await store.write(message.save);
      }
    }
    postMessage({
      id: message.id,
      ...(commit ? { commit } : {}),
    } satisfies SaveWriteResult);
  } catch (error) {
    if (message.type === "capture") message.port.close();
    postMessage({
      id: message.id,
      error: error instanceof Error ? error.message : String(error),
    } satisfies SaveWriteResult);
  }
};
