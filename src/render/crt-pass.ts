import * as THREE from "three";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import type { CRTMode } from "../types";

/** Display-space effect: input has already been tone mapped and encoded by OutputPass. */
export class CRTPass extends ShaderPass {
  constructor() {
    super({
      name: "CRT",
      uniforms: {
        tDiffuse: { value: null },
        resolution: { value: new THREE.Vector2(1, 1) },
        retro: { value: 0 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform vec2 resolution;
        uniform float retro;
        varying vec2 vUv;
        void main() {
          vec2 screen = vUv * 2.0 - 1.0;
          float curvature = mix(0.025, 0.085, retro);
          vec2 curved = screen * (1.0 + curvature * screen.yx * screen.yx);
          vec2 uv = curved * 0.5 + 0.5;
          vec2 pixel = 1.0 / resolution;
          float scale = max(1.0, resolution.y / 720.0);
          vec2 lo = pixel * 0.5;
          vec2 hi = 1.0 - lo;
          vec3 source = texture2D(tDiffuse, clamp(uv, lo, hi)).rgb;
          // Slightly misaligned electron guns, strongest near the glass edges.
          float fringe = mix(0.5, 1.35, retro) * scale * pixel.x
            * (0.5 + 0.5 * dot(screen, screen));
          vec3 color = source;
          color.r = texture2D(tDiffuse, clamp(uv + vec2(fringe, 0.0), lo, hi)).r;
          color.b = texture2D(tDiffuse, clamp(uv - vec2(fringe, 0.0), lo, hi)).b;
          // A small cross-shaped phosphor spread softens bright pixels without a bloom target.
          vec2 spread = pixel * scale * mix(1.25, 2.25, retro);
          vec3 glow = (
            texture2D(tDiffuse, clamp(uv + vec2(spread.x, 0.0), lo, hi)).rgb +
            texture2D(tDiffuse, clamp(uv - vec2(spread.x, 0.0), lo, hi)).rgb +
            texture2D(tDiffuse, clamp(uv + vec2(0.0, spread.y), lo, hi)).rgb +
            texture2D(tDiffuse, clamp(uv - vec2(0.0, spread.y), lo, hi)).rgb
          ) * 0.25;
          color = mix(color, glow, mix(0.12, 0.25, retro));
          color += glow * glow * mix(0.06, 0.16, retro);
          // Visible raster beams with dark gaps, rather than a one-pixel grid.
          // Bright phosphors widen the beam, mimicking a tube's light response.
          float lines = min(mix(360.0, 240.0, retro), resolution.y / 3.0);
          float phase = fract(uv.y * lines) - 0.5;
          float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
          float beamWidth = mix(0.24, 0.34, clamp(luminance, 0.0, 1.0));
          float beam = exp(-pow(phase / beamWidth, 2.0));
          color *= mix(1.0, beam, mix(0.28, 0.58, retro))
            * mix(1.10, 1.24, retro);
          // The shadow mask stays secondary to the horizontal raster lines.
          float column = mod(floor(gl_FragCoord.x), 3.0);
          vec3 phosphor = column < 1.0 ? vec3(1.0, 0.95, 0.95)
            : column < 2.0 ? vec3(0.95, 1.0, 0.95) : vec3(0.95, 0.95, 1.0);
          color *= mix(vec3(1.0), phosphor, mix(0.3, 1.0, retro));
          float edge = clamp(dot(screen, screen) * 0.5, 0.0, 1.0);
          color *= 1.0 - mix(0.16, 0.38, retro) * pow(edge, 1.4);
          // Rounded glass boundaries, with antialiasing at the actual buffer resolution.
          float radius = mix(0.08, 0.18, retro);
          vec2 corner = abs(curved) - vec2(1.0 - radius);
          float glassDistance = length(max(corner, 0.0))
            + min(max(corner.x, corner.y), 0.0) - radius;
          float glass = 1.0 - smoothstep(-pixel.y * 2.0, pixel.y * 2.0, glassDistance);
          color *= glass;
          // Do not apply tone mapping or color conversion a second time.
          gl_FragColor = vec4(color, 1.0);
        }
      `,
    });
    this.material.toneMapped = false;
  }
  setMode(mode: CRTMode) {
    this.enabled = mode !== "off";
    this.uniforms.retro.value = mode === "retro" ? 1 : 0;
  }
  override setSize(width: number, height: number) {
    this.uniforms.resolution.value.set(Math.max(1, width), Math.max(1, height));
  }
}
