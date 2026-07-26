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

- **Commit wave #3 (Opus, operator-ordered 2026-07-25)** — commits all
  uncommitted work on `feat/bm_readiness` (rename-orphan _37, DMX gate
  _40, trail/selection fix _1/_2, audio kick fix _39, trace_chains _33,
  partial color-transition + S2 wiring marked WIP): explicit staging
  only, security check per commit, residue triage on
  `marsin_engine/states/**`, NO PUSH. Report reserved: `20260725_3`.
- **TE sign test_bench pattern debug (Fable)** — operator (verbatim):
  "why the TE sign in the test_bench scene not showing patterns? even
  on pixelblaze lighting engine from the sim not from marsin engine
  over sacn". Read-only diagnosis (probe with `&readonly=1`, own
  browser, no scene switch), both drive paths, fix plan for Opus.
  Report reserved: `20260725_4`. Next slice number free: `_5`.


**LED feedback round 2 (operator tested, "chef's kiss" overall):**
**OPERATOR IS OFFLINE (announced ~this update). Autonomy mode within
the law; document all judgment calls; nothing pushed; commits were
explicitly ordered.**

**HOST-PROCESS RESTART EVENT (2026-07-25):** the Claude Code session
restarted; the in-flight agents (S0, S2-wiring, color-transitions)
were marked stopped-by-user and CANNOT be resumed (harness policy:
relaunch only on explicit operator ask). Tree verified HEALTHY after
the interruption: touched files syntax-clean, sim suite 526/526.
Awaiting operator "continue" to relaunch fresh agents for:
1. **S0 generator live proof** — report `_30` missing; committed
   generator UI code is valid but live proof/design-audit not done.
2. **S2 chain wiring** (`_34` missing) — `trace_chains` module (`_33`)
   DONE+tested; gui_builder/config wiring (startAngle/splits UI,
   chainPlan generation, multi-chain sweep) not confirmed complete;
   any partial edits in tree are syntax-clean and test-green.
3. **Color transitions** (`_38` missing) — substantial partial work ON
   DISK (sim `src/core/color_transition.js`, engine
   `lib/color_transition.js`, passing math tests, param_center/
   test_bench.effects wiring edits); missing integration proof,
   benchmarks, visual side-by-sides, report.
**Stale task chip:** "fix 4 NUL bytes in gui_builder.js" is ALREADY
DONE (commit 34c8c52f, '::new::'/'::ungroup::', 0 NULs on disk) — do
not redo.

**Landed 2026-07-25 — LED move trail + sticky selection DEBUG (Fable,
`20260725_1_led_move_trail_debug.md`):** all 3 operator symptoms
reproduced live on :6969/titanic, screenshots inspected. Root causes
(both LONGSTANDING — byte-identical since the main.js split 30495f12,
NOT introduced by the LED-wave campaign): (1) trail = 3D-handle move
path never invalidates the marsin batch cache — interaction.js:231-234
early-returns into `_onStrandTransformChange` (gui_builder.js:4329)
which skips the `invalidateMarsinBatchCache` PAR drags hit at L298;
`_batchRenderList` positions are snapshotted at generatePixelMap
(pixelblaze_model_exporter.js:393-395) and the dot flush writes colors
only → measured 40/40 dots at old line, 40/40 bulbs at new line; also
stales 2D map + engine normalized coords. Sliders don't trail
(rebuildLedStrands → invalidate at :4324) — confirming asymmetry.
(2+3) sticky selection + orange line = `deselectAllFixtures()`
(interaction.js:98-105) clears PARs only; empty-click (L489-495) and
Escape (L541-543) never call strand `setSelected(false)`; orange line
is the strand's selection glow tube (`led_strand.js:146-159`, colored
`config.color`, 7/8 titanic strands #ff8800). SIDE FINDING (filed, not
fixed): locked strand groups don't rigid-move on 3D handle drags —
slider path honors the lock, handle path doesn't. PROBE LESSON: load
sim probe pages with `&readonly=1` — main.js:267 overwrites
`__readonlyMode`, otherwise the probe becomes a live sACN writer.

**Landed 2026-07-25 — LED move trail + sticky selection FIX (Opus,
`20260725_2_led_move_trail_fix.md`, UNCOMMITTED):** surgical 2-file
diff per the `_1` plan. (1) `_onStrandTransformChange`
(gui_builder.js:4329-4345) now calls guarded
`invalidateMarsinBatchCache('strand_transform')` after
`rebuildVisuals()` — one bump cures global dots + 2D map + engine
`_batchCoords` + sACN pattern geometry. (2) `deselectAllFixtures()`
(interaction.js:98-118) also clears `ledStrandFixtures`
`setSelected(false)` + strips `gui-card-selected` from
`strandGuiFolders`; strand-pick order preserved; PAR/TE-Sign path
untouched. Live probe (readonly=1, autoSave asserted false): dots at
old/new line 40/1 → **0/41**; 2D-map 0 stale / 40 new; click-away AND
Escape now clear `_selected`/tube/handles/card (was true×4 → false×4);
84 PARs still selectable; **542/542**; screenshots inspected (post-fix
old diagonal = bare hull, glow gone after Escape). Probe lesson: on
SwiftShader allow ≥3000 ms settle — cache rebuild lands next frame and
this box runs ~1-2 fps; a 1500 ms settle false-failed once. Drag-FPS
delta unbenchmarkable on this box (structurally cheaper than the
slider path). Locked-group rigid-move side-finding still OPEN (operator
decision queue).

**Station-mapping wave plan (paused at S2):** `S0 ∥ S1(done) → S2 →
S3 → S4`.
**STACK EVENT (2026-07-25 ~04:17 local):** operator's stack went DOWN
while he was offline (all 6 ports dead; not caused by any agent —
possibly shut down before leaving). Coordinator restarted it per the
launcher law: `node launcher.js prod --scene titanic`. All services
up; **`_20` priority hardening verified live: engine + both bridges +
launcher parent all log requested=HIGH achieved=HIGH.** Engine:
titanic 981 px, render-only (0 patched — expected, patches empty).
Noise flags: VSN1 page-0 deploy FAILED (Lua action string 5960 chars >
device limit 909) + a libuv assertion in that path — engine kept
running; pre-existing device-config issue, follow up separately. A
stale browser client tagged 'test_bench' reconnected to the bridge at
boot (old tab somewhere) — bench controllers offline, harmless.
**FOLLOW-UP EVENT (~04:18):** a real Chrome window loaded
`?scene=test_bench` and an explicit /scene switch restarted the
engine titanic→test_bench (now healthy on test_bench,
02_phase_cathedral, renderHealth ok). The LAUNCHER PARENT exited
code 1 around the engine-child restart (VSN1 libuv assertion
suspected aggravator) — ALL SIX SERVICES SURVIVED and run unsupervised
(`node launcher.js stop` still the clean stop). Coordinator did NOT
switch the engine back (unknown whether the switch was the operator —
no last-writer-wins fights). NEW FOLLOW-UP CANDIDATES: (a) VSN1
deploy Lua exceeds device 909-char limit + crashes native assertion —
needs guard/fix; (b) launcher parent dying on engine scene-switch
restart deserves a look (supervision gap).
3. **S2 QUEUED** (after S0+S1+`_37`; gui_builder + config.js
   single-owner): wire trace_chains into circle traces +
   traceGenerated re-stamp. → `20260724_34`.
4. **S3 QUEUED** (after S2): scene restructure through the LIVE app UI
   per design `_32` (stations rename, par replacement, smokestack
   chains, TE Sign 2, orphan cleanup, Smokestacks view; ~/tmp backup;
   autosave on; never restart stack). → `20260724_35`.
5. **S4 QUEUED** (after S3): engine model re-export + pixel census +
   campaign report. → `20260724_36`.
6. **Color transition optimization** (Fable, research+implement+test,
   operator order, IN FLIGHT) — replace naive RGB lerp with
   perceptually optimal interpolation (evaluate OKLab/OKLCH vs
   CIELAB/CIELCH vs CAM16-UCS; operator's "Java colors lab library" =
   CIELAB family). Inventory ALL transition sites (sim gradient
   stops, engine crossfades/mixer; VM-side pattern math report-only);
   pure modules, no runtime deps, per-pixel-per-frame perf budget
   with benchmarks; hue shortest-arc + achromatic + gamut mapping;
   gui_builder.js LOCKED (owned by `_37`) — document any needed UI
   edit instead of making it. Visual side-by-side proof on hard pairs.
   → `20260724_38`.
**Design `_26` LANDED** (see Landed). Operator decision points from it:
(D1) stateless generator buttons (RECOMMENDED, designed) vs persistent
trace-style cards with Regenerate; (D2) second sign click: confirm +
`TE Sign 2` (designed) vs hard-block (only one physical sign exists);
(D3) cosmetic rename DMX "Light Instances" → "DMX Fixture Instances";
(D4) sign groups pinned top (designed) vs bottom; (D5) glyph ✨ vs 📐.
Proceeding on designed defaults unless operator objects.
Scene change (operator): several LED strands REMOVED as unneeded —
agents must re-read live state, never restore them. **Pre-commit
consequence: titanic engine model needs RE-EXPORT again** (strand
removal changed the pixel map after the _21 export).
Standing constraints: TE Sign V3 YAMLs canonical/read-only; each side
one strand on its own controller; pixel-ORDER model update INCOMING.
Held: punch (g) doubled strands.


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

- **DMX dot-gate fix `20260724_40`: LANDED — bug was WORSE than
  filed**: titanic scene has ZERO patched fixtures, and
  `applyFixtureOutputOverrides` skips unpatched fixtures entirely →
  DMX group masters had NO effect on ANY rendered pixel (not just
  dots). Fix: `dmxOutputScale()`+`applyDmxEntryOutputGate()` (pure, in
  dmx_output_overrides.js) as one authority; `_applyDmxOutputGate()`
  in animate.js AFTER `applyFixtureOutputOverrides` (single-scaling on
  wire proven: 159→64 not 25.4); join by `entry.fixtureConfig` (same
  live object as the buffer gate — _27 keying trap structurally
  impossible); repaints direct-painted bulbs when unpatched;
  `outputGain()` delegates to same fn. Post-fix OFF ⇒ exact 0 on
  entry/2D/dot/bulb both regimes; 40% ⇒ exact ×0.4; 0.013 ms/frame.
  LED gate untouched (led_blackout_verify re-run PASS). New
  `dmx_blackout_verify.cjs` (+`--patch` in-memory patched regime) +
  16 tests. 542/542. **OPERATOR NOTES:** (1) visible change at boot —
  `Left Front Deck Generator` persisted at brightness:0 was rendering
  FULL, now correctly black (ties to `_32` open question #6: reset
  that override?); (2) NEW DECISION: DMX section's global Master
  Enabled (parsEnabled/dmxEnabled) is STILL visibility-only — the
  exact pre-_27 shape of punch (f); folding it in touches
  `outputGain()`/light pool, held for operator.
- **Audio Companion kick/distortion fix `20260724_39`: LANDED** — TWO
  independent bugs on the test source: (1) kick-always-off
  (long-standing): the `tone` synth's steady 55 Hz sub sits INSIDE the
  50–110 Hz kick window, pinning the adaptive ratio threshold
  (instant > ema×2.4) so the 80 Hz transient never fired — retuned
  synth (sub 0.28, kick 1.0, longer burst; ~10 kicks/6s both FFT
  sizes) + regression test; (2) distortion: engine runtime tuning had
  drifted `inputGain: 8.83` (stale mic calibration in
  states/test_bench/audio_state.yaml), synced over ws/control and
  applied to the full-scale synthetic source → 81.9% samples clipped.
  Durable guard: test source now renders at UNITY gain (immune to any
  persisted mic preamp — verified clean even with 8.83 still synced);
  `applyInputGain` fails loud on bad values; stale param-seed literal
  in companion_server removed. Engine's persisted 8.83 NOT hand-edited
  (engine-owned runtime state; test source decoupled anyway) —
  operator can reset inputGain in MIC TUNE if the real mic path runs
  hot. OSC out proven (/marsin/mic/kick ~55 Hz w/ envelope). Engine
  suite 2126/2133 (7 pre-existing env fails, zero new). Only the
  Companion process was restarted; engine/sim untouched.
- **Generator rename-orphan fix `20260724_37`: LANDED** — root cause:
  trace-name onFinishChange set `trace.groupName` to the NEW name
  BEFORE regenerating, so the sweep (which removes by current name)
  matched nothing → old fixtures orphaned as duplicates (with orphaned
  overrides + view bits); the exact mechanism behind the 12 committed
  orphans from `_32`. Fix: remove-old-first semantics — fail-loud name
  guard (reverts input), carry group master override + view-mask bit,
  set new name, regenerate sweeping OLD name via new
  `previousGroupName` param on `generateGroupFromTrace` (3rd param
  defaults null = prior behavior). New pure
  `simulation/src/gui/trace_group_rename.js` + 12 tests + live
  `agent_tools/trace_rename_verify.cjs`. config.js unchanged (re-stamp
  pinned by test). LED ✨ flow unaffected (renames via _28 paths).
  Both directions + double-rename proven live (REPRO→FIX→GUARD, zero
  scene writes). 519/519. Pre-existing 12 scene orphans left for S3.
- **S1 trace_chains `20260724_33`: LANDED (new files only)** — pure
  `simulation/src/dmx/trace_chains.js` (`chainPlan`/`chainGroupNames`;
  splits ∈ [1,4], mirror/sequential layouts, startAngle fold, fail-
  loud on all bad inputs) + 23 tests; suite 519/519. KEY FINDING for
  S2: gui_builder's arclength arithmetic is NOT reproducible by naive
  degree math (1-ULP divergence) — module replicates the exact
  sequence; splits=1 proven strict `===` against a verbatim oracle on
  real titanic smokestack params (10/10 dots bit-identical + 6 more
  geometries). S2 contract: place fixtures from `points` (authoritative,
  local space, pre-transform), chain-major naming `<group> <i+1>`,
  `angles` display-only; buildTracePath change must use
  `startRad + (s/length)*arcRad`; count is per-chain when splits>1;
  pointOffsets kept for splits=1, disabled for splits>1; group names
  union with legacy `trace.groupName` in regeneration sweep AND
  config.js traceGenerated re-stamp.
- **Commit snapshot #2 `20260724_31`: COMMITTED on feat/bm_readiness
  (NOT pushed)** — `34c8c52f` sim LED-wave code (16 files, slices
  22–29 + NUL sentinel fix `'::new::'`/`'::ungroup::'` — file diffs
  as text again); `cdccabde` titanic scene state + re-exported model
  (**1141 → 981 px** after the 8 `Small_*` strand removals; TE Sign
  74 px present; viewmasks bit matches views.yaml); `d091977b` .agent
  docs (_21.._32). gui_builder.js integrity: NO broken partial edit —
  the cancelled S2 generator UI is complete and valid; committed.
  484/484 tests. Security: commits 1–2 first-try PASS; docs commit
  failed on a `_21` self-leak (its security section quoted the IPs it
  redacted) — re-redacted → PASS. Exclusions documented in `_31`
  (engine runtime, timestamp churn, session churn, CRLF-only, junk
  files incl. stray `led202.*` 0-pixel export). Model re-export via
  readonly tab, zero sACN, show undisturbed.
- **Titanic station mapping design `20260724_32` (Fable, DESIGN ONLY):
  LANDED** — target: 64 pars / 16 groups / 8 strands unchanged / 1
  custom view. 4 wall stations = existing wall traces renamed
  (Left/Right Front/Back Wall, 5× ShehdsBar each); 4 top-deck vintage
  stations renamed + 8 NEW top-deck pars in 2 side groups of 4
  (REPLACING 7-count Center Auditorium par groups; reading "16 vintage
  + 8 pars" flagged as D3); smokestacks: per stack 2 chains × 4 pars,
  index 1 nearest start, CCW/CW fan ±22.5° for even 360°; umbrella
  "all together" = custom VIEW `Smokestacks` (groups don't nest; NOT a
  power master — flagged); TE Sign 2 starboard via ✨ generator flow
  (U10–13 proposed, patching deferred to bench). NEW FEATURE: circle
  trace params `startAngle`+`splits` (+splitLayout) with pure
  `trace_chains.js`; `splits:1` byte-identical to today. CLEANUP: 12
  orphan duplicate fixtures found (trace-RENAME ORPHANING BUG at
  gui_builder.js ~L3743) — design says delete; all patches currently
  EMPTY = cheap window for renames. 14 offline defaults in §8; 7 open
  questions for operator in §9 (headliner: 4+4-per-station vs
  16v+8p reading — changes fixture counts).
- **LED blackout semantics `20260724_27`: LANDED (absorbs punch (f))**
  — root cause: each LED strand pixel has FOUR consumers; `_24` gated
  only the per-strand meshes, while the global V2 instanced-dot flush
  (`_pixelInstancedMesh` in animate.js — the visible residue dots),
  the 2D pixel map tap, and the sACN output map all read the raw
  `_batchRenderList` entry color ungated. Punch (f) same bug: Master
  Enabled OFF only hid the THREE group. Keying trap: live scene now
  has 8 strands ALL Ungrouped; exporter tags pixels by strand name but
  the master keys on the 'Ungrouped' display bucket — an entry.group
  gate would have silently no-op'd; fixed with runtime-only
  `entry.displayGroup` field. Fix: ONE authority `ledOutputScale()` in
  group_lock.js (master OFF⇒0, group OFF⇒0, else brightness) applied
  by `_applyLedOutputGate()` in animate.js after all color sources,
  before sACN out + dot flush + 2D tap, plus exporter/static-preview
  scaling. Proof live: GROUP OFF and MASTER OFF ⇒ entry/2dDecode/bulb/
  halo ALL exactly 0 (ON baseline 1.9961); remaining glow = DMX
  generators, correctly ungoverned. 484/484 tests. Verify tool:
  `agent_tools/led_blackout_verify.cjs`. No gui_builder edits.
- **LED drawer flatten + rename `20260724_28`: LANDED** — Sign
  Fixtures / LED Strands subfolders removed; TE Sign group + strand
  groups + toolbar render as ONE flat list under 🔌 LED Fixtures;
  `window._ledFixtureInstancesFolder` = the section folder; par/strand
  renderers share the parent but tear down only their own folders
  (strand edit can no longer destroy TE Sign folders). REAL rename bug
  fixed: strand rename orphaned `ledGroupOverrides` (lock+brightness)
  — now carried old→new; fail-loud collision guard (empty/reserved/
  duplicate) on strand Rename, Add Group, Move→New, and TE Sign
  rename. 483/483 tests; 15/15 isolated live DOM checks (autosave
  aborted, operator scene untouched); 3 captures inspected.
- **LED generator S1 catalog `20260724_29`: LANDED (new files only)**
  — `led_generator_catalog.js`: pure fail-loud catalog, sole entry TE
  Sign (target parLights, bornLocked, build→buildTeSign), load-time
  validation; `uniqueGroupName` dodges target groups + trace names +
  reserved Ungrouped; `runLedGenerator` enforces one-group output
  contract. API for S2: LED_GENERATORS / LED_GENERATOR_TARGETS /
  RESERVED_GROUP_NAME / getLedGenerator / uniqueGroupName /
  runLedGenerator / assertGeneratorFixtures (+ per-entry
  `defaultGroup`). 23 new tests; suite 478/478.
- **LED generator workflow design `20260724_26` (Fable, DESIGN ONLY):
  LANDED** — mirrors the DMX split: `✨ Generators` folder under LED
  Fixtures driven by a pure catalog module (`led_generator_catalog.js`,
  sole entry TE Sign); flat list titled **"LED Fixture Instances"** as
  a VIEW not a data store (data stays in params.parLights — patching/
  select/master/rename/lock/A≡B unchanged); generator STATELESS
  (option A, no new YAML keys; the locked group is the editing
  surface); second-click guard: confirm + unique `TE Sign 2` group
  (prevents silent 4-halves fusion); future-generator seam = catalog
  `target` dispatch. ZERO scene migration. Slices S1 (catalog, new
  files) / S2 (gui_builder, after flatten+rename) / S3 (live verify
  tool). Incidental: `\0` in gui_builder.js is the intentional
  `' ungroup'` Move…-dropdown sentinel, not corruption.
- **LED-C group lock + generator + real LED master `20260724_24`:
  LANDED** — new pure module `simulation/src/core/group_lock.js` (lock
  predicate, member collection, TE-sign classifier, LED master RGB
  scale; 13 unit tests). 🔒 on both group toolbars; `locked` flag in
  `groupOverrides` (par) / new `ledGroupOverrides` (strand), persists
  via save/load. Rigid moves: par groups via gizmo differential
  (`interaction.js computeRigidMoveIndices`) AND numeric inputs;
  strand groups via numeric Start/End. TE Sign rigid moves route
  through `applyTeSignPlacement()` in BOTH paths — A≡B unbreakable.
  Generator `✨ + TE Sign (A+B)` births groups locked. REAL LED group
  master: brightness/On-Off scales the direct-paint path
  (exporter apply closure → `scaleRgbForGroup`, live per frame) +
  static preview; blackout unbeatable. Live verify ALL PASS
  (`agent_tools/group_lock_verify.cjs`, `.agent_renders/glock_*`);
  455/455 tests (442+13). OPERATOR NOTES: existing scene TE Sign group
  loads UNLOCKED until 🔒 pressed + saved (no `locked` in old YAML;
  regenerated signs are born locked); don't name a strand group
  literally "Ungrouped"; strand gizmo handle-drag writeback is a
  pre-existing unwired path, untouched (strand rigid moves are
  numeric-input driven).
- **LED-B "LED Fixtures" rename + grouping parity `20260724_23`:
  LANDED (absorbs punch (e)+(h))** — section renamed `🔌 LED Lights` →
  `🔌 LED Fixtures` (titanic + test_bench scene_config + new-scene
  template in save-server.js); TE Sign STAYS in `params.parLights`
  (patching/groups/`TE Sign (2)`/A≡B byte-untouched) but UI-homed under
  LED Fixtures → 🪧 Sign Fixtures via `bus: led` classification in
  renderParGUI. LED strands got DMX-style group folders: Select All,
  visibility, Rename (carries view-mask bit), +Strand, Ungroup, ➕Add
  Group, per-strand →Move…; TE Sign full parity incl. group master via
  groupOverrides. DMX Fixtures regression-guarded (14 groups, no TE
  Sign). 442/442 tests; drawer capture `.agent_renders/
  led_fixtures_drawer.png`. Extension points for LED-C documented in
  report §. LED-strand group master OUTPUT effect deliberately deferred
  to LED-C (would've been a fake control — strands direct-paint).
- **LED-A TE sign black background `20260724_22`: LANDED** — root
  cause: TE Sign V3 YAMLs declare `shell: {type: box, color: #0a0a0a}`
  and `dmx_fixture_runtime.js` drew it as an opaque unlit black box
  (shell = physical fixture body, right for pars, wrong for a luminous
  sign; other LED fixtures carry no body). Fix: shell construction
  gated on `!this._isLed` — LED-bus fixtures build NO body mesh; DMX
  untouched; model YAMLs untouched (robust to pixel-order regen);
  A≡B/patch/groups/instancing unchanged. Artifact was 3D-only (2D
  clean). Before/after renders in .agent_renders/ (1784943103/334
  led-grids etc.); 442/442 tests. All render browsers closed.
- **beforeunload removal `20260724_25`: LANDED** — sole active handler
  was `gui_builder.js` ~:480 (unsaved-changes net for :6970 save flow):
  kept the on-unload `sendBeacon` save flush, deleted only
  preventDefault/returnValue. **Safety net gone by operator order** —
  remaining protection: beacon flush + `● UNSAVED CHANGES` chip +
  Recover-scene backups. Live-verified: reload + navigate-away → zero
  dialogs, beacon still fires; 442/442 tests. Surgical one-hunk edit;
  gui_builder.js overlap with LED-B noted (handler block only).
- **Commit snapshot `20260724_21`: COMMITTED on feat/bm_readiness (NOT
  pushed)** — `d631c5c6` product code (78 files, incl. fresh titanic
  model re-export: 1147→1141 px, 74 TE Sign entries present, TE LED
  Grid 80→0, viewmasks groupBit updated; export via readonly puppeteer
  tab + saveModelJS, live show untouched) + `22d57138` Agent OS docs
  (30 files, reports _0.._20 + laws + tracker). Security gate PASS —
  first run FAILED with 24 show-LAN IP findings in today's reports;
  redacted to 10.x.x.NNN per security_privacy.md, re-ran, PASS. No
  bypass. Exclusions left uncommitted: marsin_engine/states/** runtime,
  test_bench model timestamp churn, common.yaml lightingProfile flip,
  test_bench scene_config preview values, CRLF-only files, a
  pre-existing 0-byte junk file. **Operator eye: common.yaml
  lightingProfile 2d_pixels→full + test_bench masterExposure/
  maxSpotlights judged session churn and excluded — still in working
  tree if actually intended.**
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
