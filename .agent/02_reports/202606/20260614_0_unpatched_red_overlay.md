# Unpatched-red overlay — sim diagnostic toggle

- **Date:** 2026-06-14
- **Branch:** claude/bold-wozniak-21l1py
- **Context:** builds on the Controller Mapping work
  (`20260611_2_controller_mapping_impl.md`,
  `20260612_0_controller_id_ordinal.md`).

## What landed

A toggle that tints every fixture with **no DMX patch** red in the 3D
view, so the operator can see at a glance what still needs mapping. It is
**sim-only** — no DMX/sACN data is sent (unpatched fixtures have no
universe/address to send to). Default off.

The toggle lives in **two synced places** (both write the single
`params.showUnpatchedRed` flag):

1. **Controller Mapping panel** — a full-width button **directly above
   `+ Add Controller`**: `⚪ Unpatched Highlight: OFF` ⇄
   `🔴 Unpatched Highlight: ON` (red when on).
2. **DMX Fixtures GUI** — a `Show Unpatched (Red)` checkbox placed
   **right under `Show Generators`**.

Sync is by construction: the lil-gui checkbox is `.add(params,
'showUnpatchedRed').listen()` (auto-reflects external changes); the panel
button flips the same flag and calls `refreshControllerMapPanel()`.
Verified two-way in a real-UI smoke.

## Files changed

- `simulation/src/core/animate.js` — per-frame `_applyUnpatchedRedOverlay()`
  pass (tints unpatched fixture bodies red, skips selected fixtures so the
  selection tint still owns body color; one reset pass clears on toggle-off
  then stops touching bodies). Also the instanced-mesh "mixed mode"
  unpatched branch now renders red instead of black when the flag is on
  (red pixel dots in mapping profiles).
- `simulation/src/fixtures/dmx_fixture_runtime.js`,
  `model_fixture.js`, `fog_machine.js` — `setUnpatchedRed(on)` on each
  fixture class (mirrors the existing `setSelected` body-tint pattern;
  `0xff2222` ↔ default `0x333333`).
- `simulation/src/gui/controller_map_editor.js` — panel toggle button.
- `simulation/src/gui/gui_builder.js` — lil-gui checkbox under Show
  Generators.
- `simulation/style.css` — `.cm-unpatched-toggle` styling.

The flag is a view preference: it is **not** persisted to scene config and
does not mark the scene dirty.

## Verification

- `node --check` on all 6 changed JS files: pass.
- `git diff --check -- simulation`: pass.
- `npm test`: 67/70 pass — the 3 failures (`TEFogMachine` /
  `ChauvetHaze4D` fixtureDef, `panel_visibility.test.js`) are
  **pre-existing** (identical on a clean tree, confirmed via stash).
- Real-UI smoke (puppeteer, xvfb + SwiftShader, 1280×720, titanic):
  - `full` and `edit` profiles: clicking the real lil-gui checkbox tints
    **61/61** unpatched bodies red, **0** patched fixtures wrongly tinted;
    toggling off clears all reds.
  - Panel button renders above `+ Add Controller`; clicking it turns the
    lil-gui checkbox on (panel→gui), and clicking the checkbox turns the
    panel button back off (gui→panel).
  - Screenshots inspected (`.agent_renders/unpatched_red_*.png`,
    `unpatched_panel_ON.png`). Only console noise was the expected
    engine :6968 connection-refused (engine down).

## Notes

- titanic ships with no `controllers.yaml`, so all fixtures are unpatched
  and `_patchesActive` is false → the body-tint path is what shows. The
  instanced-mesh red branch only fires in the mixed case (some controllers
  mapped, profile mapping-enabled); it is a simple conditional verified by
  review.
