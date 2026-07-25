---
name: bm_readiness_mapping
status: active
owner: Sina (operator) / interface-agent coordinated
created: 2026-07-24
updated: 2026-07-24
---

# BM Readiness — Ship Mapping, Mapping UI, Views & Overlays

## Goal

Get the Titanic fully premapped before the burn, with the map proven against
real-world change scenarios (map change, design change, controller change),
a mapping UI that is actually pleasant to use (split-screen sim + mapping,
not a floating pane), and playa-ready views + engine overlays.

## Scope

1. **Full ship premapping** — every fixture mapped, verified, and covered by
   a test matrix for: map change, design change (scene/model edits),
   controller change (swap/re-address/add), and any other realistic playa
   scenario surfaced during review.
2. **Mapping UI rehaul (in-sim)** — replace the floating mapping pane with a
   **screen split**: sim viewport adjusts to accommodate a dedicated mapping
   area. Requirements from the operator:
   - Fluid, easy to read, dynamic; adapts from laptop screens to a 27" monitor.
   - Maximization / adjustable splitting between SIM and mapping areas.
   - Keep the killer feature: move around the 3D view, select fixtures, and
     jump to them in the mapping UI (and back).
   - Fix the existing glitches — several crept in when the LED controllers
     were added hastily. Glitches are being catalogued unbiased (operator
     deliberately did not enumerate them).
   - **Companion app is a NO-GO for now** — it stays a fallback option only
     if the in-sim rehaul fails to satisfy.
3. **Views & overlays** — figure out how views will actually be used on
   playa, and get the engine overlays set up and tuned to match.

## Current state

- 2026-07-24 — **Foundation review COMPLETE**
  (`../reports/202607/20260724_0_mapping_readiness_review.md`). Headlines:
  titanic is geometrically premapped (84 pars + 28 strands / 1,120 px) but
  **0% electrically patched** (`controllers: []`, all universes 0); engine
  model `titanic.js` stale (pre-LED, Jul 8) with no drift guard; 10 glitches
  catalogued **G1–G10** (2 CRIT: ~1 FPS render loop under software-GL;
  engine hot-reload never routes universes unpatched at boot →
  `output_dispatch.js:203`); 3D→map link works, reverse link half-built.
  Split-screen design recommended: draggable vertical split, canvas resizes
  to pane, **raycaster NDC math in `interaction.js` is the load-bearing
  risk** (uses window dims — every pick mis-hits under a split).
- 2026-07-24 — **Slice 1 DONE**
  (`../reports/202607/20260724_1_render_perf_root_cause.md`): the review's
  1 FPS was a SwiftShader artifact. Real GPU: mapping profiles
  (`pixel_mapping`/`edit`) run **60 FPS**; `full`/`emissive` run 20 FPS,
  CPU-bound on per-object draw submission — per-pixel DMX emitter meshes
  (`dmx_fixture_runtime.js:301/:328/:347`) → 5,168 draw calls. Spotlight
  pool exonerated. Felt mapping lag = panel DOM rebuild (G2), NOT the render
  loop → **split-screen is unblocked**. Fix for `full` profile: instance DMX
  emitters like `led_strand.js:14-18` (~1–2d, optional/independent).
  Interim: map in `pixel_mapping`/`edit`. NOTE: sim stack died mid-probe
  (cause unknown) and was restarted — old engine/CaptainPad attachments
  need re-attach.
- 2026-07-24 — **Slice 2 DONE**
  (`../reports/202607/20260724_2_split_screen_shell.md`): floating pane →
  real vertical split (new `simulation/src/gui/split_layout.js`): draggable
  divider, maximize-either-side + restore tab, ratio persisted per viewport
  class (laptop 62/38, ≥1920px 70/30); canvas sizes to sim pane; raycaster
  pick NDC now canvas-rect based (all 3 sites, `pointerToCanvasNdc`);
  density G4 fixed (380px cap dropped, fonts 11–12.5px). 284/284 sim tests;
  repeatable pick-accuracy test `agent_tools/pick_accuracy_test.cjs` passes
  across 4 pane widths; laptop+27" screenshots inspected
  (`.agent_renders/split_*.png`). Gaps: Lighting Controls drawer hides
  during mapping session (shared `_hidden` flag); Pattern Editor drawer
  still overlays; G5 reverse link not in this slice. Uncommitted.
- 2026-07-24 — **Slices 3+4 DONE**
  (`../reports/202607/20260724_4_panel_perf_reverse_link.md`): G2 fixed —
  selection is a DOM-patch path (`syncSelectionUi`), projections computed
  once per render; **median selection refresh 19.1 ms → 1.8 ms (~10×)**.
  G5 done both directions for DMX + LED strands (scroll-into-view, chip →
  3D select + camera fly, "🎯 Camera Follows Chip" toggle persisted). G3
  folded in (window.prompt → inline modal). **Left-dock flip landed**: map
  LEFT / sim RIGHT, Lighting Controls stays open during mapping, Pattern
  Editor yields + restores. 284/284 tests, pick-accuracy 2/2 post-flip,
  clean console smoke. New tools: `panel_perf_test.cjs`,
  `panel_capture.cjs`, `scene_console_smoke.cjs`. Uncommitted. Notes:
  pre-existing `gui_builder.js:1708` unimported `syncGuiFolders()` throws on
  LC "select group" (one-line fix, handed to sweep slice); fixture under an
  open right drawer needs drawer collapse to pick (inherent to both-open).
- 2026-07-24 — Wave 4 launched in parallel: Slice 5 glitch sweep
  (G6/G7/G8/G9 + gui_builder one-liner), emitter instancing (`full`
  20→~60 FPS), views & overlays design (Fable, doc-only).
- 2026-07-24 — **Views & overlays design DONE**
  (`../reports/202607/20260724_7_views_overlays_playa_design.md`): Views
  Rehaul machinery is complete/fail-loud (~60 free auto-views after regen;
  only ~7 policy views need authoring). Headline gaps: (1) **CaptainPad
  never reads `namedViews`** (`utils/api.ts:1236-1257`) — auto-view catalog
  invisible on iPad, views are touch-only in two modals, nothing (controller
  /autopilot/timeline) can change a view; (2) no view automation for
  zero-touch nights → proposal: snapshot-recall in timeline looks;
  (3) DATA REGRESSION: engine model stale (1,147 px vs ~1,790) + Jun-19
  group normalization regressed for 12 fixtures in `scene_config.yaml`
  (:501-677) — will break 2 views.yaml bits + 2 `_BOTH` pairs on next
  export. Work breakdown W1–W9 in report; 6 operator decisions flagged.
- 2026-07-24 — W1 launched (CaptainPad namedViews picker, disjoint
  subsystem). W2 (group fix + model regen) HELD on operator decision
  (normalization direction).
- 2026-07-24 — **Slice 5 glitch sweep DONE**
  (`../reports/202607/20260724_5_mapping_glitch_sweep.md`): G6 readable
  timeout message (`marsinled_client.js:117`); G7 caches scene-scoped
  (`${scene}::${id}` keys); G8 loud liveness guard before post-reboot-wait
  mutations; G9 vestigial `led.baseUniverse` writes removed — one source of
  truth (`port.universe`), wire behavior proven byte-identical by new
  parity test; Lighting Controls select-all ReferenceError fixed (proper
  export/import). 293 sim tests (+9 new), smoke + pick-accuracy clean.
  Uncommitted. Follow-up option: fully delete `baseUniverse` from the
  unbound model (declined for now — would change unbound projection).
- 2026-07-24 — **Slice 6 (G10) DONE**
  (`../reports/202607/20260724_3_engine_hotreload_universe_fix.md`):
  senders were built only from the boot-time universe list; declared-but-
  unpatched universes hit `return; // pruned` on later `addUniverse`. Fixed
  in `output_dispatch.js` (create-sender-on-demand, sACN + Art-Net, host-
  tagged senders, idempotent routing; removal already engine-owned). 7 new
  default-suite tests incl. real ArtDMX-datagram-on-wire for the exact playa
  scenario. Suite 2088 pass / 9 pre-existing env fails. Uncommitted.
  Follow-up: live re-patch rehearsal once titanic is actually patched.

- 2026-07-24 — **W1 CaptainPad namedViews picker DONE** (`../reports/202607/
  20260724_8_captainpad_named_views.md`): shared sectioned+searchable
  picker on both view surfaces (mixer + deck overlays), fail-loud "NO VIEW
  CATALOG" banner, gloved-touch rows; fixed bit-less Tier-A "(NO PIXELS)"
  count bug. tsc clean, 790 vitest pass (+28 new). Operator review pending
  (coordinator-initiated). Agent left engine on :6968 + dist serve :6967
  running.
- 2026-07-24 — **Emitter instancing DONE** (`../reports/202607/
  20260724_6_emitter_instancing.md`): `full` 20→59.5 FPS, `emissive`
  20→59.9 (real GPU); ~2,668 per-pixel emitter meshes → 250 InstancedMesh
  + 80 Sprites; per-pixel color via `instanceColor` off new `p.color`
  source of truth; visuals A/B verified; 293 tests + pick accuracy green.
  **Operator-confirmed 2026-07-24: "speed is day-night better."** Open:
  operator reports intermittent visual flicker post-wave — Fable debugger
  on it (→ report `20260724_15`).
- 2026-07-24 — 2D-vis wave: design DONE (`../reports/202607/
  20260724_9_2d_vis_multiview_design.md`); S1 (geometry/frame core), S2
  (view model), S3 (pane shell) IN FLIGHT on disjoint file sets; S4
  integration queued (proceeding as `2d_pixels`-exclusive per designer
  recommendation unless operator overrides). Operator spec captured in
  "2D vis rehaul requirements" section above.

## Links

- **Plans:** slices listed in report §plan (formal plan doc TBD after
  operator decisions)
- **Reports:** `../reports/202607/20260724_0_mapping_readiness_review.md`
- **Branches:** `feat/bm_readiness`
- **Notion cards:** (to be filed once the plan is broken into tasks)

## 2D vis rehaul requirements (operator, 2026-07-24)

Rework the 2D lighting-profile visualization into a **dynamic multi-view
system** (fast — used to tune patterns against the big model):

1. **Top-down view**: ONLY LED bars + LED strands, positioned as a true
   top-down spatial layout, pretty + screen-fitting, pixel look optimized
   to represent them all; PLUS a separate section with the 8 smoke-stack
   pars arranged in a circle around the stack (focusable).
2. **Front view**: focuses on the bars + vintage lights.
3. **LED strands view**: the strands alone.
4. **TE sign view**: 2D representation of the 2D LED grid fixture.
5. **Dynamic view mechanism**: views can be added/removed at runtime; not a
   hardcoded set.
6. **Dynamic pane layout**: vim/tmux-style splitting in the 2D vis — split
   panes via mouse/keyboard, each pane binds to any view.

## LED grouping + TE-sign generator requirements (operator, 2026-07-24)

1. **LED fixtures must have the same Grouping feature as DMX fixtures** —
   e.g. group the two sides of the TE sign side-by-side. Group semantics
   flow everywhere DMX groups do (selection, Lighting Controls lists,
   masks/views derived from groups).
2. **TE-sign generator**: instantiates the TE sign as **2 components** at
   a location, with relative-placement parameters — **x** = side-to-side
   (sets the distance between the two components), **y** = up/down,
   **z** = in/out. Placement aspects adjustable after instantiation.
   **SUPERSEDED in part 2026-07-24 (real TE Sign V3 spec):** the sign's two
   halves (Side A 40 px / Side B 34 px) are the two coplanar halves of ONE
   physical sign face sharing one coordinate frame — **they must always
   carry IDENTICAL transforms** (position/rotation/scale); never mirror,
   rotate, or offset one relative to the other. Placement params therefore
   move the WHOLE sign as one unit. Real fixture models arrived (74 puck
   LEDs, 40+34 chains, mm dots, `TeSignV3A40` 120ch / `TeSignV3B34` 102ch)
   and replace the two placeholder `TeLedGrid40` fixtures in the titanic
   scene (new group `TE Sign`).

## Decisions log

- **2026-07-24** — Operator: mapping UI stays **in the sim** as a screen
  split (sim area resizes); a separate companion app is explicitly parked as
  a fallback, not the plan.
- **2026-07-24** — Operator (2D-vis integration, mid-S4): **layout/
  placement correctness is the top priority** — views must be spatially
  representative and in-place so fixtures can be seen properly; the view
  DROPDOWN is sufficient UI for now; pane/keybinding/split polish is
  descoped until the four views look right (pane machinery kept, not
  ripped out).
- **2026-07-24** — Operator: **TE LED Grid is classified LED type, not
  DMX** — it is DMX-transported, but in fixture-type taxonomy (2D-vis
  clusters, view selectors, type styles) it counts as LED. Transport/wire
  behavior untouched.
- **2026-07-24** — Operator: mapping pane docks **LEFT** (not right);
  **Lighting Controls right drawer stays fully intact during mapping** —
  Sina uses its fixture-instance/DMX-group lists constantly to find lights
  on a busy unlabeled scene; the **Pattern Editor** left drawer is what
  hides during a mapping session. (Slice 2's right-dock + LC-yield behavior
  superseded; fix folded into the in-flight Slices 3+4 agent.)
- **2026-07-24** — Operator: interface-agent pattern for this project — the
  main session coordinates only; all heavy work goes to sub-agents.

## Next steps

- [x] Fable review: report `202607/20260724_0_mapping_readiness_review.md`.
- [ ] Slice 1 (IN FLIGHT): render-loop perf root-cause on real GPU.
- [ ] Operator decisions (blockers, see report §f): physical wiring
      (controller count/IPs/output→strand), 70-vs-84 fixture-name mismatch
      (patches.yaml vs parLights), Art-Net vs sACN per titanic controller,
      confirm GPU-laptop lag, confirm sim stack restarted onto MAC-fix code.
- [ ] Slices 2–6 fan-out (split shell + raycaster, panel rebuild + density,
      reverse link, glitch sweep G3/6/7/8/9, engine hot-reload fix G10).
- [ ] Premap execution + test matrix (blocked on wiring decisions).
- [ ] Views authoring + overlay tuning (after show design input).
