import * as THREE from "three";
import { afterEach, describe, expect, it } from "vitest";
import { christmas, christmasMode, setChristmasMode } from "../src/christmas";
import { SnowCover } from "../src/render/christmas/snow-cover";
import { ChristmasLights } from "../src/render/christmas/christmas-lights";
import { ChristmasWorld } from "../src/render/christmas/christmas-world";
import { FestiveParticles } from "../src/render/christmas/festive-particles";
import { EnvironmentLighting } from "../src/render/environment-lighting";
import type { Entity, Explosion, WorldData } from "../src/types";

afterEach(() => setChristmasMode("off"));

const block = (id: number, p: [number, number, number], s: [number, number, number], material: Entity["material"]): Entity => ({
  id,
  kind: "block",
  p,
  s,
  material,
  assembly: "a",
  foundation: false,
  supports: [],
  variant: 0.5,
});

function world(entities: Entity[]): WorldData {
  return {
    version: 13,
    seed: 1,
    size: 2000,
    step: 2,
    grid: 1000,
    chunkSize: 64,
    castle: [1000, 10, 1000],
    castleBounds: { min: [0, 0], max: [0, 0] },
    landmarks: { gate: [0, 0, 0], keep: [0, 0, 0], towers: [] },
    banners: [],
    bridge: [0, 0],
    spawn: [900, 100, 900],
    paths: [],
    lights: [],
    structureCount: 0,
    castleCount: 0,
    sites: [
      {
        id: "town",
        kind: "hamlet",
        town: true,
        p: [1000, 10, 1000],
        radius: 60,
        bounds: { min: [940, 940], max: [1060, 1060] },
        assemblies: ["a"],
      },
    ],
    lakes: [
      {
        id: "lake",
        center: [1400, 1400],
        radius: 50,
        level: 8,
        outline: [
          [1350, 1400],
          [1400, 1350],
          [1450, 1400],
          [1400, 1450],
        ],
        outlet: [1450, 8, 1400],
        riverId: "r",
      },
    ],
    entities,
  };
}

const flat = { sample: () => 10, waterSurface: () => undefined };

describe("Christmas", () => {
  it("is off without browser storage and switches on for the session", () => {
    expect(christmas()).toBe(false);
    setChristmasMode("sleigh");
    expect(christmas()).toBe(true);
    expect(christmasMode()).toBe("sleigh");
  });

  it("snows only on materials that opt in, once each", () => {
    const snow = new SnowCover();
    const roof = new THREE.MeshStandardMaterial();
    roof.userData.snowSlope = 0.22;
    const jet = new THREE.MeshStandardMaterial();
    snow.install(roof);
    snow.install(roof);
    snow.install(jet);
    expect(roof.customProgramCacheKey()).toContain("snow-cover-v2:0.220");
    expect(jet.customProgramCacheKey()).not.toContain("snow-cover");
    const shader = {
      uniforms: {},
      vertexShader: THREE.ShaderLib.physical.vertexShader,
      fragmentShader: THREE.ShaderLib.physical.fragmentShader,
    } as unknown as THREE.WebGLProgramParametersWithUniforms;
    roof.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    expect(shader.vertexShader).toContain("vSnowWorld =");
    expect(shader.fragmentShader.match(/snowAmount > \.001/g)).toHaveLength(1);
    expect(shader.uniforms).toHaveProperty("snowMelt");
  });

  it("feeds the nearest fires to the melt slots", () => {
    const snow = new SnowCover();
    const fires = Array.from({ length: 12 }, (_, i) => ({ p: [i * 100, 0, 0], radius: 5 + i }));
    snow.setMelt([], fires, new THREE.Vector3(0, 0, 0));
    const slots = snow.uniforms.snowMelt.value;
    expect(slots[0].z).toBe(5);
    expect(slots.every((s) => s.z > 0 && s.z < 13)).toBe(true);
    snow.setMelt([], [], new THREE.Vector3());
    expect(slots.every((s) => s.z === 0)).toBe(true);
  });

  it("keeps a nuke's melt patch however many fires burn nearer the camera", () => {
    const snow = new SnowCover();
    const nuke = { p: [5000, 0, 5000], radius: 400 };
    // Fires inside the patch, plus more near the camera than there are slots.
    const fires = [
      ...Array.from({ length: 20 }, (_, i) => ({ p: [5000 + i * 5, 0, 5000], radius: 8 })),
      ...Array.from({ length: 20 }, (_, i) => ({ p: [i * 10, 0, 0], radius: 8 })),
    ];
    for (let frame = 0; frame < 3; frame++) {
      snow.setMelt([nuke], fires, new THREE.Vector3(0, 0, 0));
      const slots = snow.uniforms.snowMelt.value;
      expect(slots[0].toArray()).toEqual([5000, 5000, 400, 0]);
      // Fires in the patch never take a slot.
      expect(slots.slice(1).every((s) => s.x < 1000)).toBe(true);
    }
  });

  it("strings lights on roof eaves and drops a destroyed roof's string", () => {
    const lights = new ChristmasLights([
      block(1, [0, 10, 0], [4, 2, 3], "roof"),
      block(2, [50, 10, 0], [4, 2, 3], "slate"),
      block(3, [90, 5, 0], [4, 4, 4], "stone"),
    ]);
    lights.update(1, 0, 0, new Set(), 800);
    const both = lights.count;
    expect(both).toBeGreaterThan(8);
    expect(lights.points.visible).toBe(true);
    lights.update(1, 0, 0, new Set([2]), 800);
    expect(lights.count).toBe(both / 2);
    const y = lights.points.geometry.getAttribute("position").getY(0);
    expect(y).toBeLessThan(8);
    lights.update(0, 0, 0, new Set([2]), 800);
    expect(lights.points.visible).toBe(false);
  });

  it("raises a town tree that a blast knocks over, and shatters lake ice", () => {
    const particles = new FestiveParticles();
    const xmas = new ChristmasWorld(world([]), flat, particles);
    const tree = xmas.group.getObjectByName("christmas-tree")!;
    const ice = xmas.group.getObjectByName("lake-ice")!;
    expect(tree).toBeDefined();
    expect(xmas.group.getObjectsByProperty("name", "snowman").length).toBeGreaterThan(0);
    expect(ice.visible).toBe(true);
    const blast = (p: [number, number, number]): Explosion => ({
      type: "explosion",
      p,
      water: false,
      power: 1,
      seed: 1,
      kind: "blast",
    });
    xmas.explosion(blast([tree.position.x + 5, 10, tree.position.z]));
    for (let i = 0; i < 30; i++) xmas.update(0.1, i * 0.1, undefined, new Set(), 800);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(tree.quaternion);
    expect(up.y).toBeLessThan(0.1);
    // The star came off and rolled away from the fallen tree.
    expect(tree.getObjectByName("star")).toBeUndefined();
    xmas.explosion(blast([1400, 9, 1400]));
    expect(ice.visible).toBe(false);
    particles.update(0.1, 0, 800);
    expect(particles.points.visible).toBe(true);
  });

  it("lowers the winter sun", () => {
    const summer = new EnvironmentLighting(),
      winter = new EnvironmentLighting();
    winter.winter = true;
    summer.update(12);
    winter.update(12);
    expect(winter.sunDirection.y).toBeLessThan(summer.sunDirection.y - 0.2);
  });
});
