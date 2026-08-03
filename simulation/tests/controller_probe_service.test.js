/**
 * controller_probe_service.test.js — server-side ONLINE / OFFLINE / UNKNOWN
 * reachability for every controller card (operator request 2026-07-31; report
 * 20260725_96).
 *
 * Two layers are covered:
 *   - CLASSIFICATION, with injected transports: every error class maps to the
 *     right state, and `unknown` is never collapsed into `offline`.
 *   - REAL SOCKETS, against LOOPBACK stubs this test stands up itself, plus the
 *     documented-unroutable TEST-NET-1 block (192.0.2.0/24, RFC 5737) for the
 *     offline case. NO physical controller is ever contacted from this suite.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import http from 'node:http';

import probe from '../server/controller_probe_service.cjs';

const {
  STATE_ONLINE, STATE_OFFLINE, STATE_UNKNOWN, PLACEHOLDER_IP,
  probeController, probeControllers, probeDmxController, probeLedController,
  clearProbeCache, getCachedProbe,
} = probe;

// RFC 5737 TEST-NET-1 — reserved for documentation, guaranteed not to host
// anything. The safe way to assert OFFLINE without inventing a private address
// that might be somebody's gear.
const UNROUTABLE_IP = '192.0.2.1';

const BOARD_STATUS = {
  controllerId: 'titanic_207',
  boardId: 'angio4',
  deviceName: 'Titanic-207',
  strands: [{ count: 40, enabled: true }, { count: 40, enabled: true }],
  capabilitiesExt: { perOutputDmx: true },
};

/** An injected io whose httpGetJson always resolves the given response. */
function httpIo(response) {
  return { httpGetJson: async () => response };
}

/** An injected io whose httpGetJson always rejects with the given code. */
function httpErrIo(code) {
  return {
    httpGetJson: async () => {
      const err = new Error(`stub ${code}`);
      err.code = code;
      throw err;
    },
  };
}

/** An injected io whose tcpProbe answers per port. */
function tcpIo(byPort) {
  return { tcpProbe: async (ip, port) => byPort[port] };
}

test.beforeEach(() => clearProbeCache());

// ── Non-probes: the honest UNKNOWN cases ────────────────────────────────────

test('a controller with NO IP is UNKNOWN with the reason — never offline', async () => {
  const r = await probeController({ id: 1, ip: '', type: 'DMX' });
  assert.equal(r.state, STATE_UNKNOWN);
  assert.equal(r.probe, 'none');
  assert.match(r.detail, /no IP set/);
});

test('the 0.0.0.0 placeholder sentinel is UNKNOWN and is never probed', async () => {
  const r = await probeController({ id: 1, ip: PLACEHOLDER_IP, type: 'DMX' });
  assert.equal(r.state, STATE_UNKNOWN);
  assert.equal(r.placeholder, true);
  assert.match(r.detail, /placeholder sentinel/);
});

test('a malformed IP is UNKNOWN, not offline', async () => {
  const r = await probeController({ id: 1, ip: '10.1.1.999', type: 'LED' });
  assert.equal(r.state, STATE_UNKNOWN);
  assert.match(r.detail, /not a valid IPv4 address/);
});

// ── LED probe classification (HTTP /api/status) ─────────────────────────────

test('LED: a MarsinLED fingerprint is ONLINE and carries the identity (FIRST CONTACT)', async () => {
  const r = await probeLedController('10.9.9.207',
    { io: httpIo({ status: 200, json: BOARD_STATUS, rttMs: 7 }) });
  assert.equal(r.state, STATE_ONLINE);
  assert.equal(r.device.controllerId, 'titanic_207');
  assert.equal(r.device.boardId, 'angio4');
  assert.deepEqual(r.device.raw, BOARD_STATUS,
    'the whole status rides along so the reconcile can check capabilities');
});

test('LED: something else answering on :80 is ONLINE but LOUDLY unrecognized', async () => {
  const r = await probeLedController('10.9.9.207',
    { io: httpIo({ status: 200, json: { model: 'office printer' }, rttMs: 4 }) });
  assert.equal(r.state, STATE_ONLINE, 'the HOST is unambiguously up');
  assert.equal(r.device, null, 'but there is no fingerprint to promote a binding with');
  assert.equal(r.unrecognized, true);
  assert.match(r.detail, /not a MarsinLED/);
});

test('LED: a refused :80 is ONLINE (the IP stack answered) with the discrepancy named', async () => {
  const r = await probeLedController('10.9.9.207', { io: httpErrIo('ECONNREFUSED') });
  assert.equal(r.state, STATE_ONLINE);
  assert.equal(r.unrecognized, true);
  assert.match(r.detail, /a MarsinLED always serves \/api\/status/);
});

test('LED: a timeout is OFFLINE', async () => {
  const r = await probeLedController('10.9.9.207', { io: httpErrIo('ETIMEDOUT') });
  assert.equal(r.state, STATE_OFFLINE);
});

test('LED: an error class that says nothing about the board is UNKNOWN', async () => {
  const r = await probeLedController('10.9.9.207', { io: httpErrIo('EMFILE') });
  assert.equal(r.state, STATE_UNKNOWN,
    'a local file-descriptor limit must never be reported as a dark controller');
  assert.match(r.detail, /EMFILE/);
});

// ── DMX probe classification (TCP connect ladder) ───────────────────────────

test('DMX: an open port is ONLINE', async () => {
  const r = await probeDmxController('10.9.9.5', {
    io: tcpIo({ 80: { state: STATE_ONLINE, detail: 'tcp/80 open', rttMs: 2 } }),
    ports: [80],
  });
  assert.equal(r.state, STATE_ONLINE);
  assert.equal(r.probe, 'tcp:80');
});

test('DMX: a REFUSED connection is ONLINE — a live IP stack sent the RST', async () => {
  const r = await probeDmxController('10.9.9.5', {
    io: tcpIo({ 80: { state: STATE_ONLINE, detail: 'tcp/80 refused (ECONNREFUSED) — the host is on the network', rttMs: 1 } }),
    ports: [80],
  });
  assert.equal(r.state, STATE_ONLINE);
  assert.match(r.detail, /the host is on the network/);
});

test('DMX: the ladder walks past an offline port to a decisive one', async () => {
  const r = await probeDmxController('10.9.9.5', {
    io: tcpIo({
      80: { state: STATE_OFFLINE, detail: 'no answer on tcp/80 within 1200 ms', rttMs: 1200 },
      8080: { state: STATE_ONLINE, detail: 'tcp/8080 open', rttMs: 3 },
    }),
    ports: [80, 8080],
  });
  assert.equal(r.state, STATE_ONLINE);
  assert.equal(r.probe, 'tcp:8080');
});

test('DMX: an UNKNOWN on the first port wins over walking on (it is not an offline board)', async () => {
  const r = await probeDmxController('10.9.9.5', {
    io: tcpIo({
      80: { state: STATE_UNKNOWN, detail: 'probe error EACCES on tcp/80', rttMs: 0 },
      8080: { state: STATE_ONLINE, detail: 'tcp/8080 open', rttMs: 3 },
    }),
    ports: [80, 8080],
  });
  assert.equal(r.state, STATE_UNKNOWN);
});

test('DMX: every port timing out is OFFLINE', async () => {
  const r = await probeDmxController('10.9.9.5', {
    io: tcpIo({
      80: { state: STATE_OFFLINE, detail: 'no answer on tcp/80 within 1200 ms', rttMs: 1200 },
      8080: { state: STATE_OFFLINE, detail: 'no answer on tcp/8080 within 1200 ms', rttMs: 1200 },
    }),
    ports: [80, 8080],
  });
  assert.equal(r.state, STATE_OFFLINE);
  assert.equal(r.probe, 'tcp:8080');
});

// ── The sweep: parallel, ordered, complete, cached ──────────────────────────

test('the sweep returns ONE result per target, in input order, even when they differ', async () => {
  const targets = [
    { id: 7, ip: '10.9.9.5', type: 'DMX' },
    { id: 9, ip: PLACEHOLDER_IP, type: 'DMX' },
    { id: 11, ip: '', type: 'LED' },
  ];
  const out = await probeControllers(targets, {
    io: tcpIo({ 80: { state: STATE_ONLINE, detail: 'tcp/80 open', rttMs: 2 } }),
    ports: [80],
  });
  assert.equal(out.results.length, 3);
  assert.deepEqual(out.results.map((r) => r.id), [7, 9, 11]);
  assert.deepEqual(out.results.map((r) => r.state), [STATE_ONLINE, STATE_UNKNOWN, STATE_UNKNOWN]);
});

test('the sweep runs PARALLEL — 12 slow targets finish in about one probe, not twelve', async () => {
  const slowIo = {
    tcpProbe: async () => {
      await new Promise((r) => setTimeout(r, 120));
      return { state: STATE_ONLINE, detail: 'tcp/80 open', rttMs: 120 };
    },
  };
  const targets = Array.from({ length: 12 }, (_, i) => ({ id: i + 1, ip: `10.9.9.${i + 1}`, type: 'DMX' }));
  const started = Date.now();
  const out = await probeControllers(targets, { io: slowIo, ports: [80], concurrency: 16 });
  const elapsed = Date.now() - started;
  assert.equal(out.results.length, 12);
  assert.ok(elapsed < 600, `12 × 120 ms probes took ${elapsed} ms — they must overlap, not queue`);
});

test('the sweep honours the concurrency cap', async () => {
  let inFlight = 0;
  let peak = 0;
  const countingIo = {
    tcpProbe: async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 20));
      inFlight -= 1;
      return { state: STATE_ONLINE, detail: 'tcp/80 open', rttMs: 20 };
    },
  };
  const targets = Array.from({ length: 10 }, (_, i) => ({ id: i + 1, ip: `10.9.9.${i + 1}`, type: 'DMX' }));
  await probeControllers(targets, { io: countingIo, ports: [80], concurrency: 3 });
  assert.ok(peak <= 3, `peak concurrency was ${peak}, cap was 3`);
});

test('the cache serves the last verdict, and `force` bypasses it', async () => {
  let calls = 0;
  const io = {
    tcpProbe: async () => {
      calls += 1;
      return { state: STATE_ONLINE, detail: 'tcp/80 open', rttMs: 1 };
    },
  };
  const targets = [{ id: 1, ip: '10.9.9.5', type: 'DMX' }];
  await probeControllers(targets, { io, ports: [80] });
  assert.equal(calls, 1);
  const second = await probeControllers(targets, { io, ports: [80] });
  assert.equal(calls, 1, 'the second sweep inside the TTL must be served from cache');
  assert.equal(second.cached, 1);
  assert.equal(second.results[0].fromCache, true);
  const forced = await probeControllers(targets, { io, ports: [80], force: true });
  assert.equal(calls, 2, '`force` must re-probe');
  assert.equal(forced.results[0].fromCache, false);
  assert.ok(getCachedProbe(targets[0]));
});

test('the cache is keyed by BOX (type + ip), not by card id', async () => {
  let calls = 0;
  const io = {
    tcpProbe: async () => {
      calls += 1;
      return { state: STATE_ONLINE, detail: 'tcp/80 open', rttMs: 1 };
    },
  };
  // Two DIFFERENT cards on the same address: one probe answers both.
  await probeControllers([
    { id: 1, ip: '10.9.9.5', type: 'DMX' },
    { id: 2, ip: '10.9.9.5', type: 'DMX' },
  ], { io, ports: [80] });
  assert.equal(calls, 1);
});

// ── Real sockets: loopback stubs + TEST-NET-1 ───────────────────────────────

test('REAL SOCKET: a TCP listener on loopback reads ONLINE', async () => {
  const server = net.createServer(() => {});
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  try {
    const r = await probeDmxController('127.0.0.1', { ports: [port], timeoutMs: 800 });
    assert.equal(r.state, STATE_ONLINE);
    assert.match(r.detail, /open/);
  } finally {
    server.close();
  }
});

test('REAL SOCKET: a closed loopback port reads ONLINE — the refusal proves the host', async () => {
  // Bind then immediately release, so nothing is listening but 127.0.0.1 is
  // unquestionably alive: exactly the DMX-gateway-without-a-web-UI case.
  const server = net.createServer(() => {});
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  await new Promise((r) => server.close(r));
  const r = await probeDmxController('127.0.0.1', { ports: [port], timeoutMs: 800 });
  assert.equal(r.state, STATE_ONLINE);
  assert.match(r.detail, /refused|open/);
});

test('REAL SOCKET: an unroutable (RFC 5737 TEST-NET-1) address reads OFFLINE', async () => {
  const r = await probeDmxController(UNROUTABLE_IP, { ports: [80], timeoutMs: 400 });
  assert.equal(r.state, STATE_OFFLINE,
    'a documentation-reserved address must never read ONLINE or UNKNOWN');
});

test('REAL SOCKET: a stub MarsinLED on loopback reads ONLINE with its fingerprint', async () => {
  const server = http.createServer((req, res) => {
    if (req.url === '/api/status') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(BOARD_STATUS));
      return;
    }
    res.statusCode = 404;
    res.end('{}');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  try {
    const r = await probeLedController('127.0.0.1', { httpPort: port, timeoutMs: 900 });
    assert.equal(r.state, STATE_ONLINE);
    assert.equal(r.device.controllerId, 'titanic_207');
    assert.equal(r.probe, 'http:/api/status');
  } finally {
    server.close();
  }
});

test('REAL SOCKET: an HTTP server that is NOT a MarsinLED reads ONLINE-but-unrecognized', async () => {
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ hello: 'not a light controller' }));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  try {
    const r = await probeLedController('127.0.0.1', { httpPort: port, timeoutMs: 900 });
    assert.equal(r.state, STATE_ONLINE);
    assert.equal(r.unrecognized, true);
    assert.equal(r.device, null);
  } finally {
    server.close();
  }
});

// ── Crash-proofing + budget hardening (report 20260725_119, Wave 1 W1-4) ─────
// These flip red-team findings 20260725_109 P1-1 (a negative timeoutMs killed
// the save-server process) and P1-3 (the "1.2 s ceiling" was an IDLE timeout a
// slow-drip host could hold open forever) into green regressions.

test('validateTimeoutMs rejects hostile values loudly and passes good ones (P1-1)', () => {
  assert.throws(() => probe.validateTimeoutMs(-1), /must be > 0/);
  assert.throws(() => probe.validateTimeoutMs(0), /must be > 0/);
  assert.throws(() => probe.validateTimeoutMs(Number.NaN), /finite number/);
  assert.throws(() => probe.validateTimeoutMs('500'), /finite number/);
  assert.throws(() => probe.validateTimeoutMs(10 ** 9), /<= /);
  // undefined/null are the "use the default" signal, not a hostile value.
  assert.equal(probe.validateTimeoutMs(undefined), undefined);
  assert.equal(probe.validateTimeoutMs(null), undefined);
  assert.equal(probe.validateTimeoutMs(500), 500);
});

test('a negative timeoutMs never becomes an unhandled socket error (P1-1 crash-proofing)', async () => {
  // A closed loopback port whose connect settles ECONNREFUSED. Before the fix,
  // socket.setTimeout(-1) threw BEFORE the 'error' handler was attached, so the
  // still-connecting socket's later error was unhandled → process exit. Now the
  // handler is attached first and the bad timeout is a caught, honest UNKNOWN.
  const server = net.createServer(() => {});
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  await new Promise((r) => server.close(r));

  let uncaught = null;
  const onUncaught = (e) => { uncaught = e; };
  process.once('uncaughtException', onUncaught);
  try {
    const r = await probe.tcpProbe('127.0.0.1', port, -1);
    // Give any late socket 'error' a tick to (fail to) surface.
    await new Promise((res) => setTimeout(res, 60));
    assert.equal(r.state, STATE_UNKNOWN, 'a bad timeout is an honest UNKNOWN, not a crash');
    assert.match(r.detail, /invalid probe timeout/);
    assert.equal(uncaught, null, 'no unhandled exception may escape the probe');
  } finally {
    process.removeListener('uncaughtException', onUncaught);
  }
});

test('REAL SOCKET: a slow-drip host is cut off by the ABSOLUTE deadline, not held open (P1-3)', async () => {
  // Emits one byte every 60 ms and never ends. An idle timeout would reset on
  // every byte and hold the pool slot forever; the absolute deadline caps the
  // probe's total wall-clock near timeoutMs so one slow host cannot wedge a sweep.
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    const iv = setInterval(() => { try { res.write('x'); } catch { clearInterval(iv); } }, 60);
    req.on('close', () => clearInterval(iv));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  try {
    const started = Date.now();
    const r = await probeLedController('127.0.0.1', { httpPort: port, timeoutMs: 300 });
    const elapsed = Date.now() - started;
    assert.ok(elapsed < 1500,
      `the drip probe took ${elapsed} ms — the absolute deadline must cap it near 300 ms`);
    assert.equal(r.state, STATE_OFFLINE, 'a host that never answers is OFFLINE');
  } finally {
    server.close();
  }
});

test('REAL SOCKET: an oversized response body is capped, not buffered whole (P2-10)', async () => {
  // A host on :80 that streams far past the cap — broken or hostile. The read
  // must abort at MAX_RESPONSE_BYTES; the host is up, so ONLINE-but-unrecognized.
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    const chunk = 'x'.repeat(64 * 1024);
    let sent = 0;
    const iv = setInterval(() => {
      if (sent > probe.MAX_RESPONSE_BYTES * 2) { clearInterval(iv); try { res.end(); } catch { /* gone */ } return; }
      try { res.write(chunk); sent += chunk.length; } catch { clearInterval(iv); }
    }, 1);
    req.on('close', () => clearInterval(iv));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  try {
    const r = await probeLedController('127.0.0.1', { httpPort: port, timeoutMs: 1500 });
    assert.equal(r.state, STATE_ONLINE, 'the host is streaming at us, so it is up');
    assert.equal(r.unrecognized, true, 'but a 512 KB blob is not a MarsinLED /api/status');
  } finally {
    server.close();
  }
});
