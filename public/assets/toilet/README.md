# Portal toilet

"Toilet" by HippoStance (https://sketchfab.com/hippostance), CC-BY-4.0, from https://sketchfab.com/3d-models/toilet-132a8ee2af3a40d39d270fbed3d3666c. The source glTF is kept in `toilet/`.

Exported by `scripts/export-toilet.mjs`. The exporter bakes the node matrices (so the lid stays raised) and scales the model uniformly so the seat hole's short inner half-width is the 54 m portal aperture. It places the water plane at the lowest bowl height that still clears that aperture, and puts the origin at the pedestal base centre. It splits long faces and partitions each part into damage-sized owners, each at most 60 m across.

`mesh.json` describes the interleaved mesh (position, normal, uv) and one index range per owner. `src/world/toilet-manifest.json` supplies owner roles and collision bounds, the hole, water and seat heights, and the revision used in asset URLs. That way simulation workers never load the rendering data.

Owners are appended after the island's generated entities at runtime, after twelve retired slots that once held the stone ring. Island, world and save versions therefore stay unchanged. Losing any bowl or seat owner closes the portal; the tank, lid, mount and handle can be destroyed without closing it.
