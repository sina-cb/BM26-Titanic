// Tests for the Companion DERIVED readout of the NEW Round-2/Wave-D derived
// signals (dev/companion_new_signals, 2026-06-20):
//   1. BROADCAST FRAME — boots the real companion server in TEST source mode on
//      an isolated port, connects over WS, and asserts every analysis `frame`'s
//      `derived` block carries the new derived keys (build/anticipation,
//      structure, onsets/sub) — they come from the companion's OWN DerivedSignals
//      and must reach the UI, not just the engine OSC tap.
//   2. THEME var completeness — the NEW BUILD/STRUCTURE/ONSETS UI only paints with
//      theme CSS vars; assert every [data-theme] block (and :root) defines the
//      full var set the new components read, so all 5 themes restyle together.
//
// Run:  cd marsin_engine && node --test tests/companion_new_signals.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(__dirname, '..', 'audio', 'companion', 'companion_server.js');
const CSS = path.join(__dirname, '..', 'audio', 'companion', 'ui', 'companion_app.css');

// The NEW derived keys the server must surface in the frame `derived` block and
// the UI must render. Names match the `derived:` fields in companion_server.js.
const NEW_FRAME_KEYS = [
  // BUILD / anticipation
  'riserScore', 'buildEta', 'riserConf', 'dropCountdown',
  // STRUCTURE
  'climax', 'phrasePhase', 'phraseBoundary', 'silence', 'trackChange',
  // ONSETS / sub
  'onsetLow', 'onsetMid', 'onsetHigh', 'chestHit',
];

// The theme vars the new BUILD/STRUCTURE/ONSETS components read (subset of the
// full companion set, but assert the full set here so the new UI can never land
// on a half-styled theme — a missing token must FAIL, not silently fall back).
const REQUIRED_VARS = [
  '--bg', '--panel', '--panel2', '--raised', '--border',
  '--text', '--muted', '--accent', '--ok', '--err', '--on-accent',
];
const EXPECTED_THEMES = ['light', 'dark', 'midnight', 'sunset', 'gruvbox'];

function collectDerived(msg, sink) {
  const frames = msg.type === 'frames' ? msg.frames : (msg.type === 'frame' ? [msg] : []);
  for (const f of frames) {
    if (f.derived) sink.push(f.derived);
  }
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

test('the broadcast frame carries the NEW derived signal keys (live, test source)', async () => {
  const port = 31930 + Math.floor(Math.random() * 25);
  const proc = spawn('node', [SERVER, '--port', String(port)], {
    cwd: path.join(__dirname, '..'),
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  try {
    await waitForServer(port);
    const { WebSocket } = await import('ws');
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
    // Force TEST source so analysis runs headless (no mic device in CI).
    ws.send(JSON.stringify({ type: 'setMode', mode: 'test' }));

    const derivedSeen = [];
    await new Promise((resolve) => {
      const to = setTimeout(resolve, 4000);
      ws.on('message', (buf) => {
        collectDerived(JSON.parse(buf.toString()), derivedSeen);
        // Stop early once a frame carries the full new key set.
        if (derivedSeen.some(d => NEW_FRAME_KEYS.every(k => k in d))) {
          clearTimeout(to);
          resolve();
        }
      });
    });
    ws.close();

    assert.ok(derivedSeen.length > 0, 'received at least one derived frame');
    // EVERY derived frame must carry EVERY new key (the server publishes them on
    // every analysis frame, value 0 when idle — a present-but-zero scalar, never
    // an omitted key).
    for (const d of derivedSeen) {
      for (const k of NEW_FRAME_KEYS) {
        assert.ok(k in d, `derived frame carries "${k}"`);
        // value is a number or null (null = key not registered in this build);
        // here every key IS registered, so it must be a finite number.
        assert.equal(typeof d[k], 'number', `"${k}" is a numeric scalar`);
        assert.ok(Number.isFinite(d[k]), `"${k}" is finite (${d[k]})`);
      }
    }
    // The pre-existing derived keys must still be present (no regression).
    const last = derivedSeen[derivedSeen.length - 1];
    for (const k of ['bpm', 'beat', 'party', 'note', 'hue', 'genre', 'genreConf']) {
      assert.ok(k in last, `existing derived key "${k}" still present`);
    }
  } finally {
    proc.kill('SIGKILL');
  }
});

test('every theme (and :root) defines the vars the NEW BUILD/STRUCTURE/ONSETS UI uses', () => {
  const css = fs.readFileSync(CSS, 'utf8');
  for (const theme of EXPECTED_THEMES) {
    const re = new RegExp(`\\[data-theme="${theme}"\\]\\s*\\{([^}]*)\\}`, 'g');
    const blocks = [...css.matchAll(re)].map(m => m[1]).join(';');
    assert.ok(blocks.length > 0, `[data-theme="${theme}"] block exists`);
    for (const v of REQUIRED_VARS) {
      assert.ok(new RegExp(`${v}\\s*:`).test(blocks), `theme "${theme}" defines ${v}`);
    }
  }
  const rootBlock = (css.match(/:root[^{]*\{([^}]*)\}/) || [])[1] || '';
  for (const v of REQUIRED_VARS) {
    assert.ok(new RegExp(`${v}\\s*:`).test(rootBlock), `:root defines ${v}`);
  }
  // The new components must NOT introduce a hardcoded hex (theme-token rule).
  // Scope the check to the new derived-row CSS section.
  const sec = css.slice(css.indexOf('NEW derived row'), css.indexOf('OSC OUT accounting page'));
  assert.ok(sec.length > 0, 'new derived-row CSS section present');
  const hexes = sec.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
  assert.deepEqual(hexes, [], `new derived-row CSS uses no hardcoded hex (found ${hexes.join(',')})`);
});
