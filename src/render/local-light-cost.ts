import * as THREE from "three";

const installed = new WeakSet<THREE.Material>();
const source = THREE.ShaderChunk.lights_fragment_begin;
const pointStart = source.indexOf("\tPointLight pointLight;"),
  pointEnd = source.indexOf("#if ( NUM_SPOT_LIGHTS");
const pointLoop = source
  .slice(pointStart, pointEnd)
  .replace(
    "pointLight = pointLights[ i ];",
    `pointLight = pointLights[ i ];
    { vec3 localLightOffset=pointLight.position-geometryPosition;
    if(any(notEqual(pointLight.color,vec3(0.))) &&
      (pointLight.distance<=0. || dot(localLightOffset,localLightOffset)<pointLight.distance*pointLight.distance)){`,
  )
  .replace(
    "material, reflectedLight );",
    "material, reflectedLight );\n    } }",
  );
const guarded =
  source.slice(0, pointStart) + pointLoop + source.slice(pointEnd);

/** Preserve Three's exact cutoff; avoid its BRDF when contribution is zero. */
export function skipEmptyPointLights(material: THREE.MeshStandardMaterial) {
  if (installed.has(material)) return;
  installed.add(material);
  const prior = material.onBeforeCompile,
    key = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    prior(shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <lights_fragment_begin>",
      guarded,
    );
  };
  material.customProgramCacheKey = () => `${key}:bounded-point-contribution-v1`;
  material.needsUpdate = true;
}
