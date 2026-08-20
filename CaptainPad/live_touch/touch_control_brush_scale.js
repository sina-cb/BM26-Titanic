/* Live Touch brush SIZE — slider value to pad-space radius.
 *
 * The SIZE control stores a bounded slider value v in 0..MAX_SLIDER. That value
 * maps monotonically to the pad fraction the operator aims with (and that
 * padBrushWorld / worldBrushRadii consume). Legacy presets captured the old
 * 0..1 slider through a different linear map; remapLegacySlider preserves the
 * physical radius they intended without guessing at unknown scale versions.
 */
(function installTouchBrushScale(root) {
  'use strict';

  var VERSION = 1;
  var MAX_SLIDER = 0.35;
  var DEFAULT_SLIDER = 0.05;
  var LEGACY_VERSION = 0;

  var ANCHORS = [
    { v: 0, label: 'XS', radius: 0.02 },
    { v: 0.025, label: 'S', radius: 0.0275 },
    { v: 0.05, label: 'M', radius: 0.035 },
    { v: 0.2, label: 'L', radius: 0.08 },
    { v: 0.35, label: 'XL', radius: 0.125 },
  ];

  function assertFinite(value, message) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(message);
    }
  }

  function validateSlider(value) {
    assertFinite(value, 'brush slider value must be finite');
    if (value < 0 || value > MAX_SLIDER) {
      throw new Error('brush slider value must be within 0..' + MAX_SLIDER);
    }
  }

  function clampSlider(value) {
    assertFinite(value, 'brush slider value must be finite');
    if (value < 0) return 0;
    if (value > MAX_SLIDER) return MAX_SLIDER;
    return value;
  }

  function padFracFromSlider(value) {
    validateSlider(value);
    for (var index = 1; index < ANCHORS.length; index++) {
      var upper = ANCHORS[index];
      if (value <= upper.v) {
        var lower = ANCHORS[index - 1];
        if (upper.v === lower.v) return upper.radius;
        var t = (value - lower.v) / (upper.v - lower.v);
        return lower.radius + t * (upper.radius - lower.radius);
      }
    }
    return ANCHORS[ANCHORS.length - 1].radius;
  }

  function sliderFromPadFrac(radius) {
    assertFinite(radius, 'brush radius must be finite');
    if (radius <= ANCHORS[0].radius) return ANCHORS[0].v;
    if (radius >= ANCHORS[ANCHORS.length - 1].radius) {
      return ANCHORS[ANCHORS.length - 1].v;
    }
    for (var index = 1; index < ANCHORS.length; index++) {
      var upper = ANCHORS[index];
      if (radius <= upper.radius) {
        var lower = ANCHORS[index - 1];
        if (upper.radius === lower.radius) return upper.v;
        var t = (radius - lower.radius) / (upper.radius - lower.radius);
        return lower.v + t * (upper.v - lower.v);
      }
    }
    return ANCHORS[ANCHORS.length - 1].v;
  }

  function legacyPadFracFromSlider(value) {
    assertFinite(value, 'legacy brush slider value must be finite');
    if (value < 0 || value > 1) {
      throw new Error('legacy brush slider value must be within 0..1');
    }
    return 0.02 + Math.min(Math.max(value, 0), 1) * 0.30;
  }

  function remapLegacySlider(oldValue) {
    return sliderFromPadFrac(legacyPadFracFromSlider(oldValue));
  }

  function resolvePresetSlider(value, scaleVersion) {
    assertFinite(value, 'preset brush slider value must be finite');
    if (scaleVersion === undefined || scaleVersion === null || scaleVersion === LEGACY_VERSION) {
      return remapLegacySlider(value);
    }
    if (scaleVersion !== VERSION) {
      throw new Error('preset brushScaleVersion ' + scaleVersion + ' is unsupported');
    }
    return clampSlider(value);
  }

  function nearestLabel(value) {
    validateSlider(value);
    var best = ANCHORS[0];
    var bestDistance = Math.abs(value - best.v);
    for (var index = 1; index < ANCHORS.length; index++) {
      var distance = Math.abs(value - ANCHORS[index].v);
      if (distance < bestDistance) {
        best = ANCHORS[index];
        bestDistance = distance;
      }
    }
    return best.label;
  }

  function formatReadout(value) {
    return nearestLabel(clampSlider(value));
  }

  function sliderFillPercent(value) {
    return (clampSlider(value) / MAX_SLIDER) * 100;
  }

  function chipValues() {
    return ANCHORS.map(function (anchor) { return [anchor.label, anchor.v]; });
  }

  root.TouchBrushScale = {
    version: VERSION,
    legacyVersion: LEGACY_VERSION,
    maxSlider: MAX_SLIDER,
    defaultSlider: DEFAULT_SLIDER,
    anchors: ANCHORS.slice(),
    validateSlider: validateSlider,
    clampSlider: clampSlider,
    padFracFromSlider: padFracFromSlider,
    sliderFromPadFrac: sliderFromPadFrac,
    legacyPadFracFromSlider: legacyPadFracFromSlider,
    remapLegacySlider: remapLegacySlider,
    resolvePresetSlider: resolvePresetSlider,
    formatReadout: formatReadout,
    sliderFillPercent: sliderFillPercent,
    chipValues: chipValues,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.TouchBrushScale;
})(typeof window !== 'undefined' ? window : globalThis);
