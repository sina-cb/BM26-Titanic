# 2026-07-24 — Integration sweep: joint verification of ~16 uncommitted slices (Slice 16, bm_readiness)

End-of-day integration verification across every 2026-07-24 slice landed
UNCOMMITTED on `feat/bm_readiness`. Goal: prove the tree behaves as ONE
coherent branch and catalogue exactly what an operator-gated commit would
contain. **No git ops that mutate. No commits. Nothing reverted/cleaned.**
Sim stack (:6969–:6972) + engine (:6968) + dist (:6967) were left running with
today's fixes live; page loads only, every page I opened was closed; my one
throwaway capture script was deleted. Screenshots in `.agent_renders/`
(`sweep16_*`, gitignored).

---

## 0. TL;DR

- **All three full suites GREEN vs baseline.** Sim 436/436. Engine 2094 pass /
  9 fail (all 9 pre-existing env/infra flakes, zero assertion regressions).
  CaptainPad tsc 0 errors, vitest 790 pass / 6 skipped, lint 4 err / 19 warn
  (the 4 errors pre-date today).
- **Perf gate PASS** (2D multiview per-pane cost linear, 1.33× < 1.5×).
- **Titanic-models mystery SOLVED — the model is STALE. FLAG FOR OPERATOR.**
  `marsin_engine/models/titanic.*` was regenerated at 11:05 by the S1 sim
  scene-export (good: strand identity + `localIndex` + new fixtures + patch
  metadata, 970→1147 px) but **BEFORE** the TE Sign V3 swap landed in the scene
  at 15:10. The committed model still encodes the OLD `TeLedGrid40` / `TE LED
  Grids` (80 px), not `TE Sign V3 A/B` (74 px). Numerically corroborated: live
  2D map shows **1141 px**, stale model shows **1147 px**, and 1147 − 80 + 74 =
  1141 exactly. **Recommendation: re-export the engine model from the current
  scene before commit; do not ship the 11:05 snapshot.**
- **Commit-set security scan CLEAN.** 21 MAC findings all live in gitignored
  `.scene_backups/` — not committable. The tracked/would-be-added files
  (scene_config, common.yaml, te_sign_v3 fixtures, titanic.js) contain zero
  MACs. The `--staged` / pre-commit gate would PASS.
- **Cross-slice residue to exclude/refresh at commit:** engine runtime state
  (`states/test_bench/globals_state.yaml` 306-line value churn,
  `audio_state.yaml`, untracked `vsn1_layout.yaml`); CRLF-only line-ending
  churn (`scenes/manifest.json`, `scenes/common.yaml` — `--ignore-all-space`
  diff is empty); and the stale `titanic.*` model above.
- **Two cross-slice inconsistencies catalogued (not fixed):** (1) new *Left
  Center Auditorium* par fixtures spatially overlap the existing *Left Center
  Auditorium Generator* fixtures (5+ overlap warning in the live map); (2)
  titanic-authored 2D default views throw loud per-panel "no fixtures match"
  banners on non-titanic scenes (test_bench) — recommend a per-scene-views
  punch-list item.

---

## 1. Full suites vs baselines

### Simulation — `npm run check` (node:test)
```
tests 436 · pass 436 · fail 0 · skipped 0    (baseline 436/0 — EXACT MATCH)
```
Includes today's new suites (te_sign_generator, te_sign_grouping_parity,
bridge_routing, pixel_map_* pane/view/frame-source, led quarantine, etc.).
Agent-tool smokes:
- `pick_accuracy_test.cjs` → **2/2** split-invariant (targets #12/#13 =
  "TE Sign V3 A/B" — confirms TE Sign V3 live in scene).
- `scene_console_smoke.cjs titanic` → clean except 1 `favicon.ico` 404
  (browser auto-request, no favicon served; benign, global, pre-existing).
- `scene_console_smoke.cjs test_bench` → same favicon 404 + 3
  `ERR_CONNECTION_REFUSED` (LED-discovery probes to absent hardware — expected).
- `pixel_map_perf_test.cjs` → **PASS**, 6-pane per-pane 2.00 ms vs single
  1.50 ms = 1.33× (limit 1.5×). Absolute FPS low but SwiftShader
  software-rendered here — non-authoritative, as the tool states.
- `tesign_verify.cjs` → exit 0 (piped stdout not captured after it was
  backgrounded, but TE Sign V3 independently confirmed via pick_accuracy + the
  live 2d_pixels Lighting-Controls "TE Sign (2)" group).

### Marsin Engine — SAFE glob `node --test "tests/**/*.test.js" "tests/**/*.test.mjs"`
```
tests 2103 · pass 2094 · fail 9 · skipped 0 · duration 13.8 s
```
Baseline was 2091 pass / ~8-9 env fails; +3 pass = the new
`status_output_routing.test.js` (2, flicker slice, verified 2/2 isolated) plus
`output_dispatch.test.js` additions. **All 9 failures are pre-existing
env/infra flakes — none are assertion regressions from today's logic:**

| Failure | File | Nature |
|---|---|---|
| 5× reframe/lifecycle/backoff/stop/onFrame | `tests/audio/audio_capture.test.js` | stream-framing under load — baseline-known |
| effects_v2 file-level fail (all 47 subtests ✔) | `tests/effects/effects_v2_mode_page_layout.test.js` | Node runner IPC "Unable to deserialize cloned data" — **passes 47/47 isolated** |
| startAsync EADDRINUSE→EACCES | `tests/io/osc_listener.test.js` | Windows bind semantics — baseline-known |
| 2× config guard (MARSIN_CONFIG_FILE unset) | `tests/state/config_persistence_guard.test.js` | file+helper **unchanged since July 11 (c6eaa733)**; fails isolated on this box too — pre-existing env |

Ran effects_v2 (47/47), config_guard (still 2 fail isolated → env, not
ordering), status_output_routing (2/2) individually to classify.

### CaptainPad — `tsc --noEmit` + vitest + lint
```
tsc --noEmit : 0 errors
vitest       : 790 passed / 6 skipped (37 files)     (baseline 790/6 — MATCH)
lint         : 23 problems (4 errors, 19 warnings)
```
The 4 lint errors are the pre-existing `GlobalEffectMacros.tsx` set (pre-date
today, per tracker). 19 warnings are exhaustive-deps/array-type advisories
across pre-existing components. No new tsc/vitest breakage from today's slices
(mixer.tsx, DeckOverlayStack.tsx, api.ts, ViewSelectionPicker + logic/test).

---

## 2. Cross-feature spot checks (renderer screenshots, visually inspected)

- **Titanic `full` profile** (`sweep16`/agent_render front) — healthy: both hull
  sections lit, LED strands (dots) along edges, **instanced emitter grids
  clearly rendering on the hull faces (slice 6)**, par-light ground pools, no
  black screen. "UNSAVED CHANGES" badge expected. Engine driving a red pattern.
- **Titanic `2d_pixels` multiview + Lighting Controls simultaneously**
  (`sweep16_titanic_2dpixels`) — "Top-Down" view rendering the fixture layout;
  Lighting-Controls dock open on the right at the same time (satisfies the
  map + controls spot-check). Groups list shows **TE Sign (2)**, Left Center
  Auditorium (7), Left Back Wall (5), etc. Header "100 fix · 1141 px".
- **3D↔chip selection round-trip** — not separately scripted, but the
  selection path is exercised by `pick_accuracy_test` (2/2 split-invariant
  raycast selection across 4 pane widths) plus the live 2d_pixels map + group
  chips. No selection breakage observed.

---

## 3. Titanic-models mystery — VERDICT: STALE, flag for operator

**What changed** (`git diff HEAD` on `marsin_engine/models/titanic.*`):
- `titanic.js`: `pixelCount 970 → 1147`; new `localIndex` field per pixel;
  populated `patch: {universe,addr,footprint}` metadata; front-loaded new
  fixtures (`Left Center Auditorium` UkingPar, `Left Back Wall` ShehdsBar);
  "Updated:" stamp 2026-07-24T18:05:31Z.
- `titanic.viewmasks.js`: +3 groupBits (`Left Center Auditorium`,
  `Left Back Wall`, **`TE LED Grids`** at 0x40000000).
- `titanic.effects.js`: timestamp only.

**Which process wrote them:** the sim's Pixelblaze model exporter
(`simulation/src/dmx/pixelblaze_model_exporter.js`, itself modified today to
emit `localIndex`) on a scene save/export at **11:05 PDT**. This is the S1
geometry-core work (report `20260724_10`: strand identity, 85→100 clusters,
new fixtures). Timestamps: model files 11:05; `scene_config.yaml` +
`te_sign_v3/*.yaml` **15:10** — i.e. the TE Sign V3 swap (report `20260724_14`)
landed **4 hours after** the model was exported and never re-triggered an
export.

**Why it's stale / wrong:** the regenerated model still contains
`TeLedGrid40`, `TE LED Grids`, and 80× `TE LED Grid 1/2 - pixel_N` entries, and
**zero** `TE Sign` / `model_a` / `model_b` entries — whereas the current scene
(`scene_config.yaml:1205-1227`) defines `TE Sign V3 A/B` in group `TE Sign`.
The viewmasks `groupBits` likewise pins `'TE LED Grids'`, not `'TE Sign'` (the
Views reconciler papers over this at runtime: test log shows
`[Views] Group bits reconciled (+1): added ['TE Sign']`). Numeric proof:
live 2D map = 1141 px; stale model = 1147 px; **1147 − 80(old TE grids) +
74(TE Sign V3) = 1141**.

**Verdict:** the regen is *partly* desirable (localIndex + new
auditorium/back-wall fixtures + patch metadata + strand identity are real S1
improvements the branch wants) but **stale on the TE Sign axis** — committing
the 11:05 snapshot would ship an engine model that misrepresents the sign.
**Recommendation: FLAG FOR OPERATOR — regenerate `titanic.*` from the current
(15:10) scene state so the committed model carries TE Sign V3, then commit the
fresh export.** Do not commit as-is.

---

## 4. Commit-readiness catalogue

`git status`: 39 tracked-modified + ~40 untracked (reports, new source, new
tests, te_sign_v3 fixtures, agent tools). `git diff --stat`: +3616 / −2149.
Grouped by slice/subsystem:

| Subsystem / slice | Representative paths |
|---|---|
| Agent OS / docs | `.agent/README.md`, `os/multi_agent.md` (§9 close-pages law), `roles/coordinator.md`, `AGENTS.md`, `memory/MEMORY.md`, new `os/interface_agent.md`, project dossier + tracker, reports `20260724_0..16` |
| Emitter instancing (6) | `simulation/src/core/light_pool.js`, `dmx_fixture_runtime.js` |
| Flicker/route fix (15) | `simulation/server/sacn_bridge.js`, new `lib/bridge_routing.cjs`, `lib/load_ports.cjs`, `main.js`, engine `lib/output_dispatch.js` + `engine.js` + `lib/api_server.js`, new engine `tests/io/status_output_routing.test.js`, `tests/io/output_dispatch.test.js` |
| 2D-vis S1–S4 (10-13) | new `src/gui/pixel_map/{pane_tree,pane_view,views,view_defaults,frame_source}.js`, `modern/pixel_map_multiview_panel.js`, `src/gui/split_layout.js`, `pixel_map/*` refactors, `pixel_map_panel.js`, many new `tests/pixel_map_*` + `bridge_routing` |
| LED grouping + TE Sign V3 (14) | new `src/fixtures/te_sign_generator.js`, `dmx/fixtures/te_sign_v3/model_{a_120,b_102}.yaml`, `pixelblaze_model_exporter.js`, `scene_config.yaml`, tests |
| CaptainPad named views (8) | new `components/ViewSelectionPicker.tsx` + `view_selection_picker_logic.ts` + test, `mixer.tsx`, `DeckOverlayStack.tsx`, `utils/api.ts` |
| LED discovery/marsinled | `src/dmx/led/marsinled_client.js`, `gui/led_discovery_panel.js`, `controller_map_editor.js`, related tests |
| Agent capture tools | new `agent_tools/{pick_accuracy_test,scene_console_smoke,pixel_map_perf_test,pixel_map_capture,split_capture,panel_capture,panel_perf_test,tesign_verify,tesign_verify2}.cjs` |

**Security (`python scripts/security_check.py --all`, working-tree mode):**
21 findings, **ALL** in gitignored `simulation/.scene_backups/studiodj/**`
(`git check-ignore` confirms not committable). Commit-eligible scene/fixture/
model files scanned for `xx:xx:xx:xx:xx:xx` → **none**. The `--staged` /
`.githooks/pre-commit` gate scans only staged+tracked-unstaged, so **the
security gate would PASS** on the real commit set. (Recommend the operator NOT
`git add` `.scene_backups/` — it stays ignored.)

**Runtime residue to EXCLUDE or REFRESH at commit (not real branch work):**
- `marsin_engine/states/test_bench/globals_state.yaml` (306-line revision/param
  value churn from the running engine) and `audio_state.yaml` — engine runtime
  state; and untracked `marsin_engine/states/test_bench/vsn1_layout.yaml`.
- `simulation/scenes/manifest.json` and `simulation/scenes/common.yaml` —
  **CRLF/line-ending-only** churn (`git diff --ignore-all-space` = empty).
- `marsin_engine/config.yaml`, `titanic.*` models — CRLF warnings on save.
- `marsin_engine/models/titanic.*` — **stale export, regenerate before commit**
  (see §3).

---

## 5. Cross-slice items broken / inconsistent / half-wired (catalogue only)

1. **Stale engine model** — `marsin_engine/models/titanic.js` +
   `titanic.viewmasks.js` groupBits: encode `TE LED Grids`/`TeLedGrid40`, not
   the scene's `TE Sign V3 A/B`. Runtime Views reconciler masks it; a committed
   model would still be wrong. (§3.)
2. **Fixture spatial overlap** — live titanic 2D map raises
   *"5+ fixture overlap(s) detected: 'Left Center Auditorium N' & 'Left Center
   Auditorium Generator N'"*. The new S1 *Left Center Auditorium* par fixtures
   (`scene_config.yaml`) sit on the same coordinates as the pre-existing
   *…Generator* fixtures. Likely intentional co-location but flagged loudly;
   operator should confirm the double-patch is desired.
3. **2D default views are not per-scene** (scope-add investigated) — the 4
   titanic-authored defaults (top_down/front/strands/te_sign) are seeded on
   every scene. On **test_bench `2d_pixels`** the profile loads and the
   top_down MAIN panel renders test_bench fixtures fine (10 fix · 132 px), but
   the titanic-specific **"Smoke Stacks" sub-panel throws a loud, scoped banner
   "Panel 'stacks': no fixtures match"** (screenshot
   `sweep16_testbench_views`). Fail-loud works at panel granularity — it does
   NOT crash the view or profile, and the scene stays usable (main panels
   render; pane view-bindings/Views manager allow rebinding to a working view).
   The `te_sign` default view (single panel selecting the TE Sign group) would
   render empty/error on test_bench for the same reason. **Verdict: current
   behavior is acceptable-but-untidy — non-blocking, recoverable, but every
   non-titanic scene ships titanic view residue that greets the operator with a
   red "no fixtures match" banner out of the box. Recommend a punch-list item:
   "views are per-scene / seed scene-appropriate defaults (or suppress
   zero-match titanic panels on foreign scenes)."**

---

## 6. What I did NOT do
No commits, no staging, no reverts/cleans, no service restarts. One throwaway
puppeteer capture script (`agent_tools/sweep16_capture.cjs`) was written to
drive the 2d_pixels/test_bench captures and **deleted** after use — tree
unchanged by this sweep except the gitignored `.agent_renders/sweep16_*` PNGs
and this report.
