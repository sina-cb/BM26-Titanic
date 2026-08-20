# 20260725_35 — Scene ↔ engine-model parity validator (Phase A slice 2)

**Author:** developer (Opus) · **Branch:** `feat/bm_readiness` · **Date:** 2026-07-28
**Slice:** step 2 of `20260725_33` §6 Phase A — the acceptance gate for the whole
Titanic mapping campaign, per `_33` §4.
**Scope discipline:** new code only. The exporters, the registry, the engine and
the scene YAMLs were **not touched** — three sibling agents held the other Phase A
slices in the same working tree.

---

## 0. TL;DR

There is now a gate. `simulation/tools/scene_model_parity.cjs` answers, offline
and in about a second:

> Does `marsin_engine/models/<scene>.js` (+ sidecars) say EXACTLY what
> `simulation/scenes/<scene>/*.yaml` says — and is what they say electrically
> sendable?

```powershell
cd simulation
node tools/scene_model_parity.cjs test_bench
node tools/scene_model_parity.cjs titanic --strict
```

Verdicts on the tree as committed:

| Scene | Default | `--strict` | Story |
|---|---|---|---|
| `test_bench` | **FAIL** — 8 errors, 0 warn, 1 info | FAIL — 8 errors | 2 unmapped TE Sign fixtures + the 4 sId/fId collision findings. Both are **already-documented open defects**, not validator noise. |
| `titanic` | **FAIL** — 92 errors, 0 warn, 9 info | FAIL — 100 errors | 84 unmapped fixtures + 8 unmapped strands. Nothing else. |

The important half of both verdicts is what is **clean**: on BOTH scenes the
coverage, patch-truth, views and drift families report **zero** errors. The
titanic model is a current, complete, faithful export of its scene (981 px
predicted from the scene's fixture definitions, 981 px found, every name,
group, channel map, `localIndex`, group-bit and sidecar entry agreeing). That
independently confirms `_33` §1.4 — **the titanic gap is purely electrical**,
and it means Phase B authoring starts from a sound base.

52 new tests; sim suite green.

---

## 1. What was built

| File | Role |
|---|---|
| `simulation/lib/scene_model_parity.cjs` | The pure check engine. No fs, no network, no DOM, no `process`. Takes parsed artifacts, returns `{ findings, stats, ok }`. |
| `simulation/tools/scene_model_parity.cjs` | The CLI. Does all I/O, prints a located report or `--json`, sets the exit code. |
| `simulation/tests/scene_model_parity.test.js` | 52 tests — one mutation per check family, plus real-scene shape assertions. |
| `.agent/ops/sim_auto_checks.md` | New **"Scene ↔ Model Parity Gate"** section + a "What Counts As Done" bullet. |
| `.agent/ops/marsin_engine_auto_checks.md` | New **"Model Files Are Generated — Run The Parity Gate"** section + a done-bullet, since `models/*` is the engine's half of the contract. |

Exit codes: `0` pass · `1` parity errors · `2` the validator could not run
(missing scene, missing model, unparseable YAML) — never a silent skip.

The process touches nothing at runtime: no ports, no engine, no browser. It was
run repeatedly during development against the operator's live stack without
disturbing it.

### 1.1 Two design decisions worth defending

**(a) The gate imports NOTHING from `simulation/src/`.**
The plan suggested loading the model "in a VM exactly like `model_loader.js`"
and re-running `projectLedStrandPixels`. I deliberately did not reuse the
authoring code. An acceptance gate that re-runs the code it audits cannot catch
a bug in that code — it will agree with the exporter about a wrong answer. So
every rule is **re-stated independently** from the artifacts, with a comment
citing its source module. The contract mirrors
`pixelblaze_model_exporter.js`, `controller_registry.js`,
`led_patch_projection.js` and `led_metadata.js`; each re-stated rule names the
one it mirrors.

This paid for itself immediately: `controller_registry.js` and `main.js` were
being rewritten by the sibling sId/fId slice **while this slice ran** (file
mtimes seconds apart, `projectOntoConfigs` mid-signature-change). An importing
validator would have been red for reasons that had nothing to do with any
scene. The cost is real and named: if the exporter's contract ever changes,
this file must change with it — and the alarm will be the validator failing on
a scene known to be good.

**(b) The fixture definitions make the check exact, not approximate.**
`simulation/dmx/fixtures/*/model_*.yaml` carry `channel_mode` (the DMX
footprint) and the pixel roster. Loading them headlessly lets the validator
**predict the exported pixel map exactly** — count, order, per-pixel name
(`<fixture> - <pixelId>`), group and standardized channel map — rather than
merely sanity-checking what it finds. That is what turns "the model looks
plausible" into "the model is byte-faithful to the scene". It is also what
makes the titanic verdict trustworthy: 41 UkingPar×1 + 25 ShehdsBar×18 +
16 VintageLed×6 + TeSignV3A40×40 + TeSignV3B34×34 = 661 DMX, + 8 strands × 40
= 981, matching the model exactly.

---

## 2. The checks

All eight families from `_33` §4 are implemented. Every finding carries
`{ check, code, severity, where, message }` — the `where` locates it (fixture
name, model pixel index, `controllers.yaml` controller # and port), and the
message states expected vs actual **and what to do about it**.

1. **Coverage** — the expected pixel roster (from scene + fixture definitions),
   element-by-element against the model: name, group, type, fixtureType,
   `localIndex`, channel map. On a size mismatch it switches to a per-fixture
   set diff (`pixel_missing_from_model` / `pixel_absent_from_scene`) instead of
   emitting hundreds of cascading positional errors. Also: unknown
   `fixtureType`, duplicate scene names, strands with no stable group key.
2. **Patch truth** — per DMX fixture, `patches.yaml` (universe/address) ==
   model `patch` with the footprint from the fixture definition. Per strand,
   the recorded 9 fields vs the model's per-pixel walk: the no-straddle
   contiguous layout (a pixel that would cross ch 512 rolls to ch 1 of the next
   universe, tail bytes unused), the recorded `endUniverse`/`endChannel`, the
   `segments` partition, the stride/channel-order/`whiteMode`/`ledWire` implied
   by the owning controller.
3. **Address hygiene** — 1..512 with the footprint fitting; universes in
   1..63999; every patched fixture's controller exists; malformed/duplicate
   controller IPs; every chain entry resolving to a real fixture or strand;
   DMX-vs-LED chain kind; a fixture in two chains; and the occupancy sweep.
   **Unmapped fixtures and strands are errors** — an unmapped fixture emits no
   sACN at all, which IS the operator's "no data from sacn_in" symptom.
4. **Metadata** — patched pixels carry nonzero `cId/sId/fId`; group↔section
   bijective; **no DMX/LED `sId` or `fId` collision** (the `_4`/`_34`
   regression guard); a `fId` identifies exactly one fixture.
5. **Views** — `views.yaml` `groupBits` ↔ model groups both ways (a pre-flight
   mirror of the check that makes the engine REFUSE to load); bits
   power-of-two, unique, ≤ `0x40000000`; custom views referencing real groups;
   and the `.viewmasks.js` sidecar agreeing with `views.yaml` field-by-field.
6. **Bench parity** — if the scene carries a `TB `-prefixed block, it is
   compared against the `test_bench` source scene on invariant fields (IP,
   type, protocol, port universes, chain order + `at:` addresses, the `led:`
   block, strand lengths), so sibling slice 4's derived copy cannot drift.
   Absent a block it reports `no_bench_block` as info. A `TB ` block with no
   source scene supplied is an error — an unprovable copy is not a passing one.
7. **Placeholder policy** — the `0.0.0.0` sentinel is info by default and
   **error under `--strict`**. Two convention checks fire in BOTH modes: a
   sentinel IP whose controller name lacks the `PLACEHOLDER` marker, and — the
   dangerous one — a `PLACEHOLDER`-marked controller carrying a REAL IP, which
   would actually transmit.
8. **Drift** — the freshness check, no timestamps needed: exported `pixelCount`
   vs the array; `patches.yaml` key set vs the scene; model `cId/sId/fId/vMask`
   vs the YAML they were generated from; the effects sidecar vs
   `patches.yaml`; and `patches.yaml` vs what the `controllers.yaml` chains
   imply (re-derived independently, including the `global_effects` pin rule) —
   which catches a hand-edited `patches.yaml`, the exact thing `_4` proved is
   futile but that nothing previously detected.

### 2.1 One judgement call, flagged

An overlap between two fixtures on the **same** controller is always an error.
The same universe on **different** controllers is legal by an explicit operator
decision (independent unicast targets) — but the engine renders ONE buffer per
universe, so both fixtures then receive identical bytes. That is mirroring, and
it may be intentional; at titanic scale it is more likely an addressing
mistake. So it is a **warning by default, an error under `--strict`**
(`shared_universe_overlap`). If the operator wants mirroring on the ship, this
is the finding to argue with.

---

## 3. Verdicts, in full

### 3.1 `test_bench` — FAIL, 8 errors, all previously documented

```
address_hygiene/unmapped_fixture      TE Sign V3 A, TE Sign V3 B
metadata/fixture_id_collision         fId 11 (TE Sign V3 A ≡ LED_0)
metadata/fixture_id_collision         fId 12 (TE Sign V3 B ≡ LED_1)
metadata/fixture_id_dmx_led_collision fId 11, fId 12
metadata/section_id_dmx_led_collision sId 5
metadata/section_id_spans_groups      sId 5 shared by [TE Sign, LED_0]
```

Both defects are known and owned:

- The **unmapped TE Sign** pair is `_33` §2 O5 — the sign is still being
  assembled, so it has never been patched. Real, and correctly fatal: those 74
  pixels cannot animate in an audit.
- The **collisions** are `_4` finding 1, fixed at source by sibling slice 1
  (`_34`) — but that fix reaches the artifacts only when the operator does one
  sim-save on test_bench, because the model generator is the browser exporter.
  **This validator is what will prove the repair landed**: after that save, all
  four collision findings must disappear. Until then they stand, correctly.

Everything else on test_bench is clean: 166/166 pixels, every DMX patch, the
two LED strands' full walks and segment records, all six group bits, both
sidecars, the effects sidecar's two foggers.

### 3.2 `titanic` — FAIL, 92 errors, and that is the entire story

```
84 × address_hygiene/unmapped_fixture   (every parLights fixture)
 8 × address_hygiene/unmapped_strand    (every ledStrand)
 8 × placeholder/unpatched_marker       (info; error under --strict)
 1 × bench_parity/no_bench_block        (info — Phase B step 6 not applied)
```

`--strict` promotes the eight unpatched strands: 100 errors.

No coverage error. No patch-truth error. No drift error. No views error — all
23 model groups have bits, and `views.yaml`, the model and the `.viewmasks.js`
sidecar agree exactly. The titanic model is FRESH and STRUCTURALLY COMPLETE;
`controllers: []` is the whole gap, exactly as `_33` §0 said. When Phase B
authoring begins, this validator will count down from 92 to 0.

---

## 4. Tests

`simulation/tests/scene_model_parity.test.js`, 52 tests, in the default
`npm run check` glob.

- A hand-built synthetic scene (2 pars on U2 @1/@5 + a 3-px RGBW strand on U10)
  that is parity-clean, asserted clean in **both** modes — every mutation test
  depends on that baseline being spotless.
- **One mutation per check family, asserting the specific code** — the plan's
  "each check falsified once". A gate nobody has watched go red is a gate
  nobody can trust. Includes a positive case for the awkward one: a strand
  starting at ch 509 that must wrap whole-pixel into the next universe passes.
- Real-scene tests assert the **shape** of each verdict — which families must
  be spotless, and that every remaining error is on a known-open list — never
  an exact defect count. The mapping campaign will fix these scenes one at a
  time; the suite has to survive that while still failing if a model ever
  drifts from its scene.

Sim suite: **698 tests / 698 pass / 0 fail** (baseline was 591; this slice adds
52, the sibling slices the rest).

---

## 5. Honesty notes

- The two real bugs I shipped and caught by running the thing: `fId` collisions
  were first keyed on model pixel NAME (so every multi-pixel bar reported
  itself as an 18-way collision), and bare-string chain entries were flagged as
  legacy-packed on LED ports, where they are the normal shape. Both fixed; both
  are now covered by tests. Worth recording because both were false POSITIVES —
  the failure mode a gate must not have.
- `checkBenchParity` has been exercised only against synthetic fixtures. Sibling
  slice 4's real `TB ` block does not exist yet, so the field list is my reading
  of `_33` §3B, not something proven against a real derived block. First
  contact with that block may need one adjustment.
- The `indeterminate_export_shape` warning is a deliberate refusal to guess: a
  fixture definition with zero pixels that is not a global effect exports via
  the runtime-dependent simple-fixture branch, which cannot be predicted
  offline. No scene currently hits it. It warns rather than inventing an
  expectation (codex P0 — no fallback).
- I did not run the sim, the engine, or any browser; no ports were bound. The
  validator reads committed files only.
- Older scenes (`studio*`, `summer_camp_*`) were NOT audited. They have models
  from early July and would likely fail loudly on drift. That is probably
  correct and probably useful — but it is out of this slice's scope, and I did
  not want to file 6 scenes' worth of findings I have no mandate to fix.
- The plan named the tool `.cjs` and I kept that; the pure engine is `.cjs` too,
  matching `lib/bridge_routing.cjs`. The model files are ESM, so the CLI loads
  them with dynamic `import()`.

---

## 6. Follow-ups (for the Notion board)

1. **Wire the validator into CI** — it is fast and dependency-light (`js-yaml`
   only). A scene/model diff that does not pass should not merge. (`_33` §9
   already lists this.)
2. **Audit the legacy scenes** (`studio`, `studiodj`, `studio_top_loft`,
   `summer_camp_dome`, `summer_camp_logsville`, `led202`) with the validator and
   decide per scene: re-export, or retire to `archived/`.
3. **Re-run on test_bench after the operator's first sim-save**, to confirm
   slice 1's sId/fId repair reached `patches.yaml` and the three model files —
   the four collision findings must go to zero.
4. **Decide the `shared_universe_overlap` policy** (§2.1) with the operator
   before titanic authoring, so the gate matches the intended rig.
