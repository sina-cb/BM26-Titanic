# 60 — CaptainPad Native-First: Live Touch, Deck PIXELS and Mixer Bands on the iPad App

**Status:** PLAN (designer: Fable, report `_251`). Implementation: one Opus
implementer, W-items §7.
**Operator orders (both verbatim):**
1. "shit! can we run the touch live control on ipad too please? it says it
   runs on web only"
2. "please make sure the mixer right now is dependent on browser too, and I am
   now worried the deck 2d pixel are also might not be available. please use
   the same fable to debug those, and make sure captainpad is a ipad native
   app, then web browser! :)"

The ruling this doc implements: **CaptainPad is an iPad NATIVE app first, a
web app second.** Every surface that today refuses or degrades on native is
audited in §1; the two architecture tracks that fix the ones that matter are
§3 (canvas surfaces → Skia, real native) and §4 (Live Touch → WebView).

---

## 1. Audit — what is web-only today, and how it fails on native

Every row was verified in source this session. "Explicit refusal" means the
surface follows the codex (no fallback, names its refusal); nothing crashes.

| # | Surface | Web-only mechanism (file:line) | Native status TODAY | Plan |
|---|---|---|---|---|
| 1 | **Live Touch tab** | iframe + `window` postMessage bridge + DOM ancestor z-elevation — `app/(tabs)/touch_control.tsx:365-377` (gate), `:385-410` (iframe), `:136-163` (elevation), `:289-349` (bridge) | Explicit refusal card: "Touch Control runs in the browser" + the panel URL | **§4: WebView** |
| 2 | **Deck PIXELS window** | DOM `<canvas>` 2D context — `components/deck/pixel_view_paint.ts:65-66`; canvas element `components/deck/pixel_view_window.tsx:249`; `ResizeObserver` `:182` | Explicit refusal `pixel_view_window.tsx:191-202`: "PIXELS NEEDS A BROWSER"; artifact hook disabled (`use_pixel_view_artifact.ts:101` `enabled=false`, no fetch) | **§3: Skia** |
| 3 | **Mixer pixel-view bands (×9)** | Same painter + shared `ResizeObserver`/`IntersectionObserver`/`document.visibilityState` — `components/mixer/pixel_view_band.tsx:71-129`, canvas `:432` | Explicit refusal `:412-420` "NEEDS A BROWSER" — and `mixer.tsx` renders all nine bands unconditionally, so native shows NINE refusal boxes (report `_243` disclosure) | **§3: Skia** |
| 4 | **2D Simulator tab** | `EmbeddedLocalSurface` platform split: `components/embedded_local_surface.web.tsx` (iframe) / `.tsx` (react-native-webview) | **WORKS on native already** — the WebView peer exists and is the in-repo precedent for §4 | none |
| 5 | **Audio COMPANION view** | Same `EmbeddedServiceScreen` shell — `app/(tabs)/audio.tsx:1274` | **WORKS on native already** (WebView) | none |
| 6 | **Studio editor** | Caret-mirror `div`, `document.execCommand` Tab insertion, `window.visualViewport` — `app/(tabs)/studio.tsx:34,75-183`, all `Platform.OS==='web'`-gated | Works as a plain `TextInput`; loses caret-follow scroll, Tab capture, keyboard-aware viewport. Config sub-view, not a performance surface | Accept (§5) |
| 7 | **Dimmer Rack fader row** | Vertical-wheel→horizontal-scroll translation — `app/(tabs)/dimmer_rack.tsx:275-293` | Mouse-only affordance; native touch scrolling unaffected | Accept (§5) |
| 8 | **EntryLabelEditor** | DOM `blur` safety net for an RN-web `onBlur` bug — `components/EntryLabelEditor.tsx:215-222` | Native `onBlur` is the normal, working path | Accept (§5) |
| 9 | **Hue wheel / deck controls** | `touchAction:'none'` web armor only — `components/deck/hue_wheel.tsx:329`; the control is RN + react-native-svg | Works (RN responder armor is platform-neutral) | none |
| 10 | **GlobalEffectMacros / split panes** | Web-only style props (`transitionDuration`, `touchAction`) | Cosmetic no-ops on native | none |
| 11 | **MIDI transport** | `navigator.requestMIDIAccess` — `utils/midi/web_midi_transport.ts:41-52`, availability-checked | Absent on native — and equally absent in iPad Safari today (no Web MIDI on iOS). No regression; controllers plug into the show machine's Chrome | Accept (§5) |
| 12 | **engineBus WS / apiBase / artifact fetch** | none — native paths exist: AppState reconnect `utils/engineBus.ts:196-205`, metro-host derivation `utils/apiBase.ts:129-151` (report `_246`), sim origin `utils/simulation_url.ts:58` | **WORK on native** | none |

Bottom line: the data plane (engine WS/REST, sim artifact fetch, address
resolution) is already native-clean. What is missing is exactly two renderers:
the **pixel-map painter** (rows 2-3) and the **Live Touch HTML surface**
(row 1).

---

## 2. Decisions at a glance

| Question | Decision | Why (short) |
|---|---|---|
| Pixel surfaces on native | **@shopify/react-native-skia**, imperative SkPicture path, ONE shared pass-order module behind a `PixelPaintTarget` seam | Real native (operator order), same 2D vocabulary the painter already speaks, in Expo SDK 54's bundled modules (2.2.12) |
| Live Touch on native | **react-native-webview** rendering the sim-served page, new native message transport | The page IS the shipped instrument (~5.8k lines: wire, lifecycle, passcode, spatial). WebView is the only zero-divergence answer; precedent already in-repo (row 4) |
| Live Touch native reimplementation | **Rejected** | docs/44 §"WHY IT IS PLAIN HTML" planned a port, but the page has since grown the deadman lease, takeover passcode and spatial surface — a rewrite forks the exact code where correctness is safety-critical |
| Open in external Safari | **Rejected** | Loses the coordinator handoff (`live_touch_coordinator.tsx` — the Deck/Mixer blend handshake), the theme link, and the tab bar; app-switching also churns the lease/deadman timing |
| WebView for the pixel surfaces | **Rejected** | Operator: native first. Also 9 WebViews ≫ 9 Skia canvases in memory and startup |
| react-native-svg pixel views | **Rejected** | Thousands of React elements per vis frame violates the "zero React on the frame path" contract and the 8 ms budget (`pixel_paint_scheduler.ts:52`) |
| expo-gl pixel views | **Rejected** | Hand-rolled shaders/batching for rects+ellipses+additive blend is more new code than the Skia adapter, for nothing the budget needs |

---

## 3. Track A — pixel surfaces go REAL native (Skia)

### 3.1 Dependency and compatibility (verified)

- `@shopify/react-native-skia` **2.2.12** is the pinned version for this
  project's Expo SDK **54** (`CaptainPad/node_modules/expo/bundledNativeModules.json:117`)
  and is included in the Expo Go runtime for SDK 54. Install with
  `npx expo install @shopify/react-native-skia` (never a bare `npm i` — the
  expo wrapper is what pins 2.2.12).
- Peers already present: `react-native-reanimated 4.1.1`,
  `react-native-gesture-handler 2.28.0`, RN 0.81.5 new-arch
  (`app.json` → `newArchEnabled: true`).
- W0 (§7) proves it renders in Expo Go on the actual iPad before anything is
  ported. If Expo Go ever drops Skia, `expo-dev-client` is already a
  dependency and a dev build is the documented fallback path — but that is a
  W0 finding, not an assumption.

### 3.2 The seam: one pass order, two paint targets

Report `_243` already named the seam: **`pixel_view_paint.ts` is the ONE
web-bound renderer file**; everything else on the frame path
(`pixel_view_logic.ts` geometry/colour, `pixel_view_band_logic`, the
scheduler, the artifact hook) is pure and node-tested.

The refactor keeps the module's own warning true ("two surfaces must not be
two copies of the halo pass" — and now: two PLATFORMS must not be either):

```
components/deck/pixel_view_paint.ts     ← pass order ONLY, platform-neutral
    emits into:
interface PixelPaintTarget {
  /** CSS-px size + device pixel ratio; target owns backing-store sizing. */
  begin(): { w: number; h: number } | null;   // null = zero-sized, skip
  clear(color: string): void;                  // PIXEL_STAGE_BG
  /** Halo pass: additive blending on, then off. */
  setAdditive(on: boolean): void;
  fillCircle(x: number, y: number, r: number,
             cr: number, cg: number, cb: number, alpha: number): void;
  fillEllipse(x: number, y: number, rx: number, ry: number,
              cr: number, cg: number, cb: number): void;
  /** Cores: snapped rect fill (target keeps the half-pixel snap). */
  fillRect(x: number, y: number, w: number, h: number,
           cr: number, cg: number, cb: number): void;
  fillGhostRect(x: number, y: number, w: number, h: number): void; // PIXEL_GHOST_INK
  end(): void;
}
```

- `paintPixelView(target, state)` keeps its exact two-pass order, the
  `GLOW_MIN_LUMA` skip, `MIN_GLYPH_PX` floor, half-pixel snapping and
  return-false-when-unpaintable semantics. No arithmetic moves — it all stays
  in `pixel_view_logic.ts`.
- **Web adapter** (`pixel_paint_target_canvas.ts`, `.web` resolution or
  explicit import from the `.web.tsx` surface): wraps
  `CanvasRenderingContext2D` — `setAdditive` = `globalCompositeOperation
  'lighter'`, `begin()` = the current DPR backing-store sizing block
  (`pixel_view_paint.ts:69-85` today). Pixel-identical output is an
  acceptance gate (§7 W1).
- **Native adapter** (`pixel_paint_target_skia.ts`): wraps an `SkCanvas` with
  TWO pre-allocated `SkPaint`s (one `BlendMode.Plus` for halos, one `SrcOver`
  for cores/ghosts), reused across every glyph — zero allocation per glyph,
  same as the web contract. DPR from `PixelRatio.get()`, capped at 2 like the
  web path.

### 3.3 Native redraw model — zero React per vis frame

The web path is: vis WS frame → subscriber ref → shared
`PixelPaintScheduler` (8 ms budget, round-robin — reused UNCHANGED, its clock
and rAF are injected and RN provides both) → `paintPixelView` onto the
canvas. The native path keeps the identical spine; only the last hop changes:

- Each surface owns one RN Skia `<Canvas>` hosting one `<Picture>` whose
  `picture` prop is a **Skia-compatible shared value** (Reanimated 4 is
  already installed). The scheduler's `paint()` callback records the frame
  into a `PictureRecorder` via the Skia `PixelPaintTarget`, finishes the
  `SkPicture`, and assigns `sharedPicture.value = picture` — RN Skia redraws
  on the UI/render thread with **no React commit**.
- Acceptance: React DevTools profiler (or a render-count probe in the
  component) shows ZERO re-renders during steady-state vis frames; renders
  happen only on view switch / collapse / theme / layout.
- Budget: `_239/_243` measured 1.8-2.6 ms median (p95 3.5 ms) per canvas on
  web, ~0.85 ms for a 316×110 band; the scheduler caps a drain at
  `PAINT_BUDGET_MS` = 8 ms. On native the JS-thread cost is the RECORDING
  only (rasterization moves off-thread), so the same scheduler budget is the
  conservative bound. W2 measures record-time with the scheduler's own
  `lastDrainMs` stats and reports the numbers.

### 3.4 Element + visibility seams

- **`PixelSurface`** platform component replaces the two inline
  `React.createElement('canvas')` sites (`pixel_view_window.tsx:249`,
  `pixel_view_band.tsx:432`): `pixel_surface.web.tsx` renders the canvas and
  exposes the canvas-2d paint target; `pixel_surface.tsx` renders the Skia
  `<Canvas><Picture/></Canvas>` and exposes the Skia recorder target. One
  props contract: `{ onTarget(target|null), style }`.
- **Visibility** module `pixel_surface_visibility.ts` (+`.web`): the band's
  three DOM helpers (`pixel_view_band.tsx:71-129` shared RO/IO,
  `documentVisible()` `:127-129`) become one interface:
  `{ observeSize(el|view, cb), observeOnScreen(cb), isDocumentVisible() }`.
  - web impl: exactly today's shared observers (moved, not rewritten).
  - native impl: size from RN `onLayout`; on-screen from
    `useIsFocused()`-fed context (the mixer is a single non-virtualized page
    — a focused, expanded band counts as on-screen; the 8 ms scheduler budget
    bounds the cost of that simplification); document-visible from
    `AppState === 'active'`.
- **base64**: `decodeVisSamples` already takes the decoder by injection
  (`atobToBytes`). Hermes on RN 0.81 provides global `atob` — W0 verifies on
  device; if absent, supply the pure-JS decoder in `pixel_view_logic.ts`
  (node-testable) instead of a polyfill import.
- The two refusal cards (`pixel_view_window.tsx:191-202`,
  `pixel_view_band.tsx:412-420`) and the `enabled` platform gate
  (`usePixelViewArtifact(isWeb)`) are removed **only in the same commit that
  makes the native path actually draw** — the refusal stays until the truth
  changes (codex P0).

---

## 4. Track B — Live Touch on native (WebView)

### 4.1 What was verified about today's web embedding

- The panel is the sim-served page `http://<host>:6969/docs/ui/touch_control.html`
  (the sim's HTTP doc root is the repo root — `utils/simulation_url.ts:44-55`);
  reachable from any LAN device.
- The page reaches the engine itself: `touch_control_wire.js:30`
  `ENGINE = 'http://' + location.hostname + ':6968'` (+ WS on the same
  host). Loaded from the sim host in a WebView, this is correct with **zero
  changes** — the WebView loads from the network, same as Safari.
- The pixel-view artifact (`docs/ui/touch_control_pixel_views.json`) is a
  same-origin GET — unchanged in a WebView.
- The passcode gate (`touch_control_passcode.js`) renders entirely inside the
  page and talks only to the engine ("Nothing about it crosses the frame
  boundary" — its own header, verified). Unchanged in a WebView.
- The host bridge has exactly FOUR page-side touchpoints, all keyed on
  `window.parent !== window`:
  1. `touch_control.html:1610` — first-paint gate (`theme-pending`, the
     `_223` fix).
  2. `touch_control_theme.js:148-266` — the whole theme/surface/fullscreen
     bridge.
  3. `touch_control_wire.js:658-674` — `acknowledgeSurfaceRelease` posts the
     handoff ack straight to `window.parent`.
  4. `touch_control.html:2141-2156` — spatial fullscreen requester (gates on
     being embedded; posts via the theme module's relay).
- **In a WebView the page is the TOP frame**: `window.parent === window`, so
  today it would render STANDALONE (dark, unthemed, no handoff bridge) —
  functional but cut off from CaptainPad. The `touch_control.tsx:9-14` header
  comment ("react-native-webview ships no web build") is why the native path
  was left as a refusal; the fix below keeps that constraint honored via
  platform-file resolution, not by importing WebView into the web bundle.

### 4.2 URL — reuse the `_246` leaf

Extend `resolveLiveTouchPanelUrl` (`utils/live_touch_bridge.ts:206-225`) —
the existing leaf, NOT a new mechanism — with an embed marker:

- Web (unchanged): `pageOrigin` wins the hostname; URL carries
  `captainpad_origin=<origin>`.
- Native: `pageOrigin` is null; hostname comes from `apiBase` (which on
  native is metro-host-derived, `utils/apiBase.ts:129-151`); URL carries
  **`captainpad_embed=native`** and NO `captainpad_origin` (there is no web
  origin to declare — inventing one would be a lie the origin check would
  then bless).
- Constant `LIVE_TOUCH_EMBED_PARAM = 'captainpad_embed'` lives beside
  `LIVE_TOUCH_PARENT_ORIGIN_PARAM` in `live_touch_bridge.ts`; node tests pin
  both shapes.

### 4.3 Page-side native transport (4 files touched, one seam)

`touch_control_theme.js` already owns the bridge; it grows a **transport**
object instead of scattering `window.ReactNativeWebView` everywhere:

- **Detection** (all four touchpoints): embedded-in-iframe =
  `window.parent !== window` (unchanged); embedded-in-native = URL has
  `captainpad_embed=native`. The head gate (`touch_control.html:1599-1618`)
  adds the query check synchronously — same stamp, same 3 s escape hatch, so
  the `_223` no-blue-flash guarantee holds identically on native.
- **Fail loudly**: if `captainpad_embed=native` but
  `window.ReactNativeWebView` is missing (page opened in Safari with the
  param, or a broken WebView), the existing `fail()` path fires — visible
  error, panel revealed, never a silent standalone fallback.
- **Outbound (page→host)**:
  `window.ReactNativeWebView.postMessage(JSON.stringify(message))`. The host
  parses with the existing `parseTouchControlBridgeMessage` — same versioned
  schema, byte-for-byte the same message objects.
- **Inbound (host→page)**: the theme script defines
  `window.__captainpadDeliver(message)` (native mode only) that feeds the
  SAME validate/apply/ack pipeline the iframe listener feeds. The host sends
  via `injectJavaScript('window.__captainpadDeliver(' + JSON.stringify(msg) + '); true;')`.
  This deliberately avoids `webViewRef.postMessage`, whose delivery target
  (`window` vs `document` 'message' event) has differed across
  react-native-webview platforms/versions — an injected call is deterministic
  on both.
- **Ordering guarantee (no race)**: `__captainpadDeliver` is installed BEFORE
  the script posts `touch-control-theme-ready`. On native the host marks
  `frameLoaded` only on receiving `theme-ready` — not on `onLoadEnd` — so an
  injected theme can never call a function that does not exist yet. (On web,
  `canSendLiveTouchTheme`'s load-event rationale — `live_touch_bridge.ts:105-110`
  — stays exactly as is; the native listener is a prop installed before
  navigation, so the ready event cannot be missed.)
- **Authentication**: iframe mode keeps the strict `captainpad_origin` origin
  checks (both directions, unchanged). Native mode's channel is
  host-authenticated by construction (only the app can inject JS; only the
  page's own JS can call `ReactNativeWebView.postMessage`), and in native
  mode the `window` 'message' listener path is NOT installed — no new
  listening surface.
- `touch_control_wire.js:666-674` posts the release ack through the shared
  transport (`CaptainPadEmbed.post(...)` exposed by the theme module) instead
  of raw `window.parent.postMessage`; iframe behavior is unchanged by
  construction (transport = the same postMessage+origin in iframe mode).
- `touch_control.html:2142`'s "am I embedded" gate asks the transport, so
  spatial fullscreen requests flow on native too.

### 4.4 Host-side split (no react-native-webview in the web bundle)

- New platform pair, following the in-repo `embedded_local_surface`
  precedent:
  - `components/live_touch_surface.web.tsx` — today's iframe + `window`
    message listener + ancestor z-elevation + body overflow lock, moved
    verbatim from `touch_control.tsx`.
  - `components/live_touch_surface.tsx` — `WebView` (13.15.0, installed)
    with `onMessage` → parse → same callback, `injectJavaScript` post.
- `touch_control.tsx` keeps ALL platform-neutral logic: coordinator
  registration (`registerHost(postToPanel)` — the `HostSender` contract in
  `live_touch_coordinator.tsx:32` is already transport-agnostic), theme
  build/ack/timeout, focus/blur handoffs, `beforeRemove`, AppState background
  handoff (`:222-251` — the AppState half already runs on native; the
  `visibilitychange` half stays web-gated). The native refusal card
  (`:365-377`) is deleted in the same commit the WebView path works.
- **WebView props** (the page has its own touch armor — the host must not
  fight it): `scrollEnabled={false}`, `bounces={false}`,
  `overScrollMode="never"`, `contentInsetAdjustmentBehavior="never"`,
  `automaticallyAdjustContentInsets={false}`,
  `allowsBackForwardNavigationGestures={false}`, `allowsLinkPreview={false}`,
  `dataDetectorTypes="none"`, `setSupportMultipleWindows={false}`,
  `textInteractionEnabled={false}`, `javaScriptEnabled`, `domStorageEnabled`,
  `originWhitelist={['http://*']}`, `style={{backgroundColor:'transparent'}}`
  inside a host `View` painted `palette.background` (this is the native half
  of the `_223` first-paint gate: the page's `theme-pending` CSS is
  transparent, the WebView is transparent, the container is CaptainPad's own
  themed ground — no flash of the standalone blue).
- **No remount rule**: the WebView must never change position in the React
  tree while live (RN remounts native views on reparent — same reload hazard
  the iframe has, `touch_control.tsx:129-135`). Fullscreen is style-only.
- **Keep-mounted teardown**: reuse `EMBEDDED_SURFACE_TEARDOWN_SCRIPT`
  (`components/embedded_surface_lifecycle.ts`) on unmount, as the simulator
  surface does.

### 4.5 Spatial fullscreen on native

Web: child asks → parent elevates the iframe to a fixed viewport surface
(`touch_control.tsx:273-287,315-331`). Native equivalent, same versioned
handshake:

- New `SpatialFullscreenContext` provided above the tab navigator. The Live
  Touch screen sets it from the `touch-control-spatial-fullscreen` message.
- `app/(tabs)/_layout.tsx` consumes it: while active, the custom rail
  (`CustomSideBar`, `:203`) renders collapsed (width 0 / null) and
  `sceneStyle`'s `marginLeft: 112` (`:206`) becomes 0. Style/prop-only —
  the screen and WebView keep their tree position (no remount), which is the
  native analogue of "elevate ancestors, never reparent".
- Ack (`captainpad-spatial-fullscreen-applied`) is sent AFTER the layout
  commit (effect scheduled by the state change), keeping the child's 1 s
  acknowledgement watchdog (`touch_control.html:2149-2155`) truthful.

### 4.6 Failure modes — loud, in-view

- **Panel unreachable** (sim down, wrong LAN, HTTP error): WebView
  `onError`/`onHttpError` + a 15 s first-load watchdog (same shape as
  `embedded_service_screen.tsx`) render an in-view error card: the exact URL
  tried, the transport/HTTP reason, and a RETRY button (remount via
  `reloadToken` — acceptable for a surface that never loaded). Never a
  silent blank.
- **Theme link failure**: identical to web — the page reveals itself unthemed
  with the `panelerror` toast at 1 s; the host shows its `bridgeError`
  banner on a missed ack. No palette substitution on either side.
- **Artifact stale/missing, engine refusals, passcode lockout**: all in-page
  already (wire + passcode modules) — carried over untouched.
- **App background**: existing AppState handoff (`deck`, reason
  `background`) already runs on native; the WS engineBus reconnects on
  foreground (`engineBus.ts:196-205`).

### 4.7 iOS transport security (verified provisioned, one contingency)

`app.json:21-27` already ships `NSAllowsLocalNetworking`,
`NSLocalNetworkUsageDescription` and Bonjour services — the engine REST/WS
calls from native JS were already planned for. Two notes:

- **Expo Go ignores `app.json` infoPlist** (it runs under Expo Go's own
  plist, which permits LAN dev traffic) — so Expo Go verification is not
  proof of the standalone build's plist. The standalone/dev-client build is
  where `NSAllowsLocalNetworking` must be proven.
- If a dev-client/standalone WKWebView still refuses the `http://` page load
  (ATS treatment of raw LAN IPs inside WEB CONTENT is stricter than
  local-networking sockets), the documented, scoped fix is
  `NSAllowsArbitraryLoadsInWebContent: true` — web content only, not
  app-wide. W4 verifies on device before adding it; do not add it
  speculatively.

---

## 5. What stays web-gated (named, with the honest message)

- **Studio caret/Tab/viewport niceties** (`studio.tsx`): native editing works
  via `TextInput`; the enhancements remain web-only. No refusal card needed —
  the surface functions.
- **Dimmer Rack wheel translation** (`dimmer_rack.tsx:275`): mouse hardware
  affordance; meaningless on touch. Stays gated.
- **EntryLabelEditor DOM blur net** (`EntryLabelEditor.tsx:216`): a web bug's
  workaround; native path is correct without it. Stays gated.
- **Web MIDI** (`utils/midi/web_midi_transport.ts`): no Web MIDI on iOS
  (native OR Safari). The MIDI tab's existing transport-absent state is the
  honest answer; native changes nothing. If on-iPad MIDI hardware ever
  becomes a requirement, that is a new project (CoreMIDI module), not a gate
  to lift here.
- **Live Touch**: nothing stays gated. The whole surface ships in the
  WebView.

---

## 6. Files touched (contract for the implementer)

Page side (all under `docs/ui/`, all covered by existing node suites in
`simulation/tests/touch_control_*.test.js` — extend, don't bypass):
- `touch_control.html` — head gate `:1599-1618` (+native detection), spatial
  requester `:2141-2156` (transport gate).
- `touch_control_theme.js` — transport object, native inbound/outbound,
  `__captainpadDeliver`.
- `touch_control_wire.js` — `:658-674` ack via transport.

CaptainPad:
- `utils/live_touch_bridge.ts` — `LIVE_TOUCH_EMBED_PARAM`,
  `resolveLiveTouchPanelUrl` embed arg (+tests in
  `utils/live_touch_bridge.test.ts`).
- `components/live_touch_surface.tsx` / `.web.tsx` — NEW platform pair.
- `app/(tabs)/touch_control.tsx` — transport-neutral refactor; refusal card
  removed.
- `app/(tabs)/_layout.tsx` — SpatialFullscreenContext consumption.
- `components/deck/pixel_view_paint.ts` — pass order over `PixelPaintTarget`.
- `components/deck/pixel_surface.tsx` / `.web.tsx` — NEW platform pair.
- `pixel_paint_target_canvas.ts` / `pixel_paint_target_skia.ts` — NEW
  adapters (locations beside their consumers).
- `pixel_surface_visibility.ts` / `.web.ts` — NEW visibility seam.
- `components/deck/pixel_view_window.tsx`, `components/mixer/pixel_view_band.tsx`
  — canvas→`PixelSurface`, observers→seam, refusals removed.
- `hooks/use_pixel_view_artifact.ts` — `enabled` gate becomes caller-truthful
  (native consumers now pass true).
- `package.json` — `@shopify/react-native-skia` via `npx expo install`.
- `app.json` — ONLY if W4's on-device ATS check demands
  `NSAllowsArbitraryLoadsInWebContent`.

---

## 7. Ordered W-items

**W0 — Native preflight (gate for everything else).**
`npx expo install @shopify/react-native-skia`; operator boots Expo Go on the
iPad against his own Metro (agents never launch/kill the operator's Expo —
standing rule). Prove: app boots natively at all (this has plausibly never
been exercised recently — surface every startup crash here, not in W2);
a scratch Skia `<Canvas>` renders; `typeof atob === 'function'` under Hermes;
engine REST+WS reachable from native JS (Deck tab shows live data).
*Acceptance:* screenshot of Deck native with `● CONNECTED`, Skia smoke
visible; findings recorded. Scratch screen deleted.

**W1 — Paint seam refactor, web-neutral.**
`PixelPaintTarget` + canvas adapter; `paintPixelView` rewritten over it; node
tests drive the pass order with a recording fake target (order, additive
windowing, luma skip, glyph floor, snapping). Web parity proven with the
existing `simulation/agent_tools/mixer_pixel_views_capture.cjs` harness —
before/after captures visually identical.
*Acceptance:* full CaptainPad vitest + tsc + eslint green; parity shots
inspected.

**W2 — Skia pixel surfaces.**
Skia adapter, `PixelSurface` pair, shared-value `SkPicture` redraw, native
visibility seam; deck window + mixer bands swap in; refusal cards and
`isWeb` gates removed. Scheduler untouched.
*Acceptance:* zero React commits per vis frame (probe); `lastDrainMs` numbers
recorded on-device and ≤ the 8 ms budget; web captures still parity-clean;
all suites green.

**W3 — Live Touch page-side transport.**
The three `docs/ui` file changes + head gate; extend the
`simulation/tests/touch_control_*` suites: native detection, deliver-before-
ready ordering, fail-loud on missing `ReactNativeWebView`, wire ack via
transport, iframe mode byte-identical.
*Acceptance:* suites green; standalone (no param, `window.parent===window`)
behavior provably unchanged; web CaptainPad embed re-verified in a browser
capture (theme handshake, no flash).

**W4 — Live Touch native host.**
Bridge URL param + `live_touch_surface` pair + `touch_control.tsx` refactor +
SpatialFullscreenContext + failure cards. On-device ATS check; plist
contingency only if refused.
*Acceptance:* web build regression-clean (fresh dist on a scratch port, per
the stale-Metro rule); native verified per §8 checklist with the operator.

**W5 — Full gates + handoff.**
`npm run check` + full vitest in CaptainPad; touched sim suites; screenshot
matrix (§8) captured and INSPECTED; report + tracker block; Notion follow-ups
for anything deferred.

---

## 8. Test plan, screenshot matrix, and what only the operator can verify

**Implementer-capturable (web + harness):**

| Shot | Surface | Proves |
|---|---|---|
| A1 | Web Deck PIXELS, before/after W1 | painter refactor is pixel-neutral |
| A2 | Web Mixer 9 bands, before/after W2 | call-site swap is web-neutral |
| A3 | Web Live Touch tab embed after W3/W4 | iframe mode untouched (theme lands, no flash, ARM reachable) |
| A4 | `touch_control.html` standalone in a browser | standalone mode untouched |
| A5 | Node suite outputs | pass order, transport ordering, URL shapes |

**Operator-verified on the physical iPad (the implementer cannot screenshot
a real device — walk this list together over Expo Go / dev build):**

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

**Perf note for 2:** if band recording measurably drags on-device, the
allowed lever is the scheduler budget/cadence (already designed for this),
never skipping frames silently — say so in the caption if cadence drops.

---

## 9. Risks

- **WebView gesture arbitration** (highest): the page's touch armor assumes
  it owns every touch; the RN tab navigator and any parent gestures must
  never claim them. Mitigated by the §4.4 prop set and checklist item 5; if
  iOS still steals edge swipes, the spatial surface may need
  `allowsBackForwardNavigationGestures` re-verified and the rail edge
  avoided in fullscreen.
- **Native app rot**: the native build path may not have been booted in
  months — W0 exists to flush unknown-unknowns (fonts, splash, router)
  before they masquerade as W2/W4 failures.
- **Expo Go vs standalone plist divergence** (§4.7): passing in Go proves JS,
  not ATS. The dev-client build is the truth for networking policy.
- **Skia picture churn**: one `SkPicture` allocation per frame per surface is
  the designed cost (they are cheap, GC'd promptly); if device profiling
  shows pressure, the fallback is recording into two reused recorders —
  an optimization, not a redesign.
- **Metro staleness** (standing memory): every native verification round
  starts from a restarted Metro; web regressions verified against a fresh
  dist export on a scratch port, never the operator's :6967/:7167.
- **Divergence pressure on the page bridge**: three embed modes (standalone,
  iframe, native) now exist. The transport object + the suites pinning each
  mode are the guardrail; any new bridge message MUST go through
  `live_touch_bridge.ts` + the transport, never a raw postMessage.
