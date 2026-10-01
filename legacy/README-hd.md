# Lantern Vale

Open **index.html** in Safari or Chrome, then click **Enter world**. The HTML is the complete application: no installation, server, internet connection, or other files are needed.

## Controls

| Input | Action |
| --- | --- |
| WASD | Walk |
| Mouse | Look |
| Shift | Sprint |
| Space | Jump |
| Escape | Pause and release the mouse |
| Hold and drag | Look when mouse capture is unavailable |

Walk into deep water to swim. Follow the path to the timber bridge and lantern fort; the eastern path climbs to the ridge, and a woodland branch leaves the western bridge approach. Safari may consume Escape presses for its pointer-capture banner before opening the pause menu.

The pause menu includes render quality, mouse sensitivity, inverted look, time of day, a hold-time switch, frame timing, and **Return to start**. A day lasts 24 minutes. Pausing freezes movement, water animation, and the clock. Settings last for the current session.

## HD rendering

The character renderer has been replaced with continuous WebGL 2 graphics: smooth terrain lighting, procedural grass/stone/wood materials, detailed tree meshes, antialiasing, filtered terrain and object shadows, and reflective water with animated distortion and underwater depth tint. Clouds, sunset, stars, moonlight, and fort lanterns remain.

Quality presets cap the scene at 720p, 1080p, or 1440p (also respecting viewport size and aspect ratio). Auto starts at High and can reduce to Balanced after sustained slow frames. Device pixel ratio is capped at 2. Reflections and refraction render at half the scene's width and height.

The deterministic 512-meter-square world and movement simulation are preserved. This is a stylized procedural landscape. It has no combat, construction, inventory, save system, or diving.

## Development

All application code, shaders, styles, and generated assets live in `index.html`. Open its URL with `#debug` to enable material/depth/normal diagnostic views, frame timing, and the `lanternVale` inspection API. The former `asciiWorld` debug name remains an alias for older development scripts; there is no ASCII display pass or font atlas.

Scripts in `checks/` use Node and Playwright only for development. Set `NODE_PATH` to the installed Playwright package directory and optionally `CHROME_PATH` to a Chrome executable. Current checks include `verify.cjs`, `recovery.cjs`, `hd.cjs`, `ray-boundaries.cjs` (terrain coverage despite its historical name), and `benchmark.cjs`.

The original notes and extracted video frames are preserved. [Verification notes](checks/VERIFICATION.md) distinguish current HD measurements from the earlier prototype's ten-minute exploration report.
