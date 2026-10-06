/** Paged numeric journal: dense excavation does not allocate millions of Map entries.
 * Float64 values retain the exact numbers accepted by the previous Map journal.
 * Presence bits distinguish an unwritten sample from a recorded zero height.
 */
export class SparseValues implements Iterable<[number, number]> {
  private pages = new Map<
    number,
    { values: Float64Array; present: Uint32Array }
  >();
  size = 0;
  constructor(entries?: Iterable<readonly [number, number]>) {
    if (entries) for (const [index, value] of entries) this.set(index, value);
  }
  set(index: number, value: number) {
    const id = index >>> 8,
      offset = index & 255,
      word = offset >>> 5,
      bit = 1 << (offset & 31);
    let page = this.pages.get(id);
    if (!page)
      this.pages.set(
        id,
        (page = { values: new Float64Array(256), present: new Uint32Array(8) }),
      );
    if (!(page.present[word] & bit)) {
      page.present[word] |= bit;
      this.size++;
    }
    page.values[offset] = value;
    return this;
  }
  get(index: number) {
    const page = this.pages.get(index >>> 8),
      offset = index & 255;
    return page && page.present[offset >>> 5] & (1 << (offset & 31))
      ? page.values[offset]
      : undefined;
  }
  has(index: number) {
    const offset = index & 255;
    return !!(
      this.pages.get(index >>> 8)?.present[offset >>> 5]! &
      (1 << (offset & 31))
    );
  }
  get byteLength() {
    return this.pages.size * (256 * 8 + 8 * 4);
  }
  clear() {
    this.pages.clear();
    this.size = 0;
  }
  forEach(callback: (value: number, index: number) => void) {
    for (const [id, page] of this.pages)
      for (let word = 0; word < 8; word++) {
        let bits = page.present[word] >>> 0;
        while (bits) {
          const low = bits & -bits,
            offset = word * 32 + 31 - Math.clz32(low);
          callback(page.values[offset], id * 256 + offset);
          bits = (bits ^ low) >>> 0;
        }
      }
  }
  *keys() {
    for (const [id, page] of this.pages)
      for (let word = 0; word < 8; word++) {
        let bits = page.present[word] >>> 0;
        while (bits) {
          const low = bits & -bits;
          yield id * 256 + word * 32 + 31 - Math.clz32(low);
          bits = (bits ^ low) >>> 0;
        }
      }
  }
  *values() {
    for (const index of this.keys()) yield this.get(index)!;
  }
  *[Symbol.iterator](): Generator<[number, number]> {
    for (const index of this.keys()) yield [index, this.get(index)!];
  }
}
