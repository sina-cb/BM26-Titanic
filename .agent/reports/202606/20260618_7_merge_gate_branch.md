# Merge Gate — `claude/audio-corpus-tuning-olcd6i` → `main`

- **Date:** 2026-06-18
- **Reviewer role:** cold-start merge-readiness gate (breadth, not deep logic)
- **Branch:** `claude/audio-corpus-tuning-olcd6i` (141 commits ahead of `main`)
- **Worktree:** `C:/Users/sina_/workspace/BM26-Titanic` (Windows + Git Bash)
- **Scope:** auto-checks, manifest consistency, working-tree cleanliness, P0/hygiene breadth scan. NO source edits, NO git mutations.

## VERDICT: MERGE-READY — WITH-FIXES

All five engine auto-checks PASS. The manifest is 1:1 consistent and the
`27_swipe` rename is clean. The working tree contains only the expected runtime
residue. The blockers are minor hygiene items (one stale doc reference in a
committed tool) plus a set of empty-`catch` swallows in the new audio code that
should be adjudicated by the deep-logic reviewer against the P0 "no silent
fallbacks" rule. None of the auto-checks fail; nothing is a hard structural
blocker.

---

## 1. Engine auto-checks (`.agent/00_gol/05_*`)

| # | Check | Command | Result |
|---|---|---|---|
| 1 | Whitespace / conflict markers | `git diff --check -- marsin_engine marsin_pb` | **PASS** (exit 0; only informational LF→CRLF warnings on 5 residue files, no conflict markers / trailing-WS errors) |
| 2 | JS syntax, every changed engine file | `node --check` over each `*.js/.mjs/.cjs` from `git diff --name-only main...HEAD -- marsin_engine` (~130 files) | **PASS** (0 failures; no deleted-file references in the changed list) |
| 3 | Pattern listing | `cd marsin_engine && node engine.js --list` | **PASS** (exit 0; **31 patterns**, incl. `26_dom_dancers_chevron`, `27_swipe`; no 28/29/30/31) |
| 4 | Base dry-run | `node engine.js --pattern test_const --model test_bench --dry-run` | **PASS** (exit 0; **no** missing blend/transition warning) |
| 5a | Active dry-run | `node engine.js --pattern 26_dom_dancers_chevron --model test_bench --dry-run` | **PASS** (exit 0; no warnings) |
| 5b | Active dry-run | `node engine.js --pattern 27_swipe --model test_bench --dry-run` | **PASS** (exit 0; no warnings) |

## 2. Manifest ↔ files (1:1)

**PASS.** `marsin_engine/patterns/manifest.json` lists 29 entries
(`00_…25_heartbeat`, `26_dom_dancers_chevron`, `27_swipe`, `rainbow`). Every
entry has a matching `patterns/<name>.js`. The only top-level `.js` not in the
manifest are `test_const.js` and `test_dualband.js` — test/helper patterns,
surfaced separately by `--list` (consistent with prior convention).

- Rename verified: `git diff --name-status main...HEAD` shows **A** for
  `26_dom_dancers_chevron.js` and `27_swipe.js`. No `27/28/29_dom_dancers`,
  no `30_swipe`, no `31_bar_swipe` source files remain.
- 44 `summer_camp/*` patterns are pure **R100** moves (path change only,
  identical content) — not new code.

## 3. Codex P0 / hygiene scan (changed files only)

- **Filenames:** all changed engine source is `snake_case`. **PASS.**
- **Scratch/tmp/debug files committed:** none (`*.tmp`, `scratch`, `debug_`,
  `.bak`, `.orig`, `.log` — clean). **PASS.**
- **`require()` / imports inside functions:** engine is ESM; no `require()` in
  changed engine source; no `import`/`export` found inside function bodies.
  The single `await import(...)` in `tools/capture_vis.mjs:58` is a legitimate
  runtime model loader (path built from `--model`), not a wrapped dependency
  fallback. **PASS.**

### Findings (WITH-FIXES — for deep-logic reviewer to adjudicate)

**H1 (hygiene, low) — stale pattern name in committed tool comment.**
`marsin_engine/tools/capture_vis.mjs:12` usage example reads
`--pattern 30_swipe`. `30_swipe` was renamed to `27_swipe`; the example points
at a non-existent pattern. The two new skill docs
(`.agent/01_skills/07_pixel_vis_clips.md`,
`.agent/01_skills/08_visualize_patterns_widget.md`) correctly say `27_swipe`.
Fix: update the comment to `27_swipe`.

**H2 (P0 candidate, medium) — empty-`catch` swallows in NEW audio code.**
A breadth scan flagged empty / fallback `catch` blocks in in-diff files. Many
are idiomatic teardown/probe guards (kill on SIGKILL, ws.close on teardown,
statSync existence probe, mkdir/unlink "if exists") which the codex generally
tolerates; two look closer to a genuine silent fallback and warrant a closer
look:

  - `audio/postproc/signal_post_processor.js:407` — `catch { return false; }`
    substitutes a default for a `paramCenter.get()` error.
  - `audio/companion/companion_server.js:893` — `catch { return; }` silently
    drops a malformed WS message.
  - Idiomatic guards (report only): `companion_server.js:84,744`,
    `engine_config_link.js:84`, `audio_config_store.js:74,133`,
    `audio_devices.js:144`, `audio_capture.js:360`.

  These are in NEW files this branch adds, so they are in scope. I am NOT
  asserting them all as hard P0 violations — that is a deep-logic call. Flagged
  for the next reviewer against "no silent fallbacks, fail loudly."

  Note: an automated scan also flagged `lib/autopilot.js`,
  `lib/ffmpeg_resolver.js`, `lib/marsin_wasm_runtime.js` — these are
  **OUT OF THIS BRANCH'S DIFF** (pre-existing on `main`) and are **not** this
  branch's concern.

- **Debug `console.log` pollution:** not separately swept (breadth gate); the
  engine boot banner / `--list` output is intentional. No obvious stray
  per-frame logging surfaced in dry-runs.

## 4. Working-tree cleanliness

`git status --short` — **PASS (expected residue only):**

```
 M marsin_engine/models/test_bench.effects.js
 M marsin_engine/models/test_bench.js
 M marsin_engine/models/test_bench.viewmasks.js
 M marsin_engine/states/test_bench/deck_state.yaml
 M marsin_engine/states/test_bench/globals_state.yaml
 M simulation/scenes/test_bench/playlists/default.yaml
```

All six are the documented intentional runtime residue (test_bench model +
states + sim playlist). No stray files, no accidental source edits, nothing
untracked. (`config.yaml` and `mixer_state.yaml` were noted as possible residue
in the brief but are clean here.)

## 5. New tools / skills / docs hygiene

- `marsin_engine/tools/capture_vis.mjs` — Node-clean: imports at top, no
  fallbacks (try/catch only guards WS JSON frames + close). One stale comment
  (**H1**).
- `marsin_engine/tools/make_vis_clip.mjs` — Node-clean: imports at top, no
  fallbacks, `snake_case`.
- `.agent/01_skills/07_pixel_vis_clips.md`,
  `.agent/01_skills/08_visualize_patterns_widget.md` — reference `27_swipe`
  correctly. **PASS.**
- Historical reports `.agent/02_reports/202606/20260618_1_bar_swipe_validation.md`
  and `…_4_swipes_and_dancing_balls_session.md` reference `31_bar_swipe` — these
  are **dated session logs of superseded work**, not live docs, so the stale
  name is acceptable historical record (not a fix item).

## 6. Tests

| Suite | Result |
|---|---|
| `tests/pattern_mixer_masking.test.js` + `tests/view_mask_constants.test.js` | **PASS** 53/53 |
| Sample audio units: `audio_signals`, `signal_post_processor`, `param_center`, `note_estimator_synthetic`, `bpm_speed_sync` | **PASS** 161/161 (exit 0) |
| HIL (`tests/hil/*`) | **SKIPPED** — require a live engine on :6968 (per brief) |

## Prioritized blocker list

1. **(H2, medium — adjudicate before merge)** Deep-logic reviewer to confirm
   whether the empty-`catch` swallows in `signal_post_processor.js:407` and
   `companion_server.js:893` (and the idiomatic guards listed) comply with the
   P0 "no silent fallbacks / fail loudly" rule, or need to be made loud.
2. **(H1, low — quick fix)** `tools/capture_vis.mjs:12`: change `30_swipe` →
   `27_swipe` in the usage comment.

Nothing else blocks. All auto-checks pass, manifest is consistent, tree is clean.
