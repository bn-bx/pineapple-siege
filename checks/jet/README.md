# Browser verification scripts

Start the production preview (`npm run build && npm run preview -- --port 4173`). The scripts use the locally installed Google Chrome and Playwright available on the test host. They are development checks, not part of the static deployment.

```sh
node checks/jet/functional.cjs
node checks/jet/failures.cjs
node checks/jet/endurance.cjs
node checks/jet/presentation.cjs
```

`GAME_URL` overrides the preview address in the functional and endurance scripts. `endurance.cjs` defaults to a ten-minute run; `RUN_SECONDS` allows a shorter diagnostic pass. Run performance scripts one at a time, with other 3D tabs closed and the Mac unlocked. Reports include errors and timing values; screenshots provide visual evidence.

The `#debug` URL enables controlled inspection hooks. Ordinary users cannot access those hooks without explicitly selecting debug mode. These hooks are local diagnostics, not a network authority or security boundary.

`VERIFICATION.md` distinguishes completed checks, baseline measurements, and remaining browser/performance limitations. `baseline-endurance-report.json` belongs to the pre-optimization build. The latest `endurance-report.json` belongs to the stitched-terrain/heightfield build, before the final forced-tree-settlement pose correction.
