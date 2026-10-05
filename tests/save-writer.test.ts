import { expect, it, vi } from "vitest";
import { SaveWriter, type SaveWriteRequest } from "../src/save-writer";
import { SaveStore } from "../src/storage";
import type { SaveSnapshot } from "../src/types";
function fixture() {
  const requests: SaveWriteRequest[] = [];
  const worker = {
    onmessage: undefined as any,
    onerror: undefined as any,
    onmessageerror: undefined as any,
    postMessage(message: SaveWriteRequest, transfer: Transferable[]) {
      requests.push(structuredClone(message, { transfer }));
    },
    terminate: vi.fn(),
  };
  return {
    writer: new SaveWriter("test", () => worker as any),
    worker,
    requests,
    reply(index: number, error?: string) {
      worker.onmessage({ data: { id: requests[index].id, error } });
    },
  };
}
const save = () =>
  ({
    version: 9,
    terrain: new Float32Array(),
    laserDry: new Uint32Array(),
    sections: [
      {
        id: 3,
        terrain: new Float32Array([100, 20]),
        dry: new Uint32Array([100]),
        ruins: [],
        removedRuins: [],
      },
    ],
    moving: { count: 0, buffer: new ArrayBuffer(16) },
  }) as unknown as SaveSnapshot;
it("transfers independent damage buffers and waits for the committed reply", async () => {
  const f = fixture(),
    original = save();
  f.writer.onPreparation = vi.fn();
  let committed = false;
  const write = f.writer.write(original).then(() => {
    committed = true;
  });
  f.reply(0);
  await Promise.resolve();
  expect(f.requests[1].type).toBe("write");
  const sent = f.requests[1] as Extract<SaveWriteRequest, { type: "write" }>;
  expect([...sent.save.sections![0].terrain]).toEqual([100, 20]);
  expect([...original.sections![0].terrain]).toEqual([100, 20]);
  expect(original.moving!.buffer.byteLength).toBe(16);
  expect(committed).toBe(false);
  expect(f.writer.onPreparation).toHaveBeenCalledOnce();
  f.reply(1);
  await write;
  expect(committed).toBe(true);
  f.writer.close();
  expect(f.worker.terminate).toHaveBeenCalledOnce();
});
it("retires a waiting dispatch before opening and rejects pending work on closure", async () => {
  const f = fixture();
  const obsolete = f.writer.write(save()).catch((error) => error.message);
  const retire = f.writer.retire();
  f.reply(0);
  await Promise.resolve();
  expect(await obsolete).toContain("World changed");
  expect(f.requests.map((message) => message.type)).toEqual(["open", "retire"]);
  f.reply(1);
  await retire;
  const pending = f.writer.write(save()).catch((error) => error.message);
  await Promise.resolve();
  const message = f.requests[2] as Extract<SaveWriteRequest, { type: "write" }>;
  expect(message.epoch).toBe(1);
  f.writer.close();
  expect(await pending).toContain("closed");
  f.reply(2); // a late reply cannot revive a closed task
  await expect(f.writer.write(save())).rejects.toThrow("closed");
});
it("aborts active local transactions before acknowledging retirement", () => {
  const store = new SaveStore();
  const active = { abort: vi.fn() };
  (store as any).writes.add(active);
  store.retirePendingWrites();
  expect(active.abort).toHaveBeenCalledOnce();
  expect((store as any).writes.size).toBe(0);
  store.retirePendingWrites();
  expect(active.abort).toHaveBeenCalledOnce();
});
it("routes captured payloads through a port and exposes only the committed receipt", async () => {
  const f = fixture();
  const receipt = {
    capture: 7,
    revision: 20,
    hour: 15,
    slices: [0.3, 1.2],
    storageMS: 4,
  };
  let finished = false;
  const capture = f.writer
    .capture((port) => {
      port.postMessage({ type: "saved", save: save(), slices: receipt.slices });
      port.close();
    })
    .then((result) => {
      finished = true;
      return result;
    });
  f.reply(0);
  await Promise.resolve();
  const request = f.requests[1] as Extract<
    SaveWriteRequest,
    { type: "capture" }
  >;
  expect(request.type).toBe("capture");
  expect("save" in request).toBe(false);
  const payload = await new Promise<any>((resolve) => {
    request.port.onmessage = (event) => resolve(event.data);
  });
  expect(payload.type).toBe("saved");
  expect(payload.save.sections[0].terrain[1]).toBe(20);
  expect(finished).toBe(false);
  request.port.close();
  f.worker.onmessage({ data: { id: request.id, commit: receipt } });
  expect(await capture).toEqual(receipt);
  f.writer.close();
});
it("rejects failed direct capture dispatch and receipts without a commit", async () => {
  const f = fixture();
  const failed = f.writer.capture(() => {
    throw Error("Source worker failed");
  });
  f.reply(0);
  await expect(failed).rejects.toThrow("Source worker failed");
  expect(f.requests).toHaveLength(1);
  const missing = f.writer.capture((port) => port.close());
  await Promise.resolve();
  const request = f.requests[1] as Extract<
    SaveWriteRequest,
    { type: "capture" }
  >;
  request.port.close();
  f.reply(1);
  await expect(missing).rejects.toThrow("no commit receipt");
  f.writer.close();
});
