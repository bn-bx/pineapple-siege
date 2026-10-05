import { expect, it } from "vitest";
import { BodyPoseCache, DebrisMap } from "../src/sim/body-pose-cache";
import { packBodies, unpackBodies } from "../src/sim/body-buffer";
import type { BodyView } from "../src/types";
const view = (id: number): BodyView => ({
  id,
  source: id % 4,
  p: [id / 3, 20, -id / 7],
  q: [0, 0.2, 0, 0.98],
  s: [1, 2, 3],
  kind: id % 3 === 1 ? "tree" : id % 3 === 2 ? "rock" : "chunk",
  material: id % 5 === 0 ? "roof" : "wood",
  roofPart: id % 5 === 0 ? (id % 4) + 1 : undefined,
});
it("matches existing packet encoding through growth, motion, deletion and buffer reuse", () => {
  const cache = new BodyPoseCache();
  const map = new DebrisMap<{ view: BodyView }>(cache);
  for (let id = 0; id < 1200; id++) map.set(id, { view: view(id) });
  const first = cache.pack();
  const frozen = new Uint8Array(first.buffer).slice();
  for (let id = 0; id < 1200; id++) {
    if (id % 4 === 0) map.delete(id);
    else {
      const b = map.get(id)!.view;
      b.p[0] += 13;
      b.q[0] = 0.1;
      b.s[2] = 4;
      cache.update(b);
    }
  }
  expect(new Uint8Array(first.buffer)).toEqual(frozen);
  const expected = packBodies(cache.views(), cache.size);
  const packet = cache.pack(first.buffer);
  expect(packet.buffer).toBe(first.buffer);
  expect(unpackBodies(packet)).toEqual(unpackBodies(expected));
  expect(new Set(unpackBodies(packet).map((body) => body.id)).size).toBe(
    map.size,
  );
  expect([...cache.views()].every((b) => b.p === map.get(b.id)!.view.p)).toBe(
    true,
  );
  map.clear();
  expect(cache.size).toBe(0);
  cache.dispose();
  expect(cache.capacity).toBe(0);
});
it("retains source, species identity and pose through rigid-to-ballistic membership handoff", () => {
  const cache = new BodyPoseCache();
  const rigid = new DebrisMap<{ view: BodyView }>(cache),
    ballistic = new DebrisMap<{ view: BodyView }>(cache);
  const tree = view(13),
    roof = view(20);
  rigid.set(tree.id, { view: tree });
  ballistic.set(roof.id, { view: roof });
  rigid.delete(tree.id);
  ballistic.set(tree.id, { view: tree });
  expect(cache.size).toBe(2);
  const before = unpackBodies(cache.pack());
  expect(before.find((b) => b.id === tree.id)?.source).toBe(tree.source);
  expect(before.find((b) => b.id === tree.id)?.kind).toBe("tree");
  ballistic.delete(roof.id);
  expect(unpackBodies(cache.pack())).toEqual(
    before.filter((b) => b.id !== roof.id),
  );
  rigid.clear();
  expect(cache.size).toBe(1);
  ballistic.clear();
  expect(cache.size).toBe(0);
});
