import * as THREE from "three";

/** Fires and hot spots that melt the snow around them (x, z, radius, 0). */
export const SNOW_MELT_SLOTS = 8;

/**
 * Snow lying on every upward-facing surface: terrain, roofs, tree crowns,
 * rocks, the statue. One shader patch on the shared materials, so it costs
 * no extra draws and follows destruction for free (fresh craters show their
 * brown earth, which the terrain marks with its scar colour).
 *
 * Materials opt in with `userData.snowSlope`: the world-up component of the
 * surface normal where snow starts to stick (lower for steep roofs and pine
 * crowns). `userData.snowMax` caps the coverage (pine needles keep some
 * green). `userData.snowEarth` makes brown and charred vertex colours shed
 * snow, which keeps craters, beaches and roads bare.
 */
export class SnowCover {
  readonly uniforms = {
    snowAmount: { value: 1 },
    snowMelt: {
      value: Array.from(
        { length: SNOW_MELT_SLOTS },
        () => new THREE.Vector4(0, 0, 0, 0),
      ),
    },
  };
  private installed = new WeakSet<THREE.Material>();

  static wants(material: THREE.Material) {
    return (
      material instanceof THREE.MeshStandardMaterial &&
      typeof material.userData.snowSlope === "number"
    );
  }

  install(material: THREE.Material) {
    if (!SnowCover.wants(material) || this.installed.has(material)) return;
    this.installed.add(material);
    const slope = (material.userData.snowSlope as number).toFixed(3),
      earth = material.userData.snowEarth === true,
      max = (typeof material.userData.snowMax === "number" ? material.userData.snowMax : 1).toFixed(3);
    const prior = material.onBeforeCompile,
      key = material.customProgramCacheKey();
    material.onBeforeCompile = (shader, renderer) => {
      prior.call(material, shader, renderer);
      Object.assign(shader.uniforms, this.uniforms);
      if (shader.vertexShader.includes("varying vec3 vSnowWorld;")) return;
      shader.vertexShader =
        `varying vec3 vSnowWorld;\n${shader.vertexShader}`.replace(
          "#include <project_vertex>",
          `#include <project_vertex>
        vec4 snowPosition = vec4(transformed, 1.);
        #ifdef USE_BATCHING
          snowPosition = batchingMatrix * snowPosition;
        #endif
        #ifdef USE_INSTANCING
          snowPosition = instanceMatrix * snowPosition;
        #endif
        vSnowWorld = (modelMatrix * snowPosition).xyz;`,
        );
      shader.fragmentShader = `varying vec3 vSnowWorld;
        uniform float snowAmount;
        uniform vec4 snowMelt[${SNOW_MELT_SLOTS}];
        float snowHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
        float snowNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
          return mix(mix(snowHash(i),snowHash(i+vec2(1,0)),f.x),mix(snowHash(i+vec2(0,1)),snowHash(i+1.),f.x),f.y);}
        ${shader.fragmentShader}`.replace(
        "#include <emissivemap_fragment>",
        `
        if (snowAmount > .001) {
          vec3 snowNormal = inverseTransformDirection(normal, viewMatrix);
          float drift = snowNoise(vSnowWorld.xz * .013) * .65 + snowNoise(vSnowWorld.xz * .09) * .35;
          float settle = smoothstep(${slope}, ${slope} + .22, snowNormal.y + (drift - .5) * .28);
          // Patchy in the lowlands, a full blanket on the heights.
          float depth = clamp(.42 + vSnowWorld.y / 420. + (drift - .5) * .9, 0., 1.);
          float cover = settle * depth * smoothstep(1.5, 7., vSnowWorld.y);
          #if defined( USE_COLOR ) && ${earth ? 1 : 0}
            // Craters, beaches and roads are brown; charred scars are dark.
            float brown = smoothstep(.035, .085, vColor.r - vColor.g);
            float charred = 1. - smoothstep(.035, .08, dot(vColor, vec3(.33)));
            cover *= 1. - max(brown, charred);
          #endif
          for (int i = 0; i < ${SNOW_MELT_SLOTS}; i++) {
            vec4 melt = snowMelt[i];
            if (melt.z > 0.) cover *= smoothstep(melt.z * .6, melt.z, distance(vSnowWorld.xz, melt.xy));
          }
          cover *= snowAmount * ${max};
          float sparkle = step(.985, snowHash(floor(vSnowWorld.xz * 2.3))) * .35;
          vec3 snowColor = vec3(.9, .93, .98) + sparkle;
          diffuseColor.rgb = mix(diffuseColor.rgb, snowColor, cover);
          roughnessFactor = mix(roughnessFactor, .82, cover);
          metalnessFactor = mix(metalnessFactor, 0., cover);
        }
        #include <emissivemap_fragment>`,
      );
    };
    material.customProgramCacheKey = () =>
      `${key}:snow-cover-v2:${slope}:${earth}:${max}`;
    material.needsUpdate = true;
  }

  /**
   * Fills the melt slots: `pinned` spots (nuke patches) always keep theirs,
   * the remaining slots go to the fires nearest the camera. Fires inside a
   * pinned patch add nothing, so they never crowd it out.
   */
  setMelt(
    pinned: readonly { p: readonly number[]; radius: number }[],
    fires: readonly { p: readonly number[]; radius: number }[],
    camera: THREE.Vector3,
  ) {
    const slots = this.uniforms.snowMelt.value;
    const chosen = pinned.slice(0, SNOW_MELT_SLOTS);
    const loose = fires.filter(
      (f) =>
        !chosen.some(
          (m) => (f.p[0] - m.p[0]) ** 2 + (f.p[2] - m.p[2]) ** 2 < (m.radius * 0.6) ** 2,
        ),
    );
    const free = SNOW_MELT_SLOTS - chosen.length;
    chosen.push(
      ...(loose.length > free
        ? [...loose].sort(
            (a, b) =>
              (a.p[0] - camera.x) ** 2 + (a.p[2] - camera.z) ** 2 -
              ((b.p[0] - camera.x) ** 2 + (b.p[2] - camera.z) ** 2),
          )
        : loose
      ).slice(0, free),
    );
    for (let i = 0; i < SNOW_MELT_SLOTS; i++) {
      const spot = chosen[i];
      if (spot) slots[i].set(spot.p[0], spot.p[2], spot.radius, 0);
      else slots[i].set(0, 0, 0, 0);
    }
  }
}
