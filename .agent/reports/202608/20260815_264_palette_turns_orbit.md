# _264 — PALETTE TURNS: the selected pair keeps its distance and orbits the ring

**Subsystem:** CaptainPad — Deck COLORS window, PALETTE TURNS transport
**Kind:** feature (client-only; zero engine source touched)
**Branch:** `feat/bm_audio_tuning` (shared tree; no git ops)

## The order

> *"For the PALETTE TURNS we have 2 selected colors — keep their distance, and
> rotate them in a window to the right, and then loop back when going over the
> end."*

## What was there, and what was wrong with it

`_224` gave TURNS a sliding window: the five staged colours became five
**adjacent** pairs, and each turn advanced the window one slot. `_224` also gave
the operator an A/B **pick** — arm COLOUR A or B, tap a staged slot, stored as
ring INDICES so a wheel re-theme carries it forward.

Those two features never met. The pick decided what the TWO COLOUR card put on
the rig; the ring was hardcoded to distance 1 starting at T1 no matter where the
pick sat. An operator who chose T3 and T5 and pressed START TURNS got a rotation
that ignored both the spacing they had chosen and the pair currently lit.

## The design — one number, `d`

The ring is now built **from the operator's own pair**. With `d = (selB − selA)
mod n`, turn `i` shows slots `selA+i` and `selA+i+d`:

```
sel (T1,T2) → d 1:  (T1,T2) (T2,T3) (T3,T4) (T4,T5) (T5,T1)     ← today
sel (T1,T3) → d 2:  (T1,T3) (T2,T4) (T3,T5) (T4,T1) (T5,T2)
sel (T3,T5) → d 2:  (T3,T5) (T4,T1) (T5,T2) (T1,T3) (T2,T4)
```

Both ends step one slot right per turn, the spacing never changes, the lap
closes after `n` turns, and every staged colour still reaches the rig exactly
twice (once per channel) — it is simply blended with the colour `d` slots along
instead of always its neighbour.

**Where the ring is built:** `CaptainPad/components/deck/colors_window_logic.ts`
— new `orbitPairs(colours, sel)` and `orbitDistance(sel, n)`. The old
`turnsPairs(colours)` survives as exactly `orbitPairs(colours, [0, 1])`, which is
what keeps the crossfade (a two-entry ring with no selection of its own) and
every legacy call site byte-unchanged. `rotationAutopilotPatch` /
`turnsAutopilotPatch` take an **optional** trailing `sel`; absent means the
adjacent ring.

### D1 — the orbit STARTS on the operator's pair (recommended, shipped)

The ring is posted **beginning at COLOUR A's slot**, not at T1. This is not
cosmetic: a restage is a full `setState`, which resets the daemon's cursor to −1,
so the first window it plays is entry 0. Starting at A is what makes both START
TURNS and a mid-rotation A/B pick land on the pair **already lit** instead of
jumping to a different one — it generalises a property the default selection
enjoyed by accident. **Veto:** start every ring at T1 instead; the rig then fades
to a different pair once on start.

The cost is that a non-default pick puts a **rotation** of the staged five on the
wire. Rather than let that renumber T1..T5 under the operator's fingers, new
`orbitPhase(staged, wire)` recovers the offset, and the adoption effect adopts a
live ring **only when it is not a rotation of the staged one**. The operator's
slot numbering stays put; the rail and the state line read the wire.

### D2 — the default pick is a pure superset (recommended, shipped)

With no pick made, `sel` is `[0, 1]`, `d = 1`, and the behaviour is today's
exactly. Proven below rather than asserted.

### D3 — the pick stays on the TWO COLOUR card (shipped, flagged)

The arm-then-tap picker is `_224`'s and lives on the TWO COLOUR card with a
scheme latched; the TURNS card has no A/B arm buttons to hang it from. TURNS
instead gained **read-only A/B badges** on its five staged slots plus a line
stating the spacing, so the ring that plays is legible on the card that plays it.
**Veto:** if you want to pick A/B from the TURNS card, that is a follow-up (it
needs an arm control that card does not currently have).

## Back-compat proof — byte-identical wire at `d = 1`

Not "equivalent" — the same bytes, three ways:

1. **Unit:** `orbitPairs(ring, [0,1])` deep-equals `turnsPairs(ring)` for all
   nine scheme generators.
2. **Transport:** `JSON.stringify(turnsAutopilotPatch(ring, 5, 1.5, [0,1]))`
   equals `JSON.stringify(turnsAutopilotPatch(ring, 5, 1.5))` for all nine
   generators; and `crossfadeAutopilotPatch` stringifies identically to the
   unselected `rotationAutopilotPatch` it delegates to.
3. **Through a real engine:** the default patch POSTed to a live daemon comes
   back from `GET /deck/color-autopilot` with `JSON.stringify(palettes)`
   **identical** to the pre-orbit wire — 343 bytes, unchanged.

The strongest signal is the negative one: **all 263 pre-existing
`colors_window_logic` tests and all 28 wiring tests passed unmodified**, before a
single new test was written. Nothing in the old contract had to be relaxed.

## The reader had to generalise too

`isTurnsConfig` tested that the pairs **chain** — each `c2` is the *next* entry's
`c1`. That is only true at `d = 1`; a `d = 2` ring the window itself posted would
have read back as `'palette-set'`, and the card would have shown a ring the
engine was not rotating. Replaced by `turnsOrbit(palettes)`, which looks for the
one distance `d` with `pairs[i].c2 === pairs[(i+d) % n].c1` for every `i` and
returns `{ ring, distance }`. At `d = 1` that **is** the old chain test.
**Smallest `d` wins**, so a MASTER ring (five identical colours, which every
spacing fits) still reports 1 and its readout is unchanged.

`rotationCursor` needed no change at all — it projects the live palette onto the
posted ring's from→to segments and never assumed adjacency. Verified explicitly
against all 20 selections rather than assumed.

`cursorRailOffset` gained an optional `phase`; new `cursorRailSegments` returns
the highlight as segments. **At distance 1 it returns the single 2-cell capsule
the rail has always drawn** — splitting it into two pills would have put a
visible notch in a highlight that never had one. Past that it returns two 1-cell
segments, and the component's existing "draw each segment at `left` and
`left − n` inside an `overflow: hidden` container" trick carries the seam
crossing unchanged, so a window straddling T5→T1 still slides through instead of
teleporting.

## Engine: unchanged, and unaware — verified before writing a line

`marsin_engine/lib/color_autopilot.js` validates `palettes` **entry by entry**
(`validatePaletteChannel` per channel), cycles them sequentially
(`_pickIndex` → `(cursor + 1) % length`) and tweens between consecutive resolved
param sets in `_runTween`. Nothing in the daemon ever asks whether two pairs
share a colour. The orbit is a client-side construction of the **same wire**. No
engine file was edited; **no engine restart is needed for this wave.**

## Offline walk — `~/tmp/orbit_260/engine_verification.txt`

A real `engine.js` subprocess on **:17262**, sACN black-holed on TEST-NET-1
`192.0.2.x`, throwaway `MARSIN_CONFIG_FILE` / `MARSIN_STATE_DIR` /
`MARSIN_PLAYLISTS_DIR` / `MARSIN_TIMELINE_DIR`. All three walls ASSERTED before
any scenario ran. The window readout is computed by the **REAL client
`rotationCursor` + `orbitWindowSlots`**, esbuild-bundled from the TypeScript the
UI imports — not a re-implementation.

```
A  client: sel (T1,T2) === no sel — 343 bytes, identical
   engine: stored the legacy 5-pair ring byte-identically; reads back
           as turns, distance 1
B  A=T3, B=T5 (distance 2):
   engine accepted the d=2 ring; reads back distance 2, phase 2 (starts at T3)
   turn 1 is exactly the operator's pick: T3 + T5
   window sequence: T3+T5 -> T4+T1 -> T5+T2 -> T1+T3 -> T2+T4 -> T3+T5
   56 settled samples, 18 mid-fade samples resolved through the real cursor
   DISTANCE KEPT: all 6 observed windows exactly 2 slots apart
   STEPS RIGHT: the window advanced exactly one slot on each of 5 transitions
   WRAP OBSERVED: A crossed T5->T1 1x; 2 windows straddled the seam
   FULL LAP: the first five turns put every staged colour on COLOUR A
C  d=1..4 all accepted; 5 pairs each, every pair d apart, round-tripped verbatim
D  no marsin_engine source change was required — the orbit is the SAME wire
```

That B sequence is the operator's sentence read back off the rig: two colours,
distance kept, rotating right, looping back over the end.

## Gates

- **Logic tests:** 22 new in `colors_window_logic.test.ts` (263 → 285) covering
  all 20 legal selections × all 4 distances, wrap coverage, the smallest-`d`
  rule, `orbitPhase` round-trip, cursor inversion on non-adjacent windows at
  three fade positions each, and rail segments including the seam.
- **Full CaptainPad suite:** **101 files / 2174 pass / 6 skipped / 0 fail**,
  failing list EMPTY. **No foreign reds** at final run.
- **`tsc --noEmit`** clean; **eslint** clean on all three touched files.
- The transient `colors_window.tsx:1156 Property 'badge' does not exist` that
  `_263` reported as foreign was **mine**, caught mid-edit between adding the
  prop's call site and its declaration. Resolved — tsc is clean.

## Files

| File | Change |
|---|---|
| `CaptainPad/components/deck/colors_window_logic.ts` | `orbitDistance`, `orbitPairs`, `turnsOrbit`, `orbitPhase`, `orbitWindowSlots`, `cursorRailSegments`, `ORBIT_DISTANCE_DEFAULT`; `turnsPairs` delegates; `rotationAutopilotPatch`/`turnsAutopilotPatch` take optional `sel`; `isTurnsConfig`/`turnsColors` read through `turnsOrbit`; `cursorRailOffset` takes `phase` |
| `CaptainPad/components/deck/colors_window.tsx` | `pairSel` moved above START TURNS; orbit adoption via `orbitPhase`; START TURNS and the scheme restage carry `sel`; lit window mapped through phase+distance; `WindowRail` takes distance+phase; A/B badges on the TURNS slots; spacing caption; a state line for "rotating a ring that is not the staged five" |
| `CaptainPad/components/deck/colors_window_logic.test.ts` | +22 tests (four new describes) |

## Hygiene

Ports 6966–6972, 5568, 6981 and 7175 were never bound, restarted or swept. No
export, no dist write, no Metro touch, no git operation. The walk engine (:17262)
is stopped; it ran entirely inside a throwaway temp world, so nothing was written
to `marsin_engine/states/**` or `simulation/scenes/**`. Concurrent waves'
territory (`hue_wheel.tsx`, the `_263` responder wiring, the mixer relayout) was
not touched — the `colors_window.tsx` hunks here are all in the TURNS transport
and slot-row region, disjoint from gesture/responder code.

## Operator check (client-only — fresh Metro reload, no restart)

1. TWO COLOUR card, latch a scheme, arm **A** and tap **T3**, arm **B** and tap
   **T5** — the badges read `A=T3 · B=T5`.
2. Switch to **PALETTE TURNS** — the five slots carry `T3 · A` and `T5 · B`
   badges, and the caption reads *"2 slot(s) apart"*.
3. **START TURNS** — the rig should begin on T3+T5 with **no jump**, then walk
   T4+T1, T5+T2, T1+T3, T2+T4 and back to T3+T5. The rail shows **two separated
   cells** travelling together.
4. Default check: with no pick made, everything behaves exactly as it did before.
