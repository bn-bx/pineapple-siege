/** Keep the terrain streaming boundary fogged without hiding the ground at altitude. */
export function terrainFogVertex(source: string) {
  const vertex = source.includes("#include <begin_vertex>")
    ? "transformed"
    : "position";
  return source.replace(
    "#include <fog_vertex>",
    `#include <fog_vertex>
#ifdef USE_FOG
  vFogDepth = length((modelMatrix * vec4(${vertex}, 1.0)).xz - cameraPosition.xz);
#endif`,
  );
}
