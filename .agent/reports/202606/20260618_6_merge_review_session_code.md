# Merge-readiness review — session code (swipe + dancers trail + vis tools)

Date: 2026-06-18
Reviewer: cold-start code review (read-only)
Scope: commits `410d515..HEAD` (HEAD `099bc70`) on branch
`claude/audio-corpus-tuning-olcd6i`, main worktree.
Method: read all changed files, `node --check`, engine `--list`/`--dry-run`,
per-pixel WASM harness driving `lib/wasm_host.js` against `test_bench`.

## VERDICT: MERGE-READY — YES

No P0 violations, no correctness bugs, no compile/render failures. Two
low-severity polish notes on the diagnostic Node tools (not blockers).

## Files reviewed

- `marsin_engine/patterns/27_swipe.js` (NEW, 203 lines)
- `marsin_engine/patterns/26_dom_dancers_chevron.js` (comet-trail added, +45)
- `marsin_engine/patterns/manifest.json` (par/vintage/bar dancers removed, 30_swipe→27_swipe)
- `marsin_engine/tools/capture_vis.mjs` (NEW)
- `marsin_engine/tools/make_vis_clip.mjs` (NEW)
- skills/reports docs (informational, not code)

## Checks

| # | Check | Result |
|---|---|---|
| 1 | Codex P0: no fallbacks / imports at top / snake_case / no temp in tree | PASS (1 minor tool note) |
| 2 | MarsinScript correctness (reserved names, declare-before-use, radians, palette helpers) | PASS |
| 2b | `node --check` all 4 files | PASS |
| 2c | `--dry-run` 27_swipe / 26 / test_const | PASS (compiled clean, no instruction-limit/blend errors) |
| 2d | `--list` shows 26 + 27_swipe, manifest parses | PASS |
| 3 | 27_swipe behavioural sanity (self-filter, single-px core, walk, blacks) | PASS |
| 4 | Node tools static check | PASS (2 low notes) |
| 5 | Edge cases (wrap math, ring buffer, ordinal formulas, blur scaling) | PASS |

### Detail

**Manifest 1:1.** `manifest.json` lists exactly the non-`test_*` `.js` files in
`patterns/` (00..26, 27_swipe, rainbow). `27_par_dancers`/`28_vintage_dancers`/
`29_bar_dancers` removed from both manifest and disk; `30_swipe` renamed to
`27_swipe`. `test_const`/`test_dualband` are present on disk but intentionally
unmanifested (test harnesses) — consistent with prior convention; `--list`
shows them separately. PASS.

**Ordinal formulas verified against `test_bench` model** (read `models/test_bench.js`):
- Pars fId1..4: nx 0.81/0.64/0.30/0.14. `ord = 4-fId` → ord0=leftmost(fId4),
  ord3=rightmost(fId1). Monotonic with nx. PASS.
- Vintage fId5/6: each 6px idx4-9 / 10-15, ny 0→0.273. `ord=(5?9:15)-index` →
  ord0=ny0(bottom), ord5=top; both strips mirror identically. PASS.
- Bars fId7/8: idx16-33 / 34-51. `ord=(7?33:69)-index` → fId7 ord0(nx0,left)..17,
  fId8 ord18..35(nx1,right). Continuous left→right across both bars. PASS.

**MarsinScript correctness.** `_hsv2rgb1/2` helpers use suffixed locals
(`hv,iv,fv,pv,qv,tv`) — no reserved single-letter names (spec §2.4 reserves
`t,i,index,x,y,z,pixelCount,PI,PI2,...`). Both patterns declare `var r/g/b` in
render3D; `r/g/b` are NOT reserved per spec §2.4 and both compile clean via
dry-run. Trig in radians (`cos(... * PI)`, `atan2`, `hypot`). No
imports/strings/objects. Palette strictly via cp1<->cp2 `_hsv2rgb` cache, no
hardcoded RGB. Declare-before-use holds: arrays (`posHist`/`trail1`/`trail2`)
and helpers are declared above every function that reads them. PASS.

**27_swipe behavioural harness** (`~/tmp/swipe_harness.mjs`, init(52),
setCoords/setPixelMeta from model, compile, control ids from getExports,
localSpeed=blur=trail=shift=0):
- Self-filter: non-listed fixtures lit = 0 at every position. PASS.
- Single-pixel core at pos=0.5: exactly 4 px lit — par ord2 (1), vintage ord3
  on BOTH strips (2 mirrored), bar ord18 (1). Matches "pars 1 / vintage 2
  mirrored / bars 1". PASS.
- Walk: pos 0→1 → par ord 0→3, vintage 0→5, bar 0→35. pos=1.0 lands on the
  LAST pixel, does not fold to 0 (`shifted()` boundary correct). PASS.
- Un-swept = true black: 48/52 px exactly 0 at pos=0.5. PASS.

**Blur/trail/shift harness** (`~/tmp/swipe_blur_trail.mjs`):
- Blur widens core symmetrically: blur0→1px, 0.3→4px, 1.0→12px around ord18.
  Radius scaling `(nPix-1)*0.18` works. PASS.
- Trail leaves a pixelated fading tail (6 lit ords at trail=0.5 vs 1 at
  trail=0). Ring-buffer indexing produces a coherent tail behind the head. PASS.
- Shift rotates start; shift=1.0 wraps equivalent to 0 (single `if (pp>1.0)
  pp-=1.0` suffices since shift∈[0,1], pos∈[0,1], max sum 2.0). PASS.

NB: the standalone harness does not reproduce free-running `phase`/palette hue
faithfully (as warned) — position/brightness/self-filter judged only.

**Node tools.** Both ESM, all `import` at module top. `make_vis_clip.mjs`
throws loudly on missing input (no swallow). `capture_vis.mjs` uses a top-level
`await import()` for the model (runtime arg path) — at module top, P0-compliant.

## Findings (prioritized)

No blockers. Two low-severity notes on the diagnostic capture tool:

- **LOW — `marsin_engine/tools/capture_vis.mjs:87`** — the capture WS has a
  hard timeout `setTimeout(() => { ws.close(); res(acc); }, frames*250+4000)`
  that resolves with whatever frames arrived. If the engine is down/unreachable
  the tool writes a near-empty JSON and exits 0 rather than failing loudly
  (soft success fallback, P0-adjacent). Diagnostic-only tool, needs a live
  engine by design. Fix (optional): if `acc.length===0` on timeout, `reject`/
  `process.exit(1)` with a clear "no vis frames — is the engine up?" message.
- **LOW — `marsin_engine/tools/capture_vis.mjs:69`** — unknown `--set` control
  name is `console.warn`+`continue` (skips silently-ish) instead of failing.
  Acceptable for a dev tool that warns visibly; flagged for awareness.

Both are confined to a never-shipped diagnostic tool (not engine/pattern
runtime), so neither blocks merge.

## Commands run (read-only)

```
git diff 410d515...HEAD --stat
node --check patterns/27_swipe.js patterns/26_dom_dancers_chevron.js tools/capture_vis.mjs tools/make_vis_clip.mjs
node engine.js --list
node engine.js --model test_bench --pattern 27_swipe --dry-run
node engine.js --model test_bench --pattern 26_dom_dancers_chevron --dry-run
node engine.js --model test_bench --pattern test_const --dry-run
node ~/tmp/swipe_harness.mjs ; node ~/tmp/swipe_blur_trail.mjs   (WASM per-pixel)
```

No source edited; no git mutation; dirty runtime-residue files left untouched.
