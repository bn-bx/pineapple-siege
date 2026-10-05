# Permanent wreckage cleanup

Wreckage and defeated pineapple monsters move normally for six simulation seconds, freeze their final pose, then shrink away over one second. Blast wreckage and defeated monsters use visual trajectories without native bodies or colliders. Settling and reblasting preserve the original seven-second deadline. Early landings retain a temporary visual pose without permanent rubble colliders.

Cleanup always applies; there is no settings checkbox. Old saves' accumulated rubble clears incrementally, up to 128 records per tick with a 0.5 ms slice target. Defeated monster identities remain defeated on reload. Display shrinking does not alter authoritative or saved dimensions.

GPU interpolation uses matching rendered dimensions for both snapshots of tree trunks and canopies, preventing size pulses during flight and shrinking. Color and shadow shaders share interpolation.

# Nuke craters

Crater radii are local 52.5 m, castle 105 m, and valley 240 m (50% wider than the earlier release). Depths are now 24, 40, and 50 m, respectively, double the previous depths. Ordinary terrain's bedrock allowance is 50 m so excavation and restored saves retain the deeper craters. Exposed terrain uses a darker mottled charcoal treatment shared by near and distant meshes.

Lifecycle regressions cover bounded visual motion, shrinking packets, unscaled save capture, defeated monsters across reloads, permanent cleanup after settings changes, and deadlines across reblasting. Rendering regressions check both trunk and canopy interpolation dimensions without requiring WebGL.
