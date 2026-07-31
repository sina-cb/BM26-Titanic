# 2026-07-29 — Generator editor: SELECT FREEZE killed + COLD MOVE landed (plan `_44` slice 1)

Opus implementer session. Executes **slice 1** of
`20260725_44_generator_ux_fixes_plan.md` §4 (steps 1-7) verbatim. Everything
here is editor-plumbing: **zero writes to `scenes/**` or `models/**`**, no
server started or stopped, no git operations. All measurement ran as a
triple-save-guarded browser client of the operator's live `:6969`.

---

## 0. TL;DR

- **Select freeze is gone.** `main.js` listened to TransformControls' `change`,
  which the vendored control dispatches from the setter of *every* tracked
  property — so `attach()` (select) and gizmo hover each ran a full
  `generateGroupFromTrace` → `rebuildParLights` → shader-recompile storm.
  Rewired to `objectChange` (fires only on a real transform).
  **2,719 ms → 0-133 ms** rAF stall per select-click, **1 → 0** regenerates.
- **Generator drag is now free.** Per-tick regeneration replaced by a dirty
  mark + one flush on the existing `dragging-changed` release seam.
  **0.4 FPS → 52-59 FPS paced drag (= idle FPS on the same adapter)**; per-tick
  handler JS **24.5 ms → 0.1 ms** (circle) and **23.7 ms → 0.4 ms** (line
  handle). Release does **exactly one** regenerate.
- **The LED move-trail fix is intact and now has a test.** Release *always*
  invalidates the batch cache; after every drag the cached batch render list is
  byte-equal to a fresh `generatePixelMap()` — proven for a generator drag AND
  an LED strand handle drag, in the harness, every run.
- **Suite: 805 → 829 tests, 821 pass, the same 8 pre-existing failures.** Zero
  new failures. Parity CLI verdicts unchanged (nothing touched scenes/models —
  scene file mtimes are 6 minutes *older* than my first edit and unchanged
  across all seven browser runs).

---

## 1. Per-step outcomes (plan §4 slice 1)

| Step | What the plan asked | Outcome |
|---|---|---|
| **1** | Rewire `main.js:240` `"change"` → `"objectChange"`; audit what rode `change` | **DONE.** `main.js` now `addEventListener("objectChange", onTransformChange)`. Audit: the vendored control dispatches `change` at TransformControls.js:124 (every property setter — `object`, `axis`, `mode`, `dragging`…), :720 and :793; `objectChange` only at :721 (real pointerMove transform) and :794 (`reset()`). Nothing in this repo used `change` for rendering — `animate()` is an unconditional rAF loop — so **no render-only listener was added**. Acceptance met: a select-click now produces **0** `invalidateMarsinBatchCache` and **0** `controllerMappingFixturesRemoved` (was 1 + 1). |
| **2** | Cold move: keep lightweight per-tick updates, defer the tail regenerate behind a pure, unit-testable scheduler | **DONE.** New pure module `simulation/src/dmx/trace_regen_scheduler.js` (no THREE/DOM/window). `_onTraceTransformChange` keeps every visual update and, while `transformControl.dragging`, calls `markTraceRegenDirty(tIdx)` instead of regenerating. Outside a drag (undo, programmatic) it regenerates immediately, exactly as before. |
| **3** | Release seam in the existing `dragging-changed` listener | **DONE.** `main.js` `flushPendingEditorRegens()` runs on `event.value === false`. The doer is `window._flushPendingEditorRegens` (gui_builder closure — it owns `generateGroupFromTrace`): one regenerate per dirty trace + the strand invalidation + one `debounceAutoSave`. Inside the same undo step (`pushUndo` still fires at drag start). |
| **4** | Same deferral for preview-dot drags | **DONE.** `_updateTraceDotDrag` keeps `refreshTraceDots` (that *is* the feedback) and marks dirty; `_endTraceDotDrag` flushes **before** its `debounceAutoSave`, so a save can never persist a trace whose fixtures have not caught up. |
| **5** | Strand cold move with the trail fix preserved | **DONE.** `_onStrandTransformChange` still runs `writeTransformToConfig` + `rebuildVisuals` every tick (the strand's own bulbs track the cursor); only `invalidateMarsinBatchCache('strand_transform')` + autosave are deferred. Contract honoured: **release always invalidates.** Divergence documented + screenshotted (§4). |
| **6** | Mandatory trail-regression test | **DONE.** Harness checks F1/F2: after release, the cached batch render list equals a fresh `generatePixelMap()` for all 987 pixels — same length, 0 coordinate mismatches — for a dragged generator and a dragged strand handle. A stale-coordinate regression fails the harness loudly. |
| **7** | `agent_tools/generator_ux_verify.cjs` + before/after timings + scheduler units | **DONE.** New harness (21 checks, all green), 17 new unit tests across two files. Timings in §2. |

### Files touched (slice-1 ownership only)

| File | Change |
|---|---|
| `simulation/main.js` | `objectChange` rewire + `flushPendingEditorRegens()` release seam + scheduler import |
| `simulation/src/gui/gui_builder.js` | trace-transform tail, dot-drag tick + end, strand-transform tail, new `window._flushPendingEditorRegens` |
| `simulation/src/dmx/trace_regen_scheduler.js` | **new** — pure dirty ledger |
| `simulation/tests/trace_regen_scheduler.test.js` | **new** — 10 contract tests |
| `simulation/tests/transform_event_discipline.test.js` | **new** — 7 wiring-regression tests |
| `simulation/agent_tools/generator_ux_verify.cjs` | **new** — live before/after harness |

`simulation/src/core/interaction.js` was in my ownership list but **needed no
change**: its routing (`isTrace` → `_onTraceTransformChange`, `isLedStrand` →
`_onStrandTransformChange`, dot-drag pointer plumbing) was already correct; the
bugs were the event name in `main.js` and the two handler tails.
Slice-3 files (`pixel_map_layout.js`, `chain_order_visual.js` + its
gui_builder call site, `controller_map_editor.js`) were **not touched**.

---

## 2. Before / after timings — MANDATORY table

Same method as the plan's §1 baseline: fresh Chromium per run, browser client of
the live `:6969` titanic scene (`profile=full&renderer=webgl`), real synthetic
mouse click for select, rAF-paced direct invocation of the real tick handlers
for drag, browser closed after each run.

**Adapter (recorded next to every number, ops rule `_39`):**
`ANGLE (NVIDIA, NVIDIA GeForce RTX 4090 Laptop GPU (0x00002757) Direct3D11
vs_5_0 ps_5_0, D3D11)` — `integrated: false`, `detectionFailed: false`.
Scene census at measurement: 90 parLights, 8 LED strands, 987 pixels,
14 traces, 234 interactive objects, chain-order viz ON.

| Measurement | BEFORE (`_44` §1) | AFTER (this session) | Verdict |
|---|---|---|---|
| Select, real 3D click — max rAF gap | **2,719 ms** (+167 ms) | **0 / 67 / 67 / 77 / 100 / 133 ms** across 6 runs | ✅ budget < 150 ms |
| Select — batch invalidations | 1 (`fixtures rebuilt`) | **0** | ✅ |
| Select — regenerates (`controllerMappingFixturesRemoved`) | 1 | **0** | ✅ |
| Select via GUI card (control) | 83-100 ms, 0 regenerates | 67-217 ms, 0 regenerates | unchanged path |
| Drag tick JS — circle hitbox | 24.5 ms median (max 31.5) | **0.1 ms** median (max 0.4-1.3) | ✅ 245× |
| Drag tick JS — line start-handle | 23.7 ms median | **0.4 ms** median (max 0.8) | ✅ 59× |
| Drag tick JS — LED strand handle | (not isolated in `_44`) | **0.2-0.5 ms** median | — |
| Frame stall per drag tick | **~2.4-2.9 s each**, 11 rebuilds / 10 ticks | **0-100 ms max gap for the whole 10-tick drag**, **0** rebuilds | ✅ |
| Paced drag (1 tick/rAF) | **0.4 FPS** | **52.0 / 55.0 / 55.5 / 59.1 FPS** | ✅ |
| Idle FPS in the same sample | (n/a) | 52.0 / 54.9 / 53.7 / 59.3 FPS | drag ÷ idle = **1.00-1.03** |
| Release cost | (n/a — cost was per tick) | exactly **1** flush `{traces:1}` + **1** `fixtures rebuilt` | ✅ |
| Strand drag — invalidations while dragging | 1 per tick | **0** | ✅ |
| Strand release | (per tick) | exactly **1** `strand_transform` | ✅ |
| Trail regression (generator + strand) | — | **987 cached == 987 fresh pixels, 0 stale coordinates** | ✅ |

**Methodology note (honest):** the first FPS runs compared a paced drag against
an idle sample taken *after* it, and one run read 0.52× — pure drift, not drag
cost: whole-page idle FPS on this box swung **18.7 → 45 FPS between runs**
because the operator's own sim window shares the GPU (the sim itself warns
"2 sim windows connected"). The harness now **interleaves** three idle and
three dragging samples inside one page evaluation and compares medians, so a
drift that hits both samples equally can neither fake nor hide drag cost. Under
that method the drag is indistinguishable from idle in every run.

Drag timings are direct invocations of the real tick handlers (same code path
as a real drag minus TransformControls' own pointer math), with
`transformControl.dragging` set true/false so the **real** `dragging-changed`
release seam in `main.js` is what fires the flush. Select was a REAL synthetic
mouse click. Same honesty caveat as `_44` §6.

---

## 3. Tests

- `simulation/tests/trace_regen_scheduler.test.js` — 10 tests: boot-safe empty
  ledger; **40 ticks ⇒ one flush entry**; take clears (a second release does
  nothing); no marks ⇒ no flush (the non-generated-trace case); multi-trace
  release is deduped and **ascending** (chain numbering must not depend on drag
  order); strand flag rides the same release and always clears; mixed drag;
  peek never eats a pending flush; **bad index throws** (a silently dropped mark
  would strand the operator's fixtures — P0 no-fallback); reset.
- `simulation/tests/transform_event_discipline.test.js` — 7 tests pinning the
  wiring itself, because both bugs *were* single lines: `objectChange` present
  and `change` absent in `main.js`; the flush lives on the release branch of
  `dragging-changed`; the trace tick marks dirty and only regenerates on the
  non-drag branch; the dot-drag tick has **no** `generateGroupFromTrace` at all;
  the dot-drag release flushes before saving; the strand tick keeps
  `rebuildVisuals` and defers only the invalidation; the release doer always
  invalidates on a deferred strand move.
- **Suite:** `805 / 797 / 8` before → `829 / 821 / 8` after. The 8 failures are
  identical before and after and are all scene↔model staleness in the operator's
  own files (`models/titanic.js` still says `Left Front Wall Generator …` after
  his 13:46 group renames, plus the known test_bench `metadata_drift` pair) —
  **none** are in slice-1 territory. Note the plan's `805 / 803 / 2` baseline
  was measured *before* his latest saves; the delta is his scene state, not
  code. (Test count rose by more than my 17 — a sibling slice-3 agent is adding
  tests in the same working tree.)
- `git diff --check -- simulation`: clean. `node --check` on every touched
  file: clean.
- `node tools/scene_model_parity.cjs test_bench|titanic`: unchanged (both still
  FAIL on the pre-existing stale-model findings). This slice reads scenes and
  models and writes neither, so the verdicts cannot move.

---

## 4. What the operator will feel — and the one intentional divergence

Selecting a generator in the 3D view is now instant. Moving or rotating one is
smooth: the generator's ring/line, its handles, the preview dots, the aim line
and the chain-order overlay follow the cursor at full frame rate. **The
generated fixtures and the global dot overlay stay put until you let go** —
this is the ratified cold-move semantic (plan §5.1), not a glitch. On release
the fixtures snap to the generator in one step.

Measured, on a 6-unit drag of "Right SmokeStacks" (8 fixtures):

| | generator `trace.x` | fixtures mean `x` |
|---|---|---|
| before drag | 23.247 | 23.247 |
| mid-drag | **29.247** | 23.247 ← frozen, by design |
| after release | 29.247 | **29.247** ← caught up in ONE regenerate |

Screenshots (`~/tmp/generator_ux/`, UI hidden on the two comparison frames):
`01_select_attached.png` (gizmo attached, no stall), **`02_middrag_fixtures_
frozen.png`** (trace dots marched away from the green fixtures),
**`03_after_release_fixtures_caught_up.png`** (fixtures now sit exactly on the
trace dots, and the moved group lights its new surroundings),
`04_strand_after_release.png`, `05_restored.png` (pristine state restored).

Other behavior notes:

- A select-click no longer marks the scene dirty. Before, `change` on attach
  reached `debounceAutoSave()`, so merely clicking a fixture flagged unsaved
  changes (and, with auto-save on, could write a scene you only looked at).
- Autosave is deferred with the regenerate during a drag. Previously every tick
  re-armed the 2-second debounce; a 2-second pause mid-drag with auto-save on
  could have persisted a scene whose generator had moved but whose fixtures had
  not. The release seam saves once, after the regenerate.
- Par-fixture (non-generator) drags still invalidate the batch cache per tick
  (~20-25 ms each on 979 px). That is out of slice-1 scope and orders of
  magnitude below the generator problem, but it is the next obvious cold-move
  candidate if he wants fixture drags perfectly smooth too.

---

## 5. Observations for the operator (not caused by this change)

1. **`models/titanic.js` is stale again** after the 13:46 saves — the model
   still carries `Left Front Wall Generator …` names/groups against the scene's
   `Left Front Wall …`, and the sim shows
   `ENGINE MODEL STALE — pixel count changed (981 → 987)`. This is what turned
   the plan's `805/803/2` suite baseline into `805/797/8`. A model re-export +
   engine restart clears it.
2. **Co-located fixtures in titanic.** Every `rebuildParLights` (including
   boot, and now the release regenerate) raises the overlap toast:
   `"Left Center Auditorium 7" & "Left Auditorium 5"`,
   `"Left Back Wall 1" & "Left Back Wall Generator 5"`,
   `"Left Back Wall 2" & "Left Back Wall Generator 4"`,
   `"Left Back Wall 3" & "Left Back Wall Generator 3"` — old renamed groups and
   generator groups sitting on the same coordinates (within 5 cm). Pre-existing
   scene state, worth a look before patching.
3. `404 http://127.0.0.1:6969/favicon.ico` is the only HTTP failure the harness
   sees — harmless, but it is the reason a naive "zero console errors" gate
   fails; the harness now separates JS errors from HTTP failures and prints the
   URL rather than swallowing it.

---

## 6. Guarantees for this session

- **Ports untouched.** No server started, stopped, or restarted; the harness is
  a browser client of `:6969` only. `6966-6972` / `5568` were never bound by me.
- **Zero scene writes, provable.** Triple guard (autoSave off → stubbed
  `debounceAutoSave` counter → every `:6970` request aborted at the network
  layer; the counters read **0 attempted, 0 stubbed calls** on the final run).
  `simulation/scenes/titanic/*` mtimes are `13:26/13:46`, my first source edit
  was `13:52`, my first browser run `14:01` — and the mtimes did not move across
  seven runs. `git status` for `simulation/scenes` and `marsin_engine/models` is
  byte-identical to the session start.
- **Pristine restore.** Every run deep-clones `params.{parLights,traces,
  ledStrands}` and restores them; the harness asserts zero residue and closes
  its browser.
- **No git operations.**

## 7. Artifacts

`~/tmp/generator_ux/` — `run1..run7.txt` (raw harness output),
`results.json` (final run, full numbers), `suite_before.txt` /
`suite_after.txt`, `parity_titanic.txt` / `parity_test_bench.txt`, and the five
screenshots. Re-runnable at any time:
`node simulation/agent_tools/generator_ux_verify.cjs`.
