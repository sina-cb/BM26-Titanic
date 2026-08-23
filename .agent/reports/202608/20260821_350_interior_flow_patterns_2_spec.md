# 350 — Spec: `titanic_interior` flow patterns, wave 2 (136–145)

Planner spec (Fable) for an Opus implementer. Nothing here is implemented.
Builds on spec `_347` / impl `_348` (131–135). Operator: "the patterns look
great, add 10 more" — ten new FLOW/water patterns, each on a **different
mathematical field**, with strong **per-module** character.

## 1. Geometry contract (updated for the parallel re-lay)

The six 330-px strings ("Modules") are being re-laid as **parallel, evenly
spaced lines** (concurrent wave, report `_349`). Assume that layout:
- `u = x` along the line (0..1), seam at `SEAM = 0.5454545`; flow is
  continuous across the seam unless a pattern names the seam as a feature.
- `moduleId ∈ 0..5` = `floor(v * 6)` clamped, where `v` is the **cross-axis**
  normalised coord. Confirm from `models/titanic_interior.js` at impl time
  which of `y`/`z` is the cross axis (the `_349` file is foreign-owned — read,
  never edit). Keep `moduleId` in ONE tiny shared idiom copied into each file
  (patterns stay self-contained; no new engine lib).
- Per-module offsets are deterministic irrational multiples of `moduleId`
  (golden angle, PHI, SQRT2) — never random, never 1/6 periods.
- Reuse `_348` conventions verbatim: `render3D` coords only, no `fId`/index,
  `SEG2_FLOW` travel compression where a current exists, floor ≥ 0.02 shaped
  (wet sheen ~0.07 where a bare strand would otherwise show), RGB only with
  `whiteFoam` desaturating crests so W lights, `cohesion` = "all modules
  identical (1) ↔ each its own river (0)".

## 2. Shared per-module hue shift (all ten patterns)

Two sliders, declared **last** in every pattern (after `whiteFoam`):
`moduleHueShift` (amplitude) then `hueShiftFreq` (rate).
- `dH_m(t) = A · sin(2π f t + moduleId · GOLDEN_ANGLE · 2π)`, with
  `A = 0.06 · moduleHueShift` (hard cap **ΔH ≤ 0.06 of the hue circle, ≈ 22°**)
  and `f = 0.005 + 0.095 · hueShiftFreq²` Hz (~3 min … ~10 s period).
- Applied to cp1 **and** cp2 hue before any blend; S/V untouched; time via the
  existing `PHASE_WRAP` idiom so no jump. Pure sine ⇒ smooth, no steps.
- Defaults: `moduleHueShift 0.5` (ΔH 0.03, "just visible"), `hueShiftFreq 0.3`.
- At `moduleHueShift 0` the pattern equals the un-shifted palette exactly.

Slider order rule (memory `pattern-param-order`): `localSpeed` first,
`direction` second **when present**, pattern-specific params, `whiteFoam`,
`moduleHueShift`, `hueShiftFreq`. Palettes via `colorPalette1/2`; defaults cp1
teal (0.55,1,0.9), cp2 amber-white (0.09,0.5,1) unless noted. Audio only via
`AUDIO_MODULATION_V1` header + playlist `cpc` modulations.

## 3. Patterns — `marsin_engine/patterns/136..145_*.js` (manifest, numeric)

### 136_curl_drift — curl-noise advection
Field: 2-D curl of a value-noise potential sampled at `(u·k, moduleId·φ, t)`;
brightness = particle density advected by the divergence-free flow (sum of 3
incompressible streamlines). Visual: smoky, swirling current that never
bunches; modules share the field but sample different rows, so eddies line up
loosely across the wall. Effect: **even modules reversed** via `direction`.
Sliders: localSpeed, direction, scale, density, cohesion, whiteFoam, +hue pair.
Sound: density ← micLow 0.4..0.85 easeOut.

### 137_reaction_ripple — Gray-Scott reaction–diffusion (1-D per module)
Field: two chemicals U/V integrated in a small per-module 1-D grid (48 cells,
interpolated to `u`); feed/kill near the "worms" regime. Visual: slow organic
spots that split, crawl, and merge — living pond film; cp2 marks V maxima.
Effect: each module has its own feed offset (PHI·moduleId·1e-3) ⇒ distinct
textures; `stir` adds a slow drift term (direction-less).
Sliders: localSpeed, feed, stir, contrast, whiteFoam, +hue pair. No sound.
Stability: clamp U/V to 0..1 every step; fixed dt independent of fps.

### 138_gerstner_swell — Gerstner (trochoidal) ocean waves
Field: 3 Gerstner waves with steepness `Q`; brightness from crest sharpness
(trochoid horizontal displacement). Visual: rolling open-sea swell with
pointed crests and wide troughs, foam only at steep peaks. Effect: per-module
**speed scaling** `1 + 0.12·(moduleId−2.5)` (swell arrives at each module at
its own pace); alternate modules reversed at `cohesion < 0.5`.
Sliders: localSpeed, direction, steepness, wavelength, cohesion, whiteFoam, +hue.
Sound: steepness ← micLow 0.3..0.8 easeOut.

### 139_kuramoto_glow — Kuramoto phase-coupled oscillators
Field: 24 oscillators per module, natural freqs spread by SQRT2 hash, coupled
with strength `K` to neighbours and (weaker) to the same index on other
modules. Visual: pulsing nodes along each line that drift from chaos into
lock-step and back as `coupling` breathes; cp2 where local order parameter
is high. Effect: cross-module coupling = `cohesion` ⇒ modules visibly sync
and desync against each other.
Sliders: localSpeed, coupling, spread, cohesion, whiteFoam, +hue. No sound.

### 140_voronoi_cells — cellular / Voronoi drift
Field: 1-D Voronoi over seed points per module that drift on Lissajous
paths; brightness = 1 − normalised distance to nearest seed, cp2 at the
second-nearest boundary. Visual: soft bright cells that slide, squeeze and
pop along the line like bubbles under ice. Effect: per-module seed count
`4 + (moduleId·PHI mod 3)` and opposite drift sense on odd modules.
Sliders: localSpeed, direction, cells, edge, whiteFoam, +hue.
Sound: edge ← micHigh 0.3..0.9 linear.

### 141_lissajous_interference — superposition / beat patterns
Field: two travelling sines at incommensurate k (ratio PHI) plus a standing
component; brightness = |sum|. Visual: slow beating interference — bright
bands that form, march, and dissolve as the carriers slip phase. Effect:
per-module k detune `1 + 0.03·moduleId` so beats sweep the wall diagonally.
Sliders: localSpeed, direction, detune, standing, cohesion, whiteFoam, +hue.
Sound: standing ← micFlux 0.2..0.7 easeOut.

### 142_warped_current — Perlin flow with domain warping
Field: `n(u + a·n(u + b·n(u,t)))` (two-level domain warp) driving brightness
and hue blend. Visual: viscous, stretched, marbled current — the most
"painterly" of the set. Effect: per-module warp amplitude `a` scaled by
`0.6 + 0.16·moduleId` ⇒ calm top line, wild bottom line; `direction` flips
the top three modules.
Sliders: localSpeed, direction, warp, scale, whiteFoam, +hue.
Sound: warp ← micLow 0.3..0.9 easeIn.

### 143_logistic_drip — logistic-map chaotic drips
Field: per-module logistic map `x ← r·x(1−x)` clocked by `localSpeed`,
`r` swept 3.2..3.9 by `chaos`; each iterate spawns a drip at `u = x` that
falls downstream with a soft tail and a foam splash at the seam. Visual:
irregular drips that go periodic → doubling → chaotic as `chaos` rises.
Effect: each module's `r` offset by `0.02·moduleId` ⇒ some modules period-2
while others are chaotic. Smoothness: drips fade in over 150 ms, never pop.
Sliders: localSpeed, chaos, tail, splash, whiteFoam, +hue.
Sound: chaos ← micFlux 0.3..0.9 linear; splash ← micKick 0.2..1 easeIn.

### 144_soliton_train — KdV solitons (shallow water)
Field: analytic KdV `sech²` solitons; amplitude sets speed (taller = faster),
so solitons overtake and pass through each other with the classic phase
shift. Visual: humped pulses of water sliding along, crossing without
breaking. Effect: per-module launch cadence on irrational ratios; **per-module
direction reversal** pattern `[+,−,+,−,+,−]` at `cohesion 0`, all `+` at 1.
Sliders: localSpeed, direction, amplitude, spacing, cohesion, whiteFoam, +hue.
Sound: amplitude ← micLow 0.35..0.9 easeOut.

### 145_vortex_street — von Kármán vortex street
Field: alternating-sign vortices shed at `u ≈ 0.08` with Strouhal-like
cadence, advected downstream, decaying; brightness = |vorticity|, cp1 for
one sign, cp2 for the other (colour-aware: cp2 kept within the palette
blend, not a hard swap). Visual: a zig-zag procession of paired eddies
behind an invisible post. Effect: shedding phase alternates by module so
neighbouring modules are anti-phase; `direction` moves the post to `u≈0.92`.
Sliders: localSpeed, direction, shedRate, decay, whiteFoam, +hue.
Sound: shedRate ← micFlux 0.3..0.8 linear.

Colour rule for all ten: cp2 is an accent ≤ ~35 % of the line at any time;
per-module hue shift is the **only** per-module colour difference (modules
differ by motion/texture, not by palette), so the room reads as one colour.

## 4. Playlists — `simulation/scenes/titanic_interior/playlists/` (interior only)

Same schema/idiom as `_348`; every slider (incl. `moduleHueShift`,
`hueShiftFreq`) set explicitly; modulated slider default = range floor; entry
ids `e_<playlist>_<n>_<pattern>`. Do not touch timeline files or other scenes.

| Playlist | New order (insert, keep existing entries) | Tunings |
|---|---|---|
| `flow` | 131 → 136 curl_drift → 132 → 138 gerstner_swell → 140 voronoi_cells → 133 → 142 warped_current → 137 reaction_ripple → 131 river_wild → 144 soliton_train (cohesion 0) → 139 kuramoto_glow → 141 lissajous (cohesion 0.6) → 135 | no modulations; `moduleHueShift 0.5`, `hueShiftFreq 0.25` everywhere |
| `flow_sound` | 134 → 143 logistic_drip → 131 → 145 vortex_street → 136 curl_drift → 133 → 138 gerstner_swell → 134 surge_unison → 141 lissajous → 132 | each new entry carries its §3 hook as `cpc` continuous, `mode: override`, `polarity: unipolar`; `hueShiftFreq 0.45` on sound entries |
| `default` | 131 → 136 → 135 → 138 → 132 → 144 → 134 (modulated) → 142 → 133 → 140 | only 134 modulated; `moduleHueShift 0.4` (calmer boot look) |

## 5. Validation (implementer must run; report results, not claims)

1. `cd marsin_engine && npm test` — add the ten names to any manifest
   discovery fixture; note pre-existing failures from foreign work separately.
2. `tools/param_truth/` cross-model on the ten names on `titanic_interior`
   **and** `test_bench`; the known W-lane `whiteFoam` harness limitation is
   acceptable only if it is the same signature as in `_348` — say so.
3. Offline render contract per pattern: 10 s at 40 fps — no NaN, all RGB in
   0..1, **every module's mean brightness ≥ 0.02 and ≤ 0.95**, frame-to-frame
   delta > 0 (motion), and per-module hue deviation **≤ 0.06** at
   `moduleHueShift 1` (measure from the output, not the formula). 137/139/143
   additionally: state stays finite for 5 min simulated.
4. Per-module distinctness: for patterns with per-module effects, pairwise
   module brightness-profile correlation < 0.9 at `cohesion 0` and > 0.95 at
   `cohesion 1` (where the slider exists).
5. Playlist YAMLs load with zero warnings; every `defaults` key is a real
   `slider*` export; the three interior playlists list 15/10/10 entries.
6. Engine boot on a **scratch port** (never 6966-6972 / 6981 / 5568) with
   `--model titanic_interior`; confirm the manifest lists 136–145.
7. Renders via `.agent/skills/see_the_world.md` only (never built-in browser
   tools): two frames 1 s apart for at least 136, 138, 143, 144, 145; inspect
   PNGs and state what per-module difference is visible in each.
8. `python scripts/security_check.py --staged` before any commit; commit only
   when asked; report `states/` residue, never revert it.

Bans: destructive git, foreign-owned files (`_349` model/scene re-lay,
timeline YAMLs, other scenes), no servers left running, no reserved ports.
