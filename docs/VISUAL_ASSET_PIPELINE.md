# Pineapple Siege visual asset pipeline

Runtime assets are local; playing the game never requests Poly Haven, OpenGameArt or a decoder CDN. Physics, generation, entity IDs, support graphs and the packed worker protocol retain their existing authority. Detail models and scenery are presentation data.

## Editable sources and provenance

- `art/models/siege-library.blend`: Blender 4.5 authored source. The corresponding uncompressed GLB is kept alongside it.
- `scripts/author-visual-assets.py`: deterministic model authoring and GLB export. Coordinates convert game Y-up into Blender Z-up and back through the glTF exporter. Existing normalized gameplay envelopes are applied by the renderer, not taken from these meshes for collision.
- `art/materials/`: original 1K scanned color, OpenGL normal and packed ambient-occlusion/roughness/metalness maps, API metadata and `provenance.json` with source MD5, runtime SHA-256, licenses and source pages.
- `art/foliage/`: original scanned atlas images, cropped RGBA branch/grass images, baked impostors and provenance.
- `art/audio/`: downloaded recordings and provenance. Runtime mixes are bounded mono samples and loops. Jet recording attribution is CC-BY-3.0; the other selected recordings are CC0. See packaged credits.

## Rebuild

Use Blender 4.5 LTS, KTX Software 4.4 and the Node version required by package.json. Downloads are explicit authoring operations, not part of ordinary installation or builds.

1. Run `blender --background --python scripts/author-visual-assets.py`.
2. Run `npm run assets:compress` to deduplicate, quantize and Meshopt-compress the GLB. Keep all UV attributes: flat Blender source materials do not consume UVs, but runtime scanned materials do. Pruning those attributes produces broken foliage and materials.
3. Run `python scripts/fetch-visual-assets.py --toktx /path/to/toktx` to verify and convert original scanned surfaces to mipmapped UASTC KTX2.
4. Run `python scripts/fetch-foliage-assets.py --toktx /path/to/toktx`. Pine crop masks exclude the neighboring cone atlas and retain the central twig.
5. Run `blender --background --python scripts/bake-tree-impostors.py`, then `python scripts/compress-tree-impostors.py --toktx /path/to/toktx`.
6. Run `python scripts/fetch-audio-assets.py` when rebuilding recordings. The script records transformations and attribution; inspect its platform audio conversion dependency before running elsewhere.
7. Run `npm run assets:verify`, `npm test`, and `npm run build`. Inspect the resulting assets in both supported browsers.

## Runtime contracts

`src/render/visual-assets.ts` declares the typed resource manifest, surface families, three named detail levels, authored bounds, animation source and destruction ownership. Runtime AABBs are captured after glTF transforms. Quantized positions and normals are converted before baking metre transforms, avoiding normalized attribute clamping.

`Scenery` attaches decorations to existing entity IDs. Spatial cells bound proximity work. Removal hides their decorations; terrain resampling suppresses vegetation in excavated or underwater positions. Grass never exceeds 120 metres.

`quality-profile.ts` controls resolution, foliage range, detail, shadows, reflections, AO, bloom, antialiasing, heat distortion and cosmetic density. Auto starts with the Balanced 900p profile; fast reductions and slow recovery use the existing quality controller. Fixed user preference values remain compatible.

`Presentation` keeps scene rendering in linear HDR and applies one final output/tone mapping pass. SSAO buffers are half resolution; bloom is restrained. Depth of field is enabled only in photo mode. Disabled optional passes relinquish their render targets. Resource estimates include local asset textures, post-processing, the ocean reflection target, scheduled shadows and the environment map; these are estimates, not driver memory telemetry.

World-scale construction mapping avoids stretched stone/timber/roof surfaces on long gameplay modules. Terrain blends scanned ground and cliff surfaces from canonical vertex data; cliffs use triplanar rock projection. Fracture UV channels retain exposed-cut semantics.

High/Ultra terrain normals follow grass/soil world UVs and all three cliff projections, using derivative tangent frames in view space. Other profiles retain geometric normals. Banners sample the shared linen scan; their attached top edge stays fixed while a shared simulation clock drives GPU cloth and shadow motion. Distant residents merge authored lowest-detail head, torso and limb meshes into one instanced silhouette, retaining the near model's metre proportions.

## Asset failures

Asset load failures retain playable procedural fallbacks and surface a notice. A release asset check must report all manifest families and the aircraft loaded and no failures. These fallbacks are recovery paths and do not satisfy the final-art acceptance requirement.

## Validation caveat

This pipeline and shared production coverage do not, by themselves, approve the art direction or certify a finished release. The entire visual-state checklist and measured release gates in the implementation plan remain mandatory.

## Shared particle artwork

The locally archived Kenney Smoke particles pack is CC0; its original license is `art/particles/source/license.txt`. `scripts/pack-particle-assets.py --toktx /path/to/toktx` packs 25 white-puff variations into a 1280-square UASTC KTX2 atlas with transparent gutters and no cross-cell mip chain. `art/particles/provenance.json` records every source hash and the runtime hash. Runtime artwork is hosted at `/assets/particles/puff-atlas.ktx2` and verified by `npm run assets:verify`.

The variations cross-fade as fixed-pool impact plumes expand, rotate and drift; they are not described as a captured smoke simulation. Material tint follows existing fragment events. Wall plumes retain the hit elevation, terrain plumes resample authoritative ground, and water plumes begin at the water impact elevation (clamped to the ocean surface for submerged strikes). Nuke billboards share this atlas and retain the three-cloud cap.

High/Ultra can render a separate half-size opaque depth target for soft particle intersections. The same auxiliary material preserves alpha-tested foliage, shader wind, GPU debris motion and the authoritative wet mask. Auto Balanced/Performance/Recovery disables this extra depth render. Its allocations contribute to the existing render-target budget. Photo depth remains limited to photo mode.

Arched glazing and voussoir surrounds are authored as `window_lod0/1/2` and `arch-trim_lod0/1/2` in the shared Blender library. Window geometry follows the existing transform; decoration faces and village overlays retain their current owner IDs. `art/models/provenance.json` records the editable source, author script, export and compressed runtime hashes. Asset verification rejects changed runtime geometry and non-positive signed volumes on the new closed models, catching inward winding before shipment.

Leaf displacement uses a shared simulation-time uniform in beauty and shadow materials. Falling canopies compose the same displacement with packed-pose interpolation; settled canopies reuse the species depth material. Prewarming includes the actual settled canopy and fractured-material shadow variants as well as airborne roof layouts. These remain presentation changes with no independent saved identities.

Coastal terrain now uses Poly Haven Coast Sand 01 (Rob Tuytel, CC0, https://polyhaven.com/a/coast_sand_01), hosted locally as 1K color, OpenGL normal and packed occlusion/roughness maps. The acquisition script records original checksums and runtime SHA-256 hashes. There are now nine scanned surface families and 27 runtime maps. Its authored coverage is 15 meters per repeat. Terrain combines world-space projections with height and slope rock/scree blending, shoreline sand and subdued moisture response; high quality enables scanned roughness and occlusion, while lower Auto states avoid those extra samples. Full river-margin proximity and detailed road blending remain open.

Standing foliage uses shared species materials in three per-instance distance bands. Near and middle meshes share matrix/color attributes; distant impostors retain the same authoritative entity index mapping. Their main-camera distance uniforms also drive shadow, reflection, auxiliary depth and optional eyes. Coarse batch spheres conservatively gate scene membership; they do not select a whole batch's artwork detail. During shader preparation all bands are forced visible, then restored in the preparation cleanup. Falling crowns use generic species wind materials independently of standing-tree bands. Edit all species detail levels and rebake their impostors together when changing crown silhouettes.

The pine crown revision authors irregular radial shoot layers with open branch gaps, replacing the former continuous conical distribution. Near/middle/far card counts are 384/128/32; broadleaf and riverside retain 550/170/32. Rebuild with `author-visual-assets.py`, compress with `compress-visual-assets.mjs`, render all matching tree impostors with `bake-tree-impostors.py`, and compress them with `compress-tree-impostors.py`. The editable Blender source, GLB export/runtime and hash provenance were refreshed together. Native scale/appearance and final family approval remain separate from successful export verification.

## Current source and distant island presentation

The model library now includes three grass-clump levels with point colors exported through a vertex-color material. Resident heads preserve authored hair colors in near and merged distant meshes. Blender source export recalculates outward normals; the verifier checks signed volume for closed families to reject inward surfaces. Aircraft fins and control surfaces use closed panels. Broadleaf/riverside crowns use separate branch-end clusters; impostor baking includes a matching tapered trunk.

Grass surface maps now use [Leafy Grass](https://polyhaven.com/a/leafy_grass), Charlotte Baglioni, CC0, at its 2m scale. The acquisition script reuses cached files only when their recorded source asset matches the requested asset. Updated maps and foliage are requested with the typed manifest revision.

`IslandHorizon` derives complete-island distant silhouettes from existing owners and spatial coverage bounds. It shares surface/image resources, uses inexpensive global instance batches, excludes nearby covered batches in the vertex shader, casts no detailed shadows, and preserves owner-linked destruction and reset/save restoration. Its depth presentation uses the same coverage hook. Whole-island visibility remains independent of the nearby detail preference; fog is disabled by explicit user instruction.

### Working entrance modules

The normalized `door` family has three authored levels in the shared Blender library: six beveled planks with battens and a brace nearby, four planks in the middle source level, and a closed simplified panel at the lowest source level. Runtime entrance dressing fits the nearby leaf to the generated doorway, opens it beyond 90 degrees so it remains outside the passage, and retains the existing hinge-wall ID as owner. Frames on opposite sides have separate owners; the header follows the existing upper wall. Thresholds use the established resampled ground-piece rules. No new save entities or collision bodies are introduced. Current runtime dressing is restricted to the existing nearby scenery range; the other authored levels remain available for subsequent distance refinement. The model-library URL is version 9, preventing reuse of the earlier immutable model response.

Pine card widths now compensate for the tall crown instance transform. Upright cards use 0.23 of the original normalized vertical width, and twig half-width is 0.32 of shoot length, avoiding vertical curtain-like scans. Card counts remain 384/128/32. Matching impostors were rebaked from the source and recompressed with refreshed provenance; models and foliage use manifest version 9.

### October 6 construction and character batch

Manifest revision 10 adds three levels of stone coping, resident hands and resident boots. The library now contains 18 three-level families plus five aircraft meshes (59 mesh nodes). The jet's static metal details and dark details are merged by material; canopy and two ailerons remain separate. The source retains cockpit seating, pilot helmet and canopy hoops. The canopy uses a transparent, non-depth-writing material.

Normalize positions, normals **and UVs** to Float32 before merging imported character geometry. Newly authored hands/boots and compressed body parts can otherwise have incompatible attribute storage even though their semantic UV values match. Native loading exposed this mismatch; the import conversion resolves it.

`art/materials/pineapple-skin-v1.png` is custom artwork created with the built-in image generator, not a scanned CC0 photograph. Its prompt, source hash and runtime hash are recorded in `pineapple-skin-v1.provenance.json`. The 1K locally hosted KTX2 is shared by monster bodies, distant bodies and weapon fruit, with procedural relief retained. Compress with `toktx --t2 --encode uastc --uastc_quality 2 --zcmp 9 --genmipmap --resize 1024x1024 public/assets/materials/pineapple-skin-v1.ktx2 art/materials/pineapple-skin-v1.png`. Asset verification checks both hashes. A replacement world's loader rebinds the shared template texture; unavailable textures select the existing recovery surface.

Near resident hands/boots follow the same snapshot arm/leg transforms. Clothing/skin colors are assigned by stable resident ID after visibility compaction. The merged distant silhouette uses a cloth mask to avoid tinting skin and footwear with clothing colors. This retains the existing pose system rather than claiming a newly authored skeletal animation library.
