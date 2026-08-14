/* ────────────────────────────────────────────────────────────────────────────
   touch_control_wire.js — connects the #44 Touch Control prototype to the
   REAL marsin engine.

   Design rules this file obeys:

   1. NO FALLBACK BEHAVIOURS (codex P0). Every request that fails is surfaced
      in the status pill and logged. Nothing silently degrades, and no control
      pretends to have worked.

   2. NOTHING WRITES UNTIL ARMED. The rig is a real installation. `armed`
      starts false and every send() is refused while it is false, so opening
      this page cannot change the show.

   3. WRITES ARE COALESCED. Continuous local controls use
      `POST /layers/live_touch/control`; shared controls remain bounded too. A
      raw drag at 60fps would compete with the 40fps render thread.
      Every continuous control goes through send() which keeps only the LATEST
      value per key and flushes on an interval.

   4. CAPABILITY IS CHECKED, NOT ASSUMED, AND FROM THE RIGHT SOURCE.
      Live Touch stages its own pattern and reads its own exports through
      `/layers/live_touch/*`. It never borrows the Deck channel or substitutes
      an overlay when its own layer is unavailable.
   ──────────────────────────────────────────────────────────────────────────── */

(function () {
  'use strict';

  var ENGINE = 'http://' + location.hostname + ':6968';
  var FLUSH_MS = 100;          /* 10 writes/sec ceiling per key */
  /* Drawing is a FINGER, not a fader — see sendDraw(). 33 ms is ~30 samples a
     second, just under the engine's 40 fps, so nothing is generated that the
     engine would only discard. */
  var DRAW_FLUSH_MS = 33;
  var POLL_MS = 2000;
  /* Every Layers switch uses the engine's one canonical linear blend.
     Live Touch must not add a private dip/fade around that operation. */
  var LAYER_TRANSITION_MS = 100;
  /* THE SAME RULE, APPLIED TO THE XY MASTER AXIS. Operator: "the xy mode cannot
     go dark on full left on the panel, the floor must be at 5%, never dark on
     that panel." X drove the grand master straight from the pad fraction, so
     the far-left edge of a control the operator sweeps mid-song sent master 0 —
     a dark ship, reachable by one careless drag, on the one panel with no undo.
     The axis is RESCALED into [floor, 1] rather than clamped: a clamp would
     make the bottom 5% of the travel dead and identical, whereas rescaling
     keeps the whole sweep live and puts exactly the floor at the far left.
     A blackout must stay an explicit, deliberate act — it is not something a
     performance fader is allowed to do by accident.
     THE VALUE LIVES PAGE-SIDE now (audit medium: it was duplicated here and in
     the page with only a comment pairing them). The page owns the pad and the
     readout, so it owns the number; this reads the export and fails loudly if
     the page ever stops providing it — a missing floor must never quietly
     become "no floor". */
  function xyMasterFloor() {
    var f = window.XY_MASTER_FLOOR;
    if (typeof f !== 'number' || !(f > 0 && f < 1)) {
      fail('xy', 'the page did not export XY_MASTER_FLOOR — refusing to drive the master without a floor');
      return null;
    }
    return f;
  }

  var state = {
    armed: false,
    phase: 'idle',
    online: false,
    channelId: null,
    channelPattern: null,
    exports: {},               /* name -> numeric id */
    sectionIds: {},            /* group name -> sectionId */
    dimmers: {},
    liveBrightnessRevision: null,
    rackBrightnessRevision: null,
    rackCeilings: {},
    liveEffectiveCaps: {},
    sessionRevision: null,
    groupProfilesReady: false,
    lastError: null,
  };

  /* ── status pill ────────────────────────────────────────────────────── */
  var pill = document.createElement('div');
  pill.id = 'wireStatus';
  pill.style.cssText =
    'position:fixed;left:10px;bottom:10px;z-index:9999;padding:5px 11px;' +
    'border-radius:999px;font:700 11px/1.2 Inter,system-ui,sans-serif;' +
    'letter-spacing:.04em;border:1px solid rgba(255,255,255,.18);' +
    'background:rgba(8,13,24,.94);color:#8fa3c4;pointer-events:none;white-space:nowrap';
  /* ATTACHED ONLY WHILE SOMETHING IS WRONG.
     This pill used to be permanently on screen, restating a state the ARM
     control already says in words in the header, and the operator had it
     removed for covering the surface. It was then detached ENTIRELY - which
     meant every failure the wire is carefully built to report went nowhere but
     the console. On an iPad there is no console: an arm that half-failed, a
     fade that never landed, a hung takeover all presented as "the ship just
     went dark for no reason".

     So it is now an ERROR TOAST, not a status bubble: absent while things are
     fine, attached and loud the moment something fails, gone again when the
     next call succeeds. The operator gets their uncluttered surface AND the
     failures stop being silent. */
  var pillAttached = false;

  function showPill(on) {
    if (on === pillAttached) return;
    if (on) { document.body.appendChild(pill); }
    else if (pill.parentNode) { pill.parentNode.removeChild(pill); }
    pillAttached = on;
  }

  function setStatus() {
    if (state.lastError) {
      /* ONLY the error. The header already carries armed/engine state, and a
         toast that buries the fault among three other fields is one the
         operator learns to ignore. */
      pill.textContent = '⚠ ' + state.lastError;
      pill.style.color = '#ff8f8f';
      pill.style.borderColor = 'rgba(255,120,120,.5)';
      pill.style.background = 'rgba(40,8,12,.96)';
      showPill(true);
      return;
    }
    /* ENGINE OFFLINE is also worth a toast: every control silently does
       nothing while the socket is down, which looks identical to a dead rig. */
    if (!state.online) {
      pill.textContent = '○ ENGINE OFFLINE — controls are not reaching the ship';
      pill.style.color = '#ffb84d';
      pill.style.borderColor = 'rgba(255,184,77,.5)';
      pill.style.background = 'rgba(8,13,24,.96)';
      showPill(true);
      return;
    }
    showPill(false);
  }

  var lastFailAt = 0;
  function fail(what, err) {
    state.lastError = what + ': ' + (err && err.message ? err.message : err);
    lastFailAt = Date.now();
    console.error('[wire]', what, err);
    setStatus();
  }
  /* HOLD THE ERROR LONG ENOUGH TO READ (audit medium). clearError fires on any
     successful write, so one healthy request wiped the pill while a whole
     CLASS of writes kept failing — the operator saw a flicker at best. An
     error now owns the pill for 5 s; a persistent failure re-stamps itself
     faster than that, so real trouble stays visible and a one-off clears. */
  function clearError() {
    if (!state.lastError) return;
    if (Date.now() - lastFailAt < 5000) return;
    state.lastError = null; setStatus();
  }

  document.addEventListener('panelerror', function (event) {
    fail('panel', event.detail && event.detail.message ? event.detail.message : 'page state is invalid');
  });

  /* ── transport ──────────────────────────────────────────────────────── */
  /* EVERY REQUEST IS BOUNDED. This was a bare fetch with no timeout, and this
     file documents (twice, from measurement) that concurrent writes from this
     page to this engine can HANG AND NEVER RETURN. An unbounded fetch inside a
     promise chain means the chain never settles — which is the root of the arm
     deadline needing to be a RACE at all, and of a hung takeover leaving the
     ship dimmed with the fade-up sitting behind a request that will never come
     back. A request that has not answered in REQ_TIMEOUT_MS is a failure; it is
     reported as one instead of silently stalling the show. */
  var REQ_TIMEOUT_MS = 6000;

  function requestJson(method, path, body, ownerTagged) {
    var opts = { method: method, headers: {} };
    if (ownerTagged) opts.headers['X-Touch-Control-Owner'] = OWNER;
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    var ctl = (typeof AbortController === 'function') ? new AbortController() : null;
    if (ctl) opts.signal = ctl.signal;
    var timer = setTimeout(function () {
      if (ctl) { try { ctl.abort(); } catch (e) { /* already settled */ } }
    }, REQ_TIMEOUT_MS);
    return fetch(ENGINE + path, opts).then(function (r) {
      if (!r.ok) {
        return r.text().then(function (t) {
          throw new Error(method + ' ' + path + ' → ' + r.status + ' ' + t.slice(0, 120));
        });
      }
      return r.status === 204 ? null : r.json().catch(function () { return null; });
    }).catch(function (e) {
      if (e && e.name === 'AbortError') {
        throw new Error(method + ' ' + path + ' → no response in ' + REQ_TIMEOUT_MS + 'ms (timed out)');
      }
      throw e;
    }).then(
      function (v) { clearTimeout(timer); return v; },
      function (e) { clearTimeout(timer); throw e; }
    );
  }

  var prepareOperations = null;
  function req(method, path, body) {
    if (prepareOperations && method !== 'GET') {
      prepareOperations.push({ method: method, path: path, body: body === undefined ? {} : body });
      return Promise.resolve({ status: 'queued-for-prepare' });
    }
    return requestJson(method, path, body, true);
  }

  /* Deck and Mixer are public layer-setting operations when Live Touch does
     not own a lease. Sending an owner header after release is not harmless:
     the engine correctly rejects stale owner-tagged mutations. */
  function unownedReq(method, path, body) {
    return requestJson(method, path, body, false);
  }

  /* Writes are REFUSED while disarmed — that is the safety, not a courtesy. */
  function write(method, path, body) {
    if (state.phase !== 'armed') return Promise.resolve(null);
    return req(method, path, body).then(function (v) { clearError(); return v; })
      .catch(function (e) { fail('write', e); return null; });
  }

  /* ARM assertions are a different contract from live, coalesced writes. A
     failed assertion must reject the ARM chain; converting it to null would let
     the panel fade up while the engine still holds stale state. */
  function strictWrite(method, path, body) {
    if (state.phase !== 'arming' && state.phase !== 'armed') {
      return Promise.reject(new Error('refusing ' + method + ' ' + path + ' without a Live Touch lease'));
    }
    return req(method, path, body).then(function (v) { clearError(); return v; });
  }

  function liveStateCanWrite(strict) {
    return state.phase === 'armed' || (strict === true && state.phase === 'arming');
  }

  /* ── coalescing queue ───────────────────────────────────────────────── */
  var pending = {};            /* key -> function that performs the write */
  var flushTimer = null;

  function send(key, fn) {
    pending[key] = fn;
    if (flushTimer) return;
    flushTimer = setInterval(function () {
      var keys = Object.keys(pending);
      if (!keys.length) { clearInterval(flushTimer); flushTimer = null; return; }
      keys.forEach(function (k) { var f = pending[k]; delete pending[k]; f(); });
    }, FLUSH_MS);
  }

  /* ── the DRAWING queue, which runs faster than everything else ──────────
     Operator: the pad "is not sensative enough". Every control on this panel
     shared one 100 ms flush — ten samples a second. For a fader that is plenty
     and deliberately kind to the engine; for a FINGER it is not. A hand crossing
     the pad in half a second was being described by five points, so the stroke
     lagged the finger and fine movement simply vanished between samples.
     Drawing gets its own queue at DRAW_FLUSH_MS. It is still coalesced — the
     newest position wins, so a slow network can never build a backlog of stale
     points — just sampled about three times as often, which is close enough to
     the engine's own 40 fps that the extra would be thrown away anyway. */
  var drawPending = null, drawTimer = null, drawFrame = null, drawLastSentAt = 0;
  /* IN-FLIGHT BACKPRESSURE (audit medium): the 33 ms flush used to fire
     regardless of whether the PREVIOUS /spatial-paint had answered, so a slow
     link (iPad wifi at the show) accumulated concurrent POSTs — the exact
     write pattern this file documents as having wedged the engine. One draw
     write in flight at a time; last-writer-wins already holds the newest
     sample, so nothing is lost by waiting a beat. */
  var drawInFlight = false;
  function scheduleDrawPump() {
    if (drawFrame !== null || drawTimer !== null || !drawPending || drawInFlight) return;
    drawFrame = requestAnimationFrame(function () {
      drawFrame = null;
      if (!drawPending || drawInFlight) return;
      var wait = DRAW_FLUSH_MS - (performance.now() - drawLastSentAt);
      if (!drawPending.final && wait > 0) {
        drawTimer = setTimeout(function () { drawTimer = null; scheduleDrawPump(); }, wait);
        return;
      }
      var item = drawPending;
      drawPending = null;
      drawInFlight = true;
      drawLastSentAt = performance.now();
      var promise;
      try { promise = item.fn(); }
      catch (error) {
        drawInFlight = false;
        fail('spatial draw', error);
        scheduleDrawPump();
        return;
      }
      Promise.resolve(promise).then(function () {
        drawInFlight = false;
        scheduleDrawPump();
      }, function (error) {
        drawInFlight = false;
        fail('spatial draw', error);
        scheduleDrawPump();
      });
    });
  }

  function sendDraw(fn, finalSample) {
    drawPending = { fn: fn, final: finalSample === true };
    if (finalSample && drawTimer !== null) {
      clearTimeout(drawTimer);
      drawTimer = null;
    }
    scheduleDrawPump();
  }

  /* THE CHART MUST MATCH THE SHIP. The page SHA-256 verifies its generated
     geometry against pixel_map_views.yaml. This second gate verifies every
     live engine pixel identity + coordinate before ARM can take control. */
  var chartDriftChecked = false;
  function chartDriftCheck() {
    if (chartDriftChecked) return Promise.resolve(true);
    chartDriftChecked = true;
    if (!window.TouchPixelViews) {
      chartDriftChecked = false;
      fail('chart', 'PIXEL VIEW UNAVAILABLE: canonical view reader did not load');
      return Promise.resolve(false);
    }
    return Promise.all([
      window.TouchPixelViews.ready(),
      req('GET', '/model/pixel-layout'),
    ]).then(function (results) {
      return window.TouchPixelViews.verifyEngineLayout(results[1]);
    }).then(function () {
      return true;
    }).catch(function (error) {
      chartDriftChecked = false;
      fail('chart', error);
      return false;
    });
  }

  /* ── boot: learn the model and Live Touch's isolated channel ────────── */
  function refresh() {
    return Promise.all([
      req('GET', '/status'),
      req('GET', '/dimmer-groups'),
      req('GET', '/dimmers'),
      req('GET', '/layers/state'),
    ]).then(function (r) {
      var status = r[0], groups = r[1], dimmers = r[2], layerState = requireLayerState(r[3]);
      state.online = true;
      state.sectionIds = groups || {};
      state.dimmers = dimmers || {};
      state.channelPattern = layerState.liveTouch && layerState.liveTouch.pattern;
      if (!(layerState.liveTouch && layerState.liveTouch.ready)) {
        /* A fresh, DISARMED engine intentionally has no Live channel yet.
           Focusing the tab stays passive and online; ARM stages the selected
           pattern, then refreshes the authoritative exports. */
        state.exports = {};
      }
      chartDriftCheck();
      loadSlots();
      setStatus();
      return status;
    }).catch(function (e) {
      state.online = false;
      fail('refresh', e);
    });
  }

  function refreshLiveExports() {
    return req('GET', '/layers/live_touch/exports').then(function (exports) {
      if (!Array.isArray(exports) || !exports.length) {
        throw new Error('Live Touch staged pattern returned no exports');
      }
      state.exports = {};
      exports.forEach(function (entry) {
        if (entry && typeof entry.id === 'number') state.exports[entry.name] = entry.id;
      });
      applyCapability();
      return exports;
    });
  }

  function refreshGroupProfiles() {
    if (state.groupProfilesReady) return Promise.resolve(true);
    if (!window.TouchGroupProfiles || typeof window.TouchGroupProfiles.install !== 'function') {
      return Promise.reject(new Error('canonical group profile reader did not load'));
    }
    return req('GET', '/model/view-selection-options').then(function (catalog) {
      window.TouchGroupProfiles.install(catalog);
      state.groupProfilesReady = true;
      return true;
    }).catch(function (error) {
      state.groupProfilesReady = false;
      fail('group profiles', error);
      return false;
    });
  }

  /* The XY pad is only real on a pattern that exports the target sliders.
     Saying so beats letting the operator drag a pad that writes nothing —
     which is exactly the failure this check exists to prevent. */
  function applyCapability() {
    /* The owner-scoped spatial stage works on every staged Live pattern.
       Clear any stale capability overlay left by an older cached page. */
    var warn = document.getElementById('padCapWarn');
    if (warn) warn.remove();
  }

  /* ── ARM ────────────────────────────────────────────────────────────── */
  /* ARM owns only the Live Touch setting. It acquires the deadman lease,
     stages Live-local state, then asks the shared Layers router to blend into
     live_touch. Deck and Mixer keep their own patterns, faders and autopilots;
     this page neither captures nor mutates them. */
  var armAsserts = [];          /* awaited on arm: make the rig match the panel */
  var fxCatalogReady = false;   /* engine registry is authoritative; no stale built-in list */
  /* ONE HANDBACK STEP. Reports loudly, then RESOLVES so the handback continues.

     Why this exists: the disarm handback was a bare Promise.all of six req()s
     with no catch, and Promise.all rejects the instant ANY member does — so one
     slow request cancelled everything downstream of it. MEASURED: a disarm that
     sent only the first seven requests, then stopped. The group colours were
     never dropped, the effects never disabled, the spatial stroke never
     cleared, and the blackout release at the end of the chain never ran. The
     panel said DISARMED with a toast nobody reads while the rig kept obeying it.
     A later identical run completed all 36 requests, so this is a race, not a
     dead branch — which is worse, because it passes when you test it.

     Handback is a SAFETY operation: every step is independent, and a step that
     fails must cost only itself. This is not a silent fallback — fail() puts it
     on the status pill; it just refuses to let one casualty take the rest. */
  var handbackFailures = null;
  function handbackStep(label, p) {
    return p.catch(function (error) {
      fail('disarm/' + label, error);
      if (handbackFailures) handbackFailures.push(label + ': ' + error.message);
      return null;
    });
  }

  function abortArm(label, err) {
    armChainTarget = false;
    fail(label + ' - ABORTED', err);
    if (!armLeaseRequested && !armLeaseAcquired) {
      forceDisarmedUi();
      return Promise.resolve();
    }

    if (!armLeaseAcquired) {
      /* WebSocket frames are ordered. Sending release after a timed-out ARM
         request closes a lease even when its positive ACK was merely late. */
      return releaseArmLease().then(forceDisarmedUi).catch(function (releaseError) {
        fail(label + ' - LEASE RELEASE UNCONFIRMED', releaseError);
        throw releaseError;
      });
    }

    /* Once the lease exists, owner-tagged cleanup MUST precede its release.
       If activation was accepted before a later acknowledgement failed, first
       land the canonical Deck handback so no Live buffer remains visible. */
    setArmUiPhase('disarming');
    return req('GET', '/layers/state').then(requireLayerState).then(function (layerState) {
      var liveParticipates = layerState.active === 'live_touch'
        || layerState.target === 'live_touch'
        || (layerState.transition && (layerState.transition.from === 'live_touch'
          || layerState.transition.to === 'live_touch'));
      if (!liveParticipates) return null;
      return activateLayerSetting('deck', 'live_touch_arm_abort', true)
        .then(function () { return waitForLayerSetting('deck', 15000); });
    }).then(cleanupLiveState).then(releaseArmLease).then(function () {
      state.liveBrightnessRevision = null;
      forceDisarmedUi();
    }).catch(function (cleanupError) {
      fail(label + ' - ABORT CLEANUP INCOMPLETE', cleanupError);
      throw cleanupError;
    });
  }

  function runSeries(tasks) {
    return tasks.reduce(function (chain, task) {
      return chain.then(task);
    }, Promise.resolve());
  }

  function requireLayerState(value) {
    var ids = { deck: true, mixer: true, live_touch: true };
    if (!value || value.type !== 'layerSettings' || !ids[value.active] || !ids[value.target]) {
      throw new Error('engine returned an invalid layerSettings state');
    }
    if (value.queued !== null && !ids[value.queued]) {
      throw new Error('engine returned an invalid queued layer setting');
    }
    if (value.transition !== null && (!value.transition || !ids[value.transition.from]
      || !ids[value.transition.to] || typeof value.transition.progress !== 'number'
      || value.transition.progress < 0 || value.transition.progress > 1
      || value.transition.curve !== 'linear')) {
      throw new Error('engine returned an invalid layer transition');
    }
    if (!value.liveTouch || typeof value.liveTouch.armed !== 'boolean'
      || (value.liveTouch.ownerId !== null && typeof value.liveTouch.ownerId !== 'string')
      || typeof value.liveTouch.ready !== 'boolean'
      || (value.liveTouch.pattern !== null && typeof value.liveTouch.pattern !== 'string')) {
      throw new Error('engine returned an invalid Live Touch layer state');
    }
    return value;
  }

  function activateLayerSetting(target, reason, ownerRequired) {
    var transport = ownerRequired ? req : unownedReq;
    return transport('POST', '/layers/activate', {
      target: target,
      durationMs: LAYER_TRANSITION_MS,
      reason: reason,
      ownerId: ownerRequired ? OWNER : undefined,
    }).then(requireLayerState);
  }

  function waitForLayerSetting(target, timeoutMs) {
    var startedAt = Date.now();
    return new Promise(function (resolve, reject) {
      (function poll() {
        req('GET', '/layers/state').then(requireLayerState).then(function (layerState) {
          if (layerState.active === target && layerState.target === target
            && layerState.transition === null && layerState.queued === null) {
            resolve(layerState);
            return;
          }
          if (Date.now() - startedAt >= timeoutMs) {
            reject(new Error('layer transition to ' + target + ' did not land within ' + timeoutMs + 'ms'));
            return;
          }
          setTimeout(poll, 50);
        }).catch(reject);
      }());
    });
  }

  function stageSelectedLivePattern() {
    var selected = patSel && PATTERN_FILES && PATTERN_FILES[patSel.value];
    if (!selected) throw new Error('Live Touch has no valid selected pattern');
    return req('PUT', '/layers/live_touch/pattern', { pattern: selected }).then(function (response) {
      if (!response || !Number.isInteger(response.sessionRevision)) {
        throw new Error('Live Touch pattern stage returned no session revision');
      }
      state.sessionRevision = response.sessionRevision;
      state.channelPattern = selected;
      return refreshLiveExports();
    });
  }

  function parentOrigin() {
    var raw = new URL(location.href).searchParams.get('captainpad_origin');
    if (!raw) throw new Error('Live Touch is embedded without captainpad_origin');
    var parsed = new URL(raw);
    if (parsed.origin !== raw) throw new Error('captainpad_origin contains a path');
    return parsed.origin;
  }

  function acknowledgeSurfaceRelease(requestId, target) {
    if (!requestId) return;
    window.parent.postMessage({
      type: 'touch-control-surface-released',
      version: 1,
      requestId: requestId,
      target: target,
    }, parentOrigin());
  }

  function verifyArmReadiness() {
    if (!fxCatalogReady) {
      forceDisarmedUi();
      return Promise.reject(new Error(
        'the engine effect catalog is unavailable, so effect buttons cannot be trusted'
      ));
    }
    return chartDriftCheck().then(function (verified) {
      if (!verified || !window.TouchPixelViews || !window.TouchPixelViews.canArm()) {
        throw new Error('the canonical pixel view has not verified the current engine model');
      }
    });
  }

  function acquireArmLease() {
    return Promise.resolve().then(function () {
      armRefused = false;
      armAckPending = true;
      armLeaseRequested = true;
      if (!sendControl({ type: 'touchControlArmed', ownerId: OWNER, armed: true })) {
        armAckPending = false;
        armLeaseRequested = false;
        throw new Error('the control link is down; no deadman can watch Live Touch');
      }
      return waitForArmAck(1500);
    }).then(function () {
        if (armRefused) throw new Error('arm refused by the engine');
        if (armAckPending) {
          armAckPending = false;
          throw new Error('the engine did not acknowledge the deadman lease within 1.5 s');
        }
        return null;
    });
  }

  function waitForArmAck(timeoutMs) {
    return new Promise(function (resolve) {
      var waited = 0;
      (function poll() {
        if (!armAckPending || armRefused || waited >= timeoutMs) return resolve();
        waited += 50;
        setTimeout(poll, 50);
      })();
    });
  }

  function waitForDisarmAck(timeoutMs) {
    return new Promise(function (resolve) {
      var waited = 0;
      (function poll() {
        if (!disarmAckPending || waited >= timeoutMs) return resolve();
        waited += 50;
        setTimeout(poll, 50);
      })();
    });
  }

  function releaseArmLease() {
    disarmAckPending = true;
    if (!sendControl({ type: 'touchControlArmed', ownerId: OWNER, armed: false })) {
      disarmAckPending = false;
      return Promise.reject(new Error('the control link is down; Live Touch lease release was not sent'));
    }
    return waitForDisarmAck(1500).then(function () {
      if (disarmAckPending) {
        disarmAckPending = false;
        throw new Error('the engine did not acknowledge Live Touch lease release within 1.5 s');
      }
    });
  }

  function cleanupLiveState() {
    /* Live Touch owns these transient controls. Clear them after the shared
       Layers blend has landed; Deck and Mixer settings are never captured,
       muted, or restored by this surface. */
    if (handbackFailures !== null) {
      return Promise.reject(new Error('a second Live Touch cleanup started concurrently'));
    }
    handbackFailures = [];
    var openingSteps = [
      function () { return handbackStep('audio-bindings', req('POST', '/audio-bindings/clear', {})); },
      function () { return handbackStep('effect-groups', req('PUT', '/effect-groups', { groups: null })); },
      function () { return handbackStep('parked-groups', req('PUT', '/parked-groups', { groups: null })); },
    ];
    return runSeries(openingSteps).then(function () {
      /* DROP THE LIVE SPATIAL STROKE before releasing its in-memory context.
         req() carries the owner while the lease remains valid. */
      var cleanupTasks = [function () {
        return handbackStep('spatial-clear',
          req('POST', '/spatial-paint', { enabled: false, touch: false, clear: true }));
      }];
      /* STOP THE XY STROBE AND WALK (audit H5). They run under presetId
         'xy_pad' with no slot, so the disable-all below cannot see them —
         disarming mid-strobe used to hand the automatic show back permanently
         strobing. handbackStep so one failure cannot cancel the chain. */
      cleanupTasks.push(function () {
        return handbackStep('xy-strobe', req('POST', '/strobe-rate', { active: false }));
      });
      cleanupTasks.push(function () {
        return handbackStep('xy-walk', req('POST', '/movement-rate', { active: false }));
      });
      forgetSpatialCfg();   /* the engine no longer holds what we cached */
      /* Drop every painted group — the paint only exists because we armed. */
      var names = Object.keys(painted);
      names.forEach(function (nm) { delete painted[nm]; });
      names.forEach(function (nm) {
        cleanupTasks.push(function () {
          return handbackStep('group-paint/' + nm,
            req('DELETE', '/group-fixed-colors/' + encodeURIComponent(nm)));
        });
      });
      return runSeries(cleanupTasks);
    }).then(function () {
      /* Stop everything this panel started. Effects only run because the panel
         is armed, so releasing control must not leave them playing. */
      return handbackStep('disable-all', req('POST', '/global-effects/disable-all', {}));
    }).then(function () {
      /* Restore the seeded Live-session slot values before release. Durable
         Deck/Mixer/global presets are never touched by these owner-tagged calls. */
      return handbackStep('effect-colours', restoreEffectColours());
    }).then(function () {
      var failures = handbackFailures;
      handbackFailures = null;
      if (failures.length) {
        throw new Error('Live Touch cleanup incomplete: ' + failures.join('; '));
      }
      clearError();
    }, function (error) {
      handbackFailures = null;
      throw error;
    });
  }

  var armEl = document.getElementById('arm');
  /* Serialize ARM and destination handback. The same Layers transaction must
     never be raced by a second tap or a tab change. */
  var armChainBusy = false;
  var armChainTarget = false;
  var pendingSurfaceRelease = null;
  var surfaceHandoffBusy = false;
  var pageSessionInvalidated = false;
  var pageRestoreHandbackPending = false;

  function setArmUiPhase(phase) {
    var armed = phase === 'armed';
    state.phase = phase;
    state.armed = armed;
    if (armEl) {
      armEl.classList.toggle('is-armed', armed);
      armEl.setAttribute('aria-checked', String(armed));
    }
    var st = document.getElementById('armState');
    if (st) st.textContent = phase === 'arming' ? 'ARMING'
      : (phase === 'disarming' ? 'DISARMING' : (armed ? 'ARMED' : 'DISARMED'));
    var lk = document.getElementById('armLock');
    if (lk) lk.textContent = armed ? '🔓' : '🔒';
    var sh = document.getElementById('shell');
    if (sh) sh.classList.toggle('disarmed', !armed);
    setStatus();
  }

  function setArmedUi(t) {
    setArmUiPhase(t ? 'armed' : 'idle');
  }

  function assertArmPageSession() {
    if (pageSessionInvalidated) {
      throw new Error('Live Touch ARM was cancelled by page lifecycle');
    }
  }

  function collectEffectSlotBuildOperations() {
    if (!fxGrid) return Promise.reject(new Error('effect grid is missing'));
    var cells = Array.prototype.slice.call(fxGrid.querySelectorAll('.fx-cell'));
    var mine = {};
    cells.forEach(function (cell) { mine[Number(cell.dataset.slot)] = true; });
    var tasks = cells.map(function (cell) {
      return function () { return provisionCell(cell); };
    });
    for (var id = OURS_FROM; id <= MAX_SLOTS; id++) {
      if (!mine[id] && slotBinding[id]) {
        (function (slotId) {
          tasks.push(function () {
            return strictWrite('PATCH', '/global-effect-slots/' + slotId, { enabled: false });
          });
        }(id));
      }
    }
    return runSeries(tasks);
  }

  function collectStaticPrepareOperations() {
    var wanted = desiredStatic(true);
    Object.keys(wanted).forEach(function (name) {
      var value = wanted[name];
      prepareOperations.push({
        method: 'PUT',
        path: '/group-fixed-colors/' + encodeURIComponent(name),
        body: { color: value.color, colors: value.colors || undefined,
          brightness: 1, ownerId: OWNER },
      });
    });
    Object.keys(painted).forEach(function (name) {
      if (wanted[name]) return;
      prepareOperations.push({
        method: 'DELETE',
        path: '/group-fixed-colors/' + encodeURIComponent(name),
        body: {},
      });
    });
    return wanted;
  }

  function initialSpatialPrepareBody() {
    if (!window.TouchPixelViews || typeof window.TouchPixelViews.currentViewSpec !== 'function') {
      throw new Error('canonical pixel view cannot describe its engine projection');
    }
    var spec = window.TouchPixelViews.currentViewSpec();
    var fadeElement = document.getElementById('trailFade');
    var fadeSeconds = fadeElement ? Number(fadeElement.dataset.value) : NaN;
    if ([0.1, 0.5, 1, 1.5].indexOf(fadeSeconds) === -1) {
      throw new Error('FADE must be 0.1, 0.5, 1.0, or 1.5 seconds');
    }
    var brush = brushPatch();
    var amount = brushAmount();
    var modeElement = document.querySelector('#drawModes button.is-active');
    var modeValue = modeElement ? Number(modeElement.dataset.dm) : NaN;
    if (!brush || amount === null || !isFinite(modeValue)) {
      throw new Error('spatial brush controls are incomplete');
    }
    var ink = typeof window.inkColour === 'function' ? window.inkColour() : null;
    if (!ink || !isFinite(ink.h) || !isFinite(ink.s) || !isFinite(ink.v)) {
      throw new Error('spatial ink colour is unavailable');
    }
    return {
      enabled: true,
      touch: false,
      clear: true,
      mode: DRAW_MODES[Math.round(Math.min(Math.max(modeValue, 0), 1) * 3)],
      fadeSeconds: fadeSeconds,
      radius: brush.radius,
      radiusY: brush.radiusY,
      amount: amount,
      color: hsvToRgb6(ink.h, ink.s, ink.v),
      colorAlt: hsvToRgb6((ink.h + 0.5) % 1, Math.max(ink.s, 0.85), Math.max(ink.v, 0.9)),
      axisX: spec.axisX,
      axisY: spec.axisY,
      pixelIndices: spec.pixelIndices,
    };
  }

  function verifyPreparedSlots() {
    return loadSlots(true).then(function () {
      Array.prototype.forEach.call(fxGrid.querySelectorAll('.fx-cell'), function (cell) {
        var slotId = Number(cell.dataset.slot);
        var expected = cell.dataset.fxkey + '|' + cell.dataset.preset;
        if (slotBinding[slotId] !== expected) {
          throw new Error('slot ' + slotId + ' failed atomic prepare readback');
        }
      });
    });
  }

  function assertLiveSurfaceState() {
    var brightness;
    var spatialBody;
    var wantedStatic;
    liveBrightnessPending = { master: null, groups: {} };
    liveBrightnessPendingFade = null;
    if (liveBrightnessTimer) {
      cancelAnimationFrame(liveBrightnessTimer);
      liveBrightnessTimer = null;
    }
    return Promise.resolve().then(assertArmPageSession)
      .then(function () { return req('GET', '/touch-control/brightness'); })
      .then(function (payload) {
        acceptLiveBrightness(payload, true);
        brightness = collectLiveBrightness();
        brightness.expectedRevision = state.liveBrightnessRevision;
        if (!Number.isInteger(state.sessionRevision)) {
          throw new Error('Live Touch has no staged session revision');
        }
        prepareOperations = [];
      })
      .then(function () { return req('POST', '/global-effects/disable-all', {}); })
      .then(function () { return req('POST', '/audio-bindings/clear', {}); })
      .then(collectEffectSlotBuildOperations)
      .then(function () { return pushPalette(true); })
      .then(function () { return pushEffectColours(true); })
      .then(function () { return reconcileEffects(true); })
      .then(function () {
        return runSeries(armAsserts.map(function (fn) {
          return function () { return fn(true); };
        }));
      })
      .then(function () {
        spatialBody = initialSpatialPrepareBody();
        prepareOperations.push({ method: 'POST', path: '/spatial-paint', body: spatialBody });
        wantedStatic = collectStaticPrepareOperations();
        var operations = prepareOperations;
        prepareOperations = null;
        assertArmPageSession();
        return requestJson('POST', '/layers/live_touch/prepare', {
          expectedSessionRevision: state.sessionRevision,
          operations: operations,
          brightness: brightness,
        }, true).then(function (response) {
          if (!response || !Number.isInteger(response.sessionRevision)
              || !Number.isInteger(response.brightnessRevision)
              || response.operationCount !== operations.length) {
            throw new Error('atomic Live Touch prepare returned an invalid acknowledgement');
          }
          state.sessionRevision = response.sessionRevision;
          state.liveBrightnessRevision = response.brightnessRevision;
          Object.keys(painted).forEach(function (name) { delete painted[name]; });
          Object.keys(wantedStatic).forEach(function (name) { painted[name] = wantedStatic[name]; });
          Object.keys(spatialBody).forEach(function (key) {
            if (Object.prototype.hasOwnProperty.call(spatialCfg, key)) {
              spatialCfg[key] = Array.isArray(spatialBody[key])
                ? spatialBody[key].slice() : spatialBody[key];
            }
          });
          return Promise.all([
            verifyPreparedSlots(),
            req('GET', '/touch-control/brightness').then(function (value) {
              return acceptLiveBrightness(value, true);
            }),
          ]);
        });
      }).then(assertArmPageSession, function (error) {
        prepareOperations = null;
        throw error;
      });
  }

  function armLiveTouch() {
    armChainTarget = true;
    setArmUiPhase('arming');
    if (!window.TouchControlLifecycle) {
      return Promise.reject(new Error('Live Touch lifecycle controller did not load'));
    }
    return window.TouchControlLifecycle.arm({
      isCancelled: function () { return pageSessionInvalidated; },
      verify: verifyArmReadiness,
      acquireLease: acquireArmLease,
      stage: function () {
        /* The global owner guard rejects tagged writes before acquireLease.
           Staging lives here, after acknowledgement and before activation. */
        return stageSelectedLivePattern().then(function () { forgetSpatialCfg(); });
      },
      assertState: assertLiveSurfaceState,
      activate: function () { return activateLayerSetting('live_touch', 'live_touch_arm', true); },
      waitForLanding: function () { return waitForLayerSetting('live_touch', 15000); },
      markArmed: function () {
        setArmUiPhase('armed');
        clearError();
      },
    });
  }

  function handbackLiveTouch(target, reason) {
    armChainTarget = false;
    setArmUiPhase('disarming');
    return activateLayerSetting(target, reason, true)
      .then(function () { return waitForLayerSetting(target, 15000); })
      .then(cleanupLiveState)
      .then(releaseArmLease)
      .then(function () {
        /* Never release the deadman before the destination has landed and all
           owner-scoped transient state has been authoritatively cleared. */
        state.liveBrightnessRevision = null;
        setArmUiPhase('idle');
        clearError();
      });
  }

  function finishArmChain() {
    armChainBusy = false;
    if (pageRestoreHandbackPending) {
      if (state.phase === 'armed' && !surfaceHandoffBusy) {
        pageRestoreHandbackPending = false;
        startArmChain(false);
        return;
      }
      if (state.phase === 'idle') pageRestoreHandbackPending = false;
    }
    if (state.phase === 'idle') pageSessionInvalidated = false;
    drainSurfaceRelease();
  }

  function startArmChain(armRequested) {
    if (armChainBusy || surfaceHandoffBusy) {
      setArmUiPhase(state.phase);
      fail('arm', 'an ARM or Layers handoff is already in progress');
      return;
    }
    armChainBusy = true;
    var operation = armRequested
      ? armLiveTouch().catch(function (error) { return abortArm('arm setup', error); })
      : handbackLiveTouch('deck', 'live_touch_manual_disarm').catch(function (error) {
          fail('disarm', error);
        });
    operation.then(finishArmChain, finishArmChain);
  }

  if (armEl) {
    armEl.addEventListener('click', function () {
      /* The page toggles first; the wire immediately converts that optimistic
         state to ARMING/DISARMING until the engine confirms the blend. */
      setTimeout(function () {
        startArmChain(armEl.classList.contains('is-armed'));
      }, 0);
    });
  }

  function drainSurfaceRelease() {
    if (!pendingSurfaceRelease || armChainBusy || surfaceHandoffBusy) return;
    var request = pendingSurfaceRelease;
    pendingSurfaceRelease = null;
    var action;
    try { action = window.TouchControlLifecycle.planHandoff(state.phase, request); }
    catch (error) { fail('Layers handoff', error); return; }
    if (action === 'ack') {
        try { acknowledgeSurfaceRelease(request.requestId, request.target); }
        catch (error) { fail('Layers handoff', error); }
        return;
    }
    if (action === 'activate') {
      /* A newer route can supersede an in-flight request after the first
         destination already landed and released the lease. Prove the latest
         destination with an unowned canonical activation before ACKing it. */
      surfaceHandoffBusy = true;
      activateLayerSetting(request.target, 'captainpad_idle_route_sync', false)
        .then(function () { return waitForLayerSetting(request.target, 15000); })
        .then(function () {
          acknowledgeSurfaceRelease(request.requestId, request.target);
          surfaceHandoffBusy = false;
          drainSurfaceRelease();
        }).catch(function (error) {
          surfaceHandoffBusy = false;
          pendingSurfaceRelease = request;
          fail('Layers handoff', error);
        });
      return;
    }
    if (action === 'wait') {
      pendingSurfaceRelease = request;
      return;
    }
    surfaceHandoffBusy = true;
    handbackLiveTouch(request.target, 'captainpad_surface_blur').then(function () {
      acknowledgeSurfaceRelease(request.requestId, request.target);
      surfaceHandoffBusy = false;
      drainSurfaceRelease();
    }).catch(function (error) {
      surfaceHandoffBusy = false;
      pendingSurfaceRelease = request;
      /* Do not invent ARMED after an uncertain failure. Keep DISARMING and the
         parent curtain until a retry or the engine's deadman proves recovery. */
      fail('Layers handoff', error);
    });
  }

  document.addEventListener('captainpad:surface-blur', function (event) {
    var detail = event.detail || {};
    if ((detail.target !== 'deck' && detail.target !== 'mixer')
        || typeof detail.requestId !== 'string' || !detail.requestId) {
      fail('Layers handoff', 'invalid surface-blur request');
      return;
    }
    if (detail.reason !== 'navigation' && detail.reason !== 'background') {
      fail('Layers handoff', 'invalid surface-blur reason');
      return;
    }
    pendingSurfaceRelease = {
      requestId: detail.requestId,
      target: detail.target,
      reason: detail.reason,
      forceDestination: detail.reason === 'navigation' || armChainBusy
        || surfaceHandoffBusy || state.phase !== 'idle',
    };
    drainSurfaceRelease();
  });

  document.addEventListener('captainpad:surface-focus', function () {
    /* Focusing this tab is passive. Only the ARM control activates Live Touch. */
  });

  /* A hard page exit cannot await the normal parent handshake. Start the same
     Live→Deck blend with keepalive; the engine's deadman owns final cleanup if
     teardown wins the race. */
  window.addEventListener('pagehide', function () {
    if (state.phase === 'idle') return;
    fetch(ENGINE + '/layers/activate', { method: 'POST', keepalive: true,
      headers: { 'Content-Type': 'application/json', 'X-Touch-Control-Owner': OWNER },
      body: JSON.stringify({
        target: 'deck', durationMs: LAYER_TRANSITION_MS,
        reason: 'live_touch_pagehide', ownerId: OWNER,
      }) }).catch(function () {});
    /* Do not clear the owner-scoped look before the blend lands. The socket
       close/deadman destroys the in-memory Live context after handback. */
  });
  /* Safari can restore the iframe with its old JS state after pagehide already
     began a Deck handback. Treat that as a fresh, explicitly DISARMED visit. */
  window.addEventListener('pageshow', function (ev) {
    var recovery = window.TouchControlLifecycle.pageShowRecovery(ev.persisted, state.phase);
    if (recovery === 'none') return;
    fail('arm', 'this page came back from the browser cache; its previous takeover ' +
      'must finish handing back before it can be armed again.');
    if (recovery === 'cancel_arm') {
      /* Do not erase lease bookkeeping. The guarded ARM chain rejects as soon
         as its current step settles, then abortArm performs landed cleanup and
         authoritative lease release. */
      pageSessionInvalidated = true;
      setArmUiPhase('disarming');
      return;
    }
    if (recovery === 'handback') {
      pageSessionInvalidated = true;
      pageRestoreHandbackPending = true;
      if (!armChainBusy && !surfaceHandoffBusy) {
        pageRestoreHandbackPending = false;
        startArmChain(false);
      }
    }
    /* A disarming page already owns the exact cleanup/release transaction.
       Let that serialized chain finish instead of starting a parallel one. */
  });

  /* ── PATTERN ────────────────────────────────────────────────────────── */
  var PATTERN_FILES = {
    '130': '130_spatial_paint',
    '128': '128_five_colour_prism',
    '129': '129_five_colour_stations',
  };
  var patSel = document.getElementById('patternSel');
  if (patSel) {
    patSel.addEventListener('change', function () {
      var name = PATTERN_FILES[patSel.value];
      if (!name) return fail('pattern', 'no file mapped for ' + patSel.value);
      write('PUT', '/layers/live_touch/pattern', { pattern: name }).then(function (result) {
        if (result === null) return null; /* disarmed or already reported */
        state.channelPattern = name;
        /* Export IDs belong to one WASM instance. Reusing the previous map
           after a live pattern swap can drive an unrelated setter by number. */
        return refreshLiveExports().then(function () {
          /* Pattern-local slots 3-5 were reset with the instance. Reassert the
             palette the surface still shows before accepting another gesture. */
          return pushPalette(true);
        });
      }).catch(function (error) { fail('pattern', error); });
    });
  }

  /* ── COLOUR → the engine's five slots ───────────────────────────────
     Send EXACTLY the five colours the panel is showing. The previous version
     did three things wrong, and together they are why the rig showed colours
     that were never chosen:

       1. It invented its own hue spread — hue + (n-2)*0.08 for slots 3/4/5 —
          no matter which scheme was picked. In HUE mode, which means ONE hue at
          five BRIGHTNESSES, that put three unrelated hues on the ship.
       2. It never wrote colorPalette2 at all, so slot 2 kept whatever stale
          colour happened to be in the engine from a previous session.
       3. It never wrote sliderVal3/4/5, so the brightness half of every scheme
          never reached the rig.

     Now the page publishes the resolved palette (slots.dataset.palette) and this
     just forwards it. One source of truth: what you see is what is sent. */
  var slotsEl = document.getElementById('slots');

  /* The five wheel colours as engine 6-channel arrays, for effects that take a
     palette as a parameter rather than through the pattern's sliders. */
  function paletteRgb6() {
    var pal;
    try { pal = JSON.parse((slotsEl && slotsEl.dataset.palette) || '[]'); }
    catch (e) { pal = []; }
    if (!pal.length) {
      /* No palette means the page has not resolved one yet. Refusing is right:
         a movement effect with an invented colour list would paint the ship a
         colour nobody picked. */
      throw new Error('paletteRgb6: no palette published yet');
    }
    return pal.map(function (c) { return hsvToRgb6(c.h, c.s, c.v); });
  }

  /* Keep any RUNNING movement effect on the current five colours. Its colours
     are slot params, not pattern sliders, so a wheel move does not reach it
     unless the slot is patched — without this the ship would keep travelling
     the colours the operator had a minute ago. */

  /* Patch a RUNNING movement slot and make the change actually take.
     PATCHing a slot only updates its STORED params; the controller reads them
     when the slot is dispatched, so a running effect kept the colours it
     started with. MEASURED: running [[1,0,0]], patched to [[0,0,1]], still
     reported [[1,0,0]] - and an 'activate' made it [[0,0,1]]. That is exactly
     why turning the button off and on again "fixed" the colour.
     'activate' re-runs the setter with the merged params and is idempotent for
     an already-running toggle effect, so it re-colours without re-triggering. */
  function patchLiveSlot(id, ov) {
    return write('PATCH', '/global-effect-slots/' + id, { paramsOverride: ov })
      .then(function () { return write('POST', '/global-effect-slots/' + id + '/activate', {}); });
  }

  function pushMovementColours() {
    if (!state.armed || !fxGrid) return;
    var cells = fxGrid.querySelectorAll('.fx-cell.is-on[data-fxkey=movementTrace]');
    if (!cells.length) return;
    var colors = paletteRgb6();
    Array.prototype.forEach.call(cells, function (cell) {
      var id = Number(cell.dataset.slot);
      var ov = liveOverride[id] || {};
      ov.colors = colors;
      liveOverride[id] = ov;
      send('mvcol' + id, function () { patchLiveSlot(id, ov); });
    });
  }

  /* The FADE bar, expressed the way a movement effect needs it: what FRACTION
     of each step is spent crossfading into the next. Bar down = hard steps,
     bar up = the colours flow and never jump. */
  function movementFadeSpan() {
    return Math.min(1, Math.max(0, fadeMs / FADE_MAX_MS));
  }

  function pushMovementFade() {
    if (!state.armed || !fxGrid) return;
    var cells = fxGrid.querySelectorAll('.fx-cell.is-on[data-fxkey=movementTrace]');
    if (!cells.length) return;
    var span = movementFadeSpan();
    Array.prototype.forEach.call(cells, function (cell) {
      var id = Number(cell.dataset.slot);
      var ov = liveOverride[id] || {};
      ov.fadeSpan = span;
      ov.switchMs = fadeMs;
      liveOverride[id] = ov;
      send('mvfade' + id, function () { patchLiveSlot(id, ov); });
    });
  }

  function pushPalette(strict) {
    if (!slotsEl) return strict ? Promise.reject(new Error('palette slots are missing')) : Promise.resolve();
    var pal;
    try { pal = JSON.parse(slotsEl.dataset.palette || '[]'); }
    catch (e) {
      fail('palette', 'unreadable palette: ' + e.message);
      return strict ? Promise.reject(e) : Promise.resolve();
    }
    if (!pal.length) return strict ? Promise.reject(new Error('palette is empty')) : Promise.resolve();

    if (strict) {
      var tasks = [];
      var body = { colorPalette1: pal[0] };
      if (pal[1]) body.colorPalette2 = pal[1];
      tasks.push(function () { return strictWrite('POST', '/param-center', body); });
      [3, 4, 5].forEach(function (n) {
        var c = pal[n - 1];
        if (!c) return;
        var hueId = state.exports['sliderHue' + n];
        var valId = state.exports['sliderVal' + n];
        if (hueId !== undefined) tasks.push(function () {
          return strictWrite('POST', '/layers/live_touch/control', { id: hueId, v0: c.h });
        });
        if (valId !== undefined) tasks.push(function () {
          return strictWrite('POST', '/layers/live_touch/control', { id: valId, v0: c.v });
        });
      });
      return runSeries(tasks);
    }

    /* Slots 1 and 2 are the ENGINE palette — every pattern sees them. */
    send('palette', function () {
      var body = { colorPalette1: pal[0] };
      if (pal[1]) body.colorPalette2 = pal[1];
      write('POST', '/param-center', body);
    });

    /* Slots 3-5 are PATTERN-LOCAL: hue AND value, resolved by name because they
       only exist on patterns that support five-colour mode. */
    [3, 4, 5].forEach(function (n) {
      var c = pal[n - 1];
      if (!c) return;
      var hueId = state.exports['sliderHue' + n];
      var valId = state.exports['sliderVal' + n];
      if (hueId !== undefined) {
        send('hue' + n, function () { write('POST', '/layers/live_touch/control', { id: hueId, v0: c.h }); });
      }
      if (valId !== undefined) {
        send('val' + n, function () { write('POST', '/layers/live_touch/control', { id: valId, v0: c.v }); });
      }
    });
    return Promise.resolve();
  }

  /* ── THE WHEEL ALSO COLOURS THE EFFECTS ─────────────────────────────
     Four effects carry a colour of their own — colorWash, dropHit,
     waterlineSweep, kickPunch — and until now they ignored the wheel entirely,
     so a wash kept whatever its preset shipped with while the patterns followed
     the operator. While ARMED the wheel is the single colour authority, so
     those slots take the palette too.

     ONLY slots 9+ (never the Deck's or the VSN1's), and the preset's original
     colour is put back on disarm — a PATCH persists, so without that restore
     the wheel would permanently overwrite "ocean blue" and "emergency red".

     Colours are dealt out across the five palette slots rather than all taking
     slot 1: with COMPLEMENT or CONTRAST loaded, several live effects then carry
     the different colours of the scheme instead of flattening to one. */
  function pushEffectColours(strict) {
    if (!liveStateCanWrite(strict) || !fxGrid) return Promise.resolve();
    var pal;
    try { pal = JSON.parse((slotsEl && slotsEl.dataset.palette) || '[]'); }
    catch (e) { return Promise.resolve(); }
    if (!pal.length) return Promise.resolve();

    var seen = {}, i = 0, jobs = [];
    Array.prototype.forEach.call(fxGrid.querySelectorAll('.fx-cell'), function (c) {
      var id = Number(c.dataset.slot);
      if (!c.dataset.slot || id < OURS_FROM) return;
      if (COLOUR_EFFECTS.indexOf(c.dataset.fxkey) === -1) return;
      if (seen[id]) return;
      seen[id] = true;
      var col = pal[i % pal.length]; i++;
      /* MERGE, never replace: amount and mode live in the same object and are
         what make a preset that preset. */
      var merged = {};
      var cur = liveOverride[id] || {};
      Object.keys(cur).forEach(function (k) { merged[k] = cur[k]; });
      var neut = COLOUR_NEUTRAL[c.dataset.fxkey];
      if (neut) Object.keys(neut).forEach(function (k) { merged[k] = neut[k]; });
      merged.color = hsvToRgb6(col.h, col.s, col.v);
      liveOverride[id] = merged;
      jobs.push((strict ? strictWrite : write)('PATCH', '/global-effect-slots/' + id, { paramsOverride: merged }));
    });
    return Promise.all(jobs).catch(function (e) {
      fail('effect colour', e);
      if (strict) throw e;
    });
  }

  function restoreEffectColours() {
    var tasks = [];
    Object.keys(presetOverride).forEach(function (id) {
      if (Number(id) < OURS_FROM) return;
      var orig = presetOverride[id];
      if (JSON.stringify(orig) === JSON.stringify(liveOverride[id] || {})) return;
      liveOverride[id] = JSON.parse(JSON.stringify(orig));
      /* Sending the ORIGINAL object back clears the colour key entirely, so the
         preset's own colour applies again rather than a stored copy of it. */
      tasks.push(function () {
        return handbackStep('effect-colour/' + id,
          req('PATCH', '/global-effect-slots/' + id, { paramsOverride: orig }));
      });
    });
    return runSeries(tasks);
  }

  /* Fires for the wheel AND for every preset button, because both go through
     paint5() — so MASTER, HUE, COMPLEMENT and CONTRAST all reach the rig. */
  if (slotsEl) slotsEl.addEventListener('palettechange', function () {
    pushPalette();
    pushEffectColours();
    pushMovementColours();
    /* IN SPATIAL MODE THE WHEEL PICKS THE INK, IT DOES NOT REPAINT THE SHIP.
       Operator: "when i use the color wheel and change the color when i go back
       to the xy the ink does not work". It was not the pad — MEASURED, the pad
       still takes input and still draws (48,288 ink px after a wheel drag, with
       real hit-tested input, no errors). The stroke had become INVISIBLE:
       applyStatic() repaints every group in the new palette colour, and
       inkColour() reads the SAME palette, so the operator was drawing a colour
       onto a hull that had just been flooded with that exact colour. Measured
       in the page: after one wheel drag the palette and the ink were both
       h=0.852. Only the white core survived, which is not much.
       Choosing a colour in order to DRAW with it should not first paint the
       whole ship in it. Every other surface still paints — arming does, the
       scheme buttons do in XY mode, and switching back to XY restores the old
       behaviour immediately — so this only narrows the one case that made the
       feature useless. */
    if (spatialMode()) return;
    applyStatic();
  });


  /* ── THE PAD — two modes, and the toggle now actually switches them ────
     The mode buttons were pure decoration: whichever was lit, the pad always
     wrote sliderTargetX/Y. Worse, the pad's own axis labels in XY MODE say
     "RIG MASTER BRIGHTNESS" and "PATTERN ROTATE", so the surface was promising
     something it never did. Each mode now does what its labels claim:

       SPATIAL MODE  x/y -> owner-scoped spatial paint in ship coordinates.
       XY MODE       x -> the Live master factor, floored at XY_MASTER_FLOOR
                          and always subordinate to the Dimmer Rack
                     y -> strobe rate or group walk, per the Y AXIS buttons
                     Coordinate-blind, works on ANY pattern. */
  var xyPad = document.getElementById('xyPad');
  var modeToggle = document.getElementById('modeToggle');
  var wirePadRect = null;

  function spatialMode() {
    if (!modeToggle) return true;
    var btns = modeToggle.querySelectorAll('button');
    return !!(btns[1] && btns[1].classList.contains('is-active'));
  }

  /* ── WHAT DRAWING DOES ──────────────────────────────────────────────────
     Mode, fade and colour are STROKE STATE, not per-sample data, so they are
     asserted on change rather than on every pointer move.

     The owner-scoped spatial stage is applied to the isolated Live buffer, so
     it remains available across Live pattern changes without touching Deck. */
  var DRAW_MODES = ['pool', 'trail', 'erase', 'ignite'];
  var spatialCfg = {
    mode: null, fadeSeconds: null, color: null, colorAlt: null,
    radius: null, radiusY: null, amount: null,
    axisX: null, axisY: null, pixelIndices: null,
  };

  /* POWER — how hard the stroke acts. Straight through to the effect's
     `amount`, which was pinned at the engine default with nothing on the panel
     able to move it. It is ONE number with four meanings, which is why the
     panel explains it per mode rather than calling it "amount":
       POOL/TRAIL  brightness of the light laid down
       ERASE       how deep the cut is (floored — never reaches black)
       IGNITE      how far the whole hull lifts
     Floored at 0.05 rather than 0: a stroke at literally zero is a control that
     looks live and does nothing, which is the failure mode this whole session
     has been about. */
  /* BRUSH SIZE — the area of effect, which the operator asked to control.
     The engine held a fixed default the panel never sent, so one touch always
     covered the same amount of hull no matter what the stroke was for.

     0 -> 0.04 (a spot, a single fixture group's worth)
     1 -> 0.50 (a wash across half the ship)
     Linear on purpose: an operator dragging a slider mid-show should get what
     the bar shows, not a curve that is clever about perceptual area. */
  /* THE PAGE OWNS THE BRUSH SIZE, because it owns the chart. SIZE is a radius
     in pad pixels; converting it to a world radius needs the chart's scale, and
     duplicating that here is how the ring and the rig drift apart — which is
     the exact bug that made "the circle does not hold what it erases". The
     chart's scale is UNIFORM, so one radius covers both axes and the brush is a
     true circle. A missing or invalid export disables the stroke loudly; an
     invented radius would make the drawn ring disagree with the rig. */
  function padBrush(target) {
    if (typeof window.padBrushWorld === 'function') {
      var r = window.padBrushWorld(target);
      if (r && isFinite(r.x) && r.x > 0 && isFinite(r.y) && r.y > 0) return r;
    }
    fail('brush size', 'the page did not provide a valid padBrushWorld radius');
    return null;
  }
  function brushPatch(target) {
    var r = padBrush(target);
    return r ? { radius: Math.min(1, r.x), radiusY: Math.min(2, r.y) } : null;
  }

  var POWER_MAX = 2;
  function brushAmount() {
    var el = document.getElementById('brushPower');
    var v = el && el.dataset.value !== undefined ? parseFloat(el.dataset.value) : NaN;
    if (!isFinite(v)) {
      fail('brush power', 'the page did not provide a valid brush power');
      return null;
    }
    /* The slider's full travel is 0..POWER_MAX, so the top half of the control
       is OVERDRIVE — past 100% the coverage is already total and the extra
       drives the colour itself. Floored so the control is never a no-op. */
    return Math.min(Math.max(v * POWER_MAX, 0.05), POWER_MAX);
  }

  /* BRUSH SIZE lives PAGE-SIDE now: the SIZE chips drive brushPadFrac(), and
     padBrushWorld() turns that into the per-axis world radii the wire reads
     through padBrush() above. One mapping, one owner.
     AUDIT H7: a second `function brushRadius()` used to live here, mapping the
     SIZE slider straight to 0.04..0.50. Function declarations hoist last-wins,
     so it silently overrode the world-derived brushRadius above while
     brushRadiusY kept the world mapping — X and Y radii from DIFFERENT
     mappings, quietly re-breaking the per-axis roundness correction the
     operator asked for ("the circle is not a circle"). The slider→world
     mapping lives page-side in padBrushWorld; the wire reads ONLY that. */

  /* Send only what actually changed — ACCUMULATING, not replacing.

     THIS USED TO SILENTLY LOSE HALF ITS PATCHES. Every config patch queues under
     the single key 'spatialCfg', and send() does `pending[key] = fn` — last
     writer wins. pushXY calls this TWICE in one synchronous sample (colour, then
     radius/amount), so one of the two was deleted before it was ever issued.
     And because the dedupe cache was written BEFORE queueing, the destroyed
     patch was recorded as already delivered and never retried by anything.
     Net effect: the SIZE slider could never reach the engine, so the brush sat
     on its constructor default while the ring on the pad said otherwise — which
     is exactly "I make the circle the size of a side and it does not all go off".

     Fixed by accumulating into one pending patch and committing the cache only
     when the write actually goes out. */
  var spatialPatch = null;

  function assertSpatial(patch) {
    var out = null, k;
    for (k in patch) {
      if (!Object.prototype.hasOwnProperty.call(patch, k)) continue;
      var v = patch[k];
      /* Compare against what is CACHED plus what is already queued, so a value
         repeated inside one flush window is still only sent once. */
      var cur = (spatialPatch && Object.prototype.hasOwnProperty.call(spatialPatch, k))
        ? spatialPatch[k] : spatialCfg[k];
      var same = Array.isArray(v)
        ? (Array.isArray(cur) && String(cur) === String(v))
        : (cur === v);
      if (same) continue;
      (out = out || {})[k] = v;
    }
    if (!out) return;
    spatialPatch = spatialPatch || {};
    for (k in out) {
      if (Object.prototype.hasOwnProperty.call(out, k)) spatialPatch[k] = out[k];
    }
    send('spatialCfg', function () {
      var body = spatialPatch;
      spatialPatch = null;
      if (!body) return;
      /* Commit the cache HERE — only what is actually going on the wire. */
      for (var kk in body) {
        if (Object.prototype.hasOwnProperty.call(body, kk)) spatialCfg[kk] = body[kk];
      }
      write('POST', '/spatial-paint', body);
    });
  }

  /* Re-assert on the next stroke after a disarm: cleanupLiveState clears the
     effect, so the cached values no longer match the engine. */
  function forgetSpatialCfg() {
    /* EVERY key, not three. It used to drop only mode/fade/colour, leaving
       radius/radiusY/amount cached as "already sent" across a disarm — so after
       re-arming, the engine had its defaults and the panel believed it had
       already told it otherwise. */
    spatialCfg = { mode: null, fadeSeconds: null, color: null, colorAlt: null,
                   radius: null, radiusY: null, amount: null,
                   axisX: null, axisY: null, pixelIndices: null };
    spatialPatch = null;
  }

  document.addEventListener('drawmode', function (ev) {
    var v = Math.min(Math.max(Number(ev.detail.value) || 0, 0), 1);
    assertSpatial({ mode: DRAW_MODES[Math.round(v * 3)] });
    /* Extra, not instead: only 130_spatial_paint has this slider. */
    var id = state.exports.sliderDrawMode;
    if (id === undefined) return;
    send('drawMode', function () { write('POST', '/layers/live_touch/control', { id: id, v0: ev.detail.value }); });
  });

  var brushSizeEl = document.getElementById('brushSize');
  if (brushSizeEl) {
    brushSizeEl.addEventListener('sliderchange', function () {
      var patch = brushPatch();
      if (patch) assertSpatial(patch);
    });
  }

  var brushPowerEl = document.getElementById('brushPower');
  if (brushPowerEl) {
    brushPowerEl.addEventListener('sliderchange', function () {
      var amount = brushAmount();
      if (amount !== null) assertSpatial({ amount: amount });
    });
  }

  var trailFadeEl = document.getElementById('trailFade');
  if (trailFadeEl) {
    trailFadeEl.addEventListener('sliderchange', function (ev) {
      var seconds = Number(ev.detail.value);
      if ([0.1, 0.5, 1, 1.5].indexOf(seconds) === -1) {
        fail('trail fade', 'FADE must be 0.1, 0.5, 1.0, or 1.5 seconds');
        return;
      }
      assertSpatial({ fadeSeconds: seconds });
      var id = state.exports.sliderTrailFade;
      if (id === undefined) return;
      var normalized = (seconds - 0.1) / 1.4;
      send('trailFade', function () {
        write('POST', '/layers/live_touch/control', { id: id, v0: normalized });
      });
    });
  }

  /* The group-paint interim that used to live here is GONE: the stroke is now
     per-pixel via owner-tagged POST /spatial-paint, which is what the
     operator asked for. Group paint was pattern-agnostic but only 24-way. */

  if (xyPad) {
    var lastSpatial = null;      /* newest world point the pad produced */
    var spatialPointers = new Map();
    var lastSpatialBrush = null;
    var lastSpatialMode = null;
    var lastStrokeColor = null;
    var lastStrokeAlt = null;
    var TAKE_POINTER_ID = 0x7ffffffe;

    function spatialPayload(includeRetiring) {
      var snapshots = [];
      spatialPointers.forEach(function (pointer) {
        if (!pointer.current || (pointer.retiring && !includeRetiring)) return;
        var stroke = {
          id: pointer.id,
          targetX: pointer.current.targetX,
          targetY: pointer.current.targetY,
          color: pointer.color,
          colorAlt: pointer.colorAlt,
        };
        if (pointer.sent) {
          stroke.prevX = pointer.sent.targetX;
          stroke.prevY = pointer.sent.targetY;
        }
        snapshots.push({ pointer: pointer, target: pointer.current, stroke: stroke });
      });
      var body = {
        enabled: true,
        touch: snapshots.length > 0,
        strokes: snapshots.map(function (snapshot) { return snapshot.stroke; }),
      };
      if (lastSpatialBrush) {
        body.radius = lastSpatialBrush.radius;
        body.radiusY = lastSpatialBrush.radiusY;
        body.amount = lastSpatialBrush.amount;
      }
      if (lastSpatialMode) body.mode = lastSpatialMode;
      if (lastStrokeColor) body.color = lastStrokeColor;
      if (lastStrokeAlt) body.colorAlt = lastStrokeAlt;
      return { body: body, snapshots: snapshots };
    }

    function commitSpatialPayload(payload) {
      payload.snapshots.forEach(function (snapshot) {
        if (spatialPointers.get(snapshot.pointer.id) === snapshot.pointer) {
          snapshot.pointer.sent = snapshot.target;
        }
      });
    }

    function queueSpatialTouches(finalSample) {
      sendDraw(function () {
        var first = spatialPayload(true);
        var retiring = first.snapshots.filter(function (snapshot) {
          return snapshot.pointer.retiring;
        });
        return write('POST', '/spatial-paint', first.body).then(function (response) {
          commitSpatialPayload(first);
          retiring.forEach(function (snapshot) {
            if (spatialPointers.get(snapshot.pointer.id) === snapshot.pointer) {
              spatialPointers.delete(snapshot.pointer.id);
            }
          });
          if (!retiring.length) return response;
          /* A released finger is stamped once at its final coordinate, then a
             second ordered state removes only that finger. Other fingers stay
             down throughout; one lift can never cancel the whole gesture. */
          var landed = spatialPayload(false);
          return write('POST', '/spatial-paint', landed.body).then(function (nextResponse) {
            commitSpatialPayload(landed);
            if (spatialPointers.size === 0) wirePadRect = null;
            return nextResponse;
          });
        });
      }, finalSample);
    }

    var pushXY = function (e) {
      var r = wirePadRect || xyPad.getBoundingClientRect();
      var x = Math.min(Math.max((e.clientX - r.left) / r.width, 0), 1);
      var y = Math.min(Math.max((e.clientY - r.top) / r.height, 0), 1);

      if (spatialMode()) {
        /* PER-PIXEL, ON EVERY LIVE PATTERN.
           The stroke runs in the lease-owned Live creative stage before the
           canonical blend; Deck and Mixer remain untouched. This
           replaced an interim that painted whole GROUPS: pattern-agnostic but
           only 24-way, where the operator asked for per-pixel.
           One write per sample carrying position + finger state; colour and mode
           are sent only when they change. */
        var sp = (typeof window.padToWorld === 'function') ? window.padToWorld(x, y) : null;
        if (sp) {
          /* COLOUR THE STROKE. The operator picks a palette slot and draws in
             it; without this every stroke was white, because position was the
             only thing the pad ever sent. Deduped, so a held colour costs one
             request per change and not one per sample. Sent as its own patch,
             ahead of the position, so the first sample of a stroke is already
             the right colour rather than flashing white for a frame. */
          /* Colour is carried by the position write below, so it is NOT
             asserted separately any more — two queues meant two arrival times.
             The cache is still kept in step so the config path never re-sends a
             colour the stroke has already delivered. */
          /* ASSERT THE BRUSH SIZE TOO, for the same reason and at the same
             cost. Without this the engine keeps its own default until the
             operator happens to touch the SIZE slider, so the very first
             stroke of a show would not be the size the panel is showing. */
          /* ASSERT THE DRAW MODE TOO. The panel ships with POOL lit but the
             only thing that ever sent a mode was the button's click handler, so
             until the operator happened to tap one the engine sat on its own
             constructor default ('trail') — the panel and the ship disagreeing
             about what drawing does, silently. Deduped, so it costs one request
             once. */
          var dmB = document.querySelector('#drawModes button.is-active');
          if (dmB) {
            var dv = Math.min(Math.max(parseFloat(dmB.dataset.dm) || 0, 0), 1);
            lastSpatialMode = DRAW_MODES[Math.round(dv * 3)];
            assertSpatial({ mode: lastSpatialMode });
          }
          var brush = brushPatch(sp);
          var amount = brushAmount();
          if (!brush || amount === null) return;
          brush.amount = amount;
          assertSpatial(brush);
          /* THE COLOUR TRAVELS WITH THE POSITION, in one body.
             It used to go on the config queue (100 ms) while the position went
             on the drawing queue (33 ms), so a colour change could arrive up to
             three samples LATE — with an INK scheme walking the palette as the
             finger moves, that means a band gets laid down in the PREVIOUS
             colour and the bands stop lining up with where they were drawn.
             That is the operator's "they are not matching the color properly".
             Sending them together makes each sample carry its own colour, so a
             band cannot land in a colour from somewhere else on the stroke. */
          var strokeCol = null, strokeAlt = null;
          if (typeof window.inkColour === 'function') {
            var c2 = window.inkColour();
            if (c2 && typeof c2.h === 'number') {
              strokeCol = hsvToRgb6(c2.h, c2.s, c2.v);
              strokeAlt = hsvToRgb6((c2.h + 0.5) % 1,
                                    Math.max(c2.s, 0.85), Math.max(c2.v, 0.9));
            }
          }
          if (!strokeCol) {
            fail('spatial colour', 'the page supplied no valid ink colour; refusing the stroke');
            return;
          }
          var pointerId = Number.isInteger(e.pointerId) ? e.pointerId : TAKE_POINTER_ID;
          var pointer = spatialPointers.get(pointerId);
          if (!pointer || pointer.retiring) return;
          pointer.current = sp;
          pointer.color = strokeCol;
          pointer.colorAlt = strokeAlt;
          lastSpatial = sp;
          lastSpatialBrush = brush;
          lastStrokeColor = strokeCol;
          lastStrokeAlt = strokeAlt;
          queueSpatialTouches(false);
        }
        /* The Live pattern's OWN position sliders are also driven when it
           exposes them (130_spatial_paint), so that pattern keeps its
           richer pool on top. Absent everywhere else, which is now harmless. */
        var idX = state.exports.sliderTargetX, idY = state.exports.sliderTargetY;
        /* Pattern 130 is authored in nx/nz. The owner-scoped global brush is
           projection-aware; do not feed Front or Sign coordinates into a
           top-plane pattern export and create a second, misplaced stroke. */
        if (!sp || sp.axisX !== 'nx' || sp.axisY !== 'nz') return;
        if (idX === undefined || idY === undefined) return;
        /* RECTIFY PAD → SHIP. The pad shows the sim's COMPRESSED top-down map,
           but the pattern is fed WORLD nx/nz. Sending the raw pad fraction
           would aim the light at the wrong place on a hull that runs diagonally
           and is 73.6% empty in this plane (docs/44 §2.5) — the operator would
           draw on one part of the map and watch a different part light up.
           The page owns the geometry and exposes the lookup. If it is absent,
           refuse the stroke: raw panel fractions are not ship coordinates. */
        if (typeof window.padToWorld !== 'function') {
          return fail('spatial', 'canonical pixel projection is unavailable');
        }
        var wpt = sp;
        var wx = wpt.targetX, wy = wpt.targetY;
        send('xy', function () {
          write('POST', '/layers/live_touch/control', { id: idX, v0: wx });
          write('POST', '/layers/live_touch/control', { id: idY, v0: wy });
          var t = state.exports.sliderTouch;
          if (t !== undefined) write('POST', '/layers/live_touch/control', { id: t, v0: 1 });
        });
      } else {
        /* XY MODE = BRIGHTNESS x STROBE SPEED (operator ruling). Y used to drive
           the pattern's rotate, which is a look-tweak rather than a performance
           control — nothing you reach for mid-song.

           X: the Live Touch master factor, left DIM to right bright. The
              Dimmer Rack remains the authoritative ceiling. It
              is rescaled into [XY_MASTER_FLOOR, 1] so the far left is 5%, not
              0 (see the constant for why).
           Y: strobe rate, 0.5 Hz at the bottom to 20 Hz at the top, on an
              EXPONENTIAL sweep so the usable slow end is not crushed into the
              last few pixels (linear, half the travel would sit above 10 Hz).
              The very bottom of the axis switches the strobe OFF rather than
              crawling at 0.5 Hz, so the pad has a natural "no strobe" position.
           The engine re-anchors the pulse train when the rate changes, so
           sweeping speeds the flashing up in place instead of restarting it. */
        var floor = xyMasterFloor();
        if (floor === null) return;                       /* refused, reported */
        var master = floor + x * (1 - floor);
        queueLiveMaster(master);
        var up = 1 - y;                                   /* bottom 0 -> top 1 */
        var axis = (typeof window.xyYAxis === 'function') ? window.xyYAxis() : 'walk';
        send('xyEffect', function () {
          if (axis === 'strobe') {
            /* The page's exported curve — one mapping shared with the readout,
               so what the label says is what the engine hears. */
            var hz = window.xyStrobeHz(up);
            if (!hz) { write('POST', '/strobe-rate', { active: false }); return; }
            var dEl = document.getElementById('strobeDuty');
            var duty = dEl && dEl.dataset.value !== undefined ? parseFloat(dEl.dataset.value) : 0.5;
            if (!isFinite(duty)) duty = 0.5;
            duty = Math.min(0.95, Math.max(0.05, duty));   /* the engine's own limits */
            write('POST', '/strobe-rate', { active: true, hz: hz, duty: duty, intensity: 1 });
            return;
          }
          /* WALK: light steps group by group along the ship, Y sets the pace.
             0.5 .. 30 groups a second, exponential for the same reason the
             strobe axis is — a linear sweep puts everything usable in the last
             few pixels. Painted in the operator's own palette so the walk is
             the colour they picked. */
          var pps = window.xyWalkPps(up);
          if (!pps) { write('POST', '/movement-rate', { active: false }); return; }
          var cols = null;
          try {
            var pal = JSON.parse((slotsEl && slotsEl.dataset.palette) || '[]');
            if (pal.length) cols = pal.map(function (c) { return hsvToRgb6(c.h, c.s, c.v); });
          } catch (e) {
            fail('xy walk', 'the palette is unreadable: ' + e.message);
            write('POST', '/movement-rate', { active: false });
            return;
          }
          if (!cols) {
            fail('xy walk', 'the palette is empty; refusing to move with engine-owned colours');
            write('POST', '/movement-rate', { active: false });
            return;
          }
          var body = { active: true, mode: 'whole_group', pixelsPerSecond: pps, amount: 1 };
          if (cols) body.colors = cols;
          write('POST', '/movement-rate', body);
        });
      }
    };
    /* DRAW IN THE COLOUR THE OPERATOR PICKED.
       The pattern paints its pool with cp1, which is the engine's palette
       colour 1 — so "draw with slot 3" means putting slot 3's colour into
       colorPalette1 for the duration of the stroke. Sent on pointer DOWN only,
       not per move: it is one value per stroke, and the pad already writes two
       control messages per sample.
       The pad ink reads the same slot (window.inkColour), so what the operator
       sees under their finger and what the hull does cannot disagree. */
    xyPad.addEventListener('pointerdown', function () {
      if (!spatialMode()) return;
      if (typeof window.inkColour !== 'function') {
        fail('draw colour', 'the page did not export inkColour; refusing the stroke');
        return;
      }
      var c = window.inkColour();
      if (!c) {
        fail('draw colour', 'the page supplied no valid ink colour; refusing the stroke');
        return;
      }
      send('drawColour', function () {
        write('POST', '/param-center', { colorPalette1: { h: c.h, s: c.s, v: c.v } });
      });
    });
    /* A REPLAYED TAKE IS A FINGER. The page owns the recording and the pad; it
       emits 'spatialplay' per frame and this hands it to the SAME code the live
       pad uses, so a played-back stroke cannot behave differently from the one
       that was performed. Only the pen-up is special-cased, because there is no
       pointerup event to hang it on. */
    document.addEventListener('spatialplay', function (ev) {
      var d = ev.detail || {};
      /* PEN-UP IS UNCONDITIONAL (audit H9). This guard used to sit above the
         !d.down branch, so switching to XY mode mid-playback dropped the final
         touch:false and left the engine re-stamping heat at the last point
         forever — the same standing-paint failure class as the stuck-ERASE
         critical, reachable without a crash. Lifting a brush is always safe;
         only laying paint DOWN needs the mode check. */
      if (!d.down) {
        var playback = spatialPointers.get(TAKE_POINTER_ID);
        if (playback && !playback.retiring) {
          playback.retiring = true;
          queueSpatialTouches(true);
        }
        return;
      }
      if (!spatialMode()) return;
      if (!spatialPointers.has(TAKE_POINTER_ID)) {
        if (spatialPointers.size >= 10) {
          fail('spatial playback', 'ten live touches are already active');
          return;
        }
        spatialPointers.set(TAKE_POINTER_ID, {
          id: TAKE_POINTER_ID, current: null, sent: null, retiring: false,
        });
      }
      var r = xyPad.getBoundingClientRect();
      pushXY({ pointerId: TAKE_POINTER_ID,
        clientX: r.left + d.u * r.width, clientY: r.top + d.v * r.height });
    });

    /* SWITCHING WHAT Y DRIVES must stop the other one, or it keeps running with
       nothing controlling it — the same "effect left playing by a surface that
       is no longer driving it" this panel has been bitten by before. */
    document.addEventListener('xyaxischange', function (ev) {
      var to = (ev.detail && ev.detail.axis) || 'walk';
      send('xyHandoff', function () {
        write('POST', to === 'strobe' ? '/movement-rate' : '/strobe-rate', { active: false });
      });
    });

    /* Spatial mode accepts independent simultaneous pointers. XY mode remains
       a single master/strobe control: two fingers cannot both own one scalar. */
    var wirePointer = null;
    xyPad.addEventListener('pointerdown', function (e) {
      if (spatialMode()) {
        if (spatialPointers.has(e.pointerId)) return;
        if (spatialPointers.size >= 10) {
          fail('spatial touch', 'a maximum of ten simultaneous touches is supported');
          return;
        }
        spatialPointers.set(e.pointerId, {
          id: e.pointerId, current: null, sent: null, retiring: false,
        });
      } else {
        if (wirePointer !== null && e.pointerId !== wirePointer) return;
        wirePointer = e.pointerId;
      }
      wirePadRect = xyPad.getBoundingClientRect();
      try { xyPad.setPointerCapture(e.pointerId); } catch (error) {
        spatialPointers.delete(e.pointerId);
        if (wirePointer === e.pointerId) wirePointer = null;
        if (!spatialPointers.size && wirePointer === null) wirePadRect = null;
        fail('spatial pointer capture', error);
        return;
      }
      pushXY(e);
    });
    xyPad.addEventListener('pointermove', function (e) {
      if (spatialPointers.has(e.pointerId)) {
        if (spatialPointers.get(e.pointerId).retiring) return;
      } else if (wirePointer !== e.pointerId) return;
      if (e.pressure > 0 || e.buttons) pushXY(e);
    });
    /* Releasing must drop sliderTouch, or the pool stays lit under a finger
       that is no longer there.
       pointercancel takes the SAME lift path (audit H14): an OS-cancelled
       touch is a lift the engine must hear about, or it paints the last point
       until the staleness deadman finally catches it. */
    var liftBrush = function (e) {
      /* Only when a stroke is actually in progress: this is also on window, so
         without the guard every chip tap's pointerup would send a spatial
         body — asserting enabled:true for a stroke nobody drew. */
      var pointerId = e && e.pointerId;
      var spatialPointer = spatialPointers.get(pointerId);
      if (spatialPointer) {
        if (spatialPointer.retiring) return;
        /* Pointer-up carries a useful final coordinate. Stage it while the
           finger is still logically down, then retire that finger in-order. */
        pushXY(e);
        spatialPointer.retiring = true;
        queueSpatialTouches(true);
        var remaining = Array.from(spatialPointers.values()).filter(function (pointer) {
          return !pointer.retiring;
        });
        var spatialTouch = state.exports.sliderTouch;
        if (!remaining.length && spatialTouch !== undefined) {
          send('touch', function () {
            write('POST', '/layers/live_touch/control', { id: spatialTouch, v0: 0 });
          });
        }
        return;
      }
      if (wirePointer === null || pointerId !== wirePointer) return;
      wirePointer = null;
      if (!spatialPointers.size) wirePadRect = null;
      var t = state.exports.sliderTouch;
      if (t !== undefined) send('touch', function () { write('POST', '/layers/live_touch/control', { id: t, v0: 0 }); });
      /* LIFT THE BRUSH on the Live spatial stage too, or it keeps painting the last
         point forever and the trail never starts cooling.

         SENT THROUGH THE SAME COALESCING KEY as the moves, and CARRYING THE
         FINAL POSITION. Both halves are load-bearing, and each fixes a bug the
         other caused:
           - An immediate req() raced the queue and LOST — measured, the effect
             sat at touch:true, energy 0.29 after the drag ended: still
             painting. So the lift has to share the key to stay ordered.
           - But send() keeps only the LATEST fn per key, so a bare
             {touch:false} then DELETED the pending position — measured, a
             nine-sample drag sent exactly one request, {"touch":false}, and
             the stroke never moved off the previous target.
         Carrying x/y makes the lift a COMPLETE final sample, so replacing the
         queued move loses nothing. */
      /* Same queue as the moves, so the lift still cannot overtake them. */
      sendDraw(function () {
        var body = { enabled: true, touch: false };
        if (lastSpatial) {
          body.targetX = lastSpatial.targetX;
          body.targetY = lastSpatial.targetY;
        }
        return write('POST', '/spatial-paint', body);
      }, true);
    };
    xyPad.addEventListener('pointerup', liftBrush);
    xyPad.addEventListener('pointercancel', liftBrush);
    /* window too: with pointer capture the pad usually gets the up, but a
       cancel delivered after capture is torn down (page visibility change)
       lands on window only — and a missed lift is a painting ghost finger. */
    window.addEventListener('pointerup', liftBrush);
    window.addEventListener('pointercancel', liftBrush);

    xyPad.addEventListener('touchpixelviewchange', function (event) {
      var spec = event.detail;
      if (!spec || typeof spec.axisX !== 'string' || typeof spec.axisY !== 'string'
          || !Array.isArray(spec.pixelIndices) || spec.pixelIndices.length === 0) {
        fail('pixel view', 'view change did not include a canonical projection and pixel mask');
        return;
      }
      currentPixelViewId = spec.viewId;
      relabelPadAxes();
      lastSpatial = null;
      spatialPointers.clear();
      wirePadRect = null;
      if (state.phase !== 'armed') {
        forgetSpatialCfg();
        return;
      }
      sendDraw(function () {
        var body = {
          touch: false,
          strokes: [],
          axisX: spec.axisX,
          axisY: spec.axisY,
          pixelIndices: spec.pixelIndices,
        };
        return write('POST', '/spatial-paint', body).then(function (response) {
          if (!response) return response;
          spatialCfg.axisX = spec.axisX;
          spatialCfg.axisY = spec.axisY;
          spatialCfg.pixelIndices = spec.pixelIndices.slice();
          return response;
        });
      }, true);
    });
  }

  /* The selected chart defines the real model axes. Labels are part of the
     safety contract: they must describe the same projection sent to the engine. */
  var currentPixelViewId = 'top_down';
  function relabelPadAxes() {
    var sp = spatialMode();
    var top = document.querySelector('.pad-label.top');
    var bot = document.querySelector('.pad-label.bottom');
    var lft = document.querySelectorAll('.xy-frame .axis-label')[0];
    var rgt = document.querySelectorAll('.xy-frame .axis-label')[1];
    if (!sp) {
      if (top) top.textContent = 'Y+ STROBE FAST';
      if (bot) bot.textContent = 'Y− STROBE OFF';
      if (lft) lft.innerHTML = '<b>X−</b>DIM 5%';
      if (rgt) rgt.innerHTML = '<b>X+</b>BRIGHT';
      return;
    }
    var topPlane = currentPixelViewId === 'top_down' || currentPixelViewId === 'strands';
    if (top) top.textContent = topPlane ? 'Z+ SHIP FORWARD' : 'Y+ UP';
    if (bot) bot.textContent = topPlane ? 'Z− SHIP AFT' : 'Y− DOWN';
    if (currentPixelViewId === 'te_sign') {
      if (lft) lft.innerHTML = '<b>Z−</b>AFT';
      if (rgt) rgt.innerHTML = '<b>Z+</b>FORWARD';
    } else {
      if (lft) lft.innerHTML = '<b>X−</b>STARBOARD';
      if (rgt) rgt.innerHTML = '<b>X+</b>PORT';
    }
  }

  /* Switching mode re-labels the axes so the pad never claims the wrong thing. */
  if (modeToggle) {
    modeToggle.addEventListener('click', function () {
      setTimeout(function () {
        relabelPadAxes();
        applyCapability();
        if (!spatialMode() && spatialPointers.size) {
          spatialPointers.forEach(function (pointer) { pointer.retiring = true; });
          queueSpatialTouches(true);
          var touchId = state.exports.sliderTouch;
          if (touchId !== undefined) {
            send('touch', function () {
              write('POST', '/layers/live_touch/control', { id: touchId, v0: 0 });
            });
          }
        }
        /* DELIBERATELY NO PATTERN AUTO-LOAD HERE. Mode changes never stage a
           pattern or touch Deck; only explicit ARM stages the selected Live
           pattern, and the isolated spatial stage works across that channel. */
      }, 0);
    });
  }

  /* ── Z fader → global speed ─────────────────────────────────────────── */
  var zf = document.getElementById('zFader');
  if (zf) {
    var pushZ = function () {
      /* dataset.value, NOT the #zVal readout text (audit H6). The readout is
         updated only by the retired vertical-fader drag handler, so reading it
         meant every SPEED chip sent the same stale 0.72 — the chips write
         dataset.value, like every other chip row. */
      var v = parseFloat(zf.dataset.value);
      if (isNaN(v)) return;
      send('speed', function () { write('POST', '/param-center', { speed: v }); });
    };
    zf.addEventListener('pointerdown', pushZ);
    zf.addEventListener('pointermove', function (e) { if (e.pressure > 0 || e.buttons) pushZ(); });
    /* SPEED is a row of buttons now, not a vertical fader beside the pad, so it
       reports through the same 'sliderchange' every other chip row uses. The
       pointer listeners above stay for anything that still drags it. */
    zf.addEventListener('sliderchange', pushZ);
  }

  /* ── BPM + TEMPO SOURCE ───────────────────────────────────────────────
     The readout was WRITE-ONLY: the stepper pushed a tempo at the engine and
     nothing ever read the engine's tempo back, so while the engine followed the
     Audio Companion at 73 the panel still said 120. And the SYNC button was
     never bound at all - it lit up and did nothing.

     The engine side works: with the source set to OSC and a live audioBpm the
     arbiter follows it, and when the Companion stops it HOLDS the last tempo
     and reports 'held' rather than snapping back. So this is purely the panel
     catching up with it.

     THREE STATES, because "synced" and "selected" are not the same thing:
       SYNC  following the Companion right now (source osc, live)
       HELD  the Companion is selected but has gone quiet - the last tempo is
             being held. This is the state that used to look like SYNC while
             doing nothing.
       TAP   manual tempo; the Companion is ignored even if it is streaming.

     Tempo source is part of the owner-scoped Live context and is writable only
     while armed. Owner-tagged GET /mixer overlays the local tempo readback. */
  var bpmVal = document.getElementById('bpmVal');
  var bpmSync = document.getElementById('bpmSync');
  var bpmEcho = false;      /* set while WE repaint the readout */

  if (bpmVal) {
    new MutationObserver(function () {
      /* Without this guard, showing the engine's tempo would immediately post
         it BACK as a manual tempo and knock the rig off sync - the display
         would fight the thing it is displaying. */
      if (bpmEcho) return;
      var bpm = parseFloat(bpmVal.textContent);
      if (!isFinite(bpm) || bpm < 20 || bpm > 400) return;
      send('bpm', function () { write('POST', '/mixer/tempo', { bpm: bpm }); });
    }).observe(bpmVal, { childList: true, characterData: true, subtree: true });
  }

  function paintTempo(m) {
    if (!m) return;
    if (bpmVal && typeof m.tempoBpm === 'number') {
      var txt = Math.round(m.tempoBpm) + ' BPM';
      if (bpmVal.textContent !== txt) {
        bpmEcho = true;
        bpmVal.textContent = txt;
        setTimeout(function () { bpmEcho = false; }, 0);
      }
    }
    if (!bpmSync) return;
    var pref = m.tempoSourcePref;
    var liveSrc = m.tempoSource;
    var label = pref !== 'osc' ? 'TAP' : (liveSrc === 'osc' ? 'SYNC' : 'HELD');
    bpmSync.textContent = label;
    bpmSync.classList.toggle('is-on', label === 'SYNC');
    bpmSync.classList.toggle('is-held', label === 'HELD');
    bpmSync.title = label === 'SYNC'
      ? 'Following the Audio Companion (' + Math.round(m.oscTempoBpm || m.tempoBpm) + ' BPM). Tap for manual.'
      : (label === 'HELD'
        ? 'Companion selected but sending nothing - holding the last tempo. Tap for manual.'
        : 'Manual tempo. Tap to follow the Audio Companion.');
  }

  function refreshTempo() {
    return req('GET', '/mixer').then(paintTempo)
      .catch(function (e) { fail('tempo', e); });
  }

  /* Re-state every fader's audio choice on ARM. The bindings are cleared on
     disarm, so this is what puts them back - and it means what the engine is
     doing always matches what the surface shows, rather than whatever was last
     written to it. */
  function pushAllAudioBindings(strict) {
    var tasks = [];
    if (bank) {
      Array.prototype.forEach.call(bank.querySelectorAll('.fader-audio'), function (w) {
        tasks.push(function () { return faderAudioWrite(w, strict); });
      });
    }
    if (fxGrid) {
      Array.prototype.forEach.call(fxGrid.querySelectorAll('.aud-row'), function (r) {
        tasks.push(function () { return audWrite(r, strict); });
      });
    }
    return strict ? runSeries(tasks) : Promise.all(tasks.map(function (task) { return task(); }));
  }
  armAsserts.push(pushAllAudioBindings);
  /* Re-state the effect scope on ARM. Disarming clears it to unrestricted, so
     without this the FX marks would still be lit on the surface while the
     engine had forgotten them - the panel showing one thing and the rig doing
     another. The dedupe key is reset first or the re-assert would be swallowed
     as "no change". */
  armAsserts.push(function (strict) { lastFxGroups = null; return pushEffectGroups(strict); });
  if (bpmSync) {
    bpmSync.addEventListener('click', function () {
      var next = bpmSync.textContent === 'TAP' ? 'osc' : 'tap';
      write('POST', '/mixer/tempo/source', { source: next })
        .then(paintTempo)
        .catch(function (e) { fail('tempo source', e); });
    });
  }
  refreshTempo();

  /* ── LIVE BRIGHTNESS FACTORS ──────────────────────────────────────────
     These are transient multipliers, never Dimmer Rack or Mixer authority.
     The engine applies rack ceiling × Live master × Live group. All mutations
     are revisioned and serialized so two fast faders cannot race revisions. */
  var liveBrightnessPending = { master: null, groups: {} };
  var liveBrightnessPendingFade = null;
  var liveBrightnessTimer = null;
  var liveBrightnessBusy = false;

  function acceptLiveBrightness(payload, requireActive) {
    if (!payload || typeof payload.active !== 'boolean'
        || !Number.isInteger(payload.revision) || payload.revision < 0
        || !Number.isInteger(payload.rackRevision) || payload.rackRevision < 0
        || !payload.groups || typeof payload.groups !== 'object' || Array.isArray(payload.groups)
        || !payload.rackCeilings || typeof payload.rackCeilings !== 'object'
        || Array.isArray(payload.rackCeilings)
        || !payload.effectiveCaps || typeof payload.effectiveCaps !== 'object'
        || Array.isArray(payload.effectiveCaps)) {
      throw new Error('engine returned invalid Live Touch brightness state');
    }
    if (requireActive && (!payload.active || payload.ownerId !== OWNER)) {
      throw new Error('Live Touch brightness lease is not owned by this surface');
    }

    var acceptance = window.TouchControlLifecycle.revisionAcceptance(
      state.liveBrightnessRevision,
      state.rackBrightnessRevision,
      payload.revision,
      payload.rackRevision
    );
    if (acceptance.live) {
      state.liveBrightnessRevision = payload.active ? payload.revision : null;
    }
    if (acceptance.rack) {
      state.rackBrightnessRevision = payload.rackRevision;
      state.rackCeilings = payload.rackCeilings;
    }
    if (acceptance.effective) {
      state.liveEffectiveCaps = payload.effectiveCaps;
    } else if (acceptance.live || acceptance.rack) {
      /* A cap belongs to one exact (Live, Rack) revision pair. Keep no value
         when only one side of an interleaved payload was current. */
      state.liveEffectiveCaps = {};
    }
    return payload;
  }

  function stripLevel(strip) {
    var level = parseFloat(strip.dataset.level || '0') / 100;
    if (!isFinite(level) || level < 0 || level > 1) {
      throw new Error('brightness strip has an invalid level');
    }
    var power = strip.querySelector('[data-role=power]');
    return power && !power.classList.contains('is-on') ? 0 : level;
  }

  function collectLiveBrightness() {
    var masterStrip = document.querySelector('#groupsGrid .fader-strip.is-master');
    if (!masterStrip) throw new Error('Live Touch has no master brightness strip');
    var groups = {};
    var seen = {};
    Array.prototype.forEach.call(
      document.querySelectorAll('#groupsGrid .fader-strip:not(.is-master)'),
      function (strip) {
        var nameElement = strip.querySelector('.fader-name');
        var name = nameElement && nameElement.textContent;
        if (!name || !Object.prototype.hasOwnProperty.call(state.sectionIds, name)) {
          throw new Error('Live Touch brightness has an unknown group "' + name + '"');
        }
        if (seen[name]) throw new Error('Live Touch brightness repeats group "' + name + '"');
        seen[name] = true;
        groups[name] = stripLevel(strip);
      }
    );
    Object.keys(state.sectionIds).forEach(function (name) {
      if (!seen[name]) throw new Error('Live Touch brightness is missing group "' + name + '"');
    });
    return { master: stripLevel(masterStrip), groups: groups };
  }

  function initializeLiveBrightness() {
    liveBrightnessPending = { master: null, groups: {} };
    liveBrightnessPendingFade = null;
    if (liveBrightnessTimer) { cancelAnimationFrame(liveBrightnessTimer); liveBrightnessTimer = null; }
    return req('GET', '/touch-control/brightness').then(function (payload) {
      acceptLiveBrightness(payload, true);
      var initial = collectLiveBrightness();
      initial.expectedRevision = state.liveBrightnessRevision;
      return req('PUT', '/touch-control/brightness', initial);
    }).then(function (payload) {
      return acceptLiveBrightness(payload, true);
    });
  }

  function pumpLiveBrightness() {
    if (liveBrightnessBusy || state.phase !== 'armed') return Promise.resolve();
    var body = null;
    var path = '/touch-control/brightness';
    if (liveBrightnessPending.master !== null
        || Object.keys(liveBrightnessPending.groups).length > 0) {
      body = { expectedRevision: state.liveBrightnessRevision };
      if (liveBrightnessPending.master !== null) body.master = liveBrightnessPending.master;
      if (Object.keys(liveBrightnessPending.groups).length > 0) {
        body.groups = liveBrightnessPending.groups;
      }
      liveBrightnessPending = { master: null, groups: {} };
    } else if (liveBrightnessPendingFade) {
      path = '/touch-control/brightness/master/fade';
      body = {
        expectedRevision: state.liveBrightnessRevision,
        target: liveBrightnessPendingFade.target,
        durationMs: liveBrightnessPendingFade.durationMs,
      };
      liveBrightnessPendingFade = null;
    }
    if (!body) return Promise.resolve();
    if (!Number.isInteger(body.expectedRevision)) {
      fail('brightness', 'no active Live Touch brightness revision');
      return Promise.resolve();
    }
    liveBrightnessBusy = true;
    var succeeded = true;
    return req(path === '/touch-control/brightness' ? 'PATCH' : 'POST', path, body)
      .then(function (payload) { acceptLiveBrightness(payload, true); })
      .catch(function (error) {
        succeeded = false;
        liveBrightnessPending = { master: null, groups: {} };
        liveBrightnessPendingFade = null;
        fail('brightness', error);
      })
      .then(function () {
        liveBrightnessBusy = false;
        return succeeded ? pumpLiveBrightness() : null;
      });
  }

  function scheduleLiveBrightness() {
    if (liveBrightnessTimer || state.phase !== 'armed') return;
    liveBrightnessTimer = requestAnimationFrame(function () {
      liveBrightnessTimer = null;
      pumpLiveBrightness();
    });
  }

  function queueLiveMaster(value) {
    if (state.phase !== 'armed') return;
    liveBrightnessPending.master = value;
    scheduleLiveBrightness();
  }

  function queueGroup(name, value) {
    if (state.phase !== 'armed') return;
    liveBrightnessPending.groups[name] = value;
    scheduleLiveBrightness();
  }

  function flushGroups() {
    if (liveBrightnessTimer) { cancelAnimationFrame(liveBrightnessTimer); liveBrightnessTimer = null; }
    return pumpLiveBrightness();
  }

  function queueLiveMasterFade(target, durationMs) {
    if (state.phase !== 'armed') return;
    liveBrightnessPendingFade = { target: target, durationMs: durationMs };
    flushGroups();
  }

  /* ── GROUP faders → Live Touch brightness factors ─────────────────── */
  var bank = document.getElementById('groupsGrid');

  /* Ticking GLOBAL/FX/OWN, switching a group off, or dragging a group's own dot
     all change what should be painted, so they all land here. applyStatic()
     coalesces and staggers, so a dot drag costs no more writes than a wheel
     drag. Registered HERE, next to the assignment: up with the palette listener
     `bank` is still hoisted-but-undefined, so the listener would silently never
     be attached - the exact shape of bug that has already cost this panel a
     whole build. */
  /* Assigned inside the `if (bank)` block below, where pushGroup lives. Same
     shape as groupSchemeSync: this listener is registered BEFORE that block
     runs, so it cannot name pushGroup directly. */
  var pushAllGroupLevels = null;

  if (bank) bank.addEventListener('groupmodeschange', function () {
    applyStatic();
    pushEffectGroups();
    /* AND RE-SEND EVERY GROUP'S LEVEL.
       MEASURED on the rig, then reproduced: tapping a group's POWER switch
       sent {"sectionId":3,"brightness":1} - the OLD value - and the correct 0
       only went out when the operator next touched a fader. Cause: pointerup
       fires BEFORE click. The level push rides pointerup and reads the switch
       while the page's click handler has not toggled it yet, so it always
       ships the pre-tap state. Operator: "they don't do anything till I drop
       the master fader."
       groupmodeschange fires AFTER the toggle (the page publishes from its own
       click handler), so pushing here sends the truth. queueGroup dedupes on
       value, so nothing extra goes out when nothing actually changed. */
    if (pushAllGroupLevels) pushAllGroupLevels();
    /* AND FLUSH IT NOW, don't trickle.
       The queue exists to survive a DRAG - 141 writes/s was measured dragging
       the engine from 40 fps to 15 - so it releases only GROUP_WRITES_PER_TICK
       (4) every FLUSH_MS (100). A power toggle is not a drag: it is one
       discrete decision, and switching all 24 groups off queued 24 changes that
       MEASURED ~15 s to dribble out, while the master fader is a single
       un-queued PATCH and lands instantly. That is exactly why the operator
       reported "the only way the lights go down is the master fader".
       Discrete changes flush whole; continuous drags keep the rate limit. */
    flushGroups(true);
  });

  /* ── FX marks → the engine's effect scope ─────────────────────────────
     PUT /effect-groups restricts the ENTIRE effect chain to the named groups,
     so an effect can play on the smokestacks while the hull carries on with the
     Live pattern. Effects are otherwise Live-wide: only group_fixed_color looks
     at a pixel's group, so without this there is no way to aim one.

     NOTHING MARKED SENDS null - unrestricted, which is the shipped behaviour
     and what an operator who has not singled anything out means. That is a
     documented default, not a guess: the engine also accepts an explicit []
     for "nowhere", and the panel simply never sends it, because a surface where
     un-ticking the last box blacks out every effect would be a trap.

     Only sent when the set actually CHANGES - this rides the same event as the
     paint, which fires on every dot drag. */
  var lastFxGroups = null;
  function pushEffectGroups(strict) {
    var names = groupModes()
      .filter(function (m) { return m && m.fx; })
      .map(function (m) { return m.name; });
    var payload = names.length ? names : null;
    var key = JSON.stringify(payload);
    if (key === lastFxGroups) return Promise.resolve();
    lastFxGroups = key;
    /* write(), NOT req(). I first sent this with req() on the grounds that a
       scope is a routing choice like the audio dropdowns. That was wrong, and
       it showed up on the rig: with the panel DISARMED the FX marks still
       landed, so the engine was carrying a scope from a surface that is
       writing nothing else - a disarmed panel silently confining the VSN1's
       and the Deck's effects. Disarmed has to mean disarmed.
       armAsserts re-states the scope on ARM, and cleanupLiveState clears it, so
       nothing is lost by making it obey the same gate as the paint. */
    return (strict ? strictWrite : write)('PUT', '/effect-groups', { groups: payload })
      .catch(function (e) {
        fail('effect groups', e);
        if (strict) throw e;
      });
  }

  if (bank) {
    /* Live Touch faders are normalized performance factors. The Dimmer Rack
       remains the authoritative ceiling for every group. */
    var pushMaster = function (strip) {
      var lvl = parseFloat(strip.dataset.level || '0') / 100;
      var on = strip.querySelector('[data-role=power]');
      var v = (on && !on.classList.contains('is-on')) ? 0 : lvl;
      queueLiveMaster(v);
    };

    var pushGroup = function (strip) {
      if (strip.classList.contains('is-master')) return pushMaster(strip);
      var name = strip.querySelector('.fader-name');
      if (!name) return;
      if (state.sectionIds[name.textContent] === undefined) {
        return fail('group', 'no Dimmer Rack group for "' + name.textContent + '"');
      }
      var on = strip.querySelector('[data-role=power]');
      var lvl = parseFloat(strip.dataset.level || '0') / 100;
      queueGroup(name.textContent, (on && !on.classList.contains('is-on')) ? 0 : lvl);
    };

    /* Every group's level, re-stated. Called from groupmodeschange (see the
       note there) so a POWER toggle lands on the frame it is made rather than
       on the operator's next touch. Groups only - the master strip has its own
       push and is not deduped, so sweeping it here would spam /mixer. */
    pushAllGroupLevels = function () {
      Array.prototype.forEach.call(bank.querySelectorAll('.fader-strip'), function (st) {
        if (!st.classList.contains('is-master')) pushGroup(st);
      });
    };
    /* One delegated listener covers taps AND drags on every strip, including
       the ones the master fader moves. */
    /* Continuous while dragging, not just on release — the operator expects the
       lights to follow the finger. send() keys per section, so a drag collapses
       to at most 10 writes/sec for that one group however fast it moves. */
    bank.addEventListener('pointermove', function (e) {
      if (!(e.pressure > 0 || e.buttons)) return;
      var s = e.target.closest('.fader-strip'); if (s) pushGroup(s);
    });
    bank.addEventListener('pointerup', function (e) {
      var s = e.target.closest('.fader-strip'); if (s) pushGroup(s);
      flushGroups(true);
    });
    /* Switching a group off must drop its paint, not leave it lit. */
    bank.addEventListener('click', function (e) {
      if (e.target.closest('[data-role=power]')) setTimeout(applyStatic, 0);
    });
    bank.addEventListener('click', function (e) {
      var s = e.target.closest('.fader-strip'); if (s) pushGroup(s);
    });
    bank.addEventListener('groupprofilebrightnesschange', function (event) {
      var detail = event.detail || {};
      if (!Array.isArray(detail.names) || !detail.names.length) {
        fail('group profile', 'brightness change did not name canonical groups');
        return;
      }
      detail.names.forEach(function (name) {
        var strip = Array.prototype.find.call(
          bank.querySelectorAll('.fader-strip:not(.is-master)'),
          function (candidate) {
            var label = candidate.querySelector('.fader-name');
            return label && label.textContent === name;
          });
        if (!strip) {
          fail('group profile', 'brightness change named unknown group "' + name + '"');
          return;
        }
        pushGroup(strip);
      });
      if (detail.final === true) flushGroups(true);
    });
    bank.addEventListener('groupprofilemasterchange', function (event) {
      var detail = event.detail || {};
      if (typeof detail.value !== 'number' || detail.value < 0 || detail.value > 1) {
        fail('group profile', 'master change was outside 0..1');
        return;
      }
      queueLiveMaster(detail.value);
      if (detail.final === true) flushGroups(true);
    });
    /* The master moves many strips at once and fires no per-strip event. */
    var mtr = bank.querySelector('[data-role=masterfader]');
    if (mtr) {
      var pushAll = function () {
        Array.prototype.forEach.call(bank.querySelectorAll('.fader-strip'), pushGroup);
      };
      mtr.addEventListener('pointermove', function (e) {
        if (e.pressure > 0 || e.buttons) pushAll();
      });
      mtr.addEventListener('pointerup', function () { pushAll(); flushGroups(true); });
    }
  }

  /* ── EFFECTS → owner-scoped Live effect slots ──────────────────────
     `POST /global-effect` only accepts the legacy DMX toggles (fogger,
     vintageWhite, blastWhite, uvBlast). Every pixel effect — strobe, colorWash,
     waterlineSweep, dropHit, beatPump… — is SLOT based: the engine holds
     provisioned effectId+presetId pairs and you press the slot.

     Owner-tagged calls are intercepted into the in-memory Live context. The
     panel preserves its established slot 9-17 allocation and never mutates
     durable Deck/Mixer/global slots. */
  var slotOf = {};   /* "effectId|presetId" -> slotId */

  /* Effects that actually carry a colour (their presets define a 6-element
     RGBWAU `color`), read off GET /global-effect-library. Everything else has
     no colour for the wheel to drive. */
  /* EMPTY ON PURPOSE. The panel no longer offers a single colour effect —
     colorWash (takeover), dropHit and kickPunch (additive colour flashes) and
     waterlineSweep's add-mode presets are all gone. Every effect on the grid
     changes brightness, timing or persistence and paints nothing, so there is
     no effect colour left to drive and nothing to restore on disarm. The wheel
     is the only thing that sets colour. */
  var COLOUR_EFFECTS = [];
  /* The four LEGACY DMX effects. They do NOT appear in the slot controller at
     all (controller.fogger is null) — their state lives in globals.effects, and
     pressing their slot twice does NOT toggle them off. MEASURED: two presses
     left fogger: true, i.e. a fog machine that will not stop.
     They are driven by POST /global-effect { effect, state } instead, which is
     IDEMPOTENT — you set true or false rather than flipping, so no amount of
     re-running can leave one stuck on. */
  var LEGACY_DMX = ['fogger', 'vintageWhite', 'blastWhite', 'uvBlast'];

  /* COLOUR NEUTRALITY.
     The wheel owns colour; an effect owns motion and brightness. Two effects
     still tint on their own even though the wheel cannot reach them, and both
     have a parameter that turns it off:
       breath          `warmth` drives AMBER ("the one place amber is
                       intentionally driven"). Forced to 0 -> a pure brightness
                       swell, which is what "breathing" should be.
       feedbackTrails  `colorBleed` shifts the hue along the tail. Forced to 0
                       -> trails that are the chosen colour, fading.
     (sparkle and invert cannot be neutralised — sparkle writes ice-white into W
     with no colour param, invert flips the chosen hue to its opposite — so they
     are not offered at all.) */
  var COLOUR_NEUTRAL = { breath: { warmth: 0 }, feedbackTrails: { colorBleed: 0 } };
  /* patchSlot REPLACES paramsOverride wholesale (`next.paramsOverride =
     {...patch.paramsOverride}`), so anything sent must carry the whole object
     or the slot's amount/mode are wiped along with the colour. */
  var slotBehavior = {};        /* slotId -> 'toggle' | 'trigger' | 'hold' */
  var slotBinding = {};         /* slotId -> 'effectId|presetId' actually bound */
  var presetOverride = {};      /* slotId -> its ORIGINAL override, captured once */
  var liveOverride = {};        /* slotId -> its current override */

  function loadSlots(strict) {
    return req('GET', '/global-effect-slots').then(function (r) {
      slotOf = {};
      (r.slots || []).forEach(function (sl) {
        if (sl.effectId) slotOf[sl.effectId + '|' + sl.presetId] = sl.slotId;
        slotBehavior[sl.slotId] = sl.behavior || 'toggle';
        slotBinding[sl.slotId] = sl.effectId ? (sl.effectId + '|' + sl.presetId) : null;
        /* Remember the ORIGINAL override ONCE, before the wheel touches it.
           A PATCH persists, so without this the wheel would permanently destroy
           "ocean blue" and "emergency red". */
        liveOverride[sl.slotId] = sl.paramsOverride || {};
        if (presetOverride[sl.slotId] === undefined) {
          presetOverride[sl.slotId] = JSON.parse(JSON.stringify(sl.paramsOverride || {}));
        }
      });
      markCells();
    }).catch(function (e) {
      fail('slots', e);
      if (strict) throw e;
    });
  }

  /* Effects that are momentary rather than latching, per the library's
     behaviorTypes. Everything else is a toggle. */
  var TRIGGER_EFFECTS = ['dropHit'];
  var OURS_FROM = 9;          /* slots 1-8 belong to the Deck + VSN1 */
  var MAX_SLOTS = 32;         /* global_effect_slot_manager.MAX_SLOTS */

  /* Provision a real engine slot for every grid cell that has none, so the
     whole grid is live instead of 7 of 25 buttons.

     Only ever writes slots 9..32 — 1..8 are the Deck's and the VSN1's, and
     re-binding those would silently change the hardware panel under the
     operator. This runs only while ARMED, and it PERSISTS (the engine saves
     the slot layout), so it is deliberately not something an idle page does. */
  /* Each button owns a FIXED slot (its data-slot, 9..24) and is provisioned to
     whatever its dropdown currently says. Re-pointing a button re-provisions
     that one slot — no searching for a free one, no chance of colliding with
     the Deck's or the VSN1's 1-8. */
  function provisionCell(cell) {
    if (!liveStateCanWrite(true)) return Promise.reject(new Error('cannot provision effects without a Live lease'));
    var id = Number(cell.dataset.slot);
    if (!(id >= OURS_FROM && id <= MAX_SLOTS)) {
      var slotError = new Error('button has slot ' + id + ', outside 9..32');
      fail('build', slotError);
      return Promise.reject(slotError);
    }
    var eff = cell.dataset.fxkey;
    var body = {
      enabled: true,
      label: cell.querySelector('.fx-name').textContent,
      effectId: eff,
      presetId: cell.dataset.preset,
      behavior: TRIGGER_EFFECTS.indexOf(eff) !== -1 ? 'trigger' : 'toggle',
    };
    /* ALWAYS send an explicit paramsOverride. patchSlot only replaces the
       object when the key is present, so omitting it left a STALE `color` from
       an earlier layout sitting on the slot — a colour nobody had chosen,
       surviving every rebuild. Sending {} clears it; the colour-neutral effects
       get their tint-killing keys instead. */
    var ov = {};
    if (COLOUR_NEUTRAL[eff]) {
      Object.keys(COLOUR_NEUTRAL[eff]).forEach(function (k) { ov[k] = COLOUR_NEUTRAL[eff][k]; });
    }
    /* MOVEMENT effects take the operator's palette as their `colors`. They
       decide WHERE the colours sit along each group and how they travel; the
       wheel decides what the colours ARE. Sending the palette here is what
       makes "one pixel per colour" mean the five colours on screen rather than
       whatever the preset shipped with. */
    if (eff === 'movementTrace') {
      ov.colors = paletteRgb6();
      ov.fadeSpan = movementFadeSpan();
      ov.switchMs = fadeMs;
    }
    body.paramsOverride = ov;
    liveOverride[id] = ov;
    return strictWrite('PATCH', '/global-effect-slots/' + id, body);
  }

  function buildEffectSlots() {
    if (!liveStateCanWrite(true) || !fxGrid) return Promise.resolve();
    var cells = Array.prototype.slice.call(fxGrid.querySelectorAll('.fx-cell'));
    var mine = {};
    cells.forEach(function (c) { mine[Number(c.dataset.slot)] = true; });
    /* Retire any slot in OUR range that no button owns. Left enabled, a stale
       slot from an earlier layout can still be fired by anything else and shows
       up as an effect the panel never started. */
    var tasks = cells.map(function (cell) {
      return function () { return provisionCell(cell); };
    });
    for (var id = OURS_FROM; id <= MAX_SLOTS; id++) {
      if (!mine[id] && slotBinding[id]) {
        (function (slotId) {
          tasks.push(function () {
            return strictWrite('PATCH', '/global-effect-slots/' + slotId, { enabled: false });
          });
        }(id));
      }
    }
    return runSeries(tasks)
      .then(function () { return loadSlots(true); })
      .then(function () {
        cells.forEach(function (cell) {
          var slotId = Number(cell.dataset.slot);
          var expected = cell.dataset.fxkey + '|' + cell.dataset.preset;
          if (slotBinding[slotId] !== expected) {
            throw new Error('slot ' + slotId + ' readback is "' + slotBinding[slotId] +
              '" after provisioning; expected "' + expected + '"');
          }
        });
      });
  }

  function markCells() {
    if (!fxGrid) return;
    Array.prototype.forEach.call(fxGrid.querySelectorAll('.fx-cell'), function (c) {
      /* Each button OWNS its slot (data-slot, set when the grid was built).
         An earlier version re-derived it here by matching effect+preset against
         whatever the engine happened to have provisioned, which scattered the
         buttons across slots 25..32 and out of the range they are meant to own.
         The button's slot is fixed; only its STATE is read from the engine. */
      var id = Number(c.dataset.slot);
      /* Compare the slot's OWN binding, not a reverse effect->slot lookup: two
         slots can hold the same effect+preset (stale ones from an earlier
         layout did), and the lookup then returned the WRONG slot and marked a
         perfectly good button unwired. */
      var live = id >= OURS_FROM && slotBinding[id] === (c.dataset.fxkey + '|' + c.dataset.preset);
      c.classList.toggle('fx-unwired', !live);
      c.classList.toggle('fx-momentary', live && slotBehavior[id] === 'trigger');
      /* No cell is marked for colour any more: none of them paint. */
      c.classList.remove('fx-nocolour');
      c.title = (live ? 'slot ' + id : 'not provisioned yet') +
        ' — movement only; colour comes from the wheel';
    });
  }

  var fxGrid = document.getElementById('fxGrid');

  /* Which slots the ENGINE currently has running. The controller reports one
     entry per effect with the slotId that owns it, so a slot is live only if
     its own id is the one holding the effect. */
  function engineOnSlots() {
    return Promise.all([
      req('GET', '/global-effect-slots/status'),
      req('GET', '/globals'),
    ]).then(function (r) {
      var st = r[0], globals = r[1] || {};
      var on = {};
      var c = (st && st.controller) || {};
      Object.keys(c).forEach(function (k) {
        var v = c[k];
        if (v && typeof v === 'object' && (v.enabled || v.active) && v.slotId) on[v.slotId] = true;
      });
      /* Some effects report as a PLAIN BOOLEAN with no slotId at all —
         controller.invert is literally `true`. Those are attributed to whichever
         button owns them, or they read as permanently off and reconcile presses
         them again on every tick. */
      if (fxGrid) {
        Array.prototype.forEach.call(fxGrid.querySelectorAll('.fx-cell'), function (cell) {
          if (c[cell.dataset.fxkey] === true) on[Number(cell.dataset.slot)] = true;
        });
      }
      /* Legacy DMX effects are invisible to the controller, so their state is
         read from globals and attributed to whichever button owns them. */
      var ge = globals.effects || {};
      if (fxGrid) {
        Array.prototype.forEach.call(fxGrid.querySelectorAll('.fx-cell'), function (cell) {
          if (LEGACY_DMX.indexOf(cell.dataset.fxkey) === -1) return;
          if (ge[cell.dataset.fxkey]) on[Number(cell.dataset.slot)] = true;
        });
      }
      return on;
    });
  }

  /* RECONCILE the engine to what the grid shows.

     The old handler pressed ONLY the tapped slot. That is wrong the moment a
     family swap happens: tapping a second DIM effect turns the first one off in
     the UI, but nothing ever told the engine — so the displaced effect kept
     running on the rig with its button showing OFF and no way to stop it. That
     is the "I can't turn it off" bug, and it was mine.

     Pressing by difference fixes the whole class: whatever the grid says should
     be on, is made on; whatever it says should be off, is made off. It also
     self-heals any drift, because the engine is read first rather than assumed. */
  /* SERIALISED. `press` is a TOGGLE, so a reconcile that overlaps another one
     reads stale engine state and presses the same slot again — and an even
     number of toggles puts it right back where it started. MEASURED: untapping
     one cell issued FOUR presses (click handler + poll ticks racing) and the
     effect stayed on. One at a time, with a single re-run queued if something
     asked while we were busy. */
  var rcBusy = false, rcAgain = false;
  /* A press is a TOGGLE and the engine's status readback lags it, so a
     reconcile that runs again too soon still sees the OLD state and presses the
     same slot a second time — putting it straight back. MEASURED: one tap
     produced three presses. A slot pressed within this window is left alone
     until its new state is actually observable. */
  var SETTLE_MS = 1800;
  var lastPress = {};

  function reconcileEffects(strict) {
    strict = strict === true;
    if (!fxGrid || !liveStateCanWrite(strict)) return Promise.resolve();
    if (rcBusy) {
      rcAgain = true;
      return strict ? Promise.reject(new Error('effect reconciliation is already in progress')) : Promise.resolve();
    }
    rcBusy = true;
    return engineOnSlots().then(function (on) {
      var want = {};
      Array.prototype.forEach.call(fxGrid.querySelectorAll('.fx-cell'), function (c) {
        var id = Number(c.dataset.slot);
        if (!c.dataset.slot || id < 9) return;
        want[id] = want[id] || c.classList.contains('is-on');
      });
      var now = Date.now();
      var tasks = [];
      function cellFor(id) {
        return fxGrid ? fxGrid.querySelector('.fx-cell[data-slot="' + id + '"]') : null;
      }
      function pressOnce(id) {
        if (now - (lastPress[id] || 0) < SETTLE_MS) return;   /* still settling */
        lastPress[id] = now;
        var cell = cellFor(id);
        var key = cell && cell.dataset.fxkey;
        if (key && LEGACY_DMX.indexOf(key) !== -1) {
          /* Set, do not toggle — see LEGACY_DMX above. */
          tasks.push(function () {
            return (strict ? strictWrite : write)('POST', '/global-effect', { effect: key, state: !!want[id] });
          });
          return;
        }
        tasks.push(function () {
          return (strict ? strictWrite : write)('POST', '/global-effect-slots/' + id + '/press');
        });
      }
      Object.keys(want).forEach(function (id) {
        /* NEVER try to hold a trigger on. It fires and ends, so the engine
           always reports it off while the cell is lit — and reconcile then
           pressed it again on every tick, firing a whiteout every couple of
           seconds. MEASURED: dropHit fired 3 times in 7s with nobody touching
           it. Triggers fire once, from the tap, and nowhere else. */
        if (slotBehavior[id] === 'trigger') return;
        if (!!on[id] === !!want[id]) return;            /* already agrees */
        pressOnce(id);
      });
      /* Anything RUNNING that this grid does not claim gets switched off —
         including slots 1-8. While armed the panel owns the rig, and an effect
         the operator cannot see or reach is exactly the "it won't turn off"
         problem. This only ever turns those slots OFF; it never binds or
         re-provisions them, so the Deck's and the VSN1's own bindings survive. */
      Object.keys(on).forEach(function (id) {
        if (want[id] || slotBehavior[id] === 'trigger') return;
        pressOnce(id);
      });
      return runSeries(tasks);
    }).then(function () {
      rcBusy = false;
      if (!rcAgain) return;
      rcAgain = false;
      return reconcileEffects(strict);
    }).catch(function (e) {
      rcBusy = false;
      fail('effects', e);
      if (strict) throw e;
    });
  }

  if (fxGrid) {
    /* The page fires this whenever a dropdown re-points a button. */
    fxGrid.addEventListener('fxassign', function (e) {
      var cell = e.target.closest('.fx-cell');
      if (!cell) return;
      /* Building the catalog dispatches fxassign for every default cell while
         the Live tab is still passive.  Catalog construction is local UI
         state, not operator intent, so it must not attempt owner-tagged slot
         provisioning until ARM has acquired the Live session. */
      if (!liveStateCanWrite(false)) return;
      provisionCell(cell).then(loadSlots).then(function () {
        pushEffectColours();
        return reconcileEffects();
      });
    });

    /* The page drives the lit state from pointerdown/up (hold or tap), so the
       wire reconciles after EITHER edge rather than on click. */
    ['pointerdown', 'pointerup', 'pointercancel'].forEach(function (evt) {
      fxGrid.addEventListener(evt, function (e) {
        if (!e.target.closest('[data-role=fxface]')) return;
        setTimeout(function () {
          reconcileEffects();
          applyStatic();
          /* A movement button that has just been lit must start on the CURRENT
             palette and the CURRENT fade. Both are only pushed to lit cells, so
             without this a button turned on later ran with whatever it was
             provisioned with at arm time - stale colours and a fade bar that
             appeared to do nothing. */
          pushMovementColours();
          pushMovementFade();
        }, 0);
      });
    });

    fxGrid.addEventListener('click', function (e) {
      var cell = e.target.closest('.fx-cell');
      if (!cell || e.target.closest('[data-role=fxpick]')) return;
      var id = Number(cell.dataset.slot);
      /* MOMENTARY: a trigger fires on the tap and immediately un-latches, so it
         never sits lit waiting to be "turned off" — there is nothing running to
         turn off. The brief flash of the lit cell is the feedback. */
      if (!e.target.closest('[data-role=fxface]')) return;
      if (cell.dataset.slot && id >= 9 && slotBehavior[id] === 'trigger') {
        if (cell.classList.contains('is-on')) {
          send('slot' + id, function () { write('POST', '/global-effect-slots/' + id + '/press'); });
          setTimeout(function () { cell.classList.remove('is-on'); refreshFxCountSafe(); }, 220);
        }
        return;
      }
      /* After the page's own handler has applied the tap AND any family swap. */
      setTimeout(function () {
          reconcileEffects();
          applyStatic();
          /* A movement button that has just been lit must start on the CURRENT
             palette and the CURRENT fade. Both are only pushed to lit cells, so
             without this a button turned on later ran with whatever it was
             provisioned with at arm time - stale colours and a fade bar that
             appeared to do nothing. */
          pushMovementColours();
          pushMovementFade();
        }, 0);
    });
  }

  /* The page owns the effect counter; nudge it after a momentary un-latch. */
  function refreshFxCountSafe() {
    var el = document.getElementById('fxCount');
    if (!el || !fxGrid) return;
    var on = fxGrid.querySelectorAll('.fx-cell.is-on').length;
    var tex = fxGrid.querySelectorAll('.fx-cell.is-on[data-fam=texture]').length;
    el.textContent = on + ' active · ' + tex + ' stacked';
  }

  /* The effect buttons carry NO amount fader any more — they are trigger /
     latch keys, so there is nothing to send an intensity for. Each preset
     already defines its own amount. */

  /* ── BRIGHT → transient Live Touch master factor ─────────────────── */
  var briSlider = document.querySelector('.slider-vertical.bright');
  if (briSlider) {
    briSlider.addEventListener('sliderchange', function () {
      var v = parseFloat(briSlider.dataset.value);
      if (!isFinite(v)) return;
      queueLiveMaster(v);
    });
  }

  /* ── FADE → the engine's crossfade times ───────────────────────────────
     `colorTransitionMs` ("Color Fade") makes the ENGINE ease the palette from
     the old colour to the new one instead of cutting, and `motionTransitionMs`
     ("Motion Glide") does the same for the numeric params, so a movement change
     eases in rather than snapping. Both are driven from this one bar, because
     an operator thinks in "how fast does the look change", not in two numbers.
     Sent on release AND while dragging, throttled by send(). */
  var FADE_MAX_MS = 5000;
  var fadeSlider = document.querySelector('.slider-vertical.fade');
  var fadeMs = 800;                 /* the engine's own default */

  /* ── PRESET TRANSITIONS ───────────────────────────────────────────────
     The page owns the presets and decides WHEN to move; this layer owns the
     engine and does the moving. Two kinds, both built from machinery that
     already exists, which is why they cost nothing new in the engine:

       fade  set colorTransitionMs / motionTransitionMs for the recall, so the
             palette EASES to the preset's colours instead of cutting. This is
             the same pair the FADE bar drives; the value is restored
             afterwards so a transition choice never silently rewrites the
             operator's own fade setting.
       dip   fades the transient Live Touch master. It cannot exceed or mutate
             the authoritative Dimmer Rack ceiling.

     write(), not req(): both put light on the rig, so a disarmed panel must
     not be able to do either. */
  var savedTransitionMs = null;
  document.addEventListener('presettransition', function (e) {
    var d = e.detail || {};
    if (d.kind === 'fade') {
      if (savedTransitionMs === null) savedTransitionMs = fadeMs;
      write('POST', '/param-center', { colorTransitionMs: d.ms, motionTransitionMs: d.ms })
        .catch(function (err) { fail('preset fade', err); });
    } else if (d.kind === 'fade-restore') {
      if (savedTransitionMs === null) return;
      var back = savedTransitionMs;
      savedTransitionMs = null;
      write('POST', '/param-center', { colorTransitionMs: back, motionTransitionMs: back })
        .catch(function (err) { fail('preset fade', err); });
    } else if (d.kind === 'dip') {
      queueLiveMasterFade(d.target, d.ms);
    }
  });

  if (fadeSlider) {
    var pushFade = function (strict) {
      strict = strict === true;
      var v = parseFloat(fadeSlider.dataset.value);
      if (!isFinite(v)) return strict ? Promise.reject(new Error('fade control has no value')) : Promise.resolve();
      fadeMs = Math.round(v * FADE_MAX_MS);
      if (strict) {
        return strictWrite('POST', '/param-center', {
          colorTransitionMs: fadeMs,
          motionTransitionMs: fadeMs,
        });
      }
      send('fade', function () {
        write('POST', '/param-center', {
          colorTransitionMs: fadeMs,
          motionTransitionMs: fadeMs,
        });
      });
      /* colorTransitionMs is the PATTERN's easing and never reached the effect
         chain, so a movement effect ignored this bar completely and hard-cut
         from one step to the next however far up the fade was. Movement carries
         its own crossfade, in fractions of a step rather than ms, because a
         step lasts as long as a beat and a fixed millisecond fade would mean
         something different at every tempo. */
      pushMovementFade();
      return Promise.resolve();
    };
    fadeSlider.addEventListener('sliderchange', pushFade);
    /* Assert it on arm too, so the rig starts with the bar's actual value
       rather than whatever was persisted from a previous session. */
    armAsserts.push(pushFade);
  }

  /* ── PER-GROUP COLOUR (the OWN checkbox) ───────────────────────────────
     Ticking OWN paints that group a flat colour. This is written as a LEASED
     paint (ownerId + renewal): a browser that is closed, backgrounded or
     crashes stops renewing, and the engine's deadman releases the group on its
     own. An unleased write persists to globals_state.yaml and would leave a
     group frozen with nothing left alive to release it — on a playa install
     that is a light stuck on until someone finds a laptop. */
  /* THE OWNER ID MUST ACTUALLY BE UNIQUE — IT IS A LEASE KEY, NOT A LABEL.
     This was Math.floor(performance.now()).toString(36): milliseconds since
     THIS page's navigation start, which at script-eval time is a few hundred at
     most. Every id it produced in testing was TWO characters (7m, 6w, 73, g1),
     i.e. an alphabet of ~1300 values clustered in a narrow band. No randomness,
     no device identity, no session id.
     That string keys BOTH the touch-paint lease and the arm lease, so a
     collision is not cosmetic: two panels sharing an id are seen by the engine
     as ONE owner, so the second arming reads as a RENEWAL rather than being
     refused — the one-desk-at-a-time guarantee silently fails — and either
     panel's disarm clears the other's lease and releases the other's paint.
     crypto.randomUUID is only defined in a SECURE CONTEXT; the playa serves
     this page over plain http on a LAN address, so it will often be absent.
     getRandomValues is available there and is mandatory: inventing a weaker ID
     would weaken the one-desk-at-a-time safety guarantee. */
  var OWNER = 'touch_control_' + (function () {
    if (typeof crypto === 'undefined' || typeof crypto.getRandomValues !== 'function') {
      throw new Error('secure random IDs are unavailable; refusing to create an arm/paint lease owner');
    }
    if (crypto.randomUUID) return crypto.randomUUID();
    var a = new Uint32Array(4);
    crypto.getRandomValues(a);
    return Array.prototype.map.call(a, function (n) { return n.toString(36); }).join('');
  })();
  var painted = {};                 /* group name -> [r,g,b,w,a,u] */

  function hsvToRgb6(h, s, v) {
    var i = Math.floor(h * 6), f = h * 6 - i;
    var p0 = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
    var r, g, b;
    switch (i % 6) {
      case 0: r = v; g = t; b = p0; break;
      case 1: r = q; g = v; b = p0; break;
      case 2: r = p0; g = v; b = t; break;
      case 3: r = p0; g = q; b = v; break;
      case 4: r = t; g = p0; b = v; break;
      default: r = v; g = p0; b = q;
    }
    return [r, g, b, 0, 0, 0];      /* RGBWAU — W/A/U left alone */
  }

  function paintGroup(name, on) {
    if (on) {
      var hsv = (document.getElementById('wheel').dataset.hsv || '').split(',').map(Number);
      if (hsv.length !== 3 || hsv.some(isNaN)) {
        return fail('paint', 'wheel reported no colour — dataset.hsv is unset');
      }
      /* SAME SHAPE as desiredStatic() writes: { color, colors }. This used to
         store a bare color6 array, and once `painted` started carrying palettes
         the 5-second renew loop would have read v.color off an array and sent
         `color: undefined` - the paint would have died at the first renewal. */
      painted[name] = { color: hsvToRgb6(hsv[0], hsv[1], hsv[2]), colors: null };
      write('PUT', '/group-fixed-colors/' + encodeURIComponent(name),
        { color: painted[name].color, brightness: 1, ownerId: OWNER });
    } else {
      delete painted[name];
      write('DELETE', '/group-fixed-colors/' + encodeURIComponent(name));
    }
  }

  if (bank) {
    /* CAPTURE phase, deliberately. The page's own checkbox handler is
       registered on this same element with capture:true and calls
       stopPropagation(), so a bubble-phase listener here would never fire at
       all — the paint silently did nothing. Two listeners on the SAME node in
       the SAME phase both still run, in registration order, and this file
       loads after the page's inline script, so by the time this runs the class
       has already been toggled. */
    bank.addEventListener('click', function (e) {
      var box = e.target.closest('[data-k=own]');
      if (!box) return;
      var strip = box.closest('.fader-strip');
      var nameEl = strip && strip.querySelector('.fader-name');
      if (!nameEl) return;
      setTimeout(function () {
        paintGroup(nameEl.textContent, box.classList.contains('on-own'));
      }, 0);
    }, true);
  }

  /* ── STATIC COLOUR MODE ────────────────────────────────────────────
     While ARMED with NO effect chosen, every live group is painted a flat
     colour from the wheel: the rig sits still and shows exactly what the panel
     shows. Choosing an effect releases the paint so the effect can be seen.

     Why it has to work that way: engine.js calls applyGroupFixedColors AFTER
     applyMacros, precisely so a painted group is NOT repainted by wash, trails
     or strobe. Painting everything and leaving it painted would make every
     effect invisible. So paint == static, and an effect lifts the paint.

     The five palette colours are dealt across the groups (group i takes
     palette[i % 5]), which is what makes the schemes mean something on the
     ship: MASTER paints all 24 the same, CONTRAST spreads five around it.

     Brightness stays with each group's own FADER — the paint goes out at full
     and the section dimmer scales it, so a fader is "how bright is this group's
     colour", which is what it looks like it should do. */
  var STATIC_MS = 500;              /* repaint no faster than twice a second */
  var staticTimer = null, staticWanted = null;

  function anyEffectChosen() {
    return !!(fxGrid && fxGrid.querySelector('.fx-cell.is-on'));
  }

  function groupStrips() {
    if (!bank) return [];
    return Array.prototype.filter.call(bank.querySelectorAll('.fader-strip'), function (st) {
      return !st.classList.contains('is-master');
    });
  }

  /* Per-group modes, published by the page as data (it owns the checkboxes and
     the wheel dots; the wire cannot read CSS classes). */
  function groupModes() {
    try { return JSON.parse((bank && bank.dataset.modes) || '[]'); }
    catch (e) { return []; }
  }

  /* What SHOULD be painted right now: name -> rgb6.
   *
   * Painted or not IS the mode, because of where the engine applies this:
   * applyGroupFixedColors runs AFTER applyMacros, so a painted group cannot be
   * touched by an effect, and an unpainted one shows whatever the effect chain
   * and the pattern are doing. So
   *
   *   OWN            -> painted from that group's own wheel dot. The palette
   *                     cannot reach it - that is what OWN means - and neither
   *                     can an effect.
   *   GLOBAL         -> painted from the five-colour palette (group i takes
   *                     palette[i % 5]) while no effect is chosen, and
   *                     RELEASED the moment one is, so the effect shows there.
   *   neither        -> stays painted whatever is running: an opted-out group.
   *
   * The FX flag that used to appear on this line was REMOVED on operator
   * request: it was OR'd with GLOBAL here and read nowhere else, so the two
   * were indistinguishable, and it never routed an effect to a group - effects
   * are global and the engine has no per-group mask.
   *
   * A group on OWN still cannot show an effect. That is an ENGINE property
   * (group_fixed_color repaints after the chain), not a checkbox, and the
   * panel says so in the groups header rather than silently picking. */
  function desiredStatic(strict) {
    var out = {};
    if (!liveStateCanWrite(strict)) return out;
    var pal;
    try { pal = JSON.parse((slotsEl && slotsEl.dataset.palette) || '[]'); }
    catch (e) { return out; }
    var modes = groupModes();
    var fxOn = anyEffectChosen();
    groupStrips().forEach(function (st, i) {
      var nameEl = st.querySelector('.fader-name');
      if (!nameEl) return;
      var m = modes[i];
      var pw = st.querySelector('[data-role=power]');
      if (pw && !pw.classList.contains('is-on')) return;   /* group switched off */
      /* No published mode means the page has not built the bank yet. Paint
         nothing rather than guess a mode - a guess here shows on the ship. */
      if (!m) return;
      if (m.own && m.h !== null && m.h !== undefined) {
        /* FIVE AT ONCE. A group on a palette scheme carries the whole set and
           the ENGINE spreads it across that group's pixels by per-group
           ordinal. `color` is still sent as the representative colour so the
           payload stays valid for anything that does not read `colors`. */
        out[nameEl.textContent] = {
          color: hsvToRgb6(m.h, m.s, m.v),
          colors: (m.colors && m.colors.length)
            ? m.colors.map(function (c) { return hsvToRgb6(c.h, c.s, c.v); })
            : null,
        };
        return;
      }
      /* TWO GATES, BOTH REQUIRED, and FX has to open both.
         1. the ENGINE must be allowed to touch the group  -> PUT /effect-groups
         2. the PANEL must not paint over it afterwards    -> this line
         group_fixed_color runs AFTER the effect chain, so a painted group hides
         whatever the effect just did. Marking FX aimed the engine correctly but
         left the paint in place, so the operator saw NOTHING change and only
         GLOBAL appeared to work - reported from the rig, and right.
         GLOBAL still releases too: it means "follow the show". */
      if (fxOn && (m.fx || m.global)) return;              /* let the effect through */
      if (!pal.length) return;
      var c = pal[i % pal.length];
      out[nameEl.textContent] = { color: hsvToRgb6(c.h, c.s, c.v), colors: null };
    });
    return out;
  }

  /* Resolves when the pending repaint's LAST staggered write has settled. ARM
     cannot activate the Live setting until the prepared look has landed. */
  var staticDeferred = null;
  var staticStrict = false;

  /* One staggered write, as a promise that settles when the write does. Normal
     performance writes report and absorb errors; strict ARM setup rejects. */
  function staggeredWrite(delayMs, fn, strict) {
    return new Promise(function (resolve, reject) {
      setTimeout(function () {
        Promise.resolve(fn()).then(resolve, strict ? reject : resolve);
      }, delayMs);
    });
  }

  function applyStatic(strict) {
    strict = strict === true;
    staticWanted = desiredStatic(strict);
    /* EVERY PATH RETURNS A PROMISE. A coalesced ARM assertion hands back the
       same promise the in-flight timer will settle, so activation cannot race
       an unfinished Live-local repaint. */
    if (staticTimer) {
      if (strict) staticStrict = true;
      return staticDeferred.promise;
    }
    staticStrict = strict;
    var resolveStatic, rejectStatic;
    staticDeferred = { promise: new Promise(function (resolve, reject) {
      resolveStatic = resolve;
      rejectStatic = reject;
    }) };
    staticTimer = setTimeout(function () {
      staticTimer = null;
      var strictRun = staticStrict;
      staticStrict = false;
      var jobs = [];
      var want = staticWanted || {};
      /* Only the groups whose colour actually changed are written — a wheel
         drag would otherwise fire 24 PUTs per tick at the rig.

         The changed ones are then SPREAD across the fade time rather than sent
         in one burst. group_fixed_color.js writes pixels straight out with no
         easing of its own, so 24 simultaneous PUTs are a hard cut across the
         whole ship; staggered, the change rolls across it over the fade and the
         rig never jumps. It also keeps the write rate inside what the engine can
         take — 141 writes/s was MEASURED dragging it from 40fps to 15. */
      var changed = Object.keys(want).filter(function (name) {
        return JSON.stringify(painted[name]) !== JSON.stringify(want[name]);
      });
      if (changed.length) {
        var gap = Math.max(20, Math.min(120, Math.round((fadeMs || 0) / changed.length)));
        changed.forEach(function (name, i) {
          painted[name] = want[name];
          jobs.push(staggeredWrite(i * gap, function () {
            var v = want[name];
            return (strictRun ? strictWrite : write)('PUT', '/group-fixed-colors/' + encodeURIComponent(name),
              { color: v.color, colors: v.colors || undefined, brightness: 1, ownerId: OWNER });
          }, strictRun));
        });
      }
      /* RELEASING the paint is what happens the instant an effect is chosen,
         and it was 24 DELETEs in one burst — the whole ship cutting from a flat
         colour to the running pattern in a single frame. That is the harsh
         transition. Staggered across the fade it rolls off instead, and the
         group faders keep the final say on level throughout because section
         dimmers are applied AFTER this stage in the engine's chain. */
      var going = Object.keys(painted).filter(function (name) { return !want[name]; });
      if (going.length) {
        var offGap = Math.max(20, Math.min(120, Math.round((fadeMs || 0) / going.length)));
        going.forEach(function (name, i) {
          delete painted[name];
          jobs.push(staggeredWrite(i * offGap, function () {
            return (strictRun ? strictWrite : write)('DELETE', '/group-fixed-colors/' + encodeURIComponent(name));
          }, strictRun));
        });
      }
      /* The look has landed only when every staggered write has SETTLED, not
         when the last timer merely fired. Hard-coding a duration here would
         silently break the day someone adds a group. */
      Promise.all(jobs).then(resolveStatic, rejectStatic);
    }, STATIC_MS);
    return staticDeferred.promise;
  }

  /* Renew every 5s — comfortably inside the engine's 12s paint lease. */
  setInterval(function () {
    Object.keys(painted).forEach(function (name) {
      var v = painted[name];
      write('PUT', '/group-fixed-colors/' + encodeURIComponent(name),
        { color: v.color, colors: v.colors || undefined, brightness: 1, ownerId: OWNER });
    });
  }, 5000);

  /* ── go ─────────────────────────────────────────────────────────────── */
  setStatus();
  refresh().then(refreshGroupProfiles);

  /* ── AUDIO BINDINGS ───────────────────────────────────────────────────
     One audio signal per effect button and per group fader, chosen on the
     surface itself. The list comes from GET /audio-sources, which is built
     from the engine's own registry plus whatever the Audio Companion has
     registered - so these dropdowns cannot drift from the audio panel.

     Two modes per binding, because one behaviour cannot serve nine signals:
       LVL  the target FOLLOWS the signal (bind HIGH to a group and it
            breathes with the hi-hats)
       HIT  the target is FIRED when the signal spikes past a threshold and
            then decays (bind KICK to a strobe and it punches once per kick)

     Bindings are part of the lease-owned Live look. Opening the tab cannot
     write them, and lease release destroys them with the rest of the Live
     session context. */
  var AUD_ORDER = ['micLow', 'micMid', 'micHigh', 'micKick', 'micFlux',
    'micDomFreq1', 'micDomFreq2', 'micDomEnergy1', 'micDomEnergy2'];
  var audSources = null;

  function audOptionsHtml(sel) {
    /* "A" for audio. The select is 18px wide, so its own text IS the button
       label - a long phrase there is unreadable, and the short signal name is
       what the operator needs to see once one is chosen. */
    var html = '<option value="">A</option>';
    if (!audSources) return html;
    var listed = {};
    AUD_ORDER.forEach(function (k) {
      var e = audSources.find(function (x) { return x.key === k; });
      if (!e) return;
      listed[k] = 1;
      html += '<option value="' + e.key + '"' + (e.key === sel ? ' selected' : '') + '>'
        + shortStem(e.label, e.key) + '</option>';
    });
    /* The FULL registry is 65 keys deep - genre confidence, phrase phase, build
       ETA. Offering all of it turns a fader control into a database browser, so
       this lists the audio panel's own stems and BPM and nothing else. */
    if (!listed[BPM_KEY]) {
      html += '<option value="' + BPM_KEY + '"' + (BPM_KEY === sel ? ' selected' : '') + '>BPM</option>';
    }
    return html;
  }

  /* Effects that own a CLOCK a tempo signal can lock to — the engine locks
     these to the beat grid instead of riding their depth (see
     GlobalEffectsController.tempoSyncFor). These are `dataset.fxkey` values,
     which the page writes from FX_OPTS[i].e — NOT the effect filenames.
     Of the nine effects this panel offers, these five have a clock; crush,
     feedbackTrails, fogger and freeze do not. */
  var TEMPO_CAPABLE_FX = ['strobe', 'beatPump', 'waterlineSweep', 'movementTrace', 'breath'];

  function audRow(scope, id) {
    var row = document.createElement('div');
    row.className = 'aud-row';
    row.dataset.scope = scope;
    row.dataset.bid = id;
    row.innerHTML = '<select class="aud-pick" data-role="audpick" title="Audio signal that drives this">'
      + audOptionsHtml(null) + '</select>'
      + '<button class="aud-mode" data-role="audmode" title="LVL follows the signal · HIT fires on a spike">LVL</button>';
    return row;
  }

  function audWrite(row, strict) {
    strict = strict === true;
    var sel = row.querySelector('[data-role=audpick]');
    var btn = row.querySelector('[data-role=audmode]');
    var scope = row.dataset.scope;
    var id = row.dataset.bid;
    var src = sel.value;
    sel.classList.toggle('is-bound', !!src);
    /* AN EFFECT WITH NO CLOCK GETS HIT, NOT LEVEL.
       A tempo signal in LEVEL mode multiplies the effect's own magnitude, and
       every effect's magnitude is a DEPTH — so for anything without a rate to
       lock to, "bind BPM" could only ever mean "throb", which is exactly what
       the operator rejected. Those are switched to HIT so they stab on the beat
       instead. VISIBLE, not silent: the button flips to HIT so the surface
       always states what it is about to send. The operator can toggle it back
       to LVL afterwards and that choice is respected. */
    if (scope === 'effects' && src === BPM_KEY && !btn.classList.contains('is-hit')) {
      var fxCell = row.closest ? row.closest('.fx-cell') : null;
      var fxkey = fxCell && fxCell.dataset ? fxCell.dataset.fxkey : null;
      if (fxkey && TEMPO_CAPABLE_FX.indexOf(fxkey) === -1) {
        btn.classList.add('is-hit');
        btn.textContent = 'HIT';
      }
    }
    var path = '/audio-bindings/' + scope + '/' + encodeURIComponent(id);
    var body = src
      ? { source: src, mode: btn.classList.contains('is-hit') ? 'hit' : 'level', depth: 1 }
      : { source: null };
    /* req(), not write(): a routing choice must land even while disarmed,
       otherwise the dropdown would silently do nothing until ARM. */
    return req('PUT', path, body).catch(function (e) {
      fail('audio binding', e);
      if (strict) throw e;
    });
  }


  /* ── PER-FADER STEM CHECKBOXES ────────────────────────────────────────
     One box per audio stem plus BPM. Tick several and the LOUDEST of them
     drives that fader (max, not sum - summing four stems just clips to full
     and the fader stops saying anything).

     NOTHING TICKED BINDS NOTHING. There is no BPM fallback: an untouched
     fader does not drive the rig. The fallback used to fire for every fader
     on ARM (pushAllAudioBindings re-states them all), so arming alone set the
     whole ship pulsing to the tempo with nobody having asked - see
     faderAudioWrite. Codex P0: no fallback behaviors.

     The list is built from GET /audio-sources, so it cannot drift from the
     audio panel: whatever stems the Companion publishes are the boxes here.
     A stem nobody is sending is dimmed rather than hidden - a missing signal
     should look missing, not absent. */
  var BPM_KEY = 'bpmPulse';

  function stemList() {
    var out = [{ key: BPM_KEY, short: 'BPM', live: true }];
    if (!audSources) return out;
    AUD_ORDER.forEach(function (k) {
      var e = audSources.find(function (x) { return x.key === k; });
      if (!e) return;
      out.push({ key: k, short: shortStem(e.label, k), live: !!e.live });
    });
    return out;
  }

  function shortStem(label, key) {
    var s = String(label).replace(/^Mic · /, '');
    if (/DomFreq1/i.test(key)) return 'D1F';
    if (/DomFreq2/i.test(key)) return 'D2F';
    if (/DomEnergy1/i.test(key)) return 'D1E';
    if (/DomEnergy2/i.test(key)) return 'D2E';
    return s.slice(0, 4).toUpperCase();
  }

  /* TWO CONTROLS PER FADER, not ten boxes. A dropdown of the audio options and
     a BPM button - the ten-checkbox version was 3px per box and unreadable, and
     the height it cost belonged to the fader.

     Nothing chosen in the dropdown binds nothing at all - the fader still
     works, it just is not driven by audio until the operator says so. */
  function faderAudio(groupName) {
    var wrap = document.createElement('div');
    wrap.className = 'fader-audio';
    wrap.dataset.bid = groupName;
    /* LOCK replaced the BPM button (operator request). Nothing is lost: the
       dropdown beside it already lists BPM as a source, so the tempo is still
       one tap away - the button only ever added "BPM *plus* a stem", which
       combined by max. LOCK earns the space far better.
       A locked group HOLDS THE SETTING IT WAS LOCKED AT: ALL ON / ALL OFF skip
       it, its own controls go inert, and the engine's grand master skips it
       too (PUT /parked-groups). Blackout still kills it. */
    wrap.innerHTML = '<select class="aud-pick" data-role="faudpick" title="Audio signal driving this fader">'
      + audOptionsHtml(null) + '</select>'
      + '<button class="fader-lock" data-role="faudlock" '
      + 'title="LOCK this group - it holds this setting. ALL ON/ALL OFF and the master skip it; blackout still kills it.">LOCK</button>';
    paintFaderAudio(wrap);
    return wrap;
  }

  function paintFaderAudio(wrap) {
    var sel = wrap.querySelector('[data-role=faudpick]');
    sel.classList.toggle('is-bound', !!sel.value);
  }

  function faderAudioWrite(wrap, strict) {
    strict = strict === true;
    paintFaderAudio(wrap);
    var sel = wrap.querySelector('[data-role=faudpick]');
    var list = [];
    if (sel.value) list.push(sel.value);
    /* NOTHING CHOSEN MEANS NOTHING BOUND. This used to fall back to BPM, and
       because pushAllAudioBindings() re-states EVERY fader on arm, arming bound
       all 24 groups to bpmPulse at depth 1. That is a SYNTHETIC beat clock off
       the mixer tempo which runs with no audio at all (engine.js: "the one
       source that always exists"), and a level binding at depth 1 is the raw
       1->0 ramp — so the whole ship pumped full-to-zero on every beat with
       nobody having clicked anything. No button showed it on, so no button
       turned it off; only DISARM did. Same shape as audWrite() for the effect
       rows: no choice, no binding. */
    var body = list.length ? { sources: list, mode: 'level', depth: 1 } : { source: null };
    return req('PUT', '/audio-bindings/groups/' + encodeURIComponent(wrap.dataset.bid), body)
      .catch(function (e) {
        fail('fader audio', e);
        if (strict) throw e;
      });
  }

  document.addEventListener('change', function (e) {
    var sel = e.target.closest && e.target.closest('[data-role=faudpick]');
    if (!sel) return;
    faderAudioWrite(sel.closest('.fader-audio'));
  });
  /* ── LOCK a group ─────────────────────────────────────────────────────
     A locked group HOLDS THE SETTING IT WAS LOCKED AT. Three things enforce
     that, and they are deliberately in different places:
       · ALL ON / ALL OFF skip it            (the page's #allToggle handler)
       · its own controls go inert           (CSS on .fader-strip.is-locked)
       · the GRAND MASTER skips it           (engine, via PUT /parked-groups)
     Blackout still kills it. An e-stop must not be defeatable from a toggle.

     Capture phase + stopPropagation so the tap never also re-aims the colour
     pad or drags the fader underneath it - the same guard the dot drag uses. */
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-role=faudlock]');
    if (!b) return;
    e.stopPropagation();
    var strip = b.closest('.fader-strip');
    var locked = !strip.classList.contains('is-locked');
    strip.classList.toggle('is-locked', locked);
    b.classList.toggle('is-on', locked);
    pushParkedGroups();
  }, true);

  /* The parked set, sent whole. Same contract as the effect scope: write() so a
     DISARMED panel cannot leave the engine holding a park nobody is driving,
     re-asserted on arm, cleared on disarm. Empty list sends null. */
  var lastParked = null;
  function pushParkedGroups(strict) {
    if (!bank) return strict ? Promise.reject(new Error('group bank is missing')) : Promise.resolve();
    var names = [];
    Array.prototype.forEach.call(bank.querySelectorAll('.fader-strip.is-locked'), function (st) {
      if (st.classList.contains('is-master')) return;
      var n = st.querySelector('.fader-name');
      if (n) names.push(n.textContent);
    });
    var payload = names.length ? names : null;
    var key = JSON.stringify(payload);
    if (key === lastParked) return Promise.resolve();
    lastParked = key;
    return (strict ? strictWrite : write)('PUT', '/parked-groups', { groups: payload })
      .catch(function (e) {
        fail('locked groups', e);
        if (strict) throw e;
      });
  }
  armAsserts.push(function (strict) { lastParked = null; return pushParkedGroups(strict); });


  /* ── LIVE AUDIO METER ─────────────────────────────────────────────────
     Eight stems as vertical jumping lines, plus the live tempo and the note.

     Fed from the engine's /ws/signals socket, which pushes a liveParams frame
     whenever the analyser publishes - the same values the Audio Companion is
     reading, straight from the engine, so this is not a second opinion about
     the audio.

     NO POLLING FALLBACK ON PURPOSE. If the socket is down the strip says
     "waiting for audio" and the bars sit still. A meter that invents motion
     when it has no data is worse than one that admits it. */
  /* The Audio Companion's own signal list: name, type and colour as it shows
     them, in its order. Nine cards, not eight - LOW MID HIGH KICK FLUX plus
     both DOM frequencies and both DOM energies, which is what that panel
     actually publishes. */
  var METER_BARS = [
    { key: 'micLow',        lab: 'LOW',         type: 'intensity', c: '#34d3b5' },
    { key: 'micMid',        lab: 'MID',         type: 'intensity', c: '#4ea1ff' },
    { key: 'micHigh',       lab: 'HIGH',        type: 'intensity', c: '#8b9bff' },
    { key: 'micKick',       lab: 'KICK',        type: 'intensity', c: '#ff5d6c' },
    { key: 'micFlux',       lab: 'FLUX',        type: 'intensity', c: '#c084fc' },
    { key: 'micDomFreq1',   lab: 'DOM1 FREQ',   type: 'frequency', c: '#f0a23b' },
    { key: 'micDomFreq2',   lab: 'DOM2 FREQ',   type: 'frequency', c: '#c084fc' },
    { key: 'micDomEnergy1', lab: 'DOM1 ENERGY', type: 'intensity', c: '#f0c23b' },
    { key: 'micDomEnergy2', lab: 'DOM2 ENERGY', type: 'intensity', c: '#d0a4fc' }
  ];
  /* Frequencies arrive in Hz and must be scaled LOGARITHMICALLY, the way
     hearing works. MEASURED: a live micDomFreq1 of 64.85 Hz - an ordinary bass
     note - came out as 0.3% of the bar on a linear 0..22050 scale, which is
     why the DOM cards looked dead. On a 20Hz..20kHz log scale the same note
     reads about 17%, and a whole octave is a visible step instead of a
     rounding error. */
  var METER_LOG = { micDomFreq1: 1, micDomFreq2: 1 };
  var LOG_MIN = 20, LOG_MAX = 20000;
  function logScale(hz) {
    if (!(hz > LOG_MIN)) return 0;
    var v = Math.log(hz / LOG_MIN) / Math.log(LOG_MAX / LOG_MIN);
    return v < 0 ? 0 : (v > 1 ? 1 : v);
  }
  var NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  var meterEls = {};
  var meterPeak = {};

  /* PORTED FROM THE COMPANION (companion_app.js: TRAIL, S.head, trLine,
     drawMini). A 360-sample ring buffer per signal, drawn as a scrolling line
     in the signal's own accent colour - the same trace, not an imitation. */
  var TRAIL = 360;
  var trHead = 0;
  var trBuf = {};

  function trLine(ctx, buf, W, H, lw, color) {
    var step = W / (TRAIL - 1);
    ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = color; ctx.lineWidth = lw;
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    /* INSET BY HALF THE STROKE. The Companion's own trLine maps value 1 to
       y=0 and value 0 to y=H - dead on the canvas edges - so half of a 1.3px
       line falls outside the bitmap and a signal sitting at 1.00 (kick, flux)
       reads as a wave with its top shaved off. Padding by half the line width
       keeps the WHOLE stroke inside the box at both extremes, which is what
       "don't cut the waveform off" means. */
    var pad = lw + 1;   /* full stroke clear of BOTH edges, incl. the zero line */
    var span = H - pad * 2;
    ctx.beginPath();
    for (var i = 0; i < TRAIL; i++) {
      var v = buf[(trHead + i) % TRAIL] || 0;
      var x = i * step, y = pad + span * (1 - v);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  function buildMeter() {
    var host = document.getElementById('meterBars');
    if (!host || host.children.length) return;
    METER_BARS.forEach(function (b) {
      var el = document.createElement('div');
      el.className = 'sig-row';
      el.style.setProperty('--sc', b.c);
      el.innerHTML = '<span class="sig-name">' + b.key + '</span>'
        + '<span class="sig-val">--</span>'
        + '<span class="sig-sub">' + b.type + ' · out</span>'
        + '<span class="sig-mini"><canvas width="110" height="34"></canvas></span>';
      host.appendChild(el);
      trBuf[b.key] = new Float32Array(TRAIL);
      meterEls[b.key] = {
        row: el,
        val: el.querySelector('.sig-val'),
        ctx: el.querySelector('canvas').getContext('2d'),
      };
    });
  }

  var lastMeterMs = 0;
  /* The socket only pushes when a value CHANGES, so "no frames" and "silence"
     look identical - a frozen trace with no explanation. This says which. */
  setInterval(function () {
    var strip = document.getElementById('meterStrip');
    var st = document.getElementById('meterState');
    if (!strip || !lastMeterMs) return;
    var quiet = Date.now() - lastMeterMs > 2000;
    strip.classList.toggle('is-live', !quiet);
    if (st && quiet) st.textContent = 'analyser quiet - no new values';
  }, 1000);

  /* DRAWING IS COALESCED TO ONE FRAME; MEANING IS NOT.
     paintMeter used to run in full on EVERY /ws/signals message. With the Audio
     Companion live that is ~60 messages a second, and each pass redraws NINE
     canvases as a 360-point polyline — roughly 194,000 line segments a second.
     MEASURED on this page with audio running: setInterval(16ms) delivered
     1 tick/s instead of ~60, requestAnimationFrame ran at 8 fps, the worst gap
     between two 4 ms timers was 4,365 ms, and a CPU profile put 89% of all
     samples inside this one loop. A page that blocks its own main thread for
     four seconds is a frozen control surface, and every timer-driven feature
     on it — take playback, the coalescing queues, the deadman UI — starves.
     So the CANVAS work now runs at most once per animation frame on the latest
     values, while the cheap semantic work below (liveness, BPM, note and beat
     publication) still runs on EVERY message. Splitting it this way matters:
     those CustomEvents drive the palette and beat-synced behaviour, and
     dropping frames of them would drop musical events, not just pixels. */
  var meterPending = null, meterRaf = 0;
  function paintMeter(params) {
    lastMeterMs = Date.now();
    var strip = document.getElementById('meterStrip');
    if (strip) strip.classList.add('is-live');
    paintMeterSemantics(params);
    meterPending = params;
    if (meterRaf) return;
    meterRaf = requestAnimationFrame(function () {
      meterRaf = 0;
      var p = meterPending; meterPending = null;
      if (p) drawMeterTraces(p);
    });
  }

  function drawMeterTraces(params) {
    trHead = (trHead + 1) % TRAIL;
    /* READS FIRST, THEN WRITES — never interleaved (audit: the settled
       80%-profile mystery). The old loop wrote e.val.textContent (invalidating
       layout) and then read c.clientWidth (forcing a synchronous reflow) PER
       CANVAS: up to nine forced reflows per frame, which is where the CPU
       actually went — the polylines themselves cost under 1 ms. All layout
       reads happen in one pass over clean layout; text is only written when
       the string CHANGED (~70 identical writes/s otherwise). */
    var widths = METER_BARS.map(function (b) {
      var e = meterEls[b.key];
      return e ? e.ctx.canvas.clientWidth : 0;
    });
    METER_BARS.forEach(function (b, i) {
      var e = meterEls[b.key];
      if (!e) return;
      var entry = params[b.key];
      var has = entry && typeof entry.value === 'number';
      var raw = has ? entry.value : 0;
      var v = METER_LOG[b.key] ? logScale(raw) : raw;
      v = v < 0 ? 0 : (v > 1 ? 1 : v);
      /* The buffer holds the NORMALISED trace; the readout shows the RAW value,
         the way the Companion prints 49 or 322 Hz rather than a fraction. */
      trBuf[b.key][(trHead + TRAIL - 1) % TRAIL] = v;
      var txt = has
        ? (METER_LOG[b.key] ? String(Math.round(raw)) : raw.toFixed(2))
        : '--';
      if (e.lastTxt !== txt) { e.lastTxt = txt; e.val.textContent = txt; }
      var c = e.ctx.canvas;
      if (c.width !== widths[i] && widths[i] > 0) c.width = widths[i];
      trLine(e.ctx, trBuf[b.key], c.width, c.height, 1.3, b.c);
    });
  }

  /* Cheap, every message: text readouts and the two CustomEvents other parts of
     the surface listen to. No canvas work here — that is the whole point. */
  function paintMeterSemantics(params) {
    var bpmEl = document.getElementById('mBpm');
    if (bpmEl) {
      var bp = params.audioBpm && params.audioBpm.value;
      if (!bp) bp = params.tempoBpm && params.tempoBpm.value;
      bpmEl.textContent = bp ? String(Math.round(bp)) : '--';
    }
    var noteEl = document.getElementById('mNote');
    var n = params.audioNote && params.audioNote.value;
    var pc = (typeof n === 'number' && n >= 0) ? (Math.round(n) % 12) : -1;
    if (noteEl) noteEl.textContent = pc >= 0 ? NOTE_NAMES[pc] : '--';
    /* PUBLISH THE NOTE. This layer owns the audio socket; the page owns the
       palette. Rather than reach across, announce the pitch class and let the
       page's NOTE mode decide what to do with it - the same shape as the
       page announcing groupmodeschange to us.
       ONLY ON CHANGE: this frame arrives with every analyser publish, and
       re-running the generators at that rate would repaint the whole rig
       continuously for no visible gain. */
    if (pc !== lastPublishedNote) {
      lastPublishedNote = pc;
      document.dispatchEvent(new CustomEvent('audionote', { detail: { pitchClass: pc } }));
    }

    /* PUBLISH THE BEAT. `audioBeatInBar` counts 1..4 and ticks once per beat -
       MEASURED against the live engine: it changed 9 times in 6s at 101 BPM,
       where 10 beats were due. `audioBeat` is NOT the thing to count: it is a
       continuous 0..1 envelope and changed 55 times over the same window.
       Only the CHANGE is announced, so a listener counts beats rather than
       frames. `downbeat` rides along so a listener can align to the bar. */
    var bib = params.audioBeatInBar && params.audioBeatInBar.value;
    if (typeof bib === 'number' && bib !== lastBeatInBar) {
      lastBeatInBar = bib;
      var dn = params.audioDownbeat && params.audioDownbeat.value;
      document.dispatchEvent(new CustomEvent('audiobeat', {
        detail: { beatInBar: bib, downbeat: !!dn },
      }));
    }
  }
  var lastPublishedNote = -2;
  var lastBeatInBar = -1;

  /* ── THE ARM DEADMAN'S SOCKET ────────────────────────────────────────────
     A /ws/control socket whose ONLY job is to let the engine know this panel is
     still alive while armed. The engine pings it and the browser's network
     stack answers automatically — no timer in this page is involved, which is
     the point: a JS heartbeat stops when the tab is backgrounded or throttled,
     and the operator switching apps on the iPad must not look like a crash.

     If this socket dies while armed, the engine reverts the ship to the
     automatic show rather than leaving it frozen with nobody driving. */
  var controlWs = null;
  var armAckPending = false;   /* waiting for the engine to confirm the lease */
  var disarmAckPending = false;/* waiting for authoritative lease release */
  var armRefused = false;      /* another panel holds the desk */
  var armLeaseRequested = false;
  var armLeaseAcquired = false;

  /* Put the SURFACE back to disarmed, not just the wire's flag.
     The panel's arm state lives in the DOM (the class, aria-checked, the label,
     the lock glyph and the shell's dimming), set by the page's own click
     handler. Flipping only state.armed would leave the operator looking at a
     button that says ARMED while the wire refuses every write — the worst of
     both. Mirrors exactly what touch_control.html's handler does. */
  function forceDisarmedUi() {
    armChainTarget = false;
    armAckPending = false;
    disarmAckPending = false;
    armLeaseRequested = false;
    armLeaseAcquired = false;
    state.phase = 'idle';
    state.armed = false;
    state.liveBrightnessRevision = null;
    state.sessionRevision = null;
    var a = document.getElementById('arm');
    if (a) {
      a.classList.remove('is-armed');
      a.setAttribute('aria-checked', 'false');
    }
    var st = document.getElementById('armState');
    if (st) st.textContent = 'DISARMED';
    var lk = document.getElementById('armLock');
    if (lk) lk.textContent = '🔒';
    var sh = document.getElementById('shell');
    if (sh) sh.classList.add('disarmed');
    setStatus();
  }

  function sendControl(msg) {
    if (!controlWs || controlWs.readyState !== 1) return false;
    try { controlWs.send(JSON.stringify(msg)); return true; } catch (e) { return false; }
  }

  function openControlSocket() {
    var url = 'ws://' + location.hostname + ':6968/ws/control';
    var ws;
    try { ws = new WebSocket(url); } catch (e) {
      /* A constructor throw must retry like a close does (audit low): fail()
         alone permanently killed the deadman's reconnect loop. */
      fail('control socket', e);
      setTimeout(openControlSocket, 2000);
      return;
    }
    controlWs = ws;
    ws.addEventListener('open', function () {
      sendControl({ type: 'touchControlHello', ownerId: OWNER });
      /* Reconnect only renews a lease the canonical Layers state still proves.
         It never re-activates Live Touch automatically. */
      if (state.armed) {
        req('GET', '/layers/state').then(requireLayerState).then(function (layerState) {
          var liveParticipates = layerState.active === 'live_touch'
            || (layerState.transition && (layerState.transition.from === 'live_touch'
              || layerState.transition.to === 'live_touch'));
          var held = layerState.liveTouch && layerState.liveTouch.armed
            && layerState.liveTouch.ownerId === OWNER;
          if (!held || !liveParticipates) {
            forceDisarmedUi();
            fail('arm', 'the engine no longer reports this panel as the active Live Touch owner; re-arm');
            return;
          }
          sendControl({ type: 'touchControlArmed', ownerId: OWNER, armed: true });
        }).catch(function () {
          /* Cannot confirm the takeover — an armed surface over an unknown rig
             is the lie the audit flagged. Fail closed. */
          forceDisarmedUi();
          fail('arm', 'could not confirm the takeover after reconnect — DISARMED (fail closed)');
        });
      }
    });
    ws.addEventListener('message', function (ev) {
      var m;
      try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (!m) return;
      if (m.type === 'touchControlArmedAck') {
        if (m.ownerId !== OWNER) return;
        if (m.requestedArmed === true && m.armed === true) {
          if (!Number.isInteger(m.sessionRevision) || m.sessionRevision < 0) {
            armRefused = true;
            armAckPending = false;
            fail('arm', 'engine lease ACK omitted the Live session revision');
            return;
          }
          state.sessionRevision = m.sessionRevision;
          armLeaseRequested = true;
          armLeaseAcquired = true;
          armAckPending = false;
          clearError();
        } else if (m.requestedArmed === false && m.armed === false) {
          state.sessionRevision = null;
          armLeaseRequested = false;
          armLeaseAcquired = false;
          disarmAckPending = false;
          clearError();
        }
      } else if (m.type === 'touchControlBrightness') {
        if (m.ownerId === OWNER && m.active) {
          try { acceptLiveBrightness(m, true); }
          catch (error) { fail('brightness', error); }
        } else if (!m.active) {
          state.liveBrightnessRevision = null;
        }
      } else if (m.type === 'dimmerState') {
        if (!Number.isInteger(m.revision) || m.revision < 0
            || !m.rackCeilings || typeof m.rackCeilings !== 'object'
            || Array.isArray(m.rackCeilings)) {
          fail('brightness', 'engine sent an invalid Dimmer Rack ceiling update');
        } else if (Number.isInteger(state.rackBrightnessRevision)
          && m.revision < state.rackBrightnessRevision) {
          return;
        } else {
          state.rackCeilings = m.rackCeilings;
          state.rackBrightnessRevision = m.revision;
          state.liveEffectiveCaps = {};
        }
      } else if (m.type === 'armRevert') {
        /* THE ENGINE TOOK THE SHOW BACK. Deadman, crash-boot policy or lease
           sweep — whichever fired, Live no longer participates. This broadcast used to be dropped on the
           floor, so the panel sat there reading ARMED, every control lit, over
           a show it no longer controlled. The panel must never outrank the
           engine's own account of who is driving. */
        if (state.phase !== 'idle') {
          armLeaseRequested = false;
          armLeaseAcquired = false;
          disarmAckPending = false;
          forceDisarmedUi();
          fail('arm', 'the engine REVERTED to the automatic show' +
            (m.why ? ' — ' + m.why : '') + '. This panel is disarmed; re-arm to take control.');
        }
      } else if (m.type === 'touchControlArmedRejected') {
        /* ONE DESK AT A TIME. Another panel already holds the rig, so this one
           must not proceed to take it — two surfaces fighting over one owner
           lease is exactly what the refusal exists to prevent. Reported loudly:
           silently staying disarmed would look like a broken ARM button. */
        armAckPending = false;
        armLeaseRequested = false;
        armLeaseAcquired = false;
        armRefused = true;
        forceDisarmedUi();
        fail('arm', 'REFUSED — ' + (m.reason || 'another panel holds the desk') +
          (m.heldBy ? ' (held by ' + m.heldBy + ')' : ''));
      }
    });
    ws.addEventListener('close', function () {
      if (controlWs === ws) controlWs = null;
      setTimeout(openControlSocket, 2000);
    });
    ws.addEventListener('error', function () { /* close handles the retry */ });
  }
  openControlSocket();

  /* THE EFFECT CATALOG COMES FROM THE ENGINE, NOT FROM A LIST PASTED IN THE PAGE.
     FX_OPTS was a hardcoded 32-entry literal covering 9 of the engine's 17
     effects, so 8 effects and 19 effect+preset pairs were simply unreachable
     from this surface — and the day someone adds an effect it stays invisible
     until a human remembers to edit the page. The engine already publishes the
     whole registry, so the panel asks for it.

     The WIRE fetches and the PAGE renders, per the split this file exists to
     keep: the page never talks to the engine.

     FAIL CLOSED if it cannot be fetched or validated (codex P0): effect slots
     cannot be trusted without the engine's registry, so ARM remains refused. */
  function publishFxCatalog() {
    return req('GET', '/global-effect-library').then(function (lib) {
      if (!lib || !lib.effects) throw new Error('/global-effect-library returned no effects');
      var detail = { effects: lib.effects, accepted: false, error: null };
      document.dispatchEvent(new CustomEvent('fxcatalog', { detail: detail }));
      if (detail.error) throw detail.error;
      if (!detail.accepted) throw new Error('page did not accept the effect catalog');
      fxCatalogReady = true;
    }).catch(function (e) {
      fxCatalogReady = false;
      fail('fx catalog', e);
      throw e;
    });
  }

  function openMeterSocket() {
    buildMeter();
    var url = 'ws://' + location.hostname + ':6968/ws/signals';
    var ws;
    try { ws = new WebSocket(url); } catch (e) {
      fail('meter socket', e);
      setTimeout(openMeterSocket, 2000);   /* same retry rule as the close path */
      return;
    }
    ws.addEventListener('message', function (ev) {
      /* CHEAP SNIFF BEFORE THE FULL PARSE (audit low): at ~35 msg/s × 59
         params, fully parsing frames this handler then discards is real work.
         Every frame this panel uses carries a "params" object; anything else
         is skipped on a substring check that costs nanoseconds. */
      if (typeof ev.data === 'string' && ev.data.indexOf('"params"') === -1) return;
      var msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (!msg || !msg.params) return;
      paintMeter(msg.params);
    });
    ws.addEventListener('close', function () {
      var strip = document.getElementById('meterStrip');
      if (strip) strip.classList.remove('is-live');
      /* Reconnect, because the engine restarts more often than the panel does
         and a dead meter after a restart looks like dead audio. */
      setTimeout(openMeterSocket, 2000);
    });
  }
  openMeterSocket();
  function buildAudioBindings() {
    return req('GET', '/audio-sources').then(function (r) {
      audSources = (r && r.sources) || [];
      var targets = [];
      if (fxGrid) {
        Array.prototype.forEach.call(fxGrid.querySelectorAll('.fx-cell'), function (c) {
          if (c.querySelector('.aud-row')) return;
          c.appendChild(audRow('effects', c.dataset.slot));
          targets.push(1);
        });
      }
      if (bank) {
        Array.prototype.forEach.call(bank.querySelectorAll('.fader-strip'), function (st) {
          if (st.classList.contains('is-master') || st.querySelector('.fader-audio')) return;
          var nm = st.querySelector('.fader-name');
          if (!nm) return;
          st.appendChild(faderAudio(nm.textContent));
          targets.push(1);
        });
      }
      return targets.length;
    }).catch(function (e) { fail('audio sources', e); return 0; });
  }

  document.addEventListener('change', function (e) {
    var sel = e.target.closest && e.target.closest('[data-role=audpick]');
    if (!sel) return;
    audWrite(sel.closest('.aud-row'));
  });
  document.addEventListener('click', function (e) {
    var btn = e.target.closest && e.target.closest('[data-role=audmode]');
    if (!btn) return;
    e.stopPropagation();
    var hit = btn.classList.toggle('is-hit');
    btn.textContent = hit ? 'HIT' : 'LVL';
    audWrite(btn.closest('.aud-row'));
  }, true);

  /* Effect binding rows depend on the catalog-created cells. Do not race the
     page's catalog validation, and do not synthesize an empty effect surface. */
  publishFxCatalog()
    .then(function () { return buildAudioBindings(); })
    .catch(function () { /* publishFxCatalog already failed loudly and ARM is gated */ });

  setInterval(function () {
    refresh();
    refreshTempo();
    /* Hold the rule while armed: if anything lights an effect from outside
       this panel — the VSN1, the Deck, a restored state — the next tick puts
       the rig back to what the grid shows. Costs one GET when nothing differs. */
    if (state.armed && !armChainBusy) reconcileEffects();
  }, POLL_MS);

  window.__wire = state;   /* for headless verification only */
  /* The cache-forget the arm chain runs (audit H8) — exposed so a harness can
     exercise the REAL function without seizing the live engine's arm lease by
     clicking the real ARM button. Verification only, like __wire itself. */
  state._forgetSpatialCfg = forgetSpatialCfg;
})();
