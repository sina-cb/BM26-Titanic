# 52. Deck Workspace Windows â€” collapsible deck sections + a two-color / palette-turns COLORS window

**Status:** DESIGN â€” ready for implementation slices Â·
**Author:** agent _196 (design) Â· **Operator:** Sina Solaimanpour Â·
**Basis:** operator brief ("use the collapsing window idea from the live
touch window"; "patterns, the parameters, auto pilot â€¦ each a separate
window I can close or show"; "make the color wheel from the live touch a
window to select 2 colors"; "allow color palette TURNS â€¦ rotating the 5
colors we choose so we have a switching fading color palette").

This doc is the implementation contract for turning the Deck tab
(`CaptainPad/app/(tabs)/index.tsx`) into a small window workspace, and for
the new COLORS window. It is **layout management, not a restyle**: with the
default layout the Deck must render visually equivalent to today.

Related: `docs/50_live_touch_implementation_proof.md` (the Live Touch
surface whose panel manager we adapt), `docs/36_color_palette_live_transitions.md`
(engine color slew â€” the two CPC palette slots), `docs/39_channels_deck_mixer.md`
(deck channel), `docs/40_autopilot_improvements.md` (autopilots),
`docs/16_captain_pad.md` (CaptainPad architecture).

---

## 1. What we adapt from Live Touch (methodology, not DOM)

The Live Touch panel manager (`CaptainPad/live_touch/touch_control.html`, the
`DOCK / UNDOCK ANY PANEL` IIFE near the bottom) earns its keep through five
rules. These are the rules we port; none of its DOM/localStorage code moves:

1. **A closed panel leaves the layout entirely** â€” it does not shrink in
   place. Survivors reflow and take both its width and its height. (Live
   Touch: `.panel.is-docked { display:none }` + `reflowRows()` removing
   empty rows. Collapsing in place "left an empty column beside the
   survivor and bought the operator nothing".)
2. **Closed panels come back from a compact restore rail** â€” every closed
   panel is represented by a small labeled tab; tapping it reopens the
   panel. A panel with no tab is unreachable, which is "worse than one that
   is simply always there".
3. **A floor of open panels is enforced at both ends** â€” the close control
   refuses (visibly) below the floor, and layout *restore* renormalizes so
   a persisted layout can never boot into a state the UI itself would
   refuse to create (`loadLayout()` re-opens panels / re-docks extras).
4. **Persist only the closed-set, under a versioned key** â€” Live Touch
   stores just the array of docked panel keys (`bm26_touch_layout_v2`).
   Layout is a view preference; it never carries engine state.
5. **Refusal must be visible** â€” a tap that does nothing is
   indistinguishable from a broken control (the `dock-refused` shake).

Deliberately **not** ported: the two-row / `MAX_PER_ROW = 2` displacement
machinery. The Deck has four windows in what is today a three-column row
(wide) or a pinned-plus-scroll stack (narrow); every open window always has
a seat, so there is nothing to displace. Porting displacement would add
complexity with no operator benefit.

---

## 2. Current Deck inventory (what goes where)

From `CaptainPad/app/(tabs)/index.tsx` @ `feat/bm_readiness` (3a4d559d):

| Piece | Today | In the workspace |
|---|---|---|
| `PlanLockBanner`, `PlanLockScrim`, plan chips (`PlanIndicatorPill`, takeover strip) | Screen chrome | **Outside** â€” unchanged |
| `DeckTopBar` (master fader etc.), `CPCControls` (SPEED Â· COLORS Â· QUEUE Â· TAP Â· BPM Â· OSC globals row) | Screen chrome | **Outside** â€” unchanged |
| `DECK MAIN Â· LIVE OUTPUT` label + `PixelStrip` preview | Header region | **Outside** â€” unchanged |
| Column 1: `DeckHueRow` + `SplitPlaylistPanes` (Deck A/B, split drag, `+ SECOND PLAYLIST`, âœ• unbind) | PATTERNS column (pinned in narrow) | **PATTERNS window (protected â€” no close control)** |
| Column 2: DECK MAIN card â€” `EntryLabelEditor`, `DeckSavedFlash`, color swatch, â—Ž ALL, `GlobalParams` (with the `_184`/`_190` param chips), toggle/momentary grid | PARAMETERS column | **PARAMETERS window** |
| Column 3: `PatternAutopilotPanel` (incl. nested DECK TX), `ColorAutopilotPanel`, `DeckOverlayStack` | AUTOPILOT column | **AUTOPILOT window** |
| â€” | (new) | **COLORS window (Â§5)** |
| Bottom bar: PANIC + `RigGlobals` (GEM strip incl. BLACKOUT) | Screen chrome | **Outside** â€” unchanged |
| Modals: `ConfirmSheet` (panic), `AllModulationsPanel`, deck color picker `Modal` | Screen level | **Outside** â€” unchanged |

The offline banner (`OfflineBanner`) keeps its current placements (PATTERNS
column + AUTOPILOT column); it renders inside whichever of those windows is
open, and â€” because PATTERNS is protected â€” it is always visible somewhere.

---

## 3. Window system design

### 3.1 Types and pure layout module

New file `CaptainPad/components/deck/deck_workspace_layout.ts` â€” **pure
TypeScript, zero React Native imports**, so it runs under the existing
vitest config (`components/**/*.test.ts` admits pure-.ts tests only).

```ts
export type DeckWindowId = 'patterns' | 'parameters' | 'autopilot' | 'colors';
export const DECK_WINDOW_IDS: readonly DeckWindowId[];      // canonical order
export const PROTECTED_WINDOW: DeckWindowId;                 // 'patterns'

// The whole persisted/runtime layout state. Closed-set only â€” mirrors the
// Live Touch model. Order of `closed` is the rail order (close order).
export type DeckWorkspaceLayout = { closed: DeckWindowId[] };

export const DEFAULT_LAYOUT: DeckWorkspaceLayout;            // { closed: ['colors'] }

// Reducer â€” the ONLY way state changes. Pure; returns the same reference
// when the action is a no-op so React state updates can bail cheaply.
export type LayoutAction =
  | { type: 'close'; id: DeckWindowId }
  | { type: 'open';  id: DeckWindowId }
  | { type: 'reset' };
export function layoutReducer(s: DeckWorkspaceLayout, a: LayoutAction): DeckWorkspaceLayout;

// Normalizer â€” every untrusted input (AsyncStorage hydrate) passes through
// here. Deterministic: drops unknown/duplicate ids, forces the protected
// window open, preserves surviving order. NEVER throws; a hopeless input
// (non-object, wrong version) yields DEFAULT_LAYOUT (and the caller logs).
export function normalizeLayout(input: unknown): DeckWorkspaceLayout;

// Derived layout facts for the render layer (no JSX here):
export function openWindows(s: DeckWorkspaceLayout): DeckWindowId[];  // canonical order
export function isOpen(s: DeckWorkspaceLayout, id: DeckWindowId): boolean;
// Wide-mode flex weight per open window; closed windows get no track.
// All-open weights reproduce today's 4/3/3 exactly, plus colors:3.
export function wideFlexFor(open: DeckWindowId[], id: DeckWindowId): number;
```

Rules encoded in the reducer/normalizer (all unit-tested, Â§7):

- `close('patterns')` is a **no-op returning the same reference** â€” the
  protected window has no close affordance in the UI at all (cleaner than
  Live Touch's refusal shake: an affordance that always refuses should not
  exist), and the reducer backstops it anyway.
- `close`/`open` are idempotent; `closed` never contains duplicates or
  unknown ids after any action.
- `normalizeLayout` handles: not an object â†’ default; `closed` not an array
  â†’ default; array entries filtered to known ids, deduped; `'patterns'`
  removed from `closed` if a hand-edited/stale store put it there. This is
  the Live Touch `loadLayout()` renormalization, made total and testable.
- The floor-of-one rule from Live Touch is subsumed: PATTERNS can never
  close, so at least one window is always open; the "single remaining
  window fills the workspace" case falls out of the flex weights.

### 3.2 Persistence

- AsyncStorage key: **`deck_workspace_layout_v1`** (version in the key,
  matching the Live Touch `_v2` convention and the app's other
  AsyncStorage precedents). Value: `JSON.stringify(layout)`.
- Stored: **layout only** â€” the closed-set. Never engine state, never the
  split ratio (engine-owned via `/deck/playlist/slots`), never selections.
- Hydrate on mount â†’ `normalizeLayout(JSON.parse(...))`; a parse error is
  `console.error`-logged and yields the default (same posture as Live
  Touch's `loadLayout` catch: a corrupted *view preference* resets loudly
  to default â€” this is not an engine-state fallback, and refusing to render
  the Deck over a preference cookie would invert the mission priority).
- Persist on every reducer transition (fire-and-forget `setItem`; a failed
  write is logged, the in-memory layout stays authoritative for the session).
- A future schema change bumps the key to `_v2`; old keys are simply
  ignored (no migration â€” it's a preference).

### 3.3 Components

```
CaptainPad/components/deck/deck_workspace.tsx   â€” workspace host (rail + tracks)
CaptainPad/components/deck/deck_window.tsx      â€” window chrome (header + body)
```

**`DeckWindow`** (chrome): a thin wrapper rendering a compact header row â€”
window title in the existing 10pt SpaceGrotesk caps label recipe â€” with a
single minimize control (chevron, 28Ã—28 visual + 8pt hitSlop = 44pt target,
`accessibilityRole="button"`, `accessibilityLabel="Hide the <name> window"`,
`accessibilityState={{ expanded }}`). The protected PATTERNS window renders
**no minimize control**. Window bodies are the *existing* column contents,
passed as children â€” the internals (SplitPlaylistPanes, SectionHost usage,
GlobalParams, the autopilot panels) move unmodified.

Header placement note: PARAMETERS and AUTOPILOT already have internal
labels; the window header REPLACES the free-standing column identity, not
the cards' own labels. In the all-open default, header chrome must add no
net height versus today â€” reuse the existing label rows (PATTERNS has no
label today; give its header the same `minHeight` as the DeckHueRow top
margin absorbs, or overlay the chevron into the existing `PARAMETERS`
label row). Validators check default parity by screenshot (Â§8).

> **AS BUILT (slice A, agent _208) â€” one deviation, recorded here so nobody
> re-litigates it.** Both options above (a per-window header row, or a
> chevron overlaid into a card's existing label row) failed the parity rule
> they were meant to serve: a header row adds ~28pt to PARAMETERS and
> AUTOPILOT, and the overlay lands on top of live controls (â—Ž ALL / SAVED /
> the colour swatch in PARAMETERS; the PLAY/PAUSE + countdown header in
> AUTOPILOT). So the minimize affordances were **merged into the restore
> rail**: ONE `DeckWorkspaceBar` row under the LIVE OUTPUT header lists every
> window â€” open ones as "hide" chips in canonical order, then a `HIDDEN`
> divider, then the closed ones (the rail proper) in close order. PATTERNS is
> a static chip with no press handler, exactly as specified. `DeckWindow` is
> therefore chrome-less: it *is* the track (visibility + flex + a11y state),
> and the column style is passed through verbatim, so every window body is
> pixel-identical to the column it replaced. Net cost vs today: the one slim
> chip row â€” the same row the design already accepted for the default layout
> (COLORS ships closed, so the rail was going to be on screen anyway).

**`DeckWorkspace`** (host): owns the reducer state + hydrate/persist, and
renders:

1. **Restore rail** â€” only when `closed.length > 0`: a slim horizontal
   strip directly under the LIVE OUTPUT header (Live Touch uses a left
   vertical rail; on the Deck, horizontal costs one ~44pt row only when
   something is closed, while a left rail would permanently steal width
   from the PATTERNS list the operator already ruled must stay wide).
   One chip per closed window: color dot + name, â‰¥44pt touch target,
   `accessibilityLabel="Show the <name> window"`. Tap â†’ `open(id)`.
2. **The window tracks** â€” structure mirrors today's exactly:
   - **Wide (`isWide`)**: one flex row. Open windows get
     `{ flex: wideFlexFor(...), minWidth: 0 }`; **closed windows stay
     mounted** with `display: 'none'` (RN supports it on both native and
     web; the component keeps state; on web scroll offsets survive, on
     native ScrollView offset survival is best-effort â€” the hard
     requirement is *no remount*, Â§3.4). All-open = today's
     PATTERNS 4 / PARAMETERS 3 / AUTOPILOT 3 (+ COLORS 3 when open).
     Fewer open = the same row with fewer tracks; the survivors' flex
     shares renormalize automatically (flexbox) â€” no empty tracks. One
     open = it fills the workspace.
   - **Narrow (stacked)**: today's PATTERNS-pin + `ColumnsScrollRest`
     contract is preserved verbatim: PATTERNS (if... it is always open)
     keeps its fixed `flexBasis` pin; the *other open* windows stack
     inside the single `ColumnsScrollRest` ScrollView below, closed ones
     `display:'none'` inside it. COLORS stacks after AUTOPILOT. No
     same-axis nested ScrollViews are introduced: `SectionHost` stays a
     plain View when stacked, exactly as now.

The `SectionHost` / `sectionHostProps` idiom, the party-2026-07-11 pin
comments, and the 2026-07-27 column-weight ruling all stay in force â€” the
workspace changes *which tracks exist*, never how a track scrolls.

### 3.4 Invariants (behavior contract)

- **Stable identities, no remounts.** All four windows mount once and stay
  mounted for the life of the screen; minimize toggles `display` only.
  Window components are module-scoped (the `ColumnsScrollRest` lesson â€”
  an inline-defined host remounts children every render). Closeâ†’open of
  PARAMETERS must not reset `GlobalParams` slider state, `EntryLabelEditor`
  focus/draft, or scroll positions (web).
- **Minimize â‰  close, and never touches the engine.** Minimizing PATTERNS
  is impossible; minimizing anything else sends **no** REST/WS traffic.
  The âœ• on Deck B (`handleCloseSecondary`) remains the one and only
  engine-authoritative unbind, unchanged, inside SplitPlaylistPanes.
- **Deck B binding survives** minimize/restore of any window and app
  relaunch (it's engine state; the workspace never persists or replays it).
- **Plan lock unchanged.** The workspace (rail included) lives inside the
  existing plan-lock content wrapper, under the hermetic `PlanLockScrim`.
  Under `planGate` the window chrome freezes with everything else â€” we do
  NOT poke holes in the scrim for layout taps; the hermetic property
  (docs/38) outranks the convenience of re-arranging windows mid-plan.
  Deck-swap lock (`deckSwapInFlight`) behavior is untouched.
- **Gestures unobstructed.** The rail is a sibling row, never an overlay;
  window headers sit above (not over) the fader/split PanResponder zones;
  no `onStartShouldSetResponderCapture` anywhere in the chrome.
- **WS reconciles keep flowing to hidden windows** (they stay mounted), so
  a restored window is instantly current â€” no refetch-on-restore logic.
- **No new dependencies; offline-only** (react-native-svg is already a
  dependency and is the only "new" primitive the COLORS window uses).

---

## 4. COLORS window â€” two-color select

### 4.1 What the engine actually has (why "exactly 2")

The engine has **exactly two global color slots** â€” the CPC shared params
`colorPalette1` / `colorPalette2` (`{h,s,v}`, house policy S=V=1 â€”
docs/36); every pattern interpolates between them, and the engine slews
changes over `colorTransitionMs` (0â€“10 s). The Live Touch COLOR panel's
five slots exist only because Live Touch drives pattern-local sliders 3â€“5
on its private layer; the Deck has no such layer, so the honest Deck
surface is **two colors** â€” which is exactly what the operator asked for.

Write path (existing, shared with `ColorPickerModal`):
`updateParamCenter({ colorPalette1: {h,s:1,v:1}, colorPalette2: {h,s:1,v:1} })`
â€” one atomic POST `/param-center`, throttled ~30 Hz during drags, engine
fades over `colorTransitionMs`. Read path: `useSharedParamValues({
colorPalette1, colorPalette2 })` off the `sharedParams` WS broadcast.

### 4.2 The wheel

`CaptainPad/components/deck/hue_wheel.tsx` â€” an RN adaptation of the Live
Touch wheel's **read model** (angle â†’ hue; `readWheel`/`moveHandle` math),
not its DOM. Rendered with **react-native-svg** (already a dependency): a
hue ring built from arc segments + two draggable handles (C1, C2) placed
at their hue angles. House picker policy pins S=V=1 (docs/36), so the Live
Touch white-core/black-rim radius bands are deliberately dropped â€” the
wheel is a **hue ring**, radius is not meaningful, and a drag clamps to
the ring (the finger-overshoot rule from Live Touch stands). One
PanResponder on the wheel; grabbing starts on whichever handle is nearer
to the touch angle. Drags write live (same 33 ms throttle + trailing-write
recipe as `ColorPickerModal`'s `useThrottle`) and the WS broadcast
reconciles â€” the handles also move when another surface (picker, QUEUE,
Live Touch, a plan cue) changes the palette, because a control that does
not reflect the rig is lying (Live Touch rule).

Under the wheel: the two active colors as a `DualSwatch` + per-slot
swatches (tap a slot swatch to "arm" it â€” see below), and the live
`colorTransitionMs` seconds readout (display only; editing stays in the
picker modal â€” one home per setting).

> **AS BUILT (`_242`) — §4.2 IS A DIAL, NOT A TOUCH-TO-PLACE RING.** Operator:
> *"the color wheel, when i click, it has an unpleasant jump. can you make it a
> dial of some sort that I can consistently control by touch"*. The absolute
> read model above is **superseded**: `onPanResponderGrant` no longer paints. It
> **ANCHORS** (`beginDial`), and the hue then follows the **accumulated angular
> delta** of the finger around the centre, geared by `DIAL_GAIN = 0.5` — one
> physical revolution is HALF a hue revolution, so the circle takes two laps and
> the control is twice as fine as the ring could be at any size. The
> consequences are the point, not side effects:
>
> - **A plain tap changes nothing, by construction** — zero accumulated delta is
>   zero change, and there is no tap tolerance that could fire by accident.
>   `onDragStart` / `onDragEnd` are raised only for a drag that actually MOVED
>   something, so a tap never reaches the parent's write flush: it puts no frame
>   on the wire at all.
> - **The grab point is irrelevant.** Ring, rim, hub, or the overshoot area
>   outside the wheel all steer identically, because only the CHANGE in angle is
>   read. Handle proximity (`GRAB_PX = 26`) still decides WHICH slot a drag
>   turns, but grabbing a handle now only **ARMS** it — it changes no value.
> - **The 0°/360° seam is an ordinary step.** Every sample is a SHORT-ARC delta
>   from the PREVIOUS sample (`turnDelta`), never a difference of two absolutes,
>   so a multi-lap drag accumulates instead of folding back on itself.
> - **The hub has no angle.** Inside `DIAL_DEAD_RADIUS_PX = 14` a sample carries
>   no usable angle (a 2 pt wobble across the exact centre is a 180° swing), so
>   `lastAngle` becomes `null` and a value change requires **two consecutive
>   samples that both have a real angle**. A swipe straight THROUGH the centre
>   therefore freezes the dial rather than reading as a half turn: a stroke
>   across the middle is a line, not a turn.
> - **New `dialValue` prop on `HueWheel`.** The dial normally anchors on
>   `hues[armed]`; while a scheme is latched (docs/55 §9 A9.3) `colors_window`
>   passes `latched ? latched.base : undefined` and the dial steers the
>   **latch's BASE** instead — anchoring on `hues[armed]` would re-introduce the
>   jump the moment A/B point at a ring slot other than T1. The pointer and the
>   centre readout follow `dialValue` too, so the number inside the dial is
>   always the number the dial is turning.
>
> **Chrome** (docs/54's rotary vocabulary): a knurled **hub** to grab, a 36-mark
> **tick ring** (`dialTicks`, majors every 3rd) and a **pointer** from the hub's
> edge out to the ring at the steered value. The hub's rim and the pointer light
> in `armedStroke` while a finger is down — the only feedback a touch produces
> and the only animation in the component.
>
> **Unchanged:** the `_211` gesture armor (§8 AS BUILT item 4), the docs/36
> S=V=1 pin, and the throttled atomic `/param-center` write with its broadcast
> reconciliation. The ring still MAPS angle↔hue exactly as §4.2 describes —
> that is what puts a handle where its colour is; what changed is how a TOUCH is
> read. The maths is pure and lives in `colors_window_logic.ts` (`wrap01`,
> `turnDelta`, `beginDial`, `dialSample`, `dialHue`, `dialTicks`), so the wrap,
> the accumulation and the gain are asserted by the suite rather than eyeballed
> inside a PanResponder closure; `hue_wheel.tsx` owns only the plumbing and the
> chrome.

### 4.3 Preset hues + "choose only 2 of them"

The rig's preset hues are the palette library (`GET /color-palettes`,
`config.colorPalettes` `{id,name,c1,c2}` â€” already cached app-wide via
`getCachedColorPalettes`/`warmColorPalettesCache`). The window renders a
**preset hue strip**: the library's `c1`/`c2` values flattened, deduped
(round to 1/360), rendered as single-hue chips (â‰¥44pt).

Selection model â€” "only 2" is enforced by construction, never by refusal:

- The window always shows two slots, C1 and C2 (they ARE the engine's two
  slots). One slot is **armed** (default C1; tapping a slot swatch arms it;
  after an assignment the armed slot auto-advances to the other â€” so "tap
  chip, tap chip" sets both, matching the operator's "choose only 2" flow).
- Tapping a preset chip assigns its hue to the armed slot and writes both
  params atomically (the unarmed slot keeps its value â€” one POST, no
  flicker, same recipe as the picker).
- ~~Dragging a wheel handle edits that slot directly (arming follows the
  grabbed handle).~~ **AS BUILT (`_242`):** a grab only ARMS the nearer
  handle; the value then follows the ROTATION of the drag, not where the
  finger landed — see the dial note under §4.2.

There is no separate "selected set" state to persist: the selection IS
`colorPalette1/2`, engine-owned, reconciled by broadcast. `DeckHueRow`
(the deck channel's F-hue trim) is orthogonal â€” it rotates the deck's
rendered RGB after patterns run and composes with any palette; no
interaction needed or designed.

### 4.4 Single-writer gate

If the color autopilot daemon is active (either the existing palette-set
mode or TURNS, Â§5), its ticks own `colorPalette1/2`; a manual wheel write
would fight it between ticks. Rule (single writer, made visible):

- When `colorAutopilot.active` is true, the two-color surface renders
  **read-only** (dimmed wheel, live handles tracking the rotation) with
  one explicit affordance: **"ROTATION IS DRIVING â€” TAP TO PAUSE"**, which
  posts `{active:false}` through the deck screen's existing
  `handleColorAutopilotChange` (optimistic + rollback + broadcast
  reconcile). No silent auto-pause: pausing an autopilot is an engine
  state change and must be an explicit operator act.

---

## 5. COLORS window â€” PALETTE TURNS

### 5.1 Operator ask â†’ mechanism

"Rotating the 5 colors we choose so we have a switching fading color
palette." With two engine slots, the honest rendering of a 5-color
rotation is: at any moment the rig shows an **adjacent pair** of the
chosen ring of colors, and on each turn the pair advances one step with a
crossfade â€” over 5 turns every chosen color has been on the rig, always
blended with its ring neighbor:

```
turn:  1        2        3        4        5        (repeat)
pair:  (T1,T2)  (T2,T3)  (T3,T4)  (T4,T5)  (T5,T1)
```

### 5.2 Where the rotation runs: ENGINE-SIDE, in the existing daemon

The rotation is exactly what `marsin_engine/lib/color_autopilot.js`
already does â€” a self-rescheduling engine daemon that applies "the next
palette (pair)" every `delay_s`, crossfading over `transitionMs`
(additive to the hold, per the 2026-07-03 operator ruling), broadcasting
`colorAutopilot` + `nextSwapAtMs` on every change, persisting to its
runtime file, and already composed with the timeline
(`_applyColorAutopilot`, deck-pin-release `deactivate()`).

**Decision: TURNS = a color-autopilot configuration, not a new mechanism.**

- **Survives iPad sleep / app kill** â€” the daemon lives in the engine.
  A CaptainPad `setInterval` pushing `/param-center` writes dies with the
  tab, exactly the Live Touch deadman-gap class of failure. Rejected.
- **Single writer by construction** â€” TURNS and the existing AUTOPILOT
  COLORS palette-set cycling are two front-ends to the SAME daemon config.
  There is one hue writer (the daemon) when active; conflicts are resolved
  at the *config* level by explicit operator POSTs, never at the
  per-frame hue level. A separate turns daemon would be a second writer
  racing the first. Rejected.
- **Countdown, plan composition, panel display come free** â€” the
  `colorAutopilot` broadcast already drives `ColorAutopilotPanel`
  (read-only under plan lock), the `SwapCountdown`, and cue-driven
  reconfiguration.

### 5.3 The one engine gap â†’ engine slice E1 (separate slice)

`ColorAutopilot.validate` requires `palettes` to be **known library ids**;
the 5 chosen colors are ad-hoc. **E1: accept inline pair entries** in the
`palettes` array alongside id strings:

```
palettes: (string | { c1: number, c2: number })[]   // hues 0..1
```

- `validate`: an object entry must have finite `c1`,`c2` in [0,1] â€” else
  throw (P0, same loudness as unknown ids).
- Resolution (api_server's `_resolvePalette` path): an inline entry maps to
  `{ colorPalette1: {h:c1,s:1,v:1}, colorPalette2: {h:c2,s:1,v:1} }` â€” the
  same shape library ids resolve to, so hard cut, crossfade tween,
  `seedCurrentParams`, and the timeline path all work untouched.
- Broadcast/GET/runtime-persist carry the inline objects verbatim (YAML
  and JSON both handle them; the runtime file already dumps the block).
- `DeckColorAutopilotConfig.palettes` in `CaptainPad/utils/api.ts` widens
  to `(string | { c1: number; c2: number })[]`; `ColorAutopilotPanel`
  renders an inline entry as a `DualSwatch(c1,c2)` chip labeled `CUSTOM`
  (it currently `byId.get(id)`-skips unknowns â€” that skip would silently
  hide TURNS entries, so the render branch is part of the CaptainPad
  slice, not optional).
- Tests: `marsin_engine/tests/effects/color_autopilot.test.js` gains
  validate/resolve/crossfade cases for inline entries; the API test
  asserts POST round-trip + broadcast shape.

**No new endpoint, no new WS type, no new daemon** â€” E1 is a widening of
one validator + one resolver. Until E1 lands, the COLORS window ships with
TURNS greyed ("engine update required") â€” the window must not fake it
client-side (P0: no fallback).

### 5.4 TURNS UI

- **Five slots T1â€“T5** (local component state until START; they are a
  *draft*, not engine state). Fill them exactly like two-color select:
  arm a slot, tap a preset chip or the wheel. Prefill on first open:
  T1=live C1, T2=live C2, T3â€“T5 empty. START requires all 5 (the ask is
  five; partial rotation is just the existing AUTOPILOT COLORS feature).
- **One control: TURN EVERY** â€” the existing cadence pill bar
  (`TimerPillBar`, presets 5/10/15/30/60/120/180 s) â†’ `delay_s`.
  The crossfade is **derived, not asked**: `transitionMs =
  clamp(round(delay_s*1000*0.25), 500, 3000)` â€” always "switching,
  fading", never a hard cut, never a fade that eats the look (additive
  scheduling means the fade extends the cycle; at the 30 s default that
  is a 3 s fade). Fine tuning stays available in ColorAutopilotPanel's
  TRANSITION bar (same config field â€” the two surfaces cannot disagree
  because the broadcast reconciles both).
- **START TURNS** posts one config through the existing
  `handleColorAutopilotChange` path:
  `{ active: true, shuffle: false, delay_s, transitionMs,
     palettes: [{c1:T1,c2:T2},{c1:T2,c2:T3},{c1:T3,c2:T4},{c1:T4,c2:T5},{c1:T5,c2:T1}] }`
  (pair derivation is a pure function in `colors_window_logic.ts`,
  unit-tested). **STOP** posts `{active:false}`.
- **State display**: while a turns config is live, the window shows the
  ring of 5 with the currently-lit pair highlighted (derived from the
  broadcast palettes + the reconciled `colorPalette1/2` shared params) and
  the shared `SwapCountdown`.
- **Composition**: starting TURNS overwrites the palette-set selection in
  the shared config (the panel's chips become the 5 CUSTOM pairs â€” visible
  truth); starting a palette-set cycle from the panel likewise replaces
  TURNS. Both are explicit POSTs by the operator; the broadcast keeps
  every surface honest. Plan cues keep working unchanged
  (`timeline_service._applyColorAutopilot` validates the same shape).

---

## 6. File / slice plan

**Slice A â€” workspace (CaptainPad only, no engine):**
- `CaptainPad/components/deck/deck_workspace_layout.ts` (+ `deck_workspace_layout.test.ts`)
- `CaptainPad/components/deck/deck_workspace.tsx`, `deck_window.tsx`
- `CaptainPad/app/(tabs)/index.tsx` â€” wrap the three existing columns in
  windows; move nothing else. Keep every existing comment block that
  records operator rulings (column weights, patterns-pin, scrim).

**Slice B â€” COLORS window, two-color mode (CaptainPad only):**
- `CaptainPad/components/deck/colors_window.tsx`, `hue_wheel.tsx`,
  `colors_window_logic.ts` (+ `.test.ts`: hue dedupe, armed-slot
  advance, angleâ†”hue math).
- Registers as the 4th window (default closed â†’ default Deck unchanged).

**Slice C â€” engine E1 (separate engine slice, gate for TURNS):**
- `marsin_engine/lib/color_autopilot.js` (validate) +
  `marsin_engine/lib/api_server.js` (resolve/knownIds gate) + tests.

**Slice D â€” TURNS UI (CaptainPad, after C):**
- `colors_window.tsx` TURNS mode + pair derivation in
  `colors_window_logic.ts` (+ tests), `utils/api.ts` type widening,
  `ColorAutopilotPanel` CUSTOM-chip rendering.

Ordering: A âˆ¥ B, then C, then D. Each slice independently shippable.

### Shared-tree protocol (MANDATORY for implementers)

The operator's other AI edits this tree concurrently. For every file you
touch: **re-read it immediately before editing** (it may have moved under
you since your last read); make **surgical edits** (smallest possible
oldâ†’new spans, never whole-file rewrites of `index.tsx`); if a file's
content no longer matches what your plan assumed â€” or an edit fails to
anchor â€” **stop and report**, do not force or re-generate. Never revert or
"clean up" changes you did not make. No git operations. The running stack
(ports 6966â€“6972) is the coordinator's â€” never start/stop/restart it;
validators screenshot a fresh dist on :7167 only (see memory:
operator-manages-expo, metro-stale-watcher).

---

## 7. Test list

Pure (vitest, `deck_workspace_layout.test.ts` / `colors_window_logic.test.ts`):
- reducer: close/open idempotence; `close('patterns')` returns same ref;
  unknown id actions are no-ops; reset.
- normalize: non-object / wrong shape â†’ default; unknown + duplicate ids
  dropped; `'patterns'` purged from closed; order preserved; total (never
  throws) over a fuzz table of junk inputs.
- `wideFlexFor`: all-open = 4/3/3/3; each subset has no zero-weight open
  window; single-open fills.
- colors logic: preset-hue dedupe; armed-slot auto-advance; TURNS pair
  derivation `[T1..T5] â†’ 5 adjacent pairs` incl. wrap; derived
  transitionMs clamp table.

Behavior (manual/screenshot, fresh dist on :7167):
- default parity â€” Deck renders visually equivalent to today (all three
  windows open, COLORS on the rail chip onlyâ€¦ confirm chrome adds no
  height);
- minimize PARAMETERS â†’ AUTOPILOT + PATTERNS absorb the width, no empty
  track; restore â†’ `GlobalParams` slider values / entry-label draft /
  (web) scroll offsets intact â€” proves no remount;
- minimize both PARAMETERS and AUTOPILOT â†’ PATTERNS fills the workspace;
- Deck B bound â†’ minimize/restore AUTOPILOT + COLORS â†’ Deck B still bound,
  split ratio unchanged (no playlist traffic in the network log);
- PATTERNS has no close affordance; hand-seed
  `deck_workspace_layout_v1 = '{"closed":["patterns","bogus"]}'` â†’ boots
  all-open-but-colors, store renormalized;
- plan lock: engage â†’ scrim blankets rail + window chrome; take over â†’
  everything live again; deck-swap dim unchanged;
- split-divider drag and fader drags work with windows in every
  open-subset (no gesture theft by headers/rail);
- COLORS two-color: wheel drag paints the rig live (sim visible), engine
  fade over colorTransitionMs, chips assign armed slot, second surface
  (picker modal) moves the handles;
- single-writer gate: start AUTOPILOT COLORS â†’ wheel goes read-only with
  the pause affordance; pause â†’ editable;
- TURNS (after E1): start â†’ engine broadcasts 5 CUSTOM pairs, countdown
  ticks, kill the CaptainPad tab â†’ sim keeps rotating (the decisive test);
  panel and window agree after reconnect.

## 8. Screenshot matrix (validators)

| # | State | Widths |
|---|---|---|
| 1 | Default layout (parity vs pre-change reference) | iPad landscape (wide) + narrow portrait |
| 2 | PARAMETERS minimized (two-window reflow + rail) | wide |
| 3 | Only PATTERNS open (single fills) | wide + narrow |
| 4 | COLORS open, two-color mode (wheel + chips + slots) | wide + narrow |
| 5 | COLORS open, TURNS mode (5 slots + TURN EVERY + live pair) | wide |
| 6 | Restore rail with 2+ chips | wide + narrow |
| 7 | Plan lock engaged over the workspace | wide |

Narrow = portrait / <900 px; wide = iPad 11" landscape class. Compare #1
against a same-commit-parent capture of the unmodified Deck.

---

> **AS BUILT (slices B + C + D, agent _211) — four notes, recorded so nobody
> re-litigates them.**
>
> 1. ~~**The CROSSFADE is a PREVIEW, and says so on its face.**~~
>    **SUPERSEDED by `docs/55_colors_schemes_and_perf_overlay.md` §2.2, built in
>    report `_217`. The preview is RETIRED; the crossfade now DRIVES THE RIG.**
>    The original reasoning was sound and is kept here for the record: the
>    operator approved the prototype's crossfade feel (report _199), but there
>    was no engine mechanism for a continuous A↔B crossfade of the two CPC
>    slots, and driving one from a `setInterval` in the tab is precisely the
>    deadman-gap failure §5.2 rejects — so the transport animated a LOCAL
>    picture, labelled `PREVIEW · DOES NOT WRITE THE RIG`.
>    What changed is the premise, not the rule: **the mechanism now exists.** A
>    crossfade IS a two-entry chained ring `[(A,B),(B,A)]` on the EXISTING
>    engine colour-autopilot daemon, and the continuous triangle is
>    `delay_s: 0` (docs/55 §3.1 — guarded, so zero hold plus zero fade stays
>    unrepresentable). So the card is now `CROSSFADE · DRIVES THE RIG`, the
>    local loop is gone (there is no `setInterval`/rAF left in the file), the
>    wash/par/blend readouts are DERIVED from the broadcast `colorPalette1/2`
>    — the glass shows the ship — and STOP freezes in place NATIVELY via the
>    daemon's `_cancelTween`. §5.2's rule stands untouched: rotation and fading
>    run engine-side, and the only tab-driven writes are still finger-driven
>    and throttled (the wheel, and now the BLEND scrubber).
> 2. **Saved pairs are SCENE-OWNED — one new REST pair, `GET/POST
>    /color-pairs`.** The operator ruled the gallery is shared across every
>    iPad, and §4/_199 §1.6 rule out localStorage as authority. There was no
>    existing scene-owned store that fits (`param_presets` is pattern params;
>    `colorPalettes` is tracked, comment-bearing config), so the list lives in
>    `states/<scene>/color_pairs_state.yaml` behind two tiny handlers using the
>    StateManager's generic atomic load/save. Whole-list writes, max 24, strict
>    validation, **no new WS type** (a second iPad picks up a save on its next
>    window open / app reload). This is additional to E1, which is still
>    exactly the validator + resolver widening §5.3 scopes.
>    **AS BUILT (`_242`): the button is now SAVE PALETTE, and `/color-pairs` is
>    `schemaVersion: 2`.** `c1`/`c2` stay REQUIRED and unchanged — a v1 file's
>    rows are already valid v2 rows, which is the whole migration — and an entry
>    MAY additionally carry `name`, `ring` + `sel`, and `scheme` + `base`, so a
>    recall restores the whole staged palette (five colours, which two feed A
>    and B, the latch) rather than only the pair. The optional fields are
>    all-or-nothing in their groups and validated loudly on both sides; the max
>    of 24, the whole-list write and the no-new-WS-type rule are unchanged.
> 3. **The five TURNS slots are always filled** — seeded from the window's own
>    five Live Touch samples, and re-seeded from a LIVE turns ring when the
>    engine is rotating one. §5.4's "T3-T5 empty, START requires all 5" would
>    have needed an "unset colour", i.e. a value to invent; keeping the ring
>    total makes the refusal unnecessary rather than making it silent. Editing
>    the draft while a rotation runs is allowed (it is local until START), so
>    the operator can prepare the next ring live.
> 4. **The wheel owns its gesture; nothing new scrolls.** The ring claims the
>    responder on start AND move, captures ahead of the column ScrollView,
>    refuses its termination request, and sets `touch-action:none` on web.
>    Measured on a fresh dist: a deliberately vertical sweep around the ring
>    moved `colorPalette1` 0° → 90° with the column's `scrollTop` unchanged at
>    0. The show-palette list is a wrapping View, not a nested ScrollView.

## 9. Open decisions for the operator

1. **COLORS default open or on the rail?** This design defaults it CLOSED
   so the default Deck stays pixel-equivalent. If you want it always
   visible by default, say so and we flip `DEFAULT_LAYOUT` (the wide row
   then becomes 4/3/3/3 by default â€” a visible change).
2. **TURNS with fewer than 5 colors** â€” currently refused (use the
   existing palette-set autopilot instead). OK?
3. **Derived crossfade (25% of the turn period, 0.5â€“3 s)** as the
   one-control policy â€” or do you want the fade pill bar duplicated inside
   the COLORS window?
4. **Wheel S/V** â€” pinned to 1.0 per house policy (docs/36). Live Touch's
   white-core/black-rim wheel allows pale/dark picks; bringing that to the
   Deck would need the S/V policy reopened. Assumed NO.

