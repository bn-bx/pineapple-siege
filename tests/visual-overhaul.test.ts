import { expect, it, vi } from "vitest";
import * as THREE from "three";
import { textureBytes, sceneResources } from "../src/render/resource-budget";
import { qualityProfile, VISUAL_BUDGET } from "../src/render/quality-profile";
import { SimulationCadence } from "../src/simulation-cadence";
import { installFractureSurface } from "../src/render/fracture-surface";
import {
  loggingCampReviewCamera,
  quarryHoistOwner,
  quarryHoistReviewCamera,
} from "../src/render/landmark-geometry";
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
it("binds the quarry hoist to the middle scaffold crossbeam deterministically", () => {
  const beams = [-24, -12, 0, 12, 24].map((x, id) => ({
      id,
      kind: "block",
      material: "wood",
      p: [x, 19, 40],
      s: [6.5, 1, 3],
    })) as any,
    owner = quarryHoistOwner(beams);
  expect(owner?.id).toBe(2);
  expect(quarryHoistOwner([])).toBeUndefined();
  const camera = quarryHoistReviewCamera(owner, 15);
  expect(camera.target).toEqual([0, 20.12, 41.14]);
  expect(camera.eye[2]).toBeGreaterThan(camera.target[2]);
});
it("removes and restores the quarry winch with its existing crossbeam owner", async () => {
  const { Scenery } = await import("../src/render/scenery");
  const beams = [-24, -12, 0, 12, 24].map((offset, id) => ({
      id,
      kind: "block",
      material: "wood",
      p: [100 + offset, 19, 40],
      s: [6.5, 1, 3],
      assembly: "quarry-1-scaffold",
      foundation: false,
      supports: [],
    })) as any,
    owner = quarryHoistOwner(beams)!,
    terrain = { sample: () => 10, flood: new Uint8Array(CONFIG.grid ** 2) },
    scenery = new Scenery(
      { paths: [], sites: [], entities: beams } as any,
      terrain as any,
      {
        wood: new THREE.MeshStandardMaterial(),
        rock: new THREE.MeshStandardMaterial(),
        stone: new THREE.MeshStandardMaterial(),
      },
    ),
    camera = new THREE.Vector3(100, 22, 40),
    count = (key: string) =>
      (scenery.group.children.find(
        (object) => object.name === `scenery:${key}`,
      ) as THREE.InstancedMesh | undefined)?.count ?? 0,
    removed = new Set<number>();
  scenery.update(camera, removed, 1200, 120, 0, true);
  expect(count("quarry-winch-drum")).toBe(1);
  expect(count("quarry-winch-collars")).toBe(2);
  expect(count("quarry-winch-cable")).toBe(1);
  expect(count("quarry-winch-crank")).toBe(1);
  expect(count("quarry-winch-handle")).toBe(1);
  expect(count("quarry-winch-load-ring")).toBe(1);
  removed.add(owner.id);
  scenery.update(camera, removed, 1200, 120, 1, true);
  expect(count("quarry-winch-drum")).toBe(0);
  expect(count("quarry-winch-cable")).toBe(0);
  expect(count("quarry-winch-crank")).toBe(0);
  removed.clear();
  scenery.update(camera, removed, 1200, 120, 2, true);
  expect(count("quarry-winch-drum")).toBe(1);
  expect(count("quarry-winch-cable")).toBe(1);
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
    if (kind === "tree")
      expect(
        scenery.group.children.some(
          (o) =>
            o.name.startsWith("scenery:forest-understory-") &&
            (o as THREE.InstancedMesh).count > 0,
        ),
      ).toBe(true);
    if (kind === "tree")
      expect(
        scenery.group.children.find(
          (object) => object.name === "scenery:tree-root-flares",
        )?.visible,
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
it("dresses riverside trees with taller bank reeds that follow flood and owner changes", async () => {
  const { Scenery } = await import("../src/render/scenery");
  let height = 10;
  const tree = {
      id: 42,
      kind: "tree",
      p: [100, 10, 100],
      s: [3, 8, 3],
      material: "foliage",
      treeSpecies: "riverside",
      variant: 0.5,
      assembly: "riverside-grove",
      foundation: false,
      supports: [],
    },
    terrain = {
      flood: new Uint8Array(CONFIG.grid * CONFIG.grid),
      sample: () => height,
    };
  const scenery = new Scenery(
      { paths: [], entities: [tree] } as any,
      terrain as any,
      {
        wood: new THREE.MeshStandardMaterial(),
        rock: new THREE.MeshStandardMaterial(),
        stone: new THREE.MeshStandardMaterial(),
      },
    ),
    camera = new THREE.Vector3(100, 15, 100),
    reeds = () =>
      (
        scenery.group.children.find(
          (object) => object.name === "scenery:riverside-reeds",
        ) as THREE.InstancedMesh | undefined
      )?.count ?? 0;
  scenery.update(camera, new Set(), 1200, 120, 0, true);
  expect(reeds()).toBe(4);
  const reedMesh = scenery.group.children.find(
    (object) => object.name === "scenery:riverside-reeds",
  ) as THREE.InstancedMesh;
  expect(
    (reedMesh.material as THREE.MeshStandardMaterial).color.getHex(),
  ).toBe(0x93885d);
  const reedScale = new THREE.Vector3();
  const reedMatrix = new THREE.Matrix4();
  reedMesh.getMatrixAt(0, reedMatrix);
  reedMatrix.decompose(new THREE.Vector3(), new THREE.Quaternion(), reedScale);
  expect(reedScale.x).toBeGreaterThan(3);
  expect(reedScale.y).toBeGreaterThan(3);
  expect(
    (reedMesh.material as THREE.MeshStandardMaterial).customProgramCacheKey(),
  ).toBe("grass-wind-v1");
  const removed = new Set([tree.id]);
  scenery.update(camera, removed, 1200, 120, 1, true);
  expect(reeds()).toBe(0);
  removed.clear();
  height = 1;
  scenery.update(camera, removed, 1200, 120, 2, true);
  expect(reeds()).toBe(0);
  height = 10;
  for (let i = 0; i < 4; i++) {
    const angle = (tree.variant * 17 + i) * 2.399963,
      radius = 3 + (i * 7 + (tree.id % 13)),
      x = tree.p[0] + Math.cos(angle) * radius,
      z = tree.p[2] + Math.sin(angle) * radius;
    terrain.flood[
      Math.round(z / CONFIG.spacing) * CONFIG.grid +
        Math.round(x / CONFIG.spacing)
    ] = 1;
  }
  scenery.update(camera, removed, 1200, 120, 3, true);
  expect(reeds()).toBe(0);
  terrain.flood.fill(0);
  scenery.update(camera, removed, 1200, 120, 4, true);
  expect(reeds()).toBe(4);
});
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
      ) as THREE.InstancedMesh | undefined,
    fencePosts = () =>
      scenery.group.children.find(
        (object) => object.name === "scenery:farm-fence-posts",
      ) as THREE.InstancedMesh | undefined,
    fenceRails = () =>
      scenery.group.children.find(
        (object) => object.name === "scenery:farm-fence-rails",
      ) as THREE.InstancedMesh | undefined;
  scenery.update(camera, new Set(), 1200, 120, 0, true);
  expect(cropBatch()?.count).toBeGreaterThan(0);
  expect(fencePosts()?.count).toBeGreaterThan(0);
  expect(fenceRails()?.count).toBeGreaterThan(0);
  const initialFencePosts = fencePosts()!.count,
    initialFenceRails = fenceRails()!.count;
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
  expect(fencePosts()!.count).toBeLessThan(initialFencePosts);
  expect(fenceRails()!.count).toBeLessThan(initialFenceRails);
  terrain.flood.fill(0);
  const removed = new Set([owner.id]);
  scenery.update(camera, removed, 1200, 120, 2, true);
  expect(cropBatch()?.count).toBe(0);
  expect(beds?.count).toBe(0);
  expect(fencePosts()?.count).toBe(0);
  expect(fenceRails()?.count).toBe(0);
  scenery.update(camera, new Set(), 1200, 120, 3, true);
  expect(fencePosts()?.count).toBeGreaterThan(0);
  expect(fenceRails()?.count).toBeGreaterThan(0);
  expect(ownedCropCount).toBeGreaterThan(10);
});
it.each([
  ["house", "roof-chimney-stack"],
  ["barn", "roof-chimney-stack"],
  ["shed", "roof-chimney-stack"],
  ["warehouse", "roof-vent-cupola"],
  ["mill", "roof-vent-cupola"],
])(
  "adds a %s-specific roofline detail owned by its destructible roof",
  async (family, detail) => {
    const { Scenery } = await import("../src/render/scenery");
    const roof = {
      id: 71,
      kind: "block",
      p: [100, 30, 100],
      s: [8, 2, 6],
      material: "roof",
      assembly: `landmark-${family}`,
      foundation: false,
      supports: [],
    };
    const scenery = new Scenery(
      { paths: [], entities: [roof] } as any,
      { sample: () => 10 } as any,
      {
        wood: new THREE.MeshStandardMaterial(),
        rock: new THREE.MeshStandardMaterial(),
        stone: new THREE.MeshStandardMaterial(),
      },
    );
    scenery.update(
      new THREE.Vector3(100, 34, 100),
      new Set(),
      1200,
      120,
      0,
      true,
    );
    const detailBatch = scenery.group.children.find(
      (object) => object.name === `scenery:${detail}`,
    ) as THREE.InstancedMesh | undefined;
    expect(detailBatch?.count).toBeGreaterThan(0);
    expect(
      scenery.group.children.some(
        (object) =>
          object.name.startsWith("scenery:roof-") &&
          (object as THREE.InstancedMesh).count > 0,
      ),
    ).toBe(true);
    scenery.update(
      new THREE.Vector3(100, 34, 100),
      new Set([roof.id]),
      1200,
      120,
      1,
      true,
    );
    expect(
      scenery.group.children.every(
        (object) =>
          !object.name.startsWith("scenery:roof-") ||
          (object as THREE.InstancedMesh).count === 0,
      ),
    ).toBe(true);
  },
);
it("renders logging-camp stacks as round, horizontal timber", async () => {
  const { isLoggingCampLog, loggingCampLogGeometry } = await import(
    "../src/render/landmark-geometry"
  );
  expect(
    isLoggingCampLog({
      kind: "block",
      material: "wood",
      assembly: "landmark-logging-3-stack-2",
    }),
  ).toBe(true);
  expect(
    isLoggingCampLog({
      kind: "block",
      material: "wood",
      assembly: "landmark-hamlet-house-2",
    }),
  ).toBe(false);
  const geometry = loggingCampLogGeometry();
  const bounds = geometry.boundingBox!;
  expect(bounds.max.x - bounds.min.x).toBeCloseTo(2);
  expect(bounds.max.y - bounds.min.y).toBeCloseTo(2);
  expect(bounds.max.z - bounds.min.z).toBeCloseTo(2);
  geometry.dispose();
});
it("details logging-camp log ends and restores owner-bound stack braces", async () => {
  const { Scenery } = await import("../src/render/scenery");
  const stack = [0, 1, 2].map((layer) => ({
      id: 20 + layer,
      kind: "block",
      p: [100, 11 + layer * 2, 100],
      s: [12, 1, 1],
      material: "wood",
      assembly: "logging-1-stack-0",
      foundation: layer === 0,
      supports: [],
    })) as any,
    scenery = new Scenery(
      { paths: [], sites: [], entities: stack } as any,
      { sample: () => 10, flood: new Uint8Array(CONFIG.grid ** 2) } as any,
      {
        wood: new THREE.MeshStandardMaterial(),
        rock: new THREE.MeshStandardMaterial(),
        stone: new THREE.MeshStandardMaterial(),
      },
    ),
    camera = new THREE.Vector3(100, 12, 100),
    count = () =>
      (
        scenery.group.children.find(
          (object) => object.name === "scenery:logging-log-chocks",
        ) as THREE.InstancedMesh | undefined
      )?.count ?? 0,
    endGrainCount = () =>
      (
        scenery.group.children.find(
          (object) => object.name === "scenery:logging-log-end-grain",
        ) as THREE.InstancedMesh | undefined
      )?.count ?? 0,
    review = loggingCampReviewCamera(stack[0], 9),
    removed = new Set<number>();
  scenery.update(camera, removed, 1200, 120, 0, true);
  expect(count()).toBe(4);
  expect(endGrainCount()).toBe(6);
  expect(review.target[1]).toBeCloseTo(10.72);
  expect(review.eye[0]).toBeLessThan(review.target[0]);
  removed.add(stack[0].id);
  scenery.update(camera, removed, 1200, 120, 1, true);
  expect(count()).toBe(0);
  expect(endGrainCount()).toBe(4);
  removed.clear();
  scenery.update(camera, removed, 1200, 120, 2, true);
  expect(count()).toBe(4);
  expect(endGrainCount()).toBe(6);
});
it("renders harbor supports as tapered driven timber piles", async () => {
  const { harborDockPileGeometry, isHarborDockPile } = await import(
    "../src/render/landmark-geometry"
  );
  const pile = {
    kind: "block",
    material: "wood",
    assembly: "harbor-1-dock",
    s: [0.5, 2.4, 0.5],
  } as const;
  expect(isHarborDockPile(pile)).toBe(true);
  expect(isHarborDockPile({ ...pile, s: [5, 0.6, 2.1] })).toBe(false);
  expect(isHarborDockPile({ ...pile, assembly: "bridge-1-crossing" })).toBe(
    false,
  );
  const geometry = harborDockPileGeometry();
  expect(
    geometry.boundingBox!.max.y - geometry.boundingBox!.min.y,
  ).toBeCloseTo(2);
  expect(geometry.getAttribute("position").count).toBeLessThan(100);
  geometry.dispose();
});
it("aims the harbor review camera down the dock at its outer supports", async () => {
  const { harborDockReviewCamera } = await import(
    "../src/render/landmark-geometry"
  );
  const camera = harborDockReviewCamera(
    [0, 1, 2, 3, 4].map((i) => ({
      p: [20, 6, 40 - i * 4] as [number, number, number],
    })),
  )!;
  expect(camera.target[2]).toBe(32);
  expect(camera.target[1]).toBe(4.5);
  expect(camera.eye[2]).toBeLessThan(camera.target[2]);
  expect(harborDockReviewCamera([{ p: [0, 0, 0] }])).toBeUndefined();
});
it("adds owner-linked mooring details only to the ends of harbor docks", async () => {
  const { Scenery } = await import("../src/render/scenery");
  const decks = Array.from({ length: 7 }, (_, i) => ({
    id: 100 + i,
    kind: "block",
    p: [100 + i * 4, 11, 100],
    s: [2.1, 0.6, 5],
    material: "wood",
    assembly: "harbor-1-dock",
    foundation: i === 0,
    supports: [],
  }));
  const scenery = new Scenery(
    { paths: [], entities: decks } as any,
    { sample: () => 10 } as any,
    {
      wood: new THREE.MeshStandardMaterial(),
      rock: new THREE.MeshStandardMaterial(),
    },
  );
  const camera = new THREE.Vector3(112, 18, 100),
    batchCount = (name: string) =>
      (
        scenery.group.children.find(
          (object) => object.name === `scenery:${name}`,
        ) as THREE.InstancedMesh
      )?.count ?? 0;
  scenery.update(camera, new Set(), 1200, 120, 0, true);
  expect(batchCount("dock-bollards")).toBe(4);
  expect(batchCount("dock-mooring-rings")).toBe(4);
  scenery.update(camera, new Set([100]), 1200, 120, 1, true);
  expect(batchCount("dock-bollards")).toBe(2);
  expect(batchCount("dock-mooring-rings")).toBe(2);
  scenery.update(camera, new Set(), 1200, 120, 2, true);
  expect(batchCount("dock-bollards")).toBe(4);
});
it("divides settlement windows with owner-linked muntins on both faces", async () => {
  const { Scenery } = await import("../src/render/scenery");
  const window = {
    id: 731,
    kind: "block",
    p: [100, 8, 100],
    s: [0.16, 1.2, 0.9],
    material: "window",
    assembly: "hamlet-1-house",
    foundation: false,
    supports: [],
  };
  const scenery = new Scenery(
    { paths: [], entities: [window] } as any,
    { sample: () => 0 } as any,
    {
      wood: new THREE.MeshStandardMaterial(),
      rock: new THREE.MeshStandardMaterial(),
      stone: new THREE.MeshStandardMaterial(),
    },
  );
  const camera = new THREE.Vector3(100, 12, 100),
    muntins = () =>
      scenery.group.children.find(
        (object) => object.name === "scenery:window-muntins",
      ) as THREE.InstancedMesh,
    batchCount = (name: string) =>
      (
        scenery.group.children.find(
          (object) => object.name === `scenery:${name}`,
        ) as THREE.InstancedMesh
      )?.count ?? 0;
  scenery.update(camera, new Set(), 1200, 120, 0, true);
  expect(muntins().count).toBe(2);
  expect(batchCount("shutter-diagonal-braces")).toBe(4);
  expect(batchCount("window-hinges")).toBe(8);
  const nearFace = new THREE.Matrix4(),
    farFace = new THREE.Matrix4();
  muntins().getMatrixAt(0, nearFace);
  muntins().getMatrixAt(1, farFace);
  expect(nearFace.elements[13]).toBeCloseTo(farFace.elements[13]);
  expect(Math.abs(nearFace.elements[12] - farFace.elements[12])).toBeGreaterThan(0.2);
  scenery.update(camera, new Set([window.id]), 1200, 120, 1, true);
  expect(muntins().count).toBe(0);
  expect(batchCount("shutter-diagonal-braces")).toBe(0);
  expect(batchCount("window-hinges")).toBe(0);
  scenery.update(camera, new Set(), 1200, 120, 2, true);
  expect(muntins().count).toBe(2);
  expect(batchCount("shutter-diagonal-braces")).toBe(4);
});
it("divides night-aware hamlet panes with wall-owned muntins", async () => {
  const { Scenery } = await import("../src/render/scenery");
  const wall = {
    id: 732,
    kind: "block",
    p: [100, 8, 100],
    s: [2.66, 2, 1],
    material: "plaster",
    assembly: "hamlet-1-house-0",
    foundation: false,
    supports: [],
  };
  const scenery = new Scenery(
    { paths: [], entities: [wall] } as any,
    { sample: () => 0 } as any,
    {
      wood: new THREE.MeshStandardMaterial(),
      rock: new THREE.MeshStandardMaterial(),
      stone: new THREE.MeshStandardMaterial(),
    },
    undefined,
    [
      { owner: wall.id, p: [100, 8, 98.92], s: [2.2, 2.4, 0.12] },
      { owner: wall.id, p: [100, 8, 101.08], s: [2.2, 2.4, 0.12] },
    ],
  );
  const camera = new THREE.Vector3(100, 12, 100),
    batchCount = (name: string) =>
      (
        scenery.group.children.find(
          (object) => object.name === `scenery:${name}`,
        ) as THREE.InstancedMesh
      )?.count ?? 0;
  scenery.update(camera, new Set(), 1200, 120, 0, true);
  expect(batchCount("window-frame")).toBeGreaterThan(0);
  expect(batchCount("window-muntins")).toBe(4);
  scenery.update(camera, new Set([wall.id]), 1200, 120, 1, true);
  expect(batchCount("window-frame")).toBe(0);
  expect(batchCount("window-muntins")).toBe(0);
  scenery.update(camera, new Set(), 1200, 120, 2, true);
  expect(batchCount("window-frame")).toBeGreaterThan(0);
});
it("dresses coastal ruins with ground-following rubble that clears on flood or owner damage", async () => {
  const { Scenery } = await import("../src/render/scenery");
  const { CONFIG } = await import("../src/config");
  const flood = new Uint8Array(CONFIG.grid * CONFIG.grid),
    ruinWall = {
      id: 151,
      kind: "block",
      p: [100, 13, 100],
      s: [3, 3, 10],
      material: "stone",
      assembly: "site-coastal-ruin-0",
      foundation: true,
      supports: [],
    },
    scenery = new Scenery(
      { paths: [], entities: [ruinWall] } as any,
      { sample: () => 10, flood } as any,
      {
        wood: new THREE.MeshStandardMaterial(),
        rock: new THREE.MeshStandardMaterial(),
        stone: new THREE.MeshStandardMaterial(),
      },
    ),
    camera = new THREE.Vector3(100, 14, 100),
    rubble = () =>
      (
        scenery.group.children.find(
          (object) => object.name === "scenery:coastal-ruin-rubble",
        ) as THREE.InstancedMesh
      )?.count ?? 0;
  scenery.update(camera, new Set(), 1200, 120, 0, true);
  const dryCount = rubble();
  expect(dryCount).toBe(5);
  scenery.update(camera, new Set([ruinWall.id]), 1200, 120, 1, true);
  expect(rubble()).toBe(0);
  flood.fill(1);
  scenery.update(camera, new Set(), 1200, 120, 2, true);
  expect(rubble()).toBe(0);
  flood.fill(0);
  scenery.update(camera, new Set(), 1200, 120, 3, true);
  expect(rubble()).toBe(dryCount);
});
it("braces quarry scaffold bays with their existing crossbeam owners", async () => {
  const { Scenery } = await import("../src/render/scenery");
  const part = (id: number, x: number, s: number[], y: number) => ({
    id,
    kind: "block",
    p: [x, y, 100],
    s,
    material: "wood",
    assembly: "quarry-1-scaffold",
    foundation: false,
    supports: [],
  });
  const parts = [
    part(501, 100, [0.6, 10, 0.6], 20),
    part(502, 112, [0.6, 10, 0.6], 20),
    part(503, 124, [0.6, 10, 0.6], 20),
    part(511, 106, [6.5, 1, 3], 29),
    part(512, 118, [6.5, 1, 3], 29),
  ];
  const scenery = new Scenery(
    { paths: [], entities: parts, sites: [] } as any,
    { sample: () => 10 } as any,
    {
      wood: new THREE.MeshStandardMaterial(),
      rock: new THREE.MeshStandardMaterial(),
    },
  );
  const camera = new THREE.Vector3(112, 20, 100),
    braces = () =>
      (
        scenery.group.children.find(
          (object) => object.name === "scenery:quarry-scaffold-braces",
        ) as THREE.InstancedMesh
      )?.count ?? 0;
  scenery.update(camera, new Set(), 1200, 120, 0, true);
  expect(braces()).toBe(8);
  scenery.update(camera, new Set([511]), 1200, 120, 1, true);
  expect(braces()).toBe(4);
  scenery.update(camera, new Set(), 1200, 120, 2, true);
  expect(braces()).toBe(8);
});
it("cuts dark arrow-slit windows into each destructible watchtower course", async () => {
  const { Scenery } = await import("../src/render/scenery");
  const tower = [
    {
      id: 201,
      kind: "block",
      p: [100, 20, 100],
      s: [6, 4.2, 6],
      material: "stone",
      assembly: "site-watchtower-0",
      foundation: true,
      supports: [],
    },
    {
      id: 202,
      kind: "block",
      p: [100, 28.4, 100],
      s: [6, 4.2, 6],
      material: "stone",
      assembly: "site-watchtower-0",
      foundation: false,
      supports: [],
    },
  ];
  const scenery = new Scenery(
    { paths: [], entities: tower } as any,
    { sample: () => 10 } as any,
    {
      wood: new THREE.MeshStandardMaterial(),
      rock: new THREE.MeshStandardMaterial(),
      stone: new THREE.MeshStandardMaterial(),
    },
  );
  const camera = new THREE.Vector3(100, 24, 100),
    slits = () =>
      (
        scenery.group.children.find(
          (object) => object.name === "scenery:watchtower-arrow-slits",
        ) as THREE.InstancedMesh
      )?.count ?? 0;
  scenery.update(camera, new Set(), 1200, 120, 0, true);
  expect(slits()).toBe(8);
  scenery.update(camera, new Set([201]), 1200, 120, 1, true);
  expect(slits()).toBe(4);
  scenery.update(camera, new Set(), 1200, 120, 2, true);
  expect(slits()).toBe(8);
});
it("adds an owner-bound watchtower gallery with deck and guardrails", async () => {
  const { Scenery } = await import("../src/render/scenery");
  const parts = [
    {
      id: 211,
      kind: "block",
      p: [93, 36, 100],
      s: [1, 4, 7],
      material: "wood",
      assembly: "site-watchtower-gallery",
      foundation: false,
      supports: [],
    },
    {
      id: 212,
      kind: "block",
      p: [107, 36, 100],
      s: [1, 4, 7],
      material: "wood",
      assembly: "site-watchtower-gallery",
      foundation: false,
      supports: [],
    },
  ];
  const scenery = new Scenery(
    { paths: [], entities: parts } as any,
    { sample: () => 10 } as any,
    {
      wood: new THREE.MeshStandardMaterial(),
      rock: new THREE.MeshStandardMaterial(),
      stone: new THREE.MeshStandardMaterial(),
    },
  );
  const count = (name: string) =>
    (
      scenery.group.children.find(
        (object) => object.name === `scenery:${name}`,
      ) as THREE.InstancedMesh | undefined
    )?.count ?? 0;
  scenery.update(new THREE.Vector3(100, 40, 100), new Set(), 1200, 120, 0, true);
  expect(count("watchtower-gallery-deck")).toBe(1);
  expect(count("watchtower-gallery-rails")).toBe(8);
  expect(count("watchtower-gallery-posts")).toBe(4);
  scenery.update(
    new THREE.Vector3(100, 40, 100),
    new Set([211]),
    1200,
    120,
    1,
    true,
  );
  expect(count("watchtower-gallery-deck")).toBe(0);
  expect(count("watchtower-gallery-rails")).toBeLessThan(8);
  scenery.update(new THREE.Vector3(100, 40, 100), new Set(), 1200, 120, 2, true);
  expect(count("watchtower-gallery-deck")).toBe(1);
  expect(count("watchtower-gallery-rails")).toBe(8);
});
it("adds sparse arrow slits to castle keep courses with their original owners", async () => {
  const { Scenery } = await import("../src/render/scenery");
  const masonry = [304, 308].map((id, index) => ({
    id,
    kind: "block",
    p: [100, 30 + index * 4, 100],
    s: [4.8, 3.2, 4.8],
    material: "sandstone",
    assembly: "castle-0:keep",
    foundation: false,
    supports: [],
  }));
  const scenery = new Scenery(
    { paths: [], entities: masonry } as any,
    { sample: () => 10 } as any,
    {
      wood: new THREE.MeshStandardMaterial(),
      rock: new THREE.MeshStandardMaterial(),
      stone: new THREE.MeshStandardMaterial(),
    },
  );
  const camera = new THREE.Vector3(100, 32, 100),
    slits = () =>
      (
        scenery.group.children.find(
          (object) => object.name === "scenery:castle-keep-arrow-slits",
        ) as THREE.InstancedMesh
      )?.count ?? 0;
  scenery.update(camera, new Set(), 1200, 120, 0, true);
  expect(slits()).toBe(8);
  scenery.update(camera, new Set([304]), 1200, 120, 1, true);
  expect(slits()).toBe(4);
  scenery.update(camera, new Set(), 1200, 120, 2, true);
  expect(slits()).toBe(8);
});
it("adds corner buttresses to castle keep wall owners and restores them", async () => {
  const { Scenery } = await import("../src/render/scenery");
  const walls = [] as any[];
  let id = 900;
  for (const y of [10, 18, 26, 34, 42, 50])
    for (const x of [-6, 0, 6])
      for (const z of [-6, 0, 6]) {
        if (Math.abs(x) !== 6 && Math.abs(z) !== 6) continue;
        walls.push({
          id: id++,
          kind: "block",
          p: [x, y, z],
          s: [5.9, 3.1, 5.9],
          material: "sandstone",
          assembly: "castle:keep",
          foundation: false,
          supports: [],
        });
      }
  const scenery = new Scenery(
    { paths: [], entities: walls } as any,
    { sample: () => 0 } as any,
    {
      wood: new THREE.MeshStandardMaterial(),
      rock: new THREE.MeshStandardMaterial(),
      stone: new THREE.MeshStandardMaterial(),
      sandstone: new THREE.MeshStandardMaterial(),
    },
  );
  const camera = new THREE.Vector3(0, 24, 0),
    count = () =>
      (
        scenery.group.children.find(
          (object) => object.name === "scenery:castle-keep-corner-buttresses",
        ) as THREE.InstancedMesh
      )?.count ?? 0,
    owner = walls.find(
      (part) => part.p[0] === -6 && part.p[2] === -6 && part.p[1] === 10,
    )!;
  scenery.update(camera, new Set(), 1200, 120, 0, true);
  const intact = count();
  expect(intact).toBe(24);
  scenery.update(camera, new Set([owner.id]), 1200, 120, 1, true);
  expect(count()).toBeLessThan(intact);
  scenery.update(camera, new Set(), 1200, 120, 2, true);
  expect(count()).toBe(intact);
});
it("cuts paired arrow slits into castle curtain-wall owners and restores them", async () => {
  const { Scenery } = await import("../src/render/scenery");
  const walls = [] as any[];
  let id = 1200;
  for (const y of [5, 9, 13])
    for (let i = 0; i < 9; i++)
      walls.push({
        id: id++,
        kind: "block",
        p: [i * 12, y, 0],
        s: [4, 2.4, 2.4],
        material: "sandstone",
        assembly: "castle:front",
        foundation: false,
        supports: [],
      });
  const scenery = new Scenery(
      { paths: [], entities: walls } as any,
      { sample: () => 0 } as any,
      {
        wood: new THREE.MeshStandardMaterial(),
        rock: new THREE.MeshStandardMaterial(),
        stone: new THREE.MeshStandardMaterial(),
        sandstone: new THREE.MeshStandardMaterial(),
      },
    ),
    camera = new THREE.Vector3(48, 9, 0),
    count = () =>
      (
        scenery.group.children.find(
          (object) => object.name === "scenery:castle-curtain-wall-arrow-slits",
        ) as THREE.InstancedMesh
      )?.count ?? 0,
    owner = walls.find((part) => part.p[0] === 48 && part.p[1] === 9)!;
  scenery.update(camera, new Set(), 1200, 120, 0, true);
  expect(count()).toBe(6);
  scenery.update(camera, new Set([owner.id]), 1200, 120, 1, true);
  expect(count()).toBe(4);
  scenery.update(camera, new Set(), 1200, 120, 2, true);
  expect(count()).toBe(6);
});
it("bands castle towers with string courses owned by existing masonry", async () => {
  const { Scenery } = await import("../src/render/scenery");
  const walls = [] as any[];
  let id = 700;
  for (const y of [5, 15, 25, 35, 45, 55])
    for (const [x, z] of [
      [-6, -6],
      [0, -6],
      [6, -6],
      [-6, 0],
      [6, 0],
      [-6, 6],
      [0, 6],
      [6, 6],
    ])
      walls.push({
        id: id++,
        kind: "block",
        p: [x, y, z],
        s: [4, 2.5, 4],
        material: "sandstone",
        assembly: "castle-0:tower-1-1",
        foundation: false,
        supports: [],
      });
  const scenery = new Scenery(
      { paths: [], entities: walls } as any,
      { sample: () => 0 } as any,
      {
        wood: new THREE.MeshStandardMaterial(),
        rock: new THREE.MeshStandardMaterial(),
        stone: new THREE.MeshStandardMaterial(),
        sandstone: new THREE.MeshStandardMaterial(),
      },
    ),
    camera = new THREE.Vector3(0, 28, 0),
    courses = () =>
      (
        scenery.group.children.find(
          (object) =>
            object.name === "scenery:castle-tower-string-courses",
        ) as THREE.InstancedMesh | undefined
      )?.count ?? 0;
  scenery.update(camera, new Set(), 1200, 120, 0, true);
  const complete = courses();
  expect(complete).toBe(12);
  const courseMesh = scenery.group.children.find(
    (object) =>
      object.name === "scenery:castle-tower-string-courses",
  ) as THREE.InstancedMesh;
  const matrix = new THREE.Matrix4(),
    position = new THREE.Vector3(),
    rotation = new THREE.Quaternion(),
    scale = new THREE.Vector3();
  courseMesh.getMatrixAt(0, matrix);
  matrix.decompose(position, rotation, scale);
  expect(scale.x * 2).toBeLessThanOrEqual(20.5);
  const merlons = () =>
    (
      scenery.group.children.find(
        (object) => object.name === "scenery:castle-tower-merlons",
      ) as THREE.InstancedMesh | undefined
    )?.count ?? 0;
  const merlonCount = merlons();
  expect(merlonCount).toBe(16);
  scenery.update(camera, new Set([walls[9].id]), 1200, 120, 1, true);
  expect(courses()).toBeLessThan(complete);
  scenery.update(camera, new Set([walls.at(-1)!.id]), 1200, 120, 2, true);
  expect(merlons()).toBeLessThan(merlonCount);
  scenery.update(camera, new Set(), 1200, 120, 2, true);
  expect(courses()).toBe(complete);
  expect(merlons()).toBe(merlonCount);
});
it("frames the castle gate with stone voussoirs owned by its existing wall blocks", async () => {
  const { Scenery } = await import("../src/render/scenery");
  const walls = [-1, 1].map((side, index) => ({
    id: 400 + index,
    kind: "block",
    p: [100 + side * 12, 12.4, 100],
    s: [4, 2.4, 1.2],
    material: "sandstone",
    assembly: "castle-0:front",
    foundation: false,
    supports: [],
  }));
  const scenery = new Scenery(
    {
      paths: [],
      entities: walls,
      castles: [{ id: "castle-0", landmarks: { gate: [100, 10, 100] } }],
    } as any,
    { sample: () => 10 } as any,
    {
      wood: new THREE.MeshStandardMaterial(),
      rock: new THREE.MeshStandardMaterial(),
      stone: new THREE.MeshStandardMaterial(),
      sandstone: new THREE.MeshStandardMaterial(),
    },
  );
  const camera = new THREE.Vector3(100, 24, 100),
    voussoirs = () =>
      (
        scenery.group.children.find(
          (object) => object.name === "scenery:castle-gate-voussoirs",
        ) as THREE.InstancedMesh | undefined
      )?.count ?? 0;
  scenery.update(camera, new Set(), 1200, 120, 0, true);
  expect(voussoirs()).toBe(32);
  scenery.update(camera, new Set([walls[0].id]), 1200, 120, 1, true);
  expect(voussoirs()).toBe(16);
  scenery.update(camera, new Set(), 1200, 120, 2, true);
  expect(voussoirs()).toBe(32);
});
it("caps bridge rail spans with rounded timber tied to each rail owner", async () => {
  const { Scenery } = await import("../src/render/scenery");
  const { isBridgeRailingPart } = await import(
    "../src/render/landmark-geometry"
  );
  const { bridgeDeckPresentation } = await import(
    "../src/render/landmark-geometry"
  );
  const rail = {
      id: 301,
      kind: "block",
      p: [100, 22, 104.5],
      s: [6, 1, 0.4],
      material: "wood",
      assembly: "bridge-1",
      foundation: false,
      supports: [],
    },
    deck = {
      ...rail,
      id: 302,
      p: [100, 20, 100],
      s: [6, 1, 5],
    };
  expect(isBridgeRailingPart(rail, new Set(["bridge-1"]))).toBe(true);
  expect(isBridgeRailingPart(deck, new Set(["bridge-1"]))).toBe(false);
  const bridgeDeck = bridgeDeckPresentation(deck, new Set(["bridge-1"]))!;
  expect(bridgeDeck.p[1] + bridgeDeck.s[1]).toBe(deck.p[1] + deck.s[1]);
  expect(bridgeDeck.s[1]).toBe(0.38);
  const scenery = new Scenery(
    {
      paths: [],
      entities: [rail, deck],
      sites: [{ id: "bridge-1", kind: "bridge", p: [100, 10, 100] }],
    } as any,
    { sample: () => 10 } as any,
    {
      wood: new THREE.MeshStandardMaterial(),
      rock: new THREE.MeshStandardMaterial(),
    },
  );
  const camera = new THREE.Vector3(100, 25, 100),
    handrail = () =>
      (
        scenery.group.children.find(
          (object) => object.name === "scenery:bridge-handrails",
        ) as THREE.InstancedMesh
      )?.count ?? 0;
  const girderCount = (name: string) =>
    (
      scenery.group.children.find(
        (object) => object.name === `scenery:${name}`,
      ) as THREE.InstancedMesh | undefined
      )?.count ?? 0;
  const railingCount = (name: string) =>
    (
      scenery.group.children.find(
        (object) => object.name === `scenery:${name}`,
      ) as THREE.InstancedMesh | undefined
    )?.count ?? 0;
  scenery.update(camera, new Set(), 1200, 120, 0, true);
  expect(handrail()).toBe(1);
  expect(railingCount("bridge-lower-handrails")).toBe(1);
  expect(railingCount("bridge-railing-posts")).toBe(1);
  expect(railingCount("bridge-railing-braces")).toBe(2);
  expect(girderCount("bridge-main-girders")).toBe(2);
  expect(girderCount("bridge-cross-joists")).toBe(1);
  scenery.update(camera, new Set([301]), 1200, 120, 1, true);
  expect(handrail()).toBe(0);
  expect(railingCount("bridge-lower-handrails")).toBe(0);
  expect(railingCount("bridge-railing-posts")).toBe(0);
  expect(railingCount("bridge-railing-braces")).toBe(0);
  expect(girderCount("bridge-main-girders")).toBe(2);
  scenery.update(camera, new Set([302]), 1200, 120, 2, true);
  expect(girderCount("bridge-main-girders")).toBe(0);
  expect(girderCount("bridge-cross-joists")).toBe(0);
  scenery.update(camera, new Set(), 1200, 120, 2, true);
  expect(handrail()).toBe(1);
  expect(railingCount("bridge-lower-handrails")).toBe(1);
  expect(railingCount("bridge-railing-posts")).toBe(1);
  expect(railingCount("bridge-railing-braces")).toBe(2);
  expect(girderCount("bridge-main-girders")).toBe(2);
  expect(girderCount("bridge-cross-joists")).toBe(1);
});
it("frames lighthouse lantern glass with owner-linked iron and Fresnel optics", async () => {
  const { Scenery } = await import("../src/render/scenery");
  const lantern = {
    id: 401,
    kind: "block",
    p: [100, 62, 100],
    s: [4, 2, 4],
    material: "window",
    assembly: "lighthouse-1",
    foundation: false,
    supports: [],
  };
  const scenery = new Scenery(
    { paths: [], entities: [lantern] } as any,
    { sample: () => 10 } as any,
    {
      wood: new THREE.MeshStandardMaterial(),
      rock: new THREE.MeshStandardMaterial(),
      stone: new THREE.MeshStandardMaterial(),
    },
  );
  const camera = new THREE.Vector3(100, 62, 100),
    count = (name: string) =>
      (
        scenery.group.children.find(
          (object) => object.name === `scenery:${name}`,
        ) as THREE.InstancedMesh
      )?.count ?? 0;
  scenery.update(camera, new Set(), 1200, 120, 0, true);
  expect(count("lighthouse-lantern-frames")).toBe(12);
  expect(count("lighthouse-lantern-glazing")).toBe(4);
  expect(count("lighthouse-fresnel-glass")).toBe(1);
  expect(count("lighthouse-fresnel-hoops")).toBe(3);
  expect(count("lighthouse-fresnel-cage")).toBe(8);
  scenery.update(camera, new Set([lantern.id]), 1200, 120, 1, true);
  expect(count("lighthouse-lantern-frames")).toBe(0);
  expect(count("lighthouse-lantern-glazing")).toBe(0);
  expect(count("lighthouse-fresnel-glass")).toBe(0);
  expect(count("lighthouse-fresnel-hoops")).toBe(0);
  expect(count("lighthouse-fresnel-cage")).toBe(0);
  scenery.update(camera, new Set(), 1200, 120, 2, true);
  expect(count("lighthouse-lantern-frames")).toBe(12);
  expect(count("lighthouse-lantern-glazing")).toBe(4);
  expect(count("lighthouse-fresnel-glass")).toBe(1);
  expect(count("lighthouse-fresnel-hoops")).toBe(3);
  expect(count("lighthouse-fresnel-cage")).toBe(8);
});
it("raises and narrows lighthouse roof caps without changing saved entities", async () => {
  const { lighthouseRoofPresentation } = await import(
    "../src/render/landmark-geometry"
  );
  const { isLighthouseLanternGlazing } = await import(
    "../src/render/landmark-geometry"
  );
  const roof = {
    id: 402,
    kind: "block",
    p: [100, 70, 100],
    s: [9.6, 4, 9.6],
    material: "roof",
    assembly: "lighthouse-1",
    foundation: false,
    supports: [],
  } as const;
  expect(lighthouseRoofPresentation(roof)).toEqual({
    p: [100, 73.5, 100],
    s: [5.2, 1.5, 5.2],
  });
  expect(roof.p).toEqual([100, 70, 100]);
  expect(roof.s).toEqual([9.6, 4, 9.6]);
  expect(
    isLighthouseLanternGlazing({
      assembly: "lighthouse-1",
      kind: "block",
      material: "window",
      s: [4, 2, 4],
    }),
  ).toBe(true);
  expect(
    isLighthouseLanternGlazing({
      assembly: "hamlet-house-1",
      kind: "block",
      material: "window",
      s: [4, 2, 4],
    }),
  ).toBe(false);
  expect(
    lighthouseRoofPresentation({ ...roof, assembly: "hamlet-house-1" }),
  ).toBeUndefined();
});
it("animates windmill sails from existing destructible owners and freezes on snapshot time", async () => {
  const { windmillRotorBladeIds } = await import(
    "../src/render/landmark-geometry"
  );
  const { windmillRotors } = await import("../src/render/landmark-geometry");
  const { WindmillView } = await import("../src/render/windmill-view");
  const block = (id: number, p: number[], s: number[]) => ({
    id,
    kind: "block",
    p,
    s,
    material: "wood",
    assembly: "windmill-1",
    foundation: false,
    supports: [],
  });
  const world = {
    sites: [{ id: "windmill-1", kind: "windmill", p: [100, 10, 100] }],
    entities: [
      block(10, [100, 33, 94], [1.8, 2, 2]),
      block(11, [109, 33, 93], [8, 1.6, 0.5]),
      block(12, [91, 33, 93], [8, 1.6, 0.5]),
      block(13, [100, 42, 93], [1.6, 8, 0.5]),
      block(14, [100, 24, 93], [1.6, 8, 0.5]),
    ],
  } as any;
  expect([...windmillRotorBladeIds(world)].sort()).toEqual([11, 12, 13, 14]);
  expect(windmillRotors(world)[0].hubOwner).toBe(10);
  expect(windmillRotors(world)[0].hubCapCenter[2]).toBeCloseTo(91.725);
  const view = new WindmillView(
    world,
    new THREE.MeshStandardMaterial(),
    new THREE.BoxGeometry(2, 2, 2),
  );
  const sails = view.group.children.find(
    (object) => object.name === "windmill-sails",
  ) as THREE.InstancedMesh;
  const caps = view.group.children.find(
    (object) => object.name === "windmill-hub-caps",
  ) as THREE.InstancedMesh;
  expect(caps.count).toBe(1);
  const before = new THREE.Matrix4();
  sails.getMatrixAt(0, before);
  view.update(2, new Set());
  const moving = new THREE.Matrix4();
  sails.getMatrixAt(0, moving);
  expect(moving.equals(before)).toBe(false);
  view.update(2, new Set());
  const paused = new THREE.Matrix4();
  sails.getMatrixAt(0, paused);
  expect(paused.equals(moving)).toBe(true);
  view.update(2, new Set([11]));
  expect(sails.count).toBe(3);
  expect(caps.count).toBe(1);
  view.update(3, new Set([10]));
  expect(caps.count).toBe(0);
  view.update(4, new Set());
  expect(caps.count).toBe(1);
});
it("animates waterwheel paddles and spokes through existing owners", async () => {
  const { waterwheelPartIds, waterwheelRotors } = await import(
    "../src/render/landmark-geometry"
  );
  const { WaterwheelView } = await import("../src/render/waterwheel-view");
  const block = (id: number, p: number[], s: number[]) => ({
    id,
    kind: "block",
    p,
    s,
    material: "wood",
    assembly: "watermill-1-mill",
    foundation: false,
    supports: [],
  });
  const entities = [
    block(20, [88, 18, 100], [4, 1, 1]),
    block(21, [85, 18, 100], [1, 7, 0.6]),
    block(22, [85, 18, 100], [1, 0.6, 7]),
    ...Array.from({ length: 16 }, (_, i) => {
      const angle = (i * Math.PI) / 8;
      return block(
        30 + i,
        [85, 18 + Math.sin(angle) * 7, 100 + Math.cos(angle) * 7],
        [1.6, 1.6, 1.6],
      );
    }),
  ];
  const world = {
    sites: [{ id: "watermill-1", kind: "watermill", p: [100, 10, 100] }],
    entities,
  } as any;
  expect([...waterwheelPartIds(world)].sort((a, b) => a - b)).toEqual([
    21,
    22,
    ...Array.from({ length: 16 }, (_, i) => 30 + i),
  ]);
  expect(waterwheelRotors(world)[0].hubOwner).toBe(20);
  expect(waterwheelRotors(world)[0].hubCapCenter[0]).toBeCloseTo(83.725);
  const view = new WaterwheelView(
    world,
    new THREE.MeshStandardMaterial(),
    new THREE.BoxGeometry(2, 2, 2),
  );
  const paddles = view.group.children.find(
    (object) => object.name === "waterwheel-paddles",
  ) as THREE.InstancedMesh;
  const spokes = view.group.children.find(
    (object) => object.name === "waterwheel-spokes",
  ) as THREE.InstancedMesh;
  const caps = view.group.children.find(
    (object) => object.name === "waterwheel-hub-caps",
  ) as THREE.InstancedMesh;
  expect(caps.count).toBe(1);
  const before = new THREE.Matrix4();
  paddles.getMatrixAt(0, before);
  view.update(3, new Set());
  const moving = new THREE.Matrix4();
  paddles.getMatrixAt(0, moving);
  expect(moving.equals(before)).toBe(false);
  view.update(3, new Set());
  const paused = new THREE.Matrix4();
  paddles.getMatrixAt(0, paused);
  expect(paused.equals(moving)).toBe(true);
  view.update(3, new Set([30, 21]));
  expect(paddles.count).toBe(15);
  expect(spokes.count).toBe(1);
  expect(caps.count).toBe(1);
  view.update(3, new Set([20]));
  expect(caps.count).toBe(0);
  view.update(3, new Set());
  expect(paddles.count).toBe(16);
  expect(spokes.count).toBe(2);
  expect(caps.count).toBe(1);
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
  const crossRails = scenery.group.getObjectByName(
    "scenery:door-cross-rails",
  ) as THREE.InstancedMesh;
  const diagonalBraces = scenery.group.getObjectByName(
    "scenery:door-diagonal-braces",
  ) as THREE.InstancedMesh;
  const latchPlates = scenery.group.getObjectByName(
    "scenery:door-latch-plates",
  ) as THREE.InstancedMesh;
  const ringHandles = scenery.group.getObjectByName(
    "scenery:door-ring-handles",
  ) as THREE.InstancedMesh;
  expect(door.count).toBe(1);
  expect(crossRails.count).toBe(4);
  expect(diagonalBraces.count).toBe(2);
  expect(latchPlates.count).toBe(2);
  expect(ringHandles.count).toBe(2);
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
  expect(crossRails.count).toBe(4);
  removed.add(81);
  scenery.update(camera, removed, 1200, 120, 2, true);
  expect(door.count).toBe(0);
  expect(crossRails.count).toBe(0);
  expect(diagonalBraces.count).toBe(0);
  expect(latchPlates.count).toBe(0);
  expect(ringHandles.count).toBe(0);
  removed.clear();
  scenery.update(camera, removed, 1200, 120, 3, true);
  expect(door.count).toBe(1);
  expect(crossRails.count).toBe(4);
  expect(diagonalBraces.count).toBe(2);
  expect(latchPlates.count).toBe(2);
  expect(ringHandles.count).toBe(2);
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
