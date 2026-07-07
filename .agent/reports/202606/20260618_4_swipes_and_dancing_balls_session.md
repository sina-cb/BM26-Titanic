# Session — par_swipe + bar_swipe + dancing-balls comet trail on dancers 26-29

**Date:** 2026-06-18
**Branch:** `claude/audio-corpus-tuning-olcd6i`
**Operator:** Sina (local, test bench, Amazon USB mic live in the room)
**Agent:** local, with 3 cold-start sub-agents for tests/validations.

## What shipped (all committed on `claude/audio-corpus-tuning-olcd6i`)

| Commit | Pattern | Summary |
|---|---|---|
| `cb2a692` | **30_par_swipe** | Pars-only (fId 1..4) high-contrast L→R swipe across the 4-par row `(4-fId)/3`. |
| `ce12a2d` → `8446008` | **31_bar_swipe** | Bars-only (fId 7..8). Final form (operator request): NOT physical x — sweeps by **LED index within the bar group**, both 18px bars as one 0..35 strip (`barIdx = index - 16`). A **single LED** walks 0→35 **slowly** (MAX_RATE 0.3 → ~6.7 s/sweep at default; swipeWidth in PIXELS, default 1). |
| `<dancers>` | **26,27,28,29** | Dancing-balls **comet trail** added to the whole dancer family. |

Controls for both swipes (UI order): `localSpeed, swipeX, swipeWidth, swipeDir, colorPalette1, colorPalette2`.
- `swipeX` (0..1) is the modulation-drivable position (the "x param"); `localSpeed`=0 freezes auto-animation so `swipeX` positions it directly.
- `swipeDir` <0.5 = forward (par: L→R / bar: index 0→35), ≥0.5 = reverse.
- High contrast: swept pixel(s) full-bright on the strict cp1↔cp2 palette (reused `_hsv2rgb1/2`/`clamp01`, no hardcoded RGB); everything else at a tiny `BASE_FLOOR` (0.04). Colour lerps cp1→cp2 along the swipe position.
- Modulators-only: audio is attached later via a modulation on `sliderSwipeX`/`sliderSwipeWidth`; the patterns never read CPC audio natively.

## Dancing-balls comet trail (26-29)

Goal: make the dancer family look like the Audio Companion's dancing-balls visualizer (`drawOrb` in `marsin_engine/audio/companion/ui/companion_app.js`), which keeps a fading history of each orb's past positions and draws them as shrinking, fading circles behind the head.

Implementation (uniform across all four): each dancer gets a 14-slot ring buffer (`trail1`/`trail2 = array(14)`) of its past spring positions, pushed every frame in `beforeRender`; a new `trailGlow(posn, trailArr, halfW)` lights pixels near recent positions, faded quadratically by age and slightly shrinking. The trail is screen-blended **under** the existing bright head (raised-cosine halo/core = the radial-gradient glow; head size already tracks energy). At rest the samples coincide so the trail collapses onto the head — comet only while moving, exactly like `drawOrb`.
- 26 (whole-rig, global-x dancers) · 27 (4-par row) · 28 (vintage, trail respects owner/echo weighting) · 29 (bars; temporal trail merged by max into the pre-existing velocity-aligned spatial comet).

## Validation

**Static (all PASS):** `node --check`, `manifest.json` parses, `engine.js --list` shows both swipes, `--dry-run` clean for every touched pattern + `test_const` (per-pixel instruction limit OK).

**Per-pixel WASM-VM harnesses** (drive the real MarsinVM via `WasmHost`; sub-agents, reports below):
- `30_par_swipe`: only fId 1..4 light (5..8 = 0); swept par marches 0→1 and reverses. (this agent, + live HIL)
- `31_bar_swipe` (`_1_` report): only fId 7,8 light; lit band marches full row and reverses. Re-verified after the index-based rewrite: single LED walks barIdx 0→35 / 35→0, pars+vintage stay dark.
- `26,27,28,29` (`_2_`, `_3_` reports): self-filters exact (26 whole-rig; 27→1-4; 28→5-6; 29→7-8); comet trail proven **moving vs stationary** (27: trailing par 86 moving vs 0 stationary, time-decay 210→86→11→0; 29: moving tail 111 vs leading edge 63; 28: owner peak 165 vs echo 101); no NaN even under a 600-frame torture pass with extreme inputs.

**Live hardware-in-the-loop** (engine `:6968` → sACN → sim `:6969`, Amazon mic live):
- par_swipe: vis-WS `rig` capture — brightest par marches P4→P1 and loops; non-par pixels 0 every frame. Sim render of `test_bench` in LIVE/sACN-in mode.
- bar_swipe: single LED walks barIdx 10→11→…→20 (one pixel, slow); pars/vintage 0.
- 27 dancer: driving ball1 L→R, the par just vacated fades (P4 254→144→20) while trailing pars linger (P2 88→49→44 after the head passes), collapsing to a clean head at rest — comet renders through the full sACN path.

Reports: `.agent/02_reports/202606/20260618_1_bar_swipe_validation.md`, `..._2_dancers_trail_validation_26_27.md`, `..._3_dancers_trail_validation_28_29.md`.

## Live runtime state left on the bench (intentional residue — do NOT revert per codex)
The engine (`:6968`) and sim (`:6969`) are left running. During HIL I changed runtime knobs (saved to `states/*`): deck pattern (last = `27_par_dancers`), `viewFader`→deck, section brightnesses (Pars/Bars→1.0), and some dancer sliders (ball2 energy 0, ball1 energy 1). These are runtime residue, reported not reverted. The engine runs locally with audio analysis ENABLED on the Amazon mic (local dev config; prod intent is Companion-as-sole-analyzer). See memory `hil-vis-gating` for the "vis reads all-zero" gotcha (viewFader + section dimmers).

## Notes / follow-ups
- To make any swipe audio-reactive, add a modulation mapping (`source: cpc <audio key>` → `target: sliderSwipeX`/`sliderSwipeY`/`sliderSwipeWidth`) on the playlist entry.

## Addendum (same day) — coordinate-based swipes, axis per group

Operator: the LED-index order was wrong (wiring ≠ physical), and the swipe set should be **axis per fixture group**. Reworked to PHYSICAL coordinates (commit `7946dce`):

| Pattern | Axis | Param | Direction (swipeDir <0.5 / ≥0.5) |
|---|---|---|---|
| `30_par_swipe` | x (left↔right) | `swipeX` | L→R / R→L — unchanged; `(4-fId)/3` row already = physical x order |
| `31_bar_swipe` | x (left↔right) | `swipeX` | L→R / R→L — reverted index→physical x (`pos = nx`, bars span nx 0..1) |
| `32_vintage_swipe` (NEW) | y (up↔down) | `swipeY` | DOWN→UP / UP→DOWN — `pos = ny / VINT_Y_MAX` (0.273); both strips together |

Verified (per-pixel WASM harness + live HIL through sACN):
- bar_swipe: lit band avg-nx 0.041→0.959 (offline) / 0.028→0.629 (live) L→R, reverses; only fId 7,8.
- vintage_swipe: lit band avg-ny 0.000→0.273 (offline) / 0.027→0.191 (live) bottom→top, reverses; only fId 5,6.
- par_swipe: unchanged, still L→R.

The earlier index-based single-pixel bar_swipe (commit `8446008`) is superseded by `7946dce`.
