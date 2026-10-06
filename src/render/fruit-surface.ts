import * as THREE from "three";
/** Fibrous waxy crown surfaces, shared by actors and weapon fruit. */
export function crownSurface(
  material: THREE.MeshStandardMaterial,
  height: number,
  width: number,
) {
  if (material.userData.crownSurface) return;
  material.userData.crownSurface = true;
  material.color.set("#596d3a");
  material.roughness = 0.78;
  const prior = material.onBeforeCompile,
    key = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    prior(shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vCrownUV;")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>\nvCrownUV=vec2(position.x/${width.toFixed(3)},position.y/${height.toFixed(3)}*.5+.5);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vCrownUV;")
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
        float crownPixel=max(length(dFdx(vCrownUV)),length(dFdy(vCrownUV)));
        float crownFibre=mix(.5,.5+.5*sin(vCrownUV.x*140.+sin(vCrownUV.y*8.)*2.),1.-smoothstep(.005,.02,crownPixel));
        float crownRib=1.-smoothstep(.015,.07,abs(vCrownUV.x));
        vec3 crownGrowth=mix(vec3(.52,.62,.43),vec3(1.08,1.1,.84),smoothstep(0.,.55,vCrownUV.y));
        crownGrowth=mix(crownGrowth,vec3(.83,.76,.48),smoothstep(.86,1.04,vCrownUV.y)*.45);
        diffuseColor.rgb*=crownGrowth*(.88+crownFibre*.18+crownRib*.12);`,
      );
  };
  material.customProgramCacheKey = () =>
    key + `|crown-fibres-v1-${height}-${width}`;
  material.needsUpdate = true;
}
/** Signature fruit surface: staggered eyes, dark creases and fibrous microdetail. */
export function fruitSurface(
  material: THREE.MeshStandardMaterial,
  texture?: THREE.Texture,
) {
  const photographed = texture !== undefined;
  material.map = texture ?? null;
  material.color.set(photographed ? "#ffffff" : "#bb8a37");
  material.userData.fruitPhotographed = photographed;
  material.needsUpdate = true;
  if (material.userData.fruitSurface) return;
  material.userData.fruitSurface = true;
  material.roughness = 0.88;
  const prior = material.onBeforeCompile,
    key = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    prior(shader, renderer);
    shader.uniforms.uFruitPhotographed = {
      value: material.userData.fruitPhotographed ? 1 : 0,
    };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vFruitUV;")
      .replace("#include <uv_vertex>", "#include <uv_vertex>\nvFruitUV=uv;");
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
      uniform float uFruitPhotographed;
      varying vec2 vFruitUV;
      vec2 fruitCell(vec2 uv){vec2 p=uv*vec2(16.,12.);p.x+=mod(floor(p.y),2.)*.5;return p;}
      float fruitCellNoise(vec2 p){return fract(sin(dot(floor(p),vec2(127.1,311.7)))*43758.5453);}
      float fruitEye(vec2 uv){vec2 p=fruitCell(uv);float variation=fruitCellNoise(p);vec2 q=fract(p)-.5;q+=vec2(variation-.5,fract(variation*17.)-.5)*.07;q=abs(q);return 1.-smoothstep(.29,.46,q.x*(.91+variation*.18)+q.y);}
      float fruitGrain(vec2 uv){return fract(sin(dot(floor(uv*700.),vec2(127.1,311.7)))*43758.5453);}`,
      )
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
        float fruitPixel=max(length(dFdx(vFruitUV)),length(dFdy(vFruitUV)));
        float fruitRaised=mix(.5,fruitEye(vFruitUV),1.-smoothstep(.02,.06,fruitPixel));
        float fruitMicro=1.-smoothstep(.001,.003,fruitPixel);
        float fruitNoise=mix(.5,fruitGrain(vFruitUV),fruitMicro);
        vec2 fruitCellPosition=fruitCell(vFruitUV);
        float fruitMottle=mix(.5,fruitCellNoise(fruitCellPosition),1.-smoothstep(.02,.06,fruitPixel));
        vec2 fruitCenter=fract(fruitCellPosition)-.5;
        float fruitDimple=(1.-smoothstep(.055,.15,length(fruitCenter)))*(1.-smoothstep(.015,.04,fruitPixel));
        diffuseColor.rgb*=mix(mix(vec3(.49,.43,.24),vec3(1.06,.94,.65),fruitRaised)*(.86+fruitNoise*.14+fruitMottle*.12),vec3(1.),uFruitPhotographed);
        diffuseColor.rgb*=1.-fruitDimple*.28*(1.-uFruitPhotographed);
        diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*vec3(.75,.9,.55),smoothstep(.7,1.,vFruitUV.y)*.4*(1.-uFruitPhotographed));`,
      )
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
        // Derivative surface basis keeps relief in metre scale as distance changes.
        float fruitHeight=fruitRaised*.07-fruitDimple*.012+(fruitNoise-.5)*.0008;
        vec3 fruitSigmaX=dFdx(-vViewPosition),fruitSigmaY=dFdy(-vViewPosition);
        vec3 fruitR1=cross(fruitSigmaY,normal),fruitR2=cross(normal,fruitSigmaX);
        float fruitDet=dot(fruitSigmaX,fruitR1);
        vec3 fruitGradient=sign(fruitDet)*(dFdx(fruitHeight)*fruitR1+dFdy(fruitHeight)*fruitR2);
        normal=normalize(max(abs(fruitDet),1e-8)*normal-fruitGradient);`,
      );
  };
  material.customProgramCacheKey = () =>
    key +
    "|fruit-scales-v4-" +
    (material.userData.fruitPhotographed ? "photo" : "procedural");
  material.needsUpdate = true;
}
