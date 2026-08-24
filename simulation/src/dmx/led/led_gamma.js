/**
 * led_gamma.js — the LED controller GAMMA curve, sim side: the scene mirror,
 * its validation, and the (DOM-free) push orchestration the Controllers UI
 * drives. Report 20260725_29.
 *
 * WHERE GAMMA LIVES. There is exactly ONE gamma curve in the chain and the LED
 * controller owns it: the sACN mapper deliberately emits linear bytes
 * (led_wire.js). The scene carries a MIRROR of the hardware curve at
 * `controllers.yaml → <LED controller>.led.wire.controllerGamma`; the sim
 * preview reads that mirror so screen matches strand. Nothing else reads it —
 * changing it never changes a wire byte.
 *
 * THE INVARIANT this module exists to keep: the mirror and the hardware must
 * never silently diverge.
 *   - Editing the fields updates the MIRROR only (preview), and marks the
 *     scene dirty through the editor's normal mutate/undo pipeline.
 *   - A push writes the curve to the device (backup → partial write →
 *     read-back verify, all server-side in server/led_gamma_service.cjs) and
 *     only then writes the VERIFIED values back into the mirror and stamps
 *     `device.lastGammaPush`.
 *   - A failed push leaves the mirror untouched and names the controller.
 *
 * Transport: the browser never talks to a controller directly — every hop goes
 * through the sim's save-server (`POST /led/gamma-push`), the same server that
 * owns the ~/tmp full-config backup. `transport` is injectable so the unit
 * tests drive the orchestration without a device or a server.
 */

import { normalizeLedWireConfig, RECOMMENDED_CONTROLLER_GAMMA } from '../led_wire.js';
import {
  isLedController,
  isValidIp,
  normalizeLedConfig,
  bindControllerDevice,
  recordDeviceGammaPush,
  LED_DEVICE_VENDOR_MARSINLED,
} from '../controller_registry.js';
import { saveHttpUrl } from '../../core/save_endpoint.js';

export const LED_GAMMA_CHANNELS = ['r', 'g', 'b', 'w'];

// The bounds are the LED controller's own accepted range, mirrored by
// led_wire.js for the scene value. A number the UI took but one of those two
// rejected would be a divergence bug, so all three agree on 1.0–3.0
// (1.0 = curve off). Anything outside is refused LOUDLY at the field.
export const LED_GAMMA_MIN = 1.0;
export const LED_GAMMA_MAX = 3.0;

/** The recommended curve (r/g/b 2.2, w 1.0 — see led_wire.js for why W is 1). */
export const LED_GAMMA_RECOMMENDED = RECOMMENDED_CONTROLLER_GAMMA;

const GAMMA_EPSILON = 1e-3;
export const GAMMA_REFRESH_TTL_MS = 60000;
const gammaRefreshCache = new Map();

/**
 * The gamma curve this controller's scene mirror currently declares. Falls back
 * to the wire DEFAULT (not a guess — normalizeLedWireConfig's documented
 * default, the same value the preview would use) when the controller carries no
 * explicit `led.wire` block. Returns a plain, mutable copy.
 */
export function readGammaMirror(controller) {
  const wire = controller && controller.led && controller.led.wire;
  const src = (wire && wire.controllerGamma) || normalizeLedWireConfig(null, 'LED').controllerGamma;
  return validateGammaMirror(src, `controller '${controller && controller.name}' gamma mirror`);
}

/**
 * Validate + normalize a gamma curve to `{r,g,b,w}` numbers. THROWS naming the
 * offending channel (codex P0 — a bad curve never reaches the mirror or the
 * wire). Missing channels are an error too: the curve is always complete.
 */
export function validateGammaMirror(raw, label = 'gamma') {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`[LedGamma] ${label} must be an object with r/g/b/w exponents`);
  }
  for (const key of Object.keys(raw)) {
    if (!LED_GAMMA_CHANNELS.includes(key)) {
      throw new Error(`[LedGamma] ${label} has unknown key '${key}' (expected r, g, b, w)`);
    }
  }
  const out = {};
  for (const ch of LED_GAMMA_CHANNELS) {
    const v = raw[ch];
    if (typeof v !== 'number' || !Number.isFinite(v) ||
        v < LED_GAMMA_MIN || v > LED_GAMMA_MAX) {
      const err = new Error(`[LedGamma] ${label}.${ch} ${JSON.stringify(raw[ch])} must be a number ` +
        `in ${LED_GAMMA_MIN}–${LED_GAMMA_MAX} (1.0 = off) — the range the LED controller accepts`);
      err.channel = ch;
      throw err;
    }
    out[ch] = v;
  }
  return out;
}

/**
 * Parse ONE field's text into a valid exponent for `channel`. THROWS with a
 * human message the field can show. Empty input is an error, never a silent
 * "keep the old value".
 */
export function parseGammaField(text, channel) {
  const trimmed = String(text === undefined || text === null ? '' : text).trim();
  if (trimmed.length === 0) {
    throw new Error(`[LedGamma] ${channel} gamma is empty — enter a number in ` +
      `${LED_GAMMA_MIN}–${LED_GAMMA_MAX} (1.0 = off)`);
  }
  const v = Number(trimmed);
  if (!Number.isFinite(v)) {
    throw new Error(`[LedGamma] ${channel} gamma '${trimmed}' is not a number`);
  }
  if (v < LED_GAMMA_MIN || v > LED_GAMMA_MAX) {
    throw new Error(`[LedGamma] ${channel} gamma ${v} is outside ` +
      `${LED_GAMMA_MIN}–${LED_GAMMA_MAX} — the range the LED controller accepts`);
  }
  return v;
}

/** True when two curves agree within the verify epsilon. */
export function gammaEquals(a, b) {
  if (!a || !b) return false;
  return LED_GAMMA_CHANNELS.every((ch) => Math.abs(Number(a[ch]) - Number(b[ch])) < GAMMA_EPSILON);
}

/** Compact display form, e.g. "2.2 / 2.2 / 2.2 / 1". */
export function formatGamma(gamma) {
  if (!gamma) return '—';
  return LED_GAMMA_CHANNELS.map((ch) => String(Number(gamma[ch]))).join(' / ');
}

function gammaExactlyEquals(a, b) {
  return LED_GAMMA_CHANNELS.every((channel) => a[channel] === b[channel]);
}

/** Resolve the one displayed source curve for a fleet run, without fallback. */
export function fleetGammaSourcePlan(controllers, selectedSourceId = null) {
  const choices = (controllers || []).filter(isLedController).map((controller) => ({
    controller,
    sourceId: String(controller.id),
    gamma: Object.freeze(readGammaMirror(controller)),
  }));
  const sourceIds = choices.map((choice) => choice.sourceId);
  if (new Set(sourceIds).size !== sourceIds.length) {
    throw new Error('[LedGamma] fleet source selection requires unique controller ids');
  }
  if (choices.length === 0) {
    return { choices, gamma: null, sourceLabel: null, requiresSelection: false };
  }

  const shared = choices.every((choice) => gammaExactlyEquals(choice.gamma, choices[0].gamma));
  if (shared) {
    return {
      choices,
      gamma: Object.freeze({ ...choices[0].gamma }),
      sourceLabel: 'shared by every displayed LED controller',
      requiresSelection: false,
    };
  }
  if (selectedSourceId === null || selectedSourceId === undefined || selectedSourceId === '') {
    return { choices, gamma: null, sourceLabel: null, requiresSelection: true };
  }
  const selected = choices.find((choice) => choice.sourceId === String(selectedSourceId));
  if (!selected) {
    throw new Error(`[LedGamma] selected fleet gamma source '${selectedSourceId}' is not displayed`);
  }
  return {
    choices,
    gamma: Object.freeze({ ...selected.gamma }),
    sourceLabel: `${selected.controller.name} (${selected.controller.ip || 'no IP'})`,
    sourceId: selected.sourceId,
    requiresSelection: false,
  };
}

// ── Curve presentation (pure, DOM-free — the UI never does this maths) ──────
//
// Report 20260725_64: the controller's own "Color Curves" card is sliders +
// a live y = x^γ plot, not text boxes. Everything the sim's control needs to
// draw that — the slider grid, the preset set, the plot geometry and the path
// maths — lives HERE so it is unit-testable without a DOM, and so the UI
// module can never quietly invent a second version of the curve.

/** Slider granularity, matching the controller's own card (1.00–3.00 by 0.05). */
export const LED_GAMMA_STEP = 0.05;

/**
 * The preset chips.
 *
 * DELIBERATE DIVERGENCE from the controller's own card: its "sRGB" / "punchy"
 * chips put the SAME exponent on W. Ours hold W at 1.0, because the device
 * derives white AFTER applying the R/G/B curve — a second exponent on W
 * compounds and crushes pastels (docs/41 §4.1(d), led_wire.js header). The
 * `w === 1` rule is test-guarded so a future edit cannot quietly adopt the
 * firmware's W = 2.2.
 */
export const LED_GAMMA_PRESETS = Object.freeze([
  Object.freeze({
    key: 'off',
    label: 'Off',
    gamma: Object.freeze({ r: 1, g: 1, b: 1, w: 1 }),
    title: 'Curve off (linear) — the controller passes bytes through',
  }),
  Object.freeze({
    key: 'srgb',
    label: '2.2 sRGB',
    gamma: Object.freeze({ ...LED_GAMMA_RECOMMENDED }),
    title: 'Recommended: R/G/B 2.2, W 1.0 (white is derived AFTER the RGB curve)',
  }),
  Object.freeze({
    key: 'punchy',
    label: 'Punchy',
    gamma: Object.freeze({ r: 2.6, g: 2.6, b: 2.6, w: 1 }),
    title: 'Deeper curve — more contrast in the low end; W stays 1.0',
  }),
]);

/**
 * Plot geometry for the inline-SVG curve preview. Sized for the docked
 * Controllers pane (the controller's own card is 240×160 on a full page).
 * `clampFloor` is the LUT's FastLED-style `applyGamma_video` behaviour: for
 * any x > 0 the output never falls below 1/255, so a dim pixel never drops to
 * full black. Drawing it is what makes the preview honest.
 */
export const GAMMA_CURVE_GEOMETRY = Object.freeze({
  width: 132,
  height: 84,
  pad: 5,
  samples: 48,
  clampFloor: 1 / 255,
});

/**
 * Snap an exponent to the slider's 0.05 grid and to 2 decimals.
 *
 * SNAPS ONLY — it never clamps. An out-of-range number must already have been
 * refused by parseGammaField; clamping here would be a silent fallback (codex
 * P0) that hides a caller bug. The second rounding is not cosmetic:
 * `Math.round(v / 0.05) * 0.05` alone yields 2.3000000000000003, which would
 * land verbatim in controllers.yaml.
 *
 * @param {number|string} value
 * @returns {number} the snapped exponent (≤ 2 decimals)
 */
export function quantizeGamma(value) {
  const v = Number(value);
  if (!Number.isFinite(v)) {
    throw new Error(`[LedGamma] cannot quantize ${JSON.stringify(value)} — not a finite number`);
  }
  return Math.round(Math.round(v / LED_GAMMA_STEP) * LED_GAMMA_STEP * 100) / 100;
}

/**
 * The SVG path for ONE channel's y = x^γ curve, in plot pixel space.
 *
 * x is the input level (0→1, left to right), y the output level (0→1, bottom
 * to top), so screen-y is inverted. This is the ONLY place the curve maths
 * exists — the UI module asks for a path string and draws it.
 *
 * @param {number} exponent - the channel's gamma
 * @param {Object} [geom] - GAMMA_CURVE_GEOMETRY (overridable for tests)
 * @returns {string} an 'M…L…' path
 */
export function gammaCurvePath(exponent, geom = GAMMA_CURVE_GEOMETRY) {
  const g = Number(exponent);
  if (!Number.isFinite(g) || g <= 0) {
    throw new Error(`[LedGamma] cannot plot exponent ${JSON.stringify(exponent)} — ` +
      'a curve exponent must be a finite number greater than 0');
  }
  const { width, height, pad, samples, clampFloor } = geom;
  const innerW = width - 2 * pad;
  const innerH = height - 2 * pad;
  const points = [];
  for (let i = 0; i <= samples; i++) {
    const x = i / samples;
    // Video clamp: x = 0 stays black, everything above it keeps at least 1/255.
    const y = x === 0 ? 0 : Math.max(x ** g, clampFloor);
    const sx = Math.round((pad + x * innerW) * 10) / 10;
    const sy = Math.round((pad + (1 - y) * innerH) * 10) / 10;
    points.push(`${sx},${sy}`);
  }
  return `M${points[0]}L${points.slice(1).join('L')}`;
}

/**
 * Which preset (if any) this curve currently IS. Uses gammaEquals, so the
 * float32 read-back noise a verified push mirrors back (2.2 → 2.200000048)
 * still lights the chip.
 *
 * @returns {string|null} the preset key, or null for a hand-tuned curve
 */
export function activeGammaPresetKey(gamma) {
  if (!gamma) return null;
  const hit = LED_GAMMA_PRESETS.find((preset) => gammaEquals(preset.gamma, gamma));
  return hit ? hit.key : null;
}

/**
 * Write a curve into the controller's SCENE MIRROR
 * (`led.wire.controllerGamma`), preserving every other wire key. Round-trips
 * through normalizeLedWireConfig so an invalid curve throws here rather than at
 * the next scene boot. Mutates + returns the controller's `led` block.
 *
 * Call this INSIDE the editor's mutate() so the scene is marked dirty and the
 * change is undoable, exactly like the other LED config edits.
 */
export function setGammaMirror(controller, gamma) {
  if (!isLedController(controller)) {
    throw new Error(`[LedGamma] '${controller && controller.name}' is not an LED controller — ` +
      'gamma is an LED-controller setting only');
  }
  const clean = validateGammaMirror(gamma, `controller '${controller.name}' gamma`);
  const led = controller.led || normalizeLedConfig(null, controller.name);
  const currentWire = led.wire || {};
  led.wire = normalizeLedWireConfig({
    foldAmber: currentWire.foldAmber,
    amberRgb: currentWire.amberRgb ? [...currentWire.amberRgb] : undefined,
    controllerWhite: currentWire.controllerWhite,
    controllerGamma: clean,
  }, `LED controller '${controller.name}'`);
  controller.led = led;
  return led;
}

/**
 * Apply a SUCCESSFUL push to the scene: mirror the HARDWARE-VERIFIED curve and
 * stamp `device.lastGammaPush`. An unbound card that answered is bound from the
 * device identity the push reported (same rule as the mapping push). Mutates
 * the controller; call inside mutate().
 */
export function commitGammaPush(controller, result) {
  const verified = validateGammaMirror(result.verified,
    `controller '${controller.name}' verified gamma`);
  setGammaMirror(controller, verified);
  if (!controller.device) {
    if (!result.controllerId) {
      throw new Error(`[LedGamma] '${controller.name}' is unbound and the device reported no ` +
        'controllerId — cannot stamp the push provenance');
    }
    bindControllerDevice(controller, {
      vendor: LED_DEVICE_VENDOR_MARSINLED,
      controllerId: result.controllerId,
      deviceName: result.deviceName,
      boardId: result.boardId,
    });
  }
  recordDeviceGammaPush(controller, {
    at: result.at || new Date().toISOString(),
    outcome: result.outcome === 'needs-reboot' ? 'needs-reboot' : 'applied',
    gamma: verified,
    firmwareSHA: result.firmwareSHA,
  });
  return controller;
}

function validateGammaReadIdentity(controller, result) {
  const device = controller.device;
  if (device && device.controllerId && result.controllerId !== device.controllerId) {
    throw new Error(`[LedGamma] '${controller.name}' gamma refresh identity mismatch — expected ` +
      `controllerId '${device.controllerId}', got ${JSON.stringify(result.controllerId)}`);
  }
  if (device && device.boardId && result.boardId !== device.boardId) {
    throw new Error(`[LedGamma] '${controller.name}' gamma refresh identity mismatch — expected ` +
      `boardId '${device.boardId}', got ${JSON.stringify(result.boardId)}`);
  }
  if (!device && !result.controllerId) {
    throw new Error(`[LedGamma] '${controller.name}' gamma refresh reported no controllerId`);
  }
}

/** Mirror one validated saved-config read without stamping it as a push. */
export function commitGammaRefresh(controller, result) {
  validateGammaReadIdentity(controller, result);
  const gamma = validateGammaMirror(result.gamma,
    `controller '${controller.name}' saved gamma`);
  setGammaMirror(controller, gamma);
  if (!controller.device) {
    bindControllerDevice(controller, {
      vendor: LED_DEVICE_VENDOR_MARSINLED,
      controllerId: result.controllerId,
      deviceName: result.deviceName,
      boardId: result.boardId,
    });
  }
  return controller;
}

export function gammaRefreshState(controller) {
  const entry = gammaRefreshCache.get(controller);
  return entry && entry.record ? { ...entry.record } : null;
}

export function clearGammaRefreshCache(controller) {
  if (controller) gammaRefreshCache.delete(controller);
  else gammaRefreshCache.clear();
}

function cacheVerifiedGamma(controller, result, nowMs) {
  const record = {
    state: 'ok',
    gamma: Object.freeze({ ...validateGammaMirror(result.gamma || result.verified) }),
    controllerId: result.controllerId || null,
    boardId: result.boardId || null,
    firmwareSHA: result.firmwareSHA || null,
    at: result.at || new Date(nowMs).toISOString(),
    source: 'saved-config',
    cached: false,
  };
  gammaRefreshCache.set(controller, { atMs: nowMs, record, inFlight: null });
  return record;
}

/** One TTL-deduplicated saved-config read; never polls or retries. */
export function refreshGammaFromController(controller, transport, commit, options = {}) {
  const now = options.now || (() => Date.now());
  const nowMs = now();
  const ttlMs = options.ttlMs === undefined ? GAMMA_REFRESH_TTL_MS : options.ttlMs;
  const existing = gammaRefreshCache.get(controller);
  if (existing && existing.inFlight) return existing.inFlight;
  if (!options.force && existing && existing.record && nowMs - existing.atMs < ttlMs) {
    return Promise.resolve({ ...existing.record, cached: true });
  }

  const inFlight = (async () => {
    let record;
    try {
      if (!isLedController(controller)) throw new Error('not an LED controller');
      if (!isValidIp(controller.ip)) throw new Error(`no valid device IP ('${controller.ip}')`);
      const result = await transport.readGamma(controller.ip);
      validateGammaReadIdentity(controller, result);
      const gamma = validateGammaMirror(result.gamma,
        `controller '${controller.name}' saved gamma`);
      const verified = { ...result, gamma, at: result.at || new Date(now()).toISOString() };
      if (commit) commit(controller, verified);
      record = cacheVerifiedGamma(controller, verified, now());
    } catch (err) {
      record = {
        state: err.kind === 'unreachable' ? 'unreachable' : 'failed',
        detail: err.message,
        at: new Date(now()).toISOString(),
        source: 'saved-config',
        cached: false,
      };
      gammaRefreshCache.set(controller, { atMs: now(), record, inFlight: null });
    }
    return { ...record };
  })();
  gammaRefreshCache.set(controller, { atMs: nowMs, record: existing && existing.record, inFlight });
  return inFlight;
}

// ── Transport (browser → sim save-server → controller) ──────────────────────

/** Exact browser → save-server JSON body for one gamma push. */
export function gammaPushRequestBody(ip, gamma, controllerName) {
  return {
    ip,
    gamma: validateGammaMirror(gamma, `controller '${controllerName}' gamma request`),
    controllerName,
  };
}

async function postGamma(ip, gamma, controllerName) {
  // controllerName is the card's name, sent for exactly one server-side use:
  // repairing an invalid STORED deviceName (docs/41 §4.1.1) — a board in that
  // state rejects EVERY config write, gamma included. Verbatim or refused,
  // never sanitized (led_gamma_service.gammaPushBody).
  const res = await fetch(saveHttpUrl('/led/gamma-push'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(gammaPushRequestBody(ip, gamma, controllerName)),
  });
  let payload = null;
  try { payload = await res.json(); } catch { /* handled below */ }
  if (!payload) {
    throw Object.assign(new Error(`sim server returned HTTP ${res.status} with no JSON body — ` +
      'is the save-server running?'), { kind: 'error' });
  }
  if (!res.ok || payload.ok !== true) {
    throw Object.assign(new Error(payload.error || `HTTP ${res.status}`),
      { kind: payload.kind || 'error' });
  }
  return payload;
}

async function getGamma(ip) {
  const res = await fetch(saveHttpUrl(`/led/gamma?ip=${encodeURIComponent(ip)}`));
  const payload = await res.json();
  if (!res.ok || payload.ok !== true) {
    throw Object.assign(new Error(payload.error || `HTTP ${res.status}`),
      { kind: payload.kind || 'error' });
  }
  return payload;
}

/** The production transport: every hop goes through the sim's save-server. */
export const DEFAULT_GAMMA_TRANSPORT = { pushGamma: postGamma, readGamma: getGamma };

// ── Push orchestration (DOM-free, sequential, per-controller results) ───────

/**
 * Push ONE controller's current mirror curve to its hardware.
 *
 * Never throws — returns a result record so a fleet run can carry on and report
 * every controller. `state` ∈ 'ok' | 'skipped' | 'unreachable' | 'failed'.
 * `commit` (usually a ctx.mutate wrapper) is invoked ONLY on a verified
 * success; a failure leaves the mirror exactly as it was.
 * `options.gamma`, when supplied, is the immutable operator-confirmed curve;
 * the live scene mirror is not reread after confirmation.
 */
export async function pushGammaToController(controller, transport, commit, options = {}) {
  const base = { id: controller.id, name: controller.name, ip: controller.ip };
  if (!isLedController(controller)) {
    return { ...base, state: 'skipped', detail: 'not an LED controller' };
  }
  if (!isValidIp(controller.ip)) {
    return { ...base, state: 'skipped', detail: `no valid device IP ('${controller.ip}')` };
  }
  let gamma;
  try {
    const requested = options.gamma === undefined ? readGammaMirror(controller) : options.gamma;
    gamma = validateGammaMirror(requested, `controller '${controller.name}' gamma`);
  } catch (err) {
    return { ...base, state: 'failed', detail: err.message };
  }
  let result;
  try {
    result = await transport.pushGamma(controller.ip, gamma, controller.name);
  } catch (err) {
    return {
      ...base,
      state: err.kind === 'unreachable' ? 'unreachable' : 'failed',
      detail: err.message,
    };
  }
  let verified;
  try {
    verified = validateGammaMirror(result.verified,
      `controller '${controller.name}' verified gamma`);
    if (!gammaEquals(verified, gamma)) {
      throw new Error(`[LedGamma] '${controller.name}' saved-config read-back MISMATCH — ` +
        `sent ${formatGamma(gamma)}, verified ${formatGamma(verified)}`);
    }
  } catch (err) {
    return { ...base, state: 'failed', detail: err.message };
  }
  const stamped = { ...result, verified, at: result.at || new Date().toISOString() };
  try {
    if (commit) commit(controller, stamped);
  } catch (err) {
    // The DEVICE was written and verified, but recording it failed (e.g. the
    // controller was deleted mid-push). Loud, and NOT reported as a success.
    return { ...base, state: 'failed', detail: `device written + verified, but the scene mirror ` +
      `could not be updated: ${err.message}` };
  }
  cacheVerifiedGamma(controller, stamped, Date.now());
  return {
    ...base,
    state: 'ok',
    verified,
    outcome: stamped.outcome === 'needs-reboot' ? 'needs-reboot' : 'applied',
    backupPath: stamped.backupPath,
  };
}

/**
 * Fleet push: every LED controller, SEQUENTIALLY, each with its own result.
 * There is no aggregate "mostly worked" — the caller renders one row per
 * controller (ok / failed / unreachable / skipped) and unreachable devices are
 * named. One controller's failure never aborts the rest.
 *
 * @param {Array<Object>} controllers - registry controllers (non-LED are skipped)
 * @param {{pushGamma: Function}} transport
 * @param {{commit?: Function, onResult?: Function, gammaSnapshot?: Object}} [hooks]
 * @returns {Promise<Array<Object>>} one record per LED controller, in order.
 */
export async function pushGammaFleet(controllers, transport, hooks = {}) {
  const leds = (controllers || []).filter(isLedController);
  const results = [];
  for (let i = 0; i < leds.length; i++) {
    const controller = leds[i];
    if (!hooks.gammaSnapshot) {
      const record = {
        id: controller.id,
        name: controller.name,
        ip: controller.ip,
        state: 'failed',
        detail: 'confirmed fleet gamma curve is missing — refusing to choose a card implicitly',
      };
      results.push(record);
      if (hooks.onResult) hooks.onResult(record, i + 1, leds.length);
      continue;
    }
    const record = await pushGammaToController(controller, transport, hooks.commit,
      { gamma: hooks.gammaSnapshot });
    results.push(record);
    if (hooks.onResult) hooks.onResult(record, i + 1, leds.length);
  }
  return results;
}

/** Roll a fleet run up for the summary line (counts only — details stay per row). */
export function summarizeFleetResults(results) {
  const tally = { ok: 0, failed: 0, unreachable: 0, skipped: 0 };
  for (const r of results || []) {
    if (tally[r.state] === undefined) tally[r.state] = 0;
    tally[r.state] += 1;
  }
  return tally;
}
