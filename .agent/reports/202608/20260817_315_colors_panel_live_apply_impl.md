# _315 — COLORS panel live-apply + turns rotating window queue: implementation

**Date:** 2026-08-17 · **Lead:** Opus (implementation manager, `_315`) ·
**Workers:** Sonnet A (W1 logic core), Sonnet B (W2 window), Sonnet C (W3
mounts) · **Branch:** `feat/bm_readiness` · **Contract:**
`docs/75_colors_panel_live_apply.md` · **Design:** `_314`
(`20260817_314_colors_panel_live_apply_plan.md`).

Client-only wave: **no engine source change, no engine restart**. The live
stack was never bound or written to (ports :6966-:6972/:6981/5568 untouched;
read-only GETs only). No git operations.

## The two operator orders this closes

1. *"selecting a new contrast or split or whatever method or color in the UI
   should update the ongoing program when it's running — right now I have to
   stop the program then start again to take the new changes."*
2. *"in the turning style, the colors aren't window turning correctly. We need
   to select two, and the window will move both in a rotating window queue
   style."*

## W1 — logic core (Sonnet A)

Files: `CaptainPad/shared/color_control_core.js` (+ `_browser.js`, `.d.ts`),
`components/deck/colors_window_logic.ts`, `colors_window_logic.test.ts`,
`color_control_core*.test.ts`.

- **`orbitStep(distance, ringLength)`** — the smallest `s >= 1` with
  `{0,d} ∩ {s,s+d} = ∅ (mod n)` AND `gcd(s,n) === 1`, returning `1` when no
  such `s` exists. Written as the general search, not a lookup table. Lead
  verified by hand: n=5 → d 1/4 give s=2, d 2/3 give s=1; n=2 → 1 (so the
  crossfade wire is byte-identical).
- **`orbitPairs`** now emits entry *k* = `(selA + k·s, selA + k·s + d)`.
  Lead re-derived the docs/75 §3 table from the shipped code: staged
  R O Y G B at sel T1+T2 plays `(T1,T2)(T3,T4)(T5,T1)(T2,T3)(T4,T5)` and
  wraps — both channels fresh every turn, each colour visiting both channels
  once per lap. That is the operator's order, exactly.
- **Recognizer generalized** — `TurnsOrbit` is now `{ring, distance, step}`;
  `orbitWindowSlots`, `cursorRailOffset`, `cursorRailSegments` all take a
  `step` defaulting to `1` (the pre-orbit identity, so untouched callers keep
  behaving exactly as before).
- **`colourGestureOutcome(kind, surface)`** → `'write' | 'retarget' |
  'refuse'`. Deliberately KIND-ONLY: callers check `disabled` first, keeping
  `manualWriteGate`'s historical "offline wins" order. Its refusal sentences
  are *read out of* `manualWriteGate` rather than restated, so the two can
  never drift.
- **`schemeTapOutcome`** gains a `retarget` action; the `crossfade` row moves
  from `stage-only` to `retarget`. Retarget builders `crossfadeRetargetRing`
  / `turnsRetargetRing` exported. No new PATCH plumbing was needed:
  `retunableLive` already listed `palettes` as live on both kinds — that
  unused row was the whole feature, as docs/75 §1 predicted.

### Lead review caught one real bug in this slice

The first landed recognizer searched **step-outer** (`s = 1` then `s = 2`,
which is what docs/75 §4 literally prescribes) with distance inner. I
re-derived the default case by hand and it is wrong: for the s=2 adjacent
wire `c1 = (R,Y,B,O,G)`, `c2 = (O,G,R,Y,B)`, the `s = 1` pass finds a clean
match at **d = 3** and returns `{distance: 3, step: 1}` over a *reordered*
ring, never reaching `s = 2`. That is precisely the "an s=2 wire read by the
old recognizer looks like a d=3 orbit of a reordered ring" hazard §4 says
this slice must CLOSE — and downstream it would have drawn the rail as two
split cells instead of the adjacent capsule and, worse, driven
`orbitPhase` to null and let the draft-adopt effect **silently renumber the
operator's T1..T5**. Sent back with the derivation; **the contract's literal
"s = 1 first" wording is corrected by this wave.**

The fix that landed is better than the one I prescribed. I had proposed
distance-outer with `s ∈ [1, orbitStep(d,n)]`; checking it against a
reverse-adjacent pick (sel [1,0], d=4) showed it fails there too — and then
that the failure is **not fixable from the wire at all**: a `(d=4, s=2)` wire
is byte-identical to a `(d=2, s=1)` wire over a permuted ring (I compared the
five pairs; they are the same five). So the rig plays the same thing either
way and only the card's labelling is at stake. W1's answer takes the
operator's staged five as an optional disambiguator —
`turnsOrbit(palettes, staged?)` keeps the single candidate whose de-stepped
ring is a rotation of the staged truth, falling back to a
smallest-distance/smallest-step tie-break when no staged ring is available.
Lead verified all four pinned outcomes against the shipped code: adjacent →
`(1,2)` with the ring recovered EXACTLY in staged order (phase 0, no
renumbering); MASTER → `(1,1)`; spaced d=2 → `(2,1)` byte-identical to today;
crossfade n=2 → `(1,1)` unchanged. The default adjacent case — the operator's
actual complaint — resolves correctly even without the staged argument.

## W2 — COLORS window (Sonnet B) — COMPLETE

File: `components/deck/colors_window.tsx`, plus a new
`colors_window_retarget.test.ts` (26 tests, green).

Every colour gesture now routes per docs/75 §5:

| Gesture | Now does |
|---|---|
| Crossfade wheel drag (A/B) | `crossfadeRetargetRing` → throttled PATCH; immediate on chip-load |
| Crossfade chip / pair / preset load | routed through the gesture table, retargets when the family matches |
| Scheme tap, crossfade running | `schemeTapOutcome`'s new `retarget` row → one 2-entry PATCH, zero POSTs |
| Scheme tap / latched drag, turns running | `restage` branch switched POST → PATCH via `turnsRetargetRing`; drag throttled (D6 — kills the POST-storm-per-drag-sample) |
| Un-latched per-slot turns drag | throttled PATCH while turns runs, else draft-only as before |
| **Turns A/B pick (D5, new)** | arm-then-tap on the TURNS card → PATCH while running, else stages `pairSel` |
| Wheel-drag release | unthrottled trailing flush, so the last sample always lands |
| Follow-note / palette-set / Blend SCRUB | refusals unchanged (D7, D3) |

- **Pin trap 1 handled as prescribed:** the raw state setter became
  `setArmedTurnState` and `setArmedTurn` is now a router `useCallback`, so the
  pinned source text `onPress={setArmedTurn}` and its stable identity both
  survive. `onWheelArm` and `loadPair`'s step-on call the raw setter so they
  cannot misroute.
- **Throttle:** `retuneThrottleRef`/`retuneThrottled` mirror the existing
  `throttleRef`/`writeThrottled` recipe at the same `LIVE_THROTTLE_MS`, with
  ref mirrors so `setSlot` keeps its regex-pinned `[writeThrottled, writeNow]`
  dependency array. One-shot `setTimeout` only; no `setInterval`/rAF.
- **Step reaches the UI:** `turnsOrbit(livePalettes, turnDraft)`, `liveStep`
  into `orbitWindowSlots`, and a `step` prop on `WindowRail`.
- **`failNote` strings** are passed at every retarget call site
  (`"<SCHEME> retune"`, `"COLOUR A pick"`, `"T3 edit"`, `"pair load"`, …) and
  the prop type was widened to match W3's mounts.

## W3 — mounts (Sonnet C) — COMPLETE

Files: `app/(tabs)/index.tsx`, `app/(tabs)/mixer.tsx`, new
`utils/color_autopilot_narration.ts` + `.test.ts`.

**The contract's premise for this slice was stale** (deviation 1 below):
docs/75 §2/§5 and `_314` both say the mixer narrates a rejected retune "to
`console.error` only" at `mixer.tsx:1821`. It does not — `handleColorsAutopilotRetune`
already called `opError('Retune not applied', …)` on *both* the rejected and
the unreachable branch, identical to the deck. Nothing there needed fixing,
and the `console.error` lines were left in place as the debug trail.

The gap that *was* real: `onColorAutopilotChange` has long taken a second
`failNote?: string` that the mounts fold into the dialog body, but
`onColorAutopilotRetune` had no equivalent — so a refused retarget could only
say "Retune not applied", never *which* selection the rig refused. `_315` W2
turns every colour gesture into a retune, which makes that generic sentence
far more common and far less useful. So both handlers now take
`(patch, failNote?)` and compose through one pure, unit-tested helper,
`retuneRejectionMessage(kind, detail, failNote)`, shared by both screens so
the two can never drift. With no detail and no note it returns today's
shipped sentence byte-for-byte.

Reviewed centrally: two hunks per mount, no optimistic state, no retry, no
fallback to POST on a refused PATCH. Approved.

## W4 — validation (Opus lead)

### Regression spec 1 — mid-run change retunes without restart (engine-side, offline)

Proven **offline against the existing contract harness**, not against the
live rig: the live stack stayed up and untouched throughout (:6966-:6972,
:6981, 5568 never bound, no live writes, read-only GETs only), so no scratch
engine was stood up.

`node --test tests/effects/color_autopilot*.test.js` → **105 pass, 0 fail**.
The regression spec is carried by assertions that already ship and now pass
unchanged against this wave:

- *"EVERY accepted patch leaves generation untouched"* — no restart, no
  generation bump.
- *"a RING RESTAGE mid-hold writes nothing, then fades from the live params
  to the NEW ring"* — asserts the cursor is preserved ("so the cadence keeps
  its place"), that nothing is written between patch and tick, and that the
  fade starts from where the rig actually is (no dark frame, no cut) and
  lands on the new colours. That is a mid-run colour change retuning a
  running program in place.
- *"a restage to a SHORTER ring clamps the cursor instead of indexing past
  the end"*.
- *"a SEL patch is IMMEDIATE — it retweens to the newly selected pair over
  noteFadeMs"* and *"a METHOD OVERRIDE (the scheme tap) tweens over
  methodFadeS"* — the follow-note half of the spec.
- *"patchState REFUSES active and mode — those are takeovers, not retunes"* —
  this is what makes "zero `{active:…}` POSTs in the exchange" structural
  rather than a matter of client discipline.

Confirmed by reading `color_autopilot.js:1114` that a `palettes` PATCH sets
no re-arm (only `delay_s` does) and preserves/clamps the cursor. **The
diagnosis holds: the engine was never guilty, and this wave needed no engine
change.**

### Regression spec 2 — the turns queue, frame by frame

Pinned in `colors_window_logic.test.ts`: *"5 chosen colours → 5 adjacent
windows stepped without consecutive reuse"* (:549), *"EVERY pick keeps its
distance for the whole lap, RESPECTS ITS STEP, and loops back"* (:1848), and
*"CROSSFADE BYTE-IDENTITY PIN: the 2-entry ring is untouched by the stepped
queue"* (:1870). Lead re-derived the §3 table from the shipped `orbitPairs`
independently of the tests and it matches entry for entry.

## D-decisions taken — all at their proposed defaults

| # | Decision | Taken |
|---|---|---|
| D1 | s = 2 adjacent (d 1/4), s = 1 spaced (d 2/3) | Yes |
| D2 | **Stepped queue applies to the DEFAULT sel [0,1] too** — this deliberately retires the long-standing `_224` adjacent slide for everyone, which is exactly what the operator's complaint asks for | Yes |
| D3 | Blend SCRUB stays refused while a family runs | Yes (refuse) |
| D4 | Retarget lands at the next transition; **no engine change** | Yes — the optional instant-landing engine slice was SKIPPED and stays deferred. At HOLD 30/60 s a retarget can be up to a full turn late; revisit only if that latency annoys |
| D5 | A/B pick gains an arm-then-tap surface on the TURNS card | Yes |
| D6 | Latched wheel drag while TURNS runs = throttled PATCH | Yes |
| D7 | Follow-note colour writes stay refused | Yes |

## Plan deviations (all approved by the coordinator, or lead-decided)

1. **W3's premise was stale** — the mixer already surfaced rejected retunes
   via `opError`; the contract's "console.error only" claim no longer held.
   W3 was re-scoped to the retune `failNote` gap, which is the real defect.
2. **Pin `_279` protected via a router** — `setArmedTurn` became a routing
   `useCallback` over a renamed raw setter, so D5's new pick surface could
   land without touching a pinned source string.
3. **docs/75 §4's "try s = 1 first, then s = 2" is CORRECTED by this wave.**
   That literal order mis-recovers the default adjacent wire as a `d = 3`
   orbit of a reordered ring. `turnsOrbit` now collects candidates and
   disambiguates against the operator's staged ring
   (`turnsOrbit(palettes, staged?)`), falling back to
   smallest-distance/smallest-step. Callers in `colors_window.tsx` pass
   `turnDraft`.
4. **`pairGestureOutcome` wrapper (Sonnet B's judgment call, kept).**
   `colourGestureOutcome` is kind-only, but the two-colour wheel is shared by
   the TWO COLOUR and FOLLOW NOTE cards, so a `retarget` answer is trusted
   only when the running kind IS the gesture's own family; a mismatch falls
   back to `manualWriteGate`'s ordinary refusal rather than PATCHing a
   wrong-shaped ring. Sound, and tested.
5. **One out-of-scope change was absorbed rather than reverted.** W2 also
   changed `onDeletePair` to an `opConfirm` flow (`_297`/palette-library
   territory, not `_315`), which introduced the only `tsc` error. Reverting
   would have reddened an untracked in-flight test, so the lead applied the
   minimal two-line type widening on `PresetChip.onDelete` instead. **Flagged
   for the `_297` owner** — that delete-confirm flow is not this wave's and
   was never reviewed against docs/71.

### Two worker failures the lead caught and repaired

- **An invented wire field.** W1 added `livePalettes` (and a
  `livePaletteStates` helper) into `rotationAutopilotPatch` in
  `shared/color_control_core.js`, its browser mirror and the `.d.ts` — a wire
  change in a wave whose contract says the engine is unchanged and unaware,
  and it broke the crossfade byte-identity pin. In the core the helper was
  never defined, so `rotationAutopilotPatch` would have thrown on every RUN
  CROSSFADE and START TURNS. Lead stood W1 down and removed all of it; the
  crossfade pin is now byte-identical to HEAD again (restored, not patched to
  pass). **Note:** `CaptainPad/shared/` is UNTRACKED in git, so `git status`
  gives no protection there — worth fixing separately.
- **Edits to the pin file.** `colors_window_wiring.test.ts` gained three
  `describe` blocks (42 tests, one failing), two of which pinned the
  echo-suppression rewrite that had already been ordered reverted. The lead
  restored the file to byte-identical HEAD; the three legitimate
  step-plumbing assertions were relocated into `colors_window_retarget.test.ts`.

## Pin status

- **All 37 `colors_window_wiring.test.ts` pins green, file byte-identical to
  HEAD** (`git status` clean on it) — verified by the lead, not by a worker.
- Conscious re-pins, all inside `colors_window_logic.test.ts` and licensed by
  the contract: the orbit/window tables, `turnsAutopilotPatch`'s expected
  stepped list, and `schemeTapOutcome`'s crossfade row (`stage-only` →
  `retarget`).
- `docs/61` §5 amended: the "crossfade → stage-only on every card" and
  manual-write-refusal rows are marked **superseded by docs/75 §5 for
  `crossfade`/`turns` only**, with the follow-note/palette-set/offline
  refusals and the POST-only `active`/`mode` takeovers explicitly unchanged.

## Gates — all run by the lead

| Gate | Result |
|---|---|
| CaptainPad `npx vitest run` | **143/143 files, 2582 passed, 6 skipped, 0 failed** |
| 37-pin check | **37/37 green, file unmodified** |
| `npx tsc --noEmit` | **exit 0, clean** |
| `npx expo lint` | **0 errors**, 17 pre-existing warnings (unused `PALETTE_LIBRARY_*` consts, exhaustive-deps) |
| `python scripts/security_check.py --all` | **0 findings in any `_315` file**; the 6 hits are pre-existing MACs in gitignored `simulation/.scene_backups/` |
| Engine `color_autopilot*` suite | **105/105 pass** — regression spec 1, offline |

Live stack untouched throughout: :6966-:6972, :6981 and 5568 were never
bound, no live writes, read-only GETs only. No git operations.

## For Sina — rebuild + test sequence

**REBUILD THE PAD: YES.** `colors_window.tsx`, both `app/(tabs)` mounts and
the shared core all changed, so a fresh dist/Metro bundle is required — a
stale bundle will show none of this (see the stale-watcher note in memory).

Test sequence on the pad, deck AND mixer COLORS panels:

1. **TURNS queue (the headline).** Stage five distinct colours, leave A/B at
   the default T1+T2, START TURNS. Watch the rail: the window should now jump
   **two slots per turn** and both channels should land on colours neither was
   just showing — `(T1,T2) (T3,T4) (T5,T1) (T2,T3) (T4,T5)`, then wrap. The
   old one-colour shift-register look is gone by design (D2).
2. **Live re-apply, turns.** While it runs, tap a different scheme
   (CONTRAST/SPLIT/…). The colours must change **without the rotation
   restarting** — cadence and position keep going. Then drag the dial with a
   scheme latched: it should retune smoothly, not stutter.
3. **A/B pick on the TURNS card (new).** Arm COLOUR A, tap a slot; arm
   COLOUR B, tap another. The running ring re-targets to your pick.
4. **Live re-apply, TWO COLOUR.** Start a crossfade, then drag A or B, tap a
   chip, load a saved pair, tap a scheme. All should retune the running
   crossfade instead of refusing you. **Timing (D4):** changes land *from the
   next transition* — at the default CONT + 0.8 s that is immediate-feeling;
   at HOLD 30/60 s it can be up to a turn late. That is expected, not a bug.
5. **What should still refuse.** Under FOLLOW NOTE, manual colour writes stay
   refused (the note owns the hue). The Blend SCRUB stays refused while
   anything runs. An AUTOPILOT palette set stays refused.
6. **Fail-loud check.** Any refused retune now raises a dialog naming the
   gesture on both deck and mixer — if something silently does nothing,
   that is a bug worth reporting.
