/**
 * shutdown_ordering.test.js — boot/shutdown ordering + blackout count
 * (catalog `.agent/reports/202608/20260805_162_engine_test_gap_catalog.md`
 * G-7, rank 9).
 *
 * `engine.js:2483-2556` (`shutdown()`): input sources are stopped BEFORE the
 * sACN sender; a single blackout frame is sent once before `sacnOut.stop()`.
 * `engine.js:1747-1763` (hot-reload): a universe the reloaded model no
 * longer references gets a 3x-repeated all-zero blackout (the sACN stream-
 * termination convention) before it's dropped from `universeIds`.
 * `engine_port_kill_scope.test.js` only covers port hygiene;
 * `scene_reload_api.test.js` covers the `/scene/reload` API's refusal
 * semantics, not the stale-universe blackout bytes.
 *
 * SCOPE CUT, disclosed: BOTH halves of this file ended up STRUCTURAL
 * (source-order/shape assertions on engine.js), not live spawned-process
 * proofs, for two independent reasons found while implementing this spec:
 *
 *   1. The stale-universe blackout (1747-1763) fires from the model-FILE
 *      watcher (`fs.watch(modelsDir, ...)`, `modelsDir` is the real,
 *      hardcoded `marsin_engine/models/` — not overridable via env).
 *      Proving it live would require writing a throwaway model file into
 *      that SHARED, TRACKED directory while an engine watches it — every
 *      other engine process on this machine (including other
 *      concurrently-running agents' spawned engines) watches the same
 *      directory, so a stray write there is a cross-agent side effect this
 *      suite must not risk.
 *
 *   2. The shutdown() ordering (2483-2556) is only reachable via
 *      `process.on('SIGINT'|'SIGTERM', ...)`. Attempted BOTH
 *      `childProc.kill('SIGINT')` and `.kill('SIGTERM')` against a real
 *      spawned engine on this Windows box: both return `{code: null,
 *      signal: 'SIGTERM'/'SIGINT'}` with none of the shutdown log lines
 *      ever printed — Node's own docs confirm why ("Sending signals to
 *      processes is not as standardized... on Windows... the signal
 *      argument will be ignored, and the process will be killed forcefully
 *      and abruptly"). There is no HTTP shutdown endpoint to fall back to
 *      (grep-verified: no `/shutdown` or `/stop` route in api_server.js),
 *      and no other test in this tree signals a spawned engine this way
 *      either (grep-verified at test-write time). A live proof needs either
 *      a POSIX CI runner or a new HTTP shutdown route (production change,
 *      out of scope here).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENGINE_JS = path.resolve(__dirname, '..', '..', 'engine.js');

test('structural: shutdown() stops audio/OSC/fire-sync/watcher/timeline BEFORE sacnOut.stop() (engine.js:2483-2556)', () => {
  const src = fs.readFileSync(ENGINE_JS, 'utf8');
  const shutdownStart = src.indexOf('function shutdown(afterClose = null)');
  assert.ok(shutdownStart > 0, 'shutdown() function not found — has it moved/renamed?');
  const shutdownEnd = src.indexOf('\n  process.on(\'SIGINT\'', shutdownStart);
  assert.ok(shutdownEnd > shutdownStart, 'could not find the end of shutdown() (SIGINT registration)');
  const body = src.slice(shutdownStart, shutdownEnd);

  const idx = (needle) => {
    const i = body.indexOf(needle);
    assert.ok(i >= 0, `expected to find '${needle}' inside shutdown()`);
    return i;
  };
  const audioStop = idx('audioState.capture.stop()');
  const oscStop = idx('lOsc.stop()');
  const fireSyncStop = idx('fireSyncState.listener.stop()');
  const loopStop = idx('loop.stop()');
  const apiClose = idx('apiServer.closeNow');
  const sacnStop = idx('sacnOut.stop()');

  assert.ok(audioStop < sacnStop, 'audio capture must stop before sacnOut.stop()');
  assert.ok(oscStop < sacnStop, 'OSC listener must stop before sacnOut.stop()');
  assert.ok(fireSyncStop < sacnStop, 'fire-sync listener must stop before sacnOut.stop()');
  assert.ok(loopStop < sacnStop, 'render loop must stop before sacnOut.stop()');
  assert.ok(apiClose < sacnStop, 'API server must close before sacnOut.stop()');
  // Every input source precedes the render loop stop too (inputs first,
  // THEN the thing consuming their output).
  assert.ok(audioStop < loopStop && oscStop < loopStop && fireSyncStop < loopStop,
    'inputs must stop before the render loop that consumes them');
});

test('structural: exactly ONE shutdown blackout send today (blocked-on S-D10: flips to 3x)', () => {
  const src = fs.readFileSync(ENGINE_JS, 'utf8');
  const shutdownStart = src.indexOf('function shutdown(afterClose = null)');
  const shutdownEnd = src.indexOf('\n  process.on(\'SIGINT\'', shutdownStart);
  const body = src.slice(shutdownStart, shutdownEnd);
  const sendFrameCalls = body.match(/sacnOut\.sendFrame(?:Checked)?\(/g) || [];
  assert.equal(sendFrameCalls.length, 1,
    'shutdown() must send the blackout exactly once today — if this count ' +
    'changed, either S-D10 (3x shutdown blackout) landed (update this test to 3 ' +
    'and flip R-D10) or there is an unrelated regression');
  // The blackout uses the CHECKED send: `sendFrame` is fire-and-forget (a
  // rejected datagram is only rate-limit-logged), which cannot confirm the
  // last frame the rig ever gets actually left. Whole-universe zeroing +
  // confirmation live in lib/shutdown_blackout.js (report 20260823_361 §8);
  // tests/io/shutdown_blackout.test.js is the behavioural proof.
  assert.deepEqual(sendFrameCalls, ['sacnOut.sendFrameChecked('],
    'the shutdown blackout must go out through sendFrameChecked so a failed ' +
    'delivery is reported instead of assumed');
});

test('structural: the stale-universe hot-reload blackout is a 3x repeat with a naming log line (engine.js:1747-1763)', () => {
  // See file header SCOPE CUT — pinned by reading the code, not by
  // triggering a live file-watcher reload (which would require writing into
  // the shared, tracked models/ directory that other concurrently-running
  // engines also watch).
  const src = fs.readFileSync(ENGINE_JS, 'utf8');
  const marker = 'Universes the new mapping no longer references must go DARK';
  const start = src.indexOf(marker);
  assert.ok(start >= 0, 'the stale-universe blackout block moved or was rewritten — re-locate it');
  const block = src.slice(start, start + 2000);
  assert.match(block, /for \(let _i = 0; _i < 3; _i\+\+\) \{\s*sacnOut\.sendFrame\(\{ \[staleU\]: staleFrame \}\);/,
    'expected a literal 3x sacnOut.sendFrame loop per the sACN stream-termination convention');
  assert.match(block, /no longer mapped — sent blackout, stopped transmitting/,
    'expected the naming log line that identifies the dropped universe');
  assert.match(block, /universeIds\.splice\(i, 1\);/,
    'the universe must be dropped from universeIds AFTER the blackout, not before');
});
