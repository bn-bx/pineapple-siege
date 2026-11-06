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
    // The swash lies within centimeters of the sand it washes over; without
    // a bias it depth-fights the beach and shimmers as the camera moves.
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
    side: THREE.DoubleSide,
    fog: true,
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      time: { value: 0 },
      brightness: { value: 1 },
    },
    vertexShader: `#include <common>
      #include <fog_pars_vertex>
      attribute float shoreDistance;varying float surfDistance;varying vec2 surfWorld;
      void main(){
        #include <begin_vertex>
        surfDistance=shoreDistance;surfWorld=position.xz;
        vec4 mvPosition=modelViewMatrix*vec4(transformed,1.);
        gl_Position=projectionMatrix*mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `uniform float time,brightness;varying float surfDistance;varying vec2 surfWorld;
      #include <common>
      #include <fog_pars_fragment>
      ${COASTAL_NOISE_GLSL}
      void main(){
        #include <clipping_planes_fragment>
        vec2 p=surfWorld;float d=surfDistance;
        float broad=coastFbm(p*.036);
        // Meters per pixel. Fine lace and froth are band-limited by it, so
        // from altitude they settle to their average instead of shimmering.
        float footprint=length(fwidth(p));
        float fineDetail=1.-smoothstep(.25,1.,footprint*.48);
        float frothDetail=1.-smoothstep(.25,1.,footprint*1.7);
        float fine=coastFbm(p*.48+vec2(time*.12,-time*.09));
        float laceAA=fwidth(fine);
        fine=mix(.5,fine,fineDetail);
        float warped=d+(broad-.5)*12.;
        float phase=warped*.15+time*.52;
        float aa=max(.045,fwidth(phase));
        float line=1.-smoothstep(.035+aa,.12+aa,abs(sin(phase)));
        float broken=smoothstep(.34,.63,coastFbm(p*.075+time*.015));
        // 0.31 is the lace's mean coverage over the noise field.
        float lace=mix(.31,1.-smoothstep(.025,.095+laceAA,abs(fine-.51)),fineDetail);
        float crest=line*(.15+lace*.85)*broken;
        float zone=(1.-smoothstep(12.,65.,d))*smoothstep(-3.,2.,d);
        float swash=(1.-smoothstep(1.,6.,warped))*(.24+fine*.65);
        float residue=lace*broken*.3*(1.-smoothstep(4.,18.,d));
        float foam=max(crest*zone,max(swash,residue))*smoothstep(-3.,0.,d);
        float froth=mix(.5,coastNoise(p*1.7+time*.1),frothDetail);
        foam*=.74+.26*froth;
        float alpha=clamp(foam*.94,0.,.88);
        if(alpha<.018)discard;
        gl_FragColor=vec4(vec3(.88,.97,.94)*brightness,alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  waterPrepass(material, terrain.heightTexture, terrain.floodTexture);
  material.onBeforeCompile = (shader) => material.userData.prepassMask(shader);
  material.customProgramCacheKey = () =>
    `${material.userData.prepassMaskKey}-lacy-surf-v3`;
  const surf = new THREE.Mesh(geometry, material);
  surf.name = "Lacy surf following coves and headlands";
  surf.renderOrder = 2;
  return surf;
}
