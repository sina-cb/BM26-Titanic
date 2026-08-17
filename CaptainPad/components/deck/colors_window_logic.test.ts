import { describe, it, expect } from 'vitest';

import {
  colour, pinned, sameColour, COLOUR_EPS,
  hsvToRgb, rgbToHsv, hexToRgb, hueCss, mixHsv,
  LIVE_TOUCH_SWATCHES,
  hueFromPoint, unitPointForHue, nearestSlot,
  slotIndexFor, pairIsLive,
  lerpHue, blendFromBroadcast, blendLabel,
  turnsPairs, isInlinePair, isTurnsConfig, turnsColors, litPairIndex,
  turnsAutopilotPatch, manualWriteGate,
  paletteWritePayload,
  normalizeColorPairs, samePair, addPalettePreset, removeColorPairAt,
  COLOR_PAIRS_MAX, TURNS_SLOT_COUNT, degrees, pairLabel,
  SCHEME_IDS, SCHEME_BASE_S, MONO_STEPS, COMP_OFFSETS, SCHEME_MIN_V,
  generateScheme, rotateHue,
  hueOf, asHsv, channelForWire,
  rotationKind, schemeTapOutcome, crossfadeAutopilotPatch, MIN_CONTINUOUS_FADE_S,
  SCHEME_ROTATION_MIN_V, GOLDEN_ANGLE_DEG,
  ANALOGOUS_STEPS, TRIADIC_STEPS, SPLIT_STEPS, TETRAD_STEPS,
  ROTATION_HOLD_PRESETS_S, ROTATION_FADE_PRESETS_S,
  rotationAutopilotPatch, assertRotationTiming,
  rotationCursor, cursorRailOffset, cursorRailSegments, CURSOR_FIT_EPS,
  orbitPairs, orbitDistance, orbitPhase, orbitWindowSlots, turnsOrbit,
  SCHEME_PAIR_DEFAULT, PAIR_CHANNEL_LABELS, selectSchemePair, schemePairColours,
  wrap01, turnDelta, beginDial, dialSample, dialHue, dialTicks,
  DIAL_GAIN, DIAL_DEAD_RADIUS_PX, DIAL_TICKS, DIAL_TICK_MAJOR_EVERY,
  samePreset, buildPalettePreset, presetIconColours, presetLabel, presetDescription,
  COLOR_PRESETS_SCHEMA_VERSION, PRESET_NAME_MAX,
  SCHEME_TITLES,
  followNoteAutopilotPatch, followNoteStateLine, assertMethodTiming, assertSchemeSubset,
  toggleSchemeSubset, nextMethodOf, noteName, NOTE_NAMES, AUDIO_SILENCE_THRESHOLD,
  FOLLOW_NOTE_DEFAULT_SCHEMES, METHOD_HOLD_PRESETS_S, METHOD_HOLD_DEFAULT_S,
  METHOD_FADE_PRESETS_S, METHOD_FADE_DEFAULT_S, NOTE_FADE_PRESETS_MS, NOTE_FADE_DEFAULT_MS,
  MIN_CONTINUOUS_METHOD_FADE_S,
  retunableLive, retuneTiming, rotationRetunePatch, RETUNE_TIMING_TAGS,
  cardForKind, kindLabel, yieldDecision, drivingStripModel, colorChipLabel, takeoverNote,
  YIELD_ON_CARD_SWITCH, YIELD_ON_WINDOW_HIDE, YIELD_ON_TAB_LEAVE, YIELD_KINDS,
  YIELD_SAY, YIELD_FAIL_SAY,
  type Hsv, type ColorPair, type PalettePreset, type DialGrip, type SchemeId,
  type RotationKind, type ColorsCard, type YieldGesture, type DrivingBroadcast,
} from './colors_window_logic';

/** The five-colour ring used across the TURNS suites, as full HSV. */
const RING_HUES = [0.07, 0.0, 0.62, 0.28, 0.74];
const RING: Hsv[] = RING_HUES.map((h) => colour(h, 1, 1));

// ── The pin policy ──────────────────────────────────────────────────────────

describe('pin policy', () => {
  it('pins every write to full saturation and brightness, keeping the hue', () => {
    expect(pinned(colour(0.42, 0.3, 0.7))).toEqual({ h: 0.42, s: 1, v: 1 });
  });

  it('is idempotent — a pinned colour survives another pass unchanged', () => {
    const once = pinned(colour(0.42, 0.3, 0.7));
    expect(pinned(once)).toEqual(once);
  });
});

// ── Colour maths ────────────────────────────────────────────────────────────

describe('colour conversions', () => {
  it('rgbToHsv is the exact inverse of hsvToRgb', () => {
    for (const h of [0, 0.13, 0.25, 0.5, 0.731, 0.99]) {
      const back = rgbToHsv(hsvToRgb(h, 1, 1));
      expect(Math.abs(back.h - h)).toBeLessThan(1e-9);
      expect(back.s).toBeCloseTo(1, 9);
      expect(back.v).toBeCloseTo(1, 9);
    }
  });

  it('a grey has no hue BY DEFINITION (h=0, s=0) — not a stand-in default', () => {
    expect(rgbToHsv([0.5, 0.5, 0.5])).toEqual({ h: 0, s: 0, v: 0.5 });
  });

  it('the five Live Touch samples carry their source hex verbatim', () => {
    expect(LIVE_TOUCH_SWATCHES.map((s) => s.hex)).toEqual(
      ['#9b5cff', '#36d7ff', '#ff9d3f', '#8be84d', '#ffd84d'],
    );
    // Provenance check (report _199 §2): hue degrees + the ENGINE/LOCAL tags.
    expect(LIVE_TOUCH_SWATCHES.map((s) => degrees(s.c.h))).toEqual([263, 192, 29, 96, 47]);
    expect(LIVE_TOUCH_SWATCHES.map((s) => s.role)).toEqual(['ENGINE', 'ENGINE', 'LOCAL', 'LOCAL', 'LOCAL']);
    // …and they are derived from the hex, not typed twice.
    for (const s of LIVE_TOUCH_SWATCHES) {
      expect(s.c).toEqual(rgbToHsv(hexToRgb(s.hex)));
    }
  });

  it('mixHsv is exact at the endpoints and continuous between them', () => {
    const a = colour(0, 1, 1);
    const b = colour(0.5, 1, 1);
    expect(mixHsv(a, b, 0)).toBe(hueCss(0));
    expect(mixHsv(a, b, 1)).toBe(hueCss(0.5));
    expect(mixHsv(a, b, -3)).toBe(hueCss(0));
    expect(mixHsv(a, b, 9)).toBe(hueCss(0.5));
    expect(mixHsv(a, b, 0.5)).toMatch(/^rgb\(\d+, \d+, \d+\)$/);
  });
});

// ── Wheel geometry ──────────────────────────────────────────────────────────

describe('wheel geometry', () => {
  it('hue 0 is UP and the ring runs clockwise', () => {
    expect(hueFromPoint(0, -1)).toBeCloseTo(0, 9);       // up
    expect(hueFromPoint(1, 0)).toBeCloseTo(0.25, 9);      // right
    expect(hueFromPoint(0, 1)).toBeCloseTo(0.5, 9);       // down
    expect(hueFromPoint(-1, 0)).toBeCloseTo(0.75, 9);     // left
  });

  it('unitPointForHue is the exact inverse of hueFromPoint', () => {
    for (const h of [0, 0.1, 0.33, 0.5, 0.87, 0.999]) {
      const u = unitPointForHue(h);
      expect(hueFromPoint(u.x, u.y)).toBeCloseTo(h, 9);
    }
  });

  it('overshooting the ring still tracks the ANGLE (radius carries no info)', () => {
    expect(hueFromPoint(0, -400)).toBeCloseTo(hueFromPoint(0, -1), 9);
  });

  it('nearestSlot grabs the closer handle ACROSS the 0/1 seam', () => {
    // 0.98 is nearer to 0.02 (0.04 away) than to 0.4 (0.42 away).
    expect(nearestSlot(0.98, [0.02, 0.4])).toBe(0);
    expect(nearestSlot(0.42, [0.02, 0.4])).toBe(1);
    // A tie is deterministic (lowest index wins) — never a coin flip.
    expect(nearestSlot(0.25, [0.0, 0.5])).toBe(0);
  });
});

// ── _242 order 1: THE DIAL ─────────────────────────────────────────────────
//
// The operator's complaint was "when i click, it has an unpleasant jump". The
// jump was the ring being an ABSOLUTE control: grant painted `hueFromPoint` of
// the touch. Every property below is a statement of the replacement contract —
// touch-down anchors, only the DELTA moves the value — and the first test is
// literally the bug that was reported.

/** Drag the dial through a list of angles (in TURNS), from a grab at `grabTurn`,
 *  and report the hue after each sample. Radius is well outside the dead zone. */
function dragDial(startHue: number, grabTurn: number, path: number[], gain = DIAL_GAIN): number[] {
  const at = (t: number) => {
    const u = unitPointForHue(t);
    return { x: u.x * 80, y: u.y * 80 };
  };
  const g0 = at(grabTurn);
  let grip: DialGrip = beginDial(startHue, g0.x, g0.y);
  const out: number[] = [];
  for (const t of path) {
    const p = at(t);
    const s = dialSample(grip, p.x, p.y, gain);
    grip = s.grip;
    out.push(s.hue);
  }
  return out;
}

describe('the dial anchors instead of teleporting (_242 order 1)', () => {
  it('THE REPORTED BUG: touching the far side of the ring does not move the value', () => {
    // The old control wrote `hueFromPoint(touch)` on grant, so a grab at 0.75
    // with the value at 0.10 lurched 234° before the drag began. Now the grab
    // is an anchor and the value is untouched.
    const u = unitPointForHue(0.75);
    const grip = beginDial(0.10, u.x * 80, u.y * 80);
    expect(dialHue(grip)).toBeCloseTo(0.10, 12);
    expect(grip.turns).toBe(0);
  });

  it('a tap — grab and release with no movement — commands the value it started at', () => {
    for (const start of [0, 0.13, 0.5, 0.87, 0.999]) {
      for (const grab of [0, 0.2, 0.66, 0.95]) {
        const u = unitPointForHue(grab);
        expect(dialHue(beginDial(start, u.x * 80, u.y * 80))).toBeCloseTo(start, 12);
      }
    }
  });

  it('a re-sample at the SAME angle reports moved:false, so a still finger writes nothing', () => {
    const u = unitPointForHue(0.3);
    const grip = beginDial(0.4, u.x * 80, u.y * 80);
    const s = dialSample(grip, u.x * 80, u.y * 80);
    expect(s.moved).toBe(false);
    expect(s.hue).toBeCloseTo(0.4, 12);
  });

  it('the hue follows the finger DELTA, scaled by the gain', () => {
    // A quarter turn of the finger at gain 0.5 is an eighth of the hue circle.
    const [h] = dragDial(0.20, 0.00, [0.25]);
    expect(h).toBeCloseTo(0.20 + 0.25 * DIAL_GAIN, 9);
  });

  it('the GRAB POINT is irrelevant — the same rotation gives the same result', () => {
    const a = dragDial(0.20, 0.00, [0.10, 0.20]);
    const b = dragDial(0.20, 0.60, [0.70, 0.80]);
    expect(b[0]).toBeCloseTo(a[0], 9);
    expect(b[1]).toBeCloseTo(a[1], 9);
  });

  it('wraps through the 0/1 seam as an ordinary step, in both directions', () => {
    // Forward across the top: 0.95 → 0.05 is +0.10 of a turn, not -0.90.
    const [fwd] = dragDial(0.50, 0.95, [0.05]);
    expect(fwd).toBeCloseTo(0.50 + 0.10 * DIAL_GAIN, 9);
    // Backward across the top: 0.05 → 0.95 is -0.10 of a turn.
    const [back] = dragDial(0.50, 0.05, [0.95]);
    expect(back).toBeCloseTo(0.50 - 0.10 * DIAL_GAIN, 9);
  });

  it('ACCUMULATES past a full revolution instead of folding back', () => {
    // Two whole laps of the finger, sampled in eighths. At gain 0.5 that is
    // exactly ONE hue revolution, so the value returns to where it started.
    const path: number[] = [];
    for (let i = 1; i <= 16; i++) path.push((i / 8) % 1);
    const out = dragDial(0.10, 0, path);
    // Half way (one physical lap) the hue has moved half the circle.
    expect(out[7]).toBeCloseTo(0.60, 9);
    expect(out[15]).toBeCloseTo(0.10, 9);
  });

  it('is geared DOWN — one physical revolution is at most one hue revolution', () => {
    // The precision requirement, as an assertion rather than a comment.
    expect(DIAL_GAIN).toBeGreaterThan(0);
    expect(DIAL_GAIN).toBeLessThanOrEqual(1);
  });

  it('a swipe THROUGH the hub freezes the dial — a line is not a rotation', () => {
    // The centre of a circle has no angle, so crossing it must not read as a
    // 180° turn. A value change requires two consecutive samples that BOTH
    // have a real angle, which is why nothing moves until the finger has been
    // back outside the hub for one sample.
    expect(Math.hypot(1, 1)).toBeLessThan(DIAL_DEAD_RADIUS_PX);
    const enter = unitPointForHue(0.25);
    const grip = beginDial(0.42, enter.x * 80, enter.y * 80);
    const inHub = dialSample(grip, 1, 1);
    expect(inHub.moved).toBe(false);
    expect(inHub.hue).toBeCloseTo(0.42, 12);
    // Straight out the far side — half a revolution of raw angle, zero move.
    const exit = unitPointForHue(0.75);
    const out = dialSample(inHub.grip, exit.x * 80, exit.y * 80);
    expect(out.moved).toBe(false);
    expect(out.hue).toBeCloseTo(0.42, 12);
    // From there the dial steers again, measured from where the finger IS.
    const on = unitPointForHue(0.80);
    const after = dialSample(out.grip, on.x * 80, on.y * 80);
    expect(after.moved).toBe(true);
    expect(after.hue).toBeCloseTo(0.42 + turnDelta(0.75, 0.80) * DIAL_GAIN, 9);
  });

  it('a grab that STARTS in the hub still anchors, and steers once it leaves', () => {
    const grip = beginDial(0.33, 0, 0);
    expect(grip.lastAngle).toBeNull();
    expect(dialHue(grip)).toBeCloseTo(0.33, 12);
    const a = unitPointForHue(0.10);
    const first = dialSample(grip, a.x * 80, a.y * 80);
    expect(first.moved).toBe(false);
    const b = unitPointForHue(0.20);
    const second = dialSample(first.grip, b.x * 80, b.y * 80);
    expect(second.hue).toBeCloseTo(0.33 + 0.10 * DIAL_GAIN, 9);
  });

  it('a non-positive gain THROWS — a dial that cannot move is a broken control', () => {
    const u = unitPointForHue(0.1);
    const grip = beginDial(0.5, u.x * 80, u.y * 80);
    expect(() => dialSample(grip, u.x * 80, u.y * 80, 0)).toThrow(/gain must be positive/);
    expect(() => dialSample(grip, u.x * 80, u.y * 80, -1)).toThrow(/gain must be positive/);
  });

  it('turnDelta is the SHORT arc, in (-0.5, +0.5]', () => {
    expect(turnDelta(0.9, 0.1)).toBeCloseTo(0.2, 12);
    expect(turnDelta(0.1, 0.9)).toBeCloseTo(-0.2, 12);
    expect(turnDelta(0.2, 0.6)).toBeCloseTo(0.4, 12);
    expect(turnDelta(0.3, 0.3)).toBe(0);
    // The exact half resolves FORWARD, matching lerpHue's tie rule.
    expect(turnDelta(0, 0.5)).toBeCloseTo(0.5, 12);
  });

  it('wrap01 folds any real into 0..1', () => {
    expect(wrap01(0.3)).toBeCloseTo(0.3, 12);
    expect(wrap01(1.3)).toBeCloseTo(0.3, 12);
    expect(wrap01(-0.7)).toBeCloseTo(0.3, 12);
    expect(wrap01(-3.7)).toBeCloseTo(0.3, 12);
  });
});

describe('the dial scale', () => {
  it('ticks are evenly spaced around one turn, majors every Nth', () => {
    const ticks = dialTicks();
    expect(ticks).toHaveLength(DIAL_TICKS);
    expect(ticks[0]).toEqual({ turn: 0, major: true });
    ticks.forEach((t, i) => expect(t.turn).toBeCloseTo(i / DIAL_TICKS, 12));
    expect(ticks.filter((t) => t.major)).toHaveLength(DIAL_TICKS / DIAL_TICK_MAJOR_EVERY);
  });

  it('refuses a scale it cannot draw rather than drawing a wrong one', () => {
    expect(() => dialTicks(1)).toThrow(/integer >= 2/);
    expect(() => dialTicks(12.5)).toThrow(/integer >= 2/);
    expect(() => dialTicks(12, 0)).toThrow(/positive integer/);
  });
});

// ── Derived selection ───────────────────────────────────────────────────────

describe('A/B badges are DERIVED, never stored', () => {
  // The two ENGINE-tagged Live Touch samples, at their EXACT hues (a rounded
  // literal would miss the ε compare — which is the point of deriving badges
  // from the same conversion the chip is drawn with).
  const H_PURPLE = LIVE_TOUCH_SWATCHES[0].c.h;
  const H_CYAN = LIVE_TOUCH_SWATCHES[1].c.h;
  const slots = [colour(H_PURPLE, 1, 1), colour(H_CYAN, 1, 1)];

  it('badges a chip whose hue, under the pin policy, IS a live slot', () => {
    expect(slotIndexFor(LIVE_TOUCH_SWATCHES[0].c, slots)).toBe(0);
    expect(slotIndexFor(LIVE_TOUCH_SWATCHES[1].c, slots)).toBe(1);
  });

  it('badges NOTHING once the wheel moves off that hue (the drag drops it)', () => {
    const dragged = [colour(H_PURPLE + 0.01, 1, 1), slots[1]];
    expect(slotIndexFor(LIVE_TOUCH_SWATCHES[0].c, dragged)).toBe(-1);
    // …and the OTHER badge is untouched: only the edited slot loses its chip.
    expect(slotIndexFor(LIVE_TOUCH_SWATCHES[1].c, dragged)).toBe(1);
  });

  it('badges a chip that is a slot even when its S/V differ (pin policy applies first)', () => {
    // Live Touch slot 4 is s 0.668 / v 0.910; under the pin it is hue-only.
    const four = LIVE_TOUCH_SWATCHES[3];
    expect(slotIndexFor(four.c, [pinned(four.c), slots[1]])).toBe(0);
  });

  it('a saved pair is LIVE only when BOTH of its hues are the two on the ship', () => {
    expect(pairIsLive({ c1: H_PURPLE, c2: H_CYAN }, slots)).toBe(true);
    expect(pairIsLive({ c1: H_CYAN, c2: H_PURPLE }, slots)).toBe(false); // order matters
    expect(pairIsLive({ c1: H_PURPLE, c2: 0.1 }, slots)).toBe(false);
  });

  it('sameColour is an ε compare, not float equality', () => {
    expect(sameColour(colour(0.5, 1, 1), colour(0.5 + COLOUR_EPS / 2, 1, 1))).toBe(true);
    expect(sameColour(colour(0.5, 1, 1), colour(0.5 + COLOUR_EPS * 10, 1, 1))).toBe(false);
  });
});

// ── D1: the SHARED shortest-arc hue interpolator ────────────────────────────
// THE REFERENCE TABLE. The identical table is pinned in the ENGINE suite
// (marsin_engine/tests/effects/color_autopilot.test.js) — the client's scrubber
// writes and the engine's tween must walk the same arc, so a change to either
// implementation breaks a test on BOTH sides.

describe('lerpHue — the shortest arc, shared bit-for-bit with the engine', () => {
  const TABLE: [number, number, number, number][] = [
    [0.9, 0.1, 0.5, 0.0],    // wraps FORWARD through 1.0 (0.2 apart, not 0.8)
    [0.1, 0.9, 0.5, 0.0],    // wraps BACKWARD through 0.0
    [0.2, 0.6, 0.5, 0.4],    // no wrap — plain midpoint
    [0.0, 0.5, 0.5, 0.25],   // exact-half tie resolves FORWARD
    [0.33, 0.33, 0.5, 0.33], // a == b is a fixed point
    [0.9, 0.1, 0.0, 0.9],    // exact endpoints
    [0.9, 0.1, 1.0, 0.1],
    [0.2, 0.6, 0.0, 0.2],
    [0.2, 0.6, 1.0, 0.6],
  ];

  it('matches the pinned reference table', () => {
    for (const [a, b, t, expected] of TABLE) {
      expect(lerpHue(a, b, t)).toBeCloseTo(expected, 12);
    }
  });

  it('never leaves the unit wheel and never takes the long way round', () => {
    for (let i = 0; i < 100; i++) {
      const a = i / 100;
      for (let j = 0; j < 100; j += 7) {
        const b = j / 100;
        for (const t of [0.1, 0.25, 0.5, 0.75, 0.9]) {
          const h = lerpHue(a, b, t);
          expect(h).toBeGreaterThanOrEqual(0);
          expect(h).toBeLessThan(1);
          const raw = Math.abs(h - a);
          expect(Math.min(raw, 1 - raw)).toBeLessThanOrEqual(0.5 * t + 1e-9);
        }
      }
    }
  });
});

// ── The crossfade card reads the SHIP, not a clock ──────────────────────────

describe('blendFromBroadcast — where on the A→B arc the rig actually sits', () => {
  it('reports the endpoints and the midpoint of a plain arc', () => {
    expect(blendFromBroadcast(0.2, 0.6, 0.2)).toBeCloseTo(0, 12);
    expect(blendFromBroadcast(0.2, 0.6, 0.4)).toBeCloseTo(0.5, 12);
    expect(blendFromBroadcast(0.2, 0.6, 0.6)).toBeCloseTo(1, 12);
  });

  it('follows the SHORT arc across the wrap, exactly like the engine tween', () => {
    // A = 0.9, B = 0.1: the short way runs 0.9 → 1.0/0.0 → 0.1.
    expect(blendFromBroadcast(0.9, 0.1, 0.0)).toBeCloseTo(0.5, 12);
    expect(blendFromBroadcast(0.9, 0.1, 0.95)).toBeCloseTo(0.25, 12);
    expect(blendFromBroadcast(0.9, 0.1, 0.05)).toBeCloseTo(0.75, 12);
  });

  it('a scrub write ROUND-TRIPS through the readout (the two share lerpHue)', () => {
    for (const [a, b] of [[0.9, 0.1], [0.2, 0.6], [0.0, 0.5]] as const) {
      for (const t of [0, 0.2, 0.5, 0.8, 1]) {
        const written = lerpHue(a, b, t);
        expect(blendFromBroadcast(a, b, written)).toBeCloseTo(t, 9);
      }
    }
  });

  it('returns NULL rather than a confident wrong number when off the arc', () => {
    // Not on the 0.2 → 0.3 segment at all.
    expect(blendFromBroadcast(0.2, 0.3, 0.8)).toBeNull();
    // Coincident endpoints have no arc to be anywhere on.
    expect(blendFromBroadcast(0.4, 0.4, 0.4)).toBeNull();
  });

  it('blendLabel names the endpoints and reads out the middle', () => {
    expect(blendLabel(0)).toBe('A');
    expect(blendLabel(1)).toBe('B');
    expect(blendLabel(0.5)).toBe('50% B');
  });
});

// ── Live Touch scheme generators, ported VERBATIM ───────────────────────────

describe('scheme generators match the Live Touch constants exactly', () => {
  it('carries the HTML block\'s own constants, unchanged', () => {
    expect(SCHEME_BASE_S).toBe(0.95);
    expect([...MONO_STEPS]).toEqual([1.0, 0.78, 0.58, 0.40, 0.25]);
    expect([...COMP_OFFSETS]).toEqual([0, 60, 30, -30, -60]);
    // The four ports keep their original places at the head of the row so the
    // operator's muscle memory survives the _224 additions.
    expect([...SCHEME_IDS].slice(0, 4)).toEqual(['master', 'hue', 'complement', 'contrast']);
  });

  it('every scheme yields exactly five colours at the base saturation', () => {
    for (const id of SCHEME_IDS) {
      const out = generateScheme(id, 0.72);
      expect(out).toHaveLength(5);
      for (const c of out) expect(c.s).toBe(SCHEME_BASE_S);
    }
  });

  it('MASTER is five identical colours', () => {
    const out = generateScheme('master', 0.31);
    for (const c of out) expect(c).toEqual({ h: 0.31, s: 0.95, v: 1 });
  });

  it('HUE is ONE hue at the five MONO_STEPS brightnesses (v floor 0.1)', () => {
    const out = generateScheme('hue', 0.72);
    expect(out.map((c) => c.h)).toEqual([0.72, 0.72, 0.72, 0.72, 0.72]);
    expect(out.map((c) => c.v)).toEqual([1.0, 0.78, 0.58, 0.40, 0.25]);
    // Every step clears the floor, and the floor exists.
    for (const c of out) expect(c.v).toBeGreaterThanOrEqual(SCHEME_MIN_V);
  });

  it('COMPLEMENT puts the FAR edge (+60 deg) in slot 2, so A/B sit 60 deg apart', () => {
    const out = generateScheme('complement', 0);
    expect(out.map((c) => Math.round(c.h * 360))).toEqual([0, 60, 30, 330, 300]);
    for (const c of out) expect(c.v).toBe(1);
  });

  it('CONTRAST is an even 72 deg pentad', () => {
    const out = generateScheme('contrast', 0);
    expect(out.map((c) => Math.round(c.h * 360))).toEqual([0, 72, 144, 216, 288]);
  });

  it('the base hue is the operator\'s, and rotation wraps the wheel', () => {
    expect(generateScheme('contrast', 0.9).map((c) => Math.round(c.h * 360)))
      .toEqual([324, 36, 108, 180, 252]);
    expect(rotateHue(0.9, 60)).toBeCloseTo(0.0666666, 5);
    expect(rotateHue(0.1, -60)).toBeCloseTo(0.9333333, 5);
    expect(rotateHue(0.5, 720)).toBeCloseTo(0.5, 12);
  });

  it('an unknown scheme THROWS — a button that quietly paints nothing is broken', () => {
    // @ts-expect-error — deliberately off-contract
    expect(() => generateScheme('rainbow', 0.5)).toThrow(/unknown scheme/);
  });
});

// ── D2: the widened pair-channel wire ───────────────────────────────────────

describe('pair channels: hue number OR full HSV, minimally encoded', () => {
  it('hueOf and asHsv read both forms', () => {
    expect(hueOf(0.4)).toBe(0.4);
    expect(hueOf({ h: 0.4, s: 0.5, v: 0.2 })).toBe(0.4);
    expect(asHsv(0.4)).toEqual({ h: 0.4, s: 1, v: 1 });
    expect(asHsv({ h: 0.4, s: 0.5, v: 0.2 })).toEqual({ h: 0.4, s: 0.5, v: 0.2 });
  });

  it('WIRE MINIMIZATION: s=1 and v=1 emit a plain number, anything else an object', () => {
    expect(channelForWire({ h: 0.4, s: 1, v: 1 })).toBe(0.4);
    expect(channelForWire({ h: 0.4, s: 0.95, v: 1 })).toEqual({ h: 0.4, s: 0.95, v: 1 });
    expect(channelForWire({ h: 0.4, s: 1, v: 0.25 })).toEqual({ h: 0.4, s: 1, v: 0.25 });
  });

  it('every existing hue-only ring keeps its EXACT current wire', () => {
    // The pre-D2 wire for this ring was five {c1: number, c2: number} pairs.
    for (const p of turnsPairs(RING)) {
      expect(typeof p.c1).toBe('number');
      expect(typeof p.c2).toBe('number');
    }
  });
});

// ── PALETTE TURNS ───────────────────────────────────────────────────────────

describe('PALETTE TURNS pair derivation', () => {
  it('5 chosen colours → 5 ADJACENT pairs, wrapping at the end', () => {
    expect(turnsPairs(RING)).toEqual([
      { c1: 0.07, c2: 0.0 },
      { c1: 0.0, c2: 0.62 },
      { c1: 0.62, c2: 0.28 },
      { c1: 0.28, c2: 0.74 },
      { c1: 0.74, c2: 0.07 },
    ]);
  });

  it('a FULL-HSV ring (the HUE scheme) carries its brightnesses onto the wire', () => {
    const hueRing = generateScheme('hue', 0.72);
    const pairs = turnsPairs(hueRing);
    expect(pairs).toHaveLength(5);
    // Every channel is an object here: s = 0.95 never minimizes to a number.
    for (const p of pairs) {
      expect(typeof p.c1).toBe('object');
      expect(typeof p.c2).toBe('object');
    }
    expect(pairs.map((p) => asHsv(p.c1).v)).toEqual([1.0, 0.78, 0.58, 0.40, 0.25]);
    // …and each pair's second colour is the ring's NEXT colour.
    expect(pairs.map((p) => asHsv(p.c2).v)).toEqual([0.78, 0.58, 0.40, 0.25, 1.0]);
  });

  it('every chosen colour appears exactly twice — once per ring neighbour', () => {
    const pairs = turnsPairs(RING);
    for (const h of RING_HUES) {
      const seen = pairs.filter((p) => hueOf(p.c1) === h).length
        + pairs.filter((p) => hueOf(p.c2) === h).length;
      expect(seen).toBe(2);
    }
  });

  it('refuses a ring too short to have neighbours (no silent one-pair rotation)', () => {
    expect(() => turnsPairs([colour(0.5, 1, 1)])).toThrow(/at least 2 colours/);
    expect(() => turnsPairs([])).toThrow(/at least 2 colours/);
  });

  it('the ring is round-trippable: pairs → colours → the same pairs', () => {
    const pairs = turnsPairs(RING);
    expect(turnsColors(pairs)).toEqual(RING);
    expect(turnsPairs(turnsColors(pairs))).toEqual(pairs);
    // …and so is a full-HSV one.
    const hueRing = generateScheme('hue', 0.72);
    expect(turnsColors(turnsPairs(hueRing))).toEqual(hueRing);
  });

  it('TURNS_SLOT_COUNT is the five the operator asked for', () => {
    expect(TURNS_SLOT_COUNT).toBe(5);
  });
});

// ── _224 order 1: ONE transport, both rings ─────────────────────────────────

describe('the shared transport — TURNS and the crossfade run on the SAME timing', () => {
  const ring = RING;

  it('exposes ONE hold row and ONE fade row, with CONT reachable', () => {
    expect([...ROTATION_FADE_PRESETS_S]).toEqual([0.4, 0.8, 1.5, 3]);
    // A superset of the `_217` crossfade hold row: CONT plus the short holds,
    // plus 30/60 s so the old set-and-forget cadences stay reachable.
    expect([...ROTATION_HOLD_PRESETS_S]).toEqual([0, 1, 2, 5, 10, 30, 60]);
    expect(ROTATION_HOLD_PRESETS_S[0]).toBe(0);
  });

  it('the two transports are literally the same function at ring lengths 2 and 5', () => {
    const two = rotationAutopilotPatch([colour(0.25, 1, 1), colour(0.75, 1, 1)], 0, 1.5);
    expect(crossfadeAutopilotPatch(0.25, 0.75, 0, 1.5)).toEqual(two);
    expect(turnsAutopilotPatch(ring, 0, 1.5)).toEqual(rotationAutopilotPatch(ring, 0, 1.5));
  });

  it('TURNS carries the operator\'s FADE verbatim — no derived 25 % heuristic', () => {
    for (const fade of ROTATION_FADE_PRESETS_S) {
      expect(turnsAutopilotPatch(ring, 5, fade).transitionMs).toBe(Math.round(fade * 1000));
    }
    // The same fade, whichever card posted it.
    expect(turnsAutopilotPatch(ring, 2, 0.8).transitionMs)
      .toBe(crossfadeAutopilotPatch(0.1, 0.6, 2, 0.8).transitionMs);
  });

  it('TURNS carries the operator\'s HOLD verbatim, CONT included', () => {
    for (const hold of ROTATION_HOLD_PRESETS_S) {
      expect(turnsAutopilotPatch(ring, hold, 1.5).delay_s).toBe(hold);
    }
    // Operator order: "if the crossfader is in CONT, TURNS in CONT rotates
    // continuously too" — superseding docs/55 §2.3's TURNS cadence floor.
    expect(turnsAutopilotPatch(ring, 0, 1.5).delay_s).toBe(0);
  });

  it('is 5 adjacent pairs, no shuffle, and exactly the five wire keys', () => {
    expect(turnsAutopilotPatch(ring, 30, 3)).toEqual({
      active: true,
      shuffle: false,
      delay_s: 30,
      transitionMs: 3000,
      palettes: [
        { c1: 0.07, c2: 0.0 },
        { c1: 0.0, c2: 0.62 },
        { c1: 0.62, c2: 0.28 },
        { c1: 0.28, c2: 0.74 },
        { c1: 0.74, c2: 0.07 },
      ],
    });
    expect(Object.keys(turnsAutopilotPatch(ring, 10, 0.8)).sort())
      .toEqual(['active', 'delay_s', 'palettes', 'shuffle', 'transitionMs']);
  });

  it('refuses exactly what the ENGINE refuses, with a sentence, on BOTH cards', () => {
    expect(() => turnsAutopilotPatch(ring, -5, 1)).toThrow(/HOLD must be 0/);
    expect(() => turnsAutopilotPatch(ring, 5, 0)).toThrow(/FADE must be a positive/);
    expect(() => turnsAutopilotPatch(ring, 0, 0.05)).toThrow(/at least 0.1s/);
    expect(() => crossfadeAutopilotPatch(0.1, 0.6, 0, 0.05)).toThrow(/at least 0.1s/);
    expect(() => assertRotationTiming(0, MIN_CONTINUOUS_FADE_S)).not.toThrow();
  });

  it('what it posts is what the window then recognises as a live ring', () => {
    const patch = turnsAutopilotPatch(ring, 15, 1.5);
    expect(isTurnsConfig(patch.palettes)).toBe(true);
    expect(turnsColors(patch.palettes)).toEqual(ring);
    expect(rotationKind(true, patch.palettes)).toBe('turns');
  });

  it('a SCHEME ring round-trips through the patch with its brightnesses intact', () => {
    const patch = turnsAutopilotPatch(generateScheme('hue', 0.72), 20, 1.5);
    expect(isTurnsConfig(patch.palettes)).toBe(true);
    expect(turnsColors(patch.palettes)).toEqual(generateScheme('hue', 0.72));
    expect(rotationKind(true, patch.palettes)).toBe('turns');
  });
});

// ── CROSSFADE = the same mechanism at ring length 2 (docs/55 §2.2) ──────────

describe('CROSSFADE RUN posts a 2-entry chained ring on the ENGINE daemon', () => {
  it('is exactly [(A,B),(B,A)] with the hold and fade the operator chose', () => {
    expect(crossfadeAutopilotPatch(0.25, 0.75, 0, 1.5)).toEqual({
      active: true,
      shuffle: false,
      delay_s: 0,
      transitionMs: 1500,
      palettes: [{ c1: 0.25, c2: 0.75 }, { c1: 0.75, c2: 0.25 }],
    });
  });

  it('posts exactly the five keys the engine expects — no new fields', () => {
    expect(Object.keys(crossfadeAutopilotPatch(0.1, 0.6, 2, 0.8)).sort())
      .toEqual(['active', 'delay_s', 'palettes', 'shuffle', 'transitionMs']);
  });

  it('is recognised as a CROSSFADE, not as a five-colour TURNS ring', () => {
    const patch = crossfadeAutopilotPatch(0.25, 0.75, 0, 1.5);
    expect(isTurnsConfig(patch.palettes)).toBe(true);   // it IS a chained ring…
    expect(rotationKind(true, patch.palettes)).toBe('crossfade'); // …of length 2
  });

  it('a HOLD is carried through verbatim (CONT is a literal 0)', () => {
    expect(crossfadeAutopilotPatch(0.1, 0.6, 5, 0.4).delay_s).toBe(5);
    expect(crossfadeAutopilotPatch(0.1, 0.6, 0, 0.4).delay_s).toBe(0);
  });

  it('REFUSES what the engine would refuse: CONT with a too-short fade', () => {
    expect(() => crossfadeAutopilotPatch(0.1, 0.6, 0, 0.05))
      .toThrow(/CONT \(no hold\) needs a fade of at least/);
    expect(MIN_CONTINUOUS_FADE_S).toBe(0.1);
    // A hold makes the same short fade legal again.
    expect(() => crossfadeAutopilotPatch(0.1, 0.6, 1, 0.05)).not.toThrow();
  });

  it('refuses a zero/negative fade or a negative hold, loudly', () => {
    expect(() => crossfadeAutopilotPatch(0.1, 0.6, 1, 0)).toThrow(/FADE must be a positive/);
    expect(() => crossfadeAutopilotPatch(0.1, 0.6, -1, 1)).toThrow(/HOLD must be 0/);
  });
});

// ── The §2.6 interaction table, row by row ──────────────────────────────────

describe('rotationKind classifies what the daemon is actually running', () => {
  it('nothing running is none, whatever the palettes say', () => {
    expect(rotationKind(false, turnsPairs(RING))).toBe('none');
    expect(rotationKind(undefined, undefined)).toBe('none');
  });

  it('a 2-entry chained ring is a crossfade; >=3 is turns', () => {
    expect(rotationKind(true, crossfadeAutopilotPatch(0.2, 0.7, 0, 1).palettes)).toBe('crossfade');
    expect(rotationKind(true, turnsPairs(RING))).toBe('turns');
    expect(rotationKind(true, turnsPairs(RING.slice(0, 3)))).toBe('turns');
  });

  it('library ids, mixed sets and unchained pairs are a palette-set', () => {
    expect(rotationKind(true, ['aurora', 'bass_drop'])).toBe('palette-set');
    expect(rotationKind(true, ['aurora', { c1: 0.1, c2: 0.2 }])).toBe('palette-set');
    expect(rotationKind(true, [{ c1: 0.1, c2: 0.2 }, { c1: 0.9, c2: 0.1 }])).toBe('palette-set');
    expect(rotationKind(true, [{ c1: 0.1, c2: 0.1 }])).toBe('palette-set');
  });
});

describe('a scheme tap during a rotation — WHICH CARD you tapped from matters (docs/61 §5, fixes C3)', () => {
  it('with nothing running it stages the ring AND writes A/B, on any surface', () => {
    const o = schemeTapOutcome('none', 'CONTRAST', 'two');
    expect(o.action).toBe('stage-and-write');
    // Byte-identical to the pre-existing (`_224`/`_248`) own-card message.
    expect(o.message).toBe('CONTRAST staged — A and B are live.');
  });

  it('TURNS tapped from its OWN card (turns) restages in one tap — byte-identical to the shipped wire', () => {
    const o = schemeTapOutcome('turns', 'CONTRAST', 'turns');
    expect(o.action).toBe('restage');
    expect(o.message).toBe('Rotation restaged to CONTRAST.');
  });

  it('FOLLOW NOTE tapped from its OWN card (follow) overrides the method — byte-identical to the `_248` wire', () => {
    const o = schemeTapOutcome('follow-note', 'COMPLEMENT', 'follow');
    expect(o.action).toBe('method-override');
    expect(o.message).toBe('Method set to COMPLEMENT — cycle continues from here.');
  });

  it('C3 REGRESSION: FOLLOW NOTE tapped from the TWO COLOUR card is NOT a method override', () => {
    const o = schemeTapOutcome('follow-note', 'COMPLEMENT', 'two');
    expect(o.action).not.toBe('method-override');
    expect(o.action).toBe('stage-only');
    expect(o.message).toBe('FOLLOW NOTE is driving — this stages only. STOP it (strip above) to write A/B.');
  });

  it('TURNS tapped from an OTHER card stages only and names the driver', () => {
    for (const surface of ['two', 'follow'] as const) {
      const o = schemeTapOutcome('turns', 'CONTRAST', surface);
      expect(o.action).toBe('stage-only');
      expect(o.message).toBe('PALETTE TURNS is driving — this stages only. STOP it (strip above) to write A/B.');
    }
  });

  it('FOLLOW NOTE tapped from an OTHER card stages only and names the driver', () => {
    for (const surface of ['two', 'turns'] as const) {
      const o = schemeTapOutcome('follow-note', 'COMPLEMENT', surface);
      expect(o.action).toBe('stage-only');
      expect(o.message).toBe('FOLLOW NOTE is driving — this stages only. STOP it (strip above) to write A/B.');
    }
  });

  it('during a crossfade it stages ONLY on EVERY card, and names the button that takes over', () => {
    for (const surface of ['two', 'turns', 'follow'] as const) {
      const o = schemeTapOutcome('crossfade', 'HUE', surface);
      expect(o.action).toBe('stage-only');
      expect(o.message).toBe('Crossfade is driving A/B — STOP it or START TURNS to run the scheme.');
    }
  });

  it('during a library palette set it stages ONLY on EVERY card, and names START TURNS', () => {
    for (const surface of ['two', 'turns', 'follow'] as const) {
      const o = schemeTapOutcome('palette-set', 'MASTER', surface);
      expect(o.action).toBe('stage-only');
      expect(o.message).toBe('AUTOPILOT palette set is driving — START TURNS to take over.');
    }
  });

  it('EVERY outcome carries a sentence — no silent tap exists', () => {
    for (const k of ['none', 'crossfade', 'turns', 'palette-set', 'follow-note'] as const) {
      for (const surface of ['two', 'turns', 'follow'] as const) {
        expect(schemeTapOutcome(k, 'CONTRAST', surface).message.length).toBeGreaterThan(10);
      }
    }
  });

  it('nothing in the table ever auto-pauses the daemon', () => {
    const actions = new Set<string>();
    for (const k of ['none', 'crossfade', 'turns', 'palette-set', 'follow-note'] as const) {
      for (const surface of ['two', 'turns', 'follow'] as const) {
        actions.add(schemeTapOutcome(k, 'X', surface).action);
      }
    }
    expect(actions.has('pause')).toBe(false);
    expect(actions).toEqual(new Set(['stage-and-write', 'restage', 'method-override', 'stage-only']));
  });

  it('an unknown kind THROWS — a scheme tap that quietly did nothing would be indistinguishable from broken', () => {
    // @ts-expect-error — deliberately off-contract
    expect(() => schemeTapOutcome('bogus', 'X', 'two')).toThrow(/unknown rotation kind/);
  });
});

describe('single-writer gate — KIND-NAMED, a refusal is always visible (docs/61 §4.2, D4)', () => {
  const DRIVING_REASON: [RotationKind, string][] = [
    ['follow-note', 'FOLLOW NOTE is driving the colours — STOP it to edit.'],
    ['turns', 'PALETTE TURNS is driving the colours — STOP it to edit.'],
    ['crossfade', 'The crossfade is driving the colours — STOP it to edit.'],
    ['palette-set', 'An AUTOPILOT palette set is driving the colours — STOP it to edit.'],
  ];
  const OFFLINE_SENTENCE = 'The rig is offline or the SHOW PLAN is driving — colours are read-only.';

  it('allows manual writes when nothing is driving and the surface is online', () => {
    expect(manualWriteGate(false, 'none')).toEqual({ canWrite: true });
  });

  it('REFUSES while ANY family is driving, and names it (kind-named sentence, byte-checked)', () => {
    for (const [kind, sentence] of DRIVING_REASON) {
      const g = manualWriteGate(false, kind);
      expect(g.canWrite).toBe(false);
      if (g.canWrite) continue;
      expect(g.reason).toBe(sentence);
    }
  });

  it('driving beats offline: REFUSES with the DRIVING sentence even when disabled is ALSO true', () => {
    for (const [kind, sentence] of DRIVING_REASON) {
      const g = manualWriteGate(true, kind);
      expect(g.canWrite).toBe(false);
      if (g.canWrite) continue;
      expect(g.reason).toBe(sentence);
    }
  });

  it('REFUSES when offline / plan-locked with nothing driving — the offline sentence, byte-identical', () => {
    const g = manualWriteGate(true, 'none');
    expect(g.canWrite).toBe(false);
    if (g.canWrite) return;
    expect(g.reason).toBe(OFFLINE_SENTENCE);
  });

  it('every refusal carries a non-empty sentence — all 5 kinds x both disabled states', () => {
    const kinds: RotationKind[] = ['none', 'follow-note', 'turns', 'crossfade', 'palette-set'];
    for (const kind of kinds) {
      for (const disabled of [false, true]) {
        const g = manualWriteGate(disabled, kind);
        if (kind === 'none' && !disabled) {
          expect(g.canWrite).toBe(true);
          continue;
        }
        expect(g.canWrite).toBe(false);
        if (!g.canWrite) expect(g.reason.length).toBeGreaterThan(10);
      }
    }
  });

  it('an unknown kind THROWS — matching schemeTapOutcome\'s default arm', () => {
    // @ts-expect-error — deliberately off-contract
    expect(() => manualWriteGate(false, 'bogus')).toThrow(/unknown rotation kind/);
  });
});

// ── docs/61 W1 — cardForKind / kindLabel ────────────────────────────────────

describe('cardForKind / kindLabel — the family <-> card mapping (docs/61 §4.1/§4.3)', () => {
  it('maps each running family to its OWN card', () => {
    expect(cardForKind('follow-note')).toBe('follow');
    expect(cardForKind('turns')).toBe('turns');
    expect(cardForKind('crossfade')).toBe('two');
  });

  it('palette-set and none own no card in THIS window', () => {
    expect(cardForKind('palette-set')).toBeNull();
    expect(cardForKind('none')).toBeNull();
  });

  it('kindLabel names every family, for sentences', () => {
    expect(kindLabel('follow-note')).toBe('FOLLOW NOTE');
    expect(kindLabel('turns')).toBe('PALETTE TURNS');
    expect(kindLabel('crossfade')).toBe('the crossfade');
    expect(kindLabel('palette-set')).toBe('an AUTOPILOT palette set');
    expect(kindLabel('none')).toBe('');
  });

  it('an unknown kind THROWS on both', () => {
    // @ts-expect-error — deliberately off-contract
    expect(() => cardForKind('bogus')).toThrow(/unknown rotation kind/);
    // @ts-expect-error — deliberately off-contract
    expect(() => kindLabel('bogus')).toThrow(/unknown rotation kind/);
  });
});

// ── docs/61 §2.1/§3 — yieldDecision, the whole §3 table as one function ────

describe('yieldDecision — the §2.1 YIELD rule as ONE total function (docs/61 §3)', () => {
  const GESTURES: YieldGesture[] = ['card', 'hide', 'tab'];
  const CARDS: ColorsCard[] = ['two', 'turns', 'follow'];
  const KINDS: RotationKind[] = ['none', 'follow-note', 'turns', 'crossfade', 'palette-set'];

  it('the DEFAULT vetoes are all ON and D2 scopes yield to follow-note only', () => {
    expect(YIELD_ON_CARD_SWITCH).toBe(true);
    expect(YIELD_ON_WINDOW_HIDE).toBe(true);
    expect(YIELD_ON_TAB_LEAVE).toBe(true);
    expect([...YIELD_KINDS]).toEqual(['follow-note']);
  });

  it('yields on EXACTLY the 3 combinations the contract names — one per gesture, leavingCard:follow, kind:follow-note, disabled:false — over the FULL cartesian product', () => {
    const yielding: string[] = [];
    for (const gesture of GESTURES) {
      for (const leavingCard of CARDS) {
        for (const kind of KINDS) {
          for (const disabled of [false, true]) {
            const d = yieldDecision({ gesture, leavingCard, kind, disabled });
            if (d.yield) yielding.push(`${gesture}/${leavingCard}/${kind}/${disabled}`);
          }
        }
      }
    }
    expect(yielding.sort()).toEqual([
      'card/follow/follow-note/false',
      'hide/follow/follow-note/false',
      'tab/follow/follow-note/false',
    ].sort());
  });

  it('L1/L2/L3 — a yielding decision carries the EXACT bare-stop body and the success narration', () => {
    for (const gesture of GESTURES) {
      const d = yieldDecision({ gesture, leavingCard: 'follow', kind: 'follow-note', disabled: false });
      expect(d).toEqual({ yield: true, post: { active: false }, say: YIELD_SAY });
      // Load-bearing (§2.1): the body is a BARE stop — never `mode`, never a
      // `followNote` block.
      expect(Object.keys(d.post as object)).toEqual(['active']);
    }
  });

  it('NEVER yields when disabled — offline / plan-locked suppresses yield exactly like every other control', () => {
    for (const gesture of GESTURES) {
      const d = yieldDecision({ gesture, leavingCard: 'follow', kind: 'follow-note', disabled: true });
      expect(d.yield).toBe(false);
      expect(d.say).toBe('');
      expect('post' in d).toBe(false);
    }
  });

  it('NEVER yields when the running kind is not follow-note (D2: TURNS/crossfade/palette-set/none persist)', () => {
    for (const kind of ['none', 'turns', 'crossfade', 'palette-set'] as const) {
      const d = yieldDecision({ gesture: 'card', leavingCard: 'follow', kind, disabled: false });
      expect(d.yield).toBe(false);
    }
  });

  it('NEVER yields when the card being left is not the running family\'s own card', () => {
    for (const leavingCard of ['two', 'turns'] as const) {
      const d = yieldDecision({ gesture: 'card', leavingCard, kind: 'follow-note', disabled: false });
      expect(d.yield).toBe(false);
    }
  });

  it('a NON-yielding decision carries NO `post` key at all — never `post: undefined`', () => {
    const d = yieldDecision({ gesture: 'card', leavingCard: 'two', kind: 'none', disabled: false });
    expect('post' in d).toBe(false);
    expect(d.say).toBe('');
  });

  it('L4/L5/L6 have no gesture value at all — disappearance never yields, by construction', () => {
    // YieldGesture is exhaustively 'card' | 'hide' | 'tab': there is no value
    // representing background/kill/reconnect, so those paths cannot reach
    // this function's yield branch — the guarantee is structural, not a
    // runtime check.
    expect(GESTURES).toHaveLength(3);
  });

  it('YIELD_FAIL_SAY is the pinned failure narration for a rejected/unreachable stop', () => {
    expect(YIELD_FAIL_SAY).toBe("Couldn't stop FOLLOW NOTE — it is still driving.");
  });
});

// ── docs/61 §4.1 — drivingStripModel ────────────────────────────────────────

describe('drivingStripModel — the driving strip, 100% broadcast-derived (docs/61 §4.1)', () => {
  const CARDS: ColorsCard[] = ['two', 'turns', 'follow'];

  it('shows on NOTHING while kind is none, on every card', () => {
    for (const card of CARDS) {
      expect(drivingStripModel('none', card, {})).toEqual({ show: false, title: '', detail: '' });
    }
  });

  it('follow-note: hidden on its OWN card (follow), shown on the other two', () => {
    const broadcast: DrivingBroadcast = { notePc: 7, currentScheme: 'triadic' };
    expect(drivingStripModel('follow-note', 'follow', broadcast).show).toBe(false);
    for (const card of ['two', 'turns'] as const) {
      const m = drivingStripModel('follow-note', card, broadcast);
      expect(m.show).toBe(true);
      expect(m.title).toBe('FOLLOW NOTE IS DRIVING');
      expect(m.detail).toBe('G · TRIADIC');
    }
  });

  it('follow-note detail: unknown/absent scheme and note both show the dash, never an invention', () => {
    const m = drivingStripModel('follow-note', 'two', { notePc: null, currentScheme: null });
    expect(m.detail).toBe('— · —');
  });

  it('turns: hidden on its OWN card (turns), shown on the other two', () => {
    const broadcast: DrivingBroadcast = { palettes: turnsPairs(RING), delay_s: 5, transitionMs: 800 };
    expect(drivingStripModel('turns', 'turns', broadcast).show).toBe(false);
    for (const card of ['two', 'follow'] as const) {
      const m = drivingStripModel('turns', card, broadcast);
      expect(m.show).toBe(true);
      expect(m.title).toBe('PALETTE TURNS IS DRIVING');
      expect(m.detail).toBe('5 colours · 5s/0.8s');
    }
  });

  it('turns detail: CONT hold and a missing fade both read honestly', () => {
    expect(drivingStripModel('turns', 'two', { palettes: turnsPairs(RING), delay_s: 0, transitionMs: 800 }).detail)
      .toBe('5 colours · CONT/0.8s');
    expect(drivingStripModel('turns', 'two', { palettes: turnsPairs(RING) }).detail)
      .toBe('5 colours · —/—');
  });

  it('crossfade: hidden on its OWN card (two), shown on the other two', () => {
    const broadcast: DrivingBroadcast = { palettes: crossfadeAutopilotPatch(0.25, 0.75, 0, 1.5).palettes, delay_s: 0, transitionMs: 1500 };
    expect(drivingStripModel('crossfade', 'two', broadcast).show).toBe(false);
    for (const card of ['turns', 'follow'] as const) {
      const m = drivingStripModel('crossfade', card, broadcast);
      expect(m.show).toBe(true);
      expect(m.title).toBe('CROSSFADE IS DRIVING');
      expect(m.detail).toBe('90° ↔ 270° · CONT/1.5s');
    }
  });

  it('crossfade detail: an unreadable ring shows the timing half only, never a guessed angle pair', () => {
    const m = drivingStripModel('crossfade', 'turns', { delay_s: 2, transitionMs: 400 });
    expect(m.detail).toBe('2s/0.4s');
  });

  it('palette-set: has NO own card, so it shows on EVERY card', () => {
    const broadcast: DrivingBroadcast = { palettes: ['aurora', 'bass_drop'] };
    for (const card of CARDS) {
      const m = drivingStripModel('palette-set', card, broadcast);
      expect(m.show).toBe(true);
      expect(m.title).toBe('AUTOPILOT PALETTE SET IS DRIVING');
      expect(m.detail).toBe('2 palettes · controls in the AUTOPILOT window');
    }
  });

  it('an unknown kind THROWS', () => {
    // @ts-expect-error — deliberately off-contract
    expect(() => drivingStripModel('bogus', 'two', {})).toThrow(/unknown rotation kind/);
  });
});

// ── docs/61 §4.4 — colorChipLabel ───────────────────────────────────────────

describe('colorChipLabel — the app-wide header chip label (docs/61 §4.4)', () => {
  it('labels every running family', () => {
    expect(colorChipLabel('follow-note', 7)).toBe('COLORS · FOLLOW G');
    expect(colorChipLabel('turns', null)).toBe('COLORS · TURNS');
    expect(colorChipLabel('crossfade', null)).toBe('COLORS · XFADE');
    expect(colorChipLabel('palette-set', null)).toBe('COLORS · SET');
  });

  it('none renders NOTHING — null, not an empty string', () => {
    expect(colorChipLabel('none', null)).toBeNull();
  });

  it('an out-of-range notePc — the dash, never an invented note', () => {
    expect(colorChipLabel('follow-note', 99)).toBe('COLORS · FOLLOW —');
    expect(colorChipLabel('follow-note', null)).toBe('COLORS · FOLLOW —');
    expect(colorChipLabel('follow-note', undefined)).toBe('COLORS · FOLLOW —');
  });

  it('an unknown kind THROWS', () => {
    // @ts-expect-error — deliberately off-contract
    expect(() => colorChipLabel('bogus', null)).toThrow(/unknown rotation kind/);
  });
});

// ── docs/61 §5 row 1 — takeoverNote ──────────────────────────────────────────

describe('takeoverNote — the §5 row-1 takeover message names the LOSER', () => {
  it('is empty when there was no previous family', () => {
    expect(takeoverNote('none', 'turns')).toBe('');
  });

  it('is empty when the family did not change', () => {
    expect(takeoverNote('turns', 'turns')).toBe('');
    expect(takeoverNote('follow-note', 'follow-note')).toBe('');
  });

  it('names the loser when a takeover happens (snapshot-pinned)', () => {
    expect(takeoverNote('follow-note', 'turns')).toBe('PALETTE TURNS replaced FOLLOW NOTE.');
    expect(takeoverNote('turns', 'crossfade')).toBe('THE CROSSFADE replaced PALETTE TURNS.');
    expect(takeoverNote('crossfade', 'follow-note')).toBe('FOLLOW NOTE replaced THE CROSSFADE.');
    expect(takeoverNote('follow-note', 'palette-set')).toBe('AN AUTOPILOT PALETTE SET replaced FOLLOW NOTE.');
  });
});

describe('recognising a live TURNS config (visible truth, not a guess)', () => {
  const ring = RING;

  it('accepts the ring this window builds', () => {
    expect(isTurnsConfig(turnsPairs(ring))).toBe(true);
    expect(isTurnsConfig(turnsPairs(generateScheme('hue', 0.72)))).toBe(true);
  });

  it('the chain test compares FULL COLOURS, not just hues', () => {
    // A HUE ring is five entries at ONE hue: a hue-only chain test would call
    // any permutation of them a valid ring and show a rotation that is not
    // running. These pairs share every hue but do NOT chain by brightness.
    const notARing = [
      { c1: { h: 0.72, s: 0.95, v: 1 }, c2: { h: 0.72, s: 0.95, v: 0.78 } },
      { c1: { h: 0.72, s: 0.95, v: 0.25 }, c2: { h: 0.72, s: 0.95, v: 1 } },
    ];
    expect(isTurnsConfig(notARing)).toBe(false);
  });

  it('refuses library ids, a mixed set, and pairs that do not chain', () => {
    expect(isTurnsConfig(['aurora', 'bass_drop'])).toBe(false);
    expect(isTurnsConfig(['aurora', { c1: 0.1, c2: 0.2 }])).toBe(false);
    expect(isTurnsConfig([{ c1: 0.1, c2: 0.2 }, { c1: 0.9, c2: 0.1 }])).toBe(false);
    expect(isTurnsConfig([])).toBe(false);
    expect(isTurnsConfig(undefined)).toBe(false);
    // A single pair is a palette, not a rotation.
    expect(isTurnsConfig([{ c1: 0.1, c2: 0.1 }])).toBe(false);
  });

  it('turnsColors returns nothing for a set that is not a ring', () => {
    expect(turnsColors(['aurora'])).toEqual([]);
    expect(turnsColors([{ c1: 0.1, c2: 0.2 }, { c1: 0.9, c2: 0.1 }])).toEqual([]);
  });

  it('isInlinePair separates the two entry forms, in BOTH channel shapes', () => {
    expect(isInlinePair({ c1: 0, c2: 1 })).toBe(true);
    expect(isInlinePair({ c1: { h: 0, s: 1, v: 0.4 }, c2: 0.5 })).toBe(true);
    expect(isInlinePair('aurora')).toBe(false);
    expect(isInlinePair([0, 1])).toBe(false);
    expect(isInlinePair(null)).toBe(false);
    expect(isInlinePair({ c1: 0 })).toBe(false);
    expect(isInlinePair({ c1: { h: 0, s: 1 }, c2: 0.5 })).toBe(false);
  });

  it('litPairIndex reports which pair is on the rig, and -1 mid-fade', () => {
    const pairs = turnsPairs(ring);
    expect(litPairIndex(pairs, colour(0.62, 1, 1), colour(0.28, 1, 1))).toBe(2);
    // Between two pairs — the UI shows "fading", not a wrong highlight.
    expect(litPairIndex(pairs, colour(0.45, 1, 1), colour(0.45, 1, 1))).toBe(-1);
    expect(litPairIndex(['aurora'], colour(0.1, 1, 1), colour(0.2, 1, 1))).toBe(-1);
    expect(litPairIndex(undefined, colour(0.1, 1, 1), colour(0.2, 1, 1))).toBe(-1);
  });

  it('litPairIndex tells a HUE ring\'s turns apart by BRIGHTNESS, not just hue', () => {
    // All five pairs share hue 0.72; only v distinguishes them. A hue-only
    // comparison would answer 0 for every turn.
    const pairs = turnsPairs(generateScheme('hue', 0.72));
    const at = (v1: number, v2: number) =>
      litPairIndex(pairs, colour(0.72, 0.95, v1), colour(0.72, 0.95, v2));
    expect(at(1.0, 0.78)).toBe(0);
    expect(at(0.58, 0.40)).toBe(2);
    expect(at(0.25, 1.0)).toBe(4);
    expect(at(0.5, 0.5)).toBe(-1);
  });
});

// ── The atomic engine write ─────────────────────────────────────────────────

describe('slot writes are ATOMIC (both slots, S/V pinned, one POST)', () => {
  it('carries BOTH slots in one payload so the rig never shows a half pair', () => {
    expect(paletteWritePayload(0.25, 0.75)).toEqual({
      colorPalette1: { h: 0.25, s: 1, v: 1 },
      colorPalette2: { h: 0.75, s: 1, v: 1 },
    });
  });

  it('the payload has exactly the two palette keys — it never smuggles anything else', () => {
    expect(Object.keys(paletteWritePayload(0, 0)).sort()).toEqual(['colorPalette1', 'colorPalette2']);
  });
});

/**
 * THROTTLE CONTRACT. The component's live writer is a leading + trailing
 * throttle (the recipe ColorPickerModal proved): the FIRST frame goes out
 * immediately, the middle of a drag is rate-limited, and the LAST position
 * always lands. This models that policy over a synthetic 60 fps drag so the
 * rule is checked rather than eyeballed.
 */
function throttleTrace(frameMs: number, frames: number, throttleMs: number): number[] {
  const sent: number[] = [];
  let last = -Infinity;
  let pendingAt: number | null = null;
  for (let i = 0; i < frames; i++) {
    const t = i * frameMs;
    if (t - last >= throttleMs) { last = t; sent.push(t); pendingAt = null; }
    else pendingAt = t;
  }
  if (pendingAt !== null) sent.push(last + throttleMs); // the trailing write
  return sent;
}

describe('live-write throttle policy', () => {
  it('emits the first frame immediately and rate-limits the rest to ~30 Hz', () => {
    const sent = throttleTrace(1000 / 60, 60, 33);
    expect(sent[0]).toBe(0);
    for (let i = 1; i < sent.length; i++) {
      expect(sent[i] - sent[i - 1]).toBeGreaterThanOrEqual(33 - 1e-9);
    }
    // A one-second 60 fps drag becomes ~30 writes, not 60.
    expect(sent.length).toBeLessThanOrEqual(31);
    expect(sent.length).toBeGreaterThanOrEqual(29);
  });

  it('always lands a trailing write, so the final drag position is never lost', () => {
    // Two frames 5 ms apart: the second is throttled, so a trailing write must
    // be scheduled — otherwise the operator's release position never reaches
    // the rig.
    const sent = throttleTrace(5, 2, 33);
    expect(sent.length).toBe(2);
    expect(sent[0]).toBe(0);
    expect(sent[1]).toBe(33);
  });
});

// ── The saved-pair gallery (scene-side store; this is the test seam) ────────

/**
 * A fake of the engine's scene-owned `/color-pairs` store. The real store is
 * `states/<scene>/color_pairs_state.yaml` behind GET/POST /color-pairs — these
 * tests exercise the round trip through the SAME normalizer + mutators the
 * component uses, and NEVER touch a real scene (no engine is spawned here; the
 * engine side has its own suite, tests/effects/color_window_engine_api.test.js).
 */
function makeFakeStore(initial: unknown = { pairs: [] }) {
  let raw: unknown = initial;
  let failNext = false;
  return {
    failOnce() { failNext = true; },
    async fetch(): Promise<{ ok: boolean; data?: PalettePreset[]; error?: string }> {
      if (failNext) { failNext = false; return { ok: false, error: 'engine unreachable' }; }
      return { ok: true, data: normalizeColorPairs(raw) };
    },
    async save(pairs: PalettePreset[]): Promise<{ ok: boolean; data?: PalettePreset[]; error?: string }> {
      if (failNext) { failNext = false; return { ok: false, error: 'engine refused' }; }
      if (pairs.length > COLOR_PAIRS_MAX) return { ok: false, error: 'too many pairs' };
      raw = { pairs: pairs.map((p) => ({ ...p })) };
      return { ok: true, data: normalizeColorPairs(raw) };
    },
  };
}

describe('saved pairs — scene-side round trip', () => {
  it('save then load returns the same pairs (colours only — the operator default)', async () => {
    const store = makeFakeStore();
    const add = addPalettePreset([], { c1: 0.7311, c2: 0.5332 });
    expect(add.ok).toBe(true);
    if (!add.ok) return;
    await store.save(add.presets);
    const back = await store.fetch();
    expect(back.ok).toBe(true);
    expect(back.data).toEqual([{ c1: 0.7311, c2: 0.5332 }]);
    // A pair carries NOTHING but its two colours: no fade time, no blend
    // position, no per-device tag.
    expect(Object.keys(back.data![0]).sort()).toEqual(['c1', 'c2']);
  });

  it('a failed save leaves the stored list exactly as it was', async () => {
    const store = makeFakeStore({ pairs: [{ c1: 0.1, c2: 0.2 }] });
    store.failOnce();
    const res = await store.save([{ c1: 0.1, c2: 0.2 }, { c1: 0.3, c2: 0.4 }]);
    expect(res.ok).toBe(false);
    expect((await store.fetch()).data).toEqual([{ c1: 0.1, c2: 0.2 }]);
  });

  it('a failed LOAD reports the error instead of showing an empty gallery as truth', async () => {
    const store = makeFakeStore({ pairs: [{ c1: 0.1, c2: 0.2 }] });
    store.failOnce();
    const res = await store.fetch();
    expect(res.ok).toBe(false);
    expect(res.error).toBeTruthy();
    expect(res.data).toBeUndefined();
  });

  it('delete removes exactly one entry and round-trips', async () => {
    const store = makeFakeStore({ pairs: [{ c1: 0.1, c2: 0.2 }, { c1: 0.3, c2: 0.4 }, { c1: 0.5, c2: 0.6 }] });
    const loaded = (await store.fetch()).data!;
    await store.save(removeColorPairAt(loaded, 1));
    expect((await store.fetch()).data).toEqual([{ c1: 0.1, c2: 0.2 }, { c1: 0.5, c2: 0.6 }]);
  });
});

describe('gallery mutators refuse visibly, never silently', () => {
  it('refuses a duplicate with a message', () => {
    const res = addPalettePreset([{ c1: 0.1, c2: 0.2 }], { c1: 0.1, c2: 0.2 });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toMatch(/already saved/);
  });

  it('a REVERSED pair is a different pair (A/B order is the look)', () => {
    const res = addPalettePreset([{ c1: 0.1, c2: 0.2 }], { c1: 0.2, c2: 0.1 });
    expect(res.ok).toBe(true);
  });

  it('refuses at the cap instead of evicting somebody else’s save', () => {
    const full = Array.from({ length: COLOR_PAIRS_MAX }, (_, i) => ({ c1: i / 100, c2: (i + 1) / 100 }));
    const res = addPalettePreset(full, { c1: 0.9, c2: 0.95 });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toMatch(/Full at 24 palettes/);
  });

  it('an out-of-range delete is a no-op copy, never a throw or a wrong removal', () => {
    const list = [{ c1: 0.1, c2: 0.2 }];
    expect(removeColorPairAt(list, 5)).toEqual(list);
    expect(removeColorPairAt(list, -1)).toEqual(list);
    expect(removeColorPairAt(list, 0)).toEqual([]);
  });

  it('samePair is an ε compare', () => {
    expect(samePair({ c1: 0.1, c2: 0.2 }, { c1: 0.1 + COLOUR_EPS / 2, c2: 0.2 })).toBe(true);
    expect(samePair({ c1: 0.1, c2: 0.2 }, { c1: 0.2, c2: 0.2 })).toBe(false);
  });
});

describe('normalizeColorPairs is TOTAL over junk', () => {
  const junk: unknown[] = [
    null, undefined, 0, 'nope', {}, { pairs: null }, { pairs: 'x' },
    [{ c1: 'a', c2: 0.1 }], [{ c1: 0.1 }], [null], [[0.1, 0.2]],
    [{ c1: 2, c2: 0.1 }], [{ c1: -1, c2: 0.1 }], [{ c1: NaN, c2: 0.1 }],
    [{ c1: Infinity, c2: 0.1 }],
  ];

  it('never throws and never invents a pair', () => {
    for (const input of junk) {
      expect(() => normalizeColorPairs(input)).not.toThrow();
      expect(normalizeColorPairs(input)).toEqual([]);
    }
  });

  it('accepts both the wire envelope and a bare array, and keeps order', () => {
    const pairs = [{ c1: 0.1, c2: 0.2 }, { c1: 0.3, c2: 0.4 }];
    expect(normalizeColorPairs({ pairs })).toEqual(pairs);
    expect(normalizeColorPairs(pairs)).toEqual(pairs);
  });

  it('drops the bad entries out of a mixed list rather than the whole list', () => {
    expect(normalizeColorPairs([{ c1: 0.1, c2: 0.2 }, { c1: 5, c2: 0 }, { c1: 0.3, c2: 0.4 }]))
      .toEqual([{ c1: 0.1, c2: 0.2 }, { c1: 0.3, c2: 0.4 }]);
  });

  it('caps a hand-edited over-long list at the gallery maximum', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ c1: i / 100, c2: 0.5 }));
    expect(normalizeColorPairs(many)).toHaveLength(COLOR_PAIRS_MAX);
  });

  it('returns fresh objects — the caller cannot mutate the store through them', () => {
    const src = [{ c1: 0.1, c2: 0.2 }];
    const out = normalizeColorPairs(src);
    out[0].c1 = 0.9;
    expect(src[0].c1).toBe(0.1);
  });
});

// ── _242 orders 2 + 4: PRESET PALETTES ─────────────────────────────────────
//
// The v1 store held bare {c1,c2} pairs. v2 keeps that field REQUIRED and
// unchanged — which is the whole migration — and adds an optional name, ring,
// A/B selection and latch. Every rule about how those group is checked here,
// because a half-restored palette puts colours on the rig nobody chose.

const DEMO_RING: Hsv[] = [
  colour(0.10, 0.95, 1), colour(0.30, 0.95, 1), colour(0.50, 0.95, 0.55),
  colour(0.70, 0.95, 1), colour(0.90, 0.95, 0.25),
];

describe('preset palettes — the v1 → v2 migration', () => {
  it('a v1 file loads UNCHANGED: a bare pair is already a valid preset', () => {
    const v1 = [{ c1: 0.1, c2: 0.2 }, { c1: 0.3, c2: 0.4 }];
    expect(normalizeColorPairs({ pairs: v1 })).toEqual(v1);
    // No invented name, no invented ring — absence stays absence.
    expect(Object.keys(normalizeColorPairs({ pairs: v1 })[0]).sort()).toEqual(['c1', 'c2']);
  });

  it('reads the v2 envelope and carries the whole block through', () => {
    const entry = {
      c1: 0.1, c2: 0.3, name: 'Sunset',
      ring: DEMO_RING, sel: [0, 1], scheme: 'analogous', base: 0.1,
    };
    const [out] = normalizeColorPairs({ schemaVersion: COLOR_PRESETS_SCHEMA_VERSION, pairs: [entry] });
    expect(out).toEqual(entry);
  });

  it('REFUSES a file from a newer build rather than showing a palette it cannot read', () => {
    expect(() => normalizeColorPairs({ schemaVersion: COLOR_PRESETS_SCHEMA_VERSION + 1, pairs: [] }))
      .toThrow(/understands up to/);
    expect(() => normalizeColorPairs({ schemaVersion: 'two', pairs: [] }))
      .toThrow(/positive integer/);
  });

  it('an EMPTY name is stored as no name at all — one encoding of "unnamed"', () => {
    expect(normalizeColorPairs({ pairs: [{ c1: 0.1, c2: 0.2, name: '   ' }] }))
      .toEqual([{ c1: 0.1, c2: 0.2 }]);
    expect(buildPalettePreset({ c1: 0.1, c2: 0.2, name: '  ' })).toEqual({ c1: 0.1, c2: 0.2 });
  });

  it('a name longer than the field is cut to the field, not silently kept whole', () => {
    const long = 'x'.repeat(PRESET_NAME_MAX + 10);
    expect(buildPalettePreset({ c1: 0, c2: 0.5, name: long }).name).toHaveLength(PRESET_NAME_MAX);
  });
});

describe('preset palettes — the v2 block is validated LOUDLY', () => {
  const bad: [string, unknown, RegExp][] = [
    ['a ring with no selection', { c1: 0, c2: 0.5, ring: DEMO_RING }, /present together/],
    ['a selection with no ring', { c1: 0, c2: 0.5, sel: [0, 1] }, /present together/],
    ['a non-colour in the ring', { c1: 0, c2: 0.5, ring: [{ h: 0.1 }, colour(0.2, 1, 1)], sel: [0, 1] }, /must be \{h,s,v\}/],
    ['an out-of-range selection', { c1: 0, c2: 0.5, ring: DEMO_RING, sel: [0, 9] }, /index into a ring/],
    ['both channels on one slot', { c1: 0, c2: 0.5, ring: DEMO_RING, sel: [2, 2] }, /BOTH channels/],
    ['a scheme with no base', { c1: 0, c2: 0.5, ring: DEMO_RING, sel: [0, 1], scheme: 'golden' }, /present together/],
    ['a scheme with no ring', { c1: 0, c2: 0.5, scheme: 'golden', base: 0.2 }, /requires a 'ring'/],
    ['an unknown scheme', { c1: 0, c2: 0.5, ring: DEMO_RING, sel: [0, 1], scheme: 'kaleidoscope', base: 0.2 }, /scheme must be one of/],
    ['a non-string name', { c1: 0, c2: 0.5, name: 7 }, /name must be a string/],
  ];

  for (const [what, entry, message] of bad) {
    it(`throws on ${what}`, () => {
      expect(() => normalizeColorPairs({ pairs: [entry] })).toThrow(message);
    });
  }

  it('still SKIPS an entry whose pair is unusable, exactly as v1 did', () => {
    // The pair is the one field the rig actually consumes, and the engine
    // already warns about these on read — a half-written hue must never paint.
    expect(normalizeColorPairs({ pairs: [{ c1: 5, c2: 0.2, name: 'nope' }, { c1: 0.1, c2: 0.2 }] }))
      .toEqual([{ c1: 0.1, c2: 0.2 }]);
  });
});

describe('preset palettes — what a save captures', () => {
  it('a two-colour save is exactly the pair', () => {
    expect(buildPalettePreset({ c1: 0.25, c2: 0.75, name: '' })).toEqual({ c1: 0.25, c2: 0.75 });
  });

  it('a latched save carries the ring, the selection AND the latch', () => {
    const p = buildPalettePreset({
      c1: 0.1, c2: 0.3, name: 'Reef',
      ring: DEMO_RING, sel: [0, 1], latch: { scheme: 'analogous', base: 0.1 },
    });
    expect(p).toEqual({
      c1: 0.1, c2: 0.3, name: 'Reef',
      ring: DEMO_RING, sel: [0, 1], scheme: 'analogous', base: 0.1,
    });
    // …and it survives the round trip through the normalizer unchanged.
    expect(normalizeColorPairs({ pairs: [p] })).toEqual([p]);
  });

  it('an unlatched TURNS save keeps the ring and drops the latch fields', () => {
    const p = buildPalettePreset({ c1: 0.1, c2: 0.3, name: '', ring: DEMO_RING, sel: [2, 4], latch: null });
    expect(p.ring).toEqual(DEMO_RING);
    expect(p.sel).toEqual([2, 4]);
    expect(p.scheme).toBeUndefined();
    expect(p.base).toBeUndefined();
  });

  it('REFUSES to store a ring with no selection — it could not say which two are live', () => {
    expect(() => buildPalettePreset({ c1: 0, c2: 0.5, name: '', ring: DEMO_RING }))
      .toThrow(/needs its A\/B selection/);
  });

  it('copies the ring, so a later draft edit cannot rewrite a saved palette', () => {
    const src = DEMO_RING.map((c) => colour(c.h, c.s, c.v));
    const p = buildPalettePreset({ c1: 0, c2: 0.5, name: '', ring: src, sel: [0, 1] });
    src[0].h = 0.99;
    expect(p.ring![0].h).toBeCloseTo(0.10, 12);
  });
});

describe('preset palettes — identity, icon and label', () => {
  it('samePreset compares the colours, NOT the name', () => {
    const a: PalettePreset = { c1: 0.1, c2: 0.2, name: 'One' };
    const b: PalettePreset = { c1: 0.1, c2: 0.2, name: 'Two' };
    expect(samePreset(a, b)).toBe(true);
    // A ring makes it a different saved thing even on the same pair.
    expect(samePreset(a, { ...a, ring: DEMO_RING, sel: [0, 1] })).toBe(false);
  });

  it('the duplicate refusal fires on colours and survives a rename', () => {
    const res = addPalettePreset([{ c1: 0.1, c2: 0.2 }], { c1: 0.1, c2: 0.2, name: 'Renamed' });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toMatch(/already saved/);
  });

  it('the icon is a wedge per colour, generated from the entry alone', () => {
    // A pair draws its two hues at the pin…
    expect(presetIconColours({ c1: 0, c2: 0.5 })).toEqual([hueCss(0), hueCss(0.5)]);
    // …a palette draws its five TRUE colours, brightness included, so a HUE
    // ramp reads as a ramp on the chip.
    const icon = presetIconColours({ c1: 0.1, c2: 0.3, ring: DEMO_RING, sel: [0, 1] });
    expect(icon).toHaveLength(DEMO_RING.length);
    expect(icon[4]).not.toBe(hueCss(0.90)); // v = 0.25, not full brightness
  });

  it('the icon is deterministic — same entry, same picture, every time', () => {
    const p: PalettePreset = { c1: 0.1, c2: 0.3, ring: DEMO_RING, sel: [0, 1] };
    expect(presetIconColours(p)).toEqual(presetIconColours({ ...p }));
  });

  it('an UNNAMED preset shows its angles rather than an invented label', () => {
    expect(presetLabel({ c1: 0.7311, c2: 0.5332 })).toBe('263° / 192°');
    expect(presetLabel({ c1: 0.7311, c2: 0.5332, name: 'Dusk' })).toBe('Dusk');
    expect(presetDescription({ c1: 0, c2: 0.5, ring: DEMO_RING, sel: [0, 1] }))
      .toMatch(/5-colour palette/);
  });
});

// ── Formatting ──────────────────────────────────────────────────────────────

describe('formatting', () => {
  it('degrees wraps the hue circle instead of printing a negative angle', () => {
    expect(degrees(0)).toBe(0);
    expect(degrees(0.5)).toBe(180);
    expect(degrees(-0.25)).toBe(270);
    expect(degrees(1.25)).toBe(90);
  });

  it('pairLabel reads as the two angles', () => {
    expect(pairLabel({ c1: 0.7311, c2: 0.5332 })).toBe('263° / 192°');
  });
});

// ── _224 order 2: the sliding window, read off the rig ──────────────────────

/** The engine's own tween, reproduced so the tests fade the way the rig does:
 *  `h` along the short arc (lerpHue), `s` and `v` linear — i.e. exactly
 *  `lerpParams` in marsin_engine/lib/color_autopilot.js for a colour leaf. */
function engineFrame(from: ColorPair, to: ColorPair, t: number): [Hsv, Hsv] {
  const step = (a: Hsv, b: Hsv): Hsv => colour(
    lerpHue(a.h, b.h, t), a.s + (b.s - a.s) * t, a.v + (b.v - a.v) * t);
  return [
    step(asHsv(from.c1), asHsv(to.c1)),
    step(asHsv(from.c2), asHsv(to.c2)),
  ];
}

describe('rotationCursor — the window the ENGINE is on, inverted from the rig', () => {
  const pairs = turnsPairs(RING);

  it('reports the settled pair during the HOLD, at t = 1', () => {
    for (let i = 0; i < pairs.length; i++) {
      expect(rotationCursor(pairs, asHsv(pairs[i].c1), asHsv(pairs[i].c2)))
        .toEqual({ index: i, t: 1 });
    }
  });

  it('reports the pair it is ARRIVING AT, and how far through, mid-fade', () => {
    for (let i = 0; i < pairs.length; i++) {
      const from = pairs[(i - 1 + pairs.length) % pairs.length];
      for (const t of [0.15, 0.37, 0.5, 0.8, 0.99]) {
        const [c1, c2] = engineFrame(from, pairs[i], t);
        const cur = rotationCursor(pairs, c1, c2);
        expect(cur).not.toBeNull();
        expect(cur!.index).toBe(i);
        expect(cur!.t).toBeCloseTo(t, 6);
      }
    }
  });

  it('THE WINDOW SLIDES ONE SLOT PER CYCLE, and wraps', () => {
    // Pair i is the window over slots i and i+1 — the operator's
    // [c1],[c2],c3,c4,c5 -> c1,[c2],[c3],c4,c5 -> ... with the T5->T1 wrap.
    const seen = pairs.map((_, i) => {
      const cur = rotationCursor(pairs, asHsv(pairs[i].c1), asHsv(pairs[i].c2))!;
      return [cur.index, (cur.index + 1) % RING.length];
    });
    expect(seen).toEqual([[0, 1], [1, 2], [2, 3], [3, 4], [4, 0]]);
  });

  it('works for a HUE ring, whose five pairs share ONE hue', () => {
    const hueRing = turnsPairs(generateScheme('hue', 0.72));
    for (let i = 0; i < hueRing.length; i++) {
      expect(rotationCursor(hueRing, asHsv(hueRing[i].c1), asHsv(hueRing[i].c2)))
        .toEqual({ index: i, t: 1 });
      const from = hueRing[(i - 1 + hueRing.length) % hueRing.length];
      const [c1, c2] = engineFrame(from, hueRing[i], 0.4);
      const cur = rotationCursor(hueRing, c1, c2);
      expect(cur!.index).toBe(i);
      expect(cur!.t).toBeCloseTo(0.4, 6);
    }
  });

  it('follows the SHORT arc across the wrap, like the engine tween does', () => {
    const wrapRing = turnsPairs([0.95, 0.05, 0.2, 0.4, 0.6].map((h) => colour(h, 1, 1)));
    const [c1, c2] = engineFrame(wrapRing[0], wrapRing[1], 0.5);
    const cur = rotationCursor(wrapRing, c1, c2);
    expect(cur!.index).toBe(1);
    expect(cur!.t).toBeCloseTo(0.5, 6);
  });

  it('is a 2-entry crossfade\'s window too — one mechanism, two lengths', () => {
    const cf = crossfadeAutopilotPatch(0.2, 0.7, 0, 1.5).palettes;
    expect(rotationCursor(cf, colour(0.2, 1, 1), colour(0.7, 1, 1))).toEqual({ index: 0, t: 1 });
    const [c1, c2] = engineFrame(cf[0], cf[1], 0.25);
    expect(rotationCursor(cf, c1, c2)!.index).toBe(1);
  });

  it('returns null when the rig is NOT on the ring — never a confident guess', () => {
    expect(rotationCursor(pairs, colour(0.5, 1, 1), colour(0.5, 1, 1))).toBeNull();
    expect(rotationCursor(pairs, colour(0.33, 0.2, 0.4), colour(0.91, 1, 1))).toBeNull();
    expect(rotationCursor(['aurora', 'bass_drop'], colour(0.1, 1, 1), colour(0.2, 1, 1))).toBeNull();
    expect(rotationCursor(undefined, colour(0.1, 1, 1), colour(0.2, 1, 1))).toBeNull();
    expect(rotationCursor([{ c1: 0.1, c2: 0.2 }], colour(0.1, 1, 1), colour(0.2, 1, 1))).toBeNull();
  });

  it('a MASTER ring (five identical colours) has no direction, so no fade fit', () => {
    // Every pair is the same colour twice: the HOLD still resolves (the rig IS
    // on pair 0), but there is no segment to measure progress along and
    // inventing one would be a fallback.
    const flat = turnsPairs(generateScheme('master', 0.4));
    expect(rotationCursor(flat, asHsv(flat[0].c1), asHsv(flat[0].c2))).toEqual({ index: 0, t: 1 });
    expect(rotationCursor(flat, colour(0.9, 0.95, 1), colour(0.9, 0.95, 1))).toBeNull();
  });

  it('the fit tolerance is tight enough to reject a foreign palette', () => {
    expect(CURSOR_FIT_EPS).toBeLessThan(0.01);
    const [c1, c2] = engineFrame(pairs[0], pairs[1], 0.5);
    // Nudge ONE channel well past the tolerance — that is no longer this fade.
    expect(rotationCursor(pairs, colour(c1.h + 0.05, c1.s, c1.v), c2)).toBeNull();
  });

  it('cursorRailOffset puts the highlight where the window actually is', () => {
    // Settled on pair 2 -> the window's left edge is slot 2.
    expect(cursorRailOffset({ index: 2, t: 1 }, 5)).toBeCloseTo(2, 9);
    // Half-way to pair 2 -> half-way between slots 1 and 2.
    expect(cursorRailOffset({ index: 2, t: 0.5 }, 5)).toBeCloseTo(1.5, 9);
    // Arriving at pair 0 slides through the seam rather than snapping back.
    expect(cursorRailOffset({ index: 0, t: 0 }, 5)).toBeCloseTo(4, 9);
    expect(cursorRailOffset({ index: 0, t: 0.5 }, 5)).toBeCloseTo(4.5, 9);
    expect(cursorRailOffset({ index: 0, t: 1 }, 5)).toBeCloseTo(0, 9);
  });
});

// ── THE ORBIT: the operator's pair keeps its distance and rotates right ─────
//
// OPERATOR ORDER: *"for the PALETTE TURNS we have 2 selected colors — keep
// their distance, and rotate them in a window to the right, and then loop back
// when going over the end."*

/** Every legal A/B pick on a five-slot ring, as [sel, expected distance]. */
const ALL_SELS: [readonly [number, number], number][] = (() => {
  const out: [readonly [number, number], number][] = [];
  for (let a = 0; a < 5; a++) {
    for (let b = 0; b < 5; b++) {
      if (a !== b) out.push([[a, b] as const, (((b - a) % 5) + 5) % 5]);
    }
  }
  return out;
})();

describe('the ORBIT — a distance-d window travelling right around the ring', () => {
  it('BACK-COMPAT: the default pick rebuilds the adjacent ring EXACTLY', () => {
    // The proof obligation. d = 1 at (T1,T2) must reduce to what TURNS has
    // always posted — not "equivalent", the same object.
    expect(orbitPairs(RING, [0, 1])).toEqual(turnsPairs(RING));
    for (const id of SCHEME_IDS) {
      const ring = generateScheme(id, 0.33);
      expect(orbitPairs(ring, SCHEME_PAIR_DEFAULT)).toEqual(turnsPairs(ring));
    }
  });

  it('BACK-COMPAT: the default pick posts a BYTE-IDENTICAL wire', () => {
    // Through the real transport, including the JSON that reaches the daemon:
    // an unselected patch and a (T1,T2)-selected one are the same bytes.
    for (const id of SCHEME_IDS) {
      const ring = generateScheme(id, 0.61);
      const before = turnsAutopilotPatch(ring, 5, 1.5);
      const after = turnsAutopilotPatch(ring, 5, 1.5, SCHEME_PAIR_DEFAULT);
      expect(JSON.stringify(after)).toBe(JSON.stringify(before));
    }
    // …and the crossfade, which posts no selection at all, is untouched.
    expect(JSON.stringify(crossfadeAutopilotPatch(0.2, 0.7, 2, 0.8)))
      .toBe(JSON.stringify(rotationAutopilotPatch([colour(0.2, 1, 1), colour(0.7, 1, 1)], 2, 0.8)));
  });

  it('orbitDistance counts RIGHTWARD, wrapping past the end', () => {
    for (const [sel, d] of ALL_SELS) expect(orbitDistance(sel, 5)).toBe(d);
    // The wrap is the whole point: T5→T2 is 2 slots right, not 3 slots left.
    expect(orbitDistance([4, 1], 5)).toBe(2);
    expect(orbitDistance([3, 0], 5)).toBe(2);
  });

  it('orbitDistance REFUSES a zero distance and an out-of-ring slot', () => {
    expect(() => orbitDistance([2, 2], 5)).toThrow(/same slot/);
    expect(() => orbitDistance([0, 5], 5)).toThrow(/outside a ring/);
    expect(() => orbitDistance([-1, 2], 5)).toThrow(/outside a ring/);
    expect(() => orbitDistance([0, 1.5], 5)).toThrow(/outside a ring/);
  });

  it('EVERY pick keeps its distance for the whole lap, and loops back', () => {
    for (const [sel, d] of ALL_SELS) {
      const pairs = orbitPairs(RING, sel);
      expect(pairs).toHaveLength(5);
      pairs.forEach((p, i) => {
        // Turn i is (selA+i, selA+i+d) — both ends stepped i slots right.
        expect(hueOf(p.c1)).toBe(RING_HUES[(sel[0] + i) % 5]);
        expect(hueOf(p.c2)).toBe(RING_HUES[(sel[0] + i + d) % 5]);
      });
      // The lap closes: turn 5 sits one slot left of where turn 1 started.
      expect(hueOf(pairs[4].c1)).toBe(RING_HUES[(sel[0] + 4) % 5]);
      // Every colour still reaches the rig, exactly twice (once per channel).
      for (const h of RING_HUES) {
        const seen = pairs.filter((p) => hueOf(p.c1) === h).length
          + pairs.filter((p) => hueOf(p.c2) === h).length;
        expect(seen).toBe(2);
      }
    }
  });

  it('IT STARTS ON THE OPERATOR\'S PAIR — turn 1 is exactly A and B', () => {
    for (const [sel] of ALL_SELS) {
      const [a, b] = schemePairColours(RING, sel);
      const first = orbitPairs(RING, sel)[0];
      expect(hueOf(first.c1)).toBe(a.h);
      expect(hueOf(first.c2)).toBe(b.h);
    }
  });

  it('refuses a ring too short to orbit in', () => {
    expect(() => orbitPairs([colour(0.5, 1, 1)], [0, 1])).toThrow(/at least 2 colours/);
    expect(() => orbitPairs([], [0, 1])).toThrow(/at least 2 colours/);
  });

  it('a FULL-HSV ring orbits with its brightnesses intact', () => {
    const hueRing = generateScheme('hue', 0.72);   // v = 1, .78, .58, .40, .25
    const pairs = orbitPairs(hueRing, [1, 3]);     // d = 2, starting at T2
    // A runs T2,T3,T4,T5,T1 and B runs two slots ahead of it the whole way.
    expect(pairs.map((p) => asHsv(p.c1).v)).toEqual([0.78, 0.58, 0.40, 0.25, 1.0]);
    expect(pairs.map((p) => asHsv(p.c2).v)).toEqual([0.40, 0.25, 1.0, 0.78, 0.58]);
  });
});

describe('reading an orbit back off the wire', () => {
  it('turnsOrbit recovers the ring AND the distance, for every pick', () => {
    for (const [sel, d] of ALL_SELS) {
      const orbit = turnsOrbit(orbitPairs(RING, sel));
      expect(orbit).not.toBeNull();
      expect(orbit!.distance).toBe(d);
      // The ring comes back in WIRE order — starting at COLOUR A's slot.
      expect(orbit!.ring.map((c) => c.h))
        .toEqual([0, 1, 2, 3, 4].map((i) => RING_HUES[(sel[0] + i) % 5]));
      expect(isTurnsConfig(orbitPairs(RING, sel))).toBe(true);
    }
  });

  it('a wider orbit is STILL a turns ring, so the card keeps the window', () => {
    // The old chain test (c2 === the NEXT entry's c1) fails at d > 1; without
    // the generalisation the daemon's own ring would read as 'palette-set'.
    for (const [sel] of ALL_SELS) {
      expect(rotationKind(true, orbitPairs(RING, sel))).toBe('turns');
    }
  });

  it('the SMALLEST distance wins, so a MASTER ring still reports 1', () => {
    // Five identical colours fit every spacing; reporting 1 keeps the readout
    // byte-identical to what it has always been.
    expect(turnsOrbit(orbitPairs(generateScheme('master', 0.4), [0, 2]))!.distance).toBe(1);
    for (const id of SCHEME_IDS) {
      const adjacent = turnsOrbit(turnsPairs(generateScheme(id, 0.2)))!;
      expect(adjacent.distance).toBe(1);
    }
  });

  it('still refuses everything that is not a ring', () => {
    expect(turnsOrbit(['aurora', 'bass_drop'])).toBeNull();
    expect(turnsOrbit([{ c1: 0.1, c2: 0.2 }, { c1: 0.9, c2: 0.1 }])).toBeNull();
    expect(turnsOrbit(undefined)).toBeNull();
    expect(turnsOrbit([{ c1: 0.1, c2: 0.1 }])).toBeNull();
    // Four unrelated pairs: no single spacing describes them.
    expect(turnsOrbit([
      { c1: 0.1, c2: 0.2 }, { c1: 0.3, c2: 0.4 },
      { c1: 0.5, c2: 0.6 }, { c1: 0.7, c2: 0.8 },
    ])).toBeNull();
  });

  it('orbitPhase recovers WHERE the wire ring starts in the staged one', () => {
    for (const [sel] of ALL_SELS) {
      const wire = turnsOrbit(orbitPairs(RING, sel))!.ring;
      expect(orbitPhase(RING, wire)).toBe(sel[0]);
    }
    // Different colours entirely, or a different length → no phase.
    expect(orbitPhase(RING, generateScheme('contrast', 0.5))).toBeNull();
    expect(orbitPhase(RING, RING.slice(0, 3))).toBeNull();
    expect(orbitPhase([], [])).toBeNull();
    // A repeating ring reports the SMALLEST offset.
    expect(orbitPhase(generateScheme('master', 0.4), generateScheme('master', 0.4))).toBe(0);
  });

  it('ROUND TRIP: pick → wire → read back → the same two slots light', () => {
    for (const [sel, d] of ALL_SELS) {
      const wire = orbitPairs(RING, sel);
      const orbit = turnsOrbit(wire)!;
      const phase = orbitPhase(RING, orbit.ring)!;
      for (let i = 0; i < 5; i++) {
        // Turn i, mapped back into the operator's own T1..T5 numbering.
        expect(orbitWindowSlots(i, orbit.distance, phase, 5))
          .toEqual([(sel[0] + i) % 5, (sel[0] + i + d) % 5]);
      }
    }
  });

  it('orbitWindowSlots at phase 0 / distance 1 is the adjacent window', () => {
    expect([0, 1, 2, 3, 4].map((i) => orbitWindowSlots(i, 1, 0, 5)))
      .toEqual([[0, 1], [1, 2], [2, 3], [3, 4], [4, 0]]);
    expect(() => orbitWindowSlots(0, 1, 0, 1)).toThrow(/at least 2/);
  });
});

describe('rotationCursor inverts a NON-ADJACENT window too', () => {
  it('reports the settled window during the hold, at every distance', () => {
    for (const [sel] of ALL_SELS) {
      const pairs = orbitPairs(RING, sel);
      for (let i = 0; i < pairs.length; i++) {
        expect(rotationCursor(pairs, asHsv(pairs[i].c1), asHsv(pairs[i].c2)))
          .toEqual({ index: i, t: 1 });
      }
    }
  });

  it('projects a mid-fade rig onto the right distance-d segment', () => {
    for (const [sel] of ALL_SELS) {
      const pairs = orbitPairs(RING, sel);
      for (let i = 0; i < pairs.length; i++) {
        const from = pairs[(i - 1 + pairs.length) % pairs.length];
        for (const t of [0.15, 0.5, 0.99]) {
          const [c1, c2] = engineFrame(from, pairs[i], t);
          const cur = rotationCursor(pairs, c1, c2);
          expect(cur).not.toBeNull();
          expect(cur!.index).toBe(i);
          expect(cur!.t).toBeCloseTo(t, 6);
        }
      }
    }
  });

  it('still rejects a palette that is not on any of the ring\'s segments', () => {
    const pairs = orbitPairs(RING, [0, 2]);
    const [c1, c2] = engineFrame(pairs[0], pairs[1], 0.5);
    expect(rotationCursor(pairs, colour(c1.h + 0.05, c1.s, c1.v), c2)).toBeNull();
  });
});

describe('the rail draws the orbit — two cells that keep their distance', () => {
  it('at distance 1 it is the ONE two-cell capsule the rail always drew', () => {
    for (const cur of [{ index: 2, t: 1 }, { index: 2, t: 0.5 }, { index: 0, t: 0 }]) {
      expect(cursorRailSegments(cur, 5, 1))
        .toEqual([{ left: cursorRailOffset(cur, 5), width: 2 }]);
    }
  });

  it('at a wider distance it is TWO one-cell segments, d apart', () => {
    // Settled on turn 0 of a d = 2 orbit: cells 0 and 2 light, not 0 and 1.
    expect(cursorRailSegments({ index: 1, t: 1 }, 5, 2)).toEqual([
      { left: 1, width: 1 }, { left: 3, width: 1 },
    ]);
    // Mid-fade, both ends travel together and the gap never changes.
    const mid = cursorRailSegments({ index: 1, t: 0.5 }, 5, 2);
    expect(mid[0].left).toBeCloseTo(0.5, 9);
    expect(mid[1].left - mid[0].left).toBeCloseTo(2, 9);
  });

  it('a segment past the ring\'s end is drawn for the SEAM, not clamped', () => {
    // The component draws every segment at `left` and `left - ringLength`, so a
    // trailing cell beyond the end must stay beyond it rather than wrap in
    // place — that is what makes the T5→T1 turn slide instead of teleport.
    const segs = cursorRailSegments({ index: 4, t: 1 }, 5, 3);
    expect(segs).toEqual([{ left: 4, width: 1 }, { left: 7, width: 1 }]);
    expect(segs[1].left - 5).toBe(2);
  });

  it('the PHASE shifts the whole highlight into staged-slot space', () => {
    // Wire turn 0 of a ring posted starting at T3 lights staged slot 2.
    expect(cursorRailOffset({ index: 1, t: 1 }, 5, 2)).toBeCloseTo(3, 9);
    expect(cursorRailSegments({ index: 1, t: 1 }, 5, 2, 2)).toEqual([
      { left: 3, width: 1 }, { left: 5, width: 1 },
    ]);
    // Phase wraps like everything else on the ring.
    expect(cursorRailOffset({ index: 1, t: 1 }, 5, 4)).toBeCloseTo(0, 9);
  });
});

// ── _224 order 3: which two of the five feed A and B ────────────────────────

describe('scheme pair selection — the ACTIVE TWO are the operator\'s pick', () => {
  /** Wrap-safe separation between two hues, in whole degrees. */
  const sep = (a: Hsv, b: Hsv) => Math.round(((((b.h - a.h) % 1) + 1) % 1) * 360);

  it('defaults to slots 1 + 2', () => {
    expect([...SCHEME_PAIR_DEFAULT]).toEqual([0, 1]);
    expect([...PAIR_CHANNEL_LABELS]).toEqual(['A', 'B']);
  });

  it('assigns a slot to the armed channel, leaving the other alone', () => {
    expect(selectSchemePair([0, 1], 0, 3)).toEqual({ ok: true, sel: [3, 1] });
    expect(selectSchemePair([3, 1], 1, 4)).toEqual({ ok: true, sel: [3, 4] });
  });

  it('REFUSES putting both channels on one slot, with a sentence naming it', () => {
    const r = selectSchemePair([1, 3], 0, 3);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/T4 is already COLOUR B/);
    const r2 = selectSchemePair([1, 3], 1, 1);
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.reason).toMatch(/T2 is already COLOUR A/);
  });

  it('re-picking the slot a channel ALREADY holds is a no-op, not a refusal', () => {
    expect(selectSchemePair([2, 4], 0, 2)).toEqual({ ok: true, sel: [2, 4] });
  });

  it('an out-of-range slot is a caller bug and THROWS', () => {
    expect(() => selectSchemePair([0, 1], 0, 5)).toThrow(/outside the ring/);
    expect(() => selectSchemePair([0, 1], 1, -1)).toThrow(/outside the ring/);
  });

  it('the selection is by SLOT, so a wheel re-theme carries it forward', () => {
    const pick: readonly [number, number] = [1, 3];
    const before = schemePairColours(generateScheme('contrast', 0.1), pick);
    const after = schemePairColours(generateScheme('contrast', 0.6), pick);
    // Same SLOTS, re-themed from the new base hue: 144 deg apart either way,
    // but neither colour is the one it was.
    expect(sep(before[0], before[1])).toBe(144);
    expect(sep(after[0], after[1])).toBe(144);
    expect(before[0].h).not.toBeCloseTo(after[0].h, 6);
  });

  it('schemePairColours THROWS rather than substituting a slot the ring lacks', () => {
    expect(() => schemePairColours(generateScheme('hue', 0.3).slice(0, 2), [0, 4]))
      .toThrow(/not in a ring of 2/);
  });

  it('the default pick reproduces the `_217` behaviour exactly', () => {
    const ring = generateScheme('complement', 0);
    const [a, b] = schemePairColours(ring, SCHEME_PAIR_DEFAULT);
    expect(a).toEqual(ring[0]);
    expect(b).toEqual(ring[1]);
    // COMPLEMENT's far edge in slot 2 -> A and B land 60 deg apart.
    expect(sep(a, b)).toBe(60);
  });
});

// ── _224 order 4: the additional generators ─────────────────────────────────

describe('the _224 scheme generators', () => {
  const NEW_IDS = ['analogous', 'triadic', 'split', 'tetrad', 'golden'] as const;

  it('extend the row without disturbing the four ports', () => {
    expect([...SCHEME_IDS]).toEqual([
      'master', 'hue', 'complement', 'contrast',
      'analogous', 'triadic', 'split', 'tetrad', 'golden',
    ]);
  });

  it('every scheme in the row still yields five colours at the base saturation', () => {
    for (const id of SCHEME_IDS) {
      const out = generateScheme(id, 0.41);
      expect(out).toHaveLength(5);
      for (const c of out) expect(c.s).toBe(SCHEME_BASE_S);
    }
  });

  it('NIGHT-VISIBILITY FLOOR: no new scheme goes below v = 0.25', () => {
    expect(SCHEME_ROTATION_MIN_V).toBe(0.25);
    for (const id of NEW_IDS) {
      for (const base of [0, 0.13, 0.5, 0.87]) {
        for (const c of generateScheme(id, base)) {
          expect(c.v).toBeGreaterThanOrEqual(SCHEME_ROTATION_MIN_V);
        }
      }
    }
  });

  it('the four Live Touch ports keep their OWN verbatim floor, unchanged', () => {
    // Re-flooring a PORT would make the Deck and Live Touch disagree about what
    // HUE means; HUE's darkest step happens to be 0.25 anyway.
    expect(SCHEME_MIN_V).toBe(0.1);
    expect(generateScheme('hue', 0.72).map((c) => c.v)).toEqual([1.0, 0.78, 0.58, 0.40, 0.25]);
  });

  it('ANALOGOUS is a tight +/-30 deg family, alternating sides of the base', () => {
    expect(ANALOGOUS_STEPS.map((s) => s[0])).toEqual([0, 15, -15, 30, -30]);
    const out = generateScheme('analogous', 0);
    expect(out.map((c) => Math.round(c.h * 360))).toEqual([0, 15, 345, 30, 330]);
    for (const c of out) expect(c.v).toBe(1);
  });

  it('TRIADIC is the 120 deg triad plus two dimmed echoes', () => {
    expect(TRIADIC_STEPS.map((s) => s[0])).toEqual([0, 120, 240, 0, 120]);
    const out = generateScheme('triadic', 0);
    expect(out.map((c) => Math.round(c.h * 360))).toEqual([0, 120, 240, 0, 120]);
    expect(out.map((c) => c.v)).toEqual([1, 1, 1, 0.55, 0.55]);
  });

  it('SPLIT flanks the complement (150/210) instead of hitting it', () => {
    expect(SPLIT_STEPS.map((s) => s[0])).toEqual([0, 150, 210, 150, 210]);
    const out = generateScheme('split', 0);
    expect(out.map((c) => Math.round(c.h * 360))).toEqual([0, 150, 210, 150, 210]);
    // The point of SPLIT: the true 180 deg complement is deliberately absent.
    expect(out.map((c) => Math.round(c.h * 360))).not.toContain(180);
  });

  it('TETRAD is the 90 deg square, its fifth slot a DIMMED base (no dead beat)', () => {
    expect(TETRAD_STEPS.map((s) => s[0])).toEqual([0, 90, 180, 270, 0]);
    const out = generateScheme('tetrad', 0);
    expect(out.map((c) => Math.round(c.h * 360))).toEqual([0, 90, 180, 270, 0]);
    // T5 repeats T1's hue, so if it also repeated its brightness the wrap turn
    // would be a fade from a colour to itself — a visibly dead beat.
    expect(out[4].h).toBeCloseTo(out[0].h, 9);
    expect(out[4].v).toBeLessThan(out[0].v);
    expect(sameColour(out[4], out[0])).toBe(false);
  });

  it('GOLDEN steps the golden angle, so nothing lands on a symmetry', () => {
    expect(GOLDEN_ANGLE_DEG).toBe(137.5);
    const out = generateScheme('golden', 0);
    [0, 137.5, 275, 52.5, 190].forEach((deg, i) => {
      expect(out[i].h * 360).toBeCloseTo(deg, 6);
    });
    for (const c of out) expect(c.v).toBe(1);
  });

  it('every new scheme is a legal ring the engine would accept', () => {
    for (const id of NEW_IDS) {
      const patch = turnsAutopilotPatch(generateScheme(id, 0.33), 2, 1.5);
      expect(isTurnsConfig(patch.palettes)).toBe(true);
      expect(turnsColors(patch.palettes)).toEqual(generateScheme(id, 0.33));
      expect(rotationKind(true, patch.palettes)).toBe('turns');
    }
  });

  it('NO DEAD BEAT: no new ring has two identical ADJACENT colours', () => {
    for (const id of NEW_IDS) {
      const ring = generateScheme(id, 0.63);
      for (let i = 0; i < ring.length; i++) {
        expect(sameColour(ring[i], ring[(i + 1) % ring.length])).toBe(false);
      }
    }
  });

  it('the base hue is the operator\'s armed hue, and every rotation wraps', () => {
    for (const id of NEW_IDS) {
      for (const c of generateScheme(id, 0.93)) {
        expect(c.h).toBeGreaterThanOrEqual(0);
        expect(c.h).toBeLessThan(1);
      }
    }
    expect(generateScheme('triadic', 0.9).map((c) => Math.round(c.h * 360)))
      .toEqual([324, 84, 204, 324, 84]);
  });

  it('the SLIDING WINDOW reads a new scheme\'s ring exactly as it reads a port\'s', () => {
    for (const id of NEW_IDS) {
      const ring = turnsPairs(generateScheme(id, 0.2));
      for (let i = 0; i < ring.length; i++) {
        expect(rotationCursor(ring, asHsv(ring[i].c1), asHsv(ring[i].c2))!.index).toBe(i);
      }
    }
  });
});

/**
 * ── THE PARITY REFERENCE TABLE (docs/59 §3, the `_217` lerpHue idiom) ───────
 *
 * The SAME literal lives in `marsin_engine/tests/effects/color_schemes.test.js`.
 * It is the whole reason two implementations of these generators are allowed to
 * exist: FOLLOW NOTE re-derives the ring INSIDE the engine on every committed
 * note change (a precomputed client ring cannot express a hue nobody has played
 * yet), while this window still stages rings on the glass and draws the live
 * ring's five swatches. If the two drifted by a float, the swatches the
 * operator picks A and B from would stop being the colours on the ship.
 *
 * All 9 scheme ids × 3 base hues → the full five {h,s,v} triples, EXACT (no
 * epsilon): both sides run the identical arithmetic in the identical order, so
 * a tolerance would only hide the day one of them stops doing that. Change
 * either implementation and a test breaks on BOTH sides.
 */
const SCHEME_REFERENCE: Record<string, Record<string, Hsv[]>> = {
  '0': {
    master: [{ h: 0, s: 0.95, v: 1 }, { h: 0, s: 0.95, v: 1 }, { h: 0, s: 0.95, v: 1 }, { h: 0, s: 0.95, v: 1 }, { h: 0, s: 0.95, v: 1 }],
    hue: [{ h: 0, s: 0.95, v: 1 }, { h: 0, s: 0.95, v: 0.78 }, { h: 0, s: 0.95, v: 0.58 }, { h: 0, s: 0.95, v: 0.4 }, { h: 0, s: 0.95, v: 0.25 }],
    complement: [{ h: 0, s: 0.95, v: 1 }, { h: 0.16666666666666666, s: 0.95, v: 1 }, { h: 0.08333333333333333, s: 0.95, v: 1 }, { h: 0.9166666666666666, s: 0.95, v: 1 }, { h: 0.8333333333333334, s: 0.95, v: 1 }],
    contrast: [{ h: 0, s: 0.95, v: 1 }, { h: 0.2, s: 0.95, v: 1 }, { h: 0.4, s: 0.95, v: 1 }, { h: 0.6, s: 0.95, v: 1 }, { h: 0.8, s: 0.95, v: 1 }],
    analogous: [{ h: 0, s: 0.95, v: 1 }, { h: 0.041666666666666664, s: 0.95, v: 1 }, { h: 0.9583333333333334, s: 0.95, v: 1 }, { h: 0.08333333333333333, s: 0.95, v: 1 }, { h: 0.9166666666666666, s: 0.95, v: 1 }],
    triadic: [{ h: 0, s: 0.95, v: 1 }, { h: 0.3333333333333333, s: 0.95, v: 1 }, { h: 0.6666666666666666, s: 0.95, v: 1 }, { h: 0, s: 0.95, v: 0.55 }, { h: 0.3333333333333333, s: 0.95, v: 0.55 }],
    split: [{ h: 0, s: 0.95, v: 1 }, { h: 0.4166666666666667, s: 0.95, v: 1 }, { h: 0.5833333333333334, s: 0.95, v: 1 }, { h: 0.4166666666666667, s: 0.95, v: 0.55 }, { h: 0.5833333333333334, s: 0.95, v: 0.55 }],
    tetrad: [{ h: 0, s: 0.95, v: 1 }, { h: 0.25, s: 0.95, v: 1 }, { h: 0.5, s: 0.95, v: 1 }, { h: 0.75, s: 0.95, v: 1 }, { h: 0, s: 0.95, v: 0.55 }],
    golden: [{ h: 0, s: 0.95, v: 1 }, { h: 0.3819444444444444, s: 0.95, v: 1 }, { h: 0.7638888888888888, s: 0.95, v: 1 }, { h: 0.14583333333333334, s: 0.95, v: 1 }, { h: 0.5277777777777778, s: 0.95, v: 1 }],
  },
  '0.25': {
    master: [{ h: 0.25, s: 0.95, v: 1 }, { h: 0.25, s: 0.95, v: 1 }, { h: 0.25, s: 0.95, v: 1 }, { h: 0.25, s: 0.95, v: 1 }, { h: 0.25, s: 0.95, v: 1 }],
    hue: [{ h: 0.25, s: 0.95, v: 1 }, { h: 0.25, s: 0.95, v: 0.78 }, { h: 0.25, s: 0.95, v: 0.58 }, { h: 0.25, s: 0.95, v: 0.4 }, { h: 0.25, s: 0.95, v: 0.25 }],
    complement: [{ h: 0.25, s: 0.95, v: 1 }, { h: 0.41666666666666663, s: 0.95, v: 1 }, { h: 0.3333333333333333, s: 0.95, v: 1 }, { h: 0.16666666666666652, s: 0.95, v: 1 }, { h: 0.08333333333333348, s: 0.95, v: 1 }],
    contrast: [{ h: 0.25, s: 0.95, v: 1 }, { h: 0.45, s: 0.95, v: 1 }, { h: 0.65, s: 0.95, v: 1 }, { h: 0.85, s: 0.95, v: 1 }, { h: 0.050000000000000044, s: 0.95, v: 1 }],
    analogous: [{ h: 0.25, s: 0.95, v: 1 }, { h: 0.2916666666666667, s: 0.95, v: 1 }, { h: 0.20833333333333348, s: 0.95, v: 1 }, { h: 0.3333333333333333, s: 0.95, v: 1 }, { h: 0.16666666666666652, s: 0.95, v: 1 }],
    triadic: [{ h: 0.25, s: 0.95, v: 1 }, { h: 0.5833333333333333, s: 0.95, v: 1 }, { h: 0.9166666666666666, s: 0.95, v: 1 }, { h: 0.25, s: 0.95, v: 0.55 }, { h: 0.5833333333333333, s: 0.95, v: 0.55 }],
    split: [{ h: 0.25, s: 0.95, v: 1 }, { h: 0.6666666666666667, s: 0.95, v: 1 }, { h: 0.8333333333333334, s: 0.95, v: 1 }, { h: 0.6666666666666667, s: 0.95, v: 0.55 }, { h: 0.8333333333333334, s: 0.95, v: 0.55 }],
    tetrad: [{ h: 0.25, s: 0.95, v: 1 }, { h: 0.5, s: 0.95, v: 1 }, { h: 0.75, s: 0.95, v: 1 }, { h: 0, s: 0.95, v: 1 }, { h: 0.25, s: 0.95, v: 0.55 }],
    golden: [{ h: 0.25, s: 0.95, v: 1 }, { h: 0.6319444444444444, s: 0.95, v: 1 }, { h: 0.01388888888888884, s: 0.95, v: 1 }, { h: 0.39583333333333337, s: 0.95, v: 1 }, { h: 0.7777777777777778, s: 0.95, v: 1 }],
  },
  '0.61803': {
    master: [{ h: 0.61803, s: 0.95, v: 1 }, { h: 0.61803, s: 0.95, v: 1 }, { h: 0.61803, s: 0.95, v: 1 }, { h: 0.61803, s: 0.95, v: 1 }, { h: 0.61803, s: 0.95, v: 1 }],
    hue: [{ h: 0.61803, s: 0.95, v: 1 }, { h: 0.61803, s: 0.95, v: 0.78 }, { h: 0.61803, s: 0.95, v: 0.58 }, { h: 0.61803, s: 0.95, v: 0.4 }, { h: 0.61803, s: 0.95, v: 0.25 }],
    complement: [{ h: 0.61803, s: 0.95, v: 1 }, { h: 0.7846966666666666, s: 0.95, v: 1 }, { h: 0.7013633333333333, s: 0.95, v: 1 }, { h: 0.5346966666666666, s: 0.95, v: 1 }, { h: 0.45136333333333334, s: 0.95, v: 1 }],
    contrast: [{ h: 0.61803, s: 0.95, v: 1 }, { h: 0.81803, s: 0.95, v: 1 }, { h: 0.01802999999999999, s: 0.95, v: 1 }, { h: 0.21802999999999995, s: 0.95, v: 1 }, { h: 0.4180299999999999, s: 0.95, v: 1 }],
    analogous: [{ h: 0.61803, s: 0.95, v: 1 }, { h: 0.6596966666666666, s: 0.95, v: 1 }, { h: 0.5763633333333333, s: 0.95, v: 1 }, { h: 0.7013633333333333, s: 0.95, v: 1 }, { h: 0.5346966666666666, s: 0.95, v: 1 }],
    triadic: [{ h: 0.61803, s: 0.95, v: 1 }, { h: 0.9513633333333333, s: 0.95, v: 1 }, { h: 0.2846966666666666, s: 0.95, v: 1 }, { h: 0.61803, s: 0.95, v: 0.55 }, { h: 0.9513633333333333, s: 0.95, v: 0.55 }],
    split: [{ h: 0.61803, s: 0.95, v: 1 }, { h: 0.0346966666666666, s: 0.95, v: 1 }, { h: 0.20136333333333334, s: 0.95, v: 1 }, { h: 0.0346966666666666, s: 0.95, v: 0.55 }, { h: 0.20136333333333334, s: 0.95, v: 0.55 }],
    tetrad: [{ h: 0.61803, s: 0.95, v: 1 }, { h: 0.86803, s: 0.95, v: 1 }, { h: 0.11803000000000008, s: 0.95, v: 1 }, { h: 0.3680300000000001, s: 0.95, v: 1 }, { h: 0.61803, s: 0.95, v: 0.55 }],
    golden: [{ h: 0.61803, s: 0.95, v: 1 }, { h: 0.9999744444444444, s: 0.95, v: 1 }, { h: 0.3819188888888889, s: 0.95, v: 1 }, { h: 0.7638633333333333, s: 0.95, v: 1 }, { h: 0.14580777777777776, s: 0.95, v: 1 }],
  },
};

describe('scheme generator parity with the engine (docs/59 §3)', () => {
  it('the reference table covers every scheme id at every base hue', () => {
    const bases = Object.keys(SCHEME_REFERENCE);
    expect(bases).toHaveLength(3);
    for (const base of bases) {
      expect(Object.keys(SCHEME_REFERENCE[base]).sort()).toEqual([...SCHEME_IDS].sort());
    }
  });

  for (const base of Object.keys(SCHEME_REFERENCE)) {
    for (const id of SCHEME_IDS) {
      it(`generateScheme('${id}', ${base}) matches the shared reference table EXACTLY`, () => {
        expect(generateScheme(id, Number(base))).toEqual(SCHEME_REFERENCE[base][id]);
      });
    }
  }
});

// ── FOLLOW NOTE — client logic (docs/59 W6) ─────────────────────────────────

describe('FOLLOW NOTE — the rotation kind comes from the MODE, never the shapes', () => {
  it('a follow-note broadcast is a follow-note rotation even with no palettes', () => {
    // A follow-note config HAS no palettes — the ring is re-derived engine-side
    // on every committed note — so shape-sniffing would call it a palette-set
    // and hand it the wrong interaction row.
    expect(rotationKind(true, undefined, 'followNote')).toBe('follow-note');
    expect(rotationKind(true, [], 'followNote')).toBe('follow-note');
  });

  it('leaves every existing kind byte-unchanged when the mode is absent or palettes', () => {
    const ring = turnsPairs(RING);
    expect(rotationKind(false, ring)).toBe('none');
    expect(rotationKind(true, ring)).toBe('turns');
    expect(rotationKind(true, ring, 'palettes')).toBe('turns');
    expect(rotationKind(true, turnsPairs(RING.slice(0, 2)))).toBe('crossfade');
    expect(rotationKind(true, ['aurora', 'deep_sea'])).toBe('palette-set');
  });

  it('a parked follow-note config is still `none` — mode does not mean running', () => {
    expect(rotationKind(false, undefined, 'followNote')).toBe('none');
  });
});

describe('FOLLOW NOTE — a scheme tap from its OWN card is a METHOD OVERRIDE, through the front door', () => {
  it('overrides the method rather than staging or restaging, tapped from the follow card', () => {
    const out = schemeTapOutcome('follow-note', 'TRIADIC', 'follow');
    expect(out.action).toBe('method-override');
    expect(out.message).toBe('Method set to TRIADIC — cycle continues from here.');
  });

  it('leaves the other own-card rows of the interaction table exactly as they were', () => {
    expect(schemeTapOutcome('none', 'SPLIT', 'two').action).toBe('stage-and-write');
    expect(schemeTapOutcome('turns', 'SPLIT', 'turns').action).toBe('restage');
    expect(schemeTapOutcome('crossfade', 'SPLIT', 'two').action).toBe('stage-only');
    expect(schemeTapOutcome('palette-set', 'SPLIT', 'two').action).toBe('stage-only');
  });

  it('the manual-write gate is KIND-NAMED (docs/61 §4.2, D4) — it names FOLLOW NOTE while following', () => {
    // Wheel drags, Live Touch chips, saved pairs and preset loads are all
    // refused, kind-named, under FOLLOW NOTE exactly as under any rotation.
    const g = manualWriteGate(false, 'follow-note');
    expect(g.canWrite).toBe(false);
    expect((g as { reason: string }).reason)
      .toBe('FOLLOW NOTE is driving the colours — STOP it to edit.');
  });
});

describe('FOLLOW NOTE — the START patch mirrors the engine validator', () => {
  const base = {
    schemes: [...FOLLOW_NOTE_DEFAULT_SCHEMES],
    methodHoldS: METHOD_HOLD_DEFAULT_S,
    methodFadeS: METHOD_FADE_DEFAULT_S,
    noteFadeMs: NOTE_FADE_DEFAULT_MS,
    sel: [0, 1] as const,
  };

  it('builds the wire the engine accepts, with NO palettes-mode fields on it', () => {
    const patch = followNoteAutopilotPatch(base);
    expect(patch).toEqual({
      active: true,
      mode: 'followNote',
      followNote: {
        schemes: [...FOLLOW_NOTE_DEFAULT_SCHEMES],
        methodHoldS: 60, methodFadeS: 3, noteFadeMs: 400, sel: [0, 1], shuffle: false,
      },
    });
    expect('palettes' in patch).toBe(false);
    expect('delay_s' in patch).toBe(false);
  });

  it('the DEFAULT subset is the seven MULTI-HUE generators — MASTER and HUE opt in', () => {
    // The mission's first line is "highly visible at night", which wants two-hue
    // pairs by default; a monochrome beat stays one tap away.
    expect(FOLLOW_NOTE_DEFAULT_SCHEMES).toEqual(
      ['complement', 'contrast', 'analogous', 'triadic', 'split', 'tetrad', 'golden']);
    expect(FOLLOW_NOTE_DEFAULT_SCHEMES).not.toContain('master');
    expect(FOLLOW_NOTE_DEFAULT_SCHEMES).not.toContain('hue');
  });

  it('refuses an EMPTY cycle with the sentence the card shows', () => {
    expect(() => followNoteAutopilotPatch({ ...base, schemes: [] }))
      .toThrow('The cycle needs at least one method.');
  });

  it('refuses a repeated method and an unknown one', () => {
    expect(() => assertSchemeSubset(['triadic', 'split', 'triadic']))
      .toThrow(/lists TRIADIC twice/);
    expect(() => assertSchemeSubset(['nope' as SchemeId])).toThrow(/"nope" is not a known method/);
  });

  it('refuses the method-cycle SPIN LOOP, exactly as the engine does', () => {
    expect(() => followNoteAutopilotPatch({ ...base, methodHoldS: 0, methodFadeS: 0.05 }))
      .toThrow(/CONT \(no method hold\) needs a fade of at least 0\.1s/);
    // …and accepts continuous with a real fade.
    expect(followNoteAutopilotPatch({ ...base, methodHoldS: 0, methodFadeS: 1.5 })
      .followNote.methodHoldS).toBe(0);
    expect(MIN_CONTINUOUS_METHOD_FADE_S).toBe(0.1);
  });

  it('refuses a zero fade, a negative hold, a negative note fade and a collapsed pair', () => {
    expect(() => followNoteAutopilotPatch({ ...base, methodFadeS: 0 })).toThrow(/METHOD FADE must be a positive/);
    expect(() => followNoteAutopilotPatch({ ...base, methodHoldS: -1 })).toThrow(/METHOD HOLD must be 0/);
    expect(() => followNoteAutopilotPatch({ ...base, noteFadeMs: -1 })).toThrow(/NOTE FADE must be 0/);
    expect(() => followNoteAutopilotPatch({ ...base, sel: [2, 2] })).toThrow(/cannot feed BOTH A and B/);
  });

  it('SNAP (noteFadeMs 0) is a legal choice, not an error', () => {
    expect(followNoteAutopilotPatch({ ...base, noteFadeMs: 0 }).followNote.noteFadeMs).toBe(0);
    expect(NOTE_FADE_PRESETS_MS[0]).toBe(0);
  });

  it('the pill rows carry the operator-approved defaults', () => {
    expect(METHOD_HOLD_PRESETS_S).toContain(METHOD_HOLD_DEFAULT_S);
    expect(METHOD_FADE_PRESETS_S).toContain(METHOD_FADE_DEFAULT_S);
    expect(NOTE_FADE_PRESETS_MS).toContain(NOTE_FADE_DEFAULT_MS);
    // The METHOD rows are a MOOD cadence and deliberately do NOT share the
    // seconds-scale pair transport — 1 s method thrash must not be one tap away.
    expect(METHOD_FADE_PRESETS_S.every((v) => v >= 1.5)).toBe(true);
    expect(METHOD_HOLD_PRESETS_S.filter((v) => v > 0).every((v) => v >= 10)).toBe(true);
  });
});

describe('FOLLOW NOTE — toggling the cycle subset', () => {
  it('adds a method in CANONICAL row order, not tap order', () => {
    const res = toggleSchemeSubset(['triadic', 'golden'], 'complement');
    expect(res).toEqual({ ok: true, schemes: ['complement', 'triadic', 'golden'] });
  });

  it('removes a method that is in the cycle', () => {
    const res = toggleSchemeSubset(['complement', 'triadic'], 'triadic');
    expect(res).toEqual({ ok: true, schemes: ['complement'] });
  });

  it('REFUSES to empty the cycle, visibly', () => {
    const res = toggleSchemeSubset(['triadic'], 'triadic');
    expect(res).toEqual({ ok: false, reason: 'The cycle needs at least one method.' });
  });
});

describe('FOLLOW NOTE — the state line is derived from the broadcast alone', () => {
  it('says PARKED when the daemon is not running', () => {
    expect(followNoteStateLine({ active: false, currentScheme: 'triadic', notePc: 4 }))
      .toBe('FOLLOW NOTE — parked');
  });

  it('names the note, the method and the one after it', () => {
    expect(followNoteStateLine({
      active: true, currentScheme: 'triadic', schemes: ['triadic', 'split'], notePc: 4,
    })).toBe('NOTE IS DRIVING — E · TRIADIC → SPLIT');
  });

  it('APPENDS the silence sentence — and holds, rather than inventing a colour', () => {
    const line = followNoteStateLine({
      active: true, currentScheme: 'split', schemes: ['split'], notePc: 0,
      audioSilence: AUDIO_SILENCE_THRESHOLD,
    });
    expect(line).toContain('HOLDING LAST NOTE (audio silent)');
    // Below the threshold the sentence is absent — it is a REPORT, not a mode.
    expect(followNoteStateLine({
      active: true, currentScheme: 'split', schemes: ['split'], notePc: 0, audioSilence: 0.1,
    })).not.toContain('HOLDING LAST NOTE');
  });

  it('shows an em-dash rather than inventing a note when there is no committed pitch', () => {
    expect(noteName(null)).toBe('—');
    expect(noteName(undefined)).toBe('—');
    expect(noteName(12)).toBe('—');
    expect(noteName(1.5)).toBe('—');
    expect(followNoteStateLine({ active: true, currentScheme: 'golden', notePc: null }))
      .toBe('NOTE IS DRIVING — — · GOLDEN');
  });

  it('uses the companion\'s OWN note table, so both surfaces say the same letter', () => {
    expect(NOTE_NAMES).toEqual(['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']);
    expect(noteName(9)).toBe('A');
  });

  it('a cycle of one has no "next" worth naming, and a tap override reads as arriving', () => {
    expect(nextMethodOf(['triadic'], 'triadic')).toBeNull();
    expect(nextMethodOf(undefined, 'triadic')).toBeNull();
    // The current method is a tap override outside the subset: the next advance
    // starts the subset from the top, and the line says so.
    expect(nextMethodOf(['complement', 'split'], 'golden')).toBe('complement');
    expect(nextMethodOf(['complement', 'split'], 'split')).toBe('complement');
  });
});

// ── LIVE RETUNE — the §5.1 table, as code ───────────────────────────────────

describe('LIVE RETUNE — which fields a running rotation takes live', () => {
  it('nothing is retunable when nothing is running', () => {
    for (const f of ['delay_s', 'transitionMs', 'methodHoldS', 'sel'] as const) {
      expect(retunableLive('none', f)).toBe(false);
    }
  });

  it('the ring families take the palettes-mode fields, and only those', () => {
    for (const kind of ['crossfade', 'turns'] as const) {
      expect(retunableLive(kind, 'delay_s')).toBe(true);
      expect(retunableLive(kind, 'transitionMs')).toBe(true);
      expect(retunableLive(kind, 'palettes')).toBe(true);
      expect(retunableLive(kind, 'methodHoldS')).toBe(false);
      expect(retunableLive(kind, 'sel')).toBe(false);
    }
  });

  it('follow-note takes the follow-note fields, and only those', () => {
    for (const f of ['methodHoldS', 'methodFadeS', 'noteFadeMs', 'schemes', 'sel', 'method'] as const) {
      expect(retunableLive('follow-note', f)).toBe(true);
    }
    expect(retunableLive('follow-note', 'delay_s')).toBe(false);
    expect(retunableLive('follow-note', 'palettes')).toBe(false);
  });

  it('a palette-set rotation belongs to the AUTOPILOT window and is never retuned from here', () => {
    expect(retunableLive('palette-set', 'delay_s')).toBe(false);
    expect(retunableLive('palette-set', 'palettes')).toBe(false);
  });
});

describe('LIVE RETUNE — the sparse patch body', () => {
  it('nests follow-note fields and leaves palettes-mode fields at the top level', () => {
    expect(rotationRetunePatch('turns', { delay_s: 10 })).toEqual({ delay_s: 10 });
    expect(rotationRetunePatch('follow-note', { methodHoldS: 120 }))
      .toEqual({ followNote: { methodHoldS: 120 } });
    expect(rotationRetunePatch('follow-note', { schemes: ['triadic'], sel: [1, 3] }))
      .toEqual({ followNote: { schemes: ['triadic'], sel: [1, 3] } });
  });

  it('carries ONLY the moved knob — so setting one field cannot silently clear another', () => {
    const patch = rotationRetunePatch('crossfade', { transitionMs: 3000 });
    expect(Object.keys(patch)).toEqual(['transitionMs']);
  });

  it('REFUSES a field the running kind cannot take live, and an empty patch', () => {
    expect(() => rotationRetunePatch('turns', { methodHoldS: 30 }))
      .toThrow(/'methodHoldS' cannot be retuned live on a 'turns' rotation/);
    expect(() => rotationRetunePatch('none', { delay_s: 5 }))
      .toThrow(/cannot be retuned live on a 'none' rotation/);
    expect(() => rotationRetunePatch('turns', {})).toThrow(/must carry at least one field/);
  });

  it('the timing table says WHEN each field shows, and every tag has wording', () => {
    expect(retuneTiming('delay_s')).toBe('now');
    expect(retuneTiming('methodHoldS')).toBe('now');
    expect(retuneTiming('transitionMs')).toBe('next-fade');
    expect(retuneTiming('methodFadeS')).toBe('next-fade');
    expect(retuneTiming('noteFadeMs')).toBe('next-fade');
    expect(retuneTiming('palettes')).toBe('next-transition');
    expect(retuneTiming('schemes')).toBe('next-transition');
    expect(retuneTiming('shuffle')).toBe('next-pick');
    expect(retuneTiming('sel')).toBe('now');
    expect(retuneTiming('method')).toBe('now');
    expect(RETUNE_TIMING_TAGS.now).toBe('applies now');
    expect(RETUNE_TIMING_TAGS['next-fade']).toBe('from the next fade');
  });

  it('active and mode are UNREPRESENTABLE as retune fields — they are takeovers', () => {
    // Not a runtime refusal nobody reads: the type has no such members, so a
    // start/stop cannot be smuggled through the patch door in the first place.
    expect(() => rotationRetunePatch('turns', { active: false } as never))
      .toThrow(/'active' cannot be retuned live/);
  });
});

describe('the method timing contract mirrors the ring one', () => {
  it('accepts what the engine accepts', () => {
    expect(() => assertMethodTiming(60, 3)).not.toThrow();
    expect(() => assertMethodTiming(0, 1.5)).not.toThrow();
  });
  it('and refuses what it refuses', () => {
    expect(() => assertMethodTiming(-1, 3)).toThrow();
    expect(() => assertMethodTiming(60, 0)).toThrow();
    expect(() => assertMethodTiming(0, 0.05)).toThrow();
  });
  it('every scheme id has an operator-facing title', () => {
    expect(Object.keys(SCHEME_TITLES)).toEqual([...SCHEME_IDS]);
  });
});
