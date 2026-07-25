# 20260724_26 — LED generator workflow design (mirror the DMX generator model)

**Author:** Fable design agent (architect, DESIGN ONLY — nothing implemented).
**Branch:** `feat/bm_readiness` · **Date:** 2026-07-24
**Inputs:** operator brief (below), reports `20260724_14_led_grouping_tesign_generator.md`,
`20260724_23_led_fixtures_grouping.md`, `20260724_24_led_group_lock_generator.md`,
code study of `gui_builder.js` (Group Generator / Light Instances / LED section),
`te_sign_generator.js`, `group_lock.js`, `config.js`, `scenes/titanic/scene_config.yaml`.

## Operator brief (verbatim intent)

> "use the same idea as generators for the LED fixture as the DMX generator.
> The only generator we will have is a TE sign, which adds the 2 halves as it
> is now, and they will go to LED Fixture Instances."

## 1. The DMX generator mental model (what we are mirroring)

The `🔌 DMX Fixtures` section (`buildParLightsSection`) has two sibling homes:

| Home | Role |
|---|---|
| **`Light Instances`** (`parListFolder`) | The instances list — group folders over `params.parLights`, each with group master (⏻ On / Brightness %), 🔒 Lock, Select All, rename, per-fixture cards. |
| **`📐 Group Generator`** (`genFolder`) | The generator area — trace cards (`params.traces`), each with geometry params + **✓ Generate / ↻ Regenerate / ✕ Delete / 🔒**. Generating writes fixtures into `params.parLights` (stamped `traceGenerated`, `group = trace.groupName`) — i.e. **generators are a separate area whose OUTPUT lands in the instances list** and from then on behaves like any other group. |

The mental model the operator wants copied is exactly that split: *generators
live in their own area; what they produce lands in the instances list and is a
normal group thereafter.*

Today's TE Sign deviates from that model in one way only: its `✨ + TE Sign
(A+B)` button sits on the **DMX** `Light Instances` toolbar
(`gui_builder.js` ~L1340–1377), not in any generator area, and its output —
the two halves — is re-homed into the LED section by the `isLedClassConfig`
routing (report _23). Everything else (pair built by `buildTeSign()`, born
locked, `groupOverrides['TE Sign'].locked = true`, A≡B enforced by
`applyTeSignPlacement` + `isTeSignConfigs` in gizmo and numeric paths) is
already right and is **kept byte-for-byte**.

## 2. The design

### 2.1 Target drawer structure (sits on the flattened LED section)

```
🔌 DMX Fixtures
   Light Instances            ← TE Sign button REMOVED from this toolbar; otherwise unchanged
   📐 Group Generator          ← traces, unchanged
🔌 LED Fixtures
   Master Enabled / Show Guides / Pixel Size / Halo Size   ← unchanged
   ✨ Generators                ← NEW generator area (mirror of 📐 Group Generator)
       [✨ + TE Sign (A+B)]     ← the ONLY generator for now (catalog-driven)
   LED Fixture Instances       ← THE flat instances list (mirror of Light Instances)
       TE Sign (2)             ← parLights-homed LED-class group folders (generated OR hand-authored)
       <named strand groups>   ← strand group folders (hand-authored)
       Ungrouped (n)           ← display bucket for group-less strands (absent when none)
```

The flattening slice (in flight, other agent) removes the `🪧 Sign Fixtures` /
`💡 LED Strands` subsections. This design **names the resulting flat list
"LED Fixture Instances"** and makes it the single landing zone.

### 2.2 What "LED Fixture Instances" IS (exact definition)

**A view, not a data store.** No fixture data moves. It is one lil-gui folder
inside the LED Fixtures section into which BOTH existing renderers project
their group folders:

1. **LED-class `parLights` groups** (today: only `TE Sign`) — rendered by
   `renderParGUI`'s existing routing: `window._ledFixtureInstancesFolder`
   simply points at this folder (it already exists as the routing target;
   post-flattening it re-points from the old `🪧 Sign Fixtures` subfolder to
   the flat list). These folders keep the FULL DMX group toolbar: Select All,
   ● On, ✏ Rename (with `viewRegistryRenameGroup` view-bit carry — the rename
   fix landing in parallel applies here for free, since it is the same code
   path), ⏻ Group On, Group Brightness %, 🔒 Lock, per-fixture cards with
   patch lines. Data stays in `params.parLights`; patching (A 120ch on its own
   controller, B 102ch on its own controller) is untouched.
2. **Strand groups** — rendered by `renderStrandGUI` exactly as report _23/_24
   built them (Select All / On / Rename / + Strand / ✕ Ungroup / 🔒 Lock /
   ⏻ Group On / Group Brightness %), plus the `Ungrouped` display bucket.
   Data stays in `params.ledStrands`.

**Coexistence rule:** generated groups and hand-authored strand groups are
siblings in this one list. There is no "generated" badge and no separate
subsection — a generated TE Sign group is distinguishable only by being a
locked `parLights` group, which is exactly the DMX-side behavior (trace
groups sit beside hand groups in Light Instances).

**Ordering (must be deterministic across rebuilds):** parLights-homed
(sign) group folders pinned at the TOP of the list, then named strand groups
in `params.ledStrands` appearance order, then `Ungrouped` last. Because two
renderers write into one folder and lil-gui only appends, the implementer
must make ordering explicit — recommended mechanism: `renderStrandGUI`
finishes by invoking `renderParGUI()` (the report-_23 pattern), and the
routing pass DOM-reorders the tracked `window._parLedGroupFolders` elements
to the head of the folder's `.children`. Any equivalent single-owner
composite render is acceptable; the requirement is the order, not the
mechanism. (Top-vs-bottom is a cosmetic operator preference — flagged in §6.)

**No strand-census assumptions:** the list renders whatever exists. Zero
strands ⇒ no strand group folders and no `Ungrouped` bucket; the section and
the generator area still render (the operator removed several strands — this
must stay true).

### 2.3 The generator area: `✨ Generators` + a generator catalog (the seam)

Mirror of `📐 Group Generator`, but **stateless** (see §2.4 for why): it
renders one "add" button per catalog entry, exactly like the DMX area renders
`○ New Circle / — New Line / ⌐ New Corner`.

**New pure module** `simulation/src/fixtures/led_generator_catalog.js`
(no DOM, no THREE, fail-loud, unit-testable — same discipline as
`te_sign_generator.js` / `group_lock.js`):

```js
// Ordered catalog of LED-fixture generators. Adding a future generator is
// ONE entry here (+ its own build module) — zero gui_builder changes.
export const LED_GENERATORS = [
  {
    id: 'te_sign',
    label: '✨ + TE Sign (A+B)',
    target: 'parLights',              // which params array output lands in
    bornLocked: true,                 // lock the output group on creation
    build: (opts) => buildTeSign(opts), // -> array of fixture configs, one shared group
  },
];

// Pure helper: first free group name — base, then "base 2", "base 3", …
// against the set of group names already present in the target array.
export function uniqueGroupName(existingGroups, base) { … }
```

`gui_builder.js` renders the `✨ Generators` folder by iterating
`LED_GENERATORS`; the click handler is generic:

```
pushUndo()
  → group = uniqueGroupName(existing groups in params[target], defaultGroup)
  → fixtures = entry.build({ group })
  → params[target].push(...fixtures)
  → if bornLocked: params.groupOverrides[group] = {enabled:true, brightness:100, locked:true}
      (for target 'ledStrands' the future dispatch writes params.ledGroupOverrides instead)
  → rebuild + re-render for the target (parLights: renderParGUI + rebuildParLights;
      ledStrands: rebuildLedStrands + renderStrandGUI)
  → debounceAutoSave() → toast
```

**The future-generator seam is the `target` dispatch + the catalog entry** —
a future strand-emitting generator declares `target: 'ledStrands'` and its
own `build`; nothing else changes. Do NOT build any second generator now.

**Duplicate-generation guard (new behavior, small but important):** today
clicking `✨ + TE Sign` twice pushes a second A+B pair into the SAME
`TE Sign` group — four halves in one locked group, which
`applyTeSignPlacement` would rigidly co-locate (two signs fused at one
transform) and which reads as one `TE Sign (4)` folder. The catalog flow
fixes this via `uniqueGroupName`: the second click creates group `TE Sign 2`,
its own locked rigid unit. Since only one physical sign exists, the click
handler should additionally `confirm()` when a TE Sign group already exists
("A TE Sign already exists — add another?") — mirroring the DMX regenerate
confirm. (Blocking outright vs confirm+suffix is an operator call — §6.)

### 2.4 Stateless catalog (Option A — recommended) vs persistent generator cards (Option B)

**Option A (recommended, designed above):** the generator area holds only
"add" buttons. No persisted generator instance. Rationale:

- The TE Sign generator has **no geometry parameters** beyond whole-sign
  placement — and placement already lives on the fixture configs, edited
  through the locked group (gizmo or numeric → `applyTeSignPlacement`, the
  A≡B guard). "Regenerate" would recompute nothing.
- A persistent card would be a **second source of truth for the transform**
  (card placement vs fixture configs) — a sync hazard against the very
  invariant the lock machinery protects, for zero operator value.
- Matches the operator's words: "adds the 2 halves **as it is now**".
- Save/load stays exactly as today: the pair persists in the scene's
  `fixtures` array; `locked` persists in `groupOverrides`
  (`pruneGroupOverrides` already keeps it). **No new persisted keys.**

**Option B (full trace parity, NOT recommended):** `params.ledGenerators`
array of cards (kind/name/group/placement/`generated` flag) with
Generate/Regenerate/Delete, persisted like `traces`, placement controls
driving `applyTeSignPlacement`. Costs: new persistence key + migration
(synthesizing a card for the existing hand-placed sign), transform-ownership
ambiguity, materially more `gui_builder` code. Choose B only if the operator
wants a future where generators carry real regenerable parameters (e.g. a
strand-array generator with count/spacing) AND wants the TE Sign to share
that chassis today. The catalog seam in Option A does not preclude adding
per-entry cards later; B can be grown from A when a parametric generator
actually arrives.

### 2.5 Everything that must keep working (invariant checklist)

| Invariant | How the design preserves it |
|---|---|
| A≡B identical transform | Untouched: `buildTeSign` copies one transform into both configs; rigid moves route through `applyTeSignPlacement` via `isTeSignConfigs` (gizmo `interaction.js` + numeric `applyLockedParNumericMove`). This design only moves the button. |
| Born locked | Same `groupOverrides[group].locked = true` write, now keyed by the (possibly suffixed) generated group name. |
| Whole-sign placement | Locked-group editing surface, unchanged. |
| Group rename (parallel fix) | Sign groups use the SAME group-folder code (`renderParGUI` → `viewRegistryRenameGroup`); the fix applies wherever the folder renders. S2 must rebase on it. |
| Group master ⏻/Brightness | parLights groups: `groupOverrides` + `applyFixtureOutputOverrides` (sign inherits, unchanged). Strand groups: `ledGroupOverrides` + `scaleRgbForGroup` in the direct-paint path (report _24, unchanged). |
| Scene save/load round-trip | Option A adds NO persisted state. Pair → `fixtures` array; lock/master → `groupOverrides`; strand groups → `strands` + `ledGroupOverrides`. `config.js` untouched. |
| Engine model export parity | Export reads `params.parLights` / `params.ledStrands` via the exporter — generated and hand-authored configs are the same objects in the same arrays; indistinguishable by construction. No export change. |
| Model YAMLs canonical read-only | Generator only names `fixture_type` strings (`TeSignV3A40`/`TeSignV3B34`); never reads or writes the YAMLs. |
| Incoming pixel-ORDER update | Drop-in point unchanged (replace the two model YAMLs; report _14/_24: nothing in generator/lock/grouping reads pixel order). |
| One controller per sign side | Patching stays in `params.parLights` + Controller Mapping panel; this design never touches patch data. |
| No fixed strand census | List renders what exists; empty states legal (§2.2). |
| Scene without an LED section | Keep report _23's fallback: if `window._ledFixtureInstancesFolder` is unset, LED-class groups render in the DMX list (never hidden). The `✨ Generators` area only exists inside a LED Fixtures section, so scenes without one simply have no LED generator button. |
| `traceGenerated` re-stamping | `config.js` L146 re-stamps `traceGenerated:true` on any fixture whose group matches a generated trace's `groupName`. `uniqueGroupName` must therefore also avoid collision with `params.traces[*].groupName` (cheap union check) so a sign group can never be captured by a trace. |

## 3. Migration notes (existing scenes load cleanly, no YAML edits)

- **`scenes/titanic/scene_config.yaml`:** TE Sign V3 A/B already sit in
  `parLights.fixtures` (group `TE Sign`, operator-fine-placed at x −15.5 /
  rotY −90, A≡B intact) with `groupOverrides['TE Sign'].locked: true`. Loads
  unchanged; the routing re-homes the group into LED Fixture Instances
  exactly as it does today into Sign Fixtures. **Zero data migration.**
- **Hand-authored strands** (any census, including the post-removal set and
  `group: ''` strands): unchanged data; render as strand groups / Ungrouped
  in the flat list. `ledGroupOverrides` (if present) applies as today.
- **`test_bench`:** no sign; the generator button appears and works (pushes
  into `params.parLights` and the group re-homes) — acceptable and useful for
  bench testing.
- **Old saves referencing nothing new:** Option A introduces no new YAML keys,
  so forward/backward compatibility is trivial (a scene saved after this work
  opens fine in older code — the button location is code-side only).
- **Folder-title-based open-state restore:** `renderParGUI` remembers open
  groups by title across BOTH homes; when `_ledFixtureInstancesFolder`
  re-points to the flat list this keeps working, but S2 must re-verify the
  `openGroups` scan covers the flat folder (it scans
  `window._ledFixtureInstancesFolder.folders` — pointing the global at the
  flat list is sufficient, and it will now also see strand group folders,
  which is harmless since titles are compared with member counts).

## 4. Implementation plan (slices for Opus implementers)

**Territory reality:** `gui_builder.js` is single-owner at any moment. The
flattening slice (other agent, in flight) and the group-rename fix (parallel)
both live there. Therefore only S1 runs in parallel; S2 is strictly after
both land.

### S1 — Generator catalog module (parallel-safe, new files only)
- **Files:** `simulation/src/fixtures/led_generator_catalog.js` (new),
  `simulation/tests/led_generator_catalog.test.js` (new).
- **Work:** catalog per §2.3 (`LED_GENERATORS` with the single `te_sign`
  entry; `uniqueGroupName(existingGroups, base)` pure helper). Fail-loud
  validation: unknown `target` throws; `build` must return a non-empty array
  sharing one group.
- **Must NOT touch:** `gui_builder.js`, `te_sign_generator.js`, any scene YAML.
- **Verify:** `cd simulation && npm test` green (baseline 455 + new);
  `node --check` on new files. Tests: catalog shape; te_sign entry builds the
  A+B pair via `buildTeSign` (A≡B, shared group, correct types);
  `uniqueGroupName` (fresh base, suffixing, collision with trace groupNames
  when given the union set).

### S2 — gui_builder wiring (sequential: after flattening slice + rename fix + S1)
- **Files:** `simulation/src/gui/gui_builder.js` only.
- **Work:**
  1. Remove the `✨ + TE Sign (A+B)` row from the DMX `Light Instances`
     toolbar (L1340–1377 region; line numbers will have shifted — locate by
     the `teSignBtn` block).
  2. In the (now flat) LED Fixtures section: add the `✨ Generators` folder
     rendering one button per `LED_GENERATORS` entry with the generic click
     flow of §2.3 (undo, unique group + confirm-on-existing-sign, push,
     born-locked override, rebuild/render dispatch by `target`, autosave,
     toast).
  3. Title the flat instances list **"LED Fixture Instances"** and point
     `window._ledFixtureInstancesFolder` at it (coordinate with whatever the
     flattening slice named it — this is the join point).
  4. Deterministic ordering: sign group folders above strand groups,
     `Ungrouped` last (§2.2 mechanism note).
  5. Keep the no-LED-section fallback and the `_parLedGroupFolders` teardown.
- **Verify:** `node --check`; `npm test` green (incl.
  `te_sign_grouping_parity.test.js`, `group_lock.test.js` untouched-green);
  read-only puppeteer DOM assertions against the running stack (own throwaway
  browser, `debounceAutoSave` stubbed, CLOSE the browser): `✨ Generators`
  folder exists with exactly one button; `LED Fixture Instances` contains
  `TE Sign (2)` with full group toolbar + strand groups + Ungrouped in the
  specified order; DMX `Light Instances` has NO TE Sign button and NO TE Sign
  group; clicking generate in the probe (params-only, not saved) creates a
  suffixed locked group `TE Sign 2` with A≡B transforms and undo restores.
  Screenshot the drawer, visually inspect, report.

### S3 — Live proof + report (sequential after S2)
- **Files:** `simulation/agent_tools/led_generator_verify.cjs` (new, modeled
  on `group_lock_verify.cjs`: own Chromium, autosave stubbed, closes browser,
  zero scene residue), dated report in `.agent/reports/202607/`.
- **Verify (against the operator's RUNNING stack — never restart anything):**
  (a) generate → pair lands in LED Fixture Instances, born locked, A≡B;
  (b) rigid move of the generated group routes through `applyTeSignPlacement`
  (byte-identical transforms after +Δx on one member); (c) scene round-trip
  simulation via `extractParams`/`reconstructYAML` unit-level check — the
  generated pair + lock survive; (d) regression sweep: DMX drawer group
  count unchanged, engine-export pixel list for the sign identical before/
  after (same 74 px, same groups) using the exporter in a probe page;
  (e) confirm no scene file was written (`git status` clean of scene YAMLs
  beyond pre-existing residue). All screenshots visually inspected.

**Dependency graph:** `[flattening slice ∥ rename fix ∥ S1] → S2 → S3`.

## 5. Explicit non-goals

- No second generator (the seam exists; do not exercise it).
- No change to `te_sign_generator.js`, `group_lock.js`, `config.js`,
  `interaction.js`, exporter, or any model YAML.
- No Option-B generator cards, no new persisted keys.
- No strand transform-gizmo writeback work (pre-existing unwired path).

## 6. Operator decision points

1. **Option A (stateless generator buttons — recommended) vs Option B
   (persistent generator cards with Regenerate, full DMX-trace parity).**
   Design assumes A; B documented in §2.4.
2. **Second-sign behavior:** confirm-then-create `TE Sign 2` as its own
   locked group (designed), or hard-block ("only one physical sign")? Either
   is a one-line difference in the S2 click handler.
3. **DMX-side symmetry rename:** rename `Light Instances` →
   `DMX Fixture Instances` to mirror `LED Fixture Instances`? Cosmetic,
   cheap, but touches operator muscle memory + any scripts asserting the
   title. Not assumed by this design.
4. **List ordering preference:** sign groups pinned at top of LED Fixture
   Instances (designed) vs strands first.
5. **Generator area label:** `✨ Generators` (designed) vs `📐 Generators`
   to visually rhyme with the DMX `📐 Group Generator`.

## 7. Notes for the coordinator

- The `\0` byte Grep flags inside `gui_builder.js` is NOT corruption — it is
  the intentional `'\u0000ungroup'` sentinel option value in the Move…
  dropdown (verified; `node --check` passes). Grep treats the file as binary
  in multi-file sweeps; implementers should search it with an explicit path.
- S2's join point ("what the flattening slice named the flat folder") is the
  only cross-agent coordination needed; everything else in this design is
  additive around code that already carries the invariants.
