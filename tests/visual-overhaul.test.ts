import { expect, it, vi } from "vitest";
import * as THREE from "three";
import { textureBytes, sceneResources } from "../src/render/resource-budget";
import { qualityProfile, VISUAL_BUDGET } from "../src/render/quality-profile";
import { SimulationCadence } from "../src/simulation-cadence";
import { installFractureSurface } from "../src/render/fracture-surface";
import { CONFIG } from "../src/config";
it("estimates shared and detached resident resources once, including shader textures", () => {
  const texture = new THREE.DataTexture(new Uint8Array(64), 4, 4);
  texture.generateMipmaps = false;
  const scene = new THREE.Scene(),
    geometry = new THREE.BoxGeometry();
  scene.add(
    new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ map: texture })),
    new THREE.Mesh(
      geometry,
      new THREE.ShaderMaterial({ uniforms: { shared: { value: texture } } }),
    ),
  );
  expect(textureBytes(texture)).toBe(64);
  expect(sceneResources(scene, [texture, texture]).residentTextureBytes).toBe(
    64,
  );
  expect(sceneResources(scene).geometryBytes).toBeGreaterThan(0);
  expect(VISUAL_BUDGET.targetBytes).toBe(64 * 1048576);
});
it("preserves fixed quality selections and reduces cosmetic features without changing gameplay", () => {
  const high = qualityProfile("1080", 4),
    low = qualityProfile("auto", 4);
  expect(high.height).toBe(1080);
  expect(high.ambientOcclusion).toBe(true);
  expect(low.height).toBe(720);
  expect(low.foliageDistance).toBeLessThanOrEqual(120);
  expect(low.nearFoliageDistance).toBe(0);
  expect(high.nearFoliageDistance).toBeGreaterThan(0);
  expect(low.bloom).toBe(false);
  expect(low.debrisShadows).toBe(false);
  expect(high.debrisShadows).toBe(true);
  expect(low.cosmetics).toBeLessThan(high.cosmetics);
});
it("measures sustained simulation speed and discards paused/reset wall time", () => {
  const cadence = new SimulationCadence();
  cadence.sample(0, 0, true);
  expect(cadence.sample(5000, 5, true)).toBe(1);
  expect(cadence.sample(10000, 9, true)).toBeCloseTo(0.8);
  cadence.sample(20000, 9, false);
  cadence.sample(25000, 9, true);
  expect(cadence.sample(30000, 14, true)).toBe(1);
  cadence.sample(31000, 0, true);
  expect(cadence.sample(36000, 5, true)).toBe(1);
});
it("retains fracture cut-face semantics and all surface-map UV channels", () => {
  const material = new THREE.MeshStandardMaterial();
  installFractureSurface(material);
  const shader = {
    uniforms: {},
    vertexShader: "#include <common>\n#include <uv_vertex>",
    fragmentShader: "#include <common>\n#include <map_fragment>",
  } as THREE.WebGLProgramParametersWithUniforms;
  material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
  expect(shader.vertexShader).toContain("vExposedCut=step(.5,uv.x)");
  for (const channel of [
    "vMapUv",
    "vNormalMapUv",
    "vRoughnessMapUv",
    "vAoMapUv",
  ])
    expect(shader.vertexShader).toContain(`${channel}.x=fract`);
  expect(shader.fragmentShader).toContain("vExposedCut");
});
it.each(["tree", "rock"])(
  "removes %s-owned ground dressing and suppresses it after excavation",
  async (kind) => {
    const { Scenery } = await import("../src/render/scenery");
    let height = 10;
    const world = {
      paths: [],
      entities: [
        {
          id: 3,
          kind,
          p: [100, 20, 100],
          s: [4, 10, 4],
          material: "foliage",
          treeSpecies: "pine",
          variant: 0.5,
          assembly: "forest",
          foundation: false,
          supports: [],
        },
      ],
    } as any;
    const terrain = { sample: () => height } as any,
      materials = {
        wood: new THREE.MeshStandardMaterial(),
        rock: new THREE.MeshStandardMaterial(),
      };
    const scenery = new Scenery(world, terrain, materials),
      camera = new THREE.Vector3(100, 20, 100),
      removed = new Set<number>();
    scenery.update(camera, removed, 1200, 120, 0, true);
    expect(
      scenery.group.children.some((o) => (o as THREE.InstancedMesh).count > 0),
    ).toBe(true);
    removed.add(3);
    scenery.update(camera, removed, 1200, 120, 1, true);
    expect(
      scenery.group.children.every(
        (o) => (o as THREE.InstancedMesh).count === 0,
      ),
    ).toBe(true);
    removed.clear();
    height = -30;
    scenery.update(camera, removed, 1200, 120, 2, true);
    expect(
      scenery.group.children.every(
        (o) => (o as THREE.InstancedMesh).count === 0,
      ),
    ).toBe(true);
  },
);
it("keeps farm crop beds clear of wet ground and tied to a building owner", async () => {
  const { Scenery } = await import("../src/render/scenery");
  const owner = {
    id: 10,
    kind: "block",
    p: [100, 10, 100],
    s: [8, 5, 12],
    material: "wood",
    assembly: "landmark-farm-0-barn",
    foundation: true,
    supports: [],
  };
  const terrain = {
    flood: new Uint8Array(CONFIG.grid * CONFIG.grid),
    sample: () => 10,
  } as any;
  const materials = {
    wood: new THREE.MeshStandardMaterial(),
    rock: new THREE.MeshStandardMaterial(),
    earth: new THREE.MeshStandardMaterial(),
    foliage: new THREE.MeshStandardMaterial(),
  };
  const scenery = new Scenery(
      { paths: [], entities: [owner] } as any,
      terrain,
      materials,
    ),
    camera = new THREE.Vector3(100, 20, 66),
    cropBatch = () =>
      scenery.group.children.find(
        (object) => object.name === "scenery:farm-crops",
      ) as THREE.InstancedMesh | undefined;
  scenery.update(camera, new Set(), 1200, 120, 0, true);
  expect(cropBatch()?.count).toBeGreaterThan(0);
  const beds = scenery.group.children.find(
    (object) => object.name === "scenery:farm-beds",
  ) as THREE.InstancedMesh | undefined;
  expect(beds?.count).toBeGreaterThan(0);
  const ownedCropCount = cropBatch()!.count;
  for (let z = 56; z <= 80; z += CONFIG.spacing)
    for (let x = 80; x <= 120; x += CONFIG.spacing)
      terrain.flood[
        Math.round(z / CONFIG.spacing) * CONFIG.grid +
          Math.round(x / CONFIG.spacing)
      ] = 1;
  scenery.update(camera, new Set(), 1200, 120, 1, true);
  expect(cropBatch()?.count).toBe(0);
  expect(beds?.count).toBe(0);
  terrain.flood.fill(0);
  const removed = new Set([owner.id]);
  scenery.update(camera, removed, 1200, 120, 2, true);
  expect(cropBatch()?.count).toBe(0);
  expect(beds?.count).toBe(0);
  expect(ownedCropCount).toBeGreaterThan(10);
});
it("keeps shared fruit shader upgrades idempotent", async () => {
  const { fruitSurface } = await import("../src/render/fruit-surface");
  const material = new THREE.MeshStandardMaterial();
  fruitSurface(material);
  fruitSurface(material);
  const shader = {
    uniforms: {},
    vertexShader: "#include <common>\n#include <uv_vertex>",
    fragmentShader:
      "#include <common>\n#include <map_fragment>\n#include <normal_fragment_maps>",
  } as THREE.WebGLProgramParametersWithUniforms;
  material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
  expect(shader.vertexShader.match(/varying vec2 vFruitUV;/g)).toHaveLength(1);
  expect(shader.fragmentShader.match(/float fruitEye\(/g)).toHaveLength(1);
});
it("rebinds disco uniforms on debris clones without inserting a second shader", async () => {
  vi.stubGlobal("document", {
    createElement: () => ({ getContext: () => ({ fillRect() {} }) }),
  });
  try {
    const { DiscoScene } = await import("../src/render/disco");
    const original = new THREE.MeshStandardMaterial();
    const a = new DiscoScene(),
      b = new DiscoScene();
    a.decorate(original);
    const clone = original.clone();
    clone.onBeforeCompile = original.onBeforeCompile;
    b.decorate(clone);
    const shader = {
      uniforms: {},
      vertexShader: "#include <common>\n#include <begin_vertex>",
      fragmentShader: "#include <common>\n#include <emissivemap_fragment>",
    } as THREE.WebGLProgramParametersWithUniforms;
    clone.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    expect(
      shader.vertexShader.match(/varying vec3 vDiscoWorld;/g),
    ).toHaveLength(1);
    expect(shader.uniforms.uDiscoAmount).toBe(b.amount);
  } finally {
    vi.unstubAllGlobals();
  }
});
it("finishes both window faces and removes all surrounds with their existing owner", async () => {
  const { Scenery } = await import("../src/render/scenery");
  const materials = {
    wood: new THREE.MeshStandardMaterial(),
    stone: new THREE.MeshStandardMaterial(),
    rock: new THREE.MeshStandardMaterial(),
  };
  const world = {
    paths: [],
    entities: [
      {
        id: 77,
        kind: "block",
        p: [100, 20, 100],
        s: [2, 3, 0.3],
        material: "window",
        assembly: "castle:tower",
        foundation: false,
        supports: [],
        variant: 0,
      },
    ],
  } as any;
  const scenery = new Scenery(world, { sample: () => 10 } as any, materials);
  const camera = new THREE.Vector3(100, 20, 100),
    matrix = new THREE.Matrix4();
  scenery.update(camera, new Set(), 1200, 120, 0, true);
  const faces: number[] = [];
  for (const object of scenery.group.children) {
    const mesh = object as THREE.InstancedMesh;
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, matrix);
      faces.push(matrix.elements[14]);
    }
  }
  expect(Math.min(...faces)).toBeLessThan(100);
  expect(Math.max(...faces)).toBeGreaterThan(100);
  scenery.update(camera, new Set([77]), 1200, 120, 1, true);
  expect(
    scenery.group.children.every(
      (object) => (object as THREE.InstancedMesh).count === 0,
    ),
  ).toBe(true);
});
it("preserves ground prop offsets and removes dressing when its footprint floods", async () => {
  const { Scenery } = await import("../src/render/scenery");
  let height = 10;
  const terrain = { sample: () => height, flood: {} as Record<number, number> };
  const materials = {
    wood: new THREE.MeshStandardMaterial(),
    rock: new THREE.MeshStandardMaterial(),
  };
  const world = {
    paths: [],
    entities: [
      {
        id: 3,
        kind: "tree",
        p: [100, 20, 100],
        s: [4, 10, 4],
        material: "foliage",
        treeSpecies: "pine",
        variant: 0.5,
        assembly: "forest",
        foundation: false,
        supports: [],
      },
    ],
  } as any;
  const scenery = new Scenery(world, terrain as any, materials),
    camera = new THREE.Vector3(100, 20, 100),
    matrix = new THREE.Matrix4();
  scenery.update(camera, new Set(), 1200, 120, 0, true);
  const rock = scenery.group.children.find(
    (object) => (object as THREE.Mesh).material === materials.rock,
  ) as THREE.InstancedMesh;
  rock.getMatrixAt(0, matrix);
  expect(matrix.elements[13]).toBeCloseTo(10.2);
  height = 10.5;
  scenery.update(camera, new Set(), 1200, 120, 1, true);
  rock.getMatrixAt(0, matrix);
  expect(matrix.elements[13]).toBeCloseTo(10.7);
  const { CONFIG } = await import("../src/config");
  const index =
    Math.round(matrix.elements[14] / CONFIG.spacing) * CONFIG.grid +
    Math.round(matrix.elements[12] / CONFIG.spacing);
  terrain.flood[index] = 255;
  scenery.update(camera, new Set(), 1200, 120, 2, true);
  expect(rock.count).toBe(0);
});
it("keeps settlement dressing with its damaged owner and restores it without changing neighbors", async () => {
  const { Scenery } = await import("../src/render/scenery");
  const materials = Object.fromEntries(
    ["wood", "stone", "rock"].map((name) => [
      name,
      new THREE.MeshStandardMaterial(),
    ]),
  );
  const wall = {
    id: 41,
    kind: "block",
    p: [100, 20, 100],
    s: [3, 2, 0.6],
    material: "plaster",
    assembly: "farm-house",
    foundation: false,
    variant: 0.2,
  };
  const glass = {
    ...wall,
    id: 42,
    p: [105, 20, 100],
    s: [0.6, 0.9, 0.15],
    material: "window",
  };
  const timber = {
    ...wall,
    id: 43,
    material: "wood",
    foundation: true,
    p: [110, 20, 100],
    s: [3, 2, 0.8],
  };
  const scenery = new Scenery(
    { paths: [], entities: [wall, glass, timber] } as any,
    { sample: () => 10 } as any,
    materials,
  );
  const camera = new THREE.Vector3(100, 20, 100);
  const count = () =>
    scenery.group.children.reduce(
      (n, o) => n + (o as THREE.InstancedMesh).count,
      0,
    );
  scenery.update(camera, new Set(), 1200, 120, 0, true);
  const intact = count();
  scenery.update(camera, new Set([41]), 1200, 120, 1, true);
  expect(count()).toBeGreaterThan(0);
  expect(count()).toBeLessThan(intact);
  scenery.update(camera, new Set([41, 42]), 1200, 120, 2, true);
  expect(count()).toBeGreaterThan(0);
  scenery.update(camera, new Set([41, 42, 43]), 1200, 120, 2.5, true);
  expect(count()).toBe(0);
  scenery.update(camera, new Set(), 1200, 120, 3, true);
  expect(count()).toBe(intact);
});
it("keeps open entrance doors outside the passage and follows the hinge wall's saved damage", async () => {
  const { Scenery } = await import("../src/render/scenery");
  const left = {
    id: 81,
    kind: "block",
    material: "plaster",
    assembly: "farm-house",
    foundation: true,
    p: [96.5, 12, 90],
    s: [1.5, 2, 1],
    variant: 0,
  };
  const right = { ...left, id: 82, p: [103.5, 12, 90] };
  const roof = {
    ...left,
    id: 83,
    material: "roof",
    foundation: false,
    p: [100, 18, 94],
    s: [8, 4, 5],
  };
  const materials = Object.fromEntries(
    ["wood", "rock", "stone", "roof"].map((name) => [
      name,
      new THREE.MeshStandardMaterial(),
    ]),
  );
  const scenery = new Scenery(
    { paths: [], entities: [left, right, roof] } as any,
    { sample: () => 10 } as any,
    materials,
  );
  const camera = new THREE.Vector3(100, 12, 80),
    removed = new Set<number>();
  scenery.update(camera, removed, 1200, 120, 0, true);
  const door = scenery.group.getObjectByName(
    "scenery:open-plank-doors",
  ) as THREE.InstancedMesh;
  expect(door.count).toBe(1);
  const matrix = new THREE.Matrix4(),
    corner = new THREE.Vector3();
  door.getMatrixAt(0, matrix);
  for (const x of [-1, 1])
    for (const z of [-0.05, 0.05]) {
      corner.set(x, 0, z).applyMatrix4(matrix);
      expect(corner.x).toBeLessThanOrEqual(98.1);
    }
  removed.add(82); // Removing the opposite wall leaves the hinged leaf intact.
  scenery.update(camera, removed, 1200, 120, 1, true);
  expect(door.count).toBe(1);
  removed.add(81);
  scenery.update(camera, removed, 1200, 120, 2, true);
  expect(door.count).toBe(0);
  removed.clear();
  scenery.update(camera, removed, 1200, 120, 3, true);
  expect(door.count).toBe(1);
});
it.each([
  ["stone", "castle:parapet", [4, 2, 1]],
  ["wood", "dock", [1, 4, 1]],
])(
  "removes and restores %s construction finishes with their original owner",
  async (material, assembly, s) => {
    const { Scenery } = await import("../src/render/scenery");
    const materials = {
      stone: new THREE.MeshStandardMaterial(),
      wood: new THREE.MeshStandardMaterial(),
      rock: new THREE.MeshStandardMaterial(),
    };
    const world = {
      paths: [],
      entities: [
        {
          id: 91,
          kind: "block",
          material,
          assembly,
          s,
          p: [100, 20, 100],
          supports: [],
          foundation: false,
          variant: 0.5,
        },
      ],
    } as any;
    const scenery = new Scenery(world, { sample: () => 10 } as any, materials);
    const camera = new THREE.Vector3(100, 20, 100);
    const count = () =>
      scenery.group.children.reduce(
        (sum, o) => sum + (o as THREE.InstancedMesh).count,
        0,
      );
    scenery.update(camera, new Set(), 1200, 120, 0, true);
    const intact = count();
    expect(intact).toBeGreaterThan(0);
    scenery.update(camera, new Set([91]), 1200, 120, 1, true);
    expect(count()).toBe(0);
    scenery.update(camera, new Set(), 1200, 120, 2, true);
    expect(count()).toBe(intact);
  },
);
it("upgrades procedural fruit to a shared texture without duplicating its relief shader", async () => {
  const { fruitSurface } = await import("../src/render/fruit-surface");
  const material = new THREE.MeshStandardMaterial(),
    texture = new THREE.Texture();
  fruitSurface(material);
  fruitSurface(material, texture);
  const shader = {
    uniforms: {},
    vertexShader: "#include <common>\n#include <uv_vertex>",
    fragmentShader:
      "#include <common>\n#include <map_fragment>\n#include <normal_fragment_maps>",
  } as THREE.WebGLProgramParametersWithUniforms;
  material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
  expect(material.map).toBe(texture);
  expect(material.color.getHex()).toBe(0xffffff);
  expect(shader.uniforms.uFruitPhotographed.value).toBe(1);
  expect(shader.fragmentShader.match(/float fruitEye\(/g)).toHaveLength(1);
});
