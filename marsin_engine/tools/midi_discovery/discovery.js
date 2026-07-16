/*
  discovery.js — browser logic for the MIDI discovery tool.

  Uses the Web MIDI API (same API CaptainPad uses) to read every controller on
  the bus. No frameworks, no external assets — offline rule. Defensive by
  design: the operator (not an agent) drives the page, and Web MIDI is only
  available over http://127.0.0.1 / https / localhost.

  Data model built up during a session:
    rawLog[]   — every incoming message, in order
    labels[]   — { label, startMs, endMs, messages:[...] } labeled captures
    summary    — Map keyed "port|type|ch|num" → aggregate stats
  Export bundles all three plus the port inventory into one JSON.
*/
(() => {
  'use strict';

  // Controllers we default OFF (already known / not the discovery target).
  const DEFAULT_OFF = [/midi fighter twister/i, /apc\b/i, /apc mini/i];

  const state = {
    access: null, // MIDIAccess
    inputs: new Map(), // id → MIDIInput
    outputs: new Map(), // id → MIDIOutput
    captureIds: new Set(), // input ids we're listening to
    rawLog: [],
    labels: [],
    summary: new Map(), // key → stats
    active: null, // active labeled group or null
    autostopTimer: null,
  };

  const $ = (id) => document.getElementById(id);
  const now = () => performance.now();

  // ── MIDI message decode ────────────────────────────────────────────────────
  function decode(bytes) {
    const b0 = bytes[0];
    if (b0 === 0xf0) {
      return { type: 'sysex', channel: null, number: null, value: null };
    }
    const status = b0 & 0xf0;
    const channel = b0 & 0x0f;
    switch (status) {
      case 0x80:
        return { type: 'noteoff', channel, number: bytes[1], value: bytes[2] };
      case 0x90:
        // note-on velocity 0 is a note-off by convention
        return {
          type: bytes[2] === 0 ? 'noteoff' : 'noteon',
          channel,
          number: bytes[1],
          value: bytes[2],
        };
      case 0xa0:
        return { type: 'polyat', channel, number: bytes[1], value: bytes[2] };
      case 0xb0:
        return { type: 'cc', channel, number: bytes[1], value: bytes[2] };
      case 0xc0:
        return { type: 'programchange', channel, number: bytes[1], value: null };
      case 0xd0:
        return { type: 'aftertouch', channel, number: null, value: bytes[1] };
      case 0xe0:
        return {
          type: 'pitchbend',
          channel,
          number: null,
          value: (bytes[2] << 7) | bytes[1],
        };
      default:
        return { type: 'other', channel: null, number: null, value: null };
    }
  }

  function hex(bytes) {
    return Array.from(bytes, (n) => n.toString(16).padStart(2, '0').toUpperCase()).join(' ');
  }

  // ── Incoming message pipeline ──────────────────────────────────────────────
  function onMidi(portId, portName, ev) {
    const bytes = Array.from(ev.data);
    const dec = decode(bytes);
    const msg = {
      t: now(),
      port: portName,
      portId,
      bytes,
      hex: hex(bytes),
      type: dec.type,
      channel: dec.channel,
      number: dec.number,
      value: dec.value,
    };
    state.rawLog.push(msg);
    updateSummary(msg);
    if (state.active) {
      state.active.messages.push(msg);
      armAutostop(); // any captured activity resets the auto-stop clock
      renderGroups();
    }
    appendLog(msg);
    renderSummary();
    $('msg-count').textContent = `${state.rawLog.length} messages`;
  }

  function summaryKey(m) {
    return `${m.port}|${m.type}|${m.channel}|${m.number}`;
  }

  function updateSummary(m) {
    const key = summaryKey(m);
    let s = state.summary.get(key);
    if (!s) {
      s = {
        port: m.port,
        type: m.type,
        channel: m.channel,
        number: m.number,
        count: 0,
        min: Infinity,
        max: -Infinity,
        firstMs: m.t,
        lastMs: m.t,
        labels: new Set(),
      };
      state.summary.set(key, s);
    }
    s.count += 1;
    s.lastMs = m.t;
    if (typeof m.value === 'number') {
      if (m.value < s.min) s.min = m.value;
      if (m.value > s.max) s.max = m.value;
    }
    if (state.active) s.labels.add(state.active.label);
  }

  // ── Labeled capture ────────────────────────────────────────────────────────
  function startLabel() {
    const label = $('label-text').value.trim();
    if (!label) {
      setStatus('label-status', 'enter a label first', 'warn');
      return;
    }
    if (state.active) stopLabel();
    state.active = { label, startMs: now(), endMs: null, messages: [] };
    $('rec-dot').classList.remove('idle');
    setStatus('label-status', `recording "${label}"…`, 'bad');
    $('btn-start-label').disabled = true;
    $('btn-stop-label').disabled = false;
    armAutostop();
  }

  function stopLabel() {
    if (!state.active) return;
    clearTimeout(state.autostopTimer);
    state.autostopTimer = null;
    state.active.endMs = now();
    state.labels.push(state.active);
    const label = state.active.label;
    const n = state.active.messages.length;
    state.active = null;
    $('rec-dot').classList.add('idle');
    setStatus('label-status', `saved "${label}" (${n} msgs)`, 'good');
    $('btn-start-label').disabled = false;
    $('btn-stop-label').disabled = true;
    $('label-text').value = '';
    renderGroups();
    renderSummary();
  }

  function armAutostop() {
    const ms = Number($('autostop').value);
    clearTimeout(state.autostopTimer);
    if (!state.active || !Number.isFinite(ms) || ms <= 0) return;
    state.autostopTimer = setTimeout(() => {
      if (state.active) stopLabel();
    }, ms);
  }

  // ── Rendering ──────────────────────────────────────────────────────────────
  function appendLog(m) {
    const log = $('log');
    const ts = (m.t / 1000).toFixed(3);
    const chStr = m.channel == null ? '--' : String(m.channel).padStart(2, ' ');
    const numStr = m.number == null ? '---' : String(m.number).padStart(3, ' ');
    const valStr = m.value == null ? '----' : String(m.value).padStart(4, ' ');
    const tag = state.active ? ` [${state.active.label}]` : '';
    const line = document.createElement('div');
    line.innerHTML =
      `<span class="ts">${ts}</span> ` +
      `<span class="t-${m.type}">${m.type.padEnd(12)}</span> ` +
      `ch${chStr} #${numStr} =${valStr}  ` +
      `<span class="ts">${m.port}</span>  ${m.hex}` +
      `<span class="lbl-tag">${tag}</span>`;
    log.appendChild(line);
    if ($('autoscroll').checked) log.scrollTop = log.scrollHeight;
    // Cap DOM nodes so a long session stays responsive (rawLog keeps all).
    while (log.childNodes.length > 500) log.removeChild(log.firstChild);
  }

  function groupSummaryText(g) {
    const byKey = new Map();
    for (const m of g.messages) {
      const k = `${m.type} ch${m.channel} #${m.number}`;
      let e = byKey.get(k);
      if (!e) {
        e = { min: Infinity, max: -Infinity, count: 0 };
        byKey.set(k, e);
      }
      e.count += 1;
      if (typeof m.value === 'number') {
        if (m.value < e.min) e.min = m.value;
        if (m.value > e.max) e.max = m.value;
      }
    }
    const parts = [];
    for (const [k, e] of byKey) {
      const range = e.min === Infinity ? '' : `, values ${e.min}..${e.max}`;
      parts.push(`${k}${range}, ${e.count} msgs`);
    }
    return parts.join('; ') || '(no messages)';
  }

  function renderGroups() {
    const ul = $('groups');
    ul.innerHTML = '';
    const all = state.active ? state.labels.concat([state.active]) : state.labels;
    for (const g of all) {
      const li = document.createElement('li');
      const live = g.endMs == null ? ' <span class="status bad">● live</span>' : '';
      li.innerHTML =
        `<div class="gl-label">${escapeHtml(g.label)}${live}</div>` +
        `<div class="gl-sum">${escapeHtml(groupSummaryText(g))}</div>`;
      ul.appendChild(li);
    }
  }

  function renderSummary() {
    const body = $('summary-body');
    body.innerHTML = '';
    const rows = Array.from(state.summary.values()).sort((a, b) => {
      if (a.port !== b.port) return a.port < b.port ? -1 : 1;
      if (a.type !== b.type) return a.type < b.type ? -1 : 1;
      if ((a.channel ?? -1) !== (b.channel ?? -1)) return (a.channel ?? -1) - (b.channel ?? -1);
      return (a.number ?? -1) - (b.number ?? -1);
    });
    for (const s of rows) {
      const tr = document.createElement('tr');
      const range = s.min === Infinity ? '—' : `${s.min}..${s.max}`;
      tr.innerHTML =
        `<td>${escapeHtml(s.port)}</td>` +
        `<td class="t-${s.type}">${s.type}</td>` +
        `<td class="num">${s.channel ?? '—'}</td>` +
        `<td class="num">${s.number ?? '—'}</td>` +
        `<td class="num">${s.count}</td>` +
        `<td class="num">${range}</td>` +
        `<td>${escapeHtml(Array.from(s.labels).join(', '))}</td>`;
      body.appendChild(tr);
    }
    $('summary-count').textContent = `(${rows.length} tuples)`;
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]),
    );
  }

  function setStatus(id, text, kind) {
    const el = $(id);
    el.textContent = text;
    el.className = 'status' + (kind ? ' ' + kind : '');
  }

  // ── Port inventory + listener wiring ───────────────────────────────────────
  function isDefaultOff(name) {
    return DEFAULT_OFF.some((re) => re.test(name || ''));
  }

  function rebuildPorts() {
    state.inputs.clear();
    state.outputs.clear();
    for (const input of state.access.inputs.values()) state.inputs.set(input.id, input);
    for (const output of state.access.outputs.values()) state.outputs.set(output.id, output);
    renderInputs();
    renderOutputs();
    wireListeners();
  }

  function portMeta(p) {
    const bits = [];
    if (p.manufacturer) bits.push(p.manufacturer);
    bits.push(`id ${p.id}`);
    return bits.join(' · ');
  }

  function renderInputs() {
    const ul = $('inputs');
    ul.innerHTML = '';
    for (const input of state.inputs.values()) {
      // First sight of a port: default-select unless it's a known controller.
      if (!state.captureIds.has(input.id) && !isDefaultOff(input.name) && !input._seen) {
        state.captureIds.add(input.id);
      }
      input._seen = true;
      const li = document.createElement('li');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = state.captureIds.has(input.id);
      cb.addEventListener('change', () => {
        if (cb.checked) state.captureIds.add(input.id);
        else state.captureIds.delete(input.id);
        wireListeners();
      });
      const name = document.createElement('span');
      name.className = 'pname';
      name.textContent = input.name || '(unnamed)';
      const meta = document.createElement('span');
      meta.className = 'pmeta';
      meta.textContent = portMeta(input);
      li.appendChild(cb);
      li.appendChild(name);
      li.appendChild(meta);
      ul.appendChild(li);
    }
    if (!state.inputs.size) ul.innerHTML = '<li class="status">no MIDI inputs found</li>';
  }

  function renderOutputs() {
    const ul = $('outputs');
    ul.innerHTML = '';
    const sel = $('send-port');
    const prev = sel.value;
    sel.innerHTML = '';
    for (const output of state.outputs.values()) {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.className = 'pname';
      name.textContent = output.name || '(unnamed)';
      const meta = document.createElement('span');
      meta.className = 'pmeta';
      meta.textContent = portMeta(output);
      li.appendChild(name);
      li.appendChild(meta);
      ul.appendChild(li);

      const opt = document.createElement('option');
      opt.value = output.id;
      opt.textContent = output.name || output.id;
      sel.appendChild(opt);
    }
    if (prev) sel.value = prev;
    if (!state.outputs.size) ul.innerHTML = '<li class="status">no MIDI outputs found</li>';
  }

  function wireListeners() {
    for (const input of state.inputs.values()) {
      if (state.captureIds.has(input.id)) {
        input.onmidimessage = (ev) => onMidi(input.id, input.name || input.id, ev);
      } else {
        input.onmidimessage = null;
      }
    }
  }

  // ── Access request ─────────────────────────────────────────────────────────
  async function requestAccess() {
    if (!navigator.requestMIDIAccess) {
      showBanner('banner-nomidi',
        'Web MIDI unavailable. Use Chrome/Edge over http://127.0.0.1 (this ' +
        'tool) or https. Firefox/Safari do not support Web MIDI.');
      setStatus('access-state', 'Web MIDI: unsupported', 'bad');
      return;
    }
    setStatus('access-state', 'Web MIDI: requesting…', 'warn');
    let access;
    try {
      access = await navigator.requestMIDIAccess({ sysex: true });
    } catch (err) {
      // Sysex denied → fall back to non-sysex WITH a visible warning (task spec).
      showBanner('banner-sysex',
        `Sysex denied (${err.message}). Retrying without sysex — Grid config/` +
        'screen dumps will NOT be captured. Re-run and allow sysex to capture them.');
      try {
        access = await navigator.requestMIDIAccess({ sysex: false });
      } catch (err2) {
        showBanner('banner-nomidi', `MIDI access denied: ${err2.message}`);
        setStatus('access-state', 'Web MIDI: denied', 'bad');
        return;
      }
      setStatus('access-state', 'Web MIDI: connected (NO sysex)', 'warn');
      finishAccess(access);
      return;
    }
    setStatus('access-state', 'Web MIDI: connected (sysex)', 'good');
    finishAccess(access);
  }

  function finishAccess(access) {
    state.access = access;
    access.onstatechange = () => rebuildPorts();
    rebuildPorts();
  }

  function showBanner(id, text) {
    const el = $(id);
    el.textContent = text;
    el.classList.add('show');
  }

  // ── Test send ──────────────────────────────────────────────────────────────
  function parseHexString(str) {
    const tokens = str.trim().split(/[\s,]+/).filter(Boolean);
    const bytes = tokens.map((t) => {
      const n = parseInt(t.replace(/^0x/i, ''), 16);
      if (!Number.isInteger(n) || n < 0 || n > 255) {
        throw new Error(`bad hex byte: ${t}`);
      }
      return n;
    });
    return bytes;
  }

  function sendTest() {
    const out = state.outputs.get($('send-port').value);
    if (!out) {
      setStatus('send-status', 'no output selected', 'warn');
      return;
    }
    const kind = $('send-kind').value;
    try {
      let bytes;
      if (kind === 'sysex') {
        bytes = parseHexString($('send-hex').value);
      } else {
        const ch = clamp(Number($('send-ch').value), 0, 15);
        const num = clamp(Number($('send-num').value), 0, 127);
        const val = clamp(Number($('send-val').value), 0, 127);
        if (kind === 'cc') bytes = [0xb0 | ch, num, val];
        else if (kind === 'noteon') bytes = [0x90 | ch, num, val];
        else bytes = [0x80 | ch, num, val];
      }
      out.send(bytes);
      setStatus('send-status', `sent ${hex(bytes)}`, 'good');
    } catch (err) {
      setStatus('send-status', `send failed: ${err.message}`, 'bad');
    }
  }

  function clamp(n, lo, hi) {
    if (!Number.isFinite(n)) return lo;
    return Math.max(lo, Math.min(hi, Math.round(n)));
  }

  // ── Export ─────────────────────────────────────────────────────────────────
  function buildExport() {
    const ports = [];
    for (const input of state.inputs.values()) {
      ports.push({
        direction: 'input',
        id: input.id,
        name: input.name || null,
        manufacturer: input.manufacturer || null,
        capturing: state.captureIds.has(input.id),
      });
    }
    for (const output of state.outputs.values()) {
      ports.push({
        direction: 'output',
        id: output.id,
        name: output.name || null,
        manufacturer: output.manufacturer || null,
      });
    }
    // Device name = the first capturing input, else first input, else 'device'.
    const capturing = ports.find((p) => p.direction === 'input' && p.capturing);
    const anyInput = ports.find((p) => p.direction === 'input');
    const deviceName = (capturing || anyInput || {}).name || 'device';

    const summary = Array.from(state.summary.values()).map((s) => ({
      port: s.port,
      type: s.type,
      channel: s.channel,
      number: s.number,
      count: s.count,
      valueMin: s.min === Infinity ? null : s.min,
      valueMax: s.max === -Infinity ? null : s.max,
      firstMs: s.firstMs,
      lastMs: s.lastMs,
      labels: Array.from(s.labels),
    }));

    return {
      tool: 'midi_discovery',
      version: 1,
      exportedAt: new Date().toISOString(),
      device: { name: deviceName, ports },
      labels: state.labels.map((g) => ({
        label: g.label,
        startMs: g.startMs,
        endMs: g.endMs,
        messages: g.messages,
      })),
      rawLog: state.rawLog,
      summary,
    };
  }

  async function exportSave() {
    if (state.active) stopLabel();
    const payload = buildExport();
    setStatus('export-status', 'saving…', 'warn');
    $('export-path').textContent = '';
    try {
      const res = await fetch('/capture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setStatus('export-status', 'saved to repo ✓', 'good');
      $('export-path').textContent = data.path;
    } catch (err) {
      setStatus('export-status',
        `save failed: ${err.message} — use Download JSON instead`, 'bad');
    }
  }

  function downloadJson() {
    if (state.active) stopLabel();
    const payload = buildExport();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    a.href = url;
    a.download = `midi_discovery_${stamp}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setStatus('export-status', 'downloaded (also try Save to repo)', 'good');
  }

  function resetSession() {
    if (state.active) stopLabel();
    state.rawLog = [];
    state.labels = [];
    state.summary.clear();
    $('log').innerHTML = '';
    $('msg-count').textContent = '0 messages';
    renderGroups();
    renderSummary();
    setStatus('export-status', 'session reset', 'warn');
    $('export-path').textContent = '';
  }

  // ── Wiring ─────────────────────────────────────────────────────────────────
  function init() {
    $('btn-request').addEventListener('click', requestAccess);
    $('btn-start-label').addEventListener('click', startLabel);
    $('btn-stop-label').addEventListener('click', stopLabel);
    $('btn-clear-log').addEventListener('click', () => {
      $('log').innerHTML = '';
    });
    $('btn-send').addEventListener('click', sendTest);
    $('btn-export').addEventListener('click', exportSave);
    $('btn-download').addEventListener('click', downloadJson);
    $('btn-reset').addEventListener('click', resetSession);
    $('send-kind').addEventListener('change', () => {
      const sysex = $('send-kind').value === 'sysex';
      $('send-sysex-row').style.display = sysex ? '' : 'none';
      $('send-simple').style.display = sysex ? 'none' : '';
    });
    renderSummary();
    renderGroups();
  }

  init();
})();
