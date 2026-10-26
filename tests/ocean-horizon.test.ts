import { expect, it } from "vitest";
import * as THREE from "three";
import { EARTH_RADIUS, oceanHorizon } from "../src/render/ocean-horizon";
import { makeWaterMaterial } from "../src/render/ocean";
import type { TerrainView } from "../src/render/terrain-view";

it("places the Earth-scale tangent horizon farther away as altitude rises", () => {
  expect(oceanHorizon(0)).toEqual({ distance: 0, dip: 0, blendEnd: 200 });
  expect(oceanHorizon(-200)).toEqual(oceanHorizon(0));
  expect(oceanHorizon(2).distance).toBeCloseTo(5048.1688, 3);
  expect(oceanHorizon(900).distance).toBeCloseTo(107091.596, 2);
  let previous = 0;
  for (const height of [0.01, 2, 50, 300, 900, 3000]) {
    const { distance, dip, blendEnd } = oceanHorizon(height);
    expect(distance).toBeGreaterThan(previous);
    // The downward tangent ray has zero sphere-intersection discriminant.
    expect(((EARTH_RADIUS + height) * dip) ** 2).toBeCloseTo(
      height * (2 * EARTH_RADIUS + height),
      3,
    );
    expect(blendEnd).toBeLessThan(distance);
    expect(blendEnd).toBeLessThanOrEqual(7000);
    previous = distance;
  }
});

it("keeps river water on its existing shader and shares backdrop uniforms only with the ocean", () => {
  const terrain = {
    heightTexture: new THREE.Texture(),
    floodTexture: new THREE.Texture(),
  } as TerrainView;
  const uniforms = {
    horizonDip: { value: 0.01 },
    oceanBlendEnd: { value: 7000 },
  };
  for (const horizon of [undefined, uniforms]) {
    const material = makeWaterMaterial(terrain, horizon);
    const shader = {
      uniforms: {},
      vertexShader: THREE.ShaderLib.standard.vertexShader,
      fragmentShader: THREE.ShaderLib.standard.fragmentShader,
    } as THREE.WebGLProgramParametersWithUniforms;
    material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    expect(shader.fragmentShader).toContain("prepassWet");
    expect(shader.fragmentShader.includes("outgoingLight=mix")).toBe(!!horizon);
    if (horizon) expect(shader.uniforms.horizonDip).toBe(uniforms.horizonDip);
    material.dispose();
  }
});

it("clips canonical water before the distant backdrop shortcut and preserves nearby coast shading", () => {
  const material = makeWaterMaterial(
    {
      heightTexture: new THREE.Texture(),
      floodTexture: new THREE.Texture(),
    } as TerrainView,
    { oceanBlendEnd: { value: 7000 } },
    true,
  );
  const shader = {
    uniforms: {},
    vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader,
  } as THREE.WebGLProgramParametersWithUniforms;
  material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
  const fragment = shader.fragmentShader;
  const shortcut = fragment.indexOf("if(oceanViewDistance>");
  expect(fragment.indexOf("if(inWorld&&")).toBeLessThan(shortcut);
  expect(shortcut).toBeLessThan(fragment.indexOf("float depth=inWorld"));
  expect(fragment).toContain("if(depth<6.+depthFootprint)");
  expect(fragment).toContain("coastViewDistance<2400.+distanceFootprint");
  // Derivative padding keeps neighboring fragments active at fade boundaries.
  expect(fragment).toContain("oceanBlendEnd+fwidth(oceanViewDistance)");
  const output = fragment.slice(
    shortcut,
    fragment.indexOf("float depth=inWorld"),
  );
  expect(output).toContain("#include <tonemapping_fragment>");
  expect(output).toContain("#include <colorspace_fragment>");
  material.dispose();
});
