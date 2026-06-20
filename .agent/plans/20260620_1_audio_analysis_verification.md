# 2026-06-20 — VERIFICATION LOG: Audio Analysis Improvement

**Companion to `20260620_0_audio_analysis_improvement.md`.** Protocol (plan §5): a
task is crossed off in the plan's §6 queue **only after REAL PROOF lands here** —
exact commands + output, captures/screenshots for any UI/signal claim, and the
process taken to close it. No proof ⇒ not done. Append-only; newest at the bottom.

Proof entry template:
```
### <task id> — <title>  [PASS/FAIL]  <UTC time>
- Branch / commit:
- Command(s) run:
- Output (numbers — test counts, F1, correlation, etc.):
- Capture(s): <path(s) to screenshot/clip, or why none possible>
- Process: <what changed, how validated, what was ruled out>
- Verdict: crossed off in plan §6? yes/no
```

---

## Baseline (pre-work, T0)

### BASELINE — audio+companion test suite  [PASS]  2026-06-20T02:30Z
- Branch / commit: `feat/audio_analysis_2` @ tip (pre-Wave-B).
- Command(s) run:
  `cd marsin_engine && node --test tests/audio_*.test.js tests/note_estimator_synthetic.test.js tests/companion_*.test.js`
- Output: `# tests 223 · # pass 223 · # fail 0` (duration ~1.79s).
- Capture: none (numeric test output above is the proof).
- Process: established a green "before" number so any regression from the merges is
  attributable. Confirmed clean `git status` afterward (no state-file residue).
- Verdict: this is the baseline gate; every post-merge run must stay ≥ 223 green
  (plus the new tests each slice adds).

## A2 / A3 — discovery reports
### A2/A3 — discovery deliverables  [PASS]  2026-06-20T02:40Z
- Branch / commit: `feat/audio_analysis_2` @ `509e285`.
- Proof: reports `.agent/02_reports/202606/20260620_2_audio_new_features_discovery.md`
  and `…/20260620_3_audio_lowhanging_fruit_triage.md` committed. Slot-3 verified the
  repo's own state by running
  `node --test tests/audio_structure_detector.test.js tests/integration/audio_analysis_validation.test.mjs`
  → **46/46 pass**, and confirmed both historical P0/P1 defects are already fixed
  (file:line evidence in the report).
- Verdict: A2, A3 crossed off in plan §6.

---

## Wave B + merges (appended at each check-in as proof arrives)

### B4 — CaptainPad audio UI (scrollable grid, dynamic genre name, richer modulation popup)  [PASS]  2026-06-20T03:00Z
- Branch / commit: `dev/captainpad_audio_ui` → merged into `feat/audio_analysis_2` @ `bd0fc34` (--no-ff).
- Files: `CaptainPad/utils/audioSignals.ts` (canonical genre list + `audioGenreName()`/`isGenreKey()`), `CaptainPad/app/(tabs)/audio.tsx` (genre renders NAME; 3-col grid in height-capped ScrollView), `CaptainPad/components/Modulation.tsx` (live source-level `SourceChip`).
- Command(s) run BY INSTIGATOR on the MERGED tip (independent re-verification, not just the agent's claim):
  `cd CaptainPad && npx tsc --noEmit` → **exit 0**; `npm run lint` → **exit 0** (12 pre-existing warnings, 0 errors, none in changed files).
- Agent-side proof (from report `20260620_6`): `npm run web:build` → exit 0, `/audio` exported; Playwright screenshots vs a dependency-free mock engine — `~/tmp/audio_tab_viewport.png`, `~/tmp/audio_tab_full.png`, `~/tmp/audio_tab_grid_scrolled.png` (onset/chest-hit rows revealed by scroll), `~/tmp/modulation_popup.png` (rich popup). Captures are in ~/tmp (gitignored — scratch); agent visually inspected them.
- Capture(s): screenshots above (ephemeral, in worktree ~/tmp). Hard re-runnable proof = the tsc/lint exit-0 on the merged tip.
- Process: confirmed branch touches CaptainPad-only files (disjoint from all engine/companion agents) → safe first Wave-B merge; three-way merge preserved the plan files (branch was cut at 509e285); re-ran static checks on the merged tip.
- Verdict: B4 crossed off in plan §6. ✅
  - Deferred (documented, not a gap): per-candidate *full* animated trails in the picker (perf — selected source still gets full trail).

### B3 — analyzer per-band onsets + sub-bass chest-hit  [PASS]  2026-06-20T03:20Z
- Branch / commit: `dev/analyzer_features` @ `ef5c6f9` → merged into `feat/audio_analysis_2` @ `1aa12f4` (--no-ff).
- New CPC keys: raw `micOnsetLowRaw/MidRaw/HighRaw`, `micSubRaw`; shaped pulses `micOnsetLow`, `micOnsetMid`, `micOnsetHigh`, `audioChestHit`. New files `audio/signals/band_onsets.js`, `sub_bass.js`; analyzer additive (5 legacy outputs byte-identical, pinned by snapshot test); +24 commented lines in `derived_signals.js`; 8 keys registered in `audio/postproc/audio_signals.js`; `audio.sub{minHz,maxHz}` config + validators.
- Command(s) run BY INSTIGATOR on the MERGED tip:
  - `node --test tests/audio_*.test.js tests/band_onsets.test.js tests/note_estimator_synthetic.test.js tests/companion_*.test.js` → **# tests 242 · # pass 242 · # fail 0** (up from 223 baseline).
  - `node engine.js --pattern test_const --model test_bench --port 31268 --dry-run` → **exit 0**, "Pattern loads and compiles OK", 52/52 pixels patched.
  - Confirmed B4 survived the merge (`audioGenreName` helper still in `audioSignals.ts`) and the new keys are registered (`micOnsetLow/audioChestHit` present in postproc).
- Agent-side proof (report `20260620_5`): full suite 779 pass/0 fail; fires/sec table `~/tmp/analyzer_features/fires_per_sec.txt` (kick_4floor→onsetLow 3.33/s + chestHit 2/s beat-aligned; hats→onsetHigh 8.17/s; chord_stab→onsetMid 3/s; silence→all 0); chase clips `~/tmp/analyzer_features/chase_{kick,edm_drop}.html`; per-hop traces show chest-hit firing exactly on the drop (t=7.512s).
- Capture(s): fires/sec table + chase HTML clips + trace JSON (ephemeral ~/tmp scratch). Hard re-runnable proof = 242 green + dry-run exit 0 on the merged tip.
- Process: dry-run merge showed no conflicts (three-way merge-base preserved B4 + plan files); ran the audio suite + boot before committing; verified no state files staged.
- Verdict: B3 crossed off in plan §6. ✅
  - Note for A0 merge: A0 (genre/note) also edits `derived_signals.js` + `audio_signals.js` registration → expect a small union conflict; resolve by keeping BOTH commented blocks.

### B2 — detector super-tuning (drop/slow/build) + scoring/eval harness  [PASS]  2026-06-20T04:00Z
- Branch / commit: `dev/detector_tuning` → merged into `feat/audio_analysis_2` @ `8ac1b6d` (--no-ff, auto-merged with B3's audio_config.js cleanly — no conflicts).
- Deliverables: `tools/detection_eval.mjs` (+ `detection_sweep.mjs`, `tests/integration/detector_scenarios.mjs`) — a real precision/recall/F1 + latency scoring harness; tuned `audio_structure_detector.js` + `audio_config.js`; new range-validated config `dropMinLevel`(0.06), `dropLevelAssist`(false), `slowZoneWidth`(0.04), `slowFluxFloor`(0.10); changed defaults `dropEnergyJump` 1.5→1.8, `slowZoneRef` 0.5→0.07. No new CPC live keys.
- Before→After (labeled scenarios, all 3 mic tiers): **Drop F1 0.29→0.71**, **precision 0.40→1.00**, recall 0.22→0.56, **phantom drops 2→0**; **slow-zone margin/acc 0.12/0.46→0.65/0.91**; build corr 0.97 / peak err −6ms (validated+locked). Frozen synth set: windowed edge P 0.43→1.00, R 0.33→0.78, negFP 4→0.
- Command(s) run BY INSTIGATOR on the MERGED tip:
  - `node --test tests/audio_*.test.js tests/band_onsets.test.js tests/detector_eval.test.mjs tests/note_estimator_synthetic.test.js tests/companion_*.test.js` → **# tests 250 · pass 250 · fail 0**.
  - `node --test tests/integration/detection_metrics.test.mjs tests/integration/audio_analysis_validation.test.mjs` → **40/40 pass** (validation not regressed).
  - `node engine.js ... --dry-run` → **exit 0**, "Pattern loads and compiles OK".
  - Verified B2+B3 coexist: `audio_config.js` has BOTH `dropMinLevel/slowZoneWidth/slowFluxFloor` (B2) AND `sub.minHz/maxHz` (B3); analyzer `onsetLow/micSub` (B3) preserved.
- Capture(s): SVG detector-vs-label overlays `~/tmp/detection_eval/overlays/default.html` (no chromium in datacenter → self-contained HTML is the viewable artifact; agent inspected). Hard re-runnable proof = the F1 numbers via `node tools/detection_eval.mjs` + 250/40 green.
- Process: root-caused bad drop precision (mic-compressed BUILD ratio spike off noise floor) → added absolute `dropMinLevel` floor + raised `dropEnergyJump`; reworked slow-zone to smoothstep soft-knee; shipped `dropLevelAssist` OFF (a phantom drop on calm music is worse than a miss). Dry-run merge showed no conflicts; ran suites + boot before commit; no state files staged.
- Verdict: B2 crossed off in plan §6. ✅
  - Known: `audio_analysis_validation` tick-p99 perf assertion is a pre-existing flake under concurrent CI load (passed here 40/40 run alone) — not introduced by this work.
