import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import {
  CHUNKS,
  clamp,
  CONFIG,
  DEFAULT_RENDER_DISTANCE,
  normalizeRenderDistance,
} from "../config";
import { isRoof } from "../debris-shape";
import { discoActive } from "../disco";
import { GPUTimer, PerformanceMonitor } from "../performance";
import {
  BODY_MATERIALS,
  PackedBodyLookup,
  PackedBodyReader,
} from "../sim/body-buffer";
import { bindMotion, motionFrame } from "../sim/motion-buffer";
import { SimulationCadence } from "../simulation-cadence";
import type {
  BodyView,
  CRTMode,
  Entity,
  Explosion,
  FragmentEffect,
  Material,
  Ruin,
  SimulationSnapshot,
  Vec3,
  WorldData,
  WorldDelta,
} from "../types";
import { ActorView } from "./actors";
import {
  createMaterials,
  fractureGeometry,
  fractureMaterials,
  makeJet,
  pineGeometry,
  roofFragmentGeometry,
  roofGeometry,
  treeCrownGeometry,
} from "./assets";
import { AutoQuality } from "./auto-quality";
import { CameraRig } from "./camera-rig";
import {
  prepareDebrisMotion,
  resizeDebrisMotion,
  uploadDebrisMotion,
  writeDebrisMotion,
} from "./debris-motion";
import { Effects } from "./effects";
import { EnvironmentView } from "./environment";
import { flightPose } from "./flight-pose";
import { jetExhaustProfile } from "./jet-exhaust";
import { Presentation } from "./presentation";
import { qualityProfile, type RenderQualityProfile } from "./quality-profile";
import { sceneResources } from "./resource-budget";
import { ResourceDisposal } from "./resource-disposal";
import { SnapshotTimeline } from "./snapshot-timeline";
import { TerrainView } from "./terrain-view";
import { WorldBatches } from "./world-batches";
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
  private environment: EnvironmentView;
  private get sun() {
    return this.environment.sun;
  }
  private get sky() {
    return this.environment.sky;
  }
  private get lighting() {
    return this.environment.lighting;
  }

  private worldView: WorldBatches;
  private actors: ActorView;
  get civilians() {
    return this.actors.civilians;
  }
  private get batches() {
    return this.worldView.batches;
  }
  private get removed() {
    return this.worldView.removed;
  }

  readonly rig = new CameraRig();
  private cameraCells = new Map<number, Entity[]>();
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(64, 1, 0.5, 2800);
  readonly terrain: TerrainView;
  readonly effects = new Effects();
  readonly jet = makeJet();
  readonly performance = new PerformanceMonitor(4096);
  warmupStages: Record<string, number> = {};
  get assetLoadingStages() {
    return {};
  }
  private gpu: GPUTimer;
  private warming?: Promise<void>;
  private disposed = false;
  private graphicsLost = false;
  private auto = new AutoQuality();
  private presentation: Presentation;
  private cadence = new SimulationCadence();
  private nextResources = 0;
  private cachedProfile?: {
    selection: string;
    level: number;
    value: RenderQualityProfile;
  };
  get visualProfile() {
    if (
      !this.cachedProfile ||
      this.cachedProfile.selection !== this.quality ||
      this.cachedProfile.level !== this.auto.level
    )
      this.cachedProfile = {
        selection: this.quality,
        level: this.auto.level,
        value: Object.freeze(qualityProfile(this.quality, this.auto.level)),
      };
    return this.cachedProfile.value;
  }
  setPhotoExposure(value: number) {
    this.renderer.toneMappingExposure = THREE.MathUtils.clamp(value, 0.4, 2.2);
  }
  setPhotoFocus(value: number) {
    this.presentation.setFocus(value);
  }

  private nextShadow = 0;
  private shadowDirty = true;
  private lightingHour = NaN;
  private lastArrival = 0;
  private reducedEffects = false;
  private cpuMS = 0;
  private wasActive = false;
  readonly materials: ReturnType<typeof createMaterials>["materials"];
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
  private syncedBodyAlpha = -1;
  private debrisRotation = new THREE.Quaternion();
  private fallenPines: THREE.InstancedMesh;
  private fallenCanopies = new Map<string, THREE.InstancedMesh>();
  private crownGeometries = new Map<string, THREE.BufferGeometry>();
  private fallenTrunks: THREE.InstancedMesh;
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
  private targetHeight = this.auto.height;
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
  private settledTrunkMaterial?: THREE.Material;
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
      antialias: false,
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
    this.presentation = new Presentation(
      this.renderer,
      this.scene,
      this.camera,
    );
    this.presentation.onPass = (name, ms) =>
      this.performance.record(name + "Submit", ms);
    const shadowRender = this.renderer.shadowMap.render.bind(
      this.renderer.shadowMap,
    );
    this.renderer.shadowMap.render = (lights, scene, camera) => {
      const updating = this.renderer.shadowMap.needsUpdate,
        started = performance.now(),
        programsBefore = this.renderer.info.programs?.length ?? 0;
      shadowRender(lights, scene, camera);
      if (updating) {
        this.performance.record("shadowSubmit", performance.now() - started);
        this.performance.queues.shadowShaderProgramsCreated =
          (this.performance.queues.shadowShaderProgramsCreated ?? 0) +
          Math.max(
            0,
            (this.renderer.info.programs?.length ?? 0) - programsBefore,
          );
      }
    };
    this.gpu = new GPUTimer(
      this.renderer.getContext() as WebGL2RenderingContext,
      this.performance,
    );
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
    this.environment = new EnvironmentView(
      this.scene,
      this.terrain,
      world,
      this.materials,
      this.visualProfile.shadowSize,
    );
    this.scene.add(this.terrain.group, this.effects.group, this.jet);
    this.worldView = new WorldBatches(this.scene, world, this.materials);
    this.actors = new ActorView(this.scene, world, this.terrain, this.effects);
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
    const markerBands = [
      [3.6, 3.9, 0x071015],
      [3.9, 4.3, 0xffe29a],
      [4.3, 4.6, 0x071015],
    ].map(([inner, outer, tint]) => {
      const geometry = new THREE.RingGeometry(inner, outer, 40);
      const colors = new Float32Array(geometry.attributes.position.count * 3);
      const color = new THREE.Color(tint);
      for (let i = 0; i < geometry.attributes.position.count; i++)
        color.toArray(colors, i * 3);
      geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      return geometry;
    });
    const markerGeometry = mergeGeometries(markerBands)!;
    markerBands.forEach((geometry) => geometry.dispose());
    this.marker = new THREE.Mesh(
      markerGeometry,
      new THREE.MeshBasicMaterial({
        vertexColors: true,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 1,
        toneMapped: false,
        depthWrite: false,
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
    this.camera.position.fromArray(world.spawn);
    this.camera.lookAt(world.castle[0], world.castle[1], world.castle[2]);
    this.camera.updateMatrixWorld();
    this.setRenderDistance(this.renderDistance);
    this.resize();
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
    this.warmupStages = {};
    let stageStarted = performance.now();
    const mark = (name: string) => {
      const now = performance.now();
      this.warmupStages[name] = now - stageStarted;
      stageStarted = now;
    };
    this.renderer.initTexture(this.terrain.heightTexture);
    this.renderer.initTexture(this.terrain.floodTexture);
    this.fallenCanopy("broadleaf");
    this.fallenCanopy("riverside");
    this.effects.prewarm();
    // Roof fragments omit instance colors, unlike ordinary airborne chunks.
    // Prepare every shape with its actual attributes before play.
    for (const material of Object.keys(this.fragmentMaterials) as Material[])
      if (isRoof(material))
        for (const roofPart of [1, 2, 3, 4]) {
          const key = this.debrisKey({ material, roofPart });
          if (this.bodyMeshes.has(key)) continue;
          const mesh = new THREE.InstancedMesh(
            this.debrisGeometry({ material, roofPart }),
            this.fragmentMaterials[material],
            64,
          );
          mesh.count = 0;
          mesh.frustumCulled = false;
          mesh.receiveShadow = true;
          mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
          prepareDebrisMotion(mesh, this.bodyAlpha, this.bodyGPUEnabled);
          this.bodyMeshes.set(key, mesh);
          this.scene.add(mesh);
        }
    for (const mesh of this.effects.prewarmMeshes) this.scene.add(mesh);
    const temporary: THREE.Mesh[] = [];
    // Streamed terrain arrives after warmup; its mapped, non-instanced shadow
    // program is absent from the coarse terrain (which does not cast shadows).
    const terrainWarmGeometry = this.terrain.material
      ? new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2)
      : undefined;
    if (terrainWarmGeometry) {
      terrainWarmGeometry.setAttribute(
        "color",
        new THREE.BufferAttribute(new Float32Array(12).fill(1), 3),
      );
      const mesh = new THREE.Mesh(terrainWarmGeometry, this.terrain.material);
      mesh.castShadow = mesh.receiveShadow = true;
      this.scene.add(mesh);
      temporary.push(mesh);
    }
    if (this.settledTrunkMaterial) {
      const mesh = new THREE.InstancedMesh(
        this.fallenTrunks.geometry,
        this.settledTrunkMaterial,
        1,
      );
      mesh.setColorAt(0, new THREE.Color(1, 1, 1));
      mesh.setMatrixAt(0, new THREE.Matrix4());
      mesh.receiveShadow = true;
      mesh.castShadow = true;
      this.scene.add(mesh);
      temporary.push(mesh);
    }
    for (const batch of this.batches)
      for (const mesh of [batch.mesh, batch.low])
        if (mesh && !mesh.parent) {
          this.scene.add(mesh);
          temporary.push(mesh);
        }
    // Settled rubble uses regular instancing, whereas airborne rubble has motion
    // attributes. Warm both shader programs before either can appear in combat.
    for (const material of Object.values(this.fragmentMaterials)) {
      const mesh = new THREE.InstancedMesh(this.fractureBox, material, 1);
      mesh.setColorAt(0, new THREE.Color(1, 1, 1));
      mesh.setMatrixAt(0, new THREE.Matrix4());
      mesh.receiveShadow = true;
      mesh.castShadow = true;
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
      if (o instanceof THREE.InstancedMesh) o.count = 1;
    });
    mark("variantAssemblyMS");
    try {
      // Keep polling cancellable: Three's compileAsync continues polling old
      // programs after a context loss/disposal. These properties are pinned to
      // the installed Three revision, as with our texture-upload adapter.
      const compiling = this.renderer.compile(this.scene, this.camera);
      mark("compileSubmitMS");
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
      mark("compileWaitMS");
      if (this.disposed || this.graphicsLost) return;
      this.renderer.shadowMap.needsUpdate = true;
      this.renderer.render(this.scene, this.camera);
      mark("shadowAndSceneWarmMS");
      this.presentation?.prewarm();
      this.presentation?.configure(
        this.visualProfile,
        this.reducedEffects,
        false,
      );
      this.presentation?.render();
      mark("postWarmMS");
      // The laser's light disappears with its inactive group. That changes
      // Three's light-count shader defines, so prepare the inactive variant as
      // well as the active one before normal flight can submit either.
      this.effects.group.traverse((object) => {
        if (object instanceof THREE.PointLight) object.visible = false;
      });
      this.renderer.render(this.scene, this.camera);
      this.presentation?.prewarm();
      this.presentation?.configure(
        this.visualProfile,
        this.reducedEffects,
        false,
      );
      this.presentation?.render();
      mark("inactiveEffectsWarmMS");
      // Wait asynchronously for queued preparation, only while gameplay is
      // paused. This does not block the driver or call finish/readPixels.
      if (typeof this.renderer.getContext === "function") {
        const gl = this.renderer.getContext() as WebGL2RenderingContext;
        const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
        if (fence) {
          gl.flush();
          try {
            while (gl.clientWaitSync(fence, 0, 0) === gl.TIMEOUT_EXPIRED) {
              await new Promise<void>((r) => setTimeout(r, 10));
              if (this.disposed || this.graphicsLost) return;
            }
          } finally {
            if (!this.graphicsLost) gl.deleteSync(fence);
          }
        }
      }
      mark("gpuCompletionWaitMS");
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
        if (
          (mesh as THREE.InstancedMesh).isInstancedMesh &&
          !this.batches.some((b) => b.mesh === mesh || b.low === mesh)
        )
          (mesh as THREE.InstancedMesh).dispose();
      }
      terrainWarmGeometry?.dispose();
    }
  }
  setCRTMode(mode: CRTMode) {
    this.presentation.setCRTMode(mode);
  }
  setReducedEffects(value: boolean) {
    this.reducedEffects = value;
    this.effects.reduced =
      value || (this.quality === "auto" && this.auto.level >= 2);
  }
  setQuality(q: string) {
    if (q === "auto" && this.quality !== "auto") this.auto = new AutoQuality();
    if (q !== this.quality) this.auto.resume();
    this.quality = q;
    this.setReducedEffects(this.reducedEffects);
    this.targetHeight = q === "auto" ? this.auto.height : Number(q);
    this.qualityChanged = performance.now();
    const size = this.visualProfile.shadowSize;
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
      this.renderer.shadowMap.needsUpdate = true;
    }
    this.lastLOD = -Infinity;
    this.resize();
  }
  /** Independent certification cases begin with the same startup quality. */
  resetAutoQuality() {
    this.auto = new AutoQuality();
    this.setQuality("auto");
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
    const drawing = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.presentation?.resize(drawing.x, drawing.y);
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
    this.worldView.restore(removed);
    for (const r of ruins) this.addRuin(r);
    this.effects.reset();
    this.actors.reset();
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

  delta(d: WorldDelta) {
    for (const id of d.removed) this.worldView.remove(id);
    for (const id of d.rubbleRemoved) this.removeRuin(id);
    for (const r of d.settled) this.addRuin(r);
    if (d.terrain) this.terrain.patch(d.terrain);
    if (d.flood) this.terrain.setFlood(d.flood);
    if (d.dry) this.terrain.setDry(d.dry);
    this.shadowDirty = true;
  }
  fragment(e: FragmentEffect) {
    this.effects.fragment(e, this.visualProfile.cosmetics);
  }
  explosion(e: Explosion) {
    this.effects.explosion(e, this.visualProfile.cosmetics);
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
          add(
            "trunk",
            this.fallenTrunks.geometry,
            this.settledTrunkMaterial ?? this.materials.wood,
          );
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
      for (const m of g.children)
        m.castShadow =
          d < 230 &&
          (!(m as THREE.Mesh).customDepthMaterial ||
            (this.visualProfile?.debrisShadows !== false &&
              !this.reducedEffects));
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
    const gpu = !!packet;
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
            previousHeight = previous?.s[1] ?? height,
            species = e.treeSpecies ?? "pine",
            index = canopyCounts.get(species) ?? 0;
          b.s[1] = height * 2;
          if (previous) previous.s[1] = previousHeight * 2;
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
          if (previous) offset(previous.p, previous.q, previousHeight);
          b.s[0] = b.s[2] = (e.s[0] * 1.45 * height) / e.s[1];
          if (previous)
            previous.s[0] = previous.s[2] =
              (e.s[0] * 1.45 * previousHeight) / e.s[1];
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
        const height = previous
          ? THREE.MathUtils.lerp(previous.s[1], b.s[1], alpha)
          : b.s[1];
        dummy.scale.set(
          previous
            ? THREE.MathUtils.lerp(previous.s[0], b.s[0], alpha)
            : b.s[0],
          height * 2,
          previous
            ? THREE.MathUtils.lerp(previous.s[2], b.s[2], alpha)
            : b.s[2],
        );
        dummy.updateMatrix();
        this.fallenTrunks.setMatrixAt(trees, dummy.matrix);
        this.fallenTrunks.setColorAt(trees, this.fragmentColor.setScalar(1));
        dummy.position.add(
          this.wreckPosition
            .set(0, -height, 0)
            .applyQuaternion(dummy.quaternion),
        );
        const ratio = height / e.s[1];
        dummy.scale.set(
          e.s[0] * 1.45 * ratio,
          height * 2,
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
        dummy.scale.set(
          ...(b.s.map((size, axis) =>
            THREE.MathUtils.lerp(previous?.s[axis] ?? size, size, alpha),
          ) as Vec3),
        );
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
      optionalDeadline = workStarted + 0.65;
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
    }
    const dancing = discoActive(snap.lasers);
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
    const exhaust = jetExhaustProfile(p.speed, this.elapsed * 42);
    for (const flame of this.jet.children) {
      if (flame.name === "flame") {
        flame.scale.y = exhaust.outerLength;
        const material = (flame as THREE.Mesh)
          .material as THREE.MeshBasicMaterial;
        material.opacity = exhaust.outerOpacity;
      } else if (flame.name === "flame-core") {
        flame.scale.y = exhaust.coreLength;
        const material = (flame as THREE.Mesh)
          .material as THREE.MeshBasicMaterial;
        material.opacity = exhaust.coreOpacity;
      }
    }
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
          : 64 + THREE.MathUtils.smoothstep(p.speed, 90, 120) * 5;
    if (this.camera.fov !== fov) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    this.rig.prepareBoom(desired, this.cameraPosition, dt, this.readyCamera);
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
      // The smoothed position has already passed terrain and structure checks.
      this.cameraPosition.copy(desired);
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
    this.actors.update(
      snap,
      this.previous,
      alpha,
      this.camera,
      this.renderDistance,
      active,
      this.frame,
      this.elapsed,
      dancing,
    );
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
      this.nextShadow = -Infinity;
      this.shadowDirty = true;
    }
    this.lightingHour = snap.hour;
    this.environment.update(
      snap,
      this.camera,
      position,
      this.renderDistance,
      this.effects.reduced,
    );
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
    this.performance.queues.renderRuins = this.dirtyRuinBatches.size;
    this.performance.queues.terrainWorkerActive = this.terrain.workerActive
      ? 1
      : 0;
    if (
      this.rig.mode === "photo" ||
      this.elapsed - this.lastLOD > 0.25 ||
      this.frame < 3
    ) {
      this.worldView.update(
        this.camera,
        this.renderDistance,
        this.visualProfile.treeDistance,
        this.visualProfile.name === "Recovery" ? 140 : 220,
      );
      this.lastLOD = this.elapsed;
    }
    if (this.elapsed >= this.nextShadow && (active || this.shadowDirty)) {
      this.renderer.shadowMap.needsUpdate = true;
      this.shadowDirty = false;
      this.nextShadow = this.elapsed + this.visualProfile.shadowInterval;
    }
    this.effects.ground = (x, z) => this.terrain.sample(x, z);
    const effectsStarted = performance.now();
    this.effects.setEnvironment(
      this.lighting.daylight,
      this.lighting.lightDirection,
      this.camera,
    );
    this.effects.update(active ? dt : 0);
    this.effects.fire.update(snap.fires ?? [], active ? dt : 0, this.effects.reduced, snap.time);
    this.performance.record("effects", performance.now() - effectsStarted);
    this.effects.laser.reduced = this.effects.reduced;
    this.effects.laser.update(
      snap.lasers,
      active ? dt : 0,
      snap.time,
      this.camera.position,
      (x, z) => this.terrain.sample(x, z),
      (x, z) => this.terrain.waterSurface(x, z),
    );
    this.effects.dust.update(active ? dt : 0, this.camera, this.effects.ground);
    this.effects.nukeFlash.update(
      active ? dt : 0,
      this.camera,
      this.reducedEffects,
    );
    this.performance.record("prepare", performance.now() - workStarted);
    // Thousands of alpha-tested falling leaf cards must not dominate the
    // shadow pass when Auto has already reduced foliage and cosmetic detail.
    const debrisShadows =
      this.visualProfile.debrisShadows && !this.reducedEffects;
    for (const [key, mesh] of this.bodyMeshes)
      mesh.castShadow = debrisShadows && !key.includes(":");
    for (const mesh of [
      this.fallenPines,
      this.fallenTrunks,
      ...this.fallenCanopies.values(),
    ])
      mesh.castShadow = debrisShadows;
    this.performance.queues.movingDebrisShadows = +debrisShadows;
    this.gpu.begin("gpu");
    const drawStarted = performance.now();
    this.renderer.info.autoReset = false;
    this.renderer.info.reset();
    this.performance.queues.shaderPrograms =
      this.renderer.info.programs?.length ?? 0;
    this.presentation.configure(
      this.visualProfile,
      this.reducedEffects,
      this.rig.mode === "photo",
    );
    this.presentation.render(dt);
    this.gpu.end();
    this.performance.record("submit", performance.now() - drawStarted);
    this.performance.queues.drawCalls = this.renderer.info.render.calls;
    this.performance.queues.geometries = this.renderer.info.memory.geometries;
    this.performance.queues.textures = this.renderer.info.memory.textures;
    this.performance.queues.triangles = this.renderer.info.render.triangles;
    this.performance.queues.simulationRatio = this.cadence.sample(
      frameTime,
      snap.time,
      active,
    );
    this.performance.queues.qualityLevel =
      this.quality === "auto" ? this.auto.level : -1;
    this.performance.queues.sceneHeight = this.presentation.size[1];
    this.performance.queues.sceneWidth = this.presentation.size[0];
    this.performance.queues.postProcessing = this.presentation.passCount;
    this.performance.queues.renderTargetBytes =
      this.presentation.targetBytes + this.sun.shadow.mapSize.x ** 2 * 8;
    if (this.elapsed >= this.nextResources) {
      Object.assign(
        this.performance.queues,
        sceneResources(this.scene, [
          this.terrain.heightTexture,
          this.terrain.floodTexture,
        ]),
      );
      this.nextResources = this.elapsed + 3;
    }
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
    this.presentation?.dispose();
    this.timeline.reset();
    this.last = this.previous = undefined;
    for (const snapshot of this.retired) this.recycle?.(snapshot);
    this.retired.clear();
    this.motionFrames.clear();
    this.ruinBuild?.return(undefined);
    this.gpu.dispose();
    this.terrain.dispose();
    const resources = new ResourceDisposal();
    this.worldView.dispose(resources);
    this.actors.dispose(resources);
    this.environment.dispose(resources);
    this.effects.dispose(resources);
    for (const group of this.ruinGroups.values()) resources.collect(group);
    if (this.settledTrunkMaterial)
      resources.materials.add(this.settledTrunkMaterial);
    resources.collect(this.scene);
    resources.dispose();
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
    this.presentation.configure(
      this.visualProfile,
      this.reducedEffects,
      this.rig.mode === "photo",
    );
    this.presentation.render();
    return new Promise((resolve, reject) =>
      this.canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(Error("Capture unavailable"))),
        "image/png",
      ),
    );
  }
  inspectCamera(p: number[], target: number[]) {
    this.lastLOD = -Infinity;
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
      projectiles: this.actors.projectileCount,
    };
  }
}
