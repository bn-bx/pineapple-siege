import type { SaveSnapshot } from "./types";

/** Ownership follows the task, so an obsolete finally cannot clear a newer save. */
export class SaveCaptureCoordinator {
  private owner = 0;
  private active?: number;
  private nextRequest = 0;
  private pending = new Map<
    number,
    { resolve: (save: SaveSnapshot) => void; reject: (error: Error) => void }
  >();
  get saving() {
    return this.active !== undefined;
  }
  get pendingCount() {
    return this.pending.size;
  }
  begin() {
    if (this.saving) throw Error("A save is already running");
    return (this.active = ++this.owner);
  }
  finish(owner: number) {
    if (this.active === owner) this.active = undefined;
  }
  request(send: (request: number) => void) {
    return new Promise<SaveSnapshot>((resolve, reject) => {
      const request = ++this.nextRequest;
      this.pending.set(request, { resolve, reject });
      try {
        send(request);
      } catch (error) {
        this.pending.delete(request);
        reject(error);
      }
    });
  }
  deliver(request: number, save: SaveSnapshot) {
    const waiter = this.pending.get(request);
    if (!waiter) return false;
    this.pending.delete(request);
    waiter.resolve(save);
    return true;
  }
  retire() {
    this.active = undefined;
    for (const waiter of this.pending.values())
      waiter.reject(Error("Island changed during save capture"));
    this.pending.clear();
  }
}
