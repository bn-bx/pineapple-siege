# Pineapple god

A textured throne model supplied by the project owner (a trimesh-exported GLB with baseColor and metallicRoughness WebP textures). The source is kept in `pineapple-god/source.glb`.

Exported by `scripts/export-pineapple-god.mjs`. The exporter scales the model uniformly by 1030 (about 1025 m tall, 838 m wide). It puts the stair base at local y −6 and the throne back at local z −230, so it stands on the existing mountain terrace. It keeps the source normals, UVs and textures, and splits faces longer than 30 m.

Triangles are given roles by source-space regions: the two eyelid shells are the reactive eyes; then stairs, throne, and figure (body, crown and scepter). Each role is shared among the legacy owner ordinals of that role (figure 318, throne 299, stairs 196, eye 2), co-partitioned along the longest axis so neighbouring patches keep neighbouring IDs. Entity IDs, island, world and save versions are unchanged. Saved removed IDs remove the patches now mapped to them.

`mesh.json` describes the interleaved mesh (position, normal, uv): one batch with one index range per owner. `src/world/approved-god-manifest.json` supplies the revision, owner roles, collision bounds and foundation flags, so simulation workers never load rendering data. Only owners touching the stair base are foundations. A new revision makes `applyApprovedGod` refit cached monuments in place.

`scripts/export-god-solid.mjs` (run by the exporter) fills the model with 5 m voxels in the same local frame: surface voxels take the owner of the triangle crossing them, outside air is flood-filled around a surface thickened by five voxels and peeled back (sealing the hidden gap where the figure meets the throne), and enclosed voxels take their nearest surface owner. `solid.json` records the mesh revision; a mismatched fill is ignored and breaks stay hollow. Broken owners expose generic stone, and debris pieces carry their own stone core.

In hell, the figure and eye owners give way to the existing aircraft effigy; the throne and stairs are drawn untextured in dark stone.

The previous sculpt pipeline (`scripts/review/`, `public/review/pineapple-god/`) no longer feeds the game.
