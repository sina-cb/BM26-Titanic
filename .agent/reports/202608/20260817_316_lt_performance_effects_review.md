# `_316` — Live Touch Performance effects P0: Fable review (TIME-BOXED)

**Date:** 2026-08-18 · **Role:** Fable reviewer · **Read-only** (no product
code changed, no live-port writes, no git ops). Wrapped early on operator
order — token budget. Scope change mid-review: NO internal `_317` wave; the
concurrent Codex (ChatGPT) agent implements. The handoff brief below is
written self-contained for it.

## Snapshot (no churn observed during review)

| File | hash (git hash-object) | state |
|---|---|---|
| `docs/ui/touch_control_wire.js` | `e6c7c5c0` | MODIFIED by concurrent Codex (uncommitted, 21 lines) |
| `marsin_engine/lib/live_touch_session_context.js` | `dde2b5af` | clean vs HEAD |
| `marsin_engine/lib/api_server.js` | `4219d20a` | clean vs HEAD |
| `docs/ui/touch_control.html` | `de733d2b` | clean vs HEAD |

## Root-cause verdicts

**RC1 — CONFIRMED (proven).** Pre-fix `acceptPerformanceModeState()`
(`docs/ui/touch_control_wire.js:556`) ran `projectPerformanceEffectSlots()`
on `if (active)` alone (see `git diff` hunk at :562). The projection
(`:3481`) does `loadSlots(true, true)` → owner-tagged
`GET /global-effect-slots` (`req()` :290 always sends
`X-Touch-Control-Owner`). With no active session,
`LiveTouchSessionContext.ownsRequest()` (`live_touch_session_context.js:436`)
returns false → the GET is served by the durable/shared slot manager →
the canonical-16 check (`wire:3494`) throws the exact symptom string
"engine must expose the complete canonical 16 Live Touch Performance slots
9-24". Disarmed Performance must never validate owner-scoped slots.

**RC2 — CONFIRMED (real, reachable).** `begin()`
(`live_touch_session_context.js:152`) early-returns at `:160`
(`if (this.ownerId === ownerId) return this.getState()`) without reseeding
`_replaceTransientState({performanceModeActive})` (`:127`, which picks
`LIVE_TOUCH_PERFORMANCE_SLOT_CONFIG` vs `DEFAULT_SLOT_CONFIG` at `:135`).
`POST /performance-mode` ENTER (`api_server.js:14125-14182`) and EXIT
(`:14184+`) never touch `liveTouchSession`. So ARM-in-Edit → enter
Performance keeps Edit slot config; the armed wire immediately re-projects
(gate allows it) and fails the canonical check. NOTE: the early return is
load-bearing for lease renewals — `armLeaseSet()` (`api_server.js:5495`)
calls `begin()` on every renewal; the fix must resync only on a MODE CHANGE,
never wipe session state on a same-mode renewal.

## What the concurrent Codex already fixed (working tree, hash e6c7c5c0)

1. `wire:565-574` — projection gated to
   `active && (state.phase === 'arming' || state.phase === 'armed')` (RC1
   core). Residual race: gate includes `'arming'`, but the ws
   `performancemode` event can land after `setArmUiPhase('arming')` and
   BEFORE `acquireLease` (ARM order `verify → acquireLease → stage →
   assertState`, `wire:1386-1402`) — projection then still hits shared
   slots. Recommend `'armed'` only; the ARM chain's own
   `collectEffectSlotBuildOperations` (`:1190`) / `verifyPreparedSlots`
   (`:1280`) already cover the arming phase post-lease.
2. `wire:3637-3650` — `engineOnSlots()` now requires and reads
   `status.slots[].active` (authoritative slot truth; fixes overlay-rendered
   movementTrace tiles repainting OFF after a successful press).

## Remaining gaps (the handoff brief)

The full self-contained brief was delivered in the review's final message
(operator pastes it into ChatGPT). Summary of the deltas beyond Codex's two
edits: disarmed "ARM to use effects" disabled render
(`touch_control.html:6753 projectFxPerformanceMode` + grid state), tighten
gate to `armed`, engine `syncPerformanceMode()` on the session + hooks in
`POST /performance-mode` ENTER/EXIT (RC2), mode-aware `begin()` early
return, DISARM returns grid to disabled state, real-button puppeteer tests
(no `fxperformanceslots` injection shortcuts), acceptance matrix as ordered.

## Not completed (time-boxed out)

- Reading `live_touch_session_performance_authority.test.js` bodies (test
  names verified: `:108`, `:279`, `:463`; no same-owner mode-transition test
  exists — UNVERIFIED beyond names).
- Tracker append (skipped on operator order).
