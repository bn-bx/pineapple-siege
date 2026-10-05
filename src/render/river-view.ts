import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { WorldData } from "../types";
import type { TerrainView } from "./terrain-view";
import { CONFIG } from "../config";

export function makeRivers(world: WorldData, terrain: TerrainView) {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({
    color: 0x126b88,
    roughness: 0.3,
    metalness: 0.05,

    side: THREE.DoubleSide,
  });
  const uniforms = {
    time: { value: 0 },
    sky: { value: new THREE.Color("#b1d3e1") },
    sun: { value: new THREE.Color("#ffe9c7") },
    sunDirection: { value: new THREE.Vector3(0, 1, 0) },
    eye: { value: new THREE.Vector3() },
  };
  group.userData.material = material;
  group.userData.uniforms = uniforms;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uRiverTime = uniforms.time;
    shader.uniforms.uRiverSky = uniforms.sky;
    shader.uniforms.uRiverSun = uniforms.sun;
    shader.uniforms.uRiverSunDirection = uniforms.sunDirection;
    shader.uniforms.uRiverEye = uniforms.eye;
    shader.uniforms.uTerrain = { value: terrain.heightTexture };
    shader.uniforms.uWet = { value: terrain.floodTexture };
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying vec3 riverPosition; varying vec2 riverFlow; attribute vec2 flow;",
      )
      .replace(
        "#include <worldpos_vertex>",
        "#include <worldpos_vertex>\nriverPosition=(modelMatrix*vec4(transformed,1.)).xyz; riverFlow=flow;",
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>\nvarying vec3 riverPosition; varying vec2 riverFlow;uniform sampler2D uTerrain,uWet;
        uniform float uRiverTime; uniform vec3 uRiverSky,uRiverSun,uRiverSunDirection,uRiverEye;`,
      )
      .replace(
        "#include <clipping_planes_fragment>",
        `#include <clipping_planes_fragment>\nvec2 riverUV=(riverPosition.xz/${CONFIG.spacing}.+.5)/${CONFIG.grid}.;float riverDepth=riverPosition.y-texture2D(uTerrain,riverUV).r;
        if(texture2D(uWet,riverUV).r<.5 || riverDepth<=0.)discard;
        diffuseColor.rgb=mix(diffuseColor.rgb*1.5,diffuseColor.rgb*.65,smoothstep(.3,5.,riverDepth));
        float along=dot(riverPosition.xz,riverFlow), across=dot(riverPosition.xz,vec2(-riverFlow.y,riverFlow.x));
        float current=sin(along*.24-uRiverTime*.8+sin(across*.19))*sin(across*.33+along*.09);
        float broad=sin(along*.045+across*.07-uRiverTime*.08);
        diffuseColor.rgb*=.95+.06*current+.06*broad;
        vec2 ripple=vec2(cos(riverPosition.x*.42+riverPosition.z*.26-uRiverTime*1.3),sin(riverPosition.z*.65-riverPosition.x*.18-uRiverTime*.9))*.035;
        vec3 riverNormal=normalize(vec3(ripple.x,1.,ripple.y));`,
      )
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
        normal=normalize(normal+(viewMatrix*vec4(ripple.x,0.,ripple.y,0.)).xyz);`,
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        vec3 toEye=normalize(uRiverEye-riverPosition);
        float fresnel=.025+.65*pow(1.-max(dot(toEye,riverNormal),0.),5.);
        float glint=pow(max(dot(toEye,reflect(-uRiverSunDirection,riverNormal)),0.),100.);
        totalEmissiveRadiance+=uRiverSky*fresnel*.55+uRiverSun*glint*.65;
        float bank=(1.-smoothstep(.1,.8,riverDepth))*smoothstep(0.,.12,riverDepth);
        totalEmissiveRadiance+=uRiverSun*bank*.12;`,
      );
  };
  const tiles = new Map<number, THREE.BufferGeometry[]>();
  const append = (geometry: THREE.BufferGeometry, x: number, z: number) => {
    const key = Math.floor(z / 256) * 24 + Math.floor(x / 256);
    let list = tiles.get(key);
    if (!list) tiles.set(key, (list = []));
    list.push(geometry);
  };
  for (const river of world.rivers ?? []) {
    // Separate reaches retain tight culling bounds and meet at shared corner pools.
    for (let i = 1; i < river.points.length; i++) {
      const a = river.points[i - 1],
        b = river.points[i],
        dx = b[0] - a[0],
        dz = b[2] - a[2],
        length = Math.hypot(dx, dz);
      if (!length) continue;
      const nx = (-dz / length) * river.width,
        nz = (dx / length) * river.width;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(
          [
            a[0] + nx,
            a[1] + 0.05,
            a[2] + nz,
            a[0] - nx,
            a[1] + 0.05,
            a[2] - nz,
            b[0] + nx,
            b[1] + 0.05,
            b[2] + nz,
            b[0] - nx,
            b[1] + 0.05,
            b[2] - nz,
          ],
          3,
        ),
      );
      const tangent = (at: number) => {
        const before = river.points[Math.max(0, at - 1)],
          after = river.points[Math.min(river.points.length - 1, at + 1)];
        const tx = after[0] - before[0],
          tz = after[2] - before[2];
        const scale = Math.hypot(tx, tz) || 1;
        return [tx / scale, tz / scale];
      };
      const startFlow = tangent(i - 1),
        endFlow = tangent(i);
      geometry.setAttribute(
        "flow",
        new THREE.Float32BufferAttribute(
          [...startFlow, ...startFlow, ...endFlow, ...endFlow],
          2,
        ),
      );
      geometry.setIndex([0, 2, 1, 1, 2, 3]);
      geometry.computeVertexNormals();
      append(geometry, (a[0] + b[0]) / 2, (a[2] + b[2]) / 2);
      const pool = new THREE.CircleGeometry(river.width, 12);
      pool.deleteAttribute("uv");
      const flow = new Float32Array(pool.attributes.position.count * 2);
      for (let j = 0; j < flow.length; j += 2) {
        flow[j] = startFlow[0];
        flow[j + 1] = startFlow[1];
      }
      pool.setAttribute("flow", new THREE.BufferAttribute(flow, 2));
      pool.rotateX(-Math.PI / 2);
      pool.translate(a[0], a[1] + 0.04, a[2]);
      append(pool, a[0], a[2]);
    }
  }
  for (const list of tiles.values()) {
    const geometry = mergeGeometries(list)!;
    geometry.computeBoundingSphere();
    for (const part of list) part.dispose();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.matrixAutoUpdate = false;
    mesh.matrixWorldAutoUpdate = false;
    group.add(mesh);
  }
  return group;
}
