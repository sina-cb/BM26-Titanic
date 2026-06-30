# Phase-Clock Engine — #3 Speed · #4 Tap-Tempo · #11 Chase (engine-side build)

**Date:** 2026-06-21 · **Slot:** 2 (engine port 31268) ·
**Branch:** `dev/phase_clock_engine` (local only) ·
**Spec:** `.agent/02_reports/202606/20260620_33_speed_tap_chase_design.md` ·
**Design home:** `docs/39_channels_deck_mixer.md` §6.z §F-phase

Sole engine writer this wave. UI (CaptainPad) is a SEPARATE later wave — not
touched. `engine.js` global clock left unmodified (correct as-is).

## What was built

A shared per-channel **phase clock**: each channel accumulates its OWN phase
from the engine's already-global-scaled `elapsed` DELTA, scaled by the
channel's `effectiveSpeed`. Accumulate (never re-scale a raw dt) so
absolute-time patterns never JUMP on a mid-show speed change — only the
future rate changes. `globalDt` is already global-speed-scaled by
`engine.js`; the per-channel multiply does NOT re-apply it (no double-count).
No reset on handle swap; no modulo (f64 fine for a multi-day show).

- **#3 SPEED**: per-channel `speed` (default 1.0, clamp [0.05,8]). 0/neg
  floored to 0.05 (frozen = broken; anti-silent-failure).
- **#11 CHASE**: per-channel `phaseOffsetMs` (default 0, clamp ±10000) — a
  constant added to the emitted phase. Staggered offsets → chase/ripple.
- **#4 TAP-TEMPO** (manual): global `tempoBpm` (null = unset) +
  `_tempoMultiplier = clamp(bpm/120, 0.05, 8)` (120 BPM = 1×). Affects ONLY
  `followsTempo` channels (opt-in; exterior immune unless opted). Client
  computes BPM from taps; audio-BPM is out-of-scope.

TRANSIENT, NEVER serialized: `_phaseSeconds`, `_lastPhaseElapsed`,
`_tempoMultiplier` (derived from `tempoBpm` on restore).

## Files changed (all under the worktree; engine-only)

| File | Change |
|---|---|
| `marsin_engine/lib/pattern_channel.js` | 3 fields + clamps + transients; rewrote `beginFrame(host, elapsed, force, effectiveSpeed=1)` to accumulate per-channel phase |
| `marsin_engine/lib/pattern_mixer.js` | `tempoBpm`/`_tempoMultiplier`; `_effectiveSpeed(ch)` (O(1), alloc-free); `setTempoBpm`; effectiveSpeed passed to all 3 `beginFrame` call sites (inactive deck sibling gets the deck's, ping-pong sync) |
| `marsin_engine/lib/api_server.js` | `validateSpeed` + `validatePhaseOffsetMs`; PATCH `{speed}/{phaseOffsetMs}/{followsTempo}` in BOTH channel handlers; `POST /mixer/tempo`; serialize in `serializeChannel` + inline `serializeMixerState` (+ `tempoBpm` global) + `buildChannelFromSaved` restore + boot `setTempoBpm` |
| `marsin_engine/lib/state_manager.js` | `serializeChannel` (additive after hue) + `saveMixerState` overlay copy + `tempoBpm` global |
| `marsin_engine/tests/phase_clock.test.js` (NEW) | 22 unit tests |
| `marsin_engine/tests/hil/hil_phase_clock_test.mjs` (NEW) | HIL driver, 13 checks |
| `marsin_engine/tests/state_atomicity.test.js` | additive key-order pins (2 existing shape tests extended) |
| `docs/39_channels_deck_mixer.md` | §6.z §F-phase section appended |

## API surface (contract for the follow-on UI wave)

- `PATCH /mixer/channels/:id` and `PATCH /deck/channel` accept:
  - `{ speed }` — `validateSpeed`: non-finite ⇒ **400**; finite clamped [0.05,8].
  - `{ phaseOffsetMs }` — `validatePhaseOffsetMs`: non-finite ⇒ **400**; finite clamped ±10000.
  - `{ followsTempo }` — `!!` boolean flag.
- `POST /mixer/tempo { bpm }` — finite [20,400] else **400**; `setTempoBpm`;
  `saveAllState`; broadcasts mixer state. Response
  `{ status, tempoBpm, tempoMultiplier }`.
- **No new WS message type** — `tempoBpm` rides the existing `mixer`-state
  broadcast (verified `ws_topic_routing.js` untouched).
- All 3 per-channel fields surfaced in all 4 serializers; `tempoBpm` is a
  mixer-state global. Missing fields restore to defaults (1.0 / 0 / false; null).

## Verification (exact output)

- `git diff --check -- marsin_engine docs` → **DIFF-CHECK CLEAN**.
- `node --check` on all 7 changed/new JS files → **ALL OK**.
- `node engine.js --list` → **60 pattern(s) found**.
- `node engine.js --model test_bench --pattern 01_cylon_sweep --dry-run` →
  exit **0**, "Pattern loads and compiles OK", **no missing-blend warning**.
- `node --test "tests/*.test.js"` → **1009 pass / 0 fail** (baseline 987 + 22
  new). Pre-change baseline confirmed 987/0.
- Unit (phase_clock.test.js, 22): phase accumulates monotonic; **speed change
  does NOT jump phase** (phase@0.3 == phase@0.2 + 0.1×4 = 0.6); first frame
  dt=0; negative dt floored; constant offset diff (0.5s); tempo 60→0.5× on
  followers only; non-follower unaffected; speed×tempo clamp→8;
  `setTempoBpm` rejects non-finite; `validateSpeed`/`validatePhaseOffsetMs`
  reject non-finite (400) + clamp; serialize round-trip; missing→defaults;
  `_phaseSeconds`/`_lastPhaseElapsed` NEVER serialized; orthogonality (speed
  change leaves fader/faderMax/hue untouched).

### HIL on :31268 (engine `01_cylon_sweep`, `test_bench`) — 13/13 PASS

```
✓ added overlays A=ch_..._0 B=ch_..._1 on 01_cylon_sweep
✓ #3 SPEED: 2× channel diverges faster than 1× (bSelf=3198 > aSelf=1506)   ← DIVERGENCE PROOF
✓ #3 SPEED: A vs B buffers differ at an instant (cross=2478)
✓ #11 CHASE: 0ms vs 500ms offset → staggered buffers (diff=3329)
✓ #4 POST /mixer/tempo {bpm:60} → multiplier 0.5 (tempoBpm=60)
✓ #4 serializeMixerState reports tempoBpm:60
✓ #4 TAP-TEMPO halves ONLY the follower (follower A=1391 < fixed B=2487)
✓ #4 bad bpm (string / <20 / >400 / null) → 400  (4 checks)
✓ #3 bad speed (non-numeric) → 400
✓ #11 bad phaseOffsetMs (non-numeric) → 400
```

Divergence proof: per-channel `/ws/viz` vis buffers compared via L1 distance.
The 2× channel's self-frame-diff (3198) exceeds the 1× channel's (1506);
with the tap-tempo follower at 0.5×, its advance (1391) is below the
fixed channel's (2487).

### State / port hygiene

Snapshotted `states/test_bench`, `states/summer_camp_dome`, root `config.yaml`
to `~/tmp/phase_clock_snap` before HIL; killed engine; **port 31268 FREE**;
restored all three. `states/test_bench` is **clean** (no tracked residue).
The `states/summer_camp_dome` + `simulation/.../default.yaml` modifications
and `marsin_engine/node_modules` are PRE-EXISTING worktree-setup residue
(node_modules is the gitignored symlink) — outside this slot's ownership,
NOT committed.

## Codex P0 compliance

Additive only; allocation-free hot path (`_effectiveSpeed`/accumulator);
no silent fallbacks (non-finite ⇒ 400, defaults are documented schema, not
masking); never re-applies global speed; never serializes `_phaseSeconds`;
imports top-of-file; snake_case files; offline-safe (no new deps).

## Deferrals (documented in docs/39 §6.z)

- CaptainPad SPEED/OFFSET faders + FOLLOW TEMPO toggle + TAP TEMPO button +
  `MixerChannel` type fields — the SEPARATE UI wave.
- Audio-derived BPM (auto-tap) — out-of-scope; #4 is manual tap only.
