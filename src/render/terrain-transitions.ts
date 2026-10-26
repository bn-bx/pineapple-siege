import * as THREE from "three";

export const TERRAIN_TRANSITION_SECONDS = 0.55;

/** Retain the previous surface briefly; no transparent sorting or extra world data. */
export class TerrainTransitions {
  readonly clock = { value: 0 };
  readonly material: THREE.Material;
  readonly depth = new THREE.MeshDepthMaterial({
    depthPacking: THREE.RGBADepthPacking,
  });
  private retiring = new Map<
    number,
    { mesh: THREE.Mesh; incoming: THREE.Mesh; until: number }
  >();
  constructor(
    private group: THREE.Group,
    private stableMaterial: THREE.Material,
  ) {
    this.material = stableMaterial.clone();
    this.material.onBeforeCompile = stableMaterial.onBeforeCompile;
    const key = stableMaterial.customProgramCacheKey();
    this.material.customProgramCacheKey = () => key;
    this.install(this.material);
    this.install(this.depth);
  }
  private install(material: THREE.Material) {
    const prior = material.onBeforeCompile;
    const key = material.customProgramCacheKey();
    const mask: THREE.Material["onBeforeCompile"] = (shader) => {
      shader.fragmentShader = `varying float terrainBlendProgress;
varying float terrainBlendDirection;
${shader.fragmentShader}`.replace(
        /void main\s*\(\s*\)\s*\{/,
        `void main() {
float terrainBlendNoise = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
if (terrainBlendDirection > 0.0 && terrainBlendNoise >= terrainBlendProgress) discard;
if (terrainBlendDirection < 0.0 && terrainBlendNoise < terrainBlendProgress) discard;
`,
      );
    };
    material.onBeforeCompile = (shader, renderer) => {
      prior.call(material, shader, renderer);
      shader.uniforms.terrainBlendClock = this.clock;
      shader.vertexShader = `attribute vec2 terrainBlend;
uniform float terrainBlendClock;
varying float terrainBlendProgress;
varying float terrainBlendDirection;
${shader.vertexShader}`.replace(
        /void main\s*\(\s*\)\s*\{/,
        `void main() {
terrainBlendProgress = smoothstep(0.0, ${TERRAIN_TRANSITION_SECONDS.toFixed(2)}, terrainBlendClock - terrainBlend.x);
terrainBlendDirection = terrainBlend.y;
`,
      );
      mask(shader, renderer);
    };
    material.customProgramCacheKey = () => `${key}:terrain-blend-v1`;
    material.userData.prepassMaskKey = "terrain-blend-v1";
    material.userData.prepassMask = mask;
  }
  setBlend(geometry: THREE.BufferGeometry, direction = 0) {
    const existing = geometry.getAttribute("terrainBlend") as
      | THREE.BufferAttribute
      | undefined;
    const attribute =
      existing ??
      new THREE.BufferAttribute(
        new Float32Array(geometry.getAttribute("position").count * 2),
        2,
      );
    const values = attribute.array as Float32Array;
    values.fill(0);
    if (direction)
      for (let i = 0; i < values.length; i += 2) {
        values[i] = this.clock.value;
        values[i + 1] = direction;
      }
    if (existing) attribute.needsUpdate = true;
    else geometry.setAttribute("terrainBlend", attribute);
  }
  active(key: number) {
    return this.retiring.has(key);
  }
  replace(key: number, incoming: THREE.Mesh, previous?: THREE.Mesh) {
    this.finish(key);
    incoming.material = previous ? this.material : this.stableMaterial;
    incoming.customDepthMaterial = previous ? this.depth : undefined;
    this.setBlend(incoming.geometry, previous ? 1 : 0);
    if (!previous) return;
    this.setBlend(previous.geometry, -1);
    previous.material = this.material;
    previous.customDepthMaterial = this.depth;
    // The old geometry now belongs to this temporary view until its fade ends.
    previous.castShadow = false;
    previous.renderOrder = incoming.renderOrder;
    this.group.add(previous);
    this.retiring.set(key, {
      mesh: previous,
      incoming,
      until: this.clock.value + TERRAIN_TRANSITION_SECONDS,
    });
  }
  update(now = performance.now() / 1000) {
    this.clock.value = now;
    for (const [key, item] of this.retiring)
      if (now >= item.until) this.finish(key);
  }
  finish(key: number) {
    const item = this.retiring.get(key);
    if (!item) return;
    item.incoming.material = this.stableMaterial;
    item.incoming.customDepthMaterial = undefined;
    item.mesh.removeFromParent();
    item.mesh.geometry.dispose();
    this.retiring.delete(key);
  }
  clear() {
    for (const key of this.retiring.keys()) this.finish(key);
  }
  dispose() {
    this.clear();
    this.depth.dispose();
    this.material.dispose();
  }
}
