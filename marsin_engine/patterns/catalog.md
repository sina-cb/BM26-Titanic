# Pattern Catalog — `marsin_engine/patterns/` (top dir)

Status of every top-level show pattern: identity, cross-model coverage, and
**remaining issues**. Generated 2026-06-19 from the offline harness
(`tools/pattern_audio_harness.mjs`) on the four rigs.

**Gate thresholds** (skill `12_highdef_pattern_generation.md` §0): `peak ≥ 200`
(high-def brightness), PRIMARY `micLow→brightness corr ≥ 0.5` (audio-reactive),
`hueSpread ≥ 0.10` (two colours), lights every rig, silence-safe.

- `peak` / `hueSpread` / `corr` measured on **test_bench** (corr on `kick_4floor`,
  `micLow:sliderLevel`). `titanic` = pixels lit / 970.
- **corr caveat:** kick-gated patterns (heartbeat/dancers/swipe) react via
  kick / position, not `micLow→brightness`, so a low corr there is *by design*,
  not a defect — flagged as such below.
- **Cross-model:** the dark/partial **self-filter bug is fixed** (commit
  `fc16e87`). The remaining cross-model items are tracked in Notion:
  <https://app.notion.com/p/3847fd75b80081268cbfd9081359b2b4>
  (④ vintage-blinder accent fires only where `sectionId==2` exists; ⑤ some
  patterns under-fill a larger rig footprint). Session report:
  `.agent/02_reports/202606/20260619_1_highdef_patterns_session.md`.

---

## A. Production-ready — the tuned core (00–25)

Put through the full ground-rule + white tuning this session. All
`peak ≥ 231`, strong corr, silence-safe, light every rig.

| # | Pattern | Identity | titanic | Remaining issue |
|---|---|---|---|---|
| 00 | golden_hour_wash | Signature vintage-blinder warm wash | 970 | ④ blinder accent off-test_bench |
| 01 | cylon_sweep | Red beam sweeping side to side | 970 | ④ |
| 02 | phase_cathedral | Per-section strict cp1↔cp2 phase field | 970 | ④ |
| 03 | dual_axis_crush | Beams collapse from both edges to centre | 762 | ⑤ partial titanic (geometry) |
| 04 | beat_folded_helix | Pseudo-3D helix tunnel | 466 | ⑤ partial titanic; corr 0.83 (kick) |
| 05 | orbital_attractor_field | Nearest-attractor focus field | 970 | ④ |
| 06 | neon_elevator | Light "car" riding the vertical stack | 970 | ④ |
| 07 | shimmer | Warm breathing wash + travelling glints | 970 | ④ |
| 08 | ocean_liner | Dark water wash + porthole flares | 970 | — |
| 09 | cyclone | Swirling bright confetti storm | 970 | ④ |
| 10 | chasers | Comet-head→tail chasers | 970 | — |
| 11 | bioluminescence | cp1 swell + sharp cp2 crests + UV | 760 | ⑤ partial titanic |
| 12 | breathing | Whole-rig inhale/exhale + white spark | 970 | ④ |
| 13 | sparkle | Two-colour wash + white-hot sparkles | 970 | ④ |
| 14 | lunar_current | Wide smooth moonlit currents | 970 | — |
| 15 | silk_prism_ribbons | Satin ribbons sliding through the rig | 970 | — |
| 16 | ghost_tide_uv | UV ghost-tide foam wash | 970 | — |
| 17 | rolling_color_dunes | Incommensurate quasi-crystal dunes | 970 | ④ |
| 18 | deep_space_lattice | Crossed interference lattice | 970 | — |
| 19 | swaying_lattice_ballet | Corps-de-ballet counter-sway | 970 | ④ |
| 20 | parametric_sway_field | Soft glowing dancing nodes | 957 | — |
| 21 | pelagic_manta_rays | Manta silhouettes gliding | 970 | — |
| 22 | abyssal_sway_garden | Vertical fronds swaying | 970 | ④ |
| 23 | prismatic_strange_attractors | Orbiting gravity wells | 970 | dark-space vs corr trade-off (operator decision) |
| 24 | chromatic_murmuration | Flock-attractor murmuration | 970 | — |
| 25 | heartbeat | lub-DUB double-pulse + blinder | 970 | ④; corr n/a (kick-gated) |

---

## B. HD batch — NEEDS the ground-rule tuning pass (26–58)

These were authored in an earlier "HD batch" and **never went through the
00–25 ground-rule/white tuning**. They light (cross-model fixed), but most miss
the brightness and/or audio-reactivity bars. **This is the recommended next
work phase** — same playbook as 00–25.

Legend: 🔴 dim (`peak<200`) · 🔵 weak audio (`corr<0.5`, not kick-gated) ·
🟣 `hueSpread<0.10` · ⚫ near-dark/broken · 🟢 meets bars.

| # | Pattern | Identity | peak | corr | titanic | Remaining issue |
|---|---|---|---|---|---|---|
| 26 | dom_dancers_chevron | Two dancers + spiral filigree | 246 | 0.14 | 970 | 🟢 corr n/a (kick-gated) |
| 27 | swipe | Unified physical-ordinal swipe | 253 | −0.05 | 142 | 🟢 swipe (audio via swipePos); sparse/frame |
| 28 | spectrum_bloom | Per-band fixture/axis bloom | 59 | −0.02 | 970 | 🔴🔵 dim + weak audio |
| 29 | kick_shockwave | Expanding kick rings | 44 | 1.00 | 874 | 🔴 dim (corr great) |
| 30 | bass_comet | Comet sweep + trail | 242 | motion | 80 | 🟢 bass→MOTION primary (brightness corr n/a); lit+animating |
| 31 | strobe_lattice | Crisp strobing node lattice | 151 | 0.70 | 221 | 🔴 dim; sparse titanic |
| 32 | caustic_shimmer | Layered caustic interference | 255 | −0.04 | 970 | 🔵 weak audio |
| 33 | aurora_breath | Vertical aurora ribbons | 218 | 0.67 | 970 | 🟢 brightness decoupled; breathing |
| 34 | moire_interference | Two-grid moiré beat | 255 | 0.97 | 964 | 🟢 |
| 35 | sparkle_rain | Downward-drifting glints | 212 | 0.54 | 970 | 🟢 micLow level PRIMARY + kick; idle a touch dim |
| 36 | orbital_pulse | Tight glow around orbiting wells | 255 | 0.14 | 970 | 🔵 weak audio |
| 37 | chevron_chase | Sharp V-arrow chase | 240 | 0.29 | 970 | 🔵 weak-ish audio |
| 38 | prism_helix | Crisp bright helical arms | 255 | 0.95 | 970 | 🟢 |
| 39 | tide_riser | Foam crest above a rising waterline | 255 | −0.05 | 970 | 🔵 weak audio |
| 40 | lissajous_weave | Lissajous core over black | 192 | 0.99 | 757 | 🔴 just-dim; ⑤ partial |
| 41 | reaction_diffusion | Gray-Scott reaction-diffusion | 223 | 1.00 | 970 | 🟢 |
| 42 | phyllotaxis_spiral | Sunflower phyllotaxis packing | 167 | 0.11 | 970 | 🔴🔵 |
| 43 | golden_hour_pulse | Warm sunset wash pulse | 255 | 0.65 | 970 | 🟢 max-react (dark idle by choice) |
| 44 | biolume_swell | Biolume swell + UV | 221 | −0.02 | 970 | 🔵🟣 |
| 45 | manta_drift | Single manta wingspan gliding | 176 | 0.09 | 970 | 🔴🔵 |
| 46 | abyssal_fronds | Irrational-phase swaying fronds | 255 | 0.60 | 970 | 🟢 brightness decoupled; spatial breath |
| 47 | quasicrystal_dunes | 5-wave quasicrystal interference | 186 | 0.10 | 970 | 🔴🔵 |
| 48 | heartbeat_drive | micLow-driven resting muscle | 12 | 0.13 | 970 | ⚫ near-dark (peak 12) |
| 49 | cylon_crush | Cylon+crush amalgam | 180 | 0.90 | 829 | 🔴 just-dim (corr great) |
| 50 | phase_cathedral_hd | Irrational node lattice | 231 | 0.65 | 970 | 🟢 levelMul anchor; dark idle |
| 51 | confetti_cyclone | Sparks over true black | 58 | −0.05 | 420 | 🔴🔵; sparse titanic |
| 52 | silk_ribbons | Crisp-core silk ribbons | 93 | 0.06 | 970 | 🔴🔵 |
| 53 | neon_elevator_hd | Tall elevator shaft bottom→top | 141 | 0.82 | 970 | 🔴 dim (corr good) |
| 54 | murmuration_storm | Flock density field | 255 | 0.39 | 835 | 🟢 flash seam fixed (Δ 38×→6.7×); corr kick-gated |
| 57 | ink_diffuse | Dye blooms diffusing in water | 255 | 0.09 | 970 | 🔵🟣 |
| 58 | lighthouse_solo | Single far-field lighthouse sweep | 122 | −0.11 | 485 | 🔴🔵; sparse by design |

*(No 55/56 in the top dir.)*

**Tuned in the 2026-06-19 review pass (now 🟢, removed from the worklist below):**
`30_bass_comet` (bass→motion), `33_aurora_breath`, `35_sparkle_rain`,
`43_golden_hour_pulse` (max-react/dark idle), `46_abyssal_fronds`,
`50_phase_cathedral_hd` (dark idle), `54_murmuration_storm` (flash seam fixed).

### Priority within batch B (remaining)
1. **⚫ near-dark (invisible — fix first):** `48_heartbeat_drive`.
2. **🔴 dim with GOOD audio (just need brightness):** `29`, `49`, `53`, `40`, `41`(ok), `31`.
3. **🔵 bright but not audio-reactive (need a real PRIMARY mapping):** `32`, `36`, `39`, `44`, `57`.
4. **🔴🔵 both (full tuning pass):** `28`, `42`, `45`, `47`, `51`, `52`, `58`.
5. **🟢 already good:** `34`, `38`, `41`, plus kick-gated `26`, `29`(after brightness), swipe `27`.

---

## C. Summary
- **00–25:** production-ready (tuned + white + cross-model). Remaining = the
  deferred ④/⑤ Notion items + the `23` dark-space operator decision.
- **26–58:** lights every rig now, but **~25 patterns miss the brightness/audio
  bars** and 2 are near-dark — they need the same ground-rule tuning pass as
  00–25. That is the clear next phase; this table is its worklist.
