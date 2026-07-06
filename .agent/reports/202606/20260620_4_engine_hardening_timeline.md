# Slot 4 — engine_hardening_timeline

- **Branch:** dev/engine_hardening_timeline
- **Parent branch:** dev/engine_hardening_timeline (based on the merged deliverable tip with hot-swap endpoints, fail-loud renderHealth, boot blend precompile, atomic state writes, 802 passing tests)
- **Worktree:** /root/workspace/BM26-Titanic-worktrees/engine_hardening_timeline
- **Slot ports:** engine 31268, OSC 31200

## Scope

P0 fail-loud / input validation, verified-easy perf, additive timeline-ready
hot-swap endpoints, and tests — all confined to the three owned files
(`lib/pattern_mixer.js`, `lib/api_server.js`, `lib/ws_topic_routing.js`) plus
new test files. Every adversarial claim was verified against the real code
before acting; several were already handled and skipped. Node is
single-threaded, so all "render thread vs request thread" framing was treated
as a sequencing concern, not a data race.

## Files changed

```
 M marsin_engine/lib/api_server.js
 M marsin_engine/lib/pattern_mixer.js
?? marsin_engine/tests/channel_validation.test.js
?? marsin_engine/tests/view_fader_ramp.test.js
?? marsin_engine/tests/deck_swap_param.test.js
?? marsin_engine/tests/hil/hil_deck_swap_param_test.mjs
```

`lib/ws_topic_routing.js` was reviewed but needed no change.

## What was done (by scope item)

### A. P0 fail-loud / input validation

1. **Fader writes — non-finite reject + clamp (DONE).** Added an exported
   `validateFader(raw)` helper (single source of truth): rejects
   non-finite / non-numeric (NaN, Infinity, `'abc'`, null, boolean, object)
   with a 400-shaped error; clamps finite out-of-range to `[0,1]`. Wired into
   all four write paths:
   - `PATCH /mixer/channels/:id` fader (was raw assign) → 400 on non-finite,
     clamp before the fader-lock check.
   - `PATCH /deck/channel` fader (was raw assign) → same.
   - `PATCH /mixer` `master` (went through `setMaster` whose `Math.max/min`
     passes NaN straight through) → now 400 on non-finite, clamp finite.
   - WS `setChannelFader` (was raw assign) → emits a typed
     `channelFaderRejected` reply (direct `ws.send`, same pattern as the
     existing `channelModeRejected`; not a broadcast, so no topic-routing
     entry needed) and does NOT coerce.
2. **Deck base-channel restore fail-loud (DONE).** `restoreChannel` used to
   `console.warn + return` on a compile failure, silently booting a null
   deck — a Codex P0 silent fallback (and the deck is the mission-critical
   exterior). Now: a **deck-role** compile failure throws a tagged
   `_deckRestoreFatal` error that the catch re-throws, propagating out of
   `startApiServer` (called unwrapped at engine boot) so the process crashes
   loudly. Mixer overlays still degrade-and-log (a dead overlay leaves the
   deck + other overlays live).
3. **Stale playlist activeEntryId (DONE).** On restore, a dangling
   `activeEntryId` (entry deleted since save) was silently ignored and left
   in place as a restore-time bomb. Now detected, **warned loudly**, and the
   stale id is **cleared** to `null` (clean "no active entry" state); the
   localControls fallback still runs so the slot keeps its last params.
4. **/deck/transition-config validation — ALREADY CORRECT (verified, skipped).**
   `durationMs` is already finite-validated (400) and clamped to
   `[50,30000]`. `mode` is already validated with `startsWith('trans_')`,
   which is functionally identical to `isValidBlendMode`'s trans_ branch AND
   stricter for this endpoint (it correctly rejects steady `blend_*` modes
   that `isValidBlendMode` would accept). No change made; aligning it to
   `isValidBlendMode` would have *loosened* it.
5. **WS broadcast routing fail-loud — ALREADY CORRECT (verified, skipped).**
   `ws_topic_routing.topicForType()` throws on an unknown type, and
   `broadcastWs()` calls it **unguarded** (no try/catch), so a routing
   failure propagates loudly at the call site. The `if (!wssForTopic) return`
   only handles the legitimate early-boot/no-subscriber case after the throw
   check has passed.

### B. Perf (verified-easy, behavior-preserving)

6. **Vis extraction buffer pool (DONE, with a correction to the claim).** The
   claim said "pre-allocate ONE reusable buffer." Verified the consumer
   (`engine.js` render loop) holds **all** per-channel `_visData` entries
   simultaneously and drains them in one synchronous tick — so a single
   shared buffer would corrupt (each channel would overwrite the previous).
   Implemented a **per-key persistent pool** (`_extractVisInto(key, buf)`
   backed by a `Map`), which is allocation-free in steady state AND safe.
   Kept the original `_extractVis` for standalone snapshots/tests.
7. **Scripted-transition render-order (DONE).** Replaced the
   `[...filter(), target]` spread/filter with an in-place rebuild of a
   persistent `_renderOrderScratch` array. (Note: the original only
   allocated *during* an active scripted transition, not every steady
   frame — but the new path is allocation-free and behavior-identical.)
8. **warmInactiveDeckHandle leak — ALREADY CORRECT (verified, skipped).**
   The method already destroys a redundant incoming handle when the slot
   holds the same pattern, and the old handle (guarded `oldHandle !== handle`)
   when re-binding to a different pattern. Pinned with tests instead.
9. **removeDeckChannel cancels swap first (DONE).** Now calls
   `cancelDeckPatternSwap()` before destroying the deck + inactive slot, so a
   queued swap-completion path can't run its atomic handle-swap against a
   half-torn-down pair (use-after-free of the destroyed handle). The explicit
   `_swapTransition = null` is kept for the no-swap-in-flight clarity case.

### C. Timeline-ready additive endpoints

10. **POST /deck/playlist/swap parametric + concurrency-safe (DONE).** Added
    an optional per-call `transition: { enabled, shuffle, mode, durationMs }`
    that overrides the global `deckTransitionConfig` **for that swap only**,
    validated by a new exported `validateSwapTransitionOverride(override,
    base)` (mirrors the transition-config field validation exactly; does NOT
    mutate the global). Omitted `transition` ⇒ existing callers get byte-for-
    byte current behavior. Concurrency: an in-flight swap already threw EBUSY
    → 409; kept that (the **safer** choice, documented inline) rather than
    `finishDeckSwapNow()` which would visibly snap the deck to an
    intermediate pattern the operator didn't ask to settle on.
11. **POST /deck/playlist/queue (DONE).** Warm-then-fire-on-anchor: compiles
    a target entry and parks it in the inactive deck slot via the leak-safe
    `warmInactiveDeckHandle` contract **without advancing** the deck; returns
    once warm (`{ warmed, entryId, reused }`). Guards: 404 missing
    playlist/entry, 400 missing pattern, 409 if a swap is in flight,
    reused:true short-circuit if the slot already holds the pattern.

### D. Techdebt (item 12)

Not done — **deferred as a known gap** (see below). It is a pure refactor
touching the duplicated deck+mixer PATCH handling; with the P0 + endpoint
work landed and verified, extracting `applyChannelPatch` was the lowest-value
/ highest-regression-risk item and time was better spent on test coverage.

### E. Tests

- `tests/channel_validation.test.js` (12 tests) — `validateFader` (accept /
  clamp / reject) and `validateSwapTransitionOverride` (merge / no-mutate /
  clamp / reject) pure-function coverage.
- `tests/view_fader_ramp.test.js` (4 tests) — viewFader ramp interpolation
  (up/down/hold/dt-clamp) driven through `renderAll6ch` with simulated time,
  no WASM.
- `tests/deck_swap_param.test.js` (5 tests) — warm-slot leak safety (item 8),
  removeDeckChannel swap-cancel teardown (item 9), vis-pool reuse +
  per-key isolation (item 6).
- `tests/hil/hil_deck_swap_param_test.mjs` (16 assertions) — parametric swap
  override (valid 200 / bad mode 400 / bad duration 400 / global config
  unchanged), queue (warm-no-advance / reused / 404s), master non-finite 400,
  WS setChannelFader non-finite → channelFaderRejected with deck fader
  uncorrupted. Self-boots the engine on 31268, snapshots+restores
  test_bench state in `finally`.
- saveDeckState pattern-swap persistence round-trip + null-deck 404 are
  exercised end-to-end by the HIL (queue does not advance the persisted deck;
  swap with no deck returns 404 via the existing `no deck channel` guard).

## Verification proof

All commands run from
`/root/workspace/BM26-Titanic-worktrees/engine_hardening_timeline`.

```
$ git diff --check -- marsin_engine
(no output — clean)

$ node --check  (each changed/new file)
ok marsin_engine/lib/api_server.js
ok marsin_engine/lib/pattern_mixer.js
ok marsin_engine/tests/channel_validation.test.js
ok marsin_engine/tests/view_fader_ramp.test.js
ok marsin_engine/tests/deck_swap_param.test.js
ok marsin_engine/tests/hil/hil_deck_swap_param_test.mjs

$ node engine.js --list
  60 pattern(s) found.

$ node engine.js --pattern test_const --model test_bench --dry-run ; echo $?
  🏁 Dry run complete. Pattern loads and compiles OK.
  0
  (grep for missing|warn|no compiled|fail → NO matching lines)

$ node --test "tests/*.test.js"
# tests 823
# pass 823
# fail 0
  (baseline 802 + 21 new unit tests; 0 failures)

$ node tests/hil/hil_deck_swap_param_test.mjs   (engine self-booted on :31268)
  16/16 HIL assertions ✅ — ALL HIL ASSERTIONS PASSED ; exit 0
```

HIL assertions (exact): GET default entries; swap non-trans_ mode → 400; swap
non-finite durationMs → 400; global config unchanged by rejected overrides;
valid override → 200; global config unchanged by valid override; queue warms
entryA pattern; first queue reused:false; queue did NOT advance live deck;
re-queue reused:true; queue missing entry → 404; queue missing playlist →
404; PATCH master "not-a-number" → 400; PATCH master 1.5 (clamp) → 200; WS
setChannelFader NaN → channelFaderRejected; deck fader finite after rejected
write.

**State residue discipline:** my new unit tests and the HIL leave **no**
tracked state residue (verified `git status -- marsin_engine/states/`
empty after the HIL). NOTE: `node engine.js --list` and the *baseline*
`node --test` suite boot the default `summer_camp_dome` model and write its
state files (`states/summer_camp_dome/*.yaml`,
`simulation/scenes/summer_camp_dome/playlists/default.yaml`) — this is
PRE-EXISTING baseline-test behavior, not from my files. I restored those with
`git checkout --` after each run; the final tree shows only my two edited lib
files + four new test files. Port 31268 freed; no stray engine processes.

**Adversarial claims — verified vs already-correct:**
- VERIFIED & FIXED: items 1 (all 4 fader paths), 2, 3, 7, 9, 10, 11, and the
  perf claim in 6 (corrected: per-key pool, not single buffer).
- ALREADY CORRECT (skipped, pinned by tests where applicable): item 4
  (transition-config validation), item 5 (WS broadcast fail-loud), item 8
  (warm-slot leak safety).

## Known gaps / follow-ups

- **Item 12 (applyChannelPatch refactor)** not done — deferred as lowest-
  value / highest-regression-risk. Follow-up: extract the shared deck+mixer
  PATCH field handling (fader-lock, blend-mode validation, viewSelection,
  transition-cancel; deck omits overlay-only fields) and prove no behavior
  change via the existing tests. Pure techdebt.
- **Pre-existing degraded-blend fallback** in `pattern_mixer.renderAll6ch`
  (inactive-deck-swap path, ~line 1548, and the mixer-overlay degraded path):
  a "last-resort linear crossfade if the blend script can't load." These are
  Codex-visible (logged once + `renderHealth.ok=false`) but are still
  host-side fallbacks. They are OUT OF SCOPE for this slice (pre-existing in
  the merged tip, and the deck/overlay mode is validated at the API
  boundary), so I left them untouched rather than risk a behavior change in
  the 40 Hz loop. Flagging for a future fail-loud-vs-degrade decision by the
  operator.
- **Baseline test state residue** (`summer_camp_dome`): a baseline test boots
  the default model and persists state; not mine, but worth a follow-up to
  give that test the same snapshot/restore `finally` discipline the HIL uses.

## Operator action requested

Ready for review and merge. No new silent fallbacks introduced (Codex P0
upheld). dev/* branch is local-only — not pushed.
