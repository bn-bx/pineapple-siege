const mix = (a, b, t) => a + (b - a) * t;
/** Seeded regional layouts, rather than a repeated pair of central ridges. */
export function createMountainLayout(hash) {
  const style = Math.floor(hash(31, 510) * 4);
  const count = style === 0 ? 1 : style === 2 ? 3 : 2;
  const startAngle = hash(33, 510) * Math.PI * 2;
  const ridges = Array.from({ length: count }, (_, i) => {
    const sector =
      startAngle + (i * Math.PI * 2) / count + (hash(i, 511) - 0.5) * 0.65;
    const radius =
      style === 0
        ? 300 + hash(i, 512) * 500
        : style === 3
          ? 1050 + hash(i, 512) * 400
          : 650 + hash(i, 512) * 650;
    const angle =
      style === 3
        ? sector + Math.PI / 2 + (hash(i, 513) - 0.5) * 0.8
        : hash(i, 513) * Math.PI;
    const length =
      style === 0
        ? 1900 + hash(i, 514) * 400
        : style === 2
          ? 800 + hash(i, 514) * 350
          : 1250 + hash(i, 514) * 550;
    const width =
      style === 2 ? 420 + hash(i, 515) * 210 : 430 + hash(i, 515) * 220;
    const peakCount =
      style === 2
        ? 2 + Math.floor(hash(i, 516) * 2)
        : style === 0
          ? 4 + Math.floor(hash(i, 516) * 3)
          : 3 + Math.floor(hash(i, 516) * 3);
    return {
      x: Math.cos(sector) * radius,
      z: Math.sin(sector) * radius,
      cos: Math.cos(angle),
      sin: Math.sin(angle),
      length,
      width,
      bend: 120 + hash(i, 517) * 180,
      phase: hash(i, 518) * Math.PI * 2,
      wavelength: 400 + hash(i, 519) * 600,
      amplitude: i === 0 ? 1 : 0.68 + hash(i, 520) * 0.32,
      spurs: Array.from({ length: 4 }, (_, j) => ({
        along: (-0.65 + j * 0.43) * length,
        side: j % 2 ? 1 : -1,
        reach: width * (1.7 + hash(i * 11 + j, 530) * 0.6),
        width: 145 + hash(i * 11 + j, 531) * 100,
        drift: (hash(i * 11 + j, 532) - 0.5) * 0.9,
      })),
      peaks: Array.from({ length: peakCount }, (_, p) => ({
        x:
          peakCount === 1
            ? 0
            : mix(-0.7, 0.7, p / (peakCount - 1)) * length +
              (hash(i * 11 + p, 521) - 0.5) * length * 0.2,
        width: length * (0.13 + hash(i * 11 + p, 522) * 0.13),
        height: 0.65 + hash(i * 11 + p, 523) * 0.35,
      })),
    };
  });
  const passes = [];
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
    const spine =
      Math.exp(-(Math.abs(across / ridge.width) ** 0.95)) * envelope;
    let peaks = 0;
    for (const peak of ridge.peaks)
      peaks = Math.max(
        peaks,
        peak.height * Math.exp(-(((along - peak.x) / peak.width) ** 2)),
      );
    const foothills =
      Math.exp(-((across / (ridge.width * 2.2)) ** 2)) * envelope;
    let branches = 0;
    for (const spur of ridge.spurs) {
      const outward = across * spur.side;
      if (outward < 0) continue;
      const offset = along - spur.along - outward * spur.drift;
      branches = Math.max(
        branches,
        Math.exp(-((offset / spur.width) ** 2) - (outward / spur.reach) ** 2) *
          0.18,
      );
    }
    relief = Math.max(
      relief,
      ridge.amplitude *
        (spine * (0.2 + peaks * 0.64) + foothills * 0.16 + branches),
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
