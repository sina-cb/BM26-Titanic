# _251 — CaptainPad Native-First Plan: Live Touch WebView + Skia Pixel Surfaces (design)

**Role:** designer/planner (Fable). **Deliverable:** `docs/60_captainpad_native_first.md`.
**Zero product-code edits** — docs + report + tracker only, per the mission gate.

## Operator orders (verbatim)

1. "shit! can we run the touch live control on ipad too please? it says it
   runs on web only"
2. Mid-flight expansion: "please make sure the mixer right now is dependent
   on browser too, and I am now worried the deck 2d pixel are also might not
   be available. please use the same fable to debug those, and make sure
   captainpad is a ipad native app, then web browser! :)"

So the doc grew from "Live Touch on native" to the **native-first plan**: a
full audit of every web-gated CaptainPad surface plus the architecture for
the two tracks that matter. Because of that scope growth the doc is named
`60_captainpad_native_first.md` (not the originally slated
`60_live_touch_native.md`) — number unchanged, slug matches the real content.

## Audit result (all verified in source; full table in docs/60 §1)

- **Live Touch** — explicit native refusal at `app/(tabs)/touch_control.tsx:365-377`;
  web embeds the sim-served `docs/ui/touch_control.html` in an iframe with a
  versioned postMessage bridge (`utils/live_touch_bridge.ts`).
- **Deck PIXELS window** — explicit refusal `pixel_view_window.tsx:191-202`;
  the only web-bound piece is the canvas-2d painter
  (`pixel_view_paint.ts:65-66`) + observers.
- **Mixer pixel bands ×9** — explicit refusal `pixel_view_band.tsx:412-420`;
  same painter; `mixer.tsx` renders all nine unconditionally, so native today
  shows nine "NEEDS A BROWSER" boxes (matches `_243`'s disclosure).
- **Already native-clean:** 2D Simulator + Audio COMPANION tabs (the
  `embedded_local_surface` WebView/iframe platform pair — the in-repo
  precedent), engineBus WS (AppState reconnect `engineBus.ts:196`), apiBase
  metro-host derivation (`_246`), artifact fetch, hue wheel (RN/SVG), deck
  controls.
- **Accepted web-only (named, honest):** Studio caret/Tab niceties, dimmer
  rack wheel translation, EntryLabelEditor DOM blur net, Web MIDI (absent on
  iOS Safari too — no regression).

## Architecture calls

1. **Pixel surfaces → @shopify/react-native-skia 2.2.12** (pinned in this
   project's `expo/bundledNativeModules.json:117`, Expo SDK 54, in Expo Go).
   ONE pass-order module (`pixel_view_paint.ts` refactored over a minimal
   `PixelPaintTarget` interface) with a canvas-2d adapter (web, pixel-parity
   gated) and an SkCanvas adapter (native, two reused SkPaints). Redraw via
   `SkPicture` in a shared value → zero React commits per vis frame; the
   `_243` scheduler (8 ms budget) is reused unchanged. Rejected: SVG
   (React-per-frame), expo-gl (hand-rolled batching), WebView (operator said
   real native).
2. **Live Touch → react-native-webview 13.15.0** (already installed)
   rendering the same sim-served page. URL via the existing
   `resolveLiveTouchPanelUrl` leaf + new `captainpad_embed=native` param.
   Page grows a native transport in `touch_control_theme.js`:
   outbound `ReactNativeWebView.postMessage`, inbound an injected
   `__captainpadDeliver()` (defined before `theme-ready` is posted — the
   host only sends after `theme-ready` on native, so the injection race is
   dead by ordering). `_223` first-paint gate holds: head gate detects the
   param synchronously; transparent WebView over a themed container = no
   blue flash. Passcode is fully in-page — untouched. Spatial fullscreen =
   a context that collapses the custom rail + zeroes `sceneStyle.marginLeft`
   (style-only, no remount). Rejected: native reimplementation (forks the
   deadman/takeover code where correctness is safety-critical), external
   Safari (loses the coordinator handoff + theme + deadman timing).

## Key risks (docs/60 §9)

- WebView gesture arbitration on the wheel/brush/spatial page (mitigation
  prop set specced; on-device checklist item).
- Native build rot — W0 preflight exists to flush boot failures before they
  masquerade as feature bugs.
- Expo Go ignores app.json infoPlist — ATS truth only in a dev-client build;
  `NSAllowsLocalNetworking` already shipped, scoped
  `NSAllowsArbitraryLoadsInWebContent` is the contingency, on-device-verified
  only.

## What the operator must verify on the physical iPad

The implementer can only capture web/harness surfaces. The 10-item on-device
checklist is docs/60 §8: boot + CONNECTED, pixel surfaces animating with the
mixer staying smooth, themed Live Touch with no flash, passcode flow,
gesture ownership, spatial fullscreen over the rail, Live→Deck/Mixer
handoffs, background/foreground lease release, sim-down loud failures +
RETRY recovery, rotation.

## Numbering verification (at write time)

- `docs/` max was 59 → claimed **60**.
- `.agent/reports/202608/` had nothing ≥ _250 on disk (_248/_250 in flight
  per coordinator; filenames not yet present) → this report is **_251**.

## Pointers

- Plan: `docs/60_captainpad_native_first.md`
- Original web-embed design context: `docs/44_touch_control.md`,
  `docs/45_touch_control_white_paper.md`, `docs/58_mixer_pixel_views.md`
- Reports built on: `_223` (first-paint gate), `_225/_239` (PIXELS window),
  `_241/_243` (mixer bands + the named Skia seam), `_246` (apiBase leaf)
