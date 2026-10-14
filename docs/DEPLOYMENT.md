# Production deployment

Production is [sweetpickledpineapple.com](https://sweetpickledpineapple.com), hosted by the Cloudflare Pages project `pineapple-siege-git`. Its Pages hostname is [pineapple-siege-git.pages.dev](https://pineapple-siege-git.pages.dev). GitHub's private `bn-bx/pineapple-siege` repository is the source; pushes to `main` trigger production builds.

## Build and release

Cloudflare uses Node 22, `npm run build`, repository root, and output directory `dist`. The build generates terrain parts, hashes audio, checks TypeScript, builds Vite, and verifies runtime assets. There are no Pages Functions or runtime secrets. `public/_headers` makes hashed assets immutable and HTML/world manifests revalidate.

```sh
npm ci
npm test
npm run build
git add <changed-files>
git commit -m "Describe the change"
git push origin main
```

The checkout's local Git SSH configuration selects a repository-scoped write deploy key. Use your own authorized GitHub access on another machine; credentials belong outside the repository. Cloudflare's GitHub App connection is independent of local SSH access.

A push confirms GitHub receipt. Verify the new release on the production domain after Pages finishes building: `/release.json` must contain the intended release, the game must reach Ready and start, and `/world.json` plus every listed terrain part must return successfully. The Pages dashboard exposes build status and logs.

## Saves and recovery

Browser saves are scoped to the site origin. Keep the production domain unchanged to preserve players' IndexedDB progress; Pages preview URLs and localhost use separate storage. Do not include generated world files, `dist`, credentials, or local Cloudflare state in Git.

A failed build leaves the last successful production deployment live. Fix the build and push a new commit. For a bad release, roll back through Cloudflare Pages or revert the commit and push; then verify the domain. A dashboard rollback does not change Git history.

## Current release

`pineapple-god-awakening-2026-10-13` adds a giant destructible pineapple god to each new PS4 island, red eye flashes after ground monster kills, and permanent monster rage after figure damage. Enraged monsters pursue the current player position at 21 m/s, with a 1.68-second attack cooldown and 750 m horizontal attack range. Rage persists through death and save/reload. Existing PS4 islands receive the reaction behavior without regeneration.

The generator is PS4, world version 10, save compatibility 10, and preference revision 5. Earlier PS3 layouts use the existing incompatible-save flow rather than migrating destruction onto the new statue layout. Crash-camera state, fuel droplets, and aircraft wrecks are transient; destruction, statue rage, and fire hazards continue through the existing save system.

The preceding larger-islands release expanded new islands to 9,216 m across with varied landscapes, busier settlements, paged GPU terrain textures, predictive streaming, and map waypoints. See [larger-island verification](LARGER_ISLANDS_QA.md) for those checks and performance measurements.
