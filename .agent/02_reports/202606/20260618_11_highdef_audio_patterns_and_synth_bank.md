# 2026-06-18 — High-def audio-reactive patterns + Companion test-synth bank

**Branch:** `claude/highdef-audio-patterns` (off latest `main` 2fc8e0c)
**Author:** developer agent (orchestrated a 5-at-a-time sub-agent fleet)

## What shipped

### 1. Audio-synthesizer bank (a project deliverable)
`marsin_engine/audio/synth/test_synths.js` — a dependency-free bank of 11
deterministic test synthesizers (pure function of sample index, so captures are
reproducible): `tone, kick_4floor, bassline, hats, chord_stab, riser, edm_drop,
full_track, sine_sweep, white_noise, silence`. Each `sample(n,SR,p)` returns a
float in [-1,1]; `fillFrame(buf,name,cursor,SR,params)` fills an Int16 frame.

Verified through the **real** `AudioAnalyzer`: kick_4floor fires `micKick`,
bassline → `micLow`, hats → `micHigh`, chord_stab → `micMid`, riser →
`micFlux`, silence → no kicks (gate holds).

### 2. Wired into the Audio Companion test mode
`audio/companion/companion_server.js` now delegates its `test` source to the
bank (`source.synth`, default `tone` = unchanged), exposes the synth list on
`/catalog` + the WS `hello`, and accepts a `setSource {synth}` selection (unknown
values rejected — no silent fallback). The UI (`ui/companion_app.js` + `.css`)
gains a themed **SYNTH dropdown** in test mode. Test: the operator picks a
synthesizer and the real DSP/meters/modulations react — no mic needed.

### 3. Offline pattern-audio test harness (reusable tool)
`marsin_engine/tools/pattern_audio_harness.mjs` — runs
`synth → real AudioAnalyzer → modulation(source→slider) → MarsinVM render →
capture JSON (+ assertions)`. Pairs with `tools/make_vis_clip.mjs` for a widget.
This is how every pattern below was validated end-to-end through the genuine
DSP (no engine boot, no ports), and how future patterns should be checked.

### 4. Fourteen high-def, audio-reactive patterns (modulators-only)
Each amalgamates ideas from the 00–25 core set, is high-contrast / high-def
(crisp cores, true-black negative space, never fully dark when silent), and
exposes `slider*` controls with documented `MODULATE <slider> <- <signal>`
mappings (never reads audio natively — repo contract, per 27_swipe).

| # | name | concept (amalgam) | headline reactivity |
|---|---|---|---|
| 28 | spectrum_bloom | 3-band spectrum→space (02+13) | micLow→bars, corr 0.97 |
| 29 | kick_shockwave | expanding ring on kick (25+03+65) | micKick fires; micLow corr 0.89 |
| 30 | bass_comet | comet w/ feedback tail (01+10+27) | micLow corr 0.73 |
| 31 | strobe_lattice | kick-gated lattice (18+04) | micLow corr 0.78; kick flashes |
| 32 | caustic_shimmer | caustics + glints (14+16+07) | micHigh corr 0.57 (hats) |
| 33 | aurora_breath | breathing aurora (00+11+15) | micLow corr 0.98 |
| 34 | moire_interference | crisp moiré (02+19+20) | micLow corr 0.76 |
| 35 | sparkle_rain | falling glints (13+07+24) | micHigh corr 0.59 |
| 36 | orbital_pulse | gravity wells (05+23) | micLow corr 0.40/0.60 |
| 37 | chevron_chase | beat-stepped chevrons (06+10+26) | micLow corr 0.80; kick steps |
| 38 | prism_helix | rotating helix tunnel (04+09+17) | micLow corr 0.41 |
| 39 | tide_riser | build/drop water level (16+12+22) | micFlux→tide, corr 0.45 |
| 57 | ink_diffuse | ink-in-water feedback buffer (14+11+13) | micHigh corr 0.88 |
| 58 | lighthouse_solo | far-field single beam (01+51+115) | micLow corr 0.65/0.86 |

All compile (offline harness + a real-engine `--dry-run` smoke on 28), animate,
cover the rig, render safely on `--synth silence`, and registered in
`patterns/manifest.json`.

## How to test a pattern with a synth
```bash
cd marsin_engine
node tools/pattern_audio_harness.mjs --pattern patterns/28_spectrum_bloom.js \
  --synth full_track --mod micLow:sliderLow,micMid:sliderMid,micHigh:sliderHigh \
  --out ~/tmp/vis.json
node tools/make_vis_clip.mjs --in ~/tmp/vis.json --out ~/tmp/clip.html
```
Or live: pick the synth in the Companion test-mode dropdown and watch the meters
/ a modulation drive the pattern.

## Validation status
- Companion test suite: **67 pass / 0 fail** (incl. new `companion_test_synths.test.js`).
- Engine `--dry-run` on a new pattern: loads + compiles OK.
- Each pattern: COMPILE_OK, ANIMATING, ≥1 REACTIVE modulation, silence-safe.

## Notes / follow-ups
- Widgets were delivered to the operator as standalone HTML (the `show_widget`
  MCP tool wasn't connected this session); they render the real per-pixel output
  via `make_vis_clip`.
- `31_strobe_lattice` reads dim on the `edm_drop` *build* window (kicks only fire
  in the drop); fine on `kick_4floor`. A brightness-floor tune is a possible polish.
- These are tuned/validated on `test_bench` (52 px); all are coordinate-driven so
  they port to the real rig, but re-check coverage on the finalized Titanic model.
