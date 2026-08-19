# Live Touch as a native CaptainPad layer setting

**Status:** Implemented architecture; operator visual approval pending
**Operator request:** Preserve Misha's tuned Live Control layout and feel, place
the tab directly under Deck, make its chrome follow every CaptainPad theme, and
use the same Deck/Mixer blend transaction without changing control geometry.

## Why

Touch Control is now a real show surface, but it still looks and behaves like a
separate application embedded inside CaptainPad. The operator should be able to
move Deck -> Live -> Mixer without changing visual languages or wondering
which system owns the show. This design carries the codex goals of visibility
and kindness into the control surface: ownership is obvious, errors are loud,
and a theme change never reloads or interrupts an armed performance.

This document records the implemented surface and CaptainPad seam. The
ARM/session transition contract is specified in
`47_[todo]_touch_control_deck_mixer_transition.md`; Dimmer Rack authority is
specified in `48_[todo]_touch_control_dimmer_authority.md`.

## Current system

```text
CaptainPad :6967
  app/(tabs)/touch_control.tsx
       |
       | iframe (same host, different origin)
       v
Simulation HTTP :6969
  CaptainPad/live_touch/touch_control.html       layout, local interaction, presets
  CaptainPad/live_touch/touch_control_wire.js    REST + /ws/control ownership/lease
       |
       v
MarsinEngine :6968
  lib/api_server.js               validation, lease, state, handback
  Layers router                   deck | mixer | live_touch
  LiveBrightnessController        transient factors below Dimmer Rack ceilings
```

The iframe boundary is intentional. `react-native-webview` has no web build,
while the deployed iPad surface is CaptainPad Web. The wrapper resolves the
simulation URL from the hostname that served CaptainPad so the iPad never tries
to reach its own `127.0.0.1`.

The page has seven operator areas:

| Area | Purpose | Authority |
|---|---|---|
| Header | ARM, connection, tempo, reload | ARM lease + engine status |
| Meter | Audio and signal visibility | engine reads only |
| Colours | Wheel, five working swatches, schemes | owner-scoped Live palette |
| Spatial / XY | Physical paint or performance axes | owner-scoped Live effects |
| Presets | Capture/recall the panel state | browser-local schema v3 |
| Effects | Live effect slots | engine catalog; slots 9+ only |
| Groups | Group mode, color and local level | live-session state |

ARM is an explicit ownership contract, not a route side effect. The page first
announces its generated owner ID over `/ws/control` and waits for the ARM lease
acknowledgement. Only then may it stage its selected pattern or assert the
owner-scoped Live look. Finally it posts `live_touch` to `/layers/activate` and
displays `ARMED` only after `GET /layers/state` proves the linear blend landed.
Every Live HTTP request carries `X-Touch-Control-Owner`; the engine routes
creative/tempo requests to an in-memory Live session context instead of
durable Deck/Mixer/global state. A failed catalog read, lease, staged write,
activation, or readback aborts loudly. Merely focusing the tab performs reads
and theme synchronization; it does not activate Live Touch.

## Target tab order

The sidebar order becomes:

```text
LAYERS
  DECK
  LIVE TOUCH
  MIXER
STUDIO
AUDIO
OSC
TIMELINE
SCHEDULER
DIMMER RACK
MIDI
CONFIG
```

`CaptainPad/app/(tabs)/_layout.tsx` is the only ordering authority. The route
file remains `touch_control.tsx`; the canonical operator label is `Live Touch`.
Deck is the base program, Live is its explicit performance takeover, and Mixer
is the alternate layered program surface. Placing Live between them expresses
that relationship without adding navigation or changing any panel control.

## Theme bridge

### Constraint

The parent is served from port 6967 and the iframe from 6969. They are
cross-origin even when the hostname matches, so CSS inheritance and direct DOM
access are unavailable. The existing iframe hard-codes blue/dark colors and
the wrapper itself hard-codes `#070b14`; consequently Gruvbox, Sunset, Light,
and Midnight stop at the iframe edge.

### Contract

CaptainPad remains the sole theme authority. The iframe does not duplicate the
theme registry and does not persist a second preference. Parent and child use
a versioned `postMessage` handshake:

```ts
type TouchControlReadyV1 = {
  type: 'touch-control-theme-ready';
  version: 1;
};

type CaptainPadThemeV1 = {
  type: 'captainpad-theme';
  version: 1;
  requestId: string;
  themeId: 'light' | 'dark' | 'midnight' | 'sunset' | 'gruvbox' | 'system';
  resolvedThemeId: 'light' | 'dark' | 'midnight' | 'sunset' | 'gruvbox';
  scheme: 'light' | 'dark';
  palette: {
    text: string;
    background: string;
    tint: string;
    icon: string;
    surface: string;
    surfaceContainerLow: string;
    surfaceContainerLowest: string;
    surfaceContainerHigh: string;
    primary: string;
    onPrimary: string;
    secondary: string;
    tertiary: string;
    error: string;
    ghostBorder: string;
    ambientShadow: string;
  };
};

type TouchControlThemeAckV1 = {
  type: 'touch-control-theme-applied';
  version: 1;
  requestId: string;
};
```

The wrapper sends the current theme after iframe load, after the child's ready
message, and whenever `useTheme()` changes. It targets exactly
`new URL(panelUrl).origin`, never `'*'`. The child accepts messages only when
`event.source === window.parent`, the origin equals the CaptainPad origin
declared in the iframe URL, the version is supported, every required key is
present, and every value parses as a CSS color. Invalid or partial payloads are
rejected atomically and reported through the panel's existing visible error
path. There is no partial palette and no silent fallback.

Theme updates mutate CSS custom properties in place. They must never change the
iframe `src`, React `key`, owner ID, WebSocket, ARM state, presets, or control
DOM. A theme switch while armed is a repaint only.

### Token ownership

| Live CSS role | CaptainPad source | Notes |
|---|---|---|
| page background | `background` | wrapper and iframe match |
| low/elevated surfaces | `surfaceContainerLowest/Low` | no geometry change |
| panel surface | `surfaceContainerHigh` | retains borders and radius |
| text | `text` | primary labels |
| secondary text | `secondary` | must pass AA for its actual size |
| borders | `ghostBorder` | existing thickness retained |
| active selection | `primary` + `onPrimary` | replaces page-wide purple chrome |
| connected/armed | `tertiary` | same semantic role as CaptainPad |
| errors/disarmed | `error` | ARM remains visually unmistakable |
| shadow | `ambientShadow` | existing blur/radius retained |

Instrument colors are not generic chrome. The hue wheel, palette swatches,
frequency-band meters, group identity tags, and fixture output colors retain
their data colors. Recoloring those would change what the instrument means,
not merely its theme. Layout tokens (`--radius-*`, `--space-*`, heights,
touch targets), fader geometry, animation timing, and all gestures remain
byte-for-byte behaviorally equivalent.

### Loading and degraded states

- The wrapper paints `palette.background` immediately, eliminating the current
  dark flash around the iframe.
- In embedded mode the child begins in `theme-pending` and requests the
  handshake. Controls are not moved or rebuilt.
- If no valid theme arrives within one second, the page displays
  `CAPTAINPAD THEME LINK UNAVAILABLE` through its existing error surface. It
  does not claim to match the parent. Show control remains available because a
  cosmetic bridge must not strand an already armed rig.
- In standalone mode the page explicitly declares its own `standalone-dark`
  theme; it is not pretending to inherit CaptainPad.

## Interactions

1. The operator opens Live Touch. The route loads DISARMED, receives the
   active CaptainPad theme, and performs reads only.
2. The operator changes Config from Dark to Gruvbox. CaptainPad posts one new
   validated palette; the live page repaints in place in the next animation
   frame. An armed session and every slider value remain unchanged.
3. The operator presses ARM. The page acquires its lease, stages and asserts
   Live-local state, and uses the canonical Layers activation. Theme and tab
   focus do not arm.
4. The operator selects Deck or Mixer. CaptainPad asks the child to hand back
   to that exact destination. The child posts the same `/layers/activate`
   operation while its owner lease is valid, waits for the destination to land,
   clears Live-owned transient state, releases and confirms the lease, and only
   then acknowledges navigation.
5. The iframe reloads or dies. Engine deadman reversion remains the final
   authority; a theme message can never arm, write show state, or renew a lease.

## Security and failure boundaries

- Theme messages contain presentation tokens only. They cannot carry endpoint
  URLs, owner IDs, API bodies, HTML, selectors, or script.
- The theme message listener and show-control message listener use distinct
  message types and validators.
- Unknown message versions fail loudly. No version negotiation guesses.
- The theme bridge never adds a network dependency; all assets and tokens are
  already local, preserving offline readiness.
- Contrast is checked for every registered theme. A theme that fails the
  required text/background pair fails the UI contract rather than being
  special-cased inside Touch Control.

## Files in the implementation slice

- `CaptainPad/app/(tabs)/_layout.tsx` — Layers group and Deck/Live Touch/Mixer order.
- `CaptainPad/components/live_touch_coordinator.tsx` — serialized, destination-aware handoff.
- `CaptainPad/app/(tabs)/touch_control.tsx` — iframe ref, exact-origin theme
  and lifecycle handshake, themed wrapper/loading/error surfaces.
- `CaptainPad/hooks/use-theme.tsx` — consumed as-is; remains authority.
- `CaptainPad/constants/theme.ts` — consumed as-is; no Live-only registry.
- `CaptainPad/live_touch/touch_control_theme.js` — atomic exact-origin palette application;
  only structural chrome tokens change.
- `CaptainPad/live_touch/touch_control_wire.js` — ARM, isolated Live endpoints, brightness,
  layer activation, landed-state polling, and release acknowledgement.
- `CaptainPad/utils/layer_settings.ts` and `live_touch_bridge.ts` — strict typed
  wire contracts with focused tests.

## Acceptance criteria

1. Sidebar group is Layers -> Deck -> Live Touch -> Mixer on web and iPad layouts.
2. Opening Live Touch while DISARMED produces zero mutating engine requests.
3. Switching among Light, Dark, Midnight, Sunset, Gruvbox, and System changes
   the iframe chrome within one animation frame after message receipt.
4. Theme switching does not reload the iframe, reconnect the socket, change
   the owner ID, alter ARM, or move any control.
5. Automated DOM geometry snapshots show unchanged bounds for every panel,
   slider, chip, pad, and touch target before/after theming.
6. Every structural text/surface pair passes WCAG AA at its actual font size;
   ARM/error and armed/connected states remain distinguishable without color
   alone.
7. Invalid origin, version, missing key, or invalid color applies zero tokens
   and produces a visible error.
8. Standalone and embedded modes state their theme source honestly.
9. No CDN, font download, package, or runtime installation is introduced.
10. Deck, Mixer, and Live Touch activation all use `/layers/activate` with the
    engine's canonical linear blend. Deck/Mixer require no ARM; Live Touch does.
11. Live brightness writes use only `/touch-control/brightness*`; they cannot
    mutate `/section-brightness`, Mixer master, or Dimmer Rack state.
12. App/document background requests Deck handback, and a rapid newer route
    cannot be acknowledged until that exact destination has landed.

## What this deliberately is not

- It does not rebuild Misha's HTML instrument in React Native.
- It does not resize, reorder, rename, or reinterpret controls inside the page.
- It does not change Misha's tuned component geometry, gestures, fader travel,
  or data colors.
- It does not grant Live Touch authority over Deck/Mixer state. Live has an
  isolated pattern/control channel and transient brightness factors.
- It does not make theme choice engine state. Theme remains a per-iPad
  CaptainPad preference.

## Validation still required

Automated contract, syntax, type, and build checks cover the bridge and routing.
Before freezing the design, run DOM-geometry equivalence, all-theme contrast,
iframe no-reload, ARM/handoff failure injection, and armed-theme-change tests;
then obtain operator visual approval on the show iPad.
