// Regression pin for the boot-time port cleanup scope (live dev-stack
// outages, 2026-07-07/08): engine.js frees "our own port" before binding,
// but it used to push `engineConfig.server.port` (config.yaml, :6968) even
// when `--port` selected a different port. Every test-spawned engine
// (tests/playlist_api.test.js spawns three on random :69xx ports) therefore
// identity-matched and KILLED the live dev-stack engine on :6968 while the
// full `npm test` suite ran — a silent, deterministic outage.
//
// The rule is: kill only what THIS boot will replace — `opts.port`, the
// port that will actually be bound (which defaults to config.yaml's
// server.port when --port is absent, so normal boots are unchanged).
//
// This is a source-level pin (same technique as
// channel_param_isolation.test.js): freeStackPorts kills real processes,
// so exercising it live from a unit test is exactly the footgun we're
// preventing. Pinning the decision in source keeps the regression from
// quietly returning.
//
// Run:  cd marsin_engine && node --test tests/engine_port_kill_scope.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const engineSource = fs.readFileSync(path.join(__dirname, '..', '..', 'engine.js'), 'utf8');

/** The port-cleanup block: from the portsToKill declaration to freeStackPorts. */
function portCleanupBlock() {
  const start = engineSource.indexOf('const portsToKill');
  assert.ok(start >= 0, 'engine.js must still declare portsToKill');
  const end = engineSource.indexOf('freeStackPorts(portsToKill', start);
  assert.ok(end > start, 'portsToKill must feed freeStackPorts');
  return engineSource.slice(start, end);
}

test('boot port cleanup kills opts.port (the port this boot binds)', () => {
  const block = portCleanupBlock();
  assert.match(block, /portsToKill\.push\(opts\.port\)/,
    'portsToKill must contain opts.port — the port THIS boot will bind');
});

test('boot port cleanup never targets the config-file port directly', () => {
  const block = portCleanupBlock();
  assert.ok(!block.includes('engineConfig.server'),
    'portsToKill must NOT read engineConfig.server.port — a --port boot ' +
    'would kill the live engine on the config port (:6968) it is not replacing');
});
