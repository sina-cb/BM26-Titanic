/*
  live_client.js — browser-side LIVE visualizer for the pattern gallery.

  Connects to the running engine's vis broadcast (ws://<engineHost>/ws/viz),
  decodes the chosen buffer (master | rig), and paints the per-pixel colors
  LIVE using the SAME visual style as the offline clips — the strip + physical
  -map (dot) renderers are factored from make_vis_clip.mjs. The layout (where
  each pixel sits) is computed SERVER-side from the active model and handed to
  us in window.__LIVE__ (see live_layout.mjs); the live WS buffer has no
  coordinates so this model-aware spec is required.

  Browser built-ins only (WebSocket, atob, DOM) — no deps, no CDNs. Offline-
  safe: this file is served by the gallery itself.

  CONNECTION STATE (codex P0: fail visibly, never fake/zero data):
   - connecting → "○ connecting to engine at <host>…"
   - open       → "● connected to engine — <buffer>"
   - closed/err → "✕ engine not reachable at <host>" + cells dimmed, NO frames
*/
(function () {
  'use strict';

  var CFG = window.__LIVE__;
  if (!CFG) {
    document.body.innerHTML = '<p style="color:#f66;padding:2rem;">live config missing</p>';
    return;
  }

  // Engine host: an explicit override (config/?host=) wins; otherwise connect
  // to the SAME host the browser used to reach the gallery, with the engine
  // port. This is what makes /live work from a phone over Tailscale — a
  // hardcoded 127.0.0.1 would be the phone's own localhost, not the engine.
  var host = CFG.host || (location.hostname + ':' + (CFG.enginePort || '6968'));
  var buffer = CFG.buffer;            // 'master' | 'rig'
  var layout = CFG.layout;            // { mode:'strip'|'map', ... }

  var statusEl = document.getElementById('live-status');
  var ppBtn = document.getElementById('live-pp');
  var bufSeg = document.getElementById('live-buf');

  // groups: array of [cellEl, modelIndex] pairs, mirroring make_vis_clip.
  var groups = [];
  var MAP = layout.mode === 'map';

  // ── build cells (factored from make_vis_clip.mjs) ─────────────────────────
  function mkRow(elId, idxs, kind) {
    var el = document.getElementById(elId);
    el.innerHTML = '';
    var cells = [];
    for (var k = 0; k < idxs.length; k++) {
      var c = document.createElement('div');
      c.style.cssText = kind === 'row'
        ? 'flex:1 1 0;min-width:4px;height:100%;border-radius:3px;background:#000;transition:background 60ms linear;'
        : 'width:26px;height:15px;border-radius:3px;background:#000;transition:background 60ms linear;';
      el.appendChild(c);
      cells.push([c, idxs[k]]);
    }
    groups.push(cells);
  }

  function mkMap(elId, dots, dot, W, H, pad) {
    var el = document.getElementById(elId);
    el.innerHTML = '';
    var cells = [];
    var iw = W - 2 * pad;
    var ih = H - 2 * pad;
    for (var k = 0; k < dots.length; k++) {
      var d = dots[k];
      var c = document.createElement('div');
      var px = pad + d.x * iw;
      var py = pad + d.y * ih;
      c.style.cssText = 'position:absolute;left:' + (px - dot / 2) + 'px;top:' + (py - dot / 2) +
        'px;width:' + dot + 'px;height:' + dot + 'px;border-radius:50%;background:#000;' +
        'transition:background 60ms linear,box-shadow 60ms linear;';
      el.appendChild(c);
      cells.push([c, d.i]);
    }
    groups.push(cells);
  }

  if (MAP) {
    var L = layout;
    mkMap('live-map', L.dots, L.dot, L.W, L.H, L.pad);
  } else {
    for (var s = 0; s < layout.sections.length; s++) {
      var sec = layout.sections[s];
      if (sec.axis === 'x') {
        mkRow('live_r' + s, sec.cols[0], 'row');
      } else {
        for (var cci = 0; cci < sec.cols.length; cci++) {
          mkRow('live_r' + s + '_' + cci, sec.cols[cci], 'col');
        }
      }
    }
  }

  // ── byte index by model index ─────────────────────────────────────────────
  // The live buffer is the full model in pixels[] order (NOT strided), so the
  // model index p.i IS the byte slot: pixel i occupies bytes [i*6 .. i*6+5]
  // (R,G,B,W,A,U). We render RGB (matching the offline clip, which also uses
  // the first three of each 6-byte group).
  // The engine SUBSAMPLES the vis for big rigs: it sends `count` (= pixelCount in
  // the frame) samples where sample slot i = model pixel floor(i*N/cap). Our
  // layout has one cell per FULL model pixel (CFG.pixelCount = N). So when the
  // frame is subsampled (count < N) we map each cell's model index back to its
  // nearest sample slot; otherwise (test_bench, count===N) it's 1:1.
  var FULL = CFG.pixelCount || 0;
  function paint(bytes, count) {
    var sub = FULL > 0 && count < FULL;
    for (var g = 0; g < groups.length; g++) {
      var cells = groups[g];
      for (var j = 0; j < cells.length; j++) {
        var c = cells[j][0];
        var mi = cells[j][1];
        var slot = sub ? Math.round(mi * count / FULL) : mi;
        if (slot >= count) slot = count - 1;
        if (slot < 0) continue;
        var o = slot * 6;
        var r = bytes[o], gg = bytes[o + 1], b = bytes[o + 2];
        var hx = '#' + toHex(r) + toHex(gg) + toHex(b);
        c.style.background = hx;
        if (MAP) {
          var lum = (r + gg + b) / 765;
          c.style.boxShadow = lum < 0.03 ? 'none'
            : '0 0 ' + (2 + lum * 10).toFixed(1) + 'px ' + (0.5 + lum * 3).toFixed(1) + 'px ' + hx;
        }
      }
    }
  }

  function toHex(v) {
    v = v < 0 ? 0 : (v > 255 ? 255 : (v | 0));
    var h = v.toString(16);
    return h.length === 1 ? '0' + h : h;
  }

  // Dim every cell to black — used on disconnect so we never show stale colors
  // as if they were live (codex P0: no fake data when not connected).
  function blank() {
    for (var g = 0; g < groups.length; g++) {
      var cells = groups[g];
      for (var j = 0; j < cells.length; j++) {
        cells[j][0].style.background = '#000';
        if (MAP) cells[j][0].style.boxShadow = 'none';
      }
    }
  }

  function b64ToBytes(s) {
    var bin = atob(s);
    var n = bin.length;
    var out = new Uint8Array(n);
    for (var i = 0; i < n; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  // ── connection state UX ───────────────────────────────────────────────────
  function setStatus(kind, text) {
    statusEl.className = 'live-status ' + kind;
    statusEl.textContent = text;
  }

  var paused = false;
  var ws = null;
  var reconnectTimer = null;
  var sawFrame = false;
  var darkFrames = 0;

  function connect() {
    setStatus('connecting', '○ connecting to engine at ' + host + '…');
    sawFrame = false;
    try {
      ws = new WebSocket('ws://' + host + '/ws/viz');
    } catch (e) {
      setStatus('down', '✕ engine not reachable at ' + host + ' (' + e.message + ')');
      scheduleReconnect();
      return;
    }
    ws.onopen = function () {
      setStatus('up', '● connected to engine · waiting for ' + buffer + ' frames…');
    };
    ws.onmessage = function (ev) {
      if (paused) return;
      var m;
      try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.type !== 'vis' || !m.vis || !m.vis[buffer]) return;
      var bytes = b64ToBytes(m.vis[buffer]);
      var count = m.pixelCount || Math.floor(bytes.length / 6);
      paint(bytes, count);
      if (!sawFrame) {
        sawFrame = true;
        setStatus('up', '● connected to engine · ' + buffer + ' · ' + count + 'px live');
      }
      // Connected but the engine's composition is all-black for a while: the
      // gallery is fine — the engine just isn't compositing a lit pattern to
      // `master`/`rig`. Guide the operator instead of showing a silent black box.
      var anyLit = false;
      for (var bi = 0; bi < bytes.length; bi += 6) {
        if (bytes[bi] || bytes[bi + 1] || bytes[bi + 2] || bytes[bi + 3]) { anyLit = true; break; }
      }
      if (anyLit) { darkFrames = 0; }
      else if (++darkFrames === 8) {
        setStatus('up', '● connected · ' + buffer + ' is DARK — load a pattern in Deck Control below'
          + (buffer === 'master' ? '' : ' (or check master fader / blackout)'));
      }
    };
    ws.onerror = function () {
      // onclose follows; report there so we have one disconnect path.
    };
    ws.onclose = function () {
      setStatus('down', '✕ engine not reachable at ' + host + ' — retrying…');
      blank();
      scheduleReconnect();
    };
  }

  function scheduleReconnect() {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(function () {
      reconnectTimer = null;
      connect();
    }, 2000);
  }

  // ── controls ──────────────────────────────────────────────────────────────
  if (ppBtn) {
    ppBtn.onclick = function () {
      paused = !paused;
      ppBtn.textContent = paused ? 'Resume' : 'Pause';
      if (paused) {
        statusEl.textContent = statusEl.textContent.replace(/ · PAUSED$/, '') + ' · PAUSED';
      }
    };
  }

  if (bufSeg) {
    bufSeg.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('button') : null;
      if (!btn || !btn.dataset.buf) return;
      if (btn.dataset.buf === buffer) return;
      buffer = btn.dataset.buf;
      var kids = bufSeg.children;
      for (var i = 0; i < kids.length; i++) {
        kids[i].classList.toggle('on', kids[i] === btn);
      }
      blank();
      // Update the URL so the choice is shareable / survives reload.
      try {
        var u = new URL(window.location.href);
        u.searchParams.set('buffer', buffer);
        window.history.replaceState(null, '', u.toString());
      } catch (e2) { /* older browsers: ignore */ }
      if (sawFrame) setStatus('up', '● connected to engine · ' + buffer);
    });
  }

  connect();
})();
