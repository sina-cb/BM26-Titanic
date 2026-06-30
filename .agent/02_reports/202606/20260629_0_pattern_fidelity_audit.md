# 2026-06-29 — Pattern fidelity audit: og_patterns → patterns (00–25)

**Trigger:** operator reported `00_golden_hour_wash` regressed — white no longer
moves and the wash is "frozen or very slow" at steady state. Question: did the
high-def rewrite (branch `feat/highdef_patterns`, "7 consistency ground rules")
preserve the ORIGINAL visuals and only ADD parameters, or did it drift?

**Method:** 5 parallel sub-agents, ~5 patterns each. For every pattern:
side-by-side code read of `beforeRender`/`render3D` in `og_patterns/NN.js` vs
`patterns/NN.js`, plus the offline harness (`tools/pattern_audio_harness.mjs`,
test_bench) at silence + a real synth with a custom **per-pixel frame-to-frame
motion** metric (the built-in `ANIMATING` flag only tracks *total-rig*
brightness variance, which the HD rewrites deliberately hold flat — it misses
spatial motion). READ-ONLY: no pattern files were edited; `og_patterns/`
untouched. Harness left expected `marsin_engine/states/**` + `simulation/`
runtime residue (not committed, not reverted).

---

## Verdict table

| # | Pattern | Verdict | Steady-state motion (og→cur) | Primary drift |
|---|---|---|---|---|
| 00 | golden_hour_wash | **DRIFTED** | 9.81 → 0.20 | rate ~2.5× slow + white static |
| 01 | cylon_sweep | FAITHFUL | self-advances | — |
| 02 | phase_cathedral | FAITHFUL* | self-advances | *brightness floor fills black nodes |
| 03 | dual_axis_crush | FAITHFUL* | 3.19 (anim) | *`level²` dims default |
| 04 | beat_folded_helix | **DRIFTED** | 30.75 → 0.77 | rate ~20× slow + white throttled |
| 05 | orbital_attractor_field | DRIFTED | slower | orbit rate too low |
| 06 | neon_elevator | DRIFTED | OK | shaft wash fills black + cp2 blue→magenta |
| 07 | shimmer | DRIFTED | OK | cp2 warm→cool cyan + darker |
| 08 | ocean_liner | DRIFTED | OK | bright blue water → near-black |
| 09 | cyclone | DRIFTED (mild) | OK (calmer) | darker/slower |
| 10 | chasers | DRIFTED | OK | tail orange→cyan + always-on star field |
| 11 | bioluminescence | DRIFTED | 2.59 → 0.18 (15×) | rate collapse |
| 12 | breathing | DRIFTED | 4.59 → 0.17 (27×) | rate collapse + palette red→cyan |
| 13 | sparkle | DRIFTED | 2.31 → 0.81 (3×) | rate collapse + palette change |
| 14 | lunar_current | DRIFTED | 2.37 → 0.30 (8×) | rate collapse |
| 15 | silk_prism_ribbons | DRIFTED | 3.33 → 0.60 (5.5×) | rate collapse |
| 16 | ghost_tide_uv | DRIFTED (mild) | OK (½) | white/UV dimmed by `levelGain` |
| 17 | rolling_color_dunes | DRIFTED | OK | section math re-architected |
| 18 | deep_space_lattice | DRIFTED | 1.87 → 0.42 | grid `sum` replaced `product` + static floor |
| 19 | swaying_lattice_ballet | **BROKEN** | 6.69 → **0.03** | dropped `*TAU` + dirSign 0.5 → frozen |
| 20 | parametric_sway_field | DRIFTED | 0.95 → 0.12 | dirSign 0.5 + rate-dip near-stall |
| 21 | pelagic_manta_rays | DRIFTED | OK | whiteFoam 0.55→0.30 + palette |
| 22 | abyssal_sway_garden | FAITHFUL | improved (coord fix) | minor cp hue nudge |
| 23 | prismatic_strange_attractors | DRIFTED | OK | lost sparse black space → glowy (open §6 decision) |
| 24 | chromatic_murmuration | DRIFTED | OK | new `nx` color sweep replaces flock-driven hue |
| 25 | heartbeat | FAITHFUL | beats autonomously | white added (additive) |

**FAITHFUL: 01, 02, 03, 22, 25 (5).  DRIFTED: 19 of 26.  BROKEN (frozen): 19.**

---

## Root causes (systematic — these few bugs explain most of the drift)

1. **`direction` / `dirSign` default `0.5` read as an already-signed multiplier.**
   The export default is `0.5`; the rewrites use it directly as a signed rate
   factor, so the base phase advances at **half** strength (and the slider's
   0.5 = "centre" never maps to full speed). Hits 00, 04, 19, 20 (and is latent
   wherever `effDir/headingNow = direction`). **Highest-leverage fix.**
2. **Base phase rates set far below the originals' effective cadence.** og used
   raw-`delta` clocks with big divisors/multipliers (`/1310`, `time(0.05/…)*…`);
   the rewrites integrate `dt` with conservative `BASE_RATE/MAX_RATE/SPAN_RATE/
   TRAVEL_RATE` constants and small in-`wave()` phase weights (0.18–0.55).
   Net 2.5×–27× slower. Hits 00, 04, 05, 11, 12, 13, 14, 15, 18, 20.
3. **19 dropped the `*TAU` (2π) factor** in its sway accumulator → ~15× too
   slow → genuinely frozen. Unique to 19.
4. **White re-architected from "track the moving field" to "static `whiteLevel`
   keep + kick-gated bite."** og animated W with the field (`w=noise*2.5`,
   `outW=v*beatPulse`); the rewrites make W a near-constant keep plus a kick
   term that is 0 at silence → white stops moving. Hits 00, 04 (dims 11, 16, 21).
5. **Large static brightness floors / always-on carrier layers** fill the
   originals' negative space → low contrast, motion hidden, "lit but still."
   Hits 02, 06, 08, 10, 18, 20, 23.
6. **Palette default changes / second-hue invention** to satisfy `hueSpread≥0.10`
   — the rule was met by *changing* the palette rather than preserving it.
   Hits 06, 07, 10, 12, 13, 16, 18, 20, 21, 23, 24.

Note: the ADDED audio/white knobs (level/kick/radius/detail/direction/white_*)
are themselves correct and additive — they are **not** the problem. The
regressions are in **base motion rate**, **static brightness floors**, and
**palette/white defaults**.

---

## Recommended fix plan (restore original look, keep all new knobs)

**Tier 1 — motion (the operator's actual complaint).** Fix causes 1–4:
guard `direction`→signed full-strength; raise the base rate constants / in-wave
phase weights so per-frame advance matches og; restore `*TAU` on 19; re-add a
moving base term to white (e.g. `w = whiteKeep*(…) + noise*0.6 + whiteBite*…`).
Patterns: **00, 04, 19 (BROKEN), 05, 11, 12, 13, 14, 15, 18, 20**.

**Tier 2 — contrast/identity.** Lower the static brightness floors / always-on
carriers so negative space goes dark again: 02, 06, 08, 10, 18, 20.

**Tier 3 — operator decisions (do not silently change):**
- **23 prismatic_strange_attractors:** sparse-black-space original vs the
  current reactive-glowy/fully-lit (the open §6 decision from 20260619).
- **Palette defaults:** restore originals (06 magenta→blue, 07 cool→warm,
  10 cyan→orange tail, 12 cyan→orange, 13, 21) or keep the new hues?

Each fix is per-pattern, knob-preserving, and re-verifiable with the
per-pixel-motion probe (cur ≈ og at default sliders). `og_patterns/` stays
read-only as the reference.

---

## Per-agent detail
Full per-pattern findings (line cites + exact fix per pattern) are in the
sub-agent transcripts for this session. The high-def project context is in
`.agent/02_reports/202606/20260619_1_highdef_patterns_session.md`
(§6 = the 23 open decision) and the white convention in
`.agent/02_reports/202606/20260619_0_white_audit.md`.
