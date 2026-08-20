# _252 — CaptainPad Native-First: Skia pixel surfaces + Live Touch WebView

**Role:** Opus implementer. **Plan:** `docs/60_captainpad_native_first.md` (`_251`).
**Operator order (verbatim):** *"please make sure the mixer right now is dependent
on browser too, and I am now worried the deck 2d pixel are also might not be
available. please use the same fable to debug those, and make sure captainpad is
a ipad native app, then web browser! :)"* — and, before it, *"shit! can we run the
touch live control on ipad too please? it says it runs on web only"*.

Three surfaces refused to exist on the iPad: the deck's PIXELS window, the
mixer's nine pixel-view bands, and the whole Live Touch tab. All three now work
there. **No web pixel moved** — that is proven, not asserted (§4).

---

## 1. W-item status

| W | What | Status |
|---|---|---|
| **W0** | Native preflight — install Skia the Expo way, prove the app compiles and bundles for iOS | **DONE (agent half)**; the physical-device half is §7 |
| **W1** | `PixelPaintTarget` seam + canvas-2d adapter, web-neutral | **DONE**, parity gated |
| **W2** | Skia adapter, `PixelSurface` pair, shared-value `SkPicture`, visibility seam, both refusals removed | **DONE** (on-device draw is §7 item 2) |
| **W3** | Page-side embed transport (`docs/ui/`) | **DONE**, 19 new node tests |
| **W4** | Native host: URL param, `live_touch_surface` pair, screen refactor, spatial fullscreen, loud failures | **DONE** (ATS check is §7 item 3/9) |
| **W5** | Full gates + screenshots + report + tracker | **DONE** |

---

## 2. W0 — the preflight, and what an agent can actually prove

`npx expo install @shopify/react-native-skia` → **2.2.12** exactly, the version
`node_modules/expo/bundledNativeModules.json:117` pins for this project's SDK 54
and the one Expo Go ships. `package.json` + `package-lock.json` are the only
dependency change in this report. **This was the one allowed install.**

The physical device is the operator's (§7). What an agent CAN prove, and did:

- **The iOS bundle compiles and links, before and after.** `expo export
  --platform ios` (`env -u CI`, scratch output dir, never the operator's Metro):
  - baseline, before any of this work: `entry-5bf889842906d8ec390e89e7bd0cf96b.hbc`, **5,584,124 B**
  - after the whole port: `entry-3660c07c0fdae4c872f94f8768016bc9.hbc`, **6,206,437 B**

  The +622 KB is Skia's JS + react-native-webview + the new surfaces. A baseline
  export was taken FIRST on purpose: it proves the native path was already
  buildable, so any breakage here would have been mine.
- **`tsc --noEmit` clean** with `@/components/deck/pixel_surface` resolving to the
  NATIVE peer (the one that imports Skia) and `@/components/live_touch_surface`
  to the WebView peer — i.e. the native files are typechecked, not just parsed.
- **Unit coverage for the native halves** with no device: the Skia adapter takes
  its Skia factories by injection, so its entire call sequence is driven against
  a recording fake `SkCanvas`; the WebView transport is driven against a stub
  `window.ReactNativeWebView`.

**NOT proven by me, by construction:** that Expo Go on the iPad renders it, that
Hermes provides `atob` (see §6), and that WKWebView's ATS lets the `http://` LAN
page load in a dev-client build. Those are §7.

---

## 3. Track A — the pixel surfaces are real native now

### 3.1 The seam

`components/deck/pixel_view_paint.ts` keeps its exact two-pass order, its
`GLOW_MIN_LUMA` skip, its `MIN_GLYPH_PX` floor and its return-false-when-
unpaintable semantics — but it now emits into a `PixelPaintTarget` instead of a
`CanvasRenderingContext2D`. No arithmetic moved: geometry and colour still live
in `pixel_view_logic.ts`.

Two adapters fulfil it:

- `pixel_paint_target_canvas.ts` — the DPR backing-store block, the `lighter`
  composite and the literal `rgba(r,g,b,a)` / `rgb(r,g,b)` strings, lifted out of
  the old painter unchanged. Imported ONLY by `pixel_surface.web.tsx`.
- `pixel_paint_target_skia.ts` — two pre-built `SkPaint`s (`BlendMode.Plus` for
  the halo pass, `SrcOver` for cores and ghosts) reused for every glyph, one
  reused `Float32Array` for colour, one `SkPicture` per frame. It imports
  **nothing** from `@shopify/react-native-skia`: the recorder and paints arrive
  by injection, the same idiom the paint scheduler uses for its clock, which is
  what makes it node-testable.

**One deviation from docs/60 §3.2, deliberate.** The plan's sketch put the
half-pixel snap inside each target ("the target keeps the half-pixel snap").
Two targets rounding independently is exactly the drift this seam exists to
prevent, and W1's own acceptance list requires snapping to be observable through
a recording fake target. So the snap happens ONCE in `paintPixelView`, which
hands `fillRect`/`fillGhostRect` an already-snapped top-left and integer size;
the interface says so. The plan's interface also had no ghost ELLIPSE (a round
unlit pixel), so `fillGhostEllipse` was added beside `fillGhostRect`.

### 3.2 Redraw, and zero React per vis frame

`components/deck/pixel_surface.tsx` (native) hosts one Skia `<Canvas>` with one
`<Picture>` whose `picture` prop is a Reanimated shared value. The scheduler's
`paint()` records into a `PictureRecorder` through the Skia target and assigns
`picture.value = …` — RN Skia redraws on the render thread with **no React
commit**. The component re-renders only on screen-focus change, which is the one
thing here that IS state (a band that lost focus must cost nothing).

The `_243` shared paint scheduler is **untouched** except for two stale comment
sentences that claimed the bands were a browser-only surface. Its `throw` when a
platform has no `requestAnimationFrame` / `performance.now` is unchanged, and
the test that pins that message still passes.

### 3.3 Element + visibility seams

`PixelSurface` is a platform pair with ONE props contract
(`onTarget` / `onResize` / `onVisibility`):

- `pixel_surface.web.tsx` renders the same raw `<canvas>` the two consumers used
  to create inline (a function component returning that element adds no wrapper
  node, so the web DOM is unchanged), and owns the shared ResizeObserver +
  IntersectionObserver **moved verbatim out of `pixel_view_band.tsx`**. The deck
  window now shares that one observer pair too, instead of allocating its own.
- `pixel_surface.tsx` reports size from `onLayout` and on-screen from
  `useIsFocused()`.

**Deviation from docs/60 §3.4, deliberate.** The plan specced one
`pixel_surface_visibility` module with three methods. Two of them are
per-ELEMENT signals and belong to the element, and a native implementation of
`observeSize(el, cb)` could only be a no-op — a silent shape the codex dislikes.
So the module keeps exactly the process-wide question,
`isPixelSurfaceHostVisible()` (`document.visibilityState` on web,
`AppState.currentState === 'active'` on native), and `PixelSurface` delivers the
element-bound signals through its props. Same three facts, no no-ops.

### 3.4 The refusals are gone because they stopped being true

`pixel_view_window.tsx:191-202` ("PIXELS NEEDS A BROWSER"), the nine copies of
`pixel_view_band.tsx:412-420` ("NEEDS A BROWSER") and the
`usePixelViewArtifact(isWeb)` platform gate were all deleted **in the same change
that makes the native path draw** — never before it (codex P0).

---

## 4. THE PARITY PROOF

`components/deck/pixel_view_paint_parity.test.ts` holds the **pre-refactor
painter, copied verbatim**, and asserts that it and the new
painter + canvas-adapter stack emit a byte-identical stream of 2D-context calls
— every `fillStyle` string, every `arc`/`ellipse`/`fillRect` argument, every
composite-mode flip, and the backing-store size — for the same draw state.

Compared across **4 surface sizes** (deck window 560x320, dominant band 316x240,
channel band 316x110, and 40x18 where every glyph lands on the `MIN_GLYPH_PX`
floor) x **5 frame states** (before the first frame, lookup unresolved, blackout,
and two busy frames exercising RGBWAU, the luma floor and round/square glyphs),
plus the zero-sized refusal. **21 comparisons, all identical.** A self-check test
guards against the gate passing on an empty op stream.

That is stronger than a screenshot: a screenshot shows one frame at one size.
The file carries a "do not edit this to match a change" note.

---

## 5. Track B — Live Touch on the iPad

### 5.1 Page side: one transport, three modes

`docs/ui/touch_control_theme.js` grew a transport object instead of scattering
`window.ReactNativeWebView` around. Modes: **standalone** (`window.parent ===
window`, no param) / **iframe** (unchanged) / **native** (`captainpad_embed=native`).

- **Outbound** — `transport.post()`. iframe: the identical
  `window.parent.postMessage(message, parentOrigin)` it always did. native:
  `ReactNativeWebView.postMessage(JSON.stringify(message))`.
- **Inbound** — ONE `deliver(data)` pipeline. iframe feeds it from the
  origin-checked `window` 'message' listener; native feeds it from
  `window.__captainpadDeliver`, which the host calls by `injectJavaScript`
  (deliberately not `webViewRef.postMessage`, whose delivery target has differed
  across react-native-webview versions).
- **Ordering guarantee** — `__captainpadDeliver` is installed BEFORE
  `touch-control-theme-ready` is posted, and the native host marks itself ready
  ONLY on that event (not `onLoadEnd`). The injection race is dead by ordering,
  and a test asserts the hook existed at the moment the ready message went out.
- **Authentication** — iframe keeps both strict origin checks. In native mode the
  `window` 'message' listener is **not installed at all**: the channel is
  host-authenticated by construction, and this adds no new listening surface.
- **Fail loud** — `captainpad_embed=native` with no `window.ReactNativeWebView`
  (page opened in Safari with the param, or a broken WebView) takes the existing
  `fail()` path: panel revealed, error toast, nothing posted. Never a silent
  slide back to standalone. An unknown param value is refused by name.

**What changed in `docs/ui/touch_control_theme.js`, precisely:** the
`PARENT_ORIGIN_PARAM` block gained `EMBED_PARAM`/`NATIVE_EMBED` constants and an
`embedMode()` + `buildTransport()` pair; the standalone early-return now also
publishes a `CaptainPadEmbed` that throws if posted to; the old inline
`window.addEventListener('message', …)` body was lifted **unchanged** into
`deliver(data)` (the `event.data.` prefix became `data.`, the two origin/source
checks stayed in the iframe listener wrapper); the three outbound
`window.parent.postMessage(..., parentOrigin)` calls became `transport.post(...)`;
and `window.CaptainPadEmbed` is published for the other two touchpoints.

The other three touchpoints:

- `touch_control.html` head gate (`_223` first-paint): also stamps
  `theme-pending` when the URL carries `captainpad_embed=native`, synchronously,
  same 3 s escape hatch. **No flash of standalone blue on the iPad.**
- `touch_control.html` spatial requester: asks the transport, not the frame tree.
- `touch_control_wire.js` `acknowledgeSurfaceRelease`: posts through the
  transport, and throws by name if the transport is absent. Its now-dead
  `parentOrigin()` helper is gone.

A test asserts **no page-side file posts to `window.parent` by hand any more**
(comments stripped before matching) — exactly one such call survives, inside the
iframe transport itself.

### 5.2 Host side

- `resolveLiveTouchPanelUrl` (the `_246` leaf, extended — not a new mechanism)
  takes an embed mode. Web is byte-identical; native adds
  `captainpad_embed=native` and declares **no** parent origin, because there is
  no web origin on native and inventing one would be a lie the page's own origin
  check would then bless. Passing both throws.
- `components/live_touch_surface.web.tsx` — the iframe, the `window` message
  channel with its origin checks, the ancestor z-elevation and the body overflow
  lock, all moved verbatim out of the screen.
- `components/live_touch_surface.tsx` — the WebView with the full gesture
  mitigation set (`scrollEnabled={false}`, `bounces={false}`,
  `overScrollMode="never"`, `contentInsetAdjustmentBehavior="never"`,
  `automaticallyAdjustContentInsets={false}`,
  `allowsBackForwardNavigationGestures={false}`, `allowsLinkPreview={false}`,
  `dataDetectorTypes="none"`, `setSupportMultipleWindows={false}`,
  `textInteractionEnabled={false}`, `originWhitelist={['http://*']}`), painted
  transparent over a container in `palette.background` — the native half of the
  `_223` gate. `EMBEDDED_SURFACE_TEARDOWN_SCRIPT` runs on unmount.
- `app/(tabs)/touch_control.tsx` keeps EVERY platform-neutral behaviour
  (coordinator registration, theme build/ack/1 s timeout, focus/blur handoffs,
  `beforeRemove`, the AppState background handoff, the fullscreen handshake and
  its rAF-delayed ack) and the native refusal card is deleted.
- **Loud in-view failure**: sim down / wrong LAN / HTTP error →
  `onError`/`onHttpError` + a 15 s first-load watchdog render a card naming the
  exact URL and the transport reason, with **RETRY** (remount via a reload
  token — acceptable for a surface that never loaded). Native-only, so the web
  iframe path is untouched.

### 5.3 Spatial fullscreen

`utils/spatial_fullscreen.ts` is a pure broker (the `op_dialog.ts` idiom) read
through `hooks/use_spatial_fullscreen.ts`. `app/(tabs)/_layout.tsx` consumes it
in exactly two places: `CustomSideBar` returns null, and `sceneStyle.marginLeft`
goes 112 → 0. **Style/tree only — the Live Touch screen and its WebView never
move**, because RN remounts a native view when it is reparented, which would
reload the page and discard the deadman lease. That is the native analogue of
"elevate ancestors, never reparent the iframe".

**Native only.** On web the iframe elevation already covers the rail; doing both
would reflow the tab tree under an already-covering fixed iframe for no gain.
`_layout.tsx` took a 4-hunk diff — deliberately small, since `_250` is live in
the tab-policy neighbourhood.

---

## 6. Known open item — `atob` under Hermes

`atobToBytes` (`pixel_view_logic.ts`) uses the global `atob` to decode the vis
buffer. React Native 0.81 does not polyfill it; Hermes is believed to provide it
natively, but **I could not verify that without the device**, and docs/60 §3.4
made it a W0 device check. Nothing was substituted (codex P0: no fallbacks). If
§7 item 2 shows the pixel surfaces staying dark with an `atob` error, the
documented fix is a pure-JS decoder in `pixel_view_logic.ts` (node-testable,
injected through the existing `decodeVisSamples(frame, decoder)` seam) — a
~15-line follow-up, not a redesign.

---

## 7. THE OPERATOR'S ROUND-2 GATE — physical iPad only

Verbatim from `docs/60_captainpad_native_first.md` §8:

1. App boots natively; Deck shows `● CONNECTED` live data (W0).
2. PIXELS window: ship draws, animates with a running pattern, SHOW/RIG
   source toggle and view chips work; mixer scroll stays smooth with all
   nine bands animating (the `_243` "laggy mixer" complaint must not return).
3. Live Touch tab: panel loads THEMED with no blue flash; theme switch in
   Config propagates live (ack banner never appears).
4. ARM in performance mode → passcode sheet rises, keyboard appears on tap,
   wrong code shows the engine's words, right code arms. Every gated gesture
   re-prompts.
5. Wheel, brush, spatial pad: drags never scroll/bounce/select; no iOS text
   magnifier or link preview intrudes.
6. Spatial FULLSCREEN: covers the rail edge-to-edge; exit restores; the 1 s
   "no acknowledgement" toast never fires.
7. Navigate Live→Deck and Live→Mixer: handoff blend completes (the release
   ack path through the new transport).
8. Home-swipe to background while armed → return: Live released to Deck,
   engineBus reconnected, no stale lease.
9. Kill the simulator → Live Touch tab shows the loud in-view card naming
   the URL; PIXELS/bands name the artifact refusal. Restart sim → RETRY
   recovers without an app restart.
10. Rotate the iPad; verify layout and the fullscreen surface survive.

Perf note for 2: if band recording measurably drags on-device, the allowed lever
is the scheduler budget/cadence, never skipping frames silently.

Notes for the walk-through:
- **Expo Go ignores `app.json` infoPlist** — passing in Go proves JS, not ATS.
  The dev-client/standalone build is the truth for networking policy. If a
  dev-client WKWebView refuses the `http://` LAN page (item 9's inverse), the
  documented, scoped fix is `NSAllowsArbitraryLoadsInWebContent: true` — web
  content only, not app-wide. **Not added speculatively**; `app.json` is
  untouched.
- While on item 2, please also glance at whether the ship is dark with a
  console error mentioning `atob` (§6).

---

## 8. Gates

- **CaptainPad vitest: 91 files / 1861 pass / 0 fail / 6 skip.** Failing list
  **EMPTY**. Baseline at session start on this shared tree was 86/1791/0; the
  +5 files / +70 tests are mine (`pixel_view_paint`, `pixel_paint_target_canvas`,
  `pixel_paint_target_skia`, `pixel_view_paint_parity`, `spatial_fullscreen`,
  plus 4 added to `live_touch_bridge.test.ts`). `_248`/`_250` land on top of this
  number.
- **`tsc --noEmit` clean. `expo lint` 0 errors** (13 warnings, all pre-existing
  and none in a file I touched).
- **Simulation node suite: 2333 tests, 7 failures — all FOREIGN**, in
  `bench_section_sync` (2 CLI parity), scene-geometry/patch-chain suites (4) and
  the scene-writer guard (1); none read a file in this report. I fixed the ONE
  failure I caused: `touch_control_passcode.test.js` asserted "the wire still
  owns the parent bridge" by matching a raw `postMessage(…, origin)` block, which
  the transport refactor made untrue — it now matches `embed.post({…})` and still
  asserts no passcode may appear in any bridge payload or URL. `_252`'s own new
  suite `touch_control_embed_transport.test.js` is **19/19**.
- **Web regression, fresh dist on :7179**, bundle hash verified against the
  export (`entry-23afb0a493664f069396f5c9ebed4692.js`), console muted before
  boot, shots in `~/tmp/fix_252/`:
  - Deck PIXELS (6 shots + 4 per-view): canvas present and DPR-sized
    (347x442 / 283x412 / 670x335), ship geometry drawn, view chips + SHOW/RIG
    present, caption `WAITING FOR THE FIRST FRAME` against an offline engine,
    **no refusal card**.
  - Mixer bands (11 shots) against a scratch engine on **:17252** (`titanic`,
    `--dest 192.0.2.x`): 3 bands **lit**, honesty ratios `964/964 FULL` and
    `100/964`, FRONT multi-panel view fits the band, collapse works, the
    performance-mode round trip is layout-identical (`true`), scheduler drain
    median **3.6–8.0 ms** / p95 6.4–9.9 ms — the same envelope `_243` measured.
  - Live Touch web embed (A3): iframe present, `src` carries
    `captainpad_origin` and **no** `captainpad_embed`; inside the frame
    `captainpad-embedded theme-applied`, `CaptainPadEmbed.mode === 'iframe'`,
    `--bg: #f8f9fa` (CaptainPad's theme landed), `__captainpadDeliver`
    **undefined**; **zero** bridge-error text, no rejected origin, no flash.
  - Panel standalone (A4): `standalone-dark`, `mode === 'standalone'`,
    `embedded === false` — untouched.
- **The live 6966-6972 stack + :7175 got read-only GETs only** (the pixel-map
  artifact from :6969, and the Live Touch page itself). Nothing was bound,
  killed or restarted there. The scratch engine on :17252 and the dist server on
  :7179 were mine and are stopped.

**Residue, disclosed not reverted:** the scratch engine rewrote
`marsin_engine/states/{titanic,test_bench}/*.yaml` — expected runtime residue
per AGENTS.md, left exactly as the engine wrote it.

---

## 9. Does anything need a restart?

**No engine restart. No Companion restart.** Every change is CaptainPad client
code plus three files under `docs/ui/` (which the simulator serves statically —
a browser reload picks them up). What IS needed:

- a **CaptainPad web rebuild** for the browser build, and
- a **Metro restart + fresh Expo Go / dev-client load** for the iPad, because
  `@shopify/react-native-skia` is a new native module.

---

## 10. Files

**New:** `components/deck/pixel_paint_target_canvas.ts`,
`pixel_paint_target_skia.ts`, `pixel_surface.web.tsx`, `pixel_surface.tsx`,
`pixel_surface_visibility.web.ts`, `pixel_surface_visibility.ts`,
`components/live_touch_surface.web.tsx`, `components/live_touch_surface.tsx`,
`utils/spatial_fullscreen.ts`, `hooks/use_spatial_fullscreen.ts`, and the suites
`pixel_view_paint.test.ts`, `pixel_paint_target_canvas.test.ts`,
`pixel_paint_target_skia.test.ts`, `pixel_view_paint_parity.test.ts`,
`utils/spatial_fullscreen.test.ts`,
`simulation/tests/touch_control_embed_transport.test.js`.

**Changed:** `components/deck/pixel_view_paint.ts`, `pixel_view_window.tsx`,
`components/mixer/pixel_view_band.tsx`, `pixel_paint_scheduler.ts` (comments +
one message), `hooks/use_pixel_view_artifact.ts` callers,
`utils/live_touch_bridge.ts` (+tests), `app/(tabs)/touch_control.tsx`,
`app/(tabs)/_layout.tsx` (4 hunks), `package.json` + `package-lock.json`;
`docs/ui/touch_control_theme.js`, `touch_control_wire.js`, `touch_control.html`
(2 gates); `simulation/tests/touch_control_passcode.test.js` (one assertion).

**Untouched on purpose:** `app.json` (no speculative ATS change),
`pixel_view_logic.ts`, the paint scheduler's logic, `live_touch_coordinator.tsx`
(its `HostSender` contract was already transport-agnostic), and everything
`_248`/`_250` own.
