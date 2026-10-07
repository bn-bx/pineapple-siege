import * as THREE from "three";
import { LASER } from "../config";
import type { Material, SimulationSnapshot, WorldData } from "../types";
import { EnvironmentLighting, SKY_FRAGMENT } from "./environment-lighting";
import { makeOcean } from "./ocean";
import type { ResourceDisposal } from "./resource-disposal";
import { makeRivers } from "./river-view";
import type { TerrainView } from "./terrain-view";
/** Lighting and water share authoritative hour, strike age, and terrain masks. */
export class EnvironmentView {
  readonly lighting = new EnvironmentLighting();
  readonly shadowCenter = new THREE.Vector3();
  readonly sky: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  readonly sun = new THREE.DirectionalLight("#fff0d2", 2.8);
  readonly ambient = new THREE.HemisphereLight("#c4e3f4", "#565b32", 1.8);
  readonly water: ReturnType<typeof makeOcean>;
  readonly rivers: THREE.Group;
  constructor(
    private scene: THREE.Scene,
    private terrain: TerrainView,
    world: WorldData,
    private materials: Record<Material, THREE.MeshStandardMaterial>,
    shadowSize: number,
  ) {
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
    this.water = makeOcean(this.terrain);
    this.rivers = makeRivers(world, this.terrain);
    this.scene.add(this.water, this.rivers);
  }
  update(
    snap: SimulationSnapshot,
    camera: THREE.PerspectiveCamera,
    position: THREE.Vector3,
    renderDistance: number,
    reduced: boolean,
  ) {
    this.sky.position.copy(camera.position);
    this.lighting.update(snap.hour);
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
    for (const object of [this.sky, this.water, this.rivers]) {
      resources.collect(object);
      object.removeFromParent();
    }
    this.sun.removeFromParent();
    this.sun.target.removeFromParent();
    this.ambient.removeFromParent();
  }
}
