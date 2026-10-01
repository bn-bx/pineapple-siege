# Space Laser Controls verification

## Checks

- TypeScript checking and production build pass. All 53 automated tests pass.
- 17 isolated Chrome browser checks pass with no browser errors.
- Preferences persist across reload; Reset settings restores defaults without changing an active strike.
- Default, minimum, and maximum brightness reviewed in daylight and darkness, plus Reduced effects. Maximum beam and completed empty terrain reviewed separately. Mobile controls fit at 390 px.
- Pause and photo mode freeze strike age; reset removes strikes.
- Automated coverage includes old version-5 strikes/work without profiles, mixed-size/depth overlap, independent queued completion, saved pending cleanup, shallower strikes preserving deeper terrain, scaled plane collisions, and 60 No cooldown launches at both default and maximum size.
- A corner maximum strike clears the entire terrain/water grid; the real generated world test removes all 11,916 entities and leaves all 1,050,625 samples dry. Reload retains the crater and empty world.

## Browser stress

Chrome headless at 1920 × 1080, normal effects, brightness 100%, depth 500 m, maximum size. Four seconds of baseline, one center strike, then twelve independent overlapping corner strikes (three per corner). Duplicate excavation targets coalesce. See `report.json` for exact settings, samples, and browser version.

| Measure | Result |
| --- | --- |
| Median frame interval, all phases | 16.7 ms |
| p95 frame interval, overlap | 16.8 ms |
| Worst frame interval | 16.8 ms |
| Peak active/finishing strikes | 13 |
| Peak queued jobs | 1,117 |
| Peak reported destruction work | 1.7 ms |
| Peak main-thread JS heap | 101.6 MiB |
| Completed save estimate | 12.1 MiB |
| Remaining strikes/work/ruins | 0 / 0 / 0 |

The heap measurement excludes worker and GPU memory. Save size is terrain/dry typed-array bytes plus serialized metadata, not IndexedDB storage overhead. Headless compositor frame intervals describe this local run, not a guarantee for other devices.

Huge strikes retain a finishing state while queued terrain/static cleanup drains after the five-second beam; their dry footprint and debris suppression remain active during that cleanup. The complete stress run took 31.2 wall seconds. The world/save version remains 5.
