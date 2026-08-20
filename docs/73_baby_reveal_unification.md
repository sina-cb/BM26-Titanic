# 73 — Baby Reveal Unification (implementation contract)

> **⚠ AMENDED — READ "Contract v2" (below §0) BEFORE §1–§8.** The operator ruled
> on 2026-08-17 that the reveal patterns consume the GLOBAL colour palette and
> derive their own dark tone. That supersedes **§2.3, §2.4, §2.5, §2.6, §3, §4's
> palette-export law and gates G1/G2/G3/G5**. Everything else here — the keeper
> specifications, the composition laws, the frames, the clock law, the remaining
> gates — stands exactly as written. The v1 text is left in place on purpose:
> it is the record of why the two-slot handshake existed and what replaced it.
> Landed in report `_311`.

**Status:** DESIGN, authored for the implementation wave (report `_306`).
**Scope:** the Baby show's ANSWER stage only. `baby_tease` — its patterns, its
playlist, its gates — is landed, operator-approved, and **out of scope**.

The operator's order, in three parts:

1. **One list, not two.** `baby_boy` and `baby_girl` merge into a single
   playlist. The Baby Reveal show passes the right colour to it. *"Pink or blue
   becomes a palette input, not two duplicated pattern sets."*
2. **Redesign the patterns — "they look awful now"** — to the `baby_tease`
   quality bar (`docs/72`: distinct skeletons, real fixture authorship, TE signs
   as artwork), but **strictly one colour family per run**. Operator suggestion
   to validate: the second tone is *a darker-but-not-fully-dark shade of the
   same colour.*
3. **Isolate the directory** the way the tease was isolated.

---

## 0. TL;DR

- **10 keepers** in a new top-level family directory
  `marsin_engine/patterns/baby_reveal/`, numbered `01`–`10` in playlist order
  (the `baby_tease` convention).
- **The patterns do not know their colour.** They read the engine's CPC palette
  slots and resolve a family through one shared authority block (§3). No
  pattern file contains the word pink or blue in a decision.
- **One playlist** `baby_reveal`, both scenes, byte-identical. `baby_boy` and
  `baby_girl` are retired; `marsin_engine/patterns/baby/` is deleted.
- **Two tones, one hue:** primary and `DARK_K ×` primary, over designed black.
  Every emitted pixel is a scalar multiple of exactly one family triple — which
  is what makes the reveal-integrity gate absolute (§6).
- **P0, no fallback:** an unarmed reveal renders **black**. It never guesses an
  answer.
- **One engine change only:** the `globals` show-action validator learns HSV.
  Nothing else in the engine moves.

---

## Contract v2 (operator ruling 2026-08-17)

*The pattern sources and the family README cite this section as **§2.4-v2** —
it is the replacement for §2.4, and this is where that pointer lands.*

**What the operator saw.** He opened a `baby_reveal` pattern on the DECK, under
an ordinary global palette, and the ship was black. That is v1 working exactly as
§2.4 specified — and it is the wrong behaviour. His ruling, in four parts:

1. The reveal patterns **consume the global colour palette**. `colorPalette1`
   (the global "colour A") is the primary.
2. The second tone is **no longer read from `colorPalette2`**. Each pattern
   derives it internally: *"set the 2nd color the 1st color's very darkened."*
3. **The handshake blackout goes away.** With any valid `colorPalette1`, the
   pattern renders in that colour family. The deck must show these looks
   animating in the live colour.
4. The show program still writes the right colour on PINK/BLUE and on
   correction; it may keep writing `colorPalette2` for other consumers, but the
   patterns no longer depend on it.

### v2.1 The contract, old → new

| | v1 (§2.4, §3) | **v2** |
|---|---|---|
| slots read | `colorPalette1` **and** `colorPalette2` | **`colorPalette1` only** — `colorPalette2` is not exported |
| the dark tone | a value the show had to put in slot 2 at exactly `DARK_K` | **derived**: the primary RGB triple × `DARK_K` |
| sanctioned colours | pink or blue only, `±0.010` on the hue | **any** hue — the palette is the answer |
| unarmed on the deck | **black** | renders the live palette |
| refusal | any handshake miss ⇒ black | **an INVALID palette only** (a component outside `[0,1]`) ⇒ black |
| what guards a swallowed write | the pattern going black | **readback verification in the dispatch path** (§v2.4) |

`DARK_K` is **unchanged at 0.28**. It did not need a retune, and the reason is
arithmetic rather than luck: v1 never rendered slot 2's colour either — slot 2
was a *token*, and `emitDark` already multiplied the resolved triple by `DARK_K`.
Multiplying an RGB triple by a scalar is exactly "same hue, same saturation,
value × 0.28", so the derivation reproduces the tone D3 measured, bit for bit.
Re-measured under v2 on both models: the family is still perfectly bimodal
(0.0 % valley on six of ten keepers, 15.8 % worst) at a 3.76–6.05 : 1 tonal step.

### v2.2 The authority block (supersedes §3)

Copy **verbatim and byte-identical** into all ten patterns; whitespace-stripped
md5 **`8dae93895ac18f7cfe39ea1acec4b7c1`**. The live text is the one in
`marsin_engine/patterns/baby_reveal/*.js` — read it there. Its shape:

```js
export var cp1H = 0.0, cp1S = 1.0, cp1V = 1.0;   // mirrors the VM's own default
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }

var DARK_K = 0.28;              // THE second tone: the primary's value x this.
…
function resolvePalette() {     // was resolveFamily()
  famR = 0.0; famG = 0.0; famB = 0.0; famOk = 0.0;
  if (cp1H < 0.0 || cp1H > 1.0) return;   // the ONLY refusal left
  if (cp1S < 0.0 || cp1S > 1.0) return;
  if (cp1V < 0.0 || cp1V > 1.0) return;
  …hsv → rgb, the house idiom from patterns/20_parametric_sway_field.js…
  famOk = 1.0;
}
function emitPrimary(v) { emitTone(v, 1.0); }
function emitDark(v) { emitTone(v, DARK_K); }
```

Every emitted pixel is still `resolvedTriple × k` and nothing else, so the purity
gate stays an exact ratio identity — it is now stated **relative to the armed
palette's hue** rather than to a hard-coded family triple. The two family triples
no longer appear anywhere in the family's sources.

### v2.3 What "absent" means — a measured VM property, not a design choice

v1's §2.4 argued that "unset" is not a state the engine can report. That is
**more true than v1 knew**, and it was measured against the real compiler during
this wave rather than assumed:

> The VM installs its own `hsvPicker` default — **h 0, s 1, v 1**, the same
> triple the engine registry carries for `colorPalette1` — and calls the exported
> setter at program init, **whatever the declared `export var cp1H/cp1S/cp1V`
> say**. Four different declared defaults (including an impossible `-1, -1, -1`
> sentinel) all produced byte-identical red output on an unpushed pattern.

So there is no sentinel a pattern can plant to detect "nobody ever gave me a
colour", and an unpushed reveal pattern renders **red**, not black. Under v2 that
is coherent rather than alarming: red *is* `colorPalette1`'s registry default, so
the pattern is still doing exactly what it says — rendering the global palette.
The refusal that remains is the **range check**, and it is genuinely reachable:
an out-of-range palette renders every pixel black on both models.

In the live engine the question is academic, because every load path pushes the
real palette before the first frame (`finalizeCpcValues` in `api_server.js`, on
deck load, playlist entry load, overlay load and snapshot restore alike). That
call is what makes the deck view work.

### v2.4 The dispatch verification — what replaces the lost blackout

The v1 refusal was not decoration. It existed because **`setGlobals` swallows a
`source_lock` refusal**: `api_server.js` treats it as runtime arbitration and
continues without error, so with Live Touch holding the lock the palette write is
silently dropped. Under v1 the show then went black. Under v2 it would run the
ceremony **in the previous colour** — which can be the other family's. The
operator accepted colour-follows-palette semantics; he did not accept a silent
wrong answer. So the guard moves from the pattern to the dispatch path:

- The special-events runner **reads the palette back after writing it**, using
  the existing `captureGlobals` dep, and compares every key the `globals` action
  wrote. ParamCenter's canonical state holds the **target** value (the slew is a
  separate `_rendered` ramp), so a readback proves the write was *accepted*,
  which is precisely the thing `source_lock` takes away.
- A missing key, a mismatched value, or a `captureGlobals` that throws is a
  **refusal**: the runner throws, naming the key, the value written and the value
  read back. No retry, no "continue anyway", no fallback.
- The reveal's `globals` action sits at `delayMs: 0`, so it is applied
  synchronously inside `fire()` and the throw propagates out to the operator's
  own HTTP request — **the run refuses to start** rather than starting in a stale
  colour — and it is also recorded on `lastError`, the field the SPECIAL EVENTS
  tab already renders, and broadcast.

`type: globals` appears in exactly one show today (this one, both scenes), so the
verification is generic in shape and reveal-only in effect.

### v2.5 The show YAML (supersedes §2.3's slot-2 rule)

Both scenes still write `colorPalette1` (the family primary at full value),
`colorPalette2` (same hue, `v: 0.28`) and `colorTransitionMs: 0`. What changed is
what those mean:

- **`colorPalette1` is the answer.** The patterns render it.
- **`colorPalette2` is written for OTHER consumers only.** The reveal patterns
  never read it; it is kept at the derived tone so the global pair mirrors what
  the ship is actually showing. The gate still asserts it equals `DARK_K` —
  as a **mirror check**, not as a handshake.
- **`colorTransitionMs: 0` matters MORE now, not less.** Under v1 a slewed
  palette left the patterns black mid-ramp. Under v2 they follow the ramp, so an
  un-pinned fade would walk the ship through intermediate hues on the way to the
  answer — a visible wrong-colour moment inside the ceremony. Pinning it makes
  the answer snap.

### v2.6 Gates (supersedes the affected entries in §6)

- **G1 purity** — relative to the armed palette's hue, run under pink, blue **and
  an arbitrary third hue** on both models. Still `assert.equal(foreign, 0)`.
- **G2 refusal** — invalid-palette cases only (components outside `[0,1]`), plus
  the converse, which is now the load-bearing half: an ordinary palette **lights
  the rig**.
- **G3** — the `DARK_K` ↔ `colorPalette2.v` mirror check described above.
- **G5 two-tone** — measures the **derived** tone, under the arbitrary hue as well
  as pink.
- **NEW — G14 deck-view usability.** Under an arbitrary non-baby palette (green,
  `h 0.333333`) at saved playlist defaults, every keeper must render **lit** and
  **single-family**: every lit pixel a scalar multiple of the green triple, zero
  pixels of any other hue. Measured family-wide on both models: `maxR = 0` and
  `maxB = 0` for all ten keepers — pure green and dark green, nothing else.

**Measuring this family offline — read this before quoting a number.** The VM
installs its own default for **every** control and ignores the declared
`export var`: `(0, 1, 1)` for the palette (§v2.3) and **0.5 for every slider**.
An offline render that does not explicitly push the playlist's saved values is
measuring 0.5 across the board, not the operator's operating point. The gates
push them; so must any ad-hoc probe.

### v2.7 The operator's field retune (2026-08-17, landed with v2)

Sina reviewed the set on the rig — overall *"great"* — and gave per-pattern speed
notes. They are applied the `_305` way: **the factor goes into each pattern's
INTERNAL base rates, never into the saved sliders**, so the playlist still loads
at the reference operating point of §4.2. Each file's `// SPEED` block carries the
new arithmetic and its pre-retune numbers.

| keeper | factor | note |
|---|---|---|
| `01_heartbeat_bloom` | **×0.45 — ESTIMATE** | *"toooooo fast"*, no number given. **Supersedes §5 K01's "Speed target"** — the beat is now ≈ 0.279 beat/s (≈ 16.7 bpm) at reference, not 0.62 / 37 bpm. |
| `03_constellation_flow`, `05_ribbon_braid`, `06_diamond_quilt` | ×1.15 | applied to every clock in each file, so internal relationships hold |
| `07_tidal_terraces` | ×1.70 | the largest factor in the set |
| `08_comet_lullaby` | density, not speed | *"too little blue"* — head/tail radii 0.30/0.19 → 0.52/0.34 and the tail's ghost samples 3 → 5, taking it from 12.0 % to 25.9 % of titanic lit while keeping full named-region coverage |
| `02`, `04`, `09`, `10` | untouched | "great", or no note |

**Two §4.2 ceilings are now touched at the LEGAL MAXIMUM** (global SPEED 100 *and*
local 1.0 — 18.93× the authored point), recorded here rather than clamped away
because the factors are the operator's own measured taste:

- `06_diamond_quilt` — legal-max period **1.84 s**, inside the 2 s ownership-front
  ceiling. Aliasing bound still clear at 1.36 % against 2 %.
- `07_tidal_terraces` — legal-max riser period **1.25 s** (inside the 2 s
  ceiling) *and* a per-frame step of **2.01 %** against the 2 % aliasing ceiling,
  i.e. marginally over. If the terraces ever alias under a hard-driven global
  speed knob, `TIDE_BASE_RATE` is the number to bring back down.

Every factor was verified empirically as well as arithmetically, by comparing the
mean per-pixel frame-to-frame delta of the pre- and post-retune sources at saved
defaults: measured 0.485× / 1.140× / 1.181× / 1.154× / 1.689× against intended
0.45 / 1.15 / 1.15 / 1.15 / 1.70.

## 1. Why the current answers fail

Read `marsin_engine/patterns/baby/29_boy_diamond_quilt.js`. Three defects, all
mechanical, all shared by the whole 20:

1. **They are single-tone, and the file knows it.** Each carries six colour
   constants named `COLOR_*_DARK` and `COLOR_*_LIGHT` — and then sets both to
   the *same triple* and averages them:
   ```js
   var r = (COLOR_R_DARK + COLOR_R_LIGHT) * 0.5;
   ```
   The two-tone idea is present in the skeleton and collapsed to nothing in the
   code. Every pixel is `familyColour × intensity`. There is no second tone, so
   the only structure available is brightness, and brightness alone at fifty
   feet is mush.
2. **No world geometry.** `render3D` consumes `localX/localY/localZ` directly.
   The tease rotates world X/Z into the smokestack-derived ship frame before
   evaluating anything (`docs/72` §3); the answers never do. The composition is
   therefore aligned to nothing the crowd can see, and the model's ~40° world
   rotation smears every diagonal.
3. **`// DRAFT - pending operator review`** is still the first line of the file.

The set is also carrying a live bench failure: `22_boy_constellation_flow` fails
the colour gate on `test_bench` and is ~6× dimmer than its committed ancestor.
This wave supersedes all of it — the redesign is total, and none of the 20
sources survive.

## 2. The palette carrier

### 2.1 The mechanism, and why it is the existing one

The engine already has exactly the tier this needs. `colorPalette1` and
`colorPalette2` are **engine-global CPC params**
(`marsin_engine/lib/param_center.js`, registry entries with
`sharedFnName: 'colorPalette1'` / `'colorPalette2'`, `type: 'hsv'`). A pattern
opts in purely by exporting a function of that name; the value arrives as three
floats.

It satisfies all four requirements from the brief without a new mechanism:

| requirement | how it is met |
|---|---|
| applies to **every entry** of the playlist for the whole run | the params are engine-global, not per-entry and not per-channel |
| **survives pattern switches** inside the playlist | `PlaylistManager.captureDefaults` and `applyEntryDefaults` both skip CPC-owned names, and `loadPlaylistEntry` calls `finalizeCpcValues(channel)` as the **last** step of every switch — CPC always wins over per-pattern state |
| settable by **one write** when the reveal fires | one `globals` action in the choice's action list |
| **fails loudly if unset** | §2.4 — the patterns validate the slots and render black |

`ParamCenter.applySnapshot` additionally snaps the rendered value on a pattern
swap rather than fading it ("the PATTERN changed, not the colour"), so an
incoming entry boots at the live palette with no visible transition.

**Nothing competes for the slots during a show.** The Special Events runner
already force-disables the ColorAutopilot at ARM and restores it at END SHOW
(`special_events_service.js` — `priorColorAutopilot`, the `setColorAutopilot`
undo push, and the restore in `_endRun`). That daemon was the only other writer.

### 2.2 The one engine change

`marsin_engine/lib/special_events/show_schema.js`, `validateAction`, the
`case 'globals':` branch, requires every value in `action.set` to be a finite
number. So `colorPalette1: {h,s,v}` is refused **at show load**.

This is a pure authoring-validator gap, not a capability gap: `setGlobals` in
`api_server.js` forwards values straight to `paramCenter.set`, which handles the
`hsv` type, and the runner's own **end-of-show restore already passes HSV
objects through that same function today** (`captureGlobals` flattens every
param, palette slots included). The validator is widened to accept a finite
number *or* an `{h, s, v}` object of finite numbers in `[0, 1]`. Nothing else in
the engine changes.

### 2.3 The wire values

Family colours are the Baby contract's, verbatim and unchanged:

| family | RGB | HSV written to the slots |
|---|---|---|
| Baby Pink | `(1.000, 0.035, 0.360)` | `h 0.943869, s 0.965, v 1.000` |
| Baby Blue | `(0.033, 0.450, 1.000)` | `h 0.594795, s 0.967, v 1.000` |

`colorPalette2` carries **the same hue and saturation at `v = DARK_K`**. The two
hues are `0.349` apart on the circle, which is why a `±0.010` acceptance window
can never confuse them.

The `globals` action also pins **`colorTransitionMs: 0`**. The palette must
*snap*: the slots are slewed by default (800 ms, operator-tunable to 10 s), and
a pattern that samples a mid-ramp value sees a hue that matches no family and
renders black. Pinning the fade to zero makes the write atomic. The operator's
own value is restored at END SHOW by the runner's existing globals
capture/restore, so this is a borrow, not a change.

### 2.4 The refusal — P0, no fallback

`colorPalette1` **always has a value** (registry default `h 0.0`, and the live
scene currently persists `h 0.8`). "Unset" is therefore not a state the engine
can report — so the patterns do not ask whether the slots are set. They ask
whether the slots carry a **sanctioned two-slot handshake**:

```
slot1.s ≥ 0.90                      a washed-out slot is not an answer
slot1.v ≥ 0.50
hueGap(slot2.h, slot1.h) ≤ 0.010    slot 2 must be the SAME hue
slot2.s ≥ 0.90
|slot2.v − DARK_K| ≤ 0.020          ... at the dark drive
hueGap(slot1.h, PINK_H | BLUE_H) ≤ 0.010
```

Any failure ⇒ **every pixel black**. There is no default family, no nearest
match, no last-known colour.

Two properties make this strong rather than decorative:

- **Accidental arming is impossible.** The deck's colour wheel pins `s: 1, v: 1`
  on both slots (`colors_window_logic.ts`), so an operator playing with colours
  can never produce `slot2.v = 0.28`. Only the reveal's own action writes the
  handshake.
- **A swallowed write fails safe.** `setGlobals` treats a `source_lock` refusal
  as runtime arbitration and continues without error — so if Live Touch holds
  the lock, the palette write is silently dropped. Under a single-slot design
  the show would then run the reveal in *whatever colour was already loaded* —
  including, catastrophically, the other family's. Under this design it goes
  black.

**Black is the correct failure.** It is unmistakable on a 964-pixel ship, it
cannot be misread as an answer, and the operator recovers by re-firing the
choice. Showing the wrong gender is the only outcome worse than showing nothing.

The cost, stated plainly: **a `baby_reveal` pattern previewed from the deck
without the show armed renders black.** That is intended. The gallery renders
both palettes offline so nobody needs to preview blind, and the README carries
the two `POST /param-center` bodies that arm the palette by hand.

### 2.5 What the refusal costs the offline tooling

Every offline tool has to be told the palette now, because the family's declared
`export var cp1H…` defaults are the *refusal* value.

`marsin_engine/tools/pattern_audio_harness.mjs` seeds `colorPalette1/2` from
those declared defaults, and its `--set` only accepted scalars — so a
`baby_reveal` pattern rendered offline was black, and the harness's own quality
gate reported `GATE_FAIL DARK: 100% of frames render essentially black`. That is
the refusal working, not a broken pattern.

`--set` therefore accepts an HSV triple, `--set name=H:S:V` (colons, because
`--set` is already comma-separated). Driving the family offline:

```
node tools/pattern_audio_harness.mjs --pattern <path> --model titanic \
  --seconds 6 --out-fps 4 --synth silence --out <out.json> \
  --set "colorPalette1=0.943869:0.965:1.0,colorPalette2=0.943869:0.965:0.28"
```

with `0.594795:0.967:…` for blue. **A bare `GATE_FAIL DARK` on a `baby_reveal`
pattern means no palette was injected** — check the invocation before the
pattern.

The **playlist gallery generator has no palette concept**: it builds its `--set`
from playlist `defaults`, and CPC keys are deliberately not playlist defaults
(§2.1). So `generate.mjs` renders this family black until it learns a `--palette`
flag to pass through. That is a real follow-up, not a defect in the patterns.

### 2.6 The `DARK_K` coupling

`DARK_K` appears in **two** places: the pattern authority block (§3) and the
show YAML's `colorPalette2.v`. That coupling is deliberate — it is what makes
slot 2 a handshake rather than decoration — but it is a footgun for a retune, so
the gate asserts the two agree by parsing both files. Changing the dark tone is
a two-place edit that **fails a test**, never a show.

## 3. The authority block

Copy **verbatim and byte-identical** into all ten patterns. This is the only
place in the family that knows a colour exists; a pattern body calls
`emitPrimary` / `emitDark` / `emitBlack` and is otherwise pure geometry.

```js
// ── BABY REVEAL COLOUR AUTHORITY ───────────────────────────────────────────
// BYTE-IDENTICAL IN EVERY patterns/baby_reveal/*.js. Contract: docs/73 §3.
//
// This family does not know whether it is pink or blue. The Baby Reveal show
// injects the answer through the engine's CPC palette slots; this block is the
// ONLY code that turns those slots into emitted colour.
//
// P0, NO FALLBACK: unless BOTH slots carry the sanctioned handshake (same hue,
// slot 2 at DARK_K), every pixel renders BLACK. An unarmed reveal refuses to
// guess an answer. docs/73 §2.4.
export var cp1H = 0.0, cp1S = 0.0, cp1V = 0.0;
export var cp2H = 0.0, cp2S = 0.0, cp2V = 0.0;
export function colorPalette1(h, s, v) { cp1H = h; cp1S = s; cp1V = v; }
export function colorPalette2(h, s, v) { cp2H = h; cp2S = s; cp2V = v; }

var FAMILY_PINK_H = 0.943869;   // HSV hue of RGB (1.000, 0.035, 0.360)
var FAMILY_BLUE_H = 0.594795;   // HSV hue of RGB (0.033, 0.450, 1.000)
var FAMILY_H_EPS = 0.010;       // the families sit 0.349 apart — cannot confuse
var FAMILY_S_MIN = 0.900;
var DARK_K = 0.28;              // the second tone. MUST equal colorPalette2.v
                                // in baby_reveal.yaml — the gate asserts it.
var DARK_V_EPS = 0.020;
var FAMILY_TRIM = 1.00;         // whole-family output trim (one-line retune)
var FAMILY_BAR_TRIM = 1.00;     // extra trim on FIX_BAR_18 only
var FLOOR_I = 0.14;             // never-black floor for a LIT pixel

var famR = 0.0, famG = 0.0, famB = 0.0;   // resolved triple; all-zero = refused
var liveLevel = 1.0;    // each pattern's beforeRender refreshes this. Declared
                        // HERE, not in the pattern: the VM resolves `var` in
                        // declaration order, so `emitTone` reading a liveLevel
                        // declared further down the file is a COMPILE FAILURE
                        // ("Undefined var liveLevel"). Verified against the
                        // real compiler, not assumed.

function clamp01(v) { if (v < 0.0) return 0.0; if (v > 1.0) return 1.0; return v; }

function hueGap(a, b) { var d = abs(a - b); if (d > 0.5) d = 1.0 - d; return d; }

// Call ONCE per frame, first thing in beforeRender.
function resolveFamily() {
  famR = 0.0; famG = 0.0; famB = 0.0;
  if (cp1S < FAMILY_S_MIN) return;
  if (cp1V < 0.5) return;
  if (cp2S < FAMILY_S_MIN) return;
  if (hueGap(cp2H, cp1H) > FAMILY_H_EPS) return;
  if (abs(cp2V - DARK_K) > DARK_V_EPS) return;
  if (hueGap(cp1H, FAMILY_PINK_H) <= FAMILY_H_EPS) {
    famR = 1.000; famG = 0.035; famB = 0.360; return;
  }
  if (hueGap(cp1H, FAMILY_BLUE_H) <= FAMILY_H_EPS) {
    famR = 0.033; famG = 0.450; famB = 1.000; return;
  }
}

function emitBlack() { rgbwau(0.0, 0.0, 0.0, 0.0, 0.0, 0.0); }

function emitTone(v, toneK) {
  if (famR == 0.0 && famG == 0.0 && famB == 0.0) { emitBlack(); return; }
  var k = max(FLOOR_I, min(1.0, v)) * liveLevel * FAMILY_TRIM * toneK;
  if (fixtureType == FIX_BAR_18) k = k * FAMILY_BAR_TRIM;
  rgbwau(famR * k, famG * k, famB * k, 0.0, 0.0, 0.0);
}

function emitPrimary(v) { emitTone(v, 1.0); }
function emitDark(v) { emitTone(v, DARK_K); }
```

**Why no pink trim.** `baby_tease` carries `PINK_TRIM 0.97` / `PINK_BAR_TRIM
0.80` because it must balance pink against blue *in the same frame*. The reveal
never shows two families, so there is nothing to balance and the night-visibility
mission argues for full drive. `FAMILY_TRIM` and `FAMILY_BAR_TRIM` ship at
`1.00` and exist so an on-rig eye pass is a one-constant edit across ten files.
Open decision **D2**.

**The consequence that makes the gates absolute:** every emitted pixel is
`(famR, famG, famB) × k` for some `k ∈ (0, 1]`. A single pixel whose RGB is not
proportional to the *one* resolved family triple is, by construction, a bug —
and §6's purity gate is an exact-ratio check, not a tolerance.

## 4. Composition laws

Inherited from `docs/72` §2 and the Baby README, unchanged: **W = A = U = 0**;
smokestack ship frame for all world geometry (§4.1); portable to `test_bench`
(fixture branches refine, the world path carries the pattern alone); black is
designed, never dropout; Vintage and TE signs authored explicitly; ≥15 % of the
rig in the dim band at defaults; complete rig visible.

**Inverted from the Baby README:** `baby_reveal` patterns **must** export
`colorPalette1` and `colorPalette2`. `baby_tease` must still export neither.

New laws for this family:

- **R1 — Two tones, three levels.** The composition is built from exactly three
  emitted states: primary, dark, black. The read at fifty feet comes from *tone
  territory*, not from a brightness gradient.
- **R2 — Bimodal, not smeared.** The tonal contrast only survives distance if
  the two tones stay separated. Emit primary at `v ∈ [0.55, 1.0]` and dark at
  `v ∈ [0.55, 1.0]` (the `DARK_K` multiply is what makes it dark — do **not**
  reach the dark tone by lowering `v` on `emitPrimary`). Gated in §6.
- **R3 — Hard edges.** Tone boundaries are thresholds, not ramps. A soft
  transition between primary and dark reads as blur, which is exactly the
  failure of the set being replaced.
- **R4 — Sign art is pattern-specific 2D art.** Each keeper's TE-sign treatment
  is a miniature of its own skeleton on the full local 10×8 face, in all three
  states. Both signs byte-identical by address (`index % 74`).
- **R5 — Vintage carries both tones.** Every six-head Vintage shows primary and
  dark simultaneously, with at least one black separator head.
- **R6 — Motion is territorial.** The primary clock moves *tone ownership*, not
  only brightness. Visible ownership change within 10–25 s at defaults; visible
  brightness life within 1–3 s.
- **R7 — Anti-bilateral.** `docs/72` L2 still applies, with tone standing in for
  family: label pixels `±1` by `sign(h − 0.5)` on each of `shipLong`, `y`,
  `shipWide`; owners `±1` by primary/dark. Time-mean `P_h ≤ 0.35`, time-max
  `≤ 0.65`. A one-colour pattern can still collapse into halves; this is what
  guards the composition.
- **R8 — One authority law.** Colour is controlled ONLY by §3. No per-pattern
  colour constants, no per-pattern trims.

### 4.1 Shared frames (verbatim)

```js
var SHIP_CENTER_X = 0.5219458333333333;
var SHIP_CENTER_Z = 0.5606541666666667;
var SHIP_AXIS_X = 0.7658426753447269;
var SHIP_AXIS_Z = -0.6430279905422711;
// per pixel:
var shipLong = 0.5 + (x - SHIP_CENTER_X) * SHIP_AXIS_X + (z - SHIP_CENTER_Z) * SHIP_AXIS_Z;
var shipWide = 0.5 + (x - SHIP_CENTER_X) * (-SHIP_AXIS_Z) + (z - SHIP_CENTER_Z) * SHIP_AXIS_X;
```

TE-sign local frame: `signAddress = index % 74`, `signX = (signAddress % 10) / 9`,
`signY = floor(signAddress / 10) / 7` (row 7 carries 4 px — include it).

### 4.2 Clock law and speed

Advance phases only in `beforeRender`; `dt = min(0.1, max(0.0, delta/1000))`;
the shared local curve, byte-identical across the family:

```js
var speedScale = 0.35 + clamp01(localSpeed) * 1.65;   // 0.35× … 2.0×
```

Wrap every phase at an **even integer** (or a documented period multiple) so
parity math survives the wrap.

The global knob is **exponential and unclamped**
(`engine.js` `createRenderLoop`): `g = 0.25 · 16^s`, `s ∈ [0, 1]`, so
**`g ∈ [0.25, 4.0]`**. Composed rate is

> `pattern-time rate = 0.25 · 16^s × (0.35 + 1.65 · localSpeed)`

| operating point | product | vs reference |
|---|---|---|
| **reference — global 25, local 0.30** | **0.4225** | 1.00× |
| legal maximum — global 100, local 1.00 | 8.0000 | **18.93×** |

**Author every base rate to the reference point**, and run the runaway analysis
against **18.93×**, not against a comfortable 4×. Ceilings: no ownership front
crosses a fixed point more often than once per 2 s at the legal maximum, and no
per-frame phase step exceeds 0.02 of a period at 40 fps.

The pattern sources retain `localSpeed: 0.30` as their authoring reference.
The show playlist deliberately SAVES `sliderLocalSpeed: 0.468` on every Reveal
entry: the earlier 20 percent lift to 0.36 followed by a Reveal-only 30 percent
lift. Baby Tease keeps its independently tuned defaults.

### 4.3 MFT parameter law

Declaration order = knob order. `sliderLocalSpeed` first; `sliderDirection` —
when present — **second** (binary: `< 0.5` reverse, `≥ 0.5` forward, default 1);
`sliderLevel` next; then exactly one character slider. Playlist `defaults` name
exactly the exported sliders.

### 4.4 Silence

No keeper carries an `AUDIO_MODULATION_V1` block. Every clock free-runs off
`delta`, so silence and music look identical by construction.

## 5. The keeper set (10)

Ten distinct mathematical skeletons: cardiac radial, polar rose, star graph,
metaball packing, laned braid, diagonal lattice, quantised terraces, multi-body
orbital, angular sweep, impulse rays. No two share a family.

Nine of the ten concepts are inherited from the boy/girl set the operator has
been living with — the *identity* of the answer show is preserved while the
execution is rebuilt from zero. `orbit_glow` is dropped (it duplicated the
cardiac radial read) and `tidal_terraces` takes its place as the one skeleton
that makes `y` the primary axis.

| # | file | entry id | 50-ft identity |
|---|---|---|---|
| 01 | `01_heartbeat_bloom` | `e_baby_reveal_heartbeat_bloom` | A heartbeat blooms out of the ship's heart in nested shells, twice per beat. |
| 02 | `02_rose_unfurl` | `e_baby_reveal_rose_unfurl` | A great rose of counter-wound petals opens and closes over the whole ship. |
| 03 | `03_constellation_flow` | `e_baby_reveal_constellation_flow` | Bright stars drift through a dim web of threads that stretch and snap between them. |
| 04 | `04_bubble_chorus` | `e_baby_reveal_bubble_chorus` | Big soft bubbles swell, crowd each other and pop across the hull. |
| 05 | `05_ribbon_braid` | `e_baby_reveal_ribbon_braid` | Three thick ribbons braid the length of the ship, passing over and under each other. |
| 06 | `06_diamond_quilt` | `e_baby_reveal_diamond_quilt` | Travelling stitches lock a field of large diamonds into a quilt. |
| 07 | `07_tidal_terraces` | `e_baby_reveal_tidal_terraces` | Stepped terraces climb the rig like a stadium wave, riser by riser. |
| 08 | `08_comet_lullaby` | `e_baby_reveal_comet_lullaby` | Soft comet heads sail the hull trailing long dim tails through black. |
| 09 | `09_lighthouse_fans` | `e_baby_reveal_lighthouse_fans` | Rotating lighthouse fans sweep the whole ship through crisp black shutters. |
| 10 | `10_celebration_burst` | `e_baby_reveal_celebration_burst` | Shells and rays fire from the ship in a full celebration finale. |

`06_diamond_quilt` is the **hero**: the show's reveal choice pins it by
`entryId`, so it is the look that rises under the white bloom at t = 3000 ms
regardless of playlist order or later curation.

The arc is calm → building → celebratory. Numbering **is** playlist order;
reordering the arc means renumbering the files, both `baby_reveal.yaml` copies,
`pattern_goals.json` and the gallery together, in one landing.

### Keeper specifications

Shared elements (§3 authority block, §4.1 frames, §4.2 clock law, floors) are
stated once and not repeated. `L` = `liveLevel`. All rates are **at the
reference point** (§4.2).

#### K01 — `01_heartbeat_bloom`

- **Skeleton:** radial distance from the ship's heart,
  `r = sqrt(((shipLong−0.5)·1.15)² + ((y−0.52)·0.9)² + ((shipWide−0.5)·0.8)²)`.
  A **cardiac envelope** drives shell emission: `beat = frac(beatClock)`, with a
  double thump — `thump = pulse(beat, 0.00, 0.09)·1.0 + pulse(beat, 0.17, 0.24)·0.72`
  where `pulse` is a raised-cosine window. Shells are launched at each thump and
  travel outward: `shellU = r·(2.6 + sharpness·1.8) − beatClock·2.0`;
  `shell = frac(shellU)`. Tone: `shell < 0.16` ⇒ **primary** (the shell face,
  `v = 0.62 + thump·0.38`); `0.16 ≤ shell < 0.46` ⇒ **dark** (the body behind
  the front, `v = 0.60 + wave(shellU·0.8 + shimmer)·0.30`); else **black**.
  Echo depth adds a second, half-amplitude shell train at `shellU + 0.5`
  weighted by `echoDepth`. `beatClock` wraps at 2.0.
- **Fixtures:** hull/silhouette = the shells crossing as expanding arches;
  Vintage = `dist = min(head, 5−head)` shells pass through the fixture, at least
  one head black at every phase; Organs (smokestack PAR chains) = the outermost
  shells, so each thump arrives at the stacks as the pattern's downbeat, chain
  lighting bottom-to-top; signs = a 3-shell mini bullseye on the same clock at
  1.5×, thump-synced.
- **Params:** `sliderLocalSpeed 0.30`, `sliderLevel 0.88`,
  `sliderBloomSharpness 0.50`, `sliderEchoDepth 0.58`.
- **Speed target:** `beatClock` ≈ 0.62 beat/s at reference (≈ 37 bpm — a calm
  resting heartbeat, deliberately slower than adult rest). At 18.93× that is
  11.7 beat/s, which is a flutter rather than a strobe because the shells are
  0.16-wide soft bands; verify the per-frame step and report it.
- **Refusal note:** `resolveFamily()` first in `beforeRender`.

#### K02 — `02_rose_unfurl`

- **Skeleton:** polar rose in the ship's top plane.
  `ang = atan2(shipWide−0.5, shipLong−0.5)/2π + 0.5`, `rad` as K01's `r`.
  `petals = 5`; the rose curve is
  `rose = abs(cos(ang·2π·petals·0.5 + spinClock·2π))`;
  `edge = rose·(0.30 + petalWidth·0.34) + 0.10`; `unfurl = 0.55 + wave(breathClock)·0.35`.
  Tone: `rad < edge·unfurl` ⇒ **primary** (petal face,
  `v = 0.60 + (1 − rad/(edge·unfurl))·0.40`);
  `edge·unfurl ≤ rad < edge·unfurl·1.42` ⇒ **dark** (the petal's under-curl);
  else **black**. A one-pixel black rib at each petal seam
  (`rose < 0.06`) keeps the petals separated.
- **Direction (2nd param):** flips the sign of the `spinClock` increment.
- **Fixtures:** hull = the rose; silhouette carries the petal tips crossing the
  outline; Vintage = a 6-head radial fan, three primary / two dark / one black
  rotating with `spinClock`; Organs = the stacks sit outside the rose's mean
  reach, so they flare primary only when a petal tip sweeps their bearing —
  five beats per revolution; signs = a 5-petal mini rose centred on the face,
  breathing on the same clock at 1.4×.
- **Params:** `sliderLocalSpeed 0.30`, `sliderDirection 1.0`,
  `sliderLevel 0.87`, `sliderPetalWidth 0.52`.

#### K03 — `03_constellation_flow`

- **Skeleton:** a sparse star set over a dim thread web — the family's dim-band
  anchor. Star sites: per-pixel hash `h = frac(sin(index·12.9898)·43758.5453)`,
  star iff `h > (0.962 − starSize·0.012)`. Threads: for each pixel compute the
  drifting field
  `w = sin((shipLong·1.4 + y·0.8)·2π·0.9 + driftClock·0.30·2π)
     + sin((shipWide·1.1 − y·0.6)·2π·0.7 − driftClock·0.21·2π)`;
  thread iff `abs(w) < (0.10 + threadReach·0.16)`. Tone: star ⇒ **primary**
  (`v = 0.58 + pow(wave(h·37 + twinkleClock·(0.5 + h)), 3.0)·0.42`);
  thread ⇒ **dark** (`v = 0.60 + wave(w·0.9 + shimmer)·0.28`); else **black**.
  The web genuinely stretches and snaps because `w`'s zero set migrates.
- **Fixtures:** hull/silhouette = stars + web; Vintage = one head is the star
  (`floor(twinkleClock·0.7) % 6`), two heads dark thread, the rest black;
  Organs = one PAR per chain carries a star, rotating by
  `floor(twinkleClock·0.25) % 4` — a slow four-step ladder; signs = 8 fixed star
  addresses `{7, 16, 25, 33, 48, 57, 62, 71}` over the sign's own two-blob web
  (same `w` in sign coords).
- **Params:** `sliderLocalSpeed 0.30`, `sliderLevel 0.90`,
  `sliderStarSize 0.54`, `sliderThreadReach 0.48`.
- **Contract note:** this will be the dimmest keeper by design. Verify the
  animated floor (peak per-pixel delta ≥ 40) via the twinkles, and the ≥15 %
  dim-band mass via the web. `_305` §8 flagged the tease's equivalent
  (`03_star_exchange`) as the one entry needing an on-rig eye check; expect the
  same note here and say so.

#### K04 — `04_bubble_chorus`

- **Skeleton:** six metaball sites on independent slow drifts in
  `(shipLong, y, shipWide)`, each with its own breath phase and radius.
  Site `k`: centre `C_k = base_k + (0.06·sin(driftClock·rate_k + φ_k), …)`;
  `R_k = (0.13 + bubbleSize·0.13) · (0.55 + wave(breathClock·b_k + ψ_k)·0.45)`.
  Field `f = Σ_k max(0, 1 − d_k/R_k)²` with `d` weighted (1.0 / 0.9 / 0.8);
  `cellDensity` scales how many sites are active (4–6) and their base spread.
  Tone: `f > 0.62` ⇒ **primary** (bubble body); `0.20 < f ≤ 0.62` ⇒ **dark**
  (the crowding halo where bubbles press on each other); else **black**. A
  bubble that reaches full radius "pops": its `R_k` collapses over ~0.4 s and
  re-grows — authored as a sawtooth on the breath phase, not a discontinuity.
- **Fixtures:** hull = the chorus; silhouette shows bubble arcs crossing the
  outline; Vintage = two bubbles growing from opposite ends of the six heads and
  meeting mid-fixture, black separator at the meeting; Organs = a stack chain
  lights bottom-to-top as a bubble rim crosses it; signs = three mini bubbles on
  the face with the same pop rule.
- **Params:** `sliderLocalSpeed 0.30`, `sliderLevel 0.89`,
  `sliderBubbleSize 0.50`, `sliderCellDensity 0.52`.

#### K05 — `05_ribbon_braid`

- **Skeleton:** three ribbons running the ship's length, braiding across the
  width. Ribbon `k ∈ {0,1,2}` has centre
  `c_k(shipLong) = 0.5 + 0.26·sin(shipLong·2π·0.8 − braidClock·2π + k·2π/3)`
  in `shipWide`, and a depth
  `z_k = cos(shipLong·2π·0.8 − braidClock·2π + k·2π/3)` — **the depth is what
  makes the braid read**: the ribbon with the largest `z_k` at a pixel is
  *over*, the others are *under*.
  `halfWidth = 0.055 + braidAmount·0.055`. Tone: inside the nearest ribbon and
  it is the topmost ⇒ **primary**; inside a ribbon that is occluded by another
  ⇒ **dark**; else **black**. Add a black rim of 0.012 around every ribbon so
  the over/under crossings are drawn, not merged.
- **Direction (2nd param):** flips the `braidClock` increment.
- **Fixtures:** hull/silhouette = the braid; Vintage = three 2-head ribbon
  segments with the same over/under rule; Organs = the stacks sit near the
  braid's outer excursion, flaring primary as a ribbon swings onto their
  bearing; signs = a 3-strand mini braid running corner to corner with the same
  occlusion rule.
- **Params:** `sliderLocalSpeed 0.30`, `sliderDirection 1.0`,
  `sliderLevel 0.89`, `sliderBraidAmount 0.56`.

#### K06 — `06_diamond_quilt` (the hero)

- **Skeleton:** the concept the operator's reveal pins, rebuilt **in the ship
  frame** (the old one used raw fixture-local coordinates — §1).
  `scale = 2.6 + quiltScale·5.4`;
  `diagA = wave((shipLong + y·0.85 + shipWide·0.20)·scale − quiltClock)`,
  `diagB = wave((shipLong − y·0.85 − shipWide·0.20)·scale + quiltClock·0.786)`;
  `seam = 1 − abs(diagA − diagB)`;
  `stitch = pow(seam, 2.0 + (1 − seamWidth)·13.0)`;
  `panel = pow(diagA·diagB, 2.2)`.
  Tone: `stitch > 0.42` ⇒ **primary** (the travelling stitch line);
  `panel > 0.30` ⇒ **dark** (the quilt panel it encloses); else **black** (the
  seam channels). This is the pattern where R3 matters most — the thresholds
  must be hard or the quilt turns to fog, which is exactly how the old one
  failed.
- **Fixtures:** hull/silhouette = the quilt; Vintage = a 6-head mini quilt,
  stitch heads primary, panel heads dark, at least one seam head black; Organs =
  each stack chain spans about one panel and flips as a stitch front crosses —
  the metronome; signs = a 4×3 mini quilt with the same three states.
- **Params:** `sliderLocalSpeed 0.30`, `sliderLevel 0.91`,
  `sliderSeamWidth 0.50`, `sliderQuiltScale 0.52`.
- **Hero note:** this look lands under the white bloom at t = 3000 ms. It must
  read instantly and at full strength from the first frame — no slow build-in.

#### K07 — `07_tidal_terraces`

- **Skeleton:** the only keeper whose primary axis is **`y`**. Quantise height
  into terraces: `steps = 4 + floor(terraceCount·3)`;
  `tU = y·steps − tideClock + shipLong·0.55`; `step = floor(tU)`;
  `frac_t = tU − step`. Tone: `frac_t < 0.10` ⇒ **black** (the riser);
  `step % 2 == 0` ⇒ **primary** (`v = 0.60 + wave(frac_t·1.2 + shimmer)·0.32`);
  else ⇒ **dark**. The `+ shipLong·0.55` skew is what makes it a *wave* climbing
  the ship rather than flat bands, and it is what keeps R7 honest on the
  `shipLong` axis. `tideClock` wraps at an even multiple of `steps`.
- **Direction (2nd param):** flips the `tideClock` increment — the wave climbs
  or falls.
- **Fixtures:** hull/silhouette = the terraces climbing; Vintage = the six heads
  as six risers, alternating tone with a black riser travelling through them;
  Organs = the stack chains are vertical by construction, so each chain reads as
  a clean four-step ladder that re-stacks as the wave passes — the strongest
  organ read in the set; signs = 4 mini terraces on the face, same clock at 1.6×.
- **Params:** `sliderLocalSpeed 0.30`, `sliderDirection 1.0`,
  `sliderLevel 0.88`, `sliderTerraceCount 0.50`.

#### K08 — `08_comet_lullaby`

- **Skeleton:** four soft heads on incommensurate Lissajous paths.
  Head `k`: `P_k = (0.5 + 0.34·sin(a·u_k + φ_k), 0.5 + 0.24·sin(a·v_k + ψ_k),
  0.5 + 0.18·sin(a·w_k + χ_k))` with `a = orbitClock·2π` and
  `(u,v,w)` mutually incommensurate per head.
  Head field `f_k = max(0, 1 − d_k/0.15)`. Tail: sample the head's path
  *backwards* in `a` over a lag window `0…(0.55 + tailLength·0.75)` radians and
  take `tail_k = max over lag of (1 − dist/0.085)·(1 − lag/lagMax)`.
  Tone: `max_k f_k > 0.30` ⇒ **primary** (the head);
  `max_k tail_k > 0.18` ⇒ **dark** (the tail); else **black**.
- **Direction (2nd param):** reverses all four paths.
- **Fixtures:** hull/silhouette = comets over black; Vintage = one bright chase
  head running the six heads with a two-head dark tail behind it; Organs = a
  stack flares as a head passes its bearing; signs = two dots with 2-px dark
  tails counter-orbiting an ellipse on the face.
- **Params:** `sliderLocalSpeed 0.30`, `sliderDirection 1.0`,
  `sliderLevel 0.88`, `sliderTailLength 0.56`.
- **Coverage note:** `05_ink_drops` in the tease shipped with a whole hull wall
  permanently black because its field never reached there (`_305` §4). Verify
  per-region coverage on **titanic** for this keeper specifically — four moving
  bodies over black is the same risk shape. No named region may be permanently
  unlit.

#### K09 — `09_lighthouse_fans`

- **Skeleton:** angular sweep in the top plane.
  `ang = atan2(shipWide−0.5, shipLong−0.5)/2π + 0.5`;
  `blades = 3 + floor(fanCount·3)`;
  `u = ang·blades + spinClock + sin(y·2π + breathClock·0.7)·0.05`;
  `frac_u = u − floor(u)`. Tone: `frac_u < 0.22` ⇒ **primary** (the blade);
  `0.22 ≤ frac_u < 0.55` ⇒ **dark** (the blade's wake, trailing behind it —
  swap the window when `sliderDirection` reverses so the wake always trails);
  else **black** (the shutter). Radial contour
  `wave(rad·2.1 − breathClock·0.42 + y·0.25)` shades blade depth within the
  primary band only. `spinClock` wraps at an even multiple of `blades`.
- **Direction (2nd param):** flips the `spinClock` increment **and** mirrors the
  wake window.
- **Fixtures:** hull/silhouette = blades sweeping bow→stern→bow; Vintage = a
  rotating 6-head alternation, blade head primary, trailing head dark, rest
  black; Organs = each stack sits at a fixed bearing, so a blade crossing it is
  a clean metronome; signs = a 4-blade local pinwheel at `spinClock/3`.
- **Params:** `sliderLocalSpeed 0.30`, `sliderDirection 1.0`,
  `sliderLevel 0.90`, `sliderFanCount 0.45`.

#### K10 — `10_celebration_burst`

- **Skeleton:** the finale — impulse-launched shells crossed with an angular ray
  comb. Three launch sites along `shipLong` fire on a staggered impulse train:
  site `k` age `age_k = frac(burstClock·0.5 + k/3)`;
  shell radius `R_k = burstReach·0.62·pow(age_k, 0.62)`;
  shell rim iff `abs(d_k − R_k) < (0.030 + burstWidth·0.030)`.
  Rays: `rayU = (atan2(...)/2π + 0.5)·(7 + floor(burstWidth·5)) + k·0.13`;
  ray iff `frac(rayU) < 0.30` **and** `d_k < R_k`.
  Tone: shell rim ⇒ **primary** (`v = 0.68 + (1 − age_k)·0.32` — a fresh burst
  is brightest); ray inside a shell ⇒ **dark**; else **black**. Fading shells
  keep their rim primary but their rays thin out with `age_k`.
- **Fixtures:** hull/silhouette = the bursts; Vintage = a rim sweeping the six
  heads outward from head 0 and head 5 alternately; Organs = a stack chain
  lights bottom-to-top as a rim crosses it — three launches per cycle; signs =
  two alternating mini bursts with a 5-ray comb.
- **Params:** `sliderLocalSpeed 0.30`, `sliderLevel 0.92`,
  `sliderBurstWidth 0.52`, `sliderBurstReach 0.64`.
- **Density note:** this is the brightest and busiest keeper. Keep the mean
  frame peak inside the family band (§6) — thin the rays, not the rims.

## 6. Gates

The `baby_tease` gates in `marsin_engine/tests/patterns/baby_color_contract.test.js`
carry forward unchanged. The answer-side gates are rebuilt for a single family.
**Every gate runs under BOTH palettes on BOTH models** (`titanic`, `test_bench`)
— four combinations per keeper. A gate that only ever ran pink would not catch
the defect it exists to catch.

- **G1 — Single-family purity (the reveal-integrity gate).** Every non-black
  pixel's `(R, G, B)` must be an exact scalar multiple of the **one** resolved
  family triple. Because §3 emits `familyTriple × k` and nothing else, this is a
  ratio identity, not a tolerance — assert the cross products
  `R·famG − G·famR` and `G·famB − B·famG` are zero to within one byte of
  quantisation. **ZERO opposite-family pixels** — `assert.equal(count, 0)`. A
  blue reveal with one pink pixel is a show-breaking defect.
- **G2 — Refusal.** With the slots at anything other than a sanctioned
  handshake — registry defaults, the live scene's persisted `h 0.8`, a
  wheel-style `s:1 v:1` pair, one slot right and the other wrong, and slot 2 at
  the wrong `v` — **every pixel of both models is exactly black, in every
  frame**. Also assert that the correct handshake does NOT produce black.
- **G3 — `DARK_K` agreement.** Parse `DARK_K` from every pattern source and
  `colorPalette2.v` from both `baby_reveal.yaml` show files; assert all twelve
  values are equal. (§2.6.)
- **G4 — Authority-block byte-identity.** The block of §3 hashes identically
  across all ten sources (whitespace-stripped), and each constant is declared
  exactly once per file. No per-pattern colour constant exists anywhere in the
  family.
- **G5 — Two-tone separation (R2).** Over a 30 s capture at saved defaults, the
  lit-pixel level histogram is **bimodal**: ≥25 % of lit mass above the bright
  threshold, ≥20 % below the dark threshold, and ≤20 % in the valley between
  them. This is the gate that decides whether the operator's darker-shade idea
  actually reads; it is measured, not asserted by taste.
- **G6 — W = A = U = 0**, every pixel, every frame, both models.
- **G7 — Per-fixture-family visibility.** Every fixture family
  (`FIX_BAR_18`, `FIX_VINTAGE_6`, `FIX_TE_SIGN`, the PAR chains) carries lit
  structure at defaults; no named region of the titanic model is permanently
  unlit (the `_305` §4 failure mode).
- **G8 — Anti-bilateral (R7).** Time-mean `P_h ≤ 0.35`, time-max `≤ 0.65` on all
  three axes, tone standing in for family.
- **G9 — Distinctness floor.** Every keeper differs from every other keeper in
  the family by mean delta > 1.5 at t = 5 s. With one colour this is a real
  test of *geometry*, since colour can no longer carry the difference.
- **G10 — Animated floor.** Peak per-pixel delta ≥ 40 and mean-frame delta ≥ 1.0
  over a 5 s sweep.
- **G11 — Silence.** No `AUDIO_MODULATION_V1` block in any source; every clock
  free-runs off `delta` alone.
- **G12 — Speed range.** Wrap safety at the legal maximum (18.93× reference):
  the worst single-frame clock jump stays well under its own wrap period, and no
  ownership front crosses a fixed point more often than once per 2 s.
- **G13 — Playlist integrity.** `baby_reveal.yaml` byte-identical across scenes;
  every entry's `defaults` names exactly the sliders its pattern exports; every
  pattern on disk appears in the playlist and vice versa; the retired
  `baby_boy.yaml` / `baby_girl.yaml` do not exist in either scene and
  `patterns/baby/` is gone.

## 7. Retirement and sweep

| removed | note |
|---|---|
| `marsin_engine/patterns/baby/*.js` (20 sources) | superseded wholesale; the directory itself is deleted |
| `simulation/scenes/{titanic,test_bench}/playlists/baby_boy.yaml` | retired |
| `simulation/scenes/{titanic,test_bench}/playlists/baby_girl.yaml` | retired |
| 20 `baby/NN_(boy\|girl)_*` keys in `pattern_goals.json` | replaced by 10 `baby_reveal/*` keys |
| `'baby'` in `MANIFEST_PATTERN_DIRS` | replaced by `'baby_reveal'` |
| the boy/girl twin tests in `baby_color_contract.test.js` | there are no twins any more |

`marsin_engine/patterns/baby/README.md` **moves** to
`marsin_engine/patterns/baby_reveal/README.md` and is rewritten for the new
world. Untracked or modified sources are backed up to
`C:/Users/TITANI~1/tmp/codex_baby_backup/` before deletion.

Known dangling references to expect and report rather than repair:
`marsin_engine/states/*/deck_state.yaml` is live runtime state and is left
alone; `simulation/scenes/titanic/timeline/playa_default.yaml` carries a
**pre-existing** dangling tease cue (`e_baby_tease_two_color_world_walk`) that
predates this wave.

## 8. Open decisions (D1–D6)

- **D1 — Keeper count.** Ten. The brief's range was 8–12 and the retired set was
  ten twinned concepts, so ten keeps the show's shape while dropping the
  duplicate half. Shelved candidates if Sina wants twelve: "keel breath" (a
  single slow longitudinal swell) and "porthole rows" (quantised windows lighting
  in reading order).
- **D2 — `FAMILY_TRIM` / `FAMILY_BAR_TRIM`.** Both ship at `1.00` (§3). The
  tease's pink trim existed to balance pink against blue in one frame; with one
  family there is nothing to balance and the mission argues for full drive. If
  pink reads hot on the bars on the rig, it is a one-constant edit across ten
  files.
- **D3 — `DARK_K = 0.28`. MEASURED AND CONFIRMED — the operator's suggestion
  works, and it beats the alternative.** A prototype carrying the §3 block and
  the K06 quilt skeleton was rendered on the real titanic model at
  `DARK_K ∈ {0.18, 0.22, 0.28, 0.35, 0.45}` plus a primary-plus-black control
  with no second tone, pink palette, 6 s at the reference operating point:

  | `DARK_K` | dark-tone peak | primary peak | ratio | bright % | dark % | **valley %** | lit % | purity |
  |---|---|---|---|---|---|---|---|---|
  | 0.18 | 30/255 | 225 | 7.50 | 68.3 | 31.7 | **0.0** | 29.8 | clean |
  | 0.22 | 37/255 | 225 | 6.08 | 68.3 | 31.7 | **0.0** | 29.8 | clean |
  | **0.28** | **47/255** | 225 | **4.79** | 68.3 | 31.7 | **0.0** | 29.8 | clean |
  | 0.35 | 59/255 | 225 | 3.81 | 68.3 | 31.7 | **0.0** | 29.8 | clean |
  | 0.45 | 76/255 | 225 | 2.96 | 68.3 | 31.7 | **0.0** | 29.8 | clean |
  | *none (control)* | 185/255 | 227 | *1.23* | 34.5 | 38.5 | ***27.0*** | *20.4* | clean |

  Two findings decide it. **(1) Same-hue two-tone is not muddy — it is perfectly
  bimodal.** Every two-tone variant puts *zero* percent of its lit mass in the
  valley between the tones: the composition is two clean tonal territories, not
  a gradient. **(2) The primary-plus-black control is measurably worse** on both
  axes — it lights 20.4 % of the rig against 29.8 %, and its histogram is *not*
  bimodal (27 % valley, 1.23:1 ratio), because with the second tone removed the
  only structure left is the stitch's own brightness ramp, which smears exactly
  the way the retired boy/girl set smeared.

  **0.28 is the pick.** It lands the dark tone at 47/255 — the middle of the
  contract's 20–65 dim band — at a 4.79:1 step below primary. 0.18 pushes the
  dark tone toward invisibility at fifty feet; 0.45 lifts it out of the dim band
  and starts closing the tonal gap.

  Every variant measured **clean** on purity: every lit pixel an exact scalar
  multiple of the family triple, W = A = U = 0 throughout.
- **D4 — Refusal renders black.** §2.4. The alternative — fall back to the last
  known family — is a P0 violation and risks the wrong answer. Confirm.
- **D5 — Playlist arc order** (§5). Approve or reorder; renumbering is a single
  coordinated landing.
- **D6 — Direction sliders** on K02/K05/K07/K08/K09. Approve, or drop for
  uniform three-slider layouts.
