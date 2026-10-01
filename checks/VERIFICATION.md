# Lantern Vale — HD verification

## Current build

The production file is `index.html`. This revision replaces the character display and per-character visibility rays with GPU terrain and instanced scenery meshes, shadow mapping, planar reflection/refraction passes, and pixel antialiasing. The world layout and movement simulation are retained.

## Browser coverage

- **Chrome 153.0.8010.54:** offline local-file functional, recovery, rendering, quality, and frame-timing checks.
- **Safari 26.6.2:** current HD build opened from the local file, entered with mouse capture, displayed the HD landscape and quality settings, and returned to the pause menu. The visible performance display reported approximately 46–50 FPS at a scene resolution around 1920 × 1048. This was a brief smoke test, not a sustained Safari benchmark. Safari can consume Escape presses for its pointer-capture banner.

Safari's smoke test preceded a small water-distortion correction; the final water shader is verified in Chrome.

## Functional and visual checks

- `report.json`: 19 functional checks passed, including deterministic terrain, exact collision sampling, spatial coverage, diagonal speed, jumping, fort-wall collision, arch entry, bridge crossing, bank exit, swimming, map bounds, resizing, and offline launch without network requests.
- `recovery-report.json`: 15 checks passed, including local paths with spaces, rejected pointer lock and drag-to-look, focus loss, clock controls, context restoration, stable paused rendering, correct depth/material selection, a full day/night sweep, and readable graphics failures.
- `hd-report.json`: six checks passed for 1280 × 720, 1920 × 1080, and 2560 × 1440 scene resolutions, actual keyboard movement, Return to start, and graphics errors.
- `ray-boundaries-report.json`: six boundary/vertical/grazing viewpoints passed; 17,280 pixel samples contained zero erroneous sky gaps. The filename is historical; visibility now uses rasterized triangles.

Reviewed daytime river and bridge views, the ridge, the fort entrance, the forest, sunset, and night lanterns. The images `vista.png`, `ridge-final.png`, `fort-final.png`, `night-final.png`, and `water-final.png` show the HD renderer. Original video reference frames remain in `../reference-frames/`.

## Performance

See `benchmark-report.json` for 30-second samples at each difficult viewpoint, after warmup, with a 1440 × 900 viewport and **1440 × 900 scene pixels** using High quality. These measurements are animation-frame timings on the development Mac, not a guarantee for other devices.

| View | Average FPS | Median frame | 95th percentile |
| --- | ---: | ---: | ---: |
| Densest forest route section | 58.2 | 16.7 ms | 16.8 ms |
| Broad reflective river | 57.8 | 16.7 ms | 16.8 ms |
| Illuminated fort | 60.0 | 16.7 ms | 16.8 ms |

No graphics errors occurred during the benchmark.

## Earlier exploration evidence

The existing `exploration-report.json` records the earlier renderer's completed ten-minute continuous exploration: 2.33 km, all 45 route waypoints, bridge crossings, courtyard, ridge, forest, and river swimming. That run validated the retained world and movement implementation. Its 60 FPS figures describe the earlier character renderer and are **not HD performance measurements**. The full ten-minute route has not been repeated for this rendering-only revision; current movement checks and an actual keyboard-input smoke test were rerun in HD.

## Practical limits

This is a stylized procedural landscape with a static heightfield and simple scenery meshes. Water uses planar reflection and refraction images at half the scene dimensions, with depth tint and normal distortion; these are approximations rather than recursive ray tracing. Fine shadow/shore edges can remain visible at close range. Desktop keyboard and mouse are required; WebGL 2 must be enabled. No caves, terrain editing, diving, or progression systems are included.

Final HTML SHA-256: `5fdf43131a927f2dc0420cd6e03e896c009f291bafbd3a6ddc4b47b3a9f2bdc1`.
