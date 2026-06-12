# Post-event cleanup PR for P2/P3 nits

- **ID:** 006
- **Priority:** LOW
- **Status:** OPEN
- **Source:** .agent/02_reports/202605/20260527_1_code_review.md
  (§P2 Findings, §P3 / Nits)
- **Location:** see report sections for individual file:line refs
- **Created:** 2026-05-27
- **Updated:** 2026-05-27

## Description
Rollup of the report's P2 and P3 items into one deferred cleanup pass.
Not re-described here — cite the report for full context.

P2 items:

- `global.wss` / `global.wssByTopic` side-channel between `engine.js`
  and `api_server.js`.
- `CaptainPad/components/audio/AudioChainsCard.tsx` at 2327 lines.
- `marsin_engine/lib/api_server.js` at 3300+ lines.
- `marsin_engine/lib/pattern_mixer.js` at ~1900 lines spanning deck
  swap, transitions, view selection, blend handles, and channel
  lifecycle in one class.
- `reachableUrls` silently drops link-local and tunnel interfaces (add
  a `--reachable-include-tunnels` debug flag).
- `fetchPatternCode(name)` URL-injects `name` without
  `encodeURIComponent` (CaptainPad/utils/api.ts:432).
- `/save-pattern` arbitrary-JS write + WASM compile (combined with
  task 001 this is unauthenticated arbitrary code write; not unique to
  this branch).
- `mixer.maxChannels` default divergence: `config.yaml` says 4, the
  `PatternMixer` constructor defaults to 3 — document the source of
  truth.

P3 / nits:

- Inconsistent `console.warn` format (`(error: ' + e.message + ')`
  style); unify for log greps.
- `validateViewSelection` handles `null` and `undefined` identically;
  add a unit test if not covered.
- `--force-osc-port` parsed via `process.argv.includes(...)` in
  engine.js rather than `parseEngineFlags` — asymmetric with other
  audio CLI flags.
- `engineBus.ts` `AppState.addEventListener` subscription is never
  removed (harmless under singleton, leaks if `createBus` is called
  multiple times in tests).
- `modulation_engine.applyContinuousModulation` bipolar scale uses
  `max(abs(min), abs(max))` — loses asymmetry on ranges like
  `[-0.1, +0.5]`. Add a comment confirming intent or fix.
- `--force-osc-port` not surfaced in any `--help` output.

## Suggested fix
One cleanup PR after the camp. Do not bundle with feature work. Each
nit is independently trivial; the value is in landing them together
rather than as scattered drive-by edits.

## Why it matters
None of these will take down the rig live, but the file-size and
side-channel concerns directly attack handoff — nobody but the original
author will be able to debug `api_server.js`, `pattern_mixer.js`, or
`AudioChainsCard.tsx` mid-show today.

## Notes
Deferred until after the summer camp event. Re-prioritize once the
event is over.
