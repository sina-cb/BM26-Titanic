# _327 — `feat/bm_readiness` structure + code-health review (findings only)

**Lens:** file structure, relocation completeness, code health, suite health.
**Branch:** `feat/bm_readiness` @ `6b26c72c` · merge-base with `main` `4e14ef61`
· 42 commits · 3251 files · +667741 / −20937.
**Scope:** findings only — nothing was fixed, no file outside this report was
edited, no git write operation was run, no port in 6966-6972 / 6981 / 5568 was
bound. (Confirmed by `netstat`: **no live show port was listening** during this
review — see the suite caveats.)

**Counts: P0 = 5 · P1 = 4 · P2 = 8.**

---

## Verdict

The two big **relocations are clean** — that part of the branch is done well.
The merge blockers are elsewhere: **29 red tests across the engine and sim
suites**, every one of the 19 engine failures coming from a test file that is
**new on this branch**. That is the signature of parallel agents landing
content and contract tests against each other without a full-suite rerun. In
addition, work that report `_325` explicitly labelled *"do not assume merge
ready"* was committed the next day, and a machine-written runtime artifact was
committed into `simulation/scenes/`.

---

## Suite results

| Suite | Command | Result | Failures |
|---|---|---|---|
| marsin_engine | `npm test` | **FAIL** — 3939 tests, **3920 pass / 19 fail**, 0 skipped | P0-1 (all named below) |
| simulation | `npm test` | **FAIL** — 2554 tests, **2543 pass / 10 fail**, 1 todo | P0-2, P0-3, P0-4; 6 inconclusive (P1-3) |
| simulation pixel-views | `npm run pixel-views:check` | **PASS** — "artifact is current" | — |
| CaptainPad typecheck | `npm run typecheck` (`tsc --noEmit`) | **PASS** — 0 errors | — |
| CaptainPad tests | `npm test` (vitest) | **PASS** — 156 files, **2695 pass / 0 fail**, 6 skipped | — |
| CaptainPad lint | `npm run lint` (expo lint) | **PASS** — 0 errors, 9 warnings | P2-6 |
| Syntax spot-check | `node --check` × 20 largest changed JS + all 19 `CaptainPad/live_touch/*.js` | **PASS** — 0 failures | — |

**Not run:** `marsin_engine` `test:hil` / `test:eval` / `perf:gate` (hardware +
baseline dependent); `simulation` `test:live-touch-arm` / `test:live-touch-grid`
(`agent_tools` scripts that drive the live stack); the full-stack smoke. All
are off-limits or out of time-box for a read-only review.

**Suite safety note.** Both suites are genuinely port-isolated by design —
`marsin_engine/tests/helpers/setup_config_guard.mjs` redirects `config.yaml` to
a scratch copy and disables the OSC + fire-sync listeners, and
`tests/helpers/spawn_engine.mjs` pins sACN at TEST-NET-1 `192.0.2.x`. The sim's
top-level tests bind `listen(0)` ephemerals or `SIM_SAVE_SERVER_PORT`. Nothing
in this review contended for a show port.

---

## P0 — merge-blocking

### P0-1 · 19 engine tests fail, all from test files new on this branch

`cd marsin_engine && npm test` → 19 failures. Every listed file returns
`NEW-on-branch` against `main`, so this branch both introduced the tests and
left them red.

| # | Test | File:line | Failure |
|---|---|---|---|
| 1 | production Titanic launch has exactly one analyzer: the Audio Companion | `marsin_engine/tests/companion/companion_single_analyzer_contract.test.js:13` | `Titanic scene state must not override the engine analyzer on while Companion is running` |
| 2 | deadman revert clears a stuck ERASE and the slot-less strobe/walk | `marsin_engine/tests/effects/revert_clears_spatial.test.js:85` | `movement-rate is retired for Live Touch; use an authoritative overlay slot action` (`LIVE_TOUCH_OVERLAY_ACTION_REQUIRED`) |
| 3 | a touch nobody refreshes goes stale and lifts on its own | `marsin_engine/tests/effects/revert_clears_spatial.test.js:140` | values not strictly equal |
| 4-8 | `dev_test_bench:` 5 model-lint tests | `marsin_engine/tests/mixer/all_models_load_lint.test.js:77,120,127,151,165` | `groupBits out of sync with model — missing: [] stale: [ParLights, VintageLights, BarLights, LED_0]` |
| 9 | approved factory patterns are locked in canonical Ambient and the review playlist is retired | `marsin_engine/tests/playlist/ambient_playlist_derivation.test.mjs:83` | expects `crisp/01,02,03,06,08,10`; tree has `ambient_extra/01,02,03,05,07,09` |
| 10 | ambient_extra/08_quiet_signal authors a complete, matched, dynamic TE-sign surface | `marsin_engine/tests/patterns/te_sign_surface_contract.test.js:84` | `TE sign mean range 23.9 is too static at Global=0.30 / Local=0.30` |
| 11 | master gallery index links transitions and all three Baby galleries | `marsin_engine/tests/patterns/transition_gallery_tool.test.mjs:89` | index missing `<strong>Baby Tease</strong><small>20 entries</small>` |
| 12 | UV purity holds for all 20 on test_bench | `marsin_engine/tests/patterns/uv_only_contract.test.js:257` | `uv_only/01_blacklight_tide/test_bench: violet lane peaks at only 40` |
| 13 | all 20 UV looks remain output-distinct on the capable subset | `marsin_engine/tests/patterns/uv_only_contract.test.js:488` | `01_blacklight_tide` vs `04_cathedral_uv_ribs`: median class separation 0.175 |
| 14 | white_only is one complete, explicitly tuned, unmodulated White review arc | `marsin_engine/tests/patterns/white_only_playlist_contract.test.js:30` | `titanic/white_only` has all 20 `white_only/*` entries; the contract expects none of them |
| 15 | every White review pattern has a current versioned fixture-authored intent | `marsin_engine/tests/patterns/white_pattern_intent_contract.test.js:20` | `62_white_shimmer: controls[8] value 0.2 does not match source default 0.3` |
| 16 | the committed playlist tree is synchronized by the permanent tool | `marsin_engine/tests/patterns/ambient_extra_contract.test.js:152` | committed tree ≠ tool output |
| 17 | every referenced playlist exists in BOTH scenes, byte-identical, and is loadable | `marsin_engine/tests/special_events/wedding_show.test.js:337` | `scene 'titanic' has no 'wedding_gathering' playlist — ARM would refuse by name` |
| 18 | CEREMONY and PHOTO GLOW lean on the palette-immune WHITE ONLY family | `marsin_engine/tests/special_events/wedding_show.test.js:372` | `ENOENT … simulation/scenes/titanic/playlists/wedding_ceremony.yaml` |
| 19 | every wedding pattern compiles and renders lit on BOTH show models | `marsin_engine/tests/special_events/wedding_show.test.js:389` | `ENOENT … simulation/scenes/titanic/playlists/wedding_gathering.yaml` |

**Fix (17-19), highest confidence:** `simulation/scenes/test_bench/playlists/`
has `wedding_ceremony.yaml` **and** `wedding_gathering.yaml`;
`simulation/scenes/titanic/playlists/` has only `wedding_party.yaml`. Copy the
two missing playlists into the titanic scene (the test demands byte-identity
across both scenes), or retire the wedding contract.

**Fix (1-16):** each is a content-vs-contract disagreement. Decide per case
which side is authoritative — the pattern/playlist content or the new contract
test — and land both sides in one commit. Do not merge with them red.

### P0-2 · A machine-written runtime artifact was committed into `simulation/scenes/`

`simulation/scenes/test_bench/bench_mirror_state.yaml` — its own header says
*"MACHINE-WRITTEN by the sACN bridge … Rewritten on every SUCCESSFUL
bench-mirror ARM"*. It is **tracked**, added on this branch by `9e8b23b8`, and
absent from `main`. It permanently fails the guard test:

`simulation/tests/bench_mirror_state.test.js:224` —
`assert.equal(fs.existsSync(...BENCH_MIRROR_STATE_FILE), false, 'the repo scene directory must be untouched by this suite')`

**Fix:** `git rm --cached simulation/scenes/test_bench/bench_mirror_state.yaml`
and add it to `.gitignore` alongside the existing
`marsin_engine/states/*/timeline_state.yaml` entry (`.gitignore:190`).

### P0-3 · Live Touch COLOR HUB overflows the panel client box

`simulation/tests/live_touch_ui_layout.test.js:1890` — *"COLOR HUB card rows
stay inside the panel client box at both iPad orientations (docs/70 W4
bugfix)"*:

```
landscape_1194x834 strip=false card=follow row="chCardFollow > chRunFollow":
bottom 601.0 escapes panel bottom 596.1 (clipped/unreachable — the exact reported defect)
```

This is **self-contained** — the suite loads the panel over a `file://` URL
(`live_touch_ui_layout.test.js:16-19`), so this is a genuine 4.9 px layout
regression, not an environment artifact. The FOLLOW card's RUN control is
clipped and unreachable on a real iPad in landscape.

**Fix:** trim `#chCardFollow > #chRunFollow`'s block height (or the COLOR HUB
card padding) by ≥5 px in landscape so the row bottom clears the panel client
box.

### P0-4 · Live Touch native TAKE readiness gate never satisfies

`simulation/tests/live_touch_ui_layout.test.js:582` — *"native TAKE records and
replays acknowledged endpoint frames with atomic clear"* — `TimeoutError:
Waiting failed: 30000ms exceeded` on
`page.waitForFunction(() => window.TouchTake && window.TouchTakeBankRuntime && window.__wire)`.

All three globals are assigned (`CaptainPad/live_touch/touch_control.html:5011`,
`:5017`, plus `__wire`), so the module graph is not reaching that block. Most
likely cause: the TAKE scripts are injected dynamically at
`touch_control.html:4384-4388` with `src="…?v=' + Date.now() + '"`, which is
timing-fragile under `file://`.

**Fix:** make the TAKE bundle load deterministic (static `<script>` tags, or
await the injected loads) so the readiness gate is reached; then re-run this
test.

### P0-5 · Work `_325` flagged "do not assume merge ready" was committed anyway

`.agent/reports/202608/20260818_325_live_touch_four_ipad_handoff.md:84-101`
lists uncommitted Live Touch work and says *"Do not assume these files are
merge-ready"* and *"Keep this work separate from the pushed checkpoint until
its focused suites are green."*

Every named file was committed **the next day** in `af128337`:

| `_325` item | File | Added by |
|---|---|---|
| Color-transition timing and exact-five overlay frames | `CaptainPad/live_touch/touch_control_color_transition_timing.js` | `af128337` |
| Transient Spatial contact-limit notices | `CaptainPad/live_touch/touch_control_spatial_contact_notice.js` | `af128337` |
| Four TAKE slots and playback visualization | `touch_control_take_bank.js`, `touch_control_take_state.js`, `touch_control_take_playback_overlay.js` | `af128337` |
| Brush-size remapping | `CaptainPad/live_touch/touch_control_brush_scale.js` | `af128337` |

Status of the three blockers `_325` named:

- *"Playback overlay cleanup must accept legitimate `kind: "settle"` events"* —
  **appears addressed**; `touch_control.html:4900` has a `settle:` handler and
  `simulation/tests/touch_control_take_playback_overlay*.test.js` are green.
- *"TAKE-bank tests need their fake clock injected into slot construction"* —
  **appears addressed**; `simulation/tests/live_touch_take_bank.test.js` and
  `live_touch_take_state.test.js` are green.
- *"Some browser contract tests still use stale Color Hub … assumptions"* —
  **STILL RED**, and it is not a stale assumption: see P0-3, which reports a
  real measured overflow.

**Fix:** clear P0-3 and P0-4, then supersede `_325`'s merge-hold with a short
follow-up report (`_328`) recording that the focused suites are green.

---

## P1 — should fix before merge

### P1-1 · 1.47 GB of generated binaries committed to a public repo with no LFS

`docs/pattern_gallery/` — **1236 files added on this branch**: 587 `.mp4`, 575
`.gif`, 37 `.html`, 36 `.json`, 1 `.md`. Blob total **1465.3 MB** (1.5 GB on
disk); largest single file 10.0 MB
(`docs/pattern_gallery/playlists/titanic/ambient_extra/gifs/048_ambient_extra__48_organ_echoes.gif`).
`.gitattributes` configures no LFS filter and `.gitignore` does not mention the
directory.

This is clearly deliberate — `docs/pattern_gallery/README.md` describes it as
*"the permanent, teammate-shareable playlist record"* and the content is
offline-clean (zero external/CDN URLs in the gallery HTML, so the offline-
readiness rule is satisfied). But merging it puts 1.47 GB into `main`'s history
permanently, for every clone, and it is regenerable via
`marsin_engine/tools/playlist_gallery/generate.mjs`.

Concrete consequence worth flagging: `README.md` advertises
`https://sina-cb.github.io/BM26-Titanic/docs/pattern_gallery/`, but **GitHub
Pages enforces a 1 GB published-site limit** — at 1.5 GB the Pages build will
not publish, so the stated share URL cannot work as-is.

**Fix (operator decision):** either move the gallery to Git LFS, or host it on
an orphan `gallery` branch / separate repo and leave `main` with the README and
generator only. Ship the `.mp4`s **or** the `.gif`s, not both — that alone is
roughly half the payload.

### P1-2 · Nine duplicate report numbers in `.agent/reports/202608/`

| # | Colliding files |
|---|---|
| 1 | `20260805_1_touch_control_and_nx_sweep_audit.md` · `20260810_1_…` · `20260811_1_…` · `20260812_1_codex_note_color_layer_hostile_review.md` · `20260812_1_live_control_panel_hardening.md` · `20260813_1_bm_readiness_local_integration.md` · `20260813_1_live_touch_multitouch_fullscreen.md` · `20260814_1_captainpad_privileged_performance_and_spatial_fullscreen.md` |
| 2 | `20260808_2_touch_control_engine_interface.md` · `20260812_2_…` · `20260813_2_…` · `20260814_2_mixer_narrow_scroll_fix.md` |
| 3 | `20260808_3_touch_control_audit.md` · `20260813_3_…` · `20260814_3_live_touch_arm_artifact_repair.md` |
| 4 | `20260813_4_bm_readiness_operator_test_matrix.md` · `20260814_4_live_touch_one_panel_grid.md` · `20260814_4_operator_feedback_mixer_arm_performance_nav.md` |
| 245 | `20260815_245_deck_transition_debug_audit.md` · `20260815_245_launcher_prod_deploy_prep.md` |
| **310** | `20260817_310_crisp_03_06_cadence_retest.md` · `20260817_310_effects_audit_and_plan.md` |
| **311** | `20260817_311_baby_reveal_palette_contract_v2.md` · `20260817_311_live_touch_production_stabilization.md` |
| **312** | `20260817_312_timeline_lease_reliability_hardening.md` · `20260817_312_white_only_pattern_wave.md` |
| **316** | `20260817_316_audio_configuration_native_fabric_fix.md` · `20260817_316_lt_performance_effects_review.md` |

The `1`-`4` collisions are the old per-day scheme and are harmless history. The
four **bold** ones (310, 311, 312, 316) are live 300-series collisions from
parallel agents on this branch, and they break the "cite report `_N`"
convention the whole `.agent/` corpus depends on.

**Fix:** renumber one of each bold pair into the free gaps `321`, `322`, `323`,
`324`, and update inbound citations.

Numbering gaps in the recent series (unclaimed, informational): `291-292`,
`294-295`, `297-298`, `321-324`, and `326` (this report takes `327`).

### P1-3 · Six sim tests could not be evaluated — they need the sim on `:6969`

All six failed with `net::ERR_CONNECTION_REFUSED at http://127.0.0.1:6969/…`.
No show port was listening during this review, so these are **inconclusive, not
failures**, and are excluded from the P0-count above:

- `simulation/tests/pixel_map_edit_interaction.test.js:94` — EDIT mode selects and drags a fixture under saved framing (top_down)
- `simulation/tests/pixel_map_edit_interaction.test.js:140` — Front view vintage rails project four fixtures across two cy bands
- `simulation/tests/pixel_map_edit_lifecycle.test.js:226` — EDIT lifecycle: one canvas, no ghost duplicate, drag + persist + touch + VIEW lock
- `simulation/tests/pixel_map_geometry_regression.test.js:196` — operator sidecar geometry (screenshot 1440x900) / (ipad 1024x768)
- `simulation/tests/pixel_map_geometry_regression.test.js:227` — operator sidecar reload preserves offsets in memory
- `simulation/tests/pixel_map_geometry_regression.test.js:246` — drag moves bezel and lit glyph together (operator sidecar)

**Fix:** re-run these with the sim up before declaring merge-ready. Separately,
consider having them **skip with a clear reason** rather than fail when `:6969`
is absent, so a bare `npm test` reports honestly.

### P1-4 · `.gitignore:190` covers only one of several runtime-written state files

`.gitignore` ignores `marsin_engine/states/*/timeline_state.yaml`, but 36 other
`marsin_engine/states/**` files are tracked and rewritten by the running
engine. On this branch they churned across up to 4 commits each
(`titanic/mixer_state.yaml` 4; `titanic/globals_state.yaml`, `deck_state.yaml`,
`audio_state.yaml` 3 each), and two are dirty in the working tree right now.
`_325:143` itself instructs *"Do not commit `marsin_engine/states/**`."*

Factually: this guarantees a merge conflict on every parallel branch that has
run the engine, and it makes "did an agent change this?" unanswerable from the
diff. It is a known tension, not a defect — but it is a per-merge tax, and P0-2
is the same class of problem escalating into a hard test failure.

**Fix (operator decision):** either ignore the runtime-written subset and ship
`*.default.yaml` seeds, or keep them tracked and add a pre-merge
`git checkout main -- marsin_engine/states/` normalization step to the merge
runbook.

---

## P2 — note

1. **`docs/ui` narrative survives in two live `.agent` docs.** Code, config,
   `.agent/ops/`, `.agent/skills/`, `.agent/os/`, and `docs/` are all clean, but
   `.agent/projects/bm26_show_readiness.md:196` and
   `.agent/memory/bm_readiness_thread_tracker.md` (≈16 hits) still write
   `docs/ui/touch_control*`. The tracker is an append-only history and is fine;
   the **projects dossier is a live document** and should be repathed to
   `CaptainPad/live_touch/`.
2. **`simulation/unreal/` — 1143 tracked files of Unreal editor residue**,
   including `Saved/webcache_6613/**` (browser cache), `Saved/Autosaves/Temp/
   Untitled_1_Auto1.umap`, and three `Marsin_*.tmp` files. **Pre-existing on
   `main` — 0 files added by this branch**, so not a merge blocker here. Worth
   a separate cleanup card: it is editor scratch in a public repo and is not
   accounted for in the `AGENTS.md` repo map.
3. **`simulation/scenes/summer_camp_dome/patches.yaml.original`** — residue
   under `scenes/`, which `robocopy /MIR` would ship to the show server. Already
   tracked as a deliberate `{ todo: … }` in
   `simulation/tests/scene_data_lint.test.js:109` (this is the suite's 1 todo)
   and raised in report `_163`. Still unresolved; operator-owned.
4. **`simulation/server/sacn_bridge.js:165`** —
   `try { ({ Receiver, Sender } = require('sacn')); } catch (e) { … process.exit(1) }`
   is a `require` in a `try`, against the "all imports at top, never wrapped"
   rule. **Pre-existing on `main`** (line 98 there), and it does fail loudly via
   `process.exit(1)` rather than falling back, so it violates the letter but not
   the intent. Same shape at `:170` for `ws`.
5. **`launcher.js:2236`** — `WebSocket = require(path.join(SIM_DIR, 'node_modules', 'ws'))`
   inside a function. A computed path across a package boundary, so it cannot be
   hoisted as-written; note only.
6. **9 eslint warnings, 0 errors** in CaptainPad — 6 `react-hooks/exhaustive-deps`,
   1 unused `Styles` (`components/timeline/FestivalEditor.tsx:196`), 1
   `@typescript-eslint/array-type` (`components/performance_mode_logic.ts:496`),
   1 ref-cleanup warning (`components/GlobalEffectMacros.tsx:439`). None
   merge-blocking.
7. **`docs/76_living_souls_of_iran_dedication.md` is untracked and not
   ignored** — an uncommitted new doc sitting in the working tree. Decide
   whether it ships with this merge.
8. **`marsin_engine/states/titanic/snapshots/performance-preshow.yaml`** is
   untracked and correctly covered by `.gitignore:206`. No action.

---

## Relocation inventory — both are clean

### `docs/ui/` → `CaptainPad/live_touch/` — **COMPLETE, reference-clean**

- `docs/ui/` never existed on `main` or at the merge-base; the surface was both
  created and relocated inside this branch. 19 files now live at
  `CaptainPad/live_touch/`.
- **Zero** tracked files remain under `docs/ui*`.
- **Zero** `docs/ui` references in any `.js/.cjs/.mjs/.ts/.tsx/.json/.py/.html/
  .yaml/.yml/.sh` file, in `docs/`, or in `.agent/ops|skills|os|context|roles`.
  The only survivors are historical narrative in `.agent/memory/`,
  `.agent/reports/`, `.agent/plans/`, and the one live dossier at P2-1.
- **No duplication.** `touch_control_pixel_views.json` exists at the new path
  only. Its generator writes there —
  `simulation/tools/export_touch_control_pixel_views.mjs:36`
  (`OUTPUT_PATH = …/CaptainPad/live_touch/touch_control_pixel_views.json`) — and
  `npm run pixel-views:check` reports **"artifact is current"**.
- **Serving is correct.** The sim's HTTP server is
  `npx http-server '../' -p 6969` (`simulation/start.js:89`), rooted at the repo
  root, so `/CaptainPad/live_touch/touch_control.html` resolves, as do the
  panel's `../shared/color_control_core_browser.js` and
  `../shared/pixel_view_projection.js` — both tracked under `CaptainPad/shared/`.
- All consumers point at the new path: `simulation/server/save-server.js:214,634`,
  `simulation/agent_tools/live_touch_*.cjs`, `simulation/tests/live_touch_*.test.js`.
- `.gitattributes` was updated in step — `/CaptainPad/live_touch/touch_control.html`
  and `touch_control_wire.js` carry `text eol=lf`.
- All 19 `CaptainPad/live_touch/*.js` pass `node --check`.

### `control_podium/` → `LookingGlass/control_podium/` — **COMPLETE, reference-clean**

- 123 files relocated, every one detected by git as `R086`-`R100` (pure moves).
- **Zero** tracked files remain under `control_podium/`.
- **Zero** stale references in any code or config file.
- `.agent/ops/build_ipad_release.md`, `.agent/ops/operating_raspberry_pi.md`,
  `.agent/os/multi_agent.md:9,200`, and `.agent/os/security_privacy.md:16,146`
  were all repathed correctly.
- **Path-depth arithmetic was updated for the extra level** — the easiest thing
  to get wrong in a move like this, and it was done right:
  `LookingGlass/control_podium/server_bridge/deploy.py:84` reads
  `REPO_ROOT = CP_ROOT.parent.parent  # .../BM26-Titanic (via LookingGlass/)`,
  and `firmware/hill_climb_link.py:75` / `tests/hil/*.py:52,71` carry matching
  updated comments.
- Archival pointers are in place and use relative links:
  `LookingGlass/README.md:10` and `README.md:410`.
- The one apparent stale hit,
  `.agent/ops/operating_raspberry_pi.md:251`
  (`pip install -r control_podium/server_bridge/requirements.txt`), is **correct
  as written** — it is a Pi-side path relative to `INSTALL_ROOT`, per line 248.

---

## Structure + consistency checks that passed

- **`CaptainPad/package.json` ↔ `package-lock.json`: in sync.** 0 mismatches
  across `dependencies` + `devDependencies`; name/version agree.
- **No tracked build artifacts.** `CaptainPad/dist/` is gitignored
  (`.gitignore:77`) and 0 files are tracked under it. Same for
  `LookingGlass/control_podium/PortWatch/dist/` (`.gitignore:69`).
- **Filename convention: clean.** Zero non-`snake_case` `.js/.cjs/.mjs/.py`
  files added on this branch. (Pre-existing `CaptainPad/StitchDesigns/…`
  directories carry spaces and Title Case, but they are design assets on `main`,
  not source.)
- **No empty catch blocks** in any of the six new Live Touch modules or in
  `marsin_engine/lib/live_touch_session_context.js` /
  `special_events_service.js`. The new panel code is written fail-loudly —
  `touch_control.html:5000` and `:5012` both `throw new Error(...)` when a TAKE
  dependency is missing rather than degrading.
- **No scratch/debug residue added on this branch.** The only suspicious tracked
  names (`simulation/debug_fog.js`, the `.original` files, the Unreal `Saved/`
  tree) all predate it.
- **Offline readiness holds for the new surface** — zero external `http(s)://`
  `src`/`href` in `docs/pattern_gallery/**/*.html`.

---

## Recommended merge gate

1. Copy `wedding_ceremony.yaml` + `wedding_gathering.yaml` into
   `simulation/scenes/titanic/playlists/` (clears engine failures 17-19).
2. Untrack + ignore `simulation/scenes/test_bench/bench_mirror_state.yaml`
   (clears sim `_176 §5.3`).
3. Reconcile the 16 remaining engine content-vs-contract failures.
4. Fix the COLOR HUB overflow (P0-3) and the TAKE readiness gate (P0-4).
5. Re-run `marsin_engine && npm test`, `simulation && npm run check`, and
   `CaptainPad && npm run check && npm test` — all green.
6. Re-run the six `:6969`-dependent sim tests with the stack up.
7. Decide P1-1 (gallery in history) before the merge commit — it is the one
   finding that cannot be undone afterwards without rewriting `main`.
8. Renumber the four colliding 300-series reports.

---

*Read-only review. No files were modified except this report. No git write
operation was performed. No port in 6966-6972 / 6981 / 5568 was bound.*
