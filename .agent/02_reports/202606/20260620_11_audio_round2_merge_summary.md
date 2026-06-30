# 2026-06-20 — Audio Round 2: merge summary (deliverable `feat/audio_analysis_2`)

**Deliverable:** branch `feat/audio_analysis_2`, pushed to origin. No PR opened (not
requested). This is the end-to-end summary of the autonomous run driven from
`.agent/plans/20260620_0` with proof in `…/20260620_1_verification.md`.

## What shipped (operator's asks, all delivered)
| Ask | Result |
|---|---|
| Genre detection (techno/melodic house/deep house + BM genres) from kick/low/high | `GenreClassifier` → `audioGenre`/`audioGenreConf`, 7-genre enum, party-mode only |
| Note detection validation + note→colour signal fix | root-caused dropped-change bug (pending-latch) + regression tests |
| Companion "all OSC out on one page" accounting | `/osc_accounting` endpoint + live UI page (generic, rate-decaying) |
| Companion uses CaptainPad themes | 5 themes (light/dark/midnight/sunset/gruvbox) + picker, WCAG-fixed |
| 2 agents: new features + low-hanging fruit | reports `20260620_2`, `20260620_3` |
| Drop / slow-zone / build-up super-tuning + validation | Drop F1 0.29→0.71, slow-zone acc 0.46→0.91, build corr 0.97; eval harness |
| P1+ DSP/signal features | per-band onsets + sub-bass chest-hit |
| 5 adversarial agents → find + implement top P0/P1 | `20260620_9`; signals + companion/CaptainPad P1s landed |
| Datasets noted | `marsin_engine/datasets/README.md` (synthetic genre profiles; real-audio gated) |
| Reports + verification discipline | `20260620_2`–`20260620_11`, `_verification` proof log |

## Merge order + SHAs (safest-first)
1. `bd0fc34` — B4 CaptainPad audio UI
2. `1aa12f4` — B3 analyzer per-band onsets + sub-bass
3. `8ac1b6d` — B2 detector super-tuning + scoring harness
4. `08d9537` — A0 genre detection + note→colour fix (sub-agent stalled; instigator finished)
5. `1924803` — A1 companion OSC accounting + theming (sub-agent stalled; instigator finished)
6. `a775398` — adversarial signals P1 batch (startup guard / party warmup / genre conf / dead BPM params)
7. (this) — C-fix-companion polish (rateHz decay, theme contrast, confirm modals, key-matching, perf+finiteness tests)
+ repo fix `9364f64` (untrack stray node_modules symlink + harden .gitignore).

## Final verification
- Full audio sweep (merged tip): **279 pass / 0 fail**.
- `DerivedSignals.tick()` perf (party + genre + shapers hot): p50 0.011 ms, **p99 0.39 ms** (budget 0.5).
- CaptainPad `tsc --noEmit` exit 0, lint exit 0.
- Engine `--dry-run` exit 0. Offline-readiness / mic-failure / tracked-state CLEAN (auditor-verified).
- Independent adversary observed **295 pass** on the committed tree pre-polish.

## New CPC keys
`audioGenre`, `audioGenreConf`; `micOnsetLow/Mid/High` (+ raw mirrors), `micSub`/`audioChestHit`.
All engine-internal derived (no inbound OSC); registered + validated; companion + CaptainPad display them.

## Run notes / incidents (handled)
- **Two sub-agents (A0 genre, A1 companion) stalled mid-task** (~2.5 h, no completion). Instigator
  detected via file-activity/proc checks, took over both as developer, finished the missing
  tests/validation/reports, and verified before merge.
- **Tracked `node_modules` symlink** (committed by a worktree `git add -A`; the `node_modules/`
  ignore rule didn't match a symlink) caused a self-referential link breaking `fft.js` on merge —
  untracked + `.gitignore` hardened (`9364f64`).
- 12 sub-agents total: 2 discovery + 5 (B-wave/A-wave dev) + 5 adversarial + 1 polish (some via
  worktrees with per-slot ports; ≤2–3 engines concurrent per the resource cap).

## Backlog — coordinated follow-ups (documented in `20260620_9`; NOT landed piecemeal)
- **FFT 1024→2048** (+ honest `sub` 30–60 Hz window; today it overlaps the kick) — re-validate
  genre/dom/note/sub as ONE slice. Highest-leverage quality change.
- **Fixed-`dt`** to signal consumers (JitterBuffer multi-hop drain) — engine.js + HIL.
- **Genre v2 robustness** — note-present vs note-flipped (techno over-selection on gated mic),
  `confSpread` recalibration; needs real labelled per-genre audio (datacenter-gated).
- **Detector scoring honesty** — fold `negFp` into precision/F1; mic-gain-relative drop gate;
  second-drop/breakdown recall; promote auditor-2's adversarial synths into `detector_scenarios.mjs`.
- P3 cleanups (dom2 retarget LPF, stale `useKalman` comment, `_kalmanNis` dt, dup genre lists).

## Operator action requested
Review `feat/audio_analysis_2` (pushed). Open a PR when you want it on its way to main.
The backlog above is the prioritized next-session plan; the FFT-2048 + genre-v2 real-audio
tuning are the two highest-value items and want an un-gated network for real-audio validation.
