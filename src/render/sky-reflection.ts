import * as THREE from "three";

/** Materials at least this metallic get sky reflections. */
export const SKY_REFLECTION_MIN_METALNESS = 0.2;

/**
 * Cheap sky reflections for metal (the Pineapple God's gold, aircraft, flies).
 *
 * Three.js renders metal nearly black without an environment map, because
 * metal has almost no diffuse colour. Instead of rendering and blurring an
 * environment map (a GPU hitch whenever the time of day moves on), each metal
 * fragment evaluates the same analytic sky gradient the sky dome uses, in its
 * reflection direction, and feeds it to Three's indirect-specular term so the
 * usual Fresnel and roughness weighting still apply. Rough metal sees an
 * average of sky and ground; below the horizon it reflects darker ground.
 */
export class SkyReflection {
  readonly uniforms: {
    skyReflZenith: { value: THREE.Color };
    skyReflHorizon: { value: THREE.Color };
    skyReflGround: { value: THREE.Color };
    skyReflStrength: { value: number };
  };
  private installed = new WeakSet<THREE.Material>();

  constructor(zenith: THREE.Color, horizon: THREE.Color, ground: THREE.Color) {
    this.uniforms = {
      skyReflZenith: { value: zenith },
      skyReflHorizon: { value: horizon },
      skyReflGround: { value: ground },
      skyReflStrength: { value: 1 },
    };
  }

  static wants(material: THREE.Material) {
    return (
      material instanceof THREE.MeshStandardMaterial &&
      !material.envMap &&
      material.metalness >= SKY_REFLECTION_MIN_METALNESS
    );
  }

  install(material: THREE.Material) {
    if (!SkyReflection.wants(material) || this.installed.has(material)) return;
    this.installed.add(material);
    const prior = material.onBeforeCompile,
      key = material.customProgramCacheKey();
    material.onBeforeCompile = (shader, renderer) => {
      prior.call(material, shader, renderer);
      Object.assign(shader.uniforms, this.uniforms);
      if (shader.fragmentShader.includes("vec3 skyReflection(")) return;
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <lights_pars_begin>",
          `#include <lights_pars_begin>
          uniform vec3 skyReflZenith, skyReflHorizon, skyReflGround;
          uniform float skyReflStrength;
          vec3 skyReflection(vec3 r, float rough){
            vec3 sky=mix(skyReflZenith,skyReflHorizon,pow(1.-max(r.y,0.),3.));
            vec3 ground=mix(skyReflGround,skyReflHorizon,.35)*.45;
            vec3 c=mix(ground,sky,smoothstep(-.12,.06,r.y));
            vec3 diffuseSky=mix(ground,(skyReflZenith+skyReflHorizon)*.5,.65);
            return mix(c,diffuseSky,rough*rough);
          }`,
        )
        .replace(
          "#include <lights_fragment_maps>",
          `#include <lights_fragment_maps>
          #if defined( RE_IndirectSpecular )
            radiance+=skyReflection(inverseTransformDirection(reflect(-geometryViewDir,geometryNormal),viewMatrix),material.roughness)*skyReflStrength;
          #endif`,
        );
    };
    material.customProgramCacheKey = () => `${key}:sky-reflection-v1`;
    material.needsUpdate = true;
  }
}
