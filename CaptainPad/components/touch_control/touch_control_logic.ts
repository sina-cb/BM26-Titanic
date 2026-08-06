// touch_control_logic — pure, React-Native-free logic for the TOUCH CONTROL tab.
//
// WHY THIS FILE IS SEPARATE FROM THE .tsx SURFACES:
//   `vitest.config.ts` globs `components/**/*.test.ts` and deliberately
//   EXCLUDES `.tsx` (RN components cannot load in the node test environment —
//   see the config's own header). So logic that lives in a `.tsx` is
//   structurally untestable in this repo. Every piece of math, every mapping
//   table, and the send-rate gate therefore live HERE, and the sibling `.tsx`
//   files stay thin render shells. `.agent/os/testing.md`: a test that isn't
//   picked up by the default runner guards nothing.
//
// Codex P0 — NO fallback behaviors: these helpers either return a correct
// value for valid input or fail loudly. Nothing silently coerces garbage into
// a plausible-looking default, because a plausible-looking default here means
// writing a wrong value to a live lighting rig.
//
// "Not measured yet" is modelled as an explicit `null`, NOT as an error and
// NOT as a silent 0 — a View that has not been laid out yet is a legitimate
// transient state, whereas a non-finite number is a programming bug.

/** WS `origin` tag stamped on every CPC write from this tab, so the engine's
 *  param-center audit trail (`lastOrigin`) can attribute a value to this
 *  surface. Mirrors the `source` threading the VSN1/CaptainPad writers use. */
export const TOUCH_CONTROL_ORIGIN = 'touch_control';

/** Central Param Center keys this tab writes. Verified present in the live
 *  engine's `GET /param-center/schema` (all `type: float`/`hsv`, range [0,1]
 *  except colorTransitionMs). Do NOT add a key here without confirming it in
 *  the schema first — an unknown key is answered `paramRejected: unknown_key`. */
export const CPC = {
  COLOR_1: 'colorPalette1',
  COLOR_2: 'colorPalette2',
  COLOR_FADE_MS: 'colorTransitionMs',
  SIZE: 'size',
  ROTATE: 'rotate',
  SPEED: 'speed',
  BPM_SPEED_SYNC: 'bpmSpeedSync',
} as const;

/** Engine-accepted bounds for `colorTransitionMs` (schema range [0, 10000]). */
export const COLOR_FADE_MIN_MS = 0;
export const COLOR_FADE_MAX_MS = 10000;

/**
 * The 3D pad's axis mapping.
 *
 * IMPORTANT — this is an HONEST mapping, not a literal XYZ position. The
 * MarsinEngine exposes NO x/y/z coordinate parameter: its spatial targeting
 * concept is view/group masks (`lib/strand_views.js`), not Cartesian space.
 * Verified against the live engine's 73-entry `/param-center/schema` — there
 * is no positional key to write. What the CPC *does* expose is the trio that
 * governs a pattern's spatial character, so the pad drives those and the UI
 * labels each axis with the parameter it actually moves. Never label an axis
 * "X" alone here — the operator must be able to see what the rig will do.
 */
export interface PadAxis {
  /** CPC key this axis writes, or null when it rides another transport. */
  key: string | null;
  /** How the value reaches the engine. `master` = PATCH /mixer { master }. */
  transport: 'cpc' | 'master';
  /** Axis letter shown on the pad. */
  axis: 'X' | 'Y' | 'Z';
  /** What the axis really controls — shown next to the letter. */
  label: string;
  /** One-line explanation for the legend. */
  hint: string;
}

/**
 * X is the rig MASTER BRIGHTNESS (operator request — `size`, the previous X,
 * had no legible effect on this rig and nobody could say what it did). It is
 * the one axis that does NOT ride the CPC: the master has no WS setter, so it
 * goes over REST at a slower gate, and it is floored at MIN_BRIGHTNESS.
 */
export const PAD_AXES: { x: PadAxis; y: PadAxis; z: PadAxis } = {
  x: {
    key: null,
    transport: 'master',
    axis: 'X',
    label: 'BRIGHT',
    hint: 'rig master brightness (never below 10%)',
  },
  y: { key: CPC.ROTATE, transport: 'cpc', axis: 'Y', label: 'ROTATE', hint: 'pattern orientation' },
  z: { key: CPC.SPEED, transport: 'cpc', axis: 'Z', label: 'SPEED', hint: 'motion rate through the model' },
};

/**
 * ── Brightness floor (TOUCH PANEL ONLY) ──────────────────────────────────
 * The rig must never go dark from this surface: the mission is "make the
 * Titanic visible at night", and a touch panel is the easiest place to drag a
 * master to zero by accident. Every master write from this tab is floored
 * here — the pad's X axis and the BRIGHTNESS fader both route through
 * `clampBrightness`, so there is no path around it.
 *
 * This is a TOUCH-CONTROL-only policy. The Deck and Mixer masters are
 * untouched and can still go to black (they own the blackout/e-stop story).
 */
export const MIN_BRIGHTNESS = 0.1;

/** Clamp a master level into [MIN_BRIGHTNESS, 1]. Throws on non-finite. */
export function clampBrightness(v: number): number {
  const c = clamp01(v);
  return c < MIN_BRIGHTNESS ? MIN_BRIGHTNESS : c;
}

/** Map a pad's unit X position onto the floored brightness range, so the far
 *  left of the pad is MIN_BRIGHTNESS rather than a dead zone. */
export function padXToBrightness(x: number): number {
  return MIN_BRIGHTNESS + clamp01(x) * (1 - MIN_BRIGHTNESS);
}

/** Inverse of padXToBrightness — where the crosshair sits for a level. */
export function brightnessToPadX(v: number): number {
  return clamp01((clampBrightness(v) - MIN_BRIGHTNESS) / (1 - MIN_BRIGHTNESS));
}

/**
 * Clamp into [0,1].
 *
 * Throws on a non-finite input rather than coercing to 0. A NaN reaching this
 * function means the caller did geometry on an unmeasured view — silently
 * sending 0 would black out / snap the rig and hide the bug. Callers must use
 * `positionToUnit`, which reports "not measured" as null instead.
 */
export function clamp01(n: number): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) {
    throw new Error(`touch_control: expected a finite number, got ${JSON.stringify(n)}`);
  }
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/**
 * Convert a touch position (px, from the pad's left/top edge) into a unit
 * [0,1] coordinate.
 *
 * Returns `null` when `size` is not a usable measurement (0 before the first
 * onLayout, or a non-finite value) — the caller must skip the write for that
 * gesture frame. This is the ONE place a "not ready" answer is legitimate;
 * everywhere downstream a number is required to be real.
 */
export function positionToUnit(pos: number, size: number): number | null {
  if (typeof size !== 'number' || !Number.isFinite(size) || size <= 0) return null;
  if (typeof pos !== 'number' || !Number.isFinite(pos)) return null;
  return clamp01(pos / size);
}

/** Inverse of positionToUnit — unit [0,1] to a pixel offset within `size`. */
export function unitToPosition(unit: number, size: number): number {
  return clamp01(unit) * (Number.isFinite(size) && size > 0 ? size : 0);
}

/**
 * Screen-Y runs DOWNWARD; every operator-facing vertical axis in this tab runs
 * UPWARD (up = more). Flip once, here, so no render file re-derives it.
 */
export function flipY(unit: number): number {
  return 1 - clamp01(unit);
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/**
 * HSV → RGB, all components in [0,1]. Standard sector decomposition; matches
 * the conversion `dimmer_rack.tsx` uses for its hue swatches so the two
 * surfaces render the same hue identically.
 */
export function hsvToRgb(h: number, s: number, v: number): Rgb {
  const hh = clamp01(h);
  const ss = clamp01(s);
  const vv = clamp01(v);
  const i = Math.floor(hh * 6);
  const f = hh * 6 - i;
  const p = vv * (1 - ss);
  const q = vv * (1 - f * ss);
  const t = vv * (1 - (1 - f) * ss);
  switch (i % 6) {
    case 0: return { r: vv, g: t, b: p };
    case 1: return { r: q, g: vv, b: p };
    case 2: return { r: p, g: vv, b: t };
    case 3: return { r: p, g: q, b: vv };
    case 4: return { r: t, g: p, b: vv };
    default: return { r: vv, g: p, b: q };
  }
}

/** HSV → a `rgb(r, g, b)` string for a React Native `backgroundColor`. */
export function hsvToCss(h: number, s: number, v: number): string {
  const { r, g, b } = hsvToRgb(h, s, v);
  return `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
}

/** Hue as whole degrees, for the readout. */
export function hueDegrees(h: number): number {
  return Math.round(clamp01(h) * 360);
}

/** Unit value as a whole percent, for the readouts. */
export function unitPercent(u: number): number {
  return Math.round(clamp01(u) * 100);
}

/**
 * Is a value a usable HSV triple from the engine?
 *
 * The engine stores `colorPalette1/2` as `{h,s,v}`. We never assume — a
 * malformed/absent slot must be visible as "no value" rather than silently
 * rendering as black (h=0,s=0,v=0 is a REAL color the operator may have set,
 * so it must not double as the missing sentinel).
 */
export function isHsv(value: unknown): value is { h: number; s: number; v: number } {
  if (!value || typeof value !== 'object') return false;
  const o = value as Record<string, unknown>;
  return ['h', 's', 'v'].every(
    (k) => typeof o[k] === 'number' && Number.isFinite(o[k] as number),
  );
}

/**
 * Read a finite number out of an engine-supplied value, or return null.
 * Used for `size`/`rotate`/`speed`/`bpmSpeedSync` reflection — an absent or
 * malformed slot reads as "unknown", never as a fabricated 0.
 */
export function asFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Rate gate for continuous (drag) writes.
 *
 * A touch drag fires at display rate (60–120 Hz). The engine broadcasts these
 * params at 30 Hz (`broadcastHz: 30` in the CPC schema) and the WS bus queues
 * only 64 messages while disconnected, so sending every frame is pure waste
 * and risks queue overflow on a flaky link. Gate outbound writes to the
 * engine's own broadcast rate; ALWAYS send the final value on release
 * (ungated) so the rig can never be left on a dropped intermediate value.
 *
 * `now` is injected so the gate is deterministically testable — the tab passes
 * nothing and gets `Date.now`.
 */
export interface SendGate {
  /** True if enough time has elapsed; records this send when it returns true. */
  allow: () => boolean;
  /** Forget the last send so the next `allow()` passes (use on drag start). */
  reset: () => void;
}

export function createSendGate(minIntervalMs: number, now: () => number = Date.now): SendGate {
  if (!Number.isFinite(minIntervalMs) || minIntervalMs < 0) {
    throw new Error(`touch_control: createSendGate needs a non-negative interval, got ${minIntervalMs}`);
  }
  let last = Number.NEGATIVE_INFINITY;
  return {
    allow() {
      const t = now();
      if (t - last >= minIntervalMs) {
        last = t;
        return true;
      }
      return false;
    },
    reset() {
      last = Number.NEGATIVE_INFINITY;
    },
  };
}

/** The engine's CPC broadcast rate — the natural ceiling for drag writes. */
export const CPC_SEND_INTERVAL_MS = 1000 / 30;

/**
 * Master brightness rides REST (`PATCH /mixer { master }`) — there is no WS
 * setter for it (verified against the engine's `/ws/control` inbound handler,
 * which accepts setChannelFader/setChannelControl/setSolo/bump/setSharedParam
 * and nothing master-related). HTTP per drag frame is far costlier than a WS
 * frame, so this gate is deliberately slower than the CPC one.
 */
export const MASTER_SEND_INTERVAL_MS = 1000 / 12;

/**
 * Build the `setSharedParam` WS envelope for a CPC write.
 *
 * Kept here (not inline in the render file) so the exact wire shape the engine
 * expects — verified at `lib/api_server.js` `d.type === 'setSharedParam'` →
 * `paramCenter.set(d.key, d.value, 'ws', d.origin)` — is asserted by a test.
 */
export function sharedParamMessage(key: string, value: unknown): {
  type: 'setSharedParam';
  key: string;
  value: unknown;
  origin: string;
} {
  if (typeof key !== 'string' || key.length === 0) {
    throw new Error('touch_control: sharedParamMessage needs a non-empty key');
  }
  return { type: 'setSharedParam', key, value, origin: TOUCH_CONTROL_ORIGIN };
}

/**
 * Is this an engine `paramRejected` reply?
 *
 * The engine answers a refused CPC write with
 * `{ type:'paramRejected', key, reason, lockedTo }` on the same socket. Codex
 * P0 forbids swallowing it — the tab surfaces it, because a silently-dropped
 * write means the operator is turning a knob that does nothing.
 */
export function isParamRejected(msg: unknown): msg is {
  type: 'paramRejected';
  key: string;
  reason?: string;
  lockedTo?: string;
} {
  return (
    !!msg &&
    typeof msg === 'object' &&
    (msg as { type?: unknown }).type === 'paramRejected' &&
    typeof (msg as { key?: unknown }).key === 'string'
  );
}

/** An HSV triple as the engine stores `colorPalette1` / `colorPalette2`. */
export interface Hsv {
  h: number;
  s: number;
  v: number;
}

/**
 * ── The 5-colour palette (TOUCH PANEL only) ──────────────────────────────
 *
 * The operator wants five colours to work with. The engine's Central Param
 * Center only has TWO colour parameters (`colorPalette1` / `colorPalette2`) —
 * verified against the live 73-entry schema, there is no colorPalette3..5. So
 * the five live here, in the tab:
 *
 *   • slots 1 and 2 are BACKED BY THE ENGINE — they write colorPalette1/2 and
 *     therefore colour the running patterns.
 *   • slots 3, 4 and 5 are TAB-LOCAL palette storage. They have no CPC home,
 *     so they colour the colour-capable EFFECTS (see COLOR_CAPABLE_EFFECTS)
 *     rather than the pattern.
 *
 * This split is stated plainly in the UI rather than hidden, because "why did
 * colour 4 not change the ship" would otherwise be a mystery.
 */
export const COLOR_SLOT_COUNT = 5;

/** A colour slot index, 1..5. */
export type ColorSlot = 1 | 2 | 3 | 4 | 5;

export const COLOR_SLOTS: ColorSlot[] = [1, 2, 3, 4, 5];

/** Slots that actually reach the engine's pattern palette. */
export const ENGINE_BACKED_SLOTS: ColorSlot[] = [1, 2];

/** Is this slot backed by a real CPC parameter? */
export function isEngineBackedSlot(slot: ColorSlot): boolean {
  return ENGINE_BACKED_SLOTS.includes(slot);
}

/**
 * Which palette slot(s) the colour pad is driving.
 * `'all'` is the MASTER choice — one drag paints every slot the same colour.
 */
export type ColorTarget = ColorSlot | 'all';

/** The CPC keys a given colour target writes. Slots 3-5 write none. */
export function colorKeysFor(target: ColorTarget): string[] {
  if (target === 1) return [CPC.COLOR_1];
  if (target === 2) return [CPC.COLOR_2];
  if (target === 'all') return [CPC.COLOR_1, CPC.COLOR_2];
  return []; // slots 3-5 have no CPC home
}

/** The slots a target writes. */
export function slotsFor(target: ColorTarget): ColorSlot[] {
  return target === 'all' ? [...COLOR_SLOTS] : [target];
}

/** Rotate a hue by `deg` degrees, wrapping the wheel. */
export function rotateHue(h: number, deg: number): number {
  const d = ((deg % 360) + 360) % 360;
  const next = (clamp01(h) + d / 360) % 1;
  return next < 0 ? next + 1 : next;
}

/**
 * THE ONE CONSTRAINT EVERY SCHEME HERE IS DESIGNED AROUND.
 *
 * Only a HUE reaches colour slots 3-5. The tab writes them with
 * `setDeckChannelControl(id, c.h)` — one number — and the patterns render them
 * with colour 1's saturation and value (`_hsv2rgb(hue3, cp1S, cp1V)` in
 * 66/67). So the usual way to make many colours agree — knock the supporting
 * ones back to tints or shades — is NOT AVAILABLE. Every scheme below has to
 * look good with all five at IDENTICAL saturation and value, using hue alone.
 *
 * That makes SEPARATION the thing that decides whether a set reads well. Two
 * fully-saturated LEDs less than about 30 deg apart do not read as two colours;
 * they read as one colour that someone got slightly wrong, and the pair muddies
 * where they meet. Hence the floor below, which every scheme is tested against.
 */
export const MIN_HUE_SEPARATION_DEG = 30;

/** Smallest gap, in degrees, between any two hues in a palette (0..180). */
export function minHueSeparationDeg(colors: Hsv[]): number {
  let min = 360;
  for (let i = 0; i < colors.length; i++) {
    for (let j = i + 1; j < colors.length; j++) {
      const raw = Math.abs(colors[i].h - colors[j].h) * 360;
      const d = Math.min(raw, 360 - raw);
      if (d < min) min = d;
    }
  }
  return min === 360 ? 0 : min;
}

/**
 * MONOCHROME palette (the HUE button) — ONE colour at five brightnesses.
 *
 * The operator's words: "hue is the same colour just different brightnesses".
 * So this holds hue AND saturation fixed and steps only the VALUE, giving one
 * colour read as a ladder from full to dim. It is the calmest thing the tab can
 * put on the ship: nothing can clash with itself.
 *
 * The steps are uneven on purpose (1.00 / 0.78 / 0.58 / 0.40 / 0.25 of the
 * chosen value). Perceived brightness is roughly the square of the linear
 * value, so evenly-spaced numbers look bunched at the top; widening the gaps as
 * they descend makes the ladder read as even. Nothing lands under
 * MIN_BRIGHTNESS, the tab's 10% floor.
 *
 * WHAT REACHES THE RIG: slots 1-2 are the engine's colour pickers and carry
 * full HSV, so their brightness reaches every pattern. Slots 3-5 reach patterns
 * through this tab's own hue AND value sliders (PATTERN_HUE_CONTROLS /
 * PATTERN_VAL_CONTROLS) — a pattern that declares only the hue sliders will
 * show slots 3-5 at colour 1's brightness, because a hue is all it can be told.
 */
const MONOCHROME_VALUE_STEPS = [1.0, 0.78, 0.58, 0.4, 0.25];

export function monochromePalette(base: Hsv): Hsv[] {
  return MONOCHROME_VALUE_STEPS.map((step) => ({
    h: clamp01(base.h),
    s: clamp01(base.s),
    v: clampBrightness(clamp01(base.v) * step),
  }));
}

/**
 * COMPLEMENT — five colours that GO TOGETHER (the operator's definition).
 *
 * This is an ANALOGOUS scheme: five hues stepping 30 deg apart across a 120 deg
 * arc centred on the operator's colour. Analogous is the most reliably pleasing
 * arrangement in colour theory, because every hue shares a neighbourhood of the
 * wheel — nothing in the set can fight anything else in it.
 *
 * WHAT WAS WRONG BEFORE: the offsets were [0, 180, -20, 200, 20] — an opposition
 * scheme, and a poorly spaced one. Three hues sat within 40 deg of each other
 * and two more within 20 deg, so the minimum separation was 20 deg, under the
 * floor above. At the identical saturation and value these slots are forced to
 * share, that read as two colours plus three near-misses that muddied where they
 * met. It was also the wrong IDEA: 180 deg opposition is what CONTRAST is for.
 *
 * 30 deg steps are chosen deliberately: wide enough to clear the separation
 * floor (each slot is unmistakably its own colour), narrow enough that the five
 * still read as one family rather than a spread.
 *
 * ORDER: slot 1 keeps the operator's colour untouched — they picked it, the
 * button builds around it rather than replacing it. Slot 2 takes the far edge
 * (+60) so the two ENGINE-BACKED slots, the only ones every stock two-colour
 * pattern sees, are 60 deg apart and give those patterns a real spread.
 */
const COMPLEMENT_OFFSETS_DEG = [0, 60, 30, -30, -60];

export function complementaryPalette(base: Hsv): Hsv[] {
  return COMPLEMENT_OFFSETS_DEG.map((deg) => ({
    h: rotateHue(base.h, deg),
    s: clamp01(base.s),
    v: clamp01(base.v),
  }));
}

/**
 * CONTRAST — five colours that CLASH (the operator's definition), on purpose.
 *
 * Five hues spread EVENLY around the wheel, 72° apart from the base. Even
 * spacing is the maximally-distinct arrangement for a fixed count: the set
 * reaches into every region of the wheel at once, which is exactly the loud,
 * fighting look this button is for. It is the opposite end of the tab's range
 * from COMPLEMENT (one harmonious family) and HUE (one colour, five
 * brightnesses) — three deliberate points, calm to loud.
 */
export function contrastingPalette(base: Hsv): Hsv[] {
  return COLOR_SLOTS.map((_, i) => ({
    h: rotateHue(base.h, (360 / COLOR_SLOT_COUNT) * i),
    s: clamp01(base.s),
    v: clamp01(base.v),
  }));
}

/** All five slots set to the same colour (the MASTER choice). */
export function uniformPalette(base: Hsv): Hsv[] {
  return COLOR_SLOTS.map(() => ({ h: clamp01(base.h), s: clamp01(base.s), v: clamp01(base.v) }));
}

/**
 * HSV → the engine's RGBWAU `color6` array used by effect params.
 *
 * W / A / UV are held at 0 deliberately: those channels carry the
 * mission-critical exterior whites, and every other colour op in this engine
 * (hue shift, invert) leaves them alone. `validateColor6` requires six finite
 * entries in [0,1].
 */
export function hsvToColor6(c: Hsv): number[] {
  const { r, g, b } = hsvToRgb(c.h, c.s, c.v);
  return [r, g, b, 0, 0, 0];
}

/**
 * ── PAINT SHIP — the five colours, live, on the actual ship ──────────────
 *
 * The patterns can only ever show TWO colours (the CPC has colorPalette1/2 and
 * nothing else), so seeing all five at once needs a different mechanism:
 * per-group fixed colours (docs/32, `PUT /group-fixed-colors/:group`).
 *
 * WHAT IT COSTS — state this plainly wherever it is offered. The engine
 * applies group colours as a FLAT overwrite:
 *     px.r = c[0] * b;  px.g = c[1] * b;  …
 * (effects/group_fixed_color.js). The pattern's contribution to those pixels
 * is DISCARDED — painted groups go static: one solid colour, no animation.
 * They are applied AFTER applyMacros, so they also paint over the tracer band
 * on those groups. Section dimmers / master / blackout still scale them.
 *
 * So the map below deliberately paints five ZONES and leaves the rails and
 * corner groups untouched, so the patterns and the tracers keep animating over
 * the majority of the rig. Each zone is symmetric (port + starboard) so the
 * result reads as an intentional scheme rather than random patches.
 *
 * Every group name below was taken from the LIVE model's
 * `GET /group-fixed-colors.groups` (24 groups) — not guessed.
 */
export interface PaintZone {
  slot: ColorSlot;
  label: string;
  groups: string[];
}

export const PAINT_ZONES: PaintZone[] = [
  { slot: 1, label: 'BOW', groups: ['Left Front Wall', 'Right Front Wall'] },
  { slot: 2, label: 'STERN', groups: ['Left Back Wall', 'Right Back Wall'] },
  {
    slot: 3,
    label: 'STACKS',
    groups: ['Left SmokeStack', 'Right SmokeStacks', 'Left Small SmokeStack', 'Right Small SmokeStack'],
  },
  { slot: 4, label: 'DECKS', groups: ['Left Auditorium', 'Right Auditorium'] },
  { slot: 5, label: 'SIGN', groups: ['TE Sign', 'TE Sign 2'] },
];

/** Every group this feature ever touches — the exact set to clear on release. */
export function allPaintedGroups(): string[] {
  return PAINT_ZONES.flatMap((z) => z.groups);
}

/** The zone a colour slot paints, or null if that slot paints nothing. */
export function paintZoneFor(slot: ColorSlot): PaintZone | null {
  return PAINT_ZONES.find((z) => z.slot === slot) || null;
}

/**
 * Split a colour into the engine's (color6, brightness) pair.
 * The RGBWAU array carries the HUE at full value and `brightness` carries V —
 * the same split `dimmer_rack.tsx` uses, so both surfaces agree on what a
 * given colour means.
 */
export function paintPayload(c: Hsv): { color: number[]; brightness: number } {
  return { color: hsvToColor6({ h: c.h, s: c.s, v: 1 }), brightness: clamp01(c.v) };
}

/**
 * ── CYCLE — put all five colours through the PATTERNS ────────────────────
 *
 * The patterns can only ever hold TWO colours, and not because of a UI limit:
 * each pattern DECLARES its own palette hooks in its own source, e.g.
 *   export function colorPalette1(h,s,v) { cp1H = h; … }
 *   export function colorPalette2(h,s,v) { cp2H = h; … }
 * 60 of the 68 shipped patterns do this. Giving the patterns five colours
 * would mean three new CPC params AND rewriting the colour maths in all 60 —
 * an engine + content change, not a touch-panel one.
 *
 * CYCLE is the touch-panel answer: step the TWO palette slots through the five
 * colours over time. Every colour gets used, the patterns keep animating
 * normally, and nothing outside this tab changes. The engine's own
 * `colorTransitionMs` slew does the crossfade between steps, so a long COLOR
 * FADE gives a slow wash and a short one gives hard changes.
 */

/** Never step faster than this, however short the fade is set. */
export const CYCLE_MIN_STEP_MS = 1500;

/** Headroom past the fade so a crossfade always completes before the next step. */
export const CYCLE_FADE_HEADROOM_MS = 500;

/**
 * How long to hold each pair. Derived from the operator's COLOR FADE so the
 * cycle never re-targets a ramp that is still running (which is exactly the
 * "scrubs through the rainbow" failure the colour pad already had to fix).
 */
export function cycleStepMs(fadeMs: number | null): number {
  const fade = asFiniteNumber(fadeMs) ?? 0;
  return Math.max(CYCLE_MIN_STEP_MS, fade + CYCLE_FADE_HEADROOM_MS);
}

/**
 * The palette pair for step `index`: consecutive colours around the ring, so
 * across five steps every colour appears in BOTH slots and every adjacent pair
 * is shown. Skips empty slots so an unset colour never blanks the rig.
 *
 * NOTE: retained for the pattern-palette walk, but CYCLE no longer drives the
 * patterns — see rotatedColorFor below for what the operator actually asked
 * for.
 */
export function cyclePairAt(
  colors: (Hsv | null)[],
  index: number,
): { c1: Hsv; c2: Hsv } | null {
  const usable = colors.filter((c): c is Hsv => !!c);
  if (usable.length === 0) return null;
  if (usable.length === 1) return { c1: usable[0], c2: usable[0] };
  const i = ((index % usable.length) + usable.length) % usable.length;
  return { c1: usable[i], c2: usable[(i + 1) % usable.length] };
}

/**
 * ── ONLY the chosen colours, ever ────────────────────────────────────────
 *
 * OPERATOR (emphatic): "cycling should cycle through the colours I choose on
 * contrast or complement, or that I manually choose — ONLY."
 *
 * Writing a PAIR of different colours to colorPalette1/2 cannot satisfy that:
 * patterns INTERPOLATE between the two slots across the model, so a pair of
 * 116° and 188° paints every hue in between onto the ship. The operator sees
 * colours they never picked, continuously.
 *
 * So CYCLE writes the SAME colour to BOTH slots each step. The interpolation
 * collapses to a single flat colour and the rig can only ever show a colour
 * from the chosen set. Stepping then walks the set one colour at a time.
 */
export function cycleSoloAt(colors: (Hsv | null)[], step: number): Hsv | null {
  const usable = colors.filter((c): c is Hsv => !!c);
  if (usable.length === 0) return null;
  const i = ((step % usable.length) + usable.length) % usable.length;
  return usable[i];
}

/**
 * ── What CYCLE actually does (operator spec) ─────────────────────────────
 *
 * "cycle through the colours chosen, not continuously change the colours…
 *  each colour faded into 1-5 so all the colours get used, and INDIVIDUAL
 *  LIGHTS to have different colours, not all at once."
 *
 * So the rig must show SEVERAL colours SIMULTANEOUSLY on different fixtures,
 * with the assignment ROTATING so every colour visits every area. That is the
 * five PAINT ZONES rotating — not the two pattern-palette slots being
 * rewritten, which would change the whole ship together (exactly the
 * "continuously change" behaviour being rejected).
 *
 * Step N: zone Z shows colour (Z + N) mod 5. Every zone always holds a
 * DIFFERENT colour, and after five steps each colour has visited each zone.
 * The engine's `colorTransitionMs` is NOT involved here (group colours are set
 * directly), so the step interval is the whole story for how fast it moves.
 */
export function rotatedColorFor(
  colors: (Hsv | null)[],
  zoneIndex: number,
  step: number,
): Hsv | null {
  const n = colors.length;
  if (n === 0) return null;
  const i = (((zoneIndex + step) % n) + n) % n;
  return colors[i] ?? null;
}

/**
 * The full zone→colour assignment for a step, in zone order.
 * Distinct by construction: a rotation is a bijection, so no two zones can
 * ever be handed the same slot.
 */
export function rotationAt(colors: (Hsv | null)[], step: number): (Hsv | null)[] {
  return colors.map((_, z) => rotatedColorFor(colors, z, step));
}

/**
 * ── Driving a PATTERN's own extra colours ────────────────────────────────
 *
 * The CPC has only two colour params, so a pattern that wants five must carry
 * the other three as LOCAL controls (`slider*`, docs §3.2). `66_five_colour_prism`
 * does exactly that. Those are written per-channel by NUMERIC export id via
 * `POST /deck/channel/control` — the id is a hash of the export name, so it is
 * resolved by NAME from the deck channel's `exports` list at call time, never
 * hard-coded.
 *
 * Slots 1-2 stay on the CPC pickers (so every other surface still drives them);
 * slots 3-5 map onto these sliders.
 */
export const PATTERN_HUE_CONTROLS: Record<number, string> = {
  3: 'sliderHue3',
  4: 'sliderHue4',
  5: 'sliderHue5',
};

/**
 * The BRIGHTNESS half of the same idea.
 *
 * Slots 1-2 are the engine's colour pickers and carry full HSV, so their
 * brightness always reaches a pattern. Slots 3-5 used to carry a HUE ONLY, and
 * patterns rendered them at colour 1's value — which made the HUE button (one
 * colour, five brightnesses) a no-op on three of its five slots.
 *
 * A pattern that declares `sliderVal3/4/5` alongside the hue sliders gets the
 * per-slot brightness too. Declaring them is OPTIONAL and additive: a pattern
 * with only the hue sliders is written exactly as before and simply keeps
 * showing slots 3-5 at colour 1's brightness. Nothing is faked either way —
 * the tab writes what the running pattern actually exposes.
 */
export const PATTERN_VAL_CONTROLS: Record<number, string> = {
  3: 'sliderVal3',
  4: 'sliderVal4',
  5: 'sliderVal5',
};

/** The pattern-slider name carrying a palette slot's BRIGHTNESS, or null. */
export function patternValControlFor(slot: ColorSlot): string | null {
  return PATTERN_VAL_CONTROLS[slot] ?? null;
}

/** Minimal shape of a channel export. */
export interface ChannelExportLike {
  id: number;
  name?: string;
}

/**
 * Resolve a control's numeric id by export NAME.
 *
 * Returns null when the running pattern does not expose it — which is the
 * normal case for the other 68 patterns. The caller must then write nothing
 * rather than guess an id: a wrong id would land on a DIFFERENT slider and
 * change something the operator never touched.
 */
export function findExportId(
  exports: ChannelExportLike[] | undefined | null,
  name: string,
): number | null {
  if (!Array.isArray(exports)) return null;
  const hit = exports.find((e) => e && e.name === name && typeof e.id === 'number');
  return hit ? hit.id : null;
}

/** The pattern-slider name for a palette slot, or null if that slot has none. */
export function patternHueControlFor(slot: ColorSlot): string | null {
  return PATTERN_HUE_CONTROLS[slot] ?? null;
}

/** Effects in this tab that accept a `color` param (engine validateParams:
 *  dropHit / colorWash / waterlineSweep / kickPunch all call validateColor6;
 *  strobe and sparkle have NO colour and are deliberately absent). */
export const COLOR_CAPABLE_EFFECTS = ['waterlineSweep', 'colorWash', 'dropHit', 'kickPunch'];

/** Can this effect be tinted at all? */
export function effectTakesColor(effectId: string): boolean {
  return COLOR_CAPABLE_EFFECTS.includes(effectId);
}

/**
 * ── BPM → SPEED sync ─────────────────────────────────────────────────────
 * `bpmSpeedSync` is registered in the CPC as a FLOAT (range [0,1]), but the
 * engine reads it as a boolean at a 0.5 threshold:
 *   lib/bpm_speed_sync.js → `const enabled = (this._numOf(params.bpmSpeedSync) ?? 0) >= 0.5;`
 * While enabled the engine writes `speed` itself (source 'bpm-sync'), which
 * overwrites any manual Z move. Turning it OFF hands SPEED back to the
 * operator. These constants keep the client's notion of on/off identical to
 * the engine's rather than re-deriving a threshold at each call site.
 */
export const BPM_SYNC_THRESHOLD = 0.5;
export const BPM_SYNC_ON = 1;
export const BPM_SYNC_OFF = 0;

/** Is the engine's BPM→speed sync currently driving `speed`? */
export function isBpmSyncOn(value: unknown): boolean {
  const n = asFiniteNumber(value);
  return n !== null && n >= BPM_SYNC_THRESHOLD;
}

/**
 * ── Optimistic-override convergence ──────────────────────────────────────
 *
 * docs/39 §4.2 allows optimistic local state for fader/param moves, with the
 * WS broadcast reconciling the canonical value. The subtlety is WHEN to hand
 * authority back. Dropping the override the instant the finger lifts makes the
 * control snap to the STALE engine value for the ~1-2 frames before the echo
 * arrives — a visible bounce on a live lighting surface.
 *
 * So the override is held until the engine actually reports the value we sent
 * (converged), with a watchdog as the backstop for the case where the echo
 * never arrives (dropped socket, refused write). This mirrors the deck's
 * pending-gate + watchdog pattern for entry loads, at param scale.
 */

/** Engine echo tolerance. CPC floats round-trip through clamping and YAML, so
 *  an exact === would never converge; 0.005 is far below one pixel of travel
 *  on any pad or fader in this tab. */
export const CONVERGE_EPSILON = 0.005;

/** Backstop if the engine never echoes (dropped socket / refused write). The
 *  deck uses ~8 s for a multi-second crossfade; a CPC param echoes at 30 Hz,
 *  so 2 s is already generous. */
export const OVERRIDE_WATCHDOG_MS = 2000;

/** Has the engine caught up with a numeric value we sent? */
export function numbersConverged(
  engine: number | null,
  sent: number | null,
  epsilon: number = CONVERGE_EPSILON,
): boolean {
  if (engine === null || sent === null) return false;
  if (!Number.isFinite(engine) || !Number.isFinite(sent)) return false;
  return Math.abs(engine - sent) <= epsilon;
}

/** Has the engine caught up with an HSV value we sent? */
export function hsvConverged(
  engine: Hsv | null,
  sent: Hsv | null,
  epsilon: number = CONVERGE_EPSILON,
): boolean {
  if (!engine || !sent) return false;
  return (
    numbersConverged(engine.h, sent.h, epsilon) &&
    numbersConverged(engine.s, sent.s, epsilon) &&
    numbersConverged(engine.v, sent.v, epsilon)
  );
}

/**
 * ── Global effects (strobe / random / tracers) ───────────────────────────
 *
 * Library effects (strobe, feedbackTrails, sparkle …) are NOT reachable
 * through the legacy `POST /global-effect` route — that one only accepts the
 * four legacy toggles (`global_effects_controller.setEffect` THROWS on an
 * unknown id). Modern effects are driven through GEM slots:
 *   toggle  → POST /global-effect-slots/:slotId/toggle
 *   config  → PATCH /global-effect-slots/:slotId  (create-on-patch, id 1..32)
 * Live state arrives on the `globalEffectSlots` broadcast (/ws/control) and
 * from GET /global-effect-slots/status, where each slot carries `active`.
 *
 * SHARED-STATE WARNING (deliberate, operator-approved): the slot table is
 * shared with the Deck/Mixer effects grid and the VSN1 hardware. Those
 * surfaces render only the FIRST 8 slots (`VISIBLE_SLOT_COUNT = 8` in
 * components/global_effect_macros_logic.ts; the engine pages at
 * SLOTS_PER_PAGE = 8). So this tab NEVER writes slots 1-8: it reuses a slot
 * that already binds the effect it wants, and only provisions into the
 * invisible range (>= 9) when the effect is bound nowhere. That keeps the
 * Deck / Mixer / VSN1 surfaces byte-identical.
 */

/** First slot id this tab may provision into — past the 8 visible on the
 *  Deck/Mixer grid and VSN1 page 0, so we can never displace a bound effect
 *  the operator can see elsewhere. */
export const PROVISION_MIN_SLOT_ID = 9;

/** Engine hard cap (global_effect_slot_manager.js MAX_SLOTS). */
export const MAX_SLOT_ID = 32;

export interface EffectSpec {
  /** Stable key for the button. */
  key: string;
  /** Button face. */
  label: string;
  /** Engine library effect id. */
  effectId: string;
  /** Engine preset id within that effect. */
  presetId: string;
  /** Grouping for the button row. */
  group: 'gate' | 'overlay' | 'tracer';
  /**
   * Slot `paramsOverride`, merged OVER the preset's params by the engine
   * (`resolveSlotBinding`: `{ ...preset.params, ...sanitized }`). Two specs
   * sharing an effectId+presetId are distinguished by this, so the slot
   * lookup keys on it too.
   */
  params?: Record<string, unknown>;
}

/**
 * ── TRACERS — a real travelling line, not an afterimage ──────────────────
 *
 * The first cut mapped "tracers" to `feedbackTrails`, which is a FEEDBACK /
 * ghost-trail effect: it smears whatever is already on the rig. The operator
 * wants something different — a line of light that starts at one end, runs
 * down the fixtures, and loops forever.
 *
 * That is `waterlineSweep` (effects/e2_waterline_sweep.js): "a soft-edged
 * band of light rolls across the rig using the pixels' own normalized
 * coordinates (nx/ny/nz) versus a moving head position". The head free-runs
 * and WRAPS — `_sweepHead = (_sweepHead + dt * speedHz) % 1` in
 * global_effects_controller.js — so it keeps going in circles by construction.
 *
 * The three tracer buttons are the three travel directions ("tracer pattern
 * types"). None of the shipped presets is an ADDITIVE band on the long axis
 * (`shadow_pass` is axis x but mode `darken` — a moving shadow), so each spec
 * carries a paramsOverride. Every value below is inside the engine's own
 * validator ranges (global_effect_library.validateParams → waterlineSweep:
 * axis x|y|z|radial, width (0..1], amount clamped, mode add|darken, color6,
 * speedHz >= 0, sync free|beat|bar).
 */
const TRACER_BASE = {
  mode: 'add',
  amount: 1,
  width: 0.12,
  speedHz: 0.3,
  sync: 'free',
  // RGBWAU. W/A/UV left at 0 so a tracer never fires the mission-critical
  // white channels — same restraint the hue/invert effects observe.
  color: [1, 1, 1, 0, 0, 0],
} as const;

/**
 * ── Why each tracer uses a DIFFERENT presetId ────────────────────────────
 *
 * OPERATOR BUG: "when I use the tracer buttons they all get pushed at once."
 *
 * The engine decides whether a slot is lit by effect + PRESET, and nothing
 * else (global_effect_slot_manager.js):
 *
 *     case 'waterlineSweep':
 *       return !!c.sweep.enabled && c.sweep.presetId === slot.presetId;
 *
 * The first cut gave all three tracers `rising_tide` and separated them only
 * by `paramsOverride.axis` — which that check never looks at — so enabling any
 * one made ALL THREE report active and every button lit together.
 *
 * Fix: one distinct preset per tracer. waterlineSweep ships exactly three, so
 * each button now owns one and the engine's own preset guard keeps them
 * apart. The paramsOverride still forces the axis and an ADDITIVE band
 * (`shadow_pass` defaults to `darken`, a moving shadow — overridden here).
 *
 * Because the presetId now identifies the slot, `speedHz` is free to change at
 * runtime (see padZToSweepHz) without breaking slot lookup.
 */

/** Z axis → sweep travel rate, in sweeps per second.
 *  Bottom of the range still crawls rather than freezing, so the band never
 *  looks stuck; the top is fast without strobing. */
export const SWEEP_HZ_MIN = 0.05;
export const SWEEP_HZ_MAX = 1.5;

export function padZToSweepHz(z: number): number {
  return SWEEP_HZ_MIN + clamp01(z) * (SWEEP_HZ_MAX - SWEEP_HZ_MIN);
}

/**
 * The effects this tab exposes. Every effectId+presetId below was verified
 * present in the LIVE engine's /global-effect-library.
 */
export const TOUCH_EFFECTS: EffectSpec[] = [
  { key: 'strobe', label: 'STROBE', effectId: 'strobe', presetId: 'sync_4hz', group: 'gate' },
  // "Random" → Frost Sparkle, the library's stochastic glint overlay.
  // `blizzard` is the most visibly random preset (density 0.15, decay 80 ms);
  // `hihat` is audio-reactive and would sit dead whenever the mic is down.
  { key: 'random', label: 'RANDOM', effectId: 'sparkle', presetId: 'blizzard', group: 'overlay' },
  // Tracer travel directions. `rising_tide` is the base preset for all three
  // (it is the additive one); the override aims and times the band.
  // One preset each — see the note above. Same effect, three directions,
  // three presets, so the engine's preset guard lights only the tapped one.
  {
    key: 'trace_along',
    label: 'ALONG',
    effectId: 'waterlineSweep',
    presetId: 'rising_tide',
    group: 'tracer',
    params: { ...TRACER_BASE, axis: 'x' },
  },
  {
    key: 'trace_rise',
    label: 'RISE',
    effectId: 'waterlineSweep',
    presetId: 'beat_wipe',
    group: 'tracer',
    params: { ...TRACER_BASE, axis: 'y' },
  },
  {
    key: 'trace_ring',
    label: 'RING',
    effectId: 'waterlineSweep',
    presetId: 'shadow_pass',
    group: 'tracer',
    params: { ...TRACER_BASE, axis: 'radial' },
  },
];

/** The tracer specs, in button order. */
export const TRACER_SPECS = TOUCH_EFFECTS.filter((e) => e.group === 'tracer');

/** The tracer whose slot is currently lit, or null. Used to aim a Z (speed)
 *  change at the band the operator can actually see moving. */
export function activeTracer(slots: EffectSlotLike[]): { spec: EffectSpec; slot: EffectSlotLike } | null {
  for (const spec of TRACER_SPECS) {
    const slot = findSlotFor(slots, spec.effectId, spec.presetId);
    if (slot && slot.active === true) return { spec, slot };
  }
  return null;
}

/** Minimal shape this tab needs from a slot status entry. */
export interface EffectSlotLike {
  slotId: number;
  effectId?: string | null;
  presetId?: string | null;
  enabled?: boolean;
  active?: boolean;
  label?: string;
  paramsOverride?: Record<string, unknown> | null;
}

/**
 * Shallow "does the slot carry the params this spec needs" check.
 *
 * Only the keys the SPEC names are compared — a slot may legitimately carry
 * extra fields (the engine's validator can add or clamp). Arrays compare
 * element-wise so a color6 override matches. Undefined spec params match
 * anything, so effects without overrides behave exactly as before.
 */
export function paramsMatch(
  slotOverride: Record<string, unknown> | undefined | null,
  specParams: Record<string, unknown> | undefined,
): boolean {
  if (!specParams) return true;
  const have = slotOverride || {};
  for (const k of Object.keys(specParams)) {
    const want = specParams[k];
    const got = (have as Record<string, unknown>)[k];
    if (Array.isArray(want)) {
      if (!Array.isArray(got) || got.length !== want.length) return false;
      for (let i = 0; i < want.length; i++) {
        if (got[i] !== want[i]) return false;
      }
    } else if (got !== want) {
      return false;
    }
  }
  return true;
}

/**
 * Find a slot already bound to this spec's effect + preset + params.
 *
 * The params comparison matters: the three tracer buttons all bind
 * `waterlineSweep/rising_tide` and differ ONLY by their `axis` override, so
 * keying on effect+preset alone would collapse them onto one slot and the
 * three buttons would fight over it.
 *
 * Returns null when nothing matches — the caller must then provision.
 * Prefers the LOWEST slotId so repeated lookups are stable.
 */
export function findSlotFor(
  slots: EffectSlotLike[],
  effectId: string,
  presetId: string,
  specParams?: Record<string, unknown>,
): EffectSlotLike | null {
  if (!Array.isArray(slots)) return null;
  const matches = slots.filter(
    (s) =>
      s &&
      s.effectId === effectId &&
      s.presetId === presetId &&
      paramsMatch(s.paramsOverride, specParams),
  );
  if (matches.length === 0) return null;
  return matches.reduce((lo, s) => (s.slotId < lo.slotId ? s : lo));
}

/**
 * Lowest unused slot id at or above `PROVISION_MIN_SLOT_ID`.
 * Returns null when the table is full — the caller must fail loudly rather
 * than stomping an occupied slot.
 */
export function firstFreeSlotId(
  slots: EffectSlotLike[],
  minId: number = PROVISION_MIN_SLOT_ID,
  maxId: number = MAX_SLOT_ID,
): number | null {
  const taken = new Set((Array.isArray(slots) ? slots : []).map((s) => s && s.slotId));
  for (let id = minId; id <= maxId; id++) {
    if (!taken.has(id)) return id;
  }
  return null;
}

/** Is the slot bound to this spec currently firing? */
export function isEffectActive(
  slots: EffectSlotLike[],
  effectId: string,
  presetId: string,
  specParams?: Record<string, unknown>,
): boolean {
  const slot = findSlotFor(slots, effectId, presetId, specParams);
  return !!slot && slot.active === true;
}

/** Human-readable text for a rejected CPC write. */
export function describeRejection(reason?: string, lockedTo?: string): string {
  if (reason === 'source_locked') {
    return `The engine's parameter center is locked to "${lockedTo ?? 'another source'}", so this control is read-only right now.`;
  }
  if (reason === 'unknown_key') {
    return 'The engine does not know this parameter. It may be running an older build than this tab expects.';
  }
  return reason ? `The engine refused the write (${reason}).` : 'The engine refused the write.';
}
