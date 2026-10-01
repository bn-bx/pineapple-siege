import type { BodyView, Material, PackedBodies } from "../types";

const materials: Material[] = [
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
const materialIds = new Map(materials.map((name, i) => [name, i]));
const kinds: BodyView["kind"][] = ["chunk", "tree", "rock"];

/** One transferable allocation: integer identity, float transforms, byte tags. */
export function packBodies(
  views: Iterable<BodyView>,
  count: number,
): PackedBodies {
  const buffer = new ArrayBuffer(count * 50);
  const identity = new Int32Array(buffer, 0, count * 2);
  const transforms = new Float32Array(buffer, count * 8, count * 10);
  const tags = new Uint8Array(buffer, count * 48, count * 2);
  let i = 0;
  for (const b of views) {
    identity[i * 2] = b.id;
    identity[i * 2 + 1] = b.source;
    transforms.set(b.p, i * 10);
    transforms.set(b.q, i * 10 + 3);
    transforms.set(b.s, i * 10 + 7);
    tags[i * 2] = materialIds.get(b.material)!;
    tags[i * 2 + 1] = kinds.indexOf(b.kind);
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
      kind: kinds[tags[i * 2 + 1]],
    };
  }
  return bodies;
}
