/** Recent active frame intervals in milliseconds, including uncapped stalls. */
export function frameStats(samples: number[], window=600) {
  const sorted = samples.slice(-window).sort((a, b) => a - b);
  const count = sorted.length;
  const slow = sorted.slice(-Math.ceil(count * 0.01));
  return {
    medianMS: sorted[Math.floor(count * 0.5)] ?? 0,
    p95MS: sorted[Math.floor(count * 0.95)] ?? 0,
    p99MS: sorted[Math.floor(count * 0.99)] ?? 0,
    missedFraction: count ? sorted.filter(ms => ms > 33.3).length/count : 0,
    worstMS: sorted.at(-1) ?? 0,
    lowFPS:
      count >= 100
        ? (1000 * slow.length) / slow.reduce((total, ms) => total + ms, 0)
        : undefined,
  };
}
