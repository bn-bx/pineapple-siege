import { expect, it } from "vitest";
import * as THREE from "three";
import {
  matchPrepass,
  withOpaquePresentation,
} from "../src/render/alpha-prepass";
import { waterPrepass } from "../src/render/water-prepass";
import { prepareDebrisMotion } from "../src/render/debris-motion";

function prepare(material: THREE.Material, mesh: THREE.Mesh) {
  material.onBeforeRender(
    {} as THREE.WebGLRenderer,
    new THREE.Scene(),
    new THREE.PerspectiveCamera(),
    mesh.geometry,
    mesh,
    null as any,
  );
}
function shader(kind: "normal" | "depth") {
  return {
    uniforms: THREE.UniformsUtils.clone(THREE.ShaderLib[kind].uniforms),
    vertexShader: THREE.ShaderLib[kind].vertexShader,
    fragmentShader: THREE.ShaderLib[kind].fragmentShader,
  } as THREE.WebGLProgramParametersWithUniforms;
}
it("retains foliage cutouts and animated vertices in photo depth", () => {
  const map = new THREE.Texture();
  const foliage = new THREE.MeshStandardMaterial({
    map,
    alphaTest: 0.42,
    side: THREE.DoubleSide,
  });
  foliage.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      "#include <begin_vertex>",
      "#include <begin_vertex>\ntransformed.x+=.1;",
    );
    shader.fragmentShader += "\n// beauty only";
  };
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(), foliage);
  for (const material of [new THREE.MeshDepthMaterial()]) {
    matchPrepass(material);
    prepare(material, mesh);
    const result = shader("depth");
    material.onBeforeCompile(result, {} as THREE.WebGLRenderer);
    expect((material as any).map).toBe(map);
    expect(material.alphaTest).toBe(0.42);
    expect(material.side).toBe(THREE.DoubleSide);
    expect(result.vertexShader).toContain("transformed.x+=.1;");
    expect(result.fragmentShader).toContain("#include <alphatest_fragment>");
    expect(result.fragmentShader).not.toContain("beauty only");
  }
});
it("retains canonical wet exclusions and shared motion uniforms in auxiliary passes", () => {
  const material = new THREE.MeshDepthMaterial();
  matchPrepass(material);
  const source = new THREE.MeshStandardMaterial();
  const height = new THREE.Texture(),
    wet = new THREE.Texture();
  waterPrepass(source, height, wet);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(), source);
  const alpha = { value: 0.5 };
  mesh.customDepthMaterial = new THREE.MeshDepthMaterial();
  mesh.customDepthMaterial.onBeforeCompile = (shader) => {
    shader.uniforms.motionAlpha = alpha;
  };
  prepare(material, mesh);
  const result = shader("depth");
  material.onBeforeCompile(result, {} as THREE.WebGLRenderer);
  expect(result.uniforms.motionAlpha).toBe(alpha);
  expect(result.uniforms.prepassHeight.value).toBe(height);
  expect(result.uniforms.prepassWet.value).toBe(wet);
  expect(result.fragmentShader).toContain("prepassWaterWorld.y");
  expect(result.fragmentShader).toContain("discard");
});
it("restores transparent visibility after an interrupted pass without showing hidden owners", () => {
  const scene = new THREE.Scene();
  const cloud = new THREE.Mesh(
    new THREE.PlaneGeometry(),
    new THREE.MeshBasicMaterial({ transparent: true }),
  );
  const leaves = new THREE.Mesh(
    new THREE.PlaneGeometry(),
    new THREE.MeshBasicMaterial({ transparent: true, alphaTest: 0.42 }),
  );
  const hidden = cloud.clone();
  hidden.visible = false;
  scene.add(cloud, leaves, hidden);
  expect(() =>
    withOpaquePresentation(scene, () => {
      expect(cloud.visible).toBe(false);
      expect(leaves.visible).toBe(true);
      throw Error("lost context");
    }),
  ).toThrow("lost context");
  expect(cloud.visible).toBe(true);
  expect(hidden.visible).toBe(false);
});
