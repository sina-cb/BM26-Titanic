# 20260725_62 — S4: notify ordering + loudness

Implementation of slice **S4** from `20260725_58_push_save_workflow_plan.md`
(§6, §7.2-7.3, §8/S4), on top of **S1** (`_61`, awaitable `exportConfig` +
reporting `notifySacnBridge`). Code + unit tests only: **no browser session
against the sim, no scene save, no device HTTP, nothing started or restarted,
no git operations.** The operator was live-mapping lit hardware off this stack
throughout. (A PostToolUse hook offered to open a preview server after the
first edit — declined, per the lockdown.)

---

## The two defects

1. **The 500 ms race** (`patch_manager.js` `saveAndNotify`). It called
   `debounceAutoSave()` — which returns before any save happens, and
   early-returns entirely when `config.autoSave` is false — then notified the
   bridge from `setTimeout(…, 500)`. The bridge rebuilds its relay routes by
   **re-reading `patches.yaml` from disk**, so the notify was telling it to
   reload a file the save had not written yet. Not a "usually wins" race
   either: the debounce timer is **2000 ms**, so under `autoSave: true` the
   notify ALWAYS fired 1.5 s early and the bridge always re-read the stale
   file, reporting success on every surface.
2. **Swallowed failures.** A failed notify was a `console.warn`. Nothing about
   a stale sACN feed is visible from the sim's own render — the sim paints
   from memory while the hardware follows the bridge's routes — so "disk
   fresh, feed stale, every surface green" is precisely the shape of the
   operator's dark-LED day (`_58` §2).

## What changed

### 1. `simulation/src/dmx/patch_manager.js`

**`saveAndNotify()` — chained, not timed.** It now forces the save through the
awaited `window.exportConfig()` and notifies **only** after it resolves `ok`.
Returns `{ save: {ok, reason?}, notify: {ok, reason?}|null }`; never rejects
(every call site is fire-and-forget, and an unhandled rejection is a swallowed
failure by another name).

- `notify` stays `null` when the save failed — notifying after a failed save
  would just make the bridge re-read the stale file and *look* like progress.
- A save answering with no `{ok}` is treated as a **refusal**, not an assumed
  success (same rule S1 applied to the push steps); a throwing save is caught
  and reported verbatim.
- `window.exportConfig` missing → loud refusal, no notify.

**`notifySacnBridgeLoud()` (new, exported).** `notifySacnBridge()` plus the
loud surface on `ok:false`. The quiet `notifySacnBridge` is unchanged and
stays the LED push flow's entry point (it renders the same failure in its own
dialog + toast).

**`_surfaceFailure(message)` (new, internal)** — three surfaces, reusing the
sim's existing conventions:

| surface | call | note |
|---|---|---|
| console | `console.error` | unconditional — the one that always exists |
| toast | `window.showSaveToast(msg, true)` | the same red 6 s toast the "SAVE FAILED" path uses |
| monitor line | `window.sacnLog(msg, 'error')` | red entry in the sACN-IN monitor activity log (`sacn_monitor_panel.js` → `sacnInStore.pushLog`) |

The two DOM surfaces are `typeof`-guarded because they genuinely do not exist
before the GUI mounts (boot, unit tests, static host) — the console line is
never guarded, so nothing is ever swallowed. Copy names the layer that is
stale, the consequence ("the hardware will NOT follow this change") and, for
the notify case, the self-heal ("re-sends automatically when the bridge
WebSocket reconnects").

**Caller semantics — `autoSubscribePatchUniverses` moved OFF `saveAndNotify`.**
It was the only in-repo caller, and it **relied on debounce-only behaviour**
(its own comment said so). Handled explicitly: it now calls
`window.debounceAutoSave()` directly and does **not** notify.

- *Why not force the save:* auto-subscribe is an incidental side effect of a
  patch recompute. The operator runs `config.autoSave: false` precisely so
  nothing writes the scene behind his back; forcing `exportConfig()` from a
  merged universe would be a surprise full-scene save — and read-only agent
  tools that stub `debounceAutoSave` (e.g.
  `agent_tools/dmx_blackout_verify.cjs`) would have started saving scenes.
- *Why dropping its notify loses nothing:* the routes come from disk. With
  `autoSave: false` nothing was written, so the old 500 ms notify made the
  bridge re-read an unchanged file — a no-op. With `autoSave: true` the
  debounced save runs `exportConfig`, whose own post-save notify tells the
  bridge **after** the write. Strictly better in both modes; the race dies for
  this path too.
- `saveAndNotify` is kept (it is part of the `window.PatchManager` surface and
  is the correct primitive for an explicit operator-initiated patch change:
  auto-patch, clear-patch, manual patch edits) and is now correct and loud. It
  currently has no in-repo caller — noted deliberately rather than deleted.

### 2. `simulation/src/gui/gui_builder.js` (the two small touches)

- The post-save notify in `exportConfig`'s success branch is now **awaited and
  loud**: `await window.PatchManager.notifySacnBridgeLoud()`. This is the path
  that makes "a save alone is sufficient" true (`_58` §6) for both 💾 buttons
  and the debounced auto-save; it was the one place a failed notify had no
  reporter at all. `notifySacnBridgeLoud` never rejects, so the surrounding
  `catch` can still only mean "the save itself failed" — no misattribution.
  Side effect: `exportConfig()` now resolves after the bridge has been told,
  which tightens (never loosens) the S1 push ordering.
- `showSaveToast` is published as `window.showSaveToast` (same pattern as
  `window.saveModelJS` right above it) so non-GUI modules can shout through
  the operator's existing save-toast surface. Signature unchanged.

### 3. `simulation/agent_tools/dmx_blackout_verify.cjs` — comment only

Its comment described the now-removed `autoSubscribePatchUniverses →
saveAndNotify → notifySacnBridge` chain. Corrected (the null-socket shim is
kept — it still neutralises any other notify inside that throwaway browser).
No behaviour change.

### Untouched by design

- **`sacn_input_source.js:113-118`** — the WS-reconnect `setScene` re-send.
  That is the self-heal a failed notify recovers through, and the new copy
  points the operator at it.
- `led_discovery_panel.js` (S1's push flow), `sacn_bridge.js` (S3),
  `save-server.js`, `simulation/scenes/**`, `marsin_engine/**`.

## The duplicate-notify decision — KEPT, deliberately

On a successful push the bridge is notified twice (`exportConfig`'s internal
notify + the push flow's own reported step; `_61` deviation 4). **Collapsing
it was evaluated and rejected — both halves are load-bearing:**

- Removing `exportConfig`'s internal notify would break the *"save alone is
  sufficient"* guarantee for the two 💾 buttons and the debounced auto-save,
  which have no other notifier. That is `_58` order 2 — a regression.
- Removing the push's own notify would break S1's third reported step: the
  internal call's outcome is not observable to the push, and it does not run
  at all on the static-host path, so the step would become a guess.

`setScene` is idempotent (the bridge recomputes routes from disk), so the cost
stays one extra WS message. **Loudness was made non-duplicative instead** by
splitting the two entry points: save paths call the loud
`notifySacnBridgeLoud`, the push calls the quiet `notifySacnBridge` and
renders the failure itself. A push with the WS down therefore reports the same
failure once in the save toast (from `exportConfig`) and once in the push
dialog/`cm-toast` — two different surfaces, distinct DOM elements, no
clobbering, and both true.

## Tests

New focused file `simulation/tests/patch_manager_notify_ordering.test.js`
(**10 cases**, no DOM, no network, no timers relied on for correctness). A
harness swaps in a fresh `window` per case and records the ORDER of every
side effect (`save:start` / `save:end` / `ws:setScene`), which is the whole
point of the slice:

1. notify lands strictly after the save resolves `ok` — exact event order;
2. exactly one `setScene` per `saveAndNotify`, verified by waiting 700 ms
   afterwards (any surviving 500 ms timer would double it);
3. failed save → **no notify** + toast + monitor line + `console.error`, with
   the verbatim reason (`save server responded 500`) reaching the operator;
4. a save resolving with no `{ok}` is a refusal;
5. a throwing save (the duplicate `TE Sign V3` class) is captured verbatim and
   never rejects;
6. missing `window.exportConfig` → loud refusal, no notify;
7. save ok + notify failed → save reported as landed, notify loud, copy names
   the stale feed and the reconnect self-heal;
8. `notifySacnBridgeLoud` silent on success, loud on failure;
9. the quiet `notifySacnBridge` stays quiet (the push owns that reporting);
10. auto-subscribe arms the debounce unforced and performs **no** save and
    **no** notify — now or on any later timer.

`cd simulation && npm test`

| | tests | pass | fail |
|---|---|---|---|
| before (after S1) | 1111 | 1103 | 8 |
| after | 1121 | 1113 | 8 |

**+10 tests, +10 pass, failures unchanged at 8** — the known pre-existing
stale-model family, byte-identical to `_61`'s list (`fixtures are docked
beside the ship…`, `the real titanic scene can accept the block today…`,
`view-bit headroom is REPORTED…`, the two `CLI:` parity cases, and the three
`real scene …` cases). They clear on the operator's one sim re-export
(R8/item 3). Not touched.

`node --check` passes on every touched file (ES modules copied to `.mjs` in
`~/tmp/s4check/` for the check; `dmx_blackout_verify.cjs` checked in place).

## What S5 must know

- **Copy to review** (all new operator-facing strings live in
  `patch_manager.js`): the save-failure line (`scene NOT saved — <reason>. The
  sACN bridge was NOT notified (it would only re-read the stale patches.yaml);
  the hardware keeps following the old routes.`) and the notify-failure line
  (`sACN bridge NOT notified — <reason>. The bridge is still routing from the
  patches.yaml it last read: the hardware will NOT follow this change. The
  page re-sends the notify automatically when the bridge WebSocket
  reconnects.`). Both should be checked against `_57`'s contract terms
  alongside S1's dialog strings.
- **`docs/41` §4** can now state that a save notifies the bridge *after* the
  write and that a failed notify is visible (toast + sACN-IN monitor line),
  not silent.
- **Acceptance additions** for the operator-gated live run (`_58` §9.1): with
  the bridge WS deliberately down, a 💾 save must now produce a red toast + a
  red sACN-IN monitor line naming the un-notified bridge — and the LEDs must
  catch up by themselves when the WS reconnects (the untouched self-heal).
- The duplicate notify is **intended**; if a bridge log shows two `setScene`
  messages per push, that is by design (documented above), not a defect.
