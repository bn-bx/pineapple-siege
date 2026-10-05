import { EnvironmentLighting, SKY_FRAGMENT } from "./environment-lighting";
import { VillageLighting, villageDecorations } from "./village-lighting";
import {
  prepareDebrisMotion,
  resizeDebrisMotion,
  writeDebrisMotion,
  uploadDebrisMotion,
} from "./debris-motion";
import {
  BODY_MATERIALS,
  PackedBodyReader,
  PackedBodyLookup,
} from "../sim/body-buffer";
import { motionFrame, bindMotion } from "../sim/motion-buffer";
import { PerformanceMonitor, GPUTimer } from "../performance";
import { AutoQuality } from "./auto-quality";
import { makeRivers } from "./river-view";
import { SnapshotTimeline } from "./snapshot-timeline";
import { CivilianView } from "./civilians";
import { ProjectileView } from "./projectiles";
import { isRoof } from "../debris-shape";
import { MAX_BODY_LIMIT } from "../destruction-settings";
import { CameraRig } from "./camera-rig";
import { GooglyEyes } from "./googly-eyes";
import { DiscoScene, DISCO_PATTERN_GLSL } from "./disco";
import { discoActive } from "../disco";
import {
  makeMonster,
  makeDistantMonster,
  DistantMonsterView,
  NearMonsterView,
  MonsterFragmentView,
} from "./monster";
import { flightPose } from "./flight-pose";
import * as THREE from "three";
import { Water } from "three/addons/objects/Water.js";
import {
  createMaterials,
  fractureGeometry,
  roofGeometry,
  roofFragmentGeometry,
  fractureMaterials,
  pineGeometry,
  treeCrownGeometry,
  treeCrownLowGeometry,
  makeJet,
  makePineapple,
} from "./assets";
import { TerrainView } from "./terrain-view";
import { Effects } from "./effects";
import type {
  WorldData,
  Entity,
  WorldDelta,
  SimulationSnapshot,
  Ruin,
  BodyView,
  Explosion,
  FragmentEffect,
  Material,
} from "../types";
import {
  CONFIG,
  CHUNKS,
  clamp,
  DEFAULT_MONSTER_COUNT,
  DEFAULT_RENDER_DISTANCE,
  normalizeRenderDistance,
  MAX_MONSTER_COUNT,
  LASER,
  MONSTER_SCALE,
  WEAPONS,
} from "../config";
interface Batch {
  mesh: THREE.InstancedMesh;
  low?: THREE.InstancedMesh;
  ids: number[];
  allIds: number[];
  kind: string;
  x: number;
  z: number;
  radius: number;
}
const dummy = new THREE.Object3D(),
  zero = new THREE.Matrix4().makeScale(0, 0, 0),
  up = new THREE.Vector3(0, 1, 0);
const bodyKeys = BODY_MATERIALS.map((material) =>
  Array.from({ length: 5 }, (_, part) =>
    part ? `${material}:${part}` : material,
  ),
);
const roofKeys = new Map(
  BODY_MATERIALS.map((material, index) => [material, bodyKeys[index]]),
);
export class GameRenderer {
  readonly civilians: CivilianView;
  readonly projectileView = new ProjectileView();
  readonly rig = new CameraRig();
  private cameraCells = new Map<number, Entity[]>();
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(64, 1, 0.5, 2800);
  readonly terrain: TerrainView;
  readonly effects = new Effects();
  readonly disco = new DiscoScene();
  readonly jet = makeJet();
  readonly performance = new PerformanceMonitor(4096);
  private gpu: GPUTimer;
  private warming?: Promise<void>;
  private disposed = false;
  private graphicsLost = false;
  private auto = new AutoQuality();
  private nextShadow = 0;
  private shadowDirty = true;
  private lightingHour = NaN;
  private nextReflection = 0.035;
  private lastArrival = 0;
  private reducedEffects = false;
  private cpuMS = 0;
  private wasActive = false;
  private lighting = new EnvironmentLighting();
  private villageLighting: VillageLighting;
  private shadowCenter = new THREE.Vector3();
  private discoSun = new THREE.Color("#b9c3ff");
  private discoAmbient = new THREE.Color("#d9dcff");
  private eyeRoots: THREE.Object3D[] = [];
  private monsterFragmentView = new MonsterFragmentView(MAX_MONSTER_COUNT);
  private monsterFragmentRoot = new THREE.Object3D();
  private monsterFragmentQuaternion = new THREE.Quaternion();
  private nearMonsterView = new NearMonsterView(MAX_MONSTER_COUNT);
  readonly eyes = new GooglyEyes();
  readonly materials: ReturnType<typeof createMaterials>["materials"];
  private sky: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private sun = new THREE.DirectionalLight("#fff0d2", 2.8);
  private ambient = new THREE.HemisphereLight("#c4e3f4", "#565b32", 1.8);
  private water: Water;
  private rivers: THREE.Group;
  private batches: Batch[] = [];
  private refs = new Map<number, { batch: Batch; index: number }[]>();
  private removed = new Set<number>();
  private ruins = new Map<number, Ruin>();
  private ruinCells = new Map<number, Set<number>>();
  private ruinGroups = new Map<number, THREE.Group>();
  private dirtyRuinBatches = new Set<number>();
  private ruinBuild?: Generator<void>;
  private ruinBuildKey = -1;
  private ruinBuildVersion = 0;
  private ruinVersions = new Map<number, number>();
  private bodyMeshes = new Map<string, THREE.InstancedMesh>();
  private bodyNeeded = new Uint32Array(BODY_MATERIALS.length * 5);
  private bodyAlpha = { value: 1 };
  private bodyGPUEnabled = { value: 1 };
  private syncedOldPacket?: SimulationSnapshot["packedBodies"];
  private bodyReader = new PackedBodyReader();
  private oldBodyReader = new PackedBodyReader();
  private bodyScratch: BodyView = {
    id: 0,
    source: 0,
    kind: "chunk",
    material: "stone",
    p: [0, 0, 0],
    q: [0, 0, 0, 1],
    s: [1, 1, 1],
  };
  private oldBodyScratch: BodyView = {
    id: 0,
    source: 0,
    kind: "chunk",
    material: "stone",
    p: [0, 0, 0],
    q: [0, 0, 0, 1],
    s: [1, 1, 1],
  };
  private oldBodyLookup = new PackedBodyLookup();
  private oldPacked?: SimulationSnapshot["packedBodies"];
  private bodyFrustum = new THREE.Frustum();
  private bodyProjection = new THREE.Matrix4();
  private bodySphere = new THREE.Sphere();
  private syncedBodies?: BodyView[];
  private previousBodies = new Map<number, BodyView>();
  private previousProjectiles = new Map<
    number,
    SimulationSnapshot["projectiles"][number]
  >();
  private previousSpikes = new Map<
    number,
    SimulationSnapshot["monsterSpikes"][number]
  >();
  private syncedBodyAlpha = -1;
  private debrisRotation = new THREE.Quaternion();
  private fallenPines: THREE.InstancedMesh;
  private fallenCanopies = new Map<string, THREE.InstancedMesh>();
  private crownGeometries = new Map<string, THREE.BufferGeometry>();
  private fallenTrunks: THREE.InstancedMesh;
  private shotMeshes: THREE.Group[] = [];
  private monsterMeshes: THREE.Group[] = [];
  private distantMonsters: THREE.Group[] = [];
  private distantMonsterView = new DistantMonsterView(MAX_MONSTER_COUNT);
  private googlyEyes = false;
  private eyesRoots: THREE.Object3D[] = [];
  private spikeMeshes: THREE.Mesh[] = [];
  private flagGroup = new THREE.Group();
  private marker: THREE.Mesh;
  private inspect?: { p: THREE.Vector3; target: THREE.Vector3 };
  private last?: SimulationSnapshot;
  private previous?: SimulationSnapshot;
  private retired = new Set<SimulationSnapshot>();
  private motionFrames = new Map<string, ReturnType<typeof motionFrame>>();
  private timeline = new SnapshotTimeline<SimulationSnapshot>(0.1, (s) =>
    this.retired.add(s),
  );
  private readyCamera = false;
  private cameraTarget = new THREE.Vector3();
  private cameraPosition = new THREE.Vector3();
  private elapsed = 0;
  private frame = 0;
  private lastLOD = 0;
  private quality = "auto";
  private renderDistance = DEFAULT_RENDER_DISTANCE;
  private targetHeight = 900;
  private lowSince = 0;
  private highSince = 0;
  private qualityChanged = 0;
  private averageMS = 16.7;
  private shakeEnabled = true;
  private fractureBox = fractureGeometry();
  private roof = roofGeometry();
  private fractureRoof = fractureGeometry(roofGeometry());
  private roofFragments = new Map<number, THREE.BufferGeometry>();
  private fragmentMaterials: Record<Material, THREE.MeshStandardMaterial>;
  private fragmentColor = new THREE.Color();
  private box = new THREE.BoxGeometry(2, 2, 2);
  private cameraBox = new THREE.Box3();
  private cameraHit = new THREE.Vector3();
  private cameraCandidates = new Set<Entity>();
  private cameraCell = -1;
  private cameraRay = new THREE.Raycaster();
  private wreckTransform = new THREE.Matrix4();
  private wreckInverse = new THREE.Matrix4();
  private wreckRay = new THREE.Ray();
  private wreckHit = new THREE.Vector3();
  private wreckPosition = new THREE.Vector3();
  private wreckRotation = new THREE.Quaternion();
  private unitScale = new THREE.Vector3(1, 1, 1);
  constructor(
    readonly canvas: HTMLCanvasElement,
    readonly world: WorldData,
    heights: Float32Array,
    private recycle?: (s: SimulationSnapshot) => void,
  ) {
    this.civilians = new CivilianView(world.civilians?.length ?? 0);
    this.scene.add(this.civilians.group);
    this.scene.add(this.projectileView.group);
    for (const e of world.entities) {
      if (e.kind === "tree") continue;
      for (
        let z = Math.max(0, Math.floor((e.p[2] - e.s[2]) / 64));
        z <= Math.min(CHUNKS - 1, Math.floor((e.p[2] + e.s[2]) / 64));
        z++
      )
        for (
          let x = Math.max(0, Math.floor((e.p[0] - e.s[0]) / 64));
          x <= Math.min(CHUNKS - 1, Math.floor((e.p[0] + e.s[0]) / 64));
          x++
        ) {
          const key = z * CHUNKS + x;
          let cell = this.cameraCells.get(key);
          if (!cell) this.cameraCells.set(key, (cell = []));
          cell.push(e);
        }
    }
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.debug.onShaderError = (gl, program, vertex, fragment) => {
      throw Error(
        "Shader initialization failed: " +
          gl.getProgramInfoLog(program) +
          " " +
          gl.getShaderInfoLog(vertex) +
          " " +
          gl.getShaderInfoLog(fragment),
      );
    };
    this.gpu = new GPUTimer(
      this.renderer.getContext() as WebGL2RenderingContext,
      this.performance,
    );
    this.eyes.setEnabled(false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.setClearColor("#9bb7c0");
    const assets = createMaterials();
    this.materials = assets.materials;
    this.fragmentMaterials = fractureMaterials(this.materials);
    this.terrain = new TerrainView(world, heights, assets.grass);
    this.terrain.enableStreamingUploads();
    this.scene.add(
      this.terrain.group,
      this.effects.group,
      this.disco.group,
      this.jet,
      this.flagGroup,
      this.sun,
      this.sun.target,
      this.ambient,
    );
    this.ensureMonsterMeshes(DEFAULT_MONSTER_COUNT);
    this.scene.add(
      this.distantMonsterView.group,
      this.nearMonsterView.group,
      this.monsterFragmentView.group,
    );

    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, {
      left: -220,
      right: 220,
      top: 220,
      bottom: -220,
      near: 1,
      far: 2000,
    });
    this.sun.shadow.bias = -0.00015;
    this.sun.shadow.normalBias = 0.5;
    this.sun.shadow.camera.updateProjectionMatrix();
    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(2500, 24, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: {
          sun: { value: this.lighting.sunDirection },
          zenithColor: { value: this.lighting.zenithColor },
          horizonColor: { value: this.lighting.horizonColor },
          cloudColor: { value: this.lighting.cloudColor },
          twilight: { value: 0 },
          discoAmount: this.disco.skyAmount,
          day: { value: 1 },
          time: { value: 0 },
          laserDim: { value: 0 },
        },
        vertexShader:
          "varying vec3 vDirection; void main(){vDirection=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}",
        fragmentShader: SKY_FRAGMENT,
      }),
    );
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -10;
    this.scene.add(this.sky);
    this.buildBatches();
    const pixels = new Uint8Array(128 * 128 * 4);
    for (let y = 0; y < 128; y++)
      for (let x = 0; x < 128; x++) {
        let i = (y * 128 + x) * 4;
        pixels[i] = 128 + Math.sin(x * 0.37 + y * 0.19) * 22;
        pixels[i + 1] = 128 + Math.cos(y * 0.43 - x * 0.12) * 22;
        pixels[i + 2] = 248;
        pixels[i + 3] = 255;
      }
    const normals = new THREE.DataTexture(pixels, 128, 128);
    normals.wrapS = normals.wrapT = THREE.RepeatWrapping;
    normals.needsUpdate = true;
    this.water = new Water(
      new THREE.PlaneGeometry(CONFIG.worldSize * 3, CONFIG.worldSize * 3),
      {
        textureWidth: 768,
        textureHeight: 432,
        waterNormals: normals,
        sunDirection: new THREE.Vector3(0.3, 0.6, 0.2),
        sunColor: 0xffeed5,
        waterColor: 0x28645d,
        distortionScale: 1.6,
        fog: false,
      },
    );
    this.water.rotation.x = -Math.PI / 2;
    this.water.position.set(CONFIG.worldSize / 2, 0.04, CONFIG.worldSize / 2);
    const mat = this.water.material;
    mat.uniforms.uFlood = { value: this.terrain.floodTexture };
    mat.uniforms.uHeight = { value: this.terrain.heightTexture };
    mat.uniforms.uDiscoAmount = this.disco.amount;
    mat.uniforms.uDiscoTime = this.disco.time;
    mat.fragmentShader = mat.fragmentShader
      .replace(
        "uniform float alpha;",
        `uniform float alpha; uniform sampler2D uFlood; uniform sampler2D uHeight;
         uniform float uDiscoAmount; uniform float uDiscoTime; ${DISCO_PATTERN_GLSL}`,
      )
      .replace(
        "#include <logdepthbuf_fragment>",
        `#include <logdepthbuf_fragment>\n vec2 terrainUV=(worldPosition.xz/${CONFIG.spacing}.+.5)/${CONFIG.grid}.; bool inMap=all(greaterThanEqual(terrainUV,vec2(0.)))&&all(lessThanEqual(terrainUV,vec2(1.))); float groundHeight=inMap?texture2D(uHeight,terrainUV).r:-30.; if(inMap&&(texture2D(uFlood,terrainUV).r<.5 || groundHeight>=0.))discard; float waterDepth=max(0.,-groundHeight);`,
      )
      .replace("float rf0 = 0.3;", "float rf0 = 0.08;")
      .replace(
        "vec3 outgoingLight = albedo;",
        "vec3 bed=mix(vec3(.25,.30,.20),vec3(.035,.15,.17),smoothstep(0.,6.,waterDepth))*sunColor; vec3 outgoingLight=mix(bed,albedo,.35+reflectance*.6); if(uDiscoAmount>0.001) outgoingLight+=uDiscoAmount*discoPattern(worldPosition.xz,uDiscoTime);",
      );
    const original = this.water.onBeforeRender;
    this.water.onBeforeRender = (r, s, c, g, m, group) => {
      if (
        this.elapsed >= this.nextReflection &&
        !this.renderer.shadowMap.needsUpdate
      ) {
        this.nextReflection =
          this.elapsed +
          (this.quality === "auto" ? this.auto.reflectionInterval : 1 / 12);
        const visible = this.effects.group.visible;
        this.effects.group.visible = false;
        const started = performance.now();
        try {
          original.call(this.water, r, s, c, g, m, group);
        } finally {
          this.effects.group.visible = visible;
          this.performance.record(
            "reflectionSubmit",
            performance.now() - started,
          );
        }
      }
    };
    this.scene.add(this.water);
    this.rivers = makeRivers(world, this.terrain);
    this.scene.add(this.rivers);
    const village = villageDecorations(world);
    this.villageLighting = new VillageLighting(village.lamps, village.windows);
    this.scene.add(
      this.villageLighting.mesh,
      this.villageLighting.windows,
      ...this.villageLighting.lights,
    );
    this.fallenPines = new THREE.InstancedMesh(
      pineGeometry(),
      this.materials.foliage,
      CONFIG.maxBodies,
    );
    this.fallenTrunks = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.8, 1, 1, 6),
      this.materials.wood,
      CONFIG.maxBodies,
    );
    for (const mesh of [this.fallenPines, this.fallenTrunks]) {
      mesh.setColorAt(0, new THREE.Color());
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.castShadow = mesh.receiveShadow = true;
      prepareDebrisMotion(mesh, this.bodyAlpha, this.bodyGPUEnabled);
      this.scene.add(mesh);
    }
    this.addBanners();
    for (let i = 0; i < 12; i++) {
      let shot = makePineapple();
      shot.visible = false;
      this.shotMeshes.push(shot);
      this.scene.add(shot);
    }
    this.marker = new THREE.Mesh(
      new THREE.RingGeometry(3.8, 4.3, 40),
      new THREE.MeshBasicMaterial({
        color: "#ffcf65",
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.7,
        depthTest: false,
      }),
    );
    this.marker.rotation.x = -Math.PI / 2;
    this.marker.renderOrder = 10;
    this.scene.add(this.marker);
    for (const material of Object.keys(this.materials) as Material[]) {
      let mesh = new THREE.InstancedMesh(
        isRoof(material) ? this.fractureRoof : this.fractureBox,
        this.fragmentMaterials[material],
        CONFIG.maxBodies,
      );
      mesh.setColorAt(0, new THREE.Color());
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      prepareDebrisMotion(mesh, this.bodyAlpha, this.bodyGPUEnabled);
      this.bodyMeshes.set(material, mesh);
      this.scene.add(mesh);
    }
    this.disco.decorateScene(this.scene);
    this.setRenderDistance(this.renderDistance);
    this.resize();
  }
  private buildBatches() {
    const grouped = new Map<string, Entity[]>();
    for (const e of this.world.entities) {
      const size = e.kind === "tree" ? 512 : 256;
      const cell = `${Math.floor(e.p[0] / size)},${Math.floor(e.p[2] / size)}`;
      let key = e.kind + e.material + (e.treeSpecies ?? "pine") + cell;
      if (e.kind === "tree") {
        const trunkKey = "trunk" + cell;
        let trunks = grouped.get(trunkKey);
        if (!trunks) grouped.set(trunkKey, (trunks = []));
        trunks.push(e);
      }
      let list = grouped.get(key);
      if (!list) grouped.set(key, (list = []));
      list.push(e);
    }
    const pine = pineGeometry(),
      low = new THREE.ConeGeometry(1, 1, 7, 1);
    low.translate(0, 0.5, 0);
    const roof = this.roof;
    const trunk = new THREE.CylinderGeometry(0.8, 1, 1, 6),
      rock = new THREE.DodecahedronGeometry(1, 0);
    for (const [groupKey, list] of grouped) {
      let e = list[0];
      const add = (
        geo: THREE.BufferGeometry,
        material: THREE.Material,
        kind: string,
        lowGeo?: THREE.BufferGeometry,
      ) => {
        let mesh = new THREE.InstancedMesh(geo, material, list.length);
        mesh.castShadow = mesh.receiveShadow = true;
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        let batch: Batch = {
          mesh,
          ids: list.map((e) => e.id),
          allIds: list.map((e) => e.id),
          kind,
          x: e.p[0],
          z: e.p[2],
          radius: 0,
        };
        if (lowGeo) {
          batch.low = new THREE.InstancedMesh(lowGeo, material, list.length);
          batch.low.receiveShadow = true;
          this.scene.add(batch.low);
        }
        list.forEach((e, i) => {
          dummy.position.fromArray(e.p);
          dummy.rotation.set(0, e.kind === "block" ? 0 : e.variant * 6.28, 0);
          dummy.scale.fromArray(e.s);
          if (kind === "pine") {
            dummy.position.y -= e.s[1];
            dummy.scale.set(e.s[0] * 1.45, e.s[1] * 2, e.s[0] * 1.45);
          }
          if (kind === "trunk") {
            dummy.position.y -= e.s[1] * 0.4;
            dummy.scale.set(0.65, e.s[1] * 1.2, 0.65);
          }
          dummy.updateMatrix();
          mesh.setMatrixAt(i, dummy.matrix);
          batch.low?.setMatrixAt(i, dummy.matrix);
          const color = new THREE.Color().setHSL(
            kind === "pine"
              ? e.treeSpecies === "broadleaf"
                ? 0.2
                : e.treeSpecies === "riverside"
                  ? 0.27
                  : 0.24
              : 0.12,
            kind === "pine" ? 0.18 : 0.06,
            0.77 + e.variant * 0.16,
          );
          mesh.setColorAt(i, color);
          batch.low?.setColorAt(i, color);
          let refs = this.refs.get(e.id);
          if (!refs) this.refs.set(e.id, (refs = []));
          refs.push({ batch, index: i });
        });
        mesh.computeBoundingSphere();
        batch.x = mesh.boundingSphere!.center.x;
        batch.z = mesh.boundingSphere!.center.z;
        batch.radius = mesh.boundingSphere!.radius;
        batch.low?.computeBoundingSphere();
        mesh.matrixAutoUpdate = false;
        mesh.matrixWorldAutoUpdate = false;
        if (batch.low) {
          batch.low.matrixAutoUpdate = false;
          batch.low.matrixWorldAutoUpdate = false;
        }
        this.scene.add(mesh);
        this.batches.push(batch);
      };
      if (groupKey.startsWith("trunk")) {
        add(trunk, this.materials.wood, "trunk");
        continue;
      }
      if (e.kind === "tree") {
        const species = e.treeSpecies ?? "pine";
        add(
          species === "pine" ? pine : this.crownGeometry(species),
          this.materials.foliage,
          "pine",
          species === "pine" ? low : treeCrownLowGeometry(species),
        );
      } else
        add(
          e.kind === "rock" ? rock : isRoof(e.material) ? roof : this.box,
          this.materials[e.material],
          e.kind,
        );
    }
  }
  private addBanners() {
    const mat = new THREE.MeshStandardMaterial({
      color: "#a9373d",
      side: THREE.DoubleSide,
      roughness: 0.9,
    });
    for (const banner of this.world.banners) {
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(banner.s[0], banner.s[1], 3, 8),
        mat,
      );
      mesh.position.fromArray(banner.p);
      mesh.rotation.y = banner.yaw ?? 0;
      mesh.userData.owner = banner.owner;
      this.flagGroup.add(mesh);
    }
  }
  prewarm(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (!this.warming)
      this.warming = this.prewarmOnce().finally(() => {
        this.warming = undefined;
      });
    return this.warming;
  }
  private async prewarmOnce() {
    this.renderer.initTexture(this.terrain.heightTexture);
    this.renderer.initTexture(this.terrain.floodTexture);
    this.fallenCanopy("broadleaf");
    this.fallenCanopy("riverside");
    this.effects.prewarm();
    for (const mesh of this.effects.prewarmMeshes) this.scene.add(mesh);
    const temporary: THREE.Mesh[] = [];
    for (const batch of this.batches)
      for (const mesh of [batch.mesh, batch.low])
        if (mesh && !mesh.parent) {
          this.scene.add(mesh);
          temporary.push(mesh);
        }
    // Settled rubble uses regular instancing, whereas airborne rubble has motion
    // attributes. Warm both shader programs before either can appear in combat.
    for (const material of Object.values(this.fragmentMaterials)) {
      this.disco.decorate(material);
      const mesh = new THREE.InstancedMesh(this.fractureBox, material, 1);
      mesh.setColorAt(0, new THREE.Color(1, 1, 1));
      mesh.setMatrixAt(0, new THREE.Matrix4());
      mesh.receiveShadow = true;
      this.scene.add(mesh);
      temporary.push(mesh);
    }
    const states: {
      object: THREE.Object3D;
      visible: boolean;
      culled: boolean;
      count?: number;
    }[] = [];
    this.scene.traverse((o) => {
      states.push({
        object: o,
        visible: o.visible,
        culled: o.frustumCulled,
        count: o instanceof THREE.InstancedMesh ? o.count : undefined,
      });
      o.visible = true;
      o.frustumCulled = false;
      if (o instanceof THREE.InstancedMesh && !o.count) o.count = 1;
    });
    try {
      // Keep polling cancellable: Three's compileAsync continues polling old
      // programs after a context loss/disposal. These properties are pinned to
      // the installed Three revision, as with our texture-upload adapter.
      const compiling = this.renderer.compile(this.scene, this.camera);
      while (compiling.size) {
        await new Promise<void>((resolve) => setTimeout(resolve, 10));
        if (this.disposed || this.graphicsLost) return;
        for (const material of compiling) {
          const { currentProgram: program } = this.renderer.properties.get(
            material,
          ) as { currentProgram?: { isReady(): boolean } };
          if (program?.isReady()) compiling.delete(material);
        }
      }
      if (this.disposed || this.graphicsLost) return;
      this.renderer.shadowMap.needsUpdate = true;
      this.renderer.render(this.scene, this.camera);
      // Reflection renders use a different output colour space. compileAsync for
      // the screen does not warm those programs or allocate the reflection target.
      // Render it deliberately while paused, after the shadow pass has completed.
      this.nextReflection = this.elapsed;
      this.renderer.shadowMap.needsUpdate = false;
      this.renderer.render(this.scene, this.camera);
    } finally {
      for (const state of states) {
        state.object.visible = state.visible;
        state.object.frustumCulled = state.culled;
        if (state.count !== undefined)
          (state.object as THREE.InstancedMesh).count = state.count;
      }
      for (const mesh of this.effects.prewarmMeshes) this.scene.remove(mesh);
      for (const mesh of temporary) {
        this.scene.remove(mesh);
        if (!this.batches.some((b) => b.mesh === mesh || b.low === mesh))
          (mesh as THREE.InstancedMesh).dispose();
      }
    }
  }
  setReducedEffects(value: boolean) {
    this.reducedEffects = value;
    this.effects.reduced =
      value || (this.quality === "auto" && this.auto.level >= 2);
  }
  setGooglyEyes(value: boolean) {
    this.syncedBodies = undefined;
    this.googlyEyes = value;
    this.eyes.setEnabled(value);
    for (const monster of this.monsterMeshes) {
      const nativeEyes = monster.getObjectByName("native-eyes");
      if (nativeEyes) nativeEyes.visible = !value;
    }
  }
  private ensureMonsterMeshes(count: number) {
    while (this.monsterMeshes.length < count) {
      const monster = new THREE.Group();
      monster.userData.googlyBounds = [0, 18.5, 0, 7, 5, 8.5];
      const distant = new THREE.Group();
      distant.userData.googlyBounds = [0, 18.5, 0, 7, 5, 8.5];
      for (const child of distant.children) child.visible = false;
      const nativeEyes = monster.getObjectByName("native-eyes");
      if (nativeEyes) nativeEyes.visible = !this.googlyEyes;
      monster.visible = distant.visible = false;
      this.monsterMeshes.push(monster);
      this.distantMonsters.push(distant);
      // Attach only visible detail models; hidden hierarchies otherwise still
      // recalculate thousands of world matrices on every frame.
    }
  }
  setQuality(q: string) {
    this.quality = q;
    this.targetHeight = q === "auto" ? this.auto.height : Number(q);
    this.qualityChanged = performance.now();
    this.resize();
  }
  setRenderDistance(value: number) {
    this.renderDistance = normalizeRenderDistance(value);
    this.camera.far =
      Math.hypot(CONFIG.worldSize, CONFIG.worldSize, CONFIG.ceiling) + 512;
    this.camera.updateProjectionMatrix();
    this.sky.scale.setScalar((this.camera.far * 0.9) / 2500);
    this.lastLOD = -Infinity;
  }
  setShake(value: boolean) {
    this.shakeEnabled = value;
  }
  resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2),
      ratio = Math.min(
        dpr,
        this.targetHeight / innerHeight,
        (this.targetHeight * 16) / 9 / innerWidth,
      );
    this.renderer.setPixelRatio(Math.max(0.5, ratio));
    this.renderer.setSize(innerWidth, innerHeight);
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
  }
  receive(snapshot: SimulationSnapshot) {
    if (snapshot.packedMotion && snapshot.slot !== undefined) {
      const key = `${snapshot.epoch}:${snapshot.slot}`;
      let frame = this.motionFrames.get(key);
      if (!frame) this.motionFrames.set(key, (frame = motionFrame()));
      bindMotion(snapshot, frame, false);
    }
    if (
      this.last &&
      flightPose(this.last.plane, snapshot.plane, 1).discontinuity
    ) {
      this.timeline.reset();
      this.readyCamera = false;
    }
    const arrival = performance.now();
    if (this.lastArrival)
      this.performance?.record("delivery", arrival - this.lastArrival);
    this.lastArrival = arrival;
    this.last = snapshot;
    this.timeline.receive(snapshot, performance.now());
  }
  resumeSnapshots() {
    this.wasActive = false;
    this.timeline.reset(this.last);
    this.readyCamera = false;
  }
  reset(
    heights: Float32Array,
    removed: number[],
    ruins: Ruin[],
    flood: Uint32Array,
    waterMask?: Uint8Array,
  ) {
    this.setChase();
    this.removed.clear();
    this.ruins.clear();
    this.ruinCells.clear();
    this.dirtyRuinBatches.clear();
    this.ruinBuild?.return(undefined);
    this.ruinBuild = undefined;
    this.ruinVersions.clear();
    for (const g of this.ruinGroups.values()) {
      this.scene.remove(g);
      for (const m of g.children) (m as THREE.InstancedMesh).dispose();
    }
    this.ruinGroups.clear();
    this.terrain.restore(heights);
    this.terrain.setFlood(flood, true);
    if (waterMask) this.terrain.setWaterMask(waterMask);
    this.refs.clear();
    for (const batch of this.batches) {
      batch.ids = batch.allIds.slice();
      batch.mesh.count = batch.ids.length;
      if (batch.low) batch.low.count = batch.ids.length;
      batch.ids.forEach((id, i) => {
        let refs = this.refs.get(id);
        if (!refs) this.refs.set(id, (refs = []));
        refs.push({ batch, index: i });
        const e = this.world.entities[id];
        dummy.position.fromArray(e.p);
        dummy.rotation.set(0, e.kind === "block" ? 0 : e.variant * 6.28, 0);
        dummy.scale.fromArray(e.s);
        if (batch.kind === "pine") {
          dummy.position.y -= e.s[1];
          dummy.scale.set(e.s[0] * 1.45, e.s[1] * 2, e.s[0] * 1.45);
        }
        if (batch.kind === "trunk") {
          dummy.position.y -= e.s[1] * 0.4;
          dummy.scale.set(0.65, e.s[1] * 1.2, 0.65);
        }
        dummy.updateMatrix();
        batch.mesh.setMatrixAt(i, dummy.matrix);
        batch.low?.setMatrixAt(i, dummy.matrix);
        const color = this.fragmentColor.setHSL(
          batch.kind === "pine"
            ? e.treeSpecies === "broadleaf"
              ? 0.2
              : e.treeSpecies === "riverside"
                ? 0.27
                : 0.24
            : 0.12,
          batch.kind === "pine" ? 0.18 : 0.06,
          0.77 + e.variant * 0.16,
        );
        batch.mesh.setColorAt(i, color);
        batch.low?.setColorAt(i, color);
        if (batch.mesh.instanceColor)
          batch.mesh.instanceColor.needsUpdate = true;
        if (batch.low?.instanceColor)
          batch.low.instanceColor.needsUpdate = true;
        batch.mesh.instanceMatrix.needsUpdate = true;
        if (batch.low) batch.low.instanceMatrix.needsUpdate = true;
      });
    }
    for (const id of removed) this.hideEntity(id);
    for (const r of ruins) this.addRuin(r);
    this.effects.reset();
    this.disco.reset();
    for (const shot of this.shotMeshes.splice(12)) this.scene.remove(shot);
    for (const shot of this.shotMeshes) shot.visible = false;
    this.civilians.reset();
    this.projectileView.reset();
    for (const m of this.monsterMeshes) m.visible = false;
    for (const m of this.distantMonsters) m.visible = false;
    this.nearMonsterView.begin();
    this.distantMonsterView.begin();
    this.distantMonsterView.finish();
    for (const s of this.spikeMeshes) s.visible = false;
    this.readyCamera = false;
    this.motionFrames.clear();
    this.previous = undefined;
    this.timeline.reset();
    this.last = undefined;
    this.previousBodies.clear();
    this.oldPacked = undefined;
    this.syncedBodies = undefined;
    this.renderer.shadowMap.needsUpdate = true;
  }
  private hideEntity(id: number) {
    this.removed.add(id);
    const refs = this.refs.get(id);
    if (!refs) return;
    for (const ref of refs) {
      const batch = ref.batch,
        last = batch.ids.length - 1;
      if (ref.index !== last) {
        const moved = batch.ids[last];
        batch.ids[ref.index] = moved;
        for (const mesh of [batch.mesh, batch.low])
          if (mesh) {
            mesh.getMatrixAt(last, dummy.matrix);
            mesh.setMatrixAt(ref.index, dummy.matrix);
            if (mesh.instanceColor) {
              mesh.getColorAt(last, this.fragmentColor);
              mesh.setColorAt(ref.index, this.fragmentColor);
              mesh.instanceColor.addUpdateRange(ref.index * 3, 3);
              mesh.instanceColor.needsUpdate = true;
            }
          }
        const movedRef = this.refs.get(moved)!.find((r) => r.batch === batch)!;
        movedRef.index = ref.index;
      }
      batch.ids.pop();
      for (const mesh of [batch.mesh, batch.low])
        if (mesh) {
          mesh.count = batch.ids.length;
          mesh.instanceMatrix.addUpdateRange(ref.index * 16, 16);
          mesh.instanceMatrix.needsUpdate = true;
        }
    }
    this.refs.delete(id);
  }

  delta(d: WorldDelta) {
    for (const id of d.removed) this.hideEntity(id);
    for (const id of d.rubbleRemoved) this.removeRuin(id);
    for (const r of d.settled) this.addRuin(r);
    if (d.terrain) this.terrain.patch(d.terrain);
    if (d.flood) this.terrain.setFlood(d.flood);
    if (d.dry) this.terrain.setDry(d.dry);
    this.shadowDirty = true;
  }
  fragment(e: FragmentEffect) {
    this.effects.fragment(e, this.targetHeight < 1080 ? 0.6 : 1);
  }
  explosion(e: Explosion) {
    this.effects.explosion(
      e,
      this.targetHeight < 1080 || this.effects.reduced ? 0.6 : 1,
    );
  }
  private ruinCell(p: number[]) {
    return (
      Math.max(0, Math.min(CHUNKS - 1, Math.floor(p[2] / 64))) * CHUNKS +
      Math.max(0, Math.min(CHUNKS - 1, Math.floor(p[0] / 64)))
    );
  }
  private addRuin(r: Ruin) {
    this.ruins.set(r.id, r);
    const key = this.ruinCell(r.p);
    let ids = this.ruinCells.get(key);
    if (!ids) this.ruinCells.set(key, (ids = new Set()));
    ids.add(r.id);
    this.dirtyRuinBatches.add(this.ruinBatch(key));
    const batchKey = this.ruinBatch(key);
    this.ruinVersions?.set(
      batchKey,
      (this.ruinVersions.get(batchKey) || 0) + 1,
    );
  }
  private removeRuin(id: number) {
    const r = this.ruins.get(id);
    if (!r) return;
    const key = this.ruinCell(r.p);
    this.ruinCells.get(key)?.delete(id);
    this.dirtyRuinBatches.add(this.ruinBatch(key));
    const batchKey = this.ruinBatch(key);
    this.ruinVersions?.set(
      batchKey,
      (this.ruinVersions.get(batchKey) || 0) + 1,
    );
    this.ruins.delete(id);
  }
  private *buildRuinBatch(key: number): Generator<void> {
    const bounds = new THREE.Sphere().makeEmpty();
    let maxRadius = 0;
    const group = new THREE.Group(),
      lists = new Map<
        string,
        {
          geo: THREE.BufferGeometry;
          mat: THREE.Material;
          matrices: THREE.Matrix4[];
        }
      >();
    let installed = false;
    try {
      const add = (
        name: string,
        geo: THREE.BufferGeometry,
        mat: THREE.Material,
      ) => {
        let batch = lists.get(name);
        if (!batch) lists.set(name, (batch = { geo, mat, matrices: [] }));
        dummy.updateMatrix();
        batch.matrices.push(dummy.matrix.clone());
        bounds.expandByPoint(dummy.position);
        if (!geo.boundingSphere) geo.computeBoundingSphere();
        maxRadius = Math.max(
          maxRadius,
          (geo.boundingSphere!.radius + geo.boundingSphere!.center.length()) *
            Math.max(
              Math.abs(dummy.scale.x),
              Math.abs(dummy.scale.y),
              Math.abs(dummy.scale.z),
            ),
        );
      };
      const firstCell =
        Math.floor(key / (CHUNKS / 4)) * CHUNKS * 4 + (key % (CHUNKS / 4)) * 4;
      const cells = this.ruinCells;
      function* ids() {
        for (let z = 0; z < 4; z++)
          for (let x = 0; x < 4; x++)
            yield* cells.get(firstCell + z * CHUNKS + x) ?? [];
      }
      let visited = 0;
      for (const id of ids()) {
        if (++visited % 16 === 0) yield;
        const r = this.ruins.get(id);
        if (!r) continue;
        dummy.position.fromArray(r.p);
        dummy.quaternion.fromArray(r.q);
        dummy.scale.fromArray(r.s);
        if (r.kind === "tree") {
          const e = this.world.entities[r.source];
          dummy.scale.set(r.s[0], r.s[1] * 2, r.s[2]);
          add("trunk", this.fallenTrunks.geometry, this.materials.wood);
          dummy.position.add(
            new THREE.Vector3(0, -r.s[1], 0).applyQuaternion(dummy.quaternion),
          );
          const ratio = r.s[1] / e.s[1];
          dummy.scale.set(
            e.s[0] * 1.45 * ratio,
            r.s[1] * 2,
            e.s[0] * 1.45 * ratio,
          );
          add(
            `canopy-${e.treeSpecies ?? "pine"}`,
            this.crownGeometry(e.treeSpecies ?? "pine"),
            this.materials.foliage,
          );
        } else if (r.pile) {
          // A compact record renders as several irregular solid chunks rather
          // than the single smooth box used as its inexpensive collision proxy.
          const root = new THREE.Vector3(...r.p);
          for (let layer = 0; layer < 2; layer++)
            for (let x = -1; x <= 1; x += 2)
              for (let z = -1; z <= 1; z += 2) {
                dummy.position.set(
                  root.x + x * r.s[0] * 0.5,
                  root.y + (layer - 0.5) * r.s[1],
                  root.z + z * r.s[2] * 0.5,
                );
                dummy.rotation.set(
                  0,
                  Math.sin(r.id + layer * 7 + x + z) * 0.16,
                  0,
                );
                dummy.scale.set(r.s[0] * 0.5, r.s[1] * 0.5, r.s[2] * 0.5);
                add(
                  r.material,
                  isRoof(r.material) ? this.fractureRoof : this.fractureBox,
                  this.fragmentMaterials[r.material],
                );
              }
        } else
          add(
            this.debrisKey(r),
            this.debrisGeometry(r),
            this.fragmentMaterials[r.material],
          );
      }
      bounds.radius += maxRadius;
      for (const { geo, mat, matrices } of lists.values()) {
        const mesh = new THREE.InstancedMesh(geo, mat, matrices.length);
        group.add(mesh);
        for (let i = 0; i < matrices.length; i++) {
          if (i % 64 === 63) yield;
          const m = matrices[i];
          mesh.setMatrixAt(i, m);
          mesh.setColorAt(
            i,
            this.fragmentColor.setScalar(
              0.86 +
                (Math.abs(m.elements[12] * 17 + m.elements[14] * 31) % 19) / 70,
            ),
          );
        }
        mesh.receiveShadow = true;
        mesh.boundingSphere = bounds.clone();
        mesh.matrixAutoUpdate = false;
        mesh.matrixWorldAutoUpdate = false;
      }
      group.userData.bounds = bounds;
      const old = this.ruinGroups.get(key);
      if (old) {
        this.scene.remove(old);
        for (const mesh of old.children)
          (mesh as THREE.InstancedMesh).dispose();
      }
      this.scene.add(group);
      this.ruinGroups.set(key, group);
      installed = true;
    } finally {
      if (!installed)
        for (const mesh of group.children)
          (mesh as THREE.InstancedMesh).dispose();
    }
  }
  private updateRuins(budgetMS = Infinity) {
    const deadline = performance.now() + budgetMS;
    while (performance.now() < deadline) {
      if (!this.ruinBuild) {
        const key = this.dirtyRuinBatches.values().next().value;
        if (key === undefined) break;
        this.ruinBuildKey = key;
        this.ruinBuildVersion = this.ruinVersions?.get(key) || 0;
        this.ruinBuild = this.buildRuinBatch(key);
      }
      if (this.ruinBuild.next().done) {
        if (
          (this.ruinVersions?.get(this.ruinBuildKey) || 0) ===
          this.ruinBuildVersion
        )
          this.dirtyRuinBatches.delete(this.ruinBuildKey);
        this.ruinBuild = undefined;
      }
    }
    for (const g of this.ruinGroups.values()) {
      const bounds = g.userData.bounds as THREE.Sphere;
      const d = Math.hypot(
        bounds.center.x - this.camera.position.x,
        bounds.center.z - this.camera.position.z,
      );
      g.visible = d < this.renderDistance + bounds.radius;
      if (g.visible && !g.parent) this.scene.add(g);
      else if (!g.visible && g.parent) this.scene.remove(g);
      for (const m of g.children) m.castShadow = d < 230;
    }
  }
  private ruinBatch(cell: number) {
    return (
      Math.floor(Math.floor(cell / CHUNKS) / 4) * (CHUNKS / 4) +
      Math.floor((cell % CHUNKS) / 4)
    );
  }
  private growDebrisMesh(mesh: THREE.InstancedMesh, required: number) {
    if (required <= mesh.instanceMatrix.count) return mesh;
    const grown = new THREE.InstancedMesh(
      mesh.geometry,
      mesh.material,
      Math.max(required, mesh.instanceMatrix.count * 2),
    );
    grown.frustumCulled = false;
    grown.castShadow = mesh.castShadow;
    grown.receiveShadow = mesh.receiveShadow;
    grown.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    if (mesh.instanceColor) grown.setColorAt(0, new THREE.Color());
    if (mesh.userData.motion) {
      grown.geometry = mesh.geometry.clone();
      grown.userData.motion = true;
      grown.customDepthMaterial = mesh.customDepthMaterial;
      resizeDebrisMotion(grown);
      mesh.geometry.dispose();
    }
    this.scene.remove(mesh);
    mesh.dispose();
    this.scene.add(grown);
    return grown;
  }
  private debrisKey(b: Pick<BodyView, "material" | "roofPart">) {
    return roofKeys.get(b.material)![b.roofPart ?? 0];
  }
  private debrisGeometry(b: Pick<BodyView, "material" | "roofPart">) {
    if (!isRoof(b.material)) return this.fractureBox;
    if (!b.roofPart) return this.fractureRoof;
    // Shared by airborne and settled instances; at most four prepared shapes.
    this.roofFragments ??= new Map();
    let geo = this.roofFragments.get(b.roofPart);
    if (!geo) {
      geo = roofFragmentGeometry(b.roofPart);
      this.roofFragments.set(b.roofPart, geo);
    }
    return geo;
  }
  private crownGeometry(species: "pine" | "broadleaf" | "riverside") {
    this.crownGeometries ??= new Map();
    let geometry = this.crownGeometries.get(species);
    if (!geometry) {
      geometry = treeCrownGeometry(species);
      this.crownGeometries.set(species, geometry);
    }
    return geometry;
  }
  private fallenCanopy(
    species: "pine" | "broadleaf" | "riverside",
    needed = 0,
  ) {
    if (species === "pine") return this.fallenPines;
    this.fallenCanopies ??= new Map();
    let mesh = this.fallenCanopies.get(species);
    if (!mesh) {
      mesh = new THREE.InstancedMesh(
        this.crownGeometry(species),
        this.materials.foliage,
        Math.max(64, needed),
      );
      mesh.setColorAt(0, new THREE.Color());
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.castShadow = mesh.receiveShadow = true;
      if (this.bodyAlpha)
        prepareDebrisMotion(mesh, this.bodyAlpha, this.bodyGPUEnabled);
      this.scene.add(mesh);
      this.fallenCanopies.set(species, mesh);
    }
    if (needed > mesh.instanceMatrix.count) {
      mesh = this.growDebrisMesh(mesh, needed);
      this.fallenCanopies.set(species, mesh);
    }
    return mesh;
  }
  private syncBodies(
    bodies: BodyView[],
    alpha: number,
    packet?: SimulationSnapshot["packedBodies"],
    oldPacket?: SimulationSnapshot["packedBodies"],
  ) {
    const gpu = !!packet && !this.googlyEyes;
    if (this.bodyAlpha) {
      this.bodyAlpha.value = alpha;
      this.bodyGPUEnabled.value = gpu ? 1 : 0;
    }
    if (
      gpu &&
      bodies === this.syncedBodies &&
      oldPacket === this.syncedOldPacket
    )
      return;
    this.syncedOldPacket = oldPacket;
    this.wreckPosition ??= new THREE.Vector3();
    if (packet) this.bodyReader.bind(packet);
    if (oldPacket) {
      this.oldBodyReader.bind(oldPacket);
      if (this.oldPacked !== oldPacket) {
        this.oldPacked = oldPacket;
        this.oldBodyLookup.build(oldPacket);
      }
    }
    if (packet) {
      this.camera.updateMatrixWorld();
      this.bodyFrustum.setFromProjectionMatrix(
        this.bodyProjection.multiplyMatrices(
          this.camera.projectionMatrix,
          this.camera.matrixWorldInverse,
        ),
      );
    }
    const bodyAt = (i: number) =>
      packet ? this.bodyReader.read(i, this.bodyScratch) : bodies[i];
    if (bodies === this.syncedBodies && alpha === this.syncedBodyAlpha) return;
    const changed = bodies !== this.syncedBodies;
    this.syncedBodies = bodies;
    this.syncedBodyAlpha = alpha;
    if (changed) {
      const needed = new Map<string, number>();
      let treeCount = 0;
      const speciesNeeded = new Map<
        "pine" | "broadleaf" | "riverside",
        number
      >();
      const codes = (this.bodyNeeded ??= new Uint32Array(
        BODY_MATERIALS.length * 5,
      ));
      codes.fill(0);
      for (let i = 0; i < bodies.length; i++) {
        const tag = packet ? this.bodyReader.tags[i * 2 + 1] : 0;
        const b = packet ? undefined : bodies[i];
        if (packet ? (tag & 3) === 1 : b!.kind === "tree") {
          treeCount++;
          const source = packet
            ? this.bodyReader.identity[i * 2 + 1]
            : b!.source;
          const species = this.world.entities[source].treeSpecies ?? "pine";
          speciesNeeded.set(species, (speciesNeeded.get(species) ?? 0) + 1);
        } else {
          if (packet) codes[this.bodyReader.tags[i * 2] * 5 + (tag >>> 2)]++;
          else {
            const key = this.debrisKey(b!);
            needed.set(key, (needed.get(key) || 0) + 1);
          }
        }
      }
      if (packet)
        for (let code = 0; code < codes.length; code++) {
          if (!codes[code]) continue;
          needed.set(bodyKeys[Math.floor(code / 5)][code % 5], codes[code]);
        }
      for (const [key] of needed) {
        if (this.bodyMeshes.has(key)) continue;
        const [material, part] = key.split(":") as [
          Material,
          string | undefined,
        ];
        const mesh = new THREE.InstancedMesh(
          this.debrisGeometry({
            material,
            roofPart: part ? Number(part) : undefined,
          }),
          this.fragmentMaterials[material],
          64,
        );
        mesh.count = 0;
        mesh.frustumCulled = false;
        mesh.receiveShadow = true;
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        if (this.bodyAlpha)
          prepareDebrisMotion(mesh, this.bodyAlpha, this.bodyGPUEnabled);
        this.bodyMeshes.set(key, mesh);
        this.scene.add(mesh);
      }
      this.fallenTrunks = this.growDebrisMesh(this.fallenTrunks, treeCount);
      for (const [species, count] of speciesNeeded)
        this.fallenCanopy(species, count);
      this.fallenPines = this.growDebrisMesh(this.fallenPines, treeCount);
      for (const [material, count] of needed)
        this.bodyMeshes.set(
          material,
          this.growDebrisMesh(this.bodyMeshes.get(material)!, count),
        );
    }
    const counts = new Map<string, number>();
    let trees = 0;
    const canopyCounts = new Map<string, number>();
    for (let i = 0; i < bodies.length; i++) {
      if (packet) {
        const j = i * 10,
          t = this.bodyReader.transforms;
        const radius = t[j + 7] + t[j + 8] + t[j + 9];
        if (
          (t[j] - this.camera.position.x) ** 2 +
            (t[j + 2] - this.camera.position.z) ** 2 >
          (this.renderDistance + radius) ** 2
        )
          continue;
        this.bodySphere.center.set(t[j], t[j + 1], t[j + 2]);
        this.bodySphere.radius = radius + 40;
        if (!this.bodyFrustum.intersectsSphere(this.bodySphere)) continue;
      }
      const b = bodyAt(i);
      const previousIndex =
        packet && oldPacket ? this.oldBodyLookup.get(b.id) : 0;
      const previous =
        packet && oldPacket
          ? previousIndex
            ? this.oldBodyReader.read(previousIndex - 1, this.oldBodyScratch)
            : undefined
          : this.previousBodies.get(b.id);
      if (!gpu) {
        dummy.position.fromArray(b.p);
        dummy.quaternion.fromArray(b.q);
        if (previous && alpha < 1) {
          dummy.position.set(
            THREE.MathUtils.lerp(previous.p[0], b.p[0], alpha),
            THREE.MathUtils.lerp(previous.p[1], b.p[1], alpha),
            THREE.MathUtils.lerp(previous.p[2], b.p[2], alpha),
          );
          this.debrisRotation
            .fromArray(previous.q)
            .slerp(dummy.quaternion, alpha);
          dummy.quaternion.copy(this.debrisRotation);
        }
      }
      if (b.kind === "tree") {
        if (gpu) {
          const e = this.world.entities[b.source],
            height = b.s[1],
            species = e.treeSpecies ?? "pine",
            index = canopyCounts.get(species) ?? 0;
          b.s[1] = height * 2;
          writeDebrisMotion(this.fallenTrunks, trees, b, previous);
          this.fallenTrunks.setColorAt(
            trees,
            this.fragmentColor.setHSL(0.12, 0.06, 0.77 + e.variant * 0.16),
          );
          const offset = (p: number[], q: number[], h: number) => {
            p[0] -= 2 * (q[0] * q[1] - q[2] * q[3]) * h;
            p[1] -= (1 - 2 * (q[0] * q[0] + q[2] * q[2])) * h;
            p[2] -= 2 * (q[1] * q[2] + q[0] * q[3]) * h;
          };
          offset(b.p, b.q, height);
          if (previous) offset(previous.p, previous.q, previous.s[1]);
          b.s[0] = b.s[2] = (e.s[0] * 1.45 * height) / e.s[1];
          const canopy = this.fallenCanopy(species);
          writeDebrisMotion(canopy, index, b, previous);
          canopy.setColorAt(
            index,
            this.fragmentColor.setHSL(
              species === "broadleaf"
                ? 0.2
                : species === "riverside"
                  ? 0.27
                  : 0.24,
              0.18,
              0.77 + e.variant * 0.16,
            ),
          );
          canopyCounts.set(species, index + 1);
          trees++;
          continue;
        }
        const e = this.world.entities[b.source];
        dummy.scale.set(b.s[0], b.s[1] * 2, b.s[2]);
        dummy.updateMatrix();
        this.fallenTrunks.setMatrixAt(trees, dummy.matrix);
        this.fallenTrunks.setColorAt(trees, this.fragmentColor.setScalar(1));
        dummy.position.add(
          this.wreckPosition
            .set(0, -b.s[1], 0)
            .applyQuaternion(dummy.quaternion),
        );
        const ratio = b.s[1] / e.s[1];
        dummy.scale.set(
          e.s[0] * 1.45 * ratio,
          b.s[1] * 2,
          e.s[0] * 1.45 * ratio,
        );
        dummy.updateMatrix();
        const species = e.treeSpecies ?? "pine",
          index = canopyCounts.get(species) ?? 0;
        this.fallenCanopy(species).setMatrixAt(index, dummy.matrix);
        this.fallenCanopy(species).setColorAt(
          index,
          this.fragmentColor.setScalar(1),
        );
        canopyCounts.set(species, index + 1);
        trees++;
        continue;
      }
      const key = this.debrisKey(b);
      let mesh = this.bodyMeshes.get(key)!,
        index = counts.get(key) || 0;
      if (gpu) writeDebrisMotion(mesh, index, b, previous);
      else {
        dummy.scale.fromArray(b.s);
        dummy.updateMatrix();
        mesh.setMatrixAt(index, dummy.matrix);
      }
      if (changed)
        mesh.setColorAt(
          index,
          this.fragmentColor.setScalar(0.86 + (b.id % 19) / 70),
        );
      counts.set(key, index + 1);
    }
    for (const [species, mesh] of [
      ["pine", this.fallenPines],
      ["trunk", this.fallenTrunks],
      ...(this.fallenCanopies ?? new Map()).entries(),
    ] as [string, THREE.InstancedMesh][]) {
      const count =
        species === "trunk" ? trees : (canopyCounts.get(species) ?? 0);
      mesh.count = count;
      uploadDebrisMotion(mesh);
      if (mesh.instanceColor && count) {
        mesh.instanceColor.clearUpdateRanges();
        mesh.instanceColor.addUpdateRange(0, count * 3);
        mesh.instanceColor.needsUpdate = true;
      }
      mesh.instanceMatrix.clearUpdateRanges();
      if (count) {
        mesh.instanceMatrix.addUpdateRange(0, count * 16);
        mesh.instanceMatrix.needsUpdate = true;
      }
    }
    for (const [mat, mesh] of this.bodyMeshes) {
      mesh.count = counts.get(mat) || 0;
      uploadDebrisMotion(mesh);
      mesh.instanceMatrix.clearUpdateRanges();
      mesh.instanceColor?.clearUpdateRanges();
      if (mesh.count) {
        mesh.instanceMatrix.addUpdateRange(0, mesh.count * 16);
        mesh.instanceMatrix.needsUpdate = true;
        if (changed && mesh.instanceColor) {
          mesh.instanceColor.addUpdateRange(0, mesh.count * 3);
          mesh.instanceColor.needsUpdate = true;
        }
      }
    }
  }
  render(dt: number, active: boolean, frameTime = performance.now()) {
    if (active && !this.wasActive) {
      this.averageMS = 1000 / 60;
      this.cpuMS = 0;
      this.auto.resume();
    }
    this.wasActive = active;
    const workStarted = performance.now(),
      optionalDeadline = workStarted + 2;
    this.gpu.poll();
    this.performance.record(
      "textureUpload",
      this.terrain.uploadTextures(
        this.renderer,
        Math.max(0, optionalDeadline - performance.now()),
      ),
    );
    this.performance.queues.textureUploads = this.terrain.textureQueue;
    if (active) this.performance.record("frame", dt * 1000);
    this.frame++;
    if (active) this.elapsed += dt;
    if (active)
      this.averageMS = this.averageMS * 0.95 + Math.min(dt * 1000, 200) * 0.05;
    const playback = this.timeline.sample(frameTime, active);
    if (!playback) return;
    const snap = playback.current;
    this.performance.queues.packetPoolBusy = snap.stats.packetPoolBusy ?? 0;
    this.performance.queues.packetPoolBytes = snap.stats.packetPoolBytes ?? 0;
    this.performance.queues.activeBodies = snap.stats.bodies;
    this.performance.queues.ballisticBodies = snap.stats.ballistic;
    this.performance.queues.permanentRuins = snap.stats.ruins;
    const alpha = playback.alpha;
    if (active && playback.current === playback.previous)
      this.performance.starvation++;
    this.performance.queues.workerLagMS = Math.max(
      0,
      frameTime - this.lastArrival - 33.3,
    );
    this.performance.record(
      "workerStep",
      snap.stats.stepMS ?? snap.stats.physicsMS,
    );
    this.performance.record("destruction", snap.stats.destructionMS);
    if (snap.stats.saveSliceMS !== undefined)
      this.performance.record("saveSlice", snap.stats.saveSliceMS);
    if (snap.stats.snapshotMS !== undefined)
      this.performance.record("snapshot", snap.stats.snapshotMS);
    for (const [stage, ms] of Object.entries(snap.stats.stageMS || {}))
      this.performance.record("sim:" + stage, ms);
    this.performance.queues.destruction = snap.stats.pendingJobs;
    if (this.previous !== playback.previous) {
      this.previous = playback.previous;
      this.previousBodies.clear();
      if (!this.previous.packedBodies)
        for (const body of this.previous.bodies)
          this.previousBodies.set(body.id, body);
      this.previousProjectiles.clear();
      for (const shot of this.previous.projectiles)
        this.previousProjectiles.set(shot.id, shot);
      this.previousSpikes.clear();
      for (const spike of this.previous.monsterSpikes)
        this.previousSpikes.set(spike.id, spike);
    }
    const dancing = discoActive(snap.lasers);
    this.disco.update(
      dancing,
      active ? dt : dancing && this.disco.amount.value === 0 ? 0.75 : 0,
      snap.time,
      (x, z) => this.terrain.sample(x, z),
      this.effects.reduced,
    );
    const p = snap.plane;
    const { position, rotation, discontinuity } = flightPose(
      this.previous?.plane,
      p,
      alpha,
    );
    if (discontinuity) this.readyCamera = false;
    this.jet.position.copy(position);
    this.jet.quaternion.copy(rotation);
    this.jet.visible = p.crashed <= 0;
    for (const flame of this.jet.children.filter((c) => c.name === "flame"))
      flame.scale.y =
        0.8 + Math.sin(this.elapsed * 42) * 0.13 + (p.speed > 95 ? 0.7 : 0);
    const f = new THREE.Vector3(0, 0, 1).applyQuaternion(rotation);
    let target = position.clone().addScaledVector(f, 40);
    let desired = position
      .clone()
      .addScaledVector(f, -30)
      .add(new THREE.Vector3(0, 10, 0));
    if (this.rig.mode === "cinematic") {
      const shot = this.rig.cinematic(position, f, active ? dt : 0);
      desired.copy(shot.position);
      target.copy(shot.target);
    }
    const fov =
      this.rig.mode === "photo"
        ? this.rig.fov
        : this.rig.mode === "cinematic"
          ? 72
          : 64;
    if (this.camera.fov !== fov) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    desired.y = Math.max(
      desired.y,
      this.terrain.sample(desired.x, desired.z) + 5,
    );
    // Shorten the camera boom against surviving structure boxes and major rubble.
    if (!this.inspect && this.rig.mode !== "photo") {
      const ray = desired.clone().sub(position),
        len = ray.length();
      this.cameraRay.set(position, ray.normalize());
      let limit = len;
      const box = this.cameraBox,
        candidates = this.cameraCandidates;
      const cell =
        Math.floor(position.x / 32) + Math.floor(position.z / 32) * 192;
      if (cell !== this.cameraCell) {
        this.cameraCell = cell;
        candidates.clear();
        for (
          let z = Math.max(0, Math.floor((position.z - 90) / 64));
          z <= Math.min(CHUNKS - 1, Math.floor((position.z + 90) / 64));
          z++
        )
          for (
            let x = Math.max(0, Math.floor((position.x - 90) / 64));
            x <= Math.min(CHUNKS - 1, Math.floor((position.x + 90) / 64));
            x++
          )
            for (const e of this.cameraCells.get(z * CHUNKS + x) || [])
              candidates.add(e);
      }
      for (const e of candidates) {
        if (
          e.kind === "tree" ||
          this.removed.has(e.id) ||
          Math.abs(e.p[0] - position.x) > 100 ||
          Math.abs(e.p[2] - position.z) > 100
        )
          continue;
        box.min.set(e.p[0] - e.s[0], e.p[1] - e.s[1], e.p[2] - e.s[2]);
        box.max.set(e.p[0] + e.s[0], e.p[1] + e.s[1], e.p[2] + e.s[2]);
        const hit = this.cameraRay.ray.intersectBox(box, this.cameraHit);
        if (hit)
          limit = Math.min(limit, Math.max(5, position.distanceTo(hit) - 2));
      }
      const collideWreck = (r: BodyView | Ruin) => {
        if (
          Math.abs(r.p[0] - position.x) > 100 ||
          Math.abs(r.p[2] - position.z) > 100
        )
          return;
        const transform = this.wreckTransform.compose(
          this.wreckPosition.fromArray(r.p),
          this.wreckRotation.fromArray(r.q),
          this.unitScale,
        );
        const local = this.wreckRay
          .copy(this.cameraRay.ray)
          .applyMatrix4(this.wreckInverse.copy(transform).invert());
        box.min.set(-r.s[0], -r.s[1], -r.s[2]);
        box.max.fromArray(r.s);
        const hit = local.intersectBox(box, this.wreckHit);
        if (hit)
          limit = Math.min(
            limit,
            Math.max(5, position.distanceTo(hit.applyMatrix4(transform)) - 2),
          );
      };
      for (
        let z = clamp(Math.floor((position.z - 90) / 64), 0, CHUNKS - 1);
        z <= clamp(Math.floor((position.z + 90) / 64), 0, CHUNKS - 1);
        z++
      )
        for (
          let x = clamp(Math.floor((position.x - 90) / 64), 0, CHUNKS - 1);
          x <= clamp(Math.floor((position.x + 90) / 64), 0, CHUNKS - 1);
          x++
        )
          for (const id of this.ruinCells.get(z * CHUNKS + x) || [])
            collideWreck(this.ruins.get(id)!);
      if (snap.packedBodies) {
        this.bodyReader.bind(snap.packedBodies);
        const data = this.bodyReader.transforms;
        for (let i = 0; i < snap.packedBodies.count; i++) {
          const j = i * 10;
          if (
            Math.abs(data[j] - position.x) <= 100 &&
            Math.abs(data[j + 2] - position.z) <= 100
          )
            collideWreck(this.bodyReader.read(i, this.bodyScratch));
        }
      } else for (const r of snap.bodies) collideWreck(r);
      for (let distance = 2; distance < len; distance += 2) {
        const point = position.clone().addScaledVector(ray, distance);
        if (point.y < this.terrain.sample(point.x, point.z) + 2) {
          limit = Math.min(limit, Math.max(2, distance - 2));
          break;
        }
      }
      if (limit < len) desired.copy(position).addScaledVector(ray, limit);
    }
    if (!this.readyCamera) {
      this.cameraPosition.copy(desired);
      this.cameraTarget.copy(target);
      this.readyCamera = true;
    } else {
      this.cameraPosition.lerp(desired, 1 - Math.exp(-dt * 6));
      this.cameraTarget.lerp(target, 1 - Math.exp(-dt * 10));
    }
    this.camera.position.copy(this.cameraPosition);
    this.camera.up.copy(up);
    if (this.shakeEnabled && active) {
      let shake = this.effects.shake * 0.4;
      this.camera.position.add(
        new THREE.Vector3(
          (Math.random() - 0.5) * shake,
          (Math.random() - 0.5) * shake,
          0,
        ),
      );
    }
    this.camera.lookAt(this.cameraTarget);
    if (this.inspect) {
      this.camera.position.copy(this.inspect.p);
      this.camera.lookAt(this.inspect.target);
    }
    if (this.rig.mode === "photo")
      this.rig.applyPhoto(this.camera, (x, z) => this.terrain.sample(x, z));
    this.sky.position.copy(this.camera.position);
    this.updateRuins(Math.max(0, optionalDeadline - performance.now()));
    const bodiesStarted = performance.now();
    this.syncBodies(
      snap.bodies,
      alpha,
      snap.packedBodies,
      this.previous?.packedBodies,
    );
    this.performance.record("bodies", performance.now() - bodiesStarted);
    const actorsStarted = performance.now();
    this.civilians.update(
      snap,
      this.previous,
      alpha,
      this.camera.position,
      this.renderDistance,
      this.camera,
    );
    this.ensureMonsterMeshes(snap.monsters.length);
    this.monsterFragmentView.begin(this.googlyEyes);
    this.nearMonsterView.begin(this.googlyEyes);
    this.distantMonsterView.begin(this.googlyEyes);
    for (let i = 0; i < this.monsterMeshes.length; i++) {
      const mesh = this.monsterMeshes[i],
        distant = this.distantMonsters[i];
      const m = snap.monsters[i];
      mesh.visible = distant.visible = !!m && (!m.defeated || !!m.ragdoll);
      if (m?.fragments?.length) {
        const previous = this.previous?.monsters[m.id]?.fragments;
        const root = this.monsterFragmentRoot;
        for (const fragment of m.fragments) {
          if (
            (fragment.p[0] - this.camera.position.x) ** 2 +
              (fragment.p[2] - this.camera.position.z) ** 2 >
            (this.renderDistance + 40) ** 2
          )
            continue;
          const old = previous?.find((p) => p.part === fragment.part);
          root.position.fromArray(fragment.p);
          root.quaternion.fromArray(fragment.q);
          if (old) {
            root.position.set(
              ...(fragment.p.map((v, i) =>
                THREE.MathUtils.lerp(old.p[i], v, alpha),
              ) as [number, number, number]),
            );
            root.quaternion
              .fromArray(old.q)
              .slerp(
                this.monsterFragmentQuaternion.fromArray(fragment.q),
                alpha,
              );
          }
          root.scale.setScalar(MONSTER_SCALE);
          this.monsterFragmentView.add(fragment.part, root);
        }
        continue;
      }
      if (!m || (m.defeated && !m.ragdoll)) {
        if (mesh.parent) this.scene.remove(mesh);
        if (distant.parent) this.scene.remove(distant);
        continue;
      }
      if (
        (m.p[0] - this.camera.position.x) ** 2 +
          (m.p[2] - this.camera.position.z) ** 2 >
        (this.renderDistance + 90) ** 2
      ) {
        mesh.visible = distant.visible = false;
        if (mesh.parent) this.scene.remove(mesh);
        if (distant.parent) this.scene.remove(distant);
        continue;
      }
      const old = this.previous?.monsters[m.id];
      if (old && old.defeated === m.defeated)
        mesh.position.set(
          THREE.MathUtils.lerp(old.p[0], m.p[0], alpha),
          THREE.MathUtils.lerp(old.p[1], m.p[1], alpha),
          THREE.MathUtils.lerp(old.p[2], m.p[2], alpha),
        );
      else mesh.position.fromArray(m.p);
      if (m.ragdoll) {
        mesh.quaternion.fromArray(m.ragdoll);
        if (old?.ragdoll) {
          mesh.quaternion
            .fromArray(old.ragdoll)
            .slerp(new THREE.Quaternion().fromArray(m.ragdoll), alpha);
        }
        mesh.scale.setScalar(MONSTER_SCALE);
        distant.position.copy(mesh.position);
        distant.quaternion.copy(mesh.quaternion);
        distant.scale.setScalar(MONSTER_SCALE);
        if (this.camera.position.distanceTo(mesh.position) < 480) {
          const sway = Math.sin(m.phase) * m.stagger * 0.25;
          this.nearMonsterView.add(mesh, 0.35 + sway, -0.35 - sway, sway * 0.2);
        } else this.distantMonsterView.add(distant);
        continue;
      }
      mesh.rotation.x = 0;
      const beat = Math.sin(snap.time * Math.PI * 4 + m.id * 0.7);
      mesh.rotation.y = m.yaw + (dancing ? beat * 0.28 : 0);
      mesh.rotation.z = dancing ? beat * 0.1 : 0;
      if (dancing) mesh.position.y += Math.max(0, beat) * 2;
      distant.position.copy(mesh.position);
      distant.rotation.y = mesh.rotation.y;
      distant.rotation.z = mesh.rotation.z;
      distant.scale.setScalar(MONSTER_SCALE);
      const detail = this.camera.position.distanceTo(mesh.position) < 480;
      mesh.visible = detail;
      distant.visible = !detail;
      if (mesh.parent) this.scene.remove(mesh);
      if (distant.parent) this.scene.remove(distant);
      if (!detail) {
        this.distantMonsterView.add(distant);
        continue;
      }
      const crawl = Math.sin(m.phase * 0.2) * (m.stagger > 0 ? 0.05 : 0.23);
      const left = dancing ? -0.65 - beat * 0.45 : m.windup > 0 ? -0.6 : crawl;
      const right = dancing ? 0.65 - beat * 0.45 : m.windup > 0 ? 0.6 : -crawl;
      mesh.scale.setScalar(
        MONSTER_SCALE *
          (m.stagger > 0 ? 1 + Math.sin(this.elapsed * 35) * 0.025 : 1),
      );
      this.nearMonsterView.add(
        mesh,
        left,
        right,
        Math.sin(m.phase * 0.09) * 0.08,
      );
    }
    this.monsterFragmentView.finish(this.googlyEyes);
    this.nearMonsterView.finish(this.googlyEyes);
    this.distantMonsterView.finish(this.googlyEyes);
    while (this.spikeMeshes.length < snap.monsterSpikes.length) {
      const spike = new THREE.Mesh(
        new THREE.ConeGeometry(0.75, 5, 5),
        new THREE.MeshStandardMaterial({
          color: "#518329",
          emissive: "#163909",
          emissiveIntensity: 0.6,
        }),
      );
      spike.scale.setScalar(MONSTER_SCALE);
      this.spikeMeshes.push(spike);
      this.scene.add(spike);
    }
    for (let i = 0; i < this.spikeMeshes.length; i++) {
      const spike = this.spikeMeshes[i],
        s = snap.monsterSpikes[i];
      spike.visible = !!s;
      if (s) {
        const old = this.previousSpikes.get(s.id);
        if (old)
          spike.position.set(
            ...(s.p.map((v, k) => THREE.MathUtils.lerp(old.p[k], v, alpha)) as [
              number,
              number,
              number,
            ]),
          );
        else spike.position.fromArray(s.p);
        spike.quaternion.setFromUnitVectors(
          up,
          new THREE.Vector3(...s.v).normalize(),
        );
      }
    }
    if (!this.googlyEyes) {
      for (const shot of this.shotMeshes) shot.visible = false;
      this.projectileView.update(
        snap.projectiles,
        this.previousProjectiles,
        alpha,
      );
      if (active && this.frame % 6 === 0)
        for (const shot of snap.projectiles)
          if (shot.weapon === "cannon") this.effects.trail(shot.p, shot.v);
    } else {
      this.projectileView.reset();
      // Eye-enabled shots retain individual eye anchors.
      while (this.shotMeshes.length < snap.projectiles.length) {
        const shot = makePineapple();
        shot.traverse((object) => {
          if (
            object instanceof THREE.Mesh &&
            object.material instanceof THREE.MeshStandardMaterial
          )
            this.disco.decorate(object.material);
        });
        this.shotMeshes.push(shot);
        this.scene.add(shot);
      }
      for (let i = 0; i < this.shotMeshes.length; i++) {
        const shot = this.shotMeshes[i],
          s = snap.projectiles[i];
        shot.visible = !!s;
        if (s) {
          const old = this.previousProjectiles.get(s.id);
          if (old)
            shot.position.set(
              ...(s.p.map((v, k) =>
                THREE.MathUtils.lerp(old.p[k], v, alpha),
              ) as [number, number, number]),
            );
          else shot.position.fromArray(s.p);
          shot.scale.setScalar(WEAPONS[s.weapon].length / 3.3);
          if (active && s.weapon === "cannon" && this.frame % 6 === 0)
            this.effects.trail(s.p, s.v);
          shot.quaternion.setFromUnitVectors(
            new THREE.Vector3(0, 1, 0),
            new THREE.Vector3(...s.v).normalize(),
          );
        }
      }
    }
    this.marker.visible =
      this.rig.mode === "chase" && !!snap.aim && p.crashed <= 0;
    if (snap.aim) {
      this.marker.position.fromArray(snap.aim);
      this.marker.position.y += 0.3;
      this.marker.lookAt(this.camera.position);
      this.marker.scale.setScalar(
        clamp(
          this.camera.position.distanceTo(this.marker.position) / 150,
          0.8,
          3,
        ),
      );
    }
    this.performance.record("actors", performance.now() - actorsStarted);
    if (!active && this.lightingHour !== snap.hour) {
      this.nextReflection = this.nextShadow = -Infinity;
      this.shadowDirty = true;
    }
    this.lightingHour = snap.hour;
    this.lighting.update(snap.hour);
    const { daylight: day, night, lightDirection: ld } = this.lighting;
    this.sky.material.uniforms.day.value = day;
    this.sky.material.uniforms.twilight.value = this.lighting.twilight;
    this.sky.material.uniforms.time.value = snap.time;
    // Strike age keeps the atmosphere frozen with pause/photo mode and avoids
    // stacking darkness when several beams fire at once.
    let laserDim = 0;
    for (const strike of snap.lasers) {
      if (strike.phase !== "burning") continue;
      const age = strike.age - LASER.charge;
      const envelope = Math.min(
        THREE.MathUtils.smoothstep(age, 0, 0.25),
        THREE.MathUtils.smoothstep(LASER.beam - age, 0, 0.5),
      );
      laserDim = Math.max(
        laserDim,
        envelope * (this.effects.reduced ? 0.14 : 0.28),
      );
    }
    this.sky.material.uniforms.laserDim.value = laserDim;
    const shadowCenter = this.shadowCenter.set(
      position.x,
      Math.max(0, this.terrain.sample(position.x, position.z)),
      position.z,
    );
    this.sun.position.copy(shadowCenter).addScaledVector(ld, 1000);
    this.sun.target.position.copy(shadowCenter);
    this.sun.intensity = this.lighting.sunIntensity;
    this.sun.color.copy(this.lighting.sunColor);
    this.ambient.intensity = this.lighting.ambientIntensity;
    this.ambient.color.copy(this.lighting.ambientColor);
    this.ambient.groundColor.copy(this.lighting.groundColor);
    this.materials.window.emissiveIntensity = night * 0.9;
    this.sun.intensity = THREE.MathUtils.lerp(
      this.sun.intensity,
      0.55,
      this.disco.skyAmount.value,
    );
    this.sun.color.lerp(this.discoSun, this.disco.skyAmount.value);
    this.ambient.intensity = THREE.MathUtils.lerp(
      this.ambient.intensity,
      1.25,
      this.disco.skyAmount.value,
    );
    this.ambient.color.lerp(this.discoAmbient, this.disco.skyAmount.value);
    this.villageLighting.update(
      this.camera.position,
      this.removed,
      night,
      this.renderDistance,
      dt,
    );
    this.water.material.uniforms.waterColor.value.copy(
      this.lighting.waterColor,
    );
    this.water.material.uniforms.sunDirection.value.copy(ld);
    this.water.material.uniforms.sunColor.value
      .copy(this.sun.color)
      .multiplyScalar(0.2 + day * 0.8);
    this.water.material.uniforms.time.value = snap.time;
    // Extending the terrain horizon must not extend detailed river residency.
    for (const child of this.rivers.children) {
      const bounds = (child as THREE.Mesh).geometry.boundingSphere!;
      const dx = bounds.center.x - this.camera.position.x;
      const dz = bounds.center.z - this.camera.position.z;
      child.visible =
        dx * dx + dz * dz < (this.renderDistance + bounds.radius) ** 2;
    }
    const terrainStarted = performance.now();
    this.terrain.update(
      this.camera.position,
      this.renderDistance,
      Math.max(0, optionalDeadline - performance.now()),
      this.quality === "auto" && this.auto.level >= 3 ? 0.75 : 1,
    );
    this.performance.record("terrain", performance.now() - terrainStarted);
    this.performance.record("terrainWorker", this.terrain.workerMS);
    this.performance.queues.terrain = this.terrain.queueDepth;
    this.performance.queues.terrainWorkerActive = this.terrain.workerActive
      ? 1
      : 0;
    this.flagGroup.visible = true;
    for (const flag of this.flagGroup.children) {
      let m = flag as THREE.Mesh<THREE.PlaneGeometry>;
      m.visible = !this.removed.has(m.userData.owner);
      let pos = m.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++)
        pos.setZ(i, Math.sin(pos.getY(i) * 1.5 + this.elapsed * 2) * 0.16);
      pos.needsUpdate = true;
    }
    if (
      this.rig.mode === "photo" ||
      this.elapsed - this.lastLOD > 0.25 ||
      this.frame < 3
    ) {
      for (const b of this.batches) {
        let d = Math.hypot(
          b.x - this.camera.position.x,
          b.z - this.camera.position.z,
        );
        b.mesh.castShadow = d < 280;
        if (b.low) {
          b.mesh.visible = d < 360;
          b.low.visible = d >= 360 && d < this.renderDistance + b.radius;
        } else if (b.kind === "trunk")
          b.mesh.visible = d < Math.min(700, this.renderDistance + 90);
        else b.mesh.visible = d < this.renderDistance + b.radius;
        for (const mesh of [b.mesh, b.low])
          if (mesh) {
            if (mesh.visible && mesh.count && !mesh.parent)
              this.scene.add(mesh);
            else if ((!mesh.visible || !mesh.count) && mesh.parent)
              this.scene.remove(mesh);
          }
      }
      this.lastLOD = this.elapsed;
    }
    if (this.elapsed >= this.nextShadow && (active || this.shadowDirty)) {
      this.renderer.shadowMap.needsUpdate = true;
      this.shadowDirty = false;
      this.nextShadow =
        this.elapsed +
        (this.quality === "auto" ? this.auto.shadowInterval : 1 / 24);
    }
    this.effects.ground = (x, z) => this.terrain.sample(x, z);
    const effectsStarted = performance.now();
    this.effects.update(active ? dt : 0);
    this.performance.record("effects", performance.now() - effectsStarted);
    this.effects.laser.reduced = this.effects.reduced;
    this.effects.laser.update(
      snap.lasers,
      active ? dt : 0,
      snap.time,
      this.camera.position,
      (x, z) => this.terrain.sample(x, z),
    );
    this.effects.dust.update(active ? dt : 0, this.camera, this.effects.ground);
    this.effects.nukeFlash.update(
      active ? dt : 0,
      this.camera,
      this.effects.reduced,
    );
    if (this.googlyEyes) {
      const roots = this.eyesRoots;
      roots.length = 0;
      roots.push(
        this.jet,
        this.flagGroup,
        this.disco.ball,
        this.nearMonsterView.faces,
        this.distantMonsterView.faces,
        this.monsterFragmentView.faces,
        this.fallenPines,
        this.fallenTrunks,
        this.effects.fragments.mesh,
      );
      for (const batch of this.batches) {
        roots.push(batch.mesh);
        if (batch.low) roots.push(batch.low);
      }
      for (const mesh of this.fallenCanopies.values()) roots.push(mesh);
      for (const mesh of this.bodyMeshes.values()) roots.push(mesh);
      for (const group of this.ruinGroups.values()) roots.push(group);
      for (const shot of this.shotMeshes) roots.push(shot);
      for (const spike of this.spikeMeshes) roots.push(spike);
      roots.push(this.villageLighting.mesh);
      for (const cloud of this.effects.cloudFaces) roots.push(cloud);
      this.eyes.update(roots, snap, this.jet.position);
    }
    this.performance.record("prepare", performance.now() - workStarted);
    this.gpu.begin("gpu");
    const drawStarted = performance.now();
    this.renderer.render(this.scene, this.camera);
    this.gpu.end();
    this.performance.record("submit", performance.now() - drawStarted);
    this.performance.queues.drawCalls = this.renderer.info.render.calls;
    this.performance.queues.geometries = this.renderer.info.memory.geometries;
    this.performance.queues.textures = this.renderer.info.memory.textures;
    this.cpuMS = this.cpuMS * 0.9 + (performance.now() - workStarted) * 0.1;
    for (const s of this.retired) {
      if (s !== this.last && s !== this.previous && s !== snap) {
        this.recycle?.(s);
        this.retired.delete(s);
      }
    }
    if (
      active &&
      this.quality === "auto" &&
      this.auto.update(frameTime, {
        frameMS: this.averageMS,
        cpuMS: this.cpuMS,
        gpuMS: this.gpu.lastMS,
        workerMS: snap.stats.stepMS ?? snap.stats.physicsMS,
        lagMS: this.performance.queues.workerLagMS,
      })
    ) {
      const height = this.auto.height;
      if (height !== this.targetHeight) {
        this.targetHeight = height;
        this.resize();
      }
      if (this.sun.shadow.mapSize.x !== this.auto.shadowSize) {
        this.sun.shadow.mapSize.set(this.auto.shadowSize, this.auto.shadowSize);
        this.sun.shadow.map?.dispose();
        this.sun.shadow.map = null;
        this.renderer.shadowMap.needsUpdate = true;
      }
      this.effects.reduced = this.reducedEffects || this.auto.level >= 2;
      this.lastLOD = -Infinity;
    }
  }

  dispose() {
    this.disposed = true;
    this.timeline.reset();
    this.last = this.previous = undefined;
    for (const snapshot of this.retired) this.recycle?.(snapshot);
    this.retired.clear();
    this.motionFrames.clear();
    this.ruinBuild?.return(undefined);
    this.gpu.dispose();
    this.terrain.dispose();
    this.effects.reset();
    for (const b of this.batches) {
      this.scene.add(b.mesh);
      if (b.low) this.scene.add(b.low);
    }
    for (const group of this.ruinGroups.values()) this.scene.add(group);
    for (const mesh of this.effects.prewarmMeshes) this.scene.add(mesh);
    this.eyes.dispose();
    this.nearMonsterView.disposeFaces();
    this.distantMonsterView.disposeFaces();
    this.monsterFragmentView?.disposeFaces();
    const geometries = new Set<THREE.BufferGeometry>(),
      materials = new Set<THREE.Material>(),
      textures = new Set<THREE.Texture>();
    // Water keeps its render target in a closure. r180 records the owner on the
    // sampled texture; disposing only that texture leaves its framebuffer behind.
    const reflectionTexture = this.water.material.uniforms.mirrorSampler.value;
    const reflection = this.renderer.properties.get(reflectionTexture) as {
      __renderTarget?: THREE.WebGLRenderTarget;
    };
    reflection.__renderTarget?.dispose();
    this.sun.shadow.dispose();
    this.scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (mesh.customDepthMaterial) materials.add(mesh.customDepthMaterial);
      if (mesh.geometry) geometries.add(mesh.geometry);
      if (mesh.material)
        for (const m of Array.isArray(mesh.material)
          ? mesh.material
          : [mesh.material])
          materials.add(m);
      if ((mesh as THREE.InstancedMesh).isInstancedMesh)
        (mesh as THREE.InstancedMesh).dispose();
    });
    for (const material of materials) {
      for (const value of Object.values(material))
        if (value instanceof THREE.Texture) textures.add(value);
      if (material instanceof THREE.ShaderMaterial)
        for (const uniform of Object.values(material.uniforms)) {
          if (uniform.value instanceof THREE.Texture)
            textures.add(uniform.value);
          else if (Array.isArray(uniform.value))
            for (const value of uniform.value)
              if (value instanceof THREE.Texture) textures.add(value);
        }
      material.dispose();
    }
    for (const geometry of geometries) geometry.dispose();
    for (const texture of textures) texture.dispose();
    this.terrain.heightTexture.dispose();
    this.terrain.floodTexture.dispose();
    this.renderer.dispose();
  }
  releaseLostGeometry() {
    this.graphicsLost = true;
    this.gpu.contextLost();
    const seen = new Set<THREE.BufferGeometry>();
    for (const c of this.terrain.chunks) {
      seen.add(c.mesh.geometry);
      c.mesh.geometry.dispose();
    }
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if ((o as THREE.InstancedMesh).isInstancedMesh)
        (o as THREE.InstancedMesh).dispose();
      if (mesh.geometry && !seen.has(mesh.geometry)) {
        seen.add(mesh.geometry);
        mesh.geometry.dispose();
      }
    });
  }
  async recoverGraphics() {
    // Let an interrupted warmup restore its temporary visibility before starting
    // the new context's warmup. It cancels its own poll within ten milliseconds.
    await this.warming;
    if (this.disposed) return;
    this.graphicsLost = false;
    this.gpu.contextRestored();
    this.terrain.fullTextureUpload();
    this.renderer.shadowMap.needsUpdate = true;
    this.resize();
    await this.prewarm();
  }
  setChase() {
    this.rig.chase();
    this.readyCamera = false;
  }
  toggleCinematic() {
    this.rig.toggle();
    if (this.rig.mode === "chase") this.readyCamera = false;
  }
  cameraDirection(): [number, number, number] {
    return this.camera.getWorldDirection(new THREE.Vector3()).toArray() as [
      number,
      number,
      number,
    ];
  }
  capture(): Promise<Blob> {
    this.renderer.render(this.scene, this.camera);
    return new Promise((resolve, reject) =>
      this.canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(Error("Capture unavailable"))),
        "image/png",
      ),
    );
  }
  inspectCamera(p: number[], target: number[]) {
    this.lastLOD = -Infinity;
    this.nextReflection = -Infinity;
    this.inspect = {
      p: new THREE.Vector3().fromArray(p),
      target: new THREE.Vector3().fromArray(target),
    };
  }
  clearInspect() {
    this.inspect = undefined;
    this.readyCamera = false;
  }
  get stats() {
    return {
      cameraMode: this.rig.mode,
      effectTime: this.elapsed,
      fps: 1000 / this.averageMS,
      width: this.canvas.width,
      height: this.canvas.height,
      drawCalls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      geometries: this.renderer.info.memory.geometries,
      textures: this.renderer.info.memory.textures,
      quality: this.targetHeight,
      renderDistance: this.renderDistance,
      clouds: this.effects.cloudCount,
      fragments: this.effects.fragments.count,
      projectiles:
        this.projectileView.count +
        this.shotMeshes.filter((s) => s.visible).length,
      googlyFaces: this.eyes.count,
    };
  }
}
