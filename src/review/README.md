# Pineapple god reference review

This preview is a separate entry point at `/statue-review.html`. The live game does not import the candidate asset or the review code. Do not replace its statue until the user explicitly accepts the comparison.

## Reproduce the package

Use Node 22+ and Python with Pillow and NumPy. Start the Vite server, then run:

```sh
python3 scripts/review/prepare-head-surface.py
python3 scripts/review/author-statue.py
node scripts/review/capture.mjs
python3 scripts/review/build-package.py
```

`REVIEW_URL` changes the preview origin (default `http://127.0.0.1:5183`). `PLAYWRIGHT_MODULE` and `CHROME_PATH` override local browser dependencies. The Codex bundled runtime is supported by the default capture script.

The original reference and its SHA-256 provenance are under `public/review/pineapple-god/`. Captures, overlays, differences, and review status are under its `captures/` directory.

## Modeling and measurement

- `sculpt.json` contains baked XYZ vertices, triangle topology, material regions, closed damage owners, and collision bounds derived from the same vertices.
- The head/neck is one closed, connected control surface with authored anatomical feature sections and a rounded rear skull. Its source is `scripts/review/head_sculpt.py`; the baked asset carries fixed model-space UVs and front/rear projection weights.
- The head and neck now use `head-surface.png`, derived from the supplied reference. Sky-derived scanline compensation, conservative broad illumination reduction, and atlas-gutter color extension are documented in `surface-provenance.json`. The original remains unchanged. Residual photographed lighting remains; this is an appearance reconstruction, not independently recovered albedo.
- Photo, gold material, and neutral clay modes share the same actual geometry. The reference surface stays attached to model UVs when the camera moves; no billboard or screenshot layer is used. The shader restores reference radiance before the fixed ACES output transform and adds a modest live lighting response. It is currently a review material, not a validated production game material.
- Inspect `clay-head-three.png`, `clay-head-side.png`, and the opposite light. Photo-surface landmarks are source-dependent and cannot pass an independent geometry gate. Observation storage is separated by surface mode. No frontal photo score can certify the unseen side.
- The head/neck is visually accepted. `visual-acceptance.json` and `accepted-head.json` record its original geometry/texture. The authoring script refuses to write a body revision if those hashes change.
- `body_sculpt.py` blends authored torso, arm, hand and leg volumes into closed continuous surfaces using an offline isosurface extraction. No reference brightness is used to estimate depth. Torso/arms/hands are one connected mesh; each hip-to-calf form is continuous. Semantic damage mapping into the real game is still deferred.
- Body silhouette control-cage fitting moves outer control vertices by at most nine source pixels towards source trace v2, preserving front relief and articulated hands. Therefore silhouette overlap is an authoring-constraint diagnostic, not an independent anatomy evaluation.
- `prepare-body-surface.py` derives the body UV atlas from the original. Aircraft pixels are masked. The separate `cloth-surface.png` reconstructs continuous vertical fabric from an unoccluded upper strip; this hidden cloth is explicitly unverified.
- Metal cuffs are closed sleeves, necklace pieces are volumetric, the scepter has a round shaft, and the stairs have actual shared treads/risers. Body/accessories are visually accepted; the approval record pins the accepted mesh revision. The game uses a separately packed, bounded-draw export of the same accepted surface.
- The fixed reference camera is used across the full statue. Side/three-quarter views intentionally change the camera and cannot be compared to unseen source views.
- Head segmentation is derived from original photo colors, within the original y=190..414 ROI; the connected neck is outside that head-only metric. The figure mask is an approximate hand trace; some accessory contours also constrain authoring. Architecture is excluded from the figure-only diagnostic. These limitations are recorded with the measurements.
- Geometry masks are captured without CRT. Rendered image comparisons use the fixed CRT preset. Occluded aircraft pixels are excluded from overlap measurements.
- Facial observations must come from the actual rendered candidate. Missing points block a face-check pass; one outlier over 2% blocks a pass even if the mean is small. Approximate source annotations do not establish subpixel accuracy.
- The original coarse body trace is preserved as `reference-body-mask-v1.png`. `trace-body-reference.py` and `body-reference-trace.json` document the corrected source-only trace v2; this must not be silently regenerated from the candidate. The gold neck/collar is segmented from source colors.
- The preview offers no automatic approval button. A chat confirmation from the user is required. Even passed geometry checks never establish exact appearance.

## Integration after acceptance

Map approved closed parts to the existing structural owners where possible. Recompute bounds and supports from the approved mesh; retain stable IDs and save semantics. Use this same geometry in near/distant draws. Then verify eye glow, localized damage, head collapse, save/load, upgrade behavior, disposal, and performance in the real game, and repeat the locked-camera capture. The integration now lives in `src/render/approved-god.ts` and `src/world/approved-god.mjs`, with source-pinned binary assets in `public/assets/pineapple-god/`. The actual game captures live in `public/review/pineapple-god/game-captures/`. Final in-game visual acceptance remains pending.

## Body iteration

The accepted head is immutable during body work. Run `author-statue.py`, then `prepare-body-surface.py`, `capture.mjs`, and `build-package.py`. Re-run `trace-body-reference.py` only when intentionally correcting source annotations; it retains the earlier mask for audit. Review source overlays as well as clay views. A silhouette fit never establishes exact appearance or validates unseen surfaces.
