// Shared HTTP client + helpers for the HIL harnesses and the run_hil dispatcher.
//
// The HIL harnesses each talk to a LIVE engine over its REST API. Historically
// every harness carried its own copy of an `httpJson` helper + a `--port`
// parser + a settle/sleep. Those copies DRIFTED into two incompatible return
// contracts (36 resolve `{ status, data }`; 7 resolve the parsed body directly),
// so they cannot be swapped wholesale without touching each call site. This
// module is the single canonical home going forward — the dispatcher uses it,
// and new harnesses (or migrated ones, verified individually against a
// disposable test_bench engine) should import from here.
//
// This is NOT a `*.test.*` module and carries no `_test.mjs` suffix, so no unit
// runner and no HIL run-all picks it up.
import http from 'node:http';

// Parse the engine port: `--port N` (argv) → ENGINE_PORT env → default.
export function parseHilPort(defaultPort = 6968) {
  const argv = process.argv;
  const i = argv.indexOf('--port');
  if (i !== -1 && argv[i + 1]) {
    const p = parseInt(argv[i + 1], 10);
    if (Number.isFinite(p)) return p;
  }
  if (process.env.ENGINE_PORT) {
    const p = parseInt(process.env.ENGINE_PORT, 10);
    if (Number.isFinite(p)) return p;
  }
  return defaultPort;
}

export function engineBase(port) {
  return `http://127.0.0.1:${port}`;
}

// Let the 40 fps render loop converge after an API call before sampling.
export function settle(ms = 200) {
  return new Promise((r) => setTimeout(r, ms));
}

// Canonical HIL HTTP call. Resolves `{ status, data }` where `data` is parsed
// JSON (or the raw string on non-JSON, or null on an empty body). Query strings
// in `path` are preserved; the JSON Content-Type header is set only when a body
// is sent. This matches the majority (`{ status, data }`) contract.
export function httpJson(method, path, body, base) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, base);
    const opts = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: body ? { 'Content-Type': 'application/json' } : {},
    };
    const req = http.request(opts, (res) => {
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => {
        let data = null;
        try { data = buf ? JSON.parse(buf) : null; } catch { data = buf; }
        resolve({ status: res.statusCode, data });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// Bind httpJson to a base URL — a drop-in for a harness's local `httpJson`.
export function makeHttpJson(base) {
  return (method, path, body = null) => httpJson(method, path, body, base);
}
