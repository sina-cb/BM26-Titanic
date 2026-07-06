# Handoff — `par_swipe` pattern (pars-only high-contrast swipe)

**Date:** 2026-06-18
**Branch:** `claude/audio-corpus-tuning-olcd6i` (the main working branch — implement `par_swipe` here).
**Prepared by:** prior agent (audio companion / patterns work). **For:** the next agent to implement.

---

## Naming (resolved)
The operator confirmed **`par_swipe`** — it lights **ONLY the pars** (fixtureId 1..4) and swipes across them 0→1, direction by a param. Name the file `par_swipe.js`.

---

## The task — `marsin_engine/patterns/3N_par_swipe.js`
Number it after the existing patterns (currently the active set is `00`..`29`; use the next free number — **`30_par_swipe.js`** — and register it in `marsin_engine/patterns/manifest.json` immediately after `29_bar_dancers`).

Requirements (keep it **very simple and HIGH CONTRAST**):
1. **Self-filter to the pars:** `render3D` first line — `if (fixtureId < 1 || fixtureId > 4) { rgb(0,0,0); return; }`. Nothing lights outside the 4 pars.
2. **A swipe that travels 0→1 across the four-par row.** Treat the four single-pixel pars as ONE left→right row. Row position of a par = `(4 - fixtureId) / 3` (fId4 = 0.0 = LEFT, fId1 = 1.0 = RIGHT — derived from the model X coords: Par1 x=1.24 rightmost … Par4 x=-0.127 leftmost). See `27_par_dancers.js` for the exact mapping already in use.
3. **Direction param:** an `x`/direction control flips the sweep **left→right vs right→left**. Expose it as a slider (e.g. `sliderSwipeDir(v)` where v<0.5 = L→R, v≥0.5 = R→L), and/or a `swipeX` (0..1) position the sweep follows so a **modulation** can drive it (e.g. `MODULATE sliderSwipeX <- micLow`). The operator said "go from left to right or right to left **based on a x local param**" — so the direction/position must be parameter-controlled, not hardcoded.
4. **High contrast + simple:** a sharp, bright leading edge / narrow window (≈ one par wide) sweeping across the row — the par(s) under the swipe are **full brightness on the cp1↔cp2 palette**, everything else **~0** (hard on/off, not a soft gradient). A small floor is fine but keep the contrast strong (this is the operator's explicit ask). The sweep auto-animates 0→1 at `localSpeed`, OR is positioned directly by `swipeX` — pick the simplest that satisfies "swiped all the way from 0 to 1."
5. **Consistent controls** (match the other dancer patterns where sensible): `localSpeed`, `colorPalette1`, `colorPalette2` + matching `sliderLocalSpeed`, `colorPalette1(h,s,v)`, `colorPalette2(h,s,v)`; plus the swipe-specific `swipeX`/`swipeWidth`/`swipeDir` sliders. Use the **strict cp1↔cp2 RGB-space palette helpers** (`_hsv2rgb1/2`, `cp1*`/`cp2*`, `clamp01`) — copy them from `26_dom_dancers_chevron.js` / `27_par_dancers.js`; **no hardcoded RGB**.

## Conventions you MUST follow (from the codebase)
- Read **`docs/MARSIN_ENGINE_PATTERNS.md`** + **`docs/MARSIN_PB_LANG_SPEC.md`** + **`.agent/00_gol/08_*marsinscript*`** + the pattern auto-check **`.agent/00_gol/05_*`** + the render skill **`.agent/01_skills/00_see_the_world.md`**.
- **`render3D(index, x, y, z)`** — x,y,z are normalized [0,1] pixel coords. `fixtureId` and `index` are available per pixel. **`beforeRender(delta)`** runs once/frame (delta ms).
- **Trig is in RADIANS** in the live VM (PATTERNS.md §4 is authoritative; the LANG_SPEC "turns" note is stale). `wave()` is turn-based. Use `PI`/`PI2`.
- **Avoid reserved single-letter names** in helpers (use `hv/iv/fv/...` like the existing patterns).
- **No imports, no strings/objects** in pattern code. Lit-at-rest is the norm, but this pattern is a deliberate hard-contrast swipe so a near-dark off-state is fine (it still lights the swept par; it's not a global blackout pattern — only the pars are in scope anyway).

## Fixture layout (test_bench) — for reference
- **fId 1..4** = ParLights, **single pixel each**, index 0,1,2,3. Physical order: Par1 rightmost (x=1.24) … Par4 leftmost (x=-0.127). Row pos `(4-fId)/3`. **← this pattern's target.**
- fId 5..6 = Vintage Left/Right (6 heads each, index 4..9 / 10..15).
- fId 7..8 = Bar Left/Right (18 px each, index 16..33 / 34..51).
- Single-pixel pars: there is no meaningful intra-fixture `localPos` (collapses to 0.5) — the swipe is across **fixtures**, by row position, not within a fixture.

## The "two views" in this repo (context)
1. **View masks** (`simulation/scenes/test_bench/views.yaml` ↔ `marsin_engine/models/test_bench.viewmasks.js`): named bitmask selections over fixture *groups*. Relevant one: **`pars` (bit 0x20) → ParLights**. (Also: `bars` 0x40, `vintages` 0x80, plus `ParsBars`/`ParsVintages` and the base `ParLights`/`VintageLights`/`BarLights`.) These select subsets of the rig; they are **not** how this pattern filters (it self-filters by `fixtureId`).
2. **The "fixture view"** (in-pattern): per-pixel local coordinates reconstructed from `fixtureId` + `index` + known fixture geometry (since MarsinScript has no per-fixture local-coord builtin). Not needed here (pars are single-pixel) but it's how 27/28/29 work — study them.

## Closest example to copy from
**`marsin_engine/patterns/27_par_dancers.js`** — already self-filters fId 1..4, maps the four pars to a left→right row `(4-fId)/3`, and has the palette helpers. `par_swipe` is a simpler sibling: a hard bright edge sweeping the same row instead of two soft dancers.

## Validation (do before reporting; do NOT commit unrelated dirty files)
1. `cd marsin_engine && node --check patterns/30_par_swipe.js`
2. `node -e "JSON.parse(require('fs').readFileSync('patterns/manifest.json','utf8'))"` (manifest parses) and `node engine.js --list | grep par_swipe`.
3. `node engine.js --model test_bench --pattern 30_par_swipe --dry-run` (compiles via MarsinCompiler, no instruction-limit / blend errors); `test_const --model test_bench --dry-run` still clean.
4. **Per-pixel render smoke test** (small WASM-VM harness over all 52 test_bench pixels — copy the harness approach the 26/27/28/29 work used): confirm **only fId 1..4 (the par pixels, index 0..3) ever light**, fId 5..8 stay 0; and confirm the swept par moves across the row from 0→1 as `swipeX`/time advances, and **reverses** when the direction param flips.
5. Optionally render the sim (`.agent/01_skills/00_see_the_world.md`; fresh chrome `--user-data-dir` if headless GL is flaky) — else rely on the per-pixel harness.

## Report back
The pattern filename + number, the exact controls + their ranges, the direction/position param semantics, the per-pixel nonblank-by-fixtureId table (pars only), how the swipe achieves high contrast, MarsinScript compliance notes, and **the name/target flag** (par_swipe-named but pars-lit — confirm with operator).

---

## The audio analysis system (context — how audio gets to a pattern)

**The Audio Companion is the SOLE analyzer.** The marsin engine runs with `audio.enabled: false` — it does NOT analyze audio itself. The Companion (`marsin_engine/audio/companion/`, served on :6966) imports the engine's REAL DSP (`AudioAnalyzer`, `SignalPostProcessor`, `AudioStructureDetector`, the `DominantFreqTracker`, `DerivedSignals`) and runs the WHOLE pipeline independently, reading audio from a mic / synthetic test generator / file replay.

**Per analyzer hop the Companion produces these raw signals:**
- Intensity bands (FFT): `micLow micMid micHigh micKick micFlux` — all [0,1].
- Dominant frequencies (DominantFreqTracker): `micDomFreq1/2` (Hz) + `micDomEnergy1/2` ([0,1]) — freq and energy are now **independent** signals.
- Structure detector: `audioStructure` (THIN/BUILD/SUSTAIN), `audioBuildScore`, `audioEnergyRatio`, `audioDropPulse`, `audioSlowZone`, `audioVocalsHot`.
- Derived: `audioBpm`, `audioNote`, `audioNoteHue`, `audioParty`, beat / bar-phase, etc.

**Signal DESIGN.** The Companion is a *signal designer*: the operator builds OUTPUT signals — each picks a RAW source → a chain of type-aware DSP ops (`lpf, clamp, slew, kalman, normalizer` [a smooth moving-window Hz→[0,1] auto-range], `danceMaker, gain, compressor, curve`, …) → a terminal `osc_out` tap. The `osc_out` carries ONE **name** that derives its `cpcKey` + OSC `address` + the CaptainPad-visible label.

**Transport to the engine.** Every hop the Companion sends each output signal's POST value over **UDP OSC → engine port 10000 → OscListener → the CPC** (param center). It also POSTs a signal **manifest** (`POST /audio/signals/manifest`) so the engine registers dynamic CPC live params and CaptainPad shows them automatically. Shared tuning (input gain / source smoothing / capture device) is kept in sync via `EngineConfigLink` (single source of truth across Companion ↔ engine ↔ CaptainPad).

**How a PATTERN consumes audio — MODULATORS ONLY (read this).** Patterns **never read CPC audio keys natively** (that injection path was removed; `param_center` no longer feeds audio keys into pattern globals). Instead a pattern exposes a plain **slider param**, and an operator / playlist entry attaches a **modulation mapping** whose *source* is a live audio CPC key (e.g. `micLow`, `micDomEnergy1`) and whose *target* is that slider. The modulation engine: resolves the source value, **normalizes a builtin wide-range source (Hz/bpm) to [0,1]**, applies the curve + mode (`offset` uni/bipolar-symmetric / `multiply` / `override`), and writes the result into the slider export each frame. So **for `par_swipe`: expose sliders and let audio be attached via a modulation later — do NOT read audio directly in the pattern.**

## Reports for this branch (context)
This branch (`claude/audio-corpus-tuning-olcd6i`) carries the whole audio + patterns effort. The most relevant reports to read for this work:
- **`202606/20260617_0_companion_signal_designer_contract.md`** — THE Companion signal-designer contract (sources → ops → osc_out, the shared contract). **Start here.**
- `202606/20260616_1_audio_signals_companion_findings.md` — audio overhaul + Companion + derived signals (findings & validation).
- `202606/20260616_2_marsin_audio_framework_plan.md` + `..._3_audio_framework_review_consolidation.md` — framework doc + 4-review consolidation.
- `202606/20260613_2_audio_structure_detector.md`, `..._4_audio_analysis_validation.md`, `..._5_audio_corpus_tuning.md`, `20260613_merge_summary.md` — structure detector, end-to-end validation, corpus tuning.
- `202606/20260612_2_audio_analysis_review_docs30_feasibility.md`, `202605/20260526_1_audio_analysis_report.md`, `20260524_2_audio_analysis.md`, `20260526_2_drop_mood_detection_research.md` — earlier audio analysis + drop/mood research.
- `202605/20260527_5_modulation_pipeline_audit.md`, `202606/20260611_2_controller_mapping_impl.md` — modulation pipeline + controller mapping.
- Views / groups: `202605/20260525_4_view_mask_options.md`, `202606/20260610_2_dynamic_group_bits.md`, `..._3_sim_owned_views_and_save_hardening.md`, `20260611_1_pr11_review_fixes.md`.
- Patterns: `202605/20260524_3_pattern_audit.md`, `20260527_4_pattern_review_final_push.md`, `20260528_1_pattern_parameter_review.md`, `20260525_7/8_*_tuned_patterns.md`.

NOTE: this session's NEWEST work — the modulators-only migration, the dancer patterns 26–29, the dom freq/energy split, the frequency normalizer op, the modulation mode redesign (offset/multiply/override + symmetric bipolar + curve-on-signal), the source allow-list removal + wide-range source normalization, and the per-group view masks (pars/bars/vintages) — is captured in the **git commit history** + this handoff, not in separate report files.

**Full report archive** (`.agent/02_reports/`, ~100 reports across 202603–202606): run `ls -R .agent/02_reports` for the complete index. The list below is the full set as of this branch:

- `.agent/02_reports/202603/20260304_1_handoff_report.md`
- `.agent/02_reports/202603/20260306_1_simulation_state.md`
- `.agent/02_reports/202603/20260318_1_physical_deployment_system.md`
- `.agent/02_reports/202603/20260321_1_meshtastic_messaging_issues.md`
- `.agent/02_reports/202603/20260321_2_meshtastic_timing_research.md`
- `.agent/02_reports/202603/20260322_1_dmx_fixture_designer_handoff.md`
- `.agent/02_reports/202603/20260324_1_hello_world.md`
- `.agent/02_reports/202603/20260326_1_dmx_gap_analysis.md`
- `.agent/02_reports/202603/20260328_1_dmx_lx_issues.md`
- `.agent/02_reports/202604/20260406_1_current_sim_code.md`
- `.agent/02_reports/202604/20260406_2_sacn_integration.md`
- `.agent/02_reports/202604/20260407_1_dmx_integration_gap_analysis.md`
- `.agent/02_reports/202604/20260407_2_team_report.md`
- `.agent/02_reports/202604/20260416_1_model_v2_integration.md`
- `.agent/02_reports/202604/20260416_2_kick_off_party_readiness.md`
- `.agent/02_reports/202604/20260422_1_unreal_implementation.md`
- `.agent/02_reports/202604/20260424_1_webgpu_lighting_error.md`
- `.agent/02_reports/202605/20260502_1_standalone_ipad.md`
- `.agent/02_reports/202605/20260504_1_marsin_mixer.md`
- `.agent/02_reports/202605/20260506_1_getting_ready_for_build.md`
- `.agent/02_reports/202605/20260506_2_getting_ready_for_build_2.md`
- `.agent/02_reports/202605/20260507_1_code_review.md`
- `.agent/02_reports/202605/20260508_1_pattern_time_dome_version.md`
- `.agent/02_reports/202605/20260508_2_bugs.md`
- `.agent/02_reports/202605/20260514_1_playlist_impl.md`
- `.agent/02_reports/202605/20260516_1_port_watch_impl.md`
- `.agent/02_reports/202605/20260522_1_bugs_report.md`
- `.agent/02_reports/202605/20260524_1_osc_impl.md`
- `.agent/02_reports/202605/20260524_2_audio_analysis.md`
- `.agent/02_reports/202605/20260524_3_pattern_audit.md`
- `.agent/02_reports/202605/20260525_0_deck_ping_pong.md`
- `.agent/02_reports/202605/20260525_0_layer_add_refresh.md`
- `.agent/02_reports/202605/20260525_0_playlist_loading_fix.md`
- `.agent/02_reports/202605/20260525_1_mixer_layer_view.md`
- `.agent/02_reports/202605/20260525_1_port_watch_audit.md`
- `.agent/02_reports/202605/20260525_1_transitions_pixel_perfect.md`
- `.agent/02_reports/202605/20260525_1_ws_topic_prioritize.md`
- `.agent/02_reports/202605/20260525_2_channel_add_default_load.md`
- `.agent/02_reports/202605/20260525_2_global_effect_macros.md`
- `.agent/02_reports/202605/20260525_2_globals_unification.md`
- `.agent/02_reports/202605/20260525_2_playlist_add_issue.md`
- `.agent/02_reports/202605/20260525_3_deck_card_compact.md`
- `.agent/02_reports/202605/20260525_3_deck_density_optimization.md`
- `.agent/02_reports/202605/20260525_3_multi_agent_summary.md`
- `.agent/02_reports/202605/20260525_4_multi_agent_round_2_summary.md`
- `.agent/02_reports/202605/20260525_4_sidebar_scroll.md`
- `.agent/02_reports/202605/20260525_4_view_mask_options.md`
- `.agent/02_reports/202605/20260525_5_fader_lock.md`
- `.agent/02_reports/202605/20260525_5_transition_pack.md`
- `.agent/02_reports/202605/20260525_6_channel_isolation.md`
- `.agent/02_reports/202605/20260525_7_dome_tuned_patterns.md`
- `.agent/02_reports/202605/20260525_8_logsville_tuned_patterns.md`
- `.agent/02_reports/202605/20260525_9_channel_addition_bug.md`
- `.agent/02_reports/202605/20260526_1_audio_analysis_report.md`
- `.agent/02_reports/202605/20260526_2_drop_mood_detection_research.md`
- `.agent/02_reports/202605/20260526_3_ipad_discovery_debug.md`
- `.agent/02_reports/202605/20260527_1_code_review.md`
- `.agent/02_reports/202605/20260527_1_mixer_trans_no_kbd.md`
- `.agent/02_reports/202605/20260527_2_format_lint_pass.md`
- `.agent/02_reports/202605/20260527_2_scheduler_engine.md`
- `.agent/02_reports/202605/20260527_3_debug_pollution_scan.md`
- `.agent/02_reports/202605/20260527_3_scheduler_ui.md`
- `.agent/02_reports/202605/20260527_4_pattern_review_final_push.md`
- `.agent/02_reports/202605/20260527_5_modulation_pipeline_audit.md`
- `.agent/02_reports/202605/20260528_1_pattern_parameter_review.md`
- `.agent/02_reports/202605/20260528_4_dark_mode.md`
- `.agent/02_reports/202605/20260528_5_playlist_reorder.md`
- `.agent/02_reports/202606/20260610_1_group_fixed_colors.md`
- `.agent/02_reports/202606/20260610_2_dynamic_group_bits.md`
- `.agent/02_reports/202606/20260610_3_sim_owned_views_and_save_hardening.md`
- `.agent/02_reports/202606/20260611_1_pr11_review_fixes.md`
- `.agent/02_reports/202606/20260611_2_controller_mapping_impl.md`
- `.agent/02_reports/202606/20260612_0_controller_id_ordinal.md`
- `.agent/02_reports/202606/20260612_1_launcher_profiles.md`
- `.agent/02_reports/202606/20260612_1_new_ui_parity_dev.md`
- `.agent/02_reports/202606/20260612_1_task_tracker_notion_migration.md`
- `.agent/02_reports/202606/20260612_2_audio_analysis_review_docs30_feasibility.md`
- `.agent/02_reports/202606/20260612_2_titanic_gap_analysis.md`
- `.agent/02_reports/202606/20260612_2_ui_rehaul_plan.md`
- `.agent/02_reports/202606/20260612_3_remove_icebergs.md`
- `.agent/02_reports/202606/20260612_3_ui_rehaul_complete.md`
- `.agent/02_reports/202606/20260612_4_layout_pass.md`
- `.agent/02_reports/202606/20260613_0_audio_file_replay.md`
- `.agent/02_reports/202606/20260613_1_audio_normalizer_calib.md`
- `.agent/02_reports/202606/20260613_2_audio_structure_detector.md`
- `.agent/02_reports/202606/20260613_3_declarative_signal_table.md`
- `.agent/02_reports/202606/20260613_4_audio_analysis_validation.md`
- `.agent/02_reports/202606/20260613_5_audio_corpus_tuning.md`
- `.agent/02_reports/202606/20260613_merge_summary.md`
- `.agent/02_reports/202606/20260614_0_unpatched_red_overlay.md`
- `.agent/02_reports/202606/20260614_1_ui_rehaul_lilgui_removal.md`
- `.agent/02_reports/202606/20260615_0_controller_cross_universe.md`
- `.agent/02_reports/202606/20260615_1_gen_count_corner.md`
- `.agent/02_reports/202606/20260615_2_gen_point_drag.md`
- `.agent/02_reports/202606/20260616_1_audio_signals_companion_findings.md`
- `.agent/02_reports/202606/20260616_2_marsin_audio_framework_plan.md`
- `.agent/02_reports/202606/20260616_3_audio_framework_review_consolidation.md`
- `.agent/02_reports/202606/20260617_0_companion_signal_designer_contract.md`
- `.agent/02_reports/202606/20260618_0_bar_swipe_handoff.md`

---

### Ready-to-run agent prompt (paste/spawn this)
> Repo: BM26-Titanic, branch `claude/audio-corpus-tuning-olcd6i` (already checked out). Read CLAUDE.md + .agent/00_gol/00_codex.md + docs/MARSIN_ENGINE_PATTERNS.md + docs/MARSIN_PB_LANG_SPEC.md + .agent/00_gol/08_* (marsinscript) + the pattern auto-check .agent/00_gol/05_* + the render skill .agent/01_skills/00_see_the_world.md. ALSO read this handoff doc's "The audio analysis system" + "Reports for this branch" sections (`.agent/02_reports/202606/20260618_0_bar_swipe_handoff.md`) — KEY takeaway: **patterns are modulators-only; expose slider params, NEVER read CPC audio natively.** Do NOT revert unrelated dirty runtime-residue files (config.yaml, marsin_engine/states/*, models/test_bench.{js,effects.js}, summer_camp_dome playlist).
>
> Implement a **very simple, HIGH-CONTRAST swipe pattern** `marsin_engine/patterns/30_par_swipe.js` that **lights ONLY the pars** (self-filter `if (fixtureId < 1 || fixtureId > 4) { rgb(0,0,0); return; }`) and sweeps a sharp bright edge **0→1 across the four pars** treated as one left→right row (`(4-fixtureId)/3`: fId4=left=0 … fId1=right=1, same mapping as `27_par_dancers.js`). Expose a **direction/position param** (`swipeX` 0..1 and/or `swipeDir`) so the sweep goes left→right or right→left "based on an x param" and can be modulation-driven; `localSpeed` animates it. The swept par(s) are full brightness on the strict **cp1↔cp2 palette** (reuse the `_hsv2rgb1/2`/`cp*`/`clamp01` helpers from 26/27 — no hardcoded RGB), everything else ~0 (hard on/off). Controls: `localSpeed, swipeX, swipeWidth, swipeDir, colorPalette1, colorPalette2` + matching slider fns. **Register** `30_par_swipe` in `patterns/manifest.json` after `29_bar_dancers`. **Validate:** node --check; manifest parses; `--list` shows it; `--dry-run` compiles clean; a per-pixel WASM-VM harness over all 52 test_bench pixels confirms **only fId 1..4 light** (fId 5..8 = 0) and the swept par moves 0→1 and reverses with the direction param. Commit to `claude/audio-corpus-tuning-olcd6i` and report the design + the per-pixel table.
