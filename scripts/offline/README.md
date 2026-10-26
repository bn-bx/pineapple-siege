# Offline checks

Tools for testing and previewing Pineapple Siege where `npm install` can't run:
no access to the npm registry, or a Node that can't load Vite's native bundler
(for example a Node bundled inside another app). They need only Node 22.12+ and
the existing `node_modules`. `npm test`, `npm run dev` and `npm run build`
remain the real checks whenever they work.

| Command | What it does |
| --- | --- |
| `node scripts/offline/run-tests.mjs [names…]` | Runs `tests/*.test.ts` with plain Node and a Vitest stand-in. `--compare <ref>` also runs them at another commit and lists regressions. |
| `node scripts/offline/typecheck.mjs` | `tsc --noEmit` on `src/` without Vite's ambient types. |
| `node scripts/offline/check-views.mjs --base <ref>` | Builds previews of the working tree and `<ref>`, captures eight fixed views of each in headless Chromium (needs Playwright), and writes before/after PNGs plus render stats. |
| `scripts/offline/run-local.command` | macOS double-click launcher: finds a usable Node, builds a preview and serves it at http://127.0.0.1:5173/. |
| `build-preview.mjs`, `serve.mjs` | The preview build (TypeScript emit plus import rewrites, no bundling) and a static server, used by the two above. |

The test stand-in reports PASS, FAIL or SKIP. SKIP marks Vitest features it
doesn't implement (fake timers, `vi.mock`, `vi.resetModules`, snapshots); those
tests are unverified offline. In a Linux container two `island-overhaul` hash
checks fail on unchanged code as well, so compare against a base commit before
treating them as regressions.

Software-rendered screenshots are colour-accurate but say nothing about frame
rate; performance still needs `performance.html` in a native browser.
