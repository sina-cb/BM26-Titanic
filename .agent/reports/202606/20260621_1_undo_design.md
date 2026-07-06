# Round-2 #10 UNDO — Design (read-only recon)

Undo the last destructive mixer action (channel delete, snapshot recall, clear, reorder) — an operator safety net.
ONE engine writer (api_server.js serial), UI after.

## Grounding (KEY)
The engine ALREADY has the exact full-mixer snapshot+restore primitives undo needs: `captureLook()` serializes
master + deck + every overlay + mixGroups into the on-disk channel shape (api_server.js:1885-1897, via
serializeChannelForState = state_manager serializeChannel), and `recallLook(look)` rebuilds the WHOLE mixer from
that shape — it CPC-unregisters + removes every overlay, rebuilds the deck never-dark (api_server.js:1955-1961), and
rebuilds each overlay through the boot-identical `restoreChannel`→`buildChannelFromSaved` path that re-compiles,
re-registers CPC (`paramCenter.registerChannel`, api_server.js:599/1539) and re-attaches playlist (:1748), restores
groups (restoreMixGroups :1904) and sets master (:1974). Destructive routes today: DELETE channel
(api_server.js:4711-4728 — unregister CPC, clearFollowersOf, removeMixerChannel, saveAllState, broadcast); snapshot
recall (POST .../recall :3930-3960 → recallLook); reorder (POST /mixer/channels/reorder :4353-4387 →
reorderMixerChannels); param-preset recall (:4065). There is NO `/mixer/clear` route today (state confirms) — if
"clear" ships it becomes another guarded mutation. DECISION: undo = a bounded ring of FULL captureLook() snapshots
taken BEFORE each destructive mutation, restored via recallLook(). recallLook is the proven, allocation-bounded,
never-dark restore (deck rebuilt explicitly); a command/inverse-op log would need a bespoke inverse per route
(restore-deleted-channel-with-CPC, un-reorder, un-recall) — strictly more code, more bug surface, for a live show.
captureLook is plain JS objects (no WASM handles captured), so a snapshot is cheap to hold and free of the dark-frame
risk (restore pays compile cost like a normal recall, which the operator already tolerates on recall).

## Model (DECISION: bounded ring of captureLook snapshots; session-only)
On PatternMixer or api_server closure: `const undoStack = []` (array as ring), `UNDO_MAX = 10` (bounded; oldest
dropped). Each entry: `{ label, look: captureLook(), atMs }`. NO redo in v1 (recommend deferring — a redo stack
adds invalidation rules; see risks). Optionally a tiny redo ring later. The stack is SESSION-ONLY (in-memory; lost
on engine restart) — DOCUMENT this: persisting it would race the on-disk state and a restart is itself a clean
"undo boundary". captureLook holds no live handles (pure serialized shape) so the ring is allocation-light.

## Choke point (single hook in api_server)
Add `function pushUndo(label)` { undoStack.push({label, look: captureLook(), atMs: Date.now()}); if
(undoStack.length > UNDO_MAX) undoStack.shift(); broadcastUndoState(); }. Call it as the FIRST line (before mutation)
in each destructive route: DELETE channel (:4711), recall (:3930) + recall-fade kickoff (:3961), reorder (:4353),
param-preset recall (:4065), future /mixer/clear. Do NOT push for fader/hue/speed PATCH (non-destructive, high
frequency — would flood the ring; explicit scope = structural mutations only). Recall-fade (morph) is in-flight at
push time: snapshot BEFORE kickoff is correct (it captures the pre-morph look).

## API
`POST /mixer/undo` → if `undoStack.length===0` return 400 UNDO_EMPTY (fail loud, NOT a silent no-op — Codex P0);
else pop, `recallLook(popped.look)`, saveAllState, broadcastMixerState + broadcastUndoState, 200 {status, label}.
`GET /mixer/undo` → `{depth, top: undoStack.at(-1)?.label || null}` for the UI button enable/label. (Defer
`POST /mixer/redo` to v2.) Reuse recallLook's existing error contract (over-cap → 400 SNAPSHOT_OVER_CAP :3953 —
shouldn't happen on a self-captured look, but surface loud).

## Serialize / WS
Undo stack: SESSION-ONLY, NOT persisted (documented above) — no state_manager change. WS: add ONE type
`undoState {type:'undoState', depth, top}` broadcast on push + undo; register it in ws_topic_routing TOPIC_BY_TYPE →
TOPICS.CONTROL (ws_topic_routing.js:63 — there is NO default topic; an unregistered type THROWS :177-181, and both
ws_topic_routing.test.js + hil_ws_topic_split_test.mjs pin the table, so the new type MUST be added there). Replay
on /ws/control connect like autopilot (api_server.js:6193). Restore itself rides the existing `mixer` broadcast.

## Tests
Unit (mixer_undo.test.js): delete→undo restores channel incl. CPC registration (assert paramCenter has the id again)
+ playlist + followLeaderId + mixGroup membership; recall→undo restores prior look exactly (deep-eq captureLook);
reorder→undo restores order; ring caps at UNDO_MAX (oldest dropped); undo on empty stack → 400 UNDO_EMPTY;
non-destructive PATCH does NOT push; depth/top reported. HIL (hil_mixer_undo): delete an overlay, POST /mixer/undo,
GET /mixer shows it back with same id+pattern+fader and it renders (vis non-zero); recall a snapshot then undo →
mix equals pre-recall; deck never dark across any undo (deck buffer non-zero every frame); empty-stack→400.

## Risks
- Undo racing a transition/morph/fade: recallLook is a HARD set (setMaster cancels in-flight fade :1972-1975;
  rebuilding overlays cancels their transitions). Acceptable + consistent (undo = "go back", animations drop).
  Document. If a morph (_morph, report 31) is mid-flight, undo must also clear it (call the morph canceller) so its
  finalizer can't fire against torn state — wire that into the undo handler.
- Undo of channel delete MUST restore CPC registration + param-center: recallLook already does via buildChannelFromSaved
  → registerChannel (:1539/599). The pre-delete captureLook captured the channel, so this is automatic — assert in test.
- Never a dark frame: recallLook rebuilds deck explicitly (never-dark, :1955-1961); restore pays normal compile cost
  (same as operator recall) off the destructive route, not the render hot path.
- Interaction w/ snapshots/param-presets: undo restores the FULL mixer look, NOT the snapshot/preset FILES on disk
  (those are separate libraries) — undo of a snapshot DELETE does NOT resurrect the file; scope undo to LIVE mixer
  state only and document (snapshot/preset file deletes are their own concern, out of v1 undo scope).
- Redo deferred: a redo stack needs invalidation on any new destructive op; defer to avoid stale-redo footguns.

## Build order / ownership
Engine writer SERIAL on api_server.js: (1) undoStack + pushUndo + broadcastUndoState + ws_topic_routing entry +
tests passing; (2) wire pushUndo into the 4 (+future clear) routes; (3) POST/GET /mixer/undo. UI AFTER: a global
UNDO button (enabled iff depth>0, labeled with top.label) calling undoApi.undo(); GET on mount + undoState WS to
keep it live.

## Citations
api_server.js:599/1539/1748/1885-1897/1904/1934-1976/1955-1961/1972-1975/3930-3960/3961/4065/4353-4387/4711-4728/
6193; state_manager serializeChannel (imported :8); snapshot_manager.js (recall source); ws_topic_routing.js:63/
65/177-181; tests: ws_topic_routing.test.js, hil_ws_topic_split_test.mjs.
