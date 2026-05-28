# Design: CaptainPad Scheduler — fire effects on a timer

**Status:** Draft v3 (engine-owned, library-bound instances)
**Operator request (verbatim):**
> "Build a Scheduler tab on CaptainPad — placed right above the Dimmer Rack
> in the navigation. It runs scheduled tasks that toggle/fire effects.
> Canonical use case: *turn on the hazer for 10 seconds every 1 minute*.
> Model the UI on `DeckTransitionControls.tsx` and the autopilot transition
> timer row. **Zero keyboard input.** Pill bars and steppers only."

**v2 revision (post-design-review):**
> The scheduler MUST be MarsinEngine/server-side for MVP. CaptainPad is
> only a UI. The schedule must continue running even if the iPad is
> closed, asleep, disconnected, or unavailable. PortWatch interaction
> is deferred — out of scope for this slice.

**v3 revision (post-Phase-1):**
> The scheduler is NOT limited to the 6 (or 16) GEM slots visible on
> the deck/mixer. It can pick any effect + preset from the full effect
> library and instantiate a fresh per-task instance. Each scheduled
> task owns its own effect instance — the GEM slot pool stays reserved
> for live-performance tactile control.

## Why

On a long playa set the operator spends a meaningful slice of their
attention cuing the same support effects — re-firing the hazer every
minute or two so the lasers cut through, blipping the fogger on a slow
bar, periodically blasting UV during certain genres. Each of these is a
manual ritual that distracts from the actual mix on the deck and mixer
tabs, and it's the kind of repetition a computer is *good at*.

Crucially, the operator also needs the schedule to keep running when
the iPad sleeps. That is the v1→v2 forcing function: the engine owns
the schedule.

And the operator should not have to **burn a precious live-performance
GEM slot** on every scheduled effect. The 6 visible deck slots are
tactile real estate. Scheduled ambience is background — it should pick
straight from the library and run as its own thing. That is the v2→v3
forcing function.

Codex goal: **"be kind to the operator."** Removing a ritual *and*
not stealing tactile slots from the live mix is the right kindness
budget for this surface.

Codex P0 ("no fallback behaviors") shapes the scheduler's failure
modes: a missing effect/preset is a loud red error, not a silent
skip; a network blip mid-fire surfaces in the row's status indicator,
not a hidden retry; an off-preset duration is rejected at create
time, not clamped.

## Architecture

The scheduler is a **server-side service in MarsinEngine**. CaptainPad
is a thin UI that reads/writes the task list over REST and mirrors the
runtime status over the WebSocket. The iPad sleeping, dropping off the
network, or being closed entirely has no effect on whether scheduled
tasks fire.

Each task binds directly to an `effectId` + `presetId` from the global
effect **library** (`GET /global-effect-library`). The scheduler
resolves the library entry at fire time and dispatches the effect's
behavior (activate / deactivate, down / up, trigger). The 6 visible
GEM slots and their `GlobalEffectSlotManager` are **not** involved —
scheduled instances are independent of the live-performance slot pool.

```
┌─────────────────────────────┐         ┌─────────────────────────────┐
│   CaptainPad (Scheduler)    │  REST   │   MarsinEngine              │
│                             │────────▶│                             │
│  GET    /scheduled-tasks    │         │   • owns task state         │
│  POST   /scheduled-tasks    │         │   • persists                │
│  PATCH  /scheduled-tasks/:id│         │     scheduled_tasks.yaml    │
│  DELETE /scheduled-tasks/:id│         │   • runs ONE scheduler tick │
│  POST   .../fire-now        │         │   • resolves effectId +     │
│  POST   .../stop            │         │     presetId against the    │
│                             │         │     library at fire time    │
│                             │   WS    │   • dispatches behavior     │
│  scheduledTasks broadcast   │◀────────│     directly (no GEM slot)  │
│  (status, countdowns)       │         │                             │
└─────────────────────────────┘         └─────────────────────────────┘
```

CaptainPad runs no timers except for display countdowns derived from
`nextFireAtMs` / `firingUntilMs`. Two CaptainPads see the same list
and the same countdowns; edits from either land on the engine via
PATCH.

## Sketches

### Tab navigation (sidebar)

```
┌────────────┐
│ MIXER      │
│ DECK       │
│ STUDIO     │
│ AUDIO      │
│ OSC        │
│ MONITOR    │
│ SCHEDULER  │ ← new (calendar.badge.clock icon)
│ DIMMER     │
│ CONFIG     │
└────────────┘
```

### Scheduler tab — happy path

```
┌───────────────────────────────────────────────────────────────────┐
│ SCHEDULED TASKS                                       [+ ADD TASK] │
│                                                                    │
│ ┌────────────────────────────────────────────────────────────────┐ │
│ │ [●] HAZER          [hazer / default ▾]   ON 10s   EVERY 1m     │ │
│ │      next: 47s                              [FIRE NOW] [TRASH]  │ │
│ │     ON DURATION  [1s][2s][5s][10s ✓][15s][30s][60s]            │ │
│ │     INTERVAL     [30s][1m ✓][2m][5m][10m][15m][30m][1h]        │ │
│ └────────────────────────────────────────────────────────────────┘ │
│                                                                    │
│ ┌────────────────────────────────────────────────────────────────┐ │
│ │ [○] UV BLAST       [uvBlast / cool ▾]   ON 2s    EVERY 5m      │ │
│ │      disabled                               [FIRE NOW] [TRASH]  │ │
│ └────────────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────┘
```

- `[●]` / `[○]` enable toggle. One tap → `PATCH {enabled}`.
- `[effectId / presetId ▾]` is the **library picker**: tap → modal
  listing every effect from `GET /global-effect-library`, grouped by
  `category`, each effect expanded to its presets. Tap a preset →
  `PATCH {effectId, presetId}`. No slot indirection, no 6-slot cap.
- `ON DURATION` and `INTERVAL` reuse `TimerPillBar` from
  `DeckTransitionControls.tsx`. Pill tap → `PATCH` the field.
- `[FIRE NOW]` → `POST .../fire-now`. Useful smoke control.
- Status line shows `next: 47s` / `FIRING — 4s left` / `disabled` /
  `ERROR: <message>` straight from the server's `status` + `lastError`.

### Empty state

```
┌─────────────────────────────────────────────────────┐
│   no scheduled tasks yet                            │
│                                                     │
│   tap [+ ADD TASK] to schedule any effect from      │
│   the library to fire on a timer.                   │
│                                                     │
│   typical use: hazer 10s every 1m, blast white      │
│   2s every 5m.                                      │
└─────────────────────────────────────────────────────┘
```

### Error state — engine offline

```
┌─────────────────────────────────────────────────────┐
│  ⚠  ENGINE OFFLINE — schedule unknown                │
│  CaptainPad cannot read or edit the schedule        │
│  until the engine is reachable. The engine          │
│  continues to fire scheduled tasks on its own.      │
└─────────────────────────────────────────────────────┘
```

### Saturated state

`FlatList` virtualises. Design target: up to 20 tasks usefully
editable on iPad Pro 11". No hard cap.

## Data shape

```ts
// Engine ships this in REST/WS payloads.
export type ScheduledTask = {
  id: string;            // server-generated stable UUID
  label: string;         // operator-facing; defaults to "<effectId> / <presetId>"

  // Library binding — resolved at FIRE time, not create time.
  effectId: string;      // matches a key in GET /global-effect-library
  presetId: string;      // matches a preset key inside that effect
  params?: Record<string, number | boolean | string>;  // optional per-task overrides

  enabled: boolean;

  // MVP supports duration tasks. Schema is forward-compatible.
  mode: 'duration';

  onDurationMs: number;  // must be one of ON_DURATION_PRESETS_MS
  intervalMs: number;    // must be one of INTERVAL_PRESETS_MS

  // ── Server-owned runtime state (read-only from CaptainPad) ─────
  nextFireAtMs:    number | null;
  firingUntilMs:   number | null;
  lastFiredAtMs:   number | null;
  lastStoppedAtMs: number | null;
  status: 'disabled' | 'armed' | 'firing' | 'error';
  lastError: string | null;
  lastMissedAtMs: number | null;

  createdAtMs: number;
  updatedAtMs: number;
};
```

### Persistence

```yaml
# marsin_engine/states/<activeModel>/scheduled_tasks.yaml
scheduledTasks:
  - id: hazer-main
    label: Hazer
    effectId: hazer
    presetId: default
    enabled: true
    mode: duration
    onDurationMs: 10000
    intervalMs: 60000
  - id: uv-strobe
    label: UV Burst
    effectId: uvBlast
    presetId: cool
    params:
      intensity: 0.7
    enabled: false
    mode: duration
    onDurationMs: 2000
    intervalMs: 300000
```

Yaml is rewritten on every PATCH/POST/DELETE (atomic temp+rename).

### Preset arrays (unchanged from v2)

```ts
export const ON_DURATION_PRESETS_MS = [
  1_000, 2_000, 5_000, 10_000, 15_000, 30_000, 60_000,
];
export const INTERVAL_PRESETS_MS = [
  30_000, 60_000, 120_000, 300_000, 600_000, 900_000, 1_800_000, 3_600_000,
];
```

`POST` / `PATCH` reject off-preset values with HTTP 400 — no clamp.

### Defaults on `[+ ADD TASK]`

```ts
{
  // Server picks the first library entry's first preset (deterministic,
  // alphabetical by effectId then presetId) so the row materialises
  // with valid bindings even before the operator picks an effect.
  effectId: <first library effectId>,
  presetId: <first preset on that effect>,
  label:    `${effectId} / ${presetId}`,
  enabled:  true,
  mode:     'duration',
  onDurationMs: 10_000,
  intervalMs:   60_000,
}
```

The "hazer 10s every 1m" canonical case is one ADD + one library-
picker tap (pick hazer/default).

## Server behavior

### Effect behavior compatibility (MVP)

Every effect in the library has a `defaultBehavior` and may declare
additional supported `behaviorTypes`. The scheduler now supports all
of them — each task owns its own instance, so trigger/burst no longer
conflict with the slot pool:

| Effect behavior | Fire action  | After `onDurationMs`  |
| --------------- | ------------ | --------------------- |
| `toggle`        | `activate`   | `deactivate`          |
| `hold`          | `down`       | `up`                  |
| `trigger`       | `trigger`    | (no OFF — self-terminates) |
| `burst`         | `trigger`    | (no OFF — self-terminates) |

For `trigger` / `burst`, `onDurationMs` is operator-visible but does
not gate any OFF dispatch — it only affects the row's `FIRING — Ns
left` UI countdown. (We could hide it for trigger effects in the UI;
recommend showing it greyed-out so the row layout stays consistent.)

### Concurrent instances of the same effect+preset

**Allowed.** Two tasks pointing at the same `effectId` + `presetId`
fire as independent instances and overlap freely. The operator can
delete one if they don't want both — no implicit dedup.

### Scheduler tick

One interval tick. 250 ms cadence. On each tick:

```
for each enabled task:
  if firingUntilMs && now >= firingUntilMs:
    if behavior is toggle: dispatch deactivate(task)
    if behavior is hold:   dispatch up(task)
    if behavior is trigger/burst: no OFF dispatch
    set firingUntilMs = null, lastStoppedAtMs = now
    set nextFireAtMs  = now + intervalMs                  // interval = wait gap from OFF
    broadcast

  if nextFireAtMs && now >= nextFireAtMs:
    resolve library[effectId][presetId]
    if missing:
      set status = 'error', lastError = "effect <effectId>/<presetId> missing"
      set nextFireAtMs = now + intervalMs
      broadcast
      continue
    dispatch ON action (activate / down / trigger) with task.params merged over preset params
    set lastFiredAtMs = now, firingUntilMs = now + onDurationMs
    broadcast
```

### Disabling / deleting a firing task

If the operator disables or deletes a task while it's in its ON
window AND the effect behavior has an OFF action (toggle/hold), the
engine immediately dispatches the OFF action so the effect doesn't
strand. Trigger/burst tasks have no OFF — disable/delete just stops
future fires.

### WebSocket broadcast

```json
{"type": "scheduledTasks", "tasks": [...]}
```

Emitted on every state change (create / PATCH / delete / fire / stop
/ error). Topic-routed on `/ws/control` (registered in
`ws_topic_routing.js`).

## Engine API

```
GET    /scheduled-tasks                  → {tasks: ScheduledTask[], presets: {onDurationMs: number[], intervalMs: number[]}}
POST   /scheduled-tasks                  → {task: ScheduledTask}
PATCH  /scheduled-tasks/:id              → {task: ScheduledTask}
DELETE /scheduled-tasks/:id              → {ok: true}
POST   /scheduled-tasks/:id/fire-now     → {task: ScheduledTask}
POST   /scheduled-tasks/:id/stop         → {task: ScheduledTask}
```

`POST` body:

```json
{
  "label": "Hazer",
  "effectId": "hazer",
  "presetId": "default",
  "params": { "intensity": 0.8 },
  "enabled": true,
  "mode": "duration",
  "onDurationMs": 10000,
  "intervalMs": 60000
}
```

`PATCH` accepts any subset of operator-authored fields
(`label`, `effectId`, `presetId`, `params`, `enabled`,
`onDurationMs`, `intervalMs`). Setting `effectId` without `presetId`
is rejected (both must be supplied together — the new effect's old
preset key is meaningless).

Validation errors: HTTP 400 + `{error: "<message>"}`. Unknown id:
HTTP 404. Per codex P0, no retry-on-400 from the client.

`fire-now` arms the task immediately; the next interval re-bases off
the new `lastFiredAtMs`. If the task is already firing, the current
ON window is force-stopped before the new fire (operator-friendly
reading of "fire now means now").

`stop` force-closes the in-flight ON window (dispatches the OFF
action if behavior has one) without disabling the task. Idempotent
no-op if the task is not firing.

## Restart behavior

On engine boot:

1. Load `scheduled_tasks.yaml` (if present; else empty list — no
   creation, no synth).
2. Reconstruct runtime fields:
   - `lastFiredAtMs = null`, `lastStoppedAtMs = null`
   - `firingUntilMs = null` (never resume an interrupted ON window)
   - `lastError = null`, `lastMissedAtMs = null`
   - if `enabled`: `nextFireAtMs = Date.now() + intervalMs`, `status = 'armed'`
   - if `!enabled`: `nextFireAtMs = null`, `status = 'disabled'`
3. **Do not replay missed fires.**

## Interactions

1. **Open the Scheduler tab.** First paint from `useScheduledTasks()`
   cache (< 100 ms). Hook does `GET /scheduled-tasks` to refresh and
   subscribes to `/ws/control` for live updates.

2. **Tap `[+ ADD TASK]`.** Optimistic row at the bottom, server-
   defaults filled in. POST returns the canonical task; replace
   placeholder.

3. **Tap the library picker.** Modal listing effects by category;
   each effect expanded to its presets. Tap a preset → `PATCH
   {effectId, presetId, label}`.

4. **Tap an ON-duration / INTERVAL pill.** Optimistic; `PATCH`.

5. **Tap the enable toggle.** `PATCH {enabled}`. Disabling a firing
   row triggers the immediate OFF dispatch (if behavior has one).

6. **Tap the trash button.** `DELETE`. Same immediate-OFF semantics
   if firing. No confirmation.

7. **Tap FIRE NOW.** `POST .../fire-now`.

8. **Scheduled fire arrives (engine-internal).** Resolve library,
   dispatch, broadcast.

9. **Engine drops the WebSocket.** Banner; list freezes; edits
   disable. The engine keeps firing — banner says so.

### Latency targets

- Tab paint: < 100 ms.
- Pill tap → optimistic update: < 16 ms.
- PATCH round-trip: < 50 ms LAN; spinner only if > 200 ms.
- Fire dispatch → broadcast → UI update: < 100 ms total.

## Edges

- **Empty state**: centered help text + ADD button.
- **Loading state**: empty shell while `GET` is in flight; spinner > 300 ms.
- **Error state** (engine offline): banner; list frozen.
- **Saturated state** (20+ tasks): `FlatList` virtualises.
- **Disconnected state**: identical to engine offline.
- **Conflict state** (two CaptainPads editing same task): last PATCH
  wins; broadcast reconciles.
- **Effect removed from library while referenced by a task**: task
  persists on disk. Fires set `status: 'error'`, `lastError = "effect
  <id> missing"`. Row shows red. Operator picks a different effect or
  deletes the task.
- **Preset removed from an effect that's still in the library**: same
  failure mode — `lastError = "preset <effectId>/<presetId> missing"`.
- **Engine restart while a task is firing**: ON window dropped (no
  resume). Schedule recomputes.
- **Clock skew**: client renders countdowns off server-provided
  `nextFireAtMs`. NTP corrections invisible at 1-minute resolution.

## What it deliberately is not

- **Not a cue list.** Intervals only, not wall-clock times.
- **Not multi-step.** One effect per task; sequences are separate tasks.
- **Not a programmer.** No conditionals.
- **Not a recorder.**
- **Not slot-bound (v3).** Scheduler is independent of the 6 visible
  GEM slots. If the operator wants a scheduled effect tappable on the
  deck, that's a separate GEM slot binding — the surfaces don't share.
- **Not PortWatch-aware (MVP).** See "Later" section.
- **Not retry-on-failure.** A dispatch error logs and the next
  interval just continues.

## Open questions for the operator

1. **First-fire timing.** Default: "one interval after enable". FIRE
   NOW covers the "I want it now" case.
2. **Per-task phase offset.** Recommend wait until someone complains.
3. **Disabled-row countdown preview.** Recommend no — disabled means
   disabled.
4. **Library picker grouping.** Recommend grouping by `category` from
   the library payload (matches the existing GEM swap modal). Confirm.

## Recommended implementation path

### Phase 1 — engine scheduler service (`04.2_marsin_engine_expert`)

(In flight on `dev/claude/scheduler_engine`. v3 revision in progress.)

- `marsin_engine/lib/scheduled_tasks.js`:
  - Task list, YAML load/save, 250 ms tick.
  - Library resolution: at fire time, look up the effect in the
    engine's global effect library (same source `GET
    /global-effect-library` reads from).
  - Direct dispatch: call the engine-side effect dispatcher with
    `{effectId, presetId, action, params}`. This is the v3 change —
    drop the slot indirection.
- Endpoints in `api_server.js` (as listed).
- Persistence file: `marsin_engine/states/<activeModel>/scheduled_tasks.yaml`.
- Tests:
  - create task persists to yaml,
  - enabled task fires after `intervalMs`,
  - toggle / hold tasks send OFF after `onDurationMs`,
  - trigger / burst tasks do NOT send OFF (no double-fire),
  - disabling a firing toggle/hold task sends OFF immediately,
  - deleting a firing toggle/hold task sends OFF immediately,
  - engine restart does not replay missed fires,
  - missing effectId → `status: 'error'` and no fire,
  - missing presetId → `status: 'error'` and no fire,
  - two tasks with same effectId+presetId fire independently,
  - off-preset duration/interval → HTTP 400,
  - PATCH of `effectId` without `presetId` → HTTP 400.

### Phase 2 — CaptainPad UI (`04.1_captain_pad_expert`)

- `CaptainPad/app/(tabs)/scheduler.tsx`, mounted above `dimmer_rack`.
- `CaptainPad/hooks/useScheduledTasks.ts`.
- `CaptainPad/components/ScheduledTaskRow.tsx` with `TimerPillBar`.
- Library picker modal driven by `GET /global-effect-library`.
- API helpers in `CaptainPad/utils/api.ts`.

---

## Later — PortWatch interaction (out of MVP scope)

The PortWatch field-ops app can take a 30 s control lease over the
deck via `cmd view/deck`, raising `EngineLockoutOverlay` on
CaptainPad. The scheduler MVP **does nothing PortWatch-aware**:

- The engine keeps ticking and firing scheduled tasks regardless of
  who holds the lock.
- CaptainPad's scheduler tab is curtained by the overlay along with
  every other tab — read and write blocked from the UI.

Open for a future PortWatch-aware pass (not this slice):

- Should the engine pause the tick while the lock is held? (Probably
  no — 30 s leases shouldn't skip atmospheric cycles.)
- Should PortWatch get a read-only view of the schedule + countdowns?
- Should PortWatch be able to `stop` an in-flight ON window remotely?
