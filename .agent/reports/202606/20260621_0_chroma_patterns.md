# 2026-06-21 — CHROMA-driven PATTERNS (dev/h1_chroma_patterns) — closing the G1 loop

Four NEW audio-reactive lighting patterns (numbers **69–72**) that MODULATE off
the harmonic/timbre CHROMA signals the engine publishes but **no pattern used
yet** (`micChromaTiltRaw`, `micTonalStabilityRaw`, `micChromaFluxRaw`), plus the
underused `audioNoteHue` / `audioPhrasePhase`. Built on `dev/h1_chroma_patterns`
(parent `feat/audio_analysis_2`, fftSize 2048, slot 0). This closes the loop the
G1 report `20260620_30` opened: the chroma axis is plumbed live but was weighted 0
in the genre classifier and unused by any visual — these patterns finally PAINT
with it.

Modulators-only contract honoured: patterns NEVER read CPC audio globals natively;
the engine OVERRIDEs their sliders from the signals. House style followed: high-
contrast, true-black negative space, NEVER fully dark on silence (lifted floor,
every pattern peak ≥96/255 and litFrac 1.000 on `--model titanic --synth silence`),
coordinate-driven (x/y/rad) so they port test_bench 52 → titanic 970 unchanged,
strict cp1↔cp2 RGB palette blends, autonomous idle so the rig is alive in silence.

Owned + touched: `marsin_engine/patterns/69..72_*.js` (NEW) +
`marsin_engine/patterns/manifest.json` (4 names appended before `rainbow`, now
72 entries). No engine/analyzer/signal-module changes.

## Validation method (REAL DSP, end-to-end)

The COMMITTED `tools/pattern_derived_harness.mjs` drives the genuine engine chain
(analyzer fftSize 2048 → AudioStructureDetector → DerivedSignals → slider
OVERRIDE → MarsinVM render). I ran it on all four for COMPILE_OK + the derived
signals it CAN drive (it proves `audioNoteHue` fires on 71 and `audioPhrasePhase`
on 72).

**Committed-harness gap (FOLLOW-UP, flagged — not in my ownership):** the
committed harness mirrors the raw analyzer keys into ParamCenter but **stops at
`micSubRaw` and never writes the three `micChroma*Raw` keys** (the engine itself
writes them at `engine.js:1461`/`:1511`). So under the committed harness those
three signals read a flat 0.00 ("signal never moved") for every chroma pattern —
it structurally cannot validate ANY chroma pattern until 3 mirror lines are added.
For the chroma reactivity numbers I ran an **engine-identical** harness (a copy of
the committed file with exactly those 3 lines added — `value: a.tonalStability /
a.chromaFlux / a.chromaTilt`, byte-for-byte the engine's own mirror) plus a
render+measure/capture variant for hue/temperature/texture axes. Every DSP stage
is the genuine engine module. Recommend promoting those 3 lines into the committed
tool in a future session (same flag D3/report 16/21 raised for the derived
harness).

**Chroma signal availability** (analyzer over the synth bank, the pivot driver):

| signal | where it drives usefully |
|---|---|
| `micChromaTiltRaw` | sine_sweep sweeps **0.00→1.00** (bass-dark→treble-bright); edm_drop 0→0.94; full_track bass-low (mean 0.13 = cool) |
| `micTonalStabilityRaw` | bassline HELD **0.71** mean (tonal); hats/chord_stab **~0.02–0.06** (percussive); full_track mid 0.50 |
| `micChromaFluxRaw` | full_track peaks **0.61** on chord turns; chord_progression spikes on changes |
| `audioNoteHue` | full_track/chord_progression walks 0.00→0.75 |
| `audioPhrasePhase` | full_track ramps 0→0.62 across the 8-bar phrase (corr 0.90, strongly REACTIVE) |

Each pattern: COMPILE_OK, ANIMATING, ≥1 REACTIVE mapping (correlation to its
driving signal below), silence-safe + visible floor, real-engine `--dry-run` exit
0 (all four). Clean `git status` (4 patterns + manifest only; no states residue).

---

## 69_harmonic_warmth — WARM↔COOL palette sweep from spectral brightness

**Concept.** `micChromaTiltRaw` (pitched-band brightness) drives a slow palette
TEMPERATURE sweep over a calm breathing wash: bass-heavy/dark material settles
COOL (deep teal/indigo, cp1), treble-rich/bright material warms toward HOT
(amber/gold, cp2). The temperature EASES toward the tilt (a slow sunrise/sunset,
never snaps); a drifting diagonal warmth gradient gives motion. `micChromaFluxRaw`
adds a small brightness+warmth lift on harmonic change.

**Signals.** `micChromaTiltRaw→sliderWarmth`, `micChromaFluxRaw→sliderFlux`.

**Reactivity** (titanic 970px). sine_sweep (tilt 0→1): **corr(chromaTilt,
warmth-temperature R/(R+B)) = 0.85**, WARMTH spans **0.00→0.82** (full cool→warm
arc); chromaFlux→totBri **0.67** (REACTIVE). Pinned: warmth=0→R/(R+B) 0.000
(fully cool), warmth=1→0.386. full_track (bass-low tilt 0.13): rig stays COOL
(warmth 0.01→0.20), as intended. Because this is a HUE/temperature shift, the
right axis is colour-temperature corr (0.85), not brightness corr (0.17) — same
as 62_genre_palette. Silence: peak **96**, litFrac **1.000**, never dark.
Clip: `~/tmp/h1_chroma/clips/69_harmonic_warmth.html` (sine_sweep, 80f, 2492 colours).

## 70_tonal_shimmer — HELD glow ↔ GRAIN shimmer, crossfaded by tonal stability

**Concept.** `micTonalStabilityRaw` (chroma concentration) crossfades two
textures: HIGH (harmonically held — pad/bassline/lead) → a smooth HELD GLOW (wide
soft breathing bands, almost no grain); LOW (percussive/atonal — drums/hats/noise)
→ a fine fast GRAIN SHIMMER (dense per-pixel sparkle field, true-black gaps). Each
pixel keeps its own stable hash seed so the grain looks like animated noise, not
random flicker. `micChromaFluxRaw` adds a shimmer BURST that re-seeds the grain on
a chord change.

**Signals.** `micTonalStabilityRaw→sliderTonal`, `micChromaFluxRaw→sliderFlux`.

**Reactivity** (titanic). The headline is a TEXTURE change → measured on spatial
VARIANCE. Cross-synth: **bassline (tonal 0.71) → variance 35–66** (held, smoother)
vs **hats/chord_stab (tonal ~0.02–0.06) → variance 61–67** (grain, grittier).
Pinned isolation: **tonal=1 (held) → variance 48.6**, **tonal=0 (grain) →
variance 65.2** (+34% grain energy on percussive material). flux→warmth/brightness
lift on hats 0.44–0.58. Silence: peak **168**, litFrac **1.000**, never dark.
Clip: `~/tmp/h1_chroma/clips/70_tonal_shimmer.html` (full_track, 80f, 6936 colours).

## 71_harmonic_sparkle — glints burst on harmonic CHANGE, coloured by the note

**Concept.** `micChromaFluxRaw` (harmonic-change rate) bursts a scatter of bright
GLINTS across the hull on every chord/harmony move (a quick scintillation that
decays fast); `audioNoteHue` (pitch class → hue) tints both the glints and a calm
base wash so the new chord arrives in its own colour and the rig walks the colour
wheel with the melody. The note hue EASES (shortest-path wrap) so the base colour
glides without strobing; the glint burst is sharp so changes pop. Base wash sits
mostly on the note colour (strong tint 0.62–0.90) so the rig hue tracks the note
clearly — the tight-tracking fix from 63_note_color.

**Signals.** `micChromaFluxRaw→sliderSparkle`, `audioNoteHue→sliderNoteHue`.

**Reactivity** (titanic). full_track: **corr(chromaFlux, totBri) = 0.36**
(REACTIVE — glint burst raises brightness on chord change) + **corr(chromaFlux,
variance) = 0.52** (the scatter raises spatial variance — the glint signature).
Pinned glint: sparkle=0 → peak 50, variance 15.9 (calm wash); **sparkle=1 → peak
255, variance 95.6, total ≈ doubles** (bright scattered burst). Pinned note→hue:
note 0.20→rigHue 0.236, 0.40→0.447, 0.60→0.606, 0.80→0.761 — clean monotonic
near-identity tracking (0.00→0.95 is the correct red wrap). Silence: peak **100**,
litFrac **1.000**, never dark. Clip:
`~/tmp/h1_chroma/clips/71_harmonic_sparkle.html` (full_track, 80f, 7058 colours).

## 72_chroma_phrase_bloom — structural bloom, coloured + surfaced by chroma

**Concept (chroma + structure combo).** A bloom that grows across the musical
phrase, with the harmony deciding its colour and texture, so two builds look
different. PHRASE (`audioPhrasePhase` 0→1) expands the lit core to full coverage
across the 8-bar phrase (you can see the wrap coming); TILT sets bloom TEMPERATURE
(dark→cool, bright→warm); TONAL sets bloom SURFACE (held→smooth glow, percussive→
fine grain).

**PIVOT (honest, per "retune or drop, don't stop").** The original concept was a
**climax** combo, but this slice's parent branch (post Wave-E) gates `audioClimax`
hard and it reads **0.00 on the entire synth bank here — verified on
65_climax_hold itself**, not my pattern's fault. I pivoted the structural driver
to `audioPhrasePhase`, which fires strongly (corr 0.90), keeping the "big look
that builds" intent on a signal that actually moves; renamed the file
`72_chroma_climax_bloom`→`72_chroma_phrase_bloom`. The three chroma signals are
unaffected and carry the colour/texture.

**Signals.** `audioPhrasePhase→sliderPhrase`, `micChromaTiltRaw→sliderWarmth`,
`micTonalStabilityRaw→sliderTonal`.

**Reactivity** (titanic, full_track 600f). Headline: **corr(audioPhrasePhase,
totBri) = 0.82** (REACTIVE — bloom grows with the phrase, peak rises 96k→190k)
+ corr→variance 0.76. Chroma axes proven pinned (at full bloom): tilt warmth=0→
R/(R+B) 0.127 (cool) vs warmth=1→0.436 (warm); tonal held(1)→variance 53.1 vs
grain(0)→variance 68.8 (+30%). Silence: peak **124**, litFrac **1.000**, never
dark. Clip: `~/tmp/h1_chroma/clips/72_chroma_phrase_bloom.html` (full_track, 75f,
2607 colours).

---

## Proof summary

| # | pattern | signals used | headline reactivity | silence (titanic) | dry-run |
|---|---|---|---|---|---|
| 69 | harmonic_warmth | micChromaTiltRaw, micChromaFluxRaw | **chromaTilt→warmth 0.85** (sine_sweep); flux→bri 0.67 | peak 96, lit 1.000 | exit 0 |
| 70 | tonal_shimmer | micTonalStabilityRaw, micChromaFluxRaw | tonal: variance **48.6(held)→65.2(grain)** pinned | peak 168, lit 1.000 | exit 0 |
| 71 | harmonic_sparkle | micChromaFluxRaw, audioNoteHue | **flux→bri 0.36 / →variance 0.52**; note→hue monotonic | peak 100, lit 1.000 | exit 0 |
| 72 | chroma_phrase_bloom | audioPhrasePhase, micChromaTiltRaw, micTonalStabilityRaw | **phrase→bri 0.82**; tilt→warmth + tonal→surface pinned | peak 124, lit 1.000 | exit 0 |

All four: COMPILE_OK, ANIMATING, silence-safe (peak ≥96/255, litFrac 1.000, never
dark), registered in `patterns/manifest.json` (72 entries), real-engine
`--dry-run` exit 0, `npm run check:rainbow` OK. Clips embed rich animated non-black
colour (2492–7058 unique colours per clip). Clean `git status` (4 patterns +
manifest only; no states/ or node_modules residue).

## Notes / follow-ups
- **Promote the chroma mirror into `tools/pattern_derived_harness.mjs`** (3 lines:
  mirror `a.tonalStability/chromaFlux/chromaTilt` → `micTonalStabilityRaw/
  micChromaFluxRaw/micChromaTiltRaw` after the `micSubRaw` write, identical to
  `engine.js:1511`). Without it the committed harness CANNOT validate any chroma
  pattern (reads flat 0). Out of this pattern-only slice's ownership; flagged.
- `audioClimax` is dead on the deterministic synth bank in this branch (Wave-E
  gating). Any future climax pattern needs a live mic / real-audio HIL to validate;
  `audioPhrasePhase` is the reliable structural-build proxy on the synth bank.
- On `silence` the analyzer noise-floor makes `micChromaTiltRaw` read ~0.78 and
  `micTonalStabilityRaw` ~0.03 (artifacts); patterns stay solidly lit regardless
  (floor is brightness-driven, not signal-driven), so the silence look is calm and
  welcoming, never dark.
