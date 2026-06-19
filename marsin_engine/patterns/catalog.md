# Pattern Catalog — `marsin_engine/patterns/`

Status of every top-level show pattern: a **test_bench preview GIF**, identity,
brightness/audio metrics, cross-model coverage, and remaining issues. This is a
multi-page catalog: this page is the index, and each linked page below covers a
group of 5 patterns with their animated previews.

**Patterns 00–25 are now updated and high-def** — they went through the full
ground-rule + white tuning pass (high-def brightness, audio-reactive PRIMARY,
two-colour, silence-safe, light every rig). Patterns 26–58 are the HD batch;
several still need that pass (see each group's status + the worklist below).

**How this is built (for the next agent):** the source of truth is
`catalog_data.json` (one entry per pattern). Edit it and run
`node tools/gen_catalog.mjs` to regenerate this index + the group pages. The
preview GIFs come from `node tools/gen_pattern_gifs.mjs` (test_bench widget
layout → `patterns/gifs/NN.gif`). Full spec:
`.agent/00_gol/15_pattern_catalog.md`.

**Gate thresholds** (skill `12_highdef_pattern_generation.md` §0): `peak ≥ 200`
(high-def brightness), PRIMARY `micLow→brightness corr ≥ 0.5` (audio-reactive),
`hueSpread ≥ 0.10` (two colours), lights every rig, silence-safe. `peak`/`corr`
measured on **test_bench**; `titanic` = pixels lit / 970. Kick-gated patterns
(heartbeat/dancers/swipe) react via kick/position, so a low `corr` there is *by
design*.

## Pages

- [Patterns 00–04](catalog/00-04.md) — golden_hour_wash, cylon_sweep, phase_cathedral, dual_axis_crush, beat_folded_helix
- [Patterns 05–09](catalog/05-09.md) — orbital_attractor_field, neon_elevator, shimmer, ocean_liner, cyclone
- [Patterns 10–14](catalog/10-14.md) — chasers, bioluminescence, breathing, sparkle, lunar_current
- [Patterns 15–19](catalog/15-19.md) — silk_prism_ribbons, ghost_tide_uv, rolling_color_dunes, deep_space_lattice, swaying_lattice_ballet
- [Patterns 20–24](catalog/20-24.md) — parametric_sway_field, pelagic_manta_rays, abyssal_sway_garden, prismatic_strange_attractors, chromatic_murmuration
- [Patterns 25–29](catalog/25-29.md) — heartbeat, dom_dancers_chevron, swipe, spectrum_bloom, kick_shockwave
- [Patterns 30–34](catalog/30-34.md) — bass_comet, strobe_lattice, caustic_shimmer, aurora_breath, moire_interference
- [Patterns 35–39](catalog/35-39.md) — sparkle_rain, orbital_pulse, chevron_chase, prism_helix, tide_riser
- [Patterns 40–44](catalog/40-44.md) — lissajous_weave, reaction_diffusion, phyllotaxis_spiral, golden_hour_pulse, biolume_swell
- [Patterns 45–49](catalog/45-49.md) — manta_drift, abyssal_fronds, quasicrystal_dunes, heartbeat_drive, cylon_crush
- [Patterns 50–54](catalog/50-54.md) — phase_cathedral_hd, confetti_cyclone, silk_ribbons, neon_elevator_hd, murmuration_storm
- [Patterns 57–58](catalog/57-58.md) — ink_diffuse, lighthouse_solo

## Legend (batch B status)
🔴 dim (`peak<200`) · 🔵 weak audio (`corr<0.5`, not kick-gated) · 🟣 `hueSpread<0.10` · ⚫ near-dark/broken · 🟢 meets bars.

## Summary
- **00–25:** production-ready (tuned + white + cross-model) — updated & high-def.
- **26–58:** lights every rig, but several patterns still miss the brightness/audio
  bars and need the same ground-rule pass. The per-group status flags the worklist.
- Cross-model ④/⑤ items + the `23` dark-space decision are tracked in Notion.

*(No 55/56 in the top dir — the sequence is 00–54, 57, 58.)*
