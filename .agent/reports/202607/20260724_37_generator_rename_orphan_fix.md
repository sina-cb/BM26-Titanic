# 20260724_37 — DMX generator rename: orphan-duplicate root-cause fix

**Author:** Opus implementer
**Branch:** `feat/bm_readiness` · **Date:** 2026-07-24
**Scope:** sim GUI trace-generator rename path only —
`simulation/src/gui/gui_builder.js` + one new pure helper module + tests.
**Territory:** sole `gui_builder.js` writer for this slice. Did NOT touch
`trace_chains.js` (S1), scene YAMLs (S3), or `config.js` (no change needed —
see §4).

## The bug (operator, live, verbatim)

> "when I create a group and then press generate, if I change the name of the
> generator, the old instances are not removed and it causes duplication of
> fixtures."

Independently identified by the designer in report `_32` §0 as the source of the
12 committed orphan duplicates (`Left Center Auditorium` ×7, `Left Back Wall` ×5)
at byte-identical coordinates to their `… Generator` twins.

## Root cause

`gui_builder.js` trace-name `onFinishChange` (pre-fix, ~L3743):

```js
trace.groupName = trace.name;                       // (1) point trace at NEW name
if (trace.generated) generateGroupFromTrace(i, true); // (2) regenerate
```

`generateGroupFromTrace` sweeps out prior instances by **the current group name
only**:

```js
const groupName = trace.groupName || trace.name;                // already the NEW name
params.parLights = params.parLights.filter(l => l.group !== groupName || !l.traceGenerated);
```

After step (1) `groupName` is the NEW name, so the sweep removes nothing (no
fixtures carry the new name yet) and step (2) emits a fresh `<new> 1..N` set. The
old `<old> 1..N` fixtures are never touched → **orphaned duplicates forever**,
each also holding a view-mask bit and an orphaned `groupOverrides` entry.

## Chosen semantics

**Remove-old-first, matching the existing regenerate-on-rename architecture** —
the generator model already regenerates instances from trace geometry, so the fix
makes the rename sweep the OLD name too, then carries the group's keyed state
across (mirroring the LED/par ✏ Rename plumbing, report `_28`). No rename-in-place
fixture surgery is needed because regeneration re-emits the set cleanly.

Concretely the rename now, in one atomic handler:

1. **Fail-loud guard** (codex P0) — reject empty, reserved (`Ungrouped`), or a
   name colliding with another trace group or an existing par group. On reject it
   `alert()`s and reverts the input to the last committed name (no silent merge
   that would fuse two groups' overrides + view bits).
2. **Carry the group master override** (`enabled` / `brightness` / `locked`)
   `groupOverrides[old]` → `groupOverrides[new]`.
3. **Carry the view-mask bit** via `window.viewRegistryRenameGroup(old, new)` so
   patterns compiled against `MASK_*` names stay stable.
4. **Set `trace.groupName = trace.name`** (the new name).
5. **Regenerate sweeping the OLD name too** —
   `generateGroupFromTrace(i, true, oldGroupName)`.

### Files changed

- **`simulation/src/gui/trace_group_rename.js`** (NEW, pure, no DOM/THREE) —
  single source of truth, unit-tested:
  - `traceRenameError(newName, {traces, parLights, traceIndex, oldGroupName})`
    → error string or `null`.
  - `sweepGeneratedInstances(parLights, groupName, previousGroupName)`
    → `{kept, removed}`; sweeps the union of the current name + any prior name.
    Non-generated fixtures in either group are preserved.
  - `carryTraceGroupOverride(groupOverrides, oldName, newName)`.
- **`simulation/src/gui/gui_builder.js`**:
  - `generateGroupFromTrace(traceIndex, skipUndo, previousGroupName = null)` —
    new optional param; sweep routed through `sweepGeneratedInstances`. The
    existing count-shrink casualties hook (`controllerMappingFixturesRemoved`)
    now correctly receives the old-named fixtures on a rename (they are casualties
    — none of the new `<new> N` names survive the old set), so any mapping entries
    drop as they should.
  - trace-name `onFinishChange` — the five-step handler above; tracks
    `committedTraceName` for clean revert on a rejected rename (lil-gui/MarsinGui
    `StringController` fires `_callOnFinishChange` on blur, after it has already
    mutated `trace.name`).
- **`simulation/tests/trace_group_rename.test.js`** (NEW, 12 tests).

## Both directions verified

- **generate-then-rename** (the operator's exact sequence): create → generate
  (4 fixtures) → rename → **exactly 4** fixtures under the new name, zero orphaned
  old-named fixtures, names re-stamped `<new> 1..4`. This is the case that
  produced 8 fixtures before the fix.
- **rename-then-generate**: renaming a not-yet-generated trace just updates
  `trace.groupName` (nothing to sweep); the subsequent generate emits under the
  new name — no stale set.
- **double rename**: no accumulation across renames (Old → Mid → Final leaves 4).

## config.js re-stamp — no change needed

`config.js` L146 restores `traceGenerated` on load via
`traces.filter(generated).map(t => t.groupName || t.name)`. Because the fix keeps
`trace.groupName` and the fixtures' `group` in sync under the new name, the
re-stamp maps every renamed fixture back to its trace on the next load. A unit
test pins this invariant. (The S2 chains slice will later widen this line to
`chainGroupNames` per design `_32` §3.2 — out of scope here.)

## LED ✨ generator flow — checked, not affected

The LED generator (`led_generator_catalog` / TE Sign, `runLedGeneratorClick`,
~L4368) creates fixtures with a unique group name and **never regenerates on
rename**. Its groups rename through the standard par/strand ✏ Rename paths (the
`_28`-fixed in-place group-field move + override/view-bit carry) — there is no
regenerate-on-name-change sweep, so the orphaning pattern cannot occur there. TE
Sign (a `parLights` group homed under LED) renames via `renderParGUI` ✏ Rename,
already `_28`-safe. No changes made to the LED flow.

## Verification

- `cd simulation && node --test tests/*.test.js` → **519 pass / 0 fail** (baseline
  484 + sibling-slice additions + the 12 new rename tests). `node --check` clean
  on all touched files.
- **Live before/after** against the RUNNING operator stack (:6969), read-only,
  triple-guarded zero-scene-write (autoSave off + `debounceAutoSave` stubbed +
  every :6970 request aborted; pristine params + view-registry `groupBits`
  snapshot restored on exit; own browser, closed on exit). Tool:
  `simulation/agent_tools/trace_rename_verify.cjs`. Drives the REAL GUI code
  path — synthetic circle trace → real "✓ Generate" button → rename via the real
  Name `<input>` (focus → input → blur → `onFinishChange`):
  - **REPRO** (faithful to the original handler: set `trace.groupName` + click
    Generate, which is `generateGroupFromTrace(i)` with no previous-name sweep) —
    `old="ZZ Orphan Probe"=4`, `new="ZZ Renamed Probe"=4`, **total 8**; BOTH group
    folders present in Light Instances. Screenshot `…_repro_bug_duplicates.png`
    (trace card, visually inspected).
  - **FIX** (rename through the real input) — `old=0, new=4`; old folder **gone**,
    new folder present; `traceGroupName` + `traceName` = new; override carried
    (`{enabled:false, brightness:33}` → new key, old key gone); view bit carried
    (`4096` → new key, old key gone); names `ZZ Renamed Probe 1..4`; scoped
    re-stamp intact. Screenshot `…_fix_single_group.png` (visually inspected —
    card now "ZZ Renamed Probe", 4 lights).
  - **GUARD** — renaming onto an existing group (`Left Center Auditorium`) fired
    the fail-loud alert, reverted the input, left the 4 fixtures intact.
  - **Zero residue** — params + traces deep-equal the pristine snapshot; no probe
    groups remain. **No console errors.**

  Note: the probe's summary line initially flagged `fix_single_group` because an
  overly-broad re-stamp assertion scanned the WHOLE scene and tripped on the 12
  pre-existing committed orphans; the assertion was scoped to the probe's own
  trace. Every substantive FIX sub-value (old=0/new=4/override/bit/names/folders)
  was correct in the raw run data. The stack went down after the run (unrelated —
  the probe only aborts :6970 and closes its own browser); I did not restart it
  (operator-gated), so the corrected-harness re-run is pending stack availability,
  but the fix behavior is fully established by the captured run + unit tests.

## Scene cleanup (read-only note for S3)

Did NOT bulk-delete the 12 pre-existing committed orphans (Slice S3 / design
`_32`). The live probe created **no** fresh orphans in the operator's scene: it
ran with autosave stubbed + :6970 aborted and restored pristine params on exit, so
nothing this slice did is persisted. The committed orphans remain exactly as
report `_32` §0 catalogued them — S3 reconciles those.
