import * as THREE from "three";
import { CONFIG } from "../config";
import type { TerrainView } from "./terrain-view";
import { waterPrepass } from "./water-prepass";
import { OCEAN_BACKGROUND_GLSL } from "./ocean-horizon";
import type { TerrainPages } from "./terrain-pages";
import { COASTAL_NOISE_GLSL } from "./coastal-noise";

/** Sample across page boundaries so the surf follows a continuous seabed. */
function coastlineShader(terrain: TerrainView) {
  const pages = terrain.heightTexture.userData.terrainPages as
    | TerrainPages
    | undefined;
  const read = pages
    ? `vec2 page=floor(pixel/${pages.side}.);
       return texture(prepassHeight,vec3((mod(pixel,${pages.side}.)+.5)/${pages.side}.,page.y*${pages.columns}.+page.x)).r;`
    : `return texture2D(prepassHeight,(pixel+.5)/${CONFIG.grid}.).r;`;
  return `
    float coastHeight(vec2 pixel){
      pixel=clamp(pixel,vec2(0.),vec2(${CONFIG.grid - 1}.));
      ${read}
    }
    float coastDepth(vec2 world){
      vec2 p=world/${CONFIG.spacing}.;
      vec2 cell=floor(p), f=fract(p);
      float a=coastHeight(cell), b=coastHeight(cell+vec2(1.,0.));
      float c=coastHeight(cell+vec2(0.,1.)), d=coastHeight(cell+vec2(1.));
      // Match the terrain mesh's triangle diagonal, including damaged shores.
      float h=f.x+f.y<=1. ? a+(b-a)*f.x+(c-a)*f.y
        : d+(c-d)*(1.-f.x)+(b-d)*(1.-f.y);
      return max(0.,-h);
    }`;
}

/** One beauty draw, clipped by the same wet/height data as the simulation. */
export function makeWaterMaterial(
  terrain: TerrainView,
  horizon?: Record<string, THREE.IUniform>,
  coastal = false,
) {
  const time = { value: 0 };
  const material = new THREE.MeshStandardMaterial({
    color: "#285f65",
    roughness: 0.35,
    metalness: 0.1,
    side: THREE.DoubleSide,
  });
  waterPrepass(material, terrain.heightTexture, terrain.floodTexture);
  material.onBeforeCompile = (shader) => {
    material.userData.prepassMask(shader);
    shader.uniforms.oceanTime = time;
    if (horizon) Object.assign(shader.uniforms, horizon);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>\nuniform float oceanTime;\n${horizon ? OCEAN_BACKGROUND_GLSL : ""}`,
      )
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
        vec2 p=prepassWaterWorld.xz;
        float rippleStrength=${horizon ? "1.-smoothstep(oceanBlendEnd*.5,oceanBlendEnd,length(prepassWaterWorld.xz-cameraPosition.xz))" : "1."};
        vec2 ripple=vec2(cos(p.x*.12+oceanTime*.5),sin(p.y*.09-oceanTime*.4))*.035*rippleStrength;
        normal=normalize(normal+(viewMatrix*vec4(ripple.x,0.,ripple.y,0.)).xyz);`,
      );
    if (coastal) {
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "void main() {",
          `${coastlineShader(terrain)}\n${COASTAL_NOISE_GLSL}\nvoid main() {`,
        )
        .replace(
          "#include <color_fragment>",
          `#include <color_fragment>
          float depth=inWorld ? coastDepth(prepassWaterWorld.xz) : 1000.;
          vec2 coastP=prepassWaterWorld.xz;
          float seabed=coastFbm(coastP*.025);
          float shallows=1.-smoothstep(2.,25.,depth+(seabed-.5)*7.);
          vec3 deepBlue=vec3(.008,.075,.14);
          vec3 lagoon=mix(vec3(.012,.24,.34),vec3(.045,.52,.43),shallows);
          diffuseColor.rgb=mix(diffuseColor.rgb,deepBlue,.72);
          diffuseColor.rgb=mix(diffuseColor.rgb,lagoon,shallows*.94);
          float mottling=coastFbm(coastP*.11+seabed*3.);
          diffuseColor.rgb*=.84+mottling*.3;
          float irregular=coastFbm(coastP*.09)*3.;
          float surfPhase=depth*1.65-oceanTime*.85+irregular*.65;
          float aa=max(.04,fwidth(surfPhase));
          float crest=smoothstep(.86-aa,.97+aa,sin(surfPhase));
          float shoreBreak=(1.-smoothstep(1.5,6.,depth))*crest;
          float wash=(1.-smoothstep(.15,1.3,depth))*(.65+.15*sin(oceanTime*.9+irregular));
          float foam=max(wash*.5,shoreBreak*.35);
          float offshorePhase=coastP.x*.035+coastP.y*.045-oceanTime*.55
            +coastFbm(coastP*.018)*7.;
          float offshoreAA=max(.015,fwidth(offshorePhase));
          float wave=smoothstep(.975-offshoreAA,1.+offshoreAA,sin(offshorePhase));
          float brokenWave=smoothstep(.55,.76,coastFbm(coastP*.038+oceanTime*.01));
          float waveFade=1.-smoothstep(700.,2400.,length(prepassWaterWorld.xz-cameraPosition.xz));
          wave*=smoothstep(5.,12.,depth)*.12*brokenWave*waveFade*(1.-smoothstep(.15,.5,offshoreAA));
          diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.83,.94,.91),clamp(foam+wave,0.,.9));`,
        );
    }
    if (horizon)
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <opaque_fragment>",
        `vec3 oceanRay=normalize(prepassWaterWorld-cameraPosition);
        float oceanBlend=smoothstep(oceanBlendEnd*.5,oceanBlendEnd,length(prepassWaterWorld.xz-cameraPosition.xz));
        outgoingLight=mix(outgoingLight,oceanBackground(oceanRay),oceanBlend);
        #include <opaque_fragment>`,
      );
  };
  material.customProgramCacheKey = () =>
    `${horizon ? "curved-ocean-v3" : "simple-ocean-v3"}-${coastal ? "coast" : "inland"}-${material.userData.prepassMaskKey}`;
  material.userData.time = time;
  return material;
}

export function makeOcean(
  terrain: TerrainView,
  horizon?: Record<string, THREE.IUniform>,
) {
  const material = makeWaterMaterial(terrain, horizon, true);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(CONFIG.worldSize * 3, CONFIG.worldSize * 3),
    material,
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(CONFIG.worldSize / 2, 0, CONFIG.worldSize / 2);
  mesh.userData.time = material.userData.time;
  return mesh;
}
