# LED Fixtures section + full DMX-style grouping parity

**Date:** 2026-07-24
**Branch:** `feat/bm_readiness`
**Scope:** sim GUI / scene-config / registry wiring (GUI territory only — did NOT
touch fixture material/backing rendering, which is another agent's slice).

## What the operator asked (two coupled items)

1. Rename the LED section to **"LED Fixtures"** and **home the TE Sign there**
   (operator ruling: *TE Sign = LED type*), without breaking TE Sign patching
   (A 120ch / B 102ch), the `TE Sign` group, the `TE Sign (2)` group-select, or
   the A≡B identical-transform invariant.
2. Bring LED fixtures to **full DMX-fixture-like grouping** in the Lighting
   Controls drawer (group folders, create/assign groups, group-select, per-group
   operations) — LED strands previously only had a per-strand free-text group
   field, no folders or operations.

## Key finding (why the design is what it is)

The TE Sign V3 halves live in `scene_config.yaml → parLights.fixtures`
(`params.parLights`), i.e. the **DMX fixture array**. That is where ALL their
machinery lives: DMX universe/address patching (`controller_map_editor`,
`gatherAllConfigs`), the group folder + `TE Sign (2)` Select-All, the group
master override (`params.groupOverrides` applied to `window.parFixtures`), and
the A≡B transform (`te_sign_generator.applyTeSignPlacement`). Physically moving
them into `params.ledStrands` (the LED-strand array) would change their transport
model to sequential pixel addressing and **break patching** — so that was ruled
out. The classifier is the fixture-definition **bus**: `TeSignV3A40` /
`TeSignV3B34` declare `bus: led` in their model YAMLs (never edited).

**Approach: keep TE Sign data in `params.parLights`; RE-HOME it in the UI.** The
sign stays byte-for-byte where it was on disk (patching / group / transform all
untouched); only the drawer folder it renders into changes.

## What changed

### Renames (label only)
- `simulation/scenes/titanic/scene_config.yaml` — `ledStrands._section.label`
  `🔌 LED Lights` → `🔌 LED Fixtures`.
- `simulation/scenes/test_bench/scene_config.yaml` — `💡 LED Strands` →
  `🔌 LED Fixtures`.
- `simulation/server/save-server.js` — new-scene template label →
  `🔌 LED Fixtures`.

### `simulation/src/gui/gui_builder.js`
- **`isLedClassConfig(config)`** (module helper): true when the fixture-type
  definition has `bus === 'led'`. Missing definition ⇒ DMX (legacy-safe).
- **`renderParGUI` routing** (DMX section): each group folder is now attached to
  a *target* folder. LED-class groups (every member `bus:'led'`, i.e. TE Sign)
  are routed into `window._ledFixtureInstancesFolder` — the `🪧 Sign Fixtures`
  subfolder of the LED Fixtures section. DMX-bus groups stay in the DMX section's
  `Light Instances`. **All per-fixture card + group-op code below the routing
  line is unchanged**, so patching, `TE Sign (2)` Select-All, the group override,
  and the A≡B transform are identical — only the parent folder differs. Cleanup
  of the LED-homed folders is tracked in `window._parLedGroupFolders` (they live
  outside `parListFolder`, so the normal destroy pass doesn't reach them). If the
  LED section isn't built yet (first render happens mid-DMX-build), the sign
  falls back to the DMX list and is re-homed when the LED section calls
  `renderParGUI()` again — so the sign is never hidden, even in a scene with no
  LED section.
- **`buildLedStrandsSection`** rewritten into the "LED Fixtures" section with two
  homes:
  - `🪧 Sign Fixtures` — owned by `renderParGUI` (TE Sign, full parity).
  - `💡 LED Strands` — LED strands, now **grouped DMX-style**: strands bucket
    into group folders by `strand.group` (empty ⇒ a single **Ungrouped** display
    bucket; bucketing is visual only, so `groupKeyForStrand` / section-id /
    view-bit numbering are unchanged). Each group folder gets **☑ Select All**
    (3D selection), **● On/○ Off** (sim visibility, same as the DMX group vis
    toggle), and — for named groups — **✏ Rename** (carries the view-mask bit via
    `viewRegistryRenameGroup`), **+ Strand**, **✕ Ungroup**. Section toolbar has
    **+ New Strand** and **➕ Add Group** (seeds a strand, mirroring DMX
    "Add Group"). Per-strand cards keep name / patch line / color / intensity /
    LED count / start-end / metadata, and gain a **→ Move…** dropdown (existing
    groups + Ungrouped + "＋ New group…") + Delete.
  - Removed the now-superseded per-strand free-text group input (and its unused
    `groupKeyForStrand` import).
  - `openStrandFolder` now opens the strand's ancestor group folder too.

## How grouping parity is achieved

| Operation | DMX Fixtures | LED strands (now) | TE Sign (now) |
|---|---|---|---|
| Group folders | ✓ | ✓ | ✓ (rendered by renderParGUI) |
| Create group | ➕ Add Group | ➕ Add Group | ➕ Add Group |
| Assign/Move to group | → Move… | → Move… (+ New group…) | → Move… |
| Group Select-All | ✓ | ✓ | ✓ (`TE Sign (2)`) |
| Visibility On/Off | ✓ | ✓ | ✓ |
| Rename group | ✓ (+view-bit) | ✓ (+view-bit) | ✓ (+view-bit) |
| Add fixture to group | ✓ | + Strand | ✓ |
| Delete/dissolve group | ✓ | ✕ Ungroup | ✓ |
| Group master On/Off + Brightness (live output override) | ✓ (`groupOverrides`) | — (extension point) | ✓ (inherited — sign is in `parFixtures`) |

The one honest gap: the DMX **group master On/Off + Brightness live-output
override** (`applyFixtureOutputOverrides`) only covers `dmxSceneFixtures` +
`parFixtures`, not `ledStrandFixtures` (LED strands direct-paint; they have no
DMX-router universe buffer to scale). I did **not** ship a no-op brightness
slider for LED-strand groups (codex P0: fail loud, no fake controls). The TE Sign
keeps that master for free because it is a `parFixtures` member.

## Extension points left for the follow-up (group-LOCK + generator) slice

- **Per-group state bag already exists:** DMX uses `params.groupOverrides[name] =
  {enabled, brightness}`. Attach a `locked` flag there (and a matching one for
  LED strands) — the group toolbars (`renderParGUI` group row ~L1471, LED group
  `row1`/`row2` in `renderStrandGUI`) are the place to add a 🔒 Lock button.
- **Group key is the join:** groups are keyed by name in both worlds
  (`config.group` / `displayGroupOf(strand)`), and Select-All already collects a
  group's member indices + attaches the transform gizmo to the first member —
  the natural hook for "move whole group as one" relative-transform handling.
- **A≡B rigid move:** for TE Sign specifically, a locked/group move must route
  through `te_sign_generator.applyTeSignPlacement(fixtures, placement)` (copies
  ONE transform into both halves) rather than per-fixture edits — that function
  is the invariant guard.
- **LED-strand group output override:** to give LED groups a real On/Off +
  Brightness master, extend the direct-paint scale in `animate.js` (the
  `entry.apply` LED path) / `applyFixtureOutputOverrides` to honor a per-group
  override keyed by the strand's group. That is output-path work, deliberately
  left to the output/lock slice.

## Verification

- `cd simulation && npm test` → **442 pass / 0 fail**, including
  `te_sign_grouping_parity.test.js` (LED-type TE Sign groups identically to a DMX
  group; two halves ⇒ one shared view group) and the `buildTeSign` A≡B /
  patching-footprint invariants. `node --check` clean on the edited JS.
- Puppeteer capture against the running stack (`--show-ui`-equivalent; read-only,
  no saves), `.agent_renders/led_fixtures_drawer.png`:
  - `🔌 LED Fixtures` section present, with `🪧 Sign Fixtures → TE Sign (2)`
    containing cards **TE Sign V3 A** + **TE Sign V3 B** and the full DMX group
    toolbar (Select All / On / Rename / add-type / Delete / ⏻ Group On / Group
    Brightness %).
  - `💡 LED Strands` with **+ New Strand**, **➕ Add Group**, and the
    **Ungrouped (16)** group folder (Select All / On).
- DOM assertions: `TE Sign` group = exactly `[TE Sign V3 A, TE Sign V3 B]`
  (`params.parLights` idx 12/13); group Select-All fires with no error.
- Regression guard: DMX Fixtures → Light Instances still lists **14** generator
  groups and **no** `TE Sign` (sign relocated, DMX drawer otherwise unchanged).
- Page errors during capture: only an unrelated pre-existing `404` for a missing
  resource; no `pageerror`, no `gui_builder` error.

## Files touched
- `simulation/src/gui/gui_builder.js`
- `simulation/scenes/titanic/scene_config.yaml`
- `simulation/scenes/test_bench/scene_config.yaml`
- `simulation/server/save-server.js`
