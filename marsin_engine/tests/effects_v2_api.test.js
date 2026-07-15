// Effects v2 engine track — API + sync-surface integration test.
//
// Spawns ONE engine on a random high port (NEVER :6968 — the live stack) with
// full MARSIN_STATE_DIR / MARSIN_PLAYLISTS_DIR isolation into throwaway temp
// dirs, then exercises the effects_v2 REST surface end to end:
//   - GET/PATCH /global-effects/page (engine-owned page VIEW)
//   - POST /global-effect-slots/:id/mode + /mode/cycle
//   - GET /global-effects/layout
//   - the named effect BANKS surface (v3): GET/create/switch/next/rename/delete,
//     effectBanks broadcasts + connect replay, and the perf-mode gating split
//     (switch/next NOT gated, create/delete/rename gated 409).
//   - the SYNC SURFACE: /global-effect-slots/status carries effectsPage +
//     per-slot intensity + mode; a /ws/control subscriber receives the
//     effectsPage + globalEffectMacroStatus broadcasts.
//   - persistence: the page survives written state (global_effect_slots.yaml).
//
// Layout DEPLOY is config-gated OFF (default) so this test NEVER spawns the
// VSN1 deploy child process — it only asserts the layout YAML is written.
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
  assert.equal(r.data.layout.pageCount, undefined, 'pageCount removed (D8)');
  assert.equal(r.data.layout.slotsPerPage, 8);
  assert.ok(Array.isArray(r.data.layout.slots));
  // Deploy is config-gated OFF by default → status reflects that (no spawn).
  assert.ok(r.data.deploy);
  assert.equal(r.data.deploy.enabled, false);
});

test('a slot layout change (PATCH slot) writes the layout YAML but does NOT deploy', async () => {
  const r = await api('PATCH', '/global-effect-slots/20', {
    enabled: true, label: 'Party Sparkle', effectId: 'sparkle', presetId: 'fizz', behavior: 'toggle', color: '#8ef',
  });
  assert.equal(r.status, 200);
  // The deploy hook writes the layout YAML on any layout change (even disabled);
  // v3 switched the artifact from vsn1_layout.json to vsn1_layout.yaml.
  const layoutFile = path.join(stateDir, 'vsn1_layout.yaml');
  await new Promise(res => setTimeout(res, 300)); // let the async hook flush
  assert.ok(fs.existsSync(layoutFile), 'vsn1_layout.yaml written on layout change');
  const layout = yaml.load(fs.readFileSync(layoutFile, 'utf8'));
  assert.ok(layout.slots.find(s => s.slotId === 20 && s.effectId === 'sparkle'));
  assert.ok(!fs.existsSync(path.join(stateDir, 'vsn1_layout.json')), 'no stale JSON artifact remains');
  // Still disabled → deploy status stays 'disabled', never 'ok'/'error'.
  const st = await api('GET', '/global-effects/layout');
  assert.equal(st.data.deploy.lastResult, 'disabled');
});

// ── Named effect BANKS (v3) ──────────────────────────────────────────

test('GET /global-effects/banks returns the ordered bank meta + active id (one edit bank by default)', async () => {
  const r = await api('GET', '/global-effects/banks');
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.data.banks));
  assert.equal(r.data.banks[0].id, 'edit');
  assert.equal(typeof r.data.banks[0].slotCount, 'number');
  assert.equal(r.data.activeBankId, 'edit');
});

test('POST /global-effects/banks creates an auto-named empty bank + broadcasts effectBanks', async () => {
  const conn = collectWs(['effectBanks'], (seen) => seen.some(m => m.banks.some(b => b.id === 'bank_1')), 4000);
  const { ws, seen, timer } = await conn;
  const r = await api('POST', '/global-effects/banks', {});
  assert.equal(r.status, 200);
  assert.equal(r.data.bank.id, 'bank_1');
  assert.equal(r.data.bank.name, 'Bank 1');
  assert.equal(r.data.bank.slotCount, 0);
  await new Promise(res => setTimeout(res, 200));
  clearTimeout(timer); try { ws.close(); } catch {}
  assert.ok(seen.length >= 1, 'effectBanks broadcast on create');
  // GET reflects the new bank.
  const g = await api('GET', '/global-effects/banks');
  assert.ok(g.data.banks.some(b => b.id === 'bank_1'));
});

test('PATCH /global-effects/banks/active switches + broadcasts effectBanks + persists v3', async () => {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/control`);
  const bcPromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { ws.close(); reject(new Error('no effectBanks broadcast')); }, 4000);
    ws.on('message', (buf) => {
      let m; try { m = JSON.parse(buf.toString()); } catch { return; }
      // Skip the connect-replay (active 'edit'); wait for the switch to bank_1.
      if (m.type === 'effectBanks' && m.activeBankId === 'bank_1') {
        clearTimeout(timer); ws.close(); resolve(m);
      }
    });
    ws.on('error', (e) => { clearTimeout(timer); reject(e); });
  });
  await new Promise((resolve, reject) => { ws.on('open', resolve); ws.on('error', reject); });

  const r = await api('PATCH', '/global-effects/banks/active', { bankId: 'bank_1', source: 'test' });
  assert.equal(r.status, 200);
  assert.equal(r.data.activeBankId, 'bank_1');
  assert.ok(Array.isArray(r.data.triggeredPages), 'response carries triggeredPages');

  const bc = await bcPromise;
  assert.equal(bc.activeBankId, 'bank_1', 'switch broadcast on /ws/control');
  assert.equal(bc.source, 'test', 'source tag echoed on the broadcast');

  // Persisted to disk (v3 shape).
  const file = path.join(stateDir, 'global_effect_slots.yaml');
  const onDisk = yaml.load(fs.readFileSync(file, 'utf8'));
  assert.equal(onDisk.version, 3, 'file is v3');
  assert.equal(onDisk.activeBankId, 'bank_1', 'active bank persisted');
  assert.ok(Array.isArray(onDisk.banks) && onDisk.banks.length >= 2, 'banks array persisted');
  assert.ok(!('slots' in onDisk), 'no legacy top-level slots key');
  assert.ok(!('profiles' in onDisk), 'no legacy v2 profiles key');
});

test('PATCH /global-effects/banks/active rejects an unknown id (400, fail loud, no change)', async () => {
  const r = await api('PATCH', '/global-effects/banks/active', { bankId: 'ghost' });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /unknown bank id/);
  const g = await api('GET', '/global-effects/banks');
  assert.equal(g.data.activeBankId, 'bank_1', 'a 400 leaves the active bank unchanged');
});

test('PATCH /global-effects/banks/active broadcasts globalEffectMacroStatus (grid content swap)', async () => {
  await api('PATCH', '/global-effects/banks/active', { bankId: 'edit' }); // known start
  const conn = collectWs(['globalEffectMacroStatus'], (seen) => seen.length >= 1, 4000);
  const { ws, seen, timer } = await conn;
  const r = await api('PATCH', '/global-effects/banks/active', { bankId: 'bank_1' });
  assert.equal(r.status, 200);
  await new Promise(res => setTimeout(res, 300));
  clearTimeout(timer); try { ws.close(); } catch {}
  assert.ok(seen.length >= 1, 'globalEffectMacroStatus fired on bank switch');
  assert.ok(Array.isArray(seen[0].slots), 'carries the new bank slot-status array');
});

test('POST /global-effects/banks/next cycles + wraps + broadcasts effectBanks', async () => {
  // Order is [edit, bank_1]; start on edit.
  await api('PATCH', '/global-effects/banks/active', { bankId: 'edit' });
  const conn = collectWs(['effectBanks'], (seen) => seen.some(m => m.activeBankId === 'bank_1'), 4000);
  const { ws, seen, timer } = await conn;
  const r = await api('POST', '/global-effects/banks/next', { source: 'sb_2' });
  assert.equal(r.status, 200);
  assert.equal(r.data.activeBankId, 'bank_1', 'edit → bank_1 (next in order)');
  assert.equal(r.data.count, 2);
  await new Promise(res => setTimeout(res, 200));
  clearTimeout(timer); try { ws.close(); } catch {}
  assert.ok(seen.some(m => m.activeBankId === 'bank_1'), 'next broadcast effectBanks');
  // Wrap: bank_1 → edit.
  const r2 = await api('POST', '/global-effects/banks/next', {});
  assert.equal(r2.data.activeBankId, 'edit', 'wraps back to the first bank');
});

test('a slot edit lands ONLY under the active bank on disk', async () => {
  await api('POST', '/performance-mode', { active: false, exitAction: 'keep' });
  await api('PATCH', '/global-effects/banks/active', { bankId: 'edit' });
  const label = `EDIT-BANK-ONLY-${Date.now()}`;
  const r = await api('PATCH', '/global-effect-slots/1', { label });
  assert.equal(r.status, 200);

  const file = path.join(stateDir, 'global_effect_slots.yaml');
  const onDisk = yaml.load(fs.readFileSync(file, 'utf8'));
  const editBank = onDisk.banks.find(b => b.id === 'edit');
  const otherBank = onDisk.banks.find(b => b.id === 'bank_1');
  assert.equal(editBank.slots.find(s => s.slotId === 1).label, label, 'edit (active) bank got the rename');
  // bank_1 was created empty → slot 1 not present, so the rename can't be there.
  assert.ok(!otherBank.slots.some(s => s.slotId === 1 && s.label === label),
    'the inactive bank did NOT get the rename');
});

test('a fresh /ws/control subscriber gets effectBanks replayed on connect', async () => {
  const conn = collectWs(['effectBanks'], (seen) => seen.length >= 1, 4000);
  const { ws, seen, timer } = await conn;
  await new Promise(res => setTimeout(res, 300));
  clearTimeout(timer); try { ws.close(); } catch {}
  assert.ok(seen.length >= 1, 'effectBanks replayed on connect');
  assert.ok(Array.isArray(seen[0].banks) && seen[0].banks.some(b => b.id === 'edit'),
    'replay carries the ordered bank list');
  assert.equal(typeof seen[0].activeBankId, 'string', 'replay carries the active id');
});

// ── Performance-mode gating: switch/next NOT gated, create/delete/rename ARE ─

test('bank SWITCH + NEXT are NOT performance-mode-gated (they are performance actions)', async () => {
  const enter = await api('POST', '/performance-mode', { active: true });
  const entered = enter.status === 200;
  try {
    const sw = await api('PATCH', '/global-effects/banks/active', { bankId: 'bank_1' });
    assert.equal(sw.status, 200, 'bank switch must be allowed during performance mode');
    const nx = await api('POST', '/global-effects/banks/next', {});
    assert.equal(nx.status, 200, 'bank next must be allowed during performance mode');
  } finally {
    if (entered) await api('POST', '/performance-mode', { active: false, exitAction: 'keep' });
    await api('PATCH', '/global-effects/banks/active', { bankId: 'edit' });
  }
});

test('bank CREATE / DELETE / RENAME ARE performance-mode-gated (409)', async () => {
  const enter = await api('POST', '/performance-mode', { active: true });
  const entered = enter.status === 200;
  try {
    const create = await api('POST', '/global-effects/banks', {});
    assert.equal(create.status, 409, 'create is structural → 409 under perf mode');
    const rename = await api('PATCH', '/global-effects/banks/bank_1', { name: 'X' });
    assert.equal(rename.status, 409, 'rename is structural → 409 under perf mode');
    const del = await api('DELETE', '/global-effects/banks/bank_1');
    assert.equal(del.status, 409, 'delete is structural → 409 under perf mode');
  } finally {
    if (entered) await api('POST', '/performance-mode', { active: false, exitAction: 'keep' });
  }
});

test('PATCH /global-effects/banks/:id renames a bank + broadcasts effectBanks', async () => {
  await api('POST', '/performance-mode', { active: false, exitAction: 'keep' });
  const r = await api('PATCH', '/global-effects/banks/bank_1', { name: 'Party' });
  assert.equal(r.status, 200);
  assert.equal(r.data.bank.name, 'Party');
  const g = await api('GET', '/global-effects/banks');
  assert.equal(g.data.banks.find(b => b.id === 'bank_1').name, 'Party');
});

test('DELETE the LAST bank is refused (409, >= 1 invariant)', async () => {
  await api('POST', '/performance-mode', { active: false, exitAction: 'keep' });
  // Reduce to a single bank first: ensure edit is active, delete bank_1.
  await api('PATCH', '/global-effects/banks/active', { bankId: 'edit' });
  await api('DELETE', '/global-effects/banks/bank_1');
  const g = await api('GET', '/global-effects/banks');
  assert.equal(g.data.banks.length, 1, 'down to a single bank');
  const del = await api('DELETE', '/global-effects/banks/edit');
  assert.equal(del.status, 409, 'the last bank cannot be deleted');
  assert.match(del.data.error, /last bank/);
});

test('DELETE an unknown bank id returns 404', async () => {
  await api('POST', '/performance-mode', { active: false, exitAction: 'keep' });
  const del = await api('DELETE', '/global-effects/banks/ghost');
  assert.equal(del.status, 404);
});

test('deleting the ACTIVE bank activates the next in order (full switch side effects)', async () => {
  await api('POST', '/performance-mode', { active: false, exitAction: 'keep' });
  // Rebuild a two-bank order: edit + a fresh bank; make the fresh one active.
  await api('POST', '/global-effects/banks', {}); // bank_1 again (edit is the only bank now)
  await api('PATCH', '/global-effects/banks/active', { bankId: 'bank_1' });
  const del = await api('DELETE', '/global-effects/banks/bank_1');
  assert.equal(del.status, 200);
  assert.equal(del.data.activeBankId, 'edit', 'successor became active');
  assert.ok(Array.isArray(del.data.triggeredPages), 'active-delete carries triggeredPages');
  const g = await api('GET', '/global-effects/banks');
  assert.equal(g.data.activeBankId, 'edit');
});
