/*
  deck_client.js — browser-side DECK CONTROL surface for the pattern gallery's
  /live page. Lets the operator drive the RUNNING engine — load patterns and
  control the deck playlist — from the gallery on a phone over Tailscale.

  Why a proxy (and why this file never talks to the engine directly): the
  gallery page runs in the browser on a different origin than the engine REST
  API, so a direct browser->engine fetch would be blocked by CORS (and we may
  NOT add CORS to the engine). The gallery SERVER is co-located with the engine,
  so every call here goes to the SAME-ORIGIN proxy at /api/engine/<path>, which
  forwards server-side over loopback. See server.mjs (deck-control section).

  Browser built-ins only (fetch, DOM) — no deps, no CDNs. Offline-safe: served
  by the gallery itself.

  ENGINE-OFFLINE UX (codex P0: fail visibly, never fake success): the proxy
  returns {error:'engine not reachable'} with a 502/504 when the engine is down.
  We detect that, disable every deck control, and show "engine offline —
  controls unavailable". We never spin forever and never report a fake success.

  The gallery NEVER drives the engine on its own — only on explicit operator
  action (tap a pattern, pick a playlist, drag the fader, etc.).
*/
(function () {
  'use strict';

  var deckEl = document.getElementById('deck');
  if (!deckEl) return; // /live page without the deck panel — nothing to do.

  var stateEl = document.getElementById('dk-state');
  var feedbackEl = document.getElementById('dk-feedback');
  var offlineEl = document.getElementById('dk-offline');
  var controlsEl = document.getElementById('dk-controls');
  var faderEl = document.getElementById('dk-fader');
  var faderValEl = document.getElementById('dk-fader-val');
  var blackoutEl = document.getElementById('dk-blackout');
  var patternsEl = document.getElementById('dk-patterns');
  var playlistSelEl = document.getElementById('dk-playlist-sel');
  var playlistClearEl = document.getElementById('dk-playlist-clear');
  var playlistNavEl = document.getElementById('dk-playlist-nav');
  var prevEl = document.getElementById('dk-prev');
  var nextEl = document.getElementById('dk-next');
  var autopilotEl = document.getElementById('dk-autopilot');
  var entriesEl = document.getElementById('dk-entries');

  // ── local view of the engine state (refreshed from the engine, never faked).
  var activePattern = null;    // current deck pattern name
  var activePlaylist = null;   // { name, activeEntryId, cursor, autopilot } | null
  var playlistEntries = [];    // entries of the loaded playlist (for next/prev)
  var faderDragging = false;   // suppress polled fader writes mid-drag
  var pollTimer = null;

  // ── proxy fetch helper ──────────────────────────────────────────────────────
  // All engine access goes through the same-origin proxy. A network failure OR
  // the proxy's {error:'engine not reachable'} envelope (502/504) is treated as
  // engine-offline. Returns { ok, status, body } (body parsed JSON or text) or
  // throws ENGINE_OFFLINE for unreachable. We never silently swallow errors.
  var ENGINE_OFFLINE = 'ENGINE_OFFLINE';

  function engine(method, path, payload) {
    var opts = { method: method, headers: {} };
    if (payload !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(payload);
    }
    return fetch('/api/engine' + path, opts).then(function (resp) {
      return resp.text().then(function (text) {
        var body = null;
        if (text) { try { body = JSON.parse(text); } catch (e) { body = text; } }
        // The proxy reports an unreachable engine as 502/504 with this exact
        // error envelope. Treat that as offline regardless of which call it was.
        if ((resp.status === 502 || resp.status === 504) &&
            body && body.error === 'engine not reachable') {
          throw ENGINE_OFFLINE;
        }
        return { ok: resp.ok, status: resp.status, body: body };
      });
    }, function () {
      // Network-level failure reaching the GALLERY itself — treat as offline.
      throw ENGINE_OFFLINE;
    });
  }

  // ── UI state helpers ────────────────────────────────────────────────────────
  function setFeedback(kind, msg) {
    feedbackEl.className = 'dk-feedback ' + kind;
    feedbackEl.textContent = msg || '';
  }

  function setOnline() {
    offlineEl.style.display = 'none';
    controlsEl.style.display = '';
    setDisabled(false);
  }

  function setOffline() {
    offlineEl.style.display = '';
    setDisabled(true);
    stateEl.innerHTML = '<b>offline</b>';
    setFeedback('err', '');
  }

  // Disable/enable every interactive deck control (used on offline).
  function setDisabled(disabled) {
    var inputs = controlsEl.querySelectorAll('button, input, select');
    for (var i = 0; i < inputs.length; i++) inputs[i].disabled = disabled;
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ── render the current state into the header readout ─────────────────────────
  function renderState() {
    var parts = [];
    parts.push('pattern <b>' + esc(activePattern || '—') + '</b>');
    if (activePlaylist && activePlaylist.name) {
      parts.push('playlist <b>' + esc(activePlaylist.name) + '</b>');
    }
    stateEl.innerHTML = parts.join(' · ');
  }

  // ── deck channel (master fader, blackout, active pattern) ───────────────────
  function refreshChannel() {
    return engine('GET', '/deck/channel').then(function (r) {
      if (!r.ok || !r.body || typeof r.body !== 'object') return;
      var ch = r.body.channel || {};
      activePattern = ch.pattern || ch.name || activePattern;
      // Reflect the fader unless the operator is mid-drag (don't fight them).
      if (!faderDragging && typeof ch.fader === 'number') {
        faderEl.value = String(ch.fader);
        faderValEl.textContent = Number(ch.fader).toFixed(2);
      }
      blackoutEl.textContent = r.body.blackout ? 'BLACKOUT' : '';
      // Reflect deck playlist embedded in the channel if present.
      if (ch.playlist !== undefined) syncPlaylist(ch.playlist);
      renderActivePatternChip();
      renderState();
    });
  }

  // ── patterns ────────────────────────────────────────────────────────────────
  function loadPatterns() {
    return engine('GET', '/patterns').then(function (r) {
      if (!r.ok || !Array.isArray(r.body)) {
        patternsEl.innerHTML = '<span class="dk-muted">no patterns</span>';
        return;
      }
      var frag = [];
      for (var i = 0; i < r.body.length; i++) {
        var name = r.body[i];
        frag.push('<button class="dk-chip" data-pattern="' + esc(name) + '">' + esc(name) + '</button>');
      }
      patternsEl.innerHTML = frag.join('') || '<span class="dk-muted">no patterns</span>';
      renderActivePatternChip();
    });
  }

  function renderActivePatternChip() {
    var chips = patternsEl.querySelectorAll('.dk-chip');
    for (var i = 0; i < chips.length; i++) {
      chips[i].classList.toggle('on', chips[i].getAttribute('data-pattern') === activePattern);
    }
  }

  // ── show the deck on the master output ──────────────────────────────────────
  // The engine's `master`/`rig` vis (what /live renders) is a crossfade between
  // the DECK and the MIXER, governed by the engine's viewFader. That fader BOOTS
  // at 1.0 = "mixer view", and the mixer overlay stack is empty on a fresh
  // gallery boot, so master stays BLACK even after a pattern is loaded onto the
  // deck — the loaded pattern lives in the deck buffer, which the master isn't
  // showing. Dropping the view to the deck side (viewFader→0) is what actually
  // surfaces the pattern live. We fire this after every operator action that
  // changes the deck pattern. It is a no-op if the engine is already deck-side,
  // and it NEVER fabricates success — a failed POST is surfaced to the operator.
  function showDeckOnMaster() {
    return engine('POST', '/mixer/view', { view: 'deck' }).then(function (r) {
      if (!r.ok) {
        var msg = (r.body && r.body.error) ? r.body.error : ('HTTP ' + r.status);
        setFeedback('err', 'live view switch failed: ' + msg
          + ' — pattern is on the deck but master may stay dark');
      }
      return r;
    });
  }

  patternsEl.addEventListener('click', function (e) {
    var btn = e.target.closest ? e.target.closest('.dk-chip') : null;
    if (!btn || btn.disabled) return;
    var name = btn.getAttribute('data-pattern');
    setFeedback('', 'loading ' + name + '…');
    engine('POST', '/pattern', { pattern: name }).then(function (r) {
      if (r.ok) {
        activePattern = name;
        renderActivePatternChip();
        renderState();
        setFeedback('ok', 'loaded ' + name);
        // Make the loaded pattern actually visible on the LIVE master output.
        showDeckOnMaster();
        // The deck pattern changed — refresh to pick up the truth.
        refreshChannel();
      } else {
        var msg = (r.body && r.body.error) ? r.body.error : ('HTTP ' + r.status);
        setFeedback('err', 'load failed: ' + msg);
      }
    }).catch(handleOffline);
  });

  // ── master fader (debounced writes while dragging) ──────────────────────────
  var faderWriteTimer = null;
  function scheduleFaderWrite() {
    if (faderWriteTimer) clearTimeout(faderWriteTimer);
    faderWriteTimer = setTimeout(writeFader, 120);
  }
  function writeFader() {
    var v = Number(faderEl.value);
    engine('PATCH', '/deck/channel', { fader: v }).then(function (r) {
      if (!r.ok) {
        var msg = (r.body && r.body.error) ? r.body.error : ('HTTP ' + r.status);
        setFeedback('err', 'fader failed: ' + msg);
      }
    }).catch(handleOffline);
  }
  faderEl.addEventListener('input', function () {
    faderDragging = true;
    faderValEl.textContent = Number(faderEl.value).toFixed(2);
    scheduleFaderWrite();
  });
  faderEl.addEventListener('change', function () {
    faderDragging = false;
    if (faderWriteTimer) { clearTimeout(faderWriteTimer); faderWriteTimer = null; }
    writeFader();
  });

  // ── playlists ───────────────────────────────────────────────────────────────
  function loadPlaylists() {
    return engine('GET', '/playlists').then(function (r) {
      var names = [];
      if (Array.isArray(r.body)) {
        for (var i = 0; i < r.body.length; i++) {
          var it = r.body[i];
          names.push(typeof it === 'string' ? it : (it && it.name));
        }
      }
      var frag = ['<option value="">— pick playlist —</option>'];
      for (var k = 0; k < names.length; k++) {
        if (!names[k]) continue;
        frag.push('<option value="' + esc(names[k]) + '">' + esc(names[k]) + '</option>');
      }
      playlistSelEl.innerHTML = frag.join('');
      if (activePlaylist && activePlaylist.name) playlistSelEl.value = activePlaylist.name;
    });
  }

  function refreshDeckPlaylist() {
    return engine('GET', '/deck/playlist').then(function (r) {
      syncPlaylist(r.ok ? r.body : null);
    });
  }

  // Update local playlist state + UI from a deck-playlist object (or null).
  function syncPlaylist(pl) {
    activePlaylist = (pl && pl.name) ? pl : null;
    if (activePlaylist) {
      if (playlistSelEl.value !== activePlaylist.name) playlistSelEl.value = activePlaylist.name;
      playlistNavEl.style.display = '';
      var ap = activePlaylist.autopilot || {};
      autopilotEl.classList.toggle('on', !!ap.active);
      autopilotEl.textContent = ap.active ? 'Autopilot ✓' : 'Autopilot';
      loadEntries(activePlaylist.name);
    } else {
      playlistNavEl.style.display = 'none';
      entriesEl.innerHTML = '';
      playlistEntries = [];
      if (playlistSelEl.value) playlistSelEl.value = '';
    }
    renderState();
  }

  // Fetch the entry list for next/prev + the tappable entry chips.
  function loadEntries(name) {
    return engine('GET', '/playlists/' + encodeURIComponent(name)).then(function (r) {
      var entries = (r.ok && r.body && Array.isArray(r.body.entries)) ? r.body.entries : [];
      playlistEntries = entries;
      var frag = [];
      for (var i = 0; i < entries.length; i++) {
        var e = entries[i];
        var label = e.label || e.pattern || e.id;
        var on = activePlaylist && e.id === activePlaylist.activeEntryId;
        frag.push('<button class="dk-chip' + (on ? ' on' : '') + '" data-entry="' +
          esc(e.id) + '">' + esc(label) + '</button>');
      }
      entriesEl.innerHTML = frag.join('') || '<span class="dk-muted">no entries</span>';
    });
  }

  playlistSelEl.addEventListener('change', function () {
    var name = playlistSelEl.value;
    if (!name) return;
    setFeedback('', 'loading playlist ' + name + '…');
    engine('POST', '/deck/playlist', { name: name }).then(function (r) {
      if (r.ok) {
        setFeedback('ok', 'loaded playlist ' + name);
        syncPlaylist(r.body && r.body.playlist ? r.body.playlist : { name: name });
        showDeckOnMaster();
        refreshChannel();
      } else {
        var msg = (r.body && r.body.error) ? r.body.error : ('HTTP ' + r.status);
        setFeedback('err', 'playlist failed: ' + msg);
      }
    }).catch(handleOffline);
  });

  playlistClearEl.addEventListener('click', function () {
    setFeedback('', 'clearing playlist…');
    engine('POST', '/deck/playlist', { name: null }).then(function (r) {
      if (r.ok) {
        setFeedback('ok', 'playlist cleared');
        syncPlaylist(null);
        refreshChannel();
      } else {
        var msg = (r.body && r.body.error) ? r.body.error : ('HTTP ' + r.status);
        setFeedback('err', 'clear failed: ' + msg);
      }
    }).catch(handleOffline);
  });

  entriesEl.addEventListener('click', function (e) {
    var btn = e.target.closest ? e.target.closest('.dk-chip') : null;
    if (!btn || btn.disabled) return;
    switchEntry(btn.getAttribute('data-entry'));
  });

  function switchEntry(entryId) {
    if (!entryId) return;
    setFeedback('', 'switching entry…');
    engine('POST', '/deck/playlist/entry', { entryId: entryId }).then(function (r) {
      if (r.ok) {
        if (r.body && r.body.playlist) syncPlaylist(r.body.playlist);
        if (r.body && r.body.pattern) { activePattern = r.body.pattern; renderActivePatternChip(); }
        setFeedback('ok', 'switched entry');
        showDeckOnMaster();
        refreshChannel();
      } else if (r.status === 409) {
        // EBUSY mid-transition: not an error — the tap is intentionally ignored.
        setFeedback('', 'transition in progress — ignored');
      } else {
        var msg = (r.body && r.body.error) ? r.body.error : ('HTTP ' + r.status);
        setFeedback('err', 'entry failed: ' + msg);
      }
    }).catch(handleOffline);
  }

  // Compute next/prev entry id from the loaded entry list + active entry.
  function stepEntry(dir) {
    if (!playlistEntries.length) return;
    var idx = -1;
    if (activePlaylist && activePlaylist.activeEntryId) {
      for (var i = 0; i < playlistEntries.length; i++) {
        if (playlistEntries[i].id === activePlaylist.activeEntryId) { idx = i; break; }
      }
    }
    if (idx === -1) idx = (activePlaylist && typeof activePlaylist.cursor === 'number') ? activePlaylist.cursor : 0;
    var n = playlistEntries.length;
    var next = ((idx + dir) % n + n) % n; // wrap both directions
    switchEntry(playlistEntries[next].id);
  }
  prevEl.addEventListener('click', function () { stepEntry(-1); });
  nextEl.addEventListener('click', function () { stepEntry(1); });

  autopilotEl.addEventListener('click', function () {
    var want = !autopilotEl.classList.contains('on');
    setFeedback('', want ? 'enabling autopilot…' : 'disabling autopilot…');
    engine('POST', '/deck/playlist/autopilot', { active: want }).then(function (r) {
      if (r.ok) {
        var ap = (r.body && r.body.autopilot) ? r.body.autopilot : { active: want };
        autopilotEl.classList.toggle('on', !!ap.active);
        autopilotEl.textContent = ap.active ? 'Autopilot ✓' : 'Autopilot';
        if (activePlaylist) activePlaylist.autopilot = ap;
        setFeedback('ok', ap.active ? 'autopilot on' : 'autopilot off');
      } else {
        var msg = (r.body && r.body.error) ? r.body.error : ('HTTP ' + r.status);
        setFeedback('err', 'autopilot failed: ' + msg);
      }
    }).catch(handleOffline);
  });

  // ── offline handling ────────────────────────────────────────────────────────
  // Any action/refresh that hits ENGINE_OFFLINE flips the panel into the
  // disabled "engine offline" state. A later successful poll flips it back.
  function handleOffline(err) {
    if (err === ENGINE_OFFLINE) {
      setOffline();
      return;
    }
    // A real unexpected error — surface it, don't hide it (codex P0).
    setFeedback('err', String(err && err.message ? err.message : err));
  }

  // ── boot + light poll ───────────────────────────────────────────────────────
  // Initial load pulls the engine state once; then a light 2s poll keeps the
  // readout fresh (and re-enables the panel if the engine comes back). We never
  // ISSUE engine writes from the poll — only reads.
  function refreshAll() {
    return refreshChannel()
      .then(function () { setOnline(); })
      .catch(function (err) {
        if (err === ENGINE_OFFLINE) { setOffline(); return; }
        throw err;
      });
  }

  function startPoll() {
    if (pollTimer) return;
    pollTimer = setInterval(function () {
      if (deckEl && !deckEl.open) return; // panel collapsed — skip the poll.
      refreshChannel()
        .then(function () { if (offlineEl.style.display !== 'none') reInit(); else setOnline(); })
        .catch(function (err) { if (err === ENGINE_OFFLINE) setOffline(); });
    }, 2000);
  }

  // Full (re)initialization of the lists — run on first boot and whenever the
  // engine transitions from offline back to online.
  function reInit() {
    Promise.all([loadPatterns(), loadPlaylists()])
      .then(refreshDeckPlaylist)
      .then(refreshAll)
      .catch(function (err) {
        if (err === ENGINE_OFFLINE) { setOffline(); }
        else setFeedback('err', String(err && err.message ? err.message : err));
      });
  }

  reInit();
  startPoll();
})();
