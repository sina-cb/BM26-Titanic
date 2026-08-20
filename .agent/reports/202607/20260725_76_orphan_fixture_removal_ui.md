# Orphaned fixtures — flagged in the sim, removable one by one or group by group

Opus implementer session. Operator order: *"there are some fixtures without
corresponding generators, please flag those in the sim and allow removing them
one by one or group by group."*

**Zero writes to `simulation/scenes/**` or `marsin_engine/**`.** No browser
session against the sim, no scene save, no device HTTP, no server started,
stopped or restarted, no git operations. Code + unit tests only; the operator
exercises the UI himself after a reload.

---

## 0. TL;DR

- **The ghosts are now visible and deletable.** A fixture that CLAIMS a
  generator made it (`traceGenerated: true`) while no live trace owns its group
  is an ORPHAN. It gets a red badge on its group header, a red badge on its own
  row, a warning bar naming the problem, and — for the first time — a control
  that actually removes it.
- **The count is where he cannot miss it.** The `📐 Group Generator` section
  header reads **`⚠ N orphaned fixtures`**, with a banner underneath listing
  every affected group and a `🗑 Remove N` button per group. That is the right
  home: the whole point of an orphan is that it has **no card in that list**.
- **Every delete enumerates its dependents FIRST** (`_47`'s ethos): controller
  chain entries (controller · IP · port · universe · address), patch-tree
  records, live-vs-zeroed patch fields, 2D Pixel Map name selectors + move
  offsets + placements, group membership (and whether the group disappears),
  and the exported engine-model pixel footprint. The confirm dialog IS that
  enumeration; the question comes last.
- **Four ways it refuses, loudly, with zero mutations:** the fixture stopped
  being an orphan under the dialog; a row cannot be re-found by identity; a
  dependent store cannot be read; or removal would leave a 2D panel with an
  empty `select`. There is no "delete the ones that still qualify" fallback —
  one bad row aborts the whole operation.
- **LED and DMX are treated as one class** (operator, 2026-07-30 — *"LED
  fixtures, DMX fixtures are both fixtures"*). One rule, one badge, one confirm
  dialog, one delete path; the bus is **reported**, never a branch. Group
  membership is counted across both buses because groups share one namespace.
- **Nothing is written to disk.** The removal mutates memory and marks the
  scene dirty. HE saves, and HE re-exports the model — both said in the dialog
  and in the toast.
- **64 new tests, all green.** Suite **1311 / 1302 / 9** vs a session baseline
  of **1237 / 1229 / 8**: the same 8 known stale-model failures, plus one
  failure that is **not mine** (§7).
- **Against his real scene the detector reports exactly 6 orphans**, all
  `Left Center Auditorium` — not 7. He deleted `Left Center Auditorium 5`
  himself in a save partway through this session (§6).

---

## 1. The detection rule

`simulation/src/dmx/orphan_fixtures.js` — **new, pure** (no DOM, no THREE, no
`window`, no registry internals).

```text
orphan  ⇔  the fixture CLAIMS generator origin
           AND no live trace owns its group
```

Both halves are load-bearing, and each one is a false-positive class this had
to avoid:

| Case | Verdict | Why |
|---|---|---|
| `traceGenerated: true`, group owned by a live trace | **not orphan** | the generator owns it |
| `traceGenerated: true`, no trace owns its group | **ORPHAN** | the ghost class |
| Hand-placed fixture, no `traceGenerated` key | **not orphan** | it never claimed a generator |
| `traceGenerated: false` (the TE Sign halves) | **not orphan** | generator OUTPUT, but no persistent generator survives it — deliberately stamped false |
| Trace **renamed**: `name` = `Left Back Wall`, `groupName` = `Left Back Wall Generator` | **not orphan** | ownership is keyed on `trace.groupName \|\| trace.name` — the same expression `generateGroupFromTrace` / `sweepGeneratedInstances` / `config.js` use. Keying on `name` alone would have painted a whole live run as deletable |
| `traceGenerated: true`, **no group at all** | **ORPHAN** | no trace can own a group that does not exist — a determination, not a guess |
| `traceGenerated: 'true'` / `1` / `null` | **not orphan** | only the boolean literal `true` is a claim |

**No guessing, and no half-scans.** Unknown provenance is never upgraded into a
claim. A scene whose generator list cannot be read is **not scanned at all** —
`generatorGroupNames` throws on a non-array `traces`, on a malformed trace
entry, and on a trace carrying neither a `groupName` nor a `name`, because an
under-counted owner set turns live fixtures into deletion candidates. Same for
a non-array `ledStrands`.

### Both buses, one rule

`sceneRecordSources()` walks `parLights` **and** `ledStrands`, tagging each
orphan row with its `bus` (`'dmx'` / `'led'`) and with the array it lives in,
so the delete splices the right list without re-deriving anything. Notes:

- The LED-**class** par fixtures (TE Sign V3 A/B) already live in `parLights`
  and are merely *homed* under the LED Fixtures drawer — they render through
  the same `renderParGUI` path and were covered from the start.
- `ledStrands` is the separate strand record list. No generator writes
  `traceGenerated: true` onto a strand **today** (the trace generators only
  emit into `parLights`, and the one LED catalog entry stamps `false`), so an
  orphaned strand is currently impossible-by-construction — but the rule, the
  enumeration and the delete cover it, so the `target: 'ledStrands'` generator
  seam cannot reintroduce the ghost class.
- Group membership is counted **across both buses**: par groups, LED-class par
  groups and LED strand groups share ONE namespace (`group_rename_guard.js`),
  so "all orphaned" can only be decided by looking at both.

---

## 2. Where the flags live in the UI

| Surface | What he sees |
|---|---|
| **`📐 Group Generator` header** | `📐 Group Generator ⚠ N orphaned fixtures` (red). This is the count that needs no hunting. |
| **Generators banner** (top of that section, under the New Circle/Line/Corner row) | A red box: *"⚠ N orphaned fixture(s) — generated, but no generator owns them"*, one row per affected group (`Left Center Auditorium — all 6`) with a **`🗑 Remove 6`** button each. Rebuilt every render, never duplicated. |
| **Group folder header** in Light Instances | `Left Center Auditorium (6) ⚠ ORPHANED`, or `⚠ 3 ORPHANED` on a mixed group. |
| **Group warning bar** inside the folder | Explains the class, plus **`☑ Select 6`** (selects them in the 3D view through the existing selection highlight — no new render machinery) and **`🗑 Remove 6 orphan(s)`**. On a MIXED group it says only the orphan members are offered and the rest belong to a live generator. |
| **Fixture row** | The card title is prefixed with a red `⚠`. |
| **Inside the fixture card** | *"⚠ ORPHANED — this fixture says the "X" generator made it, but no such generator exists. Nothing regenerates, renames or chains it."* + **`🗑 Remove this orphan`**. |

Two deliberate non-goals: no new 3D/2D render machinery (the `☑ Select` button
reuses the existing selection highlight instead), and the group card's
`✕ Delete` — which *re-homes* rather than deletes (`_51` Trap 1) — was left
exactly as it is. Removing an orphan now has its own, correctly-named control.

**Open-state safety.** Group folders restore their open/closed state by title
string. A badged title would have lost that on every re-render, so each folder
now carries `_plainTitle` (`"<group> (N)"`, un-badged) and the restore matches
on that. Identical behaviour for every unbadged group.

---

## 3. The deletion flow — and the confirm-dialog contract

`removeOrphanFixtures(candidates, scopeLabel)` in `gui_builder.js`. Four
phases, each able to refuse, **nothing mutated before the confirm**:

**1 · RE-DETECT.** The rows were computed when the panel rendered. Every
candidate is re-checked against the live `params.traces`; any row that is no
longer an orphan (a generator was created or renamed since) aborts the **whole**
operation with a named list. Rows are then re-resolved against their own record
array **by config identity** — a remembered index goes stale the moment
anything splices.

**2 · ENUMERATE** (`enumerateOrphanDependents`, pure):

| Dependent | Source | Reported as |
|---|---|---|
| Controller mapping | `describeFixtureMappings(registry, names)` | `controller (IP) · Port N · U · addr` → *will be UNMAPPED and its channels freed* |
| Live vs zeroed patch | the config's own fields | `LIVE U90:11@… (sectionId, fixtureId)` or `zeroed (sectionId, fixtureId)` |
| `__globalPatchTree` record | the name-keyed tree | *present — pruned (no phantom left behind)* |
| 2D Pixel Map | the SAME container the writer mutates (`pixelMapViewsSource()`) | each `{name: …}` selector by view · panel · index, each move offset, each placement |
| Group membership | every record in the scene, both buses | `N of M member(s) removed` — and `the group DISAPPEARS` when it empties |
| Group selectors at risk | `{group: …}` selectors on an emptying group | *will go ZERO-MATCH — left alone (operator intent, not ours to rewrite)* |
| Engine model | pixel count from the BOUND runtime fixture (`parFixtures` by config identity; `ledCount` for a strand) | `N pixel(s) — still in the EXPORTED model until you re-export it` |

**3 · CONFIRM.** The dialog is that enumeration verbatim, then totals
(`fixtures · mapped · live/zeroed patches · patch-tree entries · pixel-map
references · exported model pixels`), then the two follow-ups (RE-EXPORT the
model, SAVE the scene), then — last — *"Remove them?"*.

**4 · MUTATE.** `pushUndo()`; `removeFixtureFromPixelMapViews` per fixture
FIRST — it is the only remaining step that can throw, so doing it ahead of the
splice means a throw leaves the scene completely untouched rather than half
deleted; then splice each record out of its own array in place,
`controllerMappingFixturesRemoved` (unmaps the chain entries),
`pruneGlobalPatchTreeKeys` (no name phantoms), invalidate the batch cache, print the itemised removal report,
toast, re-render (par GUI + generators GUI + `rebuildParLights`; plus
`rebuildLedStrands` / `renderStrandGUI` when a strand was touched), and
`debounceAutoSave()` — which **marks the scene dirty and nothing more**.

### The refusals

| Situation | Behaviour |
|---|---|
| A candidate is no longer an orphan | `buildStaleOrphanRefusal` — names them, aborts everything |
| A candidate cannot be found by identity in its array | same refusal |
| `patchTree` / `chainRows` / `allRecords` / `pixelCounts` unreadable | `buildEnumerationRefusal` — *"a destructive scene operation never proceeds blind"*, nothing changed |
| The runtime fixtures are mid-rebuild, or one has no bound runtime | blocker: the engine-model footprint is **unknown**, so the delete is refused rather than guessed |
| The fixture has **no name** | blocker: every dependent store is name-keyed |
| Removing it would empty a 2D panel's `select` | blocker naming the view + panel; the schema rejects an empty `select`, so this is refused up front AND `removeFixtureFromViews` throws if it is ever reached |

No fallbacks anywhere: a partial delete is exactly the phantom class this
feature exists to end.

---

## 4. What the operator will actually see

Against his scene **as of the 14:28 save** (86 fixtures, 8 strands, 14 traces),
verified by running the real detector against read-only copies of
`scene_config.yaml`:

```text
titanic:    fixtures=86 strands=8 traces=14  ORPHANS=6
   Left Center Auditorium: 6/6  allOrphans=true
   dmx:Left Center Auditorium 1, 2, 3, 4, 6, 7
test_bench: ORPHANS=0
studiodj:   ORPHANS=0
```

So after a reload:

- `📐 Group Generator` reads **`⚠ 6 orphaned fixtures`**, with a banner row
  `Left Center Auditorium — all 6` and a `🗑 Remove 6` button.
- In Light Instances, `Left Center Auditorium (6) ⚠ ORPHANED`, its warning bar,
  `☑ Select 6`, `🗑 Remove 6 orphan(s)`, and six `⚠`-badged fixture rows each
  with its own `🗑 Remove this orphan`.
- **Zero false positives on all three real scenes** — 124 fixtures and 12
  strands, including both TE Sign groups and every hand-placed fixture.

Clicking the group button gives a confirm listing all six with zeroed patches,
their `sectionId 1` records, the group disappearing, the `{group: 'Left Center
Auditorium'}` exclude selector in the Top-Down default going zero-match, and
the exported-model pixel total. Note that `Left Center Auditorium 5` is
**already gone** — he removed it himself mid-session — which is why the count
is 6 rather than the 7 the brief quoted.

**Once he removes them, `ORPHAN_GROUPS` in
`simulation/src/gui/pixel_map/pixel_map_view_defaults.js` must lose
`'Left Center Auditorium'`** — the same Trap-3 follow-up `_51` filed for
`Left Back Wall`. The existing tripwire in `pixel_map_view_defaults.test.js`
already asserts that, and will go red the moment the group is empty. That is
the intended signal, not a regression.

---

## 5. Files touched

| File | Change |
|---|---|
| `simulation/src/dmx/orphan_fixtures.js` | **new, pure** — the rule, the bus-agnostic scan, the per-group roll-up, the dependency enumeration, and every operator-facing string (confirm body, both refusals, the removal report) |
| `simulation/src/gui/pixel_map/pixel_map_views.js` | **new export** `removeFixtureFromViews` — drops `{name: …}` selectors + offsets + placements, throws rather than emptying a panel's `select` |
| `simulation/src/gui/pixel_map/pixel_map_store.js` | **new exports** `removeFixtureFromPixelMapViews` (live container + persisted tree, never forces a save) and `pixelMapViewsSource` (so the enumerating READER and the mutating WRITER cannot read different trees) |
| `simulation/src/gui/gui_builder.js` | `orphanScene` / `orphanPixelCounts` / `removeOrphanFixtures`; the census in `renderParGUI`; badges on group folders (+ `_plainTitle`) and fixture cards; the group warning bar; the Generators header count + banner |
| `simulation/tests/orphan_fixtures.test.js` | **new** — 41 behaviour tests |
| `simulation/tests/orphan_removal_wiring.test.js` | **new** — 23 wiring-regression tests |

`led_halo.js`, `animate.js`, `dmx_fixture_runtime.js` and the gui_builder halo
param blocks were **not touched** — `_75`/`_77`'s territory.

---

## 6. Verification

- `node --test tests/orphan_fixtures.test.js tests/orphan_removal_wiring.test.js`
  → **64 pass / 0 fail** (41 behaviour + 23 wiring, including the LED-bus set
  added after the operator's "both are fixtures" note).
- `cd simulation && npm test` → **1311 tests / 1302 pass / 9 fail**, against a
  session baseline of **1237 / 1229 / 8** taken before the first edit.
- `node --check` clean on all four touched source files;
  `git diff --check -- simulation/src` clean.
- Real-scene probe: the detector run against read-only copies of all three
  scenes' `scene_config.yaml` (§4). No scene file was opened for writing.

### Zero-write proof

`simulation/scenes/**` and `marsin_engine/**` were only ever **read**. The only
files created are the two test files, the two new source modules, the edits
listed above, this report, the dossier rows, and a throwaway probe in `~/tmp/`.
No server was started or stopped; no browser was opened against `:6969`.

---

## 7. The 9th suite failure is not mine

```text
✖ every excluded orphan group is STILL an orphan (untraced) in the scene
    "Left Center Auditorium" 1-7 are the remaining untraced ghosts
    6 !== 7
```

`tests/pixel_map_view_defaults.test.js` is a **brand-new, untracked** file
landed by a concurrent agent during this session. It pins the ghost count at
**7**. The operator saved his scene at **14:28**, deleting `Left Center
Auditorium 5` — so the scene now carries **6**. The failure is that hardcoded
count meeting his save; nothing in this work touches that file, that constant,
or the scene.

I deliberately did **not** edit it (concurrency rule — it is another agent's
in-flight file). It needs one of:

- `7` → `6` now, or better,
- the count assertion dropped entirely, since the whole point of `_76` is that
  this number is about to become operator-controlled and will change with every
  click. The two assertions above it (the group still exists; no trace owns it)
  are the ones with real signal and they should stay.

The other 8 failures are byte-identical to the baseline: the known
scene↔model staleness set, cleared by his owed re-export + engine restart
(readiness item 3).

---

## 8. Follow-ups filed

1. **`ORPHAN_GROUPS` must lose `'Left Center Auditorium'`** the moment he
   removes the group — otherwise nothing is excluded that exists, and the
   literal is dead weight. Two places hold it:
   `pixel_map_view_defaults.js` and a duplicated copy in
   `agent_tools/pixel_map_view_tuning_verify.cjs`. (Carried over from `_51`
   §8.1, now one click closer.)
2. **The stale count in the new `pixel_map_view_defaults.test.js`** — §7.
3. **The group card's `✕ Delete` still re-homes rather than deletes**, with no
   confirm (`_51` §8.3). Untouched here on purpose; the orphan path got its own
   correctly-named control instead. Renaming it `↪ Dissolve into <group>` is
   still the right fix.
4. **`traceRenameError`'s collision message still does not say the colliding
   group is an ownerless orphan** (`_51` §8.5). Now that orphan-ness is a
   tested pure predicate, that message is a two-line change — but it is in the
   rename path and was out of scope here.
5. **The strand LIST rows are not badged** (only the Generators banner covers
   an orphaned strand). No generator can produce one today, and the strand card
   region neighbours `_75`/`_77`'s halo work. Worth doing when that settles.
