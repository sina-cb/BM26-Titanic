# Slot 0 — engine_hotswap_mixer

- **Branch:** dev/engine_hotswap_mixer
- **Parent branch:** claude/bm26-channels-optimization-9ok9d3 (main checkout HEAD ada12f0)
- **Worktree:** /root/workspace/BM26-Titanic-worktrees/engine_hotswap_mixer
- **Slot ports:** engine API 31068, OSC 31000

## Scope

Hardened the marsin_engine render/blend/playlist path against silent fallbacks
(Codex P0), moved blend compilation off the 40 Hz hot path to a boot-time
precompile, centralized blend-mode + transition-config validation, and added
the flagship hot-swap playlist endpoints (`/deck/playlist/swap` and the mixer
equivalent) plus a precompile-next-entry optimization for smooth sequential
playback. Files touched were limited to the three owned engine modules
(`lib/pattern_mixer.js`, `lib/api_server.js`, `lib/playlist_manager.js`) plus
new test files. Engine boot wiring for the blend precompile lives INSIDE
`pattern_mixer.js` (a `patternsDir` setter), not in `engine.js`.

## What changed (by scope item)

### 1. Codex P0 fail-loud (highest priority)
- **pattern_mixer.js render hot path** (was ~1436): the blend-compile-miss
  branch no longer silently lerps. It records a render-health error
  (`_recordBlendError`) so `/status.renderHealth.ok` flips to `false`, logs
  loudly ONCE per mode (not per frame), and still composites via host-side
  linear interp so the 40 Hz loop never crashes. Visible-not-silent.
- **pattern_mixer.js `_compileBlend`** (was ~1527): the single catch-all
  try/catch that swallowed both "missing script" and "compile error" into
  `null` was split into specific, loud reasons (NOT FOUND vs read error vs
  compile FAILED). `getBlendHandle`/`precompileBlend` now record the failure
  in render-health instead of caching a silent `null`.
- **api_server.js viewSelection**: the unknown-`viewSelection.type` path was
  already gated by `validateViewSelection` → 400 at every write site
  (PATCH /mixer/channels, PATCH /deck/channel, POST /mixer/channels). Verified
  no remaining silent-null mask write path exists; the residual silent
  treat-as-ALL branch lives only in the defensive mask compiler, behind that
  400 gate. No new code needed beyond confirming the gate; the mask compiler
  comment already documents it.
- **playlist_manager.js `load()`** (was ~119): malformed YAML no longer returns
  `null` (which masqueraded as "missing"). It now throws a structured
  `PlaylistLoadError` (`.code === 'PLAYLIST_MALFORMED'`) so HTTP callers 4xx.
  A genuinely-missing file still returns `null` (not an error). Added
  `tryLoad()` — a lenient wrapper used ONLY by the can't-crash internal paths
  (boot restore, /save-pattern re-apply) that logs loudly then degrades to null.

Tests assert these fail loudly: `tests/blend_precompile.test.js`,
`tests/playlist_malformed_loud.test.js`, and the HIL `/status.renderHealth`
+ transition-config 400 checks.

### 2. Blend precompile at boot
- `pattern_mixer.js` now exposes `patternsDir` as a getter/setter. The single
  `mixer.patternsDir = .../patterns` assignment in engine.js (unchanged) drives
  `precompileAllBlends()`, which scans `channel_blends/` + `transitions/` and
  warms every handle before the first frame. Lazy compile is removed from the
  hot path (still available as a fallback for runtime-introduced modes, which
  are now flagged in render-health). Dry-run confirms all 19 blend scripts
  compile at boot with NO missing-blend warning.

### 3. API symmetry + validation
- `POST /mixer/channels/:id/playlist/entry` already existed (verified); no
  duplicate added.
- Centralized blend-mode validation into module-scope `VALID_CHANNEL_BLEND_MODES`
  + `isValidBlendMode()` (exported), consumed by PATCH /mixer/channels/:id,
  PATCH /deck/channel, and WS `setChannelMode`. Invalid modes now 400 (HTTP) /
  `channelModeRejected` (WS) instead of being handed silently to the mixer.
- `/deck/transition-config`: `durationMs` now rejects non-finite (NaN/'abc')
  with 400 instead of `Number(x)||1000` silently coercing to 1000s; `mode`
  must be a `trans_*` name (400 otherwise). Finite values are still clamped to
  50..30000.

### 4. Hot-swap playlist (flagship)
- `POST /deck/playlist/swap { name, entryId? }` — loads a DIFFERENT playlist
  and transitions to its first (or specified) entry via the existing deck
  transition machinery (`loadPlaylistEntryWithTransition`). Additive, explicit.
- `POST /mixer/channels/:id/playlist/swap { name, entryId? }` — mixer-overlay
  mirror (instant load, matching the overlay entry-advance semantics).
- **Precompile-next-entry**: `precompileNextDeckEntry()` predicts the next
  sequential entry after a deck load and warm-installs its handle into the
  mixer's inactive deck slot (`mixer.warmInactiveDeckHandle()`), so the next
  advance reuses a warm handle (zero-compile). Guarded to ACTIVE SEQUENTIAL
  autopilot only, so manual ping-pong warmth is preserved. Never throws.

## Files changed

```
git diff --name-status ada12f0..(working tree) -- marsin_engine
 M marsin_engine/lib/api_server.js        (+280/-? )
 M marsin_engine/lib/pattern_mixer.js     (+269/-? )
 M marsin_engine/lib/playlist_manager.js  (+66/-?  )
?? marsin_engine/tests/blend_mode_validation.test.js
?? marsin_engine/tests/blend_precompile.test.js
?? marsin_engine/tests/playlist_malformed_loud.test.js
?? marsin_engine/tests/hil/hil_playlist_hotswap_test.mjs
(581 insertions, 34 deletions across the 3 lib files)
```

## Tests run

- Unit (new): blend_precompile (6), blend_mode_validation (4),
  playlist_malformed_loud (6) — all pass.
- Integration / HIL: `tests/hil/hil_playlist_hotswap_test.mjs` against engine
  on port 31068 — 17/17 assertions pass.
- Sim smoke: n/a (engine-only slice).
- CaptainPad: n/a (no CaptainPad files touched).

## Verification proof

All commands run from `marsin_engine/` in the worktree.

```
$ git -C <worktree> diff --check -- marsin_engine
  (no output — clean, no whitespace errors)

$ node --check {pattern_mixer,api_server,playlist_manager}.js
  + the 3 new .test.js + the new .mjs HIL
  → OK on all 7 files

$ node engine.js --list
  → 60 pattern(s) found.

$ node engine.js --pattern test_const --model test_bench --dry-run
  → [Mixer] Compiled blend script: blend_add / blend_over / blend_screen
    + all 16 trans_* scripts (19 total) compiled at BOOT
  → 🏁 Dry run complete. Pattern loads and compiles OK.   exit 0
  → NO missing-blend warning

$ node --test "tests/*.test.js"
  → # tests 774   # pass 774   # fail 0
  (baseline was 760/0; +14 new = 774, 0 fail)

HIL: boot engine on 31068, poll /status (ready in 1 s), run HIL, kill, restore.
$ ENGINE_BASE=http://127.0.0.1:31068 node tests/hil/hil_playlist_hotswap_test.mjs
  → Result: 17/17 assertions passed   exit 0
```

What the HIL asserted (against the live engine on 31068):
- B1/B2: `GET /status` exposes `renderHealth { ok, blendErrors[] }`; with all
  blends precompiled at boot, `renderHealth.ok === true`, `blendErrors` empty.
- A1: `PATCH /deck/channel { mode: 'not_a_blend' }` → 400 (fail loud).
- A2: `POST /deck/transition-config { durationMs: 'abc' }` → 400 (NaN, no
  silent clamp).
- A3: `POST /deck/transition-config { mode: 'blend_screen' }` → 400 (a steady
  blend is not a valid transition mode).
- A4: a fully-valid transition-config → 200 (didn't break the happy path).
- C0–C2: `/deck/playlist/swap` lands the deck on a DIFFERENT playlist's first
  usable entry (no entryId) and on a specified entry (with entryId); the deck's
  active playlist name + entry id update correctly.
- C3/C3b: swap to a missing playlist → 404; swap with no name → 400.
- C4: `/mixer/channels/:id/playlist/swap` mirrors the deck behavior on an
  overlay and lands on the specified entry's pattern.

### State hygiene
- The HIL snapshots `states/test_bench/{deck,mixer,globals}_state.yaml` AND the
  scene playlists dir, restores them in `finally`, and deletes the playlists it
  created. After the run: `git status -- marsin_engine/states/test_bench/` and
  the scene `playlists/` dir are CLEAN (no tracked residue). deck_state.yaml is
  byte-identical to the committed version.
- Temporary edits made and REVERTED before commit: `config.yaml osc.port`
  10000→31000→10000 (verified `git status -- config.yaml` empty).

## Known gaps / follow-ups

- **Full handle pooling** (scope item 4) is NOT done — shipped the safe subset:
  the swap endpoints + the precompile-next-entry warm-handle optimization. A
  larger warm-handle POOL (keep N entries warm, LRU-evict) is the documented
  follow-up; it needs careful WASM-handle lifecycle accounting to stay
  leak-free and is too large to make safe within this slice.
- **precompile-next-entry is sequential-autopilot only** by design (manual taps
  rely on the existing ping-pong warm-keeper; shuffle is unpredictable so
  skipped). Broadening to shuffle would need a deterministic shuffle cursor.
- **Pre-existing repo residue (NOT mine):** the committed
  `states/test_bench/deck_state.yaml` references a deleted pattern
  (`29_bar_dancers`), so a fresh boot leaves the deck channel null until a
  playlist is loaded; the HIL works around this by booting with a clean deck
  state. Separately, `states/summer_camp_dome/*.yaml` and
  `simulation/scenes/summer_camp_dome/playlists/default.yaml` show as modified
  in the worktree — these are pre-existing (I only ever booted the test_bench
  model) and were left untouched / NOT committed.

## Operator action requested

Ready for review and merge. One question for triage: the committed
`states/test_bench/deck_state.yaml` points at a missing pattern
(`29_bar_dancers`) — worth a small follow-up to repoint it at a live pattern so
fresh boots restore a deck channel without manual intervention.
