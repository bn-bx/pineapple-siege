import type { Vec3 } from "../types";

/** Binary cuts partition the whole collision solid; no scaling or discarded remainder. */
export function fractureStatueBox(p: Vec3, s: Vec3, limit: number, edge = 24) {
  const pieces = [{ p: [...p] as Vec3, s: [...s] as Vec3 }];
  while (pieces.length < limit) {
    let largest = -1,
      extent = edge / 2;
    for (let i = 0; i < pieces.length; i++) {
      const size = Math.max(...pieces[i].s);
      if (size > extent) {
        extent = size;
        largest = i;
      }
    }
    if (largest < 0) break;
    const part = pieces[largest],
      axis = part.s.indexOf(extent);
    const size = [...part.s] as Vec3;
    size[axis] /= 2;
    const left = [...part.p] as Vec3,
      right = [...part.p] as Vec3;
    left[axis] -= size[axis];
    right[axis] += size[axis];
    pieces.splice(
      largest,
      1,
      { p: left, s: size },
      { p: right, s: [...size] as Vec3 },
    );
  }
  return pieces;
}
