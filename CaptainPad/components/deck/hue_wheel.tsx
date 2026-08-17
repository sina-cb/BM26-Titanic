/**
 * HueWheel — the Deck COLORS window's hue DIAL (docs/53 §4.2, docs/54 canon).
 *
 * An RN/SVG control built on the Live Touch READ MODEL (angle → hue, 0° at the
 * top, increasing clockwise), so a handle still sits exactly where its colour
 * is. House policy pins S = V = 1 (docs/36), so the Live Touch white-core /
 * black-rim radius bands are deliberately DROPPED: radius carries no
 * information, the value scale is a RING.
 *
 * ── IT IS A DIAL, NOT A TOUCH-TO-PLACE RING (_242 order 1) ─────────────────
 *
 * OPERATOR: "the color wheel, when i click, it has an unpleasant jump. can you
 * make it a dial of some sort that I can consistently control by touch".
 *
 * THE JUMP: this component used to paint on GRANT — `hueFromPoint(touch)` was
 * written straight to the armed slot, so touching the ring teleported the value
 * to whatever angle was under the finger. A fingertip is ~40 pt across on a
 * 190 pt wheel, so no amount of care let the operator grab a handle without
 * moving it, and reaching for the far side of the ring threw the hue half a
 * revolution before the drag even began.
 *
 * NOW: touch-down ANCHORS. The hue follows the ACCUMULATED ANGULAR DELTA of the
 * finger around the centre, geared by `DIAL_GAIN` (0.5 — a full physical
 * revolution is half a hue revolution, so the control is twice as fine as the
 * ring could ever be). A plain tap therefore changes nothing at all: zero delta
 * is zero change by construction, and with nothing moved the parent is never
 * even told a drag happened, so a tap does not write the rig. The grab point is
 * irrelevant — ring, rim, hub or the overshoot area outside the wheel all steer
 * identically. All of that maths is pure and lives in `colors_window_logic`
 * (`beginDial` / `dialSample` / `dialTicks`), where the suite checks the wrap,
 * the multi-lap accumulation and the gain.
 *
 * The chrome says so: a knurled HUB you grab, a TICK RING you watch travel, and
 * a POINTER on the value — the docs/54 vocabulary for a rotary control, rather
 * than a colour ring that merely happens to accept touches.
 *
 * ── GESTURE OWNERSHIP (the one thing that is easy to get wrong here) ───────
 *
 * In wide mode this window's body sits inside the deck's per-column vertical
 * ScrollView, so a mostly-vertical drag on the wheel is exactly the gesture the
 * ScrollView wants. The wheel is a leaf 2-D control: a drag that STARTS on it
 * belongs to it, always. We claim it the same way HorizontalFader does — set
 * the responder on start AND on move, CAPTURE ahead of any ancestor, and refuse
 * the ScrollView's termination request — plus, on web, `touchAction:'none'` on
 * the container, because a browser pans from a touch that starts on a scrollable
 * ancestor before React's responder system ever hears about it. No nested
 * same-axis scroll view was introduced, and touches that begin anywhere OUTSIDE
 * the wheel still scroll the column normally. (_211 gesture armor — unchanged.)
 *
 * ── AND ON NATIVE, NONE OF THAT IS ENOUGH (the operator's iPad bug) ────────
 *
 * OPERATOR, on a physical iPad in Expo Go: dragging the dial ALSO scrolled the
 * surrounding pane, which made the control unusable.
 *
 * The _211 armor above is WEB armor. `touchAction` is a react-native-web style
 * and is already platform-gated to nothing on native; the capture handlers and
 * the termination refusal are React responder-system moves, and a `ScrollView`
 * on iOS is a real `UIScrollView` whose pan recognizer never consults that
 * system. Under the New Architecture React Native's one bridge between the two
 * — `blockNativeResponder` — is dropped by the mounting manager, and the scroll
 * view's own `touchesShouldCancelInContentView:` only looks for a JS responder
 * among its ANCESTORS, never among its descendants. So the pane pans and our
 * in-flight drag dies as a TERMINATE, exactly as reported. (Full citation:
 * `components/ui/scroll_lock.ts`.)
 *
 * The remedy is the one `dimmer_rack.tsx` already uses for its fader row:
 * hard-disable the owning scroll view for the life of the gesture. We take a
 * `scroll_lock` on GRANT (touch-down, before the finger has moved its slop
 * distance) and release it on release/terminate/unmount, and the deck's column
 * hosts render as `LockableScrollView`. NONE of the dial's semantics move: the
 * lock is taken by a TAP too, and a tap still writes nothing.
 *
 * The SVG itself is `pointerEvents="none"` so every touch lands on the
 * container View, which means `locationX/locationY` are always in WHEEL space —
 * no per-child coordinate surprises.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, PanResponder, Platform } from 'react-native';
import Svg, { Path, Circle, Line, Text as SvgText, G } from 'react-native-svg';

import {
  hueCss, unitPointForHue, degrees,
  beginDial, dialSample, dialTicks, DIAL_GAIN,
  type DialGrip,
} from '@/components/deck/colors_window_logic';
import { acquireScrollLock, type ScrollLockHandle } from '@/components/ui/scroll_lock';

// Ring resolution. 90 arcs = 4° per segment: continuous to the eye at every
// size we render, and cheap enough to rebuild on a theme change (it never
// rebuilds on a drag — the arcs are memoized on geometry alone).
const RING_SEGMENTS = 90;
// Overlap each arc by a hair so anti-aliasing can't leave hairline seams.
const SEG_OVERLAP = 0.35;
// A touch within this many points of a handle GRABS that handle. On a dial this
// no longer changes any value — it only ARMS — so it is a pure convenience:
// reach for the slot you want to turn instead of arming it from the row below.
const GRAB_PX = 26;

// ── Dial chrome geometry, as fractions of the wheel radius ────────────────
// One table so the hub, the ticks and the pointer cannot drift apart: the
// pointer spans exactly the gap between the hub's edge and the ring's inner
// edge, and the ticks sit inside that gap.
const HUB_R = 0.44;          // the graspable knob face
const TICK_OUTER = 0.63;     // just inside the colour ring
const TICK_MINOR_INNER = 0.56;
const TICK_MAJOR_INNER = 0.50;
// Knurl marks around the hub's rim — the "this rotates" cue, docs/54's physical
// -control vocabulary. Purely decorative; they carry no value.
const KNURLS = 24;
const KNURL_INNER = 0.38;

export interface HueWheelProps {
  /** One hue (0..1) per slot. 2 in TWO COLOUR mode, 5 in PALETTE TURNS. */
  hues: number[];
  /** Slot letters/numbers drawn on the handles ('A','B' / '1'..'5'). */
  labels: string[];
  /** Index of the armed slot — the one a drag turns. */
  armed: number;
  /** Arm a slot (a touch that landed on its handle). Arming changes no value. */
  onArm: (index: number) => void;
  /** Live hue edit for `index`. Fires only while the dial is actually TURNING;
   *  the PARENT throttles the engine write (33 ms, same recipe as
   *  ColorPickerModal). */
  onPick: (index: number, hue: number) => void;
  /**
   * The value the DIAL steers, when that is not simply the armed slot's hue.
   * While a scheme is latched a drag moves the latch's BASE and all five slots
   * re-generate from it, so the dial must anchor on the base — anchoring on
   * `hues[armed]` would re-introduce a jump at the exact moment the two differ
   * (an A/B selection that does not point at ring slot 1). Undefined means
   * "the armed slot's hue is the value", which is the ordinary case.
   */
  dialValue?: number;
  /** Drag lifecycle. Fired only for a drag that MOVED something — a tap raises
   *  neither, so the parent never flushes a write for a touch that changed
   *  nothing. */
  onDragStart?: () => void;
  onDragEnd?: () => void;
  /** READ-ONLY: the dial still tracks the rig (handles move on broadcast) but
   *  refuses touches. Used by the single-writer gate and the plan lock. */
  readOnly?: boolean;
  /** Called when a touch lands on a read-only dial, so the window can say WHY
   *  it refused rather than silently doing nothing. */
  onRefused?: () => void;
  size: number;
  ringWidth?: number;
  /** Theme colours for the chrome (no hex literals in this file). */
  handleStroke: string;
  armedStroke: string;
  centerFill: string;
  mutedText: string;
}

function arcPath(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const x0 = cx + Math.sin(a0) * r;
  const y0 = cy - Math.cos(a0) * r;
  const x1 = cx + Math.sin(a1) * r;
  const y1 = cy - Math.cos(a1) * r;
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r.toFixed(2)} ${r.toFixed(2)} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

/**
 * PERFORMANCE (_279): `React.memo`. The COLORS window re-renders at the engine
 * broadcast rate (~25 Hz) while a colour autopilot is tweening — see the
 * docblock on `ColorsWindow`'s memoized props. This dial is the most expensive
 * thing in that window (90 stroked ring arcs, 24 knurls, a `<G>` per handle),
 * and in PALETTE TURNS its `hues` come from the STAGED draft, which does not
 * move on a broadcast at all. Memoizing lets React skip the whole SVG subtree
 * on every one of those frames.
 *
 * SAFE WITH THE STALE-CLOSURE DISCIPLINE BELOW: the gesture handlers read the
 * live props out of `stateRef`, which is refreshed on every render THIS
 * component performs. A memo bail-out means no prop the ref mirrors changed,
 * so the ref cannot go stale — any prop that does change (including a handler
 * identity) fails the shallow compare and re-renders, refreshing the ref.
 */
export const HueWheel = React.memo(function HueWheel({
  hues, labels, armed, onArm, onPick, dialValue, onDragStart, onDragEnd,
  readOnly = false, onRefused, size, ringWidth,
  handleStroke, armedStroke, centerFill, mutedText,
}: HueWheelProps) {
  const cx = size / 2;
  const cy = size / 2;
  const rw = ringWidth ?? Math.max(18, Math.round(size * 0.16));
  const rMid = cx - rw / 2 - 2;
  const rInner = rMid - rw / 2;

  // The ring: RING_SEGMENTS stroked arcs. Memoized on geometry only — a hue
  // drag never rebuilds it.
  const ring = useMemo(() => {
    const step = (Math.PI * 2) / RING_SEGMENTS;
    const out: React.ReactElement[] = [];
    for (let i = 0; i < RING_SEGMENTS; i++) {
      const a0 = i * step;
      const a1 = a0 + step * (1 + SEG_OVERLAP);
      out.push(
        <Path
          key={i}
          d={arcPath(cx, cy, rMid, a0, a1)}
          stroke={hueCss((i + 0.5) / RING_SEGMENTS)}
          strokeWidth={rw}
          fill="none"
        />,
      );
    }
    return out;
  }, [cx, cy, rMid, rw]);

  // The printed SCALE. Geometry-only, so it is built once and never touched by
  // a drag; `dialTicks` owns the count/spacing so the suite can assert it.
  const ticks = useMemo(() => dialTicks().map((t, i) => {
    const u = unitPointForHue(t.turn);
    const inner = rInner * (t.major ? TICK_MAJOR_INNER : TICK_MINOR_INNER);
    const outer = rInner * TICK_OUTER;
    return (
      <Line
        key={i}
        x1={cx + u.x * inner}
        y1={cy + u.y * inner}
        x2={cx + u.x * outer}
        y2={cy + u.y * outer}
        stroke={t.major ? handleStroke : mutedText}
        strokeWidth={t.major ? 2 : 1}
        opacity={t.major ? 0.9 : 0.35}
        strokeLinecap="round"
      />
    );
  }), [cx, cy, rInner, handleStroke, mutedText]);

  // The hub's knurl — the grip texture that says "turn me". Decorative only.
  const knurls = useMemo(() => Array.from({ length: KNURLS }, (_, i) => {
    const u = unitPointForHue(i / KNURLS);
    return (
      <Line
        key={i}
        x1={cx + u.x * rInner * KNURL_INNER}
        y1={cy + u.y * rInner * KNURL_INNER}
        x2={cx + u.x * rInner * HUB_R}
        y2={cy + u.y * rInner * HUB_R}
        stroke={handleStroke}
        strokeWidth={1}
        opacity={0.5}
        strokeLinecap="round"
      />
    );
  }), [cx, cy, rInner, handleStroke]);

  // Latest props for the gesture handlers. The PanResponder is built ONCE (a
  // rebuilt responder mid-drag drops the gesture), so it reads everything
  // through refs — the same stale-closure discipline HorizontalFader uses.
  const stateRef = useRef({
    hues, armed, readOnly, dialValue, onArm, onPick, onDragStart, onDragEnd, onRefused, cx, cy, rMid,
  });
  stateRef.current = {
    hues, armed, readOnly, dialValue, onArm, onPick, onDragStart, onDragEnd, onRefused, cx, cy, rMid,
  };
  // Page-space origin of the wheel, captured on grant so MOVE (which only has
  // page coordinates) can be converted back into wheel space.
  const originRef = useRef({ x: 0, y: 0 });
  const draggingRef = useRef(false);
  // The live grab: where the value started and how far the finger has travelled
  // since. Null between drags.
  const gripRef = useRef<DialGrip | null>(null);
  // Which slot this drag turns — decided ONCE on grant, so re-arming from
  // elsewhere mid-drag cannot hand the finger a different slot.
  const dragSlotRef = useRef(0);
  // Has this drag moved anything? A drag that has not is still a tap, and a tap
  // owes the parent no lifecycle and the rig no write.
  const movedRef = useRef(false);
  // Chrome only: the hub lights while a finger is down.
  const [gripped, setGripped] = useState(false);
  // NATIVE SCROLL LOCK. Held from grant to release/terminate; null when the
  // dial holds nothing. See the "AND ON NATIVE" section of the docblock.
  const scrollLockRef = useRef<ScrollLockHandle | null>(null);

  /** Freeze the owning ScrollView. NATIVE ONLY — on web the _211 armor already
   *  works and must not be touched. Re-entrant: a second call while held is a
   *  no-op, so the responder can never leak a second lock. */
  const lockScroll = useCallback(() => {
    if (Platform.OS === 'web') return;
    if (scrollLockRef.current) return;
    scrollLockRef.current = acquireScrollLock();
  }, []);

  /** Give the scroll view back. Safe to call when nothing is held, which is
   *  what lets release AND terminate AND unmount all call it unconditionally. */
  const unlockScroll = useCallback(() => {
    const held = scrollLockRef.current;
    if (!held) return;
    scrollLockRef.current = null;
    held.release();
  }, []);

  // A dial unmounted mid-drag (window closed, mode switch, tab teardown) fires
  // neither Release nor Terminate — without this the deck's columns would stay
  // frozen with no finger anywhere near them.
  useEffect(() => unlockScroll, [unlockScroll]);

  /** Wheel-space touch → the slot the grab belongs to, arming it if needed. */
  const grabSlot = useCallback((x: number, y: number): number => {
    const s = stateRef.current;
    let best = -1;
    let bestD = GRAB_PX;
    for (let i = 0; i < s.hues.length; i++) {
      const u = unitPointForHue(s.hues[i]);
      const hx = s.cx + u.x * s.rMid;
      const hy = s.cy + u.y * s.rMid;
      const d = Math.hypot(x - hx, y - hy);
      if (d < bestD) { bestD = d; best = i; }
    }
    if (best >= 0 && best !== s.armed) {
      s.onArm(best);
      return best;
    }
    return s.armed;
  }, []);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      // CAPTURE ahead of the column ScrollView: a drag that starts on the dial
      // is the dial's, whichever direction it goes.
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponderCapture: () => true,
      // Refuse to hand the gesture back once we have it.
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (evt) => {
        const s = stateRef.current;
        // A refused touch takes NO lock: a read-only dial is not steering
        // anything, so the column must stay scrollable under the finger.
        if (s.readOnly) { if (s.onRefused) s.onRefused(); return; }
        // BEFORE anything else. The scroll view makes its cancel-the-content-
        // touches decision within a few points of finger travel, so the
        // `scrollEnabled={false}` prop has to start its trip to the main queue
        // on touch-down, not on the first move.
        lockScroll();
        const { locationX, locationY, pageX, pageY } = evt.nativeEvent as any;
        originRef.current = { x: pageX - locationX, y: pageY - locationY };
        const slot = grabSlot(locationX, locationY);
        dragSlotRef.current = slot;
        // ANCHOR — do not paint. This single line is the whole fix for the jump:
        // the value at touch-down is recorded, and nothing is written.
        const anchor = typeof s.dialValue === 'number' ? s.dialValue : (s.hues[slot] ?? 0);
        gripRef.current = beginDial(anchor, locationX - s.cx, locationY - s.cy);
        draggingRef.current = true;
        movedRef.current = false;
        setGripped(true);
      },
      onPanResponderMove: (_evt, gs) => {
        const grip = gripRef.current;
        if (!draggingRef.current || !grip) return;
        const s = stateRef.current;
        const dx = gs.moveX - originRef.current.x - s.cx;
        const dy = gs.moveY - originRef.current.y - s.cy;
        const next = dialSample(grip, dx, dy, DIAL_GAIN);
        gripRef.current = next.grip;
        if (!next.moved) return;
        if (!movedRef.current) {
          movedRef.current = true;
          if (s.onDragStart) s.onDragStart();
        }
        s.onPick(dragSlotRef.current, next.hue);
      },
      onPanResponderRelease: () => {
        // Unconditional and first: the lock must go back even on a path that
        // early-returns below, or a stuck lock outlives the finger.
        unlockScroll();
        if (!draggingRef.current) return;
        draggingRef.current = false;
        gripRef.current = null;
        setGripped(false);
        // Only a drag that MOVED gets an end: the parent flushes a write there,
        // and a tap must not put a redundant frame on the wire.
        if (movedRef.current && stateRef.current.onDragEnd) stateRef.current.onDragEnd();
        movedRef.current = false;
      },
      // A cancelled gesture (browser pointercancel, focus loss) never fires
      // Release — mirror it, or the parent's drag guard sticks on forever.
      onPanResponderTerminate: () => {
        unlockScroll();
        if (!draggingRef.current) return;
        draggingRef.current = false;
        gripRef.current = null;
        setGripped(false);
        if (movedRef.current && stateRef.current.onDragEnd) stateRef.current.onDragEnd();
        movedRef.current = false;
      },
    }),
  ).current;

  // WHERE THE DIAL IS POINTING. The steered value, which is the armed slot's hue
  // in the ordinary case and the latch's base while a scheme is latched.
  const pointerHue = typeof dialValue === 'number' ? dialValue : (hues[armed] ?? 0);
  const pointerU = unitPointForHue(pointerHue);

  return (
    <View
      style={[
        { width: size, height: size, opacity: readOnly ? 0.55 : 1 },
        // Web only: stop the browser from panning the scroll container from a
        // touch that started here. `touchAction` is a react-native-web style;
        // passing it on native would be an unknown style prop.
        Platform.OS === 'web' ? ({ touchAction: 'none' } as any) : null,
      ]}
      accessibilityRole="adjustable"
      accessibilityLabel="Colour hue dial — drag around it to turn; a tap does not change the colour"
      accessibilityValue={{ text: hues.map((h, i) => `${labels[i]} ${degrees(h)} degrees`).join(', ') }}
      accessibilityState={{ disabled: readOnly }}
      {...panResponder.panHandlers}
    >
      <Svg width={size} height={size} pointerEvents="none">
        {ring}
        {ticks}

        {/* THE POINTER — the dial's current-value indicator, from the hub's
            edge out to the ring. Drawn UNDER the handles so a handle sitting on
            the same angle reads as the pointer's head. */}
        <Line
          x1={cx + pointerU.x * rInner * HUB_R}
          y1={cy + pointerU.y * rInner * HUB_R}
          x2={cx + pointerU.x * rInner}
          y2={cy + pointerU.y * rInner}
          stroke={gripped ? armedStroke : mutedText}
          strokeWidth={gripped ? 4 : 3}
          strokeLinecap="round"
        />

        {/* THE HUB — the graspable knob face. Its rim lights while a finger is
            down, which is the only animation in this component and the only
            feedback a tap ever produces. */}
        <Circle
          cx={cx}
          cy={cy}
          r={rInner * HUB_R}
          fill={centerFill}
          stroke={gripped ? armedStroke : handleStroke}
          strokeWidth={gripped ? 3 : 1.5}
        />
        {knurls}

        {hues.map((h, i) => {
          const u = unitPointForHue(h);
          const hx = cx + u.x * rMid;
          const hy = cy + u.y * rMid;
          const isArmed = i === armed;
          return (
            <G key={i}>
              <Circle
                cx={hx}
                cy={hy}
                r={isArmed ? 15 : 12}
                fill={hueCss(h)}
                stroke={isArmed ? armedStroke : handleStroke}
                strokeWidth={isArmed ? 4 : 2}
              />
              <SvgText
                x={hx}
                y={hy + 4}
                fontSize={11}
                fontWeight="bold"
                fill={centerFill}
                textAnchor="middle"
              >
                {labels[i]}
              </SvgText>
            </G>
          );
        })}

        {/* Centre readout — the value the dial is steering, so the number the
            operator is turning sits inside the thing they are turning. */}
        <SvgText
          x={cx}
          y={cy + 5}
          fontSize={Math.round(size * 0.13)}
          fontWeight="bold"
          fill={mutedText}
          textAnchor="middle"
        >
          {`${degrees(pointerHue)}°`}
        </SvgText>
      </Svg>
    </View>
  );
});
