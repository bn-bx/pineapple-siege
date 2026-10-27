/** Rebuild structural contacts from part bounds. Disconnected decorations
 * attach to their nearest host, rather than directly to terrain. */
export function connectParts(parts) {
  const parent = parts.map((_, i) => i),
    find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const join = (i, j) => {
    const a = find(i),
      b = find(j);
    if (a === b) return false;
    parent[a] = b;
    parts[i].supports.push(parts[j].id);
    parts[j].supports.push(parts[i].id);
    return true;
  };
  for (const e of parts) e.supports = [];
  const gaps = [];
  for (let i = 0; i < parts.length; i++)
    for (let j = i + 1; j < parts.length; j++) {
      const a = parts[i],
        b = parts[j],
        distance = a.p.reduce(
          (sum, v, k) =>
            sum + Math.max(0, Math.abs(v - b.p[k]) - a.s[k] - b.s[k]) ** 2,
          0,
        );
      if (distance < 0.04) {
        join(i, j);
        if (!a.supports.includes(b.id)) {
          a.supports.push(b.id);
          b.supports.push(a.id);
        }
      } else gaps.push([distance, i, j]);
    }
  gaps.sort((a, b) => a[0] - b[0]);
  for (const [, i, j] of gaps) join(i, j);
}
