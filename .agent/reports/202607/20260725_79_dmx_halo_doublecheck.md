# 20260725_79 — DMX halo independent double-check (read-only, Fable)

**Branch:** `feat/bm_readiness` · **Subsystem:** `simulation/` (verification only — zero source files changed)
**Order (operator, 2026-07-30):** *"DMX halos are in need of a debug and double
check quickly by a fable agent please."* Independent measurement of the `_73`
(rim multiple) → `_75` (global reach + halo pitch ceiling) → `_77` (per-fixture
Halo ×) chain, plus an honest blast-radius read on the `_78` red-ring bug,
concurrent with (and hands-off from) the `_78` Opus fixer.

## Verdict table

| # | check | UkingPar | ShehdsBar | VintageLed |
|---|---|---|---|---|
| 1 | renders a halo at his settings (full profile, pixel 1.9 / halo 1.4) | **PASS** — 0.4713 (2.12× bulb 0.2223) | **PASS** — 0.03498 (2.12× bulb 0.0165) | **PASS** — 0.11925 (2.12× bulb 0.05625) |
| 2 | Global Halo Size moves it live on the drag | **PASS** — 0.311 / 0.471 / 0.667 / 1.112 at 0.5 / 1.4 / 2.5 / 5 | **PASS** — 0.0231 / 0.0350 / 0.0495 / 0.0825 | **PASS** — 0.0788 / 0.1193 / 0.1688 / 0.28125 |
| 2b | pitch ceiling engages where `_75` says | **no ceiling** (pitch 0, linear everywhere) — confirmed | **cap 0.0825 = 0.055 × 1.5, touched exactly at slider max 5** — confirmed | **cap 0.28125 = 0.1875 × 1.5, touched exactly at max 5** — confirmed |
| 3 | local `Halo ×` multiplies (× 0.5 / 1 / 2) | **PASS** — 0.2356 / 0.4713 / 0.9426, bulb untouched | (not sampled — same code path) | **PASS** — 0.0596 / 0.1193 / 0.2385, bulb untouched |
| 4 | LED folder "Halo Size" leaves DMX alone (0.05 → 0.25) | **PASS** — byte-identical | **PASS** — byte-identical | **PASS** — byte-identical |
| 5 | `_78` halo-color staleness | **not reproduced** — 0 mismatches | 0 mismatches | 0 mismatches |

Every DMX class reports exactly `dmxHaloRimMultiple(g)` as its halo/bulb ratio
(1.4 / 2.12 / 3.0 / 5.0 at g = 0.5 / 1.4 / 2.5 / 5) until its own ceiling —
`_73`'s rim law, `_75`'s ceilings and `_77`'s multiplication all hold to the
digit. During the LED-knob sweep the LED bus moved as designed (sign + strand
halo 0.07 → 0.35) while all three DMX classes did not move at all — the
"DMX ignores the LED base radius" design holds.

## Method (one line)

Two fresh readonly-guarded sessions (never his window): `?readonly=1`,
`__readonlyMode` pinned true via accessor pre-page-script, `WebSocket` to
`:6972` refused at the constructor, `:6970` intercepted with non-GET aborted,
GUI handler bodies replayed by hand, every param and config key restored
(including deleting `haloScale` keys that were never there). Guard totals
across both sessions: **0 sACN-OUT enables, 0 save-server requests, 0 aborted
writes needed, params restored exact**. Environment read live from the loaded
scene: profile `full`, mode `sacn_in`, patches active, pixel 1.9, halo 1.4,
ledPixelSize 0.08, ledHaloSize 0.14, GPU = discrete RTX 4090 (adapter read
back, `integrated: false`). Probe scripts + JSON dumps:
`~/tmp/dmx_halo_doublecheck/` (gitignored).

## `_78` blast radius — independently NOT reproduced, confirming the fixer

Scanned **all 76 DMX fixtures × every pixel** (bulb vs halo instanceColor,
worst pixel per fixture), two samples 2 s apart with bulbs verifiably animating
under live sACN between them: **0 fixtures with halo ≠ bulb (tolerance 0.02),
0 red-ring signatures** (red halo over dark bulb). `_writePixelColor` writes
bulb, halo and cone from the same call on every driven path I traced
(applyDmxFrame → setPixelColorRGB, setColor, setBulbColor, the static preview),
so the buffers cannot diverge — which independently corroborates the `_78`
log entry that landed mid-verification ("the proposed mechanism is DISPROVED";
the red was `paintUndrivenEntry`'s deliberate undriven-red plus one genuinely
red-driven frame). Two agents measuring separately, same numbers: my sampled
colors were `[0.451, 0, 0]` = exactly `(1,0,0) ×` the sim-brightness preview
scale, i.e. the undriven-red paint reaching both layers equally.

## NEW finding — trace generator visuals masquerade as broken halos (the thing worth fixing)

The screenshots that were supposed to show halo growth instead showed
**fixed-size opaque disks sitting on the fixtures**, and they are not halos:

- At every sampled generator-placed DMX fixture there is a **non-fixture
  `Mesh(SphereGeometry r=0.3)`** at the fixture position — the **trace preview
  dot** (`gui_builder.js` `buildTraceObject`, dot geometry line ~3396), tinted
  by the spacing gradient `#2a7fff → #22cc66 → #ff4422` (blue = bunched,
  green = even, **red = stretched**). Opaque, unlit, `MeshBasicMaterial`.
- Trace **end handles** add a `r=0.4` sphere at `#ff4400`, opacity 0.7 (start
  `#00ff88`, aim `#ffcc00`).
- These render in the **full beauty profile** whenever `generatorsVisible` is
  on — and it **defaults to true** (`gui_builder.js` ~4990) and was on in the
  loaded scene state.

Consequences, verified by A/B toggle screenshots: the whole mid-section of a
Shehds bar is swallowed by one mint-green disk (dot r 0.3 vs bar halo 0.035 —
**8.6× the halo it hides**); a vintage fixture wears an amber `#ff4400` disk
bigger than its six heads' halos at slider max; a par (bulb 0.2223) wears its
dot as a **ring around the housing** — exactly the "wrong-colored ring around a
DMX fixture" shape the operator has been chasing, and a **red** one wherever
the spacing gradient says stretched. Hiding the fixture's real `haloInst`
leaves the disk; hiding the one non-own sphere removes it
(`1785449480_dhdc2_bar_haloInst_hidden.png` vs `..._bar_nonown_hidden.png`).

None of this is new code from today's wave — but today's wave made real halos
finally visible, so every remaining "ring that answers no halo knob" is now one
of these. **Recommendation (one decision for the operator, not made here):**
gate trace visuals out of the beauty profiles (`full`/`emissive`) or default
`generatorsVisible` off outside `edit` — a `_78`-fixer or follow-up card,
filed as a finding only.

Caveat recorded for honesty: because those disks dominate the close-ups, my
sweep screenshots demonstrate ceiling/growth **numerically** (instance
matrices) and via the LED-bus halos visibly ballooning in the same frames, not
via clean DMX-rim close-ups. The rim itself is visually subtle at his settings
next to bloom — as designed (additive, opacity 0.2).

## Evidence

Screenshots (`.agent_renders/`, all inspected): `1785449147_dhdc_par_at_operator_settings.png`,
`..._par_global_0p5.png`, `..._par_global_2p5.png`, `..._bar_at_operator_settings.png`,
`..._bar_global_5_ceiling.png`, `..._vintage_at_operator_settings.png`,
`..._vintage_global_5_ceiling.png`, `1785449480_dhdc2_bar_baseline.png`,
`..._bar_haloInst_hidden.png`, `..._bar_nonown_hidden.png`.
Probe dumps: `~/tmp/dmx_halo_doublecheck/dhdc_dump_1785449147.json`,
`dhdc2_dump_1785449480.json`.

## Files touched

`.agent/` report + project dossier only. **Zero** `simulation/`,
`marsin_engine/`, `scenes/**`, test or tool files written; no file the `_78`
Opus fixer owns (`led_halo.js`, `dmx_fixture_runtime.js`, `animate.js`,
`gui_builder.js`) was edited. No git operations, no saves, no device HTTP, no
server restarts.
