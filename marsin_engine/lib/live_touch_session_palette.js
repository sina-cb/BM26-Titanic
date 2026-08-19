import { lerpHue } from './color_autopilot.js';

export const LIVE_TOUCH_RING_LENGTH = 5;

function cloneHsv(color) {
  return { h: color.h, s: color.s, v: color.v };
}

export function assertExactFiveHsv(colorPalette, label = 'colorPalette') {
  if (!Array.isArray(colorPalette) || colorPalette.length !== LIVE_TOUCH_RING_LENGTH) {
    throw new Error(`${label} must contain exactly ${LIVE_TOUCH_RING_LENGTH} HSV colors`);
  }
  return colorPalette.map((color, index) => {
    if (!color || typeof color !== 'object' || Array.isArray(color)
        || !Object.hasOwn(color, 'h') || !Object.hasOwn(color, 's') || !Object.hasOwn(color, 'v')) {
      throw new Error(`${label}[${index}] must be an HSV object { h, s, v }`);
    }
    for (const key of ['h', 's', 'v']) {
      const value = color[key];
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
        throw new Error(`${label}[${index}].${key} must be finite in [0,1]`);
      }
    }
    return cloneHsv(color);
  });
}

export function lerpHsv(a, b, t) {
  if (t <= 0) return cloneHsv(a);
  if (t >= 1) return cloneHsv(b);
  return {
    h: lerpHue(a.h, b.h, t),
    s: a.s + (b.s - a.s) * t,
    v: a.v + (b.v - a.v) * t,
  };
}

export function overlayFrameFromPairParams(ring, sel, params) {
  const base = assertExactFiveHsv(ring, 'ring');
  const pairSel = Array.isArray(sel) && sel.length === 2 ? sel : [0, 1];
  const c1 = params && params.colorPalette1;
  const c2 = params && params.colorPalette2;
  if (!c1 || !c2) {
    throw new Error('overlayFrameFromPairParams requires colorPalette1 and colorPalette2');
  }
  const a = assertExactFiveHsv([c1, c2, base[2], base[3], base[4]], 'params')[0];
  const b = assertExactFiveHsv([c1, c2, base[2], base[3], base[4]], 'params')[1];
  return base.map(function (color, index) {
    if (index === pairSel[0]) return cloneHsv(a);
    if (index === pairSel[1]) return cloneHsv(b);
    return color;
  });
}

export function overlayFrameFromTransition(ring, sel, fromFive, toFive, progress) {
  const base = assertExactFiveHsv(ring, 'ring');
  const pairSel = Array.isArray(sel) && sel.length === 2 ? sel : [0, 1];
  const fromState = assertExactFiveHsv(fromFive, 'fromFive');
  const toState = assertExactFiveHsv(toFive, 'toFive');
  const t = Math.max(0, Math.min(1, progress));
  return base.map(function (_color, index) {
    if (index === pairSel[0] || index === pairSel[1]) {
      return lerpHsv(fromState[index], toState[index], t);
    }
    return base[index];
  });
}

export function livePaletteForCrossfadeEntry(ring, sel, c1, c2) {
  const base = assertExactFiveHsv(ring, 'ring');
  const pairSel = Array.isArray(sel) && sel.length === 2 ? sel : [0, 1];
  const left = typeof c1 === 'number' ? { h: c1, s: 1, v: 1 } : cloneHsv(c1);
  const right = typeof c2 === 'number' ? { h: c2, s: 1, v: 1 } : cloneHsv(c2);
  return base.map(function (color, index) {
    if (index === pairSel[0]) return left;
    if (index === pairSel[1]) return right;
    return color;
  });
}

export function buildCrossfadeLivePalettes(ring, sel, palettes) {
  assertExactFiveHsv(ring, 'ring');
  if (!Array.isArray(palettes) || !palettes.length) {
    throw new Error('buildCrossfadeLivePalettes requires at least one palette entry');
  }
  return palettes.map(function (entry, index) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`palettes[${index}] must be an inline {c1,c2} pair`);
    }
    return livePaletteForCrossfadeEntry(ring, sel, entry.c1, entry.c2);
  });
}

export function buildTurnsLivePalettes(ring, sel, palettes) {
  assertExactFiveHsv(ring, 'ring');
  if (!Array.isArray(palettes) || !palettes.length) {
    throw new Error('buildTurnsLivePalettes requires at least one palette entry');
  }
  return palettes.map(function (entry, index) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`palettes[${index}] must be an inline {c1,c2} pair`);
    }
    return livePaletteForCrossfadeEntry(ring, sel, entry.c1, entry.c2);
  });
}

export function overlayFrameFromTransitionState(state, ring, sel) {
  if (!state || typeof state !== 'object') {
    throw new Error('overlayFrameFromTransitionState requires transition state');
  }
  if (Array.isArray(state.palette) && state.palette.length === LIVE_TOUCH_RING_LENGTH) {
    return assertExactFiveHsv(state.palette, 'transition.palette');
  }
  if (state.params) {
    return overlayFrameFromPairParams(ring, sel, state.params);
  }
  if (state.fromParams && state.targetParams && typeof state.progress === 'number') {
    const fromFive = overlayFrameFromPairParams(ring, sel, state.fromParams);
    const toFive = overlayFrameFromPairParams(ring, sel, state.targetParams);
    return overlayFrameFromTransition(ring, sel, fromFive, toFive, state.progress);
  }
  throw new Error('transition state did not include a resolvable five-colour frame');
}
