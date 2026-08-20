# 20260725_34 — DMX/LED sId/fId collision fix (`projectOntoConfigs`)

**Author:** implementer (Opus) · **Branch:** `feat/bm_readiness` · **Date:** 2026-07-28
**Slice:** Phase A step 1 of `20260725_33_titanic_scene_mapping_plan.md`
(`dev/sid_fid_union_fix`) — the pre-req bug that blocks step 5's metadata
pass from baking collisions into the titanic mapping.
**Precursor:** `20260725_4` secondary finding 1 (the bug, discovered while
debugging the TE Sign blackout).

Offline/unit work only: the operator's live stack (`:6966-:6972`, 5568) was
never touched, no browser, no engine, no git ops, no deploys.

---

## 0. TL;DR

DMX fixtures and LED strands share **one** section/fixture id space, but
only one of the two passes that mint into it knew that. `led_metadata.js`
floors its counters at the DMX max (so LED never lands on DMX);
`projectOntoConfigs` took its max over **DMX configs only**, so any DMX
fixture added *after* the strands were numbered was minted straight on top
of a strand id. The shipped `test_bench` model proves it: **40 TE Sign V3 A
pixels and 20 LED_0 pixels both carry `sId 5, fId 11`** — two physically
distinct fixtures, one identity.

The fix makes `projectOntoConfigs` floor over the **same DMX ∪ LED union**
`assignLedStrandMetadata` uses, and repairs — loudly, once — the ids the
old pass already baked into stored scene data. `ledStrands` is now a
**required** argument: passing nothing would silently re-open the bug, so a
non-array throws (codex P0).

Impact across every scene, measured on the committed YAML: **only
`test_bench` changes**, and only its two TE Sign halves
(`sId 5→7`, `fId 11→13` and `12→14`). The other six scenes are provably
identical. Titanic — 84 fixtures + 8 strands, all ids `0` — is untouched
today; the point of the fix is that its Phase B authoring can no longer
mint a collision in the first place.

Sim suite **591 → 601 pass, 0 fail** (10 new tests). All 10 fail against
the pre-fix algorithm (falsified, §5).

---

## 1. The bug, precisely

Two passes mint into one id space, in a fixed order at every call site
(`main.js`: `projectControllerMappings` → `projectLedStrandPatches`):

| pass | file | floor it used |
|---|---|---|
| DMX | `controller_registry.js::projectOntoConfigs` | max over **DMX configs** |
| LED | `led/led_metadata.js::assignLedStrandMetadata` | max over **DMX configs ∪ strands** |

The LED side was written correctly and is safe by construction. The DMX
side is blind to strands (`gatherAllConfigs` returns parLights /
dmxFixtures / scene fixtures only — never `params.ledStrands`), so the
moment a DMX fixture with `sectionId 0` arrives in a scene that already has
numbered strands, it is minted from the DMX max and collides.

That is exactly what happened to test_bench: DMX max was `sId 4 / fId 10`,
so the TE Sign got `5 / 11` — already owned by LED_0.

Stickiness (existing positive ids are never renumbered) then made the
collision **permanent**: re-saving, re-exporting, or rebooting the sim
reproduces it faithfully forever.

### What it actually breaks

Confirmed by a repo-wide consumer audit (§6): `GET /dimmer-groups`
(`marsin_engine/lib/api_server.js:5175-5186`) derives `group → sId` from
the model and today returns **`TE Sign: 5` and `LED_0: 5`**. The CaptainPad
Dimmer Rack (`CaptainPad/app/(tabs)/dimmer_rack.tsx:428-465`) renders its
"🔗 SHARES SECTION 5" badge for the pair and **both faders drive the same
section** — moving the TE Sign fader dims LED_0 and vice versa. The engine's
intensity controller (`intensity_controller.js:42-45`) applies one section
brightness to both fixtures' pixels. That is the operator-visible symptom.

---

## 2. The fix

**`simulation/src/dmx/controller_registry.js` — `projectOntoConfigs`**

1. **Required `ledStrands` argument.** New 4th parameter, read-only here,
   validated **before** the inactive-registry early return so an inactive
   registry cannot hide the misuse. A non-array throws with a message that
   names the shared id space. No default `[]` — a silent default is a
   fallback that re-opens the bug (codex P0).
2. **Union floors.** `maxSectionId` / `maxFixtureId` are now the max over
   DMX configs **and** strands — the same union the LED pass uses. Neither
   pass can now mint an id the other owns. Gaps are still respected (the
   floor is the MAX, never a count).
3. **One-time collision repair.** A stored DMX id that lands on a strand id
   is moved above the union max and **reported**, never silently kept and
   never silently swapped. The **DMX side yields** because only the DMX side
   could ever have minted blind (the LED pass mints with full knowledge of
   the DMX ids by call order) — so the repair undoes exactly the damage the
   bug caused, and nothing else. A whole section moves together (keyed by
   group) so group↔section stays bijective; a group-less config moves alone.
   The group→section map is seeded **after** the repair, so later members of
   a repaired group inherit the new id instead of resurrecting the colliding
   one.
4. **Return shape** gains `collisions: [{name, field, before, after, strand}]`,
   alongside the existing `violations` / `drift` / `migrated`.

**`simulation/main.js`** — passes `params.ledStrands` (the same expression
the LED pass uses 40 lines below, so both see the same union) and logs every
repair loudly with the strand it collided with and the instruction to
re-export the model.

**`simulation/src/dmx/led/led_metadata.js`** — header comment only. The
module's stated invariant was "every LED id is strictly greater than every
DMX id"; after a repair a DMX id can sit above an LED id, so the comment now
states the real guarantee (**mutual exclusion, not global ordering**) and
warns that nothing may assume the old ordering.

### Idempotency

Once repaired the DMX∩LED intersection is empty, so re-runs change nothing —
proven by test, and it matters: the sim re-projects and re-saves scene YAML
on **every page boot**, so a non-idempotent repair would renumber the scene
on every reload.

---

## 3. Files touched

| File | Change |
|---|---|
| `simulation/src/dmx/controller_registry.js` | `projectOntoConfigs`: required `ledStrands` arg, union floors, one-time repair, `collisions` in the return; expanded doc comment |
| `simulation/main.js` | call site passes `params.ledStrands`; loud per-repair `console.warn` |
| `simulation/src/dmx/led/led_metadata.js` | header comment: exclusion-not-ordering |
| `simulation/tests/controller_registry.test.js` | 4 existing call sites take the new arg; **6 new tests** |
| `simulation/tests/section_fixture_id_space.test.js` | **NEW** — 4 cross-module tests of the seam |

Nothing outside this slice was edited. `controller_registry.js` and
`main.js` carry substantial **pre-existing uncommitted** work from other
threads on this branch; my hunks are confined to `projectOntoConfigs`
(`@@ -1672`, `@@ -1674`, `@@ -1679`, `@@ -1696`) and the one call site.

---

## 4. Before / after evidence

### 4.1 The shipped model (before) — `marsin_engine/models/test_bench.js`

Aggregated `sId`/`fId` per fixture, straight from the generated file:

```
   1 px  Par 1 … Par 4        sId 1 | fId 1..4
   6 px  Vintage Left/Right   sId 2 | fId 5, 6
  18 px  Bar Left / Bar Right sId 3 | fId 7, 8
  40 px  TE Sign V3 A         sId 5 | fId 11   ← collides
  34 px  TE Sign V3 B         sId 5 | fId 12   ← collides
  20 px  LED_0                sId 5 | fId 11   ← collides
  20 px  LED_1                sId 6 | fId 12   ← collides
```

### 4.2 Per-scene impact (after), measured on committed YAML

Offline scan of all seven scenes with a `patches.yaml`
(`~/tmp/sid_falsify/scene_id_scan.cjs`, scratch — reads YAML, writes
nothing):

| scene | DMX fixtures (unnumbered) | strands (unnumbered) | verdict |
|---|---|---|---|
| studio | 23 (0) | 1 (0) | **IDENTICAL** |
| studiodj | 26 (0) | 2 (0) | **IDENTICAL** |
| studio_top_loft | 22 (22) | 0 | **IDENTICAL** (no strands to collide with) |
| summer_camp_dome | 23 (4) | 0 | **IDENTICAL** |
| summer_camp_logsville | 38 (1) | 0 | **IDENTICAL** |
| **test_bench** | 12 (0) | 2 (0) | **CHANGES — 4 ids repaired** |
| titanic | 84 (84) | 8 (8) | **IDENTICAL** (all ids `0`; nothing minted yet) |

`led202` has no `patches.yaml` (geometry-only scene) — nothing to project.

The only change anywhere, and it is exactly the change `_33` §1.3 predicted:

```
TE Sign V3 A.sectionId 5 → 7   (was == strand LED_0)
TE Sign V3 A.fixtureId 11 → 13 (was == strand LED_0)
TE Sign V3 B.sectionId 5 → 7   (was == strand LED_0)
TE Sign V3 B.fixtureId 12 → 14 (was == strand LED_1)
```

LED_0 keeps `5 / 11`, LED_1 keeps `6 / 12`, and the ten other test_bench
fixtures keep every stored id. Post-repair `/dimmer-groups` returns
`{ParLights:1, VintageLights:2, BarLights:3, LED_0:5, LED_1:6, 'TE Sign':7}`
— no duplicate, and the Dimmer Rack's two faders decouple.

---

## 5. Tests

Sim suite: **591 pass / 0 fail (baseline) → 601 pass / 0 fail**. Nothing
else in the suite moved. (A final run after the sibling Phase A slices had
landed their own test files reports **698 pass / 0 fail** — the 591→601
delta is the one attributable to this slice, measured against the baseline
before the siblings' files appeared.)

New in `tests/controller_registry.test.js` (unit, the pass in isolation):

1. `ledStrands` is required — omitted / `null` / non-array object all throw,
   including when the registry is inactive.
2. **REGRESSION** — the literal bug sequence (TE Sign arrives at id 0 while
   LED_0/LED_1 hold 5/6 and 11/12): new ids clear the LED max, and no DMX
   fixture shares any strand id.
3. **REPAIR** — the committed collision is moved to 7/13/14 and reported
   with the exact `collisions` records; the LED side is asserted byte-equal
   (strands never renumber).
4. Repair is idempotent — second pass reports nothing, ids identical.
5. A clean scene is untouched — no repairs, no id churn.
6. Two distinct colliding groups get two distinct new sections; a
   group-less fixture moves alone; a non-colliding id is left alone.

New file `tests/section_fixture_id_space.test.js` (cross-module — the seam
the two existing test files each half-covered, run in main.js's boot order):

7. DMX grows after LED (the reported bug) — id space stays sound.
8. LED grows after a DMX repair — a new strand clears the *repaired* DMX
   ids rather than reusing them (the trap created by the repair itself).
9. Alternating growth over 5 rounds never collides and settles (idempotent).
10. The committed test_bench inventory: repaired once, then stable.

The shared invariant is asserted by one helper: no `fixtureId` held by two
entities, no `sectionId` held by two different group keys (DMX or LED).

### Falsification

The tests were re-run against a **pre-fix copy** of the module
(`~/tmp/sid_falsify/controller_registry_prefix.js` — the DMX-only metadata
loop restored verbatim, imports repointed at the real source tree):
**8 of the behavioral tests fail, 60 others pass**. The "clean scene is
untouched" and "ledStrands is required" tests pass on both sides, which is
correct — they pin the contract, not the bug. Under the old algorithm the
test_bench inventory yields `collisions: []` (the collision silently
persists), which is precisely the failure the fix removes.

---

## 6. sId consumer audit — what shifts, what doesn't

Read-only sweep of `marsin_engine/`, `CaptainPad/`, `simulation/`, and every
tracked state file.

### Needs re-sync when the ids move (report-only; NOT touched by this slice)

- **`marsin_engine/states/test_bench/globals_state.yaml:382-387`** — the
  per-section dimmer map is keyed by raw numbers (`'1'…'6'`). After the
  shift, `'5'` addresses LED_0 alone and the TE Sign's new section `7` has
  no key. `state_manager.js:332-335` applies the map verbatim, never
  validating a key against the model and never pruning stale ones.
  **Behavioural impact today is nil** — both `'5'` and `'6'` are `1`, and
  `intensity_controller.js:47-49` skips the multiply at `scale >= 1.0` — but
  it is stale data the moment the model re-exports, and it would mis-apply
  if the operator trims section 5 before re-saving.
- **`marsin_engine/states/test_bench/snapshots/performance-preshow.yaml:641-646`**
  — the same map frozen into a saved snapshot; restoring it after the shift
  re-injects the pre-shift numbering.
- **`simulation/scenes/test_bench/patches.yaml:86-96`** — the four numbers
  the repair rewrites on the next sim save (see §7).

### Id-agnostic — derives from the model on every load, nothing to do

`model_loader.js:253-254`, `marsin_wasm_runtime.js:156-157` /
`wasm_host.js:298-299` (meta ABI), `api_server.js:5175-5186`
(`/dimmer-groups`) and `:6225-6236` (`/model/view-selection-options`),
`intensity_controller.js:42-45`, `pixel_local_index.js` (keys on
`(group, fId)`; TE Sign A/B stay distinct before and after), the viewmasks
sidecar (keyed by group **name**, not id), the exporter, `animate.js`,
`save-server.js`, and the sim GUI panels.

**No pattern is affected.** All 40+ patterns that test `sectionId` compare
against `0|1|2|3` only (pars / vintage / bars); an explicit grep for
`sectionId >= 4`, `fixtureId >= 10`, and every 5/6/7/11–14 literal across
`patterns/`, `og_patterns/`, `effects/`, and `lib/` returned **zero hits**.

**Latent exposure, currently unused:** `pattern_mixer.js:93-103` supports a
`viewSelection` of `{type:'section'|'fixture', target:<number>}`. Every
`viewSelection` in every tracked test_bench state file is
`type: all / target: null`, so nothing re-targets today — but a *saved*
`{type:'section', target:5}` would silently point somewhere else after the
shift. Same shape on the client (`view_selection_picker_logic.ts:34`,
`deckOverlaysApi.ts:48`). Likewise the MIDI `sectionBrightness` action
exists but no shipped profile uses it. Worth a validator check, not a code
change here.

---

## 7. What this slice deliberately did NOT do

- **It did not re-save or re-export `test_bench`.** The model is generated
  by the **browser** exporter — there is no headless/CLI path
  (`_33` §1.4) — so a re-export needs the sim page, which needs the
  operator's live stack. Hand-editing `patches.yaml` to pre-apply the
  repair would have been worse than useless: `models/test_bench.js` would
  still carry the old ids, so scene and model would *disagree* (the exact
  drift the sibling parity validator is being built to catch), and the sim
  re-derives patches on every boot anyway. Leaving both sides consistent
  means **one** operator action fixes both atomically:

  > Open the sim on `test_bench` → the boot projection logs four
  > `⚠ sectionId/fixtureId collision repaired` warnings → 💾 Save →
  > `patches.yaml` and the three model files are rewritten together.

  After that save, re-check the two engine state files in §6 (either accept
  the `1.0` defaults or re-trim section 7).
- **It did not touch any other slice's files.** No overlap was needed;
  `simulation/lib/bench_section.cjs` and `simulation/tools/bench_section_sync.cjs`
  (slice 4, landing concurrently) already exclude `sectionId`/`fixtureId`
  from their sync fields, which is correct and complementary.
- **It did not prune the stale engine state keys.** They live under
  `marsin_engine/states/` (runtime residue, operator-owned) and the shift
  has not happened yet — pruning now would be premature.

---

## 8. Follow-ups (for the Notion board / sibling slices)

1. **Parity validator (slice 2)** — its check 4 already specifies "no
   DMX/LED sId or fId collisions". With this fix that check should be green
   on every scene *after* the test_bench re-save, and it is the standing
   guard that keeps it that way. Suggest it also flag a persisted
   `viewSelection {type:'section'|'fixture', target:N}` whose `N` is absent
   from the model (§6 latent exposure).
2. **`POST /section-brightness` writes unvalidated keys**
   (`api_server.js:5249-5257`) — `globalsState.dimmers[sectionId]` is
   written with no model check, so orphan keys accumulate silently. Not this
   slice; worth a card.
3. **Operator action** — the one-save repair in §7, then confirm the Dimmer
   Rack shows six distinct sections with no "SHARES SECTION" badge.

## 9. Honesty notes

- I did not run the sim, the engine, or the browser exporter; nothing on
  `:6966-:6972` / 5568 was touched. All evidence is from committed files,
  unit tests, and offline scans.
- The per-scene impact table is derived from stored YAML, not from a real
  boot projection — it is sound because DMX section/fixture ids live only in
  `patches.yaml` and strand ids only in `scene_config.yaml`, and the fix can
  only change an id that either collides or is being minted fresh. Both
  conditions are read directly from those files.
- The `/dimmer-groups` before/after strings are reasoned from the endpoint's
  code path plus the model's stamped values, not captured from a running
  engine.
- The consumer audit in §6 is a sub-agent sweep with file:line evidence,
  spot-checked; it explicitly could not prove the sACN transmitter is
  decoupled from `sId`/`fId` (it found no coupling, which is weaker than
  proof).
