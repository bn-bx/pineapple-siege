import { expect, it } from "vitest";
import * as THREE from "three";
import {
  matchPrepass,
  withOpaquePresentation,
} from "../src/render/alpha-prepass";
import { waterPrepass } from "../src/render/water-prepass";
import { bannerWind } from "../src/render/banner-wind";
import { foliageWind } from "../src/render/foliage-wind";
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
it("retains foliage cutouts and animated vertices in normal and photo depth", () => {
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
  for (const material of [
    new THREE.MeshNormalMaterial(),
    new THREE.MeshDepthMaterial(),
  ]) {
    matchPrepass(material);
    prepare(material, mesh);
    const result = shader(
      material instanceof THREE.MeshNormalMaterial ? "normal" : "depth",
    );
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
it("keeps opaque cloth deformation synchronized with shadows and auxiliary depth", () => {
  const time = { value: 12 };
  const cloth = new THREE.MeshStandardMaterial();
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(), cloth);
  bannerWind(cloth, time);
  mesh.customDepthMaterial = new THREE.MeshDepthMaterial();
  bannerWind(mesh.customDepthMaterial, time);
  const prepass = new THREE.MeshDepthMaterial();
  matchPrepass(prepass);
  prepare(prepass, mesh);
  const beauty = {
    ...shader("depth"),
    vertexShader: THREE.ShaderLib.standard.vertexShader,
  };
  cloth.onBeforeCompile(beauty, {} as THREE.WebGLRenderer);
  for (const material of [mesh.customDepthMaterial, prepass]) {
    const result = shader("depth");
    material.onBeforeCompile(result, {} as THREE.WebGLRenderer);
    expect(result.uniforms.bannerTime).toBe(time);
    expect(result.vertexShader).toContain("*.16*(1.-uv.y)");
    expect(result.vertexShader).toContain("bannerTime*2.");
  }
  expect(beauty.uniforms.bannerTime).toBe(time);
});

it("keeps leaf wind and packed falling-tree motion together in shadow depth", () => {
  const time = { value: 8 },
    alpha = { value: 0.4 },
    enabled = { value: 1 };
  const material = new THREE.MeshStandardMaterial({
    map: new THREE.Texture(),
    alphaTest: 0.42,
    side: THREE.DoubleSide,
  });
  foliageWind(material, time);
  const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(), material, 2);
  prepareDebrisMotion(mesh, alpha, enabled);
  const result = shader("depth");
  mesh.customDepthMaterial!.onBeforeCompile(result, {} as THREE.WebGLRenderer);
  expect(result.uniforms.foliageTime).toBe(time);
  expect(result.uniforms.motionAlpha).toBe(alpha);
  expect(result.vertexShader).toContain("transformed.x+=sin(foliageTime");
  expect(result.vertexShader).toContain(
    "rotateMotion(motionQ,transformed*motionS)",
  );
  expect((mesh.customDepthMaterial as THREE.MeshDepthMaterial).map).toBe(
    material.map,
  );
  expect(mesh.customDepthMaterial!.alphaTest).toBe(0.42);
});
