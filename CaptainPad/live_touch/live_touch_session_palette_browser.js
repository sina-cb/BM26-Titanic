(function installLiveTouchSessionPalette(root) {
  'use strict';

  if (root.LiveTouchSessionPalette !== undefined) {
    throw new Error('window.LiveTouchSessionPalette is already installed');
  }

  var RING_LENGTH = 5;

  function cloneHsv(color) {
    return { h: color.h, s: color.s, v: color.v };
  }

  function wrap01(x) {
    return x >= 0 && x < 1 ? x : ((x % 1) + 1) % 1;
  }

  function lerpHue(a, b, t) {
    if (t <= 0) return a;
    if (t >= 1) return b;
    if (a === b) return a;
    var d = b - a;
    d -= Math.floor(d);
    if (d > 0.5) d -= 1;
    return wrap01(a + d * t);
  }

  function assertExactFiveHsv(colorPalette, label) {
    label = label || 'colorPalette';
    if (!Array.isArray(colorPalette) || colorPalette.length !== RING_LENGTH) {
      throw new Error(label + ' must contain exactly ' + RING_LENGTH + ' HSV colors');
    }
    return colorPalette.map(function (color, index) {
      if (!color || typeof color !== 'object' || Array.isArray(color)
          || !Object.hasOwn(color, 'h') || !Object.hasOwn(color, 's') || !Object.hasOwn(color, 'v')) {
        throw new Error(label + '[' + index + '] must be an HSV object { h, s, v }');
      }
      ['h', 's', 'v'].forEach(function (key) {
        var value = color[key];
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
          throw new Error(label + '[' + index + '].' + key + ' must be finite in [0,1]');
        }
      });
      return cloneHsv(color);
    });
  }

  function lerpHsv(a, b, t) {
    if (t <= 0) return cloneHsv(a);
    if (t >= 1) return cloneHsv(b);
    return {
      h: lerpHue(a.h, b.h, t),
      s: a.s + (b.s - a.s) * t,
      v: a.v + (b.v - a.v) * t,
    };
  }

  function validateSelection(sel, label) {
    label = label || 'selection';
    if (!Array.isArray(sel) || sel.length !== 2) {
      throw new Error(label + ' must contain exactly two palette indices');
    }
    var pair = sel.map(function (index, channel) {
      if (!Number.isInteger(index) || index < 0 || index >= RING_LENGTH) {
        throw new Error(label + '[' + channel + '] must be an integer in [0,' + RING_LENGTH + ')');
      }
      return index;
    });
    if (pair[0] === pair[1]) {
      throw new Error(label + ' must choose two different palette samples');
    }
    return pair;
  }

  function outputPaletteFromSelection(ring, sel) {
    var base = assertExactFiveHsv(ring, 'ring');
    var pair = validateSelection(sel);
    var remaining = base.filter(function (_color, index) {
      return index !== pair[0] && index !== pair[1];
    });
    return [base[pair[0]], base[pair[1]]].concat(remaining).map(cloneHsv);
  }

  function candidatePaletteFromOutput(output, sel) {
    var ordered = assertExactFiveHsv(output, 'output');
    var pair = validateSelection(sel);
    var candidate = new Array(RING_LENGTH);
    candidate[pair[0]] = cloneHsv(ordered[0]);
    candidate[pair[1]] = cloneHsv(ordered[1]);
    [0, 1, 2, 3, 4].filter(function (index) {
      return index !== pair[0] && index !== pair[1];
    }).forEach(function (index, offset) {
      candidate[index] = cloneHsv(ordered[offset + 2]);
    });
    return candidate;
  }

  function overlayFrameFromPairParams(ring, sel, params) {
    var base = assertExactFiveHsv(ring, 'ring');
    var pairSel = Array.isArray(sel) && sel.length === 2 ? sel : [0, 1];
    var c1 = params && params.colorPalette1;
    var c2 = params && params.colorPalette2;
    if (!c1 || !c2) {
      throw new Error('overlayFrameFromPairParams requires colorPalette1 and colorPalette2');
    }
    var a = assertExactFiveHsv([c1, c2, base[2], base[3], base[4]], 'params')[0];
    var b = assertExactFiveHsv([c1, c2, base[2], base[3], base[4]], 'params')[1];
    return base.map(function (_color, index) {
      if (index === pairSel[0]) return cloneHsv(a);
      if (index === pairSel[1]) return cloneHsv(b);
      return base[index];
    });
  }

  function overlayFrameFromTransition(ring, sel, fromFive, toFive, progress) {
    var base = assertExactFiveHsv(ring, 'ring');
    var pairSel = Array.isArray(sel) && sel.length === 2 ? sel : [0, 1];
    var fromState = assertExactFiveHsv(fromFive, 'fromFive');
    var toState = assertExactFiveHsv(toFive, 'toFive');
    var t = Math.max(0, Math.min(1, progress));
    return base.map(function (_color, index) {
      if (index === pairSel[0] || index === pairSel[1]) {
        return lerpHsv(fromState[index], toState[index], t);
      }
      return base[index];
    });
  }

  function livePaletteForCrossfadeEntry(ring, sel, c1, c2) {
    var base = outputPaletteFromSelection(ring, sel);
    var left = typeof c1 === 'number' ? { h: c1, s: 1, v: 1 } : cloneHsv(c1);
    var right = typeof c2 === 'number' ? { h: c2, s: 1, v: 1 } : cloneHsv(c2);
    return [left, right].concat(base.slice(2)).map(cloneHsv);
  }

  function buildLivePalettesFromPairs(ring, sel, palettes) {
    assertExactFiveHsv(ring, 'ring');
    if (!Array.isArray(palettes) || !palettes.length) {
      throw new Error('buildLivePalettesFromPairs requires at least one palette entry');
    }
    return palettes.map(function (entry, index) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        throw new Error('palettes[' + index + '] must be an inline {c1,c2} pair');
      }
      return livePaletteForCrossfadeEntry(ring, sel, entry.c1, entry.c2);
    });
  }

  function overlayFrameFromTransitionState(state, ring, sel) {
    if (!state || typeof state !== 'object') {
      throw new Error('overlayFrameFromTransitionState requires transition state');
    }
    if (Array.isArray(state.palette) && state.palette.length === RING_LENGTH) {
      return assertExactFiveHsv(state.palette, 'transition.palette');
    }
    if (state.params) {
      return overlayFrameFromPairParams(ring, sel, state.params);
    }
    if (state.fromParams && state.targetParams && typeof state.progress === 'number') {
      var fromFive = overlayFrameFromPairParams(ring, sel, state.fromParams);
      var toFive = overlayFrameFromPairParams(ring, sel, state.targetParams);
      return overlayFrameFromTransition(ring, sel, fromFive, toFive, state.progress);
    }
    throw new Error('transition state did not include a resolvable five-colour frame');
  }

  root.LiveTouchSessionPalette = Object.freeze({
    RING_LENGTH: RING_LENGTH,
    assertExactFiveHsv: assertExactFiveHsv,
    lerpHsv: lerpHsv,
    outputPaletteFromSelection: outputPaletteFromSelection,
    candidatePaletteFromOutput: candidatePaletteFromOutput,
    overlayFrameFromPairParams: overlayFrameFromPairParams,
    overlayFrameFromTransition: overlayFrameFromTransition,
    livePaletteForCrossfadeEntry: livePaletteForCrossfadeEntry,
    buildLivePalettesFromPairs: buildLivePalettesFromPairs,
    overlayFrameFromTransitionState: overlayFrameFromTransitionState,
  });
})(typeof window !== 'undefined' ? window : globalThis);
