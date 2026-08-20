# _263 — COLORS hue dial: native scroll-lock seam (the iPad drag that also scrolled the pane)

**Subsystem:** CaptainPad — Deck COLORS window, shared fader, deck scroll hosts
**Kind:** bug fix + gesture-armor audit
**Branch:** `feat/bm_audio_tuning` (shared tree; no git ops)

## The order

Operator, physical iPad, native Expo Go: *dragging the COLORS hue dial also
scrolls the surrounding pane — the drag is unusable.*

## Root cause — the `_211` gesture armor is WEB armor, and native never saw it

The `_242` dial already carried what looks like a complete claim on the
gesture: responder on start **and** move, both **capture** handlers, and
`onPanResponderTerminationRequest: () => false`. All of that is React's JS
responder system. A native `ScrollView` is a real `UIScrollView` whose pan
gesture recognizer **never consults that system**, and under the New
Architecture (this app: `newArchEnabled: true`, RN 0.81.5, Expo 54) React
Native's one bridge between the two is severed at both ends. From RN's own
sources in `node_modules`:

- `React/Fabric/Mounting/RCTMountingManager.mm` →
  `setIsJSResponder:blockNativeResponder:forShadowView:` **receives
  `blockNativeResponder` and drops it** — it forwards only
  `[componentView setIsJSResponder:]`.
- `React/Fabric/Mounting/ComponentViews/ScrollView/RCTScrollViewComponentView.mm`
  → `touchesShouldCancelInContentView:` answers from
  `_shouldDisableScrollInteraction`, which walks **`self.superview` UPWARD**
  looking for a JS responder. The dial is a **descendant** of the scroll view,
  so it is never on that path.

(The old architecture is no better: `React/Modules/RCTUIManager.mm` declares
the flag `__unused`. So `onShouldBlockNativeResponder` is inert on both.)

Net effect on the iPad: the scroll view cancels the touches in its content
view, the pane pans, and the drag it stole dies as a responder **terminate** —
exactly the reported symptom. The `touchAction:'none'` container style is
already platform-gated to nothing on native, so on the iPad the dial had, in
practice, **no armor at all**.

`dimmer_rack.tsx` had already found this the hard way and hand-wired
`scrollEnabled={!faderDragging}` on its fader row, with a comment naming the
cause. This wave generalises that remedy so a control buried inside a window
can reach the scroll view that owns it.

## The design — an opt-in scroll lock

**New — `CaptainPad/components/ui/scroll_lock.ts`** (pure TS, no `react-native`
import, so vitest can load it). A module-level store, deliberately **not** a
React context: the cooperating parties (a dial in `components/deck/`, a scroll
host in `app/(tabs)/`) have no common ancestor worth threading a provider
through. `acquireScrollLock()` returns a handle whose `release()` is
**idempotent by construction** — it deletes a unique `symbol` from a `Set`, so a
double release is a `Set.delete` returning `false`, not a counter driven
negative. There is no `if (depth > 0)` guard anywhere, because there is no state
a caller can corrupt. Notifies only on the idle↔locked transitions.

**New — `CaptainPad/components/ui/lockable_scroll_view.tsx`.** A drop-in
`ScrollView` that reads the store via `useSyncExternalStore` and renders
`scrollEnabled={locked ? false : scrollEnabled}` — the caller's own prop
(including `undefined`) passes through untouched when idle.

**Changed — `components/deck/hue_wheel.tsx`.** Takes the lock in
`onPanResponderGrant` (touch-**down**: the scroll view makes its cancel
decision within a few points of finger travel, so waiting for the first move is
already too late), releases it unconditionally and first in
`onPanResponderRelease` **and** `onPanResponderTerminate`, and on unmount
(`useEffect(() => unlockScroll, [unlockScroll])` — a dial unmounted mid-drag
fires neither handler, and a leaked lock is a deck that never scrolls again).
The lock is taken **after** the `readOnly` refusal, so a refused touch leaves
the column scrollable.

**Changed — `components/ui/HorizontalFader.tsx`.** The same three-point seam.
This is what fixes the COLORS **BLEND scrubber** without touching
`colors_window.tsx` at all, and it carries every other fader in the deck's
columns with it.

**Changed — `app/(tabs)/index.tsx` (3 minimal hunks, contended file).** One
import; `SectionHost` becomes `isWide ? LockableScrollView : View`; the narrow
`ColumnsScrollRest` scroller becomes `LockableScrollView`. Those are the deck's
only two vertical scroll hosts.

**Blast radius is opt-in.** `acquireScrollLock()` is inert for every plain
`ScrollView` in the app — enlisting a host is the swap, nothing else. The
mixer's channel strips, the timeline and the dimmer rack's own already-gated
row are untouched.

**Web is byte-identical.** Every acquire is gated `Platform.OS !== 'web'` at the
call site, so nothing on web ever acquires, `scrollLockActive()` is permanently
false there, and `LockableScrollView` passes `scrollEnabled` straight through.
The `_211` browser armor (`touchAction:'none'`, the capture handlers, the
termination refusal) is untouched — all of it is still asserted by the guards.

**MUST-NOT-CHANGE, verified by guard:** `_242` dial semantics (anchor-on-touch
via `beginDial(anchor, …)`, `DIAL_GAIN`, `dialSample`, tap = no-op via the
`if (!next.moved) return` gate and the `movedRef` drag lifecycle, `dialValue`
latch steering), `_211` write throttling (untouched — no edit to
`colors_window.tsx`), `_259` yield/gate logic (untouched, same reason). **A tap
still puts nothing on the wire**: it takes and returns a scroll lock and writes
no frame.

## Sibling audit — every touch surface in the COLORS window and the deck

**Broken the same way → FIXED**

| Surface | Why it was broken |
|---|---|
| `hue_wheel.tsx` — the COLORS hue dial | the reported bug |
| `HorizontalFader.tsx` — the COLORS **BLEND scrubber**, and every fader inside the deck's PARAMETERS/AUTOPILOT/COLORS columns (`GlobalParams`, `Modulation`, `DeckOverlayStack`, `MiniFader`, `GroupRail`) | identical: capture armor only, no native seam, and these sit inside `SectionHost` |

**Fine as they are → why**

| Surface | Why it is fine |
|---|---|
| COLORS ring arm-taps, scheme pills, mode buttons, saved-palette gallery, preset icons, the driving strip's STOP | all `TouchableOpacity` — **taps, not drags**. RN's Touchable already cooperates with a scroll view (a scroll cancels the press; a stationary press fires). There is no responder war to lose. |
| `live_touch_surface.tsx` | its host already renders `scrollEnabled={false}` outright. |
| `NauticalFader.tsx` | its only real consumer is `dimmer_rack.tsx`, whose horizontal row already carries the hand-wired `scrollEnabled={!faderDragging}` seam (the prior art this wave generalises). Its `onShouldBlockNativeResponder: () => true` is inert on Fabric but harmless — left alone rather than churn a foreign file. |
| `split_playlist_panes.tsx` divider | its docblock fears "the surrounding column ScrollView", but there is none: the divider lives in the **PATTERNS** window, which is pinned in narrow mode and has **no `SectionHost`** in wide mode. No scroll owner ⇒ nothing to lock. **If the docs/63 declutter wave ever puts PATTERNS inside a scroller, this needs the same three-line seam.** |
| `pixel_view_window.tsx` | no `PanResponder` / responder props at all, and the PIXELS window deliberately has no `SectionHost`. |
| `ColorPickerModal.tsx` | its `HorizontalFader`s are outside the presets `ScrollView` (which holds only tap cards), and it renders in a `Modal`. It inherits the fader fix anyway. |
| `DeckTopBar.tsx`, `deck_hue_row.tsx` | no scroll ancestor (top bar / pinned PATTERNS column). They inherit the fader fix, which is inert there. |

**Adjacent, out of scope, flagged not touched:** `components/timeline/DayView.tsx`
(~line 146) has a bare `PanResponder` — no capture handlers, no termination
refusal — inside its own `ScrollView` (~line 361). It reads a grant position
rather than steering a value, so the failure mode is milder, but it is the same
class. Timeline, not deck; left for the timeline owner.

## Gates

- **Baseline before any edit:** 97 files / **2021 pass** / 6 skipped / **0
  fail** — no foreign reds to carry.
- **CaptainPad vitest after:** **100 files / 2132 pass / 6 skipped / 0 fail**,
  failing list EMPTY. (The file/test delta over baseline is my 2 files / 39
  tests plus concurrent landings from the `_261`/`_262` threads.)
- **New guards, mutation-honest.**
  `components/ui/scroll_lock.test.ts` (9 real unit tests: single/nested
  acquire, last-holder-wins, triple release cannot free somebody else's lock,
  no negative count, transition-only notification, self-unsubscribe during
  notification). `components/native_gesture_armor.test.ts` (30 source-text
  guards over `hue_wheel.tsx`, `HorizontalFader.tsx`,
  `lockable_scroll_view.tsx` and `app/(tabs)/index.tsx` — the `.tsx` files
  vitest cannot render, same idiom as `colors_window_wiring.test.ts`).
  **Honesty proved, not asserted:** a scratch probe applied 19 targeted
  in-memory mutations (remove the grant lock, remove either release, remove the
  unmount cleanup, drop the web gate, revert either deck host, revert the
  `scrollEnabled` ternary, drop the subscription, break each `_242` invariant,
  reorder the lock ahead of the read-only refusal) — **19/19 flipped a guard
  from pass to fail.**
- **`tsc --noEmit`:** clean on everything this wave touched. **One FOREIGN red**
  is in the tree as of the final run: `components/deck/colors_window.tsx:1156`
  — `Property 'badge' does not exist` on the slot-chip props type, an in-flight
  edit from a concurrent COLORS wave (tsc was clean at 17:39 with all of my
  source edits already in; the error appeared by 17:43). **Not mine — I made
  zero edits to `colors_window.tsx`.**
- **`expo lint`:** 0 errors, 14 warnings, all pre-existing (the one warning in
  `HorizontalFader.tsx` is the long-standing `animVal` dep on the *external
  value sync* effect, untouched by this wave; the effect I added is
  dependency-complete).
- **No service touched.** No restarts, no rebuilds. Nothing ran against
  6966-6972 / 5568 / 6981 / 7175; no engine, no scratch server, no git.

## On-device check for the operator (2 steps)

The iPad needs a fresh Metro reload of the new bundle; then, with the COLORS
window open on the Deck:

1. **Drag the hue dial** — put a finger on the wheel and rotate. The hue must
   follow the finger for the whole gesture and **the pane behind it must not
   move a pixel**, including on a deliberately vertical drag.
2. **Tap the dial** — one touch, no movement, lift. The hue readout must be
   **unchanged** (no frame on the wire), and the pane must scroll normally again
   the moment you swipe **off** the wheel.

Worth a third pass if convenient: drag the **BLEND** scrubber on the TWO COLOUR
card — same two expectations.

## Files

- new `CaptainPad/components/ui/scroll_lock.ts`
- new `CaptainPad/components/ui/lockable_scroll_view.tsx`
- new `CaptainPad/components/ui/scroll_lock.test.ts`
- new `CaptainPad/components/native_gesture_armor.test.ts`
- `CaptainPad/components/deck/hue_wheel.tsx`
- `CaptainPad/components/ui/HorizontalFader.tsx`
- `CaptainPad/app/(tabs)/index.tsx` (3 hunks)
