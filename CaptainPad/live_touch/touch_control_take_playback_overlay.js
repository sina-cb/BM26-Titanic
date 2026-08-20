/* Display-only TAKE playback overlay for the Spatial pad.
 *
 * Observes the page-owned `spatialplay` stream before the wire adapter turns
 * samples into engine writes. Never mutates playback payloads, never touches
 * takeOutputForContact, and never adds engine traffic.
 */
(function installTouchTakePlaybackOverlay(root) {
  'use strict';

  var PLAYBACK_PREFIX = 'take-playback-';
  var MAX_SLOTS = 4;
  var MAX_PATH = 120;
  var MARKER_RADIUS_PX = 11;
  var PATH_WIDTH_PX = 2.5;

  var SLOT_COLORS = [
    { stroke: 'rgba(255, 120, 196, 0.92)', fill: 'rgba(255, 120, 196, 0.18)', path: 'rgba(255, 120, 196, 0.34)' },
    { stroke: 'rgba(88, 214, 255, 0.92)', fill: 'rgba(88, 214, 255, 0.18)', path: 'rgba(88, 214, 255, 0.34)' },
    { stroke: 'rgba(255, 216, 77, 0.92)', fill: 'rgba(255, 216, 77, 0.18)', path: 'rgba(255, 216, 77, 0.34)' },
    { stroke: 'rgba(144, 255, 170, 0.92)', fill: 'rgba(144, 255, 170, 0.18)', path: 'rgba(144, 255, 170, 0.34)' },
  ];

  function fail(message) {
    root.document.dispatchEvent(new root.CustomEvent('panelerror', {
      detail: { message: message },
    }));
    throw new Error(message);
  }

  function parseSlotIndex(contactKey) {
    if (typeof contactKey !== 'string' || contactKey.indexOf(PLAYBACK_PREFIX) !== 0) {
      throw new Error('playback overlay contactKey must use ' + PLAYBACK_PREFIX);
    }
    var index = Number(contactKey.slice(PLAYBACK_PREFIX.length));
    if (!Number.isInteger(index) || index < 0 || index >= MAX_SLOTS) {
      throw new Error('playback overlay slot index out of range for ' + contactKey);
    }
    return index;
  }

  function emptySlot(index) {
    return {
      index: index,
      contactKey: PLAYBACK_PREFIX + index,
      active: false,
      u: 0,
      v: 0,
      path: [],
      sawPenUp: false,
      looping: false,
    };
  }

  function create(options) {
    options = options || {};
    var pad = options.pad;
    var canvas = options.canvas;
    if (!pad || !canvas) throw new Error('TAKE playback overlay requires pad and canvas elements');

    var ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('TAKE playback overlay canvas is not 2d-capable');

    var slots = [];
    for (var bootIndex = 0; bootIndex < MAX_SLOTS; bootIndex++) {
      slots.push(emptySlot(bootIndex));
    }

    var raf = null;
    var drawCount = 0;

    function slotByKey(contactKey) {
      var index = parseSlotIndex(contactKey);
      return slots[index];
    }

    var lastBankPhases = ['empty', 'empty', 'empty', 'empty'];

    function syncBankPhases() {
      var runtime = root.TouchTakeBankRuntime;
      if (!runtime || typeof runtime.state !== 'function') return;
      var state = runtime.state();
      if (!state || !Array.isArray(state.slots)) return;
      state.slots.forEach(function (entry) {
        if (!Number.isInteger(entry.index) || entry.index < 0 || entry.index >= MAX_SLOTS) return;
        var slot = slots[entry.index];
        slot.looping = entry.phase === 'looping';
        var wasActive = lastBankPhases[entry.index] === 'playing'
          || lastBankPhases[entry.index] === 'looping';
        var isActive = entry.phase === 'playing' || entry.phase === 'looping';
        if (wasActive && !isActive) resetSlot(slot, 'bank-idle');
        lastBankPhases[entry.index] = entry.phase;
      });
    }

    function resetSlot(slot, reason) {
      slot.active = false;
      slot.path = [];
      slot.sawPenUp = false;
      slot.looping = false;
      slot.lastReason = reason || 'reset';
    }

    function clearAll(reason) {
      slots.forEach(function (slot) { resetSlot(slot, reason || 'clear-all'); });
      scheduleDraw(true);
    }

    function validateSample(detail) {
      if (!detail || typeof detail !== 'object') fail('playback overlay sample is missing');
      if (detail.kind !== 'playback') fail('playback overlay refused a non-playback sample');
      var contactKey = detail.contactKey;
      parseSlotIndex(contactKey);
      var u = Number(detail.u);
      var v = Number(detail.v);
      if (!Number.isFinite(u) || !Number.isFinite(v) || u < 0 || u > 1 || v < 0 || v > 1) {
        fail('playback overlay sample has invalid normalized coordinates');
      }
      if (typeof detail.down !== 'boolean') {
        fail('playback overlay sample is missing a boolean down flag');
      }
      return { contactKey: contactKey, u: u, v: v, down: detail.down };
    }

    function pushPathPoint(slot, u, v) {
      var last = slot.path[slot.path.length - 1];
      if (last && Math.hypot(last.u - u, last.v - v) < 0.002) {
        last.u = u;
        last.v = v;
        return;
      }
      slot.path.push({ u: u, v: v });
      if (slot.path.length > MAX_PATH) slot.path.shift();
    }

    function observeSample(detail) {
      syncBankPhases();
      var sample = validateSample(detail);
      var slot = slotByKey(sample.contactKey);
      if (sample.down) {
        if (slot.sawPenUp && slot.looping) {
          slot.path = [];
        }
        slot.active = true;
        slot.sawPenUp = false;
        slot.u = sample.u;
        slot.v = sample.v;
        pushPathPoint(slot, sample.u, sample.v);
      } else {
        slot.u = sample.u;
        slot.v = sample.v;
        pushPathPoint(slot, sample.u, sample.v);
        slot.sawPenUp = true;
        if (!slot.looping) resetSlot(slot, 'play-complete');
        else slot.active = false;
      }
      scheduleDraw(false);
    }

    function padSize() {
      var rect = pad.getBoundingClientRect();
      return { w: rect.width || 1, h: rect.height || 1 };
    }

    function toCanvasPoint(u, v, width, height) {
      return { x: u * width, y: v * height };
    }

    function drawMarker(context, point, palette) {
      context.beginPath();
      context.fillStyle = palette.fill;
      context.arc(point.x, point.y, MARKER_RADIUS_PX + 3, 0, Math.PI * 2);
      context.fill();
      context.lineWidth = 2;
      context.strokeStyle = palette.stroke;
      context.beginPath();
      context.arc(point.x, point.y, MARKER_RADIUS_PX, 0, Math.PI * 2);
      context.stroke();
      context.fillStyle = '#ffffff';
      context.beginPath();
      context.arc(point.x, point.y, 3.5, 0, Math.PI * 2);
      context.fill();
    }

    function drawPath(context, slot, palette, width, height) {
      if (slot.path.length < 2) return;
      context.lineWidth = PATH_WIDTH_PX;
      context.lineCap = 'round';
      context.lineJoin = 'round';
      context.strokeStyle = palette.path;
      context.beginPath();
      var first = toCanvasPoint(slot.path[0].u, slot.path[0].v, width, height);
      context.moveTo(first.x, first.y);
      for (var index = 1; index < slot.path.length; index++) {
        var point = toCanvasPoint(slot.path[index].u, slot.path[index].v, width, height);
        context.lineTo(point.x, point.y);
      }
      context.stroke();
    }

    function drawFrame(forceClear) {
      raf = null;
      drawCount++;
      var size = padSize();
      if (!size.w || !size.h) return;
      var dpr = root.devicePixelRatio || 1;
      var pixelWidth = Math.round(size.w * dpr);
      var pixelHeight = Math.round(size.h * dpr);
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size.w, size.h);
      if (forceClear) return;

      slots.forEach(function (slot) {
        if (!slot.path.length && !slot.active) return;
        var palette = SLOT_COLORS[slot.index];
        drawPath(ctx, slot, palette, size.w, size.h);
        if (slot.active || slot.path.length) {
          drawMarker(ctx, toCanvasPoint(slot.u, slot.v, size.w, size.h), palette);
        }
      });
    }

    function scheduleDraw(forceClear) {
      if (raf !== null) return;
      raf = root.requestAnimationFrame(function () { drawFrame(forceClear); });
    }

    function onSpatialPlay(event) {
      var detail = event.detail || {};
      /* Settle and other non-display samples share the spatialplay bus with
         playback frames. Ignore them here — only malformed playback samples
         fail loudly so stop/clear never emit panelerror. */
      if (detail.kind !== 'playback') return;
      observeSample(detail);
    }

    function onTransportState(event) {
      var detail = event.detail || {};
      if (detail.leaseAcquired === false || detail.armed === false) clearAll('transport');
    }

    root.document.addEventListener('spatialplay', onSpatialPlay);
    root.document.addEventListener('spatialcontactclear', function () { clearAll('spatialcontactclear'); });
    root.document.addEventListener('touchtransportstate', onTransportState);
    root.document.addEventListener('visibilitychange', function () {
      if (root.document.hidden) clearAll('visibility-hidden');
    });
    root.addEventListener('pagehide', function () { clearAll('pagehide'); });

    var takeSlots = root.document.getElementById('takeSlots');
    if (takeSlots && root.MutationObserver) {
      new root.MutationObserver(function () { syncBankPhases(); scheduleDraw(false); })
        .observe(takeSlots, { attributes: true, subtree: true, attributeFilter: ['class'] });
    }

    return {
      clearAll: clearAll,
      observeSample: observeSample,
      state: function () {
        return slots.map(function (slot) {
          return {
            index: slot.index,
            contactKey: slot.contactKey,
            active: slot.active,
            u: slot.u,
            v: slot.v,
            pathLength: slot.path.length,
            looping: slot.looping,
            sawPenUp: slot.sawPenUp,
          };
        });
      },
      drawCount: function () { return drawCount; },
      destroy: function () {
        if (raf !== null) root.cancelAnimationFrame(raf);
        clearAll('destroy');
      },
    };
  }

  root.TouchTakePlaybackOverlay = {
    playbackPrefix: PLAYBACK_PREFIX,
    maxSlots: MAX_SLOTS,
    slotColors: SLOT_COLORS.slice(),
    create: create,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.TouchTakePlaybackOverlay;
})(typeof window !== 'undefined' ? window : globalThis);
