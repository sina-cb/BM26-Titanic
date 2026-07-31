# 20260725_33 — Titanic scene output mapping + test-bench section: investigation & multi-agent plan

**Author:** investigator/planner (Fable) · **Branch:** `feat/bm_readiness` · **Date:** 2026-07-28
**Operator intent (verbatim):** about to audit every pattern one by one on the
titanic scene, but "no data is shown in the sim from sacn_in" because the
titanic scene is not mapped; and "the test_bench to be a section of the
titanic scene so I can check on real hardware too... for sanity checking."

Read-only investigation: no source edits, no stack touches, no git ops. Two
Explore sub-agents traced (a) the scene→model export pipeline and (b) the
engine load/reload/sACN-output path; their file:line evidence is folded in.
Builds on `20260724_0` (mapping foundation review), `20260724_3` (G10 fix),
`20260724_7` (views design), `20260725_4` (TE-sign patch-state debug).
Per `security_privacy.md`, IPs are redacted here as `10.x.x.NNN`; the real
values live in the functional scene YAML.

---

## 0. TL;DR

The titanic scene is **geometrically complete and 0% electrically mapped**.
`scenes/titanic/controllers.yaml` is `controllers: []`; all 84 patch records
are zeroed; the 8 LED strands carry `sectionId/fixtureId/viewMask = 0` and no
patch records at all. The generated model `marsin_engine/models/titanic.js`
is FRESH (regen 2026-07-25, post-TE-Sign-V3: 981 px = 661 DMX + 320 LED) and
structurally complete — but every pixel is `patch: null`, `cId/sId/fId/vMask
= 0`. The engine builds its universe set **from model patches**
(`engine.js:1313-1333`), so it transmits *nothing* for titanic; the sim's
sACN-in demap paints undriven red / shows no data. That is the operator's
symptom, mechanically.

The fix is **scene data plus a small amount of tooling**, not engine
surgery: author titanic's controllers/universes in the sim's Controllers
panel (auto-patch + sticky group→section metadata already exist), let the
existing browser exporter regenerate the model, and add the missing safety
rails: a scene↔model parity validator (nothing validates this today), a
fail-loud placeholder-IP convention (audit can run before the physical
wiring is known), a bench-section sync mechanism, and a same-scene engine
refresh path (today `POST /scene` with the active scene is a no-op).

**Plan: 9 steps in 3 phases; 4 parallelizable slices in phase A; 2 operator
gates (wiring facts O1–O9 — none block the sim-side audit; placeholders
carry it).**

---

## 1. Findings — what exists / what's missing, per layer

### 1.1 Scene geometry + inventory (EXISTS, healthy)

- `simulation/scenes/titanic/scene_config.yaml` (1,863 lines): 84 parLights
  fixtures with full placement (45 UkingPar, 29 ShehdsBar, 20 VintageLed
  incl. trace-generated groups; `TeSignV3A40` + `TeSignV3B34` as group
  `TE Sign`), 12 trace generators, 8 LED strands × 40 px (`ledStrands:`
  :1742-1854, names `Left_Front_Left` … `Right_Front_Left`).
- `patches.yaml`: 84 records, 1:1 with parLights (the `20260724_0` 70-vs-84
  mismatch is gone) — **all zeroed** (`dmxUniverse: 0, dmxAddress: 0,
  controllerId: 0, sectionId: 0, fixtureId: 0, viewMask: 0`). No LED strand
  records (only written when `dmxUniverse > 0`, `save-server.js:238`).
- `views.yaml`: 23 auto-reconciled `groupBits` (all groups incl. the 8
  strands + `TE Sign`), `custom: []` — no authored named views.

### 1.2 Electrical mapping layer (MISSING — the whole gap)

- `controllers.yaml`: `nextControllerId: 1, nextUniverse: 2,
  controllers: []`. With no registry, `registryIsActive()` is false →
  `projectControllerMappings` early-returns (`simulation/main.js:401`) and
  `assignLedStrandMetadata` never runs (`main.js:500`). Everything
  downstream (patches, sections, fixture ids, cIds, LED segments) is derived
  from this file — it is the single authoring surface.
  `projectOntoConfigs` re-derives patches on every boot; **hand-editing
  patches.yaml is futile** (proven in `20260725_4`, wipe-back at
  `controller_registry.js:1650-1668`).
- Contrast `scenes/test_bench/controllers.yaml`: DMX controller
  (`10.x.x.10`, 4 ports, chains with absolute `at:` addresses, U1/U2) + LED
  controller (`10.x.x.60`, 2 ports → U10/U12, `led:` wire block, `device:`
  binding `titanic_202`). That is the complete target shape.

### 1.3 Metadata (sections / fixture ids / views) — machinery EXISTS, unrun

- `sectionId` is sticky and auto-derived per fixture **group**
  (`controller_registry.js:1757-1780`); LED ids floored above the DMX max
  (`led/led_metadata.js:76-134`, strict ordering `main.js:494-501`). The
  auto-patcher UI button (`.agent/ops/auto_patcher.md`) drives the legacy
  path; the registry path runs automatically once controllers exist.
  Sections power the CaptainPad Dimmer Rack via `/dimmer-groups`.
- `viewMask` is authored in the Views panel (`view_masks_editor.js:548-582`);
  `groupBits` auto-reconcile at export (`pixelblaze_model_exporter.js:547`,
  `view_registry.js:169-191` — never renumbers, throws past 31 bits).
- **KNOWN BUG to fix before titanic-scale authoring**: the
  `projectOntoConfigs` metadata pass computes `maxSectionId/maxFixtureId`
  over DMX configs only, so DMX fixtures added after LED ids exist collide
  with LED ids (`20260725_4` secondary finding: test_bench TE-Sign-A =
  `sId 5, fId 11` ≡ LED_0). At 84 fixtures + 8..N strands this WILL produce
  collisions; the Dimmer Rack and any sId-keyed logic then treat distinct
  fixtures as one.

### 1.4 Export pipeline (EXISTS; browser-only)

- Generator: `simulation/src/dmx/pixelblaze_model_exporter.js`
  (`generatePixelMap()` :12, `saveModelJS()` :463) → 3× POST
  `:6970/save-model?scene=<s>[&type=effects|viewmasks]` →
  `save-server.js:440-480` writes `marsin_engine/models/<scene>{.js,
  .effects.js,.viewmasks.js}` atomically. **No headless/CLI path exists**;
  triggers are the 💾 Save button (`gui_builder.js:5029`), debounced
  autosave, and **every sim page boot** (`main.js:718`).
- A DMX pixel gets a `patch` only when `universe > 0 && addr > 0`
  (exporter `:79`); LED strands additionally get a loud `unpatched: true`
  marker (`:414`). Titanic today: 981/981 `patch: null`, 320 `unpatched`.
- The model IS current with the scene (regen 2026-07-25; `20260724_0`'s
  "stale Jul-8 model" and the 28-strand/1,120-px inventory are both
  superseded — the scene now has 8 strands).

### 1.5 Engine runtime (EXISTS; two sharp edges)

- Universe send set = model patches (`engine.js:1306-1334`); destinations =
  `marsin_engine/config.yaml` (`destinations: [127.0.0.1]` flat +
  `controllers:` — currently only `Titanic-202`, host `10.x.x.202`,
  U10/U12, `alsoFlat: true`). Engine is always unicast
  (`sacn_output.js:44-56`). Hardware for OTHER controllers is reached by
  the **sim bridge relay**: `sacn_bridge.js:161-187` reads
  `patches.yaml` (`dmxUniverse` + `controllerIp`) and unicasts per route,
  minus engine-owned pairs (`/status outputRouting`).
- Hot reload (`fs.watch`, `engine.js:1584-1726`): same-model file overwrite
  reloads in place, registers **new universes on the fly** (G10 fixed
  2026-07-24, `output_dispatch.js:244-259` create-sender-on-demand) —
  **but REFUSES any pixelCount change** (`:1619-1631`, sets
  `modelSync.stale`, surfaced on `GET /status.modelStale`). The now.md:57
  "restart after universe change" note is stale; the true restart trigger
  is pixel-count change.
- Scene switch: `POST /scene` (`api_server.js:4897-4960`) → graceful
  shutdown → **exit 75** → launcher restarts with the new `--model`
  (`launcher.js:1105-1129`; supervised via `BM26_SUPERVISED=1` + handoff
  file). **Same-scene POST is a `{restarting:false}` no-op** — there is no
  endpoint that restarts the active model, and no `/restart` or `/reload`.
  `/scene` is blocked in performance mode.

### 1.6 Sim sACN-in (EXISTS; why the audit sees nothing)

- The in-bridge (`:6971`) subscribes the union of every scene's patched
  universes + baseline {1,2} **at boot** (`sacn_bridge.js:45-74`); packets
  on unsubscribed universes are DROPPED with one warn (`:438-443`). The
  browser demap needs `entry.patch` + `entry.channels`
  (`sacn_mapper.js:67-130`); entries without a patch paint **bright red**
  (undriven marker) — exactly what titanic shows today.
- So the audit needs: patched universes in `scenes/titanic/patches.yaml`
  (feeds both the demap and the bridge subscription), the engine on the
  titanic model actually emitting (requires model patches), and a bridge
  restart after the first mapping save (boot-time subscription set).
- Controller IPs are **only** needed for the hardware relay — the sim-side
  audit works end-to-end with placeholder IPs.

### 1.7 Validation (MISSING — confirmed gap)

Nothing validates `scenes/<scene>/*.yaml` against
`marsin_engine/models/<scene>.js`. The engine validates only
groupBits↔model-groups internally (`engine.js:417-423`) and bit hygiene;
the exporter aborts saves on internal inconsistency; unit tests pin the
serialization. There is no duplicate-address check across fixtures, no
patches↔model field check, no freshness/drift gate, no CI guard. This is
the acceptance-gate hole the plan's validator fills.

---

## 2. OPERATOR-INPUT facts (each with a placeholder strategy)

Work proceeds without any of these; placeholders are **loud by
construction** (see §3.1 convention). None block the sim-side pattern
audit; O1/O2 block only *hardware* light-up of the titanic rig itself.

| # | Fact only the operator knows | Placeholder until answered |
|---|---|---|
| O1 | Physical controller inventory for the ship: how many DMX gateways + MarsinLED units, their IPs | One DMX controller per major fixture family + LED controllers per strand cluster, `ip: 0.0.0.0` sentinel (relay refuses loudly; sim audit unaffected) |
| O2 | Output→fixture wiring (which port/output drives which par group / strand / rope) | 1 group per port, chains in scene order; sequential outputs for strands |
| O3 | Universe budget/plan | Proposal: reserve U1/U2 (bench DMX) + U10/U12 (bench LED); titanic DMX packs from U3, titanic LED from U16. Operator approves or re-deals |
| O4 | Smokestack rope LED counts (R4a: strand count, px/rope, controller) | Keep the current 8×40 strands; flagged `PLACEHOLDER` in the mapping notes; validator lists them in non-strict mode |
| O5 | TE sign wiring (still being assembled; footprint known: A=120ch + B=102ch = 222ch, fits one universe) | Patch to a placeholder DMX controller (own universe) so it animates in the audit; mirrors the `20260725_4` fix plan for test_bench |
| O6 | Art-Net vs sACN per controller (Art-Net ready but unconfigured for titanic) | sACN everywhere |
| O7 | Identity of the `.202` engine-declared `Titanic-202` vs the bench LED unit at `.60` (both claim U10/U12; docs/41 shows a `.201/.202/.203` swarm) — which units go on the ship, and does the `Titanic-202` block stay in engine `config.yaml`? | Leave engine `config.yaml` untouched; bench relay reaches `.60` via the bridge (engine-owned suppression is per (universe,host), so `.60` still relays) |
| O8 | 20-vs-40 px per bench strand (already open in the master doc) | Keep scene as-is; validator pins whatever the scene says |
| O9 | Is the bench physically connected during titanic audits (else its section is placeholder too)? | Assume yes — that is the stated purpose |

**Fail-loud placeholder rules (hard requirements for the implementers):**
placeholder = `ip: 0.0.0.0` on the controller + a `PLACEHOLDER` marker in
the controller name. The bridge/relay must REFUSE to build a route for the
sentinel with one named warning (verify current `bridge_routing.cjs`
behavior; add the refusal if absent — never a silent skip, never an
attempted send). The validator's `--strict` mode (deploy/hardware gate)
FAILS while any placeholder remains; default mode lists them loudly and
passes for sim-audit purposes.

---

## 3. test_bench as a SECTION of the titanic scene — design decision

**Requirement:** while the engine runs the titanic model, the real bench
(DMX `10.x.x.10` + LED `10.x.x.60`) must be addressable as its own
section/view so looks can be sanity-checked on real fixtures.

Options considered:

- **(A) Scene-level import/include.** No such mechanism exists (only
  whole-scene duplicate, `scene_duplicate.cjs`); the save-server re-extracts
  all four YAMLs from the live tree (`save-server.js:204-321`), so
  read-only imported blocks would need carve-outs across registry,
  projection, `__globalPatchTree`, exporter, and save — the four-way data
  flow `20260724_0` §1.1 documents. High risk, touches the most
  incident-prone subsystem in the repo. REJECTED for this pass.
- **(B) Derived copy + parity gate (RECOMMENDED).** A deterministic sync
  tool (`YAML → YAML`, offline, no browser) projects the test_bench scene's
  controllers + fixtures into a `Test Bench` block inside the titanic scene
  (groups prefixed `TB ` so sections/views stay distinct; fixtures placed
  at a "dock" location beside the ship; bench universes carried verbatim:
  U1/U2/U10/U12). The **test_bench scene stays the single source of
  truth**; the §4 validator cross-checks the titanic bench block against it
  on the invariant fields (IP, universe, address, chain order, px counts,
  wire block) and **FAILS on any divergence** — a hand-edited copy cannot
  survive a gate. One mechanism, loud on drift (codex P0 satisfied by
  gate, not by hope).
- **(C) Engine-side multi-model.** The engine loads exactly one model;
  WASM buffers are boot-sized. REJECTED (architecture change).

Trade-offs of (B): titanic pixelCount grows ~166 → ~1,147 (any bench-block
change is a pixel-count change ⇒ needs the §5 restart path, not hot
reload); the bench fixtures render in the titanic 3D scene (arguably a
feature — the operator sees the bench section animate in-sim); universe
reservations must hold (validator enforces). Engine `config.yaml` keeps
`Titanic-202` U10/U12 → those frames also unicast to `.202` (absent on the
bench LAN = throttled send errors, already handled by `_17`'s throttle;
O7 resolves it properly).

Sync-direction note: the sim boot re-projects and re-saves scene YAML, so
the sync tool must be **idempotent** (running it twice = byte-identical
block) and the validator must compare *invariant* fields only (not
volatile ones like `device.lastPush`).

---

## 4. Scene→engine parity validator (the acceptance gate)

New headless Node tool, e.g. `simulation/tools/scene_model_parity.cjs`
(loads model JS in a VM exactly like `marsin_engine/lib/model_loader.js`;
reads the four scene YAMLs directly). Checks, all fail-loud with named
findings:

1. **Coverage:** every parLights fixture and every ledStrand appears in the
   model with the right pixel count and contiguous `localIndex`; model has
   no pixels absent from the scene; `pixelCount` export matches.
2. **Patch truth:** per fixture, `patches.yaml` (universe/address) ==
   model `patch` (+footprint from the fixture def); per strand, the
   9-field record (`pixelCount/outputIndex/segments/end*`) == the model's
   per-pixel walk (re-run `projectLedStrandPixels` logic).
3. **Address hygiene:** no channel overlap across fixtures within a
   universe; addresses in 1..512; footprints don't straddle illegally;
   universe > 0 wherever patched; every patched fixture's controller
   exists; every chain entry references an existing fixture.
4. **Metadata:** patched pixels have nonzero `cId/sId/fId`; sId↔group
   mapping is bijective; **no DMX/LED sId or fId collisions** (regression
   guard for §1.3); `cId` = controller panel ordinal.
5. **Views:** groupBits ↔ model groups bidirectional (pre-flight mirror of
   `engine.js:417-423`); custom views reference existing groups; bits
   power-of-two, unique, ≤31.
6. **Bench-section parity (titanic only):** the `TB ` block ==
   test_bench scene on invariant fields (§3B).
7. **Placeholder policy:** default mode lists `0.0.0.0` controllers and
   `unpatched:true` pixels; `--strict` fails on any of either.
8. **Drift:** the committed model must match the committed scene
   field-by-field (this IS the freshness check — no timestamps needed).

Wire-up: `simulation/package.json` test glob (pure Node, fast), named in
`.agent/ops/sim_auto_checks.md` + `marsin_engine_auto_checks.md` as a
required pre-commit check for scene/model changes, and step 1 of the §5
refresh runbook. This validator is the DONE-gate for plan steps 5–7.

## 5. Safe model refresh into the RUNNING engine

Target: operator (or curator, per `.agent/roles/curator.md` engine rights)
regenerates titanic and the running engine picks it up — no port frees, no
stack teardown.

1. **Regenerate:** mapping edits in the sim Controllers/Views panels →
   💾 Save (or page boot) rewrites the three model files via `:6970`.
   (No headless regen exists; the sim page is the generator.)
2. **Gate:** run the §4 validator. Red = stop, nothing touched the engine
   yet (models on disk are already watched, so in practice: validate
   BEFORE saving when the change is scripted, and treat a red validator
   after a save as "fix scene, save again").
3. **Same pixelCount:** the engine's `fs.watch` hot-reloads automatically
   (rebuilds masks/sections/views, add/drops universes live). Verify:
   `GET /status` → `modelStale:false`, `/model/view-selection-options`
   fresh.
4. **pixelCount changed** (e.g. bench block added): engine sets
   `modelSync.stale` and keeps running the old model. Apply = supervised
   restart via the exit-75 path. **Gap:** `POST /scene` same-scene is a
   no-op — plan step 3 adds a minimal `{"scene":"titanic","force":true}`
   (or `POST /scene/reload`) that calls the existing
   `requestSceneSwitch(activeScene)` machinery unchanged. Until it lands,
   the workaround is a scene-bounce (POST test_bench, poll, POST titanic)
   — two restarts, ugly but supervised. Both blocked in performance mode
   (correct); caller polls `GET /status` until `activeModel` flips
   (launcher waits up to 120 s).
5. **Bridge note:** after the FIRST titanic mapping save, restart the sim
   stack once — the in-bridge's universe subscription set is boot-time
   (`sacn_bridge.js:45-74, :420`); new titanic universes are otherwise
   dropped at `:438-443`. (Operator-coordinated; it is his live stack.)

Curator fit: steps 3–4 are REST-only against `:6968` and within the
curator's granted rights (drive + restart the ONE engine; never a second
engine, never port frees). The runbook lands in `.agent/ops/`.

---

## 6. The numbered plan (multi-agent ready)

Per `multi_agent.md`: instigator + `dev/<slug>` worktree slices; NO second
running stack (bm26-port-topology memory — headless work only in slices;
anything needing the live sim/browser is operator-coordinated). Subsystem
auto-checks before any merge-ready claim.

**Phase A — parallel, no operator input (4 independent slices):**

1. **`dev/sid_fid_union_fix`** — fix the DMX/LED metadata collision
   (`projectOntoConfigs` max over the same union `assignLedStrandMetadata`
   uses) + tests; re-save/re-export test_bench (and studio scenes if
   touched); audit sId consumers (Dimmer Rack tracks, saved per-section
   state) for id shifts and report them. *Blocks step 5's metadata pass
   from baking collisions in.*
2. **`dev/scene_model_parity_validator`** — build §4 validator + tests +
   ops-spec wiring. Prove it red on today's titanic (unpatched), green on
   test_bench, red on a mutated copy (each check falsified once).
3. **`dev/engine_same_scene_reload`** — §5 step-4 force-reload endpoint on
   the existing `requestSceneSwitch` path + tests (incl. performance-mode
   refusal, unsupervised standalone behavior) + the `.agent/ops/` refresh
   runbook (curator-usable). Also correct the stale now.md:57 note.
4. **`dev/bench_section_sync`** — §3B sync tool (idempotent, offline) +
   the `0.0.0.0` placeholder refusal in the bridge routing (verify current
   behavior first; one named warning, no send) + tests. Produces the
   `TB `-prefixed block but does NOT apply it to the titanic scene yet.

**Phase B — the mapping itself (serial core, operator-gated inputs
O1–O9 land here; placeholders otherwise):**

5. **Titanic mapping authoring** — with the operator or on his machine
   (live sim UI is the only authoring surface): add DMX + LED controllers
   per O1/O2/O3 (placeholders where unanswered), chain all 84 fixtures +
   8 strands + TE sign (O5), run the metadata pass, author the first named
   views (audit families: per-side, strands, sign, bench), 💾 Save →
   model regen → **validator green (non-strict)** → restart sim stack once
   (§5.5). Deliverable: sacn_in shows live data for every titanic group.
6. **Bench section integration** — apply step-4's sync block to the
   titanic scene, re-save/regen, **validator green incl. parity + universe
   reservations**; apply to the running engine via step-3's reload
   (pixelCount changes). Deliverable: `TB ` view selectable; bench
   hardware animates while the engine runs titanic.

**Phase C — proof + closure (serial):**

7. **E2E verification** — `.agent/skills/full_stack_smoke.md` on the
   titanic model: sACN IN monitor Connected + titanic universes active,
   two frames proving animation, CaptainPad Dimmer Rack showing the real
   sections (incl. `TB `), bench hardware sanity check on a known look.
   Screenshots, visually inspected.
8. **Placeholder retirement loop** — as O1/O2/O4/O5/O7 answers arrive,
   replace sentinels in the Controllers panel, re-save, validator
   `--strict` green = hardware-ready gate for the rig deploy.
9. **Docs + tracking** — ops runbook finalized, master doc row + log,
   Notion follow-up cards (validator in CI, Art-Net decision O6, engine
   `config.yaml` Titanic-202 fate O7).

Dependencies: 1→5 (metadata), 2→5/6 (gate), 3→6 (apply), 4→6 (block);
5→6→7; 8 loops after 7. Steps 1–4 fan out today; step 5 is the first
operator-present session (it is his authoring UI and his live stack).

---

## 7. Honesty notes

- I did not run the sim, engine, or any probe — file-level investigation
  only; the operator's live stack was untouched.
- `bridge_routing.cjs` / registry behavior on `ip: 0.0.0.0` is UNVERIFIED
  (the `20260724_0` audit says bad IPs become projection violations, not
  throws) — step 4 must probe before relying on the sentinel.
- Whether the in-bridge `Receiver` can add universes post-boot was not
  proven; §5.5 assumes not (boot-time set at `sacn_bridge.js:420`). If it
  can, the one-time stack restart drops out.
- Pixel accounting: 981 = 661 DMX + 320 LED per the export trace; the
  older reports' 1,120/1,147/1,790 counts describe superseded scene
  states (28 strands, pre-TE-Sign-V3).
- The sub-agent traces cite exact lines on `feat/bm_readiness` @ e805ef01
  + uncommitted tree; line numbers drift with the ~150-file dirty tree.
