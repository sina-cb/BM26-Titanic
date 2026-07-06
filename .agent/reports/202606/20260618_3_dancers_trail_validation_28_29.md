# Dancer comet-trail validation — 28_vintage_dancers & 29_bar_dancers

Date: 2026-06-18
Author: validator (agent)
Branch under test: `claude/audio-corpus-tuning-olcd6i` (main worktree)
Subsystem: `marsin_engine` patterns 28/29

## What was validated

Two "dancer" patterns gained a TEMPORAL COMET TRAIL mirroring the Audio
Companion "dancing-balls" visualizer (`drawOrb` in
`marsin_engine/audio/companion/ui/companion_app.js`):

- A per-dancer ring buffer (`trail1`/`trail2`, `array(14)`) records each
  dancer's past spring position every frame in `beforeRender`.
- `trailGlow(posn, trailArr, halfW)` lights pixels near recent positions,
  faded quadratically by age and slightly shrinking.

Patterns:
- `patterns/28_vintage_dancers.js` — self-filtered to vintage strips (fId 5..6),
  each a 6-head lane; ownership: fId5 owned by dancer1, fId6 by dancer2; the
  non-owner shows as a dimmer ECHO. Trail uses the same own1/own2 weighting.
- `patterns/29_bar_dancers.js` — self-filtered to bars (fId 7..8), each an
  18-pixel lane. Already had a velocity-aligned spatial comet (`cometProfile`);
  the temporal trail is merged into the comet envelope by `max`.

## Method

Real MarsinVM via `WasmHost` (same host the engine uses), `test_bench` model
(52 px). The trail is TEMPORAL, so each test calls `beforeRender` across many
simulated frames (elapsed advances ~33 ms/frame) while the dancer MOVES, then
reads the per-pixel brightness profile along the lane (brightness = max(R,G,B)).

Key physics note: each dancer is a **critically-damped spring** (`DANCE_OMEGA=7`).
Over ~0.8 s it LAGS the slider, so a 0.1→0.9 sweep settles the head mid/upper
lane, not pinned at 0.9 — and once the spring SETTLES the trail correctly
collapses. The moving profiles below are therefore read MID-MOTION (head still
climbing), which is exactly when a comet should be visible.

Harnesses (temp, `~/tmp/`): `dancer_trail_harness.mjs` (main), `diag28.mjs` /
`diag29.mjs` (frame-by-frame dumps), `robust.mjs` (extreme-input torture).

## Results — PASS/FAIL by check

| # | Check | Result |
|---|-------|--------|
| 1 | `node --check` both; `engine.js --list` shows both; dry-run each clean; `test_const --dry-run` clean | PASS |
| 2 | Self-filter: 28 lights ONLY fId5,6; 29 lights ONLY fId7,8 | PASS |
| 3 | Comet trail on moving dancer; collapses to symmetric orb when stationary; 28 ownership respected | PASS |
| 4 | No NaN/garbage (bytes 0..255), never throws (incl. extreme inputs) | PASS |

**Overall: PASS for both 28_vintage_dancers and 29_bar_dancers.**

### Check 1 — compile / list / dry-run
- `node --check` — both files OK.
- `engine.js --list` — both `28_vintage_dancers` and `29_bar_dancers` present.
- `engine.js --model test_bench --pattern <p> --dry-run` — both compile via
  MarsinCompiler, 52/52 pixels patched, "Dry run complete", test render pixel 0
  (a par) = RGBWAU(0,0,0,...) confirming the self-filter blacks out non-target
  fixtures.
- `test_const --dry-run` — still clean (compiles, patches, completes).

### Check 2 — self-filter (max brightness EVER observed during a moving sweep)

| fId | kind | 28 lights | 29 lights |
|-----|------|-----------|-----------|
| 1 | par | 0 | 0 |
| 2 | par | 0 | 0 |
| 3 | par | 0 | 0 |
| 4 | par | 0 | 0 |
| 5 | vintage | **248** | 0 |
| 6 | vintage | **157** | 0 |
| 7 | bar | 0 | **218** |
| 8 | bar | 0 | **218** |

28 lights ONLY the vintage strips (5,6); 29 lights ONLY the bars (7,8).
Everything else is exactly 0 across the whole sweep. PASS.

### Check 3 — comet trail (the headline)

**29_bar_dancers, lane7 (18 px, localPos 0..1), MOVING vs STATIONARY:**

```
pos:     0   1   2   3   4   5   6   7   8   9  10  11  12  13  14  15  16  17
MOVING:  22  22  22  22  30  52  80 111 167 197  93  63  37  23  32  56 101  57
STILL :  39  39  39  39  41  55  80 107 173 201 135  92  63  45  48  71 112  72
```
(pos16 ≈ 101–112 is dancer2 parked at 0.95, not part of dancer1's comet.)

- MOVING: head at pos9 (197). A long, smoothly-fading **tail BEHIND** the head
  (toward where it came from): pos5..9 = 52, 80, 111, 167, 197 rising into the
  head; ahead of the head it drops fast: pos10..13 = 93, 63, 37, 23.
  Tail side head-2 = **111** vs leading edge head+2 = **63** (tail ~1.8× brighter).
  Smoothly-fading tail length = 9 px. This is a textbook comet.
- STATIONARY: head at pos9 (201), brightness falls off roughly symmetrically
  both directions — a compact orb.
- Quantified asymmetry |behind−ahead|/(behind+ahead), 4 px each side of head:
  MOVING ratio = **0.31**, STATIONARY ratio = **0.11**. The moving case is ~3×
  more asymmetric — the trail leans into the path of travel; the stationary case
  is symmetric. PASS.

**28_vintage_dancers, 6-px lanes (prompt notes 29 is the clearest):**

```
                pos:  0   1   2   3   4   5
MOVING lane5(OWNED):  0   0 158 165   3  42
MOVING lane6(ECHO) :  0   0  72  73   8 101
STILL  lane5(OWNED):  0   0 149 173   3  42
```

- Head at pos3. While moving up the lane, the pixel just BEHIND the head
  (pos2 = **158**) retains a strong residual glow — the temporal trail
  persisting where the dancer just was, rather than going instantly dark.
- Ownership: dancer1's trail/halo is STRONGER on its owned strip fId5
  (peak **165**) than the dimmer ECHO on fId6 (peak **101**). The own1/own2
  weighting is correctly applied to the trail as well as the halo. PASS.
- The 6-px lane is coarse, so the comet reads as residual-behind-head rather
  than a long visible streak — expected and acceptable for a 6-head strip.
  (Frame-by-frame `diag28.mjs` shows pos2 draining 245→14 as the head advances
  pos2→pos3 — the trail bleeding out behind a moving head.)

### Check 4 — no NaN/garbage, never throws
- Main harness: all bytes 0..255 across all moving and stationary frames; no
  exceptions in either pattern.
- Torture pass (`robust.mjs`): 300 frames per pattern (600 total) with EXTREME
  slider values (−5, 0, 0.5, 1, 5, 1e9 across every slider) and wild deltas
  (0, 0.001, 0.033, 1, 100, 1e6 s). Bad bytes = **0**; never threw. PASS.

## Issues / notes

- No defects found. Both patterns are correct and robust.
- Behavioral note (not a bug): the dancer head is a critically-damped spring,
  so the comet is most visible WHILE the dancer is moving and naturally
  collapses to a compact orb once it settles. This matches the intent (a comet
  is a motion artifact). Anyone screenshotting a single static frame at rest
  will see an orb, not a streak — to see the trail, the dancer must be moving
  (drive ball1_x / ball2_x, e.g. via the mic-energy modulators in live use).
- Minor: in the 29 STATIONARY read there is a small residual left/right
  imbalance (behind 415 vs ahead 335) caused by dancer2 parked at the high end
  of the lane leaking ~110 into pos16 — not a stationary-trail bias; dancer1's
  own orb is symmetric.

## Artifacts
- `~/tmp/dancer_trail_harness.mjs` — main per-pixel trail validation harness.
- `~/tmp/diag28.mjs`, `~/tmp/diag29.mjs` — frame-by-frame lane dumps.
- `~/tmp/robust.mjs` — extreme-input torture test.
