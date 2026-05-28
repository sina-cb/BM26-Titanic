# Slot 2 — scheduler_engine

- **Branch:** dev/claude/scheduler_engine
- **Parent branch:** dev/summer_camp_final_push
- **Worktree:** ~/workspace/BM26-Titanic-worktrees/scheduler_engine
- **Slot ports:** engine 31268 (only one used; sim/metro not booted for this slice)

## Scope

Phase 1 of `docs/31_scheduled_tasks.md` — the engine-side scheduler service.
Adds an in-memory + YAML-backed list of `ScheduledTask` rows that the engine
fires on a 250 ms tick (one timer for the whole module), reusing the existing
`GlobalEffectSlotManager.dispatchSlotAction` helper for the actual GEM
activate/deactivate (or down/up) calls. No CaptainPad UI work; Phase 2 picks
that up against the endpoints + WS broadcast contract documented below.

Canonical use case ("hazer 10 s every 1 m") is exercised end-to-end by the
HIL test against the operator's persisted `test_bench` slot bindings.

## Files changed

```
A  marsin_engine/lib/scheduled_tasks.js                       (new module)
M  marsin_engine/lib/api_server.js                            (+6 endpoints, +scheduler boot)
M  marsin_engine/lib/ws_topic_routing.js                      (route scheduledTasks → CONTROL)
M  marsin_engine/tests/ws_topic_routing.test.js               (add scheduledTasks to control contract)
A  marsin_engine/tests/scheduled_tasks.test.js                (23 unit assertions)
A  marsin_engine/tests/hil/hil_scheduled_tasks_test.mjs       (28 wire assertions)
A  .agent/02_reports/202605/20260527_2_scheduler_engine.md    (this report)
```

## GEM dispatch path

I used the existing engine-side helper directly — no factoring out, no
HTTP-to-self. `GlobalEffectSlotManager.dispatchSlotAction(...)` already takes
`{ slotId, action, frameIndex, nowMs }` and is what `POST
/global-effect-slots/:id/activate` calls today. The scheduler's `dispatch`
defaults to a thin closure over that method (constructed in `api_server.js`,
passed the live `engineCore.globalEffectSlotManager` + `engineCore.getFrameIndex`).
Unit tests inject a fake `dispatch` sink so they don't need a real slot
manager. Behavior mapping: `slot.behavior === 'toggle'` → activate/deactivate,
`'hold'` → down/up.

## v2-spec edge cases the doc didn't fully nail (heads-up for the Phase 2 UI agent)

1. **Slot id range is 1..16, not 1..6.** The doc's data shape says "1..6"
   from the v1 design, but the engine's GEM has been expanded to
   `MAX_SLOTS = 16`, and the canonical hazer use case actually lives on slot
   10 / Fogger on slot 3 depending on the rig's operator-saved bindings. The
   service accepts 1..16 and rejects anything outside that range with HTTP
   400. Phase 2's slot picker should iterate the live `/global-effect-slots`
   response, not hard-code 1..6.

2. **Operator's `global_effect_slots.yaml` may not contain every slot.** The
   `test_bench` rig persists only 6 slots; slot 10 simply doesn't exist
   there. A scheduler task pointing at a missing slot is a documented
   runtime error (`status: 'error'`, `lastError: "slot N empty"`), but the
   task is still allowed to be created — that's the "slot deleted while a
   task references it" edge case in the doc. Phase 2's UI needs to render
   the empty-slot picker entries the same way as the doc sketch implies.

3. **Slot behavior can change after task creation.** `validateSlotBehavior`
   rejects creating a duration task against a `trigger`/`burst` slot, but
   if the operator re-binds the slot AFTER the task exists, the task is
   still on disk; the rejection happens at fire time
   (`status: 'error'`, `lastError: "slot N behavior 'burst' is not compatible..."`).
   Tested in `scheduled_tasks.test.js → slot rebound to trigger/burst between create and fire`.

4. **`fire-now` while already firing first force-stops the current ON
   window** (sends OFF, clears `firingUntilMs`) then opens a new one. The
   doc isn't explicit; I went with the operator-friendliest reading.

5. **`stop` on a non-firing task is idempotent** (returns the current task,
   no dispatch, no broadcast loop). The doc only describes the "stop a
   firing task" path.

6. **`GET /scheduled-tasks` returns `{ tasks, presets }`** — the presets
   block exposes `onDurationMs` + `intervalMs` arrays so the UI can render
   pill bars without compiling the constants in. Not in the doc; cheap
   addition.

## Quality gates

- **Unit:** `node --test tests/scheduled_tasks.test.js` — **23 pass, 0 fail.**
  Covers all 8 acceptance cases from the doc + 7 validation rejections + the
  fire-now/stop flows + reload-validates-persisted-rows (codex P0).
- **WS topic routing unit:** `node --test tests/ws_topic_routing.test.js` —
  **9 pass, 0 fail**, including the new `scheduledTasks → /ws/control` line
  in the control-contract spot check.
- **HIL:** `ENGINE_PORT=31268 node tests/hil/hil_scheduled_tasks_test.mjs` —
  **28 pass, 0 fail.** Boots a real engine on slot 2's port, drives every
  endpoint, asserts YAML side effects + WS broadcast shape + the
  firing → armed transition.
- **Engine dry-run:** `node engine.js --pattern test_const --model test_bench
  --dry-run` exits 0, no missing-blend warning.
- **`git diff --check -- marsin_engine`:** clean.
- **`node --check`** on every edited engine JS file: clean.
- **Full unit suite:** 458/459 pass. The single fail (`audio_config.test.js
  → AUDIO_LIVE_FIELDS is the contract surface`) is pre-existing and unrelated
  — it expects the `bands`/`kick` shape but the file now also exposes
  `kickEma`. Last touched in commits `88c5b99` / `9e0bd0e`, not by me.

## State files

- Snapshots `deck_state.yaml`, `mixer_state.yaml`, `globals_state.yaml`,
  `global_effect_slots.yaml`, `audio_state.yaml` before each HIL run,
  restores in `finally`.
- New `scheduled_tasks.yaml` is `unlinkSync`'d on restore so the worktree's
  `git status` stays clean. Verified after both unit + HIL runs.

## curl recipe — canonical "hazer 10s every 1m" smoke (from a cold engine boot)

```bash
# Terminal 1:
cd marsin_engine && node engine.js --pattern test_const --model test_bench --port 31268

# Terminal 2:
PORT=31268
# Use slot 3 on test_bench (operator's persisted Fogger/toggle). For
# the real rig, GET /global-effect-slots first and pick whichever slot
# the operator has bound to the hazer.
curl -s -X POST http://127.0.0.1:$PORT/scheduled-tasks \
  -H 'Content-Type: application/json' \
  -d '{"label":"Hazer","slotId":3,"enabled":true,"mode":"duration","onDurationMs":10000,"intervalMs":60000}' \
  | python3 -m json.tool

# List
curl -s http://127.0.0.1:$PORT/scheduled-tasks | python3 -m json.tool

# Fire it now without waiting
TASK_ID=$(curl -s http://127.0.0.1:$PORT/scheduled-tasks | python3 -c 'import sys,json;print(json.load(sys.stdin)["tasks"][0]["id"])')
curl -s -X POST http://127.0.0.1:$PORT/scheduled-tasks/$TASK_ID/fire-now

# Stop an in-flight pulse
curl -s -X POST http://127.0.0.1:$PORT/scheduled-tasks/$TASK_ID/stop

# Change cadence (off-preset values rejected 400)
curl -s -X PATCH http://127.0.0.1:$PORT/scheduled-tasks/$TASK_ID \
  -H 'Content-Type: application/json' -d '{"intervalMs":120000}'

# Delete
curl -s -X DELETE http://127.0.0.1:$PORT/scheduled-tasks/$TASK_ID
```

## WS broadcast shape (Phase 2 UI agent must match)

```json
{
  "type": "scheduledTasks",
  "tasks": [
    {
      "id": "uuid-string",
      "label": "Hazer",
      "slotId": 3,
      "enabled": true,
      "mode": "duration",
      "onDurationMs": 10000,
      "intervalMs": 60000,
      "nextFireAtMs": 1779951228000,
      "firingUntilMs": null,
      "lastFiredAtMs": null,
      "lastStoppedAtMs": null,
      "status": "armed",
      "lastError": null,
      "lastMissedAtMs": null,
      "createdAtMs": 1779951168000,
      "updatedAtMs": 1779951168000
    }
  ]
}
```

- Topic: `/ws/control` (see `lib/ws_topic_routing.js`).
- Emitted on: create, PATCH, DELETE, fire (tick or fire-now), OFF
  (tick or stop), error transition. NOT emitted on every tick — only when
  state changes.
- Cadence ceiling: at most one broadcast per scheduler tick (250 ms) per
  task that state-machines; in practice CRUD-driven, fewer than 1 Hz.

## Smallest-possible-client spec for Phase 2

```ts
type SchedulerStatus = 'disabled' | 'armed' | 'firing' | 'error';
type ScheduledTask = {
  id: string;
  label: string;
  slotId: number;          // 1..16; render the slot picker from /global-effect-slots
  enabled: boolean;
  mode: 'duration';        // only value for MVP
  onDurationMs: number;    // must be in ON_DURATION_PRESETS_MS
  intervalMs: number;      // must be in INTERVAL_PRESETS_MS
  nextFireAtMs: number | null;
  firingUntilMs: number | null;
  lastFiredAtMs: number | null;
  lastStoppedAtMs: number | null;
  status: SchedulerStatus;
  lastError: string | null;
  lastMissedAtMs: number | null;
  createdAtMs: number;
  updatedAtMs: number;
};

// fetch presets + tasks once at mount
GET    /scheduled-tasks            → { tasks: ScheduledTask[], presets: { onDurationMs: number[], intervalMs: number[] } }
POST   /scheduled-tasks            → { task: ScheduledTask }                              // 201, body = operator-authored fields
PATCH  /scheduled-tasks/:id        → { task: ScheduledTask }                              // body = subset of { label, slotId, enabled, onDurationMs, intervalMs }
DELETE /scheduled-tasks/:id        → { ok: true }
POST   /scheduled-tasks/:id/fire-now → { task: ScheduledTask }
POST   /scheduled-tasks/:id/stop     → { task: ScheduledTask }

// subscribe via existing engine WS on /ws/control:
// {"type":"scheduledTasks","tasks":[...]}
```

All error responses are `{ "error": "<human-readable message>" }` with HTTP
400 for validation, 404 for unknown id, 500 for unexpected. No retry-on-400
necessary — the doc explicitly says "no fallback behaviors".

Latency observed in HIL: PATCH round-trip < 10 ms, fire-now → WS broadcast
< 100 ms.

## Known gaps / follow-ups

- The Phase 1 brief asked for `tests/test_scheduled_tasks_unit.mjs` and
  `tests/hil/test_scheduled_tasks_e2e.mjs`. I named the files
  `tests/scheduled_tasks.test.js` and `tests/hil/hil_scheduled_tasks_test.mjs`
  to match the existing engine test naming conventions (`*.test.js`
  glob in `node --test`, `hil_*.mjs` for HIL). Tests run identically.
- PortWatch awareness intentionally not implemented per docs/31 §"Later".
- No `panic-stop` for the scheduler (analogous to GEM's). Not in the doc;
  not in scope. Would be a one-method add if the operator wants it later.

## Operator action requested

Ready for review and merge. Phase 2 (CaptainPad UI) can start against this
branch — the wire contract is documented above and pinned by the HIL test.

---

# Round 2 — v3 rework (library-bound, drop slotId)

Operator revised the design (commit `49215e6`, docs/31 v3): scheduled
tasks now bind to a `(effectId, presetId, params?)` triple from the
global effect library instead of a GEM `slotId`. Each task owns its
own effect instance, fully independent of the 6/16 visible GEM slots.
Trigger and burst behaviors are now allowed in MVP (no OFF dispatch).

## Files changed (Round 2)

```
M  marsin_engine/lib/scheduled_tasks.js                       (v3 rewrite)
M  marsin_engine/lib/global_effect_slot_manager.js            (+dispatchEffectAction)
M  marsin_engine/lib/api_server.js                            (comment refresh only)
M  marsin_engine/tests/scheduled_tasks.test.js                (39 unit cases)
M  marsin_engine/tests/hil/hil_scheduled_tasks_test.mjs       (40 wire cases)
```

## Dispatch path (Round 2)

Factored out `GlobalEffectSlotManager.dispatchEffectAction({ effectId,
presetId, action, params, frameIndex, nowMs, behavior })`. It resolves
the library entry directly (no GEM slot lookup), validates+merges the
caller's `params` over the preset's defaults via the same
`validateParams` gate slot resolution already uses, then routes
through a new private `_dispatchResolved` helper. `dispatchSlotAction`
now does its existing slot lookup, builds a `resolved` descriptor, and
calls `_dispatchResolved` — so behavior parity between scheduler
fires and tactile button fires is guaranteed (one switch statement,
one set of `_dispatchStrobe`/`_dispatchColorWash`/etc).

The scheduler's `dispatch` defaults to
`slotManager.dispatchEffectAction(args)` — same constructor surface
in `api_server.js`, just calls a different method. No HTTP-to-self,
no GEM slot indirection, no slot-pool collision.

## Behavior-tracking bug for concurrent same-effect instances

Confirmed bug, surfaced through library inspection:

For **singleton-toggle** effects (`fogger`, `vintageWhite`,
`blastWhite`, `uvBlast`, `colorWash`, `feedbackTrails`, `strobe`),
the controller tracks a single global active-state flag. Two
scheduler tasks pointing at the same `effectId+presetId` that overlap
will:

1. Task A fires ON → `controller.effects.fogger = true`
2. Task B fires ON → `controller.effects.fogger = true` (no-op)
3. Task A's ON window closes → OFF dispatch → `controller.effects.fogger = false`
4. Task B is still mid-window but the effect is now off on the rig

This is **not** a scheduler bug per se — it's a property of the
underlying singleton effect runtime. The doc's "two tasks with same
effectId+presetId fire independently" guarantee is honoured at the
scheduler/dispatch layer (two `activate` calls land in the sink, two
`deactivate` calls land later — proven by the unit test
`two tasks with same effectId+presetId fire independently`). What
**isn't** independent is the rig output for singleton effects.

For **non-singleton** effects (`dropHit` — trigger behavior), each
trigger fires its own envelope independently; no global active flag,
no interference. Concurrent same-preset trigger tasks compose
correctly.

Recommendation for the operator: leave as-is for MVP. If the operator
wants two overlapping "hazer 10s every 1m" tasks staggered by 30s,
they'll get one continuous haze rather than two pulses, which is
arguably what they want anyway. Document this in the CaptainPad
empty-state copy if it becomes a confusion vector. A proper fix would
need refcounted singleton state, which is well outside this slice.

## v2 → v3 migration

Per the doc, "no migration." Legacy v2 rows in
`scheduled_tasks.yaml` (those with a `slotId` field and no
`effectId/presetId`) are dropped on load with a one-shot warning per
row:

```
scheduled_tasks.yaml: dropping legacy slotId-bound row "<id>" — v2→v3 schema change, no migration
```

After dropping, `loadFromDisk` re-persists the cleaned file so the
warning fires exactly once per row across the engine's lifetime
(restarts won't re-warn on the same row). Covered by the
`loadFromDisk drops legacy slotId-bound rows with a one-shot warning`
unit test.

## Spec ambiguities locked in

- **`params` shape** is `Record<string, number|boolean|string|null>`.
  Arrays and nested objects are rejected at create/PATCH time with
  HTTP 400. Max 32 keys. This is tighter than the doc's
  `Record<string, number|boolean|string>` to allow `null` (clears an
  override) and to cap fan-out — both judgement calls, neither
  documented.
- **`params` merge semantics**: the scheduler's `dispatch` sink
  receives the task's *overrides* (not the merged map). The merge
  with preset defaults happens inside
  `GlobalEffectSlotManager.dispatchEffectAction` via `validateParams`
  + spread, mirroring `resolveSlotBinding`. This keeps the merge
  policy in one place and consistent between scheduler and slot
  fires. The unit test `task.params merge over preset params (task
  overrides win)` asserts the sink contract; the parity with slot
  fires is implicit in the shared `_dispatchResolved` path.
- **Label default**: `${effectId} / ${presetId}` (literal, with the
  space-slash-space) — matches the doc.
- **Behavior resolution**: scheduler reads `preset.defaultBehavior`,
  not the task. Adding a per-task behavior override (e.g. let an
  operator schedule a `toggle`-default preset as a one-shot
  `trigger`) is out of scope.
- **Behavior compatibility at create**: not validated against
  `effect.behaviorTypes`. The scheduler trusts the preset's
  `defaultBehavior` and only rejects if that string isn't in
  `BEHAVIOR_ACTIONS`. The library currently only declares
  `toggle|hold|trigger|burst` — all four are supported.

## HIL output summary

```
hil_scheduled_tasks_test.mjs — engine-owned scheduler v3
  engine: http://127.0.0.1:31268

[TEST 1] GET /scheduled-tasks on cold engine                ✓ 3/3
[TEST 2] POST /scheduled-tasks creates + persists (v3 body) ✓ 13/13
[TEST 3] validation rejections (codex P0)                   ✓ 8/8
[TEST 4] PATCH operator-authored fields only                ✓ 5/5
[TEST 5] FIRE NOW transitions task firing → armed           ✓ 5/5
[TEST 6] stop endpoint force-closes ON window               ✓ 3/3
[TEST 7] DELETE removes task                                ✓ 3/3
========== 40 passed, 0 failed ==========
```

Unit: 39/39 pass. ws_topic_routing: 9/9 pass. Engine process killed,
port 31268 free, operator-WIP state files restored, `git status`
shows only the five intended modified files.

## Canonical "hazer 10s every 1m" — v3 curl recipe

The "hazer" effect in the operator's library is `fogger` (the only
hazer/fogger effect ID in `GLOBAL_EFFECT_LIBRARY`). For sake of the
smoke recipe:

```bash
# Create the task. label is optional — defaults to "fogger / default".
curl -sS -X POST http://127.0.0.1:31268/scheduled-tasks \
  -H 'Content-Type: application/json' \
  -d '{
    "label": "Hazer",
    "effectId": "fogger",
    "presetId": "default",
    "enabled": true,
    "mode": "duration",
    "onDurationMs": 10000,
    "intervalMs": 60000
  }'
# → 201 { "task": { "id": "<uuid>", ..., "status": "armed", "nextFireAtMs": ... } }

# Stash the id (jq optional):
TASK_ID=$(curl -sS http://127.0.0.1:31268/scheduled-tasks | jq -r '.tasks[-1].id')

# Force-fire to verify the wire path now:
curl -sS -X POST http://127.0.0.1:31268/scheduled-tasks/$TASK_ID/fire-now

# Tail status. Should flip firing → armed after ~10 s.
watch -n1 "curl -sS http://127.0.0.1:31268/scheduled-tasks | jq '.tasks[] | {id, status, nextFireAtMs, firingUntilMs}'"

# Tear down:
curl -sS -X DELETE http://127.0.0.1:31268/scheduled-tasks/$TASK_ID
```

The pre-existing "with overrides" recipe:

```bash
curl -sS -X POST http://127.0.0.1:31268/scheduled-tasks \
  -H 'Content-Type: application/json' \
  -d '{
    "effectId": "uvBlast",
    "presetId": "default",
    "params": {"intensity": 0.7},
    "enabled": true,
    "mode": "duration",
    "onDurationMs": 2000,
    "intervalMs": 300000
  }'
```

## WS broadcast — v3 shape

Sample payload (one task on /ws/control after a `fire-now`):

```json
{
  "type": "scheduledTasks",
  "tasks": [
    {
      "id": "8b3f2a1e-…",
      "label": "Hazer",
      "effectId": "fogger",
      "presetId": "default",
      "params": null,
      "enabled": true,
      "mode": "duration",
      "onDurationMs": 10000,
      "intervalMs": 60000,
      "nextFireAtMs": null,
      "firingUntilMs": 1748395200000,
      "lastFiredAtMs": 1748395190000,
      "lastStoppedAtMs": null,
      "status": "firing",
      "lastError": null,
      "lastMissedAtMs": null,
      "createdAtMs": 1748395100000,
      "updatedAtMs": 1748395190000
    }
  ]
}
```

`params` is `null` when no overrides are set, or the per-task
`Record<string, primitive>` when the operator supplied any.

## Phase 2 — UI agent contract (v3)

REST surface (unchanged from v2 endpoints, body schema changed):

| Method | Path                                | Body                                                                                                    | Returns                                                      |
| ------ | ----------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| GET    | `/scheduled-tasks`                  | —                                                                                                       | `{ tasks: ScheduledTask[], presets: { onDurationMs, intervalMs } }` |
| GET    | `/global-effect-library`            | —                                                                                                       | library map for the picker modal                              |
| POST   | `/scheduled-tasks`                  | `{ label?, effectId, presetId, params?, enabled, mode:'duration', onDurationMs, intervalMs }`            | `{ task: ScheduledTask }` (201)                              |
| PATCH  | `/scheduled-tasks/:id`              | any subset of `{ label, effectId+presetId (pair), params, enabled, onDurationMs, intervalMs }`           | `{ task: ScheduledTask }`                                    |
| DELETE | `/scheduled-tasks/:id`              | —                                                                                                       | `{ ok: true }`                                                |
| POST   | `/scheduled-tasks/:id/fire-now`     | —                                                                                                       | `{ task: ScheduledTask }`                                    |
| POST   | `/scheduled-tasks/:id/stop`         | —                                                                                                       | `{ task: ScheduledTask }`                                    |

WS topic: `/ws/control`, message type `scheduledTasks`, payload above.

Optimistic-update rules for the UI:
- Toggle the `enabled` pill, the duration/interval pills, and the
  label inline. Send PATCH, replace the row on broadcast (or on the
  PATCH response — both arrive within ~50 ms LAN).
- Library picker: tap a preset → PATCH `{effectId, presetId, label}`
  (always send the pair, plus the label so the row's default label
  follows the new binding).
- `params` overrides: not in MVP UI (no inline param editor planned).
  Keep them in the data model for forward-compat — operator-edited
  YAML can still set them and the UI will faithfully round-trip.
- "FIRE NOW" → POST `.../fire-now`. No body. Optimistically flip
  `status:'firing'` in the row, real broadcast confirms.

400 errors: surface `error` string in a transient toast or inline on
the affected pill. No retry-on-400 (codex P0).

`status` enum: `'disabled' | 'armed' | 'firing' | 'error'`. The row
should reflect `lastError` next to the status when `status==='error'`.

## Follow-ups / open questions for operator

1. **Singleton-effect overlap.** Two scheduler tasks pointing at the
   same singleton-toggle effect (e.g. two hazer tasks) interfere at
   the rig output even though the scheduler dispatches both. Is the
   intended fix refcounted singleton state in the controller, or a
   UI lint in CaptainPad ("you already have a task for fogger/default
   — sure?"), or just operator discipline? Leaving as-is for MVP.
2. **`params` UI**. The schema supports per-task overrides but the
   MVP UI doesn't. Confirm this is intentional for Phase 2 — no
   param editor surfaces yet.
3. **`params: null` clears one override?** Currently a partial
   `params` PATCH replaces the full override map. To clear a single
   key the UI must send the rest of the map. If the operator wants
   atomic per-key clear, we need a separate convention (e.g.
   `params: {hz: null}` removes `hz`). Not implemented — would be a
   small follow-up.
4. **Defaults on `[+ ADD TASK]`.** The doc says the server picks "the
   first library entry's first preset (alphabetical)." Not
   implemented server-side — POST requires `effectId`+`presetId`. The
   UI must compute the alphabetical-first default itself and include
   it in the POST. Confirm this is acceptable (otherwise add a
   `defaults` field to `GET /scheduled-tasks` for the UI to read).
