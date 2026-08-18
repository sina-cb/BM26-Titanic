# _314 — COLORS panel live-apply + turns rotating window queue: the plan (docs/75)

**Date:** 2026-08-17 · **Agent:** Fable (design, `_314`) · **Branch:**
`feat/bm_readiness` (docs only — no product code, no servers, no git ops,
live :6966-:6972/:6981/5568 never bound; read-only file evidence only).
**Deliverable:** `docs/75_colors_panel_live_apply.md` — the full `_315`
implementation contract (diagnosis, per-mode fix, queue algorithm,
regression specs, waves, D1..D7). This report is the landing record.
Per the operator's mid-run token order, diagnosis was done first-hand with
no sub-agent fan-out, and scope is capped at the two ordered problems.

## Root cause, problem 1 (stop/start deafness) — one line per mode

- **Engine: not guilty.** `PATCH /deck/color-autopilot` →
  `patchState` (`color_autopilot.js:1114`) already retunes a RUNNING
  rotation in place (`palettes` from next transition, cursor kept;
  `followNote.sel/method` retween now). The daemon reads config fresh at
  every tick — there is no start-time snapshot. The deafness is client
  policy: colour gestures are refused (`manualWriteGate`) or staged into a
  local draft the program never sees. `retunableLive` already lists
  `palettes` as live on crossfade/turns — **no colour gesture ever calls
  it**.
- **TWO COLOUR (crossfade):** zero live path — `schemeTapOutcome` pins
  `crossfade → stage-only` on every card (`colors_window_logic.ts:1223`),
  and every wheel/chip/pair/A-B gesture is gate-refused; endpoints are
  locked to the live config's pair 0.
- **TURNS:** scheme tap "restages" via full POST (generation bump + cursor
  reset = visible restart; latched wheel drag = POST per drag sample);
  slot edits/chip loads are draft-only or refused; A/B re-pick records
  locally but the write is refused — and the pick surface doesn't even
  exist on the TURNS card (read-only badges, `colors_window.tsx:1266`).
- **FOLLOW NOTE:** already live for every field it has (sel/method/schemes/
  timings all PATCH); only real defect is the mixer mount narrating a
  rejected PATCH to `console.error` only (`mixer.tsx:1821`).

## Root cause, problem 2 (turns window) — one line

`orbitPairs` (`shared/color_control_core.js:123`) always advances the
window by ONE slot per turn, so at the default adjacent selection (d=1)
consecutive windows share a colour — channel A merely inherits what B just
showed (a one-colour shift register), instead of the ordered rotating
two-colour window queue where BOTH channels land on fresh colours each
turn.

## The fix (client-only; engine unchanged, no restart)

1. **Retarget rule:** while the matching family runs, every colour
   selection becomes a sparse `PATCH {palettes: <new ring>}` through the
   daemon's front door (the `_288` W3 fan-out pattern) — never a refusal,
   never a full POST. Crossfade keeps its 2-entry ring (kind can't drift);
   TURNS restage/drag/pick all switch POST→PATCH (throttled at the
   existing write cadence, trailing PATCH on release). Follow-note
   unchanged. Palette-set stays refused (AUTOPILOT window owns it).
   Fail-loud: rejections narrated on both mounts.
2. **Queue algorithm:** orbit gains a step `s`: window k =
   `(selA + k·s, selA + k·s + d) mod 5`, with s = 2 for adjacent pairs
   (d 1/4) and s = 1 for spaced ones (already disjoint); crossfade (n=2)
   pinned byte-identical. Sel T1+T2 over R O Y G B plays
   `(T1,T2)(T3,T4)(T5,T1)(T2,T3)(T4,T5)` — both fresh every turn, every
   colour visits both channels once per lap. Recognizer
   (`turnsOrbit`/`orbitPhase`/`orbitWindowSlots`/`cursorRailOffset`)
   generalized to recover `(ring, d, s, phase)`; the draft-adopt effect
   hazard (`colors_window.tsx:545` would renumber T1..T5 under the old
   recognizer) is closed in the same slice.

## `_315` shape

**4 waves:** W1 logic core (`shared/color_control_core.*`,
`colors_window_logic.*`) → W2 window wiring (`colors_window.tsx`) ∥ W3
mounts (deck/mixer narration) → W4 Opus validation (offline scratch engine
+ 2-lap wire assertion + screenshot matrix + full suites + security check).

**Pin re-baselines:** `colors_window_logic.test.ts` orbit/window tables and
the `schemeTapOutcome` crossfade row (stage-only → retarget) are conscious
re-pins; **all 37 `colors_window_wiring.test.ts` pins survive unmodified**
(no-timer, `_282` memo/identity discipline, yield/strip/bare-stop) and gate
W2. docs/61 §5's "crossfade → stage-only on every card" row is superseded
by docs/75 §5 (recorded there).

**docs/71 (`_297`):** compatible, not implemented here; same-file rule —
`_297` W4 and `_315` W2 both edit `colors_window.tsx`, so they must not run
concurrently. Global-line saved-palette taps retargeting a running family
stay deferred (one-line list in docs/75 §8).

**D-decisions Sina may care about:** D2 (the stepped queue changes the
default adjacent TURNS slide for everyone — that IS the order, but it
retires the `_224` look), D4 (retargets land at the next transition; at
HOLD 30/60 s that's up to a turn late — instant landing would need a small
engine slice, deferred), D5 (TURNS card gains an A/B pick surface).

Budget note (operator order mid-run): depth was kept on TURNS and the
retarget path; the TWO COLOUR mode carries the least diagnostic depth —
its gesture inventory in docs/75 §2 is from code reading, not an offline
repro walk. W4 covers it.
