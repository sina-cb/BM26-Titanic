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

   3. WRITES ARE COALESCED. `POST /control` and `POST /param-center` both call
      saveAllState() on the engine side — an fsync'd YAML write. A raw drag at
      60fps would issue 60 of those per second onto the 40fps render thread.
      Every continuous control goes through send() which keeps only the LATEST
      value per key and flushes on an interval.

   4. CAPABILITY IS CHECKED, NOT ASSUMED, AND FROM THE RIGHT SOURCE.
      The deck channel is `mixer.baseChannelId` === 'ch_base', and it is NOT
      serialised into `mixer.channels` at all — that array holds only the
      OVERLAY channels. An earlier version of this file fell back to
      `channels[0]`, read an overlay running a different pattern, and reported
      the XY pad dead while the deck was in fact running 68_spatial_paint.
      That is exactly the silent fallback the codex forbids. Deck exports now
      come from GET /exports, which the engine documents as "exports of base
      channel", and a missing deck is an ERROR, never a substitute.
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
  /* ARM ENVELOPE. Deliberately NOT the panel's FADE bar: that one is a look
     transition time and is legitimately set to 0 for snap cuts, which would
     give a hard arm cut — exactly the thing this removes. 1500 ms is 60 frames
     at 40 fps, unmistakably a fade, and small next to an arm that already costs
     seven sequential round trips plus its assertions. */
  var ARM_FADE_MS = 1500;
  /* THE NEVER-BLACK FLOOR. The arm envelope dips to THIS, not to zero.
     Operator ruling: "there is never a moment when the ship is black and all
     lights are out." The envelope exists to hide the takeover, and it was
     hiding it by extinguishing the ship for several seconds — on a hull whose
     entire mission is to be visible at night, and in a window where a dropped
     request or a dead tab left it black with nothing to raise it.
     Dimming to a floor hides the takeover nearly as well and can never present
     as a dark ship. The ONLY thing that may take the rig fully black is an
     explicit operator blackout / e-stop; the panel has no such control, so
     nothing here should ever reach 0. */
  var ARM_FADE_FLOOR = 0.12;
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
    online: false,
    channelId: null,
    channelPattern: null,
    exports: {},               /* name -> numeric id */
    sectionIds: {},            /* group name -> sectionId */
    dimmers: {},
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

  function req(method, path, body) {
    var opts = { method: method };
    if (body !== undefined) {
      opts.headers = { 'Content-Type': 'application/json' };
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

  /* Writes are REFUSED while disarmed — that is the safety, not a courtesy. */
  function write(method, path, body) {
    if (!state.armed) return Promise.resolve(null);
    return req(method, path, body).then(function (v) { clearError(); return v; })
      .catch(function (e) { fail('write', e); return null; });
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
  var drawPending = null, drawTimer = null;
  /* IN-FLIGHT BACKPRESSURE (audit medium): the 33 ms flush used to fire
     regardless of whether the PREVIOUS /spatial-paint had answered, so a slow
     link (iPad wifi at the show) accumulated concurrent POSTs — the exact
     write pattern this file documents as having wedged the engine. One draw
     write in flight at a time; last-writer-wins already holds the newest
     sample, so nothing is lost by waiting a beat. */
  var drawInFlight = false;
  function sendDraw(fn) {
    drawPending = fn;
    if (drawTimer) return;
    drawTimer = setInterval(function () {
      if (!drawPending) { clearInterval(drawTimer); drawTimer = null; return; }
      if (drawInFlight) return;              /* the newest sample keeps waiting */
      var f = drawPending; drawPending = null;
      drawInFlight = true;
      var p;
      try { p = f(); } catch (e) { drawInFlight = false; throw e; }
      /* A flush fn returns the write's promise when it has one; anything else
         releases immediately (nothing to wait on). */
      if (p && typeof p.then === 'function') {
        p.then(function () { drawInFlight = false; },
               function () { drawInFlight = false; });
      } else {
        drawInFlight = false;
      }
    }, DRAW_FLUSH_MS);
  }

  /* THE CHART MUST MATCH THE SHIP (audit medium). Every dot on the pad is
     plotted from tables BAKED out of a model export; regenerate the model and
     the chart silently mis-aims — the operator paints one part of the map and
     a different part of the hull lights. No silent wrongness: compare the
     baked group list against the engine's live one at boot, banner loudly on
     any difference. Once, at boot — the model cannot change under a running
     engine without a scene switch, which reboots this page's world anyway. */
  var chartDriftChecked = false;
  function chartDriftCheck() {
    if (chartDriftChecked) return;
    chartDriftChecked = true;
    var baked = window.padChartGroups;
    if (!Array.isArray(baked) || !baked.length) return;   /* page predates the export */
    req('GET', '/group-fixed-colors').then(function (d) {
      var live = (d && d.groups) || [];
      var a = baked.slice().sort().join('|');
      var b = live.slice().sort().join('|');
      if (a !== b) {
        fail('chart', 'THE PAD CHART IS STALE: the engine model has ' + live.length +
          ' groups, the baked chart has ' + baked.length +
          (live.length === baked.length ? ' (names differ)' : '') +
          ' — positions may mis-aim. Regenerate the chart tables (docs/44).');
      }
    }).catch(function () { chartDriftChecked = false; /* retry on the next refresh */ });
  }

  /* ── boot: learn the model and the deck channel ─────────────────────── */
  function refresh() {
    return Promise.all([
      req('GET', '/status'),
      req('GET', '/exports'),
      req('GET', '/dimmer-groups'),
      req('GET', '/dimmers'),
    ]).then(function (r) {
      var status = r[0], exports = r[1], groups = r[2], dimmers = r[3];
      state.online = true;
      state.sectionIds = groups || {};
      state.dimmers = dimmers || {};
      state.channelPattern = status && status.activePattern;

      if (!Array.isArray(exports)) throw new Error('GET /exports did not return a list');
      if (!exports.length) throw new Error('deck has no exports — is a pattern loaded?');
      state.exports = {};
      exports.forEach(function (e) {
        if (e && typeof e.id === 'number') state.exports[e.name] = e.id;
      });
      applyCapability();
      chartDriftCheck();
      loadSlots();
      setStatus();
      return status;
    }).catch(function (e) {
      state.online = false;
      fail('refresh', e);
    });
  }

  /* The XY pad is only real on a pattern that exports the target sliders.
     Saying so beats letting the operator drag a pad that writes nothing —
     which is exactly the failure this check exists to prevent. */
  function applyCapability() {
    /* THE PAD IS ALWAYS CAPABLE NOW — and this used to say the opposite.
       When SPATIAL rode the deck pattern's sliderTargetX/Y, a pattern without
       them genuinely could not be drawn on, so the pad showed a red overlay:
       "XY INACTIVE — deck is running <pattern>, which exports no
       sliderTargetX/Y. Pick 68 · Spatial Paint."
       The stroke is a GLOBAL EFFECT now (POST /spatial-paint, applied after the
       deck and after the group paint), so it works on every pattern and
       survives the autopilot cycling the deck. The warning outlived the
       limitation and became a lie — the worst kind, because it tells the
       operator the feature is dead at exactly the moment it is working, and
       sends them off to load a pattern they no longer need.
       Kept as a function rather than deleted: two call sites depend on it, and
       it still has a job — clearing any stale overlay a cached page left behind. */
    var warn = document.getElementById('padCapWarn');
    if (warn) warn.remove();
  }

  /* ── ARM ────────────────────────────────────────────────────────────── */
  /* ARMING TAKES THE WHOLE SYSTEM. While armed this panel is the only thing
     driving the show, and disarming hands everything back exactly as it was.

     Three things happen, and all three are reversible:

     a) A GLOBAL SOURCE LOCK on the param centre, locked to source 'api'.
        POST /param-center hardcodes source='api', so HTTP keeps working while
        every other writer — the WS clients (CaptainPad), bpm-sync, MIDI, OSC —
        is rejected with reason 'source_lock'. Honest limit: this locks to the
        HTTP CHANNEL, not to this browser tab, so another HTTP client could
        still write. It is exclusivity against the automatic systems, which is
        what "I have the desk now" actually needs to mean.

     b) The AUTOPILOTS are switched off, after their state is captured. They
        change patterns and palettes on a timer; leaving them running would
        mean the panel and the autopilot fighting over the same rig.

     c) Blackout is released. Disarming re-blacks out, so a disarmed panel
        never leaves the rig lit with nothing driving it. */
  var armAsserts = [];          /* run on arm: make the rig match the panel */
  var priorAutopilot = null, priorColorAutopilot = null;
  var priorOverlayFaders = null;   /* overlay channel id -> its fader before we armed */

  /* SILENCE THE OVERLAY LAYERS.
     The mixer can stack extra channels ON TOP of the deck, and the touch panel
     only drives the deck — so an overlay is invisible to this surface and
     unreachable from it. MEASURED: an overlay running 00_golden_hour_wash at
     fader 1.0 in blend_screen was screen-blending its W+A "rich golden white"
     over the deck, so a chosen GREEN arrived on the rig as YELLOW with no
     control on this panel able to explain or stop it.
     While armed the panel owns the look, so overlays are faded out and put back
     exactly as they were on disarm. Their patterns keep running; only their
     contribution is muted, so nothing is lost. */
  function silenceOverlays() {
    return req('GET', '/mixer').then(function (m) {
      priorOverlayFaders = {};
      /* ONE AT A TIME. Concurrent writes to this engine from a browser hang -
         MEASURED: five fired together never returned at all, while the same
         requests one after another each complete. This was the last Promise.all
         left inside takeControl, and takeControl's promise never settling is
         what silently skipped every arm assertion. */
      var ids = (m.channels || []).filter(function (c) {
        if (c.id === m.baseChannelId) return false;     /* the deck is ours to drive */
        priorOverlayFaders[c.id] = c.fader;
        return !!c.fader;
      }).map(function (c) { return c.id; });
      return ids.reduce(function (chain, id) {
        return chain.then(function () {
          return req('PATCH', '/mixer/channels/' + encodeURIComponent(id), { fader: 0 });
        });
      }, Promise.resolve());
    }).catch(function (e) { fail('overlays', e); });
  }

  function restoreOverlays() {
    if (!priorOverlayFaders) return Promise.resolve();
    var jobs = Object.keys(priorOverlayFaders).map(function (id) {
      return req('PATCH', '/mixer/channels/' + encodeURIComponent(id),
                 { fader: priorOverlayFaders[id] }).catch(function () {});
    });
    priorOverlayFaders = null;
    return Promise.all(jobs);
  }

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
  function handbackStep(label, p) {
    return p.catch(function (e) { fail('disarm/' + label, e); return null; });
  }

  /* THE ARM ENVELOPE — one request per leg. The engine owns the ramp, so it
     lands on target even if this panel dies mid-fade; a client-side ramp of
     many writes would both hang (see the concurrency notes above) and strand
     the ship at whatever level it had reached.

     Uses req(), NOT write(): write() refuses while disarmed, and the disarm
     fade has to land. NEVER rejects — a failed fade must not be able to abort
     the arm chain and leave the ship parked dark. */
  function armFadeTo(target, ms) {
    return req('POST', '/arm-fade', { target: target, durationMs: ms })
      .catch(function (e) { fail('arm fade', e); return null; });
  }

  function waitMs(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function takeControl() {
    /* THE DEADMAN MUST EXIST BEFORE ANYTHING TOUCHES THE RIG.
       Declared first: if this panel dies anywhere in the takeover below, the
       engine has to already know it was armed, or nothing recovers the ship. */
    armRefused = false;
    armAckPending = true;
    var declared = sendControl({ type: 'touchControlArmed', ownerId: OWNER, armed: true });
    /* NO SOCKET, NO TAKEOVER (audit H4). sendControl returns false when the
       control socket is down, and this used to be ignored — the panel then
       seized the whole rig with no deadman watching it AND bypassed the
       second-desk refusal, which only arrives over that same socket. Fail
       closed: abort the arm, put the surface back to DISARMED, say why. */
    if (!declared) {
      armAckPending = false;
      forceDisarmedUi();
      fail('arm', 'ABORTED — the control link to the engine is down, so no deadman ' +
        'could watch this panel. Re-arm once the link is back.');
      return Promise.resolve(null);
    }
    /* WAIT FOR THE LEASE TO BE ACKNOWLEDGED BEFORE TOUCHING THE RIG.
       This used to be fire-and-forget: the panel dimmed the ship and began the
       takeover without ever confirming the engine had registered a deadman, so
       a dropped message meant a rig under manual control with nothing watching
       it. It is also where a REFUSAL arrives when another panel holds the desk. */
    return waitForArmAck(1500)
      .then(function () {
        if (armRefused) throw new Error('arm refused by the engine');
        if (armAckPending) {
          /* NO ACK, NO TAKEOVER (audit H4). This used to log "proceeding, but
             nothing is watching this panel" and take the rig anyway — an armed
             desk with no deadman is exactly the unlit-ship failure the whole
             lease exists to prevent. Codex: fail closed. */
          armAckPending = false;
          forceDisarmedUi();
          fail('arm', 'ABORTED — the engine did not acknowledge the deadman lease ' +
            'within 1.5 s. Nothing would be watching this panel; re-arm to retry.');
          return null;
        }
        return takeControlBody();
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

  function takeControlBody() {
    /* FORGET THE "ALREADY SENT" BRUSH CACHE (audit H8). Values chosen while
       DISARMED were committed to spatialCfg by the flush even though write()
       silently refused them, and forgetSpatialCfg only ran on disarm — so
       SIZE/POWER/FADE picked before the first arm never reached the engine.
       Forgetting at arm makes the first stroke re-assert everything the panel
       is showing. */
    forgetSpatialCfg();
    /* LIGHT THE SHIP FIRST — BEFORE the fade-out, not after the takeover.
       This release used to be the LAST link of the sequential chain below, so
       any earlier hang or rejection (all swallowed by the chain's single
       .catch) meant it never ran, while the post-race chain went on to fade the
       envelope back up over a still-blacked-out ship: black hull, panel reading
       ARMED, and a healthy deadman that will never fire because the panel is
       alive, just wrong. Disarm no longer blacks out, but ANY other surface or
       a stale persisted state can have left blackout engaged, so arming
       asserts it off up front and again before the fade-up.
       The engine states this rule for itself in revertToAutomaticShow:
       "lighting the ship comes FIRST and is never gated on anything below it."
       takeControl now obeys the same rule. */
    return req('POST', '/global-blackout', { state: false })
      .catch(function (e) { fail('arm (blackout release)', e); })
      /* FADE DOWN TO THE FLOOR, NOT TO BLACK. Every step below is a hard visual
         cut on a lit ship — the source lock, both autopilots dying, disable-all
         and the overlay faders snapping to zero. At the floor they are muted
         rather than hidden, and the ship is never extinguished to achieve it. */
      .then(function () { return armFadeTo(ARM_FADE_FLOOR, ARM_FADE_MS); })
      .then(function () { return waitMs(ARM_FADE_MS); })
      .then(function () {
        return Promise.all([req('GET', '/autopilot'), req('GET', '/deck/color-autopilot'),
          req('GET', '/param-center')]);
      })
      .then(function (r) {
        priorAutopilot = r[0];
        priorColorAutopilot = r[1];
        /* BREAK THE RATCHET AT ITS ORIGIN.
           These captures are what disarm restores. The trap: arming turns both
           autopilots OFF, so if a panel dies while armed, the NEXT arm captures
           that OFF as the "prior" state and disarm faithfully restores it. The
           automatic show can then never come back on its own, and every
           subsequent cycle re-confirms it. Measured live: source lock still
           per-param/api, autopilot.active false, no panel open.

           A SOURCE LOCK ALREADY PRESENT AT ARM TIME IS THE FINGERPRINT of a
           previous arm that never released — takeControl is the only thing that
           sets one and releaseControl always clears it. So the autopilot state
           we are reading is not the operator's choice, it is wreckage. Do not
           trust it: record the AUTOMATIC SHOW as what to hand back.

           Deliberately narrow: with no stale lock the captures are used exactly
           as before, so a genuine "I turned the autopilot off first" is still
           honoured. */
        var pcState = r[2];
        var staleLock = pcState && pcState.sourceLock
          && pcState.sourceLock.mode && pcState.sourceLock.mode !== 'open';
        if (staleLock) {
          fail('arm', 'a source lock was already held when arming — a previous panel died while ' +
            'armed. Ignoring the autopilot state it left behind; disarm will hand back the ' +
            'automatic show.');
          priorAutopilot = { active: true };
          priorColorAutopilot = { active: true };
        }
        /* ONE AT A TIME, not Promise.all. MEASURED: fired concurrently, all
           five of these POSTs hung with no response and takeControl's promise
           never settled - so every assertion after it (the master, the fade,
           the palette) silently never ran, with no error anywhere. A lone POST
           from the same page completes fine, so it is the burst that does it.
           Arming is a once-per-show action; doing it in order costs nothing
           and it actually finishes. */
        return req('POST', '/param-center/source-lock', {
          mode: 'per-param',
          leases: {
            colorPalette1: 'api', colorPalette2: 'api',
            colorTransitionMs: 'api', motionTransitionMs: 'api',
            rotate: 'api', speed: 'api',
          },
        })
          .then(function () { return req('POST', '/autopilot', { active: false }); })
          .then(function () { return req('POST', '/deck/color-autopilot', { active: false }); })
          /* START FROM SILENCE: slots persist their enabled state and the
             VSN1 / Deck can latch their own, so arming clears everything and
             reconcileEffects then turns on exactly what the grid shows. */
          .then(function () { return req('POST', '/global-effects/disable-all', {}); })
          /* AND THE AUDIO BINDINGS (audit medium). They were cleared at DISARM
             but not at ARM, so bindings left by a previous session — or by
             CaptainPad — kept pulsing groups to the music UNDER the armed
             panel. Arming means "the rig does what this surface shows", and
             this surface shows no bindings until the operator makes some. */
          .then(function () { return req('POST', '/audio-bindings/clear', {}); })
          .then(function () { return silenceOverlays(); });
          /* The blackout release used to sit HERE, at the end of the chain, and
             that was the bug: it is the one step that must not be gated on the
             five before it. It now runs before the fade-out (see the top of
             takeControl) and is re-asserted before the fade-up. */
      })
      .then(function () { clearError(); })
      .catch(function (e) { fail('take control', e); });
  }

  function releaseControl() {
    /* FADE OUT FIRST, for the same reason arming does. One step covers every
       abrupt disarm change at once: the audio bindings clearing, the parked
       groups releasing, the overlay faders jumping back, the burst of 24 group
       paint DELETEs, and disable-all. */
    return armFadeTo(ARM_FADE_FLOOR, ARM_FADE_MS)
      .then(function () { return waitMs(ARM_FADE_MS); })
      .then(function () { return releaseControlBody(); });
  }

  function releaseControlBody() {
    /* Give the system back BEFORE blacking out, so nothing is left locked if
       the blackout call is the one that fails. */
    return Promise.all([
      /* AUDIO BINDINGS ARE PART OF BEING ARMED. They live on the engine and it
         applies them every frame, so a binding left behind kept the groups
         pulsing to the music long after the panel was disarmed - the rig
         moving with nobody driving it. Clearing them here means a disarmed
         panel does exactly nothing, which is what disarmed has to mean. */
      handbackStep('audio-bindings', req('POST', '/audio-bindings/clear', {})),
      /* THE EFFECT SCOPE IS PART OF BEING ARMED, for the same reason the audio
         bindings are. It lives on the engine, so a scope left behind by a
         disarmed panel would silently confine the VSN1's and the Deck's effects
         to whatever this panel last had marked - the rig obeying a surface
         nobody is driving. Disarmed means unrestricted. */
      handbackStep('effect-groups', req('PUT', '/effect-groups', { groups: null })),
      /* Locks are part of being armed too - a park left behind by a disarmed
         panel would keep a group lit through the master with nobody driving. */
      handbackStep('parked-groups', req('PUT', '/parked-groups', { groups: null })),
      handbackStep('source-lock', req('POST', '/param-center/source-lock', { mode: 'open' })),
      /* THE RATCHET. These captures live only as long as the PAGE. Arming turns
         both autopilots off; if the panel is reloaded or dies before disarm,
         the capture is gone and this used to send NOTHING — the automatic show
         stayed off with nobody driving. Worse, the next arm then captured that
         "off" as the prior state and faithfully restored off, so the show could
         never come back on its own. Measured live: sourceLock still per-param
         /api with autopilot.active false and no panel open.

         With no capture we now assert the AUTOMATIC SHOW rather than staying
         silent. The operator asked for exactly this ("if the system crashes
         revert to the default automatic playlist"), so it is a requested
         fallback, not an invented one — and it says so out loud. A capture we
         DO hold is still restored faithfully, so a deliberate autopilot-off is
         respected within a single page session. */
      handbackStep('autopilot', priorAutopilot
        ? req('POST', '/autopilot', { active: !!priorAutopilot.active })
        : req('POST', '/autopilot', { active: true }).then(function () {
            fail('disarm', 'no pre-arm autopilot state was captured (panel reloaded while armed) — ' +
              'asserting the automatic show ON rather than leaving the ship with nobody driving');
          })),
      handbackStep('color-autopilot', priorColorAutopilot
        ? req('POST', '/deck/color-autopilot', { active: !!priorColorAutopilot.active })
        : req('POST', '/deck/color-autopilot', { active: true })),
    ]).then(function () {
      return restoreOverlays();
    }).then(function () {
      /* DROP THE SPATIAL STROKE. It is a global effect, so unlike the pattern's
         own sliders it keeps running after this panel lets go — a stroke burned
         into the hull with nobody driving. Cleared, not just lifted, so the heat
         goes with it. req() so it lands even though we are disarming. */
      req('POST', '/spatial-paint', { enabled: false, touch: false, clear: true })
        .catch(function (e) { fail('disarm/spatial-clear', e); });
      /* STOP THE XY STROBE AND WALK (audit H5). They run under presetId
         'xy_pad' with no slot, so the disable-all below cannot see them —
         disarming mid-strobe used to hand the automatic show back permanently
         strobing. handbackStep so one failure cannot cancel the chain. */
      handbackStep('xy-strobe', req('POST', '/strobe-rate', { active: false }));
      handbackStep('xy-walk', req('POST', '/movement-rate', { active: false }));
      forgetSpatialCfg();   /* the engine no longer holds what we cached */
      /* Drop every painted group — the paint only exists because we armed. */
      var names = Object.keys(painted);
      names.forEach(function (nm) { delete painted[nm]; });
      return Promise.all(names.map(function (nm) {
        return req('DELETE', '/group-fixed-colors/' + encodeURIComponent(nm)).catch(function () {});
      }));
    }).then(function () {
      /* Stop everything this panel started. Effects only run because the panel
         is armed, so releasing control must not leave them playing. */
      return handbackStep('disable-all', req('POST', '/global-effects/disable-all', {}));
    }).then(function () {
      /* Give the effect presets their own colours back before letting go. */
      return handbackStep('effect-colours', restoreEffectColours());
    }).then(function () {
      /* DISARM HANDS THE SHIP BACK LIT. IT DOES NOT BLACK IT OUT.
         This used to be POST /global-blackout {state:true} — a clean disarm
         left the hull dark with nothing watching it, while the DEADMAN, facing
         the very same situation (this panel no longer driving), handed the deck
         back to the automatic show. A dead panel therefore produced a better
         outcome than a deliberate disarm, which is backwards.
         Operator ruling: the ship is never black as a side effect. The panel
         has no blackout control of its own (grep: zero), so this was not an
         operator command — it was residue from a time when "disarmed" was
         implemented as "off" rather than as "handed back".
         The handback above has already reopened the source lock and restored
         both autopilots, so the deck is under automatic control again; all this
         has to do is guarantee it is VISIBLE. */
      return req('POST', '/global-blackout', { state: false });
    }).then(function () { clearError(); })
      .catch(function (e) { fail('release control', e); })
      /* RESET THE ENVELOPE UNCONDITIONALLY — after the .catch, so it runs on the
         failure path too. Blackout is what holds the rig dark after a disarm;
         armFade must NEVER be the thing holding it dark. Left at 0, the next
         un-blackout from any surface — CaptainPad, the timeline, the crash
         failsafe, /mixer/panic — would produce nothing, and the operator would
         be looking at a black ship with every control reporting it lit. */
      .then(function () { return armFadeTo(1, 0); })
      /* RELEASE THE DEADMAN LAST — after the handback and after the envelope is
         back up. Cancelling it earlier would open a window where this panel is
         still fading the ship out with nothing watching it: die in there and
         the ship stays black forever. Sent even on the failure path (this sits
         after the .catch), because a half-finished disarm that leaves the lease
         standing would revert the rig a few seconds later for no reason. */
      .then(function () {
        sendControl({ type: 'touchControlArmed', ownerId: OWNER, armed: false });
      });
  }

  var armEl = document.getElementById('arm');
  /* ONE CHAIN AT A TIME (audit H12). A double-tap used to run takeControl and
     releaseControl CONCURRENTLY — the second tap flipped the class and started
     the opposite chain while the first was mid-flight, so the handback raced
     the takeover for the same locks. While a chain runs, further taps are
     refused and the button is put back to the direction already in flight. */
  var armChainBusy = false;
  var armChainTarget = false;
  function setArmedUi(t) {
    /* Mirror of forceDisarmedUi, both directions — the page's own handler owns
       these five surfaces, so a refused tap must restore all five. */
    state.armed = t;
    if (armEl) {
      armEl.classList.toggle('is-armed', t);
      armEl.setAttribute('aria-checked', String(t));
    }
    var st = document.getElementById('armState');
    if (st) st.textContent = t ? 'ARMED' : 'DISARMED';
    var lk = document.getElementById('armLock');
    if (lk) lk.textContent = t ? '🔓' : '🔒';
    var sh = document.getElementById('shell');
    if (sh) sh.classList.toggle('disarmed', !t);
    setStatus();
  }
  if (armEl) {
    armEl.addEventListener('click', function () {
      /* Read the class the page's own handler just set, so the wire follows
         the UI rather than keeping a second, drifting copy of the truth. */
      setTimeout(function () {
        if (armChainBusy) {
          setArmedUi(armChainTarget);
          fail('arm', 'an arm/disarm is already in progress — wait for it to finish');
          return;
        }
        armChainBusy = true;
        state.armed = armEl.classList.contains('is-armed');
        armChainTarget = state.armed;
        setStatus();
        /* BOUNDED. takeControl() has been observed never settling, and every
           assertion below hangs off it - so the panel said ARMED and sent
           almost nothing, silently. It now gets a deadline: whatever it has
           managed lands, and after that the panel asserts its visible state
           anyway. A slow or wedged setup step must not mean the rig quietly
           ignores the surface; it means we say so and carry on. */
        var armStep = state.armed ? takeControl() : releaseControl();
        /* Never rejects, so the chain below always continues; failures are
           already reported by fail() inside takeControl/releaseControl. */
        var armSettled = armStep.catch(function () { return null; });
        var armDeadline = new Promise(function (resolve) {
          setTimeout(function () { resolve('timeout'); }, 8000 + ARM_FADE_MS);
        });
        /* THE DEADLINE REPORTS; IT NO LONGER FORKS.
           This used to be a bare Promise.race, which is a RACE, not an abort —
           when the deadline won, everything below (the assertions, applyStatic,
           the fade-up) ran CONCURRENTLY with a takeControl that was still in
           flight. Measured: it fired on every single arm and disarm, so the
           fade-UP could and did overlap the fade-DOWN.
           Now the race only decides WHEN TO WARN. The continuation then waits
           for the real chain to settle, which is finally guaranteed to happen
           because every req() is bounded by REQ_TIMEOUT_MS — the unbounded
           fetch that made a never-settling chain possible is gone. */
        Promise.race([armSettled, armDeadline])
          .then(function (r) {
            if (r === 'timeout') {
              fail('arm', 'setup is taking longer than ' + ((8000 + ARM_FADE_MS) / 1000) +
                's — still waiting for it to finish before asserting the panel state');
              return armSettled;   // do NOT proceed alongside it
            }
            return null;
          })
          /* takeControl() had NO catch, so one failed request inside it
             rejected the whole chain and every assertion below was skipped
             WITHOUT A WORD - which is why the fade bar never reached the
             engine and the audio bindings never landed. Absorb and report,
             then carry on asserting: a partial failure must not silently
             become "armed but nothing was sent". */
          .catch(function (e) { fail('arm', e); })
          .then(function () {
          if (!state.armed) return;
          /* ASSERT THE WHOLE VISIBLE STATE ON ARM.
             Writes are refused while disarmed, so anything set before arming —
             a palette preset, an effect selection — never reached the engine,
             and nothing re-sent it afterwards. The rig then showed a mixture:
             slot 1 from some earlier write, slot 2 stale from a previous
             session, and slots 3-5 still at the PATTERN'S OWN DEFAULTS
             (67_five_colour_stations defaults to hue 0.33 green / 0.55 cyan /
             0.80 magenta) — which is exactly the "colours that don't belong".
             Arming now means "make the rig match this panel". */
          return buildEffectSlots()
            .then(function () { pushPalette(); return pushEffectColours(); })
            .then(function () { return reconcileEffects(); })
            /* ABSORB, DO NOT SWALLOW. Every arm assertion hung off the END of
               this chain, so one rejection anywhere above it skipped ALL of
               them silently - the fade never asserted, the audio bindings
               never asserted, and arming looked like it had worked. MEASURED:
               24 fader controls on screen and 0 bindings on the engine after
               arming. The failure is now reported and the assertions still
               run, because they are what makes the rig match the panel. */
            .catch(function (e) { fail('arm', e); })
            .then(function () {
              armAsserts.forEach(function (fn) {
                try { fn(); } catch (e) { fail('arm assert', e); }
              });
              /* FADE UP ONLY ONCE THE LOOK HAS LANDED. The blackout was
                 released back inside takeControl, but the palette, the effect
                 slots and the group paint are all asserted here, AFTER it —
                 so raising the house any earlier would fade up into a stale
                 look and then visibly correct itself. applyStatic() resolves
                 when its last staggered write has settled, which is the only
                 honest "the ship now shows what the panel shows" signal.

                 Guarded: if the assertions somehow never settle, the ship must
                 not be left dark, so the fade-up also runs on the failure path. */
              return applyStatic()
                .catch(function (e) { fail('arm assert', e); })
                /* RE-ASSERT THE LIT STATE IMMEDIATELY BEFORE RAISING THE HOUSE.
                   The release at the top of takeControl can have been swallowed
                   (its own .catch) or undone by another surface during the
                   seconds the takeover takes. Raising the envelope over an
                   engaged blackout is the exact "black ship reporting ARMED"
                   failure, so the last thing before the fade-up is to make sure
                   there is something to fade up TO. */
                .then(function () {
                  return req('POST', '/global-blackout', { state: false })
                    .catch(function (e) { fail('arm (blackout re-assert)', e); });
                })
                .then(function () { return armFadeTo(1, ARM_FADE_MS); });
            });
        })
          /* The chain is over either way — the next tap may start a new one.
             Both paths, because a rejection anywhere above must not leave the
             button permanently refused (audit H12). */
          .then(function () { armChainBusy = false; },
                function () { armChainBusy = false; });
      }, 0);
    });
  }

  /* Releasing on unload matters more than usual here: a closed tab that still
     held the source lock would leave the autopilots frozen out with nothing
     driving the rig. */
  window.addEventListener('pagehide', function () {
    if (!state.armed) return;
    /* RAISE THE HOUSE BEFORE ANYTHING ELSE. The envelope is held at 0 for the
       whole of arming and disarming, so a tab that dies inside either window
       would leave the ship BLACK with no panel left to raise it — a strictly
       worse failure than the frozen-but-lit one this handler was written for.
       Sent first, and snapped rather than ramped, because the page is being
       torn down and only keepalive requests survive. */
    fetch(ENGINE + '/arm-fade', { method: 'POST', keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: 1, durationMs: 0 }) }).catch(function () {});
    fetch(ENGINE + '/param-center/source-lock', { method: 'POST', keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'open' }) }).catch(function () {});
    /* And drop the audio bindings. Closing the tab while armed used to leave
       them on the engine, which applies them every frame - the rig would go on
       pulsing to the music with no panel open at all. keepalive so the request
       still goes out as the page is torn down. */
    fetch(ENGINE + '/audio-bindings/clear', { method: 'POST', keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: '{}' }).catch(function () {});
    /* Stop the XY strobe/walk too (audit H5): they are slot-less, so no sweep
       will catch them, and a tab closed mid-strobe left the ship strobing.
       The engine's deadman revert now also clears them, but that takes the
       close-grace window — these keepalive posts stop it immediately. */
    fetch(ENGINE + '/strobe-rate', { method: 'POST', keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: false }) }).catch(function () {});
    fetch(ENGINE + '/movement-rate', { method: 'POST', keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: false }) }).catch(function () {});
  });
  /* THE BFCACHE TWIN (audit low). pagehide above dropped the source lock and
     raised the house — but Safari can RESTORE the page from the back/forward
     cache with all its JS state intact, so a restored panel resumed believing
     it was armed while its exclusivity was gone. A restore is a fresh start:
     force DISARMED and let the operator re-arm deliberately. */
  window.addEventListener('pageshow', function (ev) {
    if (ev.persisted && state.armed) {
      forceDisarmedUi();
      fail('arm', 'this page came back from the browser cache — its takeover was ' +
        'released when it was hidden. Re-arm to take control.');
    }
  });

  /* ── PATTERN ────────────────────────────────────────────────────────── */
  var PATTERN_FILES = {
    '68': '68_spatial_paint',
    '66': '66_five_colour_prism',
    '67': '67_five_colour_stations',
  };
  var patSel = document.getElementById('patternSel');
  if (patSel) {
    patSel.addEventListener('change', function () {
      var name = PATTERN_FILES[patSel.value];
      if (!name) return fail('pattern', 'no file mapped for ' + patSel.value);
      write('PUT', '/pattern', { pattern: name }).then(refresh);
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

  function pushPalette() {
    if (!slotsEl) return;
    var pal;
    try { pal = JSON.parse(slotsEl.dataset.palette || '[]'); }
    catch (e) { return fail('palette', 'unreadable palette: ' + e.message); }
    if (!pal.length) return;

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
        send('hue' + n, function () { write('POST', '/control', { id: hueId, v0: c.h }); });
      }
      if (valId !== undefined) {
        send('val' + n, function () { write('POST', '/control', { id: valId, v0: c.v }); });
      }
    });
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
  function pushEffectColours() {
    if (!state.armed || !fxGrid) return Promise.resolve();
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
      jobs.push(write('PATCH', '/global-effect-slots/' + id, { paramsOverride: merged }));
    });
    return Promise.all(jobs).catch(function (e) { fail('effect colour', e); });
  }

  function restoreEffectColours() {
    var jobs = [];
    Object.keys(presetOverride).forEach(function (id) {
      if (Number(id) < OURS_FROM) return;
      var orig = presetOverride[id];
      if (JSON.stringify(orig) === JSON.stringify(liveOverride[id] || {})) return;
      liveOverride[id] = JSON.parse(JSON.stringify(orig));
      /* Sending the ORIGINAL object back clears the colour key entirely, so the
         preset's own colour applies again rather than a stored copy of it. */
      jobs.push(req('PATCH', '/global-effect-slots/' + id, { paramsOverride: orig })
        .catch(function () {}));
    });
    return Promise.all(jobs);
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

       SPATIAL MODE  x/y -> sliderTargetX / sliderTargetY. Paint where you
                     touch, in the ship's own coordinates. Needs a pattern that
                     exports the target sliders (the banner says when it does
                     not).
       XY MODE       x -> the grand master, floored at XY_MASTER_FLOOR
                          (PATCH /mixer master) — dim at the far left, never 0
                     y -> strobe rate or group walk, per the Y AXIS buttons
                     Coordinate-blind, works on ANY pattern. */
  var xyPad = document.getElementById('xyPad');
  var modeToggle = document.getElementById('modeToggle');

  function spatialMode() {
    if (!modeToggle) return true;
    var btns = modeToggle.querySelectorAll('button');
    return !!(btns[1] && btns[1].classList.contains('is-active'));
  }

  /* ── WHAT DRAWING DOES ──────────────────────────────────────────────────
     Mode, fade and colour are STROKE STATE, not per-sample data, so they are
     asserted on change rather than on every pointer move.

     These used to write the PATTERN's sliders (68_spatial_paint) and nothing
     else, which made them dead on all 200+ other patterns — DRAW mode even
     told the operator to "load 68_spatial_paint". The stroke is now a global
     effect, so they drive that; the pattern's own sliders are still written
     when that pattern happens to be on the deck, because its pool is richer
     and there is no reason to lose it. */
  var DRAW_MODES = ['pool', 'trail', 'erase', 'ignite'];
  var spatialCfg = {
    mode: null, fade: null, color: null, colorAlt: null,
    radius: null, radiusY: null, amount: null,
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
  var POWER_MAX = 2;
  function brushAmount() {
    var el = document.getElementById('brushPower');
    var v = el && el.dataset.value !== undefined ? parseFloat(el.dataset.value) : 0.45;
    if (!isFinite(v)) v = 0.45;
    /* The slider's full travel is 0..POWER_MAX, so the top half of the control
       is OVERDRIVE — past 100% the coverage is already total and the extra
       drives the colour itself. Floored so the control is never a no-op. */
    return Math.min(Math.max(v * POWER_MAX, 0.05), POWER_MAX);
  }

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
     true circle. The fallback is only for a page too old to expose it. */
  function padBrush() {
    if (typeof window.padBrushWorld === 'function') {
      var r = window.padBrushWorld();
      if (r && isFinite(r.x) && r.x > 0 && isFinite(r.y) && r.y > 0) return r;
    }
    return { x: 0.15, y: 0.15 };
  }
  function brushRadius()  { return Math.min(1, padBrush().x); }
  function brushRadiusY() { return Math.min(2, padBrush().y); }

  var POWER_MAX = 2;
  function brushAmount() {
    var el = document.getElementById('brushPower');
    var v = el && el.dataset.value !== undefined ? parseFloat(el.dataset.value) : 0.45;
    if (!isFinite(v)) v = 0.45;
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

  /* Re-assert on the next stroke after a disarm: releaseControl clears the
     effect, so the cached values no longer match the engine. */
  function forgetSpatialCfg() {
    /* EVERY key, not three. It used to drop only mode/fade/colour, leaving
       radius/radiusY/amount cached as "already sent" across a disarm — so after
       re-arming, the engine had its defaults and the panel believed it had
       already told it otherwise. */
    spatialCfg = { mode: null, fade: null, color: null, colorAlt: null,
                   radius: null, radiusY: null, amount: null };
    spatialPatch = null;
  }

  document.addEventListener('drawmode', function (ev) {
    var v = Math.min(Math.max(Number(ev.detail.value) || 0, 0), 1);
    assertSpatial({ mode: DRAW_MODES[Math.round(v * 3)] });
    /* Extra, not instead: only 68_spatial_paint has this slider. */
    var id = state.exports.sliderDrawMode;
    if (id === undefined) return;
    send('drawMode', function () { write('POST', '/control', { id: id, v0: ev.detail.value }); });
  });

  var brushSizeEl = document.getElementById('brushSize');
  if (brushSizeEl) {
    brushSizeEl.addEventListener('sliderchange', function () {
      assertSpatial({ radius: brushRadius(), radiusY: brushRadiusY() });
    });
  }

  var brushPowerEl = document.getElementById('brushPower');
  if (brushPowerEl) {
    brushPowerEl.addEventListener('sliderchange', function () {
      assertSpatial({ amount: brushAmount() });
    });
  }

  var trailFadeEl = document.getElementById('trailFade');
  if (trailFadeEl) {
    trailFadeEl.addEventListener('sliderchange', function (ev) {
      var v = Math.min(Math.max(Number(ev.detail.value) || 0, 0), 1);
      assertSpatial({ fade: v });
      var id = state.exports.sliderTrailFade;
      if (id === undefined) return;
      send('trailFade', function () { write('POST', '/control', { id: id, v0: ev.detail.value }); });
    });
  }

  /* The group-paint interim that used to live here is GONE: the stroke is now
     per-pixel via POST /spatial-paint (a global effect), which is what the
     operator asked for. Group paint was pattern-agnostic but only 24-way. */

  if (xyPad) {
    var lastSpatial = null;      /* newest world point the pad produced */
    var pushXY = function (e) {
      var r = xyPad.getBoundingClientRect();
      var x = Math.min(Math.max((e.clientX - r.left) / r.width, 0), 1);
      var y = Math.min(Math.max((e.clientY - r.top) / r.height, 0), 1);

      if (spatialMode()) {
        /* PER-PIXEL, ON EVERY PATTERN.
           The stroke is a GLOBAL EFFECT (POST /spatial-paint), so it runs on the
           composed buffer after whatever the deck is doing — no pattern needs to
           cooperate and the autopilot cycling the deck cannot kill it. This
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
            assertSpatial({ mode: DRAW_MODES[Math.round(dv * 3)] });
          }
          assertSpatial({ radius: brushRadius(), radiusY: brushRadiusY(),
                          amount: brushAmount() });
          lastSpatial = sp;   /* the lift replays it, see pointerup */
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
          sendDraw(function () {
            var body = {
              enabled: true, touch: true, targetX: sp.nx, targetY: sp.nz,
            };
            if (strokeCol) { body.color = strokeCol; body.colorAlt = strokeAlt; }
            return write('POST', '/spatial-paint', body);
          });
        }
        /* The pattern's OWN position sliders are still driven when the deck
           happens to expose them (68_spatial_paint), so that pattern keeps its
           richer pool on top. Absent everywhere else, which is now harmless. */
        var idX = state.exports.sliderTargetX, idY = state.exports.sliderTargetY;
        if (idX === undefined || idY === undefined) return;
        /* RECTIFY PAD → SHIP. The pad shows the sim's COMPRESSED top-down map,
           but the pattern is fed WORLD nx/nz. Sending the raw pad fraction
           would aim the light at the wrong place on a hull that runs diagonally
           and is 73.6% empty in this plane (docs/44 §2.5) — the operator would
           draw on one part of the map and watch a different part light up.
           The page owns the geometry and exposes the lookup; if it is somehow
           absent we send the raw value rather than nothing, because a slightly
           wrong position still beats a dead pad. */
        var wx = x, wy = 1 - y;
        if (typeof window.padToWorld === 'function') {
          var wpt = window.padToWorld(x, y);
          if (wpt) { wx = wpt.nx; wy = wpt.nz; }
        }
        send('xy', function () {
          write('POST', '/control', { id: idX, v0: wx });
          write('POST', '/control', { id: idY, v0: wy });
          var t = state.exports.sliderTouch;
          if (t !== undefined) write('POST', '/control', { id: t, v0: 1 });
        });
      } else {
        /* XY MODE = BRIGHTNESS x STROBE SPEED (operator ruling). Y used to drive
           the pattern's rotate, which is a look-tweak rather than a performance
           control — nothing you reach for mid-song.

           X: the grand master, left DIM to right bright — dim, never dark. It
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
        send('xyMaster', function () { write('PATCH', '/mixer', { master: master }); });
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
          } catch (e) { /* no palette yet: the engine keeps its own colours */ }
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
      if (typeof window.inkColour !== 'function') return;
      var c = window.inkColour();
      if (!c) return;
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
        sendDraw(function () {
          var body = { enabled: true, touch: false };
          if (lastSpatial) { body.targetX = lastSpatial.nx; body.targetY = lastSpatial.nz; }
          return write('POST', '/spatial-paint', body);
        });
        return;
      }
      if (!spatialMode()) return;
      var r = xyPad.getBoundingClientRect();
      pushXY({ clientX: r.left + d.u * r.width, clientY: r.top + d.v * r.height });
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

    /* ONE FINGER OWNS THE STROKE, wire side (audit H13). The page pins its own
       listeners; this pins the writes. A second finger's samples used to
       interleave into the drive stream and the engine's brush teleported
       between the two touch points. */
    var wirePointer = null;
    xyPad.addEventListener('pointerdown', function (e) {
      if (wirePointer !== null && e.pointerId !== wirePointer) return;
      wirePointer = e.pointerId;
      pushXY(e);
    });
    xyPad.addEventListener('pointermove', function (e) {
      if (wirePointer !== null && e.pointerId !== wirePointer) return;
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
      if (wirePointer === null) return;
      if (e && e.pointerId !== undefined && e.pointerId !== wirePointer) return;
      wirePointer = null;
      var t = state.exports.sliderTouch;
      if (t !== undefined) send('touch', function () { write('POST', '/control', { id: t, v0: 0 }); });
      /* LIFT THE BRUSH on the global effect too, or it keeps painting the last
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
        if (lastSpatial) { body.targetX = lastSpatial.nx; body.targetY = lastSpatial.nz; }
        return write('POST', '/spatial-paint', body);
      });
    };
    xyPad.addEventListener('pointerup', liftBrush);
    xyPad.addEventListener('pointercancel', liftBrush);
    /* window too: with pointer capture the pad usually gets the up, but a
       cancel delivered after capture is torn down (page visibility change)
       lands on window only — and a missed lift is a painting ghost finger. */
    window.addEventListener('pointerup', liftBrush);
    window.addEventListener('pointercancel', liftBrush);
  }

  /* Switching mode re-labels the axes so the pad never claims the wrong thing. */
  if (modeToggle) {
    modeToggle.addEventListener('click', function () {
      setTimeout(function () {
        var sp = spatialMode();
        var top = document.querySelector('.pad-label.top');
        var bot = document.querySelector('.pad-label.bottom');
        /* DESCENDANT, not child: the axis labels now sit INSIDE the DRAW and
           INK columns that flank the pad, so a '>' here silently matched
           nothing and the axes kept saying DARK/BRIGHT in spatial mode. */
        var lft = document.querySelectorAll('.xy-frame .axis-label')[0];
        var rgt = document.querySelectorAll('.xy-frame .axis-label')[1];
        if (top) top.textContent = sp ? 'Y+ SHIP FORWARD' : 'Y+ STROBE FAST';
        if (bot) bot.textContent = sp ? 'Y− SHIP AFT' : 'Y− STROBE OFF';
        /* STARBOARD IS ON THE LEFT of this chart. The pad's X was mirrored so
           the drawing matches what the operator sees in the sim; the labels
           follow the ship, not the old orientation, because a flipped axis with
           the old words would just move the lie somewhere else. */
        /* "DIM 5%", not "DARK": the axis is floored at XY_MASTER_FLOOR and can
           no longer reach black, so the old word promised something the control
           will not do. A label that lies is worse than no label. */
        if (lft) lft.innerHTML = sp ? '<b>X−</b>STARBOARD' : '<b>X−</b>DIM 5%';
        if (rgt) rgt.innerHTML = sp ? '<b>X+</b>PORT' : '<b>X+</b>BRIGHT';
        applyCapability();
        /* SPATIAL MODE LOADS THE PATTERN IT NEEDS.
           This is why "spatial mode does not work": the pad drives
           68_spatial_paint's OWN sliders (targetX/targetY/touch — the engine has
           no positional parameter of its own), and NOTHING on this surface ever
           put that pattern on the deck. Meanwhile the autopilot changes the deck
           every 90 s, so even after an operator loaded it by hand from the
           PATTERN selector, the mode silently went dead on the next cycle.
           MEASURED: mid-session the deck had drifted to
           summer_camp/53_shadow_eclipse and sliderTargetX was simply absent.
           Switching INTO spatial now loads it if — and only if — the current
           deck pattern cannot do the job, so an operator who already has it
           loaded (or a future pattern that also exports the sliders) is left
           alone. Announced, not silent: changing the deck pattern is a visible
           act and the operator must know the mode did it. */
        /* DELIBERATELY NO PATTERN AUTO-LOAD HERE.
           An earlier version loaded 68_spatial_paint when the deck could not do
           position. That contradicts the operator's requirement that SPATIAL
           work on ALL patterns: hijacking their deck is not "working
           everywhere", it is replacing what they were watching. Drawing now
           paints the touched GROUP, which overrides any pattern, so the mode is
           real regardless — and the per-pixel pool remains an extra that a
           position-capable pattern adds on top. */
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

     Tempo source is a rig-wide routing choice, like the audio bindings, so it
     is written with req() and works while disarmed. */
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
  function pushAllAudioBindings() {
    if (bank) {
      Array.prototype.forEach.call(bank.querySelectorAll('.fader-audio'), function (w) {
        faderAudioWrite(w);
      });
    }
    if (fxGrid) {
      Array.prototype.forEach.call(fxGrid.querySelectorAll('.aud-row'), function (r) {
        audWrite(r);
      });
    }
  }
  armAsserts.push(pushAllAudioBindings);
  /* Re-state the effect scope on ARM. Disarming clears it to unrestricted, so
     without this the FX marks would still be lit on the surface while the
     engine had forgotten them - the panel showing one thing and the rig doing
     another. The dedupe key is reset first or the re-assert would be swallowed
     as "no change". */
  armAsserts.push(function () { lastFxGroups = null; pushEffectGroups(); });
  /* Assert the master on arm too: the fader's position is the operator's
     intent, and arming has to make the rig agree with the panel. */
  armAsserts.push(function () {
    /* Written INLINE rather than through pushMaster(): that lives inside an
       `if (bank)` block further down the file, and depending on its scope from
       here is the kind of subtlety that fails silently. The master is the one
       control that must never be wrong, so this asks nothing of anything. */
    var m = document.querySelector('#groupsGrid .fader-strip.is-master');
    if (!m) return fail('arm master', 'no master strip in the bank');
    var lvl = parseFloat(m.dataset.level);
    if (!isFinite(lvl)) return fail('arm master', 'master fader has no level');
    var pw = m.querySelector('[data-role=power]');
    var v = (pw && !pw.classList.contains('is-on')) ? 0 : lvl / 100;
    /* req(), not write(). EVIDENCE: every assertion that uses req() lands (the
       24 group audio bindings) and every one that uses write() does not - and
       write() is the one that refuses while disarmed. So state.armed is not yet
       true when these run. Arming IS the operator asking for this, so the
       master goes out unconditionally rather than waiting on a flag that is
       still catching up. */
    req('PATCH', '/mixer', { master: v }).catch(function (e) { fail('arm master', e); });
  });

  if (bpmSync) {
    bpmSync.addEventListener('click', function () {
      var next = bpmSync.textContent === 'TAP' ? 'osc' : 'tap';
      req('POST', '/mixer/tempo/source', { source: next })
        .then(paintTempo)
        .catch(function (e) { fail('tempo source', e); });
    });
  }
  refreshTempo();

  /* ── GROUP brightness queue ─────────────────────────────────────────
     `/section-brightness` takes ONE group per call and does a saveGlobals on
     each, so a master drag over 24 linked groups is 24 disk-touching requests
     per tick. MEASURED unbounded: 141 writes/s dragged the engine from 40 fps
     down to ~15 — a visible stutter on the rig, which is exactly the failure a
     grand master must not cause.

     So group writes get their own budgeted queue:
       · a value that has not moved by 1% is not sent at all,
       · at most GROUP_WRITES_PER_TICK go out per 100ms (~40/s), the rest wait
         their turn — pending values are overwritten in place, so nothing
         queues up stale,
       · releasing the fader flushes everything at once, so the final position
         is always exact even if the drag was rate-limited. */
  var GROUP_WRITES_PER_TICK = 4;
  var groupPending = {};       /* sectionId -> brightness not yet sent */
  var groupLastSent = {};
  var groupTimer = null;

  function queueGroup(sId, b) {
    if (groupLastSent[sId] !== undefined && Math.abs(groupLastSent[sId] - b) < 0.01) return;
    groupPending[sId] = b;
    if (groupTimer) return;
    groupTimer = setInterval(function () { flushGroups(false); }, FLUSH_MS);
  }

  function flushGroups(all) {
    var keys = Object.keys(groupPending);
    if (!keys.length) {
      if (groupTimer) { clearInterval(groupTimer); groupTimer = null; }
      return;
    }
    var n = all ? keys.length : Math.min(keys.length, GROUP_WRITES_PER_TICK);
    for (var i = 0; i < n; i++) {
      var sId = keys[i], b = groupPending[sId];
      delete groupPending[sId];
      groupLastSent[sId] = b;
      write('POST', '/section-brightness', { sectionId: Number(sId), brightness: b });
    }
  }

  /* ── GROUP faders → section brightness ──────────────────────────────── */
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
     pattern. Effects are otherwise rig-wide: only group_fixed_color even looks
     at a pixel's group, so without this there is no way to aim one.

     NOTHING MARKED SENDS null - unrestricted, which is the shipped behaviour
     and what an operator who has not singled anything out means. That is a
     documented default, not a guess: the engine also accepts an explicit []
     for "nowhere", and the panel simply never sends it, because a surface where
     un-ticking the last box blacks out every effect would be a trap.

     Only sent when the set actually CHANGES - this rides the same event as the
     paint, which fires on every dot drag. */
  var lastFxGroups = null;
  function pushEffectGroups() {
    var names = groupModes()
      .filter(function (m) { return m && m.fx; })
      .map(function (m) { return m.name; });
    var payload = names.length ? names : null;
    var key = JSON.stringify(payload);
    if (key === lastFxGroups) return;
    lastFxGroups = key;
    /* write(), NOT req(). I first sent this with req() on the grounds that a
       scope is a routing choice like the audio dropdowns. That was wrong, and
       it showed up on the rig: with the panel DISARMED the FX marks still
       landed, so the engine was carrying a scope from a surface that is
       writing nothing else - a disarmed panel silently confining the VSN1's
       and the Deck's effects. Disarmed has to mean disarmed.
       armAsserts re-states the scope on ARM, and releaseControl clears it, so
       nothing is lost by making it obey the same gate as the paint. */
    write('PUT', '/effect-groups', { groups: payload })
      .catch(function (e) { fail('effect groups', e); });
  }

  if (bank) {
    /* THE MASTER FADER IS THE SHIP'S MASTER. It used to be panel-only: it
       scaled the linked group faders in the UI and never spoke to the engine,
       so it governed whichever channels happened to be linked and nothing
       else. It now drives the engine's grand master, which every fixture
       passes through - so it controls all the lights, all the time,
       regardless of what is linked, painted or running. */
    var pushMaster = function (strip) {
      var lvl = parseFloat(strip.dataset.level || '0') / 100;
      var on = strip.querySelector('[data-role=power]');
      var v = (on && !on.classList.contains('is-on')) ? 0 : lvl;
      send('shipMaster', function () { write('PATCH', '/mixer', { master: v }); });
    };

    var pushGroup = function (strip) {
      if (strip.classList.contains('is-master')) return pushMaster(strip);
      var name = strip.querySelector('.fader-name');
      if (!name) return;
      var sId = state.sectionIds[name.textContent];
      if (sId === undefined) return fail('group', 'no sectionId for "' + name.textContent + '"');
      var on = strip.querySelector('[data-role=power]');
      var lvl = parseFloat(strip.dataset.level || '0') / 100;
      queueGroup(sId, (on && !on.classList.contains('is-on')) ? 0 : lvl);
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

  /* ── EFFECTS → global effect SLOTS ─────────────────────────────────
     `POST /global-effect` only accepts the legacy DMX toggles (fogger,
     vintageWhite, blastWhite, uvBlast). Every pixel effect — strobe, colorWash,
     waterlineSweep, dropHit, beatPump… — is SLOT based: the engine holds
     provisioned effectId+presetId pairs and you press the slot.

     MEASURED against the live engine: 17 slots exist and none are free.
     Slots 1-8 belong to the Deck and the VSN1 hardware and are NOT ours to
     press. That leaves slots 9-17, so of the 25 cells on this grid only the
     ones already provisioned there are live. The rest are marked, not faked —
     a cell that cannot reach the rig must never look like one that can. */
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

  function loadSlots() {
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
    }).catch(function (e) { fail('slots', e); });
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
    if (!state.armed) return Promise.resolve();
    var id = Number(cell.dataset.slot);
    if (!(id >= OURS_FROM && id <= MAX_SLOTS)) {
      return Promise.resolve(fail('build', 'button has slot ' + id + ', outside 9..32'));
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
    return write('PATCH', '/global-effect-slots/' + id, body);
  }

  function buildEffectSlots() {
    if (!state.armed || !fxGrid) return Promise.resolve();
    var cells = Array.prototype.slice.call(fxGrid.querySelectorAll('.fx-cell'));
    var mine = {};
    cells.forEach(function (c) { mine[Number(c.dataset.slot)] = true; });
    /* Retire any slot in OUR range that no button owns. Left enabled, a stale
       slot from an earlier layout can still be fired by anything else and shows
       up as an effect the panel never started. */
    var retire = [];
    for (var id = OURS_FROM; id <= MAX_SLOTS; id++) {
      if (!mine[id] && slotBinding[id]) {
        retire.push(write('PATCH', '/global-effect-slots/' + id, { enabled: false }));
      }
    }
    return Promise.all(cells.map(provisionCell).concat(retire)).then(loadSlots);
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

  function reconcileEffects() {
    if (!fxGrid || !state.armed) return Promise.resolve();
    if (rcBusy) { rcAgain = true; return Promise.resolve(); }
    rcBusy = true;
    return engineOnSlots().then(function (on) {
      var want = {};
      Array.prototype.forEach.call(fxGrid.querySelectorAll('.fx-cell'), function (c) {
        var id = Number(c.dataset.slot);
        if (!c.dataset.slot || id < 9) return;
        want[id] = want[id] || c.classList.contains('is-on');
      });
      var now = Date.now();
      var jobs = [];
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
          jobs.push(write('POST', '/global-effect', { effect: key, state: !!want[id] }));
          return;
        }
        jobs.push(write('POST', '/global-effect-slots/' + id + '/press'));
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
      return Promise.all(jobs);
    }).then(function () {
      rcBusy = false;
      if (!rcAgain) return;
      rcAgain = false;
      return reconcileEffects();
    }).catch(function (e) { rcBusy = false; fail('effects', e); });
  }

  if (fxGrid) {
    /* The page fires this whenever a dropdown re-points a button. */
    fxGrid.addEventListener('fxassign', function (e) {
      var cell = e.target.closest('.fx-cell');
      if (!cell) return;
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

  /* ── BRIGHT → grand master ─────────────────────────────────────────── */
  var briSlider = document.querySelector('.slider-vertical.bright');
  if (briSlider) {
    briSlider.addEventListener('sliderchange', function () {
      var v = parseFloat(briSlider.dataset.value);
      if (!isFinite(v)) return;
      send('master', function () { write('PATCH', '/mixer', { master: v }); });
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
       dip   POST /mixer/master/fade {target, durationMs} - the engine's timed
             grand-master fade. Down to black, swap unseen, back up.

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
      write('POST', '/mixer/master/fade', { target: d.target, durationMs: d.ms })
        .catch(function (err) { fail('preset dip', err); });
    }
  });

  if (fadeSlider) {
    var pushFade = function () {
      var v = parseFloat(fadeSlider.dataset.value);
      if (!isFinite(v)) return;
      fadeMs = Math.round(v * FADE_MAX_MS);
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
     getRandomValues is available far more widely; the last branch is a
     capability fallback, not a behavioural one, and still beats a 2-char id. */
  var OWNER = 'touch_control_' + (function () {
    try {
      if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
      if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
        var a = new Uint32Array(4);
        crypto.getRandomValues(a);
        return Array.prototype.map.call(a, function (n) { return n.toString(36); }).join('');
      }
    } catch (e) { /* fall through to the last resort below */ }
    return String(Date.now().toString(36)) + '_' +
      Math.random().toString(36).slice(2, 12) + Math.random().toString(36).slice(2, 12);
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
  function desiredStatic() {
    var out = {};
    if (!state.armed) return out;
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

  /* Resolves when the pending repaint's LAST staggered write has settled. The
     arm fade-up chains off this: it is the only honest signal that the look the
     ship is about to be faded up into has actually landed. */
  var staticDeferred = null;

  /* One staggered write, as a promise that settles when the write does. write()
     absorbs its own rejections, so this can never reject — a failed paint must
     not be able to strand the house faded out. */
  function staggeredWrite(delayMs, fn) {
    return new Promise(function (resolve) {
      setTimeout(function () {
        Promise.resolve(fn()).then(function () { resolve(); }, function () { resolve(); });
      }, delayMs);
    });
  }

  function applyStatic() {
    staticWanted = desiredStatic();
    /* EVERY PATH RETURNS A PROMISE. This used to `return;` when a repaint was
       already pending, and the arm fade-up now chains off it — .then() on
       undefined is a TypeError, which would leave the ship faded out with
       nothing left to raise it. A coalesced call hands back the SAME promise
       the in-flight timer will settle. */
    if (staticTimer) return staticDeferred.promise;
    var resolveStatic;
    staticDeferred = { promise: new Promise(function (r) { resolveStatic = r; }) };
    staticTimer = setTimeout(function () {
      staticTimer = null;
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
            return write('PUT', '/group-fixed-colors/' + encodeURIComponent(name),
              { color: v.color, colors: v.colors || undefined, brightness: 1, ownerId: OWNER });
          }));
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
            return write('DELETE', '/group-fixed-colors/' + encodeURIComponent(name));
          }));
        });
      }
      /* The look has landed only when every staggered write has SETTLED, not
         when the last timer merely fired. Hard-coding a duration here would
         silently break the day someone adds a group. */
      Promise.all(jobs).then(function () { resolveStatic(); });
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

  /* Leaving the page: DELETE each painted group. keepalive lets the request
     outlive the page. If it does not land, the engine's deadman lease releases
     the group within ~12s anyway — which is exactly why the paint is leased.
     No invented endpoint here: this is the same DELETE the checkbox uses. */
  window.addEventListener('pagehide', function () {
    Object.keys(painted).forEach(function (name) {
      fetch(ENGINE + '/group-fixed-colors/' + encodeURIComponent(name),
            { method: 'DELETE', keepalive: true }).catch(function () {});
    });
  });

  /* ── go ─────────────────────────────────────────────────────────────── */
  setStatus();
  refresh();

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

     Binding is a rig-wide routing decision, not a look, so it is written
     whether or not the panel is armed - the same way the audio panel itself
     works. What the binding DOES still only happens while an effect is
     running or a group is lit. */
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

  function audWrite(row) {
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
    req('PUT', path, body).catch(function (e) { fail('audio binding', e); });
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

  function faderAudioWrite(wrap) {
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
    req('PUT', '/audio-bindings/groups/' + encodeURIComponent(wrap.dataset.bid), body)
      .catch(function (e) { fail('fader audio', e); });
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
  function pushParkedGroups() {
    if (!bank) return;
    var names = [];
    Array.prototype.forEach.call(bank.querySelectorAll('.fader-strip.is-locked'), function (st) {
      if (st.classList.contains('is-master')) return;
      var n = st.querySelector('.fader-name');
      if (n) names.push(n.textContent);
    });
    var payload = names.length ? names : null;
    var key = JSON.stringify(payload);
    if (key === lastParked) return;
    lastParked = key;
    write('PUT', '/parked-groups', { groups: payload })
      .catch(function (e) { fail('locked groups', e); });
  }
  armAsserts.push(function () { lastParked = null; pushParkedGroups(); });


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
  var armRefused = false;      /* another panel holds the desk */

  /* Put the SURFACE back to disarmed, not just the wire's flag.
     The panel's arm state lives in the DOM (the class, aria-checked, the label,
     the lock glyph and the shell's dimming), set by the page's own click
     handler. Flipping only state.armed would leave the operator looking at a
     button that says ARMED while the wire refuses every write — the worst of
     both. Mirrors exactly what touch_control.html's handler does. */
  function forceDisarmedUi() {
    state.armed = false;
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

  /* SURFACE AN EXTERNAL BLACKOUT WHILE ARMED (audit medium; operator ruling
     pending — the default is SURFACE, not block). /global-blackout and a
     master fade to 0 are deliberately open to every surface, so another
     client CAN dark the rig under an armed panel — but the panel showing
     ARMED over a black ship with no explanation is the part that must not
     happen. The armed panel's own master never goes below the 5% floor, so
     anything under 4% here was not this surface. */
  setInterval(function () {
    if (!state.armed) return;
    req('GET', '/mixer').then(function (m) {
      if (!m) return;
      var master = (m.master !== undefined) ? m.master : (m.mixer || {}).master;
      if (m.blackout === true) {
        fail('watch', 'BLACKOUT was engaged by ANOTHER surface while this panel is armed — ' +
          'the ship is dark. Disarm+re-arm asserts it off, or use /mixer/panic.');
      } else if (typeof master === 'number' && master < 0.04) {
        fail('watch', 'the grand master was driven to ' + Math.round(master * 100) +
          '% by another surface while this panel is armed');
      }
    }).catch(function () { /* transient — the deadman owns link-loss reporting */ });
  }, 4000);

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
      /* RESYNC, DON'T JUST RE-ASSERT (audit H2). Re-declaring only the lease
         after a reconnect acked a deadman for a panel whose TAKEOVER might be
         gone: after an engine restart or a deadman revert, the source lock is
         open and the autopilot is running — an armed panel over an automatic
         show, each fighting the other. So: confirm the takeover still stands
         (the six-key lease survives an ordinary WS blip); if it does not,
         force DISARMED and tell the operator to re-arm. Deliberately NOT an
         automatic re-takeover: an unattended iPad reconnecting in a pocket
         must not re-seize the rig. */
      if (state.armed) {
        req('GET', '/param-center').then(function (pc) {
          var lock = pc && pc.sourceLock;
          var held = !!(lock && (lock.mode === 'global'
            || (lock.mode === 'per-param' && Object.keys(lock.leases || {}).length > 0)));
          if (!held) {
            forceDisarmedUi();
            fail('arm', 'the engine lost this panel\'s takeover while the link was down ' +
              '(restart or revert) — the automatic show is driving. Re-arm to take control.');
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
        armAckPending = false;
        clearError();
      } else if (m.type === 'armRevert') {
        /* THE ENGINE TOOK THE SHOW BACK (audit H2). Deadman, crash-boot policy
           or lease sweep — whichever fired, the source lock is open and the
           autopilot is driving. This broadcast used to be dropped on the
           floor, so the panel sat there reading ARMED, every control lit, over
           a show it no longer controlled. The panel must never outrank the
           engine's own account of who is driving. */
        if (state.armed) {
          forceDisarmedUi();
          fail('arm', 'the engine REVERTED to the automatic show' +
            (m.why ? ' — ' + m.why : '') + '. This panel is disarmed; re-arm to take control.');
        }
      } else if (m.type === 'touchControlArmedRejected') {
        /* ONE DESK AT A TIME. Another panel already holds the rig, so this one
           must not proceed to take it — two surfaces fighting over one source
           lock is exactly what the refusal exists to prevent. Reported loudly:
           silently staying disarmed would look like a broken ARM button. */
        armAckPending = false;
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

     FAIL LOUD if it cannot be fetched (codex P0): the panel still works from
     its built-in list, but the operator is told the catalog is stale rather
     than quietly getting a short menu. */
  function publishFxCatalog() {
    return req('GET', '/global-effect-library').then(function (lib) {
      if (!lib || !lib.effects) throw new Error('/global-effect-library returned no effects');
      document.dispatchEvent(new CustomEvent('fxcatalog', { detail: { effects: lib.effects } }));
    }).catch(function (e) {
      fail('fx catalog', e);
    });
  }
  publishFxCatalog();

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

  buildAudioBindings();

  setInterval(function () {
    refresh();
    refreshTempo();
    /* Hold the rule while armed: if anything lights an effect from outside
       this panel — the VSN1, the Deck, a restored state — the next tick puts
       the rig back to what the grid shows. Costs one GET when nothing differs. */
    if (state.armed) reconcileEffects();
  }, POLL_MS);

  window.__wire = state;   /* for headless verification only */
  /* The cache-forget the arm chain runs (audit H8) — exposed so a harness can
     exercise the REAL function without seizing the live engine's arm lease by
     clicking the real ARM button. Verification only, like __wire itself. */
  state._forgetSpatialCfg = forgetSpatialCfg;
})();
