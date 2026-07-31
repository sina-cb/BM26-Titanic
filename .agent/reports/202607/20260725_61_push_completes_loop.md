# 20260725_61 — S1: push completes the loop (device → save → notify)

Implementation of slice **S1** from `20260725_58_push_save_workflow_plan.md`
(§5 design, §8/S1 spec), built on top of **S2** (`_59`, the registry-aware plan
gate) and alongside **S3** (`_60`). Code + unit tests only: **no browser session
against the sim, no scene save, no device HTTP, nothing started or restarted, no
git operations.** The operator was running lit hardware off this stack
throughout.

---

## The order

*"Push to controller must always push and not be ignored."* Before this slice,
⬆ Push wrote the device (and, in memory, the page registry) and stopped there.
The sACN feed the hardware actually receives is produced from FILES ON DISK —
`patches.yaml` (the bridge's relay routes) and the engine model (the send set) —
which only a scene save writes, and auto-save is off. So a push looked ignored
until the operator saved by hand: the exact sequence `_58` reconstructed.

**Principle implemented (`_58` §5):** a push is DONE only when the device AND
the feed agree — or it fails loudly stating exactly which layer is stale. The
device write is never rolled back on a completion failure (that would be a
hidden fallback plus a second reboot); honesty is the fail-loud behaviour.

## What changed

### 1. `simulation/src/gui/gui_builder.js` — `exportConfig` is awaitable

`exportConfig()` is now `async` and **returns a promise that resolves to
`{ ok: boolean, reason?: string }`**. The fetch that POSTs the YAML is awaited
instead of being a fire-and-forget `.then` chain; the post-save side effects
(dirty-flag clear, toast, bridge notify, panel resyncs) are unchanged and still
run inside the success branch.

Every path that leaves nothing new on disk now answers `ok:false` with a
verbatim reason, so a caller can print exactly which layer is stale:

| path | reason |
|---|---|
| app still booting | `the app is still booting — nothing was saved` |
| fixtures rebuilding | `fixtures are rebuilding — the save was deferred to the auto-save retry, nothing is on disk yet` |
| model/sidecar export threw | `model/sidecar export failed — nothing saved: <err>` |
| static host (no save server) | `static host — the save server (port 6970) is not reachable, nothing was written` |
| save server non-200 / network | the error message verbatim (e.g. `save server responded 500`) |

The third row is the known risk from the plan: the duplicate-fixture-name guard
(TE Sign V3 A/B, a standing operator item) makes `saveModelJS` throw and aborts
the WHOLE save. That abort now reaches the push dialog verbatim instead of
vanishing into a toast.

### 2. `simulation/src/dmx/patch_manager.js` — the notify reports its outcome

`notifySacnBridge()` now resolves to `{ ok, scene? , reason? }` and never
rejects. **"WebSocket not connected" is a FAILURE of the step**, not a
`console.warn` footnote — the bridge rebuilds its relay routes only on this
message, so a missed notify means the freshly saved `patches.yaml` is never
read. The `console.log`/`console.warn` lines are kept (S4 adds the toast +
monitor line). `saveAndNotify`'s 500 ms timer is untouched — that is S4's file
seam, and it now has an awaitable `exportConfig` to chain on.

### 3. `simulation/src/gui/led_discovery_panel.js` — the push continues

- **`DEFAULT_DEVICE_IO` grew `persistScene()` and `notifyBridge()`** —
  thin, lazy bindings to `window.exportConfig` / `window.PatchManager
  .notifySacnBridge` (each throws loudly if the global is not installed).
  Injectable like the rest of the bag, so no test saves a scene or talks to a
  device. **Option A** from `_58` §5 (operator default): one save path in the
  codebase, model re-export included; no new endpoint.
- **New exported `persistAndNotifyAfterPush(io)`** — awaits the save, and only
  then the notify. Never throws; returns `{ save: {ok, reason?}, notify:
  {ok, reason?}|null }`. `notify` stays `null` when the save failed: notifying
  after a failed save would just make the bridge re-read the stale file and
  look like progress. A step that answers with no `{ok}` result is treated as a
  REFUSAL, not an assumed success.
- **New exported `describePushCompletion(steps, {lead, deviceNote})`** — pure
  sentence builder shared by the dialog, the toast and the tests. Success:
  `✓ device written + verified · ✓ scene saved (patches projected) · ✓ bridge
  notified — routes follow`. Any failure appends
  `— the device WAS written (cannot be rolled back); the sim feed was NOT
  updated: <scene save|bridge notify> — LEDs will not follow until a successful
  save.`
- **`runPerOutputPush`** (now exported for tests) — the device push/verify has
  its own try/catch and returns early on failure (no save, no notify: there is
  nothing to project). On success it renders the interim
  `✓ device written + verified · saving the scene…`, runs the completion, and
  paints the status line green/red from `describePushCompletion`. The sync chip
  stays `in-sync` (device ≡ plan is literally what it measures) but carries a
  detail saying the sim feed is STALE and which step failed, so the green chip
  cannot read as "the LEDs are following".
- **`showPerOutputPushConfirm`** declares the save UP FRONT, as ordered:
  *"Push writes the device AND saves the scene (mapping must land on disk for
  the sACN feed to follow)."* plus a line naming it as the same save the 💾
  buttons run.
- **`startPushAll`** — same declaration in the confirm dialog, and ONE
  persist+notify after the sequential pushes, folded into the summary line
  (`done — N pushed · … · ✓ scene saved … · ✓ bridge notified …`) with the
  plural `the device(s) WERE written` note on failure. `pushAllLedControllers`
  itself stays device-layer only (documented) — a save per controller would
  rewrite the same files N times and notify the bridge against a half-updated
  registry.

**S2 is untouched and still runs first:** the collision refusal in
`startPerOutputPush` / `pushAllLedControllers` returns BEFORE the confirm dialog
and before any device write, so no save/notify wiring can run on a refused plan.

## Test counts

`cd simulation && npm test`

| | tests | pass | fail |
|---|---|---|---|
| before (after S2 + S3) | 1099 | 1091 | 8 |
| after | 1111 | 1103 | 8 |

**+12 tests, +12 pass, failures unchanged at 8** — the known pre-existing
stale-model family, byte-identical before and after (`fixtures are docked
beside the ship…`, `the real titanic scene can accept the block today…`,
`view-bit headroom is REPORTED…`, the two `CLI:` parity cases, and the three
`real scene …` cases). They clear on the operator's one sim-save (R8). Not
touched.

New cases:

- `simulation/tests/per_output_push.test.js` — **+9** ("Slice S1" section):
  success asserts the **persist→notify ORDERING** (save strictly after the
  device write, notify strictly after the save, exactly one save) and the exact
  three-step sentence; save-500 asserts red + `the device WAS written` +
  **no notify**; the model-export abort (duplicate `TE Sign V3`) surfaces
  verbatim; notify-failure asserts red and names `bridge notify`; the sync chip
  keeps `in-sync` with a STALE-feed detail; a FAILED device write never saves or
  notifies; a step answering with nothing (or missing from the io bag) is a
  refusal; a throwing save step is captured verbatim; and the pure sentence
  builder's exact strings. `runPerOutputPush` runs **DOM-free** — the dialog's
  three nodes are plain objects with `textContent` / `className` / `disabled`.
- `simulation/tests/led_controller_ui_round2.test.js` — **+3**:
  `pushAllLedControllers` is device-layer only (persist/notify spies in the io
  bag are never called during the fleet loop); the fleet completion saves once
  then notifies and reads as one sentence; a fleet whose save fails says
  `the device(s) WERE written` and never notifies.

`node --check` (copied to `.mjs`, ES-module syntax) passes on all three edited
source files.

## Deviations from the S1 spec

1. **`exportConfig` resolves with `{ok, reason}`; it never rejects.** The spec
   says "return its save promise". Every existing caller is fire-and-forget
   (`debounceAutoSave`'s timer, the two 💾 buttons, `view_masks_editor`), and a
   rejecting promise would turn each of them into an unhandled rejection while
   the push needs the failure as data it can *render*. Resolving with a
   structured result gives the push (and S4) a clean await point without
   changing any existing caller's behaviour.
2. **No `force` argument.** The plan wrote `exportConfig(force)`, but
   `exportConfig` never consulted `params.autoSave` — that gate lives in
   `debounceAutoSave`. Calling `exportConfig()` directly IS the forced save and
   it does not arm the debounce, which is exactly the reentrancy rule the plan
   asked for. Adding a no-op parameter would have been a lie in the signature.
   The `_isRebuildingFixtures` guard is deliberately NOT forced past: saving a
   half-rebuilt fixture set is worse than a reported failure.
3. **`runPerOutputPush`, `persistAndNotifyAfterPush` and
   `describePushCompletion` are exported.** Needed to test the flow without a
   DOM and to share the exact sentence with push-all (mirrors S2 exporting
   `computeSyncState`). No behaviour change for existing callers.
4. **The bridge is notified twice on a successful push.** `exportConfig`'s
   success branch already calls `notifySacnBridge()`, and the push then runs its
   own notify as a *reported* step. Deliberate: the inner call's outcome is not
   observable to the push, and it does not run at all on the static-host path,
   so relying on it would make the third reported step a guess. `setScene` is
   idempotent (the bridge recomputes routes from disk), so the cost is one extra
   WS message. Collapsing the two is S4's call.
5. **The sync chip stays `in-sync` after a failed completion**, with a detail
   naming the stale feed, rather than being forced to `drift`. `drift` means
   device ≠ plan, which would be false here and would make the chip disagree
   with the push a second time. S5 owns the tooltip wording.
6. A new CSS hook class `led-push-saves-scene` is attached to the declaration
   line; it inherits `led-push-warn` styling, so no stylesheet was touched.

## What S4 can rely on

- **`window.exportConfig()` is awaitable** and resolves to
  `{ ok: boolean, reason?: string }`, never rejects. `saveAndNotify` can drop
  its `setTimeout(…, 500)` and become
  `const res = await window.exportConfig(); if (res.ok) await notifySacnBridge();`
  — the 500 ms race dies with it. Note `debounceAutoSave()` (which
  `saveAndNotify` currently calls) is the *debounced* path and returns before
  any save happens; chaining requires the direct `exportConfig()` call.
- **`PatchManager.notifySacnBridge()` already returns `{ ok, scene?, reason? }`**
  and never rejects; "WS not connected" is `ok:false` with the reason
  `sACN bridge WebSocket not connected — the bridge did NOT reload its routes`.
  S4's remaining work there is the **loudness** half (toast + monitor line on
  `ok:false`) — the return contract is done and the LED push already consumes
  it. Keep the WS-reconnect `setScene` re-send untouched (it is the self-heal).
- `exportConfig`'s success branch still fires the inner
  `notifySacnBridge()` fire-and-forget; if S4 makes that one loud, expect it to
  fire alongside the push's own reported notify (deviation 4).

## Untouched / out of scope

- No `simulation/scenes/**`, no `marsin_engine/**`, no server code, no bridge
  code (S3's file), no `save-server.js` (Option B was not taken).
- No live acceptance run — that is `_58` §9.1, operator-gated: it costs one
  device reboot and one real scene save. **Until it runs, S1 is proven by unit
  tests only.** The live check is: change one port universe on the `.60` card,
  press ⬆ Push and NOTHING else — the dialog must walk device✓ / save✓ /
  notify✓ and the LEDs must follow with no manual save.
- The `.60`'s enabled-but-unmapped third output (`_58` §9.2) still carries its
  old universe on the device; S1 changes nothing there.
