// Tests for the Companion's OSC-OUT accounting surface + multi-theme CSS
// (dev/companion_ui, 2026-06-20):
//   1. /osc_accounting + /catalog data SHAPE — boots the real companion server
//      in TEST source mode on an isolated port, hits the HTTP endpoints, and
//      asserts the accounting frame enumerates every designed OUTPUT signal
//      (address + cpcKey + live value + count + rate) plus the always-on BPM
//      emit, with the live OSC stream actually flowing (counts climb).
//   2. THEME var completeness — every [data-theme="…"] block in
//      companion_app.css defines the FULL companion var set (a missing var
//      would leave that theme half-styled), and GENRE_NAMES matches the
//      canonical sibling list.
//
// Run:  cd marsin_engine && node --test tests/companion_osc_accounting.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(__dirname, '..', 'audio', 'companion', 'companion_server.js');
const CSS = path.join(__dirname, '..', 'audio', 'companion', 'ui', 'companion_app.css');

// The companion var set every theme must define (the tokens the UI reads).
// --on-accent is required in EVERY theme: it is the foreground on top of --accent
// (active seg-btn, .primary, .cal-apply). Light's teal accent fails WCAG AA on the
// near-black text, so each theme carries its own AA-passing on-accent color — a
// missing token must FAIL here, not silently fall back (codex P0).
const REQUIRED_VARS = ['--bg', '--panel', '--panel2', '--raised', '--border', '--text', '--muted', '--accent', '--ok', '--err', '--on-accent'];
const EXPECTED_THEMES = ['light', 'dark', 'midnight', 'sunset', 'gruvbox'];
const CANONICAL_GENRES = ['ambient', 'deep_house', 'melodic_house', 'tech_house', 'techno', 'melodic_techno', 'downtempo'];

async function getJson(port, route) {
  const res = await fetch(`http://127.0.0.1:${port}${route}`);
  assert.equal(res.ok, true, `${route} → ${res.status}`);
  return res.json();
}

async function waitForServer(port, timeoutMs = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/catalog`);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 150));
  }
  throw new Error(`companion server did not come up on :${port}`);
}

// Boot the real companion server (test source mode by default in standalone),
// switch it to TEST over WS so the OSC stream flows without a mic, and run `fn`.
async function withCompanion(port, fn) {
  const proc = spawn('node', [SERVER, '--port', String(port)], {
    cwd: path.join(__dirname, '..'),
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  try {
    await waitForServer(port);
    // Force TEST source so analysis runs headless (the worktree config may boot
    // the companion in mic mode, which has no device in CI).
    const { WebSocket } = await import('ws');
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
    ws.send(JSON.stringify({ type: 'setMode', mode: 'test' }));
    // Let a few analyzer hops + accounting ticks happen.
    await new Promise(r => setTimeout(r, 1500));
    await fn(ws);
    ws.close();
  } finally {
    proc.kill('SIGKILL');
  }
}

test('/osc_accounting enumerates every designed OUTPUT + the BPM emit, live', async () => {
  const port = 31960 + Math.floor(Math.random() * 30);
  await withCompanion(port, async () => {
    // Catalog advertises the canonical GENRE_NAMES.
    const cat = await getJson(port, '/catalog');
    assert.deepEqual(cat.genreNames, CANONICAL_GENRES);

    const acc = await getJson(port, '/osc_accounting');
    assert.ok(acc.target && typeof acc.target.host === 'string', 'target host present');
    assert.ok(Number.isInteger(acc.target.port), 'target port present');
    assert.ok(Array.isArray(acc.outputs), 'outputs is an array');
    assert.ok(typeof acc.totalSent === 'number', 'totalSent present');

    // Every row carries the accounting fields.
    for (const o of acc.outputs) {
      assert.equal(typeof o.address, 'string');
      assert.ok(o.address.startsWith('/marsin/'), `address looks like an OSC address: ${o.address}`);
      assert.equal(typeof o.cpcKey, 'string');
      assert.equal(typeof o.count, 'number');
      assert.equal(typeof o.rateHz, 'number');
      assert.ok('value' in o, 'value field present');
      assert.ok('label' in o, 'label field present');
    }

    // The default design ships the 8 curated signals; the BPM emit is always
    // advertised. So the accounting must contain those addresses by NAME (the
    // page is generic but these are the known boot outputs).
    const byAddr = new Map(acc.outputs.map(o => [o.address, o]));
    for (const a of ['/marsin/mic/low', '/marsin/dom/freq1', '/marsin/audio/bpm']) {
      assert.ok(byAddr.has(a), `accounting includes ${a}`);
    }
    // BPM is the built-in derived emit.
    assert.equal(byAddr.get('/marsin/audio/bpm').cpcKey, 'audioBpm');

    // The OSC stream is actually flowing in test mode — at least the band
    // signals have sent packets and report a live value + a non-zero rate.
    const micLow = byAddr.get('/marsin/mic/low');
    assert.ok(micLow.count > 0, `micLow has emitted packets (count=${micLow.count})`);
    assert.ok(micLow.rateHz > 0, `micLow reports a send rate (${micLow.rateHz}/s)`);
    assert.ok(acc.totalSent > 0, `totalSent climbed (${acc.totalSent})`);
  });
});

test('a STOPPED OSC stream decays its accounting rate toward 0 (no stale-rate lie)', async () => {
  // Observability that LIES is a codex-P0 hazard: if a stream stops (a tap is
  // removed/disabled, or BPM goes silent), its last EWMA rate must NOT freeze
  // forever. We boot test mode so /marsin/mic/low streams (rate > 0), then
  // remove that signal so its packets STOP, wait past the idle cutoff, and
  // assert the accounting rate has decayed to ~0 while its count stays frozen.
  const port = 31995 + Math.floor(Math.random() * 4);
  await withCompanion(port, async (ws) => {
    const addr = '/marsin/mic/low';
    let acc = await getJson(port, '/osc_accounting');
    let row = acc.outputs.find(o => o.address === addr);
    assert.ok(row && row.count > 0, `${addr} is streaming (count=${row && row.count})`);
    assert.ok(row.rateHz > 0, `${addr} reports a live rate before stop (${row.rateHz}/s)`);
    // Stop the stream: remove the 'low' signal so its tap no longer emits.
    ws.send(JSON.stringify({ type: 'removeSignal', id: 'low' }));
    // Let any in-flight analyzer hop that was already mid-send land, then snapshot
    // the now-frozen count (the removal + last packet have settled).
    await new Promise(r => setTimeout(r, 400));
    let settled = (await getJson(port, '/osc_accounting')).outputs.find(o => o.address === addr);
    const frozenCount = settled.count;

    // Wait past the hard idle cutoff (OSC_RATE_IDLE_CUTOFF_TAUS=4 × TAU=1000ms).
    await new Promise(r => setTimeout(r, 4500));

    acc = await getJson(port, '/osc_accounting');
    row = acc.outputs.find(o => o.address === addr);
    assert.ok(row, `${addr} still accounted for after stop (defensive row)`);
    assert.equal(row.count, frozenCount, 'count is frozen after stop — no new packets sent');
    assert.equal(row.rateHz, 0, `stopped stream decays to 0 (was non-zero), got ${row.rateHz}`);
  });
});

test('every [data-theme] block defines the full companion var set', () => {
  const css = fs.readFileSync(CSS, 'utf8');
  for (const theme of EXPECTED_THEMES) {
    // Grab the declaration block for this theme.
    const re = new RegExp(`\\[data-theme="${theme}"\\]\\s*\\{([^}]*)\\}`, 'g');
    const blocks = [...css.matchAll(re)].map(m => m[1]).join(';');
    assert.ok(blocks.length > 0, `[data-theme="${theme}"] block exists`);
    for (const v of REQUIRED_VARS) {
      assert.ok(new RegExp(`${v}\\s*:`).test(blocks), `theme "${theme}" defines ${v}`);
    }
  }
  // The default :root must also define the full set (so a missing data-theme
  // still renders).
  const rootBlock = (css.match(/:root[^{]*\{([^}]*)\}/) || [])[1] || '';
  for (const v of REQUIRED_VARS) {
    assert.ok(new RegExp(`${v}\\s*:`).test(rootBlock), `:root defines ${v}`);
  }
});
