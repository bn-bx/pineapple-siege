# CRT filter verification — October 7, 2026

Graphics now offers Off, Subtle, and Retro TV; Subtle is enabled by default. The saved choice applies to gameplay and PNG photos. HTML menus, HUD, and touch controls remain outside the filter. Preference revision 5 migrates missing or invalid choices to Subtle.

## Automated checks

- Production build, TypeScript check, and hashed runtime asset verification passed.
- Full Vitest suite: 64 files, 285 tests passed. The CRT tests cover preference migration, pass bypass, composer target reuse, resize uniforms, photo focus, and disposal.
- `scripts/check-crt-browser.mjs` passed in isolated headless Chrome with no console or page errors. It exercises all presets, daylight/night/explosion captures, photo mode and PNG download, mobile resizing, Reduce effects independence, context loss/restoration, reload persistence, and reset defaults.
- `scripts/check-pause-menu-browser.mjs` passed at desktop and mobile sizes, including the CRT selector.

Run the browser scripts against a local Vite server using `ISLAND_URL`; set `PLAYWRIGHT_MODULE` if Playwright is provided outside this project's dependencies. CRT captures and the timing JSON default to `/tmp/siege-crt`; override with `CRT_QA_OUTPUT`.

## Visual and timing review

Reviewed daylight and nighttime presets, exported Retro TV photos, mobile sizing, recovery, and explosion captures. After visual feedback, both presets were revised to use wider horizontal raster beams, brightness-dependent beam width, soft phosphor spread, and rounded glass boundaries. Subtle keeps those effects lighter. Retro TV strengthens the scanline gaps, glow, RGB convergence, curvature, and corner darkening; its shadow mask is secondary to the scanlines. Neither preset uses animated flicker.

The revised shader passed 9 focused presentation/recovery tests, TypeScript checking, the production build and asset verification, and the complete CRT browser script with no browser errors. Visual review covered daylight, nighttime, photo exports, and explosions. The earlier full suite passed 285 tests before this shader-only revision.

The latest short comparison of the same paused scene at 720p measured mean whole-frame GPU times of 9.56–10.47 ms with CRT Off, 10.57 ms with Subtle, and 10.59 ms with Retro TV. CRT CPU submission averaged 0.033 ms. Samples were 24–25 frames per case. The Off runs varied, so these local headless measurements do not establish a precise overhead or certify performance on other devices or during long combat runs.

The shader adds one fullscreen pass with seven texture reads, reuses the composer's existing targets, and bypasses rendering entirely when Off. GPU context recovery retains its uniforms and enabled state. The existing telemetry reports `crtSubmit` and includes the pass in the post-processing count.
