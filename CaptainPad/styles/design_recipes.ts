// design_recipes — the PURE half of the CaptainPad design system.
//
// docs/54 §1.1 puts the component recipes in `styles/globalStyles.ts`. Most of
// them are StyleSheet entries and live there. The ones in this file are the
// pure FUNCTIONS behind those entries — `accentWash`, `glowFor`, the colour
// maths — and they sit in their own module for one reason: `globalStyles.ts`
// imports `react` and `react-native`, and the CaptainPad vitest suite runs in
// plain node with no RN stubs. A contrast table that cannot be executed is a
// comment, not a test. Everything here is importable from a node test, and
// `globalStyles.ts` re-exports what components already imported from it, so
// no call site changes.
//
// Nothing in this module reads the palette on its own — every function takes
// the colours it needs. That keeps it theme-agnostic and lets the tests drive
// all five palettes through the same code the app runs.

import { contrastRatio, readableInk, relativeLuminance } from '../components/param_row_layout';

// ── shadows ─────────────────────────────────────────────────────────
//
// shadow* style props are deprecated (react-native-web warns on every
// render; RN's new architecture prefers `boxShadow`). One string replaces
// the four shadow* props, with the opacity baked into an 8-digit hex color.
// `elevation` is untouched where present — it is the Android-native shadow,
// unrelated to this deprecation.
//
// Moved here verbatim from `globalStyles.ts` (which re-exports it) so the
// glow recipe below can be built and tested without pulling in React Native.

export function shadow(x: number, y: number, blur: number, hexColor: string, opacity: number): string {
  let hex = hexColor;
  if (/^#[0-9a-fA-F]{3}$/.test(hex)) {
    hex = '#' + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3];
  }
  const a = Math.round(Math.max(0, Math.min(1, opacity)) * 255)
    .toString(16).padStart(2, '0');
  return `${x}px ${y}px ${blur}px ${hex}${a}`;
}

// ── colour maths ────────────────────────────────────────────────────
//
// The WCAG primitives (`relativeLuminance`, `contrastRatio`, `readableInk`)
// already exist in `components/param_row_layout.ts` — the _190 chip system
// owns them and they are tested there. This module imports them rather than
// growing a second copy; the two would drift the first time someone touched
// one. Re-exported so a caller needs exactly one design import.

export { contrastRatio, readableInk, relativeLuminance };

/** An 8-digit-hex alpha suffix for `#rrggbb` colours, e.g. 0.14 → '24'.
 *  React Native accepts `#rrggbbaa`; the _190 chips already paint this way. */
export function alphaSuffix(alpha: number): string {
  if (!(alpha >= 0 && alpha <= 1)) throw new Error(`alphaSuffix: alpha must be 0..1, got ${alpha}`);
  return Math.round(alpha * 255).toString(16).padStart(2, '0');
}

/** `#rrggbb` + alpha → `#rrggbbaa`. Rejects anything that is not a plain
 *  6-digit hex: an accent that already carries alpha, or an `rgba()` string,
 *  is a bug at the call site, not something to paper over. */
export function withAlpha(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`withAlpha: expected #rrggbb, got '${hex}'`);
  return `#${m[1]}${alphaSuffix(alpha)}`;
}

interface Rgba { r: number; g: number; b: number; a: number }

function parseColor(color: string): Rgba {
  const c = color.trim();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(c);
  if (short) {
    return {
      r: parseInt(short[1] + short[1], 16),
      g: parseInt(short[2] + short[2], 16),
      b: parseInt(short[3] + short[3], 16),
      a: 1,
    };
  }
  const long = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(c);
  if (long) {
    const n = parseInt(long[1], 16);
    return {
      r: (n >> 16) & 0xff,
      g: (n >> 8) & 0xff,
      b: n & 0xff,
      a: long[2] === undefined ? 1 : parseInt(long[2], 16) / 255,
    };
  }
  const fn = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(c);
  if (fn) {
    return {
      r: Number(fn[1]),
      g: Number(fn[2]),
      b: Number(fn[3]),
      a: fn[4] === undefined ? 1 : Number(fn[4]),
    };
  }
  throw new Error(`parseColor: unsupported colour '${color}'`);
}

const clampByte = (n: number): number => Math.max(0, Math.min(255, Math.round(n)));
const byteHex = (n: number): string => clampByte(n).toString(16).padStart(2, '0');

/**
 * Composite a (possibly translucent) colour over an OPAQUE backdrop and
 * return the flat `#rrggbb` a viewer actually sees.
 *
 * This is what makes the token contrast tests honest: `warningContainer` is
 * an `rgba()` wash, so "does warning text read on it" is a question about the
 * COMPOSITE, and the composite depends on which surface the chip sits on.
 */
export function flattenOver(color: string, backdrop: string): string {
  const f = parseColor(color);
  const b = parseColor(backdrop);
  if (b.a !== 1) throw new Error(`flattenOver: backdrop must be opaque, got '${backdrop}'`);
  return '#'
    + byteHex(f.r * f.a + b.r * (1 - f.a))
    + byteHex(f.g * f.a + b.g * (1 - f.a))
    + byteHex(f.b * f.a + b.b * (1 - f.a));
}

/** True when `surface` is a light ground (used to decide whether the panel
 *  recipe's inset top highlight applies — a white inset line is invisible on
 *  a light base, so light bases get none). */
export function isLightSurface(surface: string): boolean {
  return relativeLuminance(flattenOver(surface, '#ffffff')) > 0.5;
}

// ── the state tint ──────────────────────────────────────────────────
//
// docs/54 §1: an "on" control is a translucent accent wash + accent border +
// accent text — never a flat opaque repaint. This is THE way an on-state
// paints, on every surface, so that a toggle, a selected playlist row, a
// synced BPM pill and an armed effect all read as the same idea.
//
// The alphas are the _190 quiet-chip relationship, one step louder: 14 % fill
// (vs the chip's 8 %) and 45 % border (vs 40 %) — a control is a bigger,
// bolder thing than a reference chip.

export const WASH_FILL_ALPHA = 0.14;
export const WASH_BORDER_ALPHA = 0.45;

export interface AccentWash {
  backgroundColor: string;
  borderColor: string;
  color: string;
}

/**
 * The translucent on-state: accent at 14 %, accent border at 45 %, accent
 * text.
 *
 * The accent keeps its own colour as ink, so the pairing's contrast is
 * whatever the accent has against the surface underneath (the wash barely
 * moves it). Colour is therefore never the only carrier — every control that
 * wears this also states its state in TEXT, exactly as the _190 chips do.
 * When you need a LOUD state instead, use `accentFill`, which derives ink.
 */
export function accentWash(accent: string): AccentWash {
  return {
    backgroundColor: withAlpha(accent, WASH_FILL_ALPHA),
    borderColor: withAlpha(accent, WASH_BORDER_ALPHA),
    color: accent,
  };
}

/**
 * The loud on-state: solid accent fill with `readableInk()` ink.
 *
 * This is the guarded variant — the ink is DERIVED from the fill, so a fixed
 * identity hex (an audio band, PANIC amber) can fill a control on any theme
 * and still clear WCAG AA.
 */
export function accentFill(accent: string): AccentWash {
  return { backgroundColor: accent, borderColor: accent, color: readableInk(accent) };
}

// ── glow ────────────────────────────────────────────────────────────
//
// docs/54 §1: the glow budget is ARMED / LIVE / SELECTED only — never
// resting chrome. A rig where everything glows tells the operator nothing at
// 3 a.m.; the one glowing thing on screen is the thing that is about to
// change the lights.

export const GLOW_BLUR = 18;
export const GLOW_ALPHA = 0.3;

/** The single sanctioned glow: a soft accent halo, no offset. */
export function glowFor(accent: string): string {
  return shadow(0, 0, GLOW_BLUR, accent, GLOW_ALPHA);
}

// ── identity dot ────────────────────────────────────────────────────
//
// The panel-header grammar borrowed from Live Touch: a small round dot in the
// window's identity colour, then the title. It is what makes a closed window
// and its restore chip read as the SAME object (docs/54 §3).

export const IDENTITY_DOT_SIZE = 8;

export interface IdentityDotStyle {
  width: number;
  height: number;
  borderRadius: number;
  backgroundColor: string;
}

export function identityDot(color: string, size: number = IDENTITY_DOT_SIZE): IdentityDotStyle {
  return { width: size, height: size, borderRadius: size / 2, backgroundColor: color };
}
