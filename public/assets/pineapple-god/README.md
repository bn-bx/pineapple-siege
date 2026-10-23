# Approved pineapple god

Exported by `scripts/review/export-game-statue.mjs` from the visually accepted review sculpt. The exporter checks its recorded SHA256 and mesh revision before writing anything. It retains the approved surface, normals, UVs and textures. Long planar faces are split without changing their shape. Uniform world scale is 0.9, with local Y offset 15.5 to match the existing monument height.

`mesh.json` describes the interleaved binary mesh and 815 stable owner ordinals. `src/world/approved-god-manifest.json` supplies collision bounds and role metadata without loading rendering data into simulation workers. The binary SHA256 is the integration revision, used in asset URLs and cached-baseline upgrades. Existing entity IDs, save version and seed remain unchanged. Saved removed IDs remove their mapped triangles on load.

The game uses one mesh at all viewing distances: 11 geometry batches, 15 material draw groups including two eye ranges. Removing an owner edits index ranges, also removing its shadows and depth. Geometry bounds generate conservative world-axis collision boxes. Foundation boxes extend into terrain. Detached decorations use nearest structural hosts in the regenerated contact graph. The existing hell aircraft effigy remains; its throne and stairs use the approved surfaces.

The source photographs contain baked lighting. Hidden anatomy is reconstructed. Final in-game visual acceptance remains with the user.
