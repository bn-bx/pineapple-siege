import * as THREE from "three";
import { COASTAL_NOISE_GLSL } from "./coastal-noise";
import type { ShoreSegment } from "./coastline";
import type { TerrainView } from "./terrain-view";
import { waterPrepass } from "./water-prepass";

/** A curved, animated surf zone with lacy crests, rather than a solid outline. */
export function makeCoastalSurf(
  segments: ShoreSegment[],
  sample: (x: number, z: number) => number,
  terrain: TerrainView,
) {
  const positions: number[] = [],
    distances: number[] = [],
    indices: number[] = [];
  const bands = [-3, 0, 4, 10, 19, 32, 50, 75, 105];
  for (const segment of segments) {
    const start = positions.length / 3;
    for (const [x, z] of segment) {
      const dx = sample(x + 6, z) - sample(x - 6, z),
        dz = sample(x, z + 6) - sample(x, z - 6);
      const length = Math.hypot(dx, dz) || 1;
      for (const d of bands) {
        positions.push(x - (dx / length) * d, 0.15, z - (dz / length) * d);
        distances.push(d);
      }
    }
    for (let j = 0; j < bands.length - 1; j++) {
      const a = start + j,
        b = a + bands.length;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute(
    "shoreDistance",
    new THREE.Float32BufferAttribute(distances, 1),
  );
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: { time: { value: 0 }, brightness: { value: 1 } },
    vertexShader: `#include <common>
      attribute float shoreDistance;varying float surfDistance;varying vec2 surfWorld;
      void main(){
        #include <begin_vertex>
        surfDistance=shoreDistance;surfWorld=position.xz;
        gl_Position=projectionMatrix*modelViewMatrix*vec4(transformed,1.);}`,
    fragmentShader: `uniform float time,brightness;varying float surfDistance;varying vec2 surfWorld;
      #include <common>
      ${COASTAL_NOISE_GLSL}
      void main(){
        #include <clipping_planes_fragment>
        vec2 p=surfWorld;float d=surfDistance;
        float broad=coastFbm(p*.036);
        float fine=coastFbm(p*.48+vec2(time*.12,-time*.09));
        float warped=d+(broad-.5)*12.;
        float phase=warped*.15+time*.52;
        float aa=max(.045,fwidth(phase));
        float line=1.-smoothstep(.035+aa,.12+aa,abs(sin(phase)));
        float broken=smoothstep(.34,.63,coastFbm(p*.075+time*.015));
        float lace=1.-smoothstep(.025,.095,abs(fine-.51));
        float crest=line*(.15+lace*.85)*broken;
        float zone=(1.-smoothstep(12.,65.,d))*smoothstep(-3.,2.,d);
        float swash=(1.-smoothstep(1.,6.,warped))*(.24+fine*.65);
        float residue=lace*broken*.3*(1.-smoothstep(4.,18.,d));
        float foam=max(crest*zone,max(swash,residue))*smoothstep(-3.,0.,d);
        float froth=coastNoise(p*1.7+time*.1);
        foam*=.74+.26*froth;
        float alpha=clamp(foam*.94,0.,.88);
        if(alpha<.018)discard;
        gl_FragColor=vec4(vec3(.88,.97,.94)*brightness,alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  waterPrepass(material, terrain.heightTexture, terrain.floodTexture);
  material.onBeforeCompile = (shader) => material.userData.prepassMask(shader);
  material.customProgramCacheKey = () =>
    `${material.userData.prepassMaskKey}-lacy-surf-v1`;
  const surf = new THREE.Mesh(geometry, material);
  surf.name = "Lacy surf following coves and headlands";
  surf.renderOrder = 2;
  return surf;
}
