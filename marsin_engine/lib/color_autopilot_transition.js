const PUBLISH_INTERVAL_MS = 100;

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, clone(entry)]));
  }
  return value;
}

function paletteFromParams(params) {
  const palette = [];
  for (let slot = 1; slot <= 5; slot++) {
    const value = params && params[`colorPalette${slot}`];
    if (!value || typeof value !== 'object') return undefined;
    palette.push({ h: value.h, s: value.s, v: value.v });
  }
  return palette;
}

export class ColorAutopilotTransition {
  constructor({ now, publish, resolveScope } = {}) {
    this._now = typeof now === 'function' ? now : () => Date.now();
    this._publish = typeof publish === 'function' ? publish : null;
    this._resolveScope = typeof resolveScope === 'function' ? resolveScope : () => 'engine-pair';
    this._state = null;
    this._nextId = 1;
    this._lastPublishMs = -Infinity;
  }

  get state() {
    return this._state === null ? null : clone(this._state);
  }

  begin(fromParams, targetParams, durationMs) {
    const now = this._now();
    const params = fromParams || targetParams;
    this._state = {
      id: this._nextId++,
      status: 'running',
      active: true,
      settled: false,
      cancelled: false,
      failed: false,
      progress: 0,
      startedAtMs: now,
      endedAtMs: null,
      durationMs,
      scope: this._resolveScope(targetParams),
      paletteAuthority: paletteFromParams(targetParams) ? 'session-five' : undefined,
      palette: paletteFromParams(params),
      fromParams: fromParams ? clone(fromParams) : null,
      targetParams: clone(targetParams),
      params: clone(params),
      error: null,
    };
    this._publishState(true);
    return this._state.id;
  }

  update(id, params, progress) {
    if (!this._state || this._state.id !== id || this._state.status !== 'running') return;
    this._state.progress = Math.max(0, Math.min(1, progress));
    this._state.params = clone(params);
    this._state.palette = paletteFromParams(params);
    this._publishState(false);
  }

  settle(id, params) {
    this._finish(id, 'settled', params, null);
  }

  cancel(params) {
    if (!this._state || this._state.status !== 'running') return;
    this._finish(this._state.id, 'cancelled', params || this._state.params, null);
  }

  fail(id, params, error) {
    const message = error && error.message ? error.message : String(error);
    this._finish(id, 'failed', params, message);
  }

  _finish(id, status, params, error) {
    if (!this._state || this._state.id !== id || this._state.status !== 'running') return;
    this._state.status = status;
    this._state.active = false;
    this._state.settled = status === 'settled';
    this._state.cancelled = status === 'cancelled';
    this._state.failed = status === 'failed';
    if (status === 'settled') this._state.progress = 1;
    this._state.endedAtMs = this._now();
    this._state.params = clone(params || this._state.params);
    this._state.palette = paletteFromParams(this._state.params);
    this._state.error = error;
    this._publishState(true);
  }

  _publishState(force) {
    if (!this._publish) return;
    const now = this._now();
    if (!force && now - this._lastPublishMs < PUBLISH_INTERVAL_MS) return;
    this._lastPublishMs = now;
    this._publish(this.state);
  }
}
