import { expect, it, vi } from "vitest";
import * as THREE from "three";
import { makeConcreteTruck } from "../src/render/concrete-truck";

// The truck paints its door logo on a canvas; any drawing call is a no-op here.
const context: any = new Proxy(
  {},
  {
    get: (_t, key) =>
      key === "measureText" ? () => ({ width: 10 }) : () => context,
    set: () => true,
  },
);
vi.stubGlobal("document", {
  createElement: () => ({ width: 0, height: 0, getContext: () => context }),
});

const floatMeshes = (group: THREE.Object3D) => {
  const found: THREE.Mesh[] = [];
  group.traverse((o) => {
    if (
      o instanceof THREE.Mesh &&
      (o.material as THREE.MeshStandardMaterial).color?.getHexString() ===
        "ff5a1f"
    )
      found.push(o);
  });
  return found;
};
const shown = (mesh: THREE.Object3D) => {
  for (let o: THREE.Object3D | null = mesh; o; o = o.parent)
    if (!o.visible) return false;
  return true;
};

it("pops two floats out on water and packs them away ashore", () => {
  const truck = makeConcreteTruck();
  const floats = floatMeshes(truck.group);
  expect(floats).toHaveLength(2);
  truck.update(0, 0, 1 / 60);
  expect(floats.some(shown)).toBe(false);

  truck.setAfloat(true);
  for (let i = 0; i < 120; i++) truck.update(0, 0, 1 / 60);
  expect(floats.every(shown)).toBe(true);
  // One float on each side of the truck, at full size.
  const xs = floats.map((f) => f.parent!.position.x).sort((a, b) => a - b);
  expect(xs[0]).toBeLessThan(-3);
  expect(xs[1]).toBeGreaterThan(3);
  expect(floats[0].parent!.scale.x).toBeCloseTo(1, 1);

  truck.setAfloat(false);
  for (let i = 0; i < 180; i++) truck.update(0, 0, 1 / 60);
  expect(floats.some(shown)).toBe(false);

  truck.setAfloat(true);
  for (let i = 0; i < 120; i++) truck.update(0, 0, 1 / 60);
  truck.reset();
  expect(floats.some(shown)).toBe(false);
});
