import type { SaveSnapshot } from "./types";

export interface DamageWriter {
  write(save: SaveSnapshot): Promise<void>;
  retire(): Promise<void>;
  close(): void;
}
type SaveWriteCommand =
  | { type: "open"; name: string }
  | { type: "write"; epoch: number; save: SaveSnapshot }
  | { type: "capture"; epoch: number; port: MessagePort }
  | { type: "retire"; epoch: number };
export type SaveWriteRequest = SaveWriteCommand & { id: number };
export interface SaveWriteResult {
  id: number;
  error?: string;
  commit?: SaveCommit;
}
export interface SaveCommit {
  capture?: number;
  revision: number;
  hour: number;
  slices: number[];
  storageMS: number;
}

/** Only damage commits move off-thread; baseline/recovery/preferences stay explicit. */
export class SaveWriter implements DamageWriter {
  onPreparation?: (ms: number) => void;
  private worker?: Worker;
  private opening?: Promise<SaveWriteResult>;
  private next = 0;
  private epoch = 0;
  private closed = false;
  private pending = new Map<
    number,
    { resolve(result: SaveWriteResult): void; reject(error: Error): void }
  >();
  constructor(
    private name: string,
    private create = () =>
      new Worker(new URL("./save-writer-worker.ts", import.meta.url), {
        type: "module",
      }),
  ) {}
  private open() {
    if (this.closed) return Promise.reject(Error("Save writer is closed"));
    if (!this.opening) {
      this.worker = this.create();
      this.worker.onmessage = (event: MessageEvent<SaveWriteResult>) => {
        const reply = event.data,
          pending = this.pending.get(reply.id);
        if (!pending) return;
        this.pending.delete(reply.id);
        if (reply.error) pending.reject(Error(reply.error));
        else pending.resolve(reply);
      };
      this.worker.onerror = (event) =>
        this.fail(Error(event.message || "Save worker failed"));
      this.worker.onmessageerror = () =>
        this.fail(Error("Save worker reply could not be decoded"));
      this.opening = this.request({ type: "open", name: this.name });
    }
    return this.opening;
  }
  private request(message: SaveWriteCommand, transfer: Transferable[] = []) {
    const id = ++this.next;
    return new Promise<SaveWriteResult>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        this.worker!.postMessage({ ...message, id }, transfer);
      } catch (error) {
        this.pending.delete(id);
        reject(error);
      }
    });
  }
  /** The damage payload travels worker-to-worker; only a commit receipt reaches UI. */
  async capture(send: (port: MessagePort) => void): Promise<SaveCommit> {
    const epoch = this.epoch;
    await this.open();
    if (epoch !== this.epoch || this.closed)
      throw Error("World changed before save capture");
    const started = performance.now(),
      channel = new MessageChannel();
    try {
      send(channel.port1);
      const committed = this.request(
        { type: "capture", epoch, port: channel.port2 },
        [channel.port2],
      );
      this.onPreparation?.(performance.now() - started);
      const result = await committed;
      if (!result.commit) throw Error("Save worker returned no commit receipt");
      return result.commit;
    } finally {
      channel.port1.close();
      channel.port2.close();
    }
  }
  async write(save: SaveSnapshot) {
    const epoch = this.epoch;
    await this.open();
    if (epoch !== this.epoch || this.closed)
      throw Error("World changed before save dispatch");
    const started = performance.now();
    // Contiguous copies preserve caller ownership; the worker owns each transferred
    // copy and performs validation, section merging, cloning and the transaction.
    const transfer: Transferable[] = [];
    const copy = <T extends Float32Array | Uint32Array>(data: T): T => {
      const result = data.slice() as T;
      transfer.push(result.buffer);
      return result;
    };
    const message: SaveSnapshot = {
      ...save,
      terrain:
        save.terrain instanceof Float32Array
          ? copy(save.terrain)
          : save.terrain,
      laserDry: copy(save.laserDry),
      moving: save.moving
        ? { count: save.moving.count, buffer: save.moving.buffer.slice(0) }
        : undefined,
      sections: save.sections?.map((section) => ({
        ...section,
        terrain: copy(section.terrain),
        dry: copy(section.dry),
      })),
    };
    if (message.moving) transfer.push(message.moving.buffer);
    const committed = this.request(
      { type: "write", epoch, save: message },
      transfer,
    );
    this.onPreparation?.(performance.now() - started);
    await committed;
  }
  async retire() {
    const epoch = ++this.epoch;
    await this.open();
    await this.request({ type: "retire", epoch });
  }
  private fail(error: Error) {
    this.closed = true;
    this.worker?.terminate();
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
  close() {
    this.fail(Error("Save writer closed"));
  }
}
