# 2026-07-10 — LED groups + section/fixture metadata (Slices S2 + S3)

**Branch:** `feat/led_integration` (worktree `kind-banach-95157b`).
**Plan:** `.agent/plans/20260710_1_led_patching_grouping_look.md` — Requirement C
(LED groups) + Requirement B (LED section/controller/fixture id auto-assignment).
**Scope owned:** `led_metadata.js` (new), `led_metadata.test.js` (new),
`gui_builder.js` (LED group UI), `pixelblaze_model_exporter.js` (group tag +
`resolveSectionId` fix), `pixelblaze_model_exporter_local_index.test.js`
(extended), `main.js` (wire-up). No other agents' files touched. No git ops, no
server run, no device contact.

## What changed

1. **NEW `simulation/src/dmx/led/led_metadata.js`** — pure module (no DOM/IO),
   the LED mirror of `controller_registry.js::projectOntoConfigs` numbering.
   - `groupKeyForStrand(strand)` — the SINGLE source of truth for a strand's
     effective group, shared by the exporter and the metadata pass so section
     ids and view bits can never disagree.
   - `assignLedStrandMetadata(strands, dmxConfigs)` — assigns sectionId (per
     group, sticky) + fixtureId (monotonic), continuing the SHARED id space
     strictly after the DMX max.

2. **`pixelblaze_model_exporter.js`**
   - Imported `groupKeyForStrand`; LED pixel tag `group: strand.name || ''` →
     `group: groupKeyForStrand(strand)` (line ~344 region). Ungrouped strands
     still emit `group === strand.name` → existing scenes stay bit-for-bit.
   - **Fixed the latent `resolveSectionId(light)` ReferenceError** at line 155
     (simple single-light `fixture.light` branch) → `light.sectionId || 0`.
     `resolveSectionId` was defined nowhere; that branch would have thrown.

3. **`gui_builder.js`**
   - New strand default now includes `group: ''`.
   - Added a **Group** text input directly under **Name** in each strand
     folder, with a `<datalist>` of existing distinct group keys
     (`groupKeyForStrand` values). `onchange` trims, sets `strand.group`,
     invalidates the Marsin batch cache (`'led_group'`), and debounce-saves.
     Token-based styling (`--icon`, `--ghost-border`, `--input-bg`, `--text`).
     Imported `groupKeyForStrand`.

4. **`main.js`**
   - Imported `assignLedStrandMetadata` and `gatherAllConfigs`.
   - At the END of `window.projectLedStrandPatches` (after the patch-field loop,
     before `return`), gated on the SAME `registry && registryIsActive(registry)`
     condition DMX uses, it now calls
     `assignLedStrandMetadata(strands, gatherAllConfigs(params))`. Because this
     function is the only caller of the LED pass and runs strictly AFTER
     `projectControllerMappings` at every call site (boot ~line 605; editor
     recompute), the DMX ids are final and LED ids continue above them. Strand
     metadata rides `scene_config.yaml` structurally (documented at the call
     site) — NOT the patch tree — so nothing is mirrored to `__globalPatchTree`.

## DMX-first shared counter — how it is enforced

Not a persisted counter. The floor is `max(sectionId)` / `max(fixtureId)` over
`dmxConfigs ∪ strands`, re-derived each pass (exactly like DMX). DMX-before-LED
is guaranteed **by construction**: (a) `projectOntoConfigs` never sees strands
(`gatherAllConfigs` excludes them — unchanged), so DMX numbering is untouched;
(b) the LED pass is only reachable via `projectLedStrandPatches`, which every
call site runs after `projectControllerMappings`. LED and DMX group→section maps
are disjoint, so a shared group name still yields different ids. On live
test_bench: DMX sections 1–4 unchanged, `LED_0`'s group → **section 5**,
fixtureId → **11** (DMX max fixtureId is 10). DMX behavior is fully preserved.

## Tests (green)

- `node --test tests/led_metadata.test.js` → **11 pass / 0 fail**. Covers:
  groupKey rule + fail-loud throw; DMX 1..4 → LED 5,6; live test_bench shape
  (DMX fixtureIds to 10 → LED fixtureId 11); shared-group single section;
  namespace isolation; gaps respected (floor = max, not count); sticky +
  idempotent re-run; late-added strand reuses sticky group; empty registry
  starts at 1; keyless strand throws.
- `node --test tests/pixelblaze_model_exporter_local_index.test.js` →
  **11 pass / 0 fail** (7 pre-existing + 4 new): group-"bench" tag; two strands
  → one distinct group; ungrouped → `group === name` regression; simple
  single-light DMX fixture exports `sId` with no ReferenceError.
- `node --check` clean on all four modified source files.

Full suite NOT run here (per instructions — coordinator runs the authoritative
`npm test` after all slices land).

## Public API of `led_metadata.js` (for S4 / coordinator)

```js
// Effective group key. Rule: strand.group || strand.name (both trimmed).
// Throws if neither is a non-empty string (codex P0: fail loud, no fallback).
export function groupKeyForStrand(strand): string

// Mutates `strands` in place: assigns sectionId (one per effective group,
// sticky — existing positive ids kept) and fixtureId (monotonic, sticky),
// both continuing strictly above the max id found across dmxConfigs ∪ strands.
// Does NOT assign controllerId (derived at projection/export time).
// dmxConfigs = gatherAllConfigs(params) output (DMX fixture configs).
// Returns { assigned: Array<{name, group, sectionId, fixtureId}>,
//           maxSectionId: number, maxFixtureId: number }
export function assignLedStrandMetadata(strands, dmxConfigs): {assigned, maxSectionId, maxFixtureId}
```

## Operator test needed

- **Sim UI (S5, no device):** open a strand folder, type a group name (e.g.
  `bench`) into the new **Group** field under Name, Save. Confirm `views.yaml`
  gains a `bench` bit and the re-exported `marsin_engine/models/test_bench.js`
  pixels for `LED_0` carry `group: 'bench', sId: 5, fId: 11`. The Group field's
  datalist should suggest existing group names.
- No device push required for this slice; S4 owns the device flow.
