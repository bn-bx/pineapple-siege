# Pineapple god — body review

**Head and body accepted; in-game review pending. integrated; awaiting user visual acceptance.**

- Head geometry and texture remain unchanged from the accepted candidate.
- Head-outline diagnostic: 98.3% (97% threshold).
- Figure-outline constraint fit: 95.6% (95% threshold; figure-only scope).
- The body uses connected anatomical forms and source-derived UV detail. The hidden cloth has a separate reconstructed atlas.

Start with [body-comparison.png](body-comparison.png), [body-before-after.png](body-before-after.png), and [body-surface-and-clay.png](body-surface-and-clay.png). Use [clay-three.png](clay-three.png) and [clay-side.png](clay-side.png) to inspect actual volume.

The original source remains unchanged. Reference contour v2 was corrected from the source image's pixel grid and is retained separately from the earlier coarse trace. The body was fitted to that trace: the overlap score is an authoring-constraint check, not independent appearance proof. Photo-projected appearance also cannot establish anatomy. Source lighting remains in the textures, and hidden surfaces are inferred.

The approved sculpt is now integrated. Actual game captures are in ../game-captures/. User acceptance of the final in-game result remains pending.

Read [review-status.json](review-status.json) for remaining checks and hashes.
