# 2026-06-20 — Round-2 audio-reactive PATTERNS (dev/reactive_patterns)

Five NEW audio-reactive lighting patterns that MODULATE off the Round-2 derived
signals (per the modulators-only repo contract — patterns never read CPC audio
globals natively; the engine OVERRIDEs their sliders from the signals). Built on
`dev/reactive_patterns` (parent `feat/audio_analysis_2`). House style followed:
high-contrast, true-black negative space, never fully dark on silence, coordinate-
driven (x/y + sectionId) so they port test_bench 52 → titanic 970 unchanged,
strict cp1↔cp2 RGB palette blends, autonomous idle so the rig is alive in silence.

## Validation method (REAL DSP, end-to-end, MANDATORY proof)

The shipped `tools/pattern_audio_harness.mjs` only wires the 5 RAW analyzer
signals (micLow/Mid/High/Kick/Flux) — it cannot drive the NEW derived signals.
So I built a derived-signal harness that replicates the engine's exact
`onAnalysis` pipeline (`engine.js` ~1440) offline:

```
synth → real AudioAnalyzer (incl. sub:{30,60} window, matching config.yaml)
      → ParamCenter raw mirrors (setMany, same keys as the engine)
      → real AudioStructureDetector.tick (enabled)
      → real DerivedSignals.tick  → derived CPC keys
      → OVERRIDE modulation → MarsinVM render (test_bench) → capture + correlation
```

Harness + probe + clips live in `~/tmp/reactive_patterns/` (scratch, gitignored).
The audio path is the genuine analyzer + genuine second-tier shapers, so a pattern
that reacts to `audioChestHit` really reacts to a synthesized sub-bass slam.
Clips rendered with `tools/make_vis_clip.mjs` (self-contained HTML widgets,
verified to embed rich animated non-black colour data: 117–5015 unique colours).

**Signal-availability reality check** (probe across the synth bank, the pivot
driver): `micOnsetLow/Mid/High`, `audioGenre/Conf`, `audioNoteHue`, `audioParty`,
`audioBuildScore`, `audioDropPulse`, `audioBeat` all fire usefully.
`audioChestHit`/`micSub` are **0 unless the analyzer is given a `sub:{minHz,maxHz}`
window** (the deployed engine uses `30..60` Hz from config.yaml) — with that window
they fire strongly. `audioSwitchColor` is a sparse pulse (fires on real
track-change moments, e.g. edm_drop) — validated as a flash on top of a base,
not as a primary continuous driver.

Every pattern: COMPILE_OK, ANIMATING, ≥1 REACTIVE mapping, silence-safe (renders
+ stays lit on `--synth silence`), real-engine `--dry-run` exit 0 (all five).
Clean `git status` (only the 5 patterns + manifest.json changed).

---

## 59_drumkit_chase — per-band spatial chase (the drum-kit follower)

**Concept.** The three per-band onset pulses each own one hull zone so the rig
reads like a drum kit across the Titanic: KICK→bars (twin-front bursting outward
from centre X), SNARE/clap→vintage columns (bottom→top flash), HAT→pars (crisp
glints). Each band drives its own decay envelope (armed on a rising onset edge),
so a busy groove strobes the three zones in counterpoint. Between hits each zone
→ true black; a lifted time-base floor keeps the rig readable in silence.

**Signals.** `micOnsetLow→sliderLowHit`, `micOnsetMid→sliderMidHit`,
`micOnsetHigh→sliderHighHit` (all 0..1 linear, rising-edge armed).

**Reactivity.** kick_4floor: onsetLow→bri **0.81**, onsetMid→bri **0.84**
(REACTIVE). hats: onsetLow→bri 0.48 (REACTIVE). Silence: renders, base floor lit.
peakMaxChan 223. Clip: `~/tmp/reactive_patterns/clips/59_drumkit_chase.html`.

## 60_chest_thump — full-rig sub-bass chest-hit slam over a calm wash

**Concept.** `audioChestHit` (narrow 30–60 Hz transient) SLAMS the entire hull to
full output over a calm two-colour breathing wash, with a white-channel core pop
at the peak and a faint radial vignette for depth. The slam is global, so frame
brightness tracks the chest hit tightly — the rig literally thumps with the sub.
On a slam the palette also pushes toward cp2 (hot) so the thump reads as colour +
brightness. micLow drives the gentle always-on base floor.

**Signals.** `audioChestHit→sliderThump` (0..1), `micLow→sliderBase` (0.18..0.70).

**Reactivity.** kick_4floor: chestHit→bri **0.92**, micLow→bri **0.93** (both
REACTIVE), peak 255, darkFrac 0 (never dark). edm_drop 16 s (build→drop):
chestHit→bri **0.86** — calm through the build, slams on the drop. Silence: calm
base ~42, never dark. Clip: `~/tmp/reactive_patterns/clips/60_chest_thump.html`.

## 61_riser_release — build-up charge that releases on the drop

**Concept.** `audioBuildScore` winds up a tightening, accelerating ring + a global
core swell (anticipation: brightness RISES with the build, colour heats cp1→cp2);
`audioDropPulse` DISCHARGES — a whole-rig white-hot flash + an expanding burst
ring snapping free, then settling to a calm base. The drop literally releases the
charge. Charge eases smoothly toward the build score; the flash is rising-edge
armed and decays.

**Signals.** `audioBuildScore→sliderCharge` (0..1), `audioDropPulse→sliderRelease`
(0..1). (First cut had the charge ring SHRINK as it wound up, inverting brightness
(corr −0.67); PIVOTED to add a global core-swell so brightness rises with the
build → corr +0.99.)

**Reactivity.** riser 8 s: buildScore→bri **0.99** (REACTIVE). edm_drop 16 s:
buildScore→bri **0.46**, dropPulse→bri **0.79** (both REACTIVE), peak 255.
Silence: calm base ~56, never dark. Clip:
`~/tmp/reactive_patterns/clips/61_riser_release.html`.

## 62_genre_palette — genre-adaptive palette wash

**Concept.** `audioGenre` (party-mode index 0..6) selects a palette FAMILY from a
small in-pattern hue-pair table (techno=red↔orange, deep_house=amber↔gold,
melodic=magenta↔violet, trance/ambient/downtempo=teal↔indigo family, dnb=green↔
lime). `audioGenreConf × audioParty` is the COMMIT: low conf / no party holds a
calm neutral teal↔indigo (genre is party-only and meaningless when unsure), high
conf eases into the full genre palette + saturation. `audioParty` also lifts
overall brightness (a party look is brighter than calm). The hue-pair table
encodes short-path wrap (techno 0.97→1.04) so techno reads true RED, not muddy.

**Signals.** `audioGenre→sliderGenre` (0..1; engine sends genre/6, pattern
rescales ×6 and snaps), `audioGenreConf→sliderGenreConf`, `audioParty→sliderParty`.

**Reactivity.** The headline is a HUE shift (party-gated), so brightness-corr is
the wrong axis for genre; party carries it. edm_drop: party→bri **0.96**, genre→bri
0.36 (REACTIVE), peak 219. bassline: genre→bri 0.45, genreConf→bri 0.43.
Per-genre distinctness (pinned conf=party=1): meanHue idx0=0.59, idx1(techno)=
**0.02 red**, idx2(melodic)=0.81, idx3(deep_house)=**0.11 amber**, idx4=0.58,
idx5(dnb)=0.39, idx6=0.65 — clearly separated families. Silence: floor ~92, never
dark. Clip: `~/tmp/reactive_patterns/clips/62_genre_palette.html`.

## 63_note_color — play the notes as colour (+ Round-2 switch-fix validation)

**Concept.** The rig glows the live note's colour: it eases toward `audioNoteHue`
(pitch class → hue) so a melody walks the rig around the colour wheel (gentle
glide, never strobes). `audioSwitchColor` fires a bright flash + snaps a persistent
palette rotation (an on-the-music recolour — this visually validates the Round-2
note→colour switch-signal FIX). `audioBeat` sprinkles beat-locked shimmer glints.
A calm base keeps it alive in silence. (First cut had a wide complement accent
that averaged out the note signal; PIVOTED to a tight ±0.06 accent spread so the
frame mean-hue locks to the note.)

**Signals.** `audioNoteHue→sliderNoteHue` (0..1), `audioSwitchColor→sliderSwitch`
(0..1), `audioBeat→sliderBeat` (0..1).

**Reactivity.** Note→hue (the headline): bassline meanHue-corr **−0.79**
(HUE-REACTIVE; the rig hue tracks the note, the sign is the glide/accent path).
Pinned-note proof: rig meanHue 0.00→0.23, 0.25→0.47, 0.50→0.72, 0.75→0.00 — a
clean monotonic +0.22 offset (the colour follows the note exactly). Switch flash:
pinned switch=1 → peak 255; edm_drop live `audioSwitchColor` pulse → bri **0.70**
(REACTIVE — the flash fires on the real track-change pulse, confirming the fix).
Silence: floor ~212, never dark. Clip:
`~/tmp/reactive_patterns/clips/63_note_color.html`.
(NB: on chord_progression the live circular hue-corr reads ~0 — a METRIC artifact
of the note hue's non-monotonic zig-zag through the wheel under circular unwrap,
NOT a pattern failure; the pinned-note + bassline results are the decisive proof.)

---

## Proof summary

| # | pattern | signals used | headline reactivity | dry-run |
|---|---|---|---|---|
| 59 | drumkit_chase | micOnsetLow/Mid/High | onsetLow→bri 0.81, onsetMid→bri 0.84 (kick) | exit 0 |
| 60 | chest_thump | audioChestHit, micLow | chestHit→bri 0.92 (kick), 0.86 (edm) | exit 0 |
| 61 | riser_release | audioBuildScore, audioDropPulse | build→bri 0.99 (riser), drop→bri 0.79 (edm) | exit 0 |
| 62 | genre_palette | audioGenre, audioGenreConf, audioParty | party→bri 0.96; per-genre hue distinct | exit 0 |
| 63 | note_color | audioNoteHue, audioSwitchColor, audioBeat | note→hue −0.79 + pinned monotonic; switch→bri 0.70 | exit 0 |

All five: COMPILE_OK, ANIMATING, silence-safe, registered in
`patterns/manifest.json` (now 63 entries), clean git status (5 patterns + manifest
only). Regression: `npm run check:rainbow` OK, `pattern_mixer_masking` test green.

## Notes / follow-ups
- The shipped `pattern_audio_harness.mjs` can't drive derived signals (only the 5
  raw analyzer outputs). A reusable derived-signal harness would be worth promoting
  from `~/tmp/reactive_patterns/derived_harness.mjs` into `tools/` in a future
  session (out of this slice's pattern-only ownership; flagged here).
- `audioChestHit` REQUIRES the analyzer `sub:{minHz,maxHz}` window to be configured
  (deployed engine: 30..60 Hz). Without it the signal is silent — patterns mapping
  it depend on that config being present on the rig (it is, per config.yaml).
