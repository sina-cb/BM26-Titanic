// mock_bike_server.mjs — a test-only stand-in for the MarsinLED bike LED
// controller's firmware HTTP contract that lib/bike_color_share.js (engine
// side) probes and pushes to.
//
// Binds 127.0.0.1:0 (ephemeral) by default — never a real bike, never a
// non-loopback address. See the bike-color-share test brief for the
// authoritative, sanitized contract this emulates:
//   GET  /api/status  -> { controllerId, mac, firmwareTag, activePattern,
//                          colors: { color1, color2, source, engine } }
//   GET  /api/colors  -> { color1, color2, source, engine }
//   POST /api/colors  -> engine-flagged write snapshots + leases; a
//                        non-engine write while a lease is live is 409.
// The lease is evaluated LAZILY on every request AND on state() reads: once
// `now - lastEngineWrite > leaseMs`, the pre-engine snapshot is restored and
// `restoredCount` increments — that counter is how tests prove a keepalive
// cadence kept the lease alive (restoredCount === 0) versus let it lapse.
//
// Not a `*.test.*` module, so no test runner picks it up.
import http from 'node:http';

const PERSONAS = ['healthy', 'old_firmware', 'slow', 'wrong_device'];

function cloneColor(c) {
  return Array.isArray(c) ? [...c] : c;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => resolve(raw));
    req.on('error', reject);
  });
}

function sendJson(res, status, bodyObj) {
  const body = JSON.stringify(bodyObj);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(body);
}

function sendHtml(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'text/html' });
  res.end(body);
}

/**
 * Start a mock bike controller.
 *
 * @param {object} opts
 * @param {string} [opts.controllerId='bike-mock-1'] identity; NEVER the IP.
 * @param {string} [opts.mac='02:00:00:00:00:01'] synthetic, locally-administered.
 * @param {string} [opts.firmwareTag='2.0.0-mock']
 * @param {string} [opts.activePattern='mock_pattern']
 * @param {number} [opts.leaseMs=60000] engine-write lease duration.
 * @param {'healthy'|'old_firmware'|'slow'|'wrong_device'} [opts.persona='healthy']
 * @param {number} [opts.delayMs=2500] response delay for the 'slow' persona.
 * @param {{color1:number[], color2:number[]}} [opts.initialColors]
 * @param {number} [opts.port=0] explicit port to bind (0 = OS-assigned
 *   ephemeral). Not part of the firmware contract — a test-only escape hatch
 *   for the "same bike, same port, comes back" relink scenario, where a
 *   fresh mock must rebind the exact port a prior one was closed on.
 * @returns {Promise<object>} the running mock's handle.
 */
export async function createMockBike(opts = {}) {
  const {
    controllerId: initialControllerId = 'bike-mock-1',
    mac = '02:00:00:00:00:01',
    firmwareTag = '2.0.0-mock',
    activePattern = 'mock_pattern',
    leaseMs = 60000,
    persona = 'healthy',
    delayMs = 2500,
    initialColors = { color1: [0.1, 0.2, 0.3], color2: [0.4, 0.5, 0.6] },
    port: explicitPort = 0,
  } = opts;
  if (!PERSONAS.includes(persona)) {
    throw new Error(`createMockBike: unknown persona "${persona}" (want one of ${PERSONAS.join(', ')})`);
  }

  let currentControllerId = initialControllerId;
  let color1 = cloneColor(initialColors.color1);
  let color2 = cloneColor(initialColors.color2);
  // The pre-engine snapshot, restored when the lease lapses.
  const snapshot = { color1: cloneColor(initialColors.color1), color2: cloneColor(initialColors.color2) };
  let source = 'local';
  let leased = false;
  let lastEngineWrite = 0;
  let restoredCount = 0;
  let lastPostBody = null;

  const requests = { status: 0, colorsGet: 0, colorsPost: 0 };

  function evaluateLease(now) {
    if (leased && now - lastEngineWrite > leaseMs) {
      color1 = cloneColor(snapshot.color1);
      color2 = cloneColor(snapshot.color2);
      leased = false;
      source = 'local';
      restoredCount += 1;
    }
  }

  function msRemaining(now) {
    if (!leased) return 0;
    const left = leaseMs - (now - lastEngineWrite);
    return left > 0 ? left : 0;
  }

  function colorsPayload(now) {
    return {
      color1: cloneColor(color1),
      color2: cloneColor(color2),
      source,
      engine: { leased, msRemaining: msRemaining(now) },
    };
  }

  function statusPayload(now) {
    const base = { controllerId: currentControllerId, mac, firmwareTag, activePattern };
    // old_firmware never carries the colors block at all — that absence, not
    // an error status, is what marks it UNSUPPORTED once the module follows
    // up with a support check.
    if (persona === 'old_firmware') return base;
    return { ...base, colors: colorsPayload(now) };
  }

  const server = http.createServer(async (req, res) => {
    const { method, url } = req;
    const isStatus = method === 'GET' && url === '/api/status';
    const isColorsGet = method === 'GET' && url === '/api/colors';
    const isColorsPost = method === 'POST' && url === '/api/colors';

    if (isStatus) requests.status += 1;
    if (isColorsGet) requests.colorsGet += 1;
    if (isColorsPost) requests.colorsPost += 1;

    if (persona === 'slow') await new Promise((resolve) => setTimeout(resolve, delayMs));

    if (persona === 'wrong_device') {
      // Some other loopback HTTP service entirely: 200 on every path, no
      // JSON, no controllerId. The engine module must ignore it outright.
      if (isColorsPost) await readBody(req).catch(() => {});
      sendHtml(res, 200, 'not a bike');
      return;
    }

    const now = Date.now();

    if (isStatus) {
      evaluateLease(now);
      sendJson(res, 200, statusPayload(now));
      return;
    }

    if (isColorsGet || isColorsPost) {
      if (persona === 'old_firmware') {
        if (isColorsPost) await readBody(req).catch(() => {});
        sendJson(res, 404, { error: 'not found' });
        return;
      }

      if (isColorsGet) {
        evaluateLease(now);
        sendJson(res, 200, colorsPayload(now));
        return;
      }

      // POST /api/colors — the engine-flagged write / plain local write.
      const raw = await readBody(req);
      let body = null;
      try { body = JSON.parse(raw); } catch { body = null; }
      lastPostBody = body;
      evaluateLease(now);

      const isEngineWrite = !!(body && body.engine === true);
      if (!isEngineWrite && leased) {
        sendJson(res, 409, { reason: 'engineLease', msRemaining: msRemaining(now) });
        return;
      }

      if (isEngineWrite && !leased) {
        // First engine write of a lease: snapshot the pre-engine colors so a
        // lapsed lease can restore exactly this.
        snapshot.color1 = cloneColor(color1);
        snapshot.color2 = cloneColor(color2);
      }

      if (body && Array.isArray(body.color1)) color1 = cloneColor(body.color1);
      if (body && Array.isArray(body.color2)) color2 = cloneColor(body.color2);

      if (isEngineWrite) {
        source = 'engine';
        leased = true;
        lastEngineWrite = now;
      } else {
        source = 'local';
      }

      sendJson(res, 200, colorsPayload(now));
      return;
    }

    sendJson(res, 404, { error: 'not found' });
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(explicitPort, '127.0.0.1', resolve);
  });
  const { port } = server.address();

  return {
    port,
    url: `http://127.0.0.1:${port}`,
    get controllerId() { return currentControllerId; },
    state() {
      const now = Date.now();
      evaluateLease(now);
      return {
        colors: { color1: cloneColor(color1), color2: cloneColor(color2) },
        source,
        leased,
        msRemaining: msRemaining(now),
        restoredCount,
        requests: { ...requests },
        lastPostBody,
      };
    },
    setControllerId(id) { currentControllerId = id; },
    setColors(c1, c2) {
      color1 = cloneColor(c1);
      color2 = cloneColor(c2);
    },
    async close() {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
