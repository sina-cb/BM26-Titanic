# _120 — Wave 1 W1-1 follow-up: L5 strict save-now

**Thread:** the W1-1 (`_116`) fix-7 **handoff** — the last piece of red-team
`_115` **L5** ("a failed state write returns 200 `{saved:true}`"). W1-1 fixed the
in-lane halves (timeline-state writes throw; the `POST /settings/save-now`
handler was wrapped in try/catch) but left the ROOT in `lib/state_manager.js`, a
shared engine core **outside** W1-1's exclusive 3-file lane. Operator explicitly
ordered this follow-up (2026-07-31).

**Scope owned (exclusive):** `marsin_engine/lib/state_manager.js` (the `save()`
wrapper + the `saveMixerState`/`saveDeckState`/`saveGlobalsState` signatures) and
the `POST /settings/save-now` **call site** in `marsin_engine/lib/api_server.js`
(via the `saveAllState` / `saveGlobals` closures). The W1-1 WS handler + process
backstops were left INTACT and built on. Untouched: `engine.js`, `timeline/*`,
`pattern_mixer.js`, `scenes/**`, `patterns/**`, `simulation/`.

---

## Root cause (confirmed)

`StateManager.save(filename, state)` (`state_manager.js` ~line 121) wrapped its
atomic write in a try/catch that only `console.warn`ed and **swallowed** the
error:

```js
save(filename, state) {
  try { this._writeFileAtomic(filePath, yaml.dump(state)); }
  catch (e) { console.warn(`Failed to save state to ${filename}:`, e); }  // SWALLOW
}
```

`_writeFileAtomic` itself re-throws correctly (temp+fsync+rename, cleans temp on
failure) — only the public `save()` wrapper swallowed. Consequence:
`POST /settings/save-now` persists deck/mixer/globals via
`saveAllState()` → `saveMixerState`/`saveDeckState` and `saveGlobals()` →
`saveGlobalsState`, all funnelling into `save()`. A disk-full/EBUSY write was
swallowed, the handler's try/catch never saw a throw, and the endpoint returned
`200 {saved:true}` → the CaptainPad **"✓ SAVED" badge lied** (red-team `_115`
L5). The timeline-state path was already honest (W1-1: `saveTimelineState`
throws, and the save-now handler try/catch was already present). What remained
was ONLY the deck/mixer/globals path.

**Hard constraint (operator):** the ~80 AUTO-SAVE triggers (`saveAllState` from
render-adjacent paths) MUST stay **best-effort** — making `save()` throw for them
would let a transient disk blip during auto-save hit W1-1's process-level
`exit(1)` backstop and crash the engine (dark ship).

---

## The fix — a STRICT / BEST-EFFORT split at the save seam

Minimal, fail-loud, and additive. `save()` grows an options bag; the default is
the **unchanged** warn-only swallow, and the strict flag is threaded ONLY to the
explicit operator save.

**`state_manager.js`:**
- `save(filename, state, { strict = false } = {})` — on write failure, `if
  (strict) throw e; else console.warn(...)`. Default = pre-existing behaviour,
  byte-for-byte.
- `saveMixerState(mixer, { strict = false } = {})` → `save('mixer_state.yaml',
  state, { strict })`.
- `saveDeckState(mixer, extras = null, { strict = false } = {})` →
  `save('deck_state.yaml', state, { strict })`.
- `saveGlobalsState(globalsState, paramCenter, { strict = false } = {})` →
  `save('globals_state.yaml', out, { strict })`.

**`api_server.js`:**
- `saveAllState(strict = false)` threads `{ strict }` into `saveMixerState` +
  `saveDeckState`.
- `saveGlobals(withParams = false, strict = false)` threads `{ strict }` into
  `saveGlobalsState`.
- `POST /settings/save-now` now calls `saveAllState(true)` + `saveGlobals(true,
  true)`. Its try/catch (already present from W1-1) now catches a REAL throw and
  returns the honest `500 {status:'error', saved:false, error}`.

Every one of the ~80 auto-save call sites still calls `saveAllState()` /
`saveGlobals(...)` with no strict arg → default `false` → best-effort. Their
behaviour is **byte-unchanged**.

## Auto-save is unchanged

Explicitly verified: the split is a default-argument addition. The existing
`tests/state/state_atomicity.test.js` invariant *"a failed write is swallowed by
design (api_server depends on a non-throwing save)"* still passes untouched, and
the new unit test asserts `saveMixerState`/`saveDeckState`/`saveGlobalsState`
(and `save()` itself) do **not** throw over a broken dir when called without
`strict`. No auto-save trigger can crash the engine on a transient write failure.

## The save-now honest-error proof

The e2e drives a REAL `engine.js` subprocess (black-holed config; state
redirected to a temp dir; **timeline disabled** so the only writers into the
broken dir are the deck/mixer/globals paths under test) and, over the SAME
broken state dir, proves BOTH halves:

1. an AUTO-SAVE trigger — `POST /global-blackout` → `saveGlobals(false)`
   (best-effort) — answers **200** and the engine stays alive (`GET /status` ok);
2. the EXPLICIT save — `POST /settings/save-now` → strict — returns a **non-200**
   `{saved:false, error}`, and the engine is still alive afterward (the handler
   caught it; no `ENGINE FATAL` reached the W1-1 backstop).

To force the write failure the test replaces the live state dir with a FILE (the
operator's suggested method), so every atomic write fails at `openSync`
(ENOTDIR). A healthy save-now `200 {saved:true}` is asserted first as a sanity
gate.

## Tests (new, both GREEN)

- `tests/state/strict_save.test.js` — 7 deterministic unit tests pinning the
  strict/best-effort seam directly on `StateManager` (dir-replaced-by-a-file):
  `save()` default swallows / `strict:true` throws; the three save methods
  default best-effort (never throw) and each throw under `strict:true`; and
  `strict:true` produces **byte-identical** output to the best-effort save on a
  healthy dir (the happy path is unchanged).
- `tests/e2e/save_now_honesty_e2e.test.js` — 1 real-engine e2e (above). Imports
  `tests/helpers/setup_config_guard.mjs`; reuses the timeline e2e harness's
  black-hole config + dir-redirect exports; random high port (7500–7649).

## Gates

- **Full engine suite: 2524 tests / 8 fail.** The 8 are the SAME known
  environmental baseline — audio-capture framing ×2, OSC-listener
  lifecycle/EADDRINUSE ×4, `effects_v2_mode_page_layout` ×1, specialty/themed
  playlist parity ×1. **None import `state_manager.js` or touch a save path;
  zero new failures.** My 8 new tests all pass.
- `marsin_engine/config.yaml` CLEAN vs HEAD.
- Every spawned engine black-holed via `MARSIN_CONFIG_FILE`; state redirected via
  `MARSIN_STATE_DIR` (never the tracked tree, never `--dest`, never the
  operator's stack/:6967). Zero device HTTP, zero sACN to hardware. No git ops.

## Files

Source (owned): `marsin_engine/lib/state_manager.js`,
`marsin_engine/lib/api_server.js`.
Tests (new): `marsin_engine/tests/state/strict_save.test.js`,
`marsin_engine/tests/e2e/save_now_honesty_e2e.test.js`.
