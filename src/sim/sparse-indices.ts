/** Paged bit set: full-map excavation costs 1.2 MB, not millions of boxed keys. */
export class SparseIndices implements Iterable<number> {
  private pages = new Map<number, Uint32Array>();
  size = 0;
  add(index: number) {
    const pageId = index >>> 10,
      word = (index >>> 5) & 31,
      bit = 1 << (index & 31);
    let page = this.pages.get(pageId);
    if (!page) this.pages.set(pageId, (page = new Uint32Array(32)));
    if (!(page[word] & bit)) {
      page[word] |= bit;
      this.size++;
    }
    return this;
  }
  has(index: number) {
    return !!(
      this.pages.get(index >>> 10)?.[(index >>> 5) & 31]! &
      (1 << (index & 31))
    );
  }
  clear() {
    this.pages.clear();
    this.size = 0;
  }
  *[Symbol.iterator]() {
    for (const [id, page] of this.pages)
      for (let w = 0; w < 32; w++) {
        let bits = page[w] >>> 0;
        while (bits) {
          const low = bits & -bits;
          const bit = 31 - Math.clz32(low);
          yield id * 1024 + w * 32 + bit;
          bits = (bits ^ low) >>> 0;
        }
      }
  }
}
