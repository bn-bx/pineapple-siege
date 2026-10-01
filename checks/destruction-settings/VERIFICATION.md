# Destruction controls verification

Updated source and static dist build. Baseline world/save version remains 4; existing worlds remain compatible. New preferences migrate to Standard and survive world reset.

- TypeScript validation and production build passed.
- 30 automated simulation/render-math checks passed. The six new checks cover normalized preferences, cooldown removal and queue bounds, release-time blast profiles, amplified pending-job restoration, bedrock, higher fragment budgets, preserved module dimensions, cosmetic resizing, and rotation/position interpolation.
- 10 isolated Chrome 153.0.8010.54 browser checks passed at a 1920 × 1080 viewport. Settings persistence, reset/defaults, rapid drops, amplified pending saves, restoration before flight, debris limits and WebGL/page errors were checked.
- Visual inspection: settings.png, extreme-blast.png, aftermath.png. Higher building retention leaves more masonry in motion; trees keep their compact fallback representation.

## Short Extreme stress sample

All four sliders at Extreme, Valley-scale blast at 3× radius. This is a short functional stress check, not a ten-minute acceptance benchmark. Initial camera was fixed on the castle blast. Peak counters were sampled once per second after the initial screenshot and may miss short spikes.

- Peak sampled bodies: 1,186 / 2,048.
- Peak sampled cosmetic chunks: 3,491 / 16,384.
- Peak sampled persistent rubble: 11,439.
- Render frames: median 16.7 ms; p95 16.7 ms; worst 316.6 ms.
- Highest sampled smoothed Rapier step: 34.1 ms, above the 16.7 ms simulation tick budget.
- Simulation advanced 16.72 seconds during 22.50 wall seconds in the sampled interval. Extreme therefore does NOT maintain real-time simulation in this workload, despite smooth main-thread rendering. The existing worker catch-up cap drops time under sustained overload.
- No page or WebGL errors. Amplified world damage and unfinished work restored successfully.

## Limits and untested cases

No new Safari benchmark or physical MacBook trackpad session was performed. Quaternion interpolation is tested, but perceived flight feel still warrants user play. Sustained eight-nuke spam at Extreme was not benchmarked; the no-cooldown release test confirms eight drops and the existing queue backpressure. Raising body and fragment settings can slow simulation, and increasing permanent retention increases memory/save sizes. Three detailed clouds and 25 m bedrock remain unchanged. Fallback rubble uses approximate landing positions and compaction rather than conserving every building's exact material volume.
