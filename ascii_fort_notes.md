# ASCII FORT — Notes So Far

## Overview

**ASCII FORT** is a browser-based 3D game/world created by **@thesketchit**, built in **JavaScript** and rendered with **WebGL**.

The project is notable because the visible world is rendered directly as text characters rather than by rendering a normal image first and applying an ASCII post-processing effect afterward.

The creator describes the project as a **single self-contained HTML file** stored locally on his desktop.

---

## Creator

- Handle: **@thesketchit**
- Project name visible in the footage: **ASCII FORT**
- The creator appears to share development progress through short-form social media videos.
- A public source-code repository for ASCII FORT has not yet been confirmed.

---

## Confirmed Project Details

The following details come directly from the supplied videos and transcripts.

### Single-file design

An earlier version is described as:

- One self-contained HTML file
- Approximately **273 KB**
- Approximately **6,500 lines of JavaScript**
- Uses **WebGL** for rendering

A later version is described as:

- Still one HTML file
- Slightly over **half a megabyte**

This suggests the project is intentionally built with very few or no external assets.

---

## Rendering Method

The creator explicitly says this is **not standard ASCII 3D post-processing**.

Typical ASCII rendering starts with a normal image and converts pixel brightness into characters.

ASCII FORT does something different:

- There is **no underlying rendered image**
- ASCII, ANSI, and some Unicode characters are selected directly by the renderer
- Characters are chosen according to **ray collisions**
- Character choice is influenced by:
  - hit distance
  - material type
- Light sources determine character color

The text grid is therefore effectively the final visual output of the 3D renderer rather than a filter placed over another render.

---

## Ray-based World Rendering

The creator describes the rendering process as a ray moving through the world **cell by cell, front to back**.

For each traversed map cell, the renderer asks questions such as:

- How high is the ground here?
- What object or structure exists here?
- Does the current ray intersect the terrain or an object?
- What material was hit?
- How far away was the hit?

This strongly suggests a grid-based ray traversal system.

The world appears to be organized into discrete map cells, while terrain height gives those cells vertical shape.

---

## Terrain

The world now includes:

- Mountain ranges
- Cliffs
- Large-scale elevation changes
- Valleys and lowlands
- Rivers
- Forested areas

The terrain is likely based on a heightfield or another procedural height system.

The creator specifically says the renderer asks each map cell how high the ground is, which supports the idea that terrain height is represented separately from the objects standing on it.

---

## Character Selection

Characters are not selected simply by brightness.

The creator states that:

- **Hit distance** affects the selected character
- **Material** affects the selected character
- Lighting affects the **color**, rather than being the sole driver of the glyph

This means different surfaces can have their own visual vocabulary.

Possible material categories visible or implied in the footage include:

- Grass
- Soil
- Rock
- Trees
- Wood
- Water
- Structures
- Sky or atmospheric elements

The system uses a mixture of:

- Standard ASCII
- ANSI-style characters
- Unicode characters

---

## Color

The game is not monochrome.

Characters receive color based on the lighting of the scene.

This allows the renderer to retain the text-only appearance while still representing:

- sunlight
- shadow
- terrain color
- vegetation
- water
- atmospheric depth
- reflections

---

## Lighting

The lighting system has become more physically aware over time.

The creator says terrain can block light.

This means mountains and ridges are no longer decorative background shapes; they participate in lighting calculations.

A ridge between a light source and another point in the world can cause the terrain behind it to fall into shadow.

This indicates the game uses some form of **shadow ray or visibility test** between surface points and light sources.

---

## Terrain Shadows

The later version includes terrain-cast shadows.

Confirmed behavior:

- Terrain obstructs light
- Mountain ridges cast shadows
- Ground behind an obstruction receives less light

This implies that lighting is calculated using the actual geometry or height of the world rather than with a simple screen-space darkening effect.

---

## Water

The water system changed significantly between versions.

### Earlier version

The river used a visible ripple pattern.

Characters were used to imitate the appearance of waves on the surface.

### Later version

The creator says he **stopped drawing the water** in that way.

Instead, the water now determines what should be visible by asking two questions:

1. What is above me?
2. What is underneath me?

This means water acts more like an optical surface than a decorative pattern.

---

## Water Reflection

The later water system sends a ray away from the water surface to determine what the surface reflects.

The creator describes this as a ray that **bounces off the surface**.

This allows things such as:

- Trees
- Terrain
- Sky
- Other scenery

to appear in the reflection.

The reflected result is still ultimately displayed as text characters.

---

## Water Refraction

A second ray travels downward through the water.

The creator describes this ray as bending through the water to find the riverbed.

This provides a representation of what exists beneath the surface.

The final water appearance therefore combines information from:

- reflected scenery above the surface
- refracted scenery or terrain below the surface

---

## Water Ripples

Ripples still exist, but their purpose changed.

They no longer directly draw little wave characters.

Instead, the ripples alter the direction of the reflection and refraction rays.

This causes:

- reflected trees to break apart
- reflections to distort
- the riverbed to appear to move underneath the surface

The water effect is therefore produced through ray direction changes rather than animated wave symbols alone.

---

## World Size

The later version has a substantially larger world.

The creator says that walking around the entire edge of the map takes approximately **14 minutes**.

This suggests the playable terrain is much larger than what is visible in any single clip.

---

## Font

The creator identifies the font verbally as something sounding like **“Cascadia Mona.”**

There is some uncertainty in the exact name from the narration.

A likely candidate is **Cascadia Mono**, a monospaced font from the Cascadia family, but this has not been definitively verified from the source project.

The important confirmed characteristic is that the renderer uses a consistent monospaced character grid.

---

## Browser / Runtime

Confirmed implementation details:

- Written in **JavaScript**
- Uses **WebGL** for rendering

From the footage:

- The game runs in a browser
- The file appears to be opened locally
- The project runs from a single HTML file on the creator's desktop

This reinforces the idea that the renderer, world logic, and most or all of the game data are contained directly inside the HTML file.

---

## Likely Internal World Representation

This section is inference rather than confirmed source-code knowledge.

The creator's explanation strongly suggests the world is represented as a 2D ground grid with vertical information attached to each location.

Each map location may conceptually contain information such as:

- terrain height
- terrain material
- object or structure occupying the location
- vegetation
- water state

A viewing ray moves through these cells until it collides with something visible.

This resembles techniques used in:

- grid raycasting
- DDA-style traversal
- heightfield rendering
- voxel-space terrain systems

ASCII FORT appears to combine ideas from these techniques with direct text output.

---

## Likely Rendering Pipeline

Based on the creator's explanation, a frame probably follows a process similar to this:

1. Determine the viewer's position and direction.
2. Associate each visible character cell with a ray into the world.
3. Move each ray through the world map from near to far.
4. Test terrain height and objects in each traversed map cell.
5. Stop when the ray hits visible geometry.
6. Identify the hit material.
7. Measure hit distance.
8. Choose a character based on the material and distance.
9. Calculate lighting and shadowing.
10. Assign a color to the character.
11. Output the character directly into the text display.
12. For water hits, potentially trace additional reflection and refraction rays.

This is an inferred architecture, but it matches the creator's description closely.

---

## What Makes the Project Different From Typical ASCII Graphics

The most important distinction is:

**ASCII FORT is not a normal 3D renderer converted into ASCII after the fact.**

Instead:

- character cells are part of the renderer itself
- rays determine what each character represents
- materials determine glyph choice
- distance affects glyph choice
- lighting determines color
- terrain can cast shadows
- water can launch reflection and refraction rays

The characters are therefore functioning as the renderer's visual primitives.

---

## Why the Entire Game Can Fit in One HTML File

The small file size becomes plausible if most visual complexity is generated mathematically.

The project does not appear to depend heavily on:

- texture images
- 3D model files
- large sprite sheets
- pre-rendered environments
- external level files

Instead, much of the world can be represented through:

- terrain-generation rules
- mathematical height functions
- procedural object placement
- small material definitions
- character sets
- lighting calculations
- ray traversal logic

This allows a visually large world to be produced from relatively little stored data.

---

## Confirmed Features

- Direct text-based 3D renderer
- ASCII characters
- ANSI-style characters
- Unicode characters
- Colored glyphs
- Ray-based visibility
- Grid-cell traversal
- Terrain heights
- Material-dependent characters
- Distance-dependent characters
- Procedural-looking terrain
- Mountain ranges
- Cliffs
- Forests / trees
- Rivers
- Terrain-cast shadows
- Light occlusion
- Water reflections
- Water refraction
- Ripple-driven reflection distortion
- Ripple-driven refraction distortion
- Large walkable world
- Single-file HTML distribution
- Thousands of lines of JavaScript

---

## Things We Still Do Not Know

The videos do not yet confirm:

- Whether the final character display uses HTML DOM elements, a canvas-based text pass, or another WebGL text-rendering approach
- The exact world-grid dimensions
- The exact screen character resolution
- The exact terrain-generation algorithm
- The exact ray traversal algorithm
- Whether DDA is used
- How trees and structures are represented internally
- Whether terrain is generated once or generated on demand
- How collision and player movement work
- The exact light model
- The exact reflection model
- The exact refraction model
- Whether Fresnel-style blending is used on water
- The exact font name
- Whether the source code has been published
- Whether the game has a public playable build
- Whether @thesketchit uses a different username for development repositories

---

## Best Current Description

ASCII FORT appears to be a custom browser-based **text-mode 3D ray renderer** built in **JavaScript** and rendered through **WebGL**.

Its world is organized around a terrain/map grid. Rays travel through that grid and directly decide which character belongs in each visible text cell. Materials and distance determine the glyph, while lighting determines the glyph's color.

Later versions extend the same ray system to secondary effects, including terrain shadows, water reflections, and underwater refraction.

The project remains packaged as a single HTML file despite containing a large explorable world.

---

## Source Material Used for These Notes

These notes are based on:

- Two downloaded videos from **@thesketchit**
- Visual inspection of those videos
- The supplied transcript of both videos
- Technical inference based on the creator's own description of the renderer

Where a detail is not explicitly stated by the creator, it has been labeled as an inference rather than a confirmed implementation detail.
