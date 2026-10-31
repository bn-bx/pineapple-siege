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

/** Most pieces one sculpted owner breaks into. Each piece is real textured
 * and stone geometry, so the god breaks into fewer, larger chunks than boxes. */
export const SCULPT_PIECE_LIMIT = 8;

/** Equal halvings stay aligned to the source box, so a piece's size and cell
 * name its slice of the sculpture without storing where it started. */
export function statuePieceCell(p: Vec3, s: Vec3, partP: Vec3, partS: Vec3) {
  let cell = 0,
    stride = 1;
  for (let k = 0; k < 3; k++) {
    const n = Math.max(1, Math.round(s[k] / partS[k]));
    const j = Math.round((partP[k] - partS[k] - p[k] + s[k]) / (2 * partS[k]));
    cell += Math.min(n - 1, Math.max(0, j)) * stride;
    stride *= n;
  }
  return cell;
}

/** Inverse of statuePieceCell: the piece's box when it broke away. */
export function statuePieceBox(p: Vec3, s: Vec3, partS: Vec3, cell: number) {
  const n = s.map((v, k) => Math.max(1, Math.round(v / partS[k])));
  const min: Vec3 = [0, 0, 0],
    max: Vec3 = [0, 0, 0];
  for (let k = 0, rest = cell; k < 3; k++) {
    const j = rest % n[k];
    rest = Math.floor(rest / n[k]);
    min[k] = p[k] - s[k] + j * 2 * partS[k];
    max[k] = min[k] + 2 * partS[k];
  }
  return { min, max, n };
}
