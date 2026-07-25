# 2026-07-24 — BM Readiness: mapping stack review, glitch hunt, split-screen design, premap + views/overlays plans

Foundation document for project **bm_readiness_mapping** (branch
`feat/bm_readiness`). Reviewer/planner session (Fable). **No git ops, no
commits.** Sim exercised hands-on via the puppeteer renderer per
`.agent/skills/see_the_world.md`; every screenshot below was visually
inspected. Scene files were mutated during the glitch hunt and **restored to
original md5** at the end (`controllers.yaml 59bf1e03…`, `patches.yaml
62c86b4e…`, `scene_config.yaml 3b7160a7…`). Sim SERVERS (:6969–:6972) left
running — the shared stack. Screenshots in `.agent_renders/mapreview_*.png`.

Two read-only sub-audits fed this report: the sim mapping-UI code audit and the
scene/engine/views audit. Their file:line anchors are folded in below.

---

## 0. TL;DR for the operator

- The prized feature (3D → select → find in mapping UI) **works forward** but
  is **half-built in reverse** and has **no camera focus and no scroll-to-chip**
  — on the full ship you select a fixture and the matching chip is off-screen
  with zero feedback. LED strands have **no** reverse link at all.
- The "laggy/slow" complaint is mostly the **sim render loop itself** (~1 FPS on
  `titanic` in our software-GL measurement), with the mapping panel adding a
  further ~30% because it **destroys and rebuilds its entire DOM on every 3D
  click and every keystroke**.
- The "too tiny" complaint is real and specific: base panel text is **10px**,
  several fields **8.5–9px**, inside a **fixed 380px column**.
- Multiple real glitches confirmed hands-on, incl. a `window.prompt()` that
  **blocks the whole render thread** and an offline-push error that surfaces the
  raw `"signal is aborted without reason"` string.
- **`titanic` is geometrically premapped but 0% electrically patched** — 84 DMX
  pars + 28 LED strands (1,120 px), zero controllers, zero universes. The engine
  model `titanic.js` is **stale** (Jul 8, pre-LED) and regeneration is a manual
  GUI action with no CI guard.
- A real **engine hot-reload routing bug** means re-patching a universe on playa
  can leave that controller **dark until a full engine restart**.

---

## 1. Current-state review — how mapping works today

### 1.1 Data flow (scene YAML → registries → UI → save)

- Boot installs `window.__controllerRegistry` from `controllers.yaml`
  (`main.js:386`, built by `controller_registry.js:createControllerRegistry`
  :272 — a hard-throwing schema validator; operational problems like
  overflow/overlap/bad-IP become later projection *violations*, not throws).
- The heart is **projection**: `window.projectControllerMappings`
  (`main.js:387`) → `projectOntoConfigs`/`computeProjection`
  (`controller_registry.js:1631`, `:1264`) writes
  `controllerIp/dmxUniverse/dmxAddress/controllerId` onto every fixture config
  and mirrors them into `window.__globalPatchTree`. LED strands are projected
  **after** DMX by `projectLedStrandPatches` (`main.js:430`, call-order
  invariant documented in `led_metadata.js:8`).
- Editor mutations funnel through `mutate()` (`controller_map_editor.js:327`):
  snapshot → mutate registry → `recomputeAndMark()` (`:221`, the propagation
  hub) → `renderIfOpen()` → undo toast.
- Save (`server/save-server.js`, POST `/save`) **re-extracts** patch fields into
  `patches.yaml` (`:202`), `views.yaml` (`:288`), and `controllers.yaml`
  (`:301`) from the config tree; atomic writes. So a patch field lives in **four
  places** (registry chains, projected config fields, `__globalPatchTree`,
  re-extracted `patches.yaml`) and correctness depends on `recomputeAndMark`
  running before every save.

### 1.2 The 3D ↔ mapping link (the prized feature)

- **Forward (3D → panel): works.** `interaction.js onPointerDown` (:367–433)
  raycasts, sets `selectedFixtureIndices`, calls `refreshControllerMapPanel`
  (:426/:432). The panel marks the mapped chip `cm-chip-selected`
  (`controller_map_editor.js:1346`) and updates every `+ sel (n)` counter.
  **Verified live** (`mapreview_04/05`): clicking a par in 3D selected it,
  the DMX patch card populated, and `+ sel (1)` lit on every port.
- **Reverse (panel → 3D): partial.** Chip click → `selectFixtureIn3D(name)`
  (:349, impl :351) only toggles the fixture's `setSelected` visual; chip hover
  → `flashFixture` (:362). **There is no `flyTo`/camera focus and no
  `transformControl.attach`** — the selected fixture can be off-screen with no
  feedback (camera framing exists only for view presets, `view_presets.js`).
- **No `scrollIntoView` anywhere in `src/gui`.** On a fully-patched ship the
  chip highlighted by a 3D selection is very likely scrolled out of the panel's
  short list — the operator gets no visual confirmation.
- **LED strands: no reverse link at all.** Strands aren't in the 3D fixture
  list (`fixtureList()` = `dmxFixtures || parLights`, :108); tray strand chips
  are informational with no locate onclick (:1845). The link is DMX-only.
- **Index-basis risk (flagged, unverified):** `fixtureIndexByName` indexes
  `fixtureList()` (prefers `params.dmxFixtures`) but `setFixtureSelectedVisual`
  indexes `window.parFixtures[index]` (:345). If those arrays ever diverge in
  order/length the wrong 3D object highlights.

### 1.3 Scene inventory — `titanic`

- `scene_config.yaml` (46.8 KB, newest Jul 15): **84 DMX pars** (38 UkingPar,
  24 ShehdsBar, 20 VintageLed, 2 TeLedGrid40) + **28 LED strands** @ 40 px each
  = **1,120 LED pixels**. Total ~1,204 addressable points.
- **Patched: 0%.** `controllers.yaml` = `controllers: []`; every `patches.yaml`
  entry is `dmxUniverse:0 / dmxAddress:0 / controllerId:0`. Geometry is done;
  electrical mapping is entirely unstarted.
- **Name-count mismatch to reconcile before patching:** `patches.yaml` has 70
  entries but `parLights` has 84 — not 1:1 (moot while all-zero, but must be
  checked when patching begins).
- `views.yaml`: 28 `groupBits` (one per LED strand), **`custom: []`** — no
  authored named views yet.

### 1.4 Engine / exporter / views (what exists)

- Model generation runs **in the browser** (`pixelblaze_model_exporter.js`
  `generatePixelMap()` :11), triggered by a **manual GUI save**
  (`gui_builder.js:305`), not on scene-file edit. Unpatched fixtures export
  `patch:null` (loud, never silent). LED↔DMX parity is emitted per-pixel
  (native RGBW passthrough vs DMX min(R,G,B) white-synth).
- `marsin_engine/models/titanic.js` **exists but is STALE** (257 KB, Jul 8,
  pre-LED onboarding) and — because titanic is 0%-patched — every pixel
  serializes `patch:null`, so the engine would render but **emit no sACN/Art-Net
  for titanic**. No CI guard catches model-vs-scene drift.
- **Views: three tiers.** Tier-A auto-views (`auto_views.js:115`, `bit:0`,
  can't go stale vs pixels) + strand views (`strand_views.js`) + Tier-C 62-slot
  named masks (`view_registry.js`, `MAX_VIEW_SLOTS 62`). Patterns constrain to
  views via `pattern_mixer.js compileViewSelectionMask()` (:35, throws on
  unknown view name). Overlay tuning knobs: viewFader crossfade ramps
  (`pattern_mixer.js:405`), per-channel faders, snapshot morph, global-effect
  W-channel overlays (`global_effect_library.js:494`).
- **Art-Net is implemented + tested** (`artnet_output.js`,
  `output_dispatch.js`; 10 passing tests) but titanic's engine `config.yaml`
  declares only the sACN `Titanic-202` controller — no Art-Net for titanic yet.

### 1.5 MAC / security status

- The now.md:136 commit blocker ("3 MACs in `scenes/**/controllers.yaml`") is
  **stale on disk** — a MAC regex over `scenes/**` returns zero hits; the
  write-path bug was removed (now.md:166) and `bindControllerDevice` /
  `normalizeDeviceBlock` **silently drop** `mac` (`controller_registry.js:132`,
  :626) so it never persists. Only test fixtures carry a literal MAC. **Caveat:**
  a still-running *old* sim process would re-introduce them on save — confirm the
  stack was restarted onto fixed code before trusting the clean tree.

---

## 2. Glitch catalogue (hands-on, screenshots)

Severity: **CRIT** (blocks premap/playa), **MAJOR** (hurts daily use), **MINOR**.

### G1 — Sim runs at ~1 FPS on titanic — CRIT
- **Symptom/measure:** steady-state **1.0 FPS panel-closed, 0.7 FPS panel-open**
  (`fps.cjs`, `mapreview_00/01`). HUD shows "1 FPS" from load.
- **Repro:** load `?scene=titanic`, measure rAF rate.
- **Cause:** the render loop on the full ship (10.8k DOM nodes + heavy scene)
  under software GL. This dominates the "laggy" complaint — it is **not** the
  mapping panel alone.
- **Caveat:** measured under SwiftShader (the agent render path forces
  `renderer=webgl` + SwiftShader). The operator's real GPU will be faster, but
  they independently report lag, so treat 1 FPS as the floor, not the operator's
  number. Root-causing the render-loop cost on a real GPU is a required early
  slice (§3.5).

### G2 — Mapping panel fully rebuilds its DOM on every change — MAJOR
- **Symptom:** every 3D click, keystroke, collapse toggle, and address edit tears
  down and rebuilds the whole panel (`render()` :459 → `bodyEl.replaceChildren()`
  :475; scroll pos manually saved/restored :474/:569 precisely because of this).
- **Measure:** `refreshControllerMapPanel` costs **16–38 ms** per call with a
  full registry (`map_probe perf`, wrapped-timer eval) and is invoked on **every
  selection change**; panel-open drops FPS ~30% (0.7 vs 1.0).
- **Cause:** projection recomputed every render (`computeProjection`), LED
  projection computed **3–4×** per render (`validateLedManualUniverses` +
  `ledUniverseClaims()` calling both `computeLedStrandPatches` and
  `computeLedProjection`, :135/:464/:467), **plus per-LED-port** recompute
  O(ports×strands) in `renderLedPort` (:1028). No memoization, no incremental
  patch, no rAF batching.

### G3 — `window.prompt()` in "+ gap" blocks the entire render thread — MAJOR
- **Symptom:** clicking **+ gap** (and the gap-width path) opens a synchronous
  **native OS modal** (`controller_map_editor.js:1489`
  `window.prompt('Gap width…')`; same blocking pattern for manual-address
  clears). During the hunt this **wedged the page** — `Runtime.evaluate` and even
  a compositor screenshot timed out for >25 s and the renderer pegged at 100% CPU
  until I killed and relaunched the browser.
- **Repro:** open mapping panel on a port, click "+ gap".
- **Severity note:** for a human the prompt is answerable, but a blocking
  OS-modal in a lighting tool is a footgun (freezes the 3D view, no styling, no
  validation UI) and is exactly the kind of "hasty" UX the operator flagged.

### G4 — Mapping UI is too small/dense — MAJOR (operator's explicit complaint)
- **Symptom (computed styles, `map_probe`):** `.cm-body` **10px**;
  `.cm-header-status` 9px, `.cm-summary` 8.5px, `.cm-ip`/`.cm-num` 9px mono,
  inputs 10px; panel is a **fixed 380px** column (`style.css:2391`,
  `width:380px; min-width:380px`), multi-column grid only past ~660px.
- **Cause:** dense defaults chosen for a floating pane. All in
  `simulation/style.css` (:2391–3090).

### G5 — Reverse link has no camera-focus and no scroll-to-chip — MAJOR
- The prized feature is half-built: selecting in 3D highlights a chip that's
  often off-screen (no `scrollIntoView`), and clicking a chip doesn't move the
  camera or attach the gizmo (see §1.2). On a fully-patched ship this makes
  "find it in the other view" unreliable in both directions.

### G6 — Offline push surfaces a raw AbortError string — MINOR
- **Symptom (live, `push_watch.cjs`):** pushing to an unreachable LED controller
  toasts **"✋ 10.x.x.201 unreachable: signal is aborted without reason"** — the
  raw `AbortError.message` (`led_discovery_panel.js:558`,
  `marsinled_client.js fetchWithTimeout` :117, 5 s timeout). Correct outcome
  (fail-loud, no fallback — good) but the message reads like a bug, not a
  timeout. The scan path by contrast gives a clean *"no MarsinLED controllers
  answered on 10.x.x.1–254"* (`mapreview_09`, good).

### G7 — Cross-scene stale caches (LED sync chip / MAC) — MAJOR (from code audit)
- `syncCache` + `liveMacCache` (`led_discovery_panel.js:45`,:59) are keyed by
  `controller.id`, but `nextControllerId` **resets to 1 per scene**
  (`controller_registry.js:274`). Loading a different scene can show a **stale
  sync chip / stale MAC** from the previous scene's controller with the same id.
  No scene-scoped reset.

### G8 — Unguarded async after network waits — MAJOR (from code audit)
- `pushPerOutputVerifyRecord` runs `ctx.mutate(...)` **after** an up-to-30 s
  reboot wait (`led_discovery_panel.js:671`; `marsinled_client.js:646`). Change
  scene or delete the controller during the wait and the callback still mutates
  the (possibly wrong) registry and triggers a save. No abort/liveness tie-back.

### G9 — Vestigial/dual LED sources of truth — MAJOR (from code audit)
- Bound LED controllers use device-linear `computeLedStrandPatches` (ignores
  `led.baseUniverse`, `device_config_mapper.js:43`); unbound use
  `computeLedProjection` (still honors `baseUniverse`,
  `controller_registry.js:1170`). `baseUniverse` is still written on
  create/bind but vestigial for bound controllers — the `cm-led-base` readout
  is explicitly a "visual anchor" (:840). Easy to get wrong.

### G10 — Engine hot-reload doesn't route newly-patched universes — CRIT (engine)
- **Location:** `marsin_engine/lib/output_dispatch.js:203` — `addUniverse(uid)`
  for a controller-**declared** universe that had no sender at boot falls through
  to `return; // pruned` and **creates no sender**, so it never transmits.
  Senders are only built by partitioning the **boot-time** universe list
  (:137–171). Watcher at `engine.js:1542`; `registerUniverse` at :1623.
- **Playa failure mode:** boot titanic 0-patched → patch strands onto U10/U12
  (declared for `Titanic-202` in engine `config.yaml`) → regenerate model →
  hot-reload calls `addUniverse(10/12)` → **nothing happens; LEDs stay dark
  until a full engine restart.** Matches the known bug in now.md:57.
- **Zero test coverage** — `output_dispatch.test.js` never calls `addUniverse`.

**What works well (praise):** add-DMX-controller (4 ports, next-free universes,
`mapreview_03`), add-LED-controller with per-output rows (`mapreview_11`),
per-output linear strand projection is byte-correct (U6 ch1–160 / 161–320 for
two 40-px strands, `mapreview_13`), auto-patch fills the whole ship and reports
"✓ fully patched" (`mapreview_16`), offline scan fails loud and clean, and Save
correctly split-wrote `controllers.yaml`/`patches.yaml`/`views.yaml` **and
auto-derived 3 new `groupBits`** via `reconcileGroupBits`. The registry refuses
to operate without a real registry (codex-P0 no-fallback, `:96`).

---

## 3. Split-screen UI design

### 3.1 Target behavior
- Replace the floating `#controller-map-panel` with a **screen split**: a
  vertical divider separates the **3D sim pane** (left) from a **dedicated
  mapping pane** (right). Dragging the divider resizes both; double-click or a
  chevron **maximizes** either side; a snap at ~50/50 and a "sim-only / map-only"
  toggle. The sim canvas **resizes to the sim pane**, not the window.
- **Responsive:** on a laptop (~1280–1440 wide) default split ~62/38 with the
  mapping pane single-column; on a 27" (~2560) default ~70/30 and the mapping
  pane switches to its existing multi-column grid (the `.cm-main`
  `auto-fill minmax(330px,1fr)` already does this past ~660px — the split just
  needs to give it that width). Persist the divider ratio per-viewport-class in
  `localStorage`.

### 3.2 The link in the new layout
- With both panes always visible, forward selection scrolls the matching chip
  into view (`scrollIntoView({block:'nearest'})`) — the missing piece today.
- Chip click gains an **optional camera focus** (reuse `view_presets` framing to
  fly to the fixture's world position) and attaches the transform gizmo. Add a
  **reverse link for LED strands** (put strands in a locate-able list).
- Keep a "follow selection" toggle so power-users can pin the map while orbiting.

### 3.3 Density fixes (the "too tiny" complaint)
- Raise `.cm-body` base to ~13px and the 8.5–9px overrides
  (`cm-header-status/summary/ip/num`) to ~11–12px; the extra width from the
  split removes the reason they were shrunk. This is a `style.css` change plus
  dropping the hard `width:380px` in favor of the pane's flex width.

### 3.4 Implementation approach (real files)
- **Canvas sizing is centralized enough** to redirect to a container:
  `main.js:93` `renderer.setSize`, `:123` camera aspect, and the canonical
  resize handler `view_presets.js onResize` (:75) — point all three at the sim
  pane's `getBoundingClientRect()` (or a `ResizeObserver`) instead of
  `window.innerWidth/Height`.
- **The load-bearing risk is the raycaster NDC math** in `interaction.js`
  (:125, :255, :309) which uses `window.innerWidth/innerHeight`. Under a split
  these must switch to the canvas rect or **every fixture pick silently
  mis-hits.** This is the single highest-risk edit and needs a pick-accuracy
  test at several split ratios.
- Layout shell: new split container in `index.html` + a small
  `panel_layout`-style divider module (reuse the `left_drawer.js` resizer grip
  pattern :83). The mapping panel comes **out** of the floating system
  (`floating_panel.js`/`panel_layout.js` geometry) and becomes the right pane;
  `controller_map_panel.js` (the modern shell) is the natural mount point.
- Other `window.innerWidth` breakpoints (`control_drawer.js:35`,
  `gui_builder.js:4416`, `pattern_editor.js:710`) either become container-
  relative or are accepted as whole-window — decide per-panel.

### 3.5 Performance (address explicitly)
- **Two independent problems.** (a) The **render loop** at ~1 FPS is the bigger
  one — must be root-caused on a real GPU first (instrument the frame; likely
  suspects: per-frame light-pool/bloom cost across 1,200 fixtures, shadow map,
  DOM-heavy GUI). (b) The **panel rebuild** (G2) — replace `replaceChildren()`
  full-rebuild with incremental/diffed updates (the modern shell is already
  Preact-capable — render the map through it and let it diff), memoize
  `computeProjection`/LED projections per mutation instead of per render, and
  batch `refreshControllerMapPanel` on rAF. Target: selection changes must not
  reproject or rebuild the DOM.
- **Keep the companion-app door open** (operator parked it): if the in-sim split
  can't hit an acceptable frame budget, the incremental-map renderer built here
  is the same code a companion app would host — don't couple the map renderer to
  `three`/`window` globals more than necessary.

---

## 4. Premapping plan + test matrix

### 4.1 Premap the ship
- **P-A — Physical map intake.** Turn the real controller inventory (how many
  MarsinLED + DMX boxes, IPs, which outputs drive which strands/pars) into
  controllers. **Operator input required** — the sim can't invent the wiring.
- **P-B — Patch DMX pars.** Add DMX controllers, assign the 84 pars to
  ports/universes. Reconcile the 70-vs-84 name mismatch (§1.3) first.
- **P-C — Patch LED strands.** Add MarsinLED controllers, bind devices where
  reachable, assign strands per output; per-output linear projection is already
  correct (verified). Resolve the vestigial `baseUniverse` (G9) so bound and
  unbound paths agree.
- **P-D — Regenerate + commit the engine model.** Manual GUI save →
  `models/titanic.js` regen. **Add a CI/auto-check that fails on model-vs-scene
  drift** (currently nothing does — §1.4).
- **P-E — Author named views** (`custom: []` today) once the show design exists.

### 4.2 Test matrix (prefer automatable auto-checks per `.agent/ops/`)
| Scenario | What to prove | How (prefer automated) |
|---|---|---|
| **Map change** (move/rename fixture) | patch fields follow identity, not index; model regen keeps parity | exporter binds by identity (`:52`) — add a sim test that renames a mapped fixture and asserts its patch survives |
| **Design change** (add/remove fixtures) | pixelCount change → engine **refuses** hot-reload + marks stale (correct); no silent partial | engine test around `engine.js:1574`; sim test that add/remove reprojects holes correctly |
| **Controller swap / re-address / add-remove** | universes reallocate, no collision, holes visible not reused | `controller_registry` tests exist; add a titanic-scale fixture |
| **Scene/model reload** | fresh load == saved patches; no stale projected fields when registry goes inactive by reload (G-audit `mapperWasActive` :219) | sim reload test |
| **Engine restart vs hot-reload** | **THE bug (G10):** patch a declared-but-unpatched-at-boot universe → model reload → assert it transmits to its controller | **new `output_dispatch` test calling `addUniverse` — currently zero coverage** |
| **Offline resilience** | push/scan fail loud + clean message; no fallback | covered behaviorally (G6) — tidy the AbortError message |

- **Biggest test gaps:** no titanic-scene round-trip test at all (HIL/auto-checks
  run `test_bench`/`studio` only), no model-staleness guard, no `addUniverse`
  coverage. These are the falsifiers the premap must add.

---

## 5. Views & overlays plan

### 5.1 How views get used on playa
- **Mission-critical = exterior visibility at night.** Views should let the
  operator drive whole-ship families cheaply. Tier-A **auto-views** already give
  side / fore-aft / band / per-strand unions with **zero WASM bits**
  (`auto_views.js`) and can't go stale — lean on these for the exterior.
- **Author Tier-C named views** (`custom: []` today) for the show-design moments
  the auto-views don't name (e.g. "Bow", "Chimneys", "Waterline"), staying under
  the 62-slot budget. **DMX pars are absent from `groupBits`** — decide whether
  par-only views are needed and add par groups if so.

### 5.2 Overlay setup + tuning
- Overlays = global-effect channels layered over base patterns (W-channel
  glints, frost sparkle, deck overlays; `global_effect_library.js:494`,
  `DECK_OVERLAY_MAX`). Tunables: viewFader crossfade rate (`pattern_mixer.js:405`),
  per-channel fader transitions, snapshot morph.
- **Playa tuning work:** (1) map each named view to the overlay set it should
  drive; (2) set crossfade ramp times so view switches read across the playa
  without strobing; (3) decide Art-Net vs sACN per controller (Art-Net is ready
  but titanic declares only sACN today) and add the routing to engine
  `config.yaml`; (4) verify overlays survive hot-reload (mixer rebakes masks at
  `engine.js:1621`, but running channels keep stale membership otherwise).

---

## 6. Recommended slicing for sub-agent fan-out

1. **Render-loop perf root-cause (real GPU)** — instrument frame cost; the 1 FPS
   is the gating problem. ~0.5–1 day. *Do first — it may reshape the UI plan.*
2. **Split-screen shell + canvas/raycaster reparent** — highest-risk (raycaster
   NDC). ~2–3 days incl. a pick-accuracy test at multiple ratios.
3. **Mapping panel incremental render + density** — kill full-DOM rebuild,
   memoize projections, raise font sizes. ~2 days. Fixes G2+G4.
4. **Reverse-link completion** — scroll-to-chip + camera focus + LED strand
   locate. ~1 day. Fixes G5.
5. **Small glitch sweep** — prompt()→inline UI (G3), AbortError message (G6),
   cross-scene cache reset (G7), async liveness guards (G8), baseUniverse
   cleanup (G9). ~1–2 days.
6. **Engine hot-reload routing fix + test** (G10) — CRIT for playa re-patching.
   ~0.5–1 day.
7. **Premap execution + test matrix + model-staleness guard** — needs operator
   wiring input first. Ongoing.
8. **Views authoring + overlay tuning** — after show design. Ongoing.

---

## 7. Operator decisions needed

1. **Physical wiring** — controller count/IPs and which output drives which
   strand/par group. Blocks all premap.
2. **70-vs-84 fixture-name mismatch** in titanic `patches.yaml` vs `parLights` —
   is one list authoritative, or do both need reconciling?
3. **Art-Net vs sACN** per titanic controller (Art-Net is ready but unconfigured
   for titanic).
4. **Render-loop budget** — confirm the lag is also bad on your GPU laptop so we
   scope slice #1 correctly (our 1 FPS is software-GL).
5. **Confirm the sim stack was restarted onto MAC-fix code** before we treat the
   now.md:136 commit blocker as resolved.

---

## Coverage gaps / honesty notes

- FPS/perf numbers are **SwiftShader software-GL** (the agent render path); real
  GPU will differ — slice #1 must remeasure.
- `patch_manager.recomputePatchesActive` body and `gui_builder.exportConfig`
  body were not read in full (behavior inferred from callers + save-server
  expectations).
- `parFixtures` vs `fixtureList()` index alignment (§1.2) not proven — a latent
  wrong-highlight risk.
- The `location.reload()` wedge I hit is a SwiftShader WebGL-context-loss
  artifact on the *render path*, not necessarily an operator-facing bug; noted so
  the next agent doesn't chase it as a product defect.
