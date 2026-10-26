import * as THREE from "three";
import { DiscoShow } from "./disco-show";
import { HELL_LAVA_LEVEL } from "../config";
import type { Material, SimulationSnapshot, WorldData } from "../types";
import { EnvironmentLighting, SKY_FRAGMENT } from "./environment-lighting";
import { TerrainSunMask } from "./terrain-sun-mask";
import { SkyReflection } from "./sky-reflection";
import { DynamicLights } from "./dynamic-lights";
import { makeOcean } from "./ocean";
import { CoastlineView } from "./coastline";
import { oceanHorizon } from "./ocean-horizon";
import type { ResourceDisposal } from "./resource-disposal";
import { makeRivers } from "./river-view";
import type { TerrainView } from "./terrain-view";
import {
  AERIAL_FOG_DENSITY,
  AERIAL_FOG_SCALE_HEIGHT,
  AerialFog,
} from "./aerial-fog";
import {
  SHADOW_FAR,
  SHADOW_HALF_EXTENTS,
  SHADOW_SUN_DISTANCE,
  leadShadowCenter,
  shadowBias,
  shadowCasterReach,
  shadowExtentIndex,
  snapShadowCenter,
} from "./shadow-frame";
/** Lighting and water share authoritative hour, strike age, and terrain masks. */
export class EnvironmentView {
  private hell = false;
  readonly disco: DiscoShow;
  /** Island-wide terrain and statue shadows beyond the shadow map. */
  readonly sunMask: TerrainSunMask;
  readonly lighting = new EnvironmentLighting();
  /** Sky-gradient reflections for metallic materials. */
  readonly skyReflection = new SkyReflection(
    this.lighting.zenithColor,
    this.lighting.horizonColor,
    this.lighting.groundColor,
  );
  /** Explosion, fire and muzzle-flash light for every installed material. */
  readonly dynamicLights = new DynamicLights();
  readonly shadowCenter = new THREE.Vector3();
  /** Index into SHADOW_HALF_EXTENTS for the current sun shadow box. */
  shadowExtent = 0;
  /** Camera-relative radius in which casters can reach the shadow box. */
  shadowReach = SHADOW_HALF_EXTENTS[0] * Math.SQRT2;
  /** Largest half-extent the quality profile allows. */
  shadowMaxHalf: number = SHADOW_HALF_EXTENTS[0];
  /** Normal-island aerial perspective; Hell keeps its own FogExp2. */
  readonly aerialFog?: AerialFog;
  private viewDirection = new THREE.Vector3();
  /** Shadow-map size the current bias was computed for. */
  private biasMapSize = 0;
  readonly sky: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  readonly sun = new THREE.DirectionalLight("#fff0d2", 2.8);
  readonly ambient = new THREE.HemisphereLight("#c4e3f4", "#565b32", 1.8);
  readonly water: ReturnType<typeof makeOcean>;
  readonly rivers: THREE.Group;
  readonly coastline?: CoastlineView;
  readonly abyss?: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  constructor(
    private scene: THREE.Scene,
    private terrain: TerrainView,
    world: WorldData,
    private materials: Record<Material, THREE.MeshStandardMaterial>,
    shadowSize: number,
  ) {
    this.hell = world.realm === "hell";
    this.disco = new DiscoShow(world.size);
    this.scene.add(this.disco.group);
    this.sunMask = new TerrainSunMask(
      world.size,
      this.terrain,
      TerrainSunMask.statueParts(world),
    );
    this.installMaterial(this.terrain.material);
    for (const material of Object.values(materials)) this.installMaterial(material);
    this.sun.castShadow = true;
    const initialShadow = shadowSize;
    this.sun.shadow.mapSize.set(initialShadow, initialShadow);
    this.applyShadowExtent(0);
    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(2500, 24, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: {
          sun: { value: this.lighting.sunDirection },
          moon: { value: this.lighting.moonDirection },
          sunTint: { value: this.lighting.sunTint },
          starStrength: { value: 0 },
          skyTime: { value: 0 },
          zenithColor: { value: this.lighting.zenithColor },
          horizonColor: { value: this.lighting.horizonColor },
          waterColor: { value: this.lighting.waterColor },
          horizonDip: { value: 0 },
          oceanBlendEnd: { value: 7000 },
          oceanEnabled: { value: this.hell ? 0 : 1 },
          laserDim: { value: 0 },
          hazeDensity: { value: this.hell ? 0 : AERIAL_FOG_DENSITY },
          hazeScale: { value: AERIAL_FOG_SCALE_HEIGHT },
        },
        vertexShader:
          "varying vec3 vDirection; void main(){vDirection=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}",
        fragmentShader: SKY_FRAGMENT,
      }),
    );
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -10;
    this.scene.add(this.sky);

    this.scene.add(this.sun, this.sun.target, this.ambient, this.dynamicLights.halos.points);
    this.water = makeOcean(
      this.terrain,
      this.hell ? undefined : this.sky.material.uniforms,
    );
    this.rivers = makeRivers(world, this.terrain);
    this.sunMask.exclude(this.water.material);
    this.sunMask.exclude(this.rivers.userData.material as THREE.Material);
    this.scene.add(this.water, this.rivers);
    if (!this.hell) {
      this.coastline = new CoastlineView(this.terrain);
      this.scene.add(this.coastline.group);
      this.installMaterial(this.coastline.beach.material);
      this.installMaterial(this.coastline.rocks.material as THREE.MeshStandardMaterial);
      this.aerialFog = new AerialFog(this.lighting.horizonColor);
      this.scene.fog = this.aerialFog;
    }
    if (this.hell) {
      this.water.visible = false;
      this.scene.fog = new THREE.FogExp2("#7e382f", 0.00046);
      const lava = new THREE.ShaderMaterial({
        side: THREE.DoubleSide,
        uniforms: { time: { value: 0 } },
        vertexShader: `varying vec2 vUv; varying float vDepth;
          void main(){vUv=uv;vec4 view=modelViewMatrix*vec4(position,1.);
          vDepth=-view.z;gl_Position=projectionMatrix*view;}`,
        fragmentShader: `uniform float time;varying vec2 vUv;varying float vDepth;
          void main(){vec2 p=vUv*170.;
          float flow=sin(p.x*1.8+sin(p.y*.7+time*.25)*2.5+time*.4)
            *sin(p.y*1.3+sin(p.x*.5-time*.3)*2.0);
          float cracks=smoothstep(.54,.9,flow);
          float embers=pow(max(0.,sin(p.x*5.+time)*sin(p.y*4.-time*.8)),12.)*.16;
          vec3 color=mix(vec3(.15,.025,.02),vec3(1.,.25,.025),cracks*.85+embers);
          float fog=1.-exp(-vDepth*.0014);
          color=mix(color,vec3(.46,.18,.17),clamp(fog,0.,.88));
          gl_FragColor=vec4(color,1.);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          }`,
      });
      const abyss = new THREE.Mesh(
        new THREE.PlaneGeometry(world.size * 3, world.size * 3),
        lava,
      );
      abyss.rotation.x = -Math.PI / 2;
      abyss.position.set(world.size / 2, HELL_LAVA_LEVEL, world.size / 2);
      this.abyss = abyss;
      this.scene.add(abyss);
    }
  }
  update(
    snap: SimulationSnapshot,
    camera: THREE.PerspectiveCamera,
    position: THREE.Vector3,
    renderDistance: number,
    reduced: boolean,
  ) {
    this.sky.position.copy(camera.position);
    const horizon = oceanHorizon(camera.position.y);
    this.sky.material.uniforms.horizonDip.value = horizon.dip;
    this.sky.material.uniforms.oceanBlendEnd.value = horizon.blendEnd;
    this.lighting.update(snap.hour);
    if (this.hell) {
      this.lighting.zenithColor.set("#813728");
      this.lighting.horizonColor.set("#d66b39");
      this.lighting.sunColor.set("#ffb16d");
      this.lighting.ambientColor.set("#d18c72");
      this.lighting.groundColor.set("#8e4738");
      this.lighting.waterColor.set("#ff6725");
      this.lighting.sunIntensity = 2.4;
      this.lighting.ambientIntensity = 2.2;
    }
    const { night, lightDirection: ld } = this.lighting;
    const show = this.disco.update(snap.lasers, snap.time, reduced);
    this.sky.material.uniforms.laserDim.value = show * .88;
    this.skyReflection.uniforms.skyReflStrength.value = 1 - show * 0.88;
    this.sky.material.uniforms.starStrength.value = this.hell
      ? 0
      : this.lighting.starStrength * (1 - show);
    this.sky.material.uniforms.skyTime.value = snap.time;
    this.lighting.sunIntensity *= 1 - show * .94;
    this.lighting.ambientIntensity *= 1 - show * .65;
    this.aerialFog?.color
      .copy(this.lighting.horizonColor)
      .multiplyScalar(1 - show * 0.88);
    this.updateShadowFrame(camera, position, ld);
    this.sun.intensity = this.lighting.sunIntensity;
    this.sun.color.copy(this.lighting.sunColor);
    this.ambient.intensity = this.lighting.ambientIntensity;
    this.ambient.color.copy(this.lighting.ambientColor);
    this.ambient.groundColor.copy(this.lighting.groundColor);
    this.materials.window.emissiveIntensity = night * 0.45;
    this.water.material.color.copy(this.lighting.waterColor);
    this.water.userData.time.value = snap.time;
    this.coastline?.update(snap.time,(1-night*.83)*(1-show*.85));
    const riverMaterial = this.rivers.userData
      .material as THREE.MeshStandardMaterial;
    riverMaterial.color.copy(this.lighting.waterColor);
    if (this.hell) {
      riverMaterial.emissiveIntensity = 2.1 + Math.sin(snap.time * 2) * 0.35;
      if (this.abyss) this.abyss.material.uniforms.time.value = snap.time;
    }
    this.rivers.userData.time.value = snap.time;
    // Extending the terrain horizon must not extend detailed river residency.
    for (const child of this.rivers.children) {
      const bounds = (child as THREE.Mesh).geometry.boundingSphere!;
      const dx = bounds.center.x - camera.position.x;
      const dz = bounds.center.z - camera.position.z;
      child.visible = dx * dx + dz * dz < (renderDistance + bounds.radius) ** 2;
    }
  }

  /** Adds the laser disco projection, island-wide sun shadows, sky reflections and local lights to a material. */
  installMaterial(material: THREE.Material) {
    this.disco.install(material);
    this.sunMask.install(material);
    this.skyReflection.install(material);
    this.dynamicLights.install(material);
  }

  /** Sizes, leads and texel-snaps the sun's shadow box for this frame. */
  private updateShadowFrame(
    camera: THREE.PerspectiveCamera,
    position: THREE.Vector3,
    ld: THREE.Vector3,
  ) {
    const ground = Math.max(0, this.terrain.sample(position.x, position.z));
    const extent = shadowExtentIndex(
      position.y - ground,
      this.shadowMaxHalf,
      this.shadowExtent,
    );
    // Quality changes resize the map elsewhere; rescale bias to the new texels.
    if (
      extent !== this.shadowExtent ||
      this.sun.shadow.mapSize.x !== this.biasMapSize
    )
      this.applyShadowExtent(extent);
    const half = SHADOW_HALF_EXTENTS[this.shadowExtent];
    const center = this.shadowCenter.set(position.x, ground, position.z);
    camera.getWorldDirection(this.viewDirection);
    leadShadowCenter(center, this.viewDirection, half);
    snapShadowCenter(center, ld, (half * 2) / this.sun.shadow.mapSize.x);
    this.shadowReach = shadowCasterReach(
      half,
      Math.hypot(center.x - camera.position.x, center.z - camera.position.z),
    );
    this.sun.position.copy(center).addScaledVector(ld, SHADOW_SUN_DISTANCE);
    this.sun.target.position.copy(center);
  }

  /** Applies a box size and the bias matching its texel size. */
  private applyShadowExtent(index: number) {
    this.shadowExtent = index;
    this.biasMapSize = this.sun.shadow.mapSize.x;
    const half = SHADOW_HALF_EXTENTS[index];
    Object.assign(this.sun.shadow.camera, {
      left: -half,
      right: half,
      top: half,
      bottom: -half,
      near: 1,
      far: SHADOW_FAR,
    });
    const { bias, normalBias } = shadowBias(
      (half * 2) / this.sun.shadow.mapSize.x,
    );
    this.sun.shadow.bias = bias;
    this.sun.shadow.normalBias = normalBias;
    this.sun.shadow.camera.updateProjectionMatrix();
  }

  reset() {
    this.water.userData.time.value = 0;
    this.disco.reset();
    this.dynamicLights.clear();
    this.sky.material.uniforms.laserDim.value = 0;
  }
  dispose(resources: ResourceDisposal) {
    this.sun.shadow.dispose();
    this.sunMask.dispose();
    this.dynamicLights.halos.points.removeFromParent();
    this.dynamicLights.dispose();
    for (const object of [this.sky, this.water, this.rivers, this.abyss, this.disco.group, this.coastline?.group]) {
      if (!object) continue;
      resources.collect(object);
      object.removeFromParent();
    }
    if (this.hell || this.scene.fog === this.aerialFog) this.scene.fog = null;
    this.sun.removeFromParent();
    this.sun.target.removeFromParent();
    this.ambient.removeFromParent();
  }
}
