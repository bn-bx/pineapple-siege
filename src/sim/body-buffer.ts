import { PacketVector } from "./motion-buffer";
import type { BodyView, Material, PackedBodies } from "../types";

export const BODY_MATERIALS: Material[] = [
  "stone",
  "wood",
  "foliage",
  "earth",
  "rock",
  "plaster",
  "roof",
  "sandstone",
  "slate",
  "window",
];
const materials = BODY_MATERIALS;
const materialIds = new Map(materials.map((name, i) => [name, i]));
const kinds: BodyView["kind"][] = ["chunk", "tree", "rock"];

/** One transferable allocation: integer identity, float transforms, byte tags. */
export function packBodies(
  views: Iterable<BodyView>,
  count: number,
  reuse?: ArrayBuffer,
): PackedBodies {
  const buffer =
    reuse && reuse.byteLength >= count * 50
      ? reuse
      : new ArrayBuffer(count * 50);
  const identity = new Int32Array(buffer, 0, count * 2);
  const transforms = new Float32Array(buffer, count * 8, count * 10);
  const tags = new Uint8Array(buffer, count * 48, count * 2);
  let i = 0;
  for (const b of views) {
    identity[i * 2] = b.id;
    identity[i * 2 + 1] = b.source;
    const j = i * 10;
    transforms[j] = b.p[0];
    transforms[j + 1] = b.p[1];
    transforms[j + 2] = b.p[2];
    transforms[j + 3] = b.q[0];
    transforms[j + 4] = b.q[1];
    transforms[j + 5] = b.q[2];
    transforms[j + 6] = b.q[3];
    transforms[j + 7] = b.s[0];
    transforms[j + 8] = b.s[1];
    transforms[j + 9] = b.s[2];
    tags[i * 2] = materialIds.get(b.material)!;
    tags[i * 2 + 1] = kinds.indexOf(b.kind) | ((b.roofPart ?? 0) << 2);
    i++;
  }
  return { count, buffer };
}

export function unpackBodies({ count, buffer }: PackedBodies): BodyView[] {
  const identity = new Int32Array(buffer, 0, count * 2);
  const t = new Float32Array(buffer, count * 8, count * 10);
  const tags = new Uint8Array(buffer, count * 48, count * 2);
  const bodies = new Array<BodyView>(count);
  for (let i = 0; i < count; i++) {
    const j = i * 10;
    bodies[i] = {
      id: identity[i * 2],
      source: identity[i * 2 + 1],
      p: [t[j], t[j + 1], t[j + 2]],
      q: [t[j + 3], t[j + 4], t[j + 5], t[j + 6]],
      s: [t[j + 7], t[j + 8], t[j + 9]],
      material: materials[tags[i * 2]],
      kind: kinds[tags[i * 2 + 1] & 3],
      ...(tags[i * 2 + 1] >>> 2 ? { roofPart: tags[i * 2 + 1] >>> 2 } : {}),
    };
  }
  return bodies;
}

export interface BodyFrame {
  bodies: BodyView[];
  bodyPool: BodyView[];
}
export function bindBodies({ count, buffer }: PackedBodies, frame: BodyFrame) {
  const identity = new Int32Array(buffer, 0, count * 2),
    t = new Float32Array(buffer, count * 8, count * 10),
    tags = new Uint8Array(buffer, count * 48, count * 2);
  frame.bodies.length = count;
  for (let i = 0; i < count; i++) {
    let b = frame.bodyPool[i];
    if (!b)
      frame.bodyPool[i] = b = {
        id: 0,
        source: 0,
        kind: "chunk",
        material: "stone",
        p: new PacketVector(3) as unknown as BodyView["p"],
        q: new PacketVector(4) as unknown as BodyView["q"],
        s: new PacketVector(3) as unknown as BodyView["s"],
      };
    b.id = identity[i * 2];
    b.source = identity[i * 2 + 1];
    b.material = materials[tags[i * 2]];
    b.kind = kinds[tags[i * 2 + 1] & 3];
    b.roofPart = tags[i * 2 + 1] >>> 2 || undefined;
    (b.p as unknown as PacketVector).bind(t, i * 10);
    (b.q as unknown as PacketVector).bind(t, i * 10 + 3);
    (b.s as unknown as PacketVector).bind(t, i * 10 + 7);
    frame.bodies[i] = b;
  }
  return frame.bodies;
}

/** Reusable scalar reader for render loops; no per-piece vector wrappers. */
export class PackedBodyReader {
  identity!: Int32Array;
  transforms!: Float32Array;
  tags!: Uint8Array;
  private buffer?: ArrayBuffer;
  private count = -1;
  bind(packet: PackedBodies) {
    if (this.buffer === packet.buffer && this.count === packet.count) return;
    this.buffer = packet.buffer;
    this.count = packet.count;
    this.identity = new Int32Array(packet.buffer, 0, packet.count * 2);
    this.transforms = new Float32Array(
      packet.buffer,
      packet.count * 8,
      packet.count * 10,
    );
    this.tags = new Uint8Array(
      packet.buffer,
      packet.count * 48,
      packet.count * 2,
    );
  }
  read(i: number, b: BodyView) {
    const j = i * 10,
      t = this.transforms,
      tag = this.tags[i * 2 + 1];
    b.id = this.identity[i * 2];
    b.source = this.identity[i * 2 + 1];
    b.material = materials[this.tags[i * 2]];
    b.kind = kinds[tag & 3];
    b.roofPart = tag >>> 2 || undefined;
    b.p[0] = t[j];
    b.p[1] = t[j + 1];
    b.p[2] = t[j + 2];
    b.q[0] = t[j + 3];
    b.q[1] = t[j + 4];
    b.q[2] = t[j + 5];
    b.q[3] = t[j + 6];
    b.s[0] = t[j + 7];
    b.s[1] = t[j + 8];
    b.s[2] = t[j + 9];
    return b;
  }
}

/** Bounded by packet population, independent of monotonically increasing entity IDs. */
export class PackedBodyLookup {
  private keys = new Int32Array(0);
  private indices = new Uint32Array(0);
  private mask = 0;
  get capacity() {
    return this.indices.length;
  }
  build(packet: PackedBodies) {
    const needed = 2 ** Math.ceil(Math.log2(Math.max(2, packet.count * 2)));
    if (needed > this.indices.length) {
      this.keys = new Int32Array(needed);
      this.indices = new Uint32Array(needed);
      this.mask = needed - 1;
    } else this.indices.fill(0);
    const identity = new Int32Array(packet.buffer, 0, packet.count * 2);
    for (let i = 0; i < packet.count; i++) {
      const id = identity[i * 2];
      let slot = Math.imul(id, 0x9e3779b1) & this.mask;
      while (this.indices[slot] && this.keys[slot] !== id)
        slot = (slot + 1) & this.mask;
      this.keys[slot] = id;
      this.indices[slot] = i + 1;
    }
  }
  get(id: number) {
    let slot = Math.imul(id, 0x9e3779b1) & this.mask;
    while (this.indices[slot]) {
      if (this.keys[slot] === id) return this.indices[slot];
      slot = (slot + 1) & this.mask;
    }
    return 0;
  }
}
