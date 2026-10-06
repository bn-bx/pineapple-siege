import * as THREE from "three";

export interface ParticleDepth {
  texture: THREE.IUniform<THREE.Texture>;
  viewport: THREE.IUniform<THREE.Vector2>;
  range: THREE.IUniform<THREE.Vector2>;
  enabled: THREE.IUniform<number>;
}
const applied = new WeakMap<
  THREE.Material,
  THREE.Material["onBeforeCompile"]
>();
/** Sample a separate, current-frame depth target; never sample the beauty attachment. */
export function softenParticles(
  material: THREE.Material,
  depth: ParticleDepth,
  softness = 3,
  customVertex = false,
) {
  if (applied.get(material) === material.onBeforeCompile) return;
  const prior = material.onBeforeCompile.bind(material),
    key = material.customProgramCacheKey.bind(material);
  const hook: THREE.Material["onBeforeCompile"] = (shader, renderer) => {
    prior(shader, renderer);
    shader.uniforms.particleSceneDepth = depth.texture;
    shader.uniforms.particleViewport = depth.viewport;
    shader.uniforms.particleRange = depth.range;
    shader.uniforms.particleSoftEnabled = depth.enabled;
    shader.uniforms.particleSoftness = { value: softness };
    const declaration = "varying float particleViewDepth;";
    shader.vertexShader = declaration + "\n" + shader.vertexShader;
    shader.vertexShader = customVertex
      ? shader.vertexShader.replace(
          "gl_Position=projectionMatrix*center;",
          "particleViewDepth=-center.z;gl_Position=projectionMatrix*center;",
        )
      : shader.vertexShader.replace(
          "#include <project_vertex>",
          "#include <project_vertex>\nparticleViewDepth=-mvPosition.z;",
        );
    shader.fragmentShader =
      `uniform sampler2D particleSceneDepth;
      uniform vec2 particleViewport,particleRange;
      uniform float particleSoftEnabled,particleSoftness;
      ${declaration}
      float particleDepthFade(){
        if(particleSoftEnabled<.5)return 1.;
        vec4 packed=texture2D(particleSceneDepth,gl_FragCoord.xy/particleViewport);
        // Three r180 RGBA packing places the most significant byte in red.
        float d=dot(packed,vec4(255./256.,255./65536.,255./16777216.,1./16777216.));
        float distance=particleRange.x*particleRange.y/(particleRange.y-(particleRange.y-particleRange.x)*d);
        return clamp((distance-particleViewDepth)/particleSoftness,0.,1.);
      }\n` + shader.fragmentShader;
    shader.fragmentShader = customVertex
      ? shader.fragmentShader.replace(
          "gl_FragColor=vec4(c,a);",
          "gl_FragColor=vec4(c,a*particleDepthFade());",
        )
      : shader.fragmentShader.replace(
          "#include <tonemapping_fragment>",
          "gl_FragColor.a*=particleDepthFade();\n#include <tonemapping_fragment>",
        );
  };
  material.onBeforeCompile = hook;
  material.customProgramCacheKey = () =>
    `${key()}:soft-particles-v1:${softness}`;
  applied.set(material, hook);
  material.needsUpdate = true;
}
