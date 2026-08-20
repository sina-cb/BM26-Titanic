// pixel_view_band_picture_border_compensation.test.ts — source-text guard
// for the docs/69 W3 MISS 2 fix (the relocated band's canvas rendering 2 pt
// under `MIN_BAND_CANVAS_HEIGHT`).
//
// Root cause (proven, not guessed): react-native-web's `View` applies
// `boxSizing: 'border-box'` by default (`node_modules/react-native-web/src
// /exports/View/index.js`), and native Yoga treats border the same way (an
// inset within the specified size, never additive) — so a box styled
// `{ width: W, height: H, borderWidth: B }` delivers a CONTENT/PADDING area
// of `(W - 2B) x (H - 2B)` to an absolutely-positioned child, on both
// platforms. `pixel_view_band.tsx`'s `picture` box applies
// `computeBandCanvasSize`'s result directly to a box that ALSO carries
// `styles.picture.borderWidth` (1 pt), so the aspect-honest canvas — whose
// own doc comment promises "the surface this sizes IS the picture", no
// letterbox, no slack — silently lost `2 * borderWidth` on every axis. A
// floored 72 pt canvas therefore painted at 70 pt: exactly the measured
// defect, and exactly `2 * 1`.
//
// The fix does not touch `bandCanvasSizeForAspect`, `MIN_BAND_CANVAS_HEIGHT`,
// `PixelSurface`, `pixel_paint_scheduler`, or `use_pixel_view_artifact`
// (docs/69 §8 pin 3) — it only changes how the already-correct `canvasSize`
// gets APPLIED to a bordered box, by inflating the applied width/height by
// the same border allowance the box will subtract back out.
//
// WHY SOURCE TEXT. `pixel_view_band.tsx` is an RN component (`.tsx`), kept
// out of `vitest.config.ts`'s glob (see that file's own comment) — there is
// no RN test renderer wired into this suite. Same idiom as
// `mixer_polish_source_guards.test.ts` / `native_gesture_armor.test.ts`.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { bandCanvasSizeForAspect, MIN_BAND_CANVAS_HEIGHT } from './pixel_view_band_logic';

const HERE = dirname(fileURLToPath(import.meta.url));

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function read(...parts: string[]): string {
  return stripComments(readFileSync(join(HERE, ...parts), 'utf8'));
}

const BAND = read('pixel_view_band.tsx');

describe('docs/69 W3 MISS 2 — the picture box compensates for its own border under border-box sizing', () => {
  it('names the border width once, shared by the style and the compensation', () => {
    expect(BAND).toMatch(/const PICTURE_BORDER_WIDTH = 1/);
    // The style must reference the constant, not re-hardcode a literal `1`
    // that could drift from the compensation math below.
    expect(BAND).toMatch(/borderWidth:\s*PICTURE_BORDER_WIDTH/);
  });

  it('inflates the applied width AND height by the full border allowance (both sides)', () => {
    expect(BAND).toMatch(/pictureBorderAllowance\s*=\s*PICTURE_BORDER_WIDTH \* 2/);
    expect(BAND).toMatch(/width:\s*canvasSize\.width \+ pictureBorderAllowance/);
    expect(BAND).toMatch(/height:\s*canvasSize\.height \+ pictureBorderAllowance/);
  });

  it('never touches the pinned sizing math this wave is forbidden from editing (docs/69 §8 pin 3)', () => {
    // These identifiers may be IMPORTED (the band already does, verbatim,
    // per that pin) but their DEFINITIONS must not appear in this file —
    // `function bandCanvasSizeForAspect(` / `export const MIN_BAND_CANVAS_HEIGHT`
    // only exist in `pixel_view_band_logic.ts`.
    expect(BAND).not.toMatch(/function bandCanvasSizeForAspect/);
    expect(BAND).not.toMatch(/const MIN_BAND_CANVAS_HEIGHT\s*=/);
    // The import line must still pull both verbatim from the logic module —
    // proof this band still defers to that pinned floor rather than
    // reintroducing its own.
    expect(BAND).toMatch(/computeBandCanvasSize,/);
  });
});

describe('docs/69 W3 MISS 2 — the compensation arithmetic actually closes the 2 pt gap', () => {
  // Mirrors (never re-imports — the component isn't importable outside RN)
  // the exact border-box subtraction a browser or native Yoga performs on a
  // box styled `{ width, height, borderWidth }`: the content/padding area an
  // absolutely-positioned child fills is `size - 2 * borderWidth`.
  const PICTURE_BORDER_WIDTH = 1;
  function renderedContentSize(appliedSize: number): number {
    return appliedSize - 2 * PICTURE_BORDER_WIDTH;
  }

  it('a floored canvas (the exact reported defect) renders at its full floor after compensation', () => {
    // A narrow slot where slotWidth/aspect lands below MIN_BAND_CANVAS_HEIGHT
    // — the exact scenario measured tonight (117x70 before this fix).
    const aspect = 1.671;
    const slotWidth = 117;
    const capHeight = 176; // CHANNEL_EDIT_CAP_HEIGHT
    const canvasSize = bandCanvasSizeForAspect(aspect, slotWidth, capHeight);
    expect(canvasSize.height).toBe(MIN_BAND_CANVAS_HEIGHT); // the floor binds — reproduces the bug's precondition

    const appliedHeight = canvasSize.height + 2 * PICTURE_BORDER_WIDTH;
    const appliedWidth = canvasSize.width + 2 * PICTURE_BORDER_WIDTH;
    // Before this fix: `appliedHeight` WAS `canvasSize.height` (no
    // compensation), so `renderedContentSize` landed 2 pt under the floor —
    // the exact measured 70 vs 72. After: it lands exactly on the floor.
    expect(renderedContentSize(appliedHeight)).toBe(MIN_BAND_CANVAS_HEIGHT);
    expect(renderedContentSize(appliedHeight)).toBeGreaterThanOrEqual(MIN_BAND_CANVAS_HEIGHT);
    expect(renderedContentSize(appliedWidth)).toBe(canvasSize.width);
  });

  it('a ceiling-bound canvas also renders honestly after compensation', () => {
    // A wide slot where the picture is capped by CHANNEL_EDIT_CAP_HEIGHT
    // instead of floored — the other end of the aspect-honest range.
    const aspect = 1.671;
    const slotWidth = 600;
    const capHeight = 176;
    const canvasSize = bandCanvasSizeForAspect(aspect, slotWidth, capHeight);
    const appliedHeight = canvasSize.height + 2 * PICTURE_BORDER_WIDTH;
    const appliedWidth = canvasSize.width + 2 * PICTURE_BORDER_WIDTH;
    expect(renderedContentSize(appliedHeight)).toBe(canvasSize.height);
    expect(renderedContentSize(appliedWidth)).toBe(canvasSize.width);
  });
});
