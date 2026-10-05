import * as THREE from "three";
import type { BodyView } from "../types";
const declarations = `
attribute vec3 motionPreviousP;
attribute vec4 motionPreviousQ, motionCurrentQ;
uniform float motionAlpha, motionEnabled;
vec4 motionQ; vec3 motionP, motionS;
vec4 interpolateMotionQ(vec4 a,vec4 b,float t) {
  float d=dot(a,b);if(d<0.) {b=-b;d=-d;}
  if(d>.9995)return normalize(mix(a,b,t));
  float angle=acos(clamp(d,-1.,1.)),s=sin(angle);
  return (sin((1.-t)*angle)*a+sin(t*angle)*b)/max(s,.00001);
}
vec3 rotateMotion(vec4 q,vec3 v) {return v+2.*cross(q.xyz,cross(q.xyz,v)+q.w*v);}
mat3 motionRotation(vec4 q) {return mat3(rotateMotion(q,vec3(1.,0.,0.)),rotateMotion(q,vec3(0.,1.,0.)),rotateMotion(q,vec3(0.,0.,1.)));}
`;
function patch(
  material: THREE.Material,
  alpha: { value: number },
  enabled: { value: number },
) {
  const previous = material.onBeforeCompile.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    previous(shader, renderer);
    shader.uniforms.motionAlpha = alpha;
    shader.uniforms.motionEnabled = enabled;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\n" + declarations)
      .replace(
        "void main() {",
        `void main() {
        motionQ=interpolateMotionQ(motionPreviousQ,motionCurrentQ,motionAlpha);
        motionP=mix(motionPreviousP,instanceMatrix[3].xyz,motionAlpha);
        motionS=vec3(length(instanceMatrix[0].xyz),length(instanceMatrix[1].xyz),length(instanceMatrix[2].xyz));`,
      )
      .replace(
        "#include <project_vertex>",
        THREE.ShaderChunk.project_vertex.replace(
          "mvPosition = instanceMatrix * mvPosition;",
          "mvPosition = motionEnabled>.5 ? vec4(rotateMotion(motionQ,transformed*motionS)+motionP,1.) : instanceMatrix*mvPosition;",
        ),
      )
      .replace(
        "#include <worldpos_vertex>",
        THREE.ShaderChunk.worldpos_vertex.replace(
          "worldPosition = instanceMatrix * worldPosition;",
          "worldPosition = motionEnabled>.5 ? vec4(rotateMotion(motionQ,transformed*motionS)+motionP,1.) : instanceMatrix*worldPosition;",
        ),
      )
      .replace(
        "#include <defaultnormal_vertex>",
        THREE.ShaderChunk.defaultnormal_vertex.replace(
          "mat3 im = mat3( instanceMatrix );",
          "mat3 im = mat3( instanceMatrix );if(motionEnabled>.5) im=motionRotation(motionQ)*im;",
        ),
      );
  };
  material.customProgramCacheKey = () => "debris-motion-v1";
  material.needsUpdate = true;
}
/** The GPU interpolates poses. CPU uploads only when a new motion packet arrives. */
export function prepareDebrisMotion(
  mesh: THREE.InstancedMesh,
  alpha: { value: number },
  enabled: { value: number },
) {
  if (mesh.userData.motion) return;
  mesh.geometry = mesh.geometry.clone();
  const material = (mesh.material as THREE.Material).clone();
  material.onBeforeCompile = (mesh.material as THREE.Material).onBeforeCompile;
  mesh.material = material;
  patch(material, alpha, enabled);
  const depth = new THREE.MeshDepthMaterial({
    depthPacking: THREE.RGBADepthPacking,
  });
  patch(depth, alpha, enabled);
  mesh.customDepthMaterial = depth;
  resizeDebrisMotion(mesh);
  mesh.userData.motion = true;
  mesh.setMatrixAt(0, new THREE.Matrix4());
}
export function resizeDebrisMotion(mesh: THREE.InstancedMesh) {
  const count = mesh.instanceMatrix.count;
  for (const [name, size] of [
    ["motionPreviousP", 3],
    ["motionPreviousQ", 4],
    ["motionCurrentQ", 4],
  ] as const) {
    const data = new Float32Array(count * size);
    if (size === 4) for (let i = 0; i < count; i++) data[i * 4 + 3] = 1;
    mesh.geometry.setAttribute(
      name,
      new THREE.InstancedBufferAttribute(data, size).setUsage(
        THREE.DynamicDrawUsage,
      ),
    );
  }
}
export function writeDebrisMotion(
  mesh: THREE.InstancedMesh,
  index: number,
  b: BodyView,
  previous: BodyView | undefined,
) {
  const matrix = mesh.instanceMatrix.array as Float32Array,
    j = index * 16;
  matrix[j] = b.s[0];
  matrix[j + 1] = matrix[j + 2] = matrix[j + 3] = matrix[j + 4] = 0;
  matrix[j + 5] = b.s[1];
  matrix[j + 6] = matrix[j + 7] = matrix[j + 8] = matrix[j + 9] = 0;
  matrix[j + 10] = b.s[2];
  matrix[j + 11] = 0;
  matrix[j + 12] = b.p[0];
  matrix[j + 13] = b.p[1];
  matrix[j + 14] = b.p[2];
  matrix[j + 15] = 1;
  const p = mesh.geometry.getAttribute("motionPreviousP").array as Float32Array;
  const q = mesh.geometry.getAttribute("motionPreviousQ").array as Float32Array;
  const current = mesh.geometry.getAttribute("motionCurrentQ")
    .array as Float32Array;
  const old = previous ?? b,
    k = index * 3,
    n = index * 4;
  p[k] = old.p[0];
  p[k + 1] = old.p[1];
  p[k + 2] = old.p[2];
  q[n] = old.q[0];
  q[n + 1] = old.q[1];
  q[n + 2] = old.q[2];
  q[n + 3] = old.q[3];
  current[n] = b.q[0];
  current[n + 1] = b.q[1];
  current[n + 2] = b.q[2];
  current[n + 3] = b.q[3];
}
export function uploadDebrisMotion(mesh: THREE.InstancedMesh) {
  if (!mesh.userData.motion) return;
  for (const name of ["motionPreviousP", "motionPreviousQ", "motionCurrentQ"]) {
    const attribute = mesh.geometry.getAttribute(
      name,
    ) as THREE.InstancedBufferAttribute;
    attribute.clearUpdateRanges();
    if (mesh.count) {
      attribute.addUpdateRange(0, mesh.count * attribute.itemSize);
      attribute.needsUpdate = true;
    }
  }
}
