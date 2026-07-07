# 31_bar_swipe — Validation Report

- **Date:** 2026-06-18
- **Pattern:** `marsin_engine/patterns/31_bar_swipe.js`
- **Model:** `test_bench` (52 px; fId 1..4 pars, 5..6 vintage, 7..8 bars)
- **Branch:** `claude/audio-corpus-tuning-olcd6i` (main worktree)
- **Harness:** `~/tmp/bar_swipe_harness.mjs` (real MarsinVM via `WasmHost`)
- **Overall:** **PASS** — all checks green.

## Checks

| # | Check | Result |
|---|-------|--------|
| 1 | `node --check patterns/31_bar_swipe.js` | **PASS** |
| 2 | `manifest.json` parses; `engine.js --list` shows `31_bar_swipe` | **PASS** |
| 3a | `--model test_bench --pattern 31_bar_swipe --dry-run` compiles clean (exit 0) | **PASS** |
| 3b | `--model test_bench --pattern test_const --dry-run` still clean (exit 0) | **PASS** |
| 4a | Only bars (fId 7,8) ever light; fId 1..6 stay 0 across swipeX 0..1 | **PASS** |
| 4b | Lit band moves LEFT→RIGHT (avg-nx increases monotonically with swipeX) | **PASS** |
| 4c | `swipeDir=1` reverses it (avg-nx decreases with swipeX) | **PASS** |

Harness settings: `sliderLocalSpeed=0` (frozen), `sliderSwipeWidth=0.2` (→ window
0.15), swipeX swept 0→1 in 0.1 steps. "Lit" = max(R,G,B) > 127.

## Non-blank by fixtureId (max brightness ever observed, 0..255)

| fId | kind | max brightness |
|-----|------|----------------|
| 1 | par | 0 |
| 2 | par | 0 |
| 3 | par | 0 |
| 4 | par | 0 |
| 5 | vintage | 0 |
| 6 | vintage | 0 |
| 7 | **bar** | **255** |
| 8 | **bar** | **255** |

Self-filter is exact: pars + vintages never light under any swipeX; both bars
reach full 255.

## Avg-nx of lit band vs swipeX

Forward (`swipeDir=0`, L→R) — rises monotonically:

| swipeX | 0.0 | 0.1 | 0.2 | 0.3 | 0.4 | 0.5 | 0.6 | 0.7 | 0.8 | 0.9 | 1.0 |
|--------|-----|-----|-----|-----|-----|-----|-----|-----|-----|-----|-----|
| avgNx  | 0.0276 | 0.0963 | 0.2062 | 0.3024 | 0.3985 | 0.5000 | 0.6015 | 0.6976 | 0.7938 | 0.9037 | 0.9724 |

Reversed (`swipeDir=1`, R→L) — falls monotonically (clean mirror):

| swipeX | 0.0 | 0.1 | 0.2 | 0.3 | 0.4 | 0.5 | 0.6 | 0.7 | 0.8 | 0.9 | 1.0 |
|--------|-----|-----|-----|-----|-----|-----|-----|-----|-----|-----|-----|
| avgNx  | 0.9724 | 0.9037 | 0.7938 | 0.6976 | 0.6015 | 0.5000 | 0.3985 | 0.3024 | 0.2062 | 0.0963 | 0.0276 |

At swipeX=0 the band sits at the lowest-nx bar pixels (~0.03); at swipeX=1 the
highest (~0.97). Reversing direction exactly mirrors the sequence. The forward and
reverse endpoints/midpoint coincide as expected.

## Issues found

None. Pattern behaves exactly as the header comment intends.
