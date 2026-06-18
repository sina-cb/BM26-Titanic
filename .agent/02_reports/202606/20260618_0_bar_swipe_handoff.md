# Handoff — `bar_swipe` pattern (pars-only high-contrast swipe)

**Date:** 2026-06-18
**Branch:** `claude/bar-swipe` (cut from `origin/claude/audio-corpus-tuning-olcd6i` @ `d3cb883`)
**Prepared by:** prior agent (audio companion / patterns work). **For:** the next agent to implement.

---

## ⚠️ Name vs. target — confirm with the operator
The operator asked for a pattern that **lights ONLY the pars** and **swipes across them 0→1, left→right or right→left by a param**, described as "on the pars view"… but said **"call it `bar_swipe`."** So: the **behavior targets the PARS** (fixtureId 1..4), while the **name is `bar_swipe`** per the operator's words. Implement it on the **pars** as described and name the file `bar_swipe.js`. **Flag this** in your report — if the operator actually meant the *bars* (fId 7..8), it's a one-line change to the self-filter + the row mapping (and a rename to `par_swipe` if they meant pars). Do **not** silently pick bars; the description is unambiguous that the **pars** light up.

---

## The task — `marsin_engine/patterns/3N_bar_swipe.js`
Number it after the existing patterns (currently the active set is `00`..`29`; use the next free number — **`30_bar_swipe.js`** — and register it in `marsin_engine/patterns/manifest.json` immediately after `29_bar_dancers`).

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
**`marsin_engine/patterns/27_par_dancers.js`** — already self-filters fId 1..4, maps the four pars to a left→right row `(4-fId)/3`, and has the palette helpers. `bar_swipe` is a simpler sibling: a hard bright edge sweeping the same row instead of two soft dancers.

## Validation (do before reporting; do NOT commit unrelated dirty files)
1. `cd marsin_engine && node --check patterns/30_bar_swipe.js`
2. `node -e "JSON.parse(require('fs').readFileSync('patterns/manifest.json','utf8'))"` (manifest parses) and `node engine.js --list | grep bar_swipe`.
3. `node engine.js --model test_bench --pattern 30_bar_swipe --dry-run` (compiles via MarsinCompiler, no instruction-limit / blend errors); `test_const --model test_bench --dry-run` still clean.
4. **Per-pixel render smoke test** (small WASM-VM harness over all 52 test_bench pixels — copy the harness approach the 26/27/28/29 work used): confirm **only fId 1..4 (the par pixels, index 0..3) ever light**, fId 5..8 stay 0; and confirm the swept par moves across the row from 0→1 as `swipeX`/time advances, and **reverses** when the direction param flips.
5. Optionally render the sim (`.agent/01_skills/00_see_the_world.md`; fresh chrome `--user-data-dir` if headless GL is flaky) — else rely on the per-pixel harness.

## Report back
The pattern filename + number, the exact controls + their ranges, the direction/position param semantics, the per-pixel nonblank-by-fixtureId table (pars only), how the swipe achieves high contrast, MarsinScript compliance notes, and **the name/target flag** (bar_swipe-named but pars-lit — confirm with operator).

---

### Ready-to-run agent prompt (paste/spawn this)
> Repo: BM26-Titanic, branch `claude/bar-swipe` (already checked out). Read CLAUDE.md + .agent/00_gol/00_codex.md + docs/MARSIN_ENGINE_PATTERNS.md + docs/MARSIN_PB_LANG_SPEC.md + .agent/00_gol/08_* (marsinscript) + the pattern auto-check .agent/00_gol/05_* + the render skill .agent/01_skills/00_see_the_world.md. Do NOT revert unrelated dirty runtime-residue files (config.yaml, marsin_engine/states/*, models/test_bench.{js,effects.js}, summer_camp_dome playlist).
>
> Implement a **very simple, HIGH-CONTRAST swipe pattern** `marsin_engine/patterns/30_bar_swipe.js` that **lights ONLY the pars** (self-filter `if (fixtureId < 1 || fixtureId > 4) { rgb(0,0,0); return; }`) and sweeps a sharp bright edge **0→1 across the four pars** treated as one left→right row (`(4-fixtureId)/3`: fId4=left=0 … fId1=right=1, same mapping as `27_par_dancers.js`). Expose a **direction/position param** (`swipeX` 0..1 and/or `swipeDir`) so the sweep goes left→right or right→left "based on an x param" and can be modulation-driven; `localSpeed` animates it. The swept par(s) are full brightness on the strict **cp1↔cp2 palette** (reuse the `_hsv2rgb1/2`/`cp*`/`clamp01` helpers from 26/27 — no hardcoded RGB), everything else ~0 (hard on/off). Controls: `localSpeed, swipeX, swipeWidth, swipeDir, colorPalette1, colorPalette2` + matching slider fns. **Register** `30_bar_swipe` in `patterns/manifest.json` after `29_bar_dancers`. **Validate:** node --check; manifest parses; `--list` shows it; `--dry-run` compiles clean; a per-pixel WASM-VM harness over all 52 test_bench pixels confirms **only fId 1..4 light** (fId 5..8 = 0) and the swept par moves 0→1 and reverses with the direction param. **NOTE & report:** it's named `bar_swipe` but lights the **pars** per the operator's description — flag this so the operator can rename to `par_swipe` or retarget to bars if intended. Commit to `claude/bar-swipe` and report the design + the per-pixel table.
