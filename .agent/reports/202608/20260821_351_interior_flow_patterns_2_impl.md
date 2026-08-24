# 351 — `titanic_interior` flow patterns 136–145 + playlists: implementation

Implements the Fable spec `20260821_350_interior_flow_patterns_2_spec.md`: ten
new interior FLOW patterns, each on a different mathematical field, with a
shared per-module hue shift, plus the three interior playlist insertions.
Built against the parallel-Modules geometry landed in `_349`.

## 1. Files

### New patterns — `marsin_engine/patterns/`

| File | Field | Sliders (declaration = MFT knob order) |
|---|---|---|
| `136_curl_drift.js` | 2-D **curl of a noise potential** — divergence-free advection; density read back along three streamline lags | localSpeed, direction, scale, density, cohesion, whiteFoam, moduleHueShift, hueShiftFreq |
| `137_reaction_ripple.js` | **Gray-Scott reaction-diffusion**, one independent 1-D culture per module | localSpeed, feed, stir, contrast, whiteFoam, +hue pair |
| `138_gerstner_swell.js` | **Trochoidal (Gerstner) waves** — horizontal displacement fed back into the sample coordinate | localSpeed, direction, steepness, wavelength, cohesion, whiteFoam, +hue pair |
| `139_kuramoto_glow.js` | **Kuramoto phase-coupled oscillators** — neighbour + cross-module mean-field coupling | localSpeed, coupling, spread, cohesion, whiteFoam, +hue pair |
| `140_voronoi_cells.js` | **1-D Voronoi** over seeds on Lissajous paths; cp2 on the equidistant ridge | localSpeed, direction, cells, edge, whiteFoam, +hue pair |
| `141_lissajous_interference.js` | **Superposition / beats** — two carriers at an irrational wavenumber ratio plus a standing term | localSpeed, direction, detune, standing, cohesion, whiteFoam, +hue pair |
| `142_warped_current.js` | **Two-level domain warping** `n(u + a·n(u + b·n(u)))` | localSpeed, direction, warp, scale, whiteFoam, +hue pair |
| `143_logistic_drip.js` | **Logistic map** `x ← r·x(1−x)`; each iterate launches a drip, seam splash | localSpeed, chaos, tail, splash, whiteFoam, +hue pair |
| `144_soliton_train.js` | **KdV solitons** — analytic `sech²`, speed set by height, so they overtake and pass through | localSpeed, direction, amplitude, spacing, cohesion, whiteFoam, +hue pair |
| `145_vortex_street.js` | **Von Kármán vortex street** — alternating-sign shedding, advection + decay | localSpeed, direction, shedRate, decay, whiteFoam, +hue pair |

`direction` is the **second** slider wherever it exists (137/139/143 have none
by design); the `moduleHueShift` / `hueShiftFreq` pair is declared **last** in
all ten (memory note `pattern-param-order`, spec §2).

All ten derive geometry from `render3D(index, x, y, z)` normalised coords only:
`u = x`, `SEAM = 0.5454545`, `moduleId = floor(nz * 6)` clamped 0..5 (the cross
axis **is z** — `_349` §4), `travelOf()` compressing Seg2 by `SEG2_FLOW = 1.15`.
Per-module offsets are deterministic irrational multiples of `moduleId`
(GOLDEN_ANGLE / PHI / SQRT2) — never random, never a 1/6 period. No `fId`, no
`index`, no fixture metadata, so the composition is model-agnostic.

### Shared per-module hue shift (identical block in all ten)

`dH_m(t) = A · sin(2π f t + m · GOLDEN_ANGLE · 2π)`, with
`f = 0.005 + 0.095 · hueShiftFreq²` Hz. `wave(p)` **is** `0.5 + 0.5·sin(2πp)`,
so `2·wave(p) − 1` is exactly that sine on a 0..1 turn; the phase is accumulated
**already scaled by f**, so the `PHASE_WRAP` (an integer number of turns) is
exactly continuous and a slider move never steps. Applied to cp1 **and** cp2
hue before any blend; S and V untouched; at `moduleHueShift 0` the palette is
bit-identical to the un-shifted one.

### Playlists — `simulation/scenes/titanic_interior/playlists/`

| File | Entries | Notes |
|---|---|---|
| `flow.yaml` | **13** (5 existing + 8 new) | no modulations; `moduleHueShift 0.5`, `hueShiftFreq 0.25` on every new entry; 144 at `cohesion 0`, 141 at `cohesion 0.6` |
| `flow_sound.yaml` | **10** (5 existing + 5 new) | every new entry carries its §3 hook as a `cpc` continuous modulation, `mode: override`, `polarity: unipolar`; `hueShiftFreq 0.45` |
| `default.yaml` | **10** (5 existing + 5 new) | only the 134 entry modulated; `moduleHueShift 0.4` |

Order is exactly the spec §4 table. Existing entries were carried over
unchanged (only their ids renumbered to their new position); ids follow
`e_<playlist>_<n>_<pattern>`; every declared slider is set explicitly; each
modulated slider's stored default equals its modulation range floor. The files
were written through `js-yaml`'s `dump()` — the same writer `PlaylistManager.save`
uses — so the formatting matches the rest of the tree.

### Manifest

`marsin_engine/patterns/manifest.json` already contained 136–145 by the time
this wave went to register them: **the manifest is auto-synced from the patterns
directory by the running engine**, and it had picked the ten up (along with
131–135 and another wave's `white_only/21..25`). It was not hand-edited. The
tracked file is modified in the working tree; `node engine.js --list` shows all
ten, and the boot in §4.6 loads from it.

## 2. Three hard VM limits found by measurement (and what they forced)

These were discovered by probing the WASM VM directly, not assumed. They shape
several design choices and are worth keeping.

1. **`beforeRender` is cut off after roughly 2000 bytecode instructions per
   frame.** Past the cap the rest of `beforeRender` is *silently skipped* — no
   error, no log: the pattern simply stops evolving (or evolves only up to
   wherever the cut landed). Measured with a counted loop: ~290 iterations of an
   empty body, ~161 of a light body, ~82 of a Gray-Scott-weight body. `render3D`
   has no comparable cap (200 `perlin()` calls per pixel ran fine).
2. **The array arena holds roughly 250 cells TOTAL across all of a pattern's
   arrays** (2×136 cells OK, 2×144 not; 3×85 OK, 3×96 not). A single array can
   reach ~250, but the budget is shared.
3. **A value-returning helper that declares a local `var` reads back as 0 when
   it is called from `beforeRender`** (and when it is called more than once in a
   single expression). Void helpers with locals are fine; single-expression
   returning helpers are fine. This one cost real debugging time: `139`'s
   `_omega()` looked correct, compiled, and returned 0 — the whole natural-
   frequency carrier was dead and `sliderSpread` measured DEAD in param_truth
   until `_omega` was rewritten as one expression with no locals.

Consequences, all documented in the files themselves:

- The six-module HSV palette bake costs **34 %** of the `beforeRender` budget,
  so it is **round-robin: one module re-baked per frame** (all six on the first
  frame so nothing is ever unlit). The hue sine's fastest full cycle is 10 s, so
  a 6-frame (150 ms) stagger is 1/66 of a cycle — invisible, and it hands the
  budget back to the composition.
- `137` runs **16 cells per module** (not the spec's 48 — two 288-cell lanes do
  not fit the arena) and sweeps **modules round-robin**, ≤3 module-steps per
  frame. Each module is an independent culture with no cross-module term, so
  sweeping them on different frames changes nothing about the chemistry. Cells
  are read back with a smoothstep so 16 cells render as a continuous film.
- `139` runs **10 oscillators per module** (not 24) and splits the work: every
  phase advances by its own natural frequency **every frame** (that is what keeps
  the glow smooth), while the coupling is applied as a bounded nudge to a
  round-robin slice of indices.
- `137` and `139` also seed **one module per frame** for the first six frames —
  seeding the whole bank at once overran the budget and the work that got cut was
  everything after it, including the palette bake (the room rendered black).

## 3. Deviations from the spec (all deliberate, none silent)

1. **`137` grid is 16 cells/module, `139` bank is 10 oscillators/module** — VM
   array arena and `beforeRender` budget, §2. The spec's 48 and 24 do not fit.
2. **Hue-shift amplitude is `0.054`, not `0.06`.** The spec states both
   `A = 0.06·moduleHueShift` and a hard cap of `ΔH ≤ 0.06` *measured from the
   output*. Those cannot both hold: an 8-bit RGB frame only resolves hue to a
   few thousandths of a turn, and at `A = 0.057` the measured per-pixel maximum
   sat at 0.060–0.068 depending on the chroma floor. The cap and the explicit
   validation gate win over the amplitude constant; `0.054` puts the **measured**
   maximum at 0.0575 with margin (§4.3).
3. **`137`'s Gray-Scott window was chosen by an offline sweep**, not taken from
   the classic map: `Du = 0.06`, `Dv = 0.03`, `k = 0.062`, feed `0.042..0.052`.
   With a 16-cell no-flux lane the alive/dead boundary is a knife edge, and the
   spec's `PHI·moduleId·1e-3` feed offsets straddle it — at the first parameter
   set module 1's culture died. This window is where all six modules stay alive,
   patterned and still crawling after a long run.
4. **`137` carries a chemostat** — a gentle *blend* (never an additive kick) at
   one slowly wandering site per module. Copied from `41_reaction_diffusion`,
   which uses the same device for the same reason; without it a culture can
   settle into a flat equilibrium over a show-length run.
5. **`138` and `144` snap their alternate-module reversal at `cohesion 0.5`**
   rather than blending it, exactly as the spec words `138`. `133` already snaps
   for the same reason: a blended heading crosses zero and leaves those modules
   *stalled*, and a stalled swell/soliton is not one. It is a snap in the
   slider, never in time, and no playlist modulates `cohesion`.
6. **`136`'s even-module reversal is gated on `cohesion` too.** §3 words it as
   "even modules reversed via `direction`" (unconditional), but §1's cohesion
   contract ("all modules identical at 1") and validation gate #4 both require
   the modules to collapse at `cohesion 1`. Two statements beat one: the
   reversal fades out with `cohesion`, using the same snap idiom.
7. **Audio header curve vocabulary** — same deviation as `_348` §2.1: the
   `AUDIO_MODULATION_V1` header vocabulary is `linear|pow2|ease`, so headers say
   `ease` where the spec says `easeOut` and `pow2` where it says `easeIn`; the
   playlist YAMLs carry the spec's `easeOut`/`easeIn` verbatim. Same curve, two
   spellings.
8. **`flow` has 13 entries, not 15.** The spec's §5 says 15/10/10 but its own §4
   ordering for `flow` lists thirteen entries (5 existing + 8 inserted).
   The §4 table is what was built; `flow_sound` and `default` are 10/10 as
   stated.
9. **`default.yaml`'s `hueShiftFreq` is the pattern code default (0.30).** §4
   names only `moduleHueShift 0.4` for that playlist and is silent on the rate.
10. **`145` adds a small golden-angle ramp on top of the anti-phase offset.**
    Strict `0.5 · (moduleId % 2)` alternation alone makes modules 1/3/5 render
    *identically* (measured pairwise correlation 0.995). The ramp is 0.069 per
    module, so neighbours stay 0.569 apart — still reading as anti-phase — while
    no two modules share a phase.

## 4. Validation

### 4.1 Engine suite — `cd marsin_engine && npm test`

**4030 tests · 4025 pass · 5 fail · 0 skipped · 0 todo** (320 s).

All 5 failures are the same pre-existing set `_348` reported, none naming a file
from this wave:

| Failing test | Why | Owner |
|---|---|---|
| `every model file under models/ is discovered` | pinned model count vs the untracked `titanic_interior` / `dev_test_bench` | the `_346` scene wave |
| `titanic_interior: cross-fixture (universe,channel) overlap count is pinned` | no pinned expectation for the new model | the `_346` scene wave |
| `qualified package … EQ-rise companion` | `party_dancers_eq` | unrelated |
| `every non-diagnostic Ambient reuse inherits the canonical static entry` | `titanic/night_ember_hold.yaml` drift | the night-arc wave |
| `the committed playlist tree is synchronized by the permanent tool` | 8 untracked `titanic` / `test_bench` night-arc playlists | the night-arc wave |

The last one names only `scenes/titanic/` and `scenes/test_bench/` files — the
three interior playlists this wave rewrote are **not** in its diff.

### 4.2 Cross-model param sweep — `tools/param_truth`, `titanic_interior` with `--cross-model test_bench`, output written outside the repo

**10 patterns ok · 0 compile errors · 0 DEAD.**
`TRUE 30 · WEAK 7 · WRONG 22 · UNKNOWN_CLAIM 15`.

The 22 WRONG rows are three known classes and nothing else:

- **`sliderWhiteFoam` ×9** — `white_amber_emitters_unchanged`, `wMean swing
  0.0000`. **The same signature as `_348`**: these patterns emit **RGB only** and
  the rig derives W natively, so the VM's W lane is byte-zero by design while the
  sweep still moved `contrastRatio` by 0.06–0.46 on every one of them.
- **`sliderModuleHueShift` ×9 + `sliderHueShiftFreq` ×2** —
  `hue_and_saturation_static` / `temporal_rate_did_not_track_slider`, rig-wide
  hue swing 0.0002–0.0022 turns. The harness measures **whole-rig** hue; the
  shift is **per module** with golden-angle-distributed phases, so the six shifts
  very nearly cancel across the room — which is the design intent ("the room
  reads as one colour", spec §3 colour rule). Measured **per module** the same
  control moves the hue by 0.0547–0.0575 (§4.3). Measurement-domain mismatch,
  not a dead control.
- **`sliderDirection` ×2 (138, 144)** — `no_reversal_net_travel_or_velocity_series`.
  The harness's own documented limitation for mirror-symmetric motion, the same
  one `133` hits: at their default `cohesion` the alternate modules run opposite
  ways, so rig-wide net travel cancels by construction. Measured directly, the
  knob is very much alive: flipping `sliderDirection` 0 → 1 moves **15.6 M** byte
  units on 138 and **16.7 M** on 144 over a 200-frame window.

The 7 WEAK rows are the same hue-pair and `whiteFoam` classes.

`sliderSpread` on `139` came back **DEAD** on the first sweep — a real defect,
caused by VM limit §2.3. Fixed (`_omega` rewritten with no locals) and re-swept:
now live, 5.8 M byte units across its range, and the pattern's whole-rig motion
tripled once the carrier actually ran.

### 4.3 Offline render contract (scratch harness, both models)

Per pattern: 400 frames at 40 fps after 40 warm-up, code defaults, palettes
pinned to the spec's cp1/cp2 (the bare VM seeds the HSV picker exports
independently, so an unpinned sweep measures whatever colour the VM happened to
seed — the first run of this harness was accidentally measuring red).

**`titanic_interior` — 10/10 pass:**

- **0** non-finite or out-of-range channel bytes.
- **Per-module mean brightness** 0.060–0.173 (gate: ≥ 0.02 and ≤ 0.95); the
  worst single-frame per-module minimum across the family is **0.040**.
- **Motion on every module of every pattern** — mean |Δbyte| per channel per
  frame 0.015 (136, the slow smoky one) to 0.709 (143).
- **Hue-shift bound, measured from the output** at `moduleHueShift 1`,
  `hueShiftFreq 1`, over a full period, per PIXEL against the same frames
  rendered at `moduleHueShift 0`: **max 0.0575** across all ten (cap 0.06); the
  per-pixel mean is 0.024–0.055, and the family mean sits at ≈ 0.035 ≈
  `0.637 × 0.054`, which is exactly the mean of `|sin|` for that amplitude.
  (Pixels below a chroma floor are excluded — their hue is not resolved by 8-bit
  output. Raising the floor from 16 to 96 moves the measured maximum from 0.068
  to 0.059, which is how the residual was identified as quantisation.)
- Slider export order confirmed as declared, `sliderDirection` second wherever
  it exists, the hue pair last in all ten.

**`test_bench` — all ten render clean**: 0 bad bytes, motion > 0, per-module
means 0.060–0.209, hue max 0.0573. Only four of the six `floor(nz*6)` bands are
populated on that model, so the harness reports `NaN` for the two empty
bands — a fact about `test_bench`, not about the patterns.

**Long-run stability (137 / 139 / 143), 5 minutes simulated = 12 000 frames:**
all three **STABLE** — 0 bad bytes, no module ever below 0.0298 or above 0.2859
frame luma, and every module still moving at the end.

### 4.4 Per-module distinctness

Space-time brightness profiles (32 `u` bins × 50 sampled frames), pairwise
correlation between modules. A *time-averaged* profile flattens all motion away
and measures noise, so the comparison is frame-by-frame.

| Pattern | `cohesion 0` worst pair | `cohesion 1` best-separated pair |
|---|---|---|
| `136_curl_drift` | **0.596** | **0.963** |
| `138_gerstner_swell` | **0.288** | **0.996** |
| `139_kuramoto_glow` | **0.526** | **0.998** |
| `141_lissajous_interference` | **0.563** | **0.996** |
| `144_soliton_train` | **0.239** | **0.995** |

All five clear the gate (< 0.9 at cohesion 0, > 0.95 at cohesion 1). The five
patterns with no `cohesion` slider carry their per-module effects permanently;
at code defaults their worst pair is `137` 0.643, `140` 0.894, `142` 0.839,
`143` 0.596, `145` 0.689 — all below 0.9.

### 4.5 Playlist load

All three load through the engine's own `PlaylistManager` with **zero warnings
and zero errors**; every `defaults` key resolves to a declared `slider*` export,
every declared slider has an explicit default, every modulation target is a real
slider, and every modulated slider's default equals its range floor. Entry
counts 13 / 10 / 10, no duplicate ids.

### 4.6 Engine boot on a scratch port

`node engine.js --model titanic_interior --pattern 136_curl_drift --port 17311`
pointed at a TEST-NET blackhole with `--dest`, with `MARSIN_STATE_DIR` / `MARSIN_TIMELINE_DIR` redirected
outside the repo and `BM26_CAPTAINPAD_AUTH_REQUIRED=0`:

```
✅ Model loaded: 1980 pixels
[Model] Pattern constants: MASK_MODULE_1 … MASK_MODULE_6
✅ Pattern compiled via MarsinCompiler (bytecode)
✅ Shared DMX mapper: 1980/1980 pixels patched across 18 universe(s) [1..9, 11..19]
[sACN Out] Sender started — 18 universe(s), priority 100, destinations [<TEST-NET blackhole>]
✅ Playlist library: 3 playlist(s) in ..\simulation\scenes\titanic_interior\playlists
▶ Rendering "136_curl_drift" at 40 fps
🌐 Output Server listening on HTTP/WS port 17311
```

`node engine.js --list` shows all ten names. The timeline auto-write landed in
the redirected scratch directory, so the scene's foreign-owned
`timeline/playa_default.yaml` was never touched. Every reserved port
(`6966`–`6972`) was still listening after the probe, and the scratch port was
released when the process exited.

### 4.7 Sim renders — `.agent/skills/see_the_world.md`

Captured through `agent_render.cjs` against the **already-running** operator sim
on `:6969`, read-only: the scene was switched with the URL
(`?scene=titanic_interior&profile=…&renderer=webgl&lighting_mode=pixelblaze`),
patterns were compiled into the sim's own in-browser pattern engine with cp1/cp2
pinned to the spec's palette, and **nothing was saved** — no scene write, no
pinned-scene change, and no built-in browser tool touched the sim. 1280×720
(SwiftShader). Both probe browsers were closed and the `--open` lock removed.

All seventeen frames were **visually inspected**. `.agent_renders/`:

| Pattern | Frames | What is visible |
|---|---|---|
| `136_curl_drift` | `1787430711_…_ti_t0.png`, `1787430805_…_ti_t0.png` | six parallel modules, teal body with pale drifting smoke bands; the bands sit at clearly different places on adjacent modules |
| `137_reaction_ripple` | `1787430813_…_ti_t0.png`, **2D** `1787430962_…_ti_2d_pixels.png` | the 2D Pixel Map (`Modules`, `6 fix · 1980 px`) shows six rows each carrying a *different* arrangement of spots — the independent per-module cultures, exactly what the feed offset is for |
| `138_gerstner_swell` | `1787430741_…_ti_t0.png` + `1787430745_…_ti_t1.png` | sharp pale crests over wide dark troughs; between the two frames every crest has moved along its line, and the crests are **fanned** across modules rather than aligned (per-module speed scaling + alternate reversal) |
| `139_kuramoto_glow` | `1787430820_…_ti_t0.png` | discrete pulsing nodes along each line, partly in step and partly not |
| `140_voronoi_cells` | `1787430827_…_ti_t0.png` | broad bright cells with faint warm cp2 dashes on the cell walls |
| `141_lissajous_interference` | `1787430834_…_ti_t0.png` | fine beating fringes, spacing visibly different module to module |
| `142_warped_current` | `1787430841_…_ti_t0.png` | smooth marbled current, calmer on the top modules than the bottom ones (the per-module warp gradient) |
| `143_logistic_drip` | `1787430752_…_ti_t0.png` + `1787430755_…_ti_t1.png` | bright drips scattered at independent positions per module; in the second frame every drip has slid downstream and new ones have appeared upstream |
| `144_soliton_train` | `1787430762_…_ti_t0.png` + `1787430766_…_ti_t1.png`, **2D** `1787430938_…_ti_2d_pixels.png` | humped pulses with pale crowns; the 2D map shows each module's train at its own spacing and phase |
| `145_vortex_street` | `1787430774_…_ti_t0.png` + `1787430778_…_ti_t1.png` | eddies brightest just downstream of the invisible post at one end, decaying along the run; neighbouring modules' eddies are offset from each other |

The `t0`/`t1` pairs are 3–4 s apart (each capture is its own process launch, so
a literal 1 s gap was not achievable through the skill's CLI). Every pair is
plainly different, which is the point of the check. A `Shortcuts` pill and two
small carousel arrows remain in a corner of the 3-D frames — cosmetic only, the
strands are unobstructed; the 2-D captures deliberately use `--show-ui` because
the Pixel Map *is* a panel.

### 4.8 Security

`python scripts/security_check.py --all` → **7 findings, none in any file from
this wave**: six pre-existing MACs inside the gitignored
`simulation/.scene_backups/studiodj/…`, one pre-existing SSID literal in
`simulation/tests/led_gamma_workflow.test.js`. No commits, no pushes.

## 5. Residue and things the operator should know

1. **`marsin_engine/patterns/manifest.json` is modified in the working tree.**
   It is auto-synced by the running engine and had already absorbed 131–145 plus
   another wave's `white_only/21..25` before this wave looked at it. Reported,
   not reverted, not hand-edited.
2. **Test residue.** `npm test` left two scratch temp files:
   `marsin_engine/states/test_bench/.globals_state.yaml.<pid>.tmp` and
   `.mixer_state.yaml.<pid>.tmp` (untracked). Reported, not deleted.
3. **Not mine.** `marsin_engine/states/titanic/*` (modified),
   `marsin_engine/states/titanic_interior/` (untracked, last written well before
   this wave's boot — my boot's state went to the redirected scratch dir),
   `marsin_engine/tests/patterns/{specialty_white_uv,white_only_contract}.test.js`
   (modified), the untracked `models/titanic_interior.*`, `patterns/131..135`,
   `patterns/white_only/21..25`, and the other waves' untracked reports were all
   already in the tree. Untouched.
4. **The three `whiteFoam` / hue-pair param_truth classes will keep reporting
   WRONG** on any future sweep. Judge `whiteFoam` on the wire, not on the VM's W
   lane (`_348` §4), and judge the hue pair **per module**, not rig-wide — the
   whole point of the design is that the six shifts cancel across the room.
5. **The VM limits in §2 are worth writing into the pattern spec.** In
   particular the silent `beforeRender` cut-off: a pattern that quietly stops
   evolving is very easy to misread as a physics bug, and the returning-helper-
   with-locals failure produces a plausible-looking zero rather than an error.
6. No commits, no pushes, no service restarts, no reserved port bound or killed.

---

# Surge onset continuity fix

Follow-up wave on `134_surge` only. Operator report, their words: *"the
sound-reactive surge, in unison, in titanic_interior: when a new sound signal
comes in, the old one gets killed in the visuals in the middle — bad visually,
like a glitch."*

## 1. Root cause

`134_surge` carried **one** wavefront, tracked by a single scalar `frontAge`,
and every launch was a **reset** of it:

```js
var frontAge = 0.0;                 // ONE front, ONE accumulator
...
if (launch == 1) frontAge = 0.0;    // <- an onset REWINDS the front in place
```

So a kick arriving while a front was mid-room teleported that front from
wherever it was back to the head of the line. There was never a second front:
the old one did not decay, it was *overwritten*. Two smaller contributors rode
along with it:

- `front = front * (0.55 + clamp01(surge) * 0.45)` read **live** `surge`, so
  every micKick spike also stepped the brightness of whatever was in flight.
- `RETRIGGER_SEC = 0.35` meant a burst of kicks closer than 350 ms was
  *swallowed* — measured below as a burst of three producing **less** light
  than a single hit.

## 2. Fix

A **ring bank of wavefronts** — the idiom `143_logistic_drip` already uses in
this same family:

- `fAge = array(8)` / `fAmp = array(8)` (16 of the VM's ~250 array cells).
  `fAge[k]` is the local-clock age of slot k, `DEAD = 99.0` means empty.
- A launch writes the slot at the ring cursor `fIdx` (`fAge = 0`, `fAmp =
  0.55 + surge*0.45` — its **birth** amplitude) and **touches nothing else**,
  then advances the cursor mod 8. O(1); the recycled slot is by construction
  the oldest, i.e. the most faded.
- `beforeRender` advances every live `fAge` forward on the one shared clock and
  never rewinds any of them. Slots retire at
  `fAge > LIFE + 5 * stagger * STAGGER_SEC` — the stagger term matters: render
  reads slot k at `fAge[k] - lineId*stagger*STAGGER_SEC`, so retiring on the
  bare `LIFE` would chop the **last** module's front off exactly the way an
  onset used to. (Found by measurement, §3 — it was a defect in the first cut
  of this fix, not in the original.)
- `render3D` **sums** the live slots. Each carries its own `smoothUnit` profile,
  its own tail envelope `(1.25 - travel)/0.25`, and its own seam `lipFlash`,
  so old and new coexist and add.
- Live `surge` now enters only through a one-pole follower `surgeEnv`
  (attack 0.18 s / release 0.45 s) as `gain = 1.0 + surgeEnv * 0.20`. It
  **rests at 1.0x**, so with no audio the pattern renders identically to the
  single-front version; a spike lifts the room over ~180 ms rather than
  stepping it, and `sliderSurge` stays a measurably live control.
- `RETRIGGER_SEC` 0.35 -> **0.07 real seconds** (~3 frames), and it now runs off
  a separate real-time `debounce` accumulator rather than the speed-scaled
  clock, so a 100 ms burst stacks at every `localSpeed`. The guard only has to
  reject same-onset jitter now: a retrigger is additive, so it can no longer
  destroy anything.

Unchanged: every export and its declaration order (`direction` still 2nd), the
palette/white behaviour, `SEAM = 0.5454545` and `travelOf()`, the
`AUDIO_MODULATION_V1` header, and the playlist modulation contract. No new
controls. `width` was deliberately left **live** (not captured at launch) so
`sliderWidth` keeps its `TRUE` param_truth verdict.

`beforeRender` cost is well inside the ~2000-instruction cap (§2 above): two
palette bakes plus an 8-iteration light loop. The render-side 8-slot sweep
early-outs on `abs(u - pos) < w` — exact, since `smoothUnit` is already 0
outside the half-width — which is what keeps the per-frame cost where it is.

## 3. Measurements

Offline render contract on the **real VM and the real `titanic_interior` model**
(1980 px, 40 fps, 320 frames), driven by a synthetic onset train straight into
`sliderSurge` — the lane `mod_sliderSurge_micKick` writes. Train: hits at
1.0/1.5/2.0/2.5 s, then a burst of three 100 ms apart at 4.0/4.1/4.2 s. Both
`flow_sound` seats: **unison** (`e_flow_sound_7_134_surge`, stagger 0) and
**per-module** (`e_flow_sound_0_134_surge`, stagger 0.4).

The decisive gate is **injection monotonicity**, which needs no tuned bound:
render the same clip **with** and **without** the burst. An onset that injects
energy can only make the room brighter, so `with[f] >= without[f]` must hold at
every frame from t=4.0 on — in total emitted energy and in mid-room
(`nx > 0.35`, light already well past where a new front is born) energy alike.
Both clips are byte-identical before the burst (divergence 0.0), proving they
are otherwise the same clip.

| Measurement | before -> after (unison) | before -> after (per-module) |
|---|---|---|
| **mid-room shortfall vs no-burst** (the bug) | **100.00 % -> 0.00 %** | **100.00 % -> 0.00 %** |
| total-energy shortfall vs no-burst | 0.00 % -> 0.00 % | **37.05 % -> 0.00 %** |
| worst total-energy drop at an onset frame | 7.84 % -> **0.00 %** | 37.96 % -> **0.67 %** |
| worst wavefront-energy drop at an onset frame | 13.97 % -> **0.00 %** | 79.95 % -> **0.67 %** |
| 3 stacked hits vs 1, peak wavefront energy | 1.834x -> **2.193x** | 1.000x -> **2.248x** |
| 3 stacked hits vs 1, integrated energy | 1.130x -> **2.099x** | 1.067x -> **2.086x** |
| NaN / out-of-range samples | 0 -> 0 | 0 -> 0 |
| fully-black frames | 0 -> 0 | 0 -> 0 |
| mean VM render (1980 px) | 2.10 ms -> 2.98 ms | 2.07 ms -> 2.78 ms |

`CONTRACT_PASS` in both modes; the pre-fix pattern `CONTRACT_FAIL`s in both.
The old "stacking" numbers above are an artifact of the live-`surge` term (three
resets simply held `surge` high longer), not of fronts adding — in per-module it
is exactly 1.000x, i.e. three kicks produced no more light than one.

Notes on the residual numbers:

- The post-fix per-frame *decay* is smooth, not stepped: frames 165/166/167
  around the burst read 7.99 % / 8.14 % / 6.83 %, a continuous ramp with no
  onset-aligned step. That is fronts running off the end of the line, and it is
  present identically in the no-burst counterfactual — which is what the 0.00 %
  shortfall proves.
- **Ring-wrap stress.** 13 kicks 80 ms apart forces 5 slot recycles. Worst
  single-frame total-energy drop *during the recycles* (t 5.60-6.10 s):
  **0.08 %**. A recycled slot is the most faded one and it is one of nine live
  fronts, so the depth of 8 is not a visible limit.
- **Rest parity.** With no audio at all, old vs new total energy is **0.000 %**
  different from frame 120 on (bit-identical), converging to <0.5 % by frame 13.
  The only difference is at boot: the new code launches the first ambient front
  at age exactly 0 where the old one started it a single frame (25 ms) in.

### Other gates

- **`cd marsin_engine && npm test` -> 4030 tests / 4025 pass / 5 fail / 0
  skipped / 0 todo** (238 s). The same five pre-existing failures §4.1 lists,
  by name, none touching this wave.
- **`tools/param_truth/run_param_truth.mjs --pattern 134_surge --model
  titanic_interior`** -> `TRUE 3 / WEAK 0 / WRONG 1 / DEAD 0 / UNKNOWN_CLAIM 2`.
  `sliderLocalSpeed` / `sliderDirection` / `sliderWidth` **TRUE**;
  `sliderSurge` alive (effect 0.3599) and `sliderStagger` alive (0.2382) under
  `UNKNOWN_CLAIM` (their names make no falsifiable claim); the single WRONG is
  `sliderWhiteFoam`, the known RGB-only-emitter class §4.2 and `_348` §4
  describe. **No DEAD, no new WRONG.**
- **`tools/pattern_audio_harness.mjs`, real DSP, `edm_drop`, 16 s, all three
  header modulations wired** -> `GATE_PASS` in both modes.
  Unison: `meanMs=2.83 worstMs=5.17` against a `budget/ch=6.25ms`,
  `darkFrac=0.00`, all six modules lit 330/330,
  `micKick->sliderSurge corr 0.41`, `micLow->sliderWidth 0.94`,
  `micFlux->sliderLocalSpeed -0.70` — all REACTIVE.
  Per-module: `meanMs=2.78 worstMs=4.91`, same verdicts.
- **Scratch-port engine boot.**
  `MARSIN_STATE_DIR=<scratch> BM26_CAPTAINPAD_AUTH_REQUIRED=0 node engine.js
  --pattern 134_surge --model titanic_interior --port 17347 --dest <a TEST-NET
  discard address>`
  -> model 1980 px, pattern compiled via MarsinCompiler, DMX mapper 1980/1980
  across 18 universes, `Rendering "134_surge" at 40 fps`. The reserved operator
  ports were never touched and the state redirect held (§5).
- **No `see_the_world` render pair.** The operator stack is live on 6966-6972;
  putting `134_surge` on `titanic_interior` in front of it would mean rebinding
  the live engine/sim, which is exactly what is banned, and a read-only `:6969`
  capture would only show whatever the operator has up. The
  `pattern_audio_harness` visual captures are the offline equivalent and are
  where the evidence above comes from.

## 4. The other audio-modulated interior patterns: audited, none needed the fix

Every slider any interior playlist drives from audio, and what it touches:

| Pattern | Audio-driven slider(s) | Verdict |
|---|---|---|
| `131_river_run` | `level` <- micLow, `turbulence` <- micFlux | continuous amplitudes in `render3D` only — safe |
| `132_tide_pools` | `spillGain` <- micKick | scales lip width + spill amplitude only; the only accumulator, `cyclePhase`, is never touched — safe |
| `133_counter_current` | `density` <- micHigh | sets the drift **count**; lane phases are `driftPhase*spd + seed` with `seed` independent of the count, so existing lanes never move — safe (see below) |
| `136_curl_drift` | `density` <- micLow | continuous — safe |
| `138_gerstner_swell` | `steepness` <- micLow | continuous amplitude/exponent — safe |
| `141_lissajous_interference` | `standing` <- micFlux | continuous — safe |
| `143_logistic_drip` | `chaos` <- micFlux, `splash` <- micKick | `chaos` moves the logistic `r` of an ongoing map (no reset of `lgx`); `splash` is a render-side scalar. Drips launch off the internal tick clock, not audio, and already use a ring buffer — safe |
| `145_vortex_street` | `shedRate` <- micFlux | `shed[mm]` is **accumulated** as `dt * BASE_RATE * localGain * sr`, a rate not a phase multiplier; the file says so in a comment — safe |

`134_surge` was the **only** interior pattern with an edge-triggered reset. A
repo-wide grep for the idiom (`prev*` + threshold) finds it only in
`29_kick_shockwave`, `36_orbital_pulse` and `48_heartbeat_drive` — all
**exterior**, out of this wave's scope. Of those, `48_heartbeat_drive` does
`envPhase = 0.0` on a kick edge; that is a deliberate re-arm of a lub-dub and it
is not on any interior playlist, so it was left alone and is flagged here rather
than changed.

One thing worth an operator eyeball, not changed here: `133_counter_current`'s
`density` <- micHigh changes a lane **count**, so a lane pops in/out as micHigh
crosses a step. Nothing in flight is reset or moved, so it is not the reported
bug's class, and changing it would alter the authored `density` semantics
without an ask.

## 5. Residue

1. `marsin_engine/patterns/134_surge.js` rewritten in place. Still untracked (it
   was untracked before this wave too). **No commits, no pushes.**
2. No other repo file changed. The foreign-owned timeline/playlist files were
   read only.
3. The engine boot's state went to the redirected scratch dir
   (`MARSIN_STATE_DIR` under `~/tmp/`), verified: nothing new appeared under
   `marsin_engine/states/`. The `states/titanic/*` modifications,
   `states/titanic_interior/` and the two `states/test_bench/*.tmp` files are
   all older than this wave's boots — the same residue §5 above already reports.
4. Harness and baseline copy live in `~/tmp/surge_check/` (gitignored, outside
   the source tree): `surge_onset_contract.mjs`, `134_surge_OLD.js` (the
   pre-fix pattern, kept only as the A/B baseline), the `param_truth` output and
   the two `pattern_audio_harness` capture JSONs.
5. No reserved port bound or killed; the operator stack on 6966-6972 was never
   contacted.
