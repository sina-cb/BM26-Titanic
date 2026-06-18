# Dancer comet-trail validation — patterns 26 & 27

Date: 2026-06-18
Author: validator (agent)
Branch validated: `claude/audio-corpus-tuning-olcd6i` (main worktree
`C:/Users/sina_/workspace/BM26-Titanic`)
Scope: validate the new TEMPORAL COMET TRAIL added to
`marsin_engine/patterns/26_dom_dancers_chevron.js` and
`marsin_engine/patterns/27_par_dancers.js`. No source files were modified.

Method: drove the REAL MarsinVM (`marsin_engine/lib/wasm_host.js`, same host
the engine uses) over the 52-pixel `test_bench` model. The trail is temporal,
so each test calls `beforeRender`/`renderAll6ch` across many simulated ~33 ms
frames while a dancer MOVES, then inspects per-pixel brightness
(`max(r,g,b)`). Harness: `C:/Users/sina_/tmp/dancers_trail_harness.mjs`
(+ diagnostics `dancers_diag*.mjs`, `trail_collapse.mjs`).

## Overall result

| Pattern | Result |
|---|---|
| 26_dom_dancers_chevron | **PASS** |
| 27_par_dancers | **PASS** |

## Check 1 — static / load / dry-run — PASS

- `node --check patterns/26_dom_dancers_chevron.js` → OK
- `node --check patterns/27_par_dancers.js` → OK
- `node engine.js --list` shows both `26_dom_dancers_chevron` and `27_par_dancers`.
- `node engine.js --model test_bench --pattern 26_dom_dancers_chevron --dry-run` → "Pattern loads and compiles OK".
- `node engine.js --model test_bench --pattern 27_par_dancers --dry-run` → "Pattern loads and compiles OK".
- `node engine.js --model test_bench --pattern test_const --dry-run` → still clean ("Pattern loads and compiles OK").

## Check 2 — self-filter (27) / not-all-black (26) — PASS

27_par_dancers, sweeping both dancers across the row, max brightness ever
observed per fixtureId:

| fId | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
|---|---|---|---|---|---|---|---|---|
| max bri | 38 | 172 | 244 | 38 | **0** | **0** | **0** | **0** |

- fId 5,6 (vintage) and fId 7,8 (bars) stay 0 across the entire sweep — the
  P0 self-filter holds. All four pars (fId 1..4) light somewhere. PASS.

26_dom_dancers_chevron lights the whole rig (max brightness 249, not
all-black) and never throws. PASS.

## Check 3 — comet trail (headline) — PASS

### 26 (whole rig): brightness by spatial band (nx), moving vs stationary

Dancer-1 swept left→right (nx 0.05→0.95), dancer-2 quiet and parked at the
end; vs. dancer-1 held at the end the whole time. `baseGlow` zeroed so the
trail reads cleanly. Head sits in the 0.80–0.95 band.

| band (nx) | MOVING | STATIONARY |
|---|---|---|
| 0.80–0.95 (head) | 249 | 251 |
| 0.55–0.80 | **228** | 122 |
| 0.30–0.55 | 119 | 119 |
| 0.05–0.30 | 84 | 84 |

- The band immediately BEHIND the head (0.55–0.80) is far brighter when moving
  (228) than stationary (122): a comet trail the stationary dancer does not
  leave. Brightness fades with distance behind the head (228 → 119 → 84).
- Lit bar-pixel count: moving = 24, stationary = 17 — the moving dancer
  stretches the lit footprint (comet stretch). PASS.

### 27 (4 pars): per-par brightness, dancer moving fId4→fId1

Dancer-1 moved left (fId4) → right (fId1); short settle so the spring lands on
fId1 while the trail ring is still fresh. Per-par `[fId4 fId3 fId2 fId1]`
(left→right):

| case | fId4 | fId3 | fId2 | fId1 |
|---|---|---|---|---|
| MOVING (fId4→fId1) | 0 | 0 | **86** | 121 (head) |
| STATIONARY (held fId1) | 0 | 0 | **0** | 225 (head) |

- After the move the head par fId1 is lit (121), and the trailing par fId2
  remains partially lit (86) — the comet lingering behind the head — whereas
  the stationary dancer leaves fId2 at 0. PASS.

### Temporality proof (27): the trail decays as the dancer holds still

Same end position (fId1), increasing the number of held "settle" frames after
arrival. The trailing par fId2 must fade and the head fId1 must fill in:

| settle frames | fId4 | fId3 | fId2 (trail) | fId1 (head) |
|---|---|---|---|---|
| 0 | 0 | 0 | 210 | 106 |
| 4 | 0 | 0 | 86 | 121 |
| 8 | 0 | 0 | 11 | 171 |
| 16 | 0 | 0 | 0 | 213 |
| 30 | 0 | 0 | 0 | 228 |

The trailing par decays 210 → 86 → 11 → 0 as the dancer stops, while the head
climbs to full. This is genuinely temporal (a 14-slot per-dancer ring buffer
of past spring positions, faded quadratically by age) — not a static spatial
spread. Mirrors `drawOrb`'s fading trail in the Audio Companion. PASS.

## Check 4 — no NaN / garbage — PASS

Every output byte across every frame of both patterns stayed in 0..255; neither
pattern threw. PASS.

## Notes / non-issues encountered

- An early, stricter harness run reported two FAILs that were **harness
  artifacts, not pattern bugs**, and were resolved by tightening the test rig
  (confirmed via `dancers_diag2.mjs`):
  1. The critically-damped dance spring (DANCE_OMEGA = 7) needs a few frames
     to SETTLE after the target stops; reading the head pixel on the exact last
     ramp frame caught the spring still in transit. Holding ball1_x = 1.0 for
     ~16 frames settles fId1 to 243. Expected physics.
  2. A second dancer parked in the trail region (and its own trail) confounded
     the "head" read. Quieting dancer-2 (energy 0) and parking it at the head
     position removed the confound.
  Both behaviors are correct; the patterns were not changed.

## Artifacts

- Harness: `C:/Users/sina_/tmp/dancers_trail_harness.mjs`
- Diagnostics: `C:/Users/sina_/tmp/dancers_diag.mjs`,
  `C:/Users/sina_/tmp/dancers_diag2.mjs`,
  `C:/Users/sina_/tmp/trail_collapse.mjs`
