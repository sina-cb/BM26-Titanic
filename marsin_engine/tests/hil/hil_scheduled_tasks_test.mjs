/**
 * hil_scheduled_tasks_test.mjs — HIL coverage for the engine-owned
 * scheduler service v3 (docs/31_scheduled_tasks.md).
 *
 * Boots the engine on the slot's port (default 31268 via ENGINE_PORT
 * env), exercises every endpoint, asserts:
 *   - 6 REST endpoints round-trip
 *   - validation: missing effectId / off-preset values → HTTP 400
 *   - YAML persistence: scheduled_tasks.yaml written, contains only
 *     operator-authored fields (NO slotId, NO runtime fields)
 *   - scheduledTasks WS broadcasts arrive on /ws/control with the
 *     v3 payload shape (effectId/presetId/params, NO slotId)
 *   - end-to-end fire: with a 1s-on / 30s-interval task and FIRE NOW,
 *     the task transitions to status='firing', then back to 'armed'
 *     inside ~2 s.
 *
 * Default state hygiene: snapshots every state file the test may
 * touch and restores them in `finally`. The new scheduled_tasks.yaml
 * is deleted on restore so the worktree's git diff stays clean.
 *
 * Run (after `npm install` in marsin_engine):
 *   ENGINE_PORT=31268 node tests/hil/hil_scheduled_tasks_test.mjs
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { WebSocket } from 'ws';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const ENGINE_ROOT = path.resolve(__dirname, '..', '..');
const PORT = parseInt(process.env.ENGINE_PORT || '31268', 10);
const BASE = `http://127.0.0.1:${PORT}`;
const WS_CONTROL = `ws://127.0.0.1:${PORT}/ws/control`;

const STATE_DIR = path.join(ENGINE_ROOT, 'states', 'test_bench');
const SCHED_YAML = path.join(STATE_DIR, 'scheduled_tasks.yaml');

// Files the test may dirty. Snapshot + restore so `git status` stays
// clean after the run regardless of outcome.
const STATE_FILES = [
  'deck_state.yaml',
  'mixer_state.yaml',
  'globals_state.yaml',
  'global_effect_slots.yaml',
  'audio_state.yaml',
];

const stateSnapshot = {};
function snapshotState() {
  for (const f of STATE_FILES) {
    const p = path.join(STATE_DIR, f);
    if (fs.existsSync(p)) stateSnapshot[f] = fs.readFileSync(p);
  }
}
function restoreState() {
  for (const f of STATE_FILES) {
    if (stateSnapshot[f] !== undefined) {
      try { fs.writeFileSync(path.join(STATE_DIR, f), stateSnapshot[f]); }
      catch (e) { console.warn(`restore ${f} failed:`, e.message); }
    }
  }
  // The scheduler creates a brand-new file. Nuke it on restore so the
  // tree stays clean.
  if (fs.existsSync(SCHED_YAML)) {
    try { fs.unlinkSync(SCHED_YAML); }
    catch (e) { console.warn('unlink scheduled_tasks.yaml failed:', e.message); }
  }
}

// ── HTTP helper ──────────────────────────────────────────────────────
function httpReq(method, urlPath, body = null) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlPath, BASE);
    const opts = {
      method,
      hostname: u.hostname,
      port: u.port,
      path: u.pathname + (u.search || ''),
      headers: { 'Content-Type': 'application/json' },
    };
    const req = http.request(opts, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        let parsed = data;
        try { parsed = JSON.parse(data); } catch { /* keep raw */ }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    if (body !== null) req.write(JSON.stringify(body));
    req.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── engine lifecycle ────────────────────────────────────────────────
let engineProc = null;
function startEngine() {
  return new Promise((resolve, reject) => {
    const logPath = `/tmp/hil_scheduled_tasks_${PORT}.log`;
    const out = fs.openSync(logPath, 'w');
    const err = fs.openSync(logPath, 'a');
    engineProc = spawn(
      process.execPath,
      [
        path.join(ENGINE_ROOT, 'engine.js'),
        '--pattern', 'test_const',
        '--model', 'test_bench',
        '--port', String(PORT),
      ],
      { cwd: ENGINE_ROOT, stdio: ['ignore', out, err] }
    );
    engineProc.once('error', reject);
    engineProc.once('exit', (code) => {
      if (code !== 0 && code !== null) {
        console.error(`engine exited with code ${code}. See ${logPath}`);
      }
    });
    const deadline = Date.now() + 20000;
    (async () => {
      while (Date.now() < deadline) {
        try {
          const r = await httpReq('GET', '/status');
          if (r.status === 200) return resolve(logPath);
        } catch { /* not yet */ }
        await sleep(250);
      }
      reject(new Error(`engine did not come up on ${PORT} within 20s. See ${logPath}`));
    })();
  });
}

function stopEngine() {
  return new Promise((resolve) => {
    if (!engineProc || engineProc.killed) return resolve();
    engineProc.once('exit', () => resolve());
    engineProc.kill('SIGTERM');
    setTimeout(() => {
      if (engineProc && !engineProc.killed) {
        try { engineProc.kill('SIGKILL'); } catch { /* ignore */ }
      }
      resolve();
    }, 3000);
  });
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.once(sig, async () => {
    console.error(`\nReceived ${sig}; stopping engine + restoring state...`);
    try { await stopEngine(); } catch { /* ignore */ }
    restoreState();
    process.exit(sig === 'SIGINT' ? 130 : 143);
  });
}

// ── result tracking ─────────────────────────────────────────────────
const results = [];
function ok(label)            { console.log('  ✓ PASS  ' + label); results.push(true); }
function fail(label, detail)  { console.log('  ✗ FAIL  ' + label + (detail ? '  → ' + detail : '')); results.push(false); }
function check(cond, p, f, d) { if (cond) ok(p); else fail(f || p, d); }

// ── WS broadcast collector ──────────────────────────────────────────
function openControlWS() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_CONTROL);
    const collected = [];
    ws.on('open', () => resolve({ ws, collected }));
    ws.on('error', reject);
    ws.on('message', (raw) => {
      try {
        const obj = JSON.parse(raw.toString());
        if (obj && obj.type === 'scheduledTasks') collected.push(obj);
      } catch { /* ignore non-JSON */ }
    });
  });
}

// ── tests ───────────────────────────────────────────────────────────
async function main() {
  console.log('==========================================================');
  console.log('hil_scheduled_tasks_test.mjs — engine-owned scheduler v3');
  console.log(`  engine: ${BASE}`);
  console.log('==========================================================');

  snapshotState();
  await startEngine();
  console.log(`Engine up on ${BASE}\n`);

  let createdId = null;
  let ws = null;

  try {
    // Open WS to capture broadcasts
    const opened = await openControlWS();
    ws = opened.ws;
    const collected = opened.collected;
    await sleep(200);

    // ── TEST 1: GET /scheduled-tasks on cold engine returns []
    console.log('\n[TEST 1] GET /scheduled-tasks on cold engine');
    {
      const r = await httpReq('GET', '/scheduled-tasks');
      check(r.status === 200, 'GET returns 200');
      check(Array.isArray(r.body.tasks) && r.body.tasks.length === 0,
        'tasks: [] on first boot',
        'expected empty task list', JSON.stringify(r.body));
      check(Array.isArray(r.body.presets && r.body.presets.onDurationMs)
            && Array.isArray(r.body.presets && r.body.presets.intervalMs),
        'response exposes preset arrays for the UI');
    }

    // ── TEST 2: POST creates a task (v3 body shape), persists to disk
    console.log('\n[TEST 2] POST /scheduled-tasks creates + persists (v3 body)');
    {
      const r = await httpReq('POST', '/scheduled-tasks', {
        label: 'Hazer HIL',
        effectId: 'fogger',
        presetId: 'default',
        params: { intensity: 0.85 },
        enabled: true,
        mode: 'duration',
        onDurationMs: 10_000,
        intervalMs: 60_000,
      });
      check(r.status === 201, 'POST returns 201', 'unexpected status', JSON.stringify(r.body));
      check(r.body && r.body.task && typeof r.body.task.id === 'string',
        'response includes task.id');
      check(r.body.task.effectId === 'fogger' && r.body.task.presetId === 'default',
        'response carries effectId/presetId');
      check(!('slotId' in r.body.task),
        'response does NOT carry slotId (v3)');
      createdId = r.body.task.id;

      check(fs.existsSync(SCHED_YAML), 'scheduled_tasks.yaml created on disk',
        'YAML not written', SCHED_YAML);
      const onDisk = fs.readFileSync(SCHED_YAML, 'utf8');
      // Only operator-authored fields should be in YAML
      const runtimeKeys = ['nextFireAtMs', 'firingUntilMs', 'lastFiredAtMs',
        'lastStoppedAtMs', 'status', 'lastError', 'lastMissedAtMs',
        'createdAtMs', 'updatedAtMs'];
      const leakedKeys = runtimeKeys.filter(k => onDisk.includes(`${k}:`));
      check(leakedKeys.length === 0,
        'YAML contains only operator-authored fields',
        `runtime fields leaked: ${leakedKeys.join(',')}`);
      check(!onDisk.includes('slotId:'),
        'YAML does NOT contain slotId (v3)');
      check(onDisk.includes('effectId: fogger'), 'YAML contains effectId');
      check(onDisk.includes('presetId: default'), 'YAML contains presetId');

      // Broadcast should have landed
      await sleep(150);
      check(collected.length >= 1, 'scheduledTasks WS broadcast received after create',
        'no broadcast received', JSON.stringify(collected));
      const latest = collected[collected.length - 1];
      check(latest && latest.type === 'scheduledTasks' && Array.isArray(latest.tasks),
        'broadcast shape: { type: "scheduledTasks", tasks: [...] }');
      const wsTask = latest.tasks[0];
      check(wsTask && wsTask.effectId === 'fogger' && wsTask.presetId === 'default',
        'WS broadcast task carries effectId/presetId (v3 payload)');
      check(wsTask && !('slotId' in wsTask),
        'WS broadcast task does NOT carry slotId');
    }

    // ── TEST 3: Validation rejections (codex P0)
    console.log('\n[TEST 3] validation rejections (codex P0)');
    {
      const r1 = await httpReq('POST', '/scheduled-tasks', {
        label: 'bad on', effectId: 'fogger', presetId: 'default',
        enabled: true, mode: 'duration',
        onDurationMs: 9_999, intervalMs: 60_000,
      });
      check(r1.status === 400 && /onDurationMs must be one of/.test(r1.body.error || ''),
        'off-preset onDurationMs → 400 (no clamping)',
        'unexpected', `${r1.status} ${JSON.stringify(r1.body)}`);

      const r2 = await httpReq('POST', '/scheduled-tasks', {
        label: 'bad int', effectId: 'fogger', presetId: 'default',
        enabled: true, mode: 'duration',
        onDurationMs: 10_000, intervalMs: 45_000,
      });
      check(r2.status === 400 && /intervalMs must be one of/.test(r2.body.error || ''),
        'off-preset intervalMs → 400 (no clamping)');

      const r3 = await httpReq('POST', '/scheduled-tasks', {
        label: 'bad mode', effectId: 'fogger', presetId: 'default',
        enabled: true, mode: 'trigger',
        onDurationMs: 10_000, intervalMs: 60_000,
      });
      check(r3.status === 400 && /mode must be 'duration'/.test(r3.body.error || ''),
        'mode !== "duration" → 400');

      // v3: missing effectId/presetId pair → 400
      const r4 = await httpReq('POST', '/scheduled-tasks', {
        label: 'no effect', presetId: 'default',
        enabled: true, mode: 'duration',
        onDurationMs: 10_000, intervalMs: 60_000,
      });
      check(r4.status === 400 && /effectId/.test(r4.body.error || ''),
        'POST without effectId → 400');

      const r5 = await httpReq('POST', '/scheduled-tasks', {
        label: 'no preset', effectId: 'fogger',
        enabled: true, mode: 'duration',
        onDurationMs: 10_000, intervalMs: 60_000,
      });
      check(r5.status === 400 && /presetId/.test(r5.body.error || ''),
        'POST without presetId → 400');

      // v3: unknown effectId in the library → 400
      const r6 = await httpReq('POST', '/scheduled-tasks', {
        label: 'ghost', effectId: 'nonExistentEffect', presetId: 'default',
        enabled: true, mode: 'duration',
        onDurationMs: 10_000, intervalMs: 60_000,
      });
      check(r6.status === 400 && /unknown effectId 'nonExistentEffect'/.test(r6.body.error || ''),
        'POST against non-existent effectId → 400');

      // v3: PATCH of effectId without presetId → 400
      const r7 = await httpReq('PATCH', `/scheduled-tasks/${createdId}`, {
        effectId: 'uvBlast',
      });
      check(r7.status === 400 && /patched together/.test(r7.body.error || ''),
        'PATCH effectId only → 400 (must come with presetId)');

      const r8 = await httpReq('PATCH', `/scheduled-tasks/${createdId}`, {
        presetId: 'default',
      });
      check(r8.status === 400 && /patched together/.test(r8.body.error || ''),
        'PATCH presetId only → 400 (must come with effectId)');
    }

    // ── TEST 4: PATCH updates operator fields, rejects runtime fields
    console.log('\n[TEST 4] PATCH operator-authored fields only');
    {
      const r = await httpReq('PATCH', `/scheduled-tasks/${createdId}`, {
        label: 'Hazer HIL Renamed',
        intervalMs: 30_000,
      });
      check(r.status === 200, 'PATCH returns 200', 'unexpected', JSON.stringify(r.body));
      check(r.body.task.label === 'Hazer HIL Renamed', 'label updated');
      check(r.body.task.intervalMs === 30_000, 'intervalMs updated');

      const bad = await httpReq('PATCH', `/scheduled-tasks/${createdId}`, {
        firingUntilMs: 0,
      });
      check(bad.status === 400 && /not patchable/.test(bad.body.error || ''),
        'attempting to PATCH runtime field → 400');

      // v3: swap effectId+presetId together
      const swap = await httpReq('PATCH', `/scheduled-tasks/${createdId}`, {
        effectId: 'uvBlast', presetId: 'default',
      });
      check(swap.status === 200
            && swap.body.task.effectId === 'uvBlast'
            && swap.body.task.presetId === 'default',
        'PATCH effectId+presetId together swaps the library binding');

      // restore
      await httpReq('PATCH', `/scheduled-tasks/${createdId}`, {
        effectId: 'fogger', presetId: 'default',
      });
    }

    // ── TEST 5: FIRE NOW + status transitions to firing → armed
    console.log('\n[TEST 5] FIRE NOW transitions task firing → armed');
    {
      // Shorten the ON window so the test doesn't take 10 s
      const p = await httpReq('PATCH', `/scheduled-tasks/${createdId}`, {
        onDurationMs: 1_000,
      });
      check(p.status === 200, 'PATCH onDurationMs to 1s for fast assertion');

      const before = collected.length;
      const r = await httpReq('POST', `/scheduled-tasks/${createdId}/fire-now`);
      check(r.status === 200 && r.body.task.status === 'firing',
        'fire-now → 200, task.status="firing"',
        'unexpected', JSON.stringify(r.body));

      await sleep(150);
      check(collected.length > before, 'broadcast emitted after fire-now');

      await sleep(2_000);

      const after = await httpReq('GET', '/scheduled-tasks');
      const task = after.body.tasks.find(t => t.id === createdId);
      check(task && task.status === 'armed',
        'task status returns to "armed" after onDurationMs',
        'task did not re-arm', JSON.stringify(task));
      check(task && task.firingUntilMs === null,
        'firingUntilMs cleared after ON window closes');
    }

    // ── TEST 6: stop endpoint force-closes a firing task
    console.log('\n[TEST 6] stop endpoint force-closes ON window');
    {
      await httpReq('PATCH', `/scheduled-tasks/${createdId}`, { onDurationMs: 10_000 });
      const f = await httpReq('POST', `/scheduled-tasks/${createdId}/fire-now`);
      check(f.body.task.status === 'firing', 'fired again to test stop');
      const s = await httpReq('POST', `/scheduled-tasks/${createdId}/stop`);
      check(s.status === 200 && s.body.task.firingUntilMs === null,
        'stop returns 200 with firingUntilMs=null');
      check(s.body.task.status === 'armed' && s.body.task.enabled === true,
        'stop keeps task enabled and re-arms');
    }

    // ── TEST 7: DELETE removes the task and rewrites YAML
    console.log('\n[TEST 7] DELETE removes task');
    {
      const r = await httpReq('DELETE', `/scheduled-tasks/${createdId}`);
      check(r.status === 200 && r.body.ok === true, 'DELETE returns { ok: true }');
      const g = await httpReq('GET', '/scheduled-tasks');
      check(g.body.tasks.length === 0, 'task list is empty after DELETE',
        'unexpected', JSON.stringify(g.body));
      const onDisk = fs.readFileSync(SCHED_YAML, 'utf8');
      check(/scheduledTasks:\s*\[\]/.test(onDisk) || /scheduledTasks: \[\]/.test(onDisk),
        'YAML now reflects empty list');
    }

  } finally {
    try { if (ws) ws.close(); } catch { /* ignore */ }
    try { await stopEngine(); } catch { /* ignore */ }
    restoreState();
  }

  const passed = results.filter(Boolean).length;
  const failed = results.length - passed;
  console.log(`\n========== ${passed} passed, ${failed} failed ==========`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error('FATAL:', err);
  try { await stopEngine(); } catch { /* ignore */ }
  restoreState();
  process.exit(2);
});
