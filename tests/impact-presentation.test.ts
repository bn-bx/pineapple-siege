import { expect, it, vi } from "vitest";
import * as THREE from "three";
import { voiceReplacement } from "../src/audio-priority";
import { sceneResources } from "../src/render/resource-budget";
import { GroundDust, impactDustProfile, impactTint } from "../src/render/dust";
import {
  explosionFlashStyle,
  explosionParticleTint,
} from "../src/render/explosion-palette";
import { Fragments } from "../src/render/fragments";
it.each(["wood", "roof", "slate", "window", "foliage"] as const)(
  "settles %s chips on their thin face above canonical ground",
  (material) => {
    const fragments = new Fragments(() => 10);
    fragments.emit({
      type: "fragments",
      p: [0, 11, 0],
      origin: [0, 11, 0],
      material,
      seed: 2,
      count: 1,
      speed: 0,
      spread: 0,
    });
    for (let i = 0; i < 120; i++) fragments.update(1 / 60);
    const matrix = new THREE.Matrix4();
    fragments.mesh.getMatrixAt(0, matrix);
    const halfHeight =
      (Math.abs(matrix.elements[1]) +
        Math.abs(matrix.elements[5]) +
        Math.abs(matrix.elements[9])) *
      0.5;
    expect(matrix.elements[13] - halfHeight).toBeCloseTo(10, 4);
    fragments.mesh.geometry.dispose();
    (fragments.mesh.material as THREE.Material).dispose();
  },
);

it("keeps important audible voices and reevaluates distance after flight", () => {
  const voices = [
    { p: [0, 0, 0] as [number, number, number], gain: 0.2, priority: 3 },
    { p: [1000, 0, 0] as [number, number, number], gain: 0.2, priority: 3 },
  ];
  expect(
    voiceReplacement(
      voices,
      { p: [2000, 0, 0], gain: 0.03, priority: 1 },
      [0, 0, 0],
      2,
    ),
  ).toBe(-1);
  expect(
    voiceReplacement(
      voices,
      { p: [1000, 0, 0], gain: 0.2, priority: 3 },
      [1000, 0, 0],
      2,
    ),
  ).toBe(0);
  expect(
    voiceReplacement([], { p: [0, 0, 0], gain: 1, priority: 1 }, [0, 0, 0], 0),
  ).toBe(-1);
});
it("uses distinct fixed-pool plume colors for rubble, crash, impact, and nuke events", () => {
  expect(explosionParticleTint("blast", false, 0)).toBe("#ffd987");
  expect(explosionParticleTint("collapse", false, 0)).toBe("#c8c0b4");
  expect(explosionParticleTint("crash", false, 0)).toBe("#ffe6ad");
  expect(explosionParticleTint("impact", false, 0)).toBe("#c0ad8e");
  expect(explosionParticleTint("nuke", false, 0)).toBe("#fff0bd");
  for (const kind of ["blast", "collapse", "crash", "impact", "nuke"] as const)
    expect(explosionParticleTint(kind, true, 0)).toBe("#d8efed");
  expect(explosionParticleTint("collapse", false, 0)).not.toBe(
    explosionParticleTint("crash", false, 0),
  );
});
it("sizes and tones blast flashes for the event instead of reusing one land flash", () => {
  expect(explosionFlashStyle("blast", false)).toMatchObject({
    color: "#ffe198",
    radius: 12,
    intensity: 0.7,
  });
  expect(explosionFlashStyle("collapse", false)).toMatchObject({
    color: "#d0c5b2",
    radius: 8,
  });
  expect(explosionFlashStyle("crash", false)).toMatchObject({
    color: "#fff0dc",
    radius: 9,
  });
  expect(explosionFlashStyle("nuke", false, 240).radius).toBe(150);
  expect(explosionFlashStyle("impact", true).color).toBe("#bfebeb");
});
it("counts interleaved vertex storage once and includes each instance buffer", () => {
  const scene = new THREE.Scene(),
    geometry = new THREE.BufferGeometry();
  const data = new THREE.InterleavedBuffer(new Float32Array(12), 6);
  geometry.setAttribute(
    "position",
    new THREE.InterleavedBufferAttribute(data, 3, 0),
  );
  geometry.setAttribute(
    "normal",
    new THREE.InterleavedBufferAttribute(data, 3, 3),
  );
  const a = new THREE.InstancedMesh(geometry, new THREE.MeshBasicMaterial(), 2),
    b = new THREE.InstancedMesh(geometry, a.material, 1);
  scene.add(a, b);
  a.setColorAt(0, new THREE.Color());
  expect(sceneResources(scene).geometryBytes).toBe(
    data.array.byteLength +
      a.instanceMatrix.array.byteLength +
      b.instanceMatrix.array.byteLength +
      a.instanceColor!.array.byteLength,
  );
});
it("anchors wall impacts to their surface while ground plumes follow excavation", () => {
  vi.stubGlobal("document", {
    createElement: () => ({
      getContext: () => ({
        createRadialGradient: () => ({ addColorStop() {} }),
        fillRect() {},
      }),
    }),
  });
  try {
    const dust = new GroundDust(),
      camera = new THREE.PerspectiveCamera(),
      matrix = new THREE.Matrix4();
    dust.impact(
      {
        type: "fragments",
        p: [5, 30, 5],
        origin: [5, 30, 5],
        material: "wood",
        seed: 1,
        count: 8,
        speed: 1,
        spread: 0,
      },
      false,
      1,
    );
    dust.update(0.5, camera, () => -100);
    dust.mesh.getMatrixAt(0, matrix);
    expect(matrix.elements[13]).toBeGreaterThanOrEqual(30);
    dust.reset();
    dust.emit(
      {
        type: "explosion",
        p: [5, 10, 5],
        water: false,
        power: 1,
        seed: 1,
        kind: "blast",
      },
      true,
      () => 10,
    );
    dust.update(0.5, camera, () => 3);
    dust.mesh.getMatrixAt(1, matrix);
    expect(matrix.elements[13]).toBeGreaterThan(3);
    expect(matrix.elements[13]).toBeLessThan(10);
    expect(impactTint("wood")).toBe(impactTint("stone"));
  } finally {
    vi.unstubAllGlobals();
  }
});
it("shares a bounded dust profile across construction materials", () => {
  for (const material of ["wood", "foliage", "window", "rock"] as const) {
    expect(impactDustProfile(material)).toEqual(impactDustProfile("stone"));
    expect(impactTint(material)).toBe(impactTint("stone"));
  }
});
it("adds a grounded expanding water ring and retires it after the splash", () => {
  vi.stubGlobal("document", {
    createElement: () => ({
      getContext: () => ({
        createRadialGradient: () => ({ addColorStop() {} }),
        fillRect() {},
      }),
    }),
  });
  try {
    const dust = new GroundDust(),
      camera = new THREE.PerspectiveCamera(),
      matrix = new THREE.Matrix4();
    dust.emit(
      {
        type: "explosion",
        p: [5, 0.04, 5],
        water: true,
        power: 1,
        seed: 3,
        kind: "impact",
      },
      false,
      () => 0,
    );
    dust.update(0.25, camera, () => 0);
    expect(dust.ripples.count).toBe(1);
    dust.ripples.getMatrixAt(0, matrix);
    expect(matrix.elements[13]).toBeCloseTo(0.24, 4);
    expect(matrix.elements[0]).toBeGreaterThan(0.2);
    dust.update(2, camera, () => 0);
    expect(dust.ripples.count).toBe(0);
    expect(dust.ripples.visible).toBe(false);
  } finally {
    vi.unstubAllGlobals();
  }
});
it("keeps reduced-effects splashes visible at a smaller radius", () => {
  vi.stubGlobal("document", {
    createElement: () => ({
      getContext: () => ({
        createRadialGradient: () => ({ addColorStop() {} }),
        fillRect() {},
      }),
    }),
  });
  try {
    const normal = new GroundDust(),
      reduced = new GroundDust(),
      camera = new THREE.PerspectiveCamera(),
      normalMatrix = new THREE.Matrix4(),
      reducedMatrix = new THREE.Matrix4(),
      event = {
        type: "explosion",
        p: [5, 0.04, 5] as [number, number, number],
        water: true,
        power: 1,
        seed: 4,
        kind: "impact" as const,
      };
    normal.emit(event, false, () => 0);
    reduced.emit(event, true, () => 0);
    normal.update(0.625, camera, () => 0);
    reduced.update(0.45, camera, () => 0);
    normal.ripples.getMatrixAt(0, normalMatrix);
    reduced.ripples.getMatrixAt(0, reducedMatrix);
    expect(normal.ripples.count).toBe(1);
    expect(reduced.ripples.count).toBe(1);
    expect(normalMatrix.elements[0]).toBeGreaterThan(reducedMatrix.elements[0]);
  } finally {
    vi.unstubAllGlobals();
  }
});
it("bounds repeated water splash rings to their fixed 64-instance pool", () => {
  vi.stubGlobal("document", {
    createElement: () => ({
      getContext: () => ({
        createRadialGradient: () => ({ addColorStop() {} }),
        fillRect() {},
      }),
    }),
  });
  try {
    const dust = new GroundDust(),
      camera = new THREE.PerspectiveCamera();
    for (let seed = 0; seed < 80; seed++)
      dust.emit(
        {
          type: "explosion",
          p: [seed, 0.04, seed],
          water: true,
          power: 1,
          seed,
          kind: "impact",
        },
        true,
        () => 0,
      );
    dust.update(0.1, camera, () => 0);
    expect(dust.ripples.count).toBe(64);
    dust.reset();
    expect(dust.ripples.count).toBe(0);
    expect(dust.ripples.visible).toBe(false);
  } finally {
    vi.unstubAllGlobals();
  }
});
it("retains expired particle uploads while hidden and clears the full pool on reset", async () => {
  vi.stubGlobal("document", {
    createElement: () => ({
      getContext: () => ({
        createRadialGradient: () => ({ addColorStop() {} }),
        fillRect() {},
      }),
    }),
  });
  try {
    const { Effects } = await import("../src/render/effects");
    const effects = new Effects();
    const points = effects.group.children.find(
      (object) => object instanceof THREE.Points,
    ) as THREE.Points;
    const position = points.geometry.attributes
      .position as THREE.BufferAttribute;
    effects.trail([5, 30, 5], [0, 0, 0]);
    effects.update(0.1);
    position.clearUpdateRanges(); // The renderer completed the first upload.
    effects.update(0.3);
    expect(points.visible).toBe(false);
    expect(position.getY(0)).toBe(-100000);
    effects.trail([7, 40, 7], [0, 0, 0]);
    effects.update(0.01);
    expect(position.updateRanges.some((range) => range.start === 0)).toBe(true);
    effects.reset();
    expect(position.updateRanges).toEqual([
      { start: 0, count: position.count * 3 },
    ]);
  } finally {
    vi.unstubAllGlobals();
  }
});
