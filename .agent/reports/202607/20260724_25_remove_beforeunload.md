# Remove sim beforeunload "Leave site?" / reload confirmation

**Date:** 2026-07-24
**Branch:** feat/bm_readiness
**Operator order:** remove the Chrome "Leave site? Changes you made may not be
saved." dialog (and the equivalent on reload) from the simulation. No
leave/reload confirmation of any kind.

## Where the handler lived

`simulation/src/gui/gui_builder.js` (~line 480), the sole active
`beforeunload` registration in the running sim:

```js
window.addEventListener('beforeunload', (e) => {
  if (!flushPendingSaveBeacon()) return;
  e.preventDefault();
  e.returnValue = '';   // ← this pair is what raised the native dialog
});
```

Other `beforeunload` mentions are not the culprit:
- `simulation/src/gui/scene_recovery.js` — comments only; it *disarms* the
  autosave before restore, never registers a confirm.
- `simulation/unreal/.../GamepadController.ts` — vendored Unreal
  PixelStreaming infra; its `onBeforeUnload` is gamepad cleanup, not a
  leave-site confirm, and is not part of the sim served on :6969. Left
  untouched.

CaptainPad web was not searched — the sim search was not empty; the screenshot
is the sim.

## Why it existed

An unsaved-changes safety net for the :6970 save-server flow. Every GUI
mutation marks `window.__sceneDirty` and (with auto-save off) the edit only
persists on an explicit save. The handler did two things on unload:
1. **`flushPendingSaveBeacon()`** — fire-and-forget `navigator.sendBeacon`
   POST of the latest serialized config to the save server (the only
   transport that survives unload).
2. **`preventDefault()` + `returnValue=''`** — raised the browser's blocking
   "Leave site?" confirm so an accidental close/refresh gave the operator a
   chance to stay and save deliberately.

## What changed

Removed **only** the confirmation. Kept the beacon flush:

```js
window.addEventListener('beforeunload', () => {
  flushPendingSaveBeacon();
});
```

Surgical one-hunk edit inside the unsaved-changes section. `gui_builder.js` is
also being edited by another agent (GUI/lighting controls) — I touched only
this handler block; no other lines. Note the overlap.

## ⚠️ Safety net removed (operator was explicit)

The unsaved-changes **confirmation is gone**. If the operator accidentally
closes/refreshes the sim tab while a scene edit is dirty and auto-save is off,
the browser will NOT warn. Mitigations that remain: the `sendBeacon` flush
still fires on unload (best-effort save), the on-screen `● UNSAVED CHANGES`
chip, and the "Recover scene" (⟲) backups. This was done per the operator's
explicit order.

## Verification

Live stack left running (sim :6969 untouched — no restart/reconfigure). Fresh
readonly Puppeteer browser loaded the sim (getting the edited file off disk),
armed the guard (`window.__sceneDirty = true`), then:

- synthetic cancelable `beforeunload` → `defaultPrevented: false` (handler no
  longer cancels)
- real `page.reload()` and real navigate-away → `page.on('dialog')` received
  **zero** beforeunload dialogs
- `sendBeacon` (stubbed to protect live scene files) was still invoked once —
  the legitimate save-on-unload cleanup is intact

```json
{ "pass": true,
  "synthetic": { "defaultPrevented": false, "beaconAttempted": 1 },
  "dialogs": [], "beforeunloadDialogCount": 0 }
```

Browser closed after the run (multi_agent §9). `cd simulation && npm test` →
**442 pass, 0 fail**. Temp verification script written to and removed from
`~/tmp/`.
