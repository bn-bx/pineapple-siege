import * as THREE from "three";

/** Seamless, filtered ripples; built once and shared by all ocean samples. */
export function waterNormals() {
  const size = 128,
    pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = (x / size) * Math.PI * 2,
        v = (y / size) * Math.PI * 2;
      let dx = 0,
        dz = 0;
      for (let wave = 0; wave < 24; wave++) {
        const kx = ((wave * 7) % 19) - 9,
          kz = ((wave * 11) % 17) - 8;
        const length = Math.max(1, Math.hypot(kx, kz));
        const slope = Math.cos(u * kx + v * kz + wave * 2.399) * 0.025;
        dx += (slope * kx) / length;
        dz += (slope * kz) / length;
      }
      const n = Math.hypot(dx, dz, 1),
        i = (y * size + x) * 4;
      pixels[i] = Math.round(((dx / n) * 0.5 + 0.5) * 255);
      pixels[i + 1] = Math.round(((dz / n) * 0.5 + 0.5) * 255);
      pixels[i + 2] = Math.round(((1 / n) * 0.5 + 0.5) * 255);
      pixels[i + 3] = 255;
    }
  const texture = new THREE.DataTexture(pixels, size, size);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

/** Keep depth tint in shallow water, rather than blending mud into the open sea. */
export const OCEAN_COLOR_GLSL = `
vec3 shallow = mix(waterColor * 1.35, waterColor * vec3(.65,1.6,1.25), .45);
vec3 body = mix(shallow, waterColor * .62, smoothstep(1.,18.,waterDepth));
vec3 outgoingLight = mix(body, reflectionSample, reflectance * .88);
outgoingLight += specularLight * (.18 + reflectance * .5);
float shore = (1.-smoothstep(.15,1.8,waterDepth))*smoothstep(0.,.2,waterDepth);
float crest = smoothstep(.35,.9,sin(worldPosition.x*.7+worldPosition.z*.5-time*1.4));
outgoingLight += shore * crest * sunColor * .12;
if(uDiscoAmount>0.001) outgoingLight+=uDiscoAmount*discoPattern(worldPosition.xz,uDiscoTime);
`;
