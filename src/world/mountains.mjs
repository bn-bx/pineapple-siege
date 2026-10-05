const mix = (a, b, t) => a + (b - a) * t;
/** Seeded regional layouts, rather than a repeated pair of central ridges. */
export function createMountainLayout(hash) {
  const style = Math.floor(hash(31, 510) * 4);
  const count =
    style === 0
      ? 1
      : style === 2
        ? 3 + Math.floor(hash(32, 510) * 3)
        : 2 + Math.floor(hash(32, 510) * 2);
  const startAngle = hash(33, 510) * Math.PI * 2;
  const ridges = Array.from({ length: count }, (_, i) => {
    const sector =
      startAngle + (i * Math.PI * 2) / count + (hash(i, 511) - 0.5) * 0.65;
    const radius =
      style === 0
        ? 250 + hash(i, 512) * 550
        : style === 3
          ? 1350 + hash(i, 512) * 500
          : 850 + hash(i, 512) * 750;
    const angle =
      style === 3
        ? sector + Math.PI / 2 + (hash(i, 513) - 0.5) * 0.8
        : hash(i, 513) * Math.PI;
    const length =
      style === 0
        ? 1450 + hash(i, 514) * 400
        : style === 2
          ? 420 + hash(i, 514) * 320
          : 700 + hash(i, 514) * 500;
    const width =
      style === 2 ? 270 + hash(i, 515) * 220 : 230 + hash(i, 515) * 190;
    const peakCount =
      style === 2
        ? 1 + Math.floor(hash(i, 516) * 2)
        : style === 0
          ? 3 + Math.floor(hash(i, 516) * 3)
          : 2 + Math.floor(hash(i, 516) * 3);
    return {
      x: Math.cos(sector) * radius,
      z: Math.sin(sector) * radius,
      cos: Math.cos(angle),
      sin: Math.sin(angle),
      length,
      width,
      bend: 70 + hash(i, 517) * 180,
      phase: hash(i, 518) * Math.PI * 2,
      wavelength: 400 + hash(i, 519) * 600,
      amplitude: i === 0 ? 1 : 0.68 + hash(i, 520) * 0.32,
      peaks: Array.from({ length: peakCount }, (_, p) => ({
        x:
          peakCount === 1
            ? 0
            : mix(-0.7, 0.7, p / (peakCount - 1)) * length +
              (hash(i * 11 + p, 521) - 0.5) * length * 0.2,
        width: length * (0.16 + hash(i * 11 + p, 522) * 0.22),
        height: 0.65 + hash(i * 11 + p, 523) * 0.35,
      })),
    };
  });
  // Each cut belongs to one range; it cannot split every mountain on the island.
  const passes = Array.from({ length: 2 }, (_, i) => {
    const ridge = ridges[i % count];
    const along =
      (count === 1 ? (i === 0 ? -1 : 1) : hash(i, 524) < 0.5 ? -1 : 1) *
      ridge.length *
      (0.28 + hash(i, 525) * 0.35);
    const across = ridgeCenter(ridge, along);
    return {
      x: ridge.x + along * ridge.cos - across * ridge.sin,
      z: ridge.z + along * ridge.sin + across * ridge.cos,
      cos: ridge.cos,
      sin: ridge.sin,
      width: 150 + hash(i, 526) * 90,
      length: ridge.width + ridge.bend + 220,
    };
  });
  return {
    style: [
      "long-range",
      "regional-ranges",
      "scattered-massifs",
      "coastal-ranges",
    ][style],
    ridges,
    passes,
  };
}
function ridgeCenter(ridge, x) {
  return ridge.bend * Math.sin(x / ridge.wavelength + ridge.phase);
}
export function mountainRelief(layout, x, z) {
  let relief = 0;
  for (const ridge of layout.ridges) {
    const ox = x - ridge.x,
      oz = z - ridge.z;
    const along = ox * ridge.cos + oz * ridge.sin;
    const across = -ox * ridge.sin + oz * ridge.cos - ridgeCenter(ridge, along);
    const envelope = Math.exp(-((along / ridge.length) ** 4));
    const spine = Math.exp(-((across / ridge.width) ** 2)) * envelope;
    let peaks = 0;
    for (const peak of ridge.peaks)
      peaks = Math.max(
        peaks,
        peak.height * Math.exp(-(((along - peak.x) / peak.width) ** 2)),
      );
    const foothills =
      Math.exp(-((across / (ridge.width * 1.7)) ** 2)) * envelope;
    relief = Math.max(
      relief,
      ridge.amplitude * (spine * (0.24 + peaks * 0.68) + foothills * 0.08),
    );
  }
  for (const pass of layout.passes) {
    const ox = x - pass.x,
      oz = z - pass.z;
    const along = ox * pass.cos + oz * pass.sin;
    const across = -ox * pass.sin + oz * pass.cos;
    relief *=
      1 -
      0.92 *
        Math.exp(-((along / pass.width) ** 2) - (across / pass.length) ** 4);
  }
  return relief;
}
