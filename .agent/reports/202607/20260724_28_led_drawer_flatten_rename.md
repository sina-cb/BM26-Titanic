# LED Fixtures drawer — flatten the Sign/Strand split + fix group-rename plumbing

**Date:** 2026-07-24
**Branch:** `feat/bm_readiness`
**Report:** 28
**Scope:** sim GUI drawer only (`simulation/src/gui/gui_builder.js`) — the LED
Fixtures section structure + group-rename key propagation. Did NOT touch the
render/output paths (`group_lock.js` scaling, `led_strand.js`, `light_pool.js`,
exporter) — that is the concurrent blackout-semantics slice's territory.

## What the operator asked (live-testing feedback, drawer screenshot)

1. **Remove the extra nesting inside LED Fixtures.** The section split into
   "🪧 Sign Fixtures" and "💡 LED Strands" subsections. Operator: *"don't want
   the extra nesting for LED strands vs Sign Fixtures — remove that nestedness —
   they are all LED fixtures."*
2. **Group rename must work for every LED group** — TE Sign group AND named
   strand groups — and must never orphan lock/brightness state; fail loud on a
   colliding / reserved name.

## What changed — `simulation/src/gui/gui_builder.js`

### 1. Flattened the LED Fixtures section (`buildLedStrandsSection`)

- **Removed both sub-category folders** (`🪧 Sign Fixtures` and `💡 LED
  Strands`). The TE Sign group(s) and the LED-strand groups (incl. `Ungrouped`)
  now render as **one flat list of group folders DIRECTLY under 🔌 LED
  Fixtures**, with the `+ New Strand | ➕ Add Group` toolbar sitting right below
  the section's global controls (Master Enabled / Show Guides / Pixel Size /
  Halo Size).
- `window._ledFixtureInstancesFolder` now points at the **section folder itself**
  (was the removed Sign Fixtures subfolder), so `renderParGUI` routes LED-class
  groups (TE Sign) into the flat list. Everything below the routing line in
  `renderParGUI` is unchanged, so TE Sign patching / `TE Sign` group / `TE Sign
  (2)` Select-All / the A≡B transform are all untouched.
- **Shared-parent teardown discipline.** Both render functions now add folders to
  the same parent, so each tears down ONLY its own: `renderParGUI` via
  `window._parLedGroupFolders` (already existed), `renderStrandGUI` via a new
  `window._ledStrandGroupFolders`. Previously `renderStrandGUI` blew away
  `[...strandsListFolder.folders]`; doing that on the shared parent would have
  destroyed the TE Sign folders on every strand edit — the new tracked-list
  teardown prevents that.
- **Toolbar created once** in `buildLedStrandsSection` (not rebuilt per render),
  so it keeps a stable position above the group list as folders re-render.

The per-group grammar (group toolbars, 🔒 Lock, ☑ Select All, ● On/○ Off, group
master ⏻/Brightness, per-strand `→ Move…` + Delete, TE Sign A≡B/patching) is
byte-for-byte the same — only the parent folder each group renders into changed.

> Design note: the DMX Fixtures section keeps a `Light Instances` wrapper folder
> between the section and its groups. I honored the operator's literal "all live
> DIRECTLY under 🔌 LED Fixtures as one flat list" and dropped the wrapper for
> LED — groups appear immediately on expanding the section (one level shallower
> than DMX). The per-group grammar still matches DMX exactly. If the upcoming
> "LED generator → LED Fixture Instances" redesign prefers a wrapper for
> symmetry, it can reintroduce one trivially — the routing is data-driven
> (`_ledFixtureInstancesFolder` / the two tracked folder lists).

### 2. Fixed group rename (the real bug: orphaned lock/brightness)

- **Strand-group rename (`renderStrandGUI` Row 2 `✏ Rename`)** now carries the
  per-group override bag across the rename:
  `params.ledGroupOverrides[old]` → `params.ledGroupOverrides[new]` (incl. the
  `locked` flag), then deletes the old key. Before this fix the rename moved the
  strands' `group` field + the view-mask bit but **left the override bag orphaned
  under the old name** — the group silently lost its lock + brightness. This
  mirrors the DMX rename which already carried `params.groupOverrides`.
- **Collision guard (fail loud, codex P0):** new helper `_ledGroupNameClash()`
  rejects an empty name, the reserved `Ungrouped` bucket, or a name colliding
  with an existing named strand group. Wired into strand Rename, `➕ Add Group`,
  and `→ Move… → ＋ New group…`. On a clash it `alert()`s and makes no change
  (no silent merge that would fuse two groups' state).
- **TE Sign group rename** rides the par path (`renderParGUI` `✏ Rename`), which
  already carried `params.groupOverrides` + `viewRegistryRenameGroup`. I added a
  matching fail-loud guard there (reject empty / reserved `Ungrouped` / existing
  par-group name) so the shared flat list can't end up with two identically named
  folders. This is pure rename-safety; the DMX section's structure/appearance is
  unchanged.

Rename propagation now covers every keyed home:
`params.ledStrands[].group` / `params.parLights[].group`, the override bag
(`ledGroupOverrides` / `groupOverrides` incl. `locked`), the view-mask bit
(`viewRegistryRenameGroup`), and the open-state set. `group_lock.js` needed **no
change** — its helpers (`ledDisplayGroup`, `isGroupLocked`,
`strandGroupMemberIndices`, `scaleRgbForGroup`) read whatever group-name key they
are handed, so moving the override key propagates automatically. Scene save/load
persists both maps via `config.js` `pruneGroupOverrides` (keyed by name), so the
renamed keys round-trip.

## Verification

- `cd simulation && npm test` → **483 pass / 0 fail** (baseline has grown from
  455 to 483 via sibling slices; no regressions). `node --check` clean.
- **Puppeteer against the RUNNING operator stack** (:6969), read-only: a
  throwaway headless page with `params.autoSave=false` AND every save-port
  (:6970) request aborted, so the operator's browser and on-disk scene were never
  touched. Page + browser closed on exit. All **15/15** DOM/state checks passed:
  - **(a) Flatten** — LED Fixtures' direct sub-folders were exactly
    `["Ungrouped (8)", "TE Sign (2)"]`; no `Sign Fixtures` / `LED Strands`
    sub-headers anywhere; the `+ New Strand / ➕ Add Group` toolbar sits directly
    in the section. Capture: `led_fixtures_flat.png` (visually inspected).
  - **(b) Rename** — seeded a strand group `ZZ_TEST` with
    `{enabled:true, brightness:42, locked:true}`, then renamed it via the actual
    UI Rename button → `params.ledGroupOverrides.ZZ_RENAMED` equals
    `{enabled:true, brightness:42, locked:true}`, the old key is gone (no orphan),
    the member strand re-keyed, no alert. Renaming to reserved `Ungrouped` and to
    an existing group `OTHER_GRP` each failed loud with an alert and left state
    unchanged. Capture: `led_fixtures_after_rename.png` (shows `TE Sign (2)`,
    `Ungrouped (8)`, `ZZ_RENAMED (1)`, `OTHER_GRP (1)` as one flat list).
  - **(c) DMX unchanged** — DMX Fixtures still has `Light Instances` with 14
    group folders; TE Sign is NOT in the DMX list (homed under LED). Capture:
    `dmx_fixtures_section.png` (visually inspected).
  - (Read live state confirmed the operator's removed strands were not restored:
    8 strands, all `Ungrouped`.)

## Heads-up (out of scope — flagged separately)

`gui_builder.js` contains **4 literal NUL (`\x00`) bytes** in the strand
`→ Move…` dropdown sentinels (`'\x00new'` / `'\x00ungroup'` at byte offsets
~234431–235282), almost certainly meant to be a leading space (`' new'` /
`' ungroup'`). They are internally consistent so the dropdown works, but NUL in a
source file makes git treat the file as **binary** (breaks diffs / the
security-check diff) and can trip some tooling. This is pre-existing from the
report-23 grouping slice; I did not touch it (never-revert landed work + not my
territory). Spawned a follow-up task to replace them with spaces.

## Files touched
- `simulation/src/gui/gui_builder.js`
