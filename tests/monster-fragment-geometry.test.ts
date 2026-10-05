import { expect, it } from "vitest";
import * as THREE from "three";
import {
  monsterBodyQuarter,
  monsterQuarterCaps,
} from "../src/render/monster-fragment-geometry";
const area = (source: THREE.BufferGeometry) => {
  const g = source.index ? source.toNonIndexed() : source,
    p = g.getAttribute("position");
  const a = new THREE.Vector3(),
    b = new THREE.Vector3(),
    c = new THREE.Vector3();
  let total = 0;
  for (let i = 0; i < p.count; i += 3) {
    a.fromBufferAttribute(p, i);
    b.fromBufferAttribute(p, i + 1);
    c.fromBufferAttribute(p, i + 2);
    total += b.sub(a).cross(c.sub(a)).length() / 2;
  }
  if (g !== source) g.dispose();
  return total;
};
it("partitions the textured fruit skin into four quarters without losing surface area", () => {
  const source = new THREE.SphereGeometry(1, 20, 16)
    .scale(9, 12, 8)
    .translate(0, 15, 0);
  let sum = 0;
  for (const left of [false, true])
    for (const upper of [false, true]) {
      const quarter = monsterBodyQuarter(source, left, upper);
      quarter.computeBoundingBox();
      expect(quarter.getAttribute("uv").count).toBe(
        quarter.getAttribute("position").count,
      );
      expect(
        [...quarter.getAttribute("normal").array].every(Number.isFinite),
      ).toBe(true);
      if (left) expect(quarter.boundingBox!.max.x).toBeLessThanOrEqual(0.00001);
      else expect(quarter.boundingBox!.min.x).toBeGreaterThanOrEqual(-0.00001);
      if (upper)
        expect(quarter.boundingBox!.min.y).toBeGreaterThanOrEqual(14.99999);
      else expect(quarter.boundingBox!.max.y).toBeLessThanOrEqual(15.00001);
      sum += area(quarter);
      quarter.dispose();
      const caps = monsterQuarterCaps(left, upper);
      expect(area(caps)).toBeGreaterThan(200);
      caps.dispose();
    }
  expect(sum).toBeCloseTo(area(source), 3);
  source.dispose();
});
