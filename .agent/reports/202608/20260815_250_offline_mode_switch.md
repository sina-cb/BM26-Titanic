# _250 — Mode switching when the engine is gone, and CONFIG during a show

Two operator orders, one root complaint: **the pad can strand you on a face you
cannot leave.**

> "even when engine is down, allow me to switch between edit and performance so
> I can check the config"

> "on the ipad, without exiting from the performance mode, I cannot see the
> config, it's hidden."

Both are the same failure from two sides. Performance mode is owned by the
ENGINE and the flip is an engine route (`POST /performance-mode`), so an iPad
that cannot reach the engine has no way off the locked face — and `docs/56` D1
(+ `_228`) makes an auth-enabled engine **boot** locked, so that is the state a
cold pad lands in. Meanwhile CONFIG — the engine-address card, TEST CONNECTION,
BOOT MODE — was hidden by the very lock you would need CONFIG to escape.

Nothing engine-side changed. **Every gate is exactly where it was.**

---

## 1. What the operator gets

**A. CONFIG is reachable during a show, online or offline.**
`captainpad_tab_policy.ts`: `config.showInPerformance` → `true`, and its three
sub-views (STUDIO / MIDI / OSC) flip with it. The rail during a live show is now
DECK · MIXER · LIVE TOUCH · EVENTS · **CONFIG**.

**B. When the engine is unreachable, the mode chip becomes a LOCAL view
switch.** No passcode, clearly captioned `ENGINE OFFLINE` / `LOCAL VIEW`. It
changes what THIS iPad draws and nothing else, and it evaporates on reconnect.

---

## 2. The offline local view override — as built

### The state

`hooks/usePerformanceMode.ts` gained two module facts next to the engine cache:

```ts
let _connected = false;              // /ws/control bus status (the header's OFFLINE)
let _localOverride: boolean | null = null;   // the operator's local pick, or none
```

and one pure resolver, in `components/performance_mode_logic.ts` so vitest pins
it without transport imports:

```ts
export function resolveLocalViewOverride(engineActive, engineConnected, override) {
  const applies = !engineConnected && override !== null;
  return { active: applies ? override : engineActive, localOverride: applies };
}
```

`engineConnected === true` ⇒ the override **never** applies, whatever it holds.
That one line is the reconnect guarantee: engine truth wins the moment it is
available, and the two are never merged.

### The shape consumers see

`usePerformanceMode()` now returns `PerformanceModeView`, a strict **superset**
of `PerformanceModeState`:

- `active` — the EFFECTIVE face (override-aware while offline). Every existing
  consumer keeps reading exactly this and needs no change.
- `localOverride: boolean` — new, for UI that wants to badge the state.
- `engineOffline: boolean` — new, so the chip knows which tap path to take.

`_243`'s mixer contract (`usePerformanceMode().active` for its perf overlay) is
untouched in shape and now correctly follows the offline pick.

The dedupe guard moved from `_emit` onto the projected view (`_viewIdentity`),
so a disconnect or a local pick fans out even though the engine's own fields
did not move — and a redundant re-seed still does not re-render anyone.

### Readiness

`usePerformanceModeReady()` was the actual lock: `!ready` is treated as LOCKED
by both `app/(tabs)/_layout.tsx` and `performance_route_guard.tsx`, and the bus
dropping sets `_resolved = false`. It now answers **"does this pad have a
definite answer"**:

```ts
_resolved || (!_connected && _localOverride !== null)
```

Because of that, **the tab policy, the route guard, the deck workspace, the
mixer overlay and `usePerfLock()` needed no edits at all** — they compute
`!ready || active` and `active` exactly as before, and the offline pick flows
through. Smallest possible blast radius, which matters with `_243`/`_248` in the
same tree.

### The write

```ts
export function setLocalPerformanceView(active: boolean): void
```

Sets the override and fans out. **Throws when the engine is connected** — codex
P0, no fallbacks: with a live engine the only legitimate way to change a
globally-shared lock is the passcode-gated POST, and a silent local flip there
would be a client-side lie. The chip only routes here when `engineOffline` is
true, so the throw is a guard, not a path.

### What is deliberately NOT override-aware

`getPerformanceModeState()` still returns the raw engine state, and is now
documented as such. Its callers (`useTimeline`, `useSpecialEvents` takeover
gates, the MIDI LED projector) are all deciding **how to shape a request to the
engine**, and those decisions must be made against what the engine believes.
Two new non-hook reads, `getPerformanceModeView()` and `isPerformanceModeReady()`,
expose the presentation projection for imperative code and for the node-only
vitest env.

### Why no passcode — and why that weakens nothing

Stated in a code comment referencing `docs/56`: the credential ring lives in the
engine, so nothing could be verified offline anyway; and every gate that matters
is enforced **engine-side, per request** — the perf-exit passcode (D2), the
edit-session principal (D3), the eight D6 persistence writers. With no
connection there is no request to gate. On reconnect the engine's broadcast
immediately wins. The persistence gate is untouched, by construction: this
change adds no route, sends no request, and cannot reach the engine.

### On reconnect

In the bus status handler, before anything else:

```ts
if (s.connected) { _localOverride = null; _seedFromRest(); }
```

Discarded — never merged, never sent up, and never able to survive into a LATER
disconnect (pinned by its own test). No persistence anywhere: not AsyncStorage,
not a module survivor across reload. A reload while offline honestly starts back
on the engine's last-known face with the offline switch available again.

---

## 3. The chip (`PerformanceModeControl.tsx`)

- `busy` no longer includes `!performanceModeReady` while offline. **That
  spinner-forever-and-disabled state was the stuck chip** the operator hit.
- Offline tap → `setLocalPerformanceView(!active)`. No sheet, no passcode.
- Offline label always names the view you switch TO; the privileged `LOCK`
  variant is suppressed (with the engine down, the one thing the chip must
  offer is the way back to CONFIG). `END GLOBAL` is hidden — it POSTs.
- Caption under the chip: `ENGINE OFFLINE`, plus `LOCAL VIEW` in plan-lock amber
  once a pick is taken. Two lines so they read as one sentence and so the first
  is honest before the tap.
- **All three sheets** (`_236` exit sheet, the ENTER confirm, the privileged
  auth sheet) are `visible={… && !engineOffline}`, and an effect closes them and
  clears their errors when the bus drops — a connection loss mid-sheet must not
  leave an engine dialog on screen that can only POST into the void.
- The APC SOLO summon bus does the same local toggle offline, for the same
  reason: every sheet it can open ends in a POST.
- **Online behaviour is byte-identical.** `engineOffline` is false, every branch
  is the pre-existing one, the passcode flow is untouched.

---

## 4. CONFIG in performance mode — and the `_232` invariant

`config`, `studio`, `midi`, `osc` → `showInPerformance: true`.

The `_232` invariant test ("a sub-view is exactly as reachable as its parent")
is **kept, not relaxed** — the three sub-views flip *with* CONFIG. Justification:
they cost no rail slot either way (they are reached through CONFIG's cards), the
invariant stays a real constraint rather than a commented-out one, and every
write on those surfaces is still gated where it always was — the engine 409s
structural writes while the lock is on (`docs/56` D2/D6) and `usePerfLock()`
still greys the affordances. Hiding them froze nothing; it only hid diagnostics.

The line NOT crossed, pinned by a new test: AUDIO, TIMELINE, SCHEDULER, DIMMER
RACK and 2D SIMULATOR stay out of the performance nav. And the overlay-level
perf-hide semantics (deck PARAMETERS/AUTOPILOT windows, the mixer pixel-view
overlay) are untouched — they read `usePerformanceMode().active`, not the tab
policy, and screenshots 03/07 show them still hiding.

---

## 5. Verification

**Vitest — failing list EMPTY.** Baseline before the change: 85 files / 1706
passed / 6 skipped / **0 failed**. After: 86 files / **1791 passed** / 6 skipped
/ **0 failed**. (The delta beyond my +15 is concurrent `_243`/`_248` tests
landing in existing files during the session — file count moved by exactly my
one new file.)

New: `hooks/usePerformanceMode_offline.test.ts` (13 tests) — the pure resolver;
offline-with-no-pick stays on the engine face and stays not-ready; the offline
toggle both ways; engine state provably untouched by a pick; reconnect discards;
a later disconnect does not resurrect; a local flip while connected throws; the
online view byte-identical to the engine answer; and consumer sanity computing
the exact `!ready || active` expression the layout and route guard use against
`canMountCaptainPadRoute` + `effectiveOpenWindows`.
Plus 2 in `utils/captainpad_tab_policy.test.ts` and an updated perf-visible set.

**`tsc --noEmit`: clean. `expo lint`: 0 errors** (14 pre-existing warnings, none
in the lines I touched; the `performance_mode_logic.ts` `Array<T>` warning is
the pre-existing `_summonListeners` declaration, line-shifted by my insert).

**Screenshots** — `~/tmp/fix_250/`, fresh dist on `:7178`, served bundle hash
verified against the export (`entry-2367378e54db11c3653ee3d608e2ab4f.js`),
console muted before boot per the CaptainPad capture technique.

| File | Shows |
|---|---|
| `01_online_performance_mode_config_in_rail.png` | Live show lock, rail = DECK · MIXER · LIVE TOUCH · EVENTS · **CONFIG** |
| `02_online_performance_mode_config_open.png` | CONFIG **open during a show** — STUDIO/MIDI/OSC cards, TEST CONNECTION, AUTO-SAVE, BOOT MODE. Chip red EDIT, no offline caption |
| `03_engine_down_locked_face.png` | Engine down, locked face, deck says PERFORMANCE — PARAMS & AUTOPILOT HIDDEN. **Chip red EDIT, tappable, captioned ENGINE OFFLINE** |
| `04_local_view_edit_mode.png` | After one tap: chip amber PERF + `ENGINE OFFLINE` / `LOCAL VIEW`, full edit rail (AUDIO, 2D SIMULATOR, TIMELINE, SCHEDULER, DIMMER RACK back), deck PARAMETERS + AUTOPILOT restored |
| `05_local_view_config_reachable.png` | CONFIG open offline in local view — the whole diagnostics surface |
| `06_reconnect_engine_face_restored.png` | After simulated reconnect: rail back to the performance set, chip red EDIT, **offline captions gone — override discarded** |
| `07_mixer_engine_down_perf_overlay.png` | `_241`/`_243` mixer consumer, engine down: perf overlay on, RECALL/+SAVE/+DEFAULT/+PLAYLIST greyed |
| `08_mixer_local_view_edit_mode.png` | Same mixer after the local pick: edit chrome back. The `active` contract `_243` consumes is unchanged in shape and follows the pick |

**Engine isolation.** The operator's stack is live on `:6966-:6972` and **was
never touched — not one packet.** Both "engine up" and "engine down" are
simulated entirely inside the browser by an `evaluateOnNewDocument` shim that
serves every CROSS-ORIGIN `fetch`/`WebSocket` itself (same-origin — the dist,
fonts, assets — passes through). The "up" socket replays the engine's own
`performanceMode` connect frame; the "down" socket errors and closes, letting
the real `engineBus` backoff drive the reconnect. Scripts kept in `~/tmp/fix_250/`
(`capture.cjs`, `capture_mixer.cjs`), never in the source tree.

The `Failed to fetch (simulated)` strips visible in the shots are the shim's own
refusals surfacing through the app's normal loud-failure paths — which is itself
evidence the P0 no-fallback posture holds with no engine.

---

## 6. Files

| File | Change |
|---|---|
| `CaptainPad/components/performance_mode_logic.ts` | `resolveLocalViewOverride()`, `ENGINE_OFFLINE_BADGE`, `LOCAL_VIEW_BADGE`, `localViewChipAccessibilityLabel()` |
| `CaptainPad/hooks/usePerformanceMode.ts` | `PerformanceModeView`, `_connected` / `_localOverride`, view projection + identity dedupe, override-aware readiness, `setLocalPerformanceView()`, `getPerformanceModeView()`, `isPerformanceModeReady()`, reconnect discard |
| `CaptainPad/components/PerformanceModeControl.tsx` | Offline chip path, captions, sheet suppression, offline SOLO summon |
| `CaptainPad/utils/captainpad_tab_policy.ts` | CONFIG + STUDIO/MIDI/OSC `showInPerformance: true`, with the reasoning |
| `CaptainPad/hooks/usePerformanceMode_offline.test.ts` | New — 13 tests |
| `CaptainPad/utils/captainpad_tab_policy.test.ts` | Perf-visible set updated, 2 tests added |

No engine files. No git operations. No live ports touched.

## 7. Known follow-up (not fixed here)

While offline in the local EDIT view the `EditSessionChip` can render
`NO EDIT SESSION — NOT SAVING` from a *stale* `authRequired` seeded before the
drop (visible in shots 04/05/08). The sentence is true, and tapping it fails
loudly, so nothing is misleading — but a chip that invites a tap which cannot
succeed is worth a look. Left alone deliberately: `edit_session_chip.tsx` is
outside this scope and the honest-but-noisy state is strictly better than a
silent one.
