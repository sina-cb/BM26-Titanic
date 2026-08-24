/**
 * led_gamma_service.cjs — back up and write an LED controller's per-channel
 * gamma curve (the strand "vibrancy" knob) over its HTTP JSON config API
 * (port 80, docs/41).
 *
 * PUSH ONLY, and DORMANT. By operator ruling the sim's gamma UI is disabled
 * and gamma is managed on the controller's own web UI for now; this service is
 * kept working and tested so the push can be re-enabled in one small slice once
 * the narrowed config push is confirmed. The standalone gamma READ is gone
 * permanently — "only push, not pull". (The reads inside the push below are
 * part of the write discipline: backup, read-back verify, identity check.)
 *
 * This is the ONE implementation of the gamma-push discipline:
 *
 *   1. GET /api/status   — identity (fail loud if the host doesn't answer)
 *   2. GET /api/config   — the FULL persisted config
 *   3. write a timestamped backup of that full config to
 *      ~/tmp/led_controller_configs_backup/
 *   4. POST /api/config with a PARTIAL body carrying ONLY `{ gamma }` — plus
 *      `deviceName` in exactly ONE case: when the STORED name is invalid the
 *      firmware rejects every write (docs/41 §4.1.1), so the push repairs it
 *      with the controller card's name VERBATIM or refuses before the POST
 *      (`gammaPushBody` below — same doctrine as the per-output push)
 *   5. send exactly one write; a lost reply is settled by read-back, never by
 *      retrying the mutation
 *   6. GET /api/config again and VERIFY saved gamma, mode, and name
 *   7. GET /api/status again and VERIFY controller identity is unchanged
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
const { isDeepStrictEqual } = require('util');

// The deviceName doctrine (docs/41 §4.1.1, report _124) has ONE implementation
// and it lives in the LED client: `deviceNameRepairForPush` + DEVICE_NAME_RE.
// That file is a browser ES module and this one is CommonJS — Node's native
// `require(esm)` (>= 22.12; this project runs 24.x) bridges the boundary
// synchronously, so the server consumes the client's decision function
// directly instead of keeping a copy that could drift. On an older Node this
// require crashes RIGHT HERE at startup — the correct loud failure (codex P0).
const {
  deviceNameRepairForPush,
} = require('../src/dmx/led/marsinled_client.js');

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
    const v = raw[ch];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < GAMMA_MIN || v > GAMMA_MAX) {
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

// ── deviceName repair (docs/41 §4.1.1, reports _124/_126) ───────────────────
//
// MarsinLED's ConfigManager::update merges a partial POST body into the STORED
// config and validates the WHOLE merged document. A board whose stored
// deviceName is invalid (e.g. the `""` it ships with) therefore rejects EVERY
// `POST /api/config` with `field=deviceName` — including a pure `{gamma}` body
// that never mentions the field. (_124 proved it live: a no-op gamma write to
// the 10.x.x.60 board earned that exact 400.) So the gamma push carries the
// same repair as the per-output push: when the stored name is invalid, write
// the controller card's name VERBATIM alongside the gamma, or refuse loudly
// naming the exact rename. No sanitizing, no fallback (codex P0).

/**
 * Build the POST /api/config body for a gamma push — the payload-construction
 * seam. PURE (no I/O), so it is unit-testable without a device.
 *
 *  - stored name valid or absent → `{gamma}` only (a working device is never
 *    renamed, and an unreported field is never invented);
 *  - stored name present and invalid → `{gamma, deviceName}` with the card's
 *    name verbatim, plus the repair record for the caller to declare;
 *  - stored name invalid and `controllerName` unusable → THROWS (kind
 *    'invalid') naming exactly what to rename.
 *
 * @param {{ip: string, gamma: Object, storedDeviceName: *, controllerName: *}} params
 * @returns {{body: Object, nameRepair: {from: string, to: string, message: string}|null}}
 */
function gammaPushBody({ ip, gamma, storedDeviceName, controllerName }) {
  let nameRepair;
  try {
    nameRepair = deviceNameRepairForPush({ ip, storedName: storedDeviceName, controllerName });
  } catch (err) {
    throw gammaError('invalid', `${err.message} (docs/41 §4.1.1 — until that name is fixed the ` +
      'board rejects every config write, so the gamma push refuses before touching it. From the ' +
      "CLI, pass the controller card's name with --device-name.)");
  }
  if (!nameRepair) return { body: { gamma }, nameRepair: null };
  return { body: { gamma, deviceName: nameRepair.to }, nameRepair };
}

/**
 * Turn a device 400 into the error the operator can act on. PURE.
 *
 * The one trap this defuses: a `field=deviceName` rejection of a body that
 * never carried `deviceName` is the §4.1.1 merge-validation quirk — the
 * board's STORED name is invalid — not a gamma problem. Without the note the
 * operator chases a deviceName ghost through a gamma payload (_124, live).
 */
function gammaRejectionError(host, replyJson, body) {
  const mergeQuirk = replyJson.field === 'deviceName' && body.deviceName === undefined;
  return gammaError('rejected', `${host} rejected the gamma write: ` +
    `${replyJson.error || 'validation failed'}` +
    (replyJson.field ? ` (field=${replyJson.field})` : '') +
    (replyJson.detail ? ` — ${replyJson.detail}` : '') +
    (mergeQuirk ? ' — NOTE: this body never mentioned deviceName. The firmware re-validates the ' +
      "WHOLE stored config on every apply (docs/41 §4.1.1), so this board's STORED deviceName " +
      'is invalid and it rejects every write until that name is fixed (its own web UI, or a ' +
      'push carrying a legal name).' : ''),
    { deviceError: replyJson });
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

/** One partial saved-config write. Callers never retry this operation. */
async function writeConfig(host, body) {
  return request(host, 'POST', '/api/config', body);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assertStableIdentity(host, before, after, backupPath) {
  for (const field of ['controllerId', 'boardId', 'firmwareSHA']) {
    const expected = before[field];
    if (expected !== undefined && expected !== null && after[field] !== expected) {
      throw gammaError('identity-mismatch', `${host}: controller identity changed during gamma ` +
        `push — ${field} was ${JSON.stringify(expected)}, now ${JSON.stringify(after[field])}`,
      { field, expected, actual: after[field], backupPath });
    }
  }
}

function assertSavedConfigPreserved(host, before, after, nameRepair, backupPath) {
  for (const field of ['dmx', 'swarm']) {
    if (!isDeepStrictEqual(after[field], before[field])) {
      throw gammaError('verify-mismatch', `${host}: gamma push changed saved ${field} config — ` +
        'DMX / SWARM mode must remain unchanged',
      { field, expected: before[field], actual: after[field], backupPath });
    }
  }

  const expectedName = nameRepair ? nameRepair.to : before.deviceName;
  if (before.deviceName !== undefined && after.deviceName !== expectedName) {
    throw gammaError('identity-mismatch', `${host}: gamma push changed deviceName unexpectedly — ` +
      `expected ${JSON.stringify(expectedName)}, got ${JSON.stringify(after.deviceName)}`,
    { field: 'deviceName', expected: expectedName, actual: after.deviceName, backupPath });
  }
}

// The standalone gamma READ (`readGamma(host)` — identity + current curve, no
// write) is DELETED by operator ruling: "only push, not pull". Its two callers
// went with it (the save-server's `GET /led/gamma` route and the CLI's
// `--read`). `readStatus` / `readConfig` remain because the PUSH discipline
// itself needs them — backup, read-back verify, identity check.

/**
 * Push a gamma curve to ONE controller, with the full discipline (backup →
 * partial write → reboot-aware saved-config + identity verification).
 *
 * @param {string} host - controller IP (HTTP only; these devices ignore ICMP)
 * @param {Object} rawTarget - {r,g,b,w}
 * @param {{onLog?: Function, rebootWaitMs?: number, controllerName?: string}} [opts]
 *   `controllerName` is the bound controller card's name. It is used for ONE
 *   thing: repairing an invalid STORED deviceName (docs/41 §4.1.1) — verbatim
 *   or not at all. A board whose stored name is valid is never renamed.
 * @returns {Promise<Object>} {ip, controllerId, deviceName, boardId, firmwareSHA,
 *   before, target, verified, outcome, reboot, backupPath, changed,
 *   deviceNameRepaired, writeReplyLost}
 * @throws Error with `.kind` ∈ 'invalid'|'unreachable'|'rejected'|
 *   'verify-mismatch'|'identity-mismatch'
 */
async function pushGammaWithIo(host, rawTarget, opts = {}, io) {
  const log = opts.onLog || (() => {});
  const rebootWaitMs = Number.isFinite(opts.rebootWaitMs) ? opts.rebootWaitMs : REBOOT_WAIT_MS;
  const target = validateGamma(rawTarget);
  if (typeof host !== 'string' || host.trim().length === 0) {
    throw gammaError('invalid', 'a controller IP is required');
  }

  const beforeStatus = await io.readStatus(host);
  const name = beforeStatus.controllerId || beforeStatus.deviceName || host;
  log(`🔌 ${host} → controller "${name}"`);

  const before = await io.readConfig(host);
  const currentGamma = before.gamma || null;
  log(`   current gamma: ${JSON.stringify(currentGamma)}`);

  const backupPath = io.writeBackup(host, name, before);
  log(`   💾 full config backed up → ${backupPath}`);

  // §4.1.1: an invalid STORED deviceName makes the board reject every write —
  // repair it (card name verbatim) or refuse loudly BEFORE the POST.
  const { body, nameRepair } = gammaPushBody({
    ip: host,
    gamma: target,
    storedDeviceName: before.deviceName,
    controllerName: opts.controllerName,
  });
  if (nameRepair) log(`   ⚠ ${nameRepair.message}`);

  log(`   ➡  pushing gamma ${JSON.stringify(target)}`);
  let res = null;
  let writeReplyLost = false;
  try {
    res = await io.writeConfig(host, body);
  } catch (err) {
    if (err.kind !== 'unreachable') throw err;
    writeReplyLost = true;
    log(`   ⚠ write reply was lost (${err.message}); the write will NOT be retried — ` +
      'checking saved config once');
  }
  if (writeReplyLost) {
    await io.sleep(rebootWaitMs);
  }
  if (res && res.status === 400) {
    throw gammaRejectionError(host, res.json, body);
  }
  if (res && res.status !== 200) {
    throw gammaError('rejected', `${host}: POST /api/config returned HTTP ${res.status}: ` +
      JSON.stringify(res.json));
  }
  const reply = res ? res.json : {};
  const outcome = reply.outcome || 'applied';
  const reboot = reply.reboot === true || outcome === 'needs-reboot';
  if (res) log(`   reply: ${JSON.stringify(reply)}`);

  if (reboot) {
    log(`   ⏳ controller is rebooting — waiting ${Math.round(rebootWaitMs / 1000)} s ` +
      'before read-back');
    await io.sleep(rebootWaitMs);
  }

  let after;
  try {
    after = await io.readConfig(host);
  } catch (err) {
    if (!writeReplyLost) throw err;
    throw gammaError('unreachable', `${host}: write reply was lost and saved config could not be ` +
      `read back (${err.message}). The write was sent exactly once and was not retried; inspect ` +
      'the controller before another push.', { backupPath, writeReplyLost: true });
  }
  let verified;
  try {
    verified = validateGamma(after.gamma || {});
  } catch (err) {
    throw gammaError('verify-mismatch', `${host}: saved config returned malformed gamma — ` +
      err.message, { backupPath, writeReplyLost });
  }
  if (!gammaEquals(verified, target)) {
    const prefix = writeReplyLost ? 'write reply was lost; ' : '';
    throw gammaError('verify-mismatch',
      `${host}: ${prefix}saved-config read-back MISMATCH — wanted ${JSON.stringify(target)}, ` +
      `controller reports ${JSON.stringify(verified)}. The write was not retried.`,
    { verified, target, backupPath, writeReplyLost });
  }
  assertSavedConfigPreserved(host, before, after, nameRepair, backupPath);

  const afterStatus = await io.readStatus(host);
  assertStableIdentity(host, beforeStatus, afterStatus, backupPath);

  log(`   ✅ verified in saved config: ${JSON.stringify(verified)}`);
  if (nameRepair) {
    log(`   ✅ deviceName repaired: ${JSON.stringify(nameRepair.from)} → '${nameRepair.to}'`);
  }

  return {
    ip: host,
    controllerId: afterStatus.controllerId || null,
    deviceName: after.deviceName || afterStatus.deviceName || null,
    boardId: afterStatus.boardId || null,
    firmwareSHA: afterStatus.firmwareSHA || null,
    before: currentGamma,
    target,
    verified: validateGamma(roundGamma(verified)),
    outcome,
    reboot,
    backupPath,
    changed: !gammaEquals(currentGamma, target),
    deviceNameRepaired: nameRepair ? { from: nameRepair.from, to: nameRepair.to } : null,
    writeReplyLost,
  };
}

async function pushGamma(host, rawTarget, opts = {}) {
  return pushGammaWithIo(host, rawTarget, opts, {
    readStatus,
    readConfig,
    writeConfig,
    writeBackup,
    sleep,
  });
}

module.exports = {
  GAMMA_CHANNELS,
  GAMMA_MIN,
  GAMMA_MAX,
  DEFAULT_GAMMA,
  OFF_GAMMA,
  backupDir,
  gammaEquals,
  gammaPushBody,
  gammaRejectionError,
  parseGammaSpec,
  roundGamma,
  pushGamma,
  pushGammaWithIo,
  readConfig,
  readStatus,
  validateGamma,
  writeBackup,
};
