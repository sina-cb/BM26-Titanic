---
name: titanic-x-axis-dead-zone
description: The titanic model has NO pixels across 25% of its X extent (nx 0.40-0.65), so any pattern whose BRIGHTNESS travels along X swings total rig brightness for non-audio reasons and measures weakly reactive — Y and Z are fine.
type: lesson
created: 2026-08-05
updated: 2026-08-05
---

**The measurement (2026-08-05, report `202608/20260805_1`).** Pixel
distribution of `models/titanic.js` (964 px), 20 bins per axis:

```
nx:   3   1   0   9 118  80 131 140   0   0   0   0   0  59 154 115 112  38   2   2
ny:   8   0   6  54  40  16  79  18  94  21  75 101 104 115  11  35  41  52  51  43
nz:   2   0   2   2  44  50  34  88  35  39 108  35 115  18  65  46  80  47  64  90
```

`nx` has **five contiguous empty bins — 25% of the sweep (nx 0.40 to 0.65)**,
and ranges 0..154 px per bin. `ny` and `nz` each have one empty bin (5%). The
hole is **X-only**; sweeping Y or Z is safe.

**Why it matters.** A brightness feature swept along X lights anywhere from 0
to 154 pixels depending only on WHERE IT CURRENTLY IS. Total rig brightness
therefore swings hard for a reason unrelated to the music — and total
brightness is the budget the audio is supposed to own. The offline harness
scores `corr(signal, total brightness)`, so that positional swing directly
suppresses a pattern's measured audio reactivity. It is not a scoring artefact:
the rig really is doing that.

**Proven causally.** `66_five_colour_prism` and `67_five_colour_stations` both
swept their crest across `nx`. Moving ONLY the brightness coordinate to travel
along the strand — periodic in `index`, so a constant *fraction* of the rig is
lit at every phase — and changing nothing else:

| | micLow | micKick | micFlux | micHigh |
|---|---|---|---|---|
| `66` before / after | 0.37 → **0.63** | −0.04 → **0.74** | 0.36 → **0.52** | 0.17 → **0.50** |
| `67` before / after | 0.30 → **0.63** | −0.04 → **0.76** | 0.35 → **0.50** | 0.17 → **0.50** |

**Library survey (all 70 patterns, both rigs, each using its own declared
`AUDIO_MODULATION_V1` map).** Eight patterns clear the 0.5 PRIMARY bar on
`test_bench` and fail it on `titanic` — `40_lissajous_weave` (0.60 → −0.33),
`33_aurora_breath` (0.69 → 0.13), `01_cylon_sweep` (0.70 → 0.26),
`36_orbital_pulse` (0.83 → 0.45), `03_dual_axis_crush` (0.54 → 0.20),
`26_dom_dancers_chevron`, `44_biolume_swell`, `37_chevron_chase`. Mechanism
confirmed by reading the two largest: `01` does `dist = abs(nx - eyePos)`;
`40` does `ddx = nx - curX[kk]` into an inverse-square brightness.

**But this is NOT the library's main problem.** 40/64 scored patterns are below
0.5 on titanic and **34/64 are below it on test_bench too** (means 0.43 vs
0.45). So 32 patterns are weak on BOTH rigs for a cause this lesson does not
explain and nobody has diagnosed.

**How to apply:**
- Writing a pattern for the ship? Do not make BRIGHTNESS a function of position
  along X. Travel the brightness along the strand instead — `wave(index /
  PERIOD + phase)` — which lights a constant fraction at every phase. `PERIOD`
  is a CONSTANT, never `pixelCount` (that compiles to a literal 144).
- Colour and geometry may still use `x` freely; only the brightness envelope is
  affected.
- Expect the harness to then report `LOW-VARIATION` at silence. That is the
  point, not a regression — flat total brightness is what leaves the budget to
  audio. Prove motion per-pixel instead (frame-to-frame delta), and do NOT
  restore an X sweep to make the silence metric move.
- Validate any new pattern with `--model titanic`, not just the harness default
  `test_bench`. The two rigs disagree.
- Two hypotheses the data KILLED, so they are not worth re-testing: brightness
  saturation is not the discriminator (71% of strong patterns peak at 255 vs
  80% of weak), and a static regex for "who sweeps x" does not separate victims
  from controls — read the source.

Related: [[operator-uses-launcher]] (bring the stack up the same way before any
live check).
