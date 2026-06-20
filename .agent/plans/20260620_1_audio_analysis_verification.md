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

### A0 — party-mode genre detection + note→colour fix  [PASS]  2026-06-20T05:25Z
- Branch / commit: `dev/genre_signals` @ `89b65c2` → merged into `feat/audio_analysis_2` @ `08d9537` (--no-ff, union-resolved conflicts in `derived_signals.js` + `audio_signals.test.js` keeping BOTH slot-0 genre and slot-3 analyzer blocks).
- IMPORTANT — this slice's SUB-AGENT STALLED mid-task (~02:42Z, no completion/commit). Instigator detected the stall (zero file activity 90 min, no live proc, no commit), reviewed the partial work (genre_classifier.js 406 lines + note/colour fix — both coherent and high-quality), and FINISHED it: wrote the 2 missing validation suites, the datasets note, and the report, then verified before merge.
- Deliverables: `audio/signals/genre_classifier.js` (`GenreClassifier`, 7-genre enum `[ambient,deep_house,melodic_house,tech_house,techno,melodic_techno,downtempo]`, publishes `audioGenre`/`audioGenreConf`); note→colour fix in `switch_signals.js` (pending-latch so a change blocked by the colour dwell is not dropped); `chord_progression` melodic synth.
- Command(s) run BY INSTIGATOR:
  - `node --test tests/genre_classifier.test.js` → **9 pass / 0 fail** (party-gate, warmup, techno-family, downtempo, house-family, tech_house, hysteresis, no-flicker stability).
  - `node --test tests/switch_color_note.test.js` → **4 pass / 0 fail** (blocked note change fires after dwell — the fix; stale intent dropped; held note no strobe).
  - Merged tip full audio suite: `node --test tests/audio_*.test.js tests/genre_classifier.test.js tests/switch_color_note.test.js tests/band_onsets.test.js tests/detector_eval.test.mjs tests/note_estimator_synthetic.test.js tests/companion_*.test.js` → **263 pass / 0 fail**.
  - `node engine.js ... --dry-run` → **exit 0**; registry confirms `audioGenre` + `audioChestHit` both present (genre + analyzer keys coexist).
- Capture(s): none visual (signal logic — numeric/test proof above). Genre test scenarios are deterministic and committed.
- Process: resolved 6 union conflicts in derived_signals.js (imports/ctor/reset/tick/setMany/_zero — kept both modules) and the registry-order conflict in audio_signals.test.js (verified actual order via `audioRegistryEntries()`: genre keys then analyzer keys). Initial genre-test failures (downtempo/tech_house → techno) were a TEST-scenario bug (fed zero note-changes; classifier expects `melodic≈0` only for techno) — fixed the scenarios, not the classifier.
- INCIDENT (resolved): mid-merge, the main checkout's `marsin_engine/node_modules` had become a self-referential symlink (circular → `fft.js` unresolvable, 3 analyzer-dependent test files failed to import). Fixed by `rm` the bad link + `npm install` (fft.js restored); re-ran → 263 green. Root cause likely a stray `ln -sf` from a stalled worktree; no source impact. Watching for recurrence.
- Verdict: A0 crossed off in plan §6. ✅

### A1 — companion OSC-OUT accounting page + CaptainPad theming  [PASS]  2026-06-20T05:40Z
- Branch / commit: `dev/companion_ui` @ `bf3fdb8` → merged into `feat/audio_analysis_2` @ `1924803` (--no-ff, clean — companion files disjoint from all other slices).
- IMPORTANT — sub-agent STALLED mid-task (same as A0). Instigator detected, reviewed the partial work (generic `/osc_accounting` endpoint+page, 5 theme blocks, genre wiring, a passing test — all coherent), finished it (functional verification + report), verified before merge.
- Deliverables: `/osc_accounting` REST endpoint + live UI page enumerating every OSC output to the engine (`{address,label,cpcKey,kind,count,value,rateHz}` + target + totalSent, generic so new signals auto-appear, 250ms cadence); 5 CaptainPad themes (`[data-theme]` CSS + localStorage picker); DERIVED-panel genre readout (index→name via lock-step GENRE_NAMES).
- Command(s) run BY INSTIGATOR:
  - `node --test tests/companion_*.test.js` → **69 pass / 0 fail** (incl. new accounting test that boots the real server + asserts accounting shape, `/catalog.genreNames` deep-equals canonical, per-theme CSS-var completeness).
  - Live: `curl http://localhost:31166/` → **HTTP 200**; `curl /osc_accounting` → structured output list (captured: target 127.0.0.1:10000, outputs[] with /marsin/mic/low etc. each carrying address/label/cpcKey/kind/count/value/rateHz); `curl /catalog` → genreNames = the canonical 7.
  - Genre enum lock-step verified: classifier GENRE_NAMES == companion server's 7 genres (`true`).
- Capture(s): `/osc_accounting` + `/catalog` JSON captured (in chat log). **No UI screenshot** — no chromium/puppeteer in this datacenter; the committed test (asserts accounting shape + genre catalog + per-theme CSS-var completeness) is the durable proof in lieu of an image. Follow-up: visual check on a browser machine before playa.
- **FULL INTEGRATION SWEEP (all 5 slices merged):** `node --test tests/audio_*.test.js tests/genre_classifier.test.js tests/switch_color_note.test.js tests/band_onsets.test.js tests/detector_eval.test.mjs tests/note_estimator_synthetic.test.js tests/companion_*.test.js tests/integration/detection_metrics.test.mjs` → **270 pass / 0 fail**.
- Verdict: A1 crossed off in plan §6. ✅ — **ALL 5 Wave-A/B code slices now merged + verified.**

## Wave C — adversarial wave
### C-fix-signals — adversarial P1 batch (startup guard / party warmup / genre conf / dead BPM params)  [PASS]  2026-06-20T06:35Z
- Commit: `feat/audio_analysis_2` @ `a775398` (pushed).
- Fixes (each independently confirmed by ≥2 of the 5 adversarial auditors):
  switch_signals startup guard now relative (`_firstTickMs`); party_mode `warmupMs` gate;
  genre_classifier argmax seed `-Infinity` (deep_house conf was structurally 0);
  removed dead `PARAMS.bpm` + fixed `audioBpm` doc range.
- Command(s) run BY INSTIGATOR:
  - `node --test tests/genre_classifier.test.js tests/switch_color_note.test.js tests/party_mode.test.js tests/audio_signals.test.js tests/note_estimator_synthetic.test.js` → **35 pass / 0 fail**.
  - Full audio suite `node --test tests/audio_*.test.js tests/genre_classifier.test.js tests/switch_color_note.test.js tests/party_mode.test.js tests/band_onsets.test.js tests/detector_eval.test.mjs tests/note_estimator_synthetic.test.js tests/companion_*.test.js` → **271 pass / 0 fail**.
  - Independent auditor (adversary 5) ran the committed tree → **295 pass / 0 fail**; measured `DerivedSignals.tick()` p99 ~0.38 ms (within budget); confirmed the `audio_analysis_validation` perf-flake is NOT real (3× concurrent, all green); offline-readiness / mic-failure / tracked-state all CLEAN.
- New regression tests: `party_mode.test.js` (4, module had none), switch startup-guard test, genre confidence test.
- Process: 5 read-only adversarial auditors (DSP / detection+genre / signals / companion+UI / robustness) audited the merged tree; I implemented the confirmed-safe signals P1s inline, captured all findings in report `20260620_9`, and routed the disjoint companion/CaptainPad/test-gap fixes (items 5–10) to `dev/companion_captainpad_fixes`. Bigger items (FFT 2048, fixed-dt, genre v2 real-audio tuning, detector scoring honesty) documented as coordinated follow-ups.
- Verdict: C-fix-signals crossed off. ✅  C-fix-companion in flight; C-backlog documented.

### C-fix-companion — companion/CaptainPad adversarial polish (items 5–10)  [PASS]  2026-06-20T07:00Z
- Branch / commit: `dev/companion_captainpad_fixes` @ `179a6d8` → merged into `feat/audio_analysis_2` (--no-ff, clean).
- Fixes: accounting `rateHz` decays by idle (no stale-rate lie); light-theme `--on-accent` token (contrast 2.86:1 → 6.49:1); themed confirm modals replace both `window.confirm()` (0 native dialogs); CaptainPad `isGenreKey` excludes `conf`, band-token match segment-anchored (kills `audioSlowZone`→LOW collision); new `derived_signals_perf_finiteness.test.js`.
- Command(s) run BY INSTIGATOR on the MERGED tip:
  - `node --test tests/companion_*.test.js tests/derived_signals_perf_finiteness.test.js` → **72 pass / 0 fail**; `[derived perf] hops=200000 p50=0.0107ms p99=0.3897ms` (budget 0.5).
  - `cd CaptainPad && npx tsc --noEmit` → **exit 0**.
  - Final full audio sweep `node --test tests/audio_*.test.js tests/genre_classifier.test.js tests/switch_color_note.test.js tests/party_mode.test.js tests/band_onsets.test.js tests/detector_eval.test.mjs tests/derived_signals_perf_finiteness.test.js tests/note_estimator_synthetic.test.js tests/companion_*.test.js tests/integration/detection_metrics.test.mjs` → **279 pass / 0 fail**.
- Agent proof (report `20260620_10`): WCAG ratios, 70/70 companion ×3 consecutive, behavioral node checks for items 7/8, live `/osc_accounting` curl. No screenshots (no chromium) — CSS-var theme test + WCAG numbers + grep-confirmed no native dialogs.
- Verdict: C-fix-companion crossed off. ✅ — **ALL adversarial implement-now items (signals + companion/CaptainPad + test-gaps) landed.**

### C-fix-quality — safe quality pass (scoring honesty / dom2 smoothing / docs)  [PASS]  2026-06-20T07:45Z
- Branch / commit: `dev/audio_safe_quality` @ `dfe7580` → merged into `feat/audio_analysis_2` (--no-ff, clean).
- Items (all SAFE, no FFT/dt/genre-tuning touched): (1) `detection_eval.mjs` ADDITIVE `falseFiresPerMin` + `guardedPrecision` (existing P/R/F1 unchanged); `detection_sweep` ranks on the honest metric. (2) dom2 retarget low-pass (`retargetBlend=0.5`) — discontinuous `micDomFreq2` jump smoothed; note/genre/analyzer 55/55 green. (3) doc fixes (useKalman comment, genre header).
- Command(s) run BY INSTIGATOR on the MERGED tip:
  - `node --test tests/audio_*.test.js tests/genre_classifier.test.js tests/note_estimator_synthetic.test.js tests/dominant_freq_tracker_retarget.test.js tests/detector_eval.test.mjs tests/companion_*.test.js tests/derived_signals_perf_finiteness.test.js` → **261 pass / 0 fail**.
  - `node engine.js ... --dry-run` → **exit 0**.
- Metric proof (agent): shipped `default` UNCHANGED (`P=1.00 R=0.56 F1=0.71` → `guardedP=1.00 falseFiresPerMin=0.00`); the new metric exposes hidden phantom drops on a false-firing `level` config (`guardedP=0.58 falseFiresPerMin=0.83`, 3 phantoms the old precision hid). Sweep winner unchanged.
- Verdict: C-fix-quality crossed off. ✅

### D6 — real CC genre corpus + genre_eval harness  [PASS]  2026-06-20T08:30Z
- Branch/commit: `dev/audio_corpus_real` → merged into `feat/audio_analysis_2` (--no-ff, clean, all additive).
- Deliverables: `tools/genre_eval.mjs` (real engine-chain genre eval, confusion matrix, `--corpus/--fft/--json`), `datasets/genre_corpus_manifest.json` (60 CC tracks, 10 genres, archive.org netlabels — per-track license/id/url pinned), `tests/genre_eval_harness.test.mjs`, datasets/README update. Audio WAVs in ~/tmp (not committed).
- Command(s) run BY INSTIGATOR: `node --test tests/genre_eval_harness.test.mjs` → **2 pass / 0 fail**.
- KEY FINDING (real-audio truth): genre classifier baseline **8/36 = 22.2% @ fft1024** (chance ~17%) — the synthetic tuning did NOT transfer. Root causes (measured centroids): `melodic` note-rate reads ~0.10–0.21 for ALL genres (doesn't saturate → melodic_house/melodic_techno never predicted, techno over-fires); `kickDens` saturates ~0.9 everywhere; `sparkle` polarity inverted (deep_house brightest, not techno); `sparkleVar` no longer flags tech_house.
- Verdict: D6 crossed off. ✅ — and it MANDATES a data-driven genre re-tune (queued D7, after the FFT change).
