# Procedural island verification

Verified on October 4, 2026: **145 tests pass**, TypeScript checks pass, and the production build succeeds. Disposable Chrome browser flow and viewpoint checks finish with no browser errors. Additional simulation checks destroy harbor, lighthouse, and coastal-ruin assemblies plus all three tree species, then restore their saved damage and tree identities successfully.

The release uses world/save version 8 and generator revision 1. The reference island is `PS1-0000A301`; browser checks also exercise seeds 0, 1, and 42. Generator checks cover seeds 0, 1, 42, 2026, and 4294967295, plus exact reproduction of the exported reference baseline.

## Automated checks

Run `npm test` and `npm run build`. Tests generate the procedural reference and a separate, ignored version-7 fixture. Historical flight, weapons, destruction, and renderer regressions retain their original geometry, while island tests exercise the new shared generator and elevated water.

Island checks cover terrain bounds, land fraction, peaks, required sites and population, supported bridge decks, fortress gate approaches, structure budgets and support connections, safe resident and monster placement, seed/link parsing, exact baseline reproduction, species geometry, species preservation in falling and settled wreckage, local damage restoration, and dry laser channels.

With Vite running on port 5177 and Node Playwright available:

```sh
node scripts/check-island-browser.mjs
ISLAND_CODE=PS1-0000002A node scripts/check-island-views.mjs
```

Set `PLAYWRIGHT_MODULE` to a module path when Playwright is installed outside this project. Set `CHROME_PATH` for another Chrome installation and `ISLAND_URL` for another local server address. These scripts use disposable browser contexts and leave the player's existing storage untouched.

The browser flow checks initial/shared preview acceptance, copying links, damage reload, reroll and stale generation results, cancellation, malformed codes, atomic replacement transaction failure, successful replacement, same-island reset, incoming-link cancellation, mobile preview, generation failure, storage-disabled play and replacement, and protected legacy-save recovery. The view script captures coast, lighthouse, river, forest, mountain, and smaller-castle viewpoints for a selected seed.

## Performance

`npm run benchmark:world` measures fixed-step simulation with 120 and 400 monsters. To compare the historical world after generating its fixture:

```sh
WORLD_FIXTURE=tests/fixtures/legacy-world node scripts/benchmark-world.mjs
```

`npm run benchmark:destruction` exercises the existing destruction stress cases. Run timing checks separately from browser rendering and other tests. These measure CPU simulation costs; headless screenshots and browser checks do not establish hardware GPU frame rates.

Recorded simulation timings on the development machine, in milliseconds:

| World             | Monsters | Flight mean / p95 | Siege mean / p95 |
| ----------------- | -------: | ----------------: | ---------------: |
| Original valley   |      120 |       3.74 / 4.73 |      7.06 / 9.18 |
| Procedural island |      120 |       4.89 / 5.98 |    11.05 / 15.17 |
| Original valley   |      400 |       4.49 / 6.29 |      7.37 / 9.46 |
| Procedural island |      400 |       6.91 / 9.22 |     9.22 / 11.96 |

The larger island content costs more CPU, while these ordinary flight/siege cases remain within a 16.67 ms simulation-step budget at p95. Extreme destruction stress still exceeds that budget: 8,192 bodies measure 17.31 ms mean / 20.00 ms p95, and the high-cap castle-collapse case measures 30.66 ms mean / 44.53 ms p95. Normal gameplay retains the existing Standard limit of 256 active physics bodies.

## Persistence boundaries

The stored pristine manifest and heightfield are replaced in the same IndexedDB transaction that deletes the former damage record. Preview and cancellation do not write a candidate. Damage saves include generator revision and seed; settings use a separate record. Recovery and temporary play preserve incompatible saved data. Shared links contain original island identity, never player damage or population progress.
