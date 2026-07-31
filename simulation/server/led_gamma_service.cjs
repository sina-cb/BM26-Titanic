/**
 * led_gamma_service.cjs — read / back up / write an LED controller's
 * per-channel gamma curve (the strand "vibrancy" knob) over its HTTP JSON
 * config API (port 80, docs/41).
 *
 * This is the ONE implementation of the gamma-push discipline:
 *
 *   1. GET /api/status   — identity (fail loud if the host doesn't answer)
 *   2. GET /api/config   — the FULL persisted config
 *   3. write a timestamped backup of that full config to
 *      ~/tmp/led_controller_configs_backup/
 *   4. POST /api/config with a PARTIAL body carrying ONLY `{ gamma }`
 *   5. honour the reply (`applied` vs `needs-reboot`) — wait out a reboot
 *   6. GET /api/config again and VERIFY the read-back matches, or throw
 *
 * Both callers share it:
 *   - the CLI tool   simulation/agent_tools/led_gamma_push.cjs
 *   - the save-server route POST /led/gamma-push (the sim's Controllers UI)
 *
 * Nothing here has a fallback (codex P0): an unreachable host, a device 400,
 * or a read-back mismatch all THROW. Errors carry `.kind` so the caller can
 * report 'unreachable' separately from 'rejected' / 'verify-mismatch'.
 *
 * DEFAULT CURVE: r=2.2 g=2.2 b=2.2 w=1.0. The W exponent is 1.0 on purpose —
 * the controller derives its white channel AFTER applying the R/G/B curve, so
 * a second exponent on W compounds with the first and crushes whites and
 * pastels. Trim W only if the white emitter is measured to need it.
 *
 * Discovery note: these controllers do not answer ICMP — probe over HTTP
 * (`GET /api/status`), never ping (docs/41 §2).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const GAMMA_CHANNELS = ['r', 'g', 'b', 'w'];
const DEFAULT_GAMMA = Object.freeze({ r: 2.2, g: 2.2, b: 2.2, w: 1.0 });
const OFF_GAMMA = Object.freeze({ r: 1.0, g: 1.0, b: 1.0, w: 1.0 });

// The controller's accepted range. The sim's scene mirror (led_wire.js)
// enforces exactly the same bounds — a value one side would take and the
// other would reject is a config bug, so both fail at 1.0/3.0.
const GAMMA_MIN = 1.0;
const GAMMA_MAX = 3.0;

const HTTP_TIMEOUT_MS = 10000;
const REBOOT_WAIT_MS = 15000;
const VERIFY_EPSILON = 1e-3;

/** Error factory that tags the failure class for the UI (ok/failed/unreachable). */
function gammaError(kind, message, extra) {
  const err = new Error(message);
  err.kind = kind;
  if (extra) Object.assign(err, extra);
  return err;
}

/**
 * One HTTP JSON round trip against a controller. Resolves `{status, json}`;
 * rejects (kind 'unreachable') on timeout / socket error / non-JSON body.
 */
function request(host, method, urlPath, body, timeoutMs = HTTP_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const payload = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = http.request({
      host, port: 80, path: urlPath, method, timeout: timeoutMs,
      headers: payload
        ? { 'Content-Type': 'application/json', 'Content-Length': payload.length }
        : {},
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch (_) { /* surfaced below */ }
        if (json === null) {
          reject(gammaError('unreachable',
            `${method} ${urlPath} → HTTP ${res.statusCode}, non-JSON body: ${text.slice(0, 200)}`));
          return;
        }
        resolve({ status: res.statusCode, json });
      });
    });
    req.on('timeout', () => {
      req.destroy(gammaError('unreachable', `${host} did not answer within ${timeoutMs} ms`));
    });
    req.on('error', (err) => {
      reject(err.kind ? err : gammaError('unreachable', `${host}: ${err.message}`));
    });
    if (payload) req.write(payload);
    req.end();
  });
}

/**
 * Validate + normalize a gamma object. Returns a fresh `{r,g,b,w}` of numbers.
 * THROWS (kind 'invalid') naming the offending channel — a bad curve never
 * reaches the wire.
 */
function validateGamma(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw gammaError('invalid', 'gamma must be an object with r/g/b/w exponents');
  }
  for (const key of Object.keys(raw)) {
    if (!GAMMA_CHANNELS.includes(key)) {
      throw gammaError('invalid', `gamma has unknown key '${key}' (expected r, g, b, w)`);
    }
  }
  const out = {};
  for (const ch of GAMMA_CHANNELS) {
    const v = Number(raw[ch]);
    if (!Number.isFinite(v) || v < GAMMA_MIN || v > GAMMA_MAX) {
      throw gammaError('invalid', `gamma.${ch} ${JSON.stringify(raw[ch])} must be a number in ` +
        `${GAMMA_MIN}–${GAMMA_MAX} (1.0 = off) — the range the LED controller accepts`, { field: ch });
    }
    out[ch] = v;
  }
  return out;
}

/** Parse a CLI "r,g,b,w" spec into a validated gamma object. */
function parseGammaSpec(spec) {
  const parts = String(spec).split(',').map((s) => Number(s.trim()));
  if (parts.length !== 4 || parts.some((v) => !Number.isFinite(v))) {
    throw gammaError('invalid', `gamma spec expects four numbers "r,g,b,w" (got "${spec}")`);
  }
  return validateGamma({ r: parts[0], g: parts[1], b: parts[2], w: parts[3] });
}

/**
 * Round a read-back curve to 4 decimals. The controller stores the exponents as
 * float32, so a written 2.2 reads back as 2.200000048 — representation noise,
 * not a different curve (the verify below is epsilon-based for exactly that
 * reason). The SCENE MIRROR must carry the operator's number, not the noise, or
 * every push would rewrite controllers.yaml with a longer float.
 */
function roundGamma(gamma) {
  const out = {};
  for (const ch of GAMMA_CHANNELS) out[ch] = Math.round(Number(gamma[ch]) * 1e4) / 1e4;
  return out;
}

/** True when two gamma curves agree within the verify epsilon. */
function gammaEquals(a, b) {
  if (!a || !b) return false;
  return GAMMA_CHANNELS.every((ch) => Math.abs(Number(a[ch]) - Number(b[ch])) < VERIFY_EPSILON);
}

/** ~/tmp/led_controller_configs_backup/ — created on demand. */
function backupDir() {
  const dir = path.join(os.homedir(), 'tmp', 'led_controller_configs_backup');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Write the device's FULL config to a timestamped backup file; returns its path. */
function writeBackup(host, name, fullConfig) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safeName = String(name || host).replace(/[^A-Za-z0-9_.-]/g, '_');
  const file = path.join(backupDir(), `${host}_${safeName}_config_${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify(fullConfig, null, 2));
  return file;
}

/** GET /api/status — identity. THROWS (kind 'unreachable') when the host is silent. */
async function readStatus(host) {
  const res = await request(host, 'GET', '/api/status');
  if (res.status !== 200) {
    throw gammaError('unreachable', `${host}: GET /api/status returned HTTP ${res.status}`);
  }
  return res.json;
}

/** GET /api/config — the full persisted config. */
async function readConfig(host) {
  const res = await request(host, 'GET', '/api/config');
  if (res.status !== 200) {
    throw gammaError('unreachable', `${host}: GET /api/config returned HTTP ${res.status}`);
  }
  return res.json;
}

/**
 * Read a controller's identity + current gamma. No writes, no backup.
 * @returns {Promise<{ip, controllerId, deviceName, boardId, firmwareSHA, gamma}>}
 */
async function readGamma(host) {
  const status = await readStatus(host);
  const config = await readConfig(host);
  return {
    ip: host,
    controllerId: status.controllerId || null,
    deviceName: config.deviceName || status.deviceName || null,
    boardId: status.boardId || null,
    firmwareSHA: status.firmwareSHA || null,
    gamma: config.gamma || null,
  };
}

/**
 * Push a gamma curve to ONE controller, with the full discipline (backup →
 * partial write → reboot-aware read-back verify).
 *
 * @param {string} host - controller IP (HTTP only; these devices ignore ICMP)
 * @param {Object} rawTarget - {r,g,b,w}
 * @param {{onLog?: Function, rebootWaitMs?: number}} [opts]
 * @returns {Promise<Object>} {ip, controllerId, deviceName, boardId, firmwareSHA,
 *   before, target, verified, outcome, reboot, backupPath, changed}
 * @throws Error with `.kind` ∈ 'invalid'|'unreachable'|'rejected'|'verify-mismatch'
 */
async function pushGamma(host, rawTarget, opts = {}) {
  const log = opts.onLog || (() => {});
  const rebootWaitMs = Number.isFinite(opts.rebootWaitMs) ? opts.rebootWaitMs : REBOOT_WAIT_MS;
  const target = validateGamma(rawTarget);
  if (typeof host !== 'string' || host.trim().length === 0) {
    throw gammaError('invalid', 'a controller IP is required');
  }

  const status = await readStatus(host);
  const name = status.controllerId || status.deviceName || host;
  log(`🔌 ${host} → controller "${name}"`);

  const before = await readConfig(host);
  const currentGamma = before.gamma || null;
  log(`   current gamma: ${JSON.stringify(currentGamma)}`);

  const backupPath = writeBackup(host, name, before);
  log(`   💾 full config backed up → ${backupPath}`);

  log(`   ➡  pushing gamma ${JSON.stringify(target)}`);
  const res = await request(host, 'POST', '/api/config', { gamma: target });
  if (res.status === 400) {
    throw gammaError('rejected', `${host} rejected the gamma write: ` +
      `${res.json.error || 'validation failed'}` +
      (res.json.field ? ` (field=${res.json.field})` : '') +
      (res.json.detail ? ` — ${res.json.detail}` : ''), { deviceError: res.json });
  }
  if (res.status !== 200) {
    throw gammaError('rejected', `${host}: POST /api/config returned HTTP ${res.status}: ` +
      JSON.stringify(res.json));
  }
  const reply = res.json;
  const outcome = reply.outcome || 'applied';
  const reboot = reply.reboot === true || outcome === 'needs-reboot';
  log(`   reply: ${JSON.stringify(reply)}`);

  if (reboot) {
    log(`   ⏳ controller is rebooting — waiting ${Math.round(rebootWaitMs / 1000)} s before read-back`);
    await new Promise((r) => setTimeout(r, rebootWaitMs));
  }

  const after = await readConfig(host);
  const verified = after.gamma || {};
  if (!gammaEquals(verified, target)) {
    throw gammaError('verify-mismatch',
      `${host}: read-back MISMATCH — wanted ${JSON.stringify(target)}, ` +
      `controller reports ${JSON.stringify(verified)}`, { verified, target, backupPath });
  }
  log(`   ✅ verified on hardware: ${JSON.stringify(verified)}`);

  return {
    ip: host,
    controllerId: status.controllerId || null,
    deviceName: before.deviceName || status.deviceName || null,
    boardId: status.boardId || null,
    firmwareSHA: status.firmwareSHA || null,
    before: currentGamma,
    target,
    verified: validateGamma(roundGamma(verified)),
    outcome,
    reboot,
    backupPath,
    changed: !gammaEquals(currentGamma, target),
  };
}

module.exports = {
  GAMMA_CHANNELS,
  GAMMA_MIN,
  GAMMA_MAX,
  DEFAULT_GAMMA,
  OFF_GAMMA,
  backupDir,
  gammaEquals,
  parseGammaSpec,
  roundGamma,
  pushGamma,
  readConfig,
  readGamma,
  readStatus,
  validateGamma,
  writeBackup,
};
