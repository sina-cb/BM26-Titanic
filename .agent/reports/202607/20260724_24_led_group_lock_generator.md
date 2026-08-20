# 20260724_24 — Group LOCK + TE Sign generator wiring + real LED group master

**Author:** Opus implementer · **Branch:** `feat/bm_readiness` · **Date:** 2026-07-24
**Slice:** operator items 4+5 of the LED wave. Builds directly on the extension
points left by report `20260724_23_led_fixtures_grouping.md`.

## What the operator asked (verbatim intent)

1. **Group LOCK** — "LED fixture in a group must be locked together with a button
   to lock them relative to each other so I can move the whole group together."
   A 🔒 button on the group toolbars in BOTH worlds; a locked group moves as one
   rigid body (translation AND rotation) when ANY member is moved (gizmo or
   numeric), preserving relative offsets. Unlocked = per-member as before.
2. **TE Sign A≡B routing** — rigid moves of the TE Sign group MUST go through
   `te_sign_generator.applyTeSignPlacement()` (one transform copied into both
   halves), never per-fixture edits that could tear the seam.
3. **Generator integration** — a freshly generated sign is born locked; the
   whole-sign placement + component controls keep working after generation.
4. **Complete the LED group master** — report _23 withheld LED-strand group
   master brightness/On-Off because it would have been a fake control (LED
   strands direct-paint, bypassing `applyFixtureOutputOverrides`). Make it real:
   per-group enable/brightness must actually scale the LED direct-paint path.

All four landed; live-verified against the running stack; `npm test` green.

## Lock mechanics

The lock flag rides in the existing per-group override bag (no new namespace for
DMX/par): `params.groupOverrides[name].locked` for par groups,
`params.ledGroupOverrides[name].locked` for LED-strand groups. Default `false`.

**New pure module `simulation/src/core/group_lock.js`** (no DOM/THREE, fail-loud,
unit-tested) is the single source of truth for the shared logic:
- `isGroupLocked(overrides, name)` — the lock predicate.
- `parGroupMemberIndices(configs, name)` / `strandGroupMemberIndices(strands, name)`
  — the members that move together (par: `group||'Default'`; strand: display group).
- `ledDisplayGroup(strand)` — the trimmed named group, else `'Ungrouped'`; the ONE
  key the GUI master and the exporter's paint scale agree on.
- `isTeSignConfigs(configs)` — true only when EVERY member is a TE Sign half (so
  `applyTeSignPlacement` can never clobber a non-half).
- `scaleRgbForGroup(overrides, name, r,g,b)` — the LED master's RGB scale
  (Off⇒black, ≥100%⇒unchanged, else linear). Reused by both LED paint paths.

### Par groups (`renderParGUI`, `gui_builder.js`)
- **🔒 Lock button** added to the group toolbar row 1 (Select All | ● On | 🔒 Lock),
  toggling `groupOv.locked` and repainting in place (green 🔒 Locked when on).
- **Gizmo path** (`interaction.js` + `main.js`): on drag-begin,
  `computeRigidMoveIndices(dragIdx)` = selected ∪ (locked-group siblings of the
  dragged fixture). main.js captures start state for that whole set;
  `onTransformChange` applies the same translation delta + orientation delta to
  every member (the classic multi-select differential, now also fed the locked
  siblings). So dragging ONE member of a locked group drags the whole group even
  when only it is selected. Backward-compatible: an unlocked single drag still
  captures nothing and moves only itself.
- **Numeric path**: Position/Rotation inputs are bound through a lock-aware helper
  (`addLockAwareAxis`) that snapshots the pre-edit value in the CAPTURE phase of
  every input event (pointer/keyboard/wheel/focus) and, when the group is locked,
  routes the change to `applyLockedParNumericMove` (shifts every sibling's same
  field by the delta) instead of the normal per-selection propagate — the two can
  never double-apply.

### LED-strand groups (`renderStrandGUI`, `gui_builder.js`)
- **🔒 Lock button** added to the strand group toolbar row 1.
- Strands are two endpoints with no orientation, so a rigid move is a pure
  per-axis translation: `applyLockedStrandNumericMove` translates BOTH endpoints
  of EVERY member along the edited axis by the typed delta (lock-aware Start/End
  bindings mirror the par ones). (The strand transform-gizmo handle-drag writeback
  is not wired in the codebase today — `window._onStrandTransformChange` is never
  assigned — so strand rigid moves are driven by the numeric inputs, the strands'
  real editing affordance.)

### Persistence
`config.js pruneGroupOverrides` now keeps a group whenever it is locked OR carries
a non-default master, and preserves the `locked` key — so a locked group survives
scene save→load exactly like the master. `ledGroupOverrides` is a new persisted
top-level map (extract + reconstruct + prune, mirroring `groupOverrides`).

## TE Sign A≡B routing

Any rigid move of a locked group whose members are ALL TE Sign halves
(`isTeSignConfigs`) is routed through `applyTeSignPlacement(memberConfigs, leadTransform)`
instead of per-fixture edits — in BOTH the gizmo handler (`onTransformChange`) and
the numeric handler (`applyLockedParNumericMove`). This copies the lead half's
whole transform (x/y/z + rot + scale) into both halves, guaranteeing the two
carry ONE bit-identical transform (no float drift across quaternion↔euler round
trips). Verified live: moving Side A's X by +7 moved BOTH halves to x=7 with
byte-identical transforms.

## Generator wiring (born locked)

The `✨ + TE Sign (A+B)` button now, after pushing the pair, sets
`params.groupOverrides['TE Sign'].locked = true` (keyed off the generated group)
and toasts "🔒 locked". A freshly generated sign is one rigid unit out of the gate;
whole-sign placement + the generator's component controls keep working because
the locked TE Sign group routes through `applyTeSignPlacement` (the A≡B guard).
The sign's A/B relative offset is identity by design (slice 14 dropped the
between-halves offset), so "relative movement" = whole-sign placement, preserved.
Verified live: born-locked flag went `false → true` on button click.

## LED group master (the real, not-fake control)

The gap report _23 named: LED strands direct-paint via `entry.apply(r,g,b)` →
`LedStrand.setLedColorRGB`, bypassing the DMX `applyFixtureOutputOverrides`. Fixed
at the source by scaling in the direct-paint apply closure
(`pixelblaze_model_exporter.js`): every strand pixel's rendered RGB is passed
through `scaleRgbForGroup(params.ledGroupOverrides, ledDisplayGroup(strand), …)`
before `setLedColorRGB`. Read LIVE each frame, keyed by the strand's display
group, so a slider move dims the group on the next painted frame; Off ⇒ black.
This covers ALL callers of `apply` (internal gradient, engine batch, sACN-in
demap, blackout).

The static preview (no pattern painting) is scaled by the SAME function in
`LedStrand.rebuildVisuals` so the master is always visible, not only while a
pattern runs — one source of truth across both paths, no double-scaling (each
state has exactly one paint path). The strand group toolbar gained the real
`⏻ Group On` + `Group Brightness %` controls; changing them rebuilds the group's
strand visuals so the change shows immediately.

## Proof (live, renderer-only against the running :6969 stack)

Tool: `simulation/agent_tools/group_lock_verify.cjs` (launches its OWN throwaway
Chromium; never starts/stops a server; stubs `debounceAutoSave` so nothing writes
the scene; closes the browser at the end). Drives the REAL GUI code path via DOM
numeric inputs; reaches the real `params` singleton via a dynamic import of
`state.js`. All checks PASS, 0 filtered console errors:

| # | Check | Result |
|---|---|---|
| a | 🔒 Lock button in a group toolbar | **PASS** — `🔓 Lock → 🔒 Locked`; screenshot `.agent_renders/glock_*_a_lock_button_zoom.png` shows the `__locktest__ (3)` toolbar (Select All / ● On / 🔒 Locked + Group On + Group Brightness %). |
| b | Locked GENERIC group moves rigidly | **PASS** — 3 members at x=−6/0/6, one edited +5 ⇒ all three x=−1/5/11 (Δ=+5 each), y/z held, relative offsets intact. |
| c | Locked TE Sign whole-move + A≡B | **PASS** — Side A X +7 ⇒ both halves x:0→7, transforms byte-identical, rotY 180 preserved. Screenshot `glock_*_c_tesign_moved.png` (gizmo at the new offset). |
| c2 | Generator born locked | **PASS** — `TE Sign` group `locked` false→true on `✨ + TE Sign (A+B)`. |
| d | LED group master scales the paint | **PASS** — static sync sample: full `[0,1,0.402]`, 50% `[0,0.5,0.201]` (0.500×), Off `[0,0,0]`. Screenshot `glock_*_d_led_dimmed.png` (strand group visibly dimmed to 25%). |

Screenshots visually inspected. No scene residue written (`__locktest__` /
`ledGroupOverrides` absent from all scene files after the run). The "2 sim windows
connected" warning is expected (my probe browser alongside the operator's) and
harmless — it was closed.

## Tests

`cd simulation && npm test` → **455 pass / 0 fail** (442 baseline + 13 new in
`tests/group_lock.test.js`: member collection, TE-sign classifier, LED display
key, `scaleRgbForGroup` brightness/blackout math, and `pruneGroupOverrides`
lock+master persistence). `node --check` clean on every edited file.

## Files touched

- **New:** `simulation/src/core/group_lock.js`, `simulation/tests/group_lock.test.js`,
  `simulation/agent_tools/group_lock_verify.cjs`.
- `simulation/src/gui/gui_builder.js` — lock buttons + lock-aware numeric bindings
  (par + strand), real LED strand group master, generator born-locked wiring.
- `simulation/src/core/interaction.js` — `computeRigidMoveIndices` + locked-group
  differential + TE Sign A≡B routing in `onTransformChange`.
- `simulation/main.js` — drag-begin captures the rigid-move set (locked siblings).
- `simulation/src/dmx/pixelblaze_model_exporter.js` — LED direct-paint group scale.
- `simulation/src/fixtures/led_strand.js` — static-preview group scale.
- `simulation/src/core/config.js` — `locked` persistence + `ledGroupOverrides`
  extract/reconstruct/prune.

## Operator notes / caveats

- The lock flag persists with the scene (save/load). Freshly generated TE signs
  are born locked; existing scenes' TE Sign groups load unlocked (no `locked` in
  their YAML) until you press 🔒 or regenerate — set it once and save if you want
  it sticky.
- LED strand group master applies to the DISPLAY group (named group, or the
  `Ungrouped` bucket). A literal group named "Ungrouped" would collide with the
  bucket — avoid that name.
- Strand rigid moves are numeric-input driven (the strand gizmo handle-drag
  writeback is a pre-existing unwired path, untouched here).
- The upcoming pixel-ORDER model regen is safe: nothing here reads pixel order —
  the lock/master operate on fixture/strand transforms and group keys only.
