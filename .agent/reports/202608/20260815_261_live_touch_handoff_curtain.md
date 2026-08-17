# _261 — the Live Touch "HANDING BACK TO DECK" curtain that never lifted

**Role:** Opus debug/fix. **Surface:** CaptainPad Live Touch tab, NATIVE (iPad,
Expo Go on Metro :6981, PROD stack 6966-6969). **Follows:** `_252`
(native-first port), `docs/47` (the Deck/Mixer handback contract), `docs/60`.

**Operator report (verbatim intent):** entering the **Live Touch tab** on the
iPad shows a persistent overlay saying *"handing back to deck"* that blocks the
whole panel. Live Touch cannot be used at all.

---

## 1. What the overlay is

One string in the repo matches: `components/live_touch_coordinator.tsx`'s
`LiveTouchHandoffOverlay` — `HANDING BACK TO {TARGET}`. It renders whenever the
coordinator's `handoffTarget` is non-null, and it is not a banner: it is
`position:absolute; inset:0; zIndex:980`, opaque
(`palette.sidebarBackground`), mounted **outside `<Tabs>`** in
`app/(tabs)/_layout.tsx:298`, and it sets no `pointerEvents`. So it covers the
panel, the navigation rail and every other tab, and swallows every touch. There
is exactly one way to raise it (`requestHandoff` → `setHandoffTarget(target)`)
and three ways to drop it: the panel's `touch-control-surface-released`
acknowledgement, the 30 s timeout, or the sender refusing the message.

## 2. Root cause — two halves that only meet on native

### 2.1 A release nobody could answer, behind a curtain nobody could dismiss

`app/(tabs)/touch_control.tsx` subscribes to `AppState` and asks for a **Deck
release with `reason: 'background'` every time the app stops being active** —
home swipe, app switcher, Control Centre, and (the one that matters for a
performance pad on a bench) the iPad's own **auto-lock**. It is not gated on
Live being armed; any visit to the tab that got as far as loading the panel arms
it for the rest of the session.

`docs/47` wrote that rule **for a browser**: *"AppState/background and document
visibility request a Deck handback while the iframe and WebSocket are still
alive"*. In a hidden browser tab both ARE alive — the iframe's JS keeps running,
answers in milliseconds, and the curtain drops before anyone sees it. On iOS
neither is: the app's JS thread **and** the WKWebView's are suspended on resign,
and iOS may reclaim a backgrounded WebView's content process outright (which
reloads the page on return). `_252` carried the code to native; the premise did
not come with it.

Meanwhile `requestHandoff` raised the full-pad curtain for that release
**unconditionally** — `setHandoffTarget(target)` with no look at `reason` — and
then waited `HANDOFF_TIMEOUT_MS = 30_000` for an acknowledgement that could not
arrive until the operator came back. So the operator returns to the app,
lands on the Live Touch tab, and the pad is curtained. Nothing cancels it on
foreground (`foregrounded()` only clears `backgroundHandoffSentRef`), and every
further background→foreground round trip re-arms a fresh 30 s of it — which is
exactly what an operator does while poking at a screen that takes no touches.
Persistent in practice, and native-only in fact.

### 2.2 The native transport claimed deliveries it never made

`components/live_touch_surface.tsx`'s sender returned `true` as soon as a
`WebView` ref existed:

```tsx
const webView = webViewRef.current;
if (!webView) return false;
webView.injectJavaScript(`window.__captainpadDeliver(${JSON.stringify(message)}); true;`);
return true;                       // ← a promise the transport cannot keep
```

`injectJavaScript` is fire-and-forget. A call into a page that has not installed
`window.__captainpadDeliver` — never loaded, reloaded by the panel's own RELOAD
button, remounted by RETRY, or reloaded by iOS after reclaiming the WebView —
throws **inside the WebView**, where nothing is listening. The coordinator reads
that `true` as "the release is on the wire", so it keeps a pending request and
its curtain alive for the full 30 s. The iframe peer answers the same question
truthfully for free (`contentWindow` missing → `false` → immediate, loud
rejection), which is why the web build never showed this.

Both halves are needed to explain the operator's screen: (2.1) raises the
curtain at a moment nobody chose, (2.2) is why it can hang there instead of
failing fast.

## 3. The fix — 3 files, ~30 lines, no redesign

| Where | What |
|---|---|
| `utils/live_touch_bridge.ts` | **`handoffCurtainTarget(target, reason)`** — the curtain is a NAVIGATION blend curtain (docs/47's own words). `navigation` → the target; `background` → `null`; anything else throws by name. |
| `components/live_touch_coordinator.tsx` | `setHandoffTarget(handoffCurtainTarget(target, reason))`. The three drop paths stay unconditional. Its two refusals stopped calling the surface an "iframe" — the operator reads them on an iPad. |
| `utils/live_touch_bridge.ts` + `components/live_touch_surface.tsx` | **`canDeliverToNativePanel(webViewMounted, panelReady)`** gates every injected delivery. `panelReadyRef` rises on the panel's own `touch-control-theme-ready` (posted only after it installs the hook) and is cleared by **every `onLoadStart`** and by `retry`. |
| `app/(tabs)/touch_control.tsx` | Comment only: records the native truth about the background release and why it carries no curtain. |

**What did NOT change, deliberately:** the background release is still
requested, still needs its acknowledgement, still times out loudly into the
screen's error banner — no silent swallow (codex P0). The navigation handoff is
untouched end to end. `live_touch_surface.web.tsx` is untouched, and a test now
pins its delivery test verbatim. No engine, wire or `docs/ui/` change.

## 4. Gates

- **Regression guard `components/live_touch_handoff_curtain.test.ts` (6 tests).**
  A/B against the pre-fix sources (files temporarily reverted by a scratch
  script, then restored from backups): **3 of 6 FAIL pre-fix** — the curtain
  decision, the delivery gate, and the readiness lifecycle — **6/6 pass after**.
  Plus 3 behaviour tests for the two new pure functions in
  `utils/live_touch_bridge.test.ts` (14 there now, was 11).
- **CaptainPad vitest: 97 files / 2021 pass / 6 skip / 0 fail.** Failing list
  **EMPTY**. (A mid-session run caught one foreign red file,
  `components/deck/deck_workspace_layout.test.ts` — a concurrent agent's
  in-flight `audioBar`/`outputBar` work, green again by the final run.)
- **`tsc --noEmit` clean across the tree. `eslint` clean on every file I
  touched.**
- **Web parity, fresh dist on scratch :7157**
  (`entry-853153c6c46aee9099c460dd45c07acd.js`), `~/tmp/fix_259/`:
  - **A3 (the `_252` walk, repeated):** iframe present; `src` carries
    `captainpad_origin=http://127.0.0.1:7157` and **no** `captainpad_embed`;
    inside the frame `captainpad-embedded theme-applied`,
    `CaptainPadEmbed.mode === 'iframe'`, `embedded === true`, `--bg #f8f9fa`,
    `__captainpadDeliver` **undefined**; **zero** bridge-error text, no rejected
    origin, no curtain.
  - **B (the fixed path, end to end):** a real background release —
    `document.visibilityState → hidden` — with the panel's `post` recorded: the
    panel answered with exactly one **`touch-control-surface-released`**, and
    the curtain appeared in **0 of 80 samples over 4 s**. Zero engine writes:
    an idle panel answers a background blur with `planHandoff === 'ack'`.
  - **A4:** the same page standalone — `standalone-dark`, `mode 'standalone'`,
    `embedded false`. Untouched.
- **Ports:** the live 6966-6972 / :6981 / :7175 stack got **read-only GETs
  only** (`/layers/state`, the panel page, the panel's own polls). The dist
  server on **:7157** was mine and is stopped. No engine was started; nothing
  was bound, killed or restarted on a live port. No git operations.

**Not proven by me, by construction:** the iPad itself — §6.

## 5. Why the web A/B is not the proof of the bug

The failure is a platform fact (iOS suspends the app's and the WebView's JS on
resign), so the browser cannot exhibit it: on web the same stimulus is answered
in milliseconds, which the B walk above shows. The pre/post evidence for the fix
is therefore the **source A/B** in §4 plus the structural guard, and the B walk
is what proves the shared coordinator still completes the handshake with the
curtain removed. The navigation curtain round trip was deliberately **not**
re-walked against the live engine: it POSTs `/layers/activate`, and the operator
is running a show on that stack.

## 6. THE 3-STEP DEVICE CHECK (operator, physical iPad)

Reload Expo Go so the new bundle is on the pad first.

1. **The bug, gone.** Open Live Touch, let the panel finish loading, then swipe
   home (or lock the iPad) and come back. → The Live Touch tab is **usable
   immediately**: no "HANDING BACK TO DECK" panel, no dead touches. A red banner
   at the top saying `LIVE TOUCH HANDOFF …` is *acceptable and informative* (the
   iPad suspended the panel, so the release could not be confirmed — the
   engine's deadman owns the lease); tell me if you see one, it is not a
   blocker. Repeat twice — it used to come back every round trip.
2. **The curtain still works where it should.** From Live Touch tap **DECK**,
   then from Deck tap **LIVE TOUCH** and from Live Touch tap **MIXER**. → Each
   time you should see "HANDING BACK TO DECK/MIXER" briefly and then land on the
   tab you asked for; the blend must complete, not hang. (If one hangs ~30 s and
   then errors, that is a *different* fault — the panel's own handback — and I
   want the error text.)
3. **ARM, then leave.** ARM Live Touch, play for a moment, then tap **DECK**.
   → The handback completes and the panel shows DISARMED. Then ARM again, swipe
   home, wait ~10 s, come back → the pad is usable on return, and the Live panel
   tells you its state honestly (either still ARMED, or DISARMED because the
   engine's deadman released it) — never a curtain.

## 7. Files

**New:** `CaptainPad/components/live_touch_handoff_curtain.test.ts`.

**Changed:** `CaptainPad/utils/live_touch_bridge.ts` (+`live_touch_bridge.test.ts`),
`CaptainPad/components/live_touch_coordinator.tsx`,
`CaptainPad/components/live_touch_surface.tsx`,
`CaptainPad/app/(tabs)/touch_control.tsx` (comment only).

**Untouched on purpose:** `components/live_touch_surface.web.tsx`, every
`docs/ui/` page file, the engine, and the navigation handoff path.

## 8. Does anything need a restart?

**No.** CaptainPad client code only — no engine, no Companion, no `docs/ui/`
change. The iPad needs a fresh Expo Go load of the new bundle; the browser build
needs the usual CaptainPad web rebuild whenever the next dist is cut.
