---
name: 20260805_1_touch_control_and_nx_sweep_audit
type: report
created: 2026-08-05
---

# `_1` — TOUCH CONTROL tab, two five-colour patterns, and a rig-wide audio-reactivity audit (2026-08-05)

**What this is.** A full record of one working session. Three things came out
of it: a new **TOUCH CONTROL** tab in CaptainPad (additive — no existing tab,
hook, or endpoint was changed), two new **five-colour patterns**, and — the
part most likely to matter to the project — the discovery that **the Titanic
model has a 25% dead zone along its X axis**, which measurably suppresses audio
reactivity in every pattern that sweeps brightness across X.

**Read §3 first if you read nothing else.** §3 is the rig finding and the
library-wide audit. §1–2 are what was built; §4 is what was deliberately NOT
changed; §5 is a set of environment traps that cost real time this session and
will cost the next agent the same time if they are not written down.

**Ownership note.** Everything built here is in files that are new/untracked.
The only tracked file changed is `CaptainPad/app/(tabs)/_layout.tsx`, +15
lines / −0, registering the new tab. **No existing pattern of Sina's was
modified** — see §4 for the eight that arguably should be, and why they were
left alone.

---

## 1. TOUCH CONTROL tab (CaptainPad)

A manual, hands-on lighting surface. Colour on the left, motion on the right,
effects along the bottom. Everything on it is gated behind a **master ARM
switch**: unarmed, the tab writes **nothing** to the rig (proven at the network
layer — see §6).

### 1.1 The pattern browser

A **PATTERNS** sheet listing every pattern the engine reports (70 at time of
writing), grouped into seven families — SIGNATURE, BEAT + EDM, GEOMETRY,
AMBIENT, OCEAN, WHITE ONLY, UTILITY — with a search box and a one-line
description of each.

**Descriptions had no source in the API.** `GET /list-patterns` returns names
only; there is no description field anywhere. The prose exists only in each
pattern file's header comment, which a browser cannot read, and fetching 69
sources to populate a list would be 69 round trips on a playa laptop. So the
blurbs were written from those headers and ship with the app as a static
catalog (`CaptainPad/components/touch_control/pattern_catalog.ts`).

**The catalog is a snapshot, not the source of truth.** The engine decides what
exists. A pattern the engine reports that the catalog has never heard of is
still listed, shown honestly as having no description on file — never given an
invented one. A catalog entry the engine does not report is dropped.

**Each row states how many of the tab's five colour dots it can actually
take.** That was read off the real `export function colorPalette1/2` and
`export function sliderHue3/4/5` declarations **with comments stripped** —
`60_white_wash` mentions `colorPalette1` in its header only to explain that it
deliberately does *not* export it, so a plain text search gets it wrong.
Current counts: **59 two-colour, 9 colour-ignoring, 2 five-colour.**

### 1.2 The colour schemes

Three generator buttons, defined by what the operator wants them to look like:

| Button | Meaning | Construction |
|---|---|---|
| **HUE** | one colour, five brightnesses | one hue+saturation, values `1.00 / 0.78 / 0.58 / 0.40 / 0.25` |
| **COMPLEMENT** | five that go together | analogous — five hues 30° apart across a 120° arc |
| **CONTRAST** | five that clash | even pentad, 72° apart (reaches 144°) |

The HUE steps are uneven **on purpose**: perceived brightness is roughly the
square of linear value, so evenly-spaced numbers look bunched at the top.
Nothing lands below the tab's 10% brightness floor.

**A bug worth recording.** COMPLEMENT was originally built as an *opposition*
scheme with offsets `[0, 180, -20, 200, 20]`. That has a **20° minimum
separation** — three of the five hues sat inside a 40° span. Because slots 3-5
are forced to share one saturation and value (see §1.3), two fully-saturated
LEDs less than ~30° apart do not read as two colours; they read as one colour
someone got slightly wrong, and they muddy where they meet. There is now a
hard `MIN_HUE_SEPARATION_DEG = 30` floor with a test that sweeps the entire
wheel for every hue-varying scheme, plus a regression test proving the old
offsets would fail it.

### 1.3 Per-slot brightness had to be plumbed

**The constraint.** Colour slots 1-2 are the engine's own `colorPalette1/2` and
carry full HSV, so they reach every pattern. Slots 3-5 are tab-local, and the
tab was writing only `setDeckChannelControl(id, c.h)` — **a hue and nothing
else**. Patterns rendered them at colour 1's value. So "the same colour at five
brightnesses" was structurally impossible on three of its five slots.

**The fix.** `PATTERN_VAL_CONTROLS` → `sliderVal3/4/5`, written alongside the
hue sliders, and the matching exports added to the two five-colour patterns.
**Optional and additive:** a pattern that declares only the hue sliders is
unchanged and simply keeps showing slots 3-5 at colour 1's brightness. The tab
writes what the running pattern actually exposes and fakes nothing.

---

## 2. Two new patterns

Both are new files, neither replaces anything.

**`66_five_colour_prism`** — the rig is divided into five colour zones, each
holding a different operator-chosen colour, and the five slowly rotate between
zones so every colour visits every part of the ship.

**`67_five_colour_stations`** — the inverse. The ship is read as five *named
stations* and **every station carries all five colours at once**, in blocks
that march along it.

**Stations are chosen by `sectionId`, not by coordinates**, because the
Titanic's named areas do not separate on any single axis — measured from
`models/titanic.js`, the front and back walls overlap almost completely in
`nx`, and Left Front Wall, Left Back Wall and both rail runs are *flat* in
`nz`. The mapping covers all 964 px:

| station | sectionIds | px |
|---|---|---|
| BOW | 401, 408 walls · 403, 410 rails · 18, 21, 24, 25 hull | 388 |
| STERN | 406, 407 walls · 411, 412 rails · 19, 20, 22, 23 hull | 388 |
| STACKS | 402, 409 stacks · 413, 414 small stacks | 24 |
| DECKS | 404, 405 auditorium | 16 |
| SIGN | 3 (TE Sign + TE Sign 2) | 148 |

Any other model maps by `sectionId % 5` — a defined, deterministic rule, so the
pattern is rig-agnostic and still runs on `test_bench`.

The colour-block size is an operator control (`sliderSplit`, 1–12 px, default
3) because the smallest station is the 16 px auditorium pair; at 3 px it still
fits all five. **The two 4 px small smokestacks cannot show five colours at
once** — four LEDs cannot hold five hues — and the marching rotation is what
carries the rest through them over time.

Both patterns paint a pixel with **one** of five pre-converted RGB triples and
never interpolate between two hues, so a pixel can only ever show a colour the
operator actually picked.

---

## 3. THE RIG FINDING — a 25% dead zone on the X axis

**This is the part with consequences beyond this session.**

### 3.1 The measurement

Pixel distribution of `models/titanic.js` (964 px) in 20 bins per axis:

```
nx:   3   1   0   9 118  80 131 140   0   0   0   0   0  59 154 115 112  38   2   2
ny:   8   0   6  54  40  16  79  18  94  21  75 101 104 115  11  35  41  52  51  43
nz:   2   0   2   2  44  50  34  88  35  39 108  35 115  18  65  46  80  47  64  90
```

| axis | empty bins | longest contiguous empty run |
|---|---|---|
| **nx** | 6 / 20 | **5 bins = 25% of the sweep** (nx 0.40 → 0.65) |
| ny | 1 / 20 | 1 bin (5%) |
| nz | 1 / 20 | 1 bin (5%) |

**Consequence.** A brightness feature swept along X lights anywhere from **0 to
154 pixels** depending only on *where it currently is*. Total rig brightness
therefore swings hard for a reason that has nothing to do with the music — and
total brightness is the budget the audio is supposed to own. The offline
harness measures `corr(signal, total brightness)`, so that positional swing
directly suppresses the measured reactivity of the audio mapping.

**Y and Z are fine.** Only X-swept brightness is exposed.

### 3.2 Proven causally on two patterns

Both new patterns originally swept their crest across `nx`. Moving the crest to
travel along the **strand** (periodic in `index`, so a constant *fraction* of
the rig is lit at every phase) — changing nothing else — produced:

| pattern | micLow | micKick | micFlux | micHigh | peak |
|---|---|---|---|---|---|
| `66` before | 0.37 | −0.04 | 0.36 | 0.17 | 201 |
| `66` after | **0.63** | **0.74** | **0.52** | **0.50** | 236 |
| `67` before | 0.30 | −0.04 | 0.35 | 0.17 | 201 |
| `67` after | **0.63** | **0.76** | **0.50** | **0.50** | 236 |

All four modulators REACTIVE on both. These are currently the only two patterns
in the library at 4/4.

**Side effect that must not be "fixed" back:** with the crest brightness-neutral,
the harness reports `LOW-VARIATION` at silence, because total brightness is now
deliberately flat. The rig is **not** static — measured per-pixel change per
frame at silence is 0.13 at `localSpeed` 0 and 1.36 at 1 (a 10.7× range), and
with audio mapped `TOTAL_BRI` swings 74k–181k and reads ANIMATING. Both headers
carry this note.

### 3.3 The library-wide audit

Every pattern was run through the offline harness **twice** — on `titanic` and
on `test_bench` — using **each pattern's own declared `AUDIO_MODULATION_V1`
map**, because a shared mapping would fail patterns for the wrong reason.
**Zero compile failures across all 70.**

Six patterns declare no audio map and were not scored: `27_swipe`,
`calib_swipe_left_right`, `calib_swipe_up_down`, `rainbow`, `test_const`,
`test_dualband`.

**Headline: this is mostly NOT a Titanic problem.**

| | titanic | test_bench |
|---|---|---|
| PRIMARY below the 0.5 bar | **40 / 64** | **34 / 64** |
| mean PRIMARY corr | 0.43 | 0.45 |

So **32 patterns are weak on both rigs** — a separate, pre-existing issue that
the X dead zone does not explain and that this session did not diagnose.

**Eight are genuinely rig-specific** — they clear the bar on `test_bench` and
fail it on the ship:

| pattern | test_bench | titanic | drop |
|---|---|---|---|
| `40_lissajous_weave` | 0.60 | **−0.33** | 0.93 |
| `33_aurora_breath` | 0.69 | 0.13 | 0.56 |
| `01_cylon_sweep` | 0.70 | 0.26 | 0.44 |
| `36_orbital_pulse` | 0.83 | 0.45 | 0.38 |
| `03_dual_axis_crush` | 0.54 | 0.20 | 0.34 |
| `26_dom_dancers_chevron` | 0.50 | 0.36 | 0.14 |
| `44_biolume_swell` | 0.51 | 0.38 | 0.13 |
| `37_chevron_chase` | 0.52 | 0.49 | 0.03 |

Two go the other way (better on titanic than on the bench): `38_prism_helix`,
`42_phyllotaxis_spiral`.

**Mechanism confirmed for the two largest drops by reading the source:**

- `01_cylon_sweep`: `var nx = clamp01(x); var dist = abs(nx - eyePos);` —
  brightness is literally a distance from a moving point on X.
- `40_lissajous_weave`: `var ddx = nx - curX[kk]` → `bri = 1/(1+(dist*sharp)^2)`
  — brightness is distance to a curve in the (nx, ny) plane. It also
  re-normalizes x for some fixtures via `(x - 0.135)/(0.812 - 0.135)`.

**Not confirmed per-pattern for the other six.** They are consistent with the
mechanism, but only the *symptom* was measured there.

### 3.4 Two hypotheses that the data killed

Recorded because they look plausible and will otherwise be re-tried:

- **"It's brightness saturation."** No. 71% of *strong* patterns peak at 255
  versus 80% of weak ones — no discriminating signal at all.
- **"A regex can find who sweeps X."** No. A static scan for x-aliases in
  brightness expressions did not separate victims from controls; patterns that
  score fine reference `x` just as much. Reading the source is what settled it.

---

## 4. What was deliberately NOT changed

**The eight patterns in §3.3 are Sina's tracked files and were left alone.**
Each fix changes how the ship looks — `01_cylon_sweep`'s entire identity *is*
the eye travelling across X, so making its brightness position-independent is a
visual redesign, not a silent repair. That is an operator decision.

If they are to be fixed, the proven recipe is in §3.2: keep the pattern's
geometry and colour exactly as they are, and change only the coordinate the
*brightness* feature travels along — from `nx` to a strand-periodic phase
(`index / PERIOD + phase`, fed through `wave()`). Suggested priority is by drop
size; `37_chevron_chase` at 0.03 below the bar is not worth touching.

**Also not done:** the 32 patterns weak on both rigs were not investigated. The
cause is unknown and is a bigger question than this session's scope.

---

## 5. Environment traps (cost real time — please keep)

**Aborting an in-flight request to the Expo dev server tears down the whole
stack.** `:6967` crashes with `Cannot pipe to a closed or destroyed stream`, and
because the launcher supervises all children, it then stops sim, engine and
companion too. A `curl --max-time 3` poll loop and a puppeteer navigation
timeout each caused a full teardown this session. **Never probe `:6967` with a
short timeout**; warm it with one untimed request before driving it, and give
puppeteer a large `protocolTimeout`.

**Metro does not pick up CaptainPad source changes in this environment.** Three
separate UI changes were invisible in the running app until a full
`node launcher.js stop && node launcher.js dev`. **Checking the SSR html does
not reveal this** — the server-rendered page contains only the initial screen,
so pattern titles and sheet contents are absent whether the bundle is fresh or
stale. Verify against the **JS bundle** instead:
`/node_modules/expo-router/entry.bundle?platform=web&dev=true...`, then grep for
a string you just added. (Possibly related: `scripts/start.mjs` deletes `dist/`
on startup with the comment that a stale `dist` crashes the Metro file watcher
on Windows. A `dist/` created and deleted mid-session may have broken the
watcher for that session.)

**`/ws/viz` is a 100-pixel PREVIEW of the 964-pixel rig.** Roughly 10 rig
pixels per preview pixel, averaged. It therefore **cannot** be used to test
palette purity or anything with fine spatial detail: 3-px colour blocks smear
into in-between hues, and `66_five_colour_prism` shows **81 distinct hue
buckets** through that bus despite painting only five colours. Two "failures"
this session were this instrument, not the patterns. Palette purity must be
proven offline against the real model (the harness capture *is* full
resolution).

**The deck playlist autopilot can move `activePattern` on its own.** `cursor`
was found at 30 with `autopilot.active:false`. "The pattern did not change" is
therefore not a sound assertion for a gate test; assert at the network layer
(did the client issue a write at all) instead.

---

## 6. Verification performed

**Offline (real 964-px titanic model, real MarsinVM):**

- `67`: every one of the five stations showed all five colours in **every one
  of 96 frames**; the whole capture contained **exactly 5 hue clusters**, each
  within 0.2° of a configured colour — no off-palette hue.
- Silence-safe on both new patterns (964/964 lit, `darkFrac` 0.00).
- `localSpeed` genuinely drives motion (10.7× range) and still creeps at 0.
- `sliderSplit` measured at 1 / 3 / 12 px block sizes.
- Rig-agnostic path exercised on `test_bench` (166 px) — compiles, all lit.

**Live (full stack: sim + engine + companion + CaptainPad):**

- Pattern browser — 14/14: 70 of 70 listed and grouped, search filters, an
  **unarmed tap issues zero engine writes** (proven by puppeteer request
  interception, not by state comparison), an armed tap really changes
  `activePattern`, and the operator palette survives a pattern load.
- Five-colour wiring — 9/9: `sliderHue3/4/5` + `sliderVal3/4/5` exposed, Touch
  Control drove colours 3-5 exactly, all five live on the ship, 90% of lit
  pixels within 12° of a chosen colour.
- Colour schemes — 8/8: HUE returned one hue at five descending brightnesses;
  COMPLEMENT a 120° family 30° apart; CONTRAST a 144° spread.

**Static:** 1020 CaptainPad unit tests pass, `tsc --noEmit` clean.

**Not verified:** individual colour blocks were not resolved in a sim render —
the renderer shows flood-lit geometry with bloom, so hues cannot be counted
from a screenshot. The visual pass confirms multiple distinct colours across
the ship simultaneously and nothing more.

---

## 7. Files

**New (all untracked before this session):**

```
CaptainPad/app/(tabs)/touch_control.tsx
CaptainPad/components/touch_control/touch_control_logic.ts
CaptainPad/components/touch_control/touch_control_logic.test.ts
CaptainPad/components/touch_control/color_panel.tsx
CaptainPad/components/touch_control/motion_panel.tsx
CaptainPad/components/touch_control/touch_pad.tsx
CaptainPad/components/touch_control/effects_bar.tsx
CaptainPad/components/touch_control/pattern_list.tsx
CaptainPad/components/touch_control/pattern_catalog.ts
CaptainPad/components/touch_control/pattern_catalog.test.ts
marsin_engine/patterns/66_five_colour_prism.js
marsin_engine/patterns/67_five_colour_stations.js
```

**Tracked file changed:** `CaptainPad/app/(tabs)/_layout.tsx` — +15 / −0,
registering the tab. Nothing else of Sina's was edited.

**Expected residue, not committed:** the engine rewrites
`marsin_engine/states/titanic/*.yaml` while running, as documented in
`AGENTS.md`.

**Audit data** was written outside the repo (agent scratch), not committed.
It is reproducible: run the harness per pattern with that pattern's own
`AUDIO_MODULATION_V1` map, once with `--model titanic` and once with
`--model test_bench`.

---

## 8. Suggested next steps

1. **Decide on the eight.** §3.3 lists them by severity with the recipe in §4.
2. **Investigate the 32 weak on both rigs.** Unknown cause. It may be a real
   library-wide reactivity gap, or it may be that
   `corr(signal, total brightness)` is the wrong metric for visually busy
   patterns — a pattern whose own animation moves total brightness will always
   score low, which is a design tension rather than a defect.
3. **Consider whether the X dead zone is intended.** If the 964 px are correct
   and the ship genuinely has nothing across that quarter of its X extent, then
   any future pattern sweeping X inherits this. A note in the pattern-authoring
   skill would stop it recurring.
