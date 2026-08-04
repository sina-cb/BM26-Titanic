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

/**
 * The gamma curve this controller's scene mirror currently declares. Falls back
 * to the wire DEFAULT (not a guess — normalizeLedWireConfig's documented
 * default, the same value the preview would use) when the controller carries no
 * explicit `led.wire` block. Returns a plain, mutable copy.
 */
export function readGammaMirror(controller) {
  const wire = controller && controller.led && controller.led.wire;
  const src = (wire && wire.controllerGamma) || normalizeLedWireConfig(null, 'LED').controllerGamma;
  const out = {};
  for (const ch of LED_GAMMA_CHANNELS) out[ch] = Number(src[ch]);
  return out;
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
    const v = Number(raw[ch]);
    if (!Number.isFinite(v) || v < LED_GAMMA_MIN || v > LED_GAMMA_MAX) {
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

// ── Transport (browser → sim save-server → controller) ──────────────────────

async function postGamma(ip, gamma, controllerName) {
  // controllerName is the card's name, sent for exactly one server-side use:
  // repairing an invalid STORED deviceName (docs/41 §4.1.1) — a board in that
  // state rejects EVERY config write, gamma included. Verbatim or refused,
  // never sanitized (led_gamma_service.gammaPushBody).
  const res = await fetch(saveHttpUrl('/led/gamma-push'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ip, gamma, controllerName }),
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
 */
export async function pushGammaToController(controller, transport, commit) {
  const base = { id: controller.id, name: controller.name, ip: controller.ip };
  if (!isLedController(controller)) {
    return { ...base, state: 'skipped', detail: 'not an LED controller' };
  }
  if (!isValidIp(controller.ip)) {
    return { ...base, state: 'skipped', detail: `no valid device IP ('${controller.ip}')` };
  }
  let gamma;
  try {
    gamma = validateGammaMirror(readGammaMirror(controller), `controller '${controller.name}' gamma`);
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
  try {
    const stamped = { ...result, at: result.at || new Date().toISOString() };
    if (commit) commit(controller, stamped);
    return {
      ...base,
      state: 'ok',
      verified: validateGammaMirror(stamped.verified, `controller '${controller.name}' verified gamma`),
      outcome: stamped.outcome === 'needs-reboot' ? 'needs-reboot' : 'applied',
      backupPath: stamped.backupPath,
    };
  } catch (err) {
    // The DEVICE was written and verified, but recording it failed (e.g. the
    // controller was deleted mid-push). Loud, and NOT reported as a success.
    return { ...base, state: 'failed', detail: `device written + verified, but the scene mirror ` +
      `could not be updated: ${err.message}` };
  }
}

/**
 * Fleet push: every LED controller, SEQUENTIALLY, each with its own result.
 * There is no aggregate "mostly worked" — the caller renders one row per
 * controller (ok / failed / unreachable / skipped) and unreachable devices are
 * named. One controller's failure never aborts the rest.
 *
 * @param {Array<Object>} controllers - registry controllers (non-LED are skipped)
 * @param {{pushGamma: Function}} transport
 * @param {{commit?: Function, onResult?: Function}} [hooks]
 * @returns {Promise<Array<Object>>} one record per LED controller, in order.
 */
export async function pushGammaFleet(controllers, transport, hooks = {}) {
  const leds = (controllers || []).filter(isLedController);
  const results = [];
  for (let i = 0; i < leds.length; i++) {
    const record = await pushGammaToController(leds[i], transport, hooks.commit);
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
