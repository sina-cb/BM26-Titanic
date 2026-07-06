# HANDOFF — High-def audio-reactive pattern generation (continue here)

**Branch:** `claude/highdef-audio-patterns` (off `main` @ 2fc8e0c)
**Date:** 2026-06-18
**Purpose:** Everything an agent needs to AUDIT/REDO the 14 existing new patterns
and CREATE 15 more, to production grade for the Burning Man show. Read this top
to bottom, then do the work in §6.

---

## 1. What already exists on this branch (committed)

- **Synth bank** `marsin_engine/audio/synth/test_synths.js` — 11 deterministic
  test synthesizers: `tone, kick_4floor, bassline, hats, chord_stab, riser,
  edm_drop, full_track, sine_sweep, white_noise, silence`. Verified to drive the
  real analyzer bands. **A project deliverable — keep it healthy.**
- **Companion test mode** wired to the bank: `audio/companion/companion_server.js`
  (selectable `source.synth`, `/catalog`, WS) + a SYNTH dropdown in
  `audio/companion/ui/*`; test `tests/companion_test_synths.test.js` (suite 67/0).
- **Offline test harness** `marsin_engine/tools/pattern_audio_harness.mjs` —
  `synth → real AudioAnalyzer (the engine DSP) → modulation(source→slider) →
  MarsinVM render → capture JSON + QUALITY/AUDIO_REACT assertions`. It now
  **applies each pattern's declared `export var` defaults**, so offline captures
  show TRUE cp1↔cp2 colours (previously everything rendered red).
- **Widget builder** `marsin_engine/tools/make_vis_clip.mjs` (pre-existing) turns
  a capture JSON into an animated LED widget HTML.
- **14 patterns** (committed, in `patterns/manifest.json`): 28 spectrum_bloom,
  29 kick_shockwave, 30 bass_comet, 31 strobe_lattice, 32 caustic_shimmer,
  33 aurora_breath, 34 moire_interference, 35 sparkle_rain, 36 orbital_pulse,
  37 chevron_chase, 38 prism_helix, 39 tide_riser, 57 ink_diffuse, 58 lighthouse_solo.
- Prior report: `.agent/02_reports/202606/20260618_11_highdef_audio_patterns_and_synth_bank.md`.

## 2. The four PRODUCTION priorities (apply to every pattern)

1. **AUDIO REACTIVITY IS FIRST-CLASS.** Design the pattern *around* the music.
   Expose 2–3 audio-intended `slider*` controls, each driving a DISTINCT visual
   dimension (low→brightness/scale, high→detail/sparkle/colour, kick→a discrete
   event, flux→a build/rise). Document the intended `MODULATE <slider> <- <signal>`
   in the header. **Modulators-only — NEVER read audio globals natively (codex P0).**
   Bar: the PRIMARY continuous mapping measures **corr ≥ 0.5 (REACTIVE)**, and a
   2nd signal visibly drives a different dimension.
2. **USE BOTH PALETTE COLOURS.** cp1 and cp2 defaults must be DISTINCT hues and the
   geometry must employ BOTH across the rig (blend cp1↔cp2 by position/value, or
   assign cp1/cp2 to two physical elements). Bar: **hueSpread ≥ 0.10**.
3. **SOPHISTICATED, NON-REPEATING MATH.** Use incommensurate/irrational ratios
   (√2≈1.41421, √3≈1.73205, φ≈1.61803, golden-angle≈2.39996 rad, distinct primes),
   curl/attractor/Lissajous/standing-wave/phyllotaxis fields, so motion never
   visibly loops. Put the core equation in a header comment. No plain integer periods.
4. **HIGH-DEF + SHOW-BRIGHT.** Crisp cores / true-black negative space (healthy
   `darkFrac` AND `brightFrac` for the concept), bright enough for a big rig:
   **peakMaxChan ≥ 200** at a musical peak. Never fully black in silence (keep a
   small time-based base — mission-critical visibility).

Conventions (from `patterns/27_swipe.js` + `docs/MARSIN_ENGINE_PATTERNS.md`
§2,§4,§7,§9 + `docs/MARSIN_PB_LANG_SPEC.md` §2.4,§6,§9.5): `localSpeed` is the
first slider; reserved-name-safe locals (`kk`, `hv/iv/fv/pv/qv/tv`, `bri`; never
declare `i t h f p q r g b x y z index pixelCount PI PI2`); radians trig (`*PI2`;
`wave/triangle/square` take 0..1 turns); copy `_hsv2rgb1/_hsv2rgb2` and blend in
RGB space; coordinate-driven (x,y,z + optional sectionId/fixtureId/index) so it
ports to the real rig; size feedback buffers with `var N = 52;` (NOT pixelCount).

## 3. How to validate / tune (offline, no engine, parallel-safe)

```bash
cd marsin_engine
node tools/pattern_audio_harness.mjs --pattern patterns/<file>.js \
  --synth <SYNTH> --frames 96 --mod <sig:slider,sig:slider> \
  --out ~/tmp/genkit/out/<file>.json
node tools/make_vis_clip.mjs --in ~/tmp/genkit/out/<file>.json \
  --out ~/tmp/genkit/out/<file>.html --fps 14
```
Synths: tone kick_4floor bassline hats chord_stab riser edm_drop full_track
sine_sweep white_noise silence. Signals: micLow micMid micHigh micKick micFlux.
The harness prints `QUALITY hueSpread=.. darkFrac=.. brightFrac=.. peakMaxChan=..`
and `AUDIO_REACT <sig>-><slider>: corr=.. (REACTIVE|weak)`. **Tune against these.**
Also run `--synth silence` (must render a calm non-black base, no crash). Test on
the synth(s) that best exercise the pattern's signals (kick effects → kick_4floor;
build/flux → edm_drop/riser; highs → hats).

**Acceptance (ALL):** COMPILE_OK; ANIMATING; hueSpread ≥ 0.10; primary corr ≥ 0.5;
peakMaxChan ≥ 200 (not DIM); sensible dark/bright; silence-safe; widget builds.

## 4. AUDIT of the existing 14 (corrected harness, what to FIX in redo)

| # | name | hueSpread | peak | verdict / fix |
|---|---|---|---|---|
| 28 | spectrum_bloom | 0.28 | 206 | OK — light polish only |
| 29 | kick_shockwave | 0.22 | 147 | **DIM** — lift ring/peak ≥200 |
| 30 | bass_comet | 0.19 | 199 | borderline dim — lift head ≥210 |
| 31 | strobe_lattice | 0.16 | 177 | **DIM** — brighten nodes a lot |
| 32 | caustic_shimmer | **0.00** | 255 | **MONO** — cp1/cp2 too close; make hues distinct & span both |
| 33 | aurora_breath | **0.00** | 190 | **MONO + dim** — distinct cp1/cp2, brighter |
| 34 | moire_interference | **0.03** | 239 | **MONO** — colour the two grids cp1 vs cp2 |
| 35 | sparkle_rain | 0.75 | 235 | OK |
| 36 | orbital_pulse | **0.02** | 255 | **MONO** — wells alternate cp1/cp2 |
| 37 | chevron_chase | 0.35 | 182 | dim — lift ≥200 |
| 38 | prism_helix | 0.96 | 189 | dim — lift ≥200 |
| 39 | tide_riser | **0.04** | 255 | **MONO** — water cp1, foam cp2 (distinct) |
| 57 | ink_diffuse | **0.00** | 177 | **MONO + dim** — ink cp2 vs water cp1, brighter |
| 58 | lighthouse_solo | 0.79 | 226 | OK |

Mono-colour offenders (highest priority): 32, 33, 34, 36, 39, 57. Dim: 29, 30,
31, 33, 37, 38, 57. Redo each to clear ALL four §2 bars; re-run the harness to
prove hueSpread ≥ 0.10 and peakMaxChan ≥ 200.

## 5. The 15 NEW patterns to create (numbers 40–54 are free)

All must meet §2. Suggested concept + math + audio map + best test synth:

| # | name | concept / NON-REPEATING math | audio map (MODULATE) | synth |
|---|---|---|---|---|
| 40 | lissajous_weave | Lissajous x,y at √2:√3 freqs, 2-colour along the curve | low→amplitude, high→detail, kick→phase-jump | full_track |
| 41 | reaction_diffusion | Gray-Scott-ish feedback buffer (N=52), 2-colour by concentration | mid→feed rate, kick→seed | full_track |
| 42 | phyllotaxis_spiral | golden-angle (2.39996) seed spiral, 2-colour by ring parity | low→bloom radius, high→twinkle | full_track |
| 43 | curl_flow | curl-noise flow field advecting a feedback buffer, 2-colour by direction | bass→flow speed, high→spawn | bassline |
| 44 | standing_wave | sum of prime-harmonic sines (3,5,7,11), 2-colour node/antinode | level→amplitude, kick→mode jump | full_track |
| 45 | voronoi_drift | moving Voronoi cells (irrational drift), 2-colour by cell parity | kick→reseed, low→brightness | edm_drop |
| 46 | interference_rings | two off-centre radial sources, irrational freq → moiré rings, 2-colour by phase | bass→source strength, mid→ring freq | full_track |
| 47 | chladni_plate | sum of cos modes (Chladni nodal), 2-colour by field sign | mid→mode index, level→brightness | full_track |
| 48 | dna_helix | double helix: strand A=cp1, strand B=cp2 (guaranteed 2-colour), golden twist | low→glow, high→rungs, kick→pulse | full_track |
| 49 | rose_epicycle | rose/epicycle curve with irrational k, 2-colour head/tail | high→petal detail, low→size | full_track |
| 50 | plasma_field | classic plasma: Σ sin(irrational freqs)+radial, 2-colour mapped | bass→warp, high→shimmer | full_track |
| 51 | comet_swarm | N comets on golden-angle phases, feedback tails, 2-colour by parity | bass→count/speed, kick→burst | full_track |
| 52 | ripple_lattice | droplet impacts → decaying radial waves on a lattice (feedback), 2-colour crest/trough | kick→drop, low→brightness | kick_4floor |
| 53 | spectral_bars | literal per-band VU bars across rig zones (low/mid/high), 2-colour by band | micLow/mid/high → bar heights | full_track |
| 54 | fourier_tide | multi-octave noise curtains, 2-colour vertical gradient | flux→height, high→shimmer, kick→crest | edm_drop |

(Names/numbers are suggestions; keep them distinct from 00–39, 57, 58 and from
each other. Register every new file in `patterns/manifest.json`.)

## 6. The work, in order

1. **Audit/redo the 14** (§4). 5 at a time via sub-agents (one pattern each), each
   running the harness loop in §3 until all §2 bars pass. Prioritise the mono +
   dim offenders.
2. **Create the 15 new** (§5). Same 5-at-a-time pattern.
3. After each pattern is accepted: write the `.js` in `patterns/`, add it to
   `manifest.json`, leave the capture JSON in `~/tmp/genkit/out/<file>.json`.
4. **Sanity:** `cd marsin_engine && node --test tests/companion_*.test.js` stays
   green; spot-check one new pattern loads in the real engine:
   `node engine.js --pattern <file> --model test_bench --dry-run` (then
   `git restore states/ simulation/`).
5. **Commit + push** to `claude/highdef-audio-patterns` in batches (patterns +
   manifest). Do NOT open a PR unless Sina asks. Use the repo commit-message
   footers.

## 7. Reviewing the widgets (operator note)

The `show_widget` inline tool is a **built-in of the interactive Claude Code
client (desktop/terminal), not an MCP server** — it is NOT available in the web
sandbox (confirmed: `claude mcp get visualize` → not found; cloud has only
`claude_design`). To review patterns as inline widgets, run a session on this
branch from the **desktop app or terminal**, then per skills `07_pixel_vis_clips`
/ `08_visualize_patterns_widget`: build a capture (the offline harness in §3 is
now colour-correct, or `tools/capture_vis.mjs` against a live engine for the
operator's global palette) → `make_vis_clip` → `show_widget`. In the web sandbox,
deliver captures/HTML as files instead.

## 8. Gotchas (already learned)
- Offline standalone host does NOT auto-apply control defaults — the harness now
  does (palette + identity sliders). If a pattern uses a transformed slider
  (`x = 0.1 + v*0.8`), the harness sets the var default directly which may differ;
  prefer identity sliders or verify.
- The LIVE engine applies a GLOBAL palette that overrides per-pattern cp1/cp2, so
  "use 2 colours" = the geometry must span both ends regardless of the actual hues.
- `pixelCount` compiles to a literal (~144); never size buffers with it.
- After any engine boot, `git restore marsin_engine/states/ simulation/`.
