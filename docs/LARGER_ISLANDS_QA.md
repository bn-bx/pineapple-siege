# Larger islands verification

New islands use generator PS3, world revision 9, save revision 10, and a 9,216 m square with a 4,609² terrain grid at 2 m spacing. The default seed has 24,495 structural objects, 26,869 trees, 2016 residents, five castles, and six larger town layouts. Older baseline layouts fail validation and open the existing recovery flow; choosing temporary play keeps their data intact. Preferences retain their existing schema.

GPU height and wet masks use nine array-texture layers of 1,537² samples, below the 2,048 page limit. Padded storage is under 0.1% above the source grid. Chunk uploads split across page boundaries and preserve exact nearest-sample water clipping. The renderer shares an immutable baseline with storage while mutable simulation and rendering fields remain independent.

## Checks

- Release regression run: all 360 tests passed across 82 files, including the 32-seed mountain/drainage test and five-seed content test. An additional eight-test save suite passed after adding the older-sectioned-save guard; incompatible moving rubble remains untouched for recovery.
- Additional checks pass for GPU page corners and seams, split rectangle uploads, waypoint selection and bearings, graphics recovery, twenty-ball rendering, and distant ball collision coverage at 8.5 km.
- TypeScript, production build, runtime asset verification, and whitespace checks pass.
- Chrome walkthrough: generated PS3-0000002A, loaded and entered flight, selected and zoomed a waypoint, and observed its changing distance/bearing. No page or shader errors.
- Visually inspected seed 0 (broad lowland), seed 1 (rolling woodland), and seed 41729 (mountainous), including their roads, forests, settlement distribution and coastlines. Captures are in `artifacts/larger-islands/`.
- Isolated twenty-ball visual check: all 20 visible, 61 total draws including the floor, 84,162 triangles, and four shared geometries including the floor. No browser errors.

## Performance

Same machine, seed 42, 120 monsters, 30 warmup steps and 120 measured steps. Both simulations use the browser's incremental collision residency mode. Ball cases start 20 balls in a 5×4 arrangement beside the main castle at 50 m/s. Different seeded geography and nearby vegetation remain part of the comparison.

| Metric | Previous 6.1 km island | New 9.2 km island |
|---|---:|---:|
| Flight simulation step, mean | 1.60 ms | 1.16 ms |
| Flight simulation step, p95 | 4.72 ms | 2.15 ms |
| Twenty-ball step, mean | 18.52 ms | 23.94 ms |
| Twenty-ball step, p95 | 24.21 ms | 30.65 ms |
| Twenty-ball native physics, mean | 1.75 ms | 1.59 ms |
| Terrain baseline bytes | 37,773,316 | 84,971,524 |
| Isolated generation, seed 42 | 0.97 s | 6.70 s |
| Isolated generation process RSS | 142 MiB | 338 MiB |

Chrome software-rendering checks at 800×600 and Balanced graphics loaded in approximately 37 s before and 39 s after. Observed scene draws were 151 before and 173 after; tracked resident texture storage increased from approximately 47 to 103 MiB. Those browser scenes had differing active ball counts (2 and 8), so their GPU/frame timings are not a controlled twenty-ball comparison or a hardware FPS claim. The native simulation comparison above and isolated twenty-model visual check cover that stress case separately.

The busier world still costs about 29% more per simulation step in the twenty-ball scenario. Streaming prevents native physics cost from growing with the total island object count; generation and terrain memory grow substantially. No deployment was performed.
