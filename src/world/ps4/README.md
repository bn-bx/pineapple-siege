# Frozen PS4 generator

These modules and the approved-monument manifest preserve generator revision 4 / world revision 10. Do not refactor them alongside PS5: shared PS4 seed codes must continue producing the same heights, entities, IDs, and support relationships.

The public dispatcher selects this generator and its validator for PS4 requests and stored baselines. PS5 implementation lives outside this folder. `tests/island-overhaul.test.ts` pins the complete seed-42 world and terrain SHA-256 fingerprints captured before the overhaul.
