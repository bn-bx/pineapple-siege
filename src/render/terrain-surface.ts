import * as THREE from "three";
import type { VisualAssets } from "./visual-assets";

/** World-space UVs survive terrain remeshing, LOD and excavation. */
export function installTerrainSurface(
  material: THREE.MeshStandardMaterial,
  assets: VisualAssets,
) {
  const grass = assets.surfaces.get("grass"),
    rock = assets.surfaces.get("rock"),
    soil = assets.surfaces.get("soil"),
    sand = assets.surfaces.get("sand");
  if (!grass || !rock || !soil || !sand) return;
  const prior = material.onBeforeCompile;
  const priorKey = material.customProgramCacheKey.bind(material);
  material.map = grass.color;
  material.normalMap = grass.normal;
  material.normalScale.set(0.55, 0.55);
  const normalDetail = { value: 0 };
  material.userData.terrainNormalDetail = normalDetail;
  material.onBeforeCompile = (shader, renderer) => {
    prior(shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace(
      "diffuseColor.rgb = vec3(dot(diffuseColor.rgb, vec3(.2126,.7152,.0722)));",
      "",
    );
    Object.assign(shader.uniforms, {
      uRockColor: { value: rock.color },
      uSoilColor: { value: soil.color },
      uRockNormal: { value: rock.normal },
      uSoilNormal: { value: soil.normal },
      uSandColor: { value: sand.color },
      uSandNormal: { value: sand.normal },
      uGrassORM: { value: grass.orm },
      uSoilORM: { value: soil.orm },
      uRockORM: { value: rock.orm },
      uSandORM: { value: sand.orm },
      uTerrainNormalDetail: normalDetail,
    });
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying vec3 vSurfaceWorld;varying vec3 vSurfaceNormal;",
      )
      .replace(
        "#include <worldpos_vertex>",
        "#include <worldpos_vertex>\nvSurfaceWorld=(modelMatrix*vec4(transformed,1.)).xyz;vSurfaceNormal=normalize(mat3(modelMatrix)*normal);",
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
      varying vec3 vSurfaceWorld;varying vec3 vSurfaceNormal;
      uniform sampler2D uRockColor,uSoilColor,uSandColor,uRockNormal,uSoilNormal,uSandNormal;
      uniform sampler2D uGrassORM,uSoilORM,uRockORM,uSandORM;
      uniform float uTerrainNormalDetail;
      float terrainVariation(vec2 p){
        vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
        vec4 h=fract(sin(vec4(dot(i,vec2(127.1,311.7)),dot(i+vec2(1.,0.),vec2(127.1,311.7)),dot(i+vec2(0.,1.),vec2(127.1,311.7)),dot(i+1.,vec2(127.1,311.7))))*43758.5453);
        return mix(mix(h.x,h.y,f.x),mix(h.z,h.w,f.x),f.y);
      }
      vec3 surfaceRock(vec3 p,vec3 weights,vec3 dx,vec3 dy){
        vec3 result=vec3(0.);
        if(weights.x>0.)result+=textureGrad(uRockColor,p.yz*.08,dx.yz*.08,dy.yz*.08).rgb*weights.x;
        if(weights.y>0.)result+=textureGrad(uRockColor,p.xz*.08,dx.xz*.08,dy.xz*.08).rgb*weights.y;
        if(weights.z>0.)result+=textureGrad(uRockColor,p.xy*.08,dx.xy*.08,dy.xy*.08).rgb*weights.z;
        return result;
      }`,
      )
      .replace(
        "#include <map_fragment>",
        `// The original map sample is overwritten by world-space blending.
        vec3 surfaceWeights=max(pow(abs(vSurfaceNormal),vec3(5.))-vec3(.015),vec3(0.));surfaceWeights/=max(.001,dot(surfaceWeights,vec3(1.)));
        // Compute gradients before varying branches to preserve mip selection.
        vec3 surfaceDx=dFdx(vSurfaceWorld),surfaceDy=dFdy(vSurfaceWorld);
        float slope=1.-abs(vSurfaceNormal.y);
        float landscapePatch=terrainVariation(vSurfaceWorld.xz*.014);
        // Broken, height-biased scree patches keep mountain sides from reading
        // as one smooth material sheet while staying continuous across LODs.
        float screePatch=terrainVariation(vSurfaceWorld.xz*.024+vec2(vSurfaceWorld.y*.003,-vSurfaceWorld.y*.002));
        float cliff=max(smoothstep(.12,.65,slope),smoothstep(550.,850.,vSurfaceWorld.y));
        float outcrop=smoothstep(.12,.48,slope)*smoothstep(.55,.8,landscapePatch);
        cliff=max(cliff,outcrop*.58);
        float scree=smoothstep(250.,600.,vSurfaceWorld.y)*smoothstep(.02,.16,slope)*mix(.42,.95,smoothstep(.2,.78,screePatch));
        cliff=max(cliff,scree*.78);
        float bare=smoothstep(.82,1.14,vColor.r/max(vColor.g,.001));
        float charred=1.-smoothstep(.04,.24,max(vColor.r,max(vColor.g,vColor.b)));
        // Let local sediment and slope variation break the otherwise exact
        // elevation contour into a natural, streamed world-space shoreline.
        float shorelineGrain=terrainVariation(vSurfaceWorld.xz*.052);
        float shorelineTop=mix(4.8,7.2,shorelineGrain);
        float shore=(1.-smoothstep(.35,shorelineTop,vSurfaceWorld.y))*(1.-cliff)*(1.-charred);
        vec3 baseSurface=vec3(0.);
        if(shore<1.){
          if(cliff<1.){
            if(bare<1.)baseSurface=textureGrad(map,vSurfaceWorld.xz*.5,surfaceDx.xz*.5,surfaceDy.xz*.5).rgb;
            if(bare>0.){
              vec3 dirt=textureGrad(uSoilColor,vSurfaceWorld.xz*.1,surfaceDx.xz*.1,surfaceDy.xz*.1).rgb;
              baseSurface=mix(baseSurface,dirt,bare);
            }
          }
          if(cliff>0.)baseSurface=mix(baseSurface,surfaceRock(vSurfaceWorld,surfaceWeights,surfaceDx,surfaceDy),cliff);
        }
        if(shore>0.){
          vec3 sandTex=textureGrad(uSandColor,vSurfaceWorld.xz/15.,surfaceDx.xz/15.,surfaceDy.xz/15.).rgb;
          baseSurface=mix(baseSurface,sandTex,shore);
        }
        float surfaceWet=(1.-smoothstep(-.5,2.,vSurfaceWorld.y))*(1.-cliff);
        // Broad, imperfect mineral beds break up smooth heightfield slopes.
        // Keep the bands in world space so streamed LODs agree at their seams.
        float strata=.5+.5*sin(vSurfaceWorld.y*.095+vSurfaceWorld.x*.012+vSurfaceWorld.z*.008+(landscapePatch-.5)*1.8+(screePatch-.5)*1.05);
        vec3 grassVariation=mix(vec3(.83,.88,.76),vec3(1.06,1.04,.94),landscapePatch);
        vec3 rockVariation=mix(vec3(.72,.75,.8),vec3(1.04,1.02,.97),landscapePatch)*(.86+.28*screePatch)*(.82+.36*strata);
        baseSurface*=mix(grassVariation,rockVariation,cliff)*(1.-surfaceWet*.22);
        diffuseColor.rgb=baseSurface*mix(vec3(mix(1.65,1.05,cliff)),vec3(.3),charred);
      `,
      )
      .replace(
        "#include <color_fragment>",
        `// Retain canonical grass/road tint; exposed bedrock uses its scanned
        // mineral color instead of inheriting the grass's altitude tint.
        #ifdef USE_COLOR
        // Keep authored ground tint on grass, but let the scanned sand retain
        // its neutral color instead of turning the beach back into grass.
        diffuseColor.rgb*=mix(vColor,vec3(1.),max(cliff,shore));
        #endif`,
      )
      .replace(
        "#include <normalmap_pars_fragment>",
        `#include <normalmap_pars_fragment>
        vec3 surfaceMappedNormal(sampler2D textureMap,vec2 projectionUV,vec3 baseNormal){
          vec3 bump=texture2D(textureMap,projectionUV).xyz*2.-1.;
          bump.xy*=normalScale;
          return normalize(getTangentFrame(-vViewPosition,baseNormal,projectionUV)*bump);
        }`,
      )
      .replace(
        "#include <normal_fragment_maps>",
        `// Coarser quality retains the terrain's geometric normals. Detailed
        // normals use the same world projections as color, in view space.
        if(uTerrainNormalDetail>.5){
          vec3 surfaceBaseNormal=normal;
          vec3 grassBump=surfaceMappedNormal(normalMap,vSurfaceWorld.xz*.5,surfaceBaseNormal);
          vec3 soilBump=surfaceMappedNormal(uSoilNormal,vSurfaceWorld.xz*.1,surfaceBaseNormal);
          vec3 groundBump=normalize(mix(grassBump,soilBump,bare));
          vec3 rockBump=surfaceMappedNormal(uRockNormal,vSurfaceWorld.yz*.08,surfaceBaseNormal)*surfaceWeights.x+
            surfaceMappedNormal(uRockNormal,vSurfaceWorld.xz*.08,surfaceBaseNormal)*surfaceWeights.y+
            surfaceMappedNormal(uRockNormal,vSurfaceWorld.xy*.08,surfaceBaseNormal)*surfaceWeights.z;
          normal=normalize(mix(groundBump,normalize(rockBump),cliff));
          vec3 sandBump=surfaceMappedNormal(uSandNormal,vSurfaceWorld.xz/15.,surfaceBaseNormal);
          normal=normalize(mix(normal,sandBump,shore));
        }
        // Broad mineral relief remains readable from flight altitude without
        // changing canonical heights or sampling another texture. Derivatives
        // are evaluated before the mask, including across cliff transitions.
        // A second, finer world-space field breaks smooth cone-like peak faces
        // into layered rock relief without moving canonical terrain vertices.
        float cliffGrain=terrainVariation(vSurfaceWorld.xz*.072+vec2(vSurfaceWorld.y*.008,-vSurfaceWorld.y*.006));
        float cliffRelief=landscapePatch*2.8+strata*.22+(cliffGrain-.5)*.45;
        vec3 cliffSigmaX=dFdx(-vViewPosition),cliffSigmaY=dFdy(-vViewPosition);
        vec3 cliffR1=cross(cliffSigmaY,normal),cliffR2=cross(normal,cliffSigmaX);
        float cliffDet=dot(cliffSigmaX,cliffR1);
        vec3 cliffGradient=sign(cliffDet)*(dFdx(cliffRelief)*cliffR1+dFdy(cliffRelief)*cliffR2);
        normal=normalize(max(abs(cliffDet),1e-8)*normal-cliffGradient*cliff);`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
        float surfaceAO=1.;
        if(uTerrainNormalDetail>.5){
          vec2 groundORM=mix(texture2D(uGrassORM,vSurfaceWorld.xz*.5).rg,texture2D(uSoilORM,vSurfaceWorld.xz*.1).rg,bare);
          vec2 rockORM=texture2D(uRockORM,vSurfaceWorld.yz*.08).rg*surfaceWeights.x+
            texture2D(uRockORM,vSurfaceWorld.xz*.08).rg*surfaceWeights.y+
            texture2D(uRockORM,vSurfaceWorld.xy*.08).rg*surfaceWeights.z;
          vec2 surfaceORM=mix(groundORM,rockORM,cliff);
          surfaceORM=mix(surfaceORM,texture2D(uSandORM,vSurfaceWorld.xz/15.).rg,shore);
          roughnessFactor*=surfaceORM.g;
          surfaceAO=mix(1.,surfaceORM.r,.45);
        }
        roughnessFactor=max(.28,roughnessFactor*(1.-surfaceWet*.35));`,
      )
      .replace(
        "#include <aomap_fragment>",
        "#include <aomap_fragment>\nreflectedLight.indirectDiffuse*=surfaceAO;",
      );
  };
  material.customProgramCacheKey = () => priorKey() + ":realistic-terrain-v11";
  material.needsUpdate = true;
}
