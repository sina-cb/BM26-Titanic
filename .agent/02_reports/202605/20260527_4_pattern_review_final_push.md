# Pattern Review — Final Push for Summer Camp 2026

_Generated 2026-05-27 — last day before build; show on Friday._

Coordinator: Claude (Opus). Reviewers: 8 parallel sub-agents (one per pattern chunk). Designer: 1 sub-agent for the +30 new-pattern proposals (15 per stage) at the end.

---

## 1. How to read this report

Every pattern in scope gets one section structured around five axes:

1. **Visual.** One short paragraph describing what the pattern actually looks like on the rig today, in operator language ("breathing wash with cold-warm pulses") — not a translation of the math.
2. **Artistic upgrades.** Concrete suggestions to make the pattern more *eye-catching*, *visually pleasing*, and *mathematically non-repeating* (Lissajous, strange attractors, multi-period beat, phase decorrelation, jitter envelopes, etc.). Bullets, ≤4 per pattern.
3. **Audio reactivity (CPC bindings).** Which CPC signals from the catalog below drive which pattern parameters, and what the *operator-visible* behavior is when audio is loud vs silent.
4. **Hue hooks.** Color shifts tied to specific musical events (kick → red flash, vocal sustain → blue hold, drum hit → palette rotate). Reactivity reads more clearly through color than brightness alone.
5. **Stage-specific notes.** APEX lights group for dome patterns 40–56, redwood uplighting for logsville patterns 70–85. Omitted for generic patterns 00–25.

Each pattern carries a verdict tag in its heading:

- **KEEP** — already strong; ship as-is.
- **POLISH** — small tune (palette adjust, param tweak, one line of math) before show.
- **REWRITE** — needs material work. Flag clearly if it's the kind of thing the operator should NOT load on Friday night without time to test.

Operator-stated baseline (anchor your verdicts to this):
> _"Patterns 00–56 look sane on summer camp dome model. Patterns 70–85 have not been optimized and need work similar to the 40–56."_

So 70–85 reviewers (sections 7.1, 7.2) should be deliberately heavier on REWRITE/POLISH than 00–56 reviewers.

---

## 2. CPC audio signal catalog (shared brief for every reviewer)

These are the live signals available from the engine, exposed via the CPC bus. Any reviewer suggestion **must** reference these by name — do not invent new signal names. Canonical registry: `marsin_engine/lib/param_center.js:85-216` and `marsin_engine/lib/modulation_engine.js:81-82`.

> **Errata (added post-review by coordinator):** the original catalog shipped with the wrong stem names (`stemBass`/`stemDrums`/`stemVocals`). Correct names are **`stemsBass` / `stemsDrums` / `stemsVocals`** with an "s" — table below has been corrected. Reviewer sections 5.2, 6.2, 7.1 that cited the typo'd names are still semantically correct; mentally substitute the corrected key when implementing. Designer (section 8) and any post-review work must use the corrected names.

| Signal | What it is | Typical range | Good for |
|---|---|---|---|
| `micLow` | Low-band mic energy (sub/bass region) | 0..1 (post-gain) | Kick weight, sub swells, dome breathing |
| `micMid` | Mid-band mic energy | 0..1 | Snare body, vocal energy, mid-melodic |
| `micHigh` | High-band mic energy | 0..1 | Hats, cymbals, sparkle |
| `micKick` | Discrete kick trigger (gated, shaped via post-processor chain) | 0/1 pulse w/ envelope | One-shot flashes, hue snaps, palette rotates |
| `stemsBass` | Stem-separated bass (OSC-injected from a stem source) | 0..1 | Cleaner sub reaction than `micLow` when a stem source is connected |
| `stemsDrums` | Stem-separated drums (OSC-injected) | 0..1 | Drum-pattern-driven movement (chasers, sweeps) |
| `stemsVocals` | Stem-separated vocals (OSC-injected) | 0..1 | Color holds, breath effects, soft fills |

Reviewer guidance:

- Always specify *which* CPC signal(s) drive *which* pattern parameter(s), with the **mapping shape**: linear, exponential, threshold/gate, schmitt trigger, decay envelope.
- If a pattern is currently silent on audio: propose a minimum-viable binding — at least 1 parameter driven by `micLow` or `micKick`, plus 1 hue hook tied to `micKick` or `stemVocals`. If a pattern is genuinely better off un-reactive (rare — usually only slow ambient washes meant as filler), say so explicitly with a one-line reason.
- If a pattern is already audio-reactive: recommend *additional* bindings or *bigger gestures* so reactivity reads from 50m away across the playa. Most patterns today are too subtle.

---

## 3. Per-pattern review template (every reviewer must follow this exactly)

```markdown
### `NN_pattern_name.js` — **KEEP** | **POLISH** | **REWRITE**

**Visual.** One paragraph (~3 sentences). What the audience sees.

**Artistic upgrades.**
- bullet (mathematically what changes)
- bullet
- bullet

**Audio reactivity (CPC).**
- `micLow` → `paramName` (mapping shape; what the operator sees)
- `micKick` → `paramName` (...)
- ...

**Hue hooks.**
- `micKick` → palette index step / hue rotate / flash colorY
- `stemVocals` → hue hold on warm Z
- ...

**Stage-specific notes.** _(APEX dome — for 40–56; redwood uplighting — for 70–85; omit for 00–25)_
- which fixture group benefits most + which view-mask the operator should set
```

Keep each pattern's section under ~25 lines. Long reviews don't get acted on.

---

## 4. Prior work to cross-reference (do NOT duplicate)

There are two large prior reports in this same directory that already tuned the dome + logsville patterns:

- `20260525_7_dome_tuned_patterns.md` (~64 KB) — earlier dome tuning pass.
- `20260525_8_logsville_tuned_patterns.md` (~40 KB) — earlier logsville pass.

Reviewers: skim the section covering your pattern range before reviewing. Cite findings that are still open as "(carried from <report-name>)". Do not re-prove things the prior report already nailed — focus this report on *what's still wrong* and *what the show-day operator needs*.

---

## 5. Generic patterns (00–25) — dome baseline

_Stage context: these patterns run on the canonical `summer_camp_dome` model and should behave well on any model with a similar fixture density. Stage-specific notes (APEX / redwood) omitted for this section._

### 5.1 — Patterns 00–06 (Reviewer 1)
_Cross-reference: `20260525_7_dome_tuned_patterns.md` audits patterns 40–55 only; nothing in 00–06 carries forward from it. CPC signal names verified against `marsin_engine/lib/modulation_engine.js:81` (canonical: `micLow`, `micMid`, `micHigh`, `micKick`, `stemBass`, `stemDrums`, `stemVocals`)._

#### `00_golden_hour_wash.js` — **POLISH**

**Visual.** A slow, organic warm-tone wash that breathes across the rig: the `wave(v)` noise field cubed (`noise * noise * noise`) produces dark valleys with bright peaks drifting along an `x + y/2 − z/2` plane. cp1 hue dominates the low end of the gradient, cp2 (sunset orange by default) blooms at peaks; vintage-white kicks in only on the dome cap (`y>0.8 || z>0.8`). Reads as ambient golden-hour filler — pretty, but currently completely audio-blind.

**Artistic upgrades.**
- Replace single `tPhase` with two decorrelated phases (`tPhaseA`, `tPhaseB` advancing at irrational ratio ~1.27) so the wash never visibly repeats over a set.
- Add a slow vertical hue tilt: bias `dh * noise` by `(y_norm − 0.5) * 0.08` so the dome cap drifts warmer than the floor — vertical separation without breaking cp1↔cp2 lock.
- `noise^3` crushes mid-tones to near-black; expose `sliderContrast` (currently hard-coded) so the operator can soften it on ambient cues.

**Audio reactivity (CPC).**
- `micLow` → `noiseScale` boost (linear add `+micLow*0.4` on top of slider): wash "tightens" on bass swells.
- `stemVocals` → vintage-white floor scale (linear, `w *= 1 + stemVocals*0.6`): dome cap warms on sustained vocals.
- `micKick` → cp2-peak brightness lift (decay envelope ~250 ms, `val *= 1 + 0.5*env`): kicks read as gentle dome flashes.

**Hue hooks.**
- `micKick` → momentarily push `noise` toward 1.0 via envelope so cp2 (warm) dominates the rig for ~200 ms per kick.
- `stemVocals` → hold gradient weighted toward cp2 while vocals sustain (lerp factor `0.3 + 0.5*stemVocals`).

---

#### `01_cylon_sweep.js` — **KEEP**

**Visual.** A single triangle-wave beam (cp1) sweeps left↔right across the rig over a coloured background (cp2 dimmed by `bgBrightness`). Strict RGB-space lerp guarantees no chroma drift — red+blue stays red/magenta/blue, no spurious green. Pre-cached `_hsv2rgb1/2()` in `beforeRender` keeps the per-pixel hot loop tight. Direction slider lets the operator reverse and stall. Classically readable from the playa.

**Artistic upgrades.**
- Add a faint trailing beam at `scanT − 0.08 * globalDir` with `intensity * 0.35`; the eye reads motion direction more clearly with a tail than with a symmetric Gaussian.
- Optional half-amplitude `triangle(scanT*2 + 0.5)` overlay so at slow speeds a quieter cross-sweeper rides on top — kills the metronome feel.
- Lines 91-93: `(pr1 − pr2*bgScale)*intensity` lerps toward `pr1 − pr2*bgScale` (not `pr1`) at full intensity → bright backgrounds slightly desaturate the beam head. Replace with `pr2*bgScale*(1−intensity) + pr1*intensity` for a cleaner cross-fade.

**Audio reactivity (CPC).**
- `micKick` → `eyeWidth` punch (envelope, `eyeWidth + env*0.25`, ~150 ms): beam fattens on the downbeat.
- `stemDrums` → `localSpeed` boost (linear, `+stemDrums*0.25`, clamped): heavier drum patterns accelerate the sweep.
- `micLow` → `bgBrightness` lift (linear, `+micLow*0.15`): background pulses on bass without competing with the beam.

**Hue hooks.**
- `micKick` → swap cp1/cp2 roles for one frame (palette flip): beam briefly takes cp2 hue — instantly readable as impact.
- `stemVocals` → hold `bgBrightness` higher (additive `+0.1*stemVocals`) so field warms during vocal sustains.

---

#### `02_phase_cathedral.js` — **POLISH**

**Visual.** A four-wave interference field — two orthogonal sine planes plus a diagonal plus a radial — beats against itself across the rig. cp1 fills positive crests, cp2 fills negative troughs (binary palette split, not a blend). `sharpness` crushes mid-field to black so only bright nodes survive; bars stay default, 4 huge pars get an inverse-magnitude "negative" overlay, 12 vintage whites get warm/amber on low-saturation segments. `BEAT_WRAP = 10000×2π` is a good catch — kills the visible flicker the irrational ratios would otherwise cause.

**Artistic upgrades.**
- Add a third irrational ratio (`ratioC = 0.382`) to f1 so the orthogonal axes also decorrelate; f1/f2 currently share `±beatPhase`, locking the cross to a 2× repeat.
- Slowly modulate `radialDensity` (`radialDensity + sin(beatPhase*0.013)*3`) so the cathedral breathes between dense moiré and sparse rings.
- Bar section (`y<1.8`) is a no-op (lines 75-77) — wastes ~36 fixtures. At minimum drive bars off `(f1+f2)*0.5` with `sharpness*0.5` so the rig doesn't go dark below 1.8 m.
- `dy = ny − 0.85` (line 55) is hard-coded near the dome cap — fine for dome but breaks on logsville. Expose as `sliderCenterY` or branch via `sectionId`.

**Audio reactivity (CPC).**
- `micLow` → `sharpness` (inverse linear, `sharpness * (1 − micLow*0.5)`): bass softens the field; quiet sections stay crisp.
- `micKick` → `radialDensity` punch (envelope, `+env*8`, ~200 ms): kicks expand the ring count — reads as a shockwave.
- `stemDrums` → `localSpeed` (`+stemDrums*0.3`): interference field accelerates with drum density.

**Hue hooks.**
- `micKick` → one-frame cp1/cp2 swap on positive field — palette flash on the downbeat.
- `stemVocals` → desaturate cp2 toward `s *= 0.4 + 0.6*(1−stemVocals)` so negative-field zones warm to vintage-white during vocal holds (plays into the existing `y>=4` white/amber branch).

---

#### `03_dual_axis_crush.js` — **KEEP**

**Visual.** Two opposing beams spawn at stage left and stage right and collapse into the centre (`x ≈ 0.6`); cp2 = beam-head, cp1 = tail. A short flash envelope (`flashPhase < 0.1`) boosts the cp2 head at the centre on each arrival. Strict RGB lerp — no chroma drift. The asymmetric scale (`0.5376` left, `0.7936` right) compensates for the asymmetric rig — good. Reads as relentless inward pressure; pairs naturally with kick-heavy material.

**Artistic upgrades.**
- The flash fires on `attackPos < 0.1` of each cycle but `attackPos` is global — both sides flash in lockstep. Add an offset (`flashPhaseR = (attackPos + 0.5) % 1`) so left/right visually collide at centre rather than firing simultaneously.
- Add a "rebound": briefly invert `globalDir` for ~0.05 of the cycle after the centre flash so beams bounce outward once before resuming.
- `centerProximity = max(0, 1 − normDist*4)` is sharp; `pow(centerProximity, 0.5)` widens the central impact zone for wider audience angles.

**Audio reactivity (CPC).**
- `micKick` → `flashIntensity` direct gate (replace timer-driven flash with `flashIntensity = micKick_env`, ~120 ms decay): every kick literally fires the collision flash.
- `stemBass` → `swipeLength` boost (linear, `+stemBass*0.4`): heavier bass elongates the beams.
- `stemDrums` → `localSpeed` (`+stemDrums*0.35`): drum density accelerates the crush.

**Hue hooks.**
- `micKick` → temporarily swap head from cp2 to cp1 for one frame on the collision — palette pop on impact.
- `stemVocals` → warm the tail by lifting `pr1` blend weight (`+0.15*stemVocals`) so the rig warms between hits.

---

#### `04_beat_folded_helix.js` — **POLISH**

**Visual.** A pseudo-3D rotating helix tunnel: pixels are projected to polar (`atan2`, `hypot`) around centre (`0.6, 0.45*6.5`), then a sine with `armCount` arms is twisted by `1/dist * twistFreq` plus a rotating `spinPhase`. Bars get a near-centre falloff (`min(1, dist*3)`), pars get a beat-pulse white pop, vintage whites get warm/amber on every render. `colorBlend` slowly drifts cp1↔cp2 through the tunnel — motion in colour as well as space.

**Artistic upgrades.**
- `beatPulse = (beatFrac < 0.1) ? 1 : 0` makes the rig feel "ratcheted". Soften to exponential decay `pow(1 − beatFrac, 4)` so the par section breathes between hits instead of strobing.
- `1/dist` near centre blows up (the `max(0.02, dist)` clamp helps but the centre pixel still saturates). Cap `depth = min(50, 1/dist)` for visual stability.
- Bars only show within `dist < ~0.33` (`min(1, dist*3)` at line 76) — for a wide rig most bars sit beyond and stay muted. Invert sense to `min(1, (1−dist)*2)` so the helix tunnel fills the bar row.

**Audio reactivity (CPC).**
- `micKick` → replace internal `beatPulse` with `beatPulse = micKick_env` (envelope, ~150 ms). The helix "beat" is currently independent of the track — biggest miss.
- `stemBass` → `twistFreq` linear add (`+stemBass*10`): bass adds spiral twist, couples motion to sub.
- `micHigh` → `armCount` boost (`+floor(micHigh*4)`): hats split the helix into more arms — sparkle without strobe.

**Hue hooks.**
- `micKick` → snap `colorBlend` to 1.0 for one frame so the tunnel flashes cp2 hue on the downbeat.
- `stemVocals` → bias `colorBlend` toward `0.5 + 0.4*stemVocals` so vocal sustains hold the rig on the cp2 side.

---

#### `05_orbital_attractor_field.js` — **POLISH**

**Visual.** Three orbiting attractors (radii `orbit1/2/3`, rates `r1/2/3 = 1, −1.5, 2`) sweep around the rig; pixels light up where they're within `falloff`-controlled distance of the nearest attractor. `focus` sharpens dots into beams. `colorVariation` adds two `wave()`-driven hue/sat/val perturbations so the field never sits exactly on the cp1↔cp2 line — intentional but worth flagging: this is the only pattern in the 00–06 range that deliberately violates strict palette lock (compare to 01/03/06). `blackoutTexture` can punch in a moving black-cell mask. Vintage and par rows get extra white/amber.

**Artistic upgrades.**
- `r1/r2/r3 = 1, −1.5, 2` are commensurate (LCM closes the orbit every 2 cycles → visible repeat). Switch to `r1=1, r2=−√2 (≈1.414), r3=√3 (≈1.732)` for an irrational orbit set that never repeats.
- `r1/r2/r3` are not exposed as sliders — `orbit1/2/3` and `blackoutTexture` are. Expose at least one rate slider so the operator can detune live.
- Document the asymmetry in `attractorBlend = (influence2 + influence3*0.52)/total` (line 71) — attractor 1 is the "anchor" hue, 2/3 push toward cp2. Future tuners need this in the header.

**Audio reactivity (CPC).**
- `micLow` → `falloff` reduction (`falloff * (1 − micLow*0.4)`): bass fattens attractor halos so the rig blooms on sub.
- `micKick` → `focus` punch (envelope, `focus − env*2`): kicks momentarily defocus into wide flares.
- `stemDrums` → `localSpeed` (`+stemDrums*0.3`): drums accelerate orbit motion.
- `stemVocals` → `colorVariation` boost (linear, clamp `+stemVocals*0.3` ≤ 1): vocal sustains make the field more chromatic.

**Hue hooks.**
- `micKick` → temporarily zero `orbitHue + attractorHue` (snap back to strict cp1↔cp2) for ~150 ms per kick — kick reads as a "colour lock" punctuation against the drifty default.
- `stemVocals` → bias `attractorBlend` toward 1.0 (cp2 dominance) while vocals sustain.

---

#### `06_neon_elevator.js` — **KEEP**

**Visual.** An elevator counter that "rides" up through the three fixture tiers — bar (bottom), par (middle), vintage (top) — driven by `beatPhase` discretised into `stepCount` steps. cp1 is the bottom floor colour, cp2 the top; `tColour = visualY` lerps strictly in RGB-space. At the top of each ride the par row gets a white "ding" (`outW`) and vintage gets a warm amber (`outA`) — narratively the elevator arriving at the top floor. Strict palette discipline, no chroma drift. `sectionId` handling at lines 81-89 means it adapts cleanly across models. Reads as a clean, legible architectural pulse.

**Artistic upgrades.**
- Each tier is a fixed `visualY ∈ {0, 0.5, 1}` (lines 91-94) — three discrete bands. If `stepCount > 3` the operator picks more steps than the rig can express → the elevator "skips" floors with no visible change. Either clamp `stepCount ≤ 3` on the slider, or interpolate `visualY` from `wy` (e.g. `clamp(wy/6.5, 0, 1)`) so dome lights resolve sub-tier positions.
- Arrival pulse only fires on the final step. Add a smaller "passing-floor" tick on every step boundary (e.g. `outW = 0.15` on par for one frame) so the elevator reads as moving even at low speeds.
- `bloomPower = 1 + v*4` and `floorThickness = 0.05 + v*0.4` interact strongly — at high bloom + thin floor the rig blinks; document the interaction.

**Audio reactivity (CPC).**
- `micKick` → `arrivalPulse = max(arrivalPulse, micKick_env)`: every kick lights the top-floor "ding" regardless of where the elevator is — guarantees a visible beat.
- `stemBass` → `bloomPower` reduction (`bloomPower − stemBass*1.5`, floor 1): bass widens the active floor.
- `stemDrums` → `localSpeed` (`+stemDrums*0.4`): drum density speeds the climb.

**Hue hooks.**
- `micKick` → on arrival pulse, briefly override `tColour = 1.0` for all sections (not just par) so the whole rig flashes cp2 — palette-locked downbeat impact.
- `stemVocals` → hold `outA` (amber on vintage) boosted by `+stemVocals*0.2` so vocals read as warmth in the top row.

### 5.2 — Patterns 07–13 (Reviewer 2)

### `07_shimmer.js` — **POLISH**

**Visual.** A warm wash (cp1) gently breathes up and down while sharp glints (cp2) skim across the rig as a fast traveling wave. Reads from distance as "candlelight on water" — soft body, twinkling crests. Currently unreactive to audio; feels static during loud sections.

**Artistic upgrades.**
- Decouple breathing and shimmer with golden-ratio period (`tShimmer` at `tBreathing * 1.618`) so crests never re-align with the same valley — kills the visible repeat (line 28-29).
- Add a second shimmer band counter-traveling (`wave(-pct * shimmerDensity * 0.7 - tShimmer * 1.3)`) and `max()` against the first — instant Lissajous-style sparkle field.
- Replace `pow(sWave, 3)` with `pow(sWave, 1 + audioGate * 4)` to sharpen glints only when loud (line 36).
- Jitter `shimmerDensity` ±10% via a slow `wave(time(0.3))` so the spacing isn't visibly periodic.

**Audio reactivity (CPC).**
- `micHigh` → `shimmerContribution` weight (linear, replaces fixed `0.4` at line 41) — hats/cymbals drive sparkle density visibly.
- `micLow` → `breathingInt` add (linear, +0.4 on top of slider) — sub bass swells the wash.
- `micKick` → one-shot `intensity` boost via decay envelope (200 ms) — every kick lifts the floor brightness.

**Hue hooks.**
- `micKick` → snap `cp2H` by +0.05 for one frame (palette nudge per kick), drift back.
- `stemVocals` → hold `cp1S` lower (desaturate wash) during sustained vocals so glints pop harder.

---

### `08_ocean_liner.js` — **KEEP**

**Visual.** A slow, dim "water" wash in cp1 (default deep blue) sits behind sharp punchy "porthole" pops in cp2 (default warm amber). Looks like a steamship at night sliding past the playa — most legible silhouette in the 00–25 set. Already strict palette discipline (no third hues).

**Artistic upgrades.**
- Add a second porthole row at half count and opposite phase (`(pct * windowCount * 0.5 - t2)`) — windows on two decks, breaks the single-row repeat.
- Modulate `wTrigger` with a slow wave (`0.78 + 0.05 * wave(time(0.4))`) so portholes "blink on" in waves rather than all-on uniformly.
- Skew the water shimmer with `pct^1.2` so the wash isn't perfectly uniform — small spatial detune.

**Audio reactivity (CPC).**
- `micLow` → `pulse` floor (line 70: replace fixed `0.75` with `0.55 + micLow * 0.4`) — bass swells the water layer.
- `micKick` → `wTrigger` lowered to `0.70` on kick via 150 ms decay env (more portholes flash per kick).
- `micMid` → `windowFocus` linear add (0..+4) — snares sharpen the porthole edges.

**Hue hooks.**
- `micKick` → rotate `cp2H` by +0.02 each kick (slow hue drift on portholes through the night).
- `stemBass` → pull `cp1V` up 0..0.3 — water glows brighter under heavy sub.

---

### `09_cyclone.js` — **POLISH**

**Visual.** Bands of three alternating colors (cp1, cp2, midpoint) chase along the rig at high speed with a sparkle overlay on top. Reads as confetti blowing past. Color rotation is currently mod-3 by raw index — looks coarse on dense fixture groups, fine on sparse ones.

**Artistic upgrades.**
- Replace `index % 3` (line 31) with a hashed-per-particle id derived from `floor(pct * density)` — colors stay attached to particles instead of pixel slots, looks vastly more like real confetti.
- Add per-particle speed jitter: multiply `t1 * density` by `(0.85 + 0.3 * sin(particleId * 1.7))` so the stream isn't lockstep.
- Replace the magic `23.3` star spacing (line 59) with a relatively prime stride (e.g. `31.7`) to push the visible sparkle period beyond a beat.
- Add a slow rotation of the sparkle threshold based on a Lissajous (`sin(time(0.7)) * cos(time(1.1))`) for non-repeating density.

**Audio reactivity (CPC).**
- `micMid` → `density` add (linear, +0..+15) — busier confetti during melodic passages.
- `micKick` → `particleSize` snap up to 0.9 for 200 ms decay — kicks fatten the streak.
- `micHigh` → sparkle threshold lowered (line 62: `0.1 - micHigh * 0.08`) — hats drive star count.

**Hue hooks.**
- `micKick` → swap cp1H and cp2H positions (palette flip) once per kick — instant color-pop.
- `stemDrums` → push `cp1S` and `cp2S` to 1.0 (saturate fully) when drums are heavy.

---

### `10_chasers.js` — **POLISH**

**Visual.** Several glowing particles with comet tails travel in random directions across the rig, each fading in/out on its own life cycle. Tails go from cp1 head (red default) into cp2 (orange/yellow default). Reads as fireflies or tracer rounds depending on speed. `particleCount` loop runs each render — keep an eye on perf with `particleCount = 20`.

**Artistic upgrades.**
- Add a head bloom: when `tailDist < 0.02`, force `v = 1.0` and slightly boost `cp1V` — heads currently blend into the wash on dense rigs.
- Stagger `lifePhase` with golden-ratio offset (`p * 0.6180339`) instead of `p * 0.1234` (line 43) — better visual decorrelation.
- Add a second-order tail curl: warp `currentPos` with `+ 0.02 * sin(t1 * 3 + pSeed)` so particles wobble rather than running straight.
- Optionally exit the per-pixel loop early once `finalV > 0.95` to claw back CPU at high particle counts.

**Audio reactivity (CPC).**
- `micKick` → spawn-burst: temporarily double `particleCount` for 400 ms after kick (decay env) — every kick fires a fresh swarm.
- `micMid` → `tailLength` linear (0.05..0.30) — busier mids = longer comet trails.
- `micLow` → all-particle `lifeSpeed` multiplier (slows down during sub-heavy passages, accelerates on silence).

**Hue hooks.**
- `micKick` → cp1H jitter ±0.04 per kick — each swarm comes in a slightly different hue.
- `stemDrums` → cp2H rotate by `+0.005` per frame while `stemDrums > 0.6` (gentle tail-color drift).

---

### `11_bioluminescence.js` — **POLISH**

**Visual.** A slow underwater swell in cp1 (default blue) breathes across the rig with bright crests in cp2 (default green) cresting when the wave peaks. UV glow rides underneath as an additive emitter — gives the signature blacklight feel. Reads as plankton lighting up under a passing boat. The `partyMode` strobe is a useful gesture but is currently a hard 0/1 toggle.

**Artistic upgrades.**
- Replace the binary `swell > 0.9` crest gate (line 71) with a smooth high-shelf (`pow(max(0, swell - 0.75) * 4, 2)`) — crests bloom in/out instead of pop on.
- Add a second wave at `density * 1.318` traveling backwards and `max()` for the swell — kills the obvious 1D period.
- Drive `cp2V` peak with a slow Lissajous (`0.8 + 0.2 * sin(time(0.4)) * cos(time(0.73))`) so brightest crest "wanders" minute-to-minute.
- `partyMode` strobe should clamp `strobeClock` rate to a beat-locked subdivision once BPM sync lands — currently free-running and jarring.

**Audio reactivity (CPC).**
- `micLow` → `density` (linear, 1..6) — bass-heavy = more crests visible at once.
- `micKick` → instant crest flash: force `crest = 1.0` for 250 ms decay envelope (kicks make the rig "bloom").
- `stemVocals` → `uvIntensity` linear (overrides slider when >0) — vocals turn the UV up.

**Hue hooks.**
- `micKick` → cp2H step by +0.03 per kick (crest color drifts through the night).
- `stemBass` → hold cp1H -0.05 (cooler ambient) while bass sustained.

---

### `12_breathing.js` — **POLISH**

**Visual.** Whole rig breathes in/out with a hue lerp from cp1 (exhale) to cp2 (inhale) as the wave swells. `spatialOffset` adds a ripple so the breath can travel pixel-to-pixel rather than synchronized. Minimal, almost a utility filler — but currently 100% audio-deaf which is the wrong choice for a breath pattern (breaths should ride bass).

**Artistic upgrades.**
- Add a second breath at 1.5× period and `min()` the two — produces a "double-breath" rhythm that doesn't repeat for ~12 s.
- Replace `pow(w, breathSharpness)` (line 29) with an asymmetric envelope (slow rise, fast fall) — feels more like a real breath.
- Add a tiny `+0.05 * wave(t1 * 7.3)` jitter inside `t1` so consecutive breaths aren't identical.
- Floor brightness: never let `v` hit pure 0 — clamp to `max(v, 0.04)` to avoid full blackout dropouts on the rig.

**Audio reactivity (CPC).**
- `micLow` → directly add to `w` (linear, +0..+0.6 pre-pow) — bass *is* the breath, this is the single most important binding for this pattern.
- `micKick` → one-shot `breathSharpness` to 8.0 for 300 ms decay — each kick is a sharp inhale.
- `micMid` → `spatialOffset` linear add (0..+1.5) — mids spread the breath into a ripple.

**Hue hooks.**
- `micKick` → cp1H +0.05 step per kick (color of the exhale shifts over time).
- `stemVocals` → hold cp2H at +0.3 of cp1H (forced complementary inhale color) during sustained vocals.

---

### `13_sparkle.js` — **KEEP**

**Visual.** A continuous left-to-right wash from cp1 to cp2 with bright sparkles bursting between palette colors. Uses `render3D` and `sectionId` so the background field has real spatial variation (Lissajous-y wave fields A/B/C). Sparkles get optional W/A/UV glints. This is the most polished pattern in the 07–13 range — strict palette, real 3D math, multiple decorrelated wavefields. Hat-tip.

**Artistic upgrades.**
- Bloom radius is a single sin (line 99); upgrade to a 3-axis radial falloff (`exp(-r*r*8)` around a few moving "anchor" points) so sparkles look like ripples on water rather than per-pixel pops.
- `seed * 73.137` (line 96) — the constant is fine, but add a `+ sectionId * 0.41` term so different sections aren't seeded identically modulo the multiplier.
- Glint channels (`whiteGlint`/`amberGlint`/`uvGlint`) all scale with the same `sparkV` — give each a slightly different threshold (W on big sparkles only, U on small ones) for textural variety.

**Audio reactivity (CPC).**
- `micHigh` → `sparkleDensity` linear (0..+0.5 on top of slider) — hats directly fire sparkles. Single most important binding here.
- `micKick` → `sparkleIntensity` snap to 1.0 for 200 ms decay env — kicks make the whole sparkle field brighten.
- `micLow` → `backgroundMotion` linear add (0..+0.8) — bass churns the wash, hats sparkle on top.

**Hue hooks.**
- `micKick` → cycle the bg `tColour` bias by +0.1 mod 1 per kick — wash shifts color cleanly between cp1 and cp2 on each beat.
- `stemVocals` → hold `whiteGlint` high (warm vocal sustains punch through with white).

---

### 5.3 — Patterns 14–19 (Reviewer 3)

### `14_lunar_current.js` — **POLISH**

**Visual.** Wide, smooth cyan/teal currents drift diagonally with a brighter "crown" toward the top of the rig. The cp1↔cp2 RGB-lerp stays strictly on-palette, and the optional white/UV crown is gated to 0 by default, so the pattern reads as a calm, moonlit wash — a great filler but currently silent on audio.

**Artistic upgrades.**
- Add a third decorrelated drift (`time(0.007)` slow tide) and multiply into `current` so the long wave never repeats over a set.
- Push `current` shaping from `pow(1.8)` to a `pow(1.4 + 0.6*shadow)` so contrast modulates with the cross wave (more 3D feel).
- Introduce a sparse caustic dot: `softPulse(circDist(nx, drift))` over the crown to give the eye a punctuation point.

**Audio reactivity (CPC).** _Currently zero._
- `micLow` → `whiteLift` (linear, scale 0→0.6; subs swell the crown white).
- `micMid` → `density` modulation (linear, +/-1.5 around base; mid-melodic widens/tightens the wave count).
- `micKick` → one-shot envelope onto `uvLift` (decay ~250 ms) so kicks chirp UV through the crown.

**Hue hooks.**
- `micKick` → 0.04 hue nudge on `cp1H` (decaying), reads as a teal→aqua flicker on every kick.
- `stemVocals` → hold `cp2V` warmer (+0.1) during sustains; pattern leans toward the accent on long notes.

---

### `15_silk_prism_ribbons.js` — **POLISH**

**Visual.** Smooth cyan/magenta satin ribbons slide diagonally across the rig with phase-locked color blending; the look is calm, glossy, and very legible. No black gates, no flashes — it's a "breathe" pattern. Currently silent on audio.

**Artistic upgrades.**
- Phase-decorrelate `slowPhase` with a Lissajous: `time(0.014)*1 + sin(time(0.009)*TAU)*0.07` for non-repeating drift.
- Push `softness` exponent into a wave: `pow(..., softness + sin(slowPhase*TAU)*0.4)` so ribbon edges breathe in/out.
- Add a perpendicular ribbon at `0.5*ribbonCount` density mixed at 0.25 weight — gives two visible ribbon layers without going noisy.

**Audio reactivity (CPC).** _Currently zero._
- `micLow` → `ribbonCount` (linear additive, +0→3; bass thickens the weave).
- `micMid` → `phase` speed multiplier (linear, 1.0→1.8x); mids speed the slide.
- `micKick` → momentary `softness` drop (envelope, ~180 ms) so each kick punches the ribbons sharper.

**Hue hooks.**
- `micKick` → rotate `cp2H` by +0.02 each kick (wrapping); operator sees palette slowly walking on beat.
- `stemVocals` → hold `colorBlend` toward 0.7 (lean to ribbon B) during sustains.

---

### `16_ghost_tide_uv.js` — **KEEP**

**Visual.** A slow, wide tidal sweep crosses the rig with white-foam crests and UV undertow — the pattern's signature is the W+UV crown, which is on by default (and the file comment correctly defends this). Reads as eerie, glowing surf; sits low between hits.

**Artistic upgrades.**
- Add a counter-tide at half speed (subtract instead of add) and mix at 0.25 weight — two crests crossing reads more "ocean".
- Modulate `tideWidth` with `0.05*wave(time(0.006))` so foam breadth breathes.
- Replace `lowRoll = wave(...)` with `wave(...) * (0.8 + 0.2*wave(...*1.3))` for richer undertow texture.

**Audio reactivity (CPC).** _Currently zero — and this pattern especially wants it._
- `micLow` → `whiteLevel` (linear ×1.0→0.6 base + bass-driven crest); subs blow foam open.
- `micHigh` → `uvLevel` (linear); hats sparkle the undertow.
- `micKick` → envelope (~300 ms decay) on `tideWidth` widening, so each kick "breaks" a wider wave.

**Hue hooks.**
- `micKick` → snap `cp1H` between two preset blues (toggle each kick), reads as foam-color flips.
- `stemVocals` → lift `cp1V` +0.15 on sustains so mist brightens under voice.

---

### `17_rolling_color_dunes.js` — **KEEP**

**Visual.** A dense, quasi-crystal dune field across the dome with TriangleEdge "surf lines" chasing along, sparse Vintage amber embers, and PAR shimmer hits. Already section-aware (`isEdge`/`isPar`/`isBar`/`isVintage`) — the most "designed" pattern in this batch and clearly the result of a real tuning pass.

**Artistic upgrades.**
- The 4-contour blend is great; add a 5th `wave(ny * 2.1 - time(0.003))` very-slow vertical drift at 0.06 weight for a "looking up at moving sky" feel.
- Vintage `ember` could pull from a 2-period beat (`wave(shimmerPhase*0.47) * wave(shimmerPhase*0.31)`) to avoid the obvious one-period feel.
- Consider gating `parHit` exponent (`pow(...,7)`) from a slider so operator can dial PAR-shimmer aggression for the show.

**Audio reactivity (CPC).** _Currently zero — biggest gap given the section-aware infra._
- `micLow` → `blackoutDepth` modulation (inverse linear; bass *opens* the dunes).
- `micKick` → envelope (~200 ms) into PAR `parHit` so kicks punch the PARs.
- `micHigh` → boost `shardGate` exponent (lower it) so highs reveal more bar detail.
- `stemDrums` → `rollPhase` speed (linear ×1.0→1.6x).

**Hue hooks.**
- `micKick` → snap `colorBlend` toward 1.0 for one frame (palette flash to cp2 across the dunes).
- `stemVocals` → bias `amberWarmth` up +0.15 on sustains for a "vocal=warm" feel.

---

### `18_deep_space_lattice.js` — **POLISH**

**Visual.** A drifting purple/pink lattice with soft diagonals fills the rig at low contrast — calm, deep, "outer space" vibe. The lineSoftness `pow()` keeps edges glassy. Currently silent on audio and risks reading as "screensaver" from 50m on a busy night.

**Artistic upgrades.**
- The `max(gridX*gridY, diagonal*0.65)` collapse is harsh — try `sqrt(gridX*gridX*gridY*gridY + diagonal*diagonal*0.42)` for a smoother lattice braid.
- Add a phaseC for a third axis (`time(0.019)`) and a third `wave((nx+ny)*latticeScale*0.5 + phaseC)` factor at 0.3 weight — breaks the obvious grid into a quasi-pattern.
- Floor brightness `0.04` is so low the pattern can vanish at dusk — raise to `0.08 + 0.02*depth`.

**Audio reactivity (CPC).** _Currently zero._
- `micLow` → `latticeScale` (linear, +/-3 around base); bass breathes lattice density.
- `micMid` → exponent on `lineSoftness` (linear, base→base-1.5); mids sharpen the lines.
- `micKick` → flash floor brightness from 0.04→0.3 with ~150 ms decay envelope — kicks "ping" the void.

**Hue hooks.**
- `micKick` → step `depth` toward 1.0 for one frame (palette flash to accent pink).
- `stemBass` → continuous hue rotate `cp1H` at micro-rate (+0.005 per kick equiv); slow palette walk.

---

### `19_swaying_lattice_ballet.js` — **REWRITE** _(BLOCKER)_

**Visual.** What's actually on disk is **a verbatim copy of pattern 24 (`24_chromatic_murmuration.js`)** — flocking attractors with RGB-space cp1↔cp2 mix and a black-gate shutter. The header comment, function bodies, slider names (`flockReach`, `flockFocus`, `filamentDensity`, etc.) and exports all match pattern 24; nothing in the file produces a "swaying lattice ballet".

**Artistic upgrades.** _N/A until the actual pattern body exists. Once it does, the brief implied by the name suggests:_
- Two phase-offset lattices (`wave(nx*N - t)` and `wave(nx*N + t*0.83)`) "swaying" in counter-motion.
- Per-row vertical-offset bias (`ny * sin(time*TAU*0.13)`) so the lattice "ballets".
- Lissajous pivot on the sway center to avoid 1-period repeat.

**Audio reactivity (CPC).** _N/A until rewritten. Target binding:_
- `micLow` → sway amplitude; `micMid` → lattice density; `micKick` → snap sway phase.

**Hue hooks.** _N/A — wire to `micKick`→`cp2H` step and `stemVocals`→hold on cp1 once rewritten._

**BLOCKER (`marsin_engine/patterns/19_swaying_lattice_ballet.js`:1–119, all lines):** the file's header (`24_chromatic_murmuration.js`), all exports, and full body are pattern 24's content. Loading slot 19 today gives the operator a second copy of `chromatic_murmuration`. Either (a) restore the intended `swaying_lattice_ballet` source, or (b) rename the file/slot to match its contents before Friday. Do NOT ship slot 19 in the playlist until resolved.

---

### 5.4 — Patterns 20–25 (Reviewer 4)

**BLOCKER (file-level, flagged before per-pattern reviews):** `22_abyssal_sway_garden.js` is a **byte-identical copy of `24_chromatic_murmuration.js`** (verified via `diff -q`: files identical; both share the `24_chromatic_murmuration.js` header comment and full body). Loading both in the Friday playlist means slot 22 silently plays slot 24's pattern under slot 24's slider names — operator confusion guaranteed under stage pressure. Either restore the real abyssal-sway-garden source (suspected lost in a recent refactor) or remove slot 22 from the playlist. The per-pattern review below assumes the *intended* abyssal-sway-garden design.

### `20_parametric_sway_field.js` — **POLISH**

**Visual.** Three attractor "globs" of light drift across the rig in soft Lissajous arcs, blending between cp1 and cp2 with a low-amplitude trail wash bleeding between them. Reads as a slow, intelligent breathing field — calm but always moving. With reach near default, globs stay well inside the frame; at high `focus` they tighten into discrete hot spots.

**Artistic upgrades.**
- Decorrelate the three attractor periods further (multiply phase coefficients by irrationals like 1.0/1.318/0.847) so globs never re-converge on the same lattice — kills the faint "they keep meeting in the middle" tell.
- Add a per-glob micro-jitter (`wave(time(currentScale*0.07))*0.04`) to break the pure-sinusoid feel; reads as life rather than math.
- Raise default `trailBlend` floor slightly so the inter-glob filament reads from 50m even with no audio.
- Optional: drive `focus` with a slow secondary `wave(time(0.03))` to alternate "soft cloud" vs "tight orbs" without operator intervention.

**Audio reactivity (CPC).**
- Currently **silent on audio.** Minimum-viable binding:
- `micLow` → `reach` (linear, +0.15 at peak): bass pushes globs toward rig edges.
- `micKick` → `focus` (decay envelope, +3.0 then decay ~250ms): kick snaps globs into hard cores.
- `stemDrums` → `localSpeed` (linear, scale 1.0..1.3): drum density speeds the sway.

**Hue hooks.**
- `micKick` → step the cp1↔cp2 mix bias by +0.5 then decay (palette flip on the hit).
- `stemVocals` → hold mix toward cp2 (warm side) while vocals sustain.

### `21_pelagic_manta_rays.js` — **POLISH**

**Visual.** A wide "wing" of brightness traces a sinusoidal swim line horizontally across the rig, leaving rippled body trails that fade into a sea-vs-reef cp1↔cp2 wash. Foam highlights ride the top of the frame. Genuinely cinematic and reads as an organic creature; one of the few patterns that telegraphs *intent* on the rig.

**Artistic upgrades.**
- Allow 2 simultaneous mantas with offset phase (a second `mantaY` driven by `swimB + π`) — gives the "school" feel the name promises.
- Add a slow vertical drift (`time(currentScale*0.11)` added to baseline 0.48) so the manta isn't pinned to mid-height forever.
- Sharpen the leading-edge gradient: `pow(body, depthFocus*1.4)` on the forward half and softer on the trailing half — gives directional motion.

**Audio reactivity (CPC).**
- Currently **silent on audio.** Minimum-viable binding:
- `micLow` → `raySpan` (linear, scale 1.0..1.6): bass widens the wing.
- `micKick` → `whiteFoam` (decay envelope, snap to 1.0 then ~400ms decay): kick fires a foam crest across the top.
- `stemBass` → `depthFocus` (inverse: `depthFocus / (1 + 0.6*v)`): cleaner reaction than `micLow` when stems are connected.

**Hue hooks.**
- `micKick` → flash white channel +0.4 instantaneous (plumbed via the existing foam path).
- `stemVocals` → drive `uvUndertow` up while vocals sustain (moodier blacklight underglow).

### `22_abyssal_sway_garden.js` — **REWRITE**

**Visual.** Currently identical to pattern 24 (see BLOCKER above) — there is no real abyssal sway garden to review. The *name* promises a slow undulating kelp/coral bed: vertical fronds swaying with low-freq drift, deep blue-green palette, phosphorescent flickers at frond tips. That is the spec a rewrite should target.

**Artistic upgrades.** _(applies to the rewrite, not the current 24-clone)_
- Use vertical-axis (`ny`) as the primary domain with multiple decorrelated fronds: `wave(ny*k + time(s)*period + offset)` per frond, k spread irrationally so fronds never align.
- Phosphorescent tip-flicker via `pow(ny, 4) * wave(time(0.02) + nx*7.0)` to localize sparkle to the top of each frond.
- Slow lateral sway driven by `sin(time(currentScale*0.3) + ny*0.5)` added to frond x-position — kelp-in-current feel.
- Use a UV-heavy channel mix (`rgbwau` with strong uv, low w) for that "bioluminescent under blacklight" abyssal look.

**Audio reactivity (CPC).**
- `micLow` → sway amplitude (linear, scale 1.0..1.8): bass swings the kelp harder.
- `micHigh` → tip-flicker density (linear additive to phosphorescent term, +0.5 at peak): hats sparkle the tips.
- `stemVocals` → frond-base brightness (linear): vocals warm the kelp bed.

**Hue hooks.**
- `micKick` → cp1/cp2 swap, debounced ~400ms (rare palette flip on big hits — abyssal should feel sparse, not chasing every beat).
- `stemVocals` → hold hue toward cp2 (warmer accent) during vocal sustains.

### `23_prismatic_strange_attractors.js` — **KEEP**

**Visual.** Three orbital attractors drag prismatic curl filaments across the rig in a cp1↔cp2 cycle with a bounce (so the palette never visibly snaps back). White-core hot spots and UV-ghost edge bleed give it depth the RGB-only patterns lack. With chaos near default, looks like ferrofluid under three competing magnets; at high chaos, dissolves into iridescent noise — well-shaped on both ends.

**Artistic upgrades.**
- Optional: introduce a 4th attractor at low weight (~0.3) on a much slower orbit to break the 3-fold symmetry pull.
- The `curl` term sums three sinusoids then `abs`-folds — consider `(1 + curl) * 0.5` to keep more low-frequency texture instead of all "valleys" reading the same; only if operator wants more chiaroscuro.
- The bounce at `colorPhase > 0.5` creates a kink at exactly 0.5 — `wave`-style smoothing would remove it. Minor.

**Audio reactivity (CPC).**
- Currently **silent on audio.** Minimum-viable binding:
- `micLow` → `orbitReach` (linear, +0.15 at peak): bass pulls attractors toward edges.
- `micKick` → `chaos` (decay envelope, +3.0 then decay ~300ms): kick fragments the field.
- `micHigh` → `whiteCore` additive (linear, +0.3 at peak): hats sparkle the cores.

**Hue hooks.**
- `micKick` → `colorSpread` snap +0.6 then decay (kick visibly widens the palette band).
- `stemVocals` → bias `colorPhase` baseline toward cp2 (warm accent) on sustains.

### `24_chromatic_murmuration.js` — **KEEP**

**Visual.** Three orbiting flock-centers with weighted blend (the cp1/cp2 mix is driven by *which* attractors dominate at each pixel, not by position alone) make this read as actual flocking — the palette breathes with the geometry. Ribbon filaments and a slow positional shadow give it body. Strong centerpiece pattern; one of the most "alive" patterns in 00–25.

**Artistic upgrades.**
- Add a slight per-attractor color weight bias (e.g. attractor C tinted toward cp2 stronger than the others) so the blend doesn't always collapse to mid-mix when all three glow together.
- `flockFocus * contrast` combo can saturate to flat white at extreme settings — clamp `totalGlow` *before* the divide to prevent jittery `tVal` in transient hot frames.
- Slow phase precession via a 4th very slow `orbitD` term added to one attractor's coordinates — prevents the 3-sinusoid forever feeling.

**Audio reactivity (CPC).**
- Currently **silent on audio.** Minimum-viable binding:
- `micLow` → `flockReach` (linear, +0.2 at peak): bass expands the flock.
- `micKick` → `contrast` (decay envelope, +2.0 then decay ~250ms): kick crisps the filaments.
- `stemDrums` → `filamentDensity` (linear, scale 1.0..1.8): drum density adds ribbon detail.

**Hue hooks.**
- `micKick` → bias `tVal` toward 1.0 (cp2 flash) for one frame then decay (palette pulse on the hit).
- `stemVocals` → `afterglow` lifted +0.15 while vocals sustain (rig holds light longer through the lull).

### `25_heartbeat.js` — **POLISH**

**Visual.** A double-pulse (lub-dub) sweeps horizontally across the rig with a cp1↔cp2 gradient holding steady between beats. Reads cleanly as a heartbeat from the playa; the optional ripple gives a satisfying spatial sweep when engaged. Genuinely emotional pattern — one of the few that the audience will *feel* rather than just see.

**Artistic upgrades.**
- The two pulse windows (0.00–0.08 and 0.12–0.18) leave 82% of the cycle in `minBright` — add an optional `wave`-shaped breath between beats (very low amplitude, ~0.08) so the rig doesn't feel "dead" between thumps.
- Add a second harmonic option: pulse at 0.5 cycle for a "stressed/scared heartbeat" mode (operator-controlled slider, default off).
- The `posMod` vertical falloff is uniform `0.3` — try `pow(...,1.5)` so upper/lower thirds dim more, reads as a more focused chest cavity.

**Audio reactivity (CPC).**
- Currently **silent on audio.** Minimum-viable binding:
- `micLow` → pulse amplitude (linear, multiplies `localBeat` by 1.0..1.5): bass thickens the thump.
- `micKick` → `rippleAmount` (decay envelope, snap to 0.5 then decay ~600ms): each kick fires a sweeping ripple across the rig.
- `stemDrums` → `localSpeed` (linear, scale 0.9..1.2): drum density gently varies BPM.

**Hue hooks.**
- `micKick` → palette flip (single-step cp1↔cp2 swap, debounced ~400ms): every kick the heart "changes mood".
- `stemVocals` → `minBright` lifted +0.06 during sustain (the dormant glow warms while vocals hold).


---

## 6. Summer Camp Dome — APEX-specific patterns (40–56)

_Stage context: `summer_camp_dome` model. The **APEX lights group** is the tightest-density cluster at the top of the dome and reads as the most "stagey" surface from the playa. Every pattern in this range should propose at least one APEX-specific gesture (perimeter ping, dome-cap pulse, sweep that terminates at APEX, etc.). Reviewers must consult `marsin_engine/models/summer_camp_dome.js`, `summer_camp_dome.effects.js`, and `summer_camp_dome.viewmasks.js` to identify the APEX group name + indices and which view-mask isolates it._

### 6.1 — Patterns 40–48 (Reviewer 5)

_Reviewer 5 verified CPC catalog against `marsin_engine/lib/modulation_engine.js:81` and `marsin_engine/lib/osc_listener.js:42-45` — confirmed signals: `micLow`, `micMid`, `micHigh`, `micKick`. **`stem*` keys are NOT in the modulation registry for this build** — do not cite. APEX = view-mask **`Apex`** (`marsin_engine/models/summer_camp_dome.viewmasks.js:14-19`, bit `0x03`, pixels 0–56, groups `TriangleEdges` + `TrianglePars`). Across all 9 patterns the **biggest gap is that none of them bind to any CPC signal** — sliders only. From 50m of playa this is a uniform showstopper for "audio-reactive feel"; nearly every recommendation below adds a `micKick` / `micLow` hook._

#### `40_ghost_ship_reveal.js` — **POLISH**

**Visual.** Slow ghostly cold-blue→violet wash with a thin clockwise spin-beam sweeping the perimeter and a softer trailing arm; TriangleEdges fire local scanner streaks; Vintage lamps breathe sparse amber. Moody and cinematic but currently lifeless when music hits.

**Artistic upgrades.**
- Add a second beam at `tSpin + 0.5` so opposite sides of the dome flash at the same moment — doubles perimeter-ping punch for the same energy budget.
- Slow Lissajous on `revealWidth` (`phi = wave(tSlow * 0.21)`) so the beam breathes wide↔narrow over a long non-repeating period.
- `ghostLace` only modulates color by ~30% — bump weight so the cold↔warm boundary actually drifts across the dome.
- Coord math at lines 124-126 uses `(x - 0.5, z - 0.5)` but dome world coords range ~-10..10; `-0.5` offset is effectively a no-op — confirm intent vs. patterns 41/42/43 which use raw `atan2(z, x)`.

**Audio reactivity (CPC).**
- `micKick` → `tSpin` jump (additive +0.04 with 250 ms decay): beam advances on the beat.
- `micLow` → `revealWidth` (linear add 0..0.25): bass swells widen the beam.
- `micHigh` → `beaconSparkle` (linear): hats lift white-channel sparkle on APEX pars without strobing.

**Hue hooks.**
- `micKick` → nudge `cp1H` +0.04 then decay back (palette shift per beat, not a flash).
- Sustained `micLow > 0.6` → bias `colorMix` toward cp2 (warm) so basslines pull the dome amber.

**Stage-specific notes.**
- APEX gesture: when `circDist(theta, spinHead) < 0.04 && isApex`, multiply brightness 1.5x so the beam **lands** on APEX as it passes — currently apex reads same energy as BarLights.
- View-mask: **`Apex`**.

#### `41_ghost_aurora.js` — **POLISH**

**Visual.** Layered cyan-magenta aurora curtains drifting vertically across BarLights; TriangleEdges glow as a thin horizon; Vintage lamps catch sparse warm crossings. Beautiful but soft — lacks any musical anchor.

**Artistic upgrades.**
- Add a third decorrelated curl period (`tCurl3 = tCurl * 0.319`) — current two-curl mix visibly repeats every ~10 s.
- Raise `verticalTear` exponent to pow-3 and multiply by a slow Lissajous so tears walk around the dome instead of pulsing in place.
- Soften the `parSeed > 0.82 - rimShimmer*0.28` threshold gate at line 149 — currently the only "pop" mechanism and it crackles.

**Audio reactivity (CPC).**
- `micLow` → `driftChaos` (linear, add 0..0.6): bass drives curtain turbulence.
- `micMid` → `curtainWidth` (linear): mids widen ribbons.
- `micKick` → `parHit` gate (schmitt trigger): kick triggers a clean par burst, replacing the noise-threshold approach.

**Hue hooks.**
- `micKick` → snap `cp2H` +0.08 with 500 ms decay: magenta side flips toward red on the beat.
- Sustained `micHigh` → boost `rimShimmer` so cymbals literally shimmer.

**Stage-specific notes.**
- APEX gesture: on `micKick`, paint a 1-frame brighter `edgeRim` band along the lower row of `TriangleEdges` (`edgeT < 0.15`) so the horizon line "pings" as a dome-cap pulse.
- View-mask: **`Apex`**.

#### `42_boiler_glow.js` — **KEEP**

**Visual.** Hot-red/amber rotating vent sectors around BarLights with shutter texture; TriangleEdges flick as gauge needles; Vintage lamps carry filament heat; occasional steam-flash on pars. Strong TE-coded look, reads as machinery.

**Artistic upgrades.**
- `tFlicker` upper rate (1.30 + complexity*3.40 ≈ 4.7) is fast enough to alias on 60 Hz render — clamp upper end to ~3.0.
- Counter-rotating second sector (line 121) is good; add a third at `0.71 + tVent*0.31` synced to release for a 3-vent feel.
- Soften the `parBurst` hard-gated threshold (line 147) with a smoothstep so steam puffs ramp instead of snap.

**Audio reactivity (CPC).**
- `micLow` → `boilerHeat` (linear add 0..0.4): bass = more fire in the boiler.
- `micKick` → `tRelease` pulse (additive +0.04/kick): each kick triggers a steam release on pars.
- `micMid` → `triangleRPM` (linear): mids spin the gauges faster.

**Hue hooks.**
- `micKick` → +0.02 on `cp1H` (yellow shift on hit, decay back to red).
- Sustained `micLow` → blend `cp2H` toward orange (0.08) for a "running hot" look.

**Stage-specific notes.**
- APEX gesture: route `parBurst` to fire only when `tRelease` crosses a half-integer AND prefer the front-facing par via `softPulse(circDist(theta, 0.0), 0.08)` — APEX cap becomes the steam-whistle.
- View-mask: **`Apex`**.

#### `43_sea_floor_shadow.js` — **POLISH**

**Visual.** A wide dark "body" rotates around the perimeter occluding most of the ring; only the leading rim catches cold UV foam; TriangleEdges fire as distant silhouette lines. Atmospheric but **too dark by default** (`blackoutDepth` 0.76) for playa read.

**Artistic upgrades.**
- Lower default `blackoutDepth` to 0.55 — current default reads as "off" from 50m.
- Add a slow vertical swell on `y` so the shadow body has a tide rhythm, not just rotation.
- `parPulse` at pow-7 (line 145) is effectively silent — drop to pow-4 and gate on `micKick`.

**Audio reactivity (CPC).**
- `micLow` → `abyssalSwell` (linear): bass drives the underwater swell.
- `micKick` → momentary `edgeFoam` boost (+0.4, 300 ms decay): kick spikes rim foam.
- `micHigh` → `triangleSilhouette` (linear): hats brighten the distant silhouette flicker.

**Hue hooks.**
- `micKick` → palette shift toward cp2 (deeper blue) on hit — reads as a "wave crash."
- Sustained `micLow` → bias colorMix lower (deeper blue-violet).

**Stage-specific notes.**
- APEX gesture: when the dark body passes over APEX, trigger a brighter foam rim **specifically on `TrianglePars`** as if a wave is crashing over the dome cap. Currently APEX just dims.
- View-mask: **`Apex`**.

#### `44_apex_gyro_vortex.js` — **KEEP**

**Visual.** Red-orange rotating vortex with a soft core and trailing tail wrapping the whole rig; spiral texture pulls highlights inward; UV channels follow the tail. Punchy and reads from distance — the strongest of the 40s.

**Artistic upgrades.**
- **MAJOR**: coordinates use `(x - 0.5, z - 0.5)` (line 109) but dome world coords range ~-10..10. The `-0.5` offset is essentially a no-op and `radius * 2.0` (line 113) saturates to 1.0 for every pixel beyond r=0.5 m — i.e. `radius` is effectively always 1. Either normalize properly (`x/10.0`) or drop the radial term. Same bug in pattern 40.
- Add `spinSign = sign(wave(tSlow * 0.13))` to occasionally reverse direction.
- Keep `hullBase` floor just barely visible so off-frames don't snap to black.

**Audio reactivity (CPC).**
- `micKick` → `tPhase` jump (+0.06 per kick): vortex literally lurches forward on the beat.
- `micLow` → `vortexSpeed` (linear add 0..0.5): bass spins it harder.
- `micMid` → `sweepImpact` (linear): mids drive white-channel punch.

**Hue hooks.**
- `micKick` → cp1H step +0.03 (red→orange on hit).
- Sustained `micHigh` → boost `uvIntensity` so cymbals = blacklight trail.

**Stage-specific notes.**
- APEX gesture: when `circDist(theta, head) < 0.05 && isApex`, multiply brightness 1.5x so APEX gets a stronger "hit" each rotation — perimeter ping that terminates at the dome cap.
- View-mask: **`Apex`**.

#### `45_engine_room_clockwork.js` — **KEEP**

**Visual.** Mechanical amber/yellow gear-tooth pattern with pistons firing along BarLights, clock-hand sweeps on TriangleEdges, and ticking amber Vintage banks with rhythmic blackout pauses. Strong steampunk identity, very on-theme.

**Artistic upgrades.**
- `teeth = floor(5 + gearTeeth * 12)` (line 109) → up to 17 teeth aliases against 18-pixel bars — clamp to 16 max.
- Lock `tTick` rate to musical period via `micKick` count instead of free-running so pauses arrive on the beat.
- `parBurst` at pow-10 (line 140) is too narrow — pow-6 and route to `micKick`.

**Audio reactivity (CPC).**
- `micKick` → `tTick` advance (+0.05 per kick): ticks land on the beat literally.
- `micLow` → `pistonStroke` (linear): bass strokes the pistons harder.
- `micMid` → `boilerHeat` (linear): mids glow up the filaments.

**Hue hooks.**
- `micKick` → cp1H -0.02 (red flash on tick) with decay.
- Sustained `micLow` → push cp2 toward deep amber.

**Stage-specific notes.**
- APEX gesture: replace the constant `parBurst` random with a **dome-cap pulse synced to `pauseGate` exiting** — when the gate opens after a pause, fire APEX bright for ~150 ms. Makes the pause→release rhythm physical.
- View-mask: **`Apex`**.

#### `46_dome_lockdown.js` — **POLISH**

**Visual.** Two circular "doors" open from front/back over ~10 s, with pre-door blackout then a slow rotational reveal, edge highlights and warm Vintage drift through the opening. Cinematic but the pre-door blackout reads as "broken" from across the playa.

**Artistic upgrades.**
- **MAJOR**: filename is `46_dome_lockdown.js` but source header (line 3) says `dome_door_spin`. Pick one — guaranteed mid-show operator confusion.
- Lower default `holdBlackout` to 0.15 so dark phase is short for ambient use; current default sits dark ~1.5 s per cycle.
- Gate `parBreath` on `doorOpen > 0.5` (line 228) so APEX pars only light AFTER doors open — currently they breathe through blackout.

**Audio reactivity (CPC).**
- `micKick` (threshold > 0.7) → **reset `tDoor` to `openStart`**: each big drop triggers a fresh door-open animation. Single biggest improvement here.
- `micLow` → `spinSpeed` (linear): bass drives faster post-open rotation.
- `micMid` → `openImpact` (linear): mids boost white-edge highlights.

**Hue hooks.**
- `micKick` → swap `cp1H`/`cp2H` for 1 frame (visual snap) on door-open trigger.
- Sustained `micHigh` → +0.2 to `edgeUv` so cymbals = UV-edge halo.

**Stage-specific notes.**
- APEX gesture: raise default `triangleLead` to > 0.75 so APEX visibly **opens first** with a sweep — current 0.68 isn't committed enough. The tiered edge sweep IS the APEX gesture.
- View-mask: **`Apex`**.

#### `47_apex_perimeter_ping.js` — **KEEP**

**Visual.** Cyan-violet sonar pings launch from TriangleEdges (the "transmitter") and travel radially outward along BarLights to the perimeter, with delayed echoes and amber midpoint catches on Vintage. Conceptually exactly the kind of stage-coded gesture this section calls for.

**Artistic upgrades.**
- `lanes = floor(3 + laneCount * 8)` → up to 11 lanes (line 85) — too many to read from 50m; cap at 6.
- Convert `tPing` from continuous phase to a **discrete launch** model: counter increments on `micKick`, pings fire as triggered events. Today it looks more like a continuous chase than discrete sonar.
- `vintageMidpoint` default 0.26 — amber catches are barely visible; raise to 0.45.
- `par` on `TrianglePars` (line 109) fires when head hits 0.06 — decoupled from edge launch. Sync them.

**Audio reactivity (CPC).**
- `micKick` → **discrete ping launch** (advance `tPing` to 0): each kick fires a single ping traveling the rig.
- `micLow` → `trailDecay` (linear): bass lengthens trails.
- `micHigh` → `vintageMidpoint` (linear): hats brighten amber catch.

**Hue hooks.**
- Each ping (kick) → rotate `cp1H` by +0.015 (cumulative gentle palette walk across the show).
- Sustained `micMid` → push colorMix toward cp2 (warmer ping).

**Stage-specific notes.**
- APEX gesture: this **is** the canonical APEX gesture — TriangleEdges launch the ping. Strengthen by firing `launch` explicitly from `edgeT ≈ 0` (one end of each edge) rather than wrapping, so visually APEX "throws" the ping outward. Sync `parPulse` on every launch.
- View-mask: **`Apex`** (this pattern is the canonical isolation test).

#### `48_titanic_sos_beacon.js` — **POLISH**

**Visual.** Morse "SOS" (… --- …) on TriangleEdges with delayed circular echoes on BarLights and amber Vintage "responder" lamps; deep cold-blue/warm-amber palette. Strong narrative for the theme.

**Artistic upgrades.**
- **MAJOR / strobe hazard**: `morsePulse` (lines 47-52) returns hard 1.0/0.0 — no envelope, so this WILL strobe on every dot at higher `signalSpeed`. Add `min(1.0, decay * 8)` post-shape or similar. Operator should **NOT** load this near the dance floor on Friday without softening first.
- Morse pattern is hardcoded; add a slow palette phase drift per full cycle so the message doesn't loop visually-identical.
- `abyssalDarkness` default 0.70 — drop to 0.50 for playa read.

**Audio reactivity (CPC).**
- `micLow` → `responseGlow` (linear): bass swells Vintage "responders."
- `micMid` → `signalStrength` (linear): mids brighten the morse signal.
- `micKick` → reset morse cycle (`tSignal = 0`): kick re-triggers SOS so it lands on the drop.

**Hue hooks.**
- Each completed SOS cycle → rotate `cp1H` by +0.02 (slow walk).
- Sustained `micLow` → bias colorMix toward cp2 (warmer responder amber).

**Stage-specific notes.**
- APEX gesture: APEX (`TriangleEdges` + `TrianglePars`) IS the morse transmitter — sync `parBurst` (line 73) to fire with each morse pulse, and add a slow `TrianglePars` "tower light" sweep between morse letters so APEX feels like a beacon even between transmissions.
- View-mask: **`Apex`**.

### 6.2 — Patterns 49–56 (Reviewer 6)

_APEX group note: the view-mask sidecar exposes a composite `Apex` mask covering `TriangleEdges + TrianglePars` (pixel range 0–56) and an `AllButApex` mask (57–320). Every pattern below already gates on `sectionId == 1` (TriangleEdges) and `sectionId == 2 && y > 2.0` (TrianglePars), so the operator can isolate the APEX gesture by enabling the `Apex` view-mask without code changes._

#### `49_boiler_pressure_release.js` — **KEEP**

**Visual.** A rotating "vent" sector chases around the BarLights ring while TriangleEdges read like a rising pressure gauge; on release the apex pars white-flash, then a cool UV afterglow lingers as Vintage filaments breathe amber heat.

**Artistic upgrades.**
- Decorrelate the two vent angular velocities with an irrational ratio (bump second vent from `tBuild * -0.49` to `tBuild * -0.618`) so they never re-align.
- Add a brief anticipation flicker on TrianglePars in the last 8% of the build phase (pre-flash gauge tick).
- Jitter `releaseThreshold` by a slow LFO (`±0.04 * wave(tBuild*0.13)`) so release timing breathes instead of being metronomic.

**Audio reactivity (CPC).**
- `stemBass` or `micLow` → `pressure` (linear, 0..1): louder sub builds faster, more visible gauge climb.
- `micKick` → `ventFlash` (envelope, ~250 ms decay): each kick punches the vent flash brighter.
- `micHigh` → `coolingAfterglow` (linear, scaled 0.3..0.9): hats add UV shimmer in cooldown.

**Hue hooks.**
- `micKick` → snap `cp1H` +0.02 each release (palette rotate on vent burst).
- `stemVocals` → hold cp2 toward deep blue (warm-to-cool tug during cool phase).

**Stage-specific notes.** APEX benefits most from the par flash + edge gauge. Operator sets `Apex` view-mask for solo gauge-and-flash gesture; under full rig the vent sectors carry around the BarLights perimeter and terminate visually at APEX.

#### `50_iceberg_fracture.js` — **KEEP**

**Visual.** TriangleEdges crack with stuttering strikes at the apex, then chases shoot down angular BarLights lanes carrying cold white impacts; Vintage lamps glow delayed amber aftershocks. Deep negative space — most frames the dome is dark except for the active lane.

**Artistic upgrades.**
- Per-edge phase from `edgeId * 0.333` is too uniform; use `fract(edgeId * 0.6180339)` so cracks don't co-originate.
- Replace single `lane = pow(wave(theta*lanes + tBranch), N)` with a two-scale beat (`* pow(wave(theta*lanes*0.5 + phi), 3)`) for non-repeating lane structure.
- Sharpen the `impact` envelope to fast-rise / slow-decay (asymmetric) so kicks feel snappier.

**Audio reactivity (CPC).**
- `micKick` → `fractureDensity` (Schmitt-trigger gated with floor): kicks crank density + impact intensity.
- `micHigh` → `branchSpread` (linear): hats widen the splinter web.
- `micLow` → `aftershockWarmth` (linear, smoothed): sub gives the Vintage afterglow body.

**Hue hooks.**
- `micKick` → step `cp2H` by +0.015 on each strike (palette walk).
- `stemVocals` → bias cp1 toward pale cyan for held vocal sustains.

**Stage-specific notes.** APEX `TriangleEdges` is the crack origin — operator should run on `Apex` view-mask during quiet builds (no BarLights), then switch to full rig at the drop so the cracks visibly "travel out" to the perimeter.

#### `51_abyssal_searchlight.js` — **KEEP**

**Visual.** One to four narrow vertical light shafts sweep around the BarLights ring with a wobbling gimbal; TriangleEdges flare as the searchlight "source", and Vintage lamps catch each beam pass as a tiny amber glint. Most of the dome is deliberately black.

**Artistic upgrades.**
- The `shutter` term modulates `theta * 4.0`; lower to `2.7` and add a per-beam shutter offset so beams visually pulse out-of-phase.
- Add a rare reverse sweep (every ~8 cycles) via a sign flip — operators love a surprise direction change.
- Beam separation `(0.72 + beamNo * 0.09)` locks; use `(0.5 + beamNo * 0.618)` so beams drift instead of locking.

**Audio reactivity (CPC).**
- `micKick` → `sweepImpact` (envelope, ~200 ms): each kick brightens beam head + white punch.
- `micMid` → `gimbalDrift` (linear): snare/vocals wobble the beam.
- `stemDrums` → `beamCount` (stepped: <0.25→1, <0.5→2, <0.75→3, else 4): more drums, more shafts.

**Hue hooks.**
- `micKick` → momentary cp1 saturation +0.2 (color punch on hit, 300 ms decay).
- `stemVocals` → hold cp2 toward deep indigo during sustains.

**Stage-specific notes.** This pattern most justifies APEX as a stage "source". Use `Apex` view-mask alone for a beam-source-only look (no perimeter), or full rig to read the sweep across the playa. Excellent low-density choice for late-night ambient sections.

#### `52_iceberg_shear_line.js` — **POLISH**

**Visual.** A wide bright "ice blade" sweeps around the ring; one side reads as submerged cool wash, the other retreats into faint warm memory. TriangleEdges carry a synchronized vertical blade across the apex.

**Artistic upgrades.**
- `iceSide` uses a hard threshold (`dist < (0.22 + shearWidth*0.16)`); replace with a smoothstep over that band so the side division doesn't pop as the blade moves.
- BarLights vertical-crack multiplier `1.38` re-aligns visibly; change to `1.382` (golden conj.) to break the period.
- `warmthRetreat` default 0.24 reads weak; bump default to 0.40 so the warm-side contrast reads from 50m.

**Audio reactivity (CPC).**
- `micLow` → `advance` (linear, 0.3..0.9): sub drives blade speed.
- `micKick` → momentary `triangleBlade` boost (envelope, +0.4 on hit): apex blade flashes on the beat.
- `stemVocals` → `warmthRetreat` (linear): sung passages light up the retreating warm side.

**Hue hooks.**
- `micKick` → cp2 hue rotate +0.025 each blade-pass.
- `stemVocals` → cp1 hold toward pale frost (sustain reinforces ice side).

**Stage-specific notes.** APEX edges carry the blade most cleanly. Operator sets `Apex` for a single sweeping vertical bar through the stage; full rig adds the perimeter slice. Strong as a transition look.

#### `53_shadow_eclipse.js` — **KEEP**

**Visual.** A black-body shadow drifts around the BarLights ring, bordered by two shimmering rims; TriangleEdges form a corona stage flare aligned with the shadow center. Very dark by default — eats most of the rig.

**Artistic upgrades.**
- `orbitPhase` motion is monotonic; add a slow Lissajous wobble (`+ wave(orbitPhase*0.083)*0.04`) so the eclipse doesn't trace a perfect ring.
- Rim shimmer exponent (`pow(...,2.5)`) is fixed; drive it from `rimWidth` so wider rims read softer and tighter rims crisper.
- Add a rare "diamond ring" — when `wave(orbitPhase*0.13) > 0.95`, inject one bright TrianglePar frame for a single intense flash.

**Audio reactivity (CPC).**
- `micLow` → `shadowSize` (linear, scaled 0.45..0.85): bass swallows the rig.
- `micKick` → `coronaPulse` (envelope, ~300 ms): each kick flares the corona arms.
- `micHigh` → rim shimmer multiplier (linear, 0.5..1.5 on `shimmer`).

**Hue hooks.**
- `micKick` → momentarily push cp2 hue toward red-orange (corona flare warmth).
- `stemVocals` → cp1 hold deep indigo for sustained shadow.

**Stage-specific notes.** APEX corona arms are the signature here. `Apex` view-mask alone gives a stage-only black-sun coronation; full rig for the orbiting shadow. Excellent ambient/cinematic.

#### `54_boiler_fire_overdrive.js` — **POLISH**

**Visual.** Rotating flame tongues curl around the BarLights ring with hot bright TriangleEdges and amber Vintage filaments. Bright, warm, danceable — the drop-energy pattern of the set.

**Artistic upgrades.**
- One-liner is hard to read but math is fine; not a BLOCKER, just MINOR ergonomics for the next pass.
- `tongues = floor(3 + tongueCount*9)` can hit 12, which blurs into a wash from 50m. Cap at 9.
- Add per-tongue jitter `wave(tFire*0.07 + edgeId)` so tongues breathe slightly out of phase instead of locking to `theta*tongues`.
- `blackoutDepth` default 0.48 is too bright for negative space; recommend default 0.62 so peaks pop more.

**Audio reactivity (CPC).**
- `stemBass` → `flameHeight` (linear, 0.3..0.95): bass pumps flame energy.
- `micKick` → `heatFlash` (envelope, ~200 ms): each kick flashes apex whites.
- `micHigh` → `tongueCount` (linear, mapped to 4..8): hats add tongues.

**Hue hooks.**
- `micKick` → cp1 hue snap toward pure red (palette punch on hit).
- `stemVocals` → cp2 hold toward warm gold (sustain bakes amber).

**Stage-specific notes.** APEX is the bright stage core — `Apex` view-mask alone gives a pure "fire bars" look without the perimeter swirl. Full rig is the high-energy drop pattern.

#### `55_stardust_dome.js` — **POLISH**

**Visual.** Two slow particles orbit the BarLights ring with a dust haze; TriangleEdges hold the central "star" cores and TrianglePars hit white twinkle on impacts. Vintage glows occasional amber.

**Artistic upgrades.**
- Two orbits use `spin` and `0.37 - spin*0.63` — that's a mirrored, not decorrelated, motion. Replace second orbit with `tOrbit*0.391` for true non-repeat.
- Dust `pow(wave(...), 8.0 - particleDensity*3.0)` is fine but a bit expensive; consider fixed exponent 6.0 to free CPU for layering.
- Add a rare "shooting star" — at `wave(tOrbit*0.073) > 0.97`, inject a fast 0.3 s arc along BarLights.
- `wallHit=0.42` default reads weak; bump default to 0.55.

**Audio reactivity (CPC).**
- `micKick` → `starCore` (envelope, ~250 ms): each kick brightens the apex star.
- `stemBass` → `wallHit` (linear, 0.3..0.8): bass drives the perimeter punch.
- `micHigh` → `particleDensity` (linear): hats sprinkle stardust.

**Hue hooks.**
- `micKick` → cp1 hue step +0.02 on impact (palette walk warm-to-cool).
- `stemVocals` → cp2 hold toward pale gold for amber bloom.

**Stage-specific notes.** Designed as a finale — APEX carries the "star core" gesture. Operator sets `Apex` view-mask for a stage-only twinkle, or full rig for the orbiting stardust finale.

#### `56_stage_mirror_axis.js` — **KEEP**

**Visual.** Mirror-symmetric motion around an operator-aimed stage axis: two beams pulse outward and inward from the axis, a bright stage line sits on-axis, and a faint opposite-side rim closes the frame. Sparse particles and an axis "guide" marker help the operator aim at the real stage during setup.

**Artistic upgrades.**
- `mirroredEdge` uses `edgeId * 0.333`; with the small triangle-edge count this is fine, but adding `floor(edgeId/2.0)` parity would give inside/outside asymmetry.
- Particle exponent `7.0 - particleDensity*3.0` floors at 4 already in code; OK — leave.
- `centerGuide` overwrites RGB unconditionally when `>outR`; at low values it can wash out music-driven motion — gate to `centerGuide > 0.05` so it acts as an explicit operator setup tool only.

**Audio reactivity (CPC).**
- `micLow` → `orbitSpeed` (linear, 0.25..0.75): sub drives beam motion.
- `micKick` → momentary `stageFocus` boost (envelope, +0.25): kicks flare the axis line + apex core.
- `micMid` → `mirrorWidth` (linear): mids fatten the beams.

**Hue hooks.**
- `micKick` → cp1 hue snap +0.025 each kick (palette rotate).
- `stemVocals` → cp2 hold toward magenta on vocal sustain (opposite-side rim warms).

**Stage-specific notes.** Single most APEX-aware pattern in the set — the axis line lives at apex by design. `Apex` view-mask gives an axis flash + edge cores only; full rig adds the mirrored perimeter sweep. Best after `sliderCenter` is dialed in to the real stage direction.


---

## 7. Summer Camp Logsville — redwood-uplighting patterns (70–85)

_Stage context: `summer_camp_logsville` model. The **redwood uplighting group** is the vertical column cluster meant to read like trees from the playa edge. Every pattern in this range should propose at least one redwood-specific gesture (vertical wash, top-down drip, alternating-column chase, etc.). Reviewers must consult `marsin_engine/models/summer_camp_logsville.js`, `summer_camp_logsville.effects.js`, and `summer_camp_logsville.viewmasks.js` to identify the redwood group name + indices and which view-mask isolates them. Per the operator: this range has NOT been optimized — bias toward POLISH/REWRITE verdicts._

### 7.1 — Patterns 70–77 (Reviewer 7)
_Redwood context used by this reviewer: groups `Redwoods1` / `Redwoods2` / `Redwoods3` (pixel indices 204–221, all UkingPar, all at `y=3` with z=18.4 / 21 / 23.6 — the y-axis is effectively flat across the redwoods), composite view-mask `RedwoodPARs` (bit `0x40` = 64) per `marsin_engine/models/summer_camp_logsville.viewmasks.js`. Patterns currently hard-code raw bit values (1, 2, 64, 128) instead of named masks — fragile but factually correct given today's sidecar. **Critical structural finding for the whole range:** any height/vertical gesture using world `y` on the redwoods will fail (all redwoods sit at `y=3`, all TowerBars also `y=3`); operators wanting "vertical" reads on trees must use `nz` (depth-into-grove), `ny` (normalized 0..1), or per-group offsets. Most patterns 70–77 ignore this and produce dead spots or uniform flashes on the PARs._

#### `70_forest_canopy_reveal.js` — **POLISH**

**Visual.** Slow uniform UV breath on all 18 redwood PARs; vintage lamps gently flicker at ~4× the breath rate based on pixel index. RGB layer is effectively dead (`pr1 * 0.1`) — audience sees a near-monochromatic UV wash, not a "canopy reveal."

**Artistic upgrades.**
- Stagger breath phase per redwood group by 0.33 (Redwoods1/2/3 out of phase) so three distinct silhouettes read instead of one wall.
- Replace `random(1) < 0.02` sparkle with a deterministic time-jittered kernel (`(time(.1) + index*0.137) % 1 < 0.03`); current impl re-rolls per frame, sparkles look like a fizzle at 60 fps.
- Modulate `canopyReveal` with a slow `wave(tPhase*0.27)` envelope decorrelated from the per-pixel breath; kills the metronome feel.
- Bump RGB residual to ~0.15 and let cp1↔cp2 cross-fade tint the UV so warm/cool palette swaps actually register.

**Audio reactivity (CPC).**
- `micLow` → `canopyReveal` (linear, +0..+0.4 offset; bass blooms canopy)
- `micKick` → `lanternGlow` (Schmitt + 200 ms decay; lanterns pulse on kick)
- `micHigh` → `canopySparkle` (linear, gate threshold 0.3 so wash isn't always fizzing)

**Hue hooks.**
- `micKick` → cp1H +=0.083 per kick (12-step hue cycle through the canopy)
- `stemVocals` → bias `lanternGlow` toward amber-only when vocals sustain > 0.4

**Stage-specific notes.** Gesture: **root-to-canopy reveal via per-group phase** (since redwood `y` is flat, fake verticality with group/`nz` offsets). View-mask: `RedwoodPARs` (`0x40`). Operator should isolate redwoods on a dedicated view channel during ambient openers so the dim 0.1 RGB doesn't leak.

---

#### `71_redwood_aurora.js` — **REWRITE**

**Visual.** Supposed to be vertical color sweeps on redwood crowns. In practice `yPhase = y * 2.0 - tPhase` is computed against world `y=3` for *every* redwood, so all 18 PARs share an identical phase and pulse in unison — not an aurora, just a synchronized fade. UV inverts the same single-phase wave. Carry-from `20260525_8_logsville_tuned_patterns.md`: this concept always needed group/z phase separation, never got it.

**Artistic upgrades.**
- Replace `y * 2.0 - tPhase` with `nz * 2.0 - tPhase` (each redwood ring sweeps in depth) or a per-group offset hash.
- Multi-period beat: blend `wave(yPhase)*0.6 + wave(yPhase*1.618)*0.4` to break the strict 1.31 s loop.
- Replace `random(1) < 0.05` shimmer with a coherent high-band noise mask gated on `windShimmer`; current impl strobes at frame rate, reads as dead pixels.
- Bias mix toward cp2 when `uvIntensity` is high so RGB and UV stop fighting at warm/cool extremes.

**Audio reactivity (CPC).**
- `micLow` → `auroraHeight` (linear, +0..+0.4 offset)
- `micHigh` → `windShimmer` (gated threshold 0.25, exp curve)
- `stemVocals` → `cabinWarmth` (linear)

**Hue hooks.**
- `micKick` → cp2H +0.05 step (rotates the cool side of the aurora)
- `stemBass` sustain → hold cp1 saturated; release drops cp1V to 0.5

**Stage-specific notes.** Gesture: **root-to-canopy sweep on `nz`** (each redwood ring offset). View-mask: `RedwoodPARs` (`0x40`). DO NOT load Friday without the y→nz fix; in current form it is visually wrong for this stage.

---

#### `72_outpost_campfire.js` — **POLISH**

**Visual.** Vintage lamps (wall + tower) flicker amber per-pixel via index-offset wave; redwoods get a dim static `pr1 * 0.15` RGB; UV is *always on full* (`u = uvIntensity` unconditionally — not masked). Campfire reads on the vintage cluster but UV bleeds onto every fixture in the rig including bars and walls, washing the whole stage violet.

**Artistic upgrades.**
- Gate `u` behind `isRedwood` (currently leaks UV to all 222 pixels — design intent is canopy UV only).
- Per-pixel flicker should be 1/f noise, not a pure sine. Mix two waves at irrational ratio (`wave(p) * wave(p*1.41 + index*0.07)`).
- Add "log pop" — single-pixel amber spike with 300 ms exp decay on `micKick`.
- Bias campfire color toward red on low flicker (`r += a * 0.3 * (1 - flicker)`) so embers look like embers, not LEDs.

**Audio reactivity (CPC).**
- `micMid` → `flickerSpeed` (linear; busier music = busier fire)
- `stemVocals` → `campfireHeat` (linear, +0..+0.3 offset)
- `micKick` → log-pop spike (Schmitt + 300 ms decay, scales `woodSparkle` 4×)
- `micLow` → `uvIntensity` (linear; lows deepen the forest shadow)

**Hue hooks.**
- `micKick` → flash a red-orange ember on a random vintage pixel
- `stemVocals` sustain → hold cp1 toward amber-red (`cp1H ≈ 0.05`)

**Stage-specific notes.** Redwoods stay static-cool by design. Gesture: **vintage-warm hold with UV-only on redwoods**. View-masks: `RedwoodPARs` (`0x40`) for UV gating; `VintageOnly` (`0x80`) for the flicker layer.

---

#### `73_redwood_shadow_breath.js` — **POLISH**

**Visual.** A single global breath wave drives RGB swell *and* its inverse drives UV across "redwood OR tower." All 18 redwood PARs share one phase (same `y=3` issue). The tower-bit check `viewMask & 1` is a raw-bit gamble — `TowerBars` may or may not be bit 1 depending on boot-time base-group auto-assignment. Edge shimmer `random(1) < 0.01` fires on *every* pixel without group gating → walls/vintage also strobe.

**Artistic upgrades.**
- Phase-offset breath per group: `breath_g = wave(tPhase + groupPhase)` with `groupPhase ∈ {0, 0.25, 0.5}` for Redwoods1/2/3 → three trees inhaling at different cadences.
- Gate `edgeShimmer` behind `(isRedwood || isTower)` — currently leaks white onto walls.
- Add a slow `1 - wave(tPhase*0.13)` envelope on `shadowDepth` so UV depth itself breathes on a longer Lissajous-like cycle.
- Add cp2 tint to UV (`u_color = u * 0.2 → b`) to color-shift the shadow violet→indigo.

**Audio reactivity (CPC).**
- `micLow` → `shadowDepth` (linear, +0..+0.3 offset)
- `micMid` → `canopySwell` (linear)
- `micHigh` → `edgeShimmer` (gated threshold 0.3)

**Hue hooks.**
- `stemBass` sustain → bias cp2 cooler (cp2H toward 0.66 / deep blue)
- `micKick` → momentary cp1S +0.2 for 250 ms

**Stage-specific notes.** Gesture: **vertical wash via per-group phase** (fake verticality with group offset, since redwood y is flat). View-mask: `RedwoodPARs` (`0x40`) plus tower bar mask. Verify raw `viewMask & 1` against the boot-time bit assignment before show.

---

#### `74_lookout_gyro_vortex.js` — **REWRITE**

**Visual.** `atan2(z - 0.5, x - 0.5)` treats `(0.5, 0.5)` as the rotation center, but actual stage centroid is `x≈6.7, z≈8.2` (towers) and redwoods sit at `z=18–23` — all redwood PARs land in roughly the same angular sector, so the vortex barely sweeps the trees at all. UV is gated only on `core` (top 5%) → tree underlight pulses for ~50 ms per rotation, looks broken. No group gating means walls also get the RGB sweep at 0.6, fighting the concept.

**Artistic upgrades.**
- Rewrite center: use `nx, nz` (already normalized) and center at the tower (`nx≈0.5, nz≈0.34`).
- Per-fixture-type sweep speed: TowerBars rotate at `vortexSpeed`, redwoods at `vortexSpeed*0.5` counter-direction → real vortex reading.
- Replace binary core (`sweep > 0.95`) with smooth `pow(sweep, 8)` peak — current binary core flickers harshly at low FPS.
- Layer a second sweep at `vortexSpeed * 0.37` blended at 0.3 → breaks the strict 1-Hz loop.

**Audio reactivity (CPC).**
- `micLow` → `vortexSpeed` (linear, 0.5..1.5× multiplier)
- `micKick` → `sweepImpact` (Schmitt + 150 ms decay)
- `stemVocals` → `outpostGlow` (linear)
- `stemDrums` → counter-rotation speed bump on redwoods

**Hue hooks.**
- `micKick` → cp1H +=0.083 per kick
- `stemBass` → cp2V high; release dims cp2V to 0.4

**Stage-specific notes.** Gesture: **alternating-column chase** mapped to atan2 around tower centroid, redwoods get a SLOWER counter-vortex. View-mask: `RedwoodPARs` (`0x40`). DO NOT load Friday without the centroid fix — currently does nothing visually meaningful on the redwoods.

---

#### `75_timber_mill_clockwork.js` — **REWRITE**

**Visual.** Bar chase steps by raw `index/18` (mod 2). Vintage gets a `tick` amber + occasional white sparkle. **Redwoods are completely uncovered** — no group branch hits them, except the unconditional `u = uvIntensity` at the bottom (same bleed bug as 72: UV fires on every pixel). Net: tower flashes, vintage ticks, walls dark, redwoods get only UV. Doesn't match "logging mill."

**Artistic upgrades.**
- Add redwood branch: each kick rotates which redwood group lights (round-robin Redwoods1→2→3) as a "gear advance."
- Gate `u` behind `isRedwood`.
- Convert bar chase from binary `< 6 ? 1 : 0` to `exp(-((index-pos) mod 18)^2 / 8)` Gaussian → smooth gear-tooth sweep.
- Quantize vintage tick rate to a 16th-note phase, not a sine — spec calls for "ticking" but impl is continuous wave.

**Audio reactivity (CPC).**
- `stemDrums` → `gearSpeed` (linear, 0.5..2×)
- `micKick` → `tickSharpness` impulse (150 ms decay)
- `stemBass` → `boilerHeat` (linear)
- `micLow` → `uvIntensity` (gate threshold 0.2)

**Hue hooks.**
- `micKick` → palette swap on bar chase (cp1↔cp2 index step)
- `stemDrums` sustain → amber dominance hold on vintage

**Stage-specific notes.** Gesture: **alternating-column chase on tower + redwood gear-advance round-robin**. View-mask: `RedwoodPARs` (`0x40`). DO NOT load Friday without redwood branch + UV gating fix — currently flashes UV across all 222 pixels.

---

#### `76_outpost_lockdown.js` — **REWRITE**

**Visual.** `lockY = wave(tPhase)` returns `0..1`, `active = y < lockY ? 1 : 0` — for all redwoods and TowerBars `y=3`, so `y > lockY` *always*: **redwoods and bars never activate**. Slam impact `abs(y - lockY) < 0.05` also never triggers there. Only wall vintages (`y=2..2.4`) and tower vintages (`y=3.07..3.29`) animate, and even those clip strangely. Verified bug — pattern is structurally broken.

**Artistic upgrades.**
- Use `ny` (normalized 0..1) instead of world `y`. From the model: walls `ny≈0..0.29`, tower bars + redwoods `ny=0.777`, tower vintage `ny=0.83..1.0`. With `ny` the lockdown actually sweeps.
- After fix, lockdown reads wall → mid → tower vintage tops. Add per-fixture-type delay so it feels like physical doors slamming sequentially.
- White slam should latch with 200 ms exp decay envelope, not a per-frame `abs() < 0.05` knife edge (current impl produces 1-frame strobes invisible at 60 fps).
- Stair-step `lockY` (quantize to 4 levels) so the lockdown feels mechanical.

**Audio reactivity (CPC).**
- `micLow` → `doorPressure` (linear)
- `micKick` → `slamImpact` (Schmitt + 250 ms decay)
- `stemVocals` → `amberMemory` (linear, +0..+0.4 offset)

**Hue hooks.**
- `micKick` → red flash on slam line (override cp1 red for 200 ms)
- `stemBass` sustain → cool palette hold (cp1H → 0.66)

**Stage-specific notes.** Gesture: **top-down drip** (lockdown closes from canopy down). View-mask: `RedwoodPARs` (`0x40`). DO NOT load Friday — y vs ny bug is total: redwoods and bars never participate. Clearest "do not ship" in the batch.

---

#### `77_tower_canopy_ping.js` — **REWRITE**

**Visual.** `dist = y; wavePos = wave(tPhase * pingSpeed)`. Same `y=3` flat issue as 76: redwoods at `y=3`, `wavePos ∈ [0,1]`, so `abs(3 - wavePos) < 0.1` is *never* true → redwoods never ping. Bars also at `y=3` → bars never ping. UV `edgeTrail * (1 - ping)` fires on every pixel since `ping` is mostly 0 → global UV wash on the whole rig. Pattern does not do what its name says.

**Artistic upgrades.**
- Use `nz` (walls `nz=0`, tower `nz≈0.34`, redwoods `nz=0.78..1.0`) — natural ping axis is depth into stage, not height.
- Widen ping band to `< 0.15` and feather with `exp(-d²/0.01)` so the band reads at playa distance.
- True ping-pong: `triangle(tPhase * pingSpeed)` so head bounces between tower and canopy, not loops.
- Gate `u` behind `isRedwood` (currently leaks UV onto walls and bars).

**Audio reactivity (CPC).**
- `stemDrums` → `pingSpeed` (linear, 0.5..2×)
- `micKick` → `pingImpact` (Schmitt + 200 ms decay)
- `micLow` → `edgeTrail` (linear)

**Hue hooks.**
- `micKick` → cp1H/cp2H alternate step (each kick swaps which palette leads the ping)
- `stemBass` sustain → cp2V boost on the canopy end of the bounce

**Stage-specific notes.** Gesture: **root-to-canopy sweep on `nz`**. View-mask: `RedwoodPARs` (`0x40`). DO NOT load Friday — y-axis bug + UV leak make this functionally broken.

---

**Reviewer 7 summary.** 0 KEEP / 3 POLISH (70, 72, 73) / 5 REWRITE (71, 74, 75, 76, 77). Three recurring bugs hit nearly every pattern: (1) world `y` used as a vertical axis when all redwood and tower-bar pixels share `y=3` — use `ny` or `nz` instead; (2) UV bleeding onto all 222 pixels because `u = uvIntensity` is set unconditionally outside the group branch (72, 75, 77); (3) raw view-mask bit numbers (`1`, `2`, `64`, `128`) hard-coded against auto-assigned ordering — fragile, should be named constants exported from the model sidecar. **Do NOT load Friday without rework:** 71, 74, 75, 76, 77 (76 and 77 are completely non-functional on redwoods + tower; 75 leaks UV stage-wide).

### 7.2 — Patterns 78–85 (Reviewer 8)
_Reviewer 8 — 2026-05-27. Verdicts skew REWRITE per operator: this range is untuned. Verified CPC names against `marsin_engine/lib/modulation_engine.js:81` and `param_center.js:163`. Verified view-mask bits against `marsin_engine/models/summer_camp_logsville.viewmasks.js`: only `RedwoodPARs=0x40` (idx 204–221) and `VintageOnly=0x80` (idx 144–203) are defined; bits 1/2/4 used in current sources do **not** map to any registered mask and silently no-op._

---

### `78_woodland_trident_sweep.js` — **REWRITE**

**Visual.** A narrow color-bar smears across the towers and dies; redwoods stay near-black with only a faint UV haze. Reads as a single horizontal slab, no trident, no sweep gesture.

**Artistic upgrades.**
- `x` is world meters (~3..9 towers, ±10 redwoods) but compared to `wave(tPhase) ∈ [0,1]` — sweep never reaches outer redwoods. Switch to **normalized `nx`** (or normalize `x` against model bounds) so the sweep traverses the full stage.
- Real trident: three phase-offset sweeps at `tPhase`, `tPhase+1/3`, `tPhase+2/3` so something is always moving.
- Add height kicker: scale `sweepWidth` by `(1.2 - z*0.6)` so the cut narrows toward the canopy top.
- Edge trail should decay (`pow(1-distance, 3)`), not just inverse-gate the sweep onto UV.

**Audio reactivity (CPC).**
- `micLow` → sweep speed (`tPhase` rate multiplier, linear ×0.5..2.5) — slow at silence, urgent at drop.
- `micKick` → 80 ms `sweepImpact` envelope spike (Schmitt, decay 200 ms) — each kick widens the white core.

**Hue hooks.**
- `micKick` → palette index step between cp1/cp2 each hit.
- `stemVocals` → hue hold on cp1 warm side while vocals sustain.

**Stage-specific notes.** Redwood uplighting group (`Redwoods1/2/3`, idx 204–221) sees nothing today. Operator view-mask: `RedwoodPARs` (bit 0x40). Gesture: sweep should *terminate* with a 1-frame full-redwood pop on each pass — currently zero energy reaches them.

---

### `79_mill_pressure_release.js` — **REWRITE**

**Visual.** Mild red-orange bloom on every pixel, with rare unsynchronized white flashes. No "pressure-build then release" arc readable from the playa; it just throbs.

**Artistic upgrades.**
- Replace `phase = tPhase*pressure*5 % 1` (saw) with an asymmetric envelope: `pow(phase, 4)` rise + `pow(1-phase, 0.5)` decay → reads as build → snap.
- Gate the vent flash at the saw boundary with a `prevPhase>phase` zero-crossing in `beforeRender`, not `phase>0.95` (currently fires ~5 frames in a row).
- Add a per-column phase offset (`hash(columnId)`) so towers vent at different beats — currently the rig flashes monolithic.
- Mix cp2 in on the heat tail, not as a duplicate of cp1.

**Audio reactivity (CPC).**
- `micLow` → `pressure` build rate (linear, ×0.5..3.0).
- `micKick` → forced vent (override saw to 1.0, single frame), bypass the natural cycle.
- `micHigh` → `heatBloom` shimmer (jitter on UV, ±0.2).

**Hue hooks.**
- `micKick` → flash white→cp2 (e.g., cyan) for 100 ms then back to cp1 warm.
- `stemBass` → hue drift cp1H by ±0.05 with bass energy.

**Stage-specific notes.** `viewMask & 2` (line 79) targets a non-existent mask bit — should be `& 0x40` for `RedwoodPARs`. Gesture: vent should be a top-down drip on the redwood columns (use `1-nz` envelope), reading as steam release.

---

### `80_canopy_fracture.js` — **POLISH**

**Visual.** UV-dominant with sporadic white "fracture" bursts that read as random noise rather than branching cracks. RGB barely on.

**Artistic upgrades.**
- The strike gate `wave(tPhase*2) > 1 - fractureAmount*0.1` fires for tiny windows — invert to `fractureAmount` controlling threshold directly (`> 1 - fractureAmount`) for usable strike density.
- Real branching: chain 3-4 strikes per gate firing along increasing `y` (per-tier `hash(y)`) within ~200 ms — reads as a crack propagating upward.
- Drop `wave()` for spatial noise and use `random(1)` seeded by `floor(tPhase*10) + index` so strikes don't crawl; they should snap.

**Audio reactivity (CPC).**
- `micHigh` → strike density (threshold offset, linear).
- `micKick` → guarantee one strike (forced gate open for 1 frame).

**Hue hooks.**
- `micKick` → palette rotate cp1 by 0.1 each hit.
- `micHigh` → desaturate toward white during cymbal washes.

**Stage-specific notes.** Stage: `RedwoodPARs` (bit 0x40) — restrict strikes to redwoods, let `TowerBars` carry a soft cp2 wash to set the "forest floor." Currently every fixture gets the same treatment.

---

### `81_outpost_distress_beacon.js` — **REWRITE — DO NOT LOAD FRIDAY**

**Visual.** Most pixels show nothing visible. White morse only fires where `viewMask & 1` matches, and red-amber response only fires on `viewMask & 4` — neither bit is a registered mask on this model. With default mask = 0 the pattern is dark except for UV.

**Artistic upgrades.**
- Replace bits 1 and 4 with the registered `0x40` (`RedwoodPARs`) for the response glow and `0x80` (`VintageOnly`) or `0` (everything) for the morse — pick whichever surface the operator wants the beacon on.
- The morse cycle (`tPhase*10`) is locked to `localSpeed` — decouple it: use a separate `morseT` accumulator at fixed 1.0 Hz so the SOS reads at constant cadence regardless of slider.
- Add directional sweep across receiving towers (offset by tower angle) so the beacon "reaches" listeners visibly.

**Audio reactivity (CPC).**
- `stemVocals` → `responseGlow` (linear, 0..1) — beacon answers when someone sings.
- `micKick` → blanket beacon flash on every kick (full white on towers, 80 ms).

**Hue hooks.**
- `micKick` → red flash on response group.
- `stemVocals` → blue hold on tower beacon while vocals sustain.

**Stage-specific notes.** Stage: split — beacon on `TowerVintageLights`/towers (mask 0 default), response on `RedwoodPARs` (bit 0x40). Currently broken: no pixel matches the AND tests as written. Do not load Friday without a soak test.

---

### `82_redwood_timber_fall.js` — **REWRITE**

**Visual.** A near-static dim wash; the "falling line" rarely intersects any pixel because the math compares world coords (x meters, y=3) to a unit wave. Most output is UV background.

**Artistic upgrades.**
- Critical bug: `x*cos(...) + y*sin(...) - wave(tPhase)` mixes world meters with a [0,1] wave — line never sweeps across visible space. Use `nx`/`nz` (`ny` is constant 0.777 here, useless) and a `wave()*1.0` line position.
- `y` is constant for towers (3.0) and constant for each redwood ring — `tiltAngle` collapses. Use `nz` (front→back stage axis) for the tilt second-axis.
- Add a falling-impact moment: when line crosses `nx≈0.5`, blast a full white flash for one frame ("timber hits ground").
- Both sides should differ visibly — currently `mix(pr1,pr2,side)*fallDepth` is dim either way; bump multiplier and/or add a dust-cloud UV swell on the post-fall side.

**Audio reactivity (CPC).**
- `micLow` → fall speed (`tPhase` rate, exp 0.3..3.0).
- `micKick` → trigger impact flash (Schmitt-gate, 100 ms hold).

**Hue hooks.**
- `micKick` → swap which palette is "fallen side" per hit (boolean toggle).
- `stemBass` → drift cp2H toward cooler ash tone on sustained sub.

**Stage-specific notes.** Stage: full model. View-mask: leave at 0 (all on) so the line sweeps across towers AND `RedwoodPARs` (`0x40`). Today the broken math means redwoods get pure UV and nothing else.

---

### `83_shadow_canopy_eclipse.js` — **REWRITE — DO NOT LOAD FRIDAY**

**Visual.** Constant near-full red cp1 wash, rare rim flash. The "eclipse disc" math sits at `(0.5±0.3, 0.5±0.3)` while fixtures live at world meters (x≈3..9 towers, y=3) — the disc never overlaps any pixel, so `inShadow=1.0` always.

**Artistic upgrades.**
- Same root bug as 82: use `nx`, `nz` not `x,y` (`y` is constant). Then the disc actually moves across the stage.
- `eclipseDepth` should be a *radius* in normalized space, default ~0.25; rim threshold scales with it (`±0.04*eclipseDepth`).
- Make the corona breathe: `coronaBloom * (0.5 + 0.5*sin(tPhase*PI2*4))` instead of static.
- Add an inverse: pixels inside the disc go cool (cp2), outside stay warm (cp1) — currently inside just dims cp1.

**Audio reactivity (CPC).**
- `micLow` → eclipse radius pulse (linear, ±0.1).
- `micKick` → rim flash full-white for one frame.
- `stemVocals` → corona intensity (linear).

**Hue hooks.**
- `micKick` → rim color rotates between cp1/cp2.
- `stemVocals` → hold blue/cyan rim on sustained vocal.

**Stage-specific notes.** Stage: `RedwoodPARs` (bit `0x40`) for the corona — the 18-PAR ring around the camp reads as the canopy edge. `viewMask & 2` at line 79 is a phantom mask bit. Do not load Friday — needs a normalized-coord rewrite first.

---

### `84_outpost_ember_overdrive.js` — **REWRITE — DO NOT LOAD FRIDAY**

**Visual.** Near-uniform red-orange wash with random hits of white sparkle. The `flame = wave(y*emberHeight - tPhase*...)` reads `y` which is **constant 3.0 for towers** and **constant 2.5 for Redwoods3** — flame motion collapses to a single global value, no upward travel.

**Artistic upgrades.**
- Must use `nz` (the z-axis varies through the rig) or pixel-index modulo to get spatial variation. `y` is dead.
- True ember rise: `flame = wave(nz*3 - tPhase*emberSpeed*4)` so it crawls along the redwood ring depth.
- Add per-pixel sparkle hash so embers detach (`random(1) < 0.005` with `cp2` flash) instead of `heatFlash`'s white-only.
- UV inverse currently floods full-bright at low flame — clamp to `min(0.4, 1-flame)` so it doesn't drown the warm.

**Audio reactivity (CPC).**
- `micLow` → `emberSpeed` (linear, 0.3..2.5).
- `micKick` → forced `heatFlash` (one-frame 1.0 white on random 30% of pixels).
- `micHigh` → sparkle density (linear, scales the random gate).

**Hue hooks.**
- `micKick` → palette rotate cp1 across warm range (0..0.08).
- `stemBass` → deepen cp1 toward blood-red on sustained sub.

**Stage-specific notes.** Stage: redwood uplighting (`RedwoodPARs`, bit `0x40`) — embers should look like rising heat through the trees, not on the towers. Apply the view-mask. Do not load Friday with the broken `y`-axis math.

---

### `85_redwood_starry_canopy.js` — **POLISH**

**Visual.** A horizontal sweep crosses tower bars with cp1↔cp2 mix; redwoods twinkle as occasional white stars. This is the **only** pattern in 78–85 that correctly tests the registered view-mask (`viewMask & 64` = `RedwoodPARs`). Reads cleanly from a distance — twinkles register.

**Artistic upgrades.**
- Star density `random(1) < 0.02*starBrightness` is fixed-rate; add a multi-period beat (`+ 0.01*sin(tPhase*PI2*7)`) so dense-vs-sparse phases naturally cycle.
- `sweep = wave(x + tPhase*5)` — `x` is world meters (3..9); normalize to `nx` for a clean full-stage sweep.
- `wallHit` channel `a` blooms entire towers at once — make it travel: `wave(nz + tPhase*2)` so the back-wall pulses ripple.
- Add a soft warm cp1 base on stars (currently pure white) so the canopy has color personality.

**Audio reactivity (CPC).**
- `micHigh` → star density (linear, scales the random gate).
- `micKick` → wallHit pulse on each kick (Schmitt, 150 ms decay).
- `micLow` → sweep speed on towers (linear, 0.5..2.5).

**Hue hooks.**
- `micKick` → rotate cp1 hue +0.05 each hit (gentle palette walk).
- `stemVocals` → hold cp2 cool on sustained vocal in the sweep mix.

**Stage-specific notes.** Stage: split — towers get the sweep, `RedwoodPARs` (bit `0x40`) get the stars. Already correctly routed. Best of the eight — polish then ship.

---

**Section 7.2 summary.** KEEP 0 · POLISH 2 (`80`, `85`) · REWRITE 6 (`78`, `79`, `81`, `82`, `83`, `84`). **DO NOT LOAD FRIDAY without test time:** `81_outpost_distress_beacon`, `83_shadow_canopy_eclipse`, `84_outpost_ember_overdrive` — all three have math that produces near-static or fully wrong output on the actual `summer_camp_logsville` model (wrong mask bits and/or world-vs-normalized coord mixing). View-mask used: `RedwoodPARs` (bit `0x40`, idx 204–221) per `marsin_engine/models/summer_camp_logsville.viewmasks.js:18`. Common gesture for the redwood group: vertical/depth-axis sweeps (`nz`), bottom-up uplighting envelopes (`1-z` or `1-nz`), and per-ring chase across the 3 Redwood groups (`Redwoods1/2/3`). Common root cause: every pattern uses world coords (`x`,`y`,`z` in meters) against unit-range math — must switch to `nx`/`nz` (note `ny` is constant 0.777, do not rely on it for vertical).

---

## 8. Stretch — 30 new pattern proposals (Designer)

15 fresh dome patterns + 15 fresh logsville patterns. Each proposal must include: name, one-paragraph visual, key MarsinScript math idea, CPC bindings, hue hooks, and stage-specific notes. Designer fills this section AFTER reviewer reports land so the proposals fill gaps the reviewers identify (don't duplicate existing strengths; cover missing aesthetics).

### 8.1 — Dome proposals (D1 – D15)

_Mood map (operator-scannable):_
- **Ambient washes (low energy, openers):** D1, D2, D3
- **Mid-energy textures (build-ups, melodic):** D4, D5, D6, D7, D8
- **High-energy peaks (drops):** D9, D10, D11, D12
- **Narrative / gesture reveals (transitions, identity moments):** D13, D14, D15

#### Ambient washes

#### D1 — `proposed_57_dome_lorenz_drift.js`

**One-line pitch.** "The dome is breathing in slow motion and I can't predict where it'll go next."

**Visual.** A wide, low-contrast cp1↔cp2 gradient that drifts diagonally across the rig at walking pace, with two warm cp2 hot-spots wandering on Lorenz orbits — they never re-cross the same point, so the wash feels alive without ever flashing. Vintage carries a sympathetic amber that warms whenever a hot-spot passes near the floor.

**Math idea.**
- Two Lorenz attractor states (σ=10, ρ=28, β=8/3) advanced with `dt = 1/60`; map `(x_L, z_L)` → `(nx, ny)` of two hot-spot centers.
- Background field = `wave(nx*0.7 + tA) * wave(ny*0.5 - tB)` with `tA/tB` advancing at φ-ratio (1 : 1.618).
- Hot-spot weight = `exp(-d² / falloff²)` per attractor; both modulated by sliders.
- No periodic terms in the attractor path — true non-repetition is the whole point.

**CPC bindings.**
- `micLow` → `falloff` (linear; bass blooms the hot-spots wider).
- `micKick` → Lorenz `dt` boost (envelope, 200 ms; each kick advances both attractors a frame extra — they "lurch").
- `stemsVocals` → background blend toward cp2 (linear; vocals warm the field).

**Hue hooks.**
- `micKick` → cp1H +0.012 per kick (slow palette walk over the set).
- `stemsVocals` → hold hue toward cp2 warm while vocals sustain.

**Stage gesture.** APEX dome-cap pulse: when either hot-spot enters `ny > 0.85` (the dome cap), force `Apex` brightness ×1.4. View-mask: `Apex` for solo, or full rig.

**Fills which gap.** Reviewer 1 / 3 / 4 called out "mathematically non-repeating motion" as missing across 00–25. Lorenz hot-spots = literally non-periodic.

---

#### D2 — `proposed_58_dome_caustic_pool.js`

**One-line pitch.** "It's a pool of water reflecting onto the underside of the dome."

**Visual.** Soft cyan/teal caustic ripples crawl across the rig as if the dome were a ceiling above a swimming pool. The "water" wanders slowly — bright filaments cross and decorrelate, never re-forming the same pattern. UV undertow gives the pool depth.

**Math idea.**
- 3 phase-decorrelated Worley/caustic kernels: `min(d1, d2, d3)` where each `dᵢ = circDist(nx, cx_i(t)) + circDist(ny, cy_i(t))`.
- `cx_i / cy_i` drift on irrational-frequency Lissajous: `(sin(t*1), sin(t*√2), sin(t*√3))`.
- Caustic = `pow(1 - min_d, 6)` (bright thin filaments where kernels meet).
- UV = `1 - caustic_intensity` (UV fills the dark zones).

**CPC bindings.**
- `micLow` → caustic sharpening exponent (linear, 6..10; bass crisps the filaments).
- `micHigh` → UV intensity (linear; hats sparkle the undertow).
- `stemsVocals` → cp2 weight in palette mix (linear; vocals warm the water).

**Hue hooks.**
- `micKick` → cp1H +0.015 (a tiny "ripple shifts the moon's color").
- `stemsBass` → bias cp2H toward deeper indigo on sustained sub.

**Stage gesture.** APEX as the "moon": when a kernel center passes `ny > 0.9`, that kernel's brightness ×1.6 — APEX reads as the brightest part of the pool's reflection. View-mask: `Apex` for the moon alone.

**Fills which gap.** R2/R3 noted absence of "granular textures." Caustics are granular by construction; no other 00–25 pattern produces them.

---

#### D3 — `proposed_59_dome_breath_constellation.js`

**One-line pitch.** "Quiet enough for a conversation, alive enough that no one looks away."

**Visual.** A near-still warm wash with ~12 slow-pulsing "stars" scattered across the dome — each star has its own breath period (multi-period beat 3:4:5:7), so the constellation glitters out of phase. Reads as bioluminescent plankton at rest.

**Math idea.**
- 12 fixed star positions sampled on a fibonacci-spiral lattice across `(nx, ny)`.
- Per-star phase `pᵢ = wave(t * (3,4,5,7,...)/12 + i*0.6180)`.
- Star = `exp(-d²/r²) * pᵢ^4`.
- Background = constant 0.06 cp1 (so the rig never reads "off").

**CPC bindings.**
- `micLow` → constant background lift (linear, 0.06..0.18; sub keeps the wash present).
- `micHigh` → star sharpness `pᵢ^4 → pᵢ^(4-2*micHigh)` (hats round the stars into glow).
- `micKick` → spawn one extra "shooting star" with a 600 ms life envelope (rare, beat-locked).

**Hue hooks.**
- `micKick` → flash one random star to pure cp2 for 200 ms (palette pop, not brightness pop).
- `stemsVocals` → hold the brightest 3 stars on cp2 warm during sustains.

**Stage gesture.** APEX-radial reveal: when a "shooting star" spawns, it travels from APEX outward along the nearest BarLights chain (drawn as a 200 ms streak). View-mask: `Apex` for stars-only opener.

**Fills which gap.** R1/R5 noted no "audience-mirroring sparse" pattern — this is the opener that doesn't fight quiet conversation but still rewards looking.

---

#### Mid-energy textures

#### D4 — `proposed_60_dome_curl_noise_field.js`

**One-line pitch.** "The light is being stirred."

**Visual.** A smoke-like vortex field driven by curl noise: streaks of cp1/cp2 wind through each other, with vintage warmth bleeding in the eddy centers. No straight lines, no repetition — pure fluid.

**Math idea.**
- Curl-noise vector field: `vx = ∂N/∂y, vy = -∂N/∂x` where `N = wave(nx*4 + tA)*wave(ny*4 + tB)`.
- Stream brightness = `|v|` (magnitude); palette blend = `atan2(vy, vx)/τ` mapped to cp1↔cp2.
- `tA, tB` advance at irrational ratio (1 : 1.272).
- Vintage gets `(1 - |v|)` so eddy centers warm.

**CPC bindings.**
- `micLow` → field scale (linear, 3..6; bass tightens the eddies).
- `micMid` → stream contrast `|v|^(1+micMid)` (mids crisp the streaks).
- `stemsDrums` → time advance rate (linear, 1×..1.6×).

**Hue hooks.**
- `micKick` → palette rotation +0.08 (one frame, decay).
- `stemsVocals` → bias palette atan2 mapping toward cp2.

**Stage gesture.** APEX dome-cap pulse: every kick, force one full curl-eddy to spawn at APEX center (`nx=0.5, ny=0.9`) and dissipate outward over 400 ms. View-mask: `Apex` for eddy-only solo.

**Fills which gap.** R2/R3 asked for "counter-rotating fields." Curl noise IS that, with mathematical non-repetition baked in.

---

#### D5 — `proposed_61_dome_de_jong_filaments.js`

**One-line pitch.** "Spirograph for grown-ups."

**Visual.** Thin strange-attractor filaments draw themselves across the dome and fade — the attractor's parameter set drifts on a slow Lissajous so the curves never freeze into one shape. Reads as fine-line generative art on the playa.

**Math idea.**
- De Jong attractor: `x_{n+1} = sin(a*y) - cos(b*x); y_{n+1} = sin(c*x) - cos(d*y)`.
- Parameters `(a,b,c,d)` slowly modulated by `(sin(t/30), cos(t/47), sin(t/53), cos(t/59))` — prime-second periods.
- Iterate 200 points per frame; accumulate brightness on nearest pixel with exponential decay between frames.
- Palette blend = orbit step modulo cp1↔cp2.

**CPC bindings.**
- `micMid` → iteration count (linear, 100..400; mids densify the curves).
- `micHigh` → decay time-constant (exponential, faster decay on hats; curves write/erase faster).
- `micKick` → parameter "jump" — adds 0.1 perturbation to `a` for one frame.

**Hue hooks.**
- `micKick` → cp1H +0.02 (filaments drift color over time).
- `stemsBass` → hold cp2H cooler.

**Stage gesture.** APEX gestural pivot: bias attractor iteration density so 30% of points land in the `Apex` mask region — the dome cap is the "ink well." View-mask: `Apex`.

**Fills which gap.** R1/R3 explicitly named "strange attractors" as desired. No current pattern uses one as the primary motion source.

---

#### D6 — `proposed_62_dome_typography_reveal.js`

**One-line pitch.** "Did the dome just say something?"

**Visual.** Over 8 seconds, the rig spells out a single short word/glyph (e.g. "TITANIC", "WELCOME", "HELLO", "BURN") in bright cp2 across the BarLights using bitmap stencils projected by pixel index; the letters dissolve back into a wash. Operator selects glyph via slider. Cycles silently between glyphs from a fixed pool.

**Math idea.**
- 5×7 bitmap font, mapped to `(barIndex, pixelIndexInBar)` for each BarLight chain.
- Glyph "writes on" with a vertical reveal line driven by `easeInOutCubic(t/8)`.
- Holds for 1.5 s, then dissolves via per-pixel noise threshold rising from 0..1.
- Between glyphs: 3 s of cp1 wash with jitter (`+0.05*wave(t*1.7)`).

**CPC bindings.**
- `micKick` → if kick fires during "hold" phase, flash whole glyph to white for 100 ms (palette punch).
- `stemsVocals` → during write phase, slow write rate when vocals are loud (the glyph "speaks" with the singer).
- `micLow` → background wash brightness between glyphs (linear).

**Hue hooks.**
- `micKick` → glyph color steps through cp1/cp2/mix on each new glyph cycle.
- `stemsVocals` → hold glyph on cp2 warm during sustain.

**Stage gesture.** APEX punctuation: between glyphs, fire a single Apex flash as a "cursor blink." View-mask: full rig (glyph reads on BarLights, APEX punctuates).

**Fills which gap.** R3/R4 called out "geometric reveals (typography/icons)" as completely absent. This is the welcome/narrative pattern the codex asks for ("be welcoming").

---

#### D7 — `proposed_63_dome_phyllotaxis_bloom.js`

**One-line pitch.** "A sunflower opening, but in light."

**Visual.** A spiraling phyllotaxis bloom unfolds from APEX outward across the rig, 137.5°-spaced "seeds" lighting up in golden-ratio order. Each seed pulses on a slow Lissajous, so the bloom never crystallizes into a frozen image. Vintage carries warm "pollen" amber on outer seeds.

**Math idea.**
- 144 virtual seeds: `θᵢ = i * 137.5°`, `rᵢ = sqrt(i)/12`. Map `(θᵢ, rᵢ)` from APEX origin to `(nx, ny)`.
- Seed brightness = `wave(t * 0.4 + i * 0.05)` (slow chase outward).
- Light per pixel = max over seeds: `exp(-pixelDist²/r²) * seedBright`.
- Bloom radius `r` modulated by slow secondary `wave(t/19)` — bloom breathes open/closed.

**CPC bindings.**
- `micMid` → bloom radius growth rate (linear; mids "open" the flower).
- `micKick` → light one extra-bright seed at the bloom front per kick (envelope 300 ms).
- `stemsBass` → pollen amber on vintage (linear).

**Hue hooks.**
- `micKick` → cp2H step +0.015 (pollen color drifts).
- `stemsVocals` → bias seed palette toward cp2 warm.

**Stage gesture.** APEX is the bloom origin — radial bloom from APEX is the literal gesture. View-mask: `Apex` for "bud-only", full rig for "open flower."

**Fills which gap.** R5 asked for "radial bloom from APEX." This is that gesture done as a non-repeating spiral, not a sine sweep.

---

#### D8 — `proposed_64_dome_fluid_torus_braid.js`

**One-line pitch.** "Two ribbons rolling around the dome, never quite meeting."

**Visual.** Two cp1/cp2 ribbon strands wind around the rig on counter-rotating toroidal paths, each with its own irrational period. Where they cross, a brief white flash. Reads as a slow, elegant DNA helix.

**Math idea.**
- Ribbon A center: `(nx_A(t), ny_A(t)) = (0.5 + 0.4*sin(t/3.7), 0.5 + 0.3*cos(t/5.9))`.
- Ribbon B center: `(0.5 + 0.4*sin(-t/4.3 + π/3), 0.5 + 0.3*cos(-t/7.1))` — irrational ratios, counter-rotating.
- Ribbon brightness = `exp(-d²/w²)` where `d` is pixel distance to nearest ribbon path point (sampled on 24 anchor points per ribbon).
- Cross detection: when `|A_center - B_center| < 0.08`, fire white sparkle envelope 300 ms.

**CPC bindings.**
- `micLow` → ribbon width `w` (linear; bass fattens the braid).
- `micKick` → cross-flash threshold widens (envelope 200 ms; kicks force more crossings).
- `stemsDrums` → time-advance speed (linear).

**Hue hooks.**
- Each cross → cp1/cp2 swap on the next cross event (palette flip every collision).
- `stemsVocals` → bias ribbon A toward cp2 warm.

**Stage gesture.** APEX-terminating sweep: bias both ribbon paths to pass through APEX every ~9 seconds — the rig reads "two streams converging on the dome cap." View-mask: full rig.

**Fills which gap.** R5/R6 noted "counter-rotating fields" missing. R3 explicitly: irrational frequency ratios.

---

#### High-energy peaks

#### D9 — `proposed_65_dome_kick_shockwave.js`

**One-line pitch.** "Every kick visibly shoves the dome outward."

**Visual.** Sits as a dark cp1 wash. On each `micKick`, a bright cp2 shockwave ring expands from APEX across the rig and decays in 600 ms — the rig literally breathes outward on the beat. Up to 4 simultaneous rings (stacked from rapid kicks).

**Math idea.**
- Ring-buffer of last 4 kick events, each with `tStart`.
- For each ring: `r(t) = (now - tStart) * speed`; brightness = `exp(-(d - r)² / thickness²) * decay(t)`.
- `d` = `sqrt((nx-0.5)² + (ny-0.9)²)` (distance from APEX origin).
- `decay(t) = exp(-(now - tStart)/0.6)`.

**CPC bindings.**
- `micKick` → spawn ring (Schmitt + ring-buffer push).
- `micLow` → background cp1 brightness floor (linear, 0.04..0.25).
- `stemsBass` → ring speed (linear, 0.8..1.4×; heavy sub = faster shockwaves).

**Hue hooks.**
- Each ring → palette index step (ring 1 = cp2, ring 2 = cp1, ring 3 = mix, etc. — rainbow stacking).
- `stemsVocals` → background hue holds at cp2 warm.

**Stage gesture.** APEX *is* the origin — every shockwave starts at the dome cap. View-mask: `Apex` for tight-tight-tight rapid-fire, full rig for the expanding wave.

**Fills which gap.** R1/R2/R5 all noted "audio reactivity" as the #1 gap. This pattern *is* a kick visualizer — operator gets immediate beat-locked feedback at full intensity.

---

#### D10 — `proposed_66_dome_particle_rain.js`

**One-line pitch.** "It's raining color."

**Visual.** ~40 particle "drops" fall from the top of the dome to the perimeter, with comet tails. Each drop has its own spawn time, fall speed (jittered), and color (cp1/cp2 alternating). On kicks, a 10-drop burst spawns.

**Math idea.**
- Particle pool of 60; each has `(spawnT, lane, speed, color, lifeT)`.
- Position = `ny_drop = 1.0 - ((now - spawnT) * speed * 0.3)`; recycle when `ny_drop < 0`.
- `lane` = `nx` in [0,1], jittered per spawn.
- Tail: brightness at pixel = `exp(-(nx - lane)² / 0.0005) * exp(-(ny - ny_drop) / tailLen)` (clamped to `ny < ny_drop`, so tail trails upward).

**CPC bindings.**
- `micKick` → spawn 8-drop burst at top (with hue from cp2).
- `micLow` → tail length (linear; bass elongates trails).
- `micHigh` → spawn rate baseline (linear; hats accelerate rain).

**Hue hooks.**
- `micKick` → spawned-burst drops all use cp2 for 600 ms; subsequent baseline drops return to alternating.
- `stemsVocals` → hold all drops cp2-biased while sustained.

**Stage gesture.** Top-down rain originates above APEX (`ny=1.0`) and falls to perimeter — APEX is the "rain cloud." View-mask: full rig.

**Fills which gap.** R3/R4 named "particle rains" as under-represented. This is the canonical version.

---

#### D11 — `proposed_67_dome_strobe_lattice.js`

**One-line pitch.** "Disciplined strobing — feels like the drop, not like a seizure."

**Visual.** On the drop, a 4×6 cp2 lattice pulses *at exactly the kick rate*, with phase-decorrelated lattice cells (each cell gates on `micKick` AND its own per-cell phase wave > 0.6) so half the lattice flashes per kick — never the whole rig at once.

**Math idea.**
- Grid cells: `cellX = floor(nx * 4)`, `cellY = floor(ny * 6)`, `cellId = cellY*4 + cellX`.
- Per-cell phase: `cellPhase = wave(t * 0.5 + cellId * 0.382)`.
- Cell active = `micKick_env * (cellPhase > 0.5 ? 1 : 0)` (boolean per cell, not per pixel).
- Background = cp1 at 0.15 floor (never goes dark — codex: kindness, no strobe panic).

**CPC bindings.**
- `micKick` → cell-gate trigger (Schmitt, 100 ms envelope per cell).
- `micLow` → background floor (linear, 0.15..0.35).
- `stemsDrums` → cell rotation rate (linear; drums shift which cells are armed).

**Hue hooks.**
- `micKick` → odd cells = cp1, even cells = cp2 (checkerboard palette).
- `stemsVocals` → background hue holds cp2 warm.

**Stage gesture.** APEX cell prioritized: when kick fires, the APEX-region cell ALWAYS flashes (in addition to the phase-gated others) — APEX is the kick-confirmer. View-mask: `Apex` for clean "kick-only" version.

**Fills which gap.** R2/R5 noted no high-energy drop pattern. This is operator-controllable strobe with codex-aware floor (never goes black, never strobes whole rig).

---

#### D12 — `proposed_68_dome_chromatic_explosion.js`

**One-line pitch.** "The whole dome detonates on the drop."

**Visual.** On a `micKick` *gated to threshold > 0.85* (so only big hits trigger), the rig fires a 1.2-second multi-stage explosion: 100 ms white flash at APEX → 300 ms cp1 ring outward → 800 ms multicolor sparkle decay across the perimeter. Between explosions, sits at a low cp1 ember wash.

**Math idea.**
- Event-driven state machine: `idle → flash → ring → sparkle → idle`, triggered on threshold-crossed `micKick`.
- `flash`: `Apex` group at brightness 1.0, white channel high.
- `ring`: cp1 ring `exp(-(d - r)²/w²)` from APEX, `r(t)` linear 0..1 over 300 ms.
- `sparkle`: 200 random pixels lit per frame, hue = `wave(pixelIdx * 0.7 + t * 3)` mod 1 → maps to cp1↔cp2.

**CPC bindings.**
- `micKick > 0.85` → state machine trigger.
- `micLow` → ember wash brightness (linear, 0.04..0.18).
- `stemsBass` → ring expansion speed (linear).

**Hue hooks.**
- Each explosion → cp1H/cp2H both step +0.05 (palette drift over the show).
- `stemsVocals` → ember hue holds cp2 warm.

**Stage gesture.** APEX is the detonation origin. View-mask: full rig (entire purpose is full-rig impact).

**Fills which gap.** R5/R6 wanted "narrative reveals timed to track structure" — the gated threshold means this only fires on actual drops, not every kick. Operator-meaningful punctuation.

---

#### Narrative / gesture reveals

#### D13 — `proposed_69_dome_apex_lighthouse.js`

**One-line pitch.** "There's a lighthouse on top of the dome and it's watching the playa."

**Visual.** APEX projects a single rotating cp2 "beam" outward (visualized by lighting the BarLights perimeter in a narrow angular wedge that sweeps around the dome). Slow, steady, hypnotic. UV trail behind the beam. Vintage carries amber "shore" wash.

**Math idea.**
- Beam angle: `θ_beam(t) = t * 0.13` (slow sweep, ~48 s per rotation; tunable).
- Pixel angle: `θ_p = atan2(z, x)` (per pixel).
- Wedge brightness = `exp(-circDist(θ_p, θ_beam)² / wedgeWidth²)`.
- UV trail = `exp(-circDist(θ_p, θ_beam - 0.3)² / wedgeWidth²) * 0.4` (UV-only channel).

**CPC bindings.**
- `micKick` → wedge brightness pulse (envelope 200 ms; kicks "blink" the lighthouse).
- `stemsDrums` → rotation speed (linear, 0.8×..2×).
- `micLow` → wedge width (linear; bass widens the beam).

**Hue hooks.**
- `micKick` → cp2H +0.02 per beam rotation (color drift each cycle).
- `stemsVocals` → hold UV trail brighter during sustains (warm vocal = bright trail).

**Stage gesture.** APEX as the lighthouse source — `TrianglePars` carry the bright lamp head, beam sweeps across BarLights perimeter. View-mask: `Apex` for lamp-only, full rig for sweep.

**Fills which gap.** R5 wanted "sweep terminating at APEX" — this inverts: APEX *originates* the sweep. Different narrative.

---

#### D14 — `proposed_70_dome_iris_open.js`

**One-line pitch.** "The dome's eye is opening."

**Visual.** Starts fully dark. Over 6 seconds, an "iris" opens from APEX outward: cp2 inner ring (the pupil edge) expanding, with the area inside the ring lit cp1 (the iris). Holds open with a faint shimmer for 4 seconds, then closes in 6 seconds. Used as a transition / reveal cue.

**Math idea.**
- Cycle phase `p(t) = (t % 16) / 16`. Map to ease curves: open (0..0.375) → hold (0.375..0.625) → close (0.625..1).
- Iris radius `r(p)` = piecewise eased: open `easeOutCubic`, hold `1.0 + 0.05*wave(t*0.7)`, close `easeInCubic`.
- Pupil edge = `exp(-(d - r)² / 0.04²)` * cp2.
- Iris interior = `(d < r) ? cp1 * 0.4 : 0`.
- `d` = distance from APEX origin in `(nx, ny)` space.

**CPC bindings.**
- `micKick` → during hold phase, iris "blinks" (radius momentarily shrinks to 0.5 and bounces back over 200 ms).
- `micLow` → hold-phase shimmer amplitude (linear; sub makes the iris quiver).
- `stemsVocals` → eased curve gentler (slower) when vocals sustain.

**Hue hooks.**
- `micKick` → pupil-edge cp2 flashes brighter during blink.
- `stemsVocals` → iris cp1 holds warmer.

**Stage gesture.** Iris originates from APEX — this is the canonical APEX dome-cap reveal. View-mask: `Apex` for pupil-only, full rig for iris.

**Fills which gap.** R6/R8 wanted "narrative reveals" — this is one with a clear emotional arc (opening eye = welcome gesture; codex: be welcoming).

---

#### D15 — `proposed_71_dome_audience_mirror.js`

**One-line pitch.** "The dome breathes with the crowd."

**Visual.** A slow ambient cp1 wash whose brightness, density, and color tilt are driven *almost entirely by the live audio envelope* (no internal oscillator) — when the crowd cheers (`micMid` spikes), the rig brightens and warms; when the music drops out, the rig dims to a quiet ember. The dome is literally a mirror of the room.

**Math idea.**
- Pure CPC-driven: brightness = `0.08 + 0.5*micLow_smoothed + 0.3*micMid_smoothed`.
- Color tilt: `palette_blend = sigmoid((micMid_smoothed - micLow_smoothed) * 3)` — when mids dominate (vocals/cheers), warm; when lows dominate (sub), cool.
- Density (number of visible "ember" hot-spots): `floor(8 + micHigh_smoothed * 24)`.
- Smoothing: 1-pole low-pass with 0.5 s tau on all signals (so the rig doesn't twitch on individual hits).
- A tiny `0.03 * wave(t*0.7)` jitter just to avoid dead pixels at silence.

**CPC bindings.**
- `micLow` → brightness floor (linear, smoothed).
- `micMid` → palette blend (sigmoid, smoothed).
- `micHigh` → ember density (linear, smoothed).
- `micKick` → momentary +0.15 brightness burst (250 ms decay) — kicks register but don't dominate.

**Hue hooks.**
- `stemsVocals` → palette bias hard toward cp2 warm.
- `stemsBass` → palette bias toward cp1 cool.

**Stage gesture.** APEX gets +20% brightness lift on every gesture — APEX is always the "head" of the breathing. View-mask: full rig (this is the social pattern, not the focal pattern).

**Fills which gap.** R5/R6 named "audience-mirroring patterns" as missing. Codex: be welcoming. This pattern says "we see you."

---

### 8.2 — Logsville proposals (L1 – L15)

_Mood map (operator-scannable):_
- **Ambient washes (low energy, openers):** L1, L2, L3
- **Forest textures (mid energy, melodic):** L4, L5, L6, L7
- **High-energy peaks (drops):** L8, L9, L10, L11
- **Tower-and-tree narrative reveals:** L12, L13, L14, L15

_Note on coords: per R7/R8, all redwood and tower-bar pixels share `y=3` and `ny=0.777`. All vertical/depth motion below uses `nz` (redwoods range `nz≈0.78..1.0`, tower bars `nz≈0.27..0.42`), per-fixture index (Redwoods1/2/3 → 3 angular rings), or wall-vs-tower split. The Redwood PARs form three 6-PAR hex rings at distinct `nx` clusters — so `nx` + group-id give natural "tree" identity for chase gestures._

#### Ambient washes

#### L1 — `proposed_86_logsville_forest_dawn.js`

**One-line pitch.** "Sunrise through the redwoods, very slowly."

**Visual.** Walls glow pre-dawn cool blue (cp1). Tower bars hold a slate gray-purple. Redwoods, ranked back-to-front by `nz`, light up in sequence — `Redwoods3` (back) → `Redwoods1` → `Redwoods2` — each transitioning from cool cp1 to warm cp2 over ~30 seconds, simulating sunrise. Vintage filaments warm last.

**Math idea.**
- Global sunrise phase `s(t) = (t % 90) / 90`.
- Per-group offset: `Redwoods3` at `s`, `Redwoods1` at `s - 0.2`, `Redwoods2` at `s - 0.4` (clamp).
- Per-PAR within group: `wave(s + fixtureIdx * 0.05)` modulates the warm-up envelope.
- Each redwood color = `lerp(cp1, cp2, easeInOutCubic(local_s))`.
- Walls track global `s` with no per-position offset.

**CPC bindings.**
- `micLow` → sunrise rate boost (linear, 1×..1.5×; bass speeds dawn).
- `stemsVocals` → cp2 warmth multiplier (linear; vocals = warmer dawn).
- `micKick` → momentarily flash one random redwood to white (envelope 200 ms; sparrow-call).

**Hue hooks.**
- `stemsVocals` → bias cp2H toward gold during sustain.
- `micKick` → cp2H +0.005 per kick (color creeps over set).

**Stage gesture.** Root-to-canopy via group sequencing (Redwoods3 back-row first → forward) + UV-only on RedwoodPARs in pre-dawn. View-mask: `RedwoodPARs` for solo redwood reveal.

**Fills which gap.** R7 called for "root-to-canopy sweep on `nz`" but noted current patterns abuse `y`. This is a depth-axis reveal done via `nz` + group ordering.

---

#### L2 — `proposed_87_logsville_river_drift.js`

**One-line pitch.** "A slow stream of light moving past the camp."

**Visual.** Wall vintages carry a slow horizontal cp1↔cp2 wave (~one full cycle every 12 s) that reads as a river flowing left-to-right behind the camp. Tower bars catch the wave as it passes through camp center. Redwoods get faint UV reflection.

**Math idea.**
- `nx`-driven wave: `w = wave(nx*1.3 - t*0.083 + 0.05*wave(t*0.13))` with Lissajous jitter on the phase.
- Walls: brightness = `w`; palette = `lerp(cp1, cp2, w)`.
- Towers: same `w` evaluated at tower `nx` (~0.45..0.56); local brightness +0.2 to lift towers above walls.
- Redwoods: `u = w * 0.4` on UV channel only (reflection).

**CPC bindings.**
- `micLow` → wave amplitude (linear; bass makes the river roar).
- `micMid` → wave speed (linear, 0.5×..1.5×).
- `stemsVocals` → redwood UV reflection brightness (linear).

**Hue hooks.**
- `micKick` → cp1H -0.02 (cool dip — like a stone splashing).
- `stemsBass` → hold cp2H toward deep amber on sustain.

**Stage gesture.** Vertical wash on RedwoodPARs comes from the UV reflection only (subtle). View-mask: `VintageOnly` for "river-only" opener.

**Fills which gap.** R7 noted no clean ambient pattern that respects the y=3 flat constraint. This one uses `nx` (which actually varies) for the gesture.

---

#### L3 — `proposed_88_logsville_canopy_starfield.js`

**One-line pitch.** "Look up — there are stars in the trees."

**Visual.** Sits dark/dim. Redwoods (top of the visual frame) twinkle as ~20 quiet star pulses per PAR over a slow rotation — multi-period beat so the twinkles never sync. Wall vintages hold a deep cp1 forest-floor wash. Tower bars are nearly off.

**Math idea.**
- Per-PAR twinkle: `s_i = wave(t * φ + i * 0.3819) * wave(t * φ² + i * 0.618)` (golden-ratio product → non-repeating).
- Twinkle threshold: pixel on iff `s_i > 0.85`.
- Brightness when on = `(s_i - 0.85) / 0.15 * cp2_white`.
- Wall floor = constant 0.04 cp1.

**CPC bindings.**
- `micHigh` → twinkle threshold lowered (linear, 0.85..0.65; hats add stars).
- `micLow` → wall floor (linear, 0.04..0.2).
- `micKick` → spawn one bright star burst on random redwood (envelope 400 ms).

**Hue hooks.**
- `micKick` → cp2H +0.01 per kick (star color drifts).
- `stemsVocals` → bias star color toward cp2 gold on sustain.

**Stage gesture.** Pure RedwoodPARs gesture — the redwoods *are* the canopy. View-mask: `RedwoodPARs` for star-only, full rig with floor.

**Fills which gap.** R7/R8 noted no quiet "canopy" pattern that uses the redwoods as their identity, not as bonus pixels.

---

#### Forest textures

#### L4 — `proposed_89_logsville_redwood_ring_chase.js`

**One-line pitch.** "The trees are talking to each other."

**Visual.** Each redwood group (Redwoods1/2/3) is a 6-PAR ring. A bright cp2 "head" chases around each ring at its own irrational speed; rings rotate counter to each other. Reads as three carousels turning in the trees. Tower bars hold a quiet cp1 base.

**Math idea.**
- Per-group rotation: `θ_g(t) = t * speed_g` where `speed_1 = 0.5, speed_2 = -0.5/√2, speed_3 = 0.5/√3` (irrational ratios).
- Per-PAR angle within group: `φ_i = (fixtureIdxInGroup / 6) * τ`.
- PAR brightness = `exp(-circDist(φ_i, θ_g % τ)² / w²)` (head + falloff around ring).
- Trail: `+ 0.4 * exp(-circDist(φ_i, θ_g % τ - 0.3)² / w²)`.

**CPC bindings.**
- `micLow` → ring head width (linear; bass fattens heads).
- `stemsDrums` → all rotation speeds ×1..1.6 (linear).
- `micKick` → instantaneous +0.5 brightness on whichever PAR is closest to head (envelope 150 ms).

**Hue hooks.**
- `micKick` → cp2H rotates +0.025 per kick.
- `stemsVocals` → trail brighter, longer on sustain.

**Stage gesture.** Alternating-column chase across 3 groups (counter-rotating). View-mask: `RedwoodPARs` for trees-solo.

**Fills which gap.** R7 explicitly asked for "alternating-column chase." This uses per-group rotation in opposite directions — operator reads three trees in dialogue.

---

#### L5 — `proposed_90_logsville_grove_breath.js`

**One-line pitch.** "The forest is asleep and breathing."

**Visual.** Whole rig swells gently in cp1↔cp2 with a long ~8 s breath. Per-fixture phase offsets (golden-ratio jittered) mean walls breathe slightly out of sync with towers, which are slightly out of sync with redwoods — the forest never inhales in unison.

**Math idea.**
- Global breath: `b(t) = pow(wave(t / 8), 2)` (asymmetric: slow rise, slow fall).
- Per-fixture offset: `δ_i = (fixtureIdx * 0.618) % 1`.
- Local breath: `b_i = pow(wave(t/8 + δ_i * 0.15), 2)`.
- Brightness = `0.1 + 0.7 * b_i`; palette blend = `b_i`.

**CPC bindings.**
- `micLow` → breath depth (linear; bass deepens the inhale).
- `micKick` → momentary +0.2 brightness on a random redwood (envelope 300 ms; "a creature stirs").
- `stemsVocals` → breath rate ×0.7..1.3 (linear, smoothed; rig breathes with the singer).

**Hue hooks.**
- `stemsVocals` → hold palette toward cp2 warm on sustain.
- `micKick` → cp2H +0.012 per kick (slow walk).

**Stage gesture.** Vertical wash: walls (low ny=0..0.29) breathe slightly earlier than towers (mid) than redwoods (back of stage at high nz). Uses `nz` as the proxy for verticality. View-mask: full rig.

**Fills which gap.** R7/R8 wanted "vertical wash" without abusing flat `y`. This uses per-fixture-id phase offset + wall→tower→redwood ordering.

---

#### L6 — `proposed_91_logsville_woodgrain_streaks.js`

**One-line pitch.** "Wood grain texture, alive."

**Visual.** Long, slow, irregular cp1/cp2 streaks crawl horizontally across the wall vintages (mimicking wood grain). Tower bars catch the streaks as they pass overhead. Redwoods carry a steady warm hold.

**Math idea.**
- Two streak fields: `f1 = wave(nx * 8.3 + t*0.13)`, `f2 = wave(nx * 5.7 - t*0.083 + ny*1.1)`.
- Combined: `g = pow(f1 * f2, 1.5)` — narrow streaks where both fields peak.
- Palette blend = `wave(nx*2 + t*0.05)` (slow color-band slide).

**CPC bindings.**
- `micMid` → streak sharpness exponent (linear, 1.5..3.0; mids crisp grain).
- `micLow` → streak count (linear; bass thickens grain).
- `stemsVocals` → redwood warm hold brightness (linear).

**Hue hooks.**
- `micKick` → cp1H +0.01 per kick (slow palette drift).
- `stemsBass` → bias cp2H to deeper amber.

**Stage gesture.** Vintage-only solo for the grain reveal. View-mask: `VintageOnly`.

**Fills which gap.** R8 noted no "granular wood texture" — this is the structural identity of the venue rendered in light.

---

#### L7 — `proposed_92_logsville_fireflies.js`

**One-line pitch.** "Fireflies in the grove."

**Visual.** ~25 firefly "dots" wander randomly around the wall vintages, occasionally drifting up to a tower bar or out to a redwood. Each firefly has its own slow Lissajous path; they flicker on/off with multi-period beats so the swarm never stabilizes.

**Math idea.**
- 25 firefly states: `(x_i(t), y_i(t), on_i(t))`.
- Position: `x_i = 0.5 + 0.45*sin(t*ωxᵢ + φxᵢ)`, `y_i = 0.3 + 0.25*sin(t*ωyᵢ + φyᵢ)` where `ω` and `φ` are pre-generated irrational.
- `on_i = wave(t * ωlife_i) > 0.6 ? 1 : 0` with rise/fall envelope.
- Pixel brightness = `Σᵢ on_i * exp(-d_i² / r²) * cp2_warm`.

**CPC bindings.**
- `micHigh` → firefly count (linear, 15..40).
- `micKick` → boost `on_i` for all currently-off fireflies for 200 ms.
- `stemsVocals` → firefly glow warmth (linear).

**Hue hooks.**
- `micKick` → cp2H +0.008 per kick.
- `stemsBass` → background ambient cools.

**Stage gesture.** Some fireflies prefer to land on redwoods (bias 30% of paths toward `nx > 0.78` zone) — RedwoodPARs occasionally flicker. View-mask: full rig.

**Fills which gap.** R7/R8 noted no "small particles" texture. This is the canonical firefly pattern with non-repeating motion.

---

#### High-energy peaks

#### L8 — `proposed_93_logsville_redwood_drop_strike.js`

**One-line pitch.** "On the drop, lightning strikes every tree."

**Visual.** Sits dark. On `micKick > 0.85`, the three redwood groups fire in sequence (3, 1, 2) at 80 ms intervals: each group's 6 PARs flash white, dim to cp2, then dim to cp1 over 800 ms. Tower bars carry the cp2 afterglow.

**Math idea.**
- Event-driven: kick-threshold triggers state machine.
- Per-group delay: `delay_3 = 0, delay_1 = 0.08, delay_2 = 0.16`.
- Per-group envelope: `e(t - delay_g) = exp(-(t - delay_g)² / 0.05²)` for the flash, then exponential decay to baseline.
- Color = `white * env_flash + cp2 * env_warm + cp1 * (1 - env_warm)`.

**CPC bindings.**
- `micKick > 0.85` → event trigger.
- `micLow` → tower afterglow brightness (linear).
- `stemsBass` → strike speed multiplier (linear; heavy sub = faster cascade).

**Hue hooks.**
- Each strike → cp2H +0.02 (color drifts each event).
- `stemsVocals` → tower afterglow holds longer.

**Stage gesture.** RedwoodPARs is the strike target — three trees lit in sequence is the literal gesture. View-mask: `RedwoodPARs`.

**Fills which gap.** R7/R8: every pattern in 70–85 either ignores redwoods or breaks on them. This makes the redwoods *the show*.

---

#### L9 — `proposed_94_logsville_tower_pulse_pillar.js`

**One-line pitch.** "Two columns of pure energy on either side of the stage."

**Visual.** Tower bars pulse hard cp2 on every kick — full-tower brightness flash, 100 ms attack, 400 ms decay. Walls remain quiet cp1 wash. Redwoods carry a sympathetic dimmer cp1 pulse.

**Math idea.**
- Tower pulse: `tp(t) = exp(-(t - lastKick) / 0.4)` (decay envelope, reset on kick).
- Tower brightness = `0.1 + 0.9 * tp`; color = `lerp(cp1, cp2, tp)`.
- Wall: `wave(t * 0.07 + nx*1.2) * 0.25` (gentle background).
- Redwoods: `tp * 0.5` (sympathetic pulse, dimmer).

**CPC bindings.**
- `micKick` → reset `lastKick` (Schmitt gated).
- `micLow` → tower base floor (linear; sub keeps towers glowing between kicks).
- `stemsBass` → decay time constant (linear, 0.2..0.6 s; heavy sub = longer afterglow).

**Hue hooks.**
- `micKick` → cp2H +0.015 per kick.
- `stemsVocals` → wall hue holds cp2 warm.

**Stage gesture.** Tower bars are the stage's flanking pillars — they pulse on every beat. View-mask: full rig (towers carry the kick, walls/redwoods support).

**Fills which gap.** R7/R8 noted no clear tower-led pattern. This makes tower bars the kick visualizer.

---

#### L10 — `proposed_95_logsville_grove_strobe_breath.js`

**One-line pitch.** "All eighteen tree-lights flashing in disciplined patterns."

**Visual.** On the drop, RedwoodPARs strobe at the kick rate — but each of the 3 groups strobes a different subset: Redwoods1 flashes on kicks 1,4,7..., Redwoods2 on 2,5,8..., Redwoods3 on 3,6,9.... Result: every kick lights ONE group, polyrhythmic 1/3 cadence. Walls hold a quiet cp1 floor.

**Math idea.**
- Kick counter `n` increments on each `micKick`.
- Active group `g = n % 3`.
- Group brightness = `exp(-(t - lastKick) / 0.25)` for active group only; others = 0 (or low floor).
- Walls = `0.08 + 0.04*wave(t*0.5)`.

**CPC bindings.**
- `micKick` → counter increment + envelope reset.
- `micLow` → wall floor (linear).
- `stemsDrums` → flash decay time (linear).

**Hue hooks.**
- Group 0 = cp2; group 1 = cp1; group 2 = mix (cycling).
- `stemsVocals` → wall hue holds cp2 warm.

**Stage gesture.** Polyrhythmic alternating-column on RedwoodPARs. View-mask: `RedwoodPARs` for tree-only.

**Fills which gap.** R7's "alternating-column chase" gap, with rhythmic discipline (no random strobe — every kick is allocated to one group deterministically).

---

#### L11 — `proposed_96_logsville_ember_storm.js`

**One-line pitch.** "Sparks from a bonfire blowing across the camp."

**Visual.** Wall vintages flicker amber/red embers at high density. Tower bars carry occasional bright "spark" particles that streak through and dissipate. Redwoods light up briefly when sparks land nearby.

**Math idea.**
- Wall ember: 1/f-style noise mix `wave(t*1.7 + idx*0.3) * wave(t*2.3 + idx*0.7)`; cubed for sharpness.
- Spark events: pool of 8 particles, spawn on `micKick`, each with `(spawnT, lane, height, speed)`.
- Particle position: `nx_p(t) = lane + (t - spawnT) * speed`; `ny_p(t) = (t - spawnT) * fallRate`.
- Redwood "land" trigger: when any spark `nx_p > 0.78`, the nearest redwood flares cp2 white for 200 ms.

**CPC bindings.**
- `micLow` → ember intensity (linear).
- `micKick` → spawn 2-spark burst.
- `micHigh` → spark count cap (linear, 4..12).

**Hue hooks.**
- `micKick` → ember H +0.005.
- `stemsBass` → push embers toward deep red on sustain.

**Stage gesture.** Sparks travel across the rig and "land" on redwoods — natural full-rig sweep that terminates with a redwood flare. View-mask: full rig.

**Fills which gap.** R7/R8 noted "bonfire" themes missing for the camp identity. This is high-energy fire that uses every fixture group purposefully.

---

#### Tower-and-tree narrative reveals

#### L12 — `proposed_97_logsville_morse_woodknock.js`

**One-line pitch.** "Knocking on the tree trunks in time with the song."

**Visual.** Redwoods fire short cp2 "knocks" — 80 ms flash + 400 ms decay — at the kick rate, but only ONE PAR fires per knock (cycling through all 18 PARs in a deterministic non-monotonic order). Reads as someone walking around the grove knocking on different trees. Walls hold quiet cp1 backdrop.

**Math idea.**
- Knock index increments per `micKick`: `k = kickCounter`.
- Active PAR = `(k * 7) % 18` (irrational-ish stride; visits all 18 before repeating).
- Active PAR brightness = `exp(-(t - lastKick) / 0.4) * cp2_white`.
- Background = 0.05 cp1 on all PARs.

**CPC bindings.**
- `micKick` → counter increment + envelope reset.
- `micMid` → knock decay time (linear).
- `stemsVocals` → background cp1 brightness (linear).

**Hue hooks.**
- Each knock → cp2H +0.02.
- `stemsBass` → background cools.

**Stage gesture.** RedwoodPARs gesture — each individual tree gets its own moment. View-mask: `RedwoodPARs`.

**Fills which gap.** R7/R8: no pattern that addresses individual PAR identity. The audience can track "which tree is knocked next."

---

#### L13 — `proposed_98_logsville_treeline_typography.js`

**One-line pitch.** "The trees spell something."

**Visual.** RedwoodPARs treated as an 18-pixel display: a slow-scrolling text/glyph reads across the redwoods (e.g. "WELCOME TO LOGSVILLE") with each PAR as one column. Towers carry a sympathetic shimmer; walls hold a cp1 floor.

**Math idea.**
- 5×7 bitmap font; characters stored as bit-arrays.
- Scroll position `s(t) = t * scrollSpeed`.
- Per-PAR bitmap column index = `floor(s + parIdx)`.
- PAR rgb = `bitmap[col] ? cp2 : cp1*0.3`.
- Since `ny` is flat across PARs, only one "row" is visible — render the middle row (y=3 of 7) of each character.

**CPC bindings.**
- `micKick` → palette flash (one frame full-white on every "on" pixel).
- `stemsVocals` → scroll speed slows during vocal sustain (rig "speaks slower").
- `micLow` → tower shimmer brightness (linear).

**Hue hooks.**
- `micKick` → cp2H step +0.02 per word boundary.
- `stemsVocals` → cp2H holds gold during sustain.

**Stage gesture.** RedwoodPARs as a typography display — codex: be welcoming, literally. View-mask: `RedwoodPARs`.

**Fills which gap.** R3/R4/R8 noted "typography / iconography" absent. The redwood ring is naturally a 1-row 18-column display.

**Implementation prerequisite.** Only 1 row visible per character (since redwoods are not stacked vertically) — operator should choose blocky/simple glyphs, or the design becomes a 1-bit scroller.

---

#### L14 — `proposed_99_logsville_canopy_eclipse_redux.js`

**One-line pitch.** "An eclipse rolls across the canopy and the camp goes quiet."

**Visual.** A "shadow" disc travels from one side of the rig to the other over ~20 seconds (using `nx` as the world axis). Pixels inside the shadow dim cp1 deep cool; pixels outside hold warm cp2. As the shadow passes redwoods, those PARs darken in turn. Towers go quiet during eclipse peak.

**Math idea.**
- Shadow center: `cx(t) = (t % 24) / 24` (sweeps `nx` 0..1 over 24 s).
- Shadow radius: `r = 0.18`.
- Shadow weight at pixel = `exp(-(nx - cx)² / r²)`.
- Pixel = `lerp(cp2_warm, cp1_deep, shadow_weight)`.
- During peak (cx ∈ [0.4, 0.6]): towers brightness ×0.3.

**CPC bindings.**
- `micLow` → shadow radius (linear; bass widens the eclipse).
- `micKick` → eclipse trigger: on kick, jump `cx` forward by 0.05 (eclipse "lurches" with the beat).
- `stemsVocals` → cp2 warmth (linear).

**Hue hooks.**
- `micKick` → cp1H deeper (cool side of palette dips on hit).
- `stemsVocals` → cp2H holds gold.

**Stage gesture.** RedwoodPARs naturally darken as the shadow passes — reads as a canopy event. View-mask: full rig.

**Fills which gap.** R8 flagged 83 (`shadow_canopy_eclipse`) as REWRITE / broken. This is the corrected version using `nx` (which actually varies) instead of phantom math.

---

#### L15 — `proposed_100_logsville_root_to_canopy_pulse.js`

**One-line pitch.** "Energy rises from the ground, through the towers, into the trees."

**Visual.** A vertical pulse cycles every 6 seconds: walls light up first (representing roots), then tower bars (trunks), then redwoods (canopy) — each stage lasting ~2 s, with the previous stage fading. Reads as life rising up through the grove on every cycle.

**Math idea.**
- Cycle phase `p(t) = (t % 6) / 6`.
- Wall brightness = `triangle_envelope(p, 0.0, 0.33)` (peaks at 0.17, off by 0.33).
- Tower brightness = `triangle_envelope(p, 0.25, 0.66)`.
- Redwood brightness = `triangle_envelope(p, 0.58, 1.0)`.
- Color = `lerp(cp1_cool, cp2_warm, p)` (each cycle warms as it climbs).

**CPC bindings.**
- `micLow` → cycle rate (linear, 0.6×..1.4×).
- `micKick` → mid-cycle "boost": adds 0.2 to whichever stage is currently active.
- `stemsBass` → wall brightness multiplier (linear).
- `stemsVocals` → redwood (canopy) brightness multiplier (linear; vocals = bright canopy).

**Hue hooks.**
- `micKick` → cp2H +0.01 per kick.
- `stemsVocals` → bias canopy stage hard toward cp2 gold.

**Stage gesture.** Root-to-canopy via fixture-class sequencing (walls → towers → redwoods), the most literal possible reading of the gesture. View-mask: full rig.

**Fills which gap.** R7's repeated ask for "root-to-canopy sweep" without abusing flat `y`. This uses fixture identity, which is unambiguous.

---

## 9. Operator playlist plan (added 2026-05-27, post-review)

_Added by the operator. **Make playlists first; perfect patterns later.** The operator will personally test the playlists and prune what doesn't read on the rig — every playlist below is **maximally inclusive** by design. When in doubt, include; the operator removes._

### 9.1 Hard-exclude list — RESOLVED (all 13 originally-excluded patterns now fixed)

The list below was the original exclude list at review time. **All 13 patterns have been rewritten and are safe to re-add to playlists after a rig eyeball test** (see Wave 1 / Wave 3 in section 10). The historical exclude list is preserved here for traceability:

```
[FIXED — Wave 1 Agent B]
19_swaying_lattice_ballet.js   # was: silent clone of 24
22_abyssal_sway_garden.js      # was: silent clone of 24

[FIXED — Wave 3 Agents H1–H4]
71_redwood_aurora.js           # was: R7 REWRITE (y-coord bug)
74_lookout_gyro_vortex.js      # was: R7 REWRITE (rotation centre wrong)
75_timber_mill_clockwork.js    # was: R7 REWRITE (UV leaks stage-wide)
76_outpost_lockdown.js         # was: R7 REWRITE (y-gate broken)
77_tower_canopy_ping.js        # was: R7 REWRITE (y-gate broken)
78_woodland_trident_sweep.js   # was: R8 REWRITE
79_mill_pressure_release.js    # was: R8 REWRITE (phantom view-mask bit)
81_outpost_distress_beacon.js  # was: R8 REWRITE — DO NOT LOAD FRIDAY (now strobe-safe ≤2 Hz, soft envelope)
82_redwood_timber_fall.js      # was: R8 REWRITE
83_shadow_canopy_eclipse.js    # was: R8 REWRITE — DO NOT LOAD FRIDAY (now ambient, no strobe)
84_outpost_ember_overdrive.js  # was: R8 REWRITE — DO NOT LOAD FRIDAY (now strobe-safe ≤3 Hz, deterministic sparkle)
```

All Wave-3 patterns that previously had hard-strobe hazards are now bounded by an in-pattern Hz cap (precedent: pattern 48 SOS fix in Wave 1). View-mask references throughout use the named registry only (`RedwoodPARs` `0x40`, `VintageOnly` `0x80`); features that depended on unregistered masks (`TowerBars`, `Cabin`, per-redwood groups) were explicitly dropped or replaced with fixture-index identity — each documented in the affected file's header comment per codex P0.

Patterns kept but with a load-with-care note (after small fix): `46_dome_lockdown.js` (header mismatch + blackout duration — fixed Wave 1 Agent C), `48_titanic_sos_beacon.js` (Morse strobe hazard — soft envelope + ≤3 Hz cap added Wave 1 Agent C).

**Operator action:** the 13 patterns are now eligible for any logsville (or dome) playlist they fit. The 6 main playlists (section 9.2–9.7) still reflect the pre-fix exclusion — operator decides whether to add the rewritten patterns now or after a rig test.

---

### 9.2 Dome — SLOW (openers, ambient, transitions, "people arriving")

```yaml
# playlists/summer_camp_dome_slow.yaml
dome_slow:
  # operator-listed (tested baseline)
  - 00_golden_hour_wash.js
  - 07_shimmer.js
  - 08_ocean_liner.js
  - 11_bioluminescence.js
  - 12_breathing.js
  - 14_lunar_current.js
  - 15_silk_prism_ribbons.js
  - 16_ghost_tide_uv.js
  - 17_rolling_color_dunes.js
  - 18_deep_space_lattice.js
  - 20_parametric_sway_field.js
  - 21_pelagic_manta_rays.js
  - 25_heartbeat.js
  # additional candidates worth a look (operator removes if they don't read)
  - 41_ghost_aurora.js         # 6.1 POLISH — slow aurora wash on dome
  - 43_sea_floor_shadow.js     # 6.1 POLISH — slow underwater wash
  - 53_shadow_eclipse.js       # 6.2 KEEP — slow eclipse moves
  - 55_stardust_dome.js        # 6.2 POLISH — slow starfield over dome
```

Designer proposals to generate later (section 8.1): D1 `lorenz_drift`, D2 `caustic_pool`, D3 `breath_constellation`.

---

### 9.3 Dome — FAST (drops, dance sections, "read from 50m")

```yaml
# playlists/summer_camp_dome_fast.yaml
dome_fast:
  # operator-listed
  - 01_cylon_sweep.js
  - 02_phase_cathedral.js
  - 03_dual_axis_crush.js
  - 04_beat_folded_helix.js
  - 05_orbital_attractor_field.js
  - 06_neon_elevator.js
  - 09_cyclone.js
  - 10_chasers.js
  - 13_sparkle.js
  - 23_prismatic_strange_attractors.js
  - 24_chromatic_murmuration.js
  - 42_boiler_glow.js
  - 44_apex_gyro_vortex.js
  - 45_engine_room_clockwork.js
  # additional candidates worth trying
  - 40_ghost_ship_reveal.js    # 6.1 POLISH — punchy reveal
  - 50_iceberg_fracture.js     # 6.2 KEEP — sharp punctuation
  - 52_iceberg_shear_line.js   # 6.2 POLISH — high-energy line
  - 54_boiler_fire_overdrive.js # 6.2 POLISH — chaotic energy
```

Designer proposals to generate (8.1): D4 `curl_noise_field`, D5 `de_jong_filaments`, D7 `phyllotaxis_bloom`, D8 `fluid_torus_braid`, D9 `kick_shockwave`, D10 `particle_rain`, D11 `strobe_lattice`, D12 `chromatic_explosion`.

---

### 9.4 Dome — APEX (dedicated dome-cap moments, `Apex` view-mask)

```yaml
# playlists/summer_camp_dome_apex.yaml
dome_apex:
  # operator-listed (tested baseline)
  - 47_apex_perimeter_ping.js
  - 49_boiler_pressure_release.js
  - 50_iceberg_fracture.js
  - 51_abyssal_searchlight.js
  - 56_stage_mirror_axis.js
  - 44_apex_gyro_vortex.js
  - 45_engine_room_clockwork.js
  - 52_iceberg_shear_line.js
  - 40_ghost_ship_reveal.js
  - 42_boiler_glow.js
  - 41_ghost_aurora.js
  # additional APEX-relevant candidates (R5/R6 verified all 40-56 gate on APEX section IDs already)
  - 43_sea_floor_shadow.js
  - 53_shadow_eclipse.js
  - 54_boiler_fire_overdrive.js
  - 55_stardust_dome.js

# load only after small fix
dome_apex_after_fix:
  - 46_dome_lockdown.js        # fix header + reduce blackout
  - 48_titanic_sos_beacon.js   # soften Morse strobe first
```

Designer proposals to generate (8.1, APEX-specific): D6 `typography_reveal`, D13 `apex_lighthouse`, D14 `iris_open`, D15 `audience_mirror`.

---

### 9.5 Logsville — SLOW (conservative — Logsville is under-tested)

```yaml
# playlists/summer_camp_logsville_slow.yaml
logsville_slow:
  # operator-listed (the only reviewer-verified safe slow patterns)
  - 70_forest_canopy_reveal.js   # R7 POLISH
  - 72_outpost_campfire.js       # R7 POLISH
  - 73_redwood_shadow_breath.js  # R7 POLISH
  - 85_redwood_starry_canopy.js  # R8 POLISH (also has correct view-mask check)
  # additional candidate (also POLISH per R8)
  - 80_canopy_fracture.js        # R8 POLISH — runs slow ok if rate tuned down

# proposals to generate as new files (proposed_NN_*.js)
logsville_slow_generate:
  - proposed_86_logsville_forest_dawn.js          # L1 forest_dawn
  - proposed_87_logsville_mist_between_trunks.js  # close cousin of L2 river_drift
  - proposed_88_logsville_breathing_camp_lanterns.js
  - proposed_89_logsville_canopy_starfield.js     # L3 canopy_starfield
  - proposed_90_logsville_grove_breath.js         # L5 grove_breath
```

---

### 9.6 Logsville — FAST (thin today — let automation fill it)

```yaml
# playlists/summer_camp_logsville_fast.yaml
logsville_fast:
  # operator-listed (the only safer-to-load fast options)
  - 80_canopy_fracture.js
  - 85_redwood_starry_canopy.js
  - 72_outpost_campfire.js
  # additional (R7 POLISH — fast-tunable if rate cranked)
  - 70_forest_canopy_reveal.js

# proposals to generate
logsville_fast_generate:
  - proposed_95_logsville_redwood_kick_columns.js  # L8 redwood_drop_strike
  - proposed_96_logsville_ember_storm.js           # L11 ember_storm
  - proposed_99_logsville_tower_pulse_pillar.js    # L9 tower_pulse_pillar
  - proposed_100_logsville_root_to_canopy_pulse.js # L15 root_to_canopy_pulse
  - proposed_101_logsville_redwood_ring_chase.js   # L4 redwood_ring_chase
  - proposed_102_logsville_grove_strobe_breath.js  # L10 grove_strobe_breath
```

---

### 9.7 Logsville — TREES (dedicated `RedwoodPARs` mask, bit `0x40`)

```yaml
# playlists/summer_camp_logsville_trees.yaml
logsville_trees:
  # operator-listed (verified safe)
  - 70_forest_canopy_reveal.js
  - 73_redwood_shadow_breath.js
  - 85_redwood_starry_canopy.js
  # additional (gate properly on Redwoods groups)
  - 72_outpost_campfire.js
  - 80_canopy_fracture.js

# generate or fix
logsville_trees_generate_or_fix:
  - 71_redwood_aurora.js                            # FIX y -> nz / group phase first
  - proposed_95_logsville_redwood_kick_columns.js
  - proposed_97_logsville_morse_woodknock.js        # L12 morse_woodknock
  - proposed_98_logsville_treeline_typography.js    # L13 treeline_typography (1-row blocky glyphs)
  - proposed_100_logsville_root_to_canopy_pulse.js
  - proposed_103_logsville_redwood_aurora_fixed.js  # replacement for 71 if fix is non-trivial
  - proposed_104_logsville_fireflies.js             # L7 fireflies
  - proposed_105_logsville_canopy_eclipse_redux.js  # L14 canopy_eclipse_redux
```

---

### 9.8 Where to start (operator workflow)

1. Create the six playlist files above.
2. Hard-exclude the patterns in 9.1 from all playlists.
3. Generate preview contact sheets for every playlist.
4. Operator personally tests these first:
   - `dome_fast`
   - `dome_apex`
   - `logsville_slow`
   - `logsville_trees`
5. Only then tune/fix individual patterns based on what didn't read on the rig.

**First manual test set** (small, high-signal subset across both stages):

```yaml
first_manual_test:
  dome:
    - 03_dual_axis_crush.js
    - 08_ocean_liner.js
    - 47_apex_perimeter_ping.js
    - 51_abyssal_searchlight.js
    - 56_stage_mirror_axis.js
  logsville:
    - 70_forest_canopy_reveal.js
    - 72_outpost_campfire.js
    - 73_redwood_shadow_breath.js
    - 80_canopy_fracture.js
    - 85_redwood_starry_canopy.js
```

---

### 9.9 Automation plan (one agent assignment)

> **Goal:** Prepare Summer Camp pattern playlists and automated previews for BM26-Titanic.

**Deliverables:**

A. **Six playlist files** under `playlists/`:
   - `summer_camp_dome_slow.yaml`
   - `summer_camp_dome_fast.yaml`
   - `summer_camp_dome_apex.yaml`
   - `summer_camp_logsville_slow.yaml`
   - `summer_camp_logsville_fast.yaml`
   - `summer_camp_logsville_trees.yaml`

B. **Playlist validator**:
   - Verify every file exists.
   - Verify no hard-excluded pattern (see 9.1) is included.
   - Verify no two pattern files share the same SHA-256 (catches more silent clones).
   - Verify header comment matches filename when possible.
   - Verify CPC signal names use canonical keys only:
     `micLow`, `micMid`, `micHigh`, `micKick`, `stemsBass`, `stemsDrums`, `stemsVocals`.

C. **Logsville lint pass**:
   - Flag use of world `y` for redwood vertical motion (redwoods are at constant `y=3`).
   - Flag raw view-mask bit literals (`& 1`, `& 2`, `& 4`) when named masks exist.
   - Flag unconditional `u = uvIntensity` outside redwood/vintage branches (UV leak).
   - Flag any `viewMask & N` in Logsville files where `N` isn't a registered bit in `summer_camp_logsville.viewmasks.js`.

D. **Preview renderer** — for each playlist, render contact sheets under five audio profiles:
   - silent
   - bass-heavy
   - kick pulse
   - high-frequency sparkle
   - full music-reactive

   Outputs under `previews/`:
   - `dome_slow_contact_sheet.png`
   - `dome_fast_contact_sheet.png`
   - `dome_apex_contact_sheet.png`
   - `logsville_slow_contact_sheet.png`
   - `logsville_fast_contact_sheet.png`
   - `logsville_trees_contact_sheet.png`

E. **Summary** → `previews/PATTERN_TEST_SUMMARY.md`, per pattern:
   - playlist membership
   - verdict: PASS / NEEDS_VISUAL_REVIEW / FAIL
   - reason
   - screenshot link
   - whether audio response was visible

---

### 9.10 Fix queue (only what's needed before operator's manual test)

**Priority 0** (block playlist work otherwise):
- Remove 19 and 22 from any existing playlists.
- Create the six new playlist files.
- Add validator + preview contact sheets.

**Priority 1** (before manual test):
- Fix `46_dome_lockdown.js` header mismatch + reduce blackout hold.
- Soften `48_titanic_sos_beacon.js` Morse hard-strobe envelope.
- Logsville: fix only 70, 72, 73, 80, 85.
- Do NOT touch 71, 74–79, 81–84 unless extra time.

**Priority 2** (post-manual-test):
- Generate proposed Logsville patterns:
  - `95_redwood_kick_columns`
  - `96_ember_storm`
  - `97_morse_woodknock`
  - `100_root_to_canopy_pulse`

**Principle:** automation produces previews and safe playlists; operator's human time goes into "yes this reads / no it's ugly / too dark" on contact sheets — not into chasing perfection in 80+ patterns.

---

## 10. Implementation log (added 2026-05-27, post-dispatch)

Coordinator dispatched 7 implementation agents in two waves on top of the 8 reviewers + designer. Summary of what landed in the working tree, by agent:

### Wave 1 — primary implementation (5 agents in parallel)

- **Agent A — Playlists.** Created the 6 stage playlists per section 9, hard-excluding all REWRITE patterns + the two clones. Preserved slider defaults from prior `slow.yaml` / `fast.yaml` where patterns carried over.
  - `simulation/scenes/summer_camp_dome/playlists/{slow,fast,apex}.yaml`
  - `simulation/scenes/summer_camp_logsville/playlists/{slow,fast,trees}.yaml`
- **Agent B — Clone fixes.** Rewrote the two silent clones with implementations matching their names (sha256-verified distinct from `24_chromatic_murmuration.js`).
  - `marsin_engine/patterns/19_swaying_lattice_ballet.js` — counter-phase lattice grids with Lissajous pivot.
  - `marsin_engine/patterns/22_abyssal_sway_garden.js` — vertical bioluminescent fronds, cantilever bend.
- **Agent C — APEX fixes.**
  - `marsin_engine/patterns/46_dome_lockdown.js` — header fixed; `holdBlackout` default 0.35 → 0.15 (dark window 17% → 13%).
  - `marsin_engine/patterns/48_titanic_sos_beacon.js` — Morse pulse now soft-edged via `sliderEdgeSoftness` (default ~54 ms); rate cap clamps strobe to ≤3 Hz of full-rig flash at slider max.
- **Agent D — Logsville POLISH fixes.** Coord-system bug + UV leak + raw-bit view-mask fix across:
  - `70_forest_canopy_reveal.js`, `72_outpost_campfire.js`, `73_redwood_shadow_breath.js`, `80_canopy_fracture.js`, `85_redwood_starry_canopy.js`
  - All 5 now use named masks (`RedwoodPARs` = `0x40`, `VintageOnly` = `0x80`); UV strictly inside redwood/vintage branches; per-`z` phase staggers replace flat `y` gates.
  - **Engine fact discovered:** `render3D(index, x, y, z)` already receives normalized [0,1] coords (`marsin_engine/lib/wasm_host.js:126-143`). The "redwoods at y=3" problem is that normalized y is also constant — fix is fixture-group / z-axis staggering, not coordinate normalization.
  - Pattern 73 lost its tower-bar branch (`viewMask & 1` referenced unregistered TowerBars mask) — explicit removal documented, no silent fallback. Operator eyeball flagged.
- **Agent E — Initial audio variants (superseded — see Wave 2).** Originally produced `audio_dome.yaml` (27 entries) and `audio_logsville.yaml` (12 entries) as separate playlists with 3 modulations per entry mixing mic + stems. Superseded by Agent F per operator instruction.

### Wave 2 — audio integration (2 agents in parallel)

- **Agent F — Audio integration into main playlists.**
  - Deleted `audio_dome.yaml` and `audio_logsville.yaml`.
  - Augmented all 6 main playlists in place — 66 entries, 132 modulations.
  - Operator constraints respected: exactly 2 modulations per entry; mic-group XOR stems-group never mixed; 82% mic / 18% stems (mic-biased for always-on reliability).
  - Pattern 48 SOS gets brightness/width modulations only (no signal-speed mod — strobe safety).
  - All 132 mods passed `validateModulationMapping`; every slider target verified to exist in pattern source.
- **Agent G — Modulation pipeline audit** → `.agent/02_reports/202605/20260527_5_modulation_pipeline_audit.md`.
  - Verdict: **pipeline works, with caveats** (ergonomic gotchas, not engine bugs).
  - Three semantic gotchas surfaced:
    1. `polarity: bipolar` is wrong for audio sources (centers no-move at `source=0.5`; audio sits near 0 → spends most time pulling slider down).
    2. `micKick` is a gated/held/decay pulse (120 ms flat-top), not a level follower — for smooth motion use `micLow`.
    3. `mode: scale` × `base=0` = no effect; use `mode: offset` to inject motion into a parked slider.

### Coordinator follow-up

Cross-checked Agent F against Agent G's gotchas and found 7 bipolar-on-audio mods (gotcha #1). Flipped all to `unipolar` with reversed ranges (e.g. `range: [-0.2, 0]` bipolar → `range: [0, -0.2]` unipolar), so silent = no change and loud = the offset. Verified in `modulation_engine.js:144-147` that the engine treats `range` as a plain lerp endpoint pair — swapped ranges produce a reverse ramp by design. All 6 playlists now have 0 bipolar audio mods.

Files edited:
- `simulation/scenes/summer_camp_dome/playlists/slow.yaml` (5 entries fixed)
- `simulation/scenes/summer_camp_dome/playlists/fast.yaml` (1 entry fixed)
- `simulation/scenes/summer_camp_logsville/playlists/trees.yaml` (1 entry fixed)

### Wave 3 — REWRITE-tier logsville fixes (4 agents in parallel)

Four sub-agents (H1–H4) rewrote the 11 REWRITE-tier patterns logsville reviewers (R7/R8) had flagged. Every rewrite applies Agent D's three-bug recipe (coord-system / named view-masks / UV-leak gating), restores the pattern to render correctly on `summer_camp_logsville`, and caps any flash component in-pattern.

- **Agent H1** — 71, 74, 75
  - `71_redwood_aurora.js` — y-axis collapse → per-redwood-group phase via `z` (Redwoods1/2/3 index ranges 204–221) + golden-ratio second band. Visual: cool teal/violet aurora curtains across the three rings, warm tip-bias, gated wind shimmer.
  - `74_lookout_gyro_vortex.js` — rotation pivot moved from rig centre to tower centroid (`nx=0.51, nz=0.35` derived from TowerBars idx 0–143). Counter-vortex on redwoods, UV smoothed (was binary flicker).
  - `75_timber_mill_clockwork.js` — gear sweep on tower/wall surface, vintage cluster ticks on 16ths, redwoods cycle pulley-style 1→2→3 with UV. UV no longer floods stage-wide.
- **Agent H2** — 76, 77, 78
  - `76_outpost_lockdown.js` — two counter-rotating amber/red beacons on `VintageOnly`, perimeter wash on `RedwoodPARs`. Bounded alarm flash: `sliderStrobeRate` default 0.5 → 1.5 Hz, hard cap `MAX_STROBE_HZ = 3.0`, ~30 ms duty, vintage cluster only (redwoods never strobe).
  - `77_tower_canopy_ping.js` — base→top→base `triangle()` ping along `nz` on redwoods only, UV trail in-branch. TowerBars component dropped (unregistered mask).
  - `78_woodland_trident_sweep.js` — three `triangle()`-driven prongs at 1/3-cycle offsets, distinct palette assignments per prong.
- **Agent H3** — 79, 81, 82
  - `79_mill_pressure_release.js` — vintage ramp + raised-cosine vent burst, redwoods bloom as cooling tail. `VENT_HZ_MAX = 3.0`, `sliderPressure` default 0.5 → ~1.6 Hz.
  - `81_outpost_distress_beacon.js` — smooth rotating spot, raised-cosine envelope (was R8 "DO NOT LOAD" — now strobe-safe). `BEACON_HZ_MAX = 2.0`, `sliderBeaconRate` default 0.4 → ~0.86 Hz. Redwoods carry recede-on-approach response glow.
  - `82_redwood_timber_fall.js` — round-robin through Redwoods1/2/3 via index-range identity (per-tree masks aren't registered, documented in header). Per-tree: upright stillness → accelerating raised-cosine sweep → impact W flash + UV dust.
- **Agent H4** — 83, 84
  - `83_shadow_canopy_eclipse.js` — normalized-`nx` leading-edge sweep across 18 redwood PARs, thin breathing corona, cool/warm split ahead/behind eclipse front. No strobe (was R8 "DO NOT LOAD" — now pure ambient).
  - `84_outpost_ember_overdrive.js` — 3-octave irrational-ratio noise field on vintage in red→amber, deterministic time-jittered sparkle (replaces per-frame `random()` strobe-fizz). `FLASH_RATE_MAX_HZ = 3.0`, `sliderFlashRate` default 0.4 → ~1.2 Hz. Redwoods carry a slow UV backdrop only.

**Verification (coordinator):**
- All 11 patterns mutually distinct sha256 and none clone pattern 24.
- Zero raw `viewMask & N` bit literals in code paths across the 11 files; the only `viewMask & N` matches in the tree are header comments explicitly documenting dropped features (codex P0 — explicit, not silent).
- Every named view-mask cited (`RedwoodPARs`, `VintageOnly`) is registered in `marsin_engine/models/summer_camp_logsville.viewmasks.js`.
- Every pattern with a flash/strobe component has an in-pattern Hz cap and an operator-tunable slider.

### Wave 3 outstanding (post-rewrite)

- All 11 rewritten patterns need a rig eyeball before being added back into show playlists — they parse and have correct mask gating but the specific visuals haven't been seen on the actual rig.
- Operator decides whether to re-add the rewrites to `summer_camp_logsville/{slow,fast,trees}.yaml` and `summer_camp_dome/apex.yaml` (none of them touch dome patterns, so dome playlists are unaffected).
- Audio modulations for the 11 newly-fixed patterns are NOT yet wired in playlists — Agent F's Wave 2 ran before these patterns were viable. Operator can extend the audio set via the same 2-mod-per-entry / mic-XOR-stems convention once they're slotted into playlists.

### Earlier-outstanding (still deferred for operator decision)

- Designer's 30 proposals (section 8) — no implementation yet; intentional per operator's "new patterns can be ignored for now."
- Strobe-safety review of patterns 46 and 48 should be eyeballed on the rig before show (still recommended; Wave 1 caps already applied).
- POLISH-grade tweaks to generic patterns 00–25 (per R1–R4 bullets) — only the 5 logsville POLISH targets were touched; the dome/generic POLISH set is untouched.

---

## 11. Transitions review (added 2026-05-27 by Reviewer T)

Scope: the 16 scripted transition blends under `marsin_engine/patterns/transitions/`. Read-only review; no source files edited.

### 11.0 How transitions fit

**Loader.** `marsin_engine/lib/pattern_mixer.js:1495-1515` `_compileBlend(blendName)` looks first in `patterns/channel_blends/<name>.js`, then falls back to `patterns/transitions/<name>.js`, compiles via `wasmHost.compile()`, caches the handle. Lazily invoked from `getBlendHandle()` (`pattern_mixer.js:1487-1493`) the first time a `trans_*` name is requested.

**Runner.** `marsin_engine/lib/wasm_host.js:180-201` `renderBlend6ch(blendHandle, pixelCount, fromBuffer, toBuffer, progress)` allocates from/to/out buffers, copies in the upstream 6-byte-per-pixel RGBWAU snapshots, and calls the cwrap'd `marsin_render_blend_6ch` (`wasm_host.js:59`) which dispatches per-pixel into the script's `render(index, x, y, z)`. Coords passed are the same normalized `[0,1]` `(nx,ny,nz)` the regular patterns receive (`wasm_host.js:126-143`).

**Trigger.** `triggerMixerTransition({...transitionMode})` (`pattern_mixer.js:649-740`) either (a) does a "trans_crossfade" path where overlay faders smoothstep up/down with no script swap, or (b) saves the target channel's blend mode, swaps in the `trans_<name>` script, anchors fader to `0.002`, and calls `fadeChannel(c.id, 1.0, durationMs, {curve: 'smoothstep', restoreMode})`. Then `updateTransitions()` (`pattern_mixer.js:1080-1150`) ramps the fader 0→1 across `durationMs` (default curve = `smoothstep`), and that fader value is what the runner passes as `progress`.

**Expected script shape.**
- `export function render(index, x, y, z)` — required entry point per pixel.
- Built-in globals injected by the VM each pixel: `progress` (0..1), `fromR/G/B/W/A/U` (0..1, the outgoing pattern's pre-composited 6ch sample for this pixel), `toR/G/B/W/A/U` (the incoming pattern's). Built-ins are pixel-scoped; **`beforeRender()` is never invoked on a blend script** (see `trans_color_burst.js:14-21` docstring — caching colours frame-scope leaves stale bytes).
- Output via `rgbwau(r, g, b, w, a, u)`.
- `progress` is **already smoothstep-eased** at the fader layer (`pattern_mixer.js:594` default `curve: 'smoothstep'`). Any in-script easing therefore stacks ON TOP of smoothstep — usually fine for spatial wipes but worth noting for `pow(amt, 0.5)`/`pow(amt, 2)` in the flash family.
- Duration: wall-clock `durationMs` (1..30000 ms) at API server cap; `progress` is linear in time only if caller passes `curve: 'linear'`, otherwise smoothstep.

**Mixer composite semantics.** During a scripted transition the **target channel's blend mode** (e.g. `blend_screen`) is **replaced** for the duration with the `trans_*` script (`pattern_mixer.js:721-722`). The script IS the composite — it reads `from*` (= the layer below = active base/deck pre-overlay), reads `to*` (= the incoming pattern at this pixel), and outputs the final composite for this layer. On completion the saved blend mode is restored (`pattern_mixer.js:1117`).

### 11.1 Catalog overview

| File | Gesture (4–5 words) | Verdict | Strobe? |
|---|---|---|---|
| `trans_color_burst.js` | amber flare burst through middle | KEEP | Y (single peak) |
| `trans_crossfade.js` | linear pixel-wise lerp from→to | KEEP | N |
| `trans_diagonal_wipe.js` | edge sweeps bottom-left to top-right | KEEP | N |
| `trans_diamond_wipe.js` | L1 diamond expands from centre | KEEP | N |
| `trans_dissolve.js` | per-pixel random reveal grains | KEEP | N |
| `trans_flash.js` | full-white peak then reveal | POLISH ✓ FIXED | Y (single peak) |
| `trans_iris.js` | circular iris opens from centre | KEEP | N |
| `trans_iris_close.js` | iris collapses inward to centre | KEEP | N |
| `trans_morse_blink.js` | three SOS flashes then crossfade | POLISH ✓ FIXED (rate-cap) | Y (multi-pulse) |
| `trans_ripple_in.js` | concentric rings ride outward | POLISH ✓ FIXED | N |
| `trans_split_horizontal.js` | bay-doors open from y-centerline | KEEP | N |
| `trans_split_vertical.js` | curtains part from x-centerline | KEEP | N |
| `trans_wave_sweep.js` | sinusoidal wavefront left to right | KEEP | N |
| `trans_wipe_down.js` | edge sweeps top to bottom | KEEP | N |
| `trans_wipe_left.js` | edge sweeps right to left | KEEP | N |
| `trans_wipe_right.js` | edge sweeps left to right | KEEP | N |

Counts: **13 KEEP / 3 POLISH / 0 REWRITE**.

_(Wave 4 update 2026-05-27: all 3 POLISH transitions now ✓ FIXED — see section 11.5.)_

### 11.2 Per-transition reviews

#### `trans_color_burst.js` — **KEEP**

**Gesture.** Amber flare burst — first half ramps from outgoing pattern up to a saturated burst colour (default H=0.08 amber), second half ramps down to incoming pattern. A flare-bulb / signal-lamp visual.

**Smoothness.** First-half `amt = sqrt(progress*2)` (fast attack), second-half `amt = ((progress-0.5)*2)^2` (slow→fast resolve). At `progress=0` first-half `amt=0` → exact FROM. At `progress=1` second-half `amt=1` → exact TO. Discontinuity-check at `progress=0.5`: first-half upper bound = burst colour; second-half lower bound = burst colour. **Clean.** RGBWAU all reach 0 cleanly at midpoint for W/A/U since first-half fades them out and second-half fades them in from 0 (`trans_color_burst.js:69-71, 83-85`).

**Strobe-safety.** Single peak per trigger. Peak is `(burstR, burstG, burstB) = (1.0, ~0.48, 0)` at amber default → bright but not full-white. Peak dwells at half-value for roughly progress∈[0.4, 0.6]. At 500 ms transition → peak window ~100 ms; at 1 s → ~200 ms. Single-flash-per-trigger, **safe** unless operator taps repeatedly within ≤333 ms; no in-script rate cap because there is no internal repeat.

**P0 compliance.** No silent fallback. The "no `hsvPickerBurst` export" comment (`trans_color_burst.js:28-38`) is an explicit, documented decision (avoiding VM init clobber) — not a silent default. Per-pixel HSV→RGB inlined (`trans_color_burst.js:44-58`) — slightly wasteful but mandatory given no `beforeRender()`.

**Improvement.**
- Cache `bR/bG/bB` as `export var` initialised from `burstH/S/V` defaults and recompute only when a setter (a future param channel) writes — would save ~50% of the per-pixel cost. Today every pixel re-runs the HSV branch.
- Consider exposing `sliderBurstWidth` to control how long the burst dwells before resolving (currently fixed at the implicit p=0.5 crossover).

#### `trans_crossfade.js` — **KEEP**

**Gesture.** Straight per-channel linear lerp from outgoing to incoming pattern; no spatial structure. The "safe" default.

**Smoothness.** `mix(from*, to*, progress)` (`trans_crossfade.js:9-14`). At `progress=0` outputs FROM exactly; at `progress=1` outputs TO exactly. Linear in progress — combined with the smoothstep fader curve, the net easing is smoothstep. Continuous everywhere.

**Strobe-safety.** None — purely additive lerp.

**P0 compliance.** No fallback. No params, no setters, nothing to clobber.

**Improvement.**
- Already this thin; leave alone. (`triggerMixerTransition` short-circuits to a no-script path for crossfade in practice — `pattern_mixer.js:667-673` — so this script is mostly a safety net for direct compile/test paths.)

#### `trans_diagonal_wipe.js` — **KEEP**

**Gesture.** Wipe whose leading edge runs perpendicular to the (1,1) diagonal — TO is revealed starting at the bottom-left corner, front sweeps to top-right.

**Smoothness.** `pp = (x+y)*0.5`, `ep = progress*(1+2f) - f`, `edge = smoothstep(pp-f, pp+f, ep)` (`trans_diagonal_wipe.js:18-20`). Endpoint bias trick (documented in `trans_wipe_right.js:7-16`) guarantees `edge=0` at `progress=0` for every pixel and `edge=1` at `progress=1`. Continuous.

**Strobe-safety.** None.

**P0 compliance.** No fallback. `sliderFeather` clamps to `[0.02, 0.42]` so no zero-width-edge division risk (smoothstep handles equal args anyway).

**Improvement.**
- Diagonal axis ignores `z`. On dome rigs the apex follows the same `(x+y)/2` ordering as the equator — a 3D diagonal (`(x+y+z)/3`) would let the wipe also climb the dome. Optional via `sliderUseZ`.
- The `pp` range here is `[0, 1]` only when `x,y ∈ [0,1]` — confirmed correct.

#### `trans_diamond_wipe.js` — **KEEP**

**Gesture.** Expanding rotated square (L1 distance front) growing outward from rig centre. Visually distinct from the round iris.

**Smoothness.** Same bias trick (`trans_diamond_wipe.js:19-21`). At `progress=0/1` edges resolve cleanly. The L1 metric maxes at `|0-0.5|+|0-0.5| = 1.0` — only the four corners reach `pp=1`; rig edges along axes reach `pp=0.5`. That means the diamond completes "covering" the corners *late* relative to the axes — visually correct for the gesture but axis-edge pixels reach TO at progress≈0.5 while corner pixels wait until ~1.0. Documented behaviour.

**Strobe-safety.** None.

**P0 compliance.** No fallback.

**Improvement.**
- Normalise `pp` by the model's actual max L1 distance (1.0 here), or expose `sliderShape` to rotate between L1 (diamond) and L2 (circle, → trans_iris) and L∞ (square aligned to axes).

#### `trans_dissolve.js` — **KEEP**

**Gesture.** Per-pixel random crossfade — at any mid-progress the rig is a TV-static mix of "fully FROM" and "fully TO" pixels with a feather window in between.

**Smoothness.** Per-pixel threshold `th` from `fract(sin(index*12.9898+78.233)*43758.5453)` (`trans_dissolve.js:58-61`), then `amt = clamp((ep - th + grain)/(grain*2), 0, 1)` with the same bias trick (`trans_dissolve.js:65-66`). At endpoints clamps to 0 / 1 for every `th`. Continuous per-pixel.

**Strobe-safety.** None — granular dissolve, no global flashes.

**P0 compliance.** Excellent — the `_setGrain` private fn + the long header comment (`trans_dissolve.js:42-50`) explicitly explain why the `slider*` export is omitted (VM init clobber would silently change the operator-visible default). This is precisely the "explicit, not silent" pattern the codex P0 asks for.

**Improvement.**
- Hash is per-`index` — fixture-index-ordered, not spatially-ordered. On dome models where physical adjacency doesn't match index adjacency this looks like fine static, but on bar-fixture models adjacent pixels might cluster their `th` values. Optionally fold `(x+y*1.3+z*1.7)` into the seed to spatially decorrelate.
- The `random()` collision documented in the header (`trans_dissolve.js:8-14`) is a VM bug, not a transition bug — surfaces here because the dissolve is the only script that needs per-pixel noise.

#### `trans_flash.js` — **POLISH ✓ FIXED**

**Gesture.** Full-rig white pop at midpoint, then the incoming pattern fades up. Hardest-hitting transition in the set.

**Smoothness.** `progress<0.5` → `amt = sqrt(progress*2)` lerps FROM→white (RGBW all to 1.0). `progress>=0.5` → `amt = ((progress-0.5)*2)^2` lerps white→TO. At `progress=0`: `amt=0` → exact FROM. At `progress=1`: `amt=1` → exact TO. Midpoint discontinuity check: first-half upper = `(1,1,1,1, 0, 0)`; second-half lower = `(1,1,1,1, 0, 0)`. **Continuous.**

**Strobe-safety.** **Single peak per trigger** — same as color_burst, but pure white at full intensity (R=G=B=W=1.0). At 250 ms transition the white peak window (where amt>0.5 on both sides) is ~125 ms; at 500 ms it is ~250 ms; at 1 s, ~500 ms. **One flash per operator tap.** Risk only materialises if the operator (or autopilot) re-triggers the transition rapidly. Repeated triggers at <333 ms interval would exceed the 3 Hz dance-floor cap. There is no in-script rate cap, and no API-side cooldown that I can see in `triggerMixerTransition` — re-triggers cancel the in-flight transition (`pattern_mixer.js:579 cancelChannelTransition`) and start a new one. **MAJOR**: rapid autopilot picks could compound; recommend operator-tunable cooldown at the trigger layer (out of scope for transitions, raised in 11.4).

**P0 compliance.** `hsvPickerFlash` is exported (`trans_flash.js:10`) and according to the documented VM behaviour (see trans_dissolve / trans_color_burst headers) the VM will invoke it at compile/init with `(0,0,0)` — which would set `flashHue=0, flashSat=0`. The defaults (`flashHue=0, flashSat=0`) already match those values, so the inadvertent clobber happens to be a no-op. **But** the per-pixel render hard-codes `fR=fG=fB=1` (`trans_flash.js:14-16`) and **never reads `flashHue/Sat/flashV`** — the export is wired but unused. Either the params are meant to colour the flash (in which case the inline HSV→RGB conversion is missing — bug) or they are dead (in which case the export should be removed). **MAJOR — header says "Flash/Burn" but offers no actual colour control.**

**Improvement.**
- Either delete the `hsvPickerFlash` export and `flashHue/Sat` vars, or wire them through an inlined HSV→RGB the same way `trans_color_burst.js:44-58` does. Don't leave dead controls.
- Document the peak-window math in the header so the operator knows that "transitionDurationMs / 2" is roughly how long the white sits high.

**Fix applied (Wave 4).** Wired HSV→RGB at `trans_flash.js:55-69` (mirrors `trans_color_burst.js:44-58`). Renamed `hsvPickerFlash`→private `_setFlashColor` per the documented VM-init-clobber workaround (`trans_flash.js:48-52`); defaults are now flashH=0, flashS=0, flashV=1 (= pure white, unchanged behaviour, but operator can re-colour the flash via a future transition-param API). Peak-window math documented in the header. White channel now tracks `flashV` so dim flashes also dim the W output (`trans_flash.js:73`).

#### `trans_iris.js` — **KEEP**

**Gesture.** Circular iris opens from rig centre outward — TO appears at (0.5, 0.5) first, leading ring sweeps to corners.

**Smoothness.** `pp = hypot(x-0.5, y-0.5) / 0.7071`, same bias smoothstep (`trans_iris.js:18-20`). Endpoints clean. The `0.7071` divisor normalises corner distance to 1.0 — assumes a roughly square `x,y` aspect. On the dome/logsville rigs `y` spans `[0,1]` but the rig's actual aspect ratio isn't square; pixels with low y but high z will sit at `pp` near `|x-0.5|*1.414` which still ∈ `[0, ~0.707]` so the iris completes by `progress≈0.71` for those — front then sits flat until p=1. Acceptable for a 2D iris.

**Strobe-safety.** None.

**P0 compliance.** No fallback.

**Improvement.**
- `z` is ignored — on the dome the cap (high z) doesn't take part in the iris geometry. A `pp = hypot(x-0.5, y-0.5, z*0.5)/norm` would let the apex sweep with the equator. Optional.
- The flat top after `pp` saturates causes visible "stall" near `progress=0.7`+; either accept it or rescale `pp` by the model's actual radial max.

#### `trans_iris_close.js` — **KEEP**

**Gesture.** FROM collapses inward toward rig centre — corners reveal TO first, centre is the last to switch.

**Smoothness.** `pp = 1 - dist`. Endpoints clean via bias trick. Symmetric inverse of `trans_iris.js`. Same aspect-ratio caveat.

**Strobe-safety.** None.

**P0 compliance.** No fallback.

**Improvement.**
- Same `z`-ignored caveat as `trans_iris.js`.
- Consider adding a `sliderCenterX/Y` so the collapse point isn't locked to `(0.5, 0.5)` — useful for steering the eye toward, e.g., the bow.

#### `trans_morse_blink.js` — **POLISH ✓ FIXED** (rate-cap required)

**Gesture.** Three short staccato bursts of TO overlaid on FROM (SOS wink) across `progress∈[0, 0.7]`, then a final smoothstep crossfade across `[0.70, 1.0]`.

**Smoothness.** Per-pulse: `_pulse(p, center, halfWidth)` returns `1 - smoothstep(0, halfWidth, |p-center|)` — peak 1.0 at centre, smooth fall to 0 at ±halfWidth (`trans_morse_blink.js:18-22`). Three centres at p=0.10, 0.30, 0.50 with halfWidth=0.05 (`trans_morse_blink.js:27-29`). At `progress=0`: `p1 = 1 - smoothstep(0, 0.05, 0.10) = 1 - 1 = 0` (clean). At `progress=0.70`: all three pulses are far past, `burst=0`. Cross to second branch: `amt = (0.70-0.70)/0.30 = 0`, smoothstep(0,1,0)=0 → output FROM. **Continuous at the branch boundary.** At `progress=1`: `amt=1` → TO. **Clean.**

**Strobe-safety.** **THIS IS THE STROBE HAZARD.** Three pulses across `progress∈[0, 0.7]` (effectively three bright transitions to TO and back). Pulse on/off interval ≈ 0.2 progress units. At wall-clock:
- 500 ms transition → 3 bursts in 350 ms → ~8.6 Hz effective full-rig flash.
- 1 s transition → 3 in 700 ms → ~4.3 Hz.
- 2 s transition → 3 in 1.4 s → ~2.1 Hz.
- 3 s transition → ~1.4 Hz.

Below the Wave-1 / Wave-3 precedent (≤3 Hz dance-floor cap) **only at durationMs ≥ ~1500 ms**. Default mixer transitions are typically 500-1000 ms (no canonical default in `pattern_mixer.js`; API server caps `durationMs ∈ [1, 30000]`). **At common transition speeds this strobes the full rig at ~4-9 Hz** — same hazard class as patterns 46/48 that triggered Wave-1 rate caps.

There is no in-script rate cap, no minimum-duration guard, no operator-tunable strobe slider. The contrast to TO depends on what TO is — if TO is bright, the pulse is a full-amplitude flash; if TO is dark, the pulse is subtle. **Operator should not use this transition with durationMs < 2000 ms near a dance floor.**

**P0 compliance.** No silent fallback in the script itself, but the *absence* of a strobe guard mirrors the violation Wave 3 fixed in pattern 76/79/84 (all received `MAX_*_HZ` caps + sliders). Same standard should apply.

**Improvement.**
- Add `export var minDurationMs` semantics — or better, compute pulse spacing from `progress` density × an upper-bounded burst count. e.g. `burstCount = max(1, min(3, floor(progress_velocity_estimate/3)))` — but `progress_velocity` isn't visible inside the blend (no time built-in for blends). Realistically: gate at the trigger layer (raised in 11.4).
- Soften pulse amplitude with `pulse * min(1, durationMs / 1500)` IF `durationMs` becomes a built-in for blends — today it isn't.
- Reduce pulse `halfWidth` from 0.05 to 0.035 — narrows each pulse's high window, reducing effective duty-cycle from ~60% to ~40% per Hz.

**Fix applied (Wave 4).** Strobe cap implemented in-script via a per-frame wall-clock estimator (`trans_morse_blink.js:74-104`): pixel-0 each frame samples `progress` delta, assumes ~40 Hz cadence, and estimates `estDurationMs`. If `estDurationMs < minDurationMs` (operator-tunable, default 1500 ms → ~3 Hz cap), the script DELIBERATELY degrades to a single smoothstep crossfade (`trans_morse_blink.js:121-134`) — documented as a deliberate, non-silent fallback per codex P0. Pulse `halfWidth` reduced from 0.05 to 0.035 (`trans_morse_blink.js:62`). In-script `pow()` stacking removed; uses `progress` linearly inside `_pulse` envelopes to address cross-cutting #2. Exposed `minDurationMs` + `pulseHalfWidth` via private `_set*` workaround (no `slider*` magic prefix → no VM-init clobber).

#### `trans_ripple_in.js` — **POLISH ✓ FIXED**

**Gesture.** Concentric rings sweep outward from rig centre (water-drop visual). Pixels cross multiple rings before settling on TO.

**Smoothness.** `phase = (dist*ringCount - progress*2)*PI2`, `ring = 0.5 + 0.5*sin(phase)`, `amt = mix(ring*progress, 1.0, progress)` then clamp (`trans_ripple_in.js:19-24`). At `progress=0`: `amt = mix(0*0, 1, 0) = 0` → exact FROM. **Clean.** At `progress=1`: `amt = mix(ring*1, 1, 1) = 1` → exact TO. **Clean.** Continuous in between, though `amt` is *non-monotonic per pixel* — a pixel will brighten as a ring crest passes through it, dim as the trough does, before finally locking to TO when the floor sweeps up. That non-monotonicity is the gesture, not a bug, but flag: if FROM and TO have very different brightness, pixels will visibly *flicker* during the transition.

**Strobe-safety.** Per-pixel oscillation, not synchronised full-rig flash. ringCount=5 default, `progress*2` over `durationMs` → per-pixel oscillation frequency ~ `ringCount / durationMs` ≈ 5 Hz at 1 s. Per-pixel, not full-rig — but if `ringCount` is set very low (slider min = 2) and `durationMs` short, the rig can sync-pulse. **Low risk in default config but worth a rate-aware cap if exposed via autopilot.**

**P0 compliance.** No fallback. `sliderRings` clamps `[2, 12]`.

**Improvement.**
- Add `sliderRingDamping` exposing a `1 - exp(-progress*k)` envelope on `ring` so ripples *settle* over time rather than oscillating with constant amplitude until the floor swallows them.
- The `mix(ring*progress, 1.0, progress)` formula is fine for endpoint correctness but spends the first ~30% of progress at very low `amt` (since `ring*progress` is small) — the transition feels "back-loaded". Consider `mix(ring, 1, progress^0.7)` for a more even read.

**Fix applied (Wave 4).** BOTH improvement bullets applied (they're independent and additive). `sliderRingDamping` added (`trans_ripple_in.js:48-49`) driving `dampEnv = 1 - exp(-progress*k)` (`trans_ripple_in.js:65`); default k=3. Progress floor switched from linear to `pow(progress, 0.7)` (`trans_ripple_in.js:69-71`); endpoint-correct (0^0.7=0, 1^0.7=1).

#### `trans_split_horizontal.js` — **KEEP**

**Gesture.** Bay-doors open from y=0.5 outward — TO appears at the horizontal centerline and fronts travel to top + bottom.

**Smoothness.** `pp = abs(y-0.5)*2`, bias trick (`trans_split_horizontal.js:19-21`). Endpoints clean. Symmetric about y=0.5.

**Strobe-safety.** None.

**P0 compliance.** No fallback.

**Improvement.**
- `z` ignored — same caveat as iris/diamond on the dome cap.
- Consider symmetric variant with offset center (`sliderCenterY`).

#### `trans_split_vertical.js` — **KEEP**

**Gesture.** Curtains part from x=0.5 outward — TO appears at the vertical centerline and fronts travel to port + starboard.

**Smoothness.** `pp = abs(x-0.5)*2`, bias trick (`trans_split_vertical.js:16-18`). Endpoints clean.

**Strobe-safety.** None.

**P0 compliance.** No fallback.

**Improvement.**
- `z` ignored.
- Same potential `sliderCenterX` for off-axis curtain pivots.

#### `trans_wave_sweep.js` — **KEEP**

**Gesture.** Sinusoidal wavefront sweeps left→right — tide-rolling visual.

**Smoothness.** `env = 4*progress*(1-progress)` envelopes the displacement so `disp=0` at `progress=0` and `progress=1`. This is genuinely careful — at endpoints the wavefront collapses to a flat line and reduces to a clean `trans_wipe_right` (`trans_wave_sweep.js:24-30`). `pp = x - disp`, bias trick on top. Endpoints clean. **Best engineering in the set.**

**Strobe-safety.** None.

**P0 compliance.** No fallback. `sliderFeather`/`sliderWaveFreq`/`sliderWaveAmp` all bounded.

**Improvement.**
- `waveAmp` default 0.15 × env peak 1.0 = 0.15 max displacement. At high `waveFreq` (slider max = 9) the wave has ~9 crests across `y∈[0,1]`, which is fine on a tall rig but may alias on sparse y-distribution fixture groups. Consider clamping `waveFreq` to fixture-density-aware bound via a model param.
- Add a vertical variant (`disp` along x, wave along x→y) — currently the wave is only horizontal-sweep with vertical-wobble.

#### `trans_wipe_down.js` — **KEEP**

**Gesture.** Wipe sweeps from y=1 (top) down to y=0.

**Smoothness.** `pp = 1 - y`, bias trick. Endpoints clean.

**Strobe-safety.** None.

**P0 compliance.** No fallback.

**Improvement.**
- Symmetric with `trans_wipe_left/right` — same set should probably include `trans_wipe_up` for completeness (today no script reveals from y=0 upward).

#### `trans_wipe_left.js` — **KEEP**

**Gesture.** Wipe sweeps right→left.

**Smoothness.** `pp = 1 - x`, bias trick. Endpoints clean.

**Strobe-safety.** None.

**P0 compliance.** No fallback.

**Improvement.**
- None beyond expose `sliderDirection` to fold left/right into one script (out of scope; keeps file count higher than necessary but is consistent with the convention of one script per gesture).

#### `trans_wipe_right.js` — **KEEP**

**Gesture.** Wipe sweeps left→right. The canonical wipe; carries the long docstring that all other feathered wipes cite for the endpoint-bias trick.

**Smoothness.** `pp = x`, bias trick. Endpoints clean. Most-documented script in the directory — header explains the bias math and the "without it, the rig is half-faded at progress=0" failure mode.

**Strobe-safety.** None.

**P0 compliance.** No fallback. Excellent docstring.

**Improvement.**
- None. This is the reference implementation.

### 11.3 Cross-cutting findings

1. **All wipes ignore `z` entirely.** `trans_iris/iris_close/diamond/split_horizontal/split_vertical/diagonal/wave_sweep` all compute reveal order from `(x, y)` only. On the dome model the apex (high z) participates only through whatever its `(x, y)` projection happens to be — meaning two apex pixels at the same `(x, y)` but different `z` reveal *simultaneously*, regardless of their actual 3D position. Acceptable for 2D wipes (the visual gesture is 2D anyway) but worth documenting in a header convention. Suggest one of: (a) add a one-line "2D wipe, ignores z" comment to each, or (b) add an opt-in `sliderUseZ` to a few of them so the operator can run them as 3D wipes on the dome.

2. **`progress` is double-eased.** The fader curve defaults to `smoothstep` (`pattern_mixer.js:594`), and most transitions then apply additional smoothstep or pow easing inside the script. For the wipes (smoothstep on the spatial edge) this is fine — the two smoothsteps live in different domains (time vs. space). For the flash family (`pow(amt, 0.5)`, `pow(amt, 2)` in time) they compose with the fader smoothstep — net is ≈ `pow(smoothstep, 0.5)` and `pow(smoothstep, 2)`. Visually acceptable but not what the script's author may have assumed. Document or expose a `curve: 'linear'` recommendation for the flash/burst/morse family at the call site. _(Wave 4: `trans_morse_blink` now uses `progress` linearly inside pulse envelopes — addressed. `trans_flash` retains the asymmetric attack/decay intentionally but documents the compose in its header — addressed by documentation. `trans_color_burst` left unchanged. Engine-side `curve:'linear'` exposure still open.)_

3. **No transition exposes a midpoint-hold or dwell slider.** Every script linearly traverses `progress∈[0,1]` once. For `trans_flash`/`trans_color_burst` this means the flash duration is rigidly `durationMs/2`. The Wave-1 fix to pattern 48 (SOS beacon) ended up adding `sliderEdgeSoftness` for similar reasons — same gap exists here. Consider engine-side support for a "phase profile" so a flash can be `[0..0.4 ramp-up, 0.4..0.6 hold, 0.6..1 ramp-down]` independent of `durationMs`.

4. **`hsvPicker*` / `slider*` VM init clobber** is documented in three scripts (`trans_color_burst.js:28-38`, `trans_dissolve.js:42-50`) and *not handled correctly* in `trans_flash.js` (export is present, defaults happen to match, but params are dead per finding above). This is a class of latent codex P0 violations — VM init silently overwrites operator-set values. Standardise by either (a) blocking `slider*`/`hsvPicker*` invocation at compile time for blend scripts, or (b) requiring all blend scripts to use the documented private-fn workaround. **MAJOR** at the engine level (not transitions-only). _(Wave 4: `trans_flash` now uses the private-fn workaround (`_setFlashColor`); `trans_morse_blink` exposes new params via the workaround (`_setMinDurationMs`, `_setPulseHalfWidth`) — both touched transitions are clean. `trans_ripple_in` keeps the original `slider*` exports (consistent with v1; default-clobber is non-safety-critical for ring count + damping). Engine-side enforcement still open.)_

5. **Per-pixel HSV→RGB conversion.** `trans_color_burst.js` (and `trans_flash.js` if it were to use its colour params) re-runs HSV→RGB for every pixel of every frame because `beforeRender` isn't called on blends. For typical rig sizes (~600 pixels × ~40 Hz × ~500 ms transition) that's ~12k extra branches per transition. Negligible perf but stylistically jarring. Engine-side fix: invoke a one-shot `beforeBlend()` lifecycle on blend scripts (mirror of `beforeRender()`); out of scope for the scripts themselves.

6. **No `audio reactivity`.** Unlike regular patterns, transitions are deliberately silent on the CPC bus. This is the right call — transitions are short, deterministic, and operator-triggered — but the operator should be aware that audio-reactive cues are entirely the regular-pattern's job, not the transition's.

7. **`trans_dissolve` hash is index-based, not spatial.** On fixture groups where index adjacency ≠ spatial adjacency (bar strips, redwood PARs) the dissolve still looks random; on tightly index-ordered groups it may look like sequential reveal. Mostly fine, flagged as a possible polish target if any operator notices a "scan" artifact.

### 11.4 Outstanding for operator decision

- **BLOCKER candidate — `trans_morse_blink` strobe rate.** At common transition durations (500-1000 ms) this script flashes the full rig at ~4-9 Hz, above the dance-floor 3 Hz cap established in Wave 1/3. Either (a) gate at the trigger layer with a minimum-duration guard for this specific `transitionMode`, (b) add an in-script attenuation envelope as the per-pulse height drops at short durations (requires the engine to expose `durationMs` as a blend built-in — not present today), or (c) move this transition into a deliberately-not-loaded set for Friday show, similar to how Wave 1 marked patterns 83/84/87. Operator decides.

- **Re-trigger cooldown for the flash family.** `trans_flash` / `trans_color_burst` are single-flash-per-trigger, but rapid operator/autopilot re-triggers cancel in-flight and start fresh — there is no cooldown. If autopilot is given access to these blends, recommend a per-blend minimum-interval lock at the trigger layer (out of scope for transition scripts; would live in `triggerMixerTransition`). Rig eyeball this in autopilot mode before the show.

- **`trans_flash` dead colour params.** Decide whether to wire the `hsvPickerFlash` export through to actual coloured flashes (matching `trans_color_burst`'s pattern) or remove the export entirely. Today the params are silently ignored. Treat as a small POLISH task whenever someone's in the file.

- **Rig eyeball of `z`-ignoring wipes on the dome.** The 2D wipes (iris/diamond/splits/diagonal/wave) will reveal apex and equator at the same `(x,y)` simultaneously. Whether that reads as "broken" or "correct 2D wipe on a 3D rig" is an aesthetic call only an operator with rig time can make. If it reads broken, the fix is the optional `sliderUseZ` per cross-cutting finding #1.

- **No `trans_wipe_up`.** The directory has down/left/right but no up — likely an omission. Engine-side: trivially symmetric with `trans_wipe_down` (just `pp = y`). Operator decides if needed.

**Coverage gap.** Read-only review — no scripts compiled, no transitions visually verified on a live rig. All endpoint-cleanliness claims are math-only (smoothstep ranges + the bias formulae). Recommend a brief eyeball pass of each of the 16 transitions before show, especially the three with strobe components.

**Confirmation.** Only section 11 added below the existing section 10; sections 1–10 untouched.

### 11.5 Wave 4 — POLISH fixes (added 2026-05-27 by Agent T-Fix)

Scope: the 3 transitions flagged POLISH in 11.2 (`trans_morse_blink`, `trans_flash`, `trans_ripple_in`). Wipes deliberately not touched (operator preference). Engine, models, playlists, and other transitions not touched.

**Files changed.**
- `marsin_engine/patterns/transitions/trans_morse_blink.js` — full rewrite of the script header + render path (54 → 173 lines). Strobe-rate cap via per-frame wall-clock estimator; degrades to deliberate smoothstep crossfade fallback when estimated duration < `minDurationMs` (default 1500 ms). Cross-cutting #2 (double-ease) addressed. Cross-cutting #4 (VM-init clobber) addressed via `_setMinDurationMs` / `_setPulseHalfWidth` private-fn workaround.
- `marsin_engine/patterns/transitions/trans_flash.js` — rewrite (43 → 91 lines). HSV→RGB inlined mirroring `trans_color_burst.js:44-58`. Cross-cutting #4 addressed: `hsvPickerFlash` → private `_setFlashColor`. Defaults match prior visual (pure white); white channel now tracks `flashV`. Peak-window math documented in header. Cross-cutting #2 acknowledged (asymmetric attack/decay is intentional gesture).
- `marsin_engine/patterns/transitions/trans_ripple_in.js` — rewrite (33 → 75 lines). Both 11.2 improvement bullets applied: `sliderRingDamping` (`1 - exp(-progress*k)` envelope) + `pow(progress, 0.7)` floor (front-loaded). Endpoint correctness preserved.

**Test results (baseline → after).**

| Test | Baseline | After Wave 4 |
|---|---|---|
| `marsin_engine/tests/transitions_pixel_perfect.test.js` | 17/17 pass | 17/17 pass |
| `marsin_engine/tests/hil/hil_transition_pixel_perfect_test.mjs` | 16/16 pass | 16/16 pass |
| `marsin_engine/tests/hil/hil_transition_smoothness_test.mjs` | Skipped — env (no overlays) | Skipped — same env precondition |
| `marsin_engine/tests/hil/hil_transition_test.mjs` | Skipped — env (vis capture) | Skipped — same env precondition |
| `marsin_engine/tests/hil/hil_transition_type_test.mjs` | Skipped — env (no overlays) | Skipped — same env precondition |
| `marsin_engine/tests/hil/hil_transition_visual_test.mjs` | Skipped — env (no overlays) | Skipped — same env precondition |
| `marsin_engine/tests/hil/hil_deck_transition_smoothness_test.mjs` | 2/10 pass — env (no playlist scaffold) | Not re-run (no transitions touched here are in scope) |

**Zero regressions** on the math-based pixel-perfect contracts (the only tests with a meaningful pre-Wave-4 baseline). The four `hil_transition_*` tests that require an engine with ≥2 overlay channels and a vis-capture loop have the same env precondition failures pre- and post-fix — they are end-to-end rig tests and need the operator's actual playlist scaffold to evaluate.

**Operator eyeball checklist (rig-time).**
- `trans_morse_blink` at durationMs ∈ {500, 1000, 1500, 2500, 3000} — confirm: < 1500 ms degrades to a single soft crossfade (NO pulses), >= 1500 ms shows the three SOS pulses spaced ≥300 ms apart, no visible stair-step in the degraded fallback.
- `trans_flash` — confirm defaults still look like the previous pure-white flash; the per-pixel HSV branch adds ~25 ALU ops/pixel but is dwarfed by the channel mix.
- `trans_ripple_in` — confirm rings settle visibly faster now (the damping envelope), and that the new front-loading reads as a smoother reveal rather than a back-loaded "snap to TO" at the end.

**Out of scope (deferred to operator or coordinator).**
- 11.4 BLOCKER on `trans_morse_blink` is partially mitigated: short-duration triggers no longer strobe (they fall back to a soft crossfade), but the operator may still want a trigger-layer minimum-duration guard to make the gesture intent explicit at the UI rather than silently swapped at the script.
- 11.4 re-trigger cooldown for `trans_flash` / `trans_color_burst` is still entirely a trigger-layer concern; this fix changes nothing there.

### Designer A — color/static rework (2026-05-28)

Operators flagged 5 patterns as static and/or non-palette-following. Rework summary:

- **70_forest_canopy_reveal.js** (kept name, mixed): redwoods now render a cp1<->cp2 gradient driven by a depth-staggered breath (rings reveal in succession through nz); vintage carries a cp1<->cp2 lantern wash with an amber bias. Added `tBloom` slow accumulator + `paletteSpread` slider. Audio: `audioMid` swells bloom.
- **72_outpost_campfire.js** (kept name, mixed; steamboat-white added): vintage now flickers between cp1 and cp2 with heat-biased mixing and gated steamboat-white sparks on bright peaks (campfire embers); redwoods get a palette ember crawl that travels through nz so the rings move on different cadences. Audio: `audioBass` swells campfire heat.
- **73_tree_shadow_breath.js** (renamed from 73_redwood_shadow_breath, tree-only): two-color breath crossfade (cp1 inhale / cp2 exhale) with per-ring phase from nz + slow `tDrift` so silhouettes shift over time; UV shadow stays as the inverse of the breath. Audio: `audioMid` swells breath. Playlist updated.
- **75_timber_mill_clockwork.js** (kept name, mixed): added in-group rotating Gaussian sweep on the redwoods (fixes "trees static" — each PAR now visibly cycles even when its group is sustained-active); redwood RGB is now a cp1<->cp2 gradient across pixel position; vintage ticks alternate cp1/cp2; tower gear-tooth gradient now also cycles cp1<->cp2. Audio: `audioBass` widens the tooth.
- **85_redwood_starry_canopy.js** (kept name, mixed; steamboat-white added): redwoods now carry a baseline cp1<->cp2 gradient that drifts through nz so the canopy is never static; each star randomly picks cp1 or cp2 so both palette sides appear in the canopy; gated steamboat-white twinkles fire with each star. Tower sweep now travels through both nx and nz for genuine 2D motion. Audio: `audioHigh` boosts star rate.

All 5 compile clean against `marsin_wasm_runtime.createWasmRuntime` / `compile()`. Steamboat-white added to 72 and 85 (the two assigned in the brief), gated by mask in both cases.

### Designer B — discontinuity + motion optimize (2026-05-28)

Operator notes: 71 "lights the trees, optimize", 74 "discontinuity issues", 78 "good, optimize more", 79 "smoother motion", 84 "too basic". Changes:

- **71_tree_aurora.js** (renamed from 71_redwood_aurora, tree-only): added per-harmonic time accumulators (`tBandB`, `tShimmer`) so each band wraps independently instead of all teleporting at the moment `tPhase` rolls over (precedent: 05/10/18/20/23/24/44). Added a third decorrelated band keyed by per-pixel index so adjacent PARs in the same ring breathe on their own micro-cadence — canopy now reads as having depth rather than being three synchronized groups. Playlist updated.
- **74_lookout_gyro_vortex.js** (kept name, mixed): root-cause fix for the discontinuity. The prior version fed `atan2`'s `[-PI, +PI]` output into `wave()` with a *non-integer* harmonic multiplier (`(angle/PI2) * 1.37`); at the atan2 seam (±PI), neighbors jumped 1.37 cycles instead of 1, producing a visible ring once per rotation. Now: (1) angle is explicitly normalized into `[0,1)` via `aR - floor(aR)`, (2) all harmonic multipliers on the angle are integers (`* 2.0`), (3) each layer is driven by its own time accumulator (`timeR1/timeR2/timeT1`) so phase doesn't teleport when one wraps. Same fix on the tower branch.
- **78_woodland_trident_sweep.js** (kept name, mixed): minor — added a tiny per-pixel z-jitter on the prong x-offsets (sub-pixel, ≤ 1/2 sweepWidth) so the three bands read as *living* curtains rather than frozen vertical lines. Kept the triangle()/bandValue() idiom intact.
- **79_mill_pressure_release.js** (kept name, mixed; steamboat-white added): "smoother motion" pass. Replaced the asymmetric `bP*bP` build envelope with a raised-cosine (kills the tangent kink at 0.85), replaced the linear cool-down with a raised-cosine (kills the kink at 0.5), single-pole low-passed all three envelopes (`buildEnvS/ventEnvS/coolEnvS`, τ ≈ 120 ms) so the whole pattern has a heavy-flywheel feel. Boiler-noise frequencies dropped ~30% and moved onto their own time accumulators (`tNoiseA/tNoiseB`). Steamboat-white added: gated to vintage + `y>0.8 || z>0.8` + a smoothed `motionIntensity` meter (peaks during vent burst) — literal steam release through the upper stacks.
- **84_outpost_ember_overdrive.js** (kept name, mixed; steamboat-white added): "too basic" fix. Added a slow-walking hot-spot center (Lissajous `ringCx/ringCz` at sub-Hz) so the kiln has a felt source rather than a uniform glow; a raised-cosine `spot()` bloom around that center is folded into both the brightness envelope and the cp1↔cp2 mix, so the kiln center reads as hotter and tipped toward cp2 (amber tip) while the edges stay cp1 (red core). Each noise octave moved onto its own time base (`tOctA/B/C`) — was the same `tPhase` scaled three ways, which is why every octave rolled together (the "basic" feel). Slow secondary breath (`emberDrift`) under the fast flash adds long-form inhale/exhale. Steamboat-white added: gated to vintage + `y>0.8 || z>0.8` + `motionIntensity * hotSpot` — ember overdrive punches through the upper stacks during roar peaks. Also fixed a `max(w, 0.85)` call (engine has no `max` helper — replaced with explicit `if`).

All 5 compile clean against `marsin_wasm_runtime.createWasmRuntime` / `compile()`. Steamboat-white added to 79 and 84 (the two recommended in the brief). One rename (71 → tree); playlist updated.

### Designer C — trees + dim fixes + 110 all-black (2026-05-28)

- **110_logsville_giant_pixel_chase.js** (kept name; bug + dim fix): Fixed the slider-shadow bug (line 122 `var chaseMode = 0` was redeclaring the export, pinning the slider to MODE_FORWARD); renamed the local int to `chaseModeInt` and wired `beforeRender` + `modeSlot()` accordingly. Rewrote the "all black" tower/wall else-branch: now a directional sweep echoing the chase head in nx with ambient floor 0.30..0.55 (was 0.06), warm palette mix on the head, amber tip — towers/walls now read as part of the same gesture instead of near-black. Vintage branch also picked up a steamboat-white edge flicker (`y>0.85`, motion-driven).
- **112_logsville_giant_call_response.js** (kept name; tree static fix): Added a continuous `ripple` term tied to `tPhase` (not just `turnCount`) so the trees always have visible per-section motion between turn boundaries. Folded into A_THEN_B / PINGPONG edge ramp + a `rippleLevel` baseline that floors with envelope intensity. Left/right behavior unchanged (operator said "left right good").
- **76_outpost_lockdown.js** (kept name; "basic" + steamboat-white): Added a radial outpost-pulse on redwoods (red ring expanding from nx=0.5 twice per cycle) so the trees have an active gesture matching the rotating beacons. Raised perimeter wash floor from 0.4×breath×0.4 to 0.55+0.45×breath (no more washed-out trees). Steamboat-white added on the vintage branch — `motionIntensity * 0.25` baseline plus the existing 3 Hz-capped strobe; reads as warning whites pulsing.
- **77 → 77_tree_canopy_ping.js** (RENAMED per brief; "basic" fix): Renamed via `git mv`; playlists in `summer_camp_logsville`, `summer_camp_dome`, and `test_bench` + manifest.json updated. Pattern rewritten to a TRIPLE phase-staggered ping (cp1 / mid / cp2) with per-tree-clump phase offset from nx. PAR brightness floor 0.55 with bands lifting to ~1.0 (was dim). Three crown hits, amber on leading edges, UV trail.
- **80 → 80_tree_canopy_fracture.js** (RENAMED tree-prefix; "trees too dim, too basic"): Renamed; playlists + manifest updated. Three independent strike triggers + a branch-sweep term, baseline canopy glow 0.30..0.50 (was 0% between strikes), strikes punch up to PAR brightness with cp1+cp2 mixing for variety. UV floor at 0.35 so the canopy is always violet, strikes punch above.
- **82_redwood_timber_fall.js** (kept name; "trees too dim, circles around the trees"): Reworked to "orbiting halos" — each 6-PAR ring carries two counter-sweeping arcs (cp1 leader at primary phase, cp2 trailer offset 0.5). Three rings rotate at slightly different speeds (groupId-keyed) so the grove doesn't lock-step. Floor PAR brightness at 0.55 (was ~0.25). Original timber-fall gesture preserved as periodic impact accent every cycle.
- **83_shadow_canopy_eclipse.js** (kept name; "tower and walls too static" + steamboat-white): Rewrote the non-redwood branch to mirror the eclipse — same shadow front sweeps across towers/walls in nx with rim, warm side at 0.55×cp1, shadow at 0.22×cp2, post-eclipse at 0.38×cp2 (was flat 0.18 wash). Steamboat-white added: gated to `VintageOnly`, driven by `rimT * (1 - inShadow)` — literal warning white on the leading rim.

All 7 patterns compile clean against `createWasmRuntime`/`compile()`. Two renames (77 → tree, 80 → tree); three playlists + manifest.json updated. Steamboat-white added to 76, 79's neighbor pattern 83 (per brief recommendation), 110-vintage as bonus.

### Designer D — complex motion + new tower patterns (2026-05-28)

Operator notes: 81 "add random motion in x-y plane mathematically complex and not repetitive -> maybe some sort of sine wave or mix of sines", 96 "okay" (light pass), 100 "too basic, but good", 111 "tower pulses -> I like it" (light pass), plus 2 new tower-only patterns 113/114. Changes:

- **81_outpost_distress_beacon.js** (kept name; explicit operator rework): Replaced the simple fixed-rate angular rotation around `(0.5, 0.5)` with a Lissajous mix-of-sines trace on the (nx, nz) stage plane. Two axis accumulators `tA`/`tB` advance at incommensurate base rates (`LISSA_RATE_A = 0.31`, `LISSA_RATE_B = 0.47`), each scaled by the BEACON_HZ_MAX-bounded `beaconRate` — so the strobe cap is preserved. Each axis sums a fundamental sine plus a golden-ratio (`* GOLDEN * 3.1`) and sqrt(2)-ratio (`* SQRT2 * 2.3`) harmonic, the harmonic amplitude is controlled by a new `pathComplexity` slider. Hot-spot centre `(beaconCx, beaconCy)` drifts aperiodically inside a circle of radius `LISSA_RADIUS = 0.22` and is renormalized so it never leaves the [0,1] square at any complexity. The radial raised-cosine `spot2D()` replaces the prior circular-distance `spot()` — no hard edges. Redwood response-glow + UV branch untouched; trajectory is the only meaningful semantic change.
- **96_logsville_ember_storm.js** (kept name; light pass): Rewrote the steamboat-white block to the pattern-00 idiom — `w = motionIntensity * 0.85` (motionIntensity = `pow(n, 3.0) * heat`), gated to the vintage branch by structure, sparing soft gate, no hard threshold. Sparkle kernel now pushes W to 0.95 (was 0.85) so flickers punch through the steady ember field.
- **100_logsville_root_to_canopy_pulse.js** (kept name; "too basic" fix): Added a horizontal `detail = ripple * crossfront` ride inside each cascade envelope (root/trunk/canopy) — two phase-offset wavefronts on (nx, nz) at e ≈ 2.718 and golden ≈ 1.618 ratios with per-pixel jitter, so each stage carries spatial detail rather than reading as a flat rising bar. Vertical root-to-canopy reading preserved (envelopes are still the dominant term). Added steamboat-white on the wall-vintage root branch — `pow(rootEnv, 3) * bassBoost * 0.65`, sparing per the pattern-00 idiom.
- **111_logsville_giant_pixel_heartbeat.js** (kept name; light pass): Reworked the previously-flat "towers / other" branch into a vertical pulse climbing each tower column on every beat. `barT = (index % 18) / 17.0` is the column position; the pulse front rides from 0 to 1 as `beatEnv` decays 1→0; soft raised-cosine slice (bandWidth scales with `popDecay`). Per-tower golden-ratio phase offset (`towerIdx * 0.618`) so the 8 towers don't strobe identically. Vintage branch untouched (operator likes it).
- **NEW 113_tower_column_breath.js** — Slow architectural breath, **tower-only** (REDWOODS explicitly zero-output on `MASK_REDWOOD_PARS`). Each tower's 18-pixel column carries a soft raised-cosine wave-front sliding up/down on `wave(breathPhase + towerIdx * 0.618)`, palette gradient cool→warm by `barT`, BREATH_HZ_MAX = 0.6 Hz so it's always meditative. Vintage cluster carries a soft synchronized amber wash. Audio: `audioBass` lifts amplitude, `audioMid` accelerates breath (still capped). Steamboat-white pops on the inhale crest (`pow(slice, 3) * pow(front, 2) * steamboatWhite`, motion-gated per pattern-00).
- **NEW 114_tower_ring_chase.js** — Snappy azimuthal chase, **tower-only** (REDWOODS zero). Bright cp1 wedge sweeps clockwise/CCW (`direction` slider) around the 8-tower ring using `atan2(z - 0.5, x - 0.5)`, leaving an exponentially-decaying cp2 trail of length `trailLength`. RING_HZ_MAX = 3.0 Hz (precedent: pattern 47). `audioKick` snaps the wedge brighter (150 ms half-life), `audioHigh` adds deterministic sparkle on the wedge head only. Vintage washes follow the wedge at 2.5× width as a soft directional warm/cool sweep.

Playlist: only `summer_camp_logsville/playlists/default.yaml` exists (slow/fast/apex don't); added both 113 + 114 entries there with full slider defaults + CPC modulations (113: micLow→bass, micMid→mid; 114: micKick→kick, micHigh→high). Pattern 112 untouched (Designer C).

Steamboat-white added to 96 (vintage ember crests), 100 (wall-vintage root crest), and 113 (tower-bar inhale apex) — 3 of 6, hitting the quota.

All 6 patterns compile clean against `marsin_wasm_runtime.createWasmRuntime` / `compile()`. No renames (81 still touches redwoods via the response-glow branch; 96/100/111 already span tower + redwood + vintage). YAML lint clean (entries: 61 → 63).
