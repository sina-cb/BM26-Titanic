(function installColorTransitionTiming(root) {
  'use strict';

  if (root.ColorTransitionTiming !== undefined) {
    throw new Error('window.ColorTransitionTiming is already installed');
  }

  var MIN_S = 0.2;
  var MAX_S = 5.0;
  var DEFAULT_S = 0.8;
  var MIN_MS = 200;
  var MAX_MS = 5000;
  var DEFAULT_MS = 800;

  var currentMs = DEFAULT_MS;

  function clampMs(ms) {
    if (typeof ms !== 'number' || !Number.isFinite(ms)) {
      throw new Error('ColorTransitionTiming.clampMs requires a finite number');
    }
    return Math.round(Math.min(MAX_MS, Math.max(MIN_MS, ms)));
  }

  function msFromNorm(v) {
    var t = Math.min(1, Math.max(0, Number(v)));
    if (!Number.isFinite(t)) {
      throw new Error('ColorTransitionTiming.msFromNorm requires a finite 0..1 value');
    }
    return clampMs(MIN_MS + t * (MAX_MS - MIN_MS));
  }

  function normFromMs(ms) {
    return (clampMs(ms) - MIN_MS) / (MAX_MS - MIN_MS);
  }

  function formatLabel(ms) {
    return (clampMs(ms) / 1000).toFixed(1) + 's';
  }

  function movementFadeSpan(ms) {
    var value = typeof ms === 'number' ? clampMs(ms) : currentMs;
    return Math.min(1, Math.max(0, value / MAX_MS));
  }

  function publish(source) {
    root.document.dispatchEvent(new root.CustomEvent('colortransitiontiming', {
      detail: {
        ms: currentMs,
        norm: normFromMs(currentMs),
        label: formatLabel(currentMs),
        source: source || 'authority',
      },
    }));
  }

  function setMs(ms, source) {
    var next = clampMs(ms);
    var changed = next !== currentMs;
    currentMs = next;
    if (changed) publish(source);
    return next;
  }

  function setNorm(v, source) {
    return setMs(msFromNorm(v), source);
  }

  root.ColorTransitionTiming = Object.freeze({
    MIN_S: MIN_S,
    MAX_S: MAX_S,
    DEFAULT_S: DEFAULT_S,
    MIN_MS: MIN_MS,
    MAX_MS: MAX_MS,
    DEFAULT_MS: DEFAULT_MS,
    ms: function () { return currentMs; },
    norm: function () { return normFromMs(currentMs); },
    label: function () { return formatLabel(currentMs); },
    clampMs: clampMs,
    msFromNorm: msFromNorm,
    normFromMs: normFromMs,
    formatLabel: formatLabel,
    movementFadeSpan: function () { return movementFadeSpan(currentMs); },
    setMs: setMs,
    setNorm: setNorm,
    reset: function (source) { return setMs(DEFAULT_MS, source || 'reset'); },
  });
})(typeof window !== 'undefined' ? window : globalThis);
