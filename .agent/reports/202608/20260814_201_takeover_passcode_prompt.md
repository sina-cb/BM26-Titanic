# _201 — CaptainPad per-attempt takeover passcode prompt

Date: 2026-08-14 · Agent `_201` · Branch `feat/bm_readiness` (shared tree) ·
Scope: `CaptainPad/**` only

Closes the single highest-priority gap flagged by
`.agent/reports/202608/20260814_200_timeline_priority_disarm.md` §5.1:

> **CaptainPad has no takeover-passcode prompt.** … Until then,
> performance-mode takeover from CaptainPad will be refused with
> `TAKEOVER_AUTH_REQUIRED`.

Operator ruling being served (2026-08-14): *"Take over in performance mode from
the timeline needs to have either of the passwords we have for Sina, Muisha, or
Sailors" … "pass code is required **EVERY TIME**."*

---

## 1. The flow

```
  any TAKE OVER affordance
        │
        ▼
  hooks/useTimeline.ts  runTakeover()  /  runPerformTakeover(cueId)
        │   reads the ENGINE-GLOBAL performance flag
        │   (getPerformanceModeState().active — NOT this device's privilege)
        ▼
  utils/takeover_passcode.ts  runGatedTakeover()
        │
        ├─ performance OFF ─────► one bodyless POST /timeline/takeover
        │                         (byte-identical to before the ruling)
        │                         …unless the engine answers TAKEOVER_AUTH_*
        │                         anyway → fall through to the prompt
        │
        └─ performance ON ──────► requestTakeoverPasscode()
                                        │
                                        ▼
                     components/takeover_passcode_host.tsx  (ONE app-wide mount)
                                        │
                                        ▼
                     components/takeover_passcode_sheet.tsx
                        operator types → submit(passcode)
                                        │
                                        ▼
                     postTimelineTakeover(body, passcode)
                        → X-CaptainPad-Passcode header on THAT request only
                                        │
                        ┌───────────────┴───────────────┐
                 TAKEOVER_AUTH_*                  anything else
                 sheet STAYS OPEN,                sheet CLOSES; result goes to
                 box cleared, engine              the caller's normal error
                 reason shown, retry              channel (or succeeds)
```

Three outcomes now, not two — `'ok' | 'cancelled' | 'failed'`. **Cancel is not
a failure**: no request is issued, the plan keeps running, and no alert fires.
That distinction is why `takeover()` / `performTakeover()` changed shape.

The reverse direction is untouched: RESUME, `/timeline/activity` and autopilot
OFF never carry a passcode and never prompt (pinned by a test).

## 2. Every takeover affordance covered

CaptainPad has exactly **two** functions that can POST `/timeline/takeover`
(`hooks/useTimeline.ts` `_takeover` / `_performTakeover`). Gating those two is
what makes the coverage exhaustive. The affordances that reach them:

| # | Affordance | Path | Covered |
|---|---|---|---|
| 1 | `PlanLockBanner` **TEMPORARY TAKE OVER** — deck tab | `takeover()` | ✅ |
| 2 | `PlanLockBanner` on the **touch-control** tab (same component) | `takeover()` | ✅ |
| 3 | `PlanLockBanner` on the **mixer** → `handleMixerTakeover` (takeover **and** switch output to mixer) | `takeover()` then `/layers/activate` | ✅ — a cancelled prompt now also skips the layer switch, so the rig is never stranded on a surface nobody took |
| 4 | **Implicit takeover** — first touch of a manual control (fader / bump / mute / solo / pattern select / deck knobs) while a plan drives the rig, via `useOperatorTakeover.notifyInteraction()` on deck **and** mixer (~20 call sites) | `takeover()` | ✅ — the existing `takeoverInFlightRef` debounce means a fader drag opens **one** prompt, not one per frame |
| 5 | Timeline **EVENT sheet → PERFORM** (scoped zoom takeover) | `performTakeover(cueId)` | ✅ |

Verified there is no third path: `activateLayerSetting` in CaptainPad only ever
targets `'deck'` / `'mixer'` (`utils/layer_settings.ts` `LayerDestination`
excludes `live_touch`), and the MIDI layer's "soft-takeover" is the unrelated
fader-pickup guard.

**Out of scope by constraint — the Live Touch ARM button.** The engine also
gates `POST /layers/setting|activate` with `target:'live_touch'` while
`controlLock === 'plan'`. That button is **not CaptainPad code**: the touch
panel is `docs/ui/touch_control.html` + `touch_control_wire.js`, served by the
sim on :6969 and embedded in the touch-control tab as an iframe; it issues its
own fetches to the engine. Wiring a passcode there means editing
`docs/ui/touch_control_wire.js`, outside this task's `CaptainPad/**` boundary.
**Until that is done, ARM-ing Live Touch against a running plan in performance
mode still fails with a raw `TAKEOVER_AUTH_REQUIRED` and no prompt.** Filed as
the follow-up in §6.

## 3. Storage audit — where the passcode lives, and for how long

**Nowhere beyond the single in-flight request.** Traced end to end:

| Location | Holds the passcode? | For how long |
|---|---|---|
| `TakeoverPasscodeSheet` local `useState` | yes, while typing | wiped on submit (before the value is handed off) **and** on close, so a re-open always starts empty |
| `TakeoverPasscodeHost` | **no** — it forwards the argument, assigns it to nothing | — |
| `utils/takeover_passcode.ts` module state | **no** — the only module-level variable is the prompt-handler reference | — |
| `postTimelineTakeover` / `timelineSend` | function argument → one `Headers` entry | the lifetime of that one `fetch` |
| AsyncStorage / `privileged_session` / any cache | **no** — never touched by this path | — |
| Logs / error bodies / analytics | **no** — a refusal shows only the engine's reason, never the attempt | — |

Deliberate omissions, all of them the point of the ruling: **no "remember"
checkbox** (unlike `PrivilegedAuthSheet`), **no session created or consumed**,
**no retry cache** (a rejected attempt clears the box), and **no reuse across
attempts** — two consecutive takeovers prompt twice. The engine already ignores
`X-CaptainPad-Session` on this route; the client now matches that honesty
instead of quietly failing against it.

The gate reads the **engine-global** performance flag, so a privileged pad
holding a live 30-minute session is prompted exactly like every other pad.

## 4. Files

**New**
- `CaptainPad/utils/takeover_passcode.ts` — refusal-code → operator-message
  mapping, the prompt broker, and `runGatedTakeover`. Pure TS (no React/RN) so
  vitest drives the whole gate. Carries the storage audit as its header comment.
- `CaptainPad/components/takeover_passcode_sheet.tsx` — the prompt. Shares
  `PrivilegedAuthSheet`'s visual idiom (modal card, secure input, error box,
  CANCEL + primary pair) and drops every persistence affordance.
- `CaptainPad/components/takeover_passcode_host.tsx` — the single app-wide mount.

**Changed**
- `CaptainPad/hooks/useTimeline.ts` — both takeovers routed through the gate;
  `TakeoverOutcome` / `PerformTakeoverResult`; `runTakeover` /
  `runPerformTakeover` exported for imperative + vitest use.
- `CaptainPad/utils/timelineApi.ts` — `timelineSend` takes optional per-request
  headers; `postTimelineTakeover(body?, passcode?)` attaches
  `X-CaptainPad-Passcode` to that one request; `TAKEOVER_PASSCODE_HEADER` export.
- `CaptainPad/components/PlanLockBanner.tsx` — alerts only on `'failed'`; the
  button reads **TAKE OVER · PASSCODE** while performance mode is live so the
  modal is never a surprise mid-show.
- `CaptainPad/app/(tabs)/mixer.tsx` — `handleMixerTakeover` honours `'cancelled'`.
- `CaptainPad/app/(tabs)/timeline.tsx` — `handlePerform` honours `'cancelled'`
  (sheet stays open, no error, no navigation).
- `CaptainPad/app/(tabs)/_layout.tsx` — mounts `<TakeoverPasscodeHost />`
  outside `<Tabs>`, next to the other floating overlays, so a prompt survives a
  tab switch.

### Accessibility / big-thumb

64pt input at 22pt type with 2pt letter-spacing, both buttons 56pt tall (the
44pt floor plus margin), 380–520pt card, `secureTextEntry` + `autoFocus` +
`autoComplete="off"`, `accessibilityRole` / `accessibilityLabel` /
`accessibilityState` on every control, `accessibilityRole="alert"` on the card
and the error box, and every colour from the theme palette (no hard-coded hex)
so it tracks light/dark like the rest of the app.

### Fail-loud (Codex P0, no fallbacks)

- No prompt host mounted → `requestTakeoverPasscode` **throws**; the caller
  returns `'failed'` and surfaces the reason. It never takes over
  unauthenticated and never silently does nothing.
- A throwing transport rejects the gate promise and closes the sheet — it can
  never hang open on a dead engine.
- Only the three engine codes (`TAKEOVER_AUTH_REQUIRED` / `_INVALID` /
  `_RATE_LIMITED`) are treated as passcode refusals. Every other engine error
  closes the sheet and goes to the normal error channel — the operator is never
  asked to retype a passcode against "portwatch owns the rig".
- The engine's rate limit is surfaced verbatim, including its `retryAfterMs`
  ("locked this device out for 30s"). No client-side lockout was invented.
- Performance mode OFF still re-checks the response: if the engine answers
  `TAKEOVER_AUTH_*` anyway (mode flipped between our state seed and the
  request), the prompt opens instead of failing silently.

## 5. Tests

**New — 35 tests across 3 files** (all placeholder passcodes; P0: no credential
material in code or tests):

- `CaptainPad/utils/takeover_passcode.test.ts` (18) — refusal-code mapping incl.
  the lockout window and the "plain engine error is not a passcode problem"
  boundary; perf-OFF sends once and never prompts; the perf-flipped-on race
  prompts; perf-ON prompts **before** any request; **two consecutive takeovers →
  two prompts, nothing replayed**; cancel = zero requests; refusal retries in
  place (one prompt, two attempts) and the reason never contains the attempt;
  cancel-after-refusal is still `cancelled`; non-auth error closes the sheet; a
  throwing transport rejects instead of hanging; **storage audit** — no module
  export and no prompt object contains the passcode after a completed flow, and
  nothing is written to console; broker readiness + loud throw with no host.
- `CaptainPad/utils/timeline_takeover_api.test.ts` (5) — the header is absent
  when no passcode is given; present (and merged with the JSON content type) on
  exactly the request that carries it, with the value **not** in the URL or
  body; it does not leak into the next takeover; `resume` / `activity` never
  carry it; the engine's 401 envelope (with `code`) surfaces verbatim.
- `CaptainPad/hooks/useTimeline_takeover.test.ts` (12) — the same matrix through
  the real `runTakeover` / `runPerformTakeover`, incl. perf-OFF bypass, prompt
  copy, two-takeovers-two-prompts, cancel = no request and not a failure, the
  invalid→valid retry with exact call ordering, the lockout message, the
  no-host-mounted loud failure, and PERFORM keeping its `{scope, cueId}` body
  while carrying the passcode.

**Suite results**

| Check | Before (baseline) | After |
|---|---|---|
| `npx vitest run` | 62 files · **1078 pass**, 6 skipped, 0 fail | 65 files · **1113 pass**, 6 skipped, **0 fail** |
| `npx tsc --noEmit` | clean | **clean** |
| `npx eslint` (touched files) | — | 0 errors; 3 `import/first` warnings, the standard `vi.mock`-hoisting idiom already used by `party_api.test.ts` etc. |

Failing lists compared: identical (empty) before and after. +35 tests, no
pre-existing test modified or weakened.

## 6. What the operator should try after restarting the stack

Both the engine (_200) and CaptainPad (this) need a restart / rebuild.

1. **Perf mode OFF, plan running** → press TEMPORARY TAKE OVER on the deck. It
   must behave exactly as it always has: no prompt, immediate takeover.
2. **Enter PERFORMANCE mode**, plan running → the banner button now reads
   **TAKE OVER · PASSCODE**. Press it: the passcode sheet opens. Press CANCEL —
   nothing happens, the plan keeps running, **no error alert**.
3. Press it again, type a **wrong** code → "Passcode rejected. Check it and try
   again."; the box clears and the sheet stays open. Type a **right** one
   (Sina / Misha / Sailors) → takeover proceeds.
4. **Immediately take over again** (RESUME first, then TAKE OVER). It must ask
   **again** — that is the ruling. A privileged pad with a live edit session
   must also be asked.
5. **Mixer**: same button on the mixer tab. Cancelling must leave the output on
   whatever the plan was driving (it must NOT switch to the mixer).
6. **Implicit takeover**: with a plan running in performance mode, touch a live
   fader — the passcode sheet opens once (not once per movement).
7. **Timeline EVENT sheet → PERFORM**: prompts; cancelling keeps the sheet open
   with no error and does not navigate to the deck.
8. **Handback is always free**: RESUME, autopilot OFF and lease expiry must
   never ask for anything.
9. **Known gap**: ARM on the Live Touch panel (the embedded touch-control page)
   against a running plan in performance mode still fails with a raw error and
   no prompt — see below.

## 7. Follow-ups

1. **Live Touch panel ARM passcode.** `docs/ui/touch_control_wire.js` must open
   its own prompt and send `X-CaptainPad-Passcode` on the ARM request when the
   engine reports performance mode. Outside `CaptainPad/**`, so not done here.
   Options: give the panel its own prompt, or bridge the request through
   CaptainPad's host over the existing `live_touch_bridge` postMessage channel.
2. **Plan-predicate duplication** (carried over from _200 §5.2) — untouched.

## 8. Shared-tree note

Every file was re-read immediately before editing; all edits surgical. No
foreign content reverted, no git operations, nothing outside `CaptainPad/**`
touched, and no live process or port (6966-6972) used — the whole verification
is vitest + tsc + eslint, which need no engine.
