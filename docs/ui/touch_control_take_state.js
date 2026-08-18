/* Deterministic Spatial TAKE state machine.
 *
 * The page owns recording and UI; the wire adapter owns authoritative output
 * acknowledgement. This module owns the boundary between them so timer drift,
 * stale callbacks, and a late lift cannot create a ghost playback contact.
 */
(function installTouchTakeState(root) {
  'use strict';

  var MAX_POINTS = 4000;

  function finiteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
  }

  function validatePointTuple(tuple, index, previousTime) {
    if (!Array.isArray(tuple) || tuple.length !== 4) {
      throw new Error('TAKE point ' + index + ' must be [timeMs,u,v,down]');
    }
    var timeMs = Number(tuple[0]);
    var u = Number(tuple[1]);
    var v = Number(tuple[2]);
    var down = tuple[3];
    if (!finiteNumber(timeMs) || timeMs < 0 || timeMs < previousTime) {
      throw new Error('TAKE point ' + index + ' has a non-monotonic timestamp');
    }
    if (!finiteNumber(u) || !finiteNumber(v) || u < 0 || u > 1 || v < 0 || v > 1) {
      throw new Error('TAKE point ' + index + ' has coordinates outside 0..1');
    }
    if (down !== 0 && down !== 1 && down !== false && down !== true) {
      throw new Error('TAKE point ' + index + ' has an invalid contact state');
    }
    return { t: timeMs, u: u, v: v, down: !!down };
  }

  function validateTake(list) {
    if (!Array.isArray(list)) throw new Error('TAKE must be an array');
    if (list.length > MAX_POINTS) throw new Error('TAKE exceeds the 4000-point safety limit');
    if (!list.length) return [];
    var points = [];
    var previousTime = -1;
    for (var index = 0; index < list.length; index++) {
      var point = validatePointTuple(list[index], index, previousTime);
      points.push(point);
      previousTime = point.t;
    }
    if (points[points.length - 1].down) {
      throw new Error('TAKE must end with an explicit contact-up point');
    }
    var origin = points[0].t;
    points.forEach(function (point) { point.t -= origin; });
    return points;
  }

  function create(options) {
    options = options || {};
    var now = options.now || function () { return performance.now(); };
    var schedule = options.schedule || function (fn, delay) { return setTimeout(fn, delay); };
    var cancel = options.cancel || function (id) { clearTimeout(id); };
    var emitSample = options.emitSample;
    var eligibility = options.eligibility || function () { return { ok: true }; };
    var onState = options.onState || function () {};
    var onError = options.onError || function () {};
    if (typeof emitSample !== 'function') throw new Error('TAKE emitSample adapter is required');

    var points = [];
    var phase = 'empty';
    var generation = 0;
    var timer = null;
    var index = 0;
    var loop = false;
    var loopCount = 0;
    var playbackOrigin = 0;
    var recordOrigin = null;
    // A rejected acknowledgement does not prove that the engine rejected the
    // write. Once a down write is attempted, conservatively require a
    // confirmed up before treating output as safe.
    var contactMayBeDown = false;
    var lastOutputPoint = null;
    var inFlight = null;
    var settlePromise = null;
    var lastError = null;

    function durationMs() {
      return points.length ? points[points.length - 1].t : 0;
    }

    function snapshot() {
      return {
        phase: phase,
        count: points.length,
        durationMs: durationMs(),
        playing: phase === 'playing' || phase === 'looping',
        recording: phase === 'recording',
        loop: phase === 'looping',
        loopCount: loopCount,
        index: index,
        generation: generation,
        contactDown: contactMayBeDown,
        lastError: lastError,
      };
    }

    function publish() { onState(snapshot()); }

    function fail(error) {
      var normalized = error instanceof Error ? error : new Error(String(error));
      lastError = normalized.message;
      phase = 'error';
      publish();
      onError(normalized);
      return normalized;
    }

    function requireEligible(operation) {
      var result = eligibility(operation);
      if (result === true || (result && result.ok === true)) return;
      var reason = result && result.reason ? result.reason : 'Live Touch is not ready';
      throw new Error('TAKE ' + operation + ' refused: ' + reason);
    }

    function clearTimer() {
      if (timer === null) return;
      cancel(timer);
      timer = null;
    }

    function send(point, meta) {
      lastOutputPoint = { u: point.u, v: point.v };
      if (point.down) contactMayBeDown = true;
      var operation = Promise.resolve().then(function () {
        return emitSample({ u: point.u, v: point.v, down: point.down }, meta);
      }).then(function (value) {
        if (!point.down) contactMayBeDown = false;
        return value;
      });
      inFlight = operation;
      return operation.finally(function () {
        if (inFlight === operation) inFlight = null;
      });
    }

    function scheduleNext(runGeneration) {
      if (runGeneration !== generation || (phase !== 'playing' && phase !== 'looping')) return;
      if (index >= points.length) {
        if (!loop) {
          phase = points.length ? 'ready' : 'empty';
          publish();
          return;
        }
        index = 0;
        loopCount += 1;
        playbackOrigin = Math.max(playbackOrigin + Math.max(durationMs(), 1), now());
        publish();
      }
      var point = points[index];
      var delay = Math.max(0, playbackOrigin + point.t - now());
      timer = schedule(function () {
        timer = null;
        if (runGeneration !== generation) return;
        send(point, {
          kind: 'playback', generation: runGeneration, index: index,
          loop: loop, loopCount: loopCount,
        }).then(function () {
          if (runGeneration !== generation) return;
          index += 1;
          publish();
          scheduleNext(runGeneration);
        }).catch(function (error) {
          if (runGeneration !== generation) return;
          var playbackError = new Error('TAKE playback output failed: ' + error.message);
          // Cancel this generation before recovery so no later frame can race
          // the mandatory ordered lift. The terminal error is exposed only
          // after output is confirmed safe (or the lift itself fails loudly).
          settleOutput('playback-failure').then(function () {
            fail(playbackError);
          }).catch(function () {
            /* settleOutput already published the terminal lift failure. */
          });
        });
      }, delay);
    }

    function settleOutput(reason) {
      if (settlePromise) return settlePromise;
      generation += 1;
      clearTimer();
      phase = 'settling';
      publish();
      settlePromise = Promise.resolve(inFlight).catch(function () {
        /* The ordered lift below is still required after a failed down sample. */
      }).then(function () {
        if (!contactMayBeDown) return null;
        var last = lastOutputPoint
          || points[Math.max(0, Math.min(index, points.length - 1))]
          || { u: 0, v: 0 };
        return send({ u: last.u, v: last.v, down: false }, {
          kind: 'settle', reason: reason || 'stop', generation: generation,
        });
      }).then(function () {
        contactMayBeDown = false;
        phase = points.length ? 'ready' : 'empty';
        publish();
      }).catch(function (error) {
        throw fail(new Error('TAKE could not settle output: ' + error.message));
      }).finally(function () { settlePromise = null; });
      return settlePromise;
    }

    function stopRecording() {
      if (phase !== 'recording') return false;
      if (points.length && points[points.length - 1].down) {
        var last = points[points.length - 1];
        if (points.length < MAX_POINTS) {
          points.push({ t: last.t, u: last.u, v: last.v, down: false });
        } else {
          points[points.length - 1] = { t: last.t, u: last.u, v: last.v, down: false };
        }
      }
      phase = points.length ? 'ready' : 'empty';
      recordOrigin = null;
      publish();
      return true;
    }

    function startRecording() {
      try { requireEligible('REC'); } catch (error) { fail(error); return Promise.reject(error); }
      return settleOutput('record-start').then(function () {
        points = [];
        recordOrigin = null;
        loopCount = 0;
        lastError = null;
        phase = 'recording';
        publish();
      });
    }

    function recordPoint(u, v, down) {
      if (phase !== 'recording') return false;
      if (!finiteNumber(u) || !finiteNumber(v) || u < 0 || u > 1 || v < 0 || v > 1) {
        fail(new Error('TAKE record sample has coordinates outside 0..1'));
        return false;
      }
      var sampleNow = now();
      if (recordOrigin === null) recordOrigin = sampleNow;
      if (points.length >= MAX_POINTS) {
        stopRecording();
        fail(new Error('TAKE recording stopped at the 4000-point safety limit'));
        return false;
      }
      points.push({ t: sampleNow - recordOrigin, u: u, v: v, down: !!down });
      publish();
      return true;
    }

    function play(wantLoop) {
      try {
        requireEligible(wantLoop ? 'LOOP' : 'PLAY');
        if (!points.length) throw new Error('TAKE ' + (wantLoop ? 'LOOP' : 'PLAY') + ' refused: buffer is empty');
      } catch (error) {
        fail(error);
        return Promise.reject(error);
      }
      if (phase === 'recording') stopRecording();
      return settleOutput('play-switch').then(function () {
        requireEligible(wantLoop ? 'LOOP' : 'PLAY');
        generation += 1;
        index = 0;
        loop = !!wantLoop;
        loopCount = 0;
        playbackOrigin = now();
        lastError = null;
        phase = loop ? 'looping' : 'playing';
        publish();
        scheduleNext(generation);
      }).catch(function (error) {
        if (phase !== 'error') fail(error);
        throw error;
      });
    }

    function stop(reason) {
      if (phase === 'recording') {
        stopRecording();
        return Promise.resolve();
      }
      if (phase !== 'playing' && phase !== 'looping' && phase !== 'settling' && !contactMayBeDown) {
        return Promise.resolve();
      }
      return settleOutput(reason || 'operator-stop');
    }

    function clear() {
      if (phase === 'recording') stopRecording();
      return settleOutput('clear').then(function () {
        points = [];
        index = 0;
        loop = false;
        loopCount = 0;
        recordOrigin = null;
        lastError = null;
        phase = 'empty';
        publish();
      });
    }

    function replace(list) {
      var validated;
      try { validated = validateTake(list); } catch (error) { fail(error); throw error; }
      if (phase === 'playing' || phase === 'looping' || phase === 'settling' || contactMayBeDown) {
        throw fail(new Error('TAKE cannot load while output is active; stop it first'));
      }
      points = validated;
      index = 0;
      loop = false;
      loopCount = 0;
      recordOrigin = null;
      lastError = null;
      phase = points.length ? 'ready' : 'empty';
      publish();
    }

    function exportTake() {
      return points.map(function (point) {
        return [Math.round(point.t), +point.u.toFixed(4), +point.v.toFixed(4), point.down ? 1 : 0];
      });
    }

    publish();
    return {
      startRecording: startRecording,
      stopRecording: stopRecording,
      recordPoint: recordPoint,
      play: play,
      stop: stop,
      clear: clear,
      replace: replace,
      exportTake: exportTake,
      state: snapshot,
      limits: { maxPoints: MAX_POINTS },
    };
  }

  var api = { create: create, validateTake: validateTake, maxPoints: MAX_POINTS };
  root.TouchTakeState = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
