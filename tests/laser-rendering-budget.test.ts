import { expect, it } from "vitest";
import * as THREE from "three";
import { SpaceLaser } from "../src/render/space-laser";
import type { LaserStrike } from "../src/types";
it("bounds reduced laser embellishments while representing every distinct shaft", () => {
  const view = new SpaceLaser();
  view.reduced = true;
  const strikes: LaserStrike[] = Array.from({ length: 200 }, (_, id) => ({
    id,
    p: [id * 100, 20, 0],
    age: 5,
    phase: "burning",
  }));
  view.update(strikes, 1 / 60, 5, new THREE.Vector3(), () => -500);
  const v = view as any;
  expect(v.core.count).toBe(8);
  expect(v.distant.count).toBe(192);
  expect(v.aura.count).toBe(0);
  expect(v.rings.count).toBe(8);
  expect(v.core.count + v.distant.count).toBe(strikes.length);
  expect(v.distant.geometry.parameters.radialSegments).toBe(6);
  expect(strikes.every((l) => l.phase === "burning")).toBe(true);
  view.reset();
  expect(v.core.count + v.distant.count).toBe(0);
  view.group.traverse((o) => {
    const m = o as THREE.Mesh;
    m.geometry?.dispose();
    if (m.material)
      for (const a of Array.isArray(m.material) ? m.material : [m.material])
        a.dispose();
  });
});
