/** Comparison checks never imply visual acceptance. Missing observations block a pass. */
export function compareLandmarks(
  reference: Record<string, number[]>,
  observed: Record<string, number[]>,
  required: string[],
  headWidth: number,
) {
  const names = required.filter(
    (n) => observed[n]?.length === 2 && observed[n].every(Number.isFinite),
  );
  const errors = names.map(
    (n) =>
      Math.hypot(
        observed[n][0] - reference[n][0],
        observed[n][1] - reference[n][1],
      ) / headWidth,
  );
  const mean = errors.length
      ? errors.reduce((a, b) => a + b) / errors.length
      : null,
    max = errors.length ? Math.max(...errors) : null;
  const complete = names.length === required.length;
  return {
    observed: names.length,
    required: required.length,
    mean,
    max,
    complete,
    pass:
      complete && mean !== null && mean <= 0.01 && max !== null && max <= 0.02,
  };
}
export function maskOverlap(
  a: ArrayLike<number>,
  b: ArrayLike<number>,
  valid?: ArrayLike<number>,
) {
  if (a.length !== b.length || (valid && valid.length !== a.length))
    throw new Error("Masks must share the locked render resolution");
  let intersection = 0,
    union = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (valid && valid[i] < 128) continue;
    const x = a[i] > 127,
      y = b[i] > 127;
    if (x && y) intersection++;
    if (x || y) union++;
  }
  return union ? intersection / union : 0;
}
