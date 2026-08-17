# _202 — Live Touch ARM operator-passcode prompt

Date: 2026-08-14 · Agent `_202` · Branch `feat/bm_readiness` (shared tree) ·
Scope: `docs/ui/**` + `simulation/tests/**`

Closes the gap flagged by
`.agent/reports/202608/20260814_201_takeover_passcode_prompt.md` §7.1 (itself
the residue of `_200` §5.1):

> **Live Touch panel ARM passcode.** `docs/ui/touch_control_wire.js` must open
> its own prompt and send `X-CaptainPad-Passcode` on the ARM request when the
> engine reports performance mode. Outside `CaptainPad/**`, so not done here.

Operator ruling being served (2026-08-14): *"Take over in performance mode from
the timeline needs to have either of the passwords we have for Sina, Muisha, or
Sailors" … "pass code is required **EVERY TIME**."*

This is the **third and last** surface that can seize a running plan. The engine
gate landed with `_200`; CaptainPad's prompt with `_201`; the sim-served Live
Touch panel is this one.

---

## 1. Affordance audit — what the engine's gate can refuse, and what is covered

The gate is `checkTakeoverPasscode` (`marsin_engine/lib/api_server.js:4026`).
It fires only when `performanceMode.active && captainPadAuth.required`. Three
call sites exist; the Live Touch surface can reach **two** of them:

| # | Engine call site | Reachable from this surface? | Covered |
|---|---|---|---|
| 1 | `POST /timeline/takeover` (`api_server.js:8228`) | **No** — the panel never calls `/timeline/*`. That is CaptainPad's affordance, covered by `_201`. | n/a |
| 2 | `POST /layers/activate` with `target:'live_touch'` while `currentControlLock() === 'plan'` (`api_server.js:10373`) | **Yes — this is the ARM button.** | ✅ prompt + one retry |
| 3 | The IMPLICIT re-takeover inside `noteLiveTouchTimelineActivity` (`api_server.js:5223`), mapped onto ANY successful owner-tagged mutation by the response wrapper at `:5332` | **Yes**, in principle, for every `req()` this page issues while armed | ✅ reported, deliberately not prompted — see §1.2 |

### 1.1 Every request this page makes, classified

`docs/ui/touch_control_wire.js` reaches the engine through exactly four
entry points: `requestJson` (raw), `req` (owner-tagged), `unownedReq`, and one
`keepalive` fetch in the `pagehide` handler. Every `/layers/activate` call site
was enumerated:

| Call site | Target | Owner-tagged | Gate can refuse | Treatment |
|---|---|---|---|---|
| `armLiveTouch` → `activate` (`:1004`) | `live_touch` | yes | **YES** | routed through `takeoverGatedReq` |
| `handbackLiveTouch` (`:1016`) | deck / mixer | yes | no — the reverse direction is never gated | unchanged |
| `abortArm` cleanup (`:464`) | deck | yes | no | unchanged |
| `drainSurfaceRelease` idle route sync (`:997`) | deck / mixer | **no** | no | unchanged |
| `pagehide` keepalive (`:1160`) | deck | yes | no | unchanged |

So **ARM is the only takeover-equivalent affordance on this surface**, and it is
the only request routed through the gate. That is not an assumption: the test
`only an owner-tagged live_touch activation is routed through the gate` pins the
branch, and `the passcode header is attached to exactly one request and nothing
else` pins that exactly one call site in the whole file can supply a passcode.

### 1.2 The implicit re-takeover — audited, covered, deliberately not a modal

Path 3 refuses a *performance write* (a fader mid-drag, a colour wheel), not a
takeover gesture. Three reasons it does not open a sheet:

1. **The engine says so.** Its own comment: "a background mutation cannot supply
   [a passcode] … so it is refused and the caller is told to make an explicit
   takeover gesture."
2. **A modal raised by a fader movement is worse than the error.** These writes
   are coalesced at 10/sec; several can be in flight at once.
3. **After `_200` the path is nearly unreachable.** Resume and lease expiry now
   force-disarm Live Touch, and `armLeaseClear` clears
   `liveTouchTimelineTakeoverOwner` (`api_server.js:5063`) — which is the
   precondition `noteLiveTouchTimelineActivity` checks first.

It is still handled, loudly and without fallback: `describeTakeoverRefusal()`
converts the refusal into *"the timeline holds the rig and performance mode is
live — press ARM to take over with an operator passcode (<engine reason>)"* on
the wire's error toast. Nothing degrades, nothing retries, and the operator is
pointed at the one gesture that CAN answer the challenge — which lands on the
covered path.

---

## 2. The flow

```
  ARM tap
    │
    ▼  TouchControlLifecycle.arm → verify → lease → stage → assert → ACTIVATE
  activateLayerSetting('live_touch', 'live_touch_arm', true)
    │
    ▼  takeoverGatedReq  →  TouchControlPasscode.runGatedRequest(send, prompt, what)
    │
    ├─ send(null) resolves ────────────► ARMED. Byte-identical to before the
    │                                    ruling (performance mode OFF).
    │
    └─ send(null) rejects with TAKEOVER_AUTH_* ─────► prompt.ask()
                                              │
                       ┌──────────────────────┴──────────────────────┐
                    CANCEL                                    passcode typed
                       │                                              │
              no retry, sheet closed,                    send(passcode) — ONE
              chain rejects with                         request, one header
              takeoverCancelled → abortArm               │
              → cleanup → lease release      ┌───────────┴───────────┐
              → DISARMED                  ok │                       │ TAKEOVER_AUTH_*
                                    sheet closes,          sheet STAYS OPEN, box
                                    ARM continues          cleared, ENGINE's reason
                                                           shown, next submit = next
                                                           single retry
```

`send(passcode)` is called **exactly once per submission** — that shape is what
makes "the header rides exactly one retry" provable rather than hopeful, and it
is asserted directly.

A non-passcode failure after a valid passcode (e.g. `423 PortWatch owns the
rig`) closes the sheet and surfaces normally: the operator is never asked to
retype a passcode against a problem a passcode cannot fix.

**Mid-flight mode flip.** The panel never reads a performance-mode flag; the
only signal is the refusal itself. A mode flip between the ARM tap and the
activation therefore lands in the same branch and **prompts** rather than
failing silently. There is no client-side mode cache to go stale.

---

## 3. Storage audit — where the passcode lives, and for how long

**Nowhere beyond the single in-flight request.**

| Location | Holds it? | For how long |
|---|---|---|
| the prompt's `<input>` | yes, while typing | wiped by `takeValue()` the instant it is read — on submit, on cancel, and on close, so a re-open always starts empty |
| `runGatedRequest` | **no** — a function argument in one `.then` closure; never assigned to module state | the retry's promise |
| `touch_control_passcode.js` module scope | **no** — the only module state is `REFUSAL_CODES`, `HEADER` and two pixel constants | — |
| `touch_control_wire.js` module scope | **no** — `passcodePrompt` holds the *element factory result*, never a value | — |
| `requestJson` | function argument → one `Headers` entry | the lifetime of that one `fetch` |
| localStorage / sessionStorage / IndexedDB / cookies | **no — never touched** | — |
| URL / query string | **no** | — |
| `postMessage` to the CaptainPad parent | **no** | — |
| logs, the error toast, the refusal text | **no** — a refusal shows only the engine's words | — |

Enforced by tests, not just by inspection: a completed refuse→retry→succeed flow
asserts the module's `localStorage`/`sessionStorage` stubs recorded **zero**
accesses and `console` recorded **zero** calls; a source audit asserts neither
file *calls* a storage API, that the gate module never calls `postMessage`, that
no `postMessage` block in the wire mentions a passcode, and that nothing writes
it into a URL.

Deliberate omissions, all of them the point of the ruling: **no "remember"
affordance, no session created or consumed, no retry cache, no reuse across
attempts.** Two ARMs prompt twice (pinned by a test).

---

## 4. Iframe findings — verified in a real nested browsing context

The panel runs inside an iframe in CaptainPad's touch-control tab, so the prompt
was driven in a **real Chromium child frame** (offline harness in `~/tmp/fix_202/`;
the gate module only, a faked transport, **no engine contact and no use of
6966-6972** — the coordinator's live stack was never touched):

- **Renders inside the iframe.** `#takeoverPasscode` exists in the child
  document; the parent document has **no** such element. The passcode never
  reaches the parent frame.
- **The parent received zero `postMessage`s** across the whole refuse → type →
  submit → succeed → second-ARM → cancel sequence.
- **Focus works in the frame.** `document.activeElement` is the input right
  after `ask()`, and real keyboard input (`page.keyboard.type` + `Enter`)
  reached it and submitted.
- **On-screen keyboard caveat (iPadOS).** iOS does not reliably raise the
  soft keyboard for a programmatic `focus()` that is not inside the original
  touch gesture — and this prompt necessarily opens *after* an async refusal.
  Mitigated rather than assumed away: the input is a **72 px** target with the
  printed hint *"Tap the box to bring up the keyboard."*, so one tap is always
  enough. **This is the one thing worth checking on the real iPad.**
- **Stacking.** The overlay is `position:fixed; inset:0; z-index:100000` and
  measured as covering the full iframe viewport — above the Spatial fullscreen
  panel (`z-index:1000`, which also sets `#shell.inert = true`) and above the
  wire's error toast (`9999`). It is appended to `document.body`, outside
  `#shell`, so it is never inert.
- **Geometry.** input 72 px, both buttons 64 px, card ≤ 560 px. Secure input
  (`type="password"`), `autocomplete/autocapitalize/autocorrect="off"`,
  `spellcheck="false"` — no autofill, no suggestion strip, no manager capture.
- **Theme.** Every colour is a panel CSS token (`--panel`, `--bg-elevated`,
  `--border`, `--text`, `--live`/`--live-ink` for the primary button), so it
  tracks the CaptainPad theme bridge (`touch_control_theme.js`) in embedded mode
  and the standalone dark palette otherwise. The error box reuses the wire's
  existing failure-toast language (`rgba(40,8,12,.96)` / `#ff8f8f`) so a refusal
  reads as the panel's own voice.

**Abandoned prompts cannot hang the ARM chain.** A `pageshow` bfcache
cancellation and `forceDisarmedUi()` (the timeline force-disarm from `_200`, the
deadman revert, every abort) both call `closeTakeoverPrompt()`, which resolves
the pending `ask()` as a cancel. Without that, a page invalidated while the
sheet was open would have parked the activate step on an operator who is no
longer there — the lifecycle's `isCancelled` guard only runs *between* steps.

---

## 5. Files

**New**
- `docs/ui/touch_control_passcode.js` — `window.TouchControlPasscode`: refusal
  classification, operator-message mapping, `runGatedRequest`, and the DOM
  prompt. Same module idiom as `touch_control_lifecycle.js` (frozen namespace on
  `window`, no imports, drivable from `node:vm`), which is what makes the gate
  testable without a browser. Carries the storage audit as its header comment.

**Changed (all surgical, all re-read immediately before editing)**
- `docs/ui/touch_control.html` — one line: loads
  `touch_control_passcode.js` beside `touch_control_lifecycle.js`, before the
  cache-busted wire.
- `docs/ui/touch_control_wire.js`
  - `requestJson(method, path, body, ownerTagged, passcode)` — optional 5th
    argument attaches `X-CaptainPad-Passcode` to that one request; the `!r.ok`
    branch now tags takeover refusals onto the thrown error via
    `refusalFromResponse`.
  - `passcodeModule()` — loud accessor; a missing module is reported, never
    degraded around.
  - `takeoverGatedReq()` + `takeoverPrompt()` + `closeTakeoverPrompt()` — the
    gate, its lazy single prompt, and the external teardown.
  - `describeTakeoverRefusal()` + one line in `write()` — the implicit-path
    message (§1.2).
  - `activateLayerSetting()` — `target === 'live_touch' && ownerRequired` routes
    through the gate; every other direction keeps its existing transport
    verbatim.
  - `armLiveTouch()` — refuses **before** acquiring the deadman lease if the
    gate module did not load.
  - `forceDisarmedUi()` and the `pageshow` `cancel_arm` branch — close an
    abandoned prompt.
- `simulation/tests/touch_control_passcode.test.js` (new).

No CaptainPad file, no engine file, and nothing under `scenes/`, `states/` or
`patterns/` was touched. `docs/ui/touch_control_wire.js` is the other session's
file: every edit was re-read first, kept inside the existing structure and
comment idiom, and no foreign content was reverted.

---

## 6. Tests

`simulation/tests/touch_control_passcode.test.js` — **25 tests**, following the
sim suite's `node:test` + `node:vm` idiom (the same one
`marsin_engine/tests/effects/touch_control_wire_layers_contract.test.js` uses
for `touch_control_lifecycle.js`). No jsdom was vendored (offline readiness): a
~40-line DOM stub implements exactly the surface the prompt touches, which also
documents that surface.

P0 — **no credential material.** Both passcodes are literal placeholders
(`placeholder-accepted-code` / `placeholder-rejected-code`) injected through the
`send`/`prompt` test seams; the real principals live only in the external
`$BM26_SECRETS` file and are never needed, because the transport is faked.

Coverage:

- **Classification (2):** the three engine codes on 401/429 only; a
  `LAYER_SETTING_LOCKED` 423, a code-less 401, a wrong-status body and
  non-JSON are all **not** passcode problems; messages carry the engine's reason
  and the lockout window, never the attempt.
- **The gate (9):** mode-off passthrough (one request, no prompt); the
  mid-flight mode flip prompts; **auth-required → prompt → header rides exactly
  one retry**; **two ARMs → two prompts, nothing replayed**; **cancel = zero
  retries** and a `takeoverCancelled` error, not a fault; a rejection keeps ONE
  sheet open across two attempts with the engine's reason and never echoes the
  attempt; cancel-after-rejection is still a cancel; a non-auth error closes the
  sheet and surfaces; **no prompt available → loud refusal, never proceeds
  unauthenticated**.
- **Storage (2):** a completed flow touches no `localStorage`/`sessionStorage`
  and logs nothing, and no module export stringifies to contain either
  placeholder; source audit for storage calls, `postMessage`, and URL writes
  across the gate **and** the wire.
- **The rendered prompt (6):** secure input + no-autofill attributes + dialog
  ARIA; big-thumb floors (input ≥ 64, buttons ≥ 56) asserted against the actual
  inline styles; `z-index:100000`; creating the prompt does not attach it; the
  box is wiped on submit / cancel / close and the sheet detaches on close;
  REQUIRED explains while INVALID paints the error box; Enter submits, Escape
  cancels, an empty submit is refused in place; closing resolves a pending ask
  as a cancel; a second concurrent ask throws; a body-less document throws.
- **Wire + panel wiring (6):** the panel loads the gate before the wire; only an
  owner-tagged `live_touch` activation is gated while handback keeps the plain
  transports; the header rides exactly one call site; ARM refuses loudly (and
  **before** the lease) without the module; `forceDisarmedUi` and `pageshow`
  both tear the prompt down; the background-write path points at ARM.

### Suite results

Baseline measured **first**, on this shared tree (it is dirty from other
sessions, so HEAD is not the baseline — the measured failing list is):

| Suite | Baseline | After |
|---|---|---|
| `simulation` — `node --test tests/*.test.js` | 7 fail | **2274 tests, 2266 pass, 7 fail** |
| `marsin_engine` — `tests/effects/touch_control_*` | 32 pass, 0 fail | **32 pass, 0 fail** |
| `node --check` on both touched JS files | — | clean |
| `python scripts/security_check.py --all` | 6 findings | **6 findings — identical** |

**Failing lists compared and identical.** All 7 sim failures are pre-existing and
unrelated to this change — they belong to another session's scene/fixture work in
this tree: `_176 §5.3 … REFUSED`, `fixtures are docked beside the ship`,
`REFUSES: a patched fixture no chain reaches`, `the real titanic scene can accept
the block today`, two `emit_block` CLI tests, and `Live display orientation is a
pure projection of authoritative 3D coordinates`. +25 tests, no pre-existing test
modified or weakened.

The 6 security findings are all MAC addresses in gitignored
`simulation/.scene_backups/studiodj/**` — pre-existing, none from these files.

`tsc` is n/a (plain browser JS). No live process was started; the coordinator's
stack on 6966-6972 was never contacted.

---

## 7. What the operator should try after restarting the stack

The engine (`_200`) already carries the gate; this reaches the panel when the
**sim** is restarted (or the iframe is reloaded — `touch_control.html` itself is
cached, and it is the file that now loads the new script).

1. **Performance mode OFF, plan running** → press ARM on the Live Touch panel.
   Unchanged: no prompt, the takeover proceeds exactly as it always has.
2. **Enter PERFORMANCE mode, plan running** → press ARM. The **OPERATOR
   PASSCODE** sheet opens over the panel.
3. Press **CANCEL** → nothing is retried, the plan keeps running, and the panel
   settles back to **DISARMED** (it releases the deadman lease it had taken, so
   give it the moment the pill shows).
4. Press ARM again, type a **wrong** code → *"Passcode rejected. Check it and
   try again."*, the box clears, the sheet stays open. Type a **right** one
   (Sina / Misha / Sailors) → ARM completes and Live Touch goes to air.
5. **Immediately disarm and ARM again** → it must ask **again**. That is the
   ruling.
6. **Tap the passcode box** before typing if the iPad keyboard does not appear
   by itself — the one behaviour worth confirming on real hardware (§4).
7. **Handback is always free** — DISARM, CaptainPad RESUME, autopilot OFF and
   lease expiry must never ask for anything, and a timeline force-disarm while
   the sheet is open must close the sheet by itself.
8. **PANIC / blackout** remain reachable while armed, unchanged.

---

## 8. Follow-ups

1. **Nothing left on the takeover-passcode ruling.** All three surfaces (engine
   gate, CaptainPad, Live Touch) now prompt per attempt. This closes `_200` §5.1
   and `_201` §7.1.
2. **Plan-predicate duplication** (`_200` §5.2, carried by `_201` §7.2) —
   untouched, CaptainPad-side.
3. The **on-screen-keyboard caveat** in §4 is the only item that cannot be
   settled without the physical iPad.

## 9. Shared-tree note

`docs/ui/touch_control_wire.js` and `docs/ui/touch_control.html` belong to
another live session. Both were re-read immediately before each edit; every
change is additive and sits inside the file's existing structure, naming and
comment voice. No foreign content was reverted, no git operation was run, and
all scratch work lives in `~/tmp/fix_202/`.
