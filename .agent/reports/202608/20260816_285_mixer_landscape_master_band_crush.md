# 20260816_285 — Mixer: the landscape MASTER VIEW crush is a card BUDGET defect, not a bounded-chain defect

**Task:** debug + fix the pre-existing bug filed in `_279` §6 — landscape +
`citizen/masterBand` open crushes every channel card's `channelBody` to zero.

**Status: REPRODUCED and ROOT-CAUSED with numbers. NOT fixed — because every
fix that fits inside the two files this thread owns was MEASURED and each one
makes a different control unreachable.** The one assignment that works needs the
per-channel PIXELS band to yield height, which is exactly the allocation
`docs/69` item 3 (the patterns-first landscape card, report `_280`) is designing.
Handing it over with the full budget rather than pre-empting it in a shared
component. §6 is the decision, §7 is the recommendation.

**The filed LIKELY CAUSE is disproved.** It is not the landscape twin of the W0
portrait fix. §2 shows why the portrait mechanism cannot apply here at all.

---

## 1. Reproduced, exactly

Scratch `expo export` of the shipped tree served on `:7194`, driven headless at
iPad landscape 1194×834 and portrait 834×1194. **No live engine** — a fully
black-holed scratch engine on `:17123` (sACN pointed at the TEST-NET-1 host
the suites use — RFC 5737, never routed; `controllers []`
asserted at boot, OSC/web-client/audio/fire-sync/VSN1-deploy off, state +
playlists + timeline redirected into temp). The operator's `:6968` was never
read or written; it was still answering 200 at teardown.

Landscape, 2 visible channels, `sec/<id>/params` shown:

| State | card | `channelBody` | playlist scroller | rows | LOCAL PARAMS |
|---|---|---|---|---|---|
| MASTER VIEW closed | 517×**553** | 515×**134** | 283×56 | 0 (+1 partial) | 206×134 |
| MASTER VIEW **open** | 517×**417** | 515×**0** | **283×0** | **0** | **206×16** |

`283×0` and `206×16` are `_279` §6's own numbers, to the pixel. At 3 visible
channels it is identical in kind (`176×24 → 176×0`, params `135×102 → 135×16`).

Two further symptoms the original filing did not have numbers for, both
measured here:

- the list panel's content paints **20 pt past the body's bottom edge**, over
  the MUTE/SOLO/BUMP row (`paintsUnderMuteRow = true`);
- on the first card the **TRANSITION row is already pushed clean out of the
  card** (`transInCard = false`) and clipped by the card's `overflow:hidden`.
  So the shipped build is already ejecting a control, not merely overlapping one.

Screenshot: `C:/Users/TITANI~1/tmp/landscape_crush_fix/out_before/before_landscape_band_open.png`
— the pattern list is gone and fragments of the playlist header bleed through
the MUTE row.

**Portrait is unaffected and stays unaffected** (2 ch: body 335×364, scroller
309×158, 2 rows — byte-identical band open vs closed, because a portrait card's
height is not reduced by opening the citizen).

## 2. Why the "landscape twin of the W0 fix" hypothesis is wrong

The W0 portrait fix bounds the two body panels with `flexBasis:0 + flexGrow +
flexShrink:1`. Portrait's `channelBody` is a **column**, so that is the MAIN
axis and it governs HEIGHT — which is what made the fix work there.

Landscape's `channelBody` is a **row**. Height there comes from
`align-items: stretch`, not from flex, so the portrait constants have no purchase
on the axis that is failing. And the landscape panels are **already correctly
sized**: at a 0-height body the params panel measures `206×16`, which is its
`padding:8` top and bottom with a zero content box — i.e. it *did* resolve to the
body's height. Nothing about the panels' own flex is broken.

What escapes is the panels' **children** — the playlist card and the slider
list have their own intrinsic height and neither the panels nor the body clip.

## 3. The actual root cause: the card's height budget is over-subscribed

`styles.channelCard` is a flex COLUMN, `alignSelf:'stretch'`, so its height is
fixed exogenously by the strip row. `channelBody` carries `flex:1`
(⇒ `flexShrink:1, flexBasis:0`); **every other child is react-native-web's
default `flexShrink:0`**. So the body is the card's only shrinkable child and
absorbs 100 % of any deficit.

Measured child-by-child, landscape, 2 visible channels:

```
                        band CLOSED     band OPEN
card                        553             417
  [0] header                 53              53
  [1] PIXELS band           208             208     <-- flexShrink:0
  [2] CHANNEL fader          30              30
  [3] HUE                    23              23
  [4] channelBody  *        134               0     <-- flex:1, the only giver
  [5] MUTE/SOLO/BUMP         45              45
  [6] TRANSITION             52              52
      chrome (non-body)     411             411
```

Opening `citizen/masterBand` takes **136 pt** off the strip row, so the card
goes 553 → 417 while its unshrinkable chrome stays **411**. 417 − 411 − 6 pt of
card padding/border ⇒ **the body is entitled to exactly 0**. That is correct
flex arithmetic on an impossible budget, not a flex bug.

**The per-channel PIXELS band is 208 of those 411 pt — half the card.**

## 4. Every in-scope candidate, measured

Applied to the live DOM in the crush state and measured, so nothing here is
predicted:

| Candidate | body | rows | MUTE in card | TRANSITION in card | PARAMS stub tappable |
|---|---|---|---|---|---|
| shipped (none) | 0 | 0 | yes | **no** | **no** |
| `overflow:hidden` on body | 0 | 0 | yes | no | **no** — stub is clipped away, LOCAL PARAMS becomes **unreachable** |
| body `minHeight:64` | 64 | 0 | **no** | **no** | yes |
| body floor + containment | 64 | 0 | **no** | **no** | yes |
| **PIXELS band yields height** | **160** | **1** | **yes** | **yes** | **yes** |

- **Containment alone is not a fix.** It removes the paint-over but clips the
  28 pt LOCAL PARAMS micro-header out of existence, and that stub is the only
  affordance that re-opens the section (docs/64 §3.1: the stub always stays so
  the section is never unreachable). It trades an overlapped control for an
  absent one.
- **A body floor alone is not a fix.** Any floor > 0 pushes MUTE/SOLO **and**
  TRANSITION out of the card, because there is no slack to take it from.
- Only the last row keeps every control and gives the list rows back.

## 5. The one escape hatch inside the owned files was tested, and it fails

The band sizes its canvas from its measured **slot width**
(`clamp(slotWidth/aspect, MIN_BAND_CANVAS_HEIGHT, cap)`, `pixel_view_band_logic`
§3.2), so narrowing the band's slot — a one-line style in `mixer.tsx` — looked
like it would shrink the band aspect-honestly with no shared-file change and no
clipping. **Measured: it does not free any height.**

```
band slot width   canvas      band OUTER height   body
reset (515)       327×174           208             0
55%  (283)        281×149           208             0
45%  (232)        230×122           208             0
28%  (144)        142× 75           208             0
```

The picture shrinks correctly and is never clipped, but the band's OUTER height
stays pinned at `BAND_HEADER_HEIGHT + CHANNEL_EDIT_CAP_HEIGHT` and the surplus
is reserved as centred card ground ("any width or height left over in the slot
is card ground, not canvas"). So the band's height is **cap-driven, not
canvas-driven**, and the only lever on it is the cap itself — which lives in
`components/mixer/pixel_view_band{,_logic}.ts(x)`.

## 6. The decision this needs

**May the per-channel PIXELS band's `CHANNEL_EDIT_CAP_HEIGHT` ceiling be
lowered when a landscape card cannot afford it?**

It is the only surface in the card that is not a control, and the measurements
prove nothing else can pay. But it is a real, visible product change — the
operator opens MASTER VIEW and their per-channel pixel bands get smaller — and
it has prior art pointing the other way:

- `_279` §5 explicitly declined to shrink the landscape band unasked and
  escalated it: *"If Sina wants landscape rows more than he wants the big band,
  this is a ~10-line follow-up."*
- `pixel_view_band_logic.ts`'s own header records report `_243` fighting this
  exact budget and resolving it by **moving** the band into the vacated params
  column rather than shrinking it.

So "shrink the edit band" is a decision the codebase has twice routed to the
operator/design layer, and `docs/69` item 3 owns precisely this allocation now.
Pre-empting it inside `pixel_view_band.tsx` — which also needs its stage
restructured into a shrinkable flex child for the cap to actually bite, in a
component shared with the deck and with the perf-mode wave — is the wrong place
for this thread to make it.

## 7. Recommendation to the `docs/69` item 3 / `_280` thread

This is the substrate you asked for, and it says the landscape card cannot be
fixed by redistribution — it is genuinely over-subscribed:

- Budget at 1194×834, MASTER VIEW open, 2 visible channels: **417 pt of card,
  411 pt of unshrinkable chrome**, of which the PIXELS band is 208.
- Reclaimable ceiling: the band's floor is `BAND_HEADER_HEIGHT (28) +
  MIN_BAND_CANVAS_HEIGHT (72) = 100`, so **at most ~108 pt** can move from the
  band to the body. Body 0 → ~108 ⇒ scroller ~60 ⇒ **1 full row** at the
  measured landscape row height of **60 pt**.
- So even the maximum legal reallocation buys ONE row. A landscape card that is
  meant to show a usable pattern list with the master band open needs to shed a
  whole block, not trim one — which is the patterns-first rethink, not a tweak.

Concretely, the mechanism if you take it: give the band slot
`flexShrink:1` + `flexBasis: 28+176` + `minHeight: 28+72`, give `channelBody` a
`minHeight` floor, and make the band's channel/edit cap follow its **measured
slot height** exactly as the perf dominant-fill path already does
(`pixel_view_band.tsx` `capHeight = stageSize.height` when `isDominantFill`).
That is the same mechanism, not a parallel one — but it requires the band's
stage to become a shrinkable flex child, which it is not today.

Independent of the allocation, **containment should ship with it**: once the
body has a real floor, `overflow:hidden` on `channelBody` is what guarantees a
starved body can never again paint over MUTE/SOLO or eject TRANSITION. On its
own it is harmful (§4); paired with a floor it is the safety net. Verified safe:
every PlaylistPanel overlay is a react-native `Modal` portal, so nothing inside
the body depends on escaping its box.

## 8. What did NOT change

No source file was modified. `_274`/`_275`/`_277`/`_279` working-tree work is
untouched, no git operations were run, and `CaptainPad/dist` was never written.

Gates were therefore not run — there is no diff to gate. The `_279` baseline
numbers were re-verified incidentally by the scratch rig and **all hold**:
portrait 2 ch params-hidden **309×242/244 = 3/4 rows** (from 2), landscape 2 ch
params-hidden **283 → 374 pt**, params-shown geometry identical.

**CaptainPad rebuild: NOT required.** No engine restart.

## 9. Scratch assets (all in `~/tmp`, gitignored)

`C:/Users/TITANI~1/tmp/landscape_crush_fix/`

- `spawn_engine.cjs` — the black-holed `:17123` engine (three walls asserted at
  boot, per `.agent/memory/spawning_a_test_engine.md`). Note it must export
  `BM26_CAPTAINPAD_AUTH_REQUIRED` explicitly or the engine refuses to boot.
- `crush_measure.cjs` — the band-open/closed × orientation × params matrix.
  Counts a channel as VISIBLE only when its card has real geometry: a
  workspace-hidden channel stays MOUNTED at 0×0 (`MIXER_HIDDEN_DISPLAY`), so
  counting LOCAL PARAMS stubs over-counts and over-hides.
- `card_budget.cjs` — the §3 child-by-child card budget.
- `candidate_probe.cjs` — the §4 candidate matrix.
- `width_probe.cjs` — the §5 slot-width result.
- `out_before/`, `out_before3/` — measurements + screenshots.
