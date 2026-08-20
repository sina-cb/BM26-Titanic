# _224 — TURNS rotation polish: one transport, a sliding window, a pickable pair

**Date:** 2026-08-15 · **Agent:** `_224` (Opus, implementer) ·
**Branch:** `feat/bm_audio_tuning` (shared tree — no git ops).
**Builds on:** `docs/55_colors_schemes_and_perf_overlay.md` (the `_216` design)
and `.agent/reports/202608/20260814_217_colors_schemes_perf_overlay_impl.md`
(what shipped).

Four operator orders, all landed. Verbatim:

1. *"the color wheel is great, and I love it, now please make the color turns
   also work nicely"* / *"the turning is smooth and needs to happen on the same
   timescale as the two color crossfader"* / *"use the same fade time out and
   interval as the two color"*
2. The rotation is a **sliding adjacent-pair window** over the five slots —
   `[c1],[c2],c3,c4,c5 → c1,[c2],[c3],c4,c5 → …` wrapping — and the UI must show
   which pair is live, animated **from the engine broadcast, never a tab timer**.
3. In two-colour mode with a scheme latched, the five swatches show and the
   **ACTIVE TWO** feeding `colorPalette1/2` are **selectable** (slots 1+2 by
   default, any other slot pickable).
4. *"also similar to complimentary and other contrasting, add a few more
   technique to sample nice looking color duos or 5 samples."*

**Files:** `CaptainPad/components/deck/colors_window_logic.ts`,
`CaptainPad/components/deck/colors_window.tsx`, and the two colour suites.
**No engine source change was needed** — `_217` already made `delay_s: 0` and
full-HSV rings legal, and a five-entry ring at zero hold was already
representable. `marsin_engine/lib/api_server.js` and `app/(tabs)/index.tsx` were
**not touched** (`_228` and `_225` own them).

---

## Order 1 — ONE transport for both rings

TURNS and the crossfade no longer have separate timing models. They share one
FADE row and one HOLD row, one pair of values, and one patch builder.

| Before (`_217`) | After (`_224`) |
|---|---|
| TURNS: `TURN EVERY` 5…180 s + `derivedTransitionMs` (25 % of the turn, clamped 0.5–3 s) | TURNS: the crossfade card's own FADE + HOLD pills, verbatim |
| Crossfade: FADE 0.4/0.8/1.5/3 s + HOLD CONT/1/2/5/10 s | Both cards render the SAME `<TransportTiming>` component |
| `turnsAutopilotPatch(colours, delayS)` | `rotationAutopilotPatch(colours, holdS, fadeS)` — both front doors are one-liners over it |
| `delay_s: 0` reachable only from the crossfade card | CONT reachable from TURNS too: a five-colour ring slides continuously |

`derivedTransitionMs` is **deleted**. It was a reasonable guess while TURNS had a
cadence of its own; with the fade under the operator's thumb a derived value is
just a second opinion the surface cannot show.

Two deliberate calls, both recorded because they change stated contracts:

- **The shared HOLD row is a SUPERSET, not a replacement.**
  `ROTATION_HOLD_PRESETS_S = [0, 1, 2, 5, 10, 30, 60]` — the crossfade card's
  original row plus 30 s and 60 s, so the old set-and-forget cadences stay
  reachable. It is literally the same row on both cards; nothing was lost except
  the 120/180 s cadences, which the operator's "same timescale" order rules out.
- **docs/55 §2.3's "TURNS keeps its cadence floor" is SUPERSEDED** by order 1's
  "if the crossfader is in CONT, TURNS in CONT rotates continuously too". The
  engine's zero-hold-plus-zero-fade guard is untouched, so the spin loop stays
  unrepresentable; the client mirrors that refusal in `assertRotationTiming` so
  the operator sees the sentence instead of a rejected POST.

The shared default is **CONT + 0.8 s**. One control needs one default and CONT is
the operator-approved one (docs/55 §8.2) — TURNS therefore no longer defaults to
a 30 s cadence. Flagged below.

A `LiveTimingLine` (`ENGINE: FADE 1.5s · HOLD CONT`) sits under both pill rows: a
rotation started from a cue or the AUTOPILOT window can hold a value that is not
a preset, which would otherwise leave every pill dark with no explanation.

## Order 2 — the sliding window, inverted from the rig

The ring `turnsPairs` builds already IS the operator's sliding window — pair *i*
spans slots *i* and *i+1*, and the daemon's sequential cursor slides it one step
per turn, wrapping. What was missing was the **readout**.

`litPairIndex` only recognises the rig when it sits EXACTLY on a pair — i.e.
during the hold. In CONT the ring is *always* mid-fade, so the highlight would
never light at all and the window would never appear to slide.

**`rotationCursor(palettes, c1, c2)` fixes that by inverting the engine's own
tween.** During a fade the daemon writes `lerpParams(pair[i-1], pair[i], t)`:
`h` along the short arc, `s`/`v` linear. Six components, one unknown — so the
progress is a least-squares projection of the live palette onto the from→to
segment, plus a residual check that rejects a palette which is not on that
segment at all. It returns the window index the ring is **arriving at** and how
far through the arrival it is, or `null` when the rig is not on the ring
(another surface wrote the palette) — the card then says so rather than
highlighting a window that is not live.

**The deadman rule holds** (docs/53 §5.2): this is DERIVED, never clocked. It
moves only because the engine's tween frames arrive on the throttled
`sharedParams` broadcast, so the highlight animates from the rig and stops dead
when the rig does. There is still no `setInterval`/rAF anywhere in this window.

On the glass:

- **both** slots of the live window light (`T3` + `T4`), not just the leading one;
- a new **`WindowRail`** — five cells with a two-cell highlight parked exactly at
  `cursorRailOffset(cursor, n)`, drawn twice inside a clipping container so the
  T5→T1 turn slides *through* the seam instead of teleporting;
- the caption reads `On the rig now: T5 + T1, holding.` or
  `Sliding to T4 + T5 — 62% through.`

## Order 3 — which two of the five feed A and B

While a scheme is latched, two-colour mode now shows the five staged colours with
the two driving `colorPalette1/2` badged **A** and **B**.

**The gesture is the window's existing one, not a new one:** the COLOUR A /
COLOUR B buttons ARM a channel exactly as they always have, and tapping a scheme
slot assigns it to the armed channel — the same "arm, then tap a source" grammar
the Live Touch sample chips and the saved-pair gallery already use. Which two are
live is marked with the same derived badges the sample chips wear.

**The selection is stored as RING INDICES, not colours.** That is the whole
design: a wheel drag re-generates all five colours while latched, and a selection
stored as indices follows the re-theme (slots 2+4 stay slots 2+4 in the new
palette) where a selection stored as colours would silently stop matching
anything.

Putting both channels on one slot is **REFUSED with a sentence naming the
conflict** (`T4 is already COLOUR B — pick a different slot for A.`): A and B
would be the same slot, and a crossfade between a colour and itself is a dead
transport. The selection is still recorded when the manual-write gate refuses the
WRITE (a rotation is driving) — refusing both would lose the pick the moment the
rotation stopped.

### A real bug the screenshots caught

The first capture pass showed A and B collapsing onto ONE hue after a re-pick.
Root cause: `latched` was a bare `SchemeId` and the base hue was re-derived from
the **armed slot** on every read. That is circular once A and B are themselves
scheme slots — arming COLOUR B to pick B's slot moved the base to B's hue and the
ring re-themed underneath the pick.

**Fix: a latch is a scheme AND the hue it was generated from — two values that
must never disagree, so they are one piece of state**
(`{ scheme, base } | null`). While latched, the scheme row generates from the
latch's base, so switching CONTRAST → TRIADIC keeps the operator's hue instead of
jumping to whichever slot is armed, and **only a wheel drag re-bases** (the drag
updates `latched.base`, preserving Live Touch's `applyWheel → groupSchemeSync`).
The row caption now reads `TRIADIC is latched at 226°`.

## Order 4 — five more generators

`SCHEME_IDS` grows from four to nine. The four Live Touch ports keep their
original places at the head of the row, so muscle memory survives.

| Scheme | Steps `[deg, v]` |
|---|---|
| ANALOGOUS | `[0,1] [15,1] [-15,1] [30,1] [-30,1]` — a tight ±30° family, alternating sides so no two neighbours are 60° apart |
| TRIADIC | `[0,1] [120,1] [240,1] [0,.55] [120,.55]` — the even triad, then two dimmed echoes |
| SPLIT | `[0,1] [150,1] [210,1] [150,.55] [210,.55]` — flanks the complement instead of hitting it; 180° is deliberately absent |
| TETRAD | `[0,1] [90,1] [180,1] [270,1] [0,.55]` — the 90° square plus a dimmed base |
| GOLDEN | five steps of 137.5° → 0 / 137.5 / 275 / 52.5 / 190 |

Two rules shape them, both about what the RIG does with a ring rather than what a
colour-theory diagram looks like:

1. **Adjacent pairs are the product.** A rotation shows two slots at a time and
   slides that window one step per turn, so the ORDER of the five is a design
   decision: every neighbouring pair — including the T5→T1 wrap — has to be a duo
   the operator would have picked on purpose.
2. **No dead beat.** Where a construction naturally repeats its base (TETRAD's
   fifth slot, TRIADIC's and SPLIT's echoes) the repeat is DIMMED, so the turn
   stays alive and the pattern gets a light/dark beat. Pinned by a test that no
   new ring has two identical adjacent colours.

**Night-visibility floor:** the five new generators clamp at
`SCHEME_ROTATION_MIN_V = 0.25` — HUE's darkest step, the precedent the operator
already accepted (docs/55 §8.1). The four ports keep their own verbatim
`SCHEME_MIN_V = 0.1`: they are a port, and quietly re-flooring a ported algorithm
would make the Deck and Live Touch disagree about what MASTER/HUE mean.

---

## AS BUILT — deviations and notes

1. **`crossfadeAutopilotPatch` is now literally `rotationAutopilotPatch` at ring
   length 2.** `turnsPairs([A, B])` IS `[{c1:A,c2:B},{c1:B,c2:A}]`, and the
   hue-only A/B surface makes both channels minimize to plain numbers — so the
   wire is byte-identical to `_217`'s crossfade. docs/55 §2.2 claimed the two
   were "the same mechanism"; they are now the same *function*, rather than two
   that must be kept in step by hand. Pinned by a test.
2. **`CURSOR_FIT_EPS = 2e-3`.** `writeColorPaletteParams` writes the exact
   `lerpParams` output straight to the CPC with nothing re-slewing it on the way
   to the broadcast, so a real fade frame lands at float precision. The tolerance
   is wide enough for JSON round-tripping and tight enough that a palette some
   other writer set is rejected rather than mapped onto a plausible-looking
   progress. Pinned both ways.
3. **A MASTER ring has no fade fit, by construction.** Five identical colours
   means every segment's endpoints coincide, so there is no direction to measure
   progress along. `rotationCursor` returns the HOLD match and `null` otherwise
   — inventing a direction there would be a fallback.
4. **The scheme row is two-across in the wide deck column, one row in portrait.**
   Nine buttons were five stacked rows at `_217`'s sizing, which pushed the TURNS
   transport off the bottom; the button was tightened (minWidth 66→56, swatch
   9→8 px) but the wide column is simply too narrow for three. Narrow/portrait
   fits all nine in a single row — see `S8`.
5. **The shared default is CONT.** TURNS used to default to a 30 s cadence; one
   shared control has one default and CONT is the approved one. 30 s and 60 s are
   one tap away on the same row.

## Suites

**CaptainPad** `npx vitest run` — **1446 pass / 6 skip / 0 fail** (73 files).
**Failing list: EMPTY.** `colors_window_logic.test.ts` 94 → **125** (+31).
(The total moved beyond my +31 because several agents are adding tests
concurrently; the LIST is the comparison that matters.)

New client coverage: the shared-transport identity (both patches, every preset),
TURNS carrying FADE/HOLD verbatim with CONT included, the refusals both cards
share, `rotationCursor` settled/mid-fade/HUE-ring/wrap/crossfade/null/MASTER
cases, the window-slides-one-slot-and-wraps table, `cursorRailOffset` including
the seam, `selectSchemePair` assign/refuse/no-op/throw, `schemePairColours`, the
by-SLOT re-theme invariant, and all five new generators (step tables, the 0.25
floor, the ports' floor unchanged, no dead beat, legal rings, cursor parity).

**Engine** `tests/effects/color_autopilot.test.js` **48/48** (was 42), +6 for the
sliding window: a five-pair ring advancing one step per turn over two full laps,
every colour on the rig exactly twice a lap, CONT arming a 5-ring with zero hold,
hold and fade additive for a 5-ring, **every mid-fade frame lying ON the from→to
segment** (the property the Deck's cursor inverts — both slots must report the
same progress), and a CONT 5-ring accepted at the front door.
`color_window_engine_api.test.js` **14/14**.

**Engine** `npm test` — **3359 pass / 9 fail**. Failing list:

- 5 × `dev_test_bench: …` groupBits drift — the known pre-existing set.
- `privileged session bypasses only this device…`,
  `auth-required SIGKILL relocks Performance…`,
  `auth routes bypass an armed Live Touch desk…` — all in
  `tests/security/captainpad_auth_api.test.js`, which `_228` is actively editing.
- `performance mode gates special-event ARM on a FRESH operator passcode` —
  already flagged as a non-reproducible intermittent in `_217`.

None are in my domain: this wave touched zero engine source files. The
`party_dancers` and baby-gallery reds from the `_217` baseline are now green.

`npx tsc --noEmit` and `eslint` are clean **on my three files**. The tree
currently shows tsc errors in `components/performance_mode_logic.test.ts` from a
concurrent agent's in-flight `editPrincipal` change — reported, not touched.

## Offline engine verification — `~/tmp/fix_224/engine_verification.txt`

A real `engine.js` subprocess on **port 17224** (the coordinator's assignment),
sACN black-holed on **TEST-NET-1 `192.0.2.x`**, with throwaway
`MARSIN_CONFIG_FILE` / `MARSIN_STATE_DIR` / `MARSIN_PLAYLISTS_DIR` /
`MARSIN_TIMELINE_DIR`. All three walls ASSERTED before any scenario ran (every
`[sACN Out] Sender started` line names only the black hole; no Art-Net sender;
`status.outputRouting.controllers === []`). The window readout is computed by the
**REAL client `rotationCursor`**, esbuild-bundled from the TypeScript the UI
imports — not a re-implementation.

```
A  client: TURNS and CROSSFADE build the same timing — delay_s 2, transitionMs 400
   engine: delay_s 2 · transitionMs 400 · 5 chained pairs (no derived 25% fade)
B  window sequence observed: 0 -> 1 -> 2 -> 3 -> 4 -> 0
   15 MID-FADE samples resolved to a window + progress
   the window advanced ONE slot on each of 5 transitions
   the T5 -> T1 WRAP was observed 1x
C  engine accepted a FIVE-entry ring at delay_s 0 (transitionMs 400)
   CONT window sequence: 0 -> 1 -> 2 -> 3 -> 4 -> 0 -> 1
   CONT advanced through 6 turns in 2.6 s (no 30 s hold anywhere)
   CONT is CONTINUOUS: 31 moving samples vs 10 settled (the ring never parks)
D  analogous/triadic/split/tetrad/golden — 5 pairs round-trip verbatim,
   v ramps intact on the wire (e.g. triadic [1,1,1,0.55,0.55])
```

## Screenshots — `~/tmp/fix_224/`

13 PNGs, every one visually inspected. Fresh `npm run web:build` dist served on
**:7167** (never the operator's :6967), console muted via `evaluateOnNewDocument`
before boot, one tab, pointed at the isolated :17224 engine. iPad 11" landscape
1194×834 and portrait 834×1194. Transcript: `screenshot_transcript.txt`;
capture scripts `shoot_224.cjs`, `verify_224.mjs`, `engine_up.mjs`.

| File | Shows |
|---|---|
| `S1_wide_schemes_row_nine_generators` | all nine generators with five-swatch faces (order 4) |
| `S2_wide_triadic_latched` | TRIADIC latched, `accentWash` on-state, `latched at 226°` caption |
| `S3_wide_scheme_pair_default_1_2` | scheme slots with the default `A=T1 · B=T2` |
| **`S4_wide_scheme_pair_repicked_2_and_4`** | `A=T2 · B=T4` badged on the swatches; COLOUR A 346° / COLOUR B 226° on the rig |
| `S5_wide_pair_conflict_refused` | the both-channels-on-one-slot state |
| `S6_wide_turns_shared_transport_staged` | TURNS wearing the crossfader's FADE + HOLD rows |
| `S7_wide_turns_window_frame1..4` | the window sliding — `T2+T3, holding` → `Sliding to T4+T5 — 3%` → `T5+T1` → `T1+T2` |
| **`S7e_wide_turns_slots_and_rail`** | the money shot: five T slots, the two lit window slots, the sliding rail, FADE 1.5s / HOLD CONT, `ENGINE: FADE 1.5s · HOLD CONT` |
| `S8_narrow_schemes_row_and_transport` | portrait — all nine schemes in ONE row |
| `S9_narrow_turns_window_running` | portrait TURNS transport |

## Hygiene

Ports 6966–6972 and sACN 5568 were never bound, restarted or swept; the only
contact with the operator's stack was read-only `curl` liveness checks. My test
engine (17224, briefly 7846 before the coordinator's assignment) and dist server
(:7167) are both stopped. No test wrote `simulation/scenes/**` or
`marsin_engine/states/**` — the isolated engine ran entirely inside
`~/tmp/fix_224/engine_world`. No mic, no `npm install`, no git operations. I did
not touch `marsin_engine/lib/api_server.js` (`_228`) or `app/(tabs)/index.tsx`
(`_225`).

## Open for the operator

1. **TURNS now defaults to CONT with a 0.8 s fade**, not a 30 s cadence — one
   shared transport, one default. 30 s and 60 s are one tap away on the same HOLD
   row. Say the word if you'd rather the shared default were a hold.
2. **120 s and 180 s cadences are gone** from TURNS. They cannot survive "the
   same interval as the two color" and still be one row; 60 s is the new longest.
3. **The wide deck column fits two scheme buttons per row**, so nine generators
   is five rows tall there (one row in portrait). If that reads as too much
   furniture, the row could collapse behind a disclosure — say the word.
4. **No engine restart is required for this wave.** Everything here is
   client-side, and the engine capabilities it leans on (`delay_s: 0`, full-HSV
   rings) are `_217`'s. **If the operator's engine still predates `_217`, that
   restart is still pending** and CONT/full-HSV rings will 400 until it happens —
   which would make TURNS in CONT unavailable on the live rig.
5. Still open from `_217`: should a saved pair carry its fade time?
