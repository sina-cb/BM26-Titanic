import { hsvToRgb } from './color_transition.js';
import { groupIndicesFor } from './pixel_group_index.js';
import { applyMovementTrace } from '../effects/movement_trace.js';

export const LIVE_TOUCH_OVERLAY_FADE_MS = 1000;

/**
 * Session-private movement generators for Live Touch.
 *
 * Movement Trace used to run through GlobalEffectsController, where its
 * replace blend could erase the rendered pattern. This layer renders onto a
 * transparent scratch image and lightens the already-rendered Live buffer;
 * black therefore has no effect and an off overlay leaves the base untouched.
 */
export class LiveTouchOverlayPattern {
  constructor(modelPixels, { getTwoColorPalette = null } = {}) {
    this.setModelPixels(modelPixels);
    this.getTwoColorPalette = getTwoColorPalette;
    this.colorPalette = null;
    this.selectedSlotId = null;
    this.presetId = null;
    this.params = null;
    this.requestedActive = false;
    this.alphaFrom = 0;
    this.alphaTo = 0;
    this.startedAtMs = 0;
    this.phase = 0;
    this.direction = 1;
    this.lastMs = 0;
    this.pulseMs = 0;
  }

  setModelPixels(modelPixels) {
    if (!Array.isArray(modelPixels)) {
      throw new TypeError('Live Touch overlay requires model pixels');
    }
    this.modelPixels = modelPixels;
    this.indices = groupIndicesFor(modelPixels);
    this.scratchPixels = modelPixels.map(pixel => ({
      group: pixel ? pixel.group : '', r: 0, g: 0, b: 0, w: 0, a: 0, u: 0,
    }));
  }

  setPalette(colorPalette) {
    this.colorPalette = validateFiveHsvPalette(colorPalette);
    return this.getPalette();
  }

  getPalette() {
    return this.colorPalette ? this.colorPalette.map(color => ({ ...color })) : null;
  }

  clearPalette() {
    this.colorPalette = null;
  }

  requiresFivePalette(params) {
    return params && ['one_per_color', 'whole_group', 'pulse'].includes(params.mode);
  }

  ensurePaletteFor(params) {
    if (this.requiresFivePalette(params) && !this.colorPalette) {
      const error = new Error(
        'this Live Touch overlay needs the authoritative five-colour session palette',
      );
      error.code = 'LIVE_TOUCH_OVERLAY_PALETTE_REQUIRED';
      error.status = 409;
      throw error;
    }
  }

  dispatch({ slotId, presetId, params, action, behavior, nowMs }) {
    if (!params || typeof params !== 'object') {
      throw new Error('Live Touch overlay action requires resolved movement parameters');
    }
    const resolvedAction = resolveAction(action, behavior);
    this.ensurePaletteFor(params);
    const isSame = this.selectedSlotId === slotId && this.presetId === presetId;
    let nextActive;
    if (resolvedAction === 'deactivate' || resolvedAction === 'up') nextActive = false;
    else if (resolvedAction === 'activate' || resolvedAction === 'down') nextActive = true;
    else nextActive = !(this.requestedActive && isSame);

    if (nextActive) {
      const switching = !isSame;
      this.selectedSlotId = slotId;
      this.presetId = presetId;
      this.params = { ...params };
      if (switching) {
        // A different generator has no outgoing overlay identity to retain.
        // Clear it atomically and fade the newly selected one from transparent.
        this.requestedActive = true;
        this.alphaFrom = 0;
        this.alphaTo = 1;
        this.startedAtMs = nowMs;
        return this.getStatus(nowMs);
      }
    }
    this._setRequestedActive(nextActive, nowMs);
    return this.getStatus(nowMs);
  }

  updateParams(params) {
    if (!this.params) return this.getStatus(this.lastMs);
    this.ensurePaletteFor(params);
    this.params = { ...params };
    return this.getStatus(this.lastMs);
  }

  _setRequestedActive(nextActive, nowMs) {
    const current = this.alphaAt(nowMs);
    this.requestedActive = nextActive;
    this.alphaFrom = current;
    this.alphaTo = nextActive ? 1 : 0;
    this.startedAtMs = nowMs;
  }

  alphaAt(nowMs) {
    if (!Number.isFinite(nowMs)) return this.alphaTo;
    const elapsed = Math.max(0, nowMs - this.startedAtMs);
    const t = Math.min(1, elapsed / LIVE_TOUCH_OVERLAY_FADE_MS);
    return this.alphaFrom + (this.alphaTo - this.alphaFrom) * t;
  }

  isActiveForSlot(slotId, nowMs) {
    return this.selectedSlotId === slotId && this.alphaAt(nowMs) > 0;
  }

  getStatus(nowMs = this.lastMs) {
    const alpha = this.alphaAt(nowMs);
    return {
      active: alpha > 0,
      requestedActive: this.requestedActive,
      slotId: this.selectedSlotId,
      presetId: this.presetId,
      alpha,
      durationMs: LIVE_TOUCH_OVERLAY_FADE_MS,
      paletteReady: !!this.colorPalette,
    };
  }

  composite(pixels, { nowMs, signals = {} } = {}) {
    if (!Array.isArray(pixels) || pixels.length !== this.modelPixels.length) {
      throw new RangeError('Live Touch overlay pixels/model size mismatch');
    }
    const alpha = this.alphaAt(nowMs);
    if (alpha <= 0 || !this.params) {
      if (!this.requestedActive) this._clearAfterFade();
      return this.getStatus(nowMs);
    }
    this.ensurePaletteFor(this.params);
    this._clearScratch();
    const dt = this._advance(nowMs, signals);
    const colors = this._resolveColors();
    const pulseLevel = this._pulseLevel(dt);
    applyMovementTrace({
      pixels: this.scratchPixels,
      groupIndex: this.indices.index,
      groupSize: this.indices.size,
      groupId: this.indices.groupId,
      phase: this.phase,
      mode: this.params.mode,
      colors,
      amount: 1,
      blank: !!this.params.blank,
      fadeSpan: this.params.fadeSpan,
      level: pulseLevel,
    });

    for (let i = 0; i < pixels.length; i++) {
      const base = pixels[i];
      const overlay = this.scratchPixels[i];
      if (!base || !overlay) continue;
      base.r = Math.max(base.r, overlay.r * alpha);
      base.g = Math.max(base.g, overlay.g * alpha);
      base.b = Math.max(base.b, overlay.b * alpha);
      base.w = Math.max(base.w, overlay.w * alpha);
      base.a = Math.max(base.a, overlay.a * alpha);
      base.u = Math.max(base.u, overlay.u * alpha);
    }
    return this.getStatus(nowMs);
  }

  _clearScratch() {
    for (const pixel of this.scratchPixels) {
      pixel.r = 0; pixel.g = 0; pixel.b = 0;
      pixel.w = 0; pixel.a = 0; pixel.u = 0;
    }
  }

  _advance(nowMs, signals) {
    let dt = this.lastMs === 0 ? 0 : (nowMs - this.lastMs) / 1000;
    if (dt < 0 || dt > 1) dt = 0;
    this.lastMs = nowMs;
    const params = this.params;
    const bpm = typeof signals.bpm === 'number' && signals.bpm > 0 ? signals.bpm : 120;
    const advance = params.sync === 'beat'
      ? dt * (bpm / 60) * (params.pixelsPerBeat || 1)
      : dt * (params.pixelsPerSecond || 0);
    this.phase += advance * this.direction;
    if (params.travel === 'reverse') {
      const longest = this.indices.size.reduce((max, size) => Math.max(max, size), 0);
      if (longest > 1) {
        if (this.phase >= longest) {
          this.phase = longest;
          this.direction = -1;
        } else if (this.phase <= 0) {
          this.phase = 0;
          this.direction = 1;
        }
      }
    } else {
      this.direction = 1;
    }
    return dt;
  }

  _pulseLevel(dt) {
    if (this.params.mode !== 'pulse') return 1;
    const burst = this.params.burstMs > 0 ? this.params.burstMs : 1;
    const decay = this.params.decayMs > 0 ? this.params.decayMs : 1;
    const cycle = burst + decay;
    this.pulseMs = (this.pulseMs + dt * 1000) % cycle;
    if (this.pulseMs < burst) return 1;
    const t = (this.pulseMs - burst) / decay;
    const fall = (1 - t) * (1 - t) * (1 - t);
    return this.params.floor + (1 - this.params.floor) * fall;
  }

  _resolveColors() {
    if (this.params.mode === 'every_other') {
      if (typeof this.getTwoColorPalette !== 'function') {
        throw new Error('Live Touch overlay has no authoritative two-colour palette source');
      }
      const palette = validateTwoHsvPalette(this.getTwoColorPalette());
      return palette.map(hsvToColor6);
    }
    return this.colorPalette.map(hsvToColor6);
  }

  _clearAfterFade() {
    this.selectedSlotId = null;
    this.presetId = null;
    this.params = null;
    this.alphaFrom = 0;
    this.alphaTo = 0;
  }
}

function resolveAction(action, behavior) {
  if (action === 'press') {
    if (behavior === 'toggle') return 'toggle';
    if (behavior === 'hold') return 'down';
    if (behavior === 'trigger') return 'trigger';
    throw new Error(`Live Touch overlay has unsupported behavior '${behavior}'`);
  }
  return action;
}

function hsvToColor6(color) {
  const rgb = hsvToRgb(color.h, color.s, color.v, [0, 0, 0]);
  return [rgb[0], rgb[1], rgb[2], 0, 0, 0];
}

export function validateFiveHsvPalette(colorPalette) {
  if (!Array.isArray(colorPalette) || colorPalette.length !== 5) {
    throw new Error('Live Touch overlay colorPalette must contain exactly five HSV colors');
  }
  return colorPalette.map((color, index) => {
    if (!color || typeof color !== 'object' || Array.isArray(color)
        || Object.keys(color).length !== 3
        || !Object.hasOwn(color, 'h') || !Object.hasOwn(color, 's') || !Object.hasOwn(color, 'v')) {
      throw new Error(`Live Touch overlay colorPalette[${index}] must be an HSV object { h, s, v }`);
    }
    for (const key of ['h', 's', 'v']) {
      if (typeof color[key] !== 'number' || !Number.isFinite(color[key])
          || color[key] < 0 || color[key] > 1) {
        throw new Error(`Live Touch overlay colorPalette[${index}].${key} must be finite in [0,1]`);
      }
    }
    return { h: color.h, s: color.s, v: color.v };
  });
}

function validateTwoHsvPalette(colorPalette) {
  if (!Array.isArray(colorPalette) || colorPalette.length !== 2) {
    throw new Error('Live Touch overlay two-colour palette must contain exactly two HSV colors');
  }
  return colorPalette.map((color, index) => validateHsvColor(color, `two-colour palette[${index}]`));
}

function validateHsvColor(color, label) {
  if (!color || typeof color !== 'object' || Array.isArray(color)
      || Object.keys(color).length !== 3
      || !Object.hasOwn(color, 'h') || !Object.hasOwn(color, 's') || !Object.hasOwn(color, 'v')) {
    throw new Error(`Live Touch overlay ${label} must be an HSV object { h, s, v }`);
  }
  for (const key of ['h', 's', 'v']) {
    if (typeof color[key] !== 'number' || !Number.isFinite(color[key])
        || color[key] < 0 || color[key] > 1) {
      throw new Error(`Live Touch overlay ${label}.${key} must be finite in [0,1]`);
    }
  }
  return { h: color.h, s: color.s, v: color.v };
}
