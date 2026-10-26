import * as THREE from "three";
import { LASER } from "../config";
import type { LaserStrike } from "../types";

/** Uses strike age on reload and simulation time for the tail, even after excavation ends. */
export class DiscoEnvelope {
  private tail = -Infinity;
  private time = -Infinity;
  reset() {
    this.tail = this.time = -Infinity;
  }
  update(strikes: readonly LaserStrike[], time: number) {
    if (time < this.time) this.reset();
    this.time = time;
    let strength = 0;
    for (const strike of strikes) {
      const end = time - strike.age + LASER.charge + LASER.beam;
      if (strike.phase === "charging") {
        strength = Math.max(
          strength,
          THREE.MathUtils.smoothstep(strike.age, 0, LASER.charge),
        );
      } else if (strike.phase === "burning") {
        strength = 1;
        this.tail = Math.max(this.tail, end);
      } else this.tail = Math.max(this.tail, end);
    }
    // A new charging strike must not erase the previous beam's fade-out.
    // Future tails belong to a burning beam, whose strength is already one.
    if (time >= this.tail)
      strength = Math.max(
        strength,
        1 - THREE.MathUtils.smoothstep(time - this.tail, 0, 1),
      );
    return strength;
  }
}

/** One shared set of projection uniforms for every receiving material. */
export class DiscoShow {
  readonly group = new THREE.Group();
  readonly envelope = new DiscoEnvelope();
  readonly uniforms = {
    discoTime: { value: 0 },
    discoStrength: { value: 0 },
    discoDensity: { value: 1 },
    discoCenter: { value: new THREE.Vector3() },
  };
  private ball = new THREE.Group();
  private tiles: THREE.InstancedMesh;
  private shafts: THREE.InstancedMesh<
    THREE.ConeGeometry,
    THREE.MeshBasicMaterial
  >;
  private tileMaterial: THREE.MeshStandardMaterial;
  private dummy = new THREE.Object3D();
  private down = new THREE.Vector3(0, -1, 0);
  private direction = new THREE.Vector3();
  private installed = new WeakSet<THREE.Material>();
  constructor(size: number) {
    this.group.name = "space-laser-disco";
    this.group.position.set(size / 2, 1900, size / 2);
    this.uniforms.discoCenter.value.copy(this.group.position);
    this.tileMaterial = new THREE.MeshStandardMaterial({
      color: "#cce9ff",
      metalness: 0.88,
      roughness: 0.17,
      emissive: "#90b9ed",
      emissiveIntensity: 0.7,
    });
    this.tileMaterial.onBeforeCompile = (shader) => {
      shader.uniforms.discoBallTime = this.uniforms.discoTime;
      shader.fragmentShader =
        `uniform float discoBallTime;\n${shader.fragmentShader}`.replace(
          "#include <emissivemap_fragment>",
          `#include <emissivemap_fragment>
        float glint = pow(max(0., dot(normalize(vNormal), normalize(vec3(sin(discoBallTime * .7), .4, cos(discoBallTime * .7))))), 24.);
        #ifdef USE_INSTANCING_COLOR
          totalEmissiveRadiance *= vColor * (.12 + glint * 2.5);
        #endif`,
        );
    };
    this.tileMaterial.customProgramCacheKey = () => "disco-mirror-glints-v1";
    this.tiles = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      this.tileMaterial,
      1152,
    );
    this.tiles.frustumCulled = false;
    this.ball.add(this.tiles);
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(154, 32, 24),
      new THREE.MeshBasicMaterial({ color: "#172438" }),
    );
    this.ball.add(core);
    this.shafts = new THREE.InstancedMesh(
      new THREE.ConeGeometry(1, 1, 8, 1, true).translate(0, -0.5, 0),
      new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0.035,
        blending: THREE.AdditiveBlending,
        // Additive glow would add haze colour if fogged.
        fog: false,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
      32,
    );
    this.shafts.frustumCulled = false;
    this.shafts.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const color = new THREE.Color();
    for (let i = 0; i < 32; i++)
      this.shafts.setColorAt(i, color.setHSL(i / 32, 0.85, 0.62));
    this.group.add(this.ball, this.shafts);
    this.configureTiles(false);
    this.group.visible = false;
  }
  private reduced?: boolean;
  private configureTiles(reduced: boolean) {
    if (this.reduced === reduced) return;
    this.reduced = reduced;
    const rows = reduced ? 12 : 24,
      cols = reduced ? 24 : 48;
    const color = new THREE.Color();
    let i = 0;
    for (let row = 0; row < rows; row++) {
      const lat = ((row + 0.5) / rows) * Math.PI;
      for (let col = 0; col < cols; col++) {
        const lon = (col / cols) * Math.PI * 2;
        this.dummy.position.set(
          158 * Math.sin(lat) * Math.cos(lon),
          158 * Math.cos(lat),
          158 * Math.sin(lat) * Math.sin(lon),
        );
        this.dummy.lookAt(this.dummy.position.clone().multiplyScalar(2));
        this.dummy.scale.set(
          ((158 * Math.sin(lat) * Math.PI * 2) / cols) * 0.92,
          ((158 * Math.PI) / rows) * 0.92,
          3,
        );
        this.dummy.updateMatrix();
        this.tiles.setMatrixAt(i, this.dummy.matrix);
        this.tiles.setColorAt(
          i++,
          color.setHSL(
            (col / cols + row * 0.071) % 1,
            0.18,
            0.55 + (0.25 * ((col * 7 + row * 3) % 11)) / 10,
          ),
        );
      }
    }
    this.tiles.count = i;
    this.tiles.instanceMatrix.needsUpdate = true;
    this.tiles.instanceColor!.needsUpdate = true;
  }
  /** Chain existing terrain/horizon hooks; world position includes instancing. */
  install(material: THREE.Material) {
    if (
      !(material instanceof THREE.MeshStandardMaterial) ||
      this.installed.has(material)
    )
      return;
    this.installed.add(material);
    const prior = material.onBeforeCompile,
      key = material.customProgramCacheKey();
    material.onBeforeCompile = (shader, renderer) => {
      prior.call(material, shader, renderer);
      Object.assign(shader.uniforms, this.uniforms);
      // A retained material may already carry a previous world's projection.
      // Rebind its uniforms without declaring the GLSL symbols twice.
      if (shader.vertexShader.includes("varying vec3 vDiscoWorld;")) return;
      shader.vertexShader =
        `varying vec3 vDiscoWorld;\n${shader.vertexShader}`.replace(
          "#include <project_vertex>",
          `#include <project_vertex>
        vec4 discoPosition = vec4(transformed, 1.);
        #ifdef USE_BATCHING
          discoPosition = batchingMatrix * discoPosition;
        #endif
        #ifdef USE_INSTANCING
          discoPosition = instanceMatrix * discoPosition;
        #endif
        vDiscoWorld = (modelMatrix * discoPosition).xyz;`,
        );
      shader.fragmentShader = `varying vec3 vDiscoWorld;
        uniform float discoTime, discoStrength, discoDensity;
        uniform vec3 discoCenter;
        ${shader.fragmentShader}`.replace(
        "#include <opaque_fragment>",
        `
        if (discoStrength > .001) {
          vec3 ray = normalize(vDiscoWorld - discoCenter);
          float angle = discoTime * .16;
          vec2 q = mat2(cos(angle), -sin(angle), sin(angle), cos(angle)) * ray.xz;
          vec2 uv = vec2(atan(q.y, q.x) * 3.8197186, acos(clamp(ray.y, -1., 1.)) * 9.);
          uv *= discoDensity;
          vec2 cell = floor(uv);
          float spot = 1. - smoothstep(.09, .24, length(fract(uv) - .5));
          vec3 tint = .55 + .45 * cos(vec3(0., 2.094, 4.188) + cell.x * 1.7 + cell.y * 2.3 + discoTime * .7);
          outgoingLight += tint * spot * discoStrength * (1.2 + .15 * sin(discoTime * 3.));
        }
        #include <opaque_fragment>`,
      );
    };
    material.customProgramCacheKey = () => `${key}:disco-projection-v1`;
    material.needsUpdate = true;
  }
  update(strikes: readonly LaserStrike[], time: number, reduced: boolean) {
    const strength = this.envelope.update(strikes, time);
    this.uniforms.discoTime.value = time;
    this.uniforms.discoStrength.value = strength;
    this.uniforms.discoDensity.value = reduced ? 0.65 : 1;
    this.group.visible = strength > 0.001;
    if (!this.group.visible) return strength;
    this.configureTiles(reduced);
    this.ball.rotation.set(0.12, time * 0.16, 0.08);
    this.ball.scale.setScalar(0.05 + 0.95 * strength);
    this.tileMaterial.emissiveIntensity =
      strength * (1.1 + 0.15 * Math.sin(time * 3));
    this.shafts.count = reduced ? 12 : 32;
    const direction = this.direction;
    for (let i = 0; i < this.shafts.count; i++) {
      const a = (i * Math.PI * 2) / this.shafts.count + time * 0.16;
      const reach = 600 + (i % 5) * 1250 + 300 * Math.sin(time * 0.45 + i);
      direction.set(Math.cos(a) * reach, -1900, Math.sin(a) * reach);
      this.dummy.position.set(0, 0, 0);
      const length = direction.length();
      this.dummy.quaternion.setFromUnitVectors(
        this.down,
        direction.normalize(),
      );
      this.dummy.scale.set(55 + reach * 0.035, length, 55 + reach * 0.035);
      this.dummy.updateMatrix();
      this.shafts.setMatrixAt(i, this.dummy.matrix);
    }
    this.shafts.instanceMatrix.needsUpdate = true;
    this.shafts.material.opacity = 0.035 * strength;
    return strength;
  }
  reset() {
    this.envelope.reset();
    this.uniforms.discoStrength.value = 0;
    this.group.visible = false;
  }
}
