import * as THREE from "three";
import { HELL_LAVA_LEVEL, LASER } from "../config";
import type { Material, SimulationSnapshot, WorldData } from "../types";
import { EnvironmentLighting, SKY_FRAGMENT } from "./environment-lighting";
import { makeOcean } from "./ocean";
import { oceanHorizon } from "./ocean-horizon";
import type { ResourceDisposal } from "./resource-disposal";
import { makeRivers } from "./river-view";
import type { TerrainView } from "./terrain-view";
/** Lighting and water share authoritative hour, strike age, and terrain masks. */
export class EnvironmentView {
  private hell = false;
  readonly lighting = new EnvironmentLighting();
  readonly shadowCenter = new THREE.Vector3();
  readonly sky: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  readonly sun = new THREE.DirectionalLight("#fff0d2", 2.8);
  readonly ambient = new THREE.HemisphereLight("#c4e3f4", "#565b32", 1.8);
  readonly water: ReturnType<typeof makeOcean>;
  readonly rivers: THREE.Group;
  readonly abyss?: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  constructor(
    private scene: THREE.Scene,
    private terrain: TerrainView,
    world: WorldData,
    private materials: Record<Material, THREE.MeshStandardMaterial>,
    shadowSize: number,
  ) {
    this.hell = world.realm === "hell";
    this.sun.castShadow = true;
    const initialShadow = shadowSize;
    this.sun.shadow.mapSize.set(initialShadow, initialShadow);
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
          waterColor: { value: this.lighting.waterColor },
          horizonDip: { value: 0 },
          oceanBlendEnd: { value: 7000 },
          oceanEnabled: { value: this.hell ? 0 : 1 },
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

    this.scene.add(this.sun, this.sun.target, this.ambient);
    this.water = makeOcean(
      this.terrain,
      this.hell ? undefined : this.sky.material.uniforms,
    );
    this.rivers = makeRivers(world, this.terrain);
    this.scene.add(this.water, this.rivers);
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
      laserDim = Math.max(laserDim, envelope * (reduced ? 0.14 : 0.28));
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
    this.materials.window.emissiveIntensity = night * 0.45;
    this.water.material.color.copy(this.lighting.waterColor);
    this.water.userData.time.value = snap.time;
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

  reset() {
    this.water.userData.time.value = 0;
  }
  dispose(resources: ResourceDisposal) {
    this.sun.shadow.dispose();
    for (const object of [this.sky, this.water, this.rivers, this.abyss]) {
      if (!object) continue;
      resources.collect(object);
      object.removeFromParent();
    }
    if (this.hell) this.scene.fog = null;
    this.sun.removeFromParent();
    this.sun.target.removeFromParent();
    this.ambient.removeFromParent();
  }
}
