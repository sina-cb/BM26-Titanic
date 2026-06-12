# Titanic engine model has no DMX patches — engine runs render-only

- **ID:** 015
- **Priority:** IMPORTANT
- **Status:** OPEN
- **Source:** launcher prod-profile verification, 2026-06-12
  (branch claude/launcher-command-profiles-h255l5)
- **Location:** marsin_engine/models/titanic.js (no patched pixels),
  simulation/scenes/titanic/ (patch export source)
- **Created:** 2026-06-12
- **Updated:** 2026-06-12

## Description
Booting the engine with `--model titanic` logs:

```text
✅ Shared DMX mapper: 0/976 pixels patched across 0 universe(s) []
⚠️ No patched pixels found in model. Running in render-only mode.
[sACN Out] Sender started — 0 universe(s)
```

The engine→sim sACN link comes up Connected but carries zero frames,
and the sim shows the "⚠ UNPATCHED — SIM-ONLY MODE" banner. The
`test_bench` model is patched and streams normally, so this is
titanic-model content, not an engine bug. The root `launcher.js`
defaults to the titanic scene, so the default `prod` stack currently
drives no DMX.

Related observation: the titanic scene's default `lightingMode` is
`pixelblaze` (in-browser engine), which also hides the sACN IN monitor
panel until the operator flips Mode to `sacn_in`.

## Suggested fix
- Re-export the titanic model from the sim with its DMX patch table
  (`simulation/src/dmx/pixelblaze_model_exporter.js` flow) so
  `marsin_engine/models/titanic.js` has patched pixels.
- Decide whether the titanic scene's default `lightingMode` should be
  `sacn_in` when driven by marsin_engine.

## Why it matters
The show stack (`launcher.js prod`) is sim + engine on the titanic
scene. Until the model is patched, the engine renders 976 pixels to
nowhere and the real controllers would get nothing.
