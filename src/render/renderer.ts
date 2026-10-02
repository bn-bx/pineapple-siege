import { SnapshotTimeline } from "./snapshot-timeline";
import { CivilianView } from "./civilians";
import { isRoof } from "../debris-shape";
import { MAX_BODY_LIMIT } from "../destruction-settings";
import { CameraRig } from "./camera-rig";
import { GooglyEyes } from "./googly-eyes";
import { DiscoScene, DISCO_PATTERN_GLSL } from "./disco";
import { discoActive } from "../disco";
import { makeMonster, makeDistantMonster, DistantMonsterView } from "./monster";
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
  MAX_MONSTER_COUNT,
  LASER,
  MONSTER_SCALE,
  WEAPONS,
} from "../config";
interface Batch {
  mesh: THREE.InstancedMesh;
  low?: THREE.InstancedMesh;
  ids: number[];
  kind: string;
  x: number;
  z: number;
}
const dummy = new THREE.Object3D(),
  zero = new THREE.Matrix4().makeScale(0, 0, 0),
  up = new THREE.Vector3(0, 1, 0);
export class GameRenderer {
  readonly civilians: CivilianView;
  readonly rig = new CameraRig();
  private cameraCells = new Map<number, Entity[]>();
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(64, 1, 0.5, 2800);
  readonly terrain: TerrainView;
  readonly effects = new Effects();
  readonly disco = new DiscoScene();
  readonly jet = makeJet();
  readonly eyes = new GooglyEyes();
  readonly materials: ReturnType<typeof createMaterials>["materials"];
  private sky: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private sun = new THREE.DirectionalLight("#fff0d2", 2.8);
  private ambient = new THREE.HemisphereLight("#c4e3f4", "#565b32", 1.8);
  private water: Water;
  private lanterns: {
    light: THREE.PointLight;
    lamp: THREE.Mesh;
    owner: number;
  }[] = [];
  private batches: Batch[] = [];
  private refs = new Map<number, { batch: Batch; index: number }[]>();
  private removed = new Set<number>();
  private ruins = new Map<number, Ruin>();
  private ruinCells = new Map<number, Set<number>>();
  private ruinGroups = new Map<number, THREE.Group>();
  private dirtyRuinBatches = new Set<number>();
  private bodyMeshes = new Map<string, THREE.InstancedMesh>();
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
  private fallenTrunks: THREE.InstancedMesh;
  private shotMeshes: THREE.Group[] = [];
  private monsterMeshes: THREE.Group[] = [];
  private distantMonsters: THREE.Group[] = [];
  private distantMonsterView = new DistantMonsterView(MAX_MONSTER_COUNT);
  private googlyEyes = false;
  private spikeMeshes: THREE.Mesh[] = [];
  private flagGroup = new THREE.Group();
  private marker: THREE.Mesh;
  private inspect?: { p: THREE.Vector3; target: THREE.Vector3 };
  private last?: SimulationSnapshot;
  private previous?: SimulationSnapshot;
  private timeline = new SnapshotTimeline<SimulationSnapshot>();
  private readyCamera = false;
  private cameraTarget = new THREE.Vector3();
  private cameraPosition = new THREE.Vector3();
  private elapsed = 0;
  private frame = 0;
  private lastLOD = 0;
  private quality = "auto";
  private targetHeight = 1080;
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
  ) {
    this.civilians = new CivilianView(world.civilians?.length ?? 0);
    this.scene.add(this.civilians.group);
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
    this.scene.add(this.distantMonsterView.group);
    this.scene.fog = new THREE.FogExp2("#98b5bb", 0.00065);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, {
      left: -220,
      right: 220,
      top: 220,
      bottom: -220,
      near: 1,
      far: 850,
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
          sun: { value: new THREE.Vector3() },
          day: { value: 1 },
          time: { value: 0 },
          laserDim: { value: 0 },
        },
        vertexShader:
          "varying vec3 vDirection; void main(){vDirection=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}",
        fragmentShader: `uniform vec3 sun;uniform float day,time,laserDim;varying vec3 vDirection;float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+1.),f.x),f.y);}void main(){vec3 d=normalize(vDirection);float h=pow(1.-max(d.y,0.),2.);vec3 c=mix(mix(vec3(.009,.018,.046),vec3(.05,.08,.12),h),mix(vec3(.15,.39,.64),vec3(.63,.76,.78),h),day);float sunset=pow(1.-abs(sun.y),8.)*smoothstep(-.2,.04,sun.y);c+=vec3(.48,.19,.055)*sunset*pow(max(dot(normalize(d.xz),normalize(sun.xz)),0.),4.)*(.3+h);float cloud=0.;if(d.y>.03){vec2 p=d.xz/d.y*1.1+time*.002;float n=noise(p*2.)*.6+noise(p*4.1+13.)*.28+noise(p*8.3)*.12;cloud=smoothstep(.50,.69,n)*smoothstep(.03,.18,d.y);c=mix(c,mix(vec3(.065,.085,.13),mix(vec3(.50,.60,.64),vec3(.99,.96,.84),smoothstep(.50,.77,n)),day)+sunset*vec3(.25,.08,.01),cloud*.9);}c+=vec3(1.,.77,.37)*pow(max(dot(d,sun),0.),1500.)*day;c+=vec3(.7,.8,1.)*pow(max(dot(d,-sun),0.),1800.)*(1.-day);float stars=step(.9985,hash(floor(d.xz/(abs(d.y)+.2)*600.)))*max(d.y,0.);c+=stars*(1.-day)*(1.-cloud);gl_FragColor=vec4(c*(1.-laserDim),1.);}`,
      }),
    );
    this.sky.frustumCulled = false;
    this.sky.material.uniforms.discoAmount = this.disco.skyAmount;
    this.sky.material.fragmentShader = this.sky.material.fragmentShader
      .replace(
        "uniform float day,time,laserDim;",
        "uniform float day,time,laserDim,discoAmount;",
      )
      .replace(
        "gl_FragColor=vec4(c*(1.-laserDim),1.);",
        "gl_FragColor=vec4(mix(c*(1.-laserDim),vec3(.001,.001,.003),discoAmount),1.);",
      );
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
      new THREE.PlaneGeometry(CONFIG.worldSize, CONFIG.worldSize),
      {
        textureWidth: 768,
        textureHeight: 432,
        waterNormals: normals,
        sunDirection: new THREE.Vector3(0.3, 0.6, 0.2),
        sunColor: 0xffeed5,
        waterColor: 0x28645d,
        distortionScale: 1.6,
        fog: true,
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
        `#include <logdepthbuf_fragment>\n vec2 terrainUV=(worldPosition.xz/${CONFIG.spacing}.+.5)/${CONFIG.grid}.; if(texture2D(uFlood,terrainUV).r<.5)discard; float waterDepth=max(0.,-texture2D(uHeight,terrainUV).r);`,
      )
      .replace("float rf0 = 0.3;", "float rf0 = 0.08;")
      .replace(
        "vec3 outgoingLight = albedo;",
        "vec3 bed=mix(vec3(.25,.30,.20),vec3(.035,.15,.17),smoothstep(0.,6.,waterDepth))*sunColor; vec3 outgoingLight=mix(bed,albedo,.35+reflectance*.6)+uDiscoAmount*discoPattern(worldPosition.xz,uDiscoTime);",
      );
    const original = this.water.onBeforeRender;
    this.water.onBeforeRender = (r, s, c, g, m, group) => {
      if (this.frame % 6 === 0) {
        const visible = this.effects.group.visible;
        this.effects.group.visible = false;
        original.call(this.water, r, s, c, g, m, group);
        this.effects.group.visible = visible;
      }
    };
    this.scene.add(this.water);
    for (const { p, owner } of world.lights) {
      const light = new THREE.PointLight("#ff9a35", 0, 36, 2);
      light.position.fromArray(p);

      this.scene.add(light);
      const lamp = new THREE.Mesh(
        new THREE.BoxGeometry(0.6, 0.8, 0.6),
        new THREE.MeshStandardMaterial({
          color: "#ffe8a1",
          emissive: "#ffbd51",
          emissiveIntensity: 2,
        }),
      );
      lamp.position.fromArray(p);
      this.scene.add(lamp);
      this.lanterns.push({ light, lamp, owner });
    }
    this.fallenPines = new THREE.InstancedMesh(
      pineGeometry(),
      this.materials.foliage,
      MAX_BODY_LIMIT,
    );
    this.fallenTrunks = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.8, 1, 1, 6),
      this.materials.wood,
      MAX_BODY_LIMIT,
    );
    for (const mesh of [this.fallenPines, this.fallenTrunks]) {
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.castShadow = mesh.receiveShadow = true;
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
        MAX_BODY_LIMIT,
      );
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.bodyMeshes.set(material, mesh);
      this.scene.add(mesh);
    }
    this.disco.decorateScene(this.scene);
    this.resize();
  }
  private buildBatches() {
    const grouped = new Map<string, Entity[]>();
    for (const e of this.world.entities) {
      const cell =
        e.kind === "tree"
          ? `${Math.floor(e.p[0] / 128)},${Math.floor(e.p[2] / 128)}`
          : "structure";
      let key = e.kind + e.material + cell;
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
    for (const list of grouped.values()) {
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
          kind,
          x: e.p[0],
          z: e.p[2],
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
            kind === "pine" ? 0.24 : 0.12,
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
        batch.low?.computeBoundingSphere();
        this.scene.add(mesh);
        this.batches.push(batch);
      };
      if (e.kind === "tree") {
        add(pine, this.materials.foliage, "pine", low);
        add(trunk, this.materials.wood, "trunk");
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
      mesh.userData.owner = banner.owner;
      this.flagGroup.add(mesh);
    }
  }
  setReducedEffects(value: boolean) {
    this.effects.reduced = value;
  }
  setGooglyEyes(value: boolean) {
    this.googlyEyes = value;
    this.eyes.setEnabled(value);
    for (const monster of this.monsterMeshes) {
      const nativeEyes = monster.getObjectByName("native-eyes");
      if (nativeEyes) nativeEyes.visible = !value;
    }
  }
  private ensureMonsterMeshes(count: number) {
    while (this.monsterMeshes.length < count) {
      const monster = makeMonster();
      const distant = makeDistantMonster();
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
    this.targetHeight = q === "auto" ? 1080 : Number(q);
    this.qualityChanged = performance.now();
    this.resize();
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
    if (
      this.last &&
      flightPose(this.last.plane, snapshot.plane, 1).discontinuity
    ) {
      this.timeline.reset();
      this.readyCamera = false;
    }
    this.last = snapshot;
    this.timeline.receive(snapshot, performance.now());
  }
  reset(
    heights: Float32Array,
    removed: number[],
    ruins: Ruin[],
    flood: Uint32Array,
  ) {
    this.setChase();
    this.removed.clear();
    this.ruins.clear();
    this.ruinCells.clear();
    this.dirtyRuinBatches.clear();
    for (const g of this.ruinGroups.values()) {
      this.scene.remove(g);
      for (const m of g.children) (m as THREE.InstancedMesh).dispose();
    }
    this.ruinGroups.clear();
    this.terrain.restore(heights);
    this.terrain.setFlood(flood, true);
    for (const batch of this.batches)
      batch.ids.forEach((id, i) => {
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
        batch.mesh.instanceMatrix.needsUpdate = true;
        if (batch.low) batch.low.instanceMatrix.needsUpdate = true;
      });
    for (const id of removed) this.hideEntity(id);
    for (const r of ruins) this.addRuin(r);
    this.effects.reset();
    this.disco.reset();
    for (const shot of this.shotMeshes.splice(12)) this.scene.remove(shot);
    for (const shot of this.shotMeshes) shot.visible = false;
    this.civilians.reset();
    for (const m of this.monsterMeshes) m.visible = false;
    for (const m of this.distantMonsters) m.visible = false;
    this.distantMonsterView.begin();
    this.distantMonsterView.finish();
    for (const s of this.spikeMeshes) s.visible = false;
    this.readyCamera = false;
    this.previous = undefined;
    this.timeline.reset();
    this.last = undefined;
    this.previousBodies.clear();
    this.syncedBodies = undefined;
    this.renderer.shadowMap.needsUpdate = true;
  }
  private hideEntity(id: number) {
    this.removed.add(id);
    for (const ref of this.refs.get(id) || []) {
      ref.batch.mesh.setMatrixAt(ref.index, zero);
      ref.batch.mesh.instanceMatrix.needsUpdate = true;
      if (ref.batch.low) {
        ref.batch.low.setMatrixAt(ref.index, zero);
        ref.batch.low.instanceMatrix.needsUpdate = true;
      }
    }
  }
  delta(d: WorldDelta) {
    for (const id of d.removed) this.hideEntity(id);
    for (const id of d.rubbleRemoved) this.removeRuin(id);
    for (const r of d.settled) this.addRuin(r);
    if (d.terrain) this.terrain.patch(d.terrain);
    if (d.flood) this.terrain.setFlood(d.flood);
    if (d.dry) this.terrain.setDry(d.dry);
    this.renderer.shadowMap.needsUpdate = true;
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
  }
  private removeRuin(id: number) {
    const r = this.ruins.get(id);
    if (!r) return;
    const key = this.ruinCell(r.p);
    this.ruinCells.get(key)?.delete(id);
    this.dirtyRuinBatches.add(this.ruinBatch(key));
    this.ruins.delete(id);
  }
  private updateRuins() {
    for (const key of this.dirtyRuinBatches) {
      const old = this.ruinGroups.get(key);
      if (old) {
        this.scene.remove(old);
        for (const m of old.children) (m as THREE.InstancedMesh).dispose();
      }
      const group = new THREE.Group(),
        lists = new Map<
          string,
          {
            geo: THREE.BufferGeometry;
            mat: THREE.Material;
            matrices: THREE.Matrix4[];
          }
        >();
      const add = (
        name: string,
        geo: THREE.BufferGeometry,
        mat: THREE.Material,
      ) => {
        let batch = lists.get(name);
        if (!batch) lists.set(name, (batch = { geo, mat, matrices: [] }));
        dummy.updateMatrix();
        batch.matrices.push(dummy.matrix.clone());
      };
      const firstCell =
        Math.floor(key / (CHUNKS / 2)) * CHUNKS * 2 + (key % (CHUNKS / 2)) * 2;
      const ids = [
        firstCell,
        firstCell + 1,
        firstCell + CHUNKS,
        firstCell + CHUNKS + 1,
      ].flatMap((cell) => [...(this.ruinCells.get(cell) || [])]);
      for (const id of ids) {
        const r = this.ruins.get(id)!;
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
          add("pine", this.fallenPines.geometry, this.materials.foliage);
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
      for (const { geo, mat, matrices } of lists.values()) {
        const mesh = new THREE.InstancedMesh(geo, mat, matrices.length);
        matrices.forEach((m, i) => {
          mesh.setMatrixAt(i, m);
          mesh.setColorAt(
            i,
            this.fragmentColor.setScalar(
              0.86 +
                (Math.abs(m.elements[12] * 17 + m.elements[14] * 31) % 19) / 70,
            ),
          );
        });
        mesh.receiveShadow = true;
        mesh.computeBoundingSphere();
        group.add(mesh);
      }
      this.scene.add(group);
      this.ruinGroups.set(key, group);
    }
    this.dirtyRuinBatches.clear();
    for (const [key, g] of this.ruinGroups) {
      const d = Math.hypot(
        (key % (CHUNKS / 2)) * 128 + 64 - this.camera.position.x,
        Math.floor(key / (CHUNKS / 2)) * 128 + 64 - this.camera.position.z,
      );
      g.visible = d < 1400;
      for (const m of g.children) m.castShadow = d < 230;
    }
  }
  private ruinBatch(cell: number) {
    return (
      Math.floor(Math.floor(cell / CHUNKS) / 2) * (CHUNKS / 2) +
      Math.floor((cell % CHUNKS) / 2)
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
    this.scene.remove(mesh);
    mesh.dispose();
    this.scene.add(grown);
    return grown;
  }
  private debrisKey(b: Pick<BodyView, "material" | "roofPart">) {
    return b.roofPart ? `${b.material}:${b.roofPart}` : b.material;
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
  private syncBodies(bodies: BodyView[], alpha: number) {
    if (bodies === this.syncedBodies && alpha === this.syncedBodyAlpha) return;
    const changed = bodies !== this.syncedBodies;
    this.syncedBodies = bodies;
    this.syncedBodyAlpha = alpha;
    if (changed) {
      const needed = new Map<string, number>();
      let treeCount = 0;
      for (const b of bodies) {
        if (b.kind === "tree") treeCount++;
        else {
          const key = this.debrisKey(b);
          needed.set(key, (needed.get(key) || 0) + 1);
          if (!this.bodyMeshes.has(key)) {
            const mesh = new THREE.InstancedMesh(
              this.debrisGeometry(b),
              this.fragmentMaterials[b.material],
              64,
            );
            mesh.count = 0;
            mesh.frustumCulled = false;
            mesh.receiveShadow = true;
            mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
            this.bodyMeshes.set(key, mesh);
            this.scene.add(mesh);
          }
        }
      }
      this.fallenTrunks = this.growDebrisMesh(this.fallenTrunks, treeCount);
      this.fallenPines = this.growDebrisMesh(this.fallenPines, treeCount);
      for (const [material, count] of needed)
        this.bodyMeshes.set(
          material,
          this.growDebrisMesh(this.bodyMeshes.get(material)!, count),
        );
    }
    const counts = new Map<string, number>();
    let trees = 0;
    for (const b of bodies) {
      dummy.position.fromArray(b.p);
      dummy.quaternion.fromArray(b.q);
      const previous = this.previousBodies.get(b.id);
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
      if (b.kind === "tree") {
        const e = this.world.entities[b.source];
        dummy.scale.set(b.s[0], b.s[1] * 2, b.s[2]);
        dummy.updateMatrix();
        this.fallenTrunks.setMatrixAt(trees, dummy.matrix);
        dummy.position.add(
          new THREE.Vector3(0, -b.s[1], 0).applyQuaternion(dummy.quaternion),
        );
        const ratio = b.s[1] / e.s[1];
        dummy.scale.set(
          e.s[0] * 1.45 * ratio,
          b.s[1] * 2,
          e.s[0] * 1.45 * ratio,
        );
        dummy.updateMatrix();
        this.fallenPines.setMatrixAt(trees, dummy.matrix);
        trees++;
        continue;
      }
      const key = this.debrisKey(b);
      let mesh = this.bodyMeshes.get(key)!,
        index = counts.get(key) || 0;
      dummy.scale.fromArray(b.s);
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
      if (changed)
        mesh.setColorAt(
          index,
          this.fragmentColor.setScalar(0.86 + (b.id % 19) / 70),
        );
      counts.set(key, index + 1);
    }
    for (const mesh of [this.fallenPines, this.fallenTrunks]) {
      mesh.count = trees;
      mesh.instanceMatrix.clearUpdateRanges();
      if (trees) {
        mesh.instanceMatrix.addUpdateRange(0, trees * 16);
        mesh.instanceMatrix.needsUpdate = true;
      }
    }
    for (const [mat, mesh] of this.bodyMeshes) {
      mesh.count = counts.get(mat) || 0;
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
    this.frame++;
    if (active) this.elapsed += dt;
    this.averageMS = this.averageMS * 0.95 + Math.min(dt * 1000, 200) * 0.05;
    const playback = this.timeline.sample(frameTime, active);
    if (!playback) return;
    const snap = playback.current;
    const alpha = playback.alpha;
    if (this.previous !== playback.previous) {
      this.previous = playback.previous;
      this.previousBodies.clear();
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
    const ray = desired.clone().sub(position),
      len = ray.length();
    this.cameraRay.set(position, ray.normalize());
    let limit = len;
    const box = new THREE.Box3();
    const candidates = new Set<Entity>();
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
    for (const e of candidates) {
      if (
        e.kind === "tree" ||
        this.removed.has(e.id) ||
        Math.abs(e.p[0] - position.x) > 100 ||
        Math.abs(e.p[2] - position.z) > 100
      )
        continue;
      box.set(
        new THREE.Vector3(...e.p).sub(new THREE.Vector3(...e.s)),
        new THREE.Vector3(...e.p).add(new THREE.Vector3(...e.s)),
      );
      const hit = this.cameraRay.ray.intersectBox(box, new THREE.Vector3());
      if (hit)
        limit = Math.min(limit, Math.max(5, position.distanceTo(hit) - 2));
    }
    const nearby: Ruin[] = [];
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
          nearby.push(this.ruins.get(id)!);
    for (const r of [...nearby, ...snap.bodies]) {
      if (
        Math.abs(r.p[0] - position.x) > 100 ||
        Math.abs(r.p[2] - position.z) > 100
      )
        continue;
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
    }
    for (let distance = 2; distance < len; distance += 2) {
      const point = position.clone().addScaledVector(ray, distance);
      if (point.y < this.terrain.sample(point.x, point.z) + 2) {
        limit = Math.min(limit, Math.max(2, distance - 2));
        break;
      }
    }
    if (limit < len) desired.copy(position).addScaledVector(ray, limit);
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
    this.updateRuins();
    this.syncBodies(snap.bodies, alpha);
    this.civilians.update(snap, this.previous, alpha, this.camera.position);
    this.ensureMonsterMeshes(snap.monsters.length);
    this.distantMonsterView.begin();
    for (let i = 0; i < this.monsterMeshes.length; i++) {
      const mesh = this.monsterMeshes[i],
        distant = this.distantMonsters[i];
      const m = snap.monsters[i];
      mesh.visible = distant.visible = !!m && !m.defeated;
      if (!m || m.defeated) {
        if (mesh.parent) this.scene.remove(mesh);
        if (distant.parent) this.scene.remove(distant);
        continue;
      }
      if (
        (m.p[0] - this.camera.position.x) ** 2 +
          (m.p[2] - this.camera.position.z) ** 2 >
        1700 ** 2
      ) {
        mesh.visible = distant.visible = false;
        if (mesh.parent) this.scene.remove(mesh);
        if (distant.parent) this.scene.remove(distant);
        continue;
      }
      const old = this.previous?.monsters[m.id];
      if (old && !old.defeated)
        mesh.position.set(
          THREE.MathUtils.lerp(old.p[0], m.p[0], alpha),
          THREE.MathUtils.lerp(old.p[1], m.p[1], alpha),
          THREE.MathUtils.lerp(old.p[2], m.p[2], alpha),
        );
      else mesh.position.fromArray(m.p);
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
      if (detail && !mesh.parent) this.scene.add(mesh);
      else if (!detail && mesh.parent) this.scene.remove(mesh);
      if (this.googlyEyes && !detail && !distant.parent)
        this.scene.add(distant);
      else if ((!this.googlyEyes || detail) && distant.parent)
        this.scene.remove(distant);
      if (!detail) {
        this.distantMonsterView.add(distant);
        continue;
      }
      const crawl = Math.sin(m.phase * 0.2) * (m.stagger > 0 ? 0.05 : 0.23);
      const left = mesh.getObjectByName("leftArm");
      const right = mesh.getObjectByName("rightArm");
      if (left)
        left.rotation.z = dancing
          ? -0.65 - beat * 0.45
          : m.windup > 0
            ? -0.6
            : crawl;
      if (right)
        right.rotation.z = dancing
          ? 0.65 - beat * 0.45
          : m.windup > 0
            ? 0.6
            : -crawl;
      const crown = mesh.getObjectByName("crown");
      if (crown) crown.rotation.z = Math.sin(m.phase * 0.09) * 0.08;
      mesh.scale.setScalar(
        MONSTER_SCALE *
          (m.stagger > 0 ? 1 + Math.sin(this.elapsed * 35) * 0.025 : 1),
      );
      if (this.frame % 15 === 0)
        mesh.traverse((o) => {
          if (o instanceof THREE.Mesh)
            o.castShadow = this.camera.position.distanceTo(mesh.position) < 300;
        });
    }
    this.distantMonsterView.finish();
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
    // No-cooldown mode has no in-flight cap. Grow the shared-asset pool to show every shot.
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
            ...(s.p.map((v, k) => THREE.MathUtils.lerp(old.p[k], v, alpha)) as [
              number,
              number,
              number,
            ]),
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
    const a = ((snap.hour - 6) / 24) * Math.PI * 2,
      sunDir = new THREE.Vector3(
        Math.cos(a) * 0.8,
        Math.sin(a),
        Math.cos(a) * 0.5,
      ).normalize(),
      day = THREE.MathUtils.smoothstep(sunDir.y, -0.15, 0.2),
      night = 1 - day;
    this.sky.material.uniforms.sun.value.copy(sunDir);
    this.sky.material.uniforms.day.value = day;
    this.sky.material.uniforms.time.value = this.elapsed;
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
    const ld = sunDir.y > 0 ? sunDir : sunDir.clone().negate();
    const shadowCenter = new THREE.Vector3(
      position.x,
      Math.max(0, this.terrain.sample(position.x, position.z)),
      position.z,
    );
    this.sun.position.copy(shadowCenter).addScaledVector(ld, 350);
    this.sun.target.position.copy(shadowCenter);
    this.sun.intensity = 0.3 + day * 2.7;
    this.sun.color.set(day > 0.2 ? "#ffe6ba" : "#9ebdeb");
    this.ambient.intensity = 0.38 + day * 1.5;
    this.ambient.color.set(day > 0.2 ? "#c5e5f4" : "#5873a2");
    this.sun.intensity = THREE.MathUtils.lerp(
      this.sun.intensity,
      0.55,
      this.disco.skyAmount.value,
    );
    this.sun.color.lerp(new THREE.Color("#b9c3ff"), this.disco.skyAmount.value);
    this.ambient.intensity = THREE.MathUtils.lerp(
      this.ambient.intensity,
      1.25,
      this.disco.skyAmount.value,
    );
    this.ambient.color.lerp(
      new THREE.Color("#d9dcff"),
      this.disco.skyAmount.value,
    );
    const fog = this.scene.fog as THREE.FogExp2;
    fog.color.copy(
      new THREE.Color("#192c43").lerp(new THREE.Color("#a3bdbb"), day),
    );
    fog.color.multiplyScalar(1 - laserDim * 0.5);
    fog.color.lerp(
      new THREE.Color("#101021"),
      this.disco.skyAmount.value * 0.88,
    );
    fog.density = THREE.MathUtils.lerp(
      0.00065,
      0.00035,
      this.disco.skyAmount.value,
    );
    for (const { light, lamp, owner } of this.lanterns) {
      const alive = !this.removed.has(owner);
      light.intensity = alive ? night * 150 : 0;
      lamp.visible = alive;
    }
    this.water.material.uniforms.sunDirection.value.copy(ld);
    this.water.material.uniforms.sunColor.value
      .copy(this.sun.color)
      .multiplyScalar(0.2 + day * 0.8);
    this.water.material.uniforms.time.value = this.elapsed;
    this.terrain.update(this.camera.position);
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
          b.low.visible = d >= 360 && d < 1500;
        } else if (b.kind === "trunk") b.mesh.visible = d < 700;
      }
      this.lastLOD = this.elapsed;
    }
    if (this.frame % 3 === 0) this.renderer.shadowMap.needsUpdate = true;
    this.effects.ground = (x, z) => this.terrain.sample(x, z);
    this.effects.update(active ? dt : 0);
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
    this.eyes.update(
      [
        this.jet,
        this.flagGroup,
        this.disco.ball,
        ...this.batches.flatMap((batch) =>
          batch.low ? [batch.mesh, batch.low] : [batch.mesh],
        ),
        this.fallenPines,
        this.fallenTrunks,
        ...this.bodyMeshes.values(),
        ...this.ruinGroups.values(),
        ...this.monsterMeshes,
        ...this.distantMonsters,
        ...this.shotMeshes,
        ...this.spikeMeshes,
        ...this.lanterns.map(({ lamp }) => lamp),
        this.effects.fragments.mesh,
        ...this.effects.cloudFaces,
      ],
      snap,
      this.jet.position,
    );
    this.renderer.render(this.scene, this.camera);
    if (
      this.quality === "auto" &&
      active &&
      performance.now() - this.qualityChanged > 8000
    ) {
      if (this.averageMS > 30) {
        this.highSince = 0;
        if (!this.lowSince) this.lowSince = performance.now();
        if (
          performance.now() - this.lowSince > 2200 &&
          this.targetHeight > 720
        ) {
          this.targetHeight = 720;
          this.resize();
          this.qualityChanged = performance.now();
          this.lowSince = 0;
        }
      } else if (this.averageMS < 18) {
        this.lowSince = 0;
        if (!this.highSince) this.highSince = performance.now();
        if (
          performance.now() - this.highSince > 6000 &&
          this.targetHeight < 1080
        ) {
          this.targetHeight = 1080;
          this.resize();
          this.qualityChanged = performance.now();
          this.highSince = 0;
        }
      }
    }
  }
  releaseLostGeometry() {
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
      clouds: this.effects.cloudCount,
      fragments: this.effects.fragments.count,
      projectiles: this.shotMeshes.filter((s) => s.visible).length,
      googlyFaces: this.eyes.count,
    };
  }
}
