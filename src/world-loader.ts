import type { WorldData } from "./types";

/** Reassemble byte-exact terrain parts in manifest order, regardless of arrival order. */
export async function loadTerrain(
  world: WorldData,
  base: string,
  request = fetch,
): Promise<ArrayBuffer> {
  const parts = await Promise.all(
    (world.heightFiles ?? ["world.bin"]).map(async (name) => {
      const response = await request(`${base}${name}`);
      if (!response.ok) throw Error("Terrain data did not load");
      return new Uint8Array(await response.arrayBuffer());
    }),
  );
  const length = parts.reduce((n, part) => n + part.byteLength, 0);
  if (length !== world.grid * world.grid * 4)
    throw Error("Terrain data is incomplete");
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  return bytes.buffer;
}
