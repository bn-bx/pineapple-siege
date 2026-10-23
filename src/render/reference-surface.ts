import * as THREE from "three";

/** Reference surface on model UVs, not a camera-facing image. Its photographed
 * lighting cannot be fully removed from a single view. Keep a clay inspection
 * mode and never treat projected landmark agreement as geometry evidence. */
export function applyReferenceSurface(
  material: THREE.MeshStandardMaterial,
  texture: THREE.Texture,
) {
  const strength = { value: 1 };
  material.map = texture; // Also registers this owned texture for disposal.
  material.onBeforeCompile = (shader) => {
    shader.uniforms.surfaceStrength = strength;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
        attribute float surfaceWeight;
        varying float vSurfaceWeight;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        vSurfaceWeight = surfaceWeight;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        varying float vSurfaceWeight;
        uniform float surfaceStrength;
        // Invert the review renderer's ACES transform to avoid applying a
        // second photographic tone curve. Texture samples are linear sRGB.
        vec3 referenceRadiance(vec3 c) {
          const mat3 inverseOutput = mat3(
            0.64303891, 0.05926869, 0.00596190,
            0.31118675, 0.93143649, 0.06392921,
            0.04577434, 0.00929492, 0.93010889);
          const mat3 inverseInput = mat3(
            1.76474097, -0.14702785, -0.03633683,
            -0.67577768, 1.16025151, -0.16243644,
            -0.08896329, -0.01322366, 1.19877327);
          vec3 f = clamp(inverseOutput*c, vec3(0.0), vec3(0.98));
          vec3 a = 1.0-0.983729*f;
          vec3 b = 0.0245786-0.432951*f;
          vec3 d = -0.000090537-0.238081*f;
          vec3 v = (-b+sqrt(max(vec3(0.0),b*b-4.0*a*d)))/(2.0*a);
          return max(vec3(0.0), 0.6*inverseInput*v);
        }`,
      )
      .replace(
        "#include <map_fragment>",
        "// Reference map is applied after lighting below.",
      )
      .replace(
        "#include <opaque_fragment>",
        `
        vec3 photographed = referenceRadiance(texture2D(map, vMapUv).rgb);
        vec3 response = clamp(outgoingLight / max(diffuseColor.rgb, vec3(0.02)), vec3(0.65), vec3(1.6));
        // Retain modest live light response. Source shadows still remain;
        // this is an appearance reconstruction, not true recovered albedo.
        vec3 surfaced = photographed * mix(vec3(1.0), response, 0.12) + totalEmissiveRadiance;
        outgoingLight = mix(outgoingLight, surfaced, clamp(vSurfaceWeight*surfaceStrength, 0.0, 1.0));
        #include <opaque_fragment>`,
      );
  };
  material.customProgramCacheKey = () => "reference-surface-v1";
  material.needsUpdate = true;
  return strength;
}
