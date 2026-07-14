// Effects v2 engine track — API + sync-surface integration test.
//
// Spawns ONE engine on a random high port (NEVER :6968 — the live stack) with
// full MARSIN_STATE_DIR / MARSIN_PLAYLISTS_DIR isolation into throwaway temp
// dirs, then exercises the effects_v2 REST surface end to end:
//   - GET/PATCH /global-effects/page (engine-owned page VIEW)
//   - POST /global-effect-slots/:id/mode + /mode/cycle
//   - GET /global-effects/layout
//   - the SYNC SURFACE: /global-effect-slots/status carries effectsPage +
//     per-slot intensity + mode; a /ws/control subscriber receives the
//     effectsPage + globalEffectMacroStatus broadcasts.
//   - persistence: the page survives written state (global_effect_slots.yaml).
//
// Layout DEPLOY is config-gated OFF (default) so this test NEVER spawns the
// VSN1 deploy child process — it only asserts the layout JSON is written.
//
// Run: node --test tests/effects_v2_api.test.js
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { WebSocket } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const engineDir = path.resolve(__dirname, '..');
const SCENE = 'test_bench';

const tmpStateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'marsin-fx2-states-'));
const playlistsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'marsin-fx2-playlists-'));
const stateDir = path.join(tmpStateRoot, SCENE);

// Random high port well away from the live :6968.
const port = 7100 + Math.floor(Math.random() * 300);
const BASE = () => `http://127.0.0.1:${port}`;

let proc = null;

function spawnEngine() {
  const child = spawn(
    'node',
    ['engine.js', '--pattern', '01_cylon_sweep', '--model', SCENE, '--port', String(port)],
    {
      cwd: engineDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        BM26_DISABLE_TIMELINE: '1',
        MARSIN_STATE_DIR: tmpStateRoot,
        MARSIN_PLAYLISTS_DIR: playlistsDir,
        // Force VSN1 layout-deploy OFF for this suite regardless of the
        // committed config.yaml value — the deploy-status assertions below
        // rely on it staying 'disabled', and the suite must NEVER spawn the
        // deploy child (no COM12 / hardware in a unit test).
        MARSIN_VSN1_DEPLOY: '0',
      },
    },
  );
  child.stdout.on('data', d => process.stderr.write('[engine] ' + d));
  child.stderr.on('data', d => process.stderr.write('[engine!] ' + d));
  return child;
}

async function waitForReady(timeoutMs = 25000) {
  const t0 = Date.now();
  let lastErr = null;
  while (Date.now() - t0 < timeoutMs) {
    try {
      const res = await fetch(BASE() + '/status');
      if (res.ok) {
        const j = await res.json();
        if (j.service === 'marsin-engine') return j;
      }
    } catch (e) { lastErr = e; }
    await new Promise(r => setTimeout(r, 300));
  }
  throw new Error('Engine never became ready: ' + (lastErr?.message || 'timeout'));
}

async function api(method, path_, body) {
  const res = await fetch(BASE() + path_, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

// Collect /ws/control messages of the given types until `predicate` is met.
function collectWs(types, predicate, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/control`);
    const seen = [];
    const timer = setTimeout(() => { ws.close(); reject(new Error(`ws timeout; saw ${JSON.stringify(seen.map(m => m.type))}`)); }, timeoutMs);
    ws.on('open', () => resolve({ ws, seen, timer }));
    ws.on('message', (buf) => {
      let m; try { m = JSON.parse(buf.toString()); } catch { return; }
      if (types.includes(m.type)) seen.push(m);
      if (predicate(seen)) { clearTimeout(timer); ws.close(); }
    });
    ws.on('error', (e) => { clearTimeout(timer); reject(e); });
  });
}

before(async () => {
  proc = spawnEngine();
  await waitForReady();
});

after(async () => {
  if (proc && !proc.killed) {
    proc.kill('SIGTERM');
    await new Promise(r => setTimeout(r, 500));
    if (!proc.killed) proc.kill('SIGKILL');
  }
});

// ── Page view ────────────────────────────────────────────────────────

test('GET /global-effects/page returns the engine-owned page (default 0)', async () => {
  const r = await api('GET', '/global-effects/page');
  assert.equal(r.status, 200);
  assert.equal(r.data.effectsPage, 0);
});

test('PATCH /global-effects/page sets + broadcasts + persists the page', async () => {
  // Subscribe first and WAIT for the socket to open before firing the PATCH,
  // so the broadcast can't race ahead of the subscription.
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/control`);
  const bcPromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { ws.close(); reject(new Error('no effectsPage broadcast')); }, 4000);
    ws.on('message', (buf) => {
      let m; try { m = JSON.parse(buf.toString()); } catch { return; }
      if (m.type === 'effectsPage') { clearTimeout(timer); ws.close(); resolve(m); }
    });
    ws.on('error', (e) => { clearTimeout(timer); reject(e); });
  });
  await new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
  });

  const r = await api('PATCH', '/global-effects/page', { effectsPage: 2 });
  assert.equal(r.status, 200);
  assert.equal(r.data.effectsPage, 2);

  const bc = await bcPromise;
  assert.equal(bc.effectsPage, 2, 'page change broadcast on /ws/control');

  // Status carries the page too (sync surface).
  const st = await api('GET', '/global-effect-slots/status');
  assert.equal(st.data.effectsPage, 2);

  // Persisted to disk.
  const file = path.join(stateDir, 'global_effect_slots.yaml');
  const onDisk = yaml.load(fs.readFileSync(file, 'utf8'));
  assert.equal(onDisk.effectsPage, 2, 'page persisted in global_effect_slots.yaml');
});

test('PATCH /global-effects/page rejects an out-of-range page (400)', async () => {
  const r = await api('PATCH', '/global-effects/page', { effectsPage: 9 });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /effectsPage must be an integer/);
});

// ── Mode surface ─────────────────────────────────────────────────────

test('slot status carries the mode surface (mode/modeValues/modeLabel)', async () => {
  const st = await api('GET', '/global-effect-slots/status');
  const s3 = st.data.slots.find(s => s.slotId === 3); // colorWash
  assert.equal(s3.modeLabel, 'Blend');
  assert.ok(Array.isArray(s3.modeValues) && s3.modeValues.includes('tint'));
  assert.ok(s3.modeValues.some(v => v === s3.mode));
});

test('POST /global-effect-slots/:id/mode sets an explicit mode value', async () => {
  const r = await api('POST', '/global-effect-slots/3/mode', { value: 'replace' });
  assert.equal(r.status, 200);
  assert.equal(r.data.mode, 'replace');
  const st = await api('GET', '/global-effect-slots/status');
  assert.equal(st.data.slots.find(s => s.slotId === 3).mode, 'replace');
});

test('POST /global-effect-slots/:id/mode rejects a stranger value (400)', async () => {
  const r = await api('POST', '/global-effect-slots/3/mode', { value: 'plaid' });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /not valid for/);
});

test('POST /global-effect-slots/:id/mode/cycle steps the mode + broadcasts status', async () => {
  // Reset to a known mode first.
  await api('POST', '/global-effect-slots/3/mode', { value: 'tint' });
  const conn = collectWs(['globalEffectMacroStatus'], (seen) => seen.length >= 1);
  const { ws, timer } = await conn;
  const r = await api('POST', '/global-effect-slots/3/mode/cycle', {});
  assert.equal(r.status, 200);
  assert.equal(r.data.mode, 'replace', 'tint → replace (next in list)');
  // Give the broadcast a moment, then verify status reflects it.
  await new Promise(res => setTimeout(res, 200));
  clearTimeout(timer); try { ws.close(); } catch {}
  const st = await api('GET', '/global-effect-slots/status');
  assert.equal(st.data.slots.find(s => s.slotId === 3).mode, 'replace');
});

test('mode endpoints 400 for a slot with no mode (invert)', async () => {
  const r = await api('POST', '/global-effect-slots/9/mode/cycle', {});
  assert.equal(r.status, 400);
  assert.match(r.data.error, /no primary mode/);
});

// ── Intensity surface still present on status (sync) ─────────────────

test('POST /global-effect-slots/:id/intensity flows onto status (sync surface)', async () => {
  const r = await api('POST', '/global-effect-slots/3/intensity', { value: 0.25 });
  assert.equal(r.status, 200);
  assert.equal(r.data.intensity, 0.25);
  const st = await api('GET', '/global-effect-slots/status');
  assert.equal(st.data.slots.find(s => s.slotId === 3).intensity, 0.25);
});

// ── Layout model ─────────────────────────────────────────────────────

test('GET /global-effects/layout returns the serialized 32-slot layout + deploy status', async () => {
  const r = await api('GET', '/global-effects/layout');
  assert.equal(r.status, 200);
  assert.equal(r.data.layout.pageCount, 4);
  assert.equal(r.data.layout.slotsPerPage, 8);
  assert.ok(Array.isArray(r.data.layout.slots));
  // Deploy is config-gated OFF by default → status reflects that (no spawn).
  assert.ok(r.data.deploy);
  assert.equal(r.data.deploy.enabled, false);
});

test('a slot layout change (PATCH slot) writes the layout JSON but does NOT deploy', async () => {
  const r = await api('PATCH', '/global-effect-slots/20', {
    enabled: true, label: 'Party Sparkle', effectId: 'sparkle', presetId: 'fizz', behavior: 'toggle', color: '#8ef',
  });
  assert.equal(r.status, 200);
  // The deploy hook writes the layout JSON on any layout change (even disabled).
  const layoutFile = path.join(stateDir, 'vsn1_layout.json');
  await new Promise(res => setTimeout(res, 300)); // let the async hook flush
  assert.ok(fs.existsSync(layoutFile), 'vsn1_layout.json written on layout change');
  const layout = JSON.parse(fs.readFileSync(layoutFile, 'utf8'));
  assert.ok(layout.slots.find(s => s.slotId === 20 && s.effectId === 'sparkle'));
  // Still disabled → deploy status stays 'disabled', never 'ok'/'error'.
  const st = await api('GET', '/global-effects/layout');
  assert.equal(st.data.deploy.lastResult, 'disabled');
});

// ── Controller profile (edit | play) ─────────────────────────────────

test('GET /global-effects/profile returns the engine-owned profile (default edit)', async () => {
  const r = await api('GET', '/global-effects/profile');
  assert.equal(r.status, 200);
  assert.equal(r.data.controllerProfile, 'edit');
});

test('PATCH /global-effects/profile sets + broadcasts + persists the profile', async () => {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/control`);
  const bcPromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { ws.close(); reject(new Error('no controllerProfile broadcast')); }, 4000);
    ws.on('message', (buf) => {
      let m; try { m = JSON.parse(buf.toString()); } catch { return; }
      // Skip the connect-replay (carries the CURRENT profile, 'edit'); wait for
      // the PATCH-driven broadcast that flips it to 'play'.
      if (m.type === 'controllerProfile' && m.profile === 'play') {
        clearTimeout(timer); ws.close(); resolve(m);
      }
    });
    ws.on('error', (e) => { clearTimeout(timer); reject(e); });
  });
  await new Promise((resolve, reject) => { ws.on('open', resolve); ws.on('error', reject); });

  const r = await api('PATCH', '/global-effects/profile', { controllerProfile: 'play' });
  assert.equal(r.status, 200);
  assert.equal(r.data.controllerProfile, 'play');

  const bc = await bcPromise;
  assert.equal(bc.profile, 'play', 'profile change broadcast on /ws/control');

  // GET reflects it.
  const g = await api('GET', '/global-effects/profile');
  assert.equal(g.data.controllerProfile, 'play');

  // Persisted to disk.
  const file = path.join(stateDir, 'global_effect_slots.yaml');
  const onDisk = yaml.load(fs.readFileSync(file, 'utf8'));
  assert.equal(onDisk.controllerProfile, 'play', 'profile persisted in global_effect_slots.yaml');
});

test('PATCH /global-effects/profile rejects a stranger value (400, fail loud)', async () => {
  const r = await api('PATCH', '/global-effects/profile', { controllerProfile: 'performance' });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /controllerProfile must be/);
  // A rejected write must not have changed the engine's profile.
  const g = await api('GET', '/global-effects/profile');
  assert.equal(g.data.controllerProfile, 'play', 'a 400 leaves the profile unchanged');
});

test('a fresh /ws/control subscriber gets the profile replayed on connect', async () => {
  // The previous test switched the engine to 'play'; a late joiner must see it
  // without a GET (single source of truth, connect replay).
  const conn = collectWs(['controllerProfile'], (seen) => seen.length >= 1, 4000);
  const { ws, seen, timer } = await conn;
  await new Promise(res => setTimeout(res, 300));
  clearTimeout(timer); try { ws.close(); } catch {}
  assert.ok(seen.length >= 1, 'controllerProfile replayed on connect');
  assert.equal(seen[0].profile, 'play', 'replay carries the current profile');
  // Put the engine back to edit for any later assertions (leave a clean state).
  await api('PATCH', '/global-effects/profile', { controllerProfile: 'edit' });
});

test('profile PATCH is NOT performance-mode-gated (switching to PLAY is a performance action)', async () => {
  // Enter performance mode (structural lock), then confirm a profile switch is
  // still ALLOWED (200) — a 409 here would defeat the purpose of PLAY mode.
  const enter = await api('POST', '/performance-mode', { active: true });
  const entered = enter.status === 200;
  try {
    const r = await api('PATCH', '/global-effects/profile', { controllerProfile: 'play' });
    assert.equal(r.status, 200, entered
      ? 'profile PATCH must be allowed DURING performance mode (not 409-gated)'
      : 'profile PATCH must be allowed');
    assert.equal(r.data.controllerProfile, 'play');
  } finally {
    if (entered) await api('POST', '/performance-mode', { active: false });
    await api('PATCH', '/global-effects/profile', { controllerProfile: 'edit' });
  }
});
