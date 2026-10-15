export type JetCloudPart = "hull" | "wing" | "engine";

/** Volumetric smoke arranged into a tapered fuselage, swept wings and twin engines. */
export function jetCloudPuffs(height: number, count: number, rand: (i: number) => number) {
  return Array.from({ length: count }, (_, i) => {
    const t = (i + .5) / count, side = i % 2 ? -1 : 1;
    let x = 0, y = 0, z = 0, size = .035;
    let part: JetCloudPart = "hull";
    if (t < .4) {
      const along = t / .4, a = i * 2.399963;
      const radius = (.018 + Math.sin(along * Math.PI) * .048) * Math.sqrt(rand(i + 41));
      x = Math.cos(a) * radius;
      y = .2 + along * .77;
      z = Math.sin(a) * radius * .8;
      size = .043 + Math.sin(along * Math.PI) * .012;
    } else if (t < .72 || t >= .94) {
      const tail = t >= .94;
      const u = Math.sqrt(rand(i + 53)), v = rand(i + 67);
      const a = tail ? [.045, .3] : [.045, .67];
      const b = tail ? [.23, .17] : [.49, .36];
      const c = tail ? [.055, .18] : [.075, .37];
      x = side * ((1 - u) * a[0] + u * (1 - v) * b[0] + u * v * c[0]);
      y = (1 - u) * a[1] + u * (1 - v) * b[1] + u * v * c[1];
      z = (rand(i + 71) - .5) * .035;
      size = tail ? .04 : .055;
      part = "wing";
    } else if (t < .88) {
      const along = (t - .72) / .16, a = i * 2.399963;
      x = side * .105 + Math.cos(a) * .028;
      y = .16 + along * .34;
      z = -.025 + Math.sin(a) * .03;
      size = .047;
      part = along < .38 ? "engine" : "hull";
    } else {
      // Upright tail fin gives the cloud depth as the camera moves around it.
      x = (rand(i + 79) - .5) * .03;
      y = .21 + rand(i + 83) * .2;
      z = rand(i + 89) * .17;
      size = .04;
      part = "wing";
    }
    return { p: [x * height, y * height, z * height] as [number, number, number], size: size * height, part };
  });
}
