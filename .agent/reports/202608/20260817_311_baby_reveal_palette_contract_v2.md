# 20260817_311 — Baby Reveal palette contract v2: the answer follows the global colour

**Wave:** `_311`, Opus lead + 3 Sonnet slices (patterns/prose, dispatch+YAML,
gates), central review, the full battery and the operator's field retune by the
lead.
**Operator ruling, 2026-08-17:** the reveal patterns consume the **global colour
palette** — `colorPalette1` is the primary, each pattern **derives** its second
tone as *"the 1st color's very darkened"*, `colorPalette2` is no longer read, and
the handshake blackout goes away so the DECK shows these looks animating in
whatever colour is live.
**Operator field review, same day, absorbed into this wave** (§6): per-pattern
speed notes and one density note, verdict on the set overall *"great"*.
**Contract:** `docs/73_baby_reveal_unification.md` → new section **"Contract v2
(operator ruling 2026-08-17)"**, amended in place; the v1 text is left standing
as the record of why the handshake existed.

> **NOTHING IN THIS WAVE IS LIVE.** The engine loaded its pattern set at boot.
> The pending launcher bounce now carries `_300` + `_305` + `_306` **and
> `_311`**. See §8. **No CaptainPad rebuild** — this wave changed no CaptainPad
> file, for the same reason `_306` §7 documented.

---

## 1. The contract, in two sentences

A `baby_reveal` pattern now renders **`colorPalette1` and nothing else**: it
converts that one slot to an RGB triple and emits either that triple (primary) or
that triple × `DARK_K = 0.28` (the derived dark tone) or black. The two-slot
handshake, and with it the "renders black unless the show armed me" behaviour, is
gone — the safety it provided moved into the **dispatch path**, which now reads
the palette back after writing it and refuses to start the run if the write did
not land.

| | v1 (`_306`) | **v2 (this wave)** |
|---|---|---|
| slots read by the pattern | `colorPalette1` **and** `colorPalette2` | **`colorPalette1` only** (`colorPalette2` is not even exported) |
| the dark tone | a value the show had to place in slot 2 at exactly `DARK_K` | **derived** in the pattern: primary triple × `DARK_K` |
| sanctioned colours | pink or blue only, `±0.010` hue window | **any** hue — the palette *is* the answer |
| a reveal pattern on the deck | **black** | animates in the live colour |
| refusal | any handshake miss ⇒ black | **an invalid palette only** (component outside `[0,1]`) ⇒ black |
| guard against a swallowed palette write | the pattern going black | **readback verification in the runner** (§3) |
| `DARK_K` lives in | pattern block **and** both show YAMLs (coupled) | **the pattern block alone** (one place) |

## 2. `DARK_K` stays 0.28 — and that is arithmetic, not luck

The brief allowed one global retune if 0.28 failed a two-tone gate after the
derivation change. **It did not, and it could not have**, for a reason worth
recording: **v1 never rendered slot 2's colour either.** Slot 2 was a *token* —
`resolveFamily()` read it only to validate the handshake, and `emitDark` already
produced `resolvedTriple × DARK_K`. Deriving the dark tone by multiplying the
primary's RGB by 0.28 is *exactly* the same operation, because RGB scales
linearly with HSV value: scaling the triple preserves hue and saturation and
changes only value. So v2 reproduces the tone `_306` D3 measured, bit for bit,
and the whole D3 sweep (perfectly bimodal, 0 % valley at every K) carries over.

Re-measured under v2 anyway — §5. The family is still bimodal, at a 3.76–5.95 : 1
tonal step, on both models, under three different hues.

## 3. The dispatch verification — what replaces the lost blackout

The v1 refusal was load-bearing for one specific reason: **`setGlobals` swallows a
`source_lock` refusal.** `api_server.js` treats it as runtime arbitration and
continues without error, so with Live Touch holding the lock the palette write is
silently dropped. Under v1 the show then went black — recoverable. Under v2 it
would run the ceremony in **whatever colour was already loaded**, which can be the
other family's. That is the one failure worse than showing nothing, and the
operator's ruling removed the thing that used to prevent it. So the guard moved.

**Design, as landed** (`lib/special_events/special_events_service.js`):

- `_applyAction`, `case 'globals':` → `setGlobals(action.set)` is immediately
  followed by **`_assertGlobalsLanded(action.set, label)`**, and only then are the
  keys recorded into `_globalsWritten` (a refused write leaves END SHOW nothing to
  restore).
- The readback uses the **existing `captureGlobals` dep** — no new dependency, and
  it is the same capture ARM already uses. It flattens ParamCenter's **canonical**
  state, i.e. the **target** value of each param, not the `_rendered` value that
  ramps over `colorTransitionMs`. That distinction is what makes the check
  meaningful: a matching readback proves the write was *accepted*, not that a fade
  happened to finish.
- Comparison is `globalsValueMatches` at `GLOBALS_READBACK_EPS = 1e-6`: numbers by
  absolute difference, `{h,s,v}` component-wise. **Any other shape on either side
  is a mismatch** — "we could not tell" and "it did not land" fail identically.
  A missing key, a non-object return and a throwing `captureGlobals` are all
  failures.
- The error names the key, what was written, what was read back, and the likely
  cause (a `source_lock` refusal — Live Touch armed), and ends `NO FALLBACK: the
  stage refuses rather than running the show on a stale colour.`
- **Propagation, traced end to end rather than assumed** — this is the "find the
  show program's existing error surface" half of the brief:

  > `_assertGlobalsLanded` throws → the reveal's `globals` action is at
  > `delayMs: 0`, so `_dispatchActions` applied it **synchronously** (not inside
  > `_scheduleActionTimer`'s try/catch) → the throw rejects the awaited call in
  > `fire()` → a new wrapper there sets `lastError = "stage <id> refused: …"`,
  > console-errors, `_broadcast()`s and **rethrows** → `POST
  > /special-events/fire` → `sendSpecialEventError` → HTTP 500
  > `{ error: <the full message>, code: 'SPECIAL_EVENT_ERROR' }` → CaptainPad's
  > `useSpecialEvents` → `describeEventRefusal` (which passes the engine's own
  > words through verbatim) → the **`<ErrorStrip>` on the SPECIAL EVENTS tab**.

  So the operator reads the offending key, the value written, the value read back
  and the `source_lock` diagnosis on the card he is already looking at. **The run
  does not start.** The `fire()` wrapper is deliberately generic: any synchronous
  action failure, not only the palette.

`type: globals` appears today in exactly one show — this one, both scenes — so the
verification is generic in shape and reveal-only in effect.

**The recovery path, stated so nobody has to work it out on the night.** A refusal
throws before the choice's remaining actions (the white release, the master lift,
the strobe, the playlist) ever fire, so the ship simply stays in the HOLD WHITE
10 % it was already in — the ceremony does not half-run. The run's in-memory
cursor does record the reveal stage as entered, which is exactly what makes the
fix a **re-tap**: drop the Live Touch lock, then press the same colour again.
Re-firing the current stage is already legal (`isRefire`) and replays the whole
action list, palette included.

## 4. What the patterns actually do now

The shared authority block was rewritten and copied **byte-identical** into all
ten sources. Digests: **`8dae93895ac18f7cfe39ea1acec4b7c1`** over the span the
gate hashes (`export var cp1H` → `function emitPrimary`, whitespace-stripped;
v1 was `976276359e82fe633bfac5077c2bfbd2`), and
**`d37c12f938e1dc393507d77de989b312`** over the whole block including the emit
helpers. `resolveFamily()` became `resolvePalette()`; the family-triple
constants, the hue windows, the saturation floor, the `DARK_V_EPS` window and the
whole `colorPalette2` path are gone. The HSV→RGB conversion is the house idiom,
lifted from `patterns/20_parametric_sway_field.js` `_hsv2rgb1()` rather than
invented, and a `famOk` flag keeps "refused" distinguishable from "a legitimately
black palette". The block now also carries an explicit
`// ── END AUTHORITY BLOCK` terminator in **all ten** files — it arrived in five
of them during the prose pass and half-applied is exactly the drift the
byte-identity rule exists to stop, so it was made uniform.

Beyond the block and the operator's own retune (§6), **no pattern geometry
changed**: same skeletons, same thresholds, same compositions the operator has
been looking at.

### 4.1 A measured VM property that changes what "absent" can mean

The brief asked the patterns to keep refusing when `colorPalette1` is *genuinely
absent or invalid*. **Absent is not a detectable state, and this wave measured
why** rather than inheriting `_306`'s assertion:

> The VM installs its own `hsvPicker` default — **h 0, s 1, v 1**, the same triple
> the engine registry carries for `colorPalette1` — and calls the exported setter
> at program init, **whatever the declared `export var cp1H/cp1S/cp1V` say.**

Proven by substitution: four different declared defaults — `(0, 1, 1)`,
`(0, 0, 0)`, `(0.5, 1, 1)` and an impossible `(-1, -1, -1)` sentinel — all
produced **byte-identical red output** on an unpushed pattern. A sentinel cannot
survive, so no pattern can tell "nobody gave me a colour" from "somebody gave me
the engine default". An unpushed reveal pattern therefore renders **red**, not
black.

Under v2 that is coherent rather than alarming: red *is* `colorPalette1`'s
registry default, so the pattern is still doing precisely what it claims —
rendering the global palette. The refusal that remains is the **range check**, and
it is genuinely reachable and gated: an out-of-range palette renders every pixel
black on both models. The declared defaults now mirror the VM's own `(0, 1, 1)`
rather than pretending to be a refusal value, and the block says so.

**The same VM behaviour applies to SLIDERS, and that one has teeth for anyone
measuring this family offline** (found by the gate slice while cross-checking my
reference numbers): the VM installs its own slider default of **0.5** and ignores
the declared `export var`, so *any offline render that does not explicitly push
the playlist's saved values is measuring 0.5 across the board, not the operator's
saved point.* It moved `06_diamond_quilt` from 26.9 % to 29.8 % lit and
`10_celebration_burst` from 69.4 % to 75.4 % (its `sliderBurstReach` is saved at
0.64 against the VM's 0.5). Every number in §5 and §6 is taken **with the saved
playlist defaults pushed**; the gates now push them too.

In the live engine the palette question is academic anyway: every load path pushes
the real palette before the first frame (`finalizeCpcValues`, called on deck load,
playlist-entry load, overlay load and snapshot restore alike). **That call is what
makes the deck view work**, and it is why the operator's complaint is fixed.

### 4.2 One consequence worth naming out loud

On the DECK, the **colour autopilot now drives these patterns**. It writes
`colorPalette1` on its own cadence, so a `baby_reveal` look left running outside a
show will change colour when the daemon cycles. That is the ruling working as
written — "these patterns render the global colour" — and it is harmless where it
matters, because the Special Events runner already **force-disables the colour
autopilot at ARM** and restores it at END SHOW (`priorColorAutopilot`, unchanged
since `_306` §4.1). Nothing can move the palette out from under an armed reveal.

## 5. The battery — three palettes, both models, all ten keepers

Measured by the lead independently of the gate suite, **after** the §6 retune:
31 samples over 30 s, saved playlist defaults, titanic and test_bench, pink /
blue / green. **Every metric is identical to the digit across all three palettes**
— palette independence is now structural, not just twin fairness. 60 rows, all
clean: **zero foreign pixels, zero W/A/U, every keeper lit.**

| # | keeper | titanic lit / bright / dark / valley / ratio | test_bench lit / bright / dark / valley / ratio |
|---|---|---|---|
| 01 | `heartbeat_bloom` | 53.5 / 28.6 / 71.4 / 0.0 / 3.76 | 49.9 / 30.7 / 69.3 / 0.0 / 3.76 |
| 02 | `rose_unfurl` | 63.4 / 37.9 / 62.1 / 0.0 / 4.65 | 57.4 / 36.3 / 63.0 / 0.6 / 5.00 |
| 03 | `constellation_flow` | 25.8 / 31.4 / 68.6 / 0.0 / 5.03 | 27.2 / 39.9 / 60.1 / 0.0 / 5.26 |
| 04 | `bubble_chorus` | 87.2 / 65.5 / 23.9 / 10.7 / 5.51 | 60.1 / 48.2 / 42.3 / 9.6 / 5.95 |
| 05 | `ribbon_braid` | 61.6 / 32.4 / 67.0 / 0.7 / 5.05 | 45.4 / 31.7 / 67.1 / 1.2 / 5.08 |
| 06 | `diamond_quilt` (hero) | 29.8 / 67.7 / 32.3 / 0.0 / 4.77 | 31.3 / 66.9 / 33.1 / 0.0 / 4.77 |
| 07 | `tidal_terraces` | 89.7 / 51.2 / 48.8 / 0.0 / 4.35 | 89.4 / 50.1 / 49.9 / 0.0 / 4.35 |
| 08 | `comet_lullaby` | **25.9** / 67.1 / 32.9 / 0.0 / 5.03 | **37.1** / 72.8 / 27.2 / 0.0 / 4.85 |
| 09 | `lighthouse_fans` | 57.5 / 26.6 / 57.3 / 16.1 / 5.35 | 52.3 / 25.4 / 60.4 / 14.2 / 5.44 |
| 10 | `celebration_burst` | 75.4 / 36.3 / 63.3 / 0.3 / 5.56 | 71.1 / 52.3 / 47.7 / 0.0 / 5.44 |

Gate floors are bright ≥ 25 %, dark ≥ 20 %, valley ≤ 20 %, ratio ≥ 2.0. **Tightest
margins, named rather than rounded away:** `09_lighthouse_fans` at **25.4 %**
primary mass on the bench (floor 25) and **16.1 %** valley on titanic (ceiling
20); `04_bubble_chorus` at **23.9 %** dark mass on titanic (floor 20).
`09_lighthouse_fans` therefore keeps the title `_306` §13 gave it — the one keeper
with no headroom on two independent metrics at once.

Some numbers differ from `_306` §5's table beyond what v2 or the retune explains
(`04_bubble_chorus` 25.0 → 87.2 % lit, `10_celebration_burst` 45.8 → 75.4 %). Two
causes, both measurement rather than pattern: `_306` measured those two keepers
*before* its own coverage fixes edited them, and it measured at the VM's 0.5
sliders rather than the saved defaults (§4.1).

### 5.1 The deck-view proof

Under a **green** global palette (`h 0.333333, s 1, v 1`) at saved defaults, every
keeper on both models renders with **`maxR = 0` and `maxB = 0`** across the whole
capture — pure green and dark green, and nothing else, on every lit pixel. All ten
are lit. That is the operator's complaint, measured as fixed: the reveal looks now
show up in the deck's live colour and stay one colour family while doing it. It is
also a landed gate now (§7, the deck-usability gate).

## 6. The operator's field retune (absorbed into this wave)

Sina reviewed the set on the rig — overall verdict *"great"* — with per-pattern
notes. All of them are applied the `_305` way: **the factor goes into the
pattern's INTERNAL base rates, never into the saved sliders**, so the playlist
still loads at the reference operating point the family is authored to (global
SPEED 25, `sliderLocalSpeed` 0.30, composed 0.4225×). Each pattern's `// SPEED`
comment block carries its new arithmetic and the pre-retune numbers.

| # | keeper | factor | basis | knob |
|---|---|---|---|---|
| 01 | `heartbeat_bloom` | **×0.45 — ESTIMATE** | *"toooooo fast"*, no number given | the two `beforeRender` rates: `1.4675 → 0.6604` (beat), `0.45 → 0.2025` (shimmer) |
| 02 | `rose_unfurl` | — | "great" | untouched |
| 03 | `constellation_flow` | ×1.15 | operator | `0.05 → 0.0575` (drift), `4.5 → 5.175` (twinkle) |
| 04 | `bubble_chorus` | — | "great" | untouched |
| 05 | `ribbon_braid` | ×1.15 | operator | `0.045 → 0.05175` (braid), `0.5 → 0.575` (shimmer) |
| 06 | `diamond_quilt` | ×1.15 | operator | `QUILT_BASE_RATE 0.059 → 0.06785` |
| 07 | `tidal_terraces` | ×1.70 | operator | `TIDE_BASE_RATE 0.059 → 0.1003`, `SHIMMER_BASE_RATE 0.79 → 1.343` |
| 08 | `comet_lullaby` | density, not speed | *"too little blue"* | §6.2 |
| 09, 10 | — | no feedback | untouched |

**`01_heartbeat_bloom`'s 0.45× is the only estimate in the table** and is flagged
as such in the file itself. The operator asked for "slower" without a number; 0.45
lands the beat at **0.279 beat/s ≈ 16.7 bpm** at reference (it was 37 bpm), a slow
deliberate pulse. If the rig says otherwise, the two numbers to move are named in
the file's `// SPEED` block.

### 6.1 Probe verification, and the false negative on the way there

Each factor was verified **empirically**, not just arithmetically, by rendering
the pre-retune and post-retune sources side by side at saved defaults and
comparing the **mean per-pixel frame-to-frame delta** (which scales linearly with
clock rate for an unchanged composition):

| keeper | measured | intended |
|---|---|---|
| `01_heartbeat_bloom` | **0.485×** | 0.45× |
| `03_constellation_flow` | **1.140×** | 1.15× |
| `05_ribbon_braid` | **1.181×** | 1.15× |
| `06_diamond_quilt` | **1.154×** | 1.15× |
| `07_tidal_terraces` | **1.689×** | 1.70× |

01's 8 % residual is the double-thump envelope's nonlinearity under this metric,
not a mis-scaled clock — its constants are exactly 0.45×.

Worth recording because it nearly produced a wrong conclusion: **the first probe I
built measured whole-rig brightness peak spacing, and it reported 1.00× for
`03_constellation_flow` and 0.85× for `07_tidal_terraces`** — i.e. "the retune did
nothing". Both readings were artefacts. The peak detector was locking onto the
fast cosmetic texture rather than the structural clock, *and* my first pre-retune
copies had reverted only one of each pattern's two clocks, leaving the cosmetic
one at its new rate in both halves of the comparison. Fixed both; the table above
is from the corrected run. A probe that disagrees with exact arithmetic is a
suspect probe first.

### 6.2 Runaway analysis at the legal maximum — and two ceilings now touched

Re-run for all five retuned keepers against `docs/73` §4.2's two ceilings at the
**legal maximum** (global SPEED 100 *and* local 1.0 = 18.93× the reference, the
absolute extreme the knobs allow):

| keeper | reference period | legal-max period vs the 2 s ownership ceiling | legal-max per-frame step vs the 2 % aliasing ceiling |
|---|---|---|---|
| 01 | 3.58 s / beat | 0.19 s — n/a (soft 0.16-wide shell bands, not an ownership front) | **6.6 %** of the 2.0 wrap — **halved** by the retune (was 14.7 %) |
| 03 | 41.2 s web reshape | 2.17 s ✓ | 0.58 % ✓ |
| 05 | 45.7 s / braid cycle | 2.42 s ✓ | 0.52 % ✓ |
| 06 | 34.9 s | **1.84 s — inside the 2 s ceiling** | 1.36 % ✓ |
| 07 | 23.6 s riser | **1.25 s — inside the 2 s ceiling** | **2.01 % — marginally over** |

**Both breaches are recorded, not smoothed over, and neither was silently
clamped** — the operator gave explicit numbers after watching the rig, and
second-guessing them into a "safe" value would have been a fallback. Both ceilings
describe an operating point 18.93× faster than the one the show runs at, and the
playlist loads at the reference point. `07_tidal_terraces` at 2.01 % of a period
per frame is the single number to bring back down if the terraces ever alias under
a hard-driven global speed knob; it is called out in that file's `// SPEED` block
in those words.

### 6.3 `08_comet_lullaby` — "too little blue"

This was the sparsest keeper in the family by a wide margin (12.0 % of titanic
lit), and on the rig that reads as not enough of the answer's colour on the ship.
Three levers, all preserving "comets sailing through black":

- world-path head radius **0.30 → 0.52**, tail radius **0.19 → 0.34** (sign face
  0.26/0.16 → 0.44/0.29 to match);
- the tail's ghost samples **3 → 5**. The tail was three dots covering lag
  0.14–0.42 of a ~0.97 window, so the "long dim tail" the keeper is named for was
  mostly missing.

**Six or more ghost samples is dead work, and it was measured as such:** the ghost
weight is `(1 − lag / lagMax)`, so a sample at lag ≥ 0.80 weighs under the 0.18
tail threshold and can never light a pixel — a seven-sample build rendered
byte-identically to five. That is now a comment in the file, so nobody spends the
per-pixel cost again.

| | before | after |
|---|---|---|
| titanic lit | 12.0 % | **25.9 %** |
| test_bench lit | 16.8 % | **37.1 %** |
| bright / dark / valley / ratio (titanic) | 50.8 / 47.9 / 1.3 / 5.53 | **67.1 / 32.9 / 0.0 / 5.03** |
| named-region coverage (200 s, 24 regions) | 100 % ever-lit, 0 permanently dark | **100 % ever-lit, 0 permanently dark** |

More than double the colour on the ship, the two-tone histogram improved (the
1.3 % valley closed to zero), purity still exact, and 74 % of the rig is still
designed black — it is a fuller constellation, not a wash. Coverage was
re-measured over 200 s / ~4 full orbits against the named-region registry
(`tools/titanic_model/regions.mjs`, `measureNamedRegionCoverage`) both before and
after: no region is ever permanently unlit, which is the `_305` §4 failure shape
this keeper was always closest to.

### 6.4 A second live TASK #69 miscompile, found while retuning — `04_bubble_chorus`

The tracker's refined task #69 rule ("any call to a user function with internal
`var`s gets its own named variable before use in arithmetic") arrived mid-wave, so
I scanned the whole family for the shape. It flags **ten** sites: one in
`01_heartbeat_bloom` and nine in `04_bubble_chorus`.

**`01` is a false positive**, and that is worth recording as a refinement of the
trigger: rewriting its `beatPulse(...) * 1.0 + beatPulse(...) * 0.72` to named
variables renders **byte-identically** (0 differing bytes over 49 sampled frames).
Its locals sit behind early `return`s.

**`04` is real, and it is load-bearing for how that keeper currently looks.**
`popEnvelope` declares a local `var` and is called non-leading in six radius lines
plus three sign lines. Two *independent* rewrites — extract-to-named-variable, and
strip the local `var` out of `popEnvelope`'s body — render **byte-identically to
each other** and differ from the shipped file on **40.6 % of all emitted bytes**
(max delta 226/255). So the pop envelope is **dead**: the radii are not breathing
between 0.30× and 1.00× of `rBase`, they are driven by a corrupted value above
2.0× (a static-radius control at 2.0× still measures less lit than the shipped
file). That is why this keeper measures **87.2 %** of titanic lit rather than the
~25 % its design intends — the "big soft bubbles over black" is currently a wash.

**It is deliberately left as it renders, and loudly commented at the site.**
Correcting the shape alone makes the pattern fail the coverage law `_306`
explicitly fixed it to satisfy:

| `04_bubble_chorus` | titanic lit | permanently dark named regions (200 s, 24 regions) |
|---|---|---|
| shipped (miscompiled) | 87.2 % | **0** |
| correct arithmetic, authored radii | 9.5 % | **11** |
| correct arithmetic, `rBase` × 1.8 | 22.9 % | **4** |

`_306`'s coverage audit passed *because* the miscompile inflated the radii. Fixing
it properly means re-tuning the field geometry against
`measureNamedRegionCoverage` — a focused wave, not a tail-end edit to a
palette-contract wave, and the operator has approved how this keeper looks today
(he called it "great"). Follow-up in §11, and the file now carries the full
measurement so nobody "tidies" those six lines without reading it. **Stated
plainly: this pattern's appearance currently depends on a compiler bug and will
change the day the VM is fixed.**

## 7. Gates

| suite | result |
|---|---|
| `tests/patterns/baby_reveal_contract.test.js` (rebuilt) | **13 / 13** |
| `tests/patterns/baby_color_contract.test.js` | **14 / 14** |
| `tests/special_events/baby_reveal_palette_dispatch.test.js` (5 → 10 tests) | **10 / 10** |
| `tests/special_events/show_schema.test.js` | **39 / 39** |
| `tests/special_events/effect_release_passthrough.test.js` | pass |
| `tests/timeline/baby_reveal_sequence.test.js` | **5 / 5** |
| the four special-events + timeline files together | **62 / 62** |
| full `tests/special_events/` | **122 / 125** (the 3 are the known foreign `wedding_*` reds) |
| full `tests/timeline/` | **449 / 449** |

Everything above was re-run by the lead **after** the §6 retune, not only by the
slices before it.

What changed in the gates, against `docs/73` §6:

- **G1 purity** is now **relative to the armed palette's hue**, computed in-test
  from HSV by a second, independent implementation (never read out of the
  authority block), run under pink / blue / green × both models, keeping the
  zero-tolerance `assert.equal(foreign, 0)`.
- **G2 refusal** is invalid-palette cases only — `(-1,-1,-1)`, `(0.5, 1.5, 1.0)`,
  `(0.5, 1.0, -0.2)`, `(1.4, 1.0, 1.0)` — exactly black in every sampled frame on
  both models; and the **converse**, now the load-bearing half, loops all three
  palettes: an ordinary palette lights the rig.
- **G3** keeps the `DARK_K` ↔ `colorPalette2.v` cross-file assertion but re-states
  it as a **mirror check** (a drifted mirror is documentation that lies), not a
  handshake the patterns validate. `colorTransitionMs === 0` and the known-family
  hue check stay.
- **G5 two-tone** measures the **derived** tone, under green as well as pink, at
  saved playlist defaults.
- **NEW — deck-usability gate.** Green at saved defaults on both models: lit
  fraction ≥ 5 % **and** literally `R === 0 && B === 0` on every lit pixel. This
  is the gate that would have caught the operator's complaint.
- **New structural assertions:** every pattern exports `colorPalette1` and
  **must not** export `colorPalette2`; the two family RGB triples are absent from
  the **whole file**, not just the body.
- **`baby_color_contract`** had a v1 rule of its own — "`baby_reveal` MUST export
  `colorPalette2`", asserted at both source and compile level — which failed hard
  on all ten keepers. Inverted, with its four now-false comment blocks corrected.

Four new dispatch tests cover the verification itself, driven against the shipped
YAML with a stateful fake ParamCenter seeded to a **stale** palette (`h 0.8`) so a
swallowed write reads back as the *wrong colour* rather than as a gap: a fully
swallowed write throws naming the key and `source_lock`; a partially swallowed one
(`colorPalette1` dropped, `colorTransitionMs` landed) throws naming that key and
both values; a clean write does not throw and records all three keys; an
unreadable ParamCenter refuses.

## 8. Restart — what the operator has to do

1. **ENGINE / LAUNCHER BOUNCE REQUIRED.** Nothing here is live. The pending bounce
   now carries `_300`'s tease rebuild, `_305`'s renumber+retune, `_306`'s whole
   answer set and **`_311`'s palette contract v2 plus the field retune**. Bench
   arm-marker check first, per standing order.
2. **No CaptainPad rebuild** — zero CaptainPad files touched.
3. Runtime-state residue in `marsin_engine/states/*/deck_state.yaml` is left alone
   by instruction, as always.

## 9. Operator preview steps

1. Bounce the launcher.
2. **Open any `baby_reveal` pattern on the DECK, with no show armed.** It now
   animates in whatever colour the deck's palette is set to — turn the colour
   wheel and the whole look follows, primary and dark tone together. That is the
   fix; it needs no show, no arming and no special step.
3. Re-judge the five retuned keepers at the deck's normal speed: **01** (now
   markedly slower — the estimate), **03 / 05 / 06** (+15 %), **07** (+70 %). And
   look at **08** specifically: it now carries more than double the colour it did.
4. ARM the Baby Reveal show and run it exactly as before. Tap **BABY PINK** or
   **BABY BLUE**: the palette write lands at t = 0, is verified, and
   `06_diamond_quilt` rises under the white bloom at t = 2700 ms.
5. Test the correction — tap the other colour. The ship changes family and keeps
   playing the same ten looks.
6. **To see the new refusal work:** arm Live Touch so it holds the param lock,
   then fire a reveal choice. The show refuses with a named error on the SPECIAL
   EVENTS card instead of running the ceremony in the wrong colour; drop the lock
   and tap the same colour again to recover.

## 10. Files touched

**Modified** — `docs/73_baby_reveal_unification.md` (banner + the new "Contract
v2" section; v1 text untouched); `marsin_engine/patterns/baby_reveal/*.js` (10 —
the shared authority block, stale header prose in 01–05, and the §6 retune in
01/03/05/06/07/08); `marsin_engine/patterns/baby_reveal/README.md`;
`marsin_engine/lib/special_events/special_events_service.js`;
`simulation/scenes/{titanic,test_bench}/special_events/baby_reveal.yaml`
(comments only — the action lists are byte-for-byte the `_306` ones);
`simulation/scenes/titanic/timeline/playa_default.yaml` (comments only on the two
Baby cues); `marsin_engine/tools/pattern_audio_harness.mjs` (one stale comment);
`marsin_engine/tests/patterns/baby_reveal_contract.test.js`;
`marsin_engine/tests/patterns/baby_color_contract.test.js`;
`marsin_engine/tests/special_events/baby_reveal_palette_dispatch.test.js`;
`marsin_engine/tests/timeline/baby_reveal_sequence.test.js`.

**Not touched, by instruction** — `patterns/baby_tease/**`, `patterns/crisp/**`,
Live Touch / `touch_control`, deck and mixer `tsx`, all of CaptainPad, the
launcher, deployment, `marsin_engine/states/**`, and the engine beyond the
dispatch verification. No playlist file changed: the retune is internal, so the
saved defaults still name the reference operating point.

**Scratch, outside the tree** — `C:/Users/TITANI~1/tmp/reveal_v2/` (the block
prototype, the VM-default substitution experiments, the 60-row battery, the green
deck-view proof, the five 08 density candidates, the pre/post retune probes).

## 11. Follow-ups

1. **`_306`'s gallery follow-up needs restating, because its premise was wrong.**
   `tools/playlist_gallery/generate.mjs` **does** have a palette concept — a
   `--palette <id>` flag — but it hard-requires **both** `colorPalette1` and
   `colorPalette2` exports and resolves against `config.yaml`'s `colorPalettes`,
   which are two-hue **duets** (`c1`/`c2` as two hues at `s:1 v:1`). Neither shape
   fits a v2 reveal pattern, which reads one slot and derives the rest. The real
   follow-up is a **single-hue passthrough** for this family. Until then a
   `baby_reveal` gallery would render **red** (the VM default) rather than black —
   different symptom, same blocked state, and `docs/pattern_gallery` still carries
   no `baby_reveal` entry (a gate asserts it must not).
2. **P0 CANDIDATE — `04_bubble_chorus` renders a TASK #69 miscompile (§6.4).**
   Two independent rewrites agree byte-for-byte and differ from the shipped file
   on 40.6 % of emitted bytes; the pop envelope is dead and the radii are driven
   by a corrupted value. Correcting the shape alone drops it to 9.5 % lit with
   **11 permanently black named regions**, so the fix is: correct the six radius
   lines *and* re-tune the field geometry against `measureNamedRegionCoverage`
   until coverage is clean again, then re-run the two-tone and distinctness
   gates. Everything needed is measured in §6.4 and commented at the site. This
   is also the **second confirmed live instance** of task #69 and the first where
   the bug is load-bearing for a shipped look — useful evidence for the
   fix-the-compiler-vs-lint-and-sweep decision, and a reason to run the scanner
   (`C:/Users/TITANI~1/tmp/reveal_v2/scan69.cjs`) across every pattern family.
   Note the refinement it produced: `01_heartbeat_bloom` matches the shape but
   renders byte-identically when rewritten, so locals behind early `return`s
   appear not to trigger it.
3. **`09_lighthouse_fans` remains the thinnest keeper**, now at 25.4 % primary
   mass on the bench against a 25 % floor and 16.1 % valley on titanic against a
   20 % ceiling, plus `_306`'s anti-bilateral max `P` 0.643 against 0.65. Widening
   its blade duty cycle buys margin on all of them at once. It took no operator
   note this round, so it was left alone.
4. **`07_tidal_terraces` sits marginally over the legal-maximum aliasing ceiling**
   after the ×1.70 (§6.2). Nothing to do at the show's operating point; named so
   it is not rediscovered.
5. **`01_heartbeat_bloom`'s 0.45× is an estimate** awaiting a rig eye (§6).
6. **Foreign reds, none of them this wave's** — both audited rather than waved
   past:
   - `tests/patterns/playlist_gallery_tool.test.mjs` is **15/16**: "Ambient
     gallery carries Crisp autoplay evidence for every named hull wall" fails
     34 vs 53. An ambient/Crisp gallery assertion; nothing here touches ambient,
     Crisp or `docs/pattern_gallery`.
   - `simulation/tests/pattern_manifest.test.js` is **4/6**: the tracked manifest
     carries eight `uv_only/*` ids and `patterns/uv_only/` does not exist on disk
     — the concurrent `_313` UV wave, mid-flight. The two tests that would catch a
     Baby regression both **pass** ("every manifest id resolves to a source file
     on disk", "every curated playlist entry in every scene names a registered
     pattern"), and this wave added and removed no pattern file, so no manifest
     regeneration was needed or done.
   - `tests/special_events/wedding_show.test.js` stays **15/18** on the four
     missing titanic `wedding_*` playlists — foreign to `_306` and to this wave.
