# 2026-06-20 · Engine State Hardening (slot 2)

Branch: `dev/engine_state_hardening` · Worktree slot 2 · Engine port 31268
Scope owner files: `marsin_engine/lib/state_manager.js` + new tests only.

## Summary

Hardened `StateManager` persistence to be crash-safe and de-duplicated the
channel serialization, all backward-compatible (no exported function removed
or renamed, no existing call signature changed). Added 27 new tests (24 unit
+ 1 HIL with 7 assertions) covering atomic writes, the `serializeChannel`
helper, deck/mixer channel-split invariants, blend-script presence, and
concurrent control-storm state integrity.

## What changed (additive / backward-compatible)

1. **Atomic state writes** — `StateManager.save()` now routes through a new
   internal `_writeFileAtomic(filePath, data)` helper: write to a sibling
   `.<name>.<pid>.<n>.tmp` in the SAME directory → `fsync` → atomic
   `fs.renameSync` over the destination. A crash/throw mid-write can never
   leave a half-written/corrupt YAML on disk — the previous good file stays
   intact until the rename swaps in the fully-written one. On failure the temp
   file is unlinked and the error re-thrown (no new silent swallow; the
   existing `save()` try/catch keeps `save` non-throwing for `api_server`).
   `save()`'s signature is unchanged.

2. **`serializeChannel(ch)` de-dup helper (new export)** — flattens a
   PatternChannel into the on-disk core shape (`id, name, pattern, mode,
   fader, enabled, locked, faderLocked, localControls, playlist,
   viewSelection`). Now used by BOTH `saveDeckState` and `saveMixerState`.
   On-disk output is byte-compatible: deck file uses the core verbatim; mixer
   file preserves exact key order and layers the overlay-only
   `transitionMode`/`transitionTime` between `faderLocked` and
   `localControls`, and keeps the "never persist a live `trans_*` mode →
   coerce to `blend_screen`" rule.

No changes to `pattern_mixer.js`, `api_server.js`, `playlist_manager.js`,
`engine.js`, or any CaptainPad file.

## New tests

- `tests/state_atomicity.test.js` (14 tests) — normal save round-trips;
  no `.tmp` residue after success; a serialization failure (BigInt → yaml
  throws) does NOT corrupt the previous good file and leaks no temp; an IO
  failure (rename over a directory) re-throws and cleans the temp; rename
  fully replaces the old file; `serializeChannel` shape/key-order/boolean
  coercion/defaults; `saveDeckState` core + extras merge; `saveMixerState`
  key order + overlay fields + `trans_*` → `blend_screen` coercion.
- `tests/deck_mixer_invariants.test.js` (10 tests) — deck id never in
  `mixerChannels`; `addMixerChannel` rejects the deck id; `maxChannels` cap
  enforced (deck excluded from the count); invalid `maxChannels` → default 3;
  `removeMixerChannel`/`getMixerChannel` reject the deck id; legacy pre-split
  `mixer_state.yaml` (deck at `channels[0]`) migrates correctly via
  `loadMixerState`; migration idempotent; empty/missing file → default shape.
- `tests/blend_fallback_presence.test.js` (5 tests) — required blend /
  transition scripts exist on disk (keeps dry-run warning-free);
  `getBlendHandle` returns `null` (not a fabricated handle) for a missing
  script, and for null/empty input; the null is cached and sticky.
  NOTE: documents CURRENT behavior. `pattern_mixer.js` (owned by another
  agent) still SILENTLY lerps when `getBlendHandle` returns null, which
  violates codex P0. The test asserts only the observable null-handle
  contract (which stays true after a loud-fail fix) and carries a `TODO`
  to add a render-time loud-fail assertion once that branch lands — so it
  cannot break the concurrent branch.
- `tests/hil/hil_concurrent_entry_test.mjs` (7 assertions) — boots on
  31268, installs a deck channel via `/set-pattern` if the saved
  `deck_state.yaml` pattern is absent in this checkout (loud-fail-and-skip
  restore leaves the deck null — a valid state), fires 6 rounds of
  concurrent `POST /deck/playlist/entry` + `PATCH /mixer/channels/:id`
  bursts, then asserts: all responses are well-formed JSON; statuses are
  only 200/404/409 (no 5xx, no torn body); every 409 carries `code='EBUSY'`;
  deck id unchanged; deck settles on a requested entry; deck id never leaked
  into the mixer overlay list; all `states/test_bench/*.yaml` remain valid
  YAML. Snapshots + restores `states/test_bench/*.yaml` in `finally`.

## Verification proof

Run from `marsin_engine/` in the worktree.

```
$ git -C <worktree> diff --check -- marsin_engine
  → PASS (no whitespace/conflict markers)

$ node --check  on each changed/new file
  OK lib/state_manager.js
  OK tests/state_atomicity.test.js
  OK tests/deck_mixer_invariants.test.js
  OK tests/blend_fallback_presence.test.js
  OK tests/hil/hil_concurrent_entry_test.mjs

$ node engine.js --list
  → "60 pattern(s) found."

$ node engine.js --pattern test_const --model test_bench --dry-run
  → "🏁 Dry run complete. Pattern loads and compiles OK."  (exit 0)
  → grep for missing/blend-fail warnings: NONE

$ node --test "tests/*.test.js"
  baseline (pre-change): # tests 760  # pass 760  # fail 0
  after change:          # tests 787  # pass 787  # fail 0
  (760 + 27 new = 787, 0 fail)

HIL (engine on 31268, model test_bench):
  $ ENGINE_PORT=31268 node tests/hil/hil_concurrent_entry_test.mjs
  → 7/7 assertions passed   (HIL_EXIT=0)
    ✓ all 60 responses were well-formed JSON objects
    ✓ all responses had an expected status (200/404/409), none 5xx
    ✓ all 409 responses carry code='EBUSY'  (0 conflicts: transitions
       disabled by default → instant loads, EBUSY contract still asserted)
    ✓ deck channel id unchanged after the storm
    ✓ deck activeEntryId is one of the requested entries
    ✓ deck id never leaked into the mixer overlay stack
    ✓ all states/test_bench/*.yaml are valid YAML after the storm

State residue after HIL + engine kill:
  $ lsof -i :31268               → PORT 31268 FREED
  $ git status --short -- states/test_bench/   → CLEAN (no tracked residue)
```

Pre-boot port check (`lsof -i :31268`) showed FREE before each boot; engine
killed and port freed after the run.

## Known gaps

- **Blend loud-fail is NOT fixed here** — the silent host-side lerp fallback
  on a missing blend handle lives in `pattern_mixer.js`, owned by another
  agent. `blend_fallback_presence.test.js` documents current behavior with a
  `TODO` to assert loud-fail once that branch lands; it does not change the
  render path.
- **EBUSY path not exercised under default config** — transitions are
  disabled by default, so the concurrent storm produced 200s, not 409s. The
  test still validates the EBUSY response shape for any 409 that does occur.
  A follow-up could enable `deckTransitionConfig` before the storm to force
  in-flight EBUSY conflicts deterministically. Filed as a backlog candidate.
- **Pre-existing unrelated worktree residue** — `states/summer_camp_dome/*`
  and `simulation/scenes/summer_camp_dome/playlists/default.yaml` were dirty
  in the worktree before any of this work (mtime 12:19, predating the engine
  boots; my engine ran `--model test_bench` only). Left untouched; NOT
  staged in this branch's commits.
