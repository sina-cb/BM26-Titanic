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

  var ENDPOINT = window.TouchControlEndpoint;
  if (!ENDPOINT) {
    throw new Error('Live Touch engine endpoint contract is unavailable: '
      + ((window.TouchControlEndpointError && window.TouchControlEndpointError.message)
        || 'CaptainPad did not provide a validated engine origin and protocol version'));
  }
  var ENGINE = ENDPOINT.engineOrigin;
  var ENGINE_WS = ENDPOINT.webSocketOrigin;
  var FLUSH_MS = 100;          /* 10 writes/sec ceiling per key */
  /* Drawing is a FINGER, not a fader — see sendDraw(). 33 ms is ~30 samples a
     second, just under the engine's 40 fps, so nothing is generated that the
     engine would only discard. */
  var DRAW_FLUSH_MS = 33;
  var POLL_MS = 2000;
  var availabilityKnown = false;
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
    colorOutputSlots: null,    /* null until exports prove 2 or 5 */
    colorCapabilityKnown: false,
    sectionIds: {},            /* group name -> sectionId */
    dimmers: {},
    liveBrightnessRevision: null,
    rackBrightnessRevision: null,
    rackCeilings: {},
    liveEffectiveCaps: {},
    sessionRevision: null,
    groupProfilesReady: false,
    performanceModeActive: null,
    engineProtocolReady: false,
    surfaceAvailable: false,
    lastError: null,
    lastErrorDetail: null,
    lastErrorCode: null,
  };
  /* Installed by the Spatial block once the pad exists. Pattern/lifecycle
     handlers are registered earlier in this file but run only after the whole
     script has installed, so they all converge on this one contact owner. */
  var clearTransientSpatialContacts = null;
  /* Verification-only, like clearTransientSpatialContacts above: installed by
     the Spatial block so a headless harness can inspect the exact compact
     stroke-slot bookkeeping (never the raw pointerId) without seizing the
     live engine. */
  var spatialPayloadForTest = null;
  var spatialPointerSlotForTest = null;

  /* ── status pill ────────────────────────────────────────────────────── */
  var pill = document.createElement('div');
  pill.id = 'wireStatus';
  pill.style.cssText =
    'position:fixed;left:10px;bottom:10px;z-index:9999;padding:5px 11px;' +
    'max-width:min(760px,calc(100vw - 20px));border-radius:12px;' +
    'font:700 11px/1.2 Inter,system-ui,sans-serif;' +
    'letter-spacing:.04em;border:1px solid rgba(255,255,255,.18);' +
    'background:rgba(8,13,24,.94);color:#8fa3c4;pointer-events:none;white-space:normal';
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
  var dismissedErrorKey = null;

  function wireErrorKey() {
    return [
      state.lastError || '',
      state.lastErrorDetail || '',
      state.lastErrorCode || '',
    ].join('\n');
  }

  function showPill(on) {
    if (on === pillAttached) return;
    if (on) { document.body.appendChild(pill); }
    else if (pill.parentNode) { pill.parentNode.removeChild(pill); }
    pillAttached = on;
  }

  function liveTouchAvailabilityDetail() {
    if (!state.online) {
      return {
        available: false,
        headline: 'NOT AVAILABLE',
        detail: 'Live Touch cannot reach the lighting engine. Controls stay read-only until the connection returns.',
        reason: 'offline',
      };
    }
    if (!state.engineProtocolReady) {
      return {
        available: false,
        headline: 'NOT AVAILABLE',
        detail: state.lastErrorDetail || state.lastError
          || 'Live Touch protocol is not verified. Reload after restarting the engine.',
        reason: 'protocol',
      };
    }
    return { available: true, headline: '', detail: '', reason: null };
  }

  function publishLiveTouchAvailability() {
    if (!availabilityKnown) return;
    var detail = liveTouchAvailabilityDetail();
    state.surfaceAvailable = detail.available === true;
    document.dispatchEvent(new CustomEvent('livetouchavailability', { detail: detail }));
  }

  function markAvailabilityKnown() {
    if (availabilityKnown) return;
    availabilityKnown = true;
    publishLiveTouchAvailability();
  }

  function publishTouchTransportState() {
    publishLiveTouchAvailability();
    document.dispatchEvent(new CustomEvent('touchtransportstate', { detail: {
      online: state.online === true,
      phase: state.phase,
      armed: state.armed === true,
      leaseAcquired: armLeaseAcquired === true,
      surfaceAvailable: state.surfaceAvailable === true,
    } }));
  }

  function setStatus() {
    publishTouchTransportState();
    if (state.lastError) {
      var currentErrorKey = wireErrorKey();
      if (dismissedErrorKey === currentErrorKey) {
        showPill(false);
        return;
      }
      /* ONLY the error. The header already carries armed/engine state, and a
         toast that buries the fault among three other fields is one the
         operator learns to ignore. */
      pill.replaceChildren();
      var primary = document.createElement('span');
      primary.textContent = '⚠ ' + state.lastError;
      pill.appendChild(primary);
      if (state.lastErrorDetail) {
        var detail = document.createElement('span');
        detail.textContent = state.lastErrorDetail;
        detail.style.cssText = 'display:block;margin:2px 0 0 17px;font-weight:600;opacity:.86;letter-spacing:.015em';
        pill.appendChild(detail);
        pill.title = state.lastErrorDetail;
      } else {
        pill.removeAttribute('title');
      }
      var dismiss = document.createElement('button');
      dismiss.type = 'button';
      dismiss.textContent = '×';
      dismiss.setAttribute('aria-label', 'Dismiss Live Touch error');
      dismiss.style.cssText =
        'position:absolute;right:5px;top:50%;transform:translateY(-50%);' +
        'width:24px;height:24px;border:0;border-radius:999px;padding:0;' +
        'font:800 19px/22px Inter,system-ui,sans-serif;color:#ffd2d2;' +
        'background:rgba(255,255,255,.10);cursor:pointer;touch-action:manipulation';
      dismiss.addEventListener('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        dismissedErrorKey = currentErrorKey;
        showPill(false);
      });
      pill.appendChild(dismiss);
      pill.style.color = '#ff8f8f';
      pill.style.borderColor = 'rgba(255,120,120,.5)';
      pill.style.background = 'rgba(40,8,12,.96)';
      pill.style.paddingRight = '36px';
      pill.style.pointerEvents = 'auto';
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
      pill.style.paddingRight = '11px';
      pill.style.pointerEvents = 'none';
      showPill(true);
      return;
    }
    showPill(false);
  }

  var lastFailAt = 0;
  var lastErrorSource = null;
  function operatorSafeErrorMessage(what, err) {
    if (err && err.operatorMessage) {
      return err.code === 'LIVE_TOUCH_PROTOCOL'
        ? err.operatorMessage
        : what + ': ' + err.operatorMessage;
    }
    var message = err && err.message ? err.message : String(err || 'operation did not complete');
    var looksLikeDiagnostic = message.length > 240
      || /\{\s*["']?(?:error|code)["']?\s*:/i.test(message)
      || /\b(?:GET|POST|PUT|PATCH|DELETE)\s+\//.test(message);
    if (looksLikeDiagnostic) {
      return what + ': operation did not complete. Controls remain in a safe state.';
    }
    return what + ': ' + message;
  }

  function fail(what, err) {
    state.lastError = operatorSafeErrorMessage(what, err);
    /* `diagnostic` is for the development console. Only explicitly authored
       operator detail is allowed into the production toast; raw response
       bodies, routes, and stack-shaped internals must never cover the show UI. */
    state.lastErrorDetail = err && err.operatorDetail
      ? err.operatorDetail
      : (err && err.code === 'LIVE_TOUCH_PROTOCOL' ? err.diagnostic : null);
    state.lastErrorCode = err && err.code ? err.code : null;
    lastErrorSource = what;
    if (dismissedErrorKey && dismissedErrorKey !== wireErrorKey()) dismissedErrorKey = null;
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
    state.lastError = null;
    state.lastErrorDetail = null;
    state.lastErrorCode = null;
    lastErrorSource = null;
    dismissedErrorKey = null;
    setStatus();
  }

  function clearProtocolError() {
    if (state.lastErrorCode !== 'LIVE_TOUCH_PROTOCOL') return;
    state.lastError = null;
    state.lastErrorDetail = null;
    state.lastErrorCode = null;
    lastErrorSource = null;
    dismissedErrorKey = null;
    setStatus();
  }

  function clearRecoveredRefreshError() {
    if (lastErrorSource !== 'refresh') return;
    state.lastError = null;
    state.lastErrorDetail = null;
    state.lastErrorCode = null;
    lastErrorSource = null;
    dismissedErrorKey = null;
  }

  document.addEventListener('panelerror', function (event) {
    var msg = event.detail && event.detail.message
      ? event.detail.message
      : 'page state is invalid';
    if (window.SpatialContactNotice && msg === window.SpatialContactNotice.MESSAGE) {
      window.SpatialContactNotice.show();
      return;
    }
    fail('panel', msg);
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

  function requestFailure(method, path, status, bodyText) {
    var responseCode = null;
    try {
      var parsed = JSON.parse(bodyText || '{}');
      responseCode = parsed && typeof parsed.code === 'string' ? parsed.code : null;
    } catch (parseError) {
      responseCode = null;
    }
    var diagnostic = method + ' ' + path + ' → ' + status
      + (responseCode ? ' (' + responseCode + ')' : '');
    var error = new Error(diagnostic);
    error.diagnostic = diagnostic;
    error.status = status;
    error.code = responseCode || 'ENGINE_REQUEST_FAILED';
    error.operatorMessage = responseCode === 'PERFORMANCE_MODE'
      ? 'This change is locked while Performance mode is active.'
      : (status >= 500
        ? 'The lighting engine is temporarily unavailable. Live Touch will retry automatically.'
        : 'The lighting engine refused this change. Controls remain in a safe state.');
    return error;
  }

  function requestTimeoutFailure(method, path) {
    var diagnostic = method + ' ' + path + ' → no response in ' + REQ_TIMEOUT_MS + 'ms (timed out)';
    var error = new Error(diagnostic);
    error.operatorMessage = 'Connection to the lighting engine is slow. Live Touch will retry automatically.';
    error.diagnostic = diagnostic;
    error.code = 'TRANSPORT_TIMEOUT';
    return error;
  }

  /* The passcode gate is a HARD DEPENDENCY, exactly like the lifecycle
     controller. A missing module must never degrade into "takeovers just fail"
     — it is reported where it matters (the refusal classifier below and the
     ARM entry point) and the takeover is refused. */
  function passcodeModule() {
    if (!window.TouchControlPasscode) {
      throw new Error('touch_control_passcode.js did not load; Live Touch cannot answer a '
        + 'performance-mode takeover challenge');
    }
    return window.TouchControlPasscode;
  }

  function requestJson(method, path, body, ownerTagged, passcode) {
    var opts = { method: method, headers: {} };
    /* WKWebView keeps an HTTP cache independent of Safari. Live Touch's two
       ARM gates (`/layers/state` and `/model/pixel-layout`) must never be
       answered from an older native session: a cached topology makes a valid
       Titanic artifact look mismatched, while a cached pre-schema layer state
       produces the observed "invalid layerSettings" refusal. This is the
       request half of the server's matching `Cache-Control: no-store`. */
    if (method === 'GET') opts.cache = 'no-store';
    if (ownerTagged) opts.headers['X-Touch-Control-Owner'] = OWNER;
    /* PERFORMANCE-MODE TAKEOVER PASSCODE (operator ruling 2026-08-14).
       The value arrives as an argument, is written straight into THIS
       request's headers, and is never assigned to anything that outlives this
       call — no storage, no module state, no URL, no postMessage. */
    if (passcode) opts.headers[passcodeModule().HEADER] = passcode;
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
          var error = requestFailure(method, path, r.status, t);
          /* Tag takeover refusals so the ARM gate can tell "type the passcode"
             apart from "the takeover itself failed". Everything else keeps its
             existing shape and its existing error channel. */
          var refusal = passcodeModule().refusalFromResponse(r.status, t);
          if (refusal) error.takeoverRefusal = refusal;
          throw error;
        });
      }
      return r.status === 204 ? null : r.json().catch(function () { return null; });
    }).catch(function (e) {
      if (e && e.name === 'AbortError') {
        throw requestTimeoutFailure(method, path);
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

  /* ── PERFORMANCE-MODE TAKEOVER PASSCODE ──────────────────────────────────
     Operator ruling 2026-08-14: taking the rig FROM a running plan while a
     show is live costs one of the three named operator passcodes, EVERY TIME.
     The engine refuses such a request with 401/429 + TAKEOVER_AUTH_*; this is
     the surface's answer to that refusal.

     WHAT IS GATED HERE, AND WHY ONLY THAT.
     The engine's gate covers exactly two things this page can reach:
       1. POST /layers/activate with target 'live_touch' while the plan holds
          the deck pin — i.e. THE ARM BUTTON. That is an explicit operator
          takeover gesture, so it prompts and retries. It is the only request
          this file routes through the gate.
       2. The IMPLICIT re-takeover the engine performs when an owner-tagged
          mutation arrives after the plan has already taken the rig back. That
          is a background performance write (a fader, a wheel), not a takeover
          gesture, and the engine itself answers it by telling the caller to
          make an explicit gesture. Opening a modal in the middle of a drag
          would be worse than useless, so those refusals are REPORTED (loudly,
          on the error toast, with the engine's own words) and the operator
          presses ARM — which lands on path 1.
     The reverse direction — handback to Deck/Mixer, pagehide, idle route sync
     — is never gated by the engine and never carries a passcode.

     NO STORAGE, EVER. The typed value exists as one function argument and as
     one <input> that is wiped the moment it is read. Nothing on this page
     keeps it between attempts, so two ARMs ask twice. */
  var passcodePrompt = null;

  function takeoverPrompt() {
    if (!passcodePrompt) passcodePrompt = passcodeModule().createPrompt(document);
    return passcodePrompt;
  }

  /* Tear the prompt down from OUTSIDE the gate — page lifecycle cancellation, a
     timeline force-disarm, any path that ends the ARM the prompt belonged to.
     close() wipes the input and resolves the pending ask() as a cancel, so the
     gate rejects instead of hanging on an operator who is no longer there. */
  function closeTakeoverPrompt() {
    if (!passcodePrompt) return;
    passcodePrompt.close();
  }

  /**
   * Perform one takeover-gated owner-tagged request.
   *
   * The first attempt carries no passcode (performance mode off → identical to
   * before the ruling). If the engine refuses it, the prompt opens and each
   * submission drives EXACTLY ONE retry carrying the header.
   */
  function takeoverGatedReq(method, path, body, what) {
    var gate = passcodeModule();
    var prompt;
    try {
      prompt = takeoverPrompt();
    } catch (error) {
      /* Loud: a gate that cannot ask must not let the takeover past. */
      return Promise.reject(new Error('performance mode may require an operator passcode for '
        + what + ', but the prompt cannot be rendered: ' + error.message));
    }
    return gate.runGatedRequest(function (passcode) {
      return passcode === null
        ? req(method, path, body)
        : requestJson(method, path, body, true, passcode);
    }, prompt, what);
  }

  /* The engine ALSO refuses an implicit re-takeover: an owner-tagged write that
     arrives after the plan has already taken the rig back. That is a
     performance write — a fader mid-drag — not a takeover gesture, and a modal
     opened by a fader movement would be worse than the error. Report it in the
     operator's own terms and point at the gesture that CAN answer the
     challenge, which is ARM. Nothing is retried and nothing degrades. */
  function describeTakeoverRefusal(error) {
    if (!error || !error.takeoverRefusal) return error;
    var directed = new Error('the timeline holds the rig and performance mode is live — press '
      + 'ARM to take over with an operator passcode (' + error.takeoverRefusal.reason + ')');
    directed.takeoverRefusal = error.takeoverRefusal;
    return directed;
  }

  /* Writes are REFUSED while disarmed — that is the safety, not a courtesy. */
  function write(method, path, body) {
    if (state.phase !== 'armed') return Promise.resolve(null);
    return req(method, path, body).then(function (v) { clearError(); return v; })
      .catch(function (e) { fail('write', describeTakeoverRefusal(e)); return null; });
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
  function settleDrawItem(item, error) {
    (item.settlers || []).forEach(function (settle) {
      try { settle(error || null); }
      catch (settleError) { console.error('[wire] spatial draw acknowledgement failed', settleError); }
    });
  }
  function scheduleDrawPump() {
    if (drawFrame !== null || drawTimer !== null || !drawPending || drawInFlight) return;
    var run = function () {
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
        settleDrawItem(item, error);
        scheduleDrawPump();
        return;
      }
      Promise.resolve(promise).then(function () {
        drawInFlight = false;
        settleDrawItem(item, null);
        scheduleDrawPump();
      }, function (error) {
        drawInFlight = false;
        fail('spatial draw', error);
        settleDrawItem(item, error);
        scheduleDrawPump();
      });
    };
    /* A lift/cancel is safety state, not animation. requestAnimationFrame is
       suspended when WKWebView backgrounds, which used to strand the last
       touch:true until the engine deadman. Final samples run in a microtask;
       ordinary moves stay frame-coalesced. */
    if (drawPending.final) {
      drawFrame = -1;
      Promise.resolve().then(run);
    } else {
      drawFrame = requestAnimationFrame(run);
    }
  }

  function sendDraw(fn, finalSample, settled) {
    /* A newer multi-contact snapshot subsumes the older one. Preserve every
       acknowledgement waiter and settle them from the authoritative write that
       carries the combined latest state; supersession is expected coalescing,
       not a TAKE playback failure. */
    var settlers = drawPending && Array.isArray(drawPending.settlers)
      ? drawPending.settlers.slice() : [];
    if (typeof settled === 'function') settlers.push(settled);
    drawPending = { fn: fn, final: finalSample === true, settlers: settlers };
    if (finalSample && drawTimer !== null) {
      clearTimeout(drawTimer);
      drawTimer = null;
    }
    if (finalSample && drawFrame !== null && drawFrame !== -1) {
      cancelAnimationFrame(drawFrame);
      drawFrame = null;
    }
    scheduleDrawPump();
  }

  /* THE CHART MUST MATCH THE SHIP. The page SHA-256 verifies its generated
     geometry against pixel_map_views.yaml. This second gate verifies every
     live engine pixel identity + coordinate before ARM can take control. */
  var chartDriftVerified = false;
  var chartDriftInFlight = null;
  var chartDriftLastError = null;
  var chartDriftPhase = 'wire-ready';
  var nativePixelEmbed = window.CaptainPadEmbed && window.CaptainPadEmbed.mode === 'native';
  var nativePixelDocumentId = nativePixelEmbed
    ? 'pixel-document-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2)
    : null;
  var nativePixelStarted = !nativePixelEmbed;
  var nativePixelRequestId = null;
  var nativeVerifierReadyTimer = null;
  var resolveNativePixelStart = null;
  var nativePixelStart = nativePixelEmbed ? new Promise(function (resolve) {
    resolveNativePixelStart = resolve;
  }) : Promise.resolve();

  function nativePixelState() {
    return window.TouchPixelViews && typeof window.TouchPixelViews.state === 'function'
      ? window.TouchPixelViews.state() : null;
  }

  function announceNativePixelVerifierReady() {
    if (!nativePixelEmbed || nativePixelStarted || !window.CaptainPadEmbed) return;
    var pixelState = nativePixelState();
    window.CaptainPadEmbed.post({
      type: 'touch-control-pixel-verifier-ready',
      version: 1,
      documentId: nativePixelDocumentId,
      phase: chartDriftPhase,
      staticVerified: !!(pixelState && pixelState.staticVerified),
      engineVerified: !!(pixelState && pixelState.engineVerified),
      readyStatus: pixelState && typeof pixelState.readyStatus === 'string'
        ? pixelState.readyStatus : 'unavailable',
    });
  }

  function publishPixelVerification(status, error) {
    if (!nativePixelEmbed || !window.CaptainPadEmbed) return;
    var pixelState = nativePixelState();
    window.CaptainPadEmbed.post({
      type: 'touch-control-pixel-verification',
      version: 1,
      documentId: nativePixelDocumentId,
      requestId: nativePixelRequestId,
      status: status,
      phase: chartDriftPhase,
      staticVerified: !!(pixelState && pixelState.staticVerified),
      engineVerified: !!(pixelState && pixelState.engineVerified),
      readyStatus: pixelState && typeof pixelState.readyStatus === 'string'
        ? pixelState.readyStatus : 'unavailable',
      error: error ? String(error.message || error).slice(0, 500) : null,
    });
  }

  function acceptPerformanceModeState(active) {
    if (typeof active !== 'boolean') {
      throw new Error('engine status omitted authoritative performanceMode.active');
    }
    state.performanceModeActive = active;
    document.dispatchEvent(new CustomEvent('performancemode', {
      detail: { active: active },
    }));
    projectAudioPerformanceLock();
    /* A passive Performance page has no owner-scoped Live session yet.
       Reading /global-effect-slots there returns the shared Deck/VSN1 bank,
       which is intentionally not the canonical Live Touch 9..24 action bank.
       Project here only after ARM is complete. The ARM transaction performs
       its own authoritative projection after the private lease exists. */
    if (active && state.phase === 'armed') {
      projectPerformanceEffectSlots().catch(function (error) {
        fail('performance effects', error);
      });
    }
  }

  function chartDriftCheck() {
    if (chartDriftVerified && window.TouchPixelViews && window.TouchPixelViews.canArm()) {
      publishPixelVerification('ready', null);
      return Promise.resolve(true);
    }
    chartDriftVerified = false;
    /* Native verification is protocol-gated, not timing-gated. The page
       repeatedly announces verifier-ready only after this wire and the pixel
       reader are mounted; CaptainPad answers with a correlated start request.
       ARM joins that promise. A lost/reordered theme-ready, focus injection or
       onLoadEnd can no longer strand the verifier in a false pre-mount state. */
    if (!nativePixelStarted) {
      return nativePixelStart.then(function () { return chartDriftCheck(); });
    }
    if (chartDriftInFlight) return chartDriftInFlight;
    if (!window.TouchPixelViews) {
      chartDriftPhase = 'wire-mount';
      chartDriftLastError = new Error('PIXEL VIEW UNAVAILABLE: canonical view reader did not load');
      fail('chart', chartDriftLastError);
      publishPixelVerification('failed', chartDriftLastError);
      return Promise.resolve(false);
    }
    /* Verification hashes the generated view plus the engine's complete
       964-pixel topology. On an iPad that can still be running when the
       operator taps ARM. The old boolean was set BEFORE this work finished,
       so the ARM caller skipped the in-flight check, observed canArm=false,
       and aborted with "pixel view has not verified" even though verification
       completed moments later. Share the real promise; verified means done. */
    chartDriftPhase = 'canonical-source';
    publishPixelVerification('checking', null);
    chartDriftInFlight = window.TouchPixelViews.ready().then(function () {
      chartDriftPhase = 'engine-layout-fetch';
      publishPixelVerification('checking', null);
      return req('GET', '/model/pixel-layout');
    }).then(function (layout) {
      chartDriftPhase = 'engine-layout-compare';
      publishPixelVerification('checking', null);
      return window.TouchPixelViews.verifyEngineLayout(layout);
    }).then(function () {
      chartDriftVerified = true;
      chartDriftLastError = null;
      chartDriftPhase = 'complete';
      publishPixelVerification('ready', null);
      return true;
    }).catch(function (error) {
      chartDriftLastError = error;
      fail('chart', error);
      publishPixelVerification('failed', error);
      return false;
    }).then(function (verified) {
      chartDriftInFlight = null;
      return verified;
    });
    return chartDriftInFlight;
  }

  /* ── boot: learn the model and Live Touch's isolated channel ────────── */
  var refreshInFlight = null;
  function acceptEngineProtocolStatus(status) {
    var actual = status && status.liveTouchProtocolVersion;
    var result = window.TouchControlEndpointContract.engineProtocolStatus(
      ENDPOINT.protocolVersion,
      actual
    );
    if (!result.compatible) {
      state.engineProtocolReady = false;
      var error = new Error(result.diagnostic);
      error.operatorMessage = result.headline;
      error.diagnostic = result.diagnostic;
      error.code = 'LIVE_TOUCH_PROTOCOL';
      throw error;
    }
    state.engineProtocolReady = true;
    clearProtocolError();
  }

  function refresh() {
    /* Native WebViews can pause timers/network work while the app is briefly
       backgrounded. The 2 s poll used to start another four-request refresh
       even when the previous one was still pending, eventually piling up
       duplicate slot reads until an old request hit the 6 s deadline. One
       authoritative refresh at a time; callers join it rather than overlap. */
    if (refreshInFlight) return refreshInFlight;
    refreshInFlight = Promise.all([
      req('GET', '/status'),
      req('GET', '/dimmer-groups'),
      req('GET', '/dimmers'),
      req('GET', '/layers/state'),
    ]).then(function (r) {
      var status = r[0], groups = r[1], dimmers = r[2], layerState = requireLayerState(r[3]);
      acceptEngineProtocolStatus(status);
      state.online = true;
      clearRecoveredRefreshError();
      state.sectionIds = groups || {};
      state.dimmers = dimmers || {};
      acceptPerformanceModeState(status && status.performanceMode && status.performanceMode.active);
      acceptPatternLayerState(layerState);
      if (!(layerState.liveTouch && layerState.liveTouch.ready)) {
        /* A fresh, DISARMED engine intentionally has no Live channel yet.
           Focusing the tab stays passive and online; ARM stages the selected
           pattern, then refreshes the authoritative exports. */
        state.exports = {};
        state.colorCapabilityKnown = false;
        applyCapability();
      }
      chartDriftCheck();
      if (state.performanceModeActive === true && state.phase !== 'armed') {
        markAvailabilityKnown();
        setStatus();
        return status;
      }
      return loadSlots(false).then(function () {
        return publishEffectTruth();
      }).then(function () {
        markAvailabilityKnown();
        setStatus();
        return status;
      });
    }).catch(function (e) {
      state.online = false;
      state.engineProtocolReady = false;
      markAvailabilityKnown();
      var transientTransport = e && (e.code === 'TRANSPORT_TIMEOUT'
        || (typeof e.status === 'number' && e.status >= 500));
      if (!transientTransport) {
        fail('refresh', e);
      } else {
        /* A bounded background poll may time out while the native view or
           engine is briefly busy. Fail closed through the calm NOT AVAILABLE
           curtain, but do not turn a self-healing poll into a raw red request
           dump. The next authoritative success restores the surface. */
        console.warn('[wire] background refresh unavailable', e && e.diagnostic
          ? e.diagnostic
          : e);
        setStatus();
      }
      return null;
    });
    refreshInFlight = refreshInFlight.then(
      function (value) { refreshInFlight = null; return value; },
      function (error) { refreshInFlight = null; throw error; }
    );
    return refreshInFlight;
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
      state.colorCapabilityKnown = true;
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
    var extraNames = [
      'sliderHue3', 'sliderVal3',
      'sliderHue4', 'sliderVal4',
      'sliderHue5', 'sliderVal5',
    ];
    var present = extraNames.filter(function (name) {
      return typeof state.exports[name] === 'number';
    });
    if (!state.colorCapabilityKnown) {
      state.colorOutputSlots = null;
    } else if (present.length === 0) {
      state.colorOutputSlots = 2;
    } else if (present.length === extraNames.length) {
      state.colorOutputSlots = 5;
    } else {
      state.colorOutputSlots = null;
    }
    document.dispatchEvent(new CustomEvent('livecolorcapability', {
      detail: {
        outputSlots: state.colorOutputSlots,
        complete: state.colorOutputSlots !== null,
      },
    }));
  }

  /* ── ARM ────────────────────────────────────────────────────────────── */
  /* ARM owns only the Live Touch setting. It acquires the deadman lease,
     stages Live-local state, then asks the shared Layers router to blend into
     live_touch. Deck and Mixer keep their own patterns, faders and autopilots;
     this page neither captures nor mutates them. */
  var armAsserts = [];          /* awaited on arm: make the rig match the panel */
  var fxCatalogReady = false;   /* engine registry is authoritative; no stale built-in list */
  var fxCatalogPromise = null;
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
     fails must cost only itself. This is not a silent fallback — failures are
     collected and reported once after every safety step has run. */
  var handbackFailures = null;
  function handbackStep(label, p) {
    return p.catch(function (error) {
      console.error('[wire] disarm cleanup step failed', label, error);
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
    }).then(cleanupThenReleaseArmLease).then(function () {
      state.liveBrightnessRevision = null;
      forceDisarmedUi();
    }).catch(function (cleanupError) {
      if (cleanupError && cleanupError.handbackReleased === true) forceDisarmedUi();
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
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('engine returned a non-object layerSettings state');
    }
    if (value.type !== 'layerSettings') {
      throw new Error('engine returned layerSettings type ' + JSON.stringify(value.type)
        + ' instead of "layerSettings"');
    }
    if (!ids[value.active]) {
      throw new Error('engine returned invalid layerSettings.active ' + JSON.stringify(value.active));
    }
    if (!ids[value.target]) {
      throw new Error('engine returned invalid layerSettings.target ' + JSON.stringify(value.target));
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
    var patternTransition = value.liveTouch.patternTransition;
    if (patternTransition !== undefined && patternTransition !== null
        && (typeof patternTransition.id !== 'string' || !patternTransition.id
          || typeof patternTransition.fromPattern !== 'string'
          || typeof patternTransition.toPattern !== 'string'
          || typeof patternTransition.progress !== 'number'
          || patternTransition.progress < 0 || patternTransition.progress > 1
          || patternTransition.durationMs !== 500
          || patternTransition.mode !== 'trans_crossfade')) {
      throw new Error('engine returned an invalid Live Touch base-pattern transition');
    }
    return value;
  }

  function activateLayerSetting(target, reason, ownerRequired) {
    var body = {
      target: target,
      durationMs: LAYER_TRANSITION_MS,
      reason: reason,
      ownerId: ownerRequired ? OWNER : undefined,
    };
    /* THE ONE GATED DIRECTION. Only an owner-tagged activation of live_touch
       can be refused for a missing operator passcode; a handback to Deck or
       Mixer is always free. See the takeover-passcode block above. */
    if (target === 'live_touch' && ownerRequired) {
      return takeoverGatedReq('POST', '/layers/activate', body, 'ARM (Live Touch takeover)')
        .then(requireLayerState);
    }
    var transport = ownerRequired ? req : unownedReq;
    return transport('POST', '/layers/activate', body).then(requireLayerState);
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
    var staged = selectedPatternStagePayload();
    if (!staged) throw new Error('Live Touch has no valid selected pattern');
    if (typeof clearTransientSpatialContacts !== 'function') {
      throw new Error('Live Touch spatial contact owner did not install');
    }
    return clearTransientSpatialContacts('pattern-stage', false).then(function () {
      return req('PUT', '/layers/live_touch/pattern', staged.body);
    }).then(function (response) {
      if (!response || response.status !== 'ok' || response.pattern !== staged.pattern
          || !Number.isInteger(response.sessionRevision)) {
        throw new Error('Live Touch pattern stage returned an invalid acknowledgement');
      }
      state.sessionRevision = response.sessionRevision;
      state.channelPattern = response.pattern;
      if (!syncPatternSelection(response.pattern)) {
        throw new Error('Live Touch staged a pattern that is not present in the authoritative chooser');
      }
      /* Parameters are never rendered for a background pattern (docs/70
         §3.2): the panel learns local controls ONLY from
         GET /layers/live_touch/exports, so ARM simply never makes that call
         for a background — hiding is free and total. This stage runs while
         DISARMED, before the Live layer is activated; changes to an already
         running base use the retained transition path below. */
      if (staged.isBackground) {
        /* A background deliberately has no pattern-local parameter surface.
           Clear the prior instrument's export ids as part of the same stage:
           leaving them resident makes pushPalette(true) queue stale local
           controls into ARM prepare, where the new background correctly
           rejects them as not_local_control. */
        state.exports = {};
        return null;
      }
      return refreshLiveExports();
    });
  }

  /* The handoff ack goes through the ONE embed transport built by
     `touch_control_theme.js` (report _252). In iframe mode that is the same
     origin-checked post to the parent frame this used to do inline; in a
     CaptainPad WebView it is the React Native bridge instead. Doing it here by
     hand would mean the Deck/Mixer blend handshake worked on exactly one of the
     two platforms. */
  function acknowledgeSurfaceRelease(requestId, target) {
    if (!requestId) return;
    var embed = window.CaptainPadEmbed;
    if (!embed || !embed.embedded) {
      throw new Error('Live Touch cannot acknowledge a surface release: '
        + 'the CaptainPad embed transport is unavailable');
    }
    embed.post({
      type: 'touch-control-surface-released',
      version: 1,
      requestId: requestId,
      target: target,
    });
  }

  function verifyArmReadiness() {
    /* Catalog loads are authoritative boot dependencies. Join them instead of
       treating a quick ARM tap as evidence that the surface is in Edit mode. */
    return Promise.all([
      fxCatalogPromise || Promise.reject(new Error('the engine effect catalog is unavailable')),
      backgroundCatalogPromise || Promise.reject(new Error('the authoritative background catalog is unavailable')),
    ]).then(function () {
      if (!fxCatalogReady) throw new Error('the engine effect catalog is unavailable, so effect buttons cannot be trusted');
      if (!backgroundCatalogReady) throw backgroundCatalogError || new Error('the authoritative background catalog is unavailable, so ARM is refused');
      return refresh();
    }).then(function () {
      if (!state.engineProtocolReady) {
        throw new Error('engine Live Touch protocol has not been verified; ARM is refused');
      }
      if (typeof state.performanceModeActive !== 'boolean') {
        throw new Error('engine performance-mode status is unavailable; ARM is refused');
      }
      return verifyPixelViewArmReadiness();
    }).catch(function (error) {
      forceDisarmedUi();
      throw error;
    });
  }

  function verifyPixelViewArmReadiness() {
    return chartDriftCheck().then(function (verified) {
      if (!verified) {
        throw new Error('canonical pixel-view verification failed: '
          + (chartDriftLastError ? chartDriftLastError.message : 'the verification step returned false'));
      }
      if (!window.TouchPixelViews || !window.TouchPixelViews.canArm()) {
        var pixelState = window.TouchPixelViews && typeof window.TouchPixelViews.state === 'function'
          ? window.TouchPixelViews.state() : null;
        var readinessError = new Error('canonical pixel-view verification completed without ARM readiness'
          + (pixelState ? ' (source=' + pixelState.staticVerified
            + ', engine=' + pixelState.engineVerified + ', load=' + pixelState.readyStatus + ')' : ''));
        publishPixelVerification('failed', readinessError);
        throw readinessError;
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
    resetOverlayTransitionDriver();
    if (window.SpatialContactNotice) window.SpatialContactNotice.cleanup();
    /* Live Touch owns these transient controls. Clear them after the shared
       Layers blend has landed; Deck and Mixer settings are never captured,
       muted, or restored by this surface. */
    if (handbackFailures !== null) {
      return Promise.reject(new Error('a second Live Touch cleanup started concurrently'));
    }
    handbackFailures = [];
    function readEffectStatus() {
      return req('GET', '/global-effect-slots/status').then(function (status) {
        if (!status || !Array.isArray(status.slots)) {
          throw new Error('engine effect cleanup readback did not include slots');
        }
        return status;
      });
    }
    function deactivateActiveOverlays() {
      return readEffectStatus().then(function (status) {
        var activeOverlaySlots = status.slots.filter(function (slot) {
          return slot && slot.effectId === 'movementTrace' && slot.active === true;
        });
        return runSeries(activeOverlaySlots.map(function (slot) {
          return function () {
            return handbackStep('overlay-slot/' + slot.slotId,
              req('POST', '/global-effect-slots/' + slot.slotId + '/deactivate', {}));
          };
        }));
      });
    }
    function verifyEffectsCleared() {
      return readEffectStatus().then(function (status) {
        var activeSlots = status.slots.filter(function (slot) {
          return slot && slot.active === true;
        }).map(function (slot) { return slot.slotId; });
        var overlay = status.liveTouchOverlayPattern;
        if (activeSlots.length || (overlay && overlay.requestedActive === true)) {
          throw new Error('engine still reports active effect slots: '
            + (activeSlots.length ? activeSlots.join(',') : 'overlay'));
        }
      });
    }
    var openingSteps = state.performanceModeActive === true ? [] : [
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
      /* XY strobe remains a dedicated transient. Movement generators are now
         authoritative overlay slots and are cleared through their slot actions
         below; cleanup must never call the retired /movement-rate path. */
      cleanupTasks.push(function () {
        return handbackStep('xy-strobe', req('POST', '/strobe-rate', { active: false }));
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
      /* Clear every logically active 2-colour, 5-colour and by-group overlay
         through the engine-owned slot identity. An already-clean retry is a
         successful no-op. */
      return handbackStep('overlay-slots', deactivateActiveOverlays());
    }).then(function () {
      /* Stop everything this panel started. Effects only run because the panel
         is armed, so releasing control must not leave them playing. */
      return handbackStep('disable-all', req('POST', '/global-effects/disable-all', {}));
    }).then(function () {
      return handbackStep('effect-readback', verifyEffectsCleared());
    }).then(function () {
      /* Restore the seeded Live-session slot values before release. Durable
         Deck/Mixer/global presets are never touched by these owner-tagged calls. */
      return handbackStep('effect-colours', restoreEffectColours());
    }).then(function () {
      var failures = handbackFailures;
      handbackFailures = null;
      if (failures.length) {
        var diagnostic = 'Live Touch cleanup incomplete (' + failures.length
          + ' steps): ' + failures.join('; ');
        var cleanupError = new Error(diagnostic);
        cleanupError.operatorMessage =
          'Live Touch could not finish every disarm cleanup step. Controls remain fail-safe.';
        cleanupError.code = 'DISARM_INCOMPLETE';
        throw cleanupError;
      }
      clearError();
    }, function (error) {
      handbackFailures = null;
      throw error;
    });
  }

  function cleanupThenReleaseArmLease() {
    var cleanupError = null;
    return cleanupLiveState().catch(function (error) {
      cleanupError = error;
      return null;
    }).then(releaseArmLease).then(function () {
      if (!cleanupError) return;
      cleanupError.handbackReleased = true;
      throw cleanupError;
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
    if (!armed && typeof clearTransientSpatialContacts === 'function') {
      clearTransientSpatialContacts('arm-' + phase, false);
    }
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
    if (state.performanceModeActive === true) {
      return projectPerformanceEffectSlots().then(function () { return publishEffectTruth(); });
    }
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
    if (typeof window.padBrushWorldCanonical !== 'function') {
      throw new Error('canonical pixel view cannot provide verified brush geometry');
    }
    var spec = window.TouchPixelViews.currentViewSpec();
    var fadeElement = document.getElementById('trailFade');
    var fadeSeconds = fadeElement ? Number(fadeElement.dataset.value) : NaN;
    if ([0.1, 0.5, 1, 1.5].indexOf(fadeSeconds) === -1) {
      throw new Error('FADE must be 0.1, 0.5, 1.0, or 1.5 seconds');
    }
    var amount = brushAmount();
    var modeElement = document.querySelector('#drawModes button.is-active');
    var modeValue = modeElement ? Number(modeElement.dataset.dm) : NaN;
    if (amount === null || !isFinite(modeValue)) {
      throw new Error('spatial brush controls are incomplete');
    }
    var ink = typeof window.inkColour === 'function' ? window.inkColour() : null;
    if (!ink || !isFinite(ink.h) || !isFinite(ink.s) || !isFinite(ink.v)) {
      throw new Error('spatial ink colour is unavailable');
    }
    var radius = window.padBrushWorldCanonical();
    if (!radius || !isFinite(radius.x) || radius.x <= 0 ||
        !isFinite(radius.y) || radius.y <= 0) {
      throw new Error('canonical pixel view returned invalid brush geometry');
    }
    return {
      enabled: true,
      touch: false,
      clear: true,
      mode: DRAW_MODES[Math.round(Math.min(Math.max(modeValue, 0), 1) * 3)],
      fadeSeconds: fadeSeconds,
      amount: amount,
      color: hsvToRgb6(ink.h, ink.s, ink.v),
      colorAlt: hsvToRgb6((ink.h + 0.5) % 1, Math.max(ink.s, 0.85), Math.max(ink.v, 0.9)),
      axisX: spec.axisX,
      axisY: spec.axisY,
      pixelIndices: spec.pixelIndices,
      radius: Math.min(1, radius.x),
      radiusY: Math.min(2, radius.y),
    };
  }

  function verifyPreparedSlots() {
    if (state.performanceModeActive === true) {
      /* Performance ARM never configures slots. Re-project the authoritative
         action catalog instead of comparing the hidden Edit grid against it. */
      return projectPerformanceEffectSlots().then(function () { return publishEffectTruth(); });
    }
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
      .then(function () {
        if (state.performanceModeActive === true) {
          return collectEffectSlotBuildOperations()
            .then(function () { return pushPalette(true); });
        }
        return req('POST', '/global-effects/disable-all', {})
          .then(function () { return req('POST', '/audio-bindings/clear', {}); })
          .then(function () { return pushPalette(true); })
          .then(collectEffectSlotBuildOperations)
          .then(function () { return pushEffectColours(true); })
          .then(function () { return reconcileEffects(true); });
      })
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
    /* Refuse the gesture BEFORE it acquires a lease if the surface could not
       answer a performance-mode passcode challenge. Fail closed, out loud. */
    if (!window.TouchControlPasscode) {
      return Promise.reject(new Error('Live Touch operator-passcode prompt did not load; '
        + 'ARM is refused because a performance-mode takeover could not be authorised'));
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
      .then(cleanupThenReleaseArmLease)
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
          if (error && error.handbackReleased === true) forceDisarmedUi();
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
    /* Focusing this tab is output-passive. Native verifier startup has its own
       acknowledged protocol and deliberately does not depend on this
       fire-and-forget message. */
  });

  document.addEventListener('captainpad:pixel-verification-start', function (event) {
    if (!nativePixelEmbed) return;
    var detail = event.detail || {};
    if (typeof detail.documentId !== 'string' || detail.documentId !== nativePixelDocumentId
        || typeof detail.requestId !== 'string' || !detail.requestId) {
      /* Do not emit an uncorrelated failure that the host cannot safely
         attribute. Re-advertise this live document and wait for its exact ack. */
      announceNativePixelVerifierReady();
      return;
    }
    if (nativePixelStarted && nativePixelRequestId !== detail.requestId) {
      /* A remounted host may issue a new correlated request. It does not reset
         a valid gate; it only gives subsequent diagnostics the live request. */
      nativePixelRequestId = detail.requestId;
      chartDriftCheck();
      return;
    }
    nativePixelRequestId = detail.requestId;
    if (!nativePixelStarted) {
      nativePixelStarted = true;
      if (nativeVerifierReadyTimer !== null) clearInterval(nativeVerifierReadyTimer);
      nativeVerifierReadyTimer = null;
      if (resolveNativePixelStart) resolveNativePixelStart();
      resolveNativePixelStart = null;
    }
    chartDriftCheck();
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
      /* If the cancelled step IS the passcode prompt, nothing will ever answer
         it. Close it so the ARM chain settles instead of waiting forever. */
      closeTakeoverPrompt();
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

  /* ── PATTERN / BACKGROUND (docs/70 §3) ─────────────────────────────────
     The picker is two sections: BACKGROUNDS (the `ambient` playlist's
     blessed entries, D4: ambient.yaml only) and INSTRUMENTS (128-130,
     unchanged, D6). `selectedPatternStagePayload()` below is the single
     place that decides which form a PUT takes, shared by this change
     handler and the ARM stage step (`stageSelectedLivePattern` above) so
     the two can never drift apart. */
  var PATTERN_FILES = {
    '130': '130_spatial_paint',
    '128': '128_five_colour_prism',
    '129': '129_five_colour_stations',
  };

  /* The one playlist this picker is allowed to read (D4). Naming stays
     "BACKGROUND"/"background pattern" everywhere in this file — "ambient"
     only ever appears as this one literal, matching the actual playlist
     file on disk; the timeline's cue kind `ambient` is a homonym this
     surface must not echo (docs/70 §3.2 last bullet). */
  var BACKGROUND_PLAYLIST_NAME = 'ambient';
  var backgroundCatalogReady = false;
  var backgroundCatalogError = null;
  var backgroundCatalogPromise = null;

  /* Capability tier for EVERY background pattern entry, not a per-entry
     trait: none of the ambient patterns export sliderHue3/4/5 (five-colour
     degrades to colorPalette1/2) or targetX/targetY (SPATIAL painting still
     reaches them through the coordinate-blind /spatial-paint global-effect
     path, not the pattern's own exports). One constant covers all 34. */

  /* FALLBACK RULE (docs/70 W2 correction — verified against all 34 entries
     in ambient.yaml): docs/70 §3.2 says list entries "by label", but every
     entry in the blessed ambient playlist ships with label: null, so there
     is no label to list. When an entry has no label, humanize its pattern
     slug instead: strip the leading numeric ordering prefix and the
     underscores, then title-case each remaining word — e.g.
     "00_golden_hour_wash" -> "Golden Hour Wash". This only ever fills a gap;
     an entry that DOES carry a real label keeps it verbatim (see
     backgroundEntryLabel below). */
  function humanizeBackgroundPatternName(patternSlug) {
    var body = String(patternSlug || '').replace(/^\d+_/, '');
    var words = body.split('_').filter(Boolean).map(function (word) {
      return word.charAt(0).toUpperCase() + word.slice(1);
    });
    return words.length ? words.join(' ') : String(patternSlug || '');
  }

  function backgroundEntryLabel(entry) {
    if (entry && typeof entry.label === 'string' && entry.label) return entry.label;
    return humanizeBackgroundPatternName(entry && entry.pattern);
  }

  /* Fills the BACKGROUNDS optgroup from the ambient playlist at boot. This
     is the entry-resolution read the isolation rule carves out alongside
     the /layers/live_touch/* writes — GET only, never a second write
     surface. A failed fetch or an empty playlist fails loudly on the error
     pill; it never leaves a silently-shortened list standing in for the
     real one (codex P0, no fallback behaviours). */
  function populateBackgroundPatternGroup() {
    var group = document.getElementById('patternBackgroundGroup');
    if (!group) return Promise.resolve();
    return req('GET', '/playlists/' + BACKGROUND_PLAYLIST_NAME).then(function (playlist) {
      var entries = (playlist && Array.isArray(playlist.entries)) ? playlist.entries : [];
      if (!entries.length) {
        throw new Error('the "' + BACKGROUND_PLAYLIST_NAME + '" playlist has no background patterns');
      }
      var seenIds = {};
      var seenPatterns = {};
      var options = [];
      entries.forEach(function (entry, index) {
        if (!entry || typeof entry.id !== 'string' || !entry.id
            || typeof entry.pattern !== 'string' || !entry.pattern) {
          throw new Error('background entry ' + (index + 1)
            + ' must provide non-empty id and pattern strings');
        }
        if (seenIds[entry.id]) {
          throw new Error('background playlist repeats entry id ' + JSON.stringify(entry.id));
        }
        if (seenPatterns[entry.pattern]) {
          throw new Error('background playlist repeats pattern ' + JSON.stringify(entry.pattern));
        }
        seenIds[entry.id] = true;
        seenPatterns[entry.pattern] = true;
        var option = document.createElement('option');
        option.value = entry.id;
        option.textContent = backgroundEntryLabel(entry);
        option.dataset.pattern = entry.pattern;
        option.dataset.playlist = BACKGROUND_PLAYLIST_NAME;
        option.dataset.entryId = entry.id;
        options.push(option);
      });
      /* Commit only after every authoritative record validated. A partial
         chooser is a lie: it makes a corrupt catalog look merely shorter. */
      group.textContent = '';
      var fragment = document.createDocumentFragment();
      options.forEach(function (option) { fragment.appendChild(option); });
      group.appendChild(fragment);
      backgroundCatalogReady = true;
      backgroundCatalogError = null;
      syncPatternSelection(state.channelPattern);
    }).catch(function (error) {
      backgroundCatalogReady = false;
      backgroundCatalogError = error;
      group.textContent = '';
      fail('pattern', new Error('background patterns did not load: ' + error.message));
      throw error;
    });
  }

  var patSel = document.getElementById('patternSel');
  var patternChangeInFlight = null;
  var patternSettlementInFlight = null;
  var presetEffectIntent = null;

  function patternForOption(option) {
    if (!option) return null;
    if (option.dataset && option.dataset.pattern) return option.dataset.pattern;
    return PATTERN_FILES[option.value] || null;
  }

  function syncPatternSelection(pattern) {
    if (!patSel || typeof pattern !== 'string' || !pattern) return false;
    for (var i = 0; i < patSel.options.length; i++) {
      if (patternForOption(patSel.options[i]) !== pattern) continue;
      patSel.selectedIndex = i;
      patSel.dataset.confirmedPattern = pattern;
      return true;
    }
    /* A retained Live channel may name an older or API-staged pattern, and the
       ambient catalog can still be loading when the first layer state lands.
       Neither is an operator failure: opening this tab is passive, and ARM
       explicitly stages the current chooser selection before activation.
       Active stage acknowledgements remain strict at their call site. */
    return false;
  }

  function setPatternPending(pending, label) {
    if (!patSel) return;
    patSel.disabled = !!pending;
    patSel.setAttribute('aria-busy', String(!!pending));
    var status = document.getElementById('patternState');
    if (!status) return;
    status.hidden = !pending;
    status.textContent = pending ? (label || 'PREPARING') : '';
  }

  function patternTransitionLabel(phase, fromPattern, toPattern) {
    var from = typeof fromPattern === 'string' && fromPattern ? fromPattern : 'CURRENT';
    var to = typeof toPattern === 'string' && toPattern ? toPattern : 'TARGET';
    return phase + ' ' + from + ' \u2192 ' + to;
  }

  function acceptPatternLayerState(layerState) {
    var live = layerState.liveTouch;
    state.channelPattern = live.pattern;
    if (live.patternTransition) {
      setPatternPending(true, patternTransitionLabel('CROSSFADING',
        live.patternTransition.fromPattern || live.pattern,
        live.patternTransition.toPattern));
      return;
    }
    if (!patternChangeInFlight) {
      syncPatternSelection(live.pattern);
      setPatternPending(false);
    }
  }

  function waitForPatternLanding(pattern, transitionId, timeoutMs) {
    var startedAt = Date.now();
    return new Promise(function (resolve, reject) {
      (function poll() {
        req('GET', '/layers/state').then(requireLayerState).then(function (layerState) {
          acceptPatternLayerState(layerState);
          var live = layerState.liveTouch;
          if (live.pattern === pattern && live.patternTransition === null) {
            resolve(layerState);
            return;
          }
          if (live.patternTransition && live.patternTransition.id !== transitionId) {
            reject(new Error('Live Touch base transition was superseded by '
              + live.patternTransition.id));
            return;
          }
          if (Date.now() - startedAt >= timeoutMs) {
            reject(new Error('Live Touch base pattern did not land within ' + timeoutMs + 'ms'));
            return;
          }
          setTimeout(poll, 50);
        }).catch(reject);
      }());
    });
  }

  backgroundCatalogPromise = populateBackgroundPatternGroup().catch(function () {
    /* The status pill contains the actionable error; readiness refuses ARM. */
    return null;
  });

  /* A BACKGROUND option carries dataset.entryId (stamped by
     populateBackgroundPatternGroup above); an INSTRUMENT option does not,
     and keeps the bare {pattern} form exactly as before this wave
     (regression guard, docs/70 §3.2 D6). */
  function selectedPatternStagePayload() {
    var opt = patSel && patSel.options[patSel.selectedIndex];
    if (!opt) return null;
    if (opt.dataset.entryId) {
      return {
        pattern: opt.dataset.pattern,
        isBackground: true,
        body: { pattern: opt.dataset.pattern, playlist: opt.dataset.playlist, entryId: opt.dataset.entryId },
      };
    }
    var name = PATTERN_FILES[patSel.value];
    if (!name) return null;
    return { pattern: name, isBackground: false, body: { pattern: name } };
  }

  if (patSel) {
    patSel.addEventListener('change', function () {
      var staged = selectedPatternStagePayload();
      if (!staged) return fail('pattern', 'no file mapped for ' + patSel.value);
      if (state.phase !== 'armed') {
        syncPatternSelection(state.channelPattern);
        fail('pattern', 'ARM Live Touch before changing the running base pattern');
        return;
      }
      if (patternChangeInFlight) {
        syncPatternSelection(state.channelPattern);
        fail('pattern', 'a Live Touch base-pattern transition is already in progress');
        return;
      }
      /* Keep B in the native chooser while the engine still confirms A. The
         separate confirmedPattern dataset and explicit A → B state make this
         intent visible without presenting it as an accomplished swap. */
      setPatternPending(true, patternTransitionLabel('PREPARING', state.channelPattern, staged.pattern));
      var requestBody = Object.assign({}, staged.body, {
        transition: { mode: 'trans_crossfade', durationMs: 500 },
      });
      var transition = clearTransientSpatialContacts('pattern-switch', true)
        .then(function () { return req('PUT', '/layers/live_touch/pattern', requestBody); })
        .then(function (result) {
        if (!result || result.status !== 'transitioning'
            || result.pattern !== state.channelPattern
            || result.targetPattern !== staged.pattern
            || !result.transition || result.transition.id !== result.transitionId
            || result.transition.fromPattern !== state.channelPattern
            || result.transition.toPattern !== staged.pattern
            || result.transition.mode !== 'trans_crossfade'
            || result.transition.durationMs !== 500
            || !Number.isInteger(result.sessionRevision)) {
          throw new Error('Live Touch base transition returned an invalid acknowledgement');
        }
        state.sessionRevision = result.sessionRevision;
        setPatternPending(true, patternTransitionLabel('CROSSFADING',
          result.transition.fromPattern, result.transition.toPattern));
        return waitForPatternLanding(staged.pattern, result.transitionId, 6000);
      }).then(function (layerState) {
        state.channelPattern = layerState.liveTouch.pattern;
        if (!syncPatternSelection(state.channelPattern)) {
          throw new Error('Live Touch landed on a pattern that is not present in the authoritative chooser');
        }
        /* Parameters are never rendered for a background pattern (docs/70
           §3.2): the panel learns local controls ONLY from
           GET /layers/live_touch/exports, so a background selection simply
           never makes that call — hiding is free and total. */
        if (staged.isBackground) {
          state.exports = {};
          return null;
        }
        /* Export IDs belong to one WASM instance. Reusing the previous map
           after a live pattern swap can drive an unrelated setter by number. */
        return refreshLiveExports().then(function () {
          /* Pattern-local slots 3-5 were reset with the instance. Reassert the
             palette the surface still shows before accepting another gesture. */
          return pushPalette(true);
        });
      });
      patternSettlementInFlight = transition;
      patternChangeInFlight = transition.then(function () {
        patternChangeInFlight = null;
        setPatternPending(false);
        clearError();
      }).catch(function (error) {
        patternChangeInFlight = null;
        setPatternPending(false);
        syncPatternSelection(state.channelPattern);
        fail('pattern', error);
      });
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
  var LTP = window.LiveTouchSessionPalette;
  if (!LTP) throw new Error('LiveTouchSessionPalette is unavailable');

  var overlayTransitionCtx = {
    ring: null,
    sel: [0, 1],
    transitionId: null,
    terminalPosted: false,
  };

  function readPublishedFivePalette() {
    if (!slotsEl) throw new Error('palette slots are missing');
    var parsed;
    try { parsed = JSON.parse(slotsEl.dataset.palette || '[]'); }
    catch (e) { throw new Error('unreadable palette: ' + e.message); }
    return LTP.assertExactFiveHsv(parsed);
  }

  function readPublishedPaletteSelection() {
    if (!slotsEl) throw new Error('palette slots are missing');
    var selection;
    try { selection = JSON.parse(slotsEl.dataset.paletteSelection || '[0,1]'); }
    catch (e) { throw new Error('unreadable palette selection: ' + e.message); }
    /* outputPaletteFromSelection is the strict validator for this shared
       selection. Use a known palette only to validate without duplicating its
       index rules here. */
    LTP.outputPaletteFromSelection(readPublishedFivePalette(), selection);
    return selection.slice();
  }

  function rememberOverlayTransitionContext(event) {
    var detail = event && event.detail ? event.detail : {};
    if (Array.isArray(detail.sel) && detail.sel.length === 2) {
      overlayTransitionCtx.sel = [0, 1];
    }
    if (Array.isArray(detail.palette) && detail.palette.length === 5) {
      var selection = Array.isArray(detail.sel) ? detail.sel : readPublishedPaletteSelection();
      overlayTransitionCtx.ring = LTP.outputPaletteFromSelection(detail.palette, selection);
    }
  }

  function resetOverlayTransitionDriver() {
    overlayTransitionCtx.transitionId = null;
    overlayTransitionCtx.terminalPosted = false;
    delete pending['overlayPalette'];
  }

  function pushOverlayPalette(palette) {
    if (state.phase !== 'armed') return Promise.resolve();
    var pal = LTP.assertExactFiveHsv(palette);
    send('overlayPalette', function () {
      if (state.phase !== 'armed') return Promise.resolve(null);
      return write('POST', '/layers/live_touch/palette', { colorPalette: pal });
    });
    return Promise.resolve();
  }

  function handleColorTransitionBroadcast(transition) {
    if (!transition || typeof transition !== 'object') {
      resetOverlayTransitionDriver();
      return;
    }
    if (state.phase !== 'armed') {
      resetOverlayTransitionDriver();
      return;
    }
    if (!overlayTransitionCtx.ring) {
      try {
        overlayTransitionCtx.ring = LTP.outputPaletteFromSelection(
          readPublishedFivePalette(), readPublishedPaletteSelection());
        overlayTransitionCtx.sel = [0, 1];
      }
      catch (e) {
        fail('palette transition', e);
        return;
      }
    }
    var status = transition.status || (transition.active ? 'running' : 'idle');
    if (status === 'running') {
      overlayTransitionCtx.terminalPosted = false;
      overlayTransitionCtx.transitionId = transition.id;
      try {
        var frame = LTP.overlayFrameFromTransitionState(
          transition, overlayTransitionCtx.ring, overlayTransitionCtx.sel);
        pushPalette(false, true, frame);
      } catch (e) {
        fail('palette transition', e);
      }
      return;
    }
    if (overlayTransitionCtx.transitionId !== null
        && transition.id !== overlayTransitionCtx.transitionId) return;
    if (overlayTransitionCtx.terminalPosted) return;
    if (status === 'settled' || status === 'cancelled' || status === 'failed') {
      try {
        var terminal = LTP.overlayFrameFromTransitionState(
          transition, overlayTransitionCtx.ring, overlayTransitionCtx.sel);
        pushPalette(false, true, terminal);
      } catch (e) {
        fail('palette transition', e);
      }
      overlayTransitionCtx.terminalPosted = true;
      overlayTransitionCtx.transitionId = null;
    }
  }

  /* Patch a RUNNING movement slot fade envelope and make the change take.
     PATCHing a slot only updates its STORED params; the controller reads them
     when the slot is dispatched, so a running effect kept the fade it started
     with until re-activated. Colours are session-owned through
     /layers/live_touch/palette — never slot paramsOverride.colors. */
  function patchLiveSlot(id, ov) {
    return write('PATCH', '/global-effect-slots/' + id, { paramsOverride: ov })
      .then(function () { return write('POST', '/global-effect-slots/' + id + '/activate', {}); });
  }

  /* The FADE bar, expressed the way a movement effect needs it: what FRACTION
     of each step is spent crossfading into the next. Bar down = hard steps,
     bar up = the colours flow and never jump. */
  function movementFadeSpan() {
    if (!window.ColorTransitionTiming) {
      throw new Error('ColorTransitionTiming is unavailable');
    }
    return window.ColorTransitionTiming.movementFadeSpan();
  }

  function currentColorTransitionMs() {
    if (!window.ColorTransitionTiming) {
      throw new Error('ColorTransitionTiming is unavailable');
    }
    return window.ColorTransitionTiming.ms();
  }

  function pushMovementFade() {
    if (!state.armed || state.performanceModeActive === true || !fxGrid) return;
    var cells = fxGrid.querySelectorAll('.fx-cell.is-on[data-fxkey=movementTrace]');
    if (!cells.length) return;
    var span = movementFadeSpan();
    Array.prototype.forEach.call(cells, function (cell) {
      var id = Number(cell.dataset.slot);
      var ov = liveOverride[id] || {};
      ov.fadeSpan = span;
      ov.switchMs = currentColorTransitionMs();
      liveOverride[id] = ov;
      send('mvfade' + id, function () { patchLiveSlot(id, ov); });
    });
  }

  function pushPalette(strict, skipEnginePair, explicitOutputPalette) {
    if (!slotsEl) return strict ? Promise.reject(new Error('palette slots are missing')) : Promise.resolve();
    var pal;
    try {
      if (explicitOutputPalette) {
        pal = LTP.assertExactFiveHsv(explicitOutputPalette);
      } else {
        pal = LTP.outputPaletteFromSelection(
          readPublishedFivePalette(), readPublishedPaletteSelection());
      }
      if (state.colorCapabilityKnown && state.colorOutputSlots === null) {
        throw new Error('the selected pattern has an incomplete five-colour control contract');
      }
    }
    catch (e) {
      fail('palette', e.message);
      return strict ? Promise.reject(e) : Promise.resolve();
    }

    if (strict) {
      var tasks = [];
      /* Movement overlays do not read CPC or pattern-local sliders. Their
         exact five colours belong to this private Live Touch session and must
         land in the same atomic prepare as the rest of ARM, including the
         read-only Performance effect bank. */
      tasks.push(function () {
        return strictWrite('POST', '/layers/live_touch/palette', { colorPalette: pal });
      });
      if (!skipEnginePair) {
        var body = { colorPalette1: pal[0] };
        if (pal[1]) body.colorPalette2 = pal[1];
        tasks.push(function () { return strictWrite('POST', '/param-center', body); });
      }
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

    /* Keep an already-armed overlay on the exact palette shown by the wheel.
       This endpoint is owner-private and does not configure the shared effect
       bank, so it remains writable in Performance mode. */
    pushOverlayPalette(pal);

    /* Slots 1 and 2 are the ENGINE palette — every pattern sees them. A
       daemon broadcast has already written this pair through its one timing
       owner, so it skips only this duplicate write. Slots 3-5 below still
       have to reach five-colour Live instruments. */
    if (!skipEnginePair) {
      send('palette', function () {
        var body = { colorPalette1: pal[0] };
        if (pal[1]) body.colorPalette2 = pal[1];
        write('POST', '/param-center', body);
      });
    }

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

  /* Reserved for any future per-slot colour effects. COLOUR_EFFECTS is empty
     today — movementTrace reads the session palette; additive colour flashes
     were retired from the Edit grid. restoreEffectColours() still resets any
     legacy slot colour keys on disarm when presetOverride captured them. */
  function pushEffectColours(strict) {
    if (state.performanceModeActive === true) return Promise.resolve();
    if (!liveStateCanWrite(strict) || !fxGrid) return Promise.resolve();
    var pal;
    try { pal = JSON.parse((slotsEl && slotsEl.dataset.palette) || '[]'); }
    catch (e) {
      if (strict) return Promise.reject(new Error('the Live Touch palette is invalid'));
      return Promise.resolve();
    }
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
    /* Performance slots are action-only and session-private. Their runtime
       state was already stopped and verified above; attempting to PATCH their
       configuration is both unnecessary and correctly rejected by the engine. */
    if (state.performanceModeActive === true) return Promise.resolve();
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
  if (slotsEl) slotsEl.addEventListener('palettechange', function (event) {
    rememberOverlayTransitionContext(event);
    /* Color Hub and Legacy Color share #slots as their canonical five-colour
       bus. A daemon-owned palette update must refresh the session-owned overlay
       palette and any future colour-capable effect slots, but must not issue a
       competing static /param-center write underneath crossfade/turns transport. */
    pushPalette(false, !!(event.detail && event.detail.skipPaletteWrite));
    pushEffectColours();
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

  document.addEventListener('livefollowpalette', function (event) {
    var palette = event.detail && event.detail.colorPalette;
    pushPalette(false, true, palette);
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
  var xyMovementSlotId = null;
  var xyMovementNoticeAt = 0;

  /* Mode identity is the `data-mode` ATTRIBUTE, never the button ordinal.
     docs/70 W1 reordered the toggle so SPATIAL ships first and lit; the old
     `btns[1]` read meant "the second button", which silently inverted every
     mode-gated behaviour the moment the order changed. The attribute survives
     any future reorder. Fail-open to spatial when the toggle is absent, as
     before. */
  function spatialMode() {
    if (!modeToggle) return true;
    var spatialBtn = modeToggle.querySelector('button[data-mode="spatial"]');
    return !!(spatialBtn && spatialBtn.classList.contains('is-active'));
  }

  function xyMovementCell() {
    if (!fxGrid) return null;
    var active = fxGrid.querySelector('.fx-cell.is-on[data-fxkey="movementTrace"]');
    if (active) {
      xyMovementSlotId = Number(active.dataset.slot);
      return active;
    }
    if (xyMovementSlotId === null) return null;
    var remembered = fxGrid.querySelector(
      '.fx-cell[data-slot="' + xyMovementSlotId + '"][data-fxkey="movementTrace"]'
    );
    if (!remembered) xyMovementSlotId = null;
    return remembered;
  }

  function announceMissingMovementEffect() {
    var now = Date.now();
    if (now - xyMovementNoticeAt < 3000) return;
    xyMovementNoticeAt = now;
    document.dispatchEvent(new CustomEvent('panelstatus', {
      detail: {
        message: 'Turn on a movement effect before tuning WALK speed.',
        role: 'status',
        ttlMs: 3000,
      },
    }));
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
    /* THE PLAYBACK CONTACT IS NOT A POINTER ID. A replayed TAKE runs through
       the same code as a real finger, so it owns a real spatialPointers entry
       — but the key it used to claim (0x7ffffffe) lived in the SAME namespace
       as real DOM pointer ids. A device that ever handed back that number
       would have painted into the playback contact instead of its own. A
       string can never equal a `pointerId`, which is always a number, so that
       collision class is gone by construction rather than by improbability.
       Synthetic playback samples now DECLARE themselves (see
       spatialContactKey) instead of being recognised by the shape of an id. */
    var TAKE_PLAYBACK_PREFIX = 'take-playback-';

    function isTakePlaybackKey(contactKey) {
      return typeof contactKey === 'string' && contactKey.indexOf(TAKE_PLAYBACK_PREFIX) === 0;
    }

    /* WHICH CONTACT DOES THIS SAMPLE BELONG TO? Read from what the event
       declares, never inferred.

       This used to run the incoming id through Number.isInteger and hand
       anything that failed to the playback key — "is an integer" standing in
       for "is a real pointer". That proxy is gone, and the pin in
       marsin_engine/tests/effects/touch_control_wire_layers_contract.test.js
       forbids it coming back.
       WKWebView derives pointer ids from iOS touch identifiers and can hand
       back a non-integer double, and such a finger resolved to the PLAYBACK
       entry: its `current` was never set, so it vanished from
       spatialPayload()'s strokes[] and painted nothing, with no error
       anywhere. That is a silent fallback, which this project forbids.

       pointerdown, pointermove and liftBrush all key spatialPointers on the
       RAW e.pointerId; this was the one place that re-derived it, so it now
       agrees with them. A sample that is neither a declared playback frame nor
       a numeric pointer id is refused LOUDLY rather than resolved to whatever
       entry happens to be nearby. */
    function spatialContactKey(e) {
      if (e.spatialPlayback === true) {
        if (!isTakePlaybackKey(e.contactKey)) {
          fail('spatial touch', 'playback sample missing a take-playback contactKey');
          return undefined;
        }
        return e.contactKey;
      }
      if (typeof e.pointerId === 'number' && !Number.isNaN(e.pointerId)) return e.pointerId;
      fail('spatial touch', 'a spatial sample carried no usable pointerId ('
        + String(e.pointerId) + ') and no playback marker; refusing it');
      return undefined;
    }

    /* The wire must never carry the raw DOM pointerId as a stroke id.
       WKWebView on iPad hands back pointer ids derived from iOS touch
       identifiers that can be huge integers (e.g. 0x80000001) or large
       non-integer doubles, well outside the engine's setSpatialPaint
       contract (integer, 0..0x7fffffff). Each live spatialPointers entry
       instead gets a SLOT — the smallest free integer in 0..9 — and the
       slot, never the raw id, is what spatialPayload() puts on the wire.
       pointer.id keeps being the raw pointerId so the Map key and
       commitSpatialPayload's lookup are untouched. */
    var spatialSlotUsed = [false, false, false, false, false, false, false, false, false, false];
    function allocateSpatialSlot() {
      for (var i = 0; i < spatialSlotUsed.length; i++) {
        if (!spatialSlotUsed[i]) { spatialSlotUsed[i] = true; return i; }
      }
      /* spatialPointers.size >= 10 is the real gate at every creation site;
         reaching here means that gate and this pool disagreed. No fallback
         to the raw pointerId — fail loudly instead. */
      throw new Error('setSpatialPaint: no free stroke slot (0-9) is available');
    }
    function releaseSpatialSlot(slot) {
      if (slot === undefined || slot === null) return;
      spatialSlotUsed[slot] = false;
    }

    clearTransientSpatialContacts = function (reason, transmit) {
      spatialPointers.forEach(function (pointer) { releaseSpatialSlot(pointer.slot); });
      spatialPointers.clear();
      wirePointer = null;
      wirePadRect = null;
      lastSpatial = null;
      document.dispatchEvent(new CustomEvent('spatialcontactclear', {
        detail: { reason: reason || 'unspecified' },
      }));
      if (!transmit || state.phase !== 'armed') return Promise.resolve(null);
      return new Promise(function (resolve, reject) {
        sendDraw(function () {
          /* Clear contacts only. Heat/ink belongs to the independent overlay
             and must survive a base-pattern transition. */
          return req('POST', '/spatial-paint', {
            enabled: true,
            touch: false,
            strokes: [],
          });
        }, true, function (error) {
          if (error) reject(error); else resolve(null);
        });
      });
    };

    document.addEventListener('spatialcontactclearrequest', function (event) {
      var detail = event.detail || {};
      clearTransientSpatialContacts(detail.reason || 'page-request', true)
        .catch(function (error) { fail('spatial clear', error); });
    });
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) return;
      clearTransientSpatialContacts('background', true)
        .catch(function (error) { fail('spatial background clear', error); });
    });

    function spatialPayload(includeRetiring) {
      var snapshots = [];
      spatialPointers.forEach(function (pointer) {
        if (!pointer.current || (pointer.retiring && !includeRetiring)) return;
        var stroke = {
          id: pointer.slot,
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
    spatialPayloadForTest = function () { return spatialPayload(false).body; };
    spatialPointerSlotForTest = function (pointerId) {
      var pointer = spatialPointers.get(pointerId);
      return pointer ? pointer.slot : undefined;
    };

    function commitSpatialPayload(payload) {
      payload.snapshots.forEach(function (snapshot) {
        if (spatialPointers.get(snapshot.pointer.id) === snapshot.pointer) {
          snapshot.pointer.sent = snapshot.target;
        }
      });
    }

    function queueSpatialTouches(finalSample, settled) {
      sendDraw(function () {
        /* One event state, one command. Pointerdown/move already delivered the
           last live coordinate; lift publishes only the canonical remaining
           contact set instead of a touch:true stamp followed by touch:false. */
        var payload = spatialPayload(false);
        var spatialWrite = settled ? req : write;
        return spatialWrite('POST', '/spatial-paint', payload.body).then(function (response) {
          commitSpatialPayload(payload);
          /* A retiring contact and its gate claim remain authoritative until
             the engine ACKs the lift. If the request is rejected, TAKE retries
             the same up against this retained entry instead of falsely ACKing
             an already-forgotten contact. */
          if (finalSample) {
            spatialPointers.forEach(function (pointer, pointerId) {
              if (!pointer.retiring) return;
              releaseSpatialSlot(pointer.slot);
              spatialPointers.delete(pointerId);
              if (isTakePlaybackKey(pointerId)) {
                window.TouchSpatialContactGate.releasePlayback(pointerId);
              } else {
                window.TouchSpatialContactGate.release(pointerId);
              }
            });
          }
          if (spatialPointers.size === 0) wirePadRect = null;
          return response;
        });
      }, finalSample, settled);
    }

    function rejectSpatialSample(settled, message) {
      if (typeof settled !== 'function') return;
      settled(new Error(message));
    }

    var pushXY = function (e, settled) {
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
        if (!sp) {
          rejectSpatialSample(settled, 'spatial sample could not be projected onto the pixel map');
          return;
        }
        {
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
          }
          var brush = brushPatch(sp);
          var amount = brushAmount();
          if (!brush || amount === null) {
            rejectSpatialSample(settled, 'spatial brush geometry is unavailable');
            return;
          }
          brush.amount = amount;
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
          if (!strokeCol && e.spatialPlayback && lastStrokeColor) {
            strokeCol = lastStrokeColor;
            strokeAlt = lastStrokeAlt;
          }
          if (!strokeCol && e.spatialPlayback && slotsEl && slotsEl.dataset.palette) {
            try {
              var playbackPal = JSON.parse(slotsEl.dataset.palette);
              if (playbackPal.length && typeof playbackPal[0].h === 'number') {
                strokeCol = hsvToRgb6(playbackPal[0].h, playbackPal[0].s, playbackPal[0].v);
                strokeAlt = hsvToRgb6((playbackPal[0].h + 0.5) % 1,
                                      Math.max(playbackPal[0].s, 0.85), Math.max(playbackPal[0].v, 0.9));
              }
            } catch (paletteError) {
              rejectSpatialSample(settled, 'the playback palette is unreadable: ' + paletteError.message);
              return;
            }
          }
          if (!strokeCol) {
            fail('spatial colour', 'the page supplied no valid ink colour; refusing the stroke');
            rejectSpatialSample(settled, 'the page supplied no valid ink colour; refusing the stroke');
            return;
          }
          var pointerId = spatialContactKey(e);
          if (pointerId === undefined) {
            rejectSpatialSample(settled, 'spatial contact was refused by the single-contact gate');
            return;
          }
          var pointer = spatialPointers.get(pointerId);
          if (!pointer || pointer.retiring) {
            rejectSpatialSample(settled, 'spatial contact is not active');
            return;
          }
          pointer.current = sp;
          pointer.color = strokeCol;
          pointer.colorAlt = strokeAlt;
          lastSpatial = sp;
          lastSpatialBrush = brush;
          lastStrokeColor = strokeCol;
          lastStrokeAlt = strokeAlt;
          queueSpatialTouches(false, settled);
        }
        /* ONE CONTACT OWNER. Pattern 130 previously received this same finger
           again through sliderTargetX/Y/sliderTouch after /spatial-paint had
           already accepted it. Its private wrapped pool then rendered beside
           the canonical projected brush: one physical finger, two footprints
           and two command paths. The retained owner-scoped spatial stage is
           the independent overlay for every base pattern, including 130. */
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
          /* WALK tunes the active owner-scoped movement slot. It used to call
             the retired /movement-rate route, which the Live Touch authority
             correctly refuses because that route can bypass the selected slot.
             This action endpoint changes only the running private overlay; it
             does not reconfigure or persist the effect bank, so it remains a
             valid performance action in both Edit and Performance. */
          var movementCell = xyMovementCell();
          if (!movementCell) {
            announceMissingMovementEffect();
            return;
          }
          var movementSlotId = Number(movementCell.dataset.slot);
          var pps = window.xyWalkPps(up);
          var movementPath = '/global-effect-slots/' + movementSlotId + '/movement-rate';
          var body = pps
            ? { active: true, pixelsPerSecond: pps }
            : { active: false };
          write('POST', movementPath, body).then(function () {
            publishEffectTruth(movementCell, pps ? 'active' : 'inactive');
          });
        });
      }
    };
    /* Stroke colour belongs to the canonical /spatial-paint contact body.
       A former pointerdown listener also wrote colorPalette1 through the
       shared ParamCenter, creating a second outbound path before the first
       contact sample. One physical contact now has one spatial command. */
    /* A REPLAYED TAKE IS A FINGER. The page owns the recording and the pad; it
       emits 'spatialplay' per frame and this hands it to the SAME code the live
       pad uses, so a played-back stroke cannot behave differently from the one
       that was performed. Only the pen-up is special-cased, because there is no
       pointerup event to hang it on. */
    window.TouchTakeEligibility = function () {
      if (!spatialMode()) return { ok: false, reason: 'SPATIAL mode is not active' };
      if (state.phase !== 'armed' || !state.armed) {
        return { ok: false, reason: 'ARM is not confirmed' };
      }
      if (!state.online) return { ok: false, reason: 'engine connection is offline' };
      if (!armLeaseAcquired) return { ok: false, reason: 'Live Touch lease is not confirmed' };
      return { ok: true };
    };
    function settleTakeSample(requestId, error) {
      document.dispatchEvent(new CustomEvent('spatialplayack', {
        detail: {
          requestId: requestId,
          ok: !error,
          error: error ? error.message : null,
        },
      }));
    }
    document.addEventListener('spatialplay', function (ev) {
      var d = ev.detail || {};
      if (typeof d.requestId !== 'string' || !d.requestId) {
        fail('spatial playback', 'TAKE sample has no acknowledgement identity');
        return;
      }
      /* PEN-UP IS UNCONDITIONAL (audit H9). This guard used to sit above the
         !d.down branch, so switching to XY mode mid-playback dropped the final
         touch:false and left the engine re-stamping heat at the last point
         forever — the same standing-paint failure class as the stuck-ERASE
         critical, reachable without a crash. Lifting a brush is always safe;
         only laying paint DOWN needs the mode check. */
      var contactKey = d.contactKey;
      if (!isTakePlaybackKey(contactKey)) {
        var identityError = new Error('TAKE sample missing take-playback contactKey');
        fail('spatial playback', identityError);
        settleTakeSample(d.requestId, identityError);
        return;
      }
      if (!d.down) {
        var playback = spatialPointers.get(contactKey);
        if (playback) {
          if (!playback.retiring) playback.retiring = true;
          queueSpatialTouches(true, function (error) {
            if (!error) window.TouchSpatialContactGate.releasePlayback(contactKey);
            settleTakeSample(d.requestId, error);
          });
        } else {
          /* Absence is not proof that the engine is lifted: lifecycle cleanup
             can forget the local entry before its own clear write settles.
             Duplicate empty-stroke lifts are safe, so require an authoritative
             ACK here too and retain the page gate across any rejection. */
          queueSpatialTouches(true, function (error) {
            if (!error) window.TouchSpatialContactGate.releasePlayback(contactKey);
            settleTakeSample(d.requestId, error);
          });
        }
        return;
      }
      var eligibility = window.TouchTakeEligibility();
      if (!eligibility.ok) {
        var eligibilityError = new Error(eligibility.reason);
        fail('spatial playback', eligibilityError);
        settleTakeSample(d.requestId, eligibilityError);
        return;
      }
      if (!spatialPointers.has(contactKey)) {
        if (!window.TouchSpatialContactGate ||
            !window.TouchSpatialContactGate.beginPlayback(contactKey)) {
          if (window.SpatialContactNotice) window.SpatialContactNotice.show();
          settleTakeSample(d.requestId, null);
          return;
        }
        spatialPointers.set(contactKey, {
          id: contactKey, slot: allocateSpatialSlot(), current: null, sent: null, retiring: false,
        });
      }
      wirePadRect = xyPad.getBoundingClientRect();
      var r = xyPad.getBoundingClientRect();
      /* The marker — not a reserved number — is what routes this sample to the
         playback contact, so no real finger can ever be mistaken for it. */
      pushXY({ spatialPlayback: true, contactKey: contactKey,
        clientX: r.left + d.u * r.width, clientY: r.top + d.v * r.height },
      function (error) { settleTakeSample(d.requestId, error); });
    });

    /* SWITCHING WHAT Y DRIVES must stop the other one, or it keeps running with
       nothing controlling it — the same "effect left playing by a surface that
       is no longer driving it" this panel has been bitten by before. */
    document.addEventListener('xyaxischange', function (ev) {
      var to = (ev.detail && ev.detail.axis) || 'walk';
      send('xyHandoff', function () {
        if (to !== 'strobe') {
          write('POST', '/strobe-rate', { active: false });
          return;
        }
        var movementCell = xyMovementCell();
        if (!movementCell) return;
        var slotId = Number(movementCell.dataset.slot);
        write('POST', '/global-effect-slots/' + slotId + '/movement-rate', {
          active: false,
        }).then(function () {
          publishEffectTruth(movementCell, 'inactive');
        });
      });
    });

    /* Post-stability multi-touch is deliberately deferred. The shared gate
       admits exactly one raw contact across marker, preview and engine wire. */
    var wirePointer = null;
    xyPad.addEventListener('pointerdown', function (e) {
      if (spatialMode()) {
        if (spatialPointers.has(e.pointerId)) return;
        if (!window.TouchSpatialContactGate ||
            !window.TouchSpatialContactGate.begin(e.pointerId)) {
          return;
        }
        spatialPointers.set(e.pointerId, {
          id: e.pointerId, slot: allocateSpatialSlot(), current: null, sent: null, retiring: false,
        });
      } else {
        if (wirePointer !== null && e.pointerId !== wirePointer) return;
        wirePointer = e.pointerId;
      }
      wirePadRect = xyPad.getBoundingClientRect();
      try { xyPad.setPointerCapture(e.pointerId); } catch (error) {
        var failedSpatialPointer = spatialPointers.get(e.pointerId);
        if (failedSpatialPointer) releaseSpatialSlot(failedSpatialPointer.slot);
        spatialPointers.delete(e.pointerId);
        window.TouchSpatialContactGate.release(e.pointerId);
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
        return;
      }
      if (wirePointer === null || pointerId !== wirePointer) return;
      wirePointer = null;
      window.TouchSpatialContactGate.release(pointerId);
      if (!spatialPointers.size) wirePadRect = null;
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
      clearTransientSpatialContacts('view-change', false);
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
    if (top) top.textContent = topPlane ? 'Z+ FRONT' : 'Y+ UP';
    if (bot) bot.textContent = topPlane ? 'Z− BACK' : 'Y− DOWN';
    if (currentPixelViewId === 'te_sign') {
      if (lft) lft.innerHTML = '<b>Z−</b>BACK';
      if (rgt) rgt.innerHTML = '<b>Z+</b>FRONT';
    } else {
      if (lft) lft.innerHTML = '<b>X−</b>LEFT';
      if (rgt) rgt.innerHTML = '<b>X+</b>RIGHT';
    }
  }

  /* Switching mode re-labels the axes so the pad never claims the wrong thing. */
  if (modeToggle) {
    modeToggle.addEventListener('click', function () {
      setTimeout(function () {
        relabelPadAxes();
        applyCapability();
        clearTransientSpatialContacts('mode-switch', true)
          .catch(function (error) { fail('spatial mode clear', error); });
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
  /* Re-state every fader's audio choice on ARM. The bindings are cleared on
     disarm, so this is what puts them back - and it means what the engine is
     doing always matches what the surface shows, rather than whatever was last
     written to it. */
  function pushAllAudioBindings(strict) {
    /* Performance projects read-only binding state. ARM reassertion is a
       programmatic lifecycle step, not an operator attempt, so it must be a
       quiet no-op here rather than flooding the error surface once per row. */
    if (state.performanceModeActive === true) return Promise.resolve();
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

  /* Preset recall is not a normal coalesced gesture: success must mean every
     restored strip has reached the owner-scoped engine state.  `write()` is
     deliberately forgiving for live dragging, so use raw req()+readback here. */
  function commitPresetBrightness() {
    if (liveBrightnessTimer) { cancelAnimationFrame(liveBrightnessTimer); liveBrightnessTimer = null; }
    liveBrightnessPending = { master: null, groups: {} };
    liveBrightnessPendingFade = null;
    var body = collectLiveBrightness();
    if (!Number.isInteger(state.liveBrightnessRevision)) {
      return Promise.reject(new Error('preset brightness has no active Live Touch revision'));
    }
    body.expectedRevision = state.liveBrightnessRevision;
    return req('PATCH', '/touch-control/brightness', body).then(function (payload) {
      return acceptLiveBrightness(payload, true);
    });
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
    if (state.performanceModeActive === true) return Promise.resolve();
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
  var slotRecords = {};         /* slotId -> authoritative engine slot record */
  var presetOverride = {};      /* slotId -> its ORIGINAL override, captured once */
  var liveOverride = {};        /* slotId -> its current override */

  var loadSlotsInFlight = null;
  function loadSlots(strict, force) {
    /* Share the physical GET while preserving each caller's error contract:
       passive refresh reports and resolves; atomic ARM verification reports
       and rethrows. The raw shared promise stays rejecting so a passive caller
       cannot accidentally turn a concurrent strict verification into success. */
    if (force) {
      return Promise.resolve(loadSlotsInFlight).catch(function () {}).then(function () {
        return loadSlots(strict, false);
      });
    }
    if (!loadSlotsInFlight) {
      loadSlotsInFlight = req('GET', '/global-effect-slots').then(function (r) {
      slotOf = {};
      slotRecords = {};
      (r.slots || []).forEach(function (sl) {
        slotRecords[sl.slotId] = sl;
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
      });
      loadSlotsInFlight = loadSlotsInFlight.then(
        function (value) { loadSlotsInFlight = null; return value; },
        function (error) { loadSlotsInFlight = null; throw error; }
      );
    }
    return loadSlotsInFlight.catch(function (e) {
      fail('slots', e);
      if (strict) throw e;
    });
  }

  var OURS_FROM = 9;          /* slots 1-8 belong to the Deck + VSN1 */
  var MAX_SLOTS = 32;         /* global_effect_slot_manager.MAX_SLOTS */
  /* Performance is an action surface over the same approved 16 bindings as
     Edit. The session seeds these records before it reports Performance ready;
     never manufacture a partial grid from whichever slots happened to survive
     an earlier session. */
  var CANONICAL_PERFORMANCE_EFFECTS = [
    'movementTrace|pulse_slow_fade',
    'movementTrace|every_other_repeat',
    'movementTrace|every_other_reverse',
    'movementTrace|every_other_two_tone',
    'movementTrace|one_per_color_repeat',
    'movementTrace|one_per_color_reverse',
    'movementTrace|one_per_color_double',
    'movementTrace|whole_group_repeat',
    'movementTrace|whole_group_reverse',
    'strobe|sync_4hz',
    'beatPump|soft',
    'breath|calm',
    'feedbackTrails|soft_afterimage',
    'feedbackTrails|ghost_ship',
    'waterlineSweep|shadow_pass',
    'freeze|hold'
  ];

  function projectPerformanceEffectSlots() {
    return (fxCatalogPromise || Promise.reject(new Error('effect catalog is still loading'))).then(function () {
      if (!fxCatalogReady) throw new Error('effect catalog is unavailable for Performance actions');
      return loadSlots(true, true);
    }).then(function () {
      var slots = Object.keys(slotRecords).map(function (id) { return slotRecords[id]; })
        .filter(function (slot) {
          return slot && slot.enabled === true && Number.isInteger(slot.slotId)
            && slot.slotId >= OURS_FROM && slot.slotId <= 24
            && typeof slot.effectId === 'string' && slot.effectId
            && typeof slot.presetId === 'string' && slot.presetId
            && ['toggle', 'trigger', 'hold'].indexOf(slot.behavior) !== -1;
        }).sort(function (a, b) { return a.slotId - b.slotId; });
      if (slots.length !== CANONICAL_PERFORMANCE_EFFECTS.length) {
        throw new Error('engine must expose the complete canonical 16 Live Touch Performance slots 9-24');
      }
      slots.forEach(function (slot, index) {
        var expectedSlotId = OURS_FROM + index;
        var expectedBinding = CANONICAL_PERFORMANCE_EFFECTS[index];
        if (slot.slotId !== expectedSlotId || (slot.effectId + '|' + slot.presetId) !== expectedBinding) {
          throw new Error('engine Performance slot ' + expectedSlotId
            + ' must retain canonical binding ' + expectedBinding);
        }
      });
      document.dispatchEvent(new CustomEvent('fxperformanceslots', { detail: { slots: slots } }));
      return slots;
    });
  }

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
    if (state.performanceModeActive === true) {
      return Promise.reject(new Error('Performance effects are action-only; slot configuration is refused'));
    }
    var id = Number(cell.dataset.slot);
    if (!(id >= OURS_FROM && id <= MAX_SLOTS)) {
      var slotError = new Error('button has slot ' + id + ', outside 9..32');
      fail('build', slotError);
      return Promise.reject(slotError);
    }
    var eff = cell.dataset.fxkey;
    var behavior = cell.dataset.behavior;
    if (behavior !== 'toggle' && behavior !== 'trigger' && behavior !== 'hold') {
      return Promise.reject(new Error('effect button has no authoritative behavior'));
    }
    var body = {
      enabled: true,
      label: cell.querySelector('.fx-name').textContent,
      effectId: eff,
      presetId: cell.dataset.preset,
      behavior: behavior,
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
    /* MOVEMENT overlays read the session-owned five-colour palette staged through
       /layers/live_touch/palette. paramsOverride.colors is refused — only the
       fade envelope travels with the slot binding. */
    if (eff === 'movementTrace') {
      ov.fadeSpan = movementFadeSpan();
      ov.switchMs = currentColorTransitionMs();
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
      /* Slot status is the authoritative action truth. In particular,
         Live Touch movementTrace is rendered by the non-replacing overlay
         compositor and deliberately never appears as an enabled controller
         effect. Reading controller-only truth made a successful overlay tap
         repaint OFF immediately, so the operator could not enable the first
         nine Performance tiles even though the engine was running them. */
      if (!st || !Array.isArray(st.slots)) {
        throw new Error('global effect status omitted authoritative slot state');
      }
      st.slots.forEach(function (slot) {
        if (slot && Number.isInteger(slot.slotId) && slot.active === true) {
          on[slot.slotId] = true;
        }
      });
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

  function publishEffectTruth() {
    if (!fxGrid) return Promise.resolve({});
    return engineOnSlots().then(function (on) {
      document.dispatchEvent(new CustomEvent('fxconfirmedstate', {
        detail: { activeSlots: Object.keys(on).map(Number) },
      }));
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
  var rcBusy = false, rcAgain = false, rcCurrent = Promise.resolve();
  /* A press is a TOGGLE and the engine's status readback lags it, so a
     reconcile that runs again too soon still sees the OLD state and presses the
     same slot a second time — putting it straight back. MEASURED: one tap
     produced three presses. A slot pressed within this window is left alone
     until its new state is actually observable. */
  var SETTLE_MS = 1800;
  var lastPress = {};
  var holdChains = {};

  function cellBehavior(cell, slotId) {
    return (cell && cell.dataset && cell.dataset.behavior) || slotBehavior[slotId] || null;
  }

  function dispatchHoldEdge(slotId, edge) {
    var previous = holdChains[slotId] || Promise.resolve();
    var task = previous.catch(function () {}).then(function () {
      return req('POST', '/global-effect-slots/' + slotId + '/' + edge);
    }).then(function () {
      return publishEffectTruth();
    }).catch(function (error) {
      fail('effect hold ' + edge, error);
      return publishEffectTruth().catch(function (truthError) {
        fail('effect hold readback', truthError);
      }).then(function () { throw error; });
    });
    holdChains[slotId] = task.catch(function () {});
    return task;
  }

  function reconcileEffects(strict) {
    strict = strict === true;
    if (!fxGrid || !liveStateCanWrite(strict)) return Promise.resolve();
    if (rcBusy) {
      if (strict) {
        /* Preset recall is authoritative and must not race the ordinary poll or
           tap reconciler. Wait for that serialized chain, then perform a fresh
           strict read/write/readback pass instead of reporting a false partial
           apply merely because routine reconciliation was already active. */
        return rcCurrent.catch(function () {}).then(function () {
          return reconcileEffects(true);
        });
      }
      rcAgain = true;
      return Promise.resolve();
    }
    rcBusy = true;
    var operation = engineOnSlots().then(function (on) {
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
        var cell = cellFor(Number(id));
        var behavior = cellBehavior(cell, Number(id));
        if (behavior === 'trigger' || behavior === 'hold') return;
        if (!!on[id] === !!want[id]) return;            /* already agrees */
        pressOnce(id);
      });
      /* Anything RUNNING that this grid does not claim gets switched off —
         including slots 1-8. While armed the panel owns the rig, and an effect
         the operator cannot see or reach is exactly the "it won't turn off"
         problem. This only ever turns those slots OFF; it never binds or
         re-provisions them, so the Deck's and the VSN1's own bindings survive. */
      Object.keys(on).forEach(function (id) {
        var cell = cellFor(Number(id));
        var behavior = cellBehavior(cell, Number(id));
        if (want[id] || behavior === 'trigger' || behavior === 'hold') return;
        pressOnce(id);
      });
      return runSeries(tasks).then(function () {
        return new Promise(function (resolve) {
          setTimeout(function () { resolve(publishEffectTruth()); }, 75);
        });
      });
    }).then(function () {
      rcBusy = false;
      if (!rcAgain) return;
      rcAgain = false;
      return reconcileEffects(strict);
    }).catch(function (e) {
      rcBusy = false;
      fail('effects', e);
      publishEffectTruth().catch(function (truthError) { fail('effects readback', truthError); });
      if (strict) throw e;
    });
    rcCurrent = operation;
    return operation;
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
      if (state.performanceModeActive === true) {
        if (cell.dataset.performanceBound === 'true') return;
        projectPerformanceEffectSlots().then(publishEffectTruth).catch(function (error) {
          fail('performance effects', error);
        });
        return;
      }
      provisionCell(cell).then(loadSlots).then(function () {
        pushEffectColours();
        return reconcileEffects();
      });
    });

    /* The page drives the lit state from pointerdown/up (hold or tap), so the
       wire reconciles after EITHER edge rather than on click. */
    ['pointerdown', 'pointerup', 'pointercancel'].forEach(function (evt) {
      fxGrid.addEventListener(evt, function (e) {
        var face = e.target.closest('[data-role=fxface]');
        if (!face) return;
        var cell = face.closest('.fx-cell');
        var slotId = Number(cell && cell.dataset.slot);
        if (cellBehavior(cell, slotId) === 'hold') {
          if (state.phase !== 'armed') {
            fail('effect hold', 'ARM Live Touch before using a hold effect');
            return;
          }
          if (!(slotId >= 9)) {
            fail('effect hold', 'hold button has no valid slot');
            return;
          }
          dispatchHoldEdge(slotId, evt === 'pointerdown' ? 'down' : 'up').catch(function () {});
          return;
        }
        setTimeout(function () {
          reconcileEffects();
          applyStatic();
          if (state.performanceModeActive === true) return;
          /* A movement button lit after ARM must pick up the current fade
             envelope. Colours come from the session palette staged at ARM and
             on every wheel move through pushPalette(), not slot overrides. */
          pushMovementFade();
        }, 0);
      });
    });

    fxGrid.addEventListener('click', function (e) {
      var cell = e.target.closest('.fx-cell');
      if (!cell || e.target.closest('[data-role=fxpick]')) return;
      var id = Number(cell.dataset.slot);
      if (cellBehavior(cell, id) === 'hold') return;
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
          if (state.performanceModeActive === true) return;
          /* A movement button lit after ARM must pick up the current fade
             envelope. Colours come from the session palette staged at ARM and
             on every wheel move through pushPalette(), not slot overrides. */
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
     eases in rather than snapping. Both are driven from ColorTransitionTiming,
     the one authority Legacy Color and Color Hub mirror, because an operator
     thinks in "how fast does the look change", not in two numbers.
     Sent on release AND while dragging, throttled by send(). */
  var CTT = window.ColorTransitionTiming;
  if (!CTT) throw new Error('ColorTransitionTiming is unavailable');

  function pushFadeToEngine(strict) {
    strict = strict === true;
    var fadeMs = currentColorTransitionMs();
    if (strict) {
      return strictWrite('POST', '/param-center', {
        colorTransitionMs: fadeMs,
        motionTransitionMs: fadeMs,
      });
    }
    send('fade', function () {
      var ms = currentColorTransitionMs();
      write('POST', '/param-center', {
        colorTransitionMs: ms,
        motionTransitionMs: ms,
      });
    });
    pushMovementFade();
    return Promise.resolve();
  }

  document.addEventListener('colortransitiontiming', function (event) {
    if (event.detail && event.detail.source === 'engine-broadcast') return;
    pushFadeToEngine(false);
  });

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
      if (savedTransitionMs === null) savedTransitionMs = currentColorTransitionMs();
      write('POST', '/param-center', { colorTransitionMs: d.ms, motionTransitionMs: d.ms })
        .catch(function (err) { fail('preset fade', err); });
    } else if (d.kind === 'fade-restore') {
      if (savedTransitionMs === null) return;
      var back = savedTransitionMs;
      savedTransitionMs = null;
      CTT.setMs(back, 'preset-restore');
      pushFadeToEngine(false);
    } else if (d.kind === 'dip') {
      queueLiveMasterFade(d.target, d.ms);
    }
  });

  var fadeSlider = document.querySelector('.slider-vertical.fade');
  if (fadeSlider) {
    var pushFade = function (strict) {
      return pushFadeToEngine(strict === true);
    };
    fadeSlider.addEventListener('sliderchange', pushFade);
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

  /* What SHOULD receive the explicit post-pattern fixed-colour compositor.
   *
   * GLOBAL is palette AUTHORITY, not a paint mode. It feeds the active Live
   * pattern through ParamCenter and the pattern's local five-colour exports;
   * installing a group-fixed colour for GLOBAL would flatten the animated
   * background after it rendered. OWN is the only explicit request for that
   * post-pattern compositor. Anything else has no fixed override. */
  function desiredStatic(strict) {
    var out = {};
    if (!liveStateCanWrite(strict)) return out;
    var modes = groupModes();
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
      }
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
        var gap = Math.max(20, Math.min(120, Math.round(currentColorTransitionMs() / changed.length)));
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
        var offGap = Math.max(20, Math.min(120, Math.round(currentColorTransitionMs() / going.length)));
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

  function projectAudioPerformanceLock() {
    var locked = state.performanceModeActive === true;
    Array.prototype.forEach.call(document.querySelectorAll(
      '[data-role=audpick], [data-role=audmode], [data-role=faudpick], [data-role=faudlock]'
    ), function (control) {
      if (!control.dataset.editTitle) control.dataset.editTitle = control.title;
      control.disabled = locked;
      control.title = locked
        ? 'Edit mode required — audio bindings are unavailable in Performance'
        : control.dataset.editTitle;
      var row = control.closest('.aud-row, .fader-audio');
      if (row) row.classList.toggle('is-performance-locked', locked);
    });
  }

  function audWrite(row, strict) {
    strict = strict === true;
    if (state.performanceModeActive === true) {
      fail('audio binding', 'Edit mode required — Performance never changes audio bindings');
      return Promise.resolve(null);
    }
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
    if (state.performanceModeActive === true) {
      fail('fader audio', 'Edit mode required — Performance never changes audio bindings');
      return Promise.resolve(null);
    }
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
    if (state.performanceModeActive === true) {
      fail('fader audio', 'Edit mode required — Performance never changes audio bindings');
      return;
    }
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
      /* DECLUTTER (docs/65 §4.1): the "<type> · out" line no longer renders -
         the trace shape and the accent colour already say it - but the same
         text stays discoverable as the card's title tooltip. */
      /* The card shows the OPERATOR name (`lab`: "LOW", "DOM1 FREQ"), not the
         engine key. docs/70 F7/D13: the premium top strip was printing raw
         analysis identifiers — `micDomFreq1` — which mean nothing mid-show on
         a dark playa. `lab` has been carried in METER_BARS all along and was
         dead code; this is the honesty fix, not a new vocabulary. The engine
         key stays reachable in the tooltip for anyone debugging. */
      el.title = b.key + ' — ' + b.type + ' · out';
      el.innerHTML = '<span class="sig-name">' + b.lab + '</span>'
        + '<span class="sig-val">--</span>'
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
      /* HIDDEN (docs/65 §4.2): while docked the strip is display:none, so
         its nine canvases are invisible - skip the redraw entirely rather
         than paint a layer nobody can see. Semantics above (BPM/note/liveness
         events) still run every message regardless of dock state. */
      if (p && !(strip && strip.classList.contains('is-docked'))) drawMeterTraces(p);
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
      /* Units, not bare numbers (docs/70 F7/D13 — presentation only, the
         maths above is untouched). A frequency card printing "5733" reads as
         a build number; "5733 Hz" reads as a measurement. Intensity cards are
         genuinely unitless 0-1 normals, so they keep the bare 2-decimal form
         rather than gaining a fake unit. */
      var txt = has
        ? (METER_LOG[b.key]
            ? String(Math.round(raw)) + (b.type === 'frequency' ? ' Hz' : '')
            : raw.toFixed(2))
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
    resetOverlayTransitionDriver();
    /* An open passcode prompt belongs to an ARM that no longer exists. Close it
       and wipe the box: it resolves as a cancel, so no request is retried. */
    closeTakeoverPrompt();
    armChainTarget = false;
    armAckPending = false;
    disarmAckPending = false;
    armLeaseRequested = false;
    armLeaseAcquired = false;
    if (typeof clearTransientSpatialContacts === 'function') {
      clearTransientSpatialContacts('force-disarm', false);
    }
    if (window.SpatialContactNotice) window.SpatialContactNotice.cleanup();
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
    var url = ENGINE_WS + '/ws/control';
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
      /* Reconnect renews a lease the engine still proves this panel owns. The
         Timeline may have yielded an otherwise-armed Live session to Deck;
         rebinding the socket must preserve that session without putting Live
         back on air until the operator makes a real mutation. */
      if (state.armed) {
        req('GET', '/layers/state').then(requireLayerState).then(function (layerState) {
          var held = layerState.liveTouch && layerState.liveTouch.armed
            && layerState.liveTouch.ownerId === OWNER;
          if (!held) {
            forceDisarmedUi();
            fail('arm', 'the engine no longer reports this panel as the Live Touch owner; re-arm');
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
      if (m.type === 'performanceMode') {
        try { acceptPerformanceModeState(m.active); }
        catch (error) { fail('performance mode', error); }
      } else if (m.type === 'layerSettings') {
        try { acceptPatternLayerState(requireLayerState(m)); }
        catch (error) { fail('layer settings', error); }
      } else if (m.type === 'touchControlArmedAck') {
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
          publishTouchTransportState();
          clearError();
        } else if (m.requestedArmed === false && m.armed === false) {
          state.sessionRevision = null;
          armLeaseRequested = false;
          armLeaseAcquired = false;
          disarmAckPending = false;
          publishTouchTransportState();
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
      } else if (m.type === 'liveTouchForceDisarm') {
        /* TIMELINE PRIORITY (operator ruling 2026-08-14). The show plan took
           the rig back — RESUME was pressed, or the timeline's operator lease
           expired — and the engine force-disarmed this desk to do it. The
           timeline outranks an ARM, so there is nothing to negotiate: drop out
           of armed mode deliberately and say why, rather than letting the
           operator discover it through a 409 on the next control write.

           NEVER AUTO-RE-ARM. forceDisarmedUi() clears state.armed, which is
           exactly what the reconnect handler checks before re-asserting an ARM
           — so a force-disarmed panel stays disarmed until a human presses ARM
           again. That is the point of the ruling: the plan is running now. */
        if (m.ownerId && m.ownerId !== OWNER) return;
        if (state.phase !== 'idle') {
          armLeaseRequested = false;
          armLeaseAcquired = false;
          disarmAckPending = false;
          forceDisarmedUi();
          fail('arm', 'TIMELINE RESUMED — the show plan took the rig back' +
            (m.why ? ' (' + m.why + ')' : '') +
            '. This panel is disarmed; press ARM to take control again.');
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
      } else if (m.type === 'liveTouchPresets') {
        /* docs/70 W4 (item 3, presets playlist): pure passthrough. The
           engine's live_touch_presets store is opaque and server-
           authoritative — this file does not interpret it, it just hands
           the broadcast (replay-on-connect, plus every create/rename/
           reorder/delete) to the page over the ONE /ws/control socket this
           file already owns, rather than the page opening a second one. */
        document.dispatchEvent(new CustomEvent('liveTouchPresets', { detail: m }));
      } else if (m.type === 'colorAutopilot') {
        /* docs/70 W3 (item 2b, deck colour daemon as the main Live colour
           surface): pure passthrough, same idiom as liveTouchPresets above —
           this is the ONE /ws/control socket the file already owns, replayed
           on connect by the engine (api_server.js wssControl 'connection'
           handler) so a late-joining panel sees the current config
           immediately, not just future changes. The page's COLOR HUB panel
           owns everything about interpreting this payload. */
        if (m.mode === 'followNote') resetOverlayTransitionDriver();
        else handleColorTransitionBroadcast(m.colorTransition);
        document.dispatchEvent(new CustomEvent('colorautopilot', { detail: m }));
      }
    });
    ws.addEventListener('close', function () {
      if (controlWs === ws) controlWs = null;
      setTimeout(openControlSocket, 2000);
    });
    ws.addEventListener('error', function () { /* close handles the retry */ });
  }
  openControlSocket();

  /* ── COLOR HUB write path (docs/70 W3) ───────────────────────────────────
     The route is Deck-level, but the global HTTP lease guard still protects
     EVERY mutating route while Live Touch is armed. Therefore an armed Color
     Hub write must carry this surface's owner header; an idle page must remain
     unowned because no lease exists to authenticate it. Do not use req() here:
     a colour tap during the atomic ARM prepare must never splice a Deck daemon
     operation into the private Live prepare transaction. */
  function colorHubRequest(method, path, body) {
    if (state.phase === 'armed') return requestJson(method, path, body, true);
    if (state.phase === 'arming' || state.phase === 'disarming') {
      return Promise.reject(new Error('finish the ARM transition before changing Color Hub'));
    }
    return unownedReq(method, path, body);
  }

  document.addEventListener('colorautopilotwrite', function (event) {
    var detail = event.detail || {};
    var request = colorHubRequest(detail.method, detail.path || '/deck/color-autopilot', detail.body);
    detail.promise = request;
    request.then(function (out) {
      document.dispatchEvent(new CustomEvent('colorautopilotwriteok', { detail: { label: detail.label, state: out } }));
    }).catch(function (error) {
      fail('color', error);
      document.dispatchEvent(new CustomEvent('colorautopilotwritefail', {
        detail: { label: detail.label, message: error && error.message ? error.message : String(error) },
      }));
    });
  });

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
    var url = ENGINE_WS + '/ws/signals';
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
      projectAudioPerformanceLock();
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
  fxCatalogPromise = publishFxCatalog()
    .then(function () { return buildAudioBindings(); })
    .catch(function () { /* publishFxCatalog already failed loudly and ARM is gated */ });

  function runBackgroundRefresh() {
    if (document.hidden) return Promise.resolve(null);
    return refresh().then(function (status) {
      /* Do not overlap the refresh batch with effect readback. Serializing
         these removes the request burst that caused otherwise healthy polls
         to cross the six-second transport deadline. */
      if (status && state.armed && !armChainBusy) return reconcileEffects();
      return status;
    });
  }

  var backgroundWasHidden = document.hidden === true;
  setInterval(runBackgroundRefresh, POLL_MS);
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      backgroundWasHidden = true;
      return;
    }
    if (!backgroundWasHidden) return;
    backgroundWasHidden = false;
    runBackgroundRefresh();
  });

  window.__wire = state;   /* for headless verification only */
  /* Read-only owner exposure lets the preset playlist use the same lease
     identity as every other Live mutation. It never creates or renews a lease. */
  state.ownerId = OWNER;
  /* Verification/recovery hook: a catalog request may be retried after an
     explicit transport recovery, but no caller may synthesize catalog truth. */
  state._loadFxCatalog = function () {
    fxCatalogPromise = publishFxCatalog();
    return fxCatalogPromise;
  };
  state._loadBackgroundCatalog = function () {
    var request = populateBackgroundPatternGroup();
    backgroundCatalogPromise = request.catch(function () { return null; });
    return request;
  };
  state._verifyArmReadiness = verifyArmReadiness;
  state._assertLiveSurfaceState = assertLiveSurfaceState;
  state._reconcileEffectsForTest = reconcileEffects;
  state._handleColorTransitionBroadcast = handleColorTransitionBroadcast;
  state._readPublishedFivePalette = readPublishedFivePalette;
  state._refresh = refresh;
  state._preflightPresetRecall = function (pageChecks) {
    if (state.phase !== 'armed') {
      return Promise.reject(new Error('ARM Live Touch before recalling a preset'));
    }
    if (armChainBusy) {
      return Promise.reject(new Error('wait for Live Touch ARM to finish before recalling a preset'));
    }
    if (surfaceHandoffBusy) {
      return Promise.reject(new Error('wait for Live Touch surface handoff to finish before recalling a preset'));
    }
    if (patternChangeInFlight) {
      return Promise.reject(new Error('wait for the current Live Touch base-pattern transition before recalling a preset'));
    }
    if (!fxCatalogReady) {
      return Promise.reject(new Error('wait for the effect catalog to confirm before recalling a preset'));
    }
    if (!backgroundCatalogReady) {
      return Promise.reject(new Error('wait for the background catalog to confirm before recalling a preset'));
    }
    if (!state.engineProtocolReady) {
      return Promise.reject(new Error('Live Touch engine protocol is not ready; preset recall is refused'));
    }
    if (typeof state.ownerId !== 'string' || !state.ownerId) {
      return Promise.reject(new Error('Live Touch lease owner is missing; preset recall is refused'));
    }
    if (pageChecks && typeof pageChecks === 'object') {
      if (pageChecks.storeError) {
        return Promise.reject(new Error('preset store error: ' + pageChecks.storeError));
      }
      if (!pageChecks.storeReady) {
        return Promise.reject(new Error('wait for the preset store to confirm before recalling a preset'));
      }
      if (!pageChecks.fxCatalogReady) {
        return Promise.reject(new Error('wait for the effect catalog to confirm before recalling a preset'));
      }
    }
    /* A manual transition has already reached a terminal UI state. It must
       not become a latent failure for a later, unrelated recall. A recall
       that changes its background installs its own settlement synchronously
       during restoreState and _settlePresetRecall consumes that exact promise. */
    patternSettlementInFlight = null;
    presetEffectIntent = null;
    return Promise.resolve();
  };
  state._assertPresetRecallLease = state._preflightPresetRecall;
  state._stagePresetEffectIntent = function (effects) {
    if (!Array.isArray(effects)) throw new Error('preset effect intent is missing');
    presetEffectIntent = {};
    effects.forEach(function (effect) {
      if (!effect || !Number.isInteger(Number(effect.slot)) || typeof effect.on !== 'boolean') {
        throw new Error('preset effect intent is malformed');
      }
      presetEffectIntent[Number(effect.slot)] = effect.on;
    });
  };
  function settlePerformancePresetEffects(intent) {
    if (!fxGrid) return Promise.reject(new Error('Performance effect surface is unavailable'));
    var desired = {};
    Array.prototype.forEach.call(fxGrid.querySelectorAll('.fx-cell:not([hidden])'), function (cell) {
      var slotId = Number(cell.dataset.slot);
      if (Number.isInteger(slotId) && cellBehavior(cell, slotId) === 'toggle') {
        if (!intent || !Object.prototype.hasOwnProperty.call(intent, slotId)) {
          throw new Error('Performance preset is missing projected toggle slot ' + slotId);
        }
        desired[slotId] = intent[slotId];
      }
    });
    return engineOnSlots().then(function (on) {
      var presses = [];
      Array.prototype.forEach.call(fxGrid.querySelectorAll('.fx-cell:not([hidden])'), function (cell) {
        var slotId = Number(cell.dataset.slot);
        var behavior = cellBehavior(cell, slotId);
        if (!Number.isInteger(slotId) || slotId < 9 || behavior !== 'toggle') return;
        if (!!on[slotId] !== desired[slotId]) {
          presses.push(function () { return strictWrite('POST', '/global-effect-slots/' + slotId + '/press'); });
        }
      });
      return runSeries(presses);
    }).then(function () {
      return publishEffectTruth().then(function (on) {
        var mismatch = Object.keys(desired).some(function (slotId) {
          return !!on[slotId] !== desired[slotId];
        });
        if (mismatch) throw new Error('Performance effect toggle readback did not match the recalled preset');
        return on;
      });
    });
  }
  state._settlePresetRecall = function () {
    var patternSettlement = patternSettlementInFlight;
    var effectIntent = presetEffectIntent;
    patternSettlementInFlight = null;
    presetEffectIntent = null;
    return Promise.resolve(patternSettlement).then(function () {
      /* Reassert every restored write through rejecting transport paths. The
         ordinary UI queues intentionally absorb a failed drag; a preset must
         never report active after one of those mutations was rejected. */
      return pushPalette(true);
    }).then(function () {
      return state.performanceModeActive === true ? null : pushEffectColours(true);
    }).then(function () {
      if (state.performanceModeActive === true) return null;
      lastFxGroups = null;
      return pushEffectGroups(true);
    }).then(function () {
      return applyStatic(true);
    }).then(function () {
      return commitPresetBrightness();
    }).then(function () {
      var spatial = initialSpatialPrepareBody();
      /* The preset's restored ink remains; this is an acknowledged config
         reassertion, not the ARM prepare clear. */
      delete spatial.clear;
      return strictWrite('POST', '/spatial-paint', spatial);
    }).then(function () {
      if (state.performanceModeActive === true) {
        return projectPerformanceEffectSlots().then(function () { return settlePerformancePresetEffects(effectIntent); });
      }
      return buildEffectSlots().then(function () { return reconcileEffects(true); });
    }).then(function () {
      return publishEffectTruth();
    });
  };
  /* The cache-forget the arm chain runs (audit H8) — exposed so a harness can
     exercise the REAL function without seizing the live engine's arm lease by
     clicking the real ARM button. Verification only, like __wire itself. */
  state._forgetSpatialCfg = forgetSpatialCfg;
  state._clearTransientSpatialContacts = function (reason, transmit) {
    if (typeof clearTransientSpatialContacts !== 'function') {
      return Promise.reject(new Error('Live Touch spatial contact owner did not install'));
    }
    return clearTransientSpatialContacts(reason, transmit);
  };
  state._acceptPatternLayerState = acceptPatternLayerState;
  state._acceptPerformanceMode = acceptPerformanceModeState;
  state._refresh = refresh;
  state._liveTouchAvailabilityDetail = liveTouchAvailabilityDetail;
  state._publishLiveTouchAvailability = publishLiveTouchAvailability;
  state._markAvailabilityKnown = markAvailabilityKnown;
  state._verifyPixelViewArmReadiness = verifyPixelViewArmReadiness;
  state._resetPixelViewVerificationForTest = function () {
    chartDriftVerified = false;
    chartDriftInFlight = null;
    chartDriftLastError = null;
  };
  state._initialSpatialPrepareBody = initialSpatialPrepareBody;
  /* Compact stroke-slot bookkeeping (CaptainPad/live_touch readiness W2): verification-only,
     like the hooks above. Lets a harness prove the wire never carries a raw
     pointerId as strokes[].id without seizing the live engine's arm lease. */
  state._spatialPayloadForTest = function () {
    if (typeof spatialPayloadForTest !== 'function') {
      throw new Error('Live Touch spatial contact owner did not install');
    }
    return spatialPayloadForTest();
  };
  state._spatialPointerSlot = function (pointerId) {
    if (typeof spatialPointerSlotForTest !== 'function') {
      throw new Error('Live Touch spatial contact owner did not install');
    }
    return spatialPointerSlotForTest(pointerId);
  };
  /* Separate from theme-ready by design: this fires only after every wire
     listener and the pixel reader's mount call exist. Repeat until CaptainPad
     answers so a dropped WKWebView message cannot permanently block ARM. */
  if (nativePixelEmbed) {
    announceNativePixelVerifierReady();
    nativeVerifierReadyTimer = setInterval(announceNativePixelVerifierReady, 250);
  }
})();
