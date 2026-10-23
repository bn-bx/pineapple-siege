import { expect, it } from "vitest";
import * as THREE from "three";
import { refineGod, reconnectGod } from "../src/world/refine-god.mjs";
import { statueShape } from "../src/world/statue-shapes.mjs";
import {
  statueGeometry,
  setEntityTransform,
  finishEntityTransform,
} from "../src/render/statue-geometry";
import type { Entity, Vec3, WorldData } from "../src/types";

it("upgrades cached statue owners into connected anatomy without changing their identities", () => {
  const site = {
    p: [0, 0, 0],
    yaw: 0,
  } as unknown as WorldData["sites"][number];
  const parts: Entity[] = [];
  const add = (
    shape: NonNullable<Entity["visual"]>["shape"],
    p: Vec3,
    size: Vec3,
    band = 0,
    azimuth = 0,
    role: "figure" | "eye" = "figure",
  ) => {
    parts.push({
      id: parts.length,
      kind: "block",
      p,
      s: [1, 1, 1],
      material: "stone",
      assembly: "god",
      supports: [],
      variant: 0,
      visual: {
        shape,
        size,
        band,
        azimuth,
        rotation: [0, 0, 0],
        offset: [0, 0, 0],
        role,
        color: "#cf9e38",
      },
    });
  };
  for (let band = 0; band < 6; band++)
    for (let sector = 0; sector < 12; sector++) {
      add(
        "pineapple",
        [0, 780, 0],
        [120, 145, 105],
        band,
        (sector * Math.PI) / 6,
      );
      add(
        "sector",
        [0, 440, -10],
        [200, 250, 150],
        band,
        (sector * Math.PI) / 6,
      );
    }
  for (const side of [-1, 1]) {
    add("ellipsoid", [side * 42, 810, 100], [31, 8, 9]);
    add("ellipsoid", [side * 65, 751, 94], [28, 24, 5]);
    add("box", [side * 42, 795, 104], [23, 5, 5], 0, 0, "eye");
  }
  add("ellipsoid", [0, 780, 108], [12, 30, 12]);
  add("ellipsoid", [0, 707, 92], [40, 18, 9]);
  add("box", [0, 728, 101], [34, 4, 5]);
  const ids = parts.map((e) => e.id);
  expect(refineGod(site, parts)).toBe(true);
  reconnectGod(parts);
  expect(parts.map((e) => e.id)).toEqual(ids);
  expect(parts.filter((e) => e.visual?.shape === "hero-head")).toHaveLength(72);
  expect(parts.filter((e) => e.visual?.shape === "hero-torso")).toHaveLength(
    72,
  );
  expect(parts.filter((e) => e.visual?.shape === "hero-neck")).toHaveLength(6);
  expect(parts.filter((e) => e.visual?.role === "eye")).toHaveLength(2);
  const mesh = new THREE.Object3D(),
    point = new THREE.Vector3();
  for (const e of parts) {
    const geometry = statueGeometry(e),
      vertices = geometry.getAttribute("position");
    setEntityTransform(mesh, e);
    finishEntityTransform(mesh, e);
    for (let i = 0; i < vertices.count; i++) {
      point.fromBufferAttribute(vertices, i).applyMatrix4(mesh.matrix);
      for (let k = 0; k < 3; k++)
        expect(Math.abs(point.getComponent(k) - e.p[k])).toBeLessThanOrEqual(
          e.s[k] + 0.001,
        );
    }
    expect(e.supports.length).toBeGreaterThan(0);
    geometry.dispose();
  }
  const upgraded = structuredClone(parts);
  expect(refineGod(site, parts)).toBe(false);
  expect(parts).toEqual(upgraded);
});
it("keeps neighboring facial sectors joined at exactly the same surface boundaries", () => {
  // Every consecutive sector has the same boundary surface vertices, not a
  // renderer-only distortion clipped independently to rectangular owner bounds.
  for (let band = 0; band < 6; band++) {
    const a = statueShape("hero-head", band, 0),
      b = statueShape("hero-head", band, Math.PI / 6);
    const onBoundary = (v: number[], azimuth: number) => {
      const found = new Set<string>();
      for (let i = 0; i < v.length; i += 3) {
        const x = v[i] * Math.cos(azimuth) + v[i + 2] * Math.sin(azimuth),
          z = -v[i] * Math.sin(azimuth) + v[i + 2] * Math.cos(azimuth);
        if (z > 0 && Math.abs(Math.atan2(x, z) - Math.PI / 12) < 1e-6)
          found.add([x, v[i + 1], z].map((n) => n.toFixed(6)).join(","));
      }
      return found;
    };
    expect([...onBoundary(a, 0)].sort()).toEqual(
      [...onBoundary(b, Math.PI / 6)].sort(),
    );
  }
});
