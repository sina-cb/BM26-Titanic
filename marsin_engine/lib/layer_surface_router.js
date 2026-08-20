export const LAYER_SETTING_IDS = Object.freeze({
  DECK: 'deck',
  MIXER: 'mixer',
  LIVE_TOUCH: 'live_touch',
});

export const LAYER_SETTING_ID_SET = Object.freeze(new Set(Object.values(LAYER_SETTING_IDS)));

export const DEFAULT_LAYER_TRANSITION_DURATION_MS = 100;
const MAX_TRANSITION_DURATION_MS = 30000;
const MAX_TICK_MS = 250;

function validateSetting(setting) {
  if (!LAYER_SETTING_ID_SET.has(setting)) {
    throw new RangeError(
      `Unknown layer setting '${setting}' (expected deck, mixer, or live_touch)`,
    );
  }
}

function validateDuration(durationMs) {
  if (!Number.isFinite(durationMs) || durationMs < 1 || durationMs > MAX_TRANSITION_DURATION_MS) {
    throw new RangeError(
      `layer transition durationMs must be finite in [1, ${MAX_TRANSITION_DURATION_MS}]`,
    );
  }
}

/**
 * Owns the mutually-exclusive Deck / Mixer / Live Touch render setting.
 *
 * A steady frame has exactly one participant. A transition has exactly two:
 * the captured outgoing setting and the requested incoming setting. A request
 * for a third setting is queued, never admitted into the current blend.
 */
export class LayerSurfaceRouter {
  constructor({
    initialSetting = LAYER_SETTING_IDS.MIXER,
    defaultDurationMs = DEFAULT_LAYER_TRANSITION_DURATION_MS,
    now = () => Date.now(),
    onChange = null,
  } = {}) {
    validateSetting(initialSetting);
    validateDuration(defaultDurationMs);
    if (typeof now !== 'function') throw new TypeError('LayerSurfaceRouter now must be a function');
    if (onChange !== null && typeof onChange !== 'function') {
      throw new TypeError('LayerSurfaceRouter onChange must be a function or null');
    }

    this.active = initialSetting;
    this.defaultDurationMs = defaultDurationMs;
    this.now = now;
    this.onChange = onChange;
    this.transition = null;
    this.queued = null;
    this._transitionCounter = 0;
    this._lastTickMs = null;
  }

  setOnChange(onChange) {
    if (onChange !== null && typeof onChange !== 'function') {
      throw new TypeError('LayerSurfaceRouter onChange must be a function or null');
    }
    this.onChange = onChange;
  }

  activate(target, { durationMs = this.defaultDurationMs, reason = 'operator' } = {}) {
    validateSetting(target);
    validateDuration(durationMs);
    if (typeof reason !== 'string' || reason.length === 0) {
      throw new TypeError('layer transition reason must be a non-empty string');
    }

    if (!this.transition) {
      if (target === this.active) {
        this.queued = null;
        return { status: 'active', state: this.getState() };
      }
      this._startTransition(this.active, target, durationMs, reason, 0);
      return { status: 'started', state: this.getState() };
    }

    const current = this.transition;
    if (target === current.to) {
      this.queued = null;
      return { status: 'transitioning', state: this.getState() };
    }

    if (target === current.from) {
      const reversedProgress = 1 - current.progress;
      this.transition = {
        ...current,
        id: this._nextTransitionId(),
        from: current.to,
        to: current.from,
        progress: reversedProgress,
        elapsedMs: reversedProgress * durationMs,
        durationMs,
        reason,
      };
      this.queued = null;
      this._lastTickMs = this.now();
      this._emit('started');
      return { status: 'reversed', state: this.getState() };
    }

    this.queued = { target, durationMs, reason };
    this._emit('queued');
    return { status: 'queued', state: this.getState() };
  }

  tick(nowMs = this.now()) {
    if (!Number.isFinite(nowMs)) throw new TypeError('layer transition clock must be finite');
    if (!this.transition) {
      this._lastTickMs = nowMs;
      return false;
    }

    const previousTickMs = this._lastTickMs;
    this._lastTickMs = nowMs;
    if (previousTickMs === null) return false;

    const dtMs = Math.max(0, Math.min(MAX_TICK_MS, nowMs - previousTickMs));
    if (dtMs === 0) return false;

    const transition = this.transition;
    transition.elapsedMs = Math.min(transition.durationMs, transition.elapsedMs + dtMs);
    transition.progress = transition.elapsedMs / transition.durationMs;

    if (transition.progress < 1) {
      this._emit('progress');
      return true;
    }

    this.active = transition.to;
    const completed = { ...transition };
    this.transition = null;
    this._emit('completed', completed);

    const queued = this.queued;
    this.queued = null;
    if (queued && queued.target !== this.active) {
      this._startTransition(
        this.active,
        queued.target,
        queued.durationMs,
        queued.reason,
        0,
      );
    }
    return true;
  }

  forceActive(target, reason = 'forced') {
    validateSetting(target);
    if (typeof reason !== 'string' || reason.length === 0) {
      throw new TypeError('layer transition reason must be a non-empty string');
    }
    const previous = this.getState();
    this.active = target;
    this.transition = null;
    this.queued = null;
    this._lastTickMs = this.now();
    this._emit('forced', { previous, reason });
    return this.getState();
  }

  participants() {
    if (!this.transition) return [this.active];
    return [this.transition.from, this.transition.to];
  }

  isParticipant(setting) {
    validateSetting(setting);
    if (!this.transition) return this.active === setting;
    return this.transition.from === setting || this.transition.to === setting;
  }

  blend() {
    if (!this.transition) {
      return { from: this.active, to: this.active, amount: 1 };
    }
    return {
      from: this.transition.from,
      to: this.transition.to,
      amount: this.transition.progress,
    };
  }

  getState() {
    const transition = this.transition
      ? {
          id: this.transition.id,
          from: this.transition.from,
          to: this.transition.to,
          progress: this.transition.progress,
          durationMs: this.transition.durationMs,
          curve: 'linear',
          reason: this.transition.reason,
        }
      : null;
    return {
      active: this.active,
      target: transition ? transition.to : this.active,
      transition,
      queued: this.queued ? this.queued.target : null,
    };
  }

  _nextTransitionId() {
    this._transitionCounter += 1;
    return `layer_tx_${this._transitionCounter}`;
  }

  _startTransition(from, to, durationMs, reason, progress) {
    this.transition = {
      id: this._nextTransitionId(),
      from,
      to,
      progress,
      elapsedMs: progress * durationMs,
      durationMs,
      reason,
    };
    this._lastTickMs = this.now();
    this._emit('started');
  }

  _emit(event, detail = null) {
    if (this.onChange) this.onChange({ event, detail, state: this.getState() });
  }
}
