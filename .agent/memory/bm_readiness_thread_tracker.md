---
name: bm-readiness-thread-tracker
description: Live tracker for the BM readiness campaign — in-flight agent threads, queued work, and the operator decision queue.
type: project
created: 2026-07-24
updated: 2026-07-24
---

Living tracker for the **bm_readiness_mapping** project (operator asked to
keep the thread state on file for posterity, 2026-07-24). Dossier:
[`../projects/bm_readiness_mapping.md`](../projects/bm_readiness_mapping.md).
Branch: `feat/bm_readiness` (all work uncommitted; commits operator-gated).

**How to apply:** whichever agent coordinates this project updates this file
whenever a thread starts/lands; done items move to the Landed list with
their report link. Reports live in `.agent/reports/202607/20260724_N_*.md`.

## In flight (as of 2026-07-24)

1. **Commit snapshot agent** (Opus, deployment role) — operator
   authorized commit on feat/bm_readiness ("commit so it's safe so
   far"). Checklist: fresh titanic model re-export (TE Sign present,
   1141 px), residue exclusions, security gate, 1–3 logical commits,
   NO push. → `20260724_21`.

**LED Fixtures wave (operator-ordered, Opus implementers) — QUEUED,
launches AFTER the commit lands** (safe baseline first):
1. TE sign renders a BLACK BACKGROUND causing visual conflicts in the
   vis — remove/fix (operator screenshot referenced; reproduce via
   renders).
2. Rename Lighting Profile menu "LED strands" → **"LED Fixtures"**;
   TE sign must live there (TE Sign = LED type, standing ruling).
3. LED fixtures get FULL DMX-fixture-like grouping in the UI.
4. Group LOCK button: fixtures in a group lock relative to each other
   so the whole group moves as one.
5. LED generator: TE-sign generator adds both fixtures together and
   allows relative movement as previously designed.
Constraints (operator, verbatim intent): LED models MUST follow the
TE Sign V3 model YAMLs (te_sign_v3/model_a_120.yaml + model_b_102.yaml,
dots byte-identical, A≡B transform invariant); **each SIDE is ONE
single continuous strand, mapped on its OWN LED controller — A and B
independent at transport/mapping level** (corrected from earlier "one
big strand for whole sign"); operator will send a pixel-ORDER update
to the models soon — design so a model order update drops in cleanly.
Aesthetic bar: "a beautiful TE sign as a LED fixture."

**Observation #11 RESOLVED by machine reboot:** whole-machine/all-
Chrome flicker was accumulated Chrome-GPU-process/driver state —
operator confirms post-reboot "flicker is gone gone, performance is
great." H2 closed. Writer-#2 (H1) remains latent → option-(ii)/
Phase 1 fix still on the table (decision #12).

## Queued

- **2D-vis feedback round 1 (HELD — operator is testing; batch with his
  further findings, then one fix agent):**
  (a) top_down chimney rings render far-right (one hidden UNDER the
  Lighting Controls drawer) — move both to sit centrally among the LED
  strand clusters (shipped default in view placements, stays
  data-editable);
  (b) multiview canvas extends under the open Lighting Controls drawer —
  container must yield the drawer width when open and reflow on close
  (mirror the 3D split's drawer handling);
  (c) 2D views scene-portability — titanic-authored default views don't
  necessarily work on other scenes (test_bench etc.); per-scene behavior
  must be handled correctly (sweep verdict: seed per-scene defaults;
  Smoke Stacks panel banner on test_bench is the visible symptom);
  (d) engine↔sim scene sync affordance (operator asked "can we keep them
  synced?"): header indicator "⚡ Engine: <scene>" (amber on mismatch) +
  EXPLICIT one-click "Sync engine → <viewed scene>" + optional off-by-
  default per-session "follow me" toggle. NEVER auto-follow viewers —
  that re-creates the last-writer-wins bug the bridge fix just killed;
  (e) **LED strands still missing groups** (operator, live testing) —
  LED strands lack the DMX-style group feature in practice (Lighting
  Controls folders/assignment); TE Sign parity landed but strand grouping
  is incomplete — investigate the actual UI path, not just the registry
  contract;
  (f) **Master Enabled semantics wrong for LEDs** — with Master disabled,
  operator expects ALL LEDs black; instead they keep emitting and only
  lose the halo. Find where master gates DMX emission vs LED emission
  and make LEDs honor it fully (sim render AND any output implications);
  (g) **LED strings render as ~2 strands / doubled** — strands appear
  duplicated ("2 strands or something"); suspects: instancing wave
  double-draw (sprites + instanced bulbs), S1 strand-identity split
  showing one physical strand as two clusters (2D), or scene data.
  Fix agent must check BOTH 3D and 2D representations and name which;
  (h) **TE Sign belongs under LED, and the section renames** (operator):
  the TE Sign currently appears in the "DMX Fixtures" menu — move it to
  live with the LED strands, and rename that section "LED Fixtures".
  Consistent with the standing "TE Sign = LED type" ruling; watch the
  scene-config representation (it lives in `parLights` today) — the fix
  must not break patching/groups/`TE Sign (2)` select or the A≡B
  transform invariant.

- Writer-#2 arbitration implementation — after the operator picks option
  (i)/(ii)/(iii) (see decision queue).
- 2-minute eyes-on A/B (`~/tmp/ab_writer2.cjs` staged) — on operator "go".
- Premap execution + W-slices — wait on operator decisions.
- **Pre-commit: re-export the titanic engine model from the CURRENT scene**
  — sweep verdict: `titanic.*` models are an 11:05 snapshot (has S1
  localIndex + 1147 px) regenerated BEFORE the 15:10 TE Sign swap; still
  encodes TeLedGrid40, zero TE Sign (live map 1141 px = 1147−80+74). Do
  NOT ship the stale snapshot.
- Pre-commit residue to exclude/refresh: engine runtime state
  (`globals_state.yaml`, `audio_state.yaml`, untracked `vsn1_layout.yaml`),
  CRLF-only churn (`manifest.json`, `common.yaml`).

## Duplicate-work guard

- **`syncGuiFolders` ReferenceError (gui_builder.js:1708)** — ALREADY FIXED
  on `feat/bm_readiness` by the glitch sweep (report `20260724_5`): proper
  `export` at `interaction.js:178` + static import at `gui_builder.js:27`.
  Verified in tree 2026-07-24. The separate operator session spawned for
  this same bug has ENDED — do not re-fix.

## Landed today (2026-07-24)

- Foundation review `20260724_0`; perf root-cause `20260724_1` (render loop
  exonerated on GPU; lag = panel); split-screen shell `20260724_2`;
  engine hot-reload universe fix G10 `20260724_3`; panel perf ~10× +
  reverse link + left-dock flip `20260724_4`; **glitch sweep `20260724_5`**
  (G6/G7/G8/G9 + Lighting Controls select-all ReferenceError; 293 sim
  tests, wire-parity proven for G9); views & overlays playa design
  `20260724_7`; **CaptainPad namedViews picker W1 `20260724_8`** (shared
  sectioned/searchable picker on both view surfaces, 790 vitest pass + 28
  new, operator review pending — coordinator-initiated slice; 4 lint
  errors in `GlobalEffectMacros.tsx` pre-date W1); **emitter instancing
  `20260724_6`** (`full` 20→59.5 FPS, `emissive` 20→59.9 on real GPU;
  ~2,668 per-pixel meshes → 250 InstancedMesh + 80 Sprites; visuals A/B
  verified; **operator-confirmed "speed is day-night better"**).
- **2D-vis wave:** design `20260724_9`; S1 geometry core `20260724_10`
  (strand identity fix — 85→100 clusters, engine model byte-identical;
  radial/planar/lanes layouts; shared frame source); S2 view model
  `20260724_11` (views-as-data + 4 defaults; chimneys = TWO ×10-par groups
  → two radial rings); S3 pane shell `20260724_12` (pane tree/view/Preact
  container, injected deps, 51 tests); **S4 integration `20260724_13`**:
  multiview LIVE in `2d_pixels` (4 views seeded, migration, persistence,
  Views manager, focus-scoped keys; TE sign LED-class; TeSignV3 A+B
  registered — 8 fixture types load; **spatial/planar rewritten to true
  whole-panel projection** — top-down matches the 3D top render; 426/426
  tests; 6 panes 57.7 FPS real GPU; `pixel_map_renderer.js` retired).
  Gaps: EDIT drag only radial/lanes (deliberate); scene-YAML views
  round-trip unit-proven, not disk-exercised; pane polish descoped per
  operator (dropdown is enough).
- **LED grouping + TE Sign V3 `20260724_14`**: real sign installed —
  models `te_sign_v3/model_a_120.yaml`+`model_b_102.yaml` (provenance
  scrubbed, dots byte-identical), scene swap `TeLedGrid40`→`TE Sign V3
  A/B` group `TE Sign` identical pose, `te_sign_generator.js` (A≡B hard
  invariant, whole-sign placement), grouping parity proven. 426/426.
  **LIVE VERIFICATION ALL PASS**: labels 120/102ch; 74 px, bbox
  1.58×2.17 m; chase order correct, `rotY 180` NOT mirrored; seam
  disjoint, nearest A↔B 166.6 mm; `TE Sign (2)` group selects exactly
  both halves. Deferred: 2D te_sign view eyeball on real-GPU host.
  Tools: `agent_tools/tesign_verify*.cjs`.
- **Flicker/freeze debug + fix `20260724_15`: LANDED, wire-verified** —
  three mechanisms: (1) route flapping — every sim tab's `setScene`
  REPLACED the bridge's hardware route table (`sacn_input_source.js:116`);
  titanic = 0 routes → bench disconnected on every titanic tab load;
  (2) dual sACN writers — engine unicast U10/U12 to 10.x.x.202 + bridge
  relaying the engine's own loopback frames back (both from c6eaa733);
  (3) viewport GPU contention (fleet browsers + operator tab; zero JS
  longtasks during stalls; instancing + GC exonerated; engine cadence
  39 Hz clean). "Started today" activator = the agent fleet churning sim
  tabs. FIX LIVE: `simulation/lib/bridge_routing.cjs` union routes (CLI
  pin ∪ engine activeScene via new `/status outputRouting` ∪ refcounted
  client tags) − engine-owned pairs; flip-proof 5 tab cycles → 0 route
  removals; dual-write suppression live; wire 39.1 Hz max gap 29 ms;
  sim 436/436, engine 2091 pass/8 env; save server :6970 was dead
  pre-session — restarted by agent. Ops rule codified in
  `os/multi_agent.md` §9: agents close every sim page they open.

- **Cold review A `20260724_17`: diagnosis complete, AGREES with `_15`,
  CONVERGES with B** — H1 (high confidence): in `sacn_in` mode the sim
  tab is a prio-150 sACN hardware writer inside Chrome's rAF loop
  (`animate.js:543-590`, prio at :576, via :6972); tab focus is
  literally the on/off switch of writer #2 fighting the prio-100 relay.
  H2 (residual): Chrome-INSTANCE-level ~1s jank supplies the raw stalls
  while focused (fresh page on same URL stall-free headless AND headed
  on RTX 4090 at 59.9fps → not sim-page JS); H1 exports the stalls to
  the lights, blur erases them. All 10 observations explained; obs #9 =
  same E1.31 ~2.5s source-loss handoff B found (independent). Obs #10
  audio → residual stall is Chrome-instance/system-wide; the ONE open
  item: needs a 2-min operator-present trace to pin exactly. Engine
  time-loop ruled out (3× cadence probes p50 39.8fps). Launcher arms
  writer #2 itself (`launcher.js:102-121` auto-opens sacn_in tab).
  **NEW interim option: `readonly: 1` in the prod profile simParams —
  one line, kills writer #2/focus coupling/handoff freeze tonight**
  (trade: that tab's per-fixture overrides stop reaching hardware).
  Real fix: decision #12 option (ii) — same as B and `_19`; explicitly
  diverges from `_15`'s option (i). All probes closed.
- **Cold review B `20260724_18`: diagnosis complete, AGREES with `_15`**
  — #1 mechanism: in `sacn_in` mode the sim page is itself a prio-150
  sACN hardware writer clocked by Chrome rAF (`animate.js:543-590` →
  :6972) on top of the bridge's steady prio-100 relay; hardware output
  enslaved to Chrome tab health; on-screen flicker = Chrome GPU/present
  starvation under external GPU load (data feed measured flawless:
  39.3fps, maxGap 41ms, zero gaps). Obs #9 (tab-away small freeze) =
  E1.31 ~2.5s source-loss hold before fallback to relay. Obs #10
  (audio): machine-wide stall RULED OUT (zero event-loop gaps >100ms in
  180s) → points at Chrome's shared GPU process; speaker-audio would
  need admin DPC capture. Engine time-loop REFUTED. Adds 3 latent
  hazards `_15` missed: global-not-per-universe bridge arbitration
  (`sacn_bridge.js:415`), `reuseAddr:true` on Receiver (:410), missing
  `127.0.0.1` skip in `animate.js:564`. Minimal fix = option (ii)/
  Phase 1 of `_19` (guarding animate.js alone is too naive — it carries
  operator overrides). Interim: ONE sim window during bench, shed
  non-stack GPU load. Note: both controllers TCP-unreachable during
  probe (bench likely powered off). Confidence: high on mechanism.
- **Engine priority hardening `20260724_20`: LANDED (code-only, live
  stack untouched)** — new shared `tools/process_priority.cjs`
  (elevateSelf/elevatePid, always logs `requested=X achieved=Y`, no
  silent fallback); engine self-elevates (env `BM26_ENGINE_PRIORITY` >
  CLI `--engine-priority` > config > `'high'`); launcher passes env +
  parent-side belt via real engine pid (survives scene-switch restart);
  both sACN bridges elevated (self + parent). Default HIGH everywhere;
  REALTIME opt-in, honestly reports downgrade without admin. Jitter
  proof (25ms tick, 64-worker load): NORMAL mean 3.40ms/12% ticks
  dropped → HIGH mean 0.49ms/drops recovered (~7×). New 11/11 tests;
  engine suite 2103/2110 (7 pre-existing env fails, < baseline 9).
  **Activation: operator's next relaunch** — look for `[EnginePriority]
  requested=HIGH achieved=HIGH` + two `[BridgePriority]` lines. Live
  engine pid 4748 still reads Normal (untouched, the vulnerable case).
- **Router-in-engine design study `20260724_19` (DESIGN ONLY, no code)**:
  recommendation **GO, phased** — engine becomes the only hardware writer
  by extending `output_dispatch.js` in-process; universe→destination truth
  moves into the engine model (patches.yaml stays authoring surface,
  exporter bakes controller table, per-box overlays); operator per-fixture
  Off/Brightness overrides become an engine pre-send buffer stage +
  `GET/PUT /output-overrides` API (WS broadcast, `states/` persistence);
  sim tabs become pure viewers in `sacn_in` mode (`animate.js` relay
  branch dies); browser-generator bench modes keep :6972 so sim-without-
  engine bench driving survives. **Resolves decision #12 as option (ii)**
  with evidence option (i) would keep hardware chained to tab focus.
  Effort ~1–1.5 weeks in 3 rollback-safe phases; Phase 1 (overrides →
  engine + sacn_in tabs stop writing) alone removes Chrome from the write
  path. Key risks: engine = delivery SPOF, stale model exports become
  hardware-affecting (needs model-hash guard), override replay on restart
  must be exact, console-via-bridge relay dies in Phase 3. Operator
  decisions: approve option (ii)/Phase 1; confirm nobody uses console-via-
  bridge relay; pick overlay home for per-box controller declarations.
- **Integration sweep `20260724_16`: ALL GREEN** — sim 436/436 + all
  smokes/perf gates; engine 2094/9 (all 9 pre-existing env flakes, +3 new
  passes); CaptainPad tsc 0 / 790 pass. Security gate PASSES on
  commit-eligible files (21 MAC findings all in gitignored
  `.scene_backups/`). Titanic-model mystery SOLVED: 11:05 S1 export,
  stale vs the 15:10 TE Sign swap → re-export before commit. test_bench
  2D views: loads, main panels render, titanic "Smoke Stacks" panel
  shows a loud scoped no-match banner — acceptable-but-untidy, seed
  per-scene defaults (punch list). New finding → decision #14
  (auditorium fixture overlap).

## Operator decision queue (blocking)

**Premap trio (blocks all physical premapping):**
1. Physical wiring plan — controller count/IPs, output → strand/par.
2. 70-vs-84 fixture-name mismatch (titanic patches.yaml vs parLights) —
   which is authoritative?
3. Art-Net vs sACN per titanic controller.

**Views design six (from report `20260724_7`):**
4. Group-name normalization direction (gates W2 regen fix).
5. INTERIOR view membership.
6. SAFETY_MIN never-dark exterior set.
7. Night-arc show design (incl. TE Sign duty).
8. View-scoped global effects — recommend defer.
9. BAND thirds vs authored heights.

**2D-vis (from design `20260724_9`):**
10. Multiview exclusive to `2d_pixels` profile — S4 proceeded with this
    recommendation; veto still open.
11. Smoke stacks: TWO 10-par chimney groups shipped as two rings
    (data-editable) — confirm or name exact fixtures.

**Flicker/freeze round 2 (`20260724_15` §7): CLOSED** — bridge poll
CLEARED (zero recompute churn, wire clean); engine time loop CLEARED
(setInterval coalesces, monotonic clock, 39.1Hz/40ms-max on wire);
2-clients NOT sufficient alone (controlled A/B incl. pixelblaze: ≤1
freeze/100s) — rhythm required full afternoon load stack; content
golden_hour_wash has ~1.99s level cycle (perceptual cross-check).
FORWARD PLAN on next occurrence: operator F5 (session-age vs code
split); if survives, ping coordinator, close nothing — agent attaches
live. **LANDED: multi-client warning** — bridge client census broadcast
+ red HUD banner in every window when count>1
(`simulation/src/gui/multi_client_warning.js`), 6 tests, sim 442/442,
live-verified 2→3→2. Bridge now pid 30416 (census build).

**Flicker/freeze (from debug `20260724_15`):**
12. **Writer-#2 kill design** — in sacn_in mode the browser's sACN-out
    ALSO delivers per-fixture Off/Brightness overrides to hardware.
    Options: (i) input-bridge stands down per (universe,ip) while a
    browser drives it; (ii) sim-out stands down, overrides move
    server-side; (iii) rely on receiver priority (broken on these
    gateways). **Design study `20260724_19` recommends (ii)** — option
    (i) would keep hardware chained to Chrome tab focus, the exact
    observed failure. Held for operator.
13. **2-minute eyes-on A/B** — operator watches bench during scripted
    phases to tie the visual symptom to the wire signature. Staged,
    awaiting go.

14. **Left Center Auditorium overlap** (sweep finding): new *Left Center
    Auditorium* fixtures spatially overlap *…Generator* fixtures (5+
    overlap warnings) — confirm intentional double-patch or fix.

**Small confirmations:** CaptainPad namedViews picker keep/drop verdict;
lag-on-GPU-laptop calibration; sim stack restarted onto MAC-fix code
(marks the now.md commit blocker resolved).
