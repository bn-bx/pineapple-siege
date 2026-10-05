import { BODY_MATERIALS } from "./body-buffer";
import type { BodyView, PackedBodies } from "../types";
const materials = new Map(
  BODY_MATERIALS.map((material, index) => [material, index]),
);
/** Simulation-owned dense poses. Packets retain the existing 50-byte layout. */
export class BodyPoseCache {
  private slots = new Map<number, number>();
  private identity = new Int32Array();
  private transforms = new Float32Array();
  private tags = new Uint8Array();
  private records: BodyView[] = [];
  *views() {
    for (const view of this.records) yield view;
  }
  get size() {
    return this.slots.size;
  }
  get capacity() {
    return this.identity.length / 2;
  }
  set(view: BodyView) {
    let index = this.slots.get(view.id);
    if (index === undefined) {
      index = this.slots.size;
      if (index === this.capacity) {
        const capacity = Math.max(256, this.capacity * 2);
        const identity = new Int32Array(capacity * 2),
          transforms = new Float32Array(capacity * 10),
          tags = new Uint8Array(capacity * 2);
        identity.set(this.identity);
        transforms.set(this.transforms);
        tags.set(this.tags);
        this.identity = identity;
        this.transforms = transforms;
        this.tags = tags;
      }
      this.slots.set(view.id, index);
    }
    this.records[index] = view;
    this.identity[index * 2] = view.id;
    this.identity[index * 2 + 1] = view.source;
    this.tags[index * 2] = materials.get(view.material)!;
    this.tags[index * 2 + 1] =
      (view.kind === "tree" ? 1 : view.kind === "rock" ? 2 : 0) |
      ((view.roofPart ?? 0) << 2);
    this.update(view);
  }
  update(view: BodyView) {
    const index = this.slots.get(view.id);
    if (index === undefined) return;
    const j = index * 10,
      data = this.transforms;
    data[j] = view.p[0];
    data[j + 1] = view.p[1];
    data[j + 2] = view.p[2];
    data[j + 3] = view.q[0];
    data[j + 4] = view.q[1];
    data[j + 5] = view.q[2];
    data[j + 6] = view.q[3];
    data[j + 7] = view.s[0];
    data[j + 8] = view.s[1];
    data[j + 9] = view.s[2];
  }
  delete(id: number) {
    const index = this.slots.get(id);
    if (index === undefined) return;
    const last = this.slots.size - 1;
    if (index !== last) {
      this.identity.copyWithin(index * 2, last * 2, last * 2 + 2);
      this.transforms.copyWithin(index * 10, last * 10, last * 10 + 10);
      this.tags.copyWithin(index * 2, last * 2, last * 2 + 2);
      this.slots.set(this.identity[index * 2], index);
      this.records[index] = this.records[last];
    }
    this.records.pop();
    this.slots.delete(id);
  }
  pack(reuse?: ArrayBuffer): PackedBodies {
    const count = this.size,
      bytes = count * 50;
    const buffer =
      reuse && reuse.byteLength >= bytes ? reuse : new ArrayBuffer(bytes);
    new Int32Array(buffer, 0, count * 2).set(
      this.identity.subarray(0, count * 2),
    );
    new Float32Array(buffer, count * 8, count * 10).set(
      this.transforms.subarray(0, count * 10),
    );
    new Uint8Array(buffer, count * 48, count * 2).set(
      this.tags.subarray(0, count * 2),
    );
    return { count, buffer };
  }
  dispose() {
    this.records.length = 0;
    this.slots.clear();
    this.identity = new Int32Array();
    this.transforms = new Float32Array();
    this.tags = new Uint8Array();
  }
}
/** Membership changes, including rigid-to-ballistic handoff, repair dense slots. */
export class DebrisMap<T extends { view: BodyView }> extends Map<number, T> {
  constructor(private poses: BodyPoseCache) {
    super();
  }
  set(id: number, value: T) {
    super.set(id, value);
    this.poses.set(value.view);
    return this;
  }
  delete(id: number) {
    const removed = super.delete(id);
    if (removed) this.poses.delete(id);
    return removed;
  }
  clear() {
    for (const id of this.keys()) this.poses.delete(id);
    super.clear();
  }
}
