# Cloudflare deployment verification

Verified on 2026-09-28 UTC (2026-09-27 America/Chicago).

## Routing

- Pineapple Hoops: https://hoops.sweetpickledpineapple.com
- Hoops Pages project: `sweet-pickled-pineapple`; original deployment preserved.
- Pineapple Siege: https://sweetpickledpineapple.com
- Siege Pages project: `pineapple-siege`, production branch `main`.
- Siege deployment: `56e588ce-4e79-4c03-8794-7cb4968a2f99`.
- Siege deployment address: https://56e588ce.pineapple-siege.pages.dev

The domain spelling was confirmed by the user before the migration.

## Checks

- Baseline world regenerated from current source.
- TypeScript compilation passed.
- Vite production build passed.
- Existing Vitest suite: 6 files, 36 tests passed.
- Hoops verified in Chrome at its new hostname; basketball scene and controls rendered.
- Siege verified in Chrome at its Pages address and at the apex.
- Apex reached Ready; Start launched the game, with the aircraft, terrain, castle, HUD, and World saved status visible.
- Game paused after verification.
- Apex CNAME targets `pineapple-siege.pages.dev`.
- Hoops CNAME targets `sweet-pickled-pineapple.pages.dev`.

Cloudflare briefly returned 522 while new domain bindings propagated. Both games were verified working before completion. API tokens were supplied only to deployment processes and are absent from these records and Wrangler logs.

## Records

- `migration-before.json`: original routing and Hoops deployment details.
- `cutover.json`: apex reassignment and Siege deployment identity.
- `migration-after.json`: final Cloudflare domain and DNS state.
- `deployed-assets.json`: sizes and SHA-256 hashes of the uploaded build.

Redeployment instructions are in the project README.
