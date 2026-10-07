import * as THREE from "three";

const BANNER_PALETTE = ["#8f3439", "#344d68", "#4e6547"] as const;

/** A small shared-UV weave pattern gives each castle owner distinct heraldry. */
export function heraldicBannerGeometry(width: number, height: number, owner: number) {
  const geometry = new THREE.PlaneGeometry(width, height, 8, 16);
  const uv = geometry.getAttribute("uv");
  const colors = new Float32Array(uv.count * 3);
  const palette = new THREE.Color(BANNER_PALETTE[Math.abs(owner) % BANNER_PALETTE.length]);
  const gold = new THREE.Color("#c1a15c");
  const shadow = new THREE.Color("#46372c");
  const pattern = Math.abs(owner) % 3;
  for (let i = 0; i < uv.count; i++) {
    const u = uv.getX(i),
      v = uv.getY(i),
      dx = Math.abs(u - 0.5),
      dy = Math.abs(v - 0.52),
      shield = dx * 1.35 + dy * 0.95 < 0.245,
      border = u < 0.055 || u > 0.945 || v < 0.045 || v > 0.94;
    let color = palette;
    if (border || shield) color = gold;
    if (
      shield &&
      ((pattern === 0 && (dx < 0.035 || dy < 0.035)) ||
        (pattern === 1 && Math.abs(dx - dy * 0.7) < 0.035) ||
        (pattern === 2 && dx < 0.045 && dy < 0.045))
    )
      color = shadow;
    colors.set(color.toArray(), i * 3);
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geometry;
}

/** One clock drives cloth and its shadow; top edge remains attached. */
export function bannerWind(
  material: THREE.Material,
  time: THREE.IUniform<number>,
) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.bannerTime = time;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform float bannerTime;",
      )
      .replace(
        "#include <beginnormal_vertex>",
        `#include <beginnormal_vertex>
        float clothPin=1.-uv.y;
        float clothPhase=position.y*1.5+bannerTime*2.;
        float clothSlope=.24*cos(clothPhase)*clothPin;
        objectNormal=normalize(vec3(0.,-clothSlope,1.));`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        transformed.z+=sin(position.y*1.5+bannerTime*2.)*.16*(1.-uv.y);`,
      );
  };
  material.customProgramCacheKey = () => "banner-wind-v1";
}
