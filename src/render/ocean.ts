import * as THREE from "three";
import { CONFIG, SURFACE_FLIGHT } from "../config";
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
    float waterBedHeight(vec2 world){
      vec2 p=world/${CONFIG.spacing}.;
      vec2 cell=floor(p), f=fract(p);
      float a=coastHeight(cell), b=coastHeight(cell+vec2(1.,0.));
      float c=coastHeight(cell+vec2(0.,1.)), d=coastHeight(cell+vec2(1.));
      // Match the terrain mesh's triangle diagonal, including damaged shores.
      return f.x+f.y<=1. ? a+(b-a)*f.x+(c-a)*f.y
        : d+(c-d)*(1.-f.x)+(b-d)*(1.-f.y);
    }
    float coastDepth(vec2 world){
      return max(0.,-waterBedHeight(world));
    }`;
}

/**
 * Inland water shading. Each vertex carries its downstream direction (`flow`)
 * and `current` = (speed in m/s, white-water amount). Two flow-mapped noise
 * layers, half a cycle apart, scroll downstream and cross-fade so the ripples
 * move without stretching. Depth above the authoritative bed tints shallows
 * and puts foam along the banks; `current.y` whitens rapids and falls.
 */
const RIVER_VERTEX_GLSL = `attribute vec2 flow;
attribute vec2 current;
varying vec2 riverFlow;
varying vec2 riverCurrent;`;
const RIVER_FRAGMENT_GLSL = `uniform vec3 riverDayColor;
varying vec2 riverFlow;
varying vec2 riverCurrent;
float riverHeight(vec2 uv){return coastNoise(uv)*.66+coastNoise(uv*2.3+17.)*.34;}
vec3 riverLayer(vec2 uv){
  float h=riverHeight(uv);
  return vec3(riverHeight(uv+vec2(.35,0.))-h,riverHeight(uv+vec2(0.,.35))-h,h);
}`;
const RIVER_COLOR_GLSL = `
  vec2 riverP=prepassWaterWorld.xz;
  float riverSpeed=riverCurrent.x, riverRush=riverCurrent.y;
  float riverDetail=1.-smoothstep(.6,2.4,length(fwidth(riverP)));
  float riverCycle=oceanTime*.32;
  float riverPhase0=fract(riverCycle), riverPhase1=fract(riverCycle+.5);
  float riverMix=abs(riverPhase0-.5)*2.;
  // Seconds per cycle times the current gives metres travelled per cycle.
  vec2 riverDrift=riverFlow*riverSpeed*3.1;
  vec2 riverUV=riverP*.16;
  vec3 riverA=riverLayer(riverUV-riverDrift*riverPhase0*.16);
  vec3 riverB=riverLayer(riverUV-riverDrift*riverPhase1*.16+vec2(7.3,3.1));
  vec3 riverWave=mix(riverA,riverB,riverMix);
  // Faster water reads rougher; distant water calms to avoid shimmer.
  vec2 riverGrad=riverWave.xy*(.32+riverSpeed*.1+riverRush*.45)*riverDetail;
  float riverBed=inWorld ? waterBedHeight(riverP) : prepassWaterWorld.y-4.;
  // Past the shoreline the sea takes over from the river.
  if(riverBed<-.3&&prepassWaterWorld.y<.6)discard;
  float riverDepth=max(0.,prepassWaterWorld.y-.05-riverBed);
  float riverShallow=1.-smoothstep(.15,2.8,riverDepth+(riverWave.z-.5)*.6);
  vec3 riverDeep=vec3(.018,.085,.095), riverSilt=vec3(.15,.22,.13);
  // The lighting retints the material colour through dusk and night;
  // carry that change over from the daytime colour it started as.
  vec3 riverTint=clamp(diffuseColor.rgb/max(riverDayColor,vec3(.004)),0.,2.);
  diffuseColor.rgb=mix(riverDeep,riverSilt,riverShallow*.85)*riverTint;
  diffuseColor.rgb*=.86+coastNoise(riverP*.03)*.28;
  // Bank foam hugs the waterline; rapids and falls streak along the current.
  float riverFoamNoise=mix(.5,riverWave.z,riverDetail);
  // Fine, fast-moving foam cells; broken up rather than a solid sheet.
  // Same two-phase scheme as the ripples, so bends never smear over time.
  // Calm, deep water has no foam, so it skips the fine noise entirely.
  float riverFoamFine=.5;
  if(riverRush>.01||riverDepth<1.2||(inWorld&&prepassWetSmooth(riverP)<.95)){
    vec2 riverFoamUV=riverP*.42, riverFoamDrift=riverDrift*.42*1.6;
    riverFoamFine=mix(.5,mix(coastFbm(riverFoamUV-riverFoamDrift*riverPhase0),
      coastFbm(riverFoamUV-riverFoamDrift*riverPhase1+vec2(3.7,9.1)),riverMix),riverDetail);
    // Cross-fading two noises flattens contrast mid-cycle; restore it.
    riverFoamFine=clamp(.5+(riverFoamFine-.5)*(1.+.6*(1.-abs(riverMix-.5)*2.)),0.,1.);
  }
  float riverEdge=(1.-smoothstep(.03,.3+.25*riverFoamNoise,riverDepth))
    *smoothstep(.25,.6,riverFoamFine);
  float riverStreak=smoothstep(.68-riverRush*.24,.8-riverRush*.16,
    riverFoamFine*.6+riverFoamNoise*.4);
  // Where blast damage has dried part of a river, the water stops at the
  // edge of the wet area; churn that edge so it reads as water spilling away.
  float riverWetEdge=inWorld ? 1.-smoothstep(.5,.9,prepassWetSmooth(riverP)) : 0.;
  float riverFoam=max(max(riverEdge*.55,riverWetEdge*(.45+.45*riverFoamFine)),
    riverRush*(.1+.8*riverStreak));
  // Churned water between foam streaks is paler and greener than a pool.
  diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.2,.34,.32),riverRush*.45);
  riverFoam=clamp(riverFoam,0.,.92);
  diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.84,.9,.88),riverFoam);`;

/** One beauty draw, clipped by the same wet/height data as the simulation. */
export function makeWaterMaterial(
  terrain: TerrainView,
  horizon?: Record<string, THREE.IUniform>,
  coastal = false,
  river = false,
) {
  const time = { value: 0 };
  const riverDayColor = new THREE.Color("#285f65");
  const material = new THREE.MeshStandardMaterial({
    color: riverDayColor.clone(),
    roughness: 0.35,
    metalness: 0.1,
    side: THREE.DoubleSide,
  });
  waterPrepass(material, terrain.heightTexture, terrain.floodTexture, river);
  material.onBeforeCompile = (shader) => {
    material.userData.prepassMask(shader);
    shader.uniforms.oceanTime = time;
    if (river) shader.uniforms.riverDayColor = { value: riverDayColor };
    if (river)
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", `#include <common>\n${RIVER_VERTEX_GLSL}`)
        .replace(
          "#include <begin_vertex>",
          "#include <begin_vertex>\nriverFlow=flow;riverCurrent=current;",
        );
    if (horizon) Object.assign(shader.uniforms, horizon);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>\nuniform float oceanTime;\n${horizon ? OCEAN_BACKGROUND_GLSL : ""}`,
      )
      .replace(
        "#include <normal_fragment_maps>",
        river
          ? `#include <normal_fragment_maps>
        normal=normalize(normal+(viewMatrix*vec4(-riverGrad.x,0.,-riverGrad.y,0.)).xyz);`
          : `#include <normal_fragment_maps>
        vec2 p=prepassWaterWorld.xz;
        float rippleStrength=${horizon ? "1.-smoothstep(oceanBlendEnd*.5,oceanBlendEnd,length(prepassWaterWorld.xz-cameraPosition.xz))" : "1."};
        vec2 ripple=vec2(cos(p.x*.12+oceanTime*.5),sin(p.y*.09-oceanTime*.4))*.035*rippleStrength;
        normal=normalize(normal+(viewMatrix*vec4(ripple.x,0.,ripple.y,0.)).xyz);`,
      );
    if (river)
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "void main() {",
          `${coastlineShader(terrain)}\n${COASTAL_NOISE_GLSL}\n${RIVER_FRAGMENT_GLSL}\nvoid main() {`,
        )
        .replace(
          "#include <color_fragment>",
          `#include <color_fragment>${RIVER_COLOR_GLSL}`,
        )
        .replace(
          "#include <roughnessmap_fragment>",
          `#include <roughnessmap_fragment>
          roughnessFactor=mix(roughnessFactor,.85,riverFoam);`,
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
          float depthFootprint=fwidth(depth);
          float coastViewDistance=length(prepassWaterWorld.xz-cameraPosition.xz);
          float distanceFootprint=fwidth(coastViewDistance);
          float foam=0.;
          // Both shoreline terms are exactly zero at six meters of depth.
          if(depth<6.+depthFootprint) {
            float irregular=coastFbm(coastP*.09)*3.;
            float surfPhase=depth*1.65-oceanTime*.85+irregular*.65;
            float aa=max(.04,fwidth(surfPhase));
            float crest=smoothstep(.86-aa,.97+aa,sin(surfPhase));
            float shoreBreak=(1.-smoothstep(1.5,6.,depth))*crest;
            float wash=(1.-smoothstep(.15,1.3,depth))*(.65+.15*sin(oceanTime*.9+irregular));
            foam=max(wash*.5,shoreBreak*.35);
          }
          float waveFade=1.-smoothstep(700.,2400.,coastViewDistance);
          float wave=0.;
          // Avoid two noise fields when their final multiplier is zero.
          if(depth>5.-depthFootprint && coastViewDistance<2400.+distanceFootprint) {
            float offshorePhase=coastP.x*.035+coastP.y*.045-oceanTime*.55
              +coastFbm(coastP*.018)*7.;
            float offshoreAA=max(.015,fwidth(offshorePhase));
            wave=smoothstep(.975-offshoreAA,1.+offshoreAA,sin(offshorePhase));
            float brokenWave=smoothstep(.55,.76,coastFbm(coastP*.038+oceanTime*.01));
            wave*=smoothstep(5.,12.,depth)*.12*brokenWave*waveFade*(1.-smoothstep(.15,.5,offshoreAA));
          }
          diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.83,.94,.91),clamp(foam+wave,0.,.9));`,
        );
    }
    if (horizon)
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <color_fragment>",
          `#include <color_fragment>
          float oceanViewDistance=length(prepassWaterWorld.xz-cameraPosition.xz);
          vec3 oceanRay=normalize(prepassWaterWorld-cameraPosition);
          float oceanBlend=smoothstep(oceanBlendEnd*.5,oceanBlendEnd,oceanViewDistance);
          vec3 oceanBackdrop=oceanBackground(oceanRay);
          // Beyond the blend, the backdrop replaces all water shading.
          // The canonical wet/terrain discard has already run above.
          // Keep the full path while the laser projection is active.
          if(oceanViewDistance>oceanBlendEnd+fwidth(oceanViewDistance) && laserDim<=0.) {
            gl_FragColor=vec4(oceanBackdrop,1.);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
            return;
          }`,
        )
        .replace(
          "#include <opaque_fragment>",
          `outgoingLight=mix(outgoingLight,oceanBackdrop,oceanBlend);
          #include <opaque_fragment>`,
        )
        // The backdrop carries the same aerial haze; fade scene fog out
        // across the blend so it is not applied twice.
        .replace(
          "#include <fog_fragment>",
          `#define AERIAL_FOG_SCALE (1.-oceanBlend)
          #include <fog_fragment>`,
        );
  };
  material.customProgramCacheKey = () =>
    `${horizon ? "curved-ocean-v6" : "simple-ocean-v3"}-${coastal ? "coast-guarded" : river ? "river-flow-v2" : "inland"}-${material.userData.prepassMaskKey}`;
  material.userData.time = time;
  return material;
}

export function makeOcean(
  terrain: TerrainView,
  horizon?: Record<string, THREE.IUniform>,
) {
  const material = makeWaterMaterial(terrain, horizon, true);
  const mesh = new THREE.Mesh(
    // Reaches past the sky-drawn backdrop blend even from the far flight edge.
    new THREE.PlaneGeometry(
      CONFIG.worldSize * 3 + SURFACE_FLIGHT.margin * 2,
      CONFIG.worldSize * 3 + SURFACE_FLIGHT.margin * 2,
    ),
    material,
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(CONFIG.worldSize / 2, 0, CONFIG.worldSize / 2);
  mesh.userData.time = material.userData.time;
  return mesh;
}
