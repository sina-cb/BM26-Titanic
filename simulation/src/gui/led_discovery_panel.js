/**
 * led_discovery_panel.js — Discover / bind / push UI for MarsinLED LED-string
 * controllers (plan 20260709_0 P3). Kept OUT of controller_map_editor.js to
 * keep that panel readable; the editor supplies a small `ctx` of primitives
 * (registry access, the mutate/undo pipeline, strand counts, re-render) and
 * calls these functions.
 *
 * Everything network-facing goes through marsinled_client.js (transport) and
 * device_config_mapper.js (pure derivation) — this module owns only DOM and
 * the orchestration of discover → bind → push → verify. Fail loud everywhere
 * (codex P0): an unreachable device or a failed verify is a red error state,
 * never a silent retry or a swallowed miss.
 */
import {
  scanSubnet,
  getConfig,
  getStatus,
  awaitReboot,
  normalizeSubnetPrefix,
  deviceSupportsPerOutput,
  readPerOutput,
  pushPerOutputUniverses,
  validatePerOutputPlan,
  applyPerOutputPlan,
  PER_OUTPUT_WRITE_TIMEOUT_MS,
  REBOOT_WAIT_TIMEOUT_MS,
} from '../dmx/led/marsinled_client.js';
import {
  derivePerOutputPlan,
} from '../dmx/led/device_config_mapper.js';
import { projectLedStrandSegments } from '../dmx/led/led_patch_projection.js';
import {
  isLedController,
  isBoundLedController,
  addLedControllerFromDevice,
  bindControllerDevice,
  recordDevicePush,
  ledOutputIndexForPort,
  setParkedUniverse,
  clearParkedUniverse,
  LED_DEVICE_VENDOR_MARSINLED,
  LED_MAX_OUTPUTS,
  nextFreeUniverse,
  noteUniverseUsed,
  isValidIp,
} from '../dmx/controller_registry.js';

// ── Scene-scoped cache key (G7) ──────────────────────────────────────────────
// nextControllerId RESTARTS at 1 in every scene (controller_registry.js
// createControllerRegistry), so controller.id alone is NOT unique across scenes:
// a stale entry keyed by id 1 from the previous scene could be served for THIS
// scene's id-1 controller (a wrong sync chip / wrong MAC). Namespacing every
// cache key by the active scene makes a cross-scene collision impossible — a
// different scene simply reads under a different key. `ctx.activeScene()` is the
// same source main.js installs at boot; threading ctx keeps this module free of
// hidden window globals (it already takes ctx for everything else).
function cacheKey(ctx, controllerId) {
  return `${ctx.activeScene()}::${controllerId}`;
}

// ── Sync-chip cache (computed on panel open + after push; no polling) ───────
// key = `${scene}::${controllerId}` → { state:
//   'in-sync'|'drift'|'unreachable'|'never'|'checking', detail?, changes? }
const syncCache = new Map();

function setSyncState(ctx, controllerId, state) {
  syncCache.set(cacheKey(ctx, controllerId), state);
}

export function getSyncState(ctx, controllerId) {
  return syncCache.get(cacheKey(ctx, controllerId)) || null;
}

// ── Live MAC cache (display-only; NEVER persisted) ───────────────────────────
// key → MAC string, refreshed from the device's live HTTP status
// (marsinled_client.js) at discover/bind/push/verify time. The MAC is
// deliberately absent from controller.device (see controller_registry.js
// normalizeDeviceBlock) so it never round-trips into controllers.yaml — this
// repo is public and a persisted MAC trips the gitleaks security gate. This
// cache is memory-only and resets on reload; that's fine, it repopulates the
// next time the panel talks to the device.
const liveMacCache = new Map();

function setLiveMac(ctx, controllerId, mac) {
  if (mac) liveMacCache.set(cacheKey(ctx, controllerId), mac);
}

export function getLiveMac(ctx, controllerId) {
  return liveMacCache.get(cacheKey(ctx, controllerId)) || null;
}

// ── Device outputs cache (display-only; NEVER persisted) ─────────────────────
// key → the device's `strands[]` as last read (enabled / count / dmxUniverse per
// physical output). Populated from every getConfig/getStatus the panel already
// performs (discover, bind, push, sync-chip refresh) so the port row's output
// selector can offer exactly the outputs the board HAS, labelled with what each
// one is doing today.
//
// MEMORY ONLY, deliberately (report 20260725_70 §5.2): a stale on-disk output
// count would silently constrain the selector on a machine that has never talked
// to this board — offering 1…4 on a 16-output controller with no way to tell.
// With an empty cache the selector offers 1…16 and SAYS the range is unverified.
const deviceOutputsCache = new Map();

function setDeviceOutputs(ctx, controllerId, strands) {
  if (!Array.isArray(strands)) return;
  deviceOutputsCache.set(cacheKey(ctx, controllerId), strands.map((s) => ({
    enabled: s && s.enabled === true,
    count: s && Number.isInteger(s.count) ? s.count : null,
    universe: s && Number.isInteger(s.dmxUniverse) ? s.dmxUniverse : null,
  })));
}

/** The device's last-read outputs for a card, or null when it was never read. */
export function getDeviceOutputs(ctx, controllerId) {
  return deviceOutputsCache.get(cacheKey(ctx, controllerId)) || null;
}

/**
 * The port row's output-selector model. PURE (no DOM) so the uniqueness rule and
 * the range rule are unit-testable without a browser.
 *
 * Two enforcement layers protect "no repeating port→output associations"
 * (operator order 3): this one makes a duplicate UNSELECTABLE, and the push gate
 * blocks it regardless of who authored the file (a hand-edited controllers.yaml
 * has no UI to go through).
 *
 * @param {Object} controller - the LED card.
 * @param {Object} port - the port row being rendered.
 * @param {Array|null} deviceOutputs - `getDeviceOutputs(...)`, or null when the
 *   board has never been read.
 * @returns {{options: Array<{value:number,label:string,disabled:boolean,
 *   takenBy:(number|undefined),selected:boolean}>, verified: boolean,
 *   max: number}}
 */
export function outputSelectorOptions(controller, port, deviceOutputs) {
  const verified = Array.isArray(deviceOutputs) && deviceOutputs.length > 0;
  const max = verified ? Math.min(deviceOutputs.length, LED_MAX_OUTPUTS) : LED_MAX_OUTPUTS;
  const takenBy = new Map();   // output number → the OTHER port row that drives it
  for (const other of controller.ports || []) {
    if (other === port) continue;
    if (Number.isInteger(other.output)) takenBy.set(other.output, other.port);
  }
  const options = [];
  for (let n = 1; n <= max; n++) {
    const owner = takenBy.get(n);
    const dev = verified ? deviceOutputs[n - 1] : null;
    let label = String(n);
    if (owner !== undefined) {
      label = `${n} — taken by P${owner}`;
    } else if (dev) {
      label = dev.enabled
        ? `${n} — enabled${dev.count !== null ? `, ${dev.count} px` : ''}` +
          `${dev.universe !== null ? `, U${dev.universe}` : ''}`
        : `${n} — disabled (push will enable it)`;
    }
    options.push({
      value: n,
      label,
      disabled: owner !== undefined,
      takenBy: owner,
      selected: port.output === n,
    });
  }
  return { options, verified, max };
}

// ── Small DOM helpers ───────────────────────────────────────────────────────

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function subnetStorageKey(ctx) {
  return `bm26.ledDiscovery.subnet.${ctx.activeScene()}`;
}

function loadSubnet(ctx) {
  try {
    const v = window.localStorage.getItem(subnetStorageKey(ctx));
    if (v && normalizeSubnetPrefix(v)) return v;
  } catch { /* localStorage unavailable — fall through to the default */ }
  return '10.1.1';
}

function saveSubnet(ctx, value) {
  try { window.localStorage.setItem(subnetStorageKey(ctx), value); } catch { /* ignore */ }
}

/**
 * SHA-256 hex of a string (config-hash provenance). Uses globalThis.crypto so
 * it works both in the sim browser (secure-context on localhost) and under
 * node:test's webcrypto — identical object as window.crypto in the browser.
 */
async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ── Injectable device I/O (default = the real MarsinLED client) ─────────────
// The per-output push orchestration takes an `io` bag so the unit tests drive it
// against a mock device store (no live POST to 10.1.1.20x — the operator runs
// experiments on that hardware). Production callers use DEFAULT_DEVICE_IO.
const DEFAULT_DEVICE_IO = {
  getConfig, getStatus, awaitReboot,
  pushPerOutputUniverses,
  // ── Slice S1: the two steps that make a push EFFECTIVE ────────────────────
  // A device write moves ONE of the six state layers (report 20260725_58 §1).
  // The sACN feed the device actually receives is produced from FILES ON DISK —
  // patches.yaml (bridge relay routes) and the engine model (send set) — which
  // only a scene save writes, and auto-save is off. So a push that stops at the
  // device is invisible on the hardware until someone saves by hand. These two
  // members are the same paths the operator drove manually: ONE save path in the
  // codebase (window.exportConfig, the 💾 buttons' path) and the bridge notify.
  // Both are injectable so the unit tests never save a scene or touch a device.
  persistScene: () => {
    if (typeof window.exportConfig !== 'function') {
      throw new Error('window.exportConfig is not installed — the scene cannot be saved');
    }
    return window.exportConfig();
  },
  notifyBridge: () => {
    if (!window.PatchManager || typeof window.PatchManager.notifySacnBridge !== 'function') {
      throw new Error('window.PatchManager.notifySacnBridge is not installed — the sACN bridge ' +
        'cannot be told to reload its routes');
    }
    return window.PatchManager.notifySacnBridge();
  },
};

// ── Layout preview (no device I/O) ──────────────────────────────────────────

/**
 * Compute the PER-OUTPUT layout for the per-port derived line from registry
 * state. Per-output firmware contract (docs/41; operator ruling 2026-07-10/11:
 * per-output is the ONLY layout): every port IS one device output — the cursor
 * starts at (port.universe, ch 1) for EACH port; strands in a port's chain pack
 * contiguously through the shared no-straddle walker. The legacy single-base
 * linear preview (synthLinearConfig + computeLinearLayout) was removed with the
 * rest of the linear path.
 *
 * KEYED BY PORT NUMBER, LABELLED BY OUTPUT (report 20260725_70 §5.1). The two
 * used to be the same number; since the output selector they can differ (P1 may
 * drive output 4), and the caller renders this line ON a port row — so the key
 * has to be the row's identity while the text names the physical output.
 *
 * Returns { perOutput: Map<portNum, layoutEntry>, universes: number[],
 * error: string|null }. Each entry carries `portNum`, `output` (1-based) and
 * `outputIndex` (0-based). Needs NO device snapshot.
 */
export function deriveLayoutPreview(controller, strandCounts) {
  const stride = (controller.led && controller.led.stride) || 4;
  const perOutput = new Map();
  const universes = new Set();
  let anyEnabled = false;
  for (const port of controller.ports || []) {
    const outputIndex = ledOutputIndexForPort(port);
    const names = (port.chain || []).filter((n) => typeof n === 'string');
    const pixelCount = names.reduce((sum, n) => sum + (strandCounts.get(n) || 0), 0);
    if (pixelCount <= 0 || !Number.isInteger(port.universe) || port.universe < 1) {
      perOutput.set(port.port, {
        portNum: port.port, output: port.output, outputIndex,
        enabled: false, universe: port.universe,
        startChannel: 0, endChannel: 0, endUniverse: port.universe,
        pixelCount, segments: [],
      });
      continue;
    }
    const walk = projectLedStrandSegments(port.universe, 1, stride, pixelCount);
    if (walk.overflow) {
      return { perOutput: new Map(), universes: [],
        error: `P${port.port} → output ${port.output} spills past the sACN universe ceiling` };
    }
    const last = walk.segments[walk.segments.length - 1];
    perOutput.set(port.port, {
      portNum: port.port, output: port.output, outputIndex,
      enabled: true, universe: port.universe,
      startChannel: 1, endChannel: last.endChannel, endUniverse: last.universe,
      pixelCount, segments: walk.segments,
    });
    for (const seg of walk.segments) universes.add(seg.universe);
    anyEnabled = true;
  }
  if (!anyEnabled) {
    return { perOutput, universes: [], error: 'no enabled output (assign a strand first)' };
  }
  return { perOutput, universes: [...universes].sort((a, b) => a - b), error: null };
}

// ── Per-output universe repair (whole-universe, monotonic) ──────────────────

/**
 * Ensure every port carries a valid universe (Slice D: the base is the first
 * enabled output's port.universe, and each output declares its own). Create-
 * from-device already gives every port a fresh universe via addPort, so this is
 * only a repair path for a port left at ≤0. Allocates monotonically through
 * nextFreeUniverse; never rewrites an already-valid manual universe.
 */
function ensurePortUniverses(ctx, controller) {
  const bad = (controller.ports || []).filter(
    (p) => !Number.isInteger(p.universe) || p.universe < 1);
  if (bad.length === 0) return;
  const registry = ctx.registry();
  ctx.mutate(`Allocated universe(s) for ${controller.name}`, () => {
    for (const port of bad) {
      const u = nextFreeUniverse(registry);
      port.universe = u;
      noteUniverseUsed(registry, u);
    }
  });
}

// ── Registry-wide universe claims (per-output plan gate, slice S2) ──────────

/**
 * The universes owned by controllers OTHER than `controller`, as the editor sees
 * them (DMX `computeProjection().universeMaps` + `computeLedUniverseClaims()`,
 * assembled by `collectClaimedUniverses`). The editor owns those projections, so
 * the panel takes the index through `ctx` — and REFUSES to plan without it: a
 * registry-blind plan is exactly the defect this gate closes (report 20260725_58
 * §4 — a push auto-assigned U23, which another controller already owned).
 * THROWS on a ctx missing the member (fail loud, codex P0 — never plan blind).
 */
/**
 * One sentence for a blocking plan refusal — the SAME text on the sync chip, the
 * refusal dialog's toast and the fleet push's per-controller detail, so the three
 * can never tell different stories. A pure universe-ownership clash keeps its
 * original "universe collision" lead (that IS what it is); anything else (a
 * duplicate output, an out-of-range output, an exhausted park window) leads with
 * the refusal itself, because calling those a "universe collision" would send the
 * operator hunting the wrong field.
 */
function describeCollisions(collisions) {
  const kinds = new Set(collisions.map((c) => c.kind));
  const lead = (kinds.size === 1 && kinds.has('universe_owned'))
    ? 'universe collision' : 'push REFUSED';
  return `${lead} — ${collisions.map((c) => c.message).join('; ')}`;
}

function claimedUniversesFor(ctx, controller) {
  if (typeof ctx.claimedUniverses !== 'function') {
    throw new Error('[LedPanel] ctx.claimedUniverses(controller) is missing — the per-output plan ' +
      'gate cannot see which universes other controllers own; refusing to derive a plan');
  }
  const claimed = ctx.claimedUniverses(controller);
  if (!claimed || typeof claimed.has !== 'function') {
    throw new Error('[LedPanel] ctx.claimedUniverses(controller) must return a Set or Map of the ' +
      'universes other controllers claim');
  }
  return claimed;
}

// ── Bind affordance ─────────────────────────────────────────────────────────

/**
 * Should the discovery modal offer "Bind to '<controller>'" for this device?
 * True whenever the modal was opened FROM a controller card and that controller
 * is not ALREADY bound to THIS device (same device `controllerId`) — rebinding a
 * card onto a different device stays offered, binding it to the device it
 * already is stays suppressed.
 *
 * The IP-match dedup that drives the "✓ already added" label must NOT gate this.
 * A card the operator typed by hand carries the right IP but NO device block, so
 * it is UNBOUND — and an unbound card is exactly the one that needs to bind.
 * Gating Bind on the IP match made such a card permanently unbindable: its own
 * "🔍 Discover / bind device" scan found the device and then offered nothing but
 * "✓ already added as '<itself>'", so it never got a device block, never got a
 * sync chip, and stayed invisible to every bound-only flow (push-all, gamma-all).
 * That is the "the controller doesn't show up" report. Fixed 2026-07-30.
 */
export function shouldOfferBind(controller, device) {
  if (!controller || !device) return false;
  const boundId = controller.device && controller.device.controllerId;
  return !(boundId && device.controllerId && boundId === device.controllerId);
}

// ── Discovery modal ─────────────────────────────────────────────────────────

/**
 * Open the discover-and-bind modal. `controller` null = create-only mode
 * (global "Discover LED controllers"); a controller = also offer "Bind to
 * selected controller".
 */
export function openLedDiscoveryPanel(ctx, { controller = null } = {}) {
  const overlay = el('div', 'vm-modal-overlay');
  const card = el('div', 'vm-modal-card led-disc-card');
  overlay.appendChild(card);

  const title = controller
    ? `Discover LED Controllers — bind to '${controller.name}'`
    : 'Discover LED Controllers';
  card.appendChild(el('div', 'vm-modal-title', title));

  // Subnet row.
  const row = el('div', 'led-disc-row');
  const subnetInput = el('input', 'vm-modal-input led-disc-subnet');
  subnetInput.placeholder = 'subnet — e.g. 10.1.1';
  subnetInput.value = loadSubnet(ctx);
  const scanBtn = el('button', 'vm-modal-btn vm-modal-btn-primary', 'Scan');
  const cancelScanBtn = el('button', 'vm-modal-btn', 'Cancel');
  cancelScanBtn.disabled = true;
  row.appendChild(subnetInput);
  row.appendChild(scanBtn);
  row.appendChild(cancelScanBtn);
  card.appendChild(row);

  const progress = el('div', 'led-disc-progress');
  const progressBar = el('div', 'led-disc-progress-bar');
  progress.appendChild(progressBar);
  const progressText = el('div', 'led-disc-progress-text');
  card.appendChild(progress);
  card.appendChild(progressText);

  const results = el('div', 'led-disc-results');
  card.appendChild(results);

  const closeRow = el('div', 'vm-modal-actions');
  const closeBtn = el('button', 'vm-modal-btn', 'Close');
  closeRow.appendChild(closeBtn);
  card.appendChild(closeRow);

  let abort = null;
  const done = () => {
    if (abort) { abort.abort(); abort = null; }
    overlay.remove();
  };
  closeBtn.onclick = done;
  cancelScanBtn.onclick = () => { if (abort) abort.abort(); };
  overlay.onkeydown = (e) => { if (e.key === 'Escape') done(); };

  const renderCard = (device) => {
    const dc = el('div', 'led-disc-device');
    const name = device.deviceName || device.controllerId;
    const headEl = el('div', 'led-disc-device-head');
    headEl.appendChild(el('span', 'led-disc-device-name', `💡 ${name}`));
    headEl.appendChild(el('span', 'led-disc-device-ip', device.ip));
    dc.appendChild(headEl);

    const meta = el('div', 'led-disc-device-meta');
    const strandsArr = Array.isArray(device.strands) ? device.strands : [];
    const enabled = strandsArr.filter((s) => s && s.enabled).length;
    const perOut = strandsArr
      .map((s, i) => `${i + 1}:${s && s.enabled ? `${s.count || 0}px` : 'off'}`).join('  ');
    const sacnOn = device.sacn && device.sacn.enabled;
    meta.textContent =
      `id ${device.controllerId} · board ${device.boardId} · ${enabled}/${strandsArr.length} enabled` +
      (Number.isFinite(device.fps) ? ` · ${device.fps}fps` : '') +
      ` · sACN ${sacnOn ? 'on' : 'off'}`;
    dc.appendChild(meta);
    dc.appendChild(el('div', 'led-disc-device-outputs', perOut));

    // Dedup: if a controller in this scene already IS this device (matched by
    // the device's unique controllerId, or failing that its IP), don't offer to
    // add a duplicate — just say it's already added.
    const existing = ctx.registry().controllers.find((c) =>
      isLedController(c) && (
        (c.device && c.device.controllerId && device.controllerId &&
          c.device.controllerId === device.controllerId) ||
        (c.ip && device.ip && c.ip === device.ip)
      ));

    const actions = el('div', 'led-disc-device-actions');
    if (existing) {
      // Say WHICH state it is in: "added" (a card with this IP exists) is not
      // "bound" (that card carries a device block). A hand-typed card matches by
      // IP while still unbound — calling that a plain ✓ is what made the missing
      // Bind button read as "the sim can't see my controller".
      actions.appendChild(el('div', 'cm-fully-patched',
        isBoundLedController(existing)
          ? `✓ already added as '${existing.name}'`
          : `✓ added as '${existing.name}' — NOT bound yet`));
    } else {
      const createBtn = el('button', 'cm-btn', '+ Create controller from device');
      createBtn.onclick = () => createFromDevice(ctx, device, done);
      actions.appendChild(createBtn);
    }
    // Offer "Bind" whenever this controller is not ALREADY bound to this device
    // (shouldOfferBind — the IP-match dedup above must not gate it).
    if (shouldOfferBind(controller, device)) {
      const bindBtn = el('button', 'cm-btn', `Bind to '${controller.name}'`);
      bindBtn.onclick = () => bindToController(ctx, device, controller, done);
      actions.appendChild(bindBtn);
    }
    dc.appendChild(actions);
    return dc;
  };

  const runScan = async () => {
    const prefix = normalizeSubnetPrefix(subnetInput.value);
    if (!prefix) {
      progressText.textContent = `✋ invalid subnet '${subnetInput.value}' — expected "a.b.c"`;
      progressText.classList.add('led-disc-error');
      return;
    }
    progressText.classList.remove('led-disc-error');
    saveSubnet(ctx, prefix);
    results.replaceChildren();
    abort = new AbortController();
    scanBtn.disabled = true;
    cancelScanBtn.disabled = false;
    subnetInput.disabled = true;
    const seen = new Set();
    try {
      const found = await scanSubnet(prefix, {
        signal: abort.signal,
        onProgress: ({ completed, total, found: devs }) => {
          progressBar.style.width = `${Math.round((completed / total) * 100)}%`;
          progressText.textContent = `scanning ${prefix}.1–254 … ${completed}/${total} · ` +
            `${devs.length} found`;
          for (const d of devs) {
            if (!seen.has(d.ip)) { seen.add(d.ip); results.appendChild(renderCard(d)); }
          }
        },
      });
      progressBar.style.width = '100%';
      const aborted = abort && abort.signal.aborted;
      progressText.textContent = aborted
        ? `cancelled — ${found.length} controller(s) found`
        : (found.length === 0
          ? `no MarsinLED controllers answered on ${prefix}.1–254`
          : `done — ${found.length} controller(s) found`);
    } catch (err) {
      progressText.textContent = `✋ scan failed: ${err.message}`;
      progressText.classList.add('led-disc-error');
    } finally {
      scanBtn.disabled = false;
      cancelScanBtn.disabled = true;
      subnetInput.disabled = false;
      abort = null;
    }
  };
  scanBtn.onclick = runScan;
  subnetInput.onkeydown = (e) => { if (e.key === 'Enter') runScan(); };

  document.body.appendChild(overlay);
  subnetInput.focus();
}

// ── Create / bind actions ───────────────────────────────────────────────────

async function createFromDevice(ctx, device, closeModal) {
  let config = null;
  try {
    config = await getConfig(device.ip); // for the real deviceName (absent from /api/status)
  } catch (err) {
    ctx.showToast(`✋ ${device.ip}: could not read config — ${err.message}`, { error: true, ttl: 8000 });
    return;
  }
  const deviceName = config.deviceName || device.controllerId;
  const portCount = Array.isArray(config.strands) ? config.strands.length
    : (Array.isArray(device.strands) ? device.strands.length : 4);
  ctx.mutate(`Created LED controller from '${deviceName}'`, () => {
    const registry = ctx.registry();
    const created = addLedControllerFromDevice(registry, {
      name: deviceName,
      ip: device.ip,
      portCount,
      order: 'RGBW',
      device: {
        vendor: LED_DEVICE_VENDOR_MARSINLED,
        controllerId: device.controllerId,
        deviceName: config.deviceName,
        boardId: device.boardId,
      },
    });
    // G9: a bound controller addresses PER OUTPUT — each port already carries its
    // own universe from addPort (computeLedStrandPatches is the one source of
    // truth and IGNORES led.baseUniverse). Do NOT stamp a vestigial baseUniverse
    // here: it never reaches the wire, but it collapses the generic projection
    // onto one lane and reads like it controls addressing. Leaving it 0 keeps a
    // single source of truth (port.universe).
    setLiveMac(ctx, created.id, device.mac); // display-only — never persisted (see controller_registry.js)
  });
  ctx.showToast(`Created '${deviceName}' (${portCount} ports) — assign strands, then Push`, { ttl: 9000 });
  closeModal();
  refreshSyncChips(ctx);
}

async function bindToController(ctx, device, controller, closeModal) {
  let config = null;
  try {
    config = await getConfig(device.ip);
  } catch (err) {
    ctx.showToast(`✋ ${device.ip}: could not read config — ${err.message}`, { error: true, ttl: 8000 });
    return;
  }
  ctx.mutate(`Bound '${controller.name}' to ${device.controllerId}`, () => {
    controller.ip = device.ip; // identity key
    bindControllerDevice(controller, {
      vendor: LED_DEVICE_VENDOR_MARSINLED,
      controllerId: device.controllerId,
      deviceName: config.deviceName,
      boardId: device.boardId,
    });
    // G9: binding switches this controller onto the PER-OUTPUT device layout
    // (computeLedStrandPatches, keyed off each port.universe) which ignores
    // led.baseUniverse entirely — so no baseUniverse is allocated on bind. The
    // per-output universes live on the port rows; baseUniverse stays the unbound
    // generic model's field only (single source of truth per controller state).
    setLiveMac(ctx, controller.id, device.mac); // display-only — never persisted
  });
  ctx.showToast(`Bound '${controller.name}' → ${config.deviceName || device.controllerId} ` +
    `(${device.ip})`, { ttl: 8000 });
  closeModal();
  refreshSyncChips(ctx);
}

// ── Sync chips (one status GET per bound controller; no polling) ────────────

const SYNC_LABELS = {
  'in-sync': '● In sync',
  drift: '▲ Drift',
  unreachable: '⚠ Unreachable',
  never: '○ Never pushed',
  checking: '… checking',
};

/**
 * What the chip measures — stated on every chip (slice S5). The chip compares the
 * DEVICE to the plan this page would push; it says nothing about whether frames
 * are actually reaching the strands. That is the sACN feed, which only a saved
 * `patches.yaml` + a notified bridge can move (report 20260725_58 §3).
 */
const SYNC_CHIP_MEANING =
  'Measures the DEVICE against the per-output plan this page would push (device ≡ plan) — ' +
  'which outputs are enabled, and the universe on each, including the PARKED outputs no port ' +
  'drives — NOT the sACN feed: green does not prove frames are reaching the strands, which ' +
  'needs the scene saved (patches.yaml) and the sACN bridge notified.';

/**
 * Build the sync chip's tooltip: the meaning line first, then whatever this
 * particular state has to add (a `detail` sentence, or the per-output diff). Pure
 * and exported so the copy is asserted in one place.
 *
 * Keeps the same vocabulary as the push flow's stale-feed detail ("device ≡ plan",
 * "the sACN feed"), so a green chip carrying
 * `device ≡ plan, but the sACN feed is STALE — …` reads as one sentence with its
 * own header rather than two competing claims.
 */
export function describeSyncChipTooltip(sync) {
  const parts = [SYNC_CHIP_MEANING];
  if (sync && sync.detail) {
    parts.push(sync.detail);
  } else if (sync && Array.isArray(sync.changes) && sync.changes.length) {
    parts.push(sync.changes.map((c) => `${c.path}: ${c.from} → ${c.to}`).join('\n'));
  }
  return parts.join('\n\n');
}

/**
 * Recompute the sync chip for every bound LED controller (panel-open / post-
 * push). One getConfig + getStatus each; results land in syncCache and the
 * caller's panel re-renders. No background loop.
 */
export function refreshSyncChips(ctx) {
  const registry = ctx.registry();
  if (!registry || !Array.isArray(registry.controllers)) return;
  const bound = registry.controllers.filter(isBoundLedController);
  for (const controller of bound) {
    if (!controller.device.lastPush) {
      setSyncState(ctx, controller.id, { state: 'never' });
      continue;
    }
    setSyncState(ctx, controller.id, { state: 'checking' });
    computeSyncState(ctx, controller)
      .then((res) => { setSyncState(ctx, controller.id, res); ctx.refresh(); })
      .catch((err) => {
        setSyncState(ctx, controller.id, { state: 'unreachable', detail: err.message });
        ctx.refresh();
      });
  }
  ctx.refresh();
}

export async function computeSyncState(ctx, controller) {
  const snapshot = await getConfig(controller.ip);
  const status = await getStatus(controller.ip);
  setLiveMac(ctx, controller.id, status.mac); // display-only — never persisted
  setDeviceOutputs(ctx, controller.id, snapshot.strands); // feeds the output selector
  // Per-output DMX is the only supported mapping. Firmware without it is stale —
  // report drift so the operator updates it (no silent legacy fallback, codex P0).
  if (!deviceSupportsPerOutput(status)) {
    return { state: 'drift', detail: 'firmware predates per-output DMX' };
  }
  let plan;
  try {
    // SAME claim index as the push (slice S2): the chip compares the device to
    // the plan a push WOULD write, so both paths must auto-extend around the same
    // registry claims — otherwise the chip invents drift the push would not fix.
    plan = derivePerOutputPlan(controller, ctx.strandLedCounts(), snapshot,
      claimedUniversesFor(ctx, controller));
  } catch (err) {
    return { state: 'drift', detail: err.message };
  }
  // A collision means a push would REFUSE — reporting in-sync here would let the
  // chip disagree with the push (report 20260725_58 §8/S2).
  if (plan.collisions.length) {
    return { state: 'drift', detail: describeCollisions(plan.collisions) };
  }
  const reported = readPerOutput(status);
  const changes = perOutputChanges(reported, plan);
  const sacnOn = status.sacn && status.sacn.enabled;
  if (changes.length) return { state: 'drift', changes };
  if (!sacnOn) return { state: 'drift', detail: 'device sACN receiver is disabled', changes: [] };
  return { state: 'in-sync' };
}

// ── Device binding section (identity + sync chip + push) ────────────────────

/**
 * Build the per-controller device section for an LED controller card. The Push
 * button renders on EVERY LED card (addendum #1) — the IP is the identity that
 * matters for pushing, so a card added by hand (no device block) still gets it.
 * Identity line + sync chip + push provenance render ONLY when the card is bound;
 * an unbound card shows just the Push + Discover/bind buttons (pushing it binds
 * it, addendum #3). The Push button is disabled with a hint when the IP is
 * missing/invalid. Returns null for a non-LED controller.
 */
export function renderDeviceBindingSection(ctx, controller) {
  if (!isLedController(controller)) return null;
  const section = el('div', 'led-device-section');
  const bound = isBoundLedController(controller);
  const validIp = isValidIp(controller.ip);

  if (bound) {
    const dev = controller.device;
    // MAC is NOT part of the persisted device block (never written to
    // controllers.yaml — public repo, gitleaks bm26-mac-address). Source it
    // from the live cache (populated from the device's runtime HTTP status by
    // discover/bind/push/sync-chip refresh) so the display still works.
    const liveMac = getLiveMac(ctx, controller.id);
    const idLine = el('div', 'led-device-id');
    idLine.textContent =
      `${dev.deviceName || dev.controllerId} · ${dev.boardId || 'board ?'}` +
      (liveMac ? ` · ${liveMac}` : '');
    section.appendChild(idLine);

    const chipRow = el('div', 'led-device-chip-row');
    const sync = getSyncState(ctx, controller.id) || { state: dev.lastPush ? 'checking' : 'never' };
    const chip = el('span', `led-sync-chip led-sync-${sync.state}`, SYNC_LABELS[sync.state] || sync.state);
    // Every chip states what it measures (slice S5) — device ≡ plan, never the feed.
    chip.title = describeSyncChipTooltip(sync);
    chipRow.appendChild(chip);

    if (dev.lastPush) {
      const prov = el('span', 'led-device-prov',
        `pushed ${new Date(dev.lastPush.at).toLocaleString()} · ${dev.lastPush.outcome}`);
      if (dev.lastPush.configHash) prov.title = `configHash ${dev.lastPush.configHash}`;
      chipRow.appendChild(prov);
    }
    section.appendChild(chipRow);
  }

  // Push is ALWAYS present on an LED card — disabled (with a hint) without a
  // usable IP. Pushing an unbound card that answers will bind it on success.
  const pushBtn = el('button', 'cm-btn led-device-push', '⬆ Push to controller');
  if (validIp) {
    pushBtn.title = 'Read device status, derive the per-output plan, and (after confirm) push + ' +
      'reboot the device, then save the scene and notify the sACN bridge';
    pushBtn.onclick = () => startPush(ctx, controller);
  } else {
    pushBtn.disabled = true;
    pushBtn.title = 'set the device IP first';
  }
  section.appendChild(pushBtn);

  const bindBtn = el('button', 'cm-btn led-device-rebind',
    bound ? 'Re-bind…' : '🔍 Discover / bind device');
  bindBtn.title = bound
    ? 'Bind this controller to a different discovered device'
    : 'Find a MarsinLED on the network and bind it to this controller';
  bindBtn.onclick = () => openLedDiscoveryPanel(ctx, { controller });
  section.appendChild(bindBtn);

  return section;
}

// ── Push flow (per-output DMX is the ONLY supported push style) ──────────────

async function startPush(ctx, controller) {
  if (!isValidIp(controller.ip)) {
    ctx.showToast(`✋ ${controller.name}: set a valid device IP before pushing`, { error: true, ttl: 7000 });
    return;
  }
  // Repair any port left without a universe BEFORE derive (base = first
  // enabled output's port.universe, Slice D).
  ensurePortUniverses(ctx, controller);

  let snapshot;
  let status;
  try {
    snapshot = await getConfig(controller.ip);
    status = await getStatus(controller.ip);
  } catch (err) {
    ctx.showToast(`✋ ${controller.ip} unreachable: ${err.message}`, { error: true, ttl: 8000 });
    setSyncState(ctx, controller.id, { state: 'unreachable', detail: err.message });
    ctx.refresh();
    return;
  }

  // Per-output DMX is the only push style. Firmware without it is too old — LOUD
  // refusal, never a legacy fallback (operator decision + codex P0).
  if (!deviceSupportsPerOutput(status)) {
    const detail = 'firmware too old — update MarsinLED to a per-output build';
    ctx.showToast(`✋ '${controller.name}': ${detail}`, { error: true, ttl: 10000 });
    setSyncState(ctx, controller.id, { state: 'drift', detail });
    ctx.refresh();
    return;
  }
  await startPerOutputPush(ctx, controller, snapshot, status);
}

// ── Per-output DMX push flow (firmware advertises capabilitiesExt.perOutputDmx) ─

/**
 * Compare the device-reported `sacn.perOutput` to the plan we pushed — the
 * read-back that ARBITRATES a lost write reply (report 20260725_69 §3).
 *
 * It asserts over `plan.universeByOutputIndex`, which since report 20260725_70
 * covers the WHOLE post-push output map: the assigned outputs, the PARKED ones,
 * and the ones this push enabled. Outputs OUTSIDE the plan are not asserted —
 * the push made no claim about them (it never disables anything).
 *
 * Returns an array of human-readable mismatch strings ([] ⇒ the device confirmed
 * the plan).
 */
function diffPerOutput(reported, plan) {
  const mismatches = [];
  const byIndex = new Map();
  for (const entry of reported || []) byIndex.set(Number(entry.index), entry);
  const enabledByPush = new Set(plan.enableOutputIndices || []);
  for (const [indexStr, universe] of Object.entries(plan.universeByOutputIndex)) {
    const index = Number(indexStr);
    const got = byIndex.get(index);
    if (!got) {
      mismatches.push(`output ${index}: device reported no per-output entry (wanted U${universe})`);
      continue;
    }
    if (got.universe !== universe) {
      mismatches.push(`output ${index}: device U${got.universe} ≠ wanted U${universe}`);
    }
    if (got.startAddress !== 1) {
      mismatches.push(`output ${index}: device startAddress ${got.startAddress} ≠ 1`);
    }
    if (got.enabled !== true) {
      mismatches.push(enabledByPush.has(index)
        ? `output ${index}: this push should have ENABLED it, device reports enabled=${got.enabled}`
        : `output ${index}: device reports enabled=${got.enabled}`);
    }
  }
  return mismatches;
}

/**
 * Structured drift between the device-reported `sacn.perOutput` and the plan, for
 * the sync-chip tooltip. Each change is `{path:'output N', from, to}`.
 *
 * The chip compares the FULL output map — assigned, PARKED and pending-enable —
 * with the same claims and the same derive as the push, so the chip and the push
 * can never disagree (report 20260725_70 §5.4). Consequence to expect: a device
 * carrying a stale extra universe on a portless enabled output reads ▲ Drift
 * until one push re-parks it. That is the landmine becoming visible.
 */
function perOutputChanges(reported, plan) {
  const byIndex = new Map();
  for (const entry of reported || []) byIndex.set(Number(entry.index), entry);
  const enabledByPush = new Set(plan.enableOutputIndices || []);
  const changes = [];
  for (const [indexStr, universe] of Object.entries(plan.universeByOutputIndex)) {
    const index = Number(indexStr);
    const got = byIndex.get(index);
    if (enabledByPush.has(index)) {
      // A pending ENABLE is drift by definition — say it in those words rather
      // than as a universe diff against an output that is off today.
      changes.push({ path: `output ${index}`, from: 'disabled', to: `enabled · U${universe}` });
      continue;
    }
    const matches = got && got.universe === universe && got.startAddress === 1 && got.enabled === true;
    if (matches) continue;
    const from = got ? `U${got.universe}` : 'unset';
    changes.push({ path: `output ${index}`, from, to: `U${universe}` });
  }
  return changes;
}

/**
 * True iff `controller` is STILL the live registry object (by reference). Delete
 * or undo swaps the registry's controller objects out, so a stale async
 * continuation can detect it lost the world (G8). Reference identity is exact:
 * removeController splices this object out, and restoreSnapshot rebuilds the
 * array with freshly-parsed objects, so neither leaves this reference in place.
 */
function controllerIsLive(ctx, controller) {
  const reg = ctx.registry();
  return !!(reg && Array.isArray(reg.controllers) && reg.controllers.includes(controller));
}

// ── Push phase copy (budgets come from the client's measured constants) ─────
// The operator must be able to read the dialog and know which PHASE is running
// and how long it is willing to wait — a push that spans a device reboot looks
// identical to a hang otherwise (report 20260725_69).
const WRITE_BUDGET_SECONDS = Math.round(PER_OUTPUT_WRITE_TIMEOUT_MS / 1000);
const REBOOT_WAIT_SECONDS = Math.round(REBOOT_WAIT_TIMEOUT_MS / 1000);

/**
 * Shared per-output push core (single-push + push-all use the SAME path). POST
 * the per-output plan (full read-modify-write), wait out the reboot, then VERIFY
 * by re-reading `sacn.perOutput` and asserting it matches the plan, and record
 * push provenance through the undo pipeline. THROWS on any failure (fail loud): a
 * network/device error propagates verbatim; a verify mismatch throws an Error
 * carrying `.perOutputMismatch` so the caller can render the drift. Takes an
 * injectable `io` bag so tests mock the device. `onStatus(msg)` is an optional
 * progress sink (single-push status line; push-all passes null).
 *
 * THREE PHASES, THREE BUDGETS (report 20260725_69):
 *  1. write — POST /api/config, PER_OUTPUT_WRITE_TIMEOUT_MS;
 *  2. reboot wait — poll /api/status until the device answers,
 *     REBOOT_WAIT_TIMEOUT_MS (the measured reboot is ~11 s);
 *  3. verify — read the mapping back, only AFTER the device has answered.
 *
 * A LOST WRITE REPLY IS NOT A FAILURE. The firmware persists the config and
 * reboots, and it can go down before flushing the POST reply — declaring failure
 * there leaves the sim's mirror saying "not written" over a device that IS
 * written, which is the exact desync this whole campaign exists to kill. So an
 * unanswered write falls through to the SAME reboot wait + read-back, and the
 * read-back is the arbiter: matching plan ⇒ success (flagged `responseLost`),
 * different plan or a device that never answers ⇒ loud failure.
 *
 * @returns {Promise<{needsReboot, reply, reported, responseLost, writeError}>}
 */
async function pushPerOutputVerifyRecord(ctx, controller, plan, io, onStatus) {
  const report = onStatus || (() => {});
  report(`pushing per-output universes… (the device may take up to ${WRITE_BUDGET_SECONDS}s to ` +
    'answer the write)');
  let reply = null;
  let writeError = null;
  try {
    reply = await io.pushPerOutputUniverses(controller.ip, { plan });
  } catch (err) {
    // `writeResponseLost` = the device gave us NO answer (timeout / dropped
    // socket). Anything else — a 400, any other HTTP status, a rejected plan, a
    // failed pre-write read — is a device that spoke, and stays a hard failure.
    if (!err.writeResponseLost) throw err;
    writeError = err;
  }
  const needsReboot = !!writeError || reply.reboot === true || reply.outcome === 'needs-reboot';
  if (needsReboot) {
    report(writeError
      ? `the device did not answer the write (${writeError.message}) — a per-output write ` +
        'reboots the device, which can drop the reply. Waiting up to ' +
        `${REBOOT_WAIT_SECONDS}s for it to come back, then reading the config back to find ` +
        'out whether the write applied…'
      : `device rebooting — waiting up to ${REBOOT_WAIT_SECONDS}s for it to answer…`);
    try {
      await io.awaitReboot(controller.ip, {
        onProgress: ({ elapsedMs }) => report(
          `device rebooting — waiting up to ${REBOOT_WAIT_SECONDS}s for it to answer ` +
          `(${Math.round(elapsedMs / 1000)}s elapsed)…`),
      });
    } catch (err) {
      if (!writeError) throw err;
      // Unanswered write AND unreachable through the whole budget: we genuinely
      // do not know what the device holds. Say exactly that — never guess.
      throw new Error(`${writeError.message}; and the device never answered again within ` +
        `${REBOOT_WAIT_SECONDS}s — the write is UNCONFIRMED: it may or may not have applied. ` +
        'Power-cycle the controller, re-open this card to read its live mapping, then push ' +
        'again.');
    }
  }

  report('reading confirmed mapping…');
  const verifyStatus = await io.getStatus(controller.ip);
  setDeviceOutputs(ctx, controller.id, verifyStatus.strands); // feeds the output selector
  const reported = readPerOutput(verifyStatus);
  const mismatches = diffPerOutput(reported, plan);
  if (mismatches.length) {
    const lostNote = writeError
      ? 'the device did not answer the write AND the read-back shows a DIFFERENT mapping — ' : '';
    const err = new Error(`${lostNote}device mapping mismatch — ${mismatches.join('; ')}`);
    err.perOutputMismatch = mismatches;
    throw err;
  }

  // G8 — liveness guard. The reboot wait above can take up to 30 s; during it the
  // operator may delete this controller or undo (restoreSnapshot replaces the
  // registry's controller objects). Writing provenance onto a controller that is
  // no longer in the registry would mutate a detached object and trigger a save
  // of a phantom — fail LOUD instead of silently recording onto the wrong world.
  // (A scene switch is a full page reload, so this same reference check also
  // covers "the scene changed": the old controller object is simply gone.)
  if (!controllerIsLive(ctx, controller)) {
    throw new Error(`'${controller.name}' was removed (or the scene changed) during the reboot ` +
      'wait — the device WAS written, but the push result is discarded; re-add the controller ' +
      'and re-verify');
  }

  const configHash = await sha256Hex(JSON.stringify(plan.universeByOutputIndex));
  const firmwareSHA = verifyStatus.firmwareSHA;
  ctx.mutate(`Pushed per-output universes to '${controller.name}'`, () => {
    // STICKY PARKING (report 20260725_70 §2.2). The park the device just
    // confirmed is persisted on the card so the NEXT derive reuses the same
    // number. A re-derived park would move whenever any other controller took a
    // universe, and the sync chip — which compares device ≡ plan — would then
    // report drift on a card nobody touched and "fix" it with a reboot nobody
    // asked for. Noting it against the registry's monotonic high-water mark
    // keeps it from ever being handed to real gear later.
    const registry = ctx.registry();
    for (const entry of plan.parked || []) {
      setParkedUniverse(controller, entry.outputIndex, entry.universe);
      if (registry) noteUniverseUsed(registry, entry.universe);
    }
    // An output a port now drives is no longer parked — drop the stale entry so
    // the card never carries two claims on one output.
    for (const entry of plan.assignments || []) clearParkedUniverse(controller, entry.outputIndex);
    // Pushing an UNBOUND card binds it: adopt the device identity from the
    // confirmed status so provenance + sync chips work from now on (addendum #3).
    if (!controller.device) {
      bindControllerDevice(controller, {
        vendor: LED_DEVICE_VENDOR_MARSINLED,
        controllerId: verifyStatus.controllerId,
        deviceName: verifyStatus.deviceName,
        boardId: verifyStatus.boardId,
      });
    }
    recordDevicePush(controller, {
      at: new Date().toISOString(),
      outcome: needsReboot ? 'needs-reboot' : (reply.outcome || 'applied'),
      firmwareSHA,
      configHash,
      perOutput: reported,
    });
  });
  setLiveMac(ctx, controller.id, verifyStatus.mac); // display-only — never persisted
  return { needsReboot, reply, reported, responseLost: !!writeError, writeError };
}

/**
 * The push's device-step sentence. A write whose reply was LOST but whose
 * read-back matched is a SUCCESS — and says so without hiding what happened.
 */
function describeDeviceStep(pushResult) {
  if (!pushResult.responseLost) return '✓ device written + verified';
  return '✓ device verified — the write reply was LOST (the device rebooted before answering), ' +
    'but the read-back confirms the mapping applied';
}

// ── Push completion: persist + project, then notify (slice S1) ──────────────
// "A push is DONE only when the device AND the feed agree — or it fails loudly
// stating exactly which layer is stale" (report 20260725_58 §5). These two steps
// run AFTER the device write + verify; the device write is NEVER rolled back on
// their failure (that would be a hidden fallback and a second reboot) — the
// dialog says so instead.

const PUSH_STEP_LABELS = { save: 'scene save', notify: 'bridge notify' };

/**
 * Coerce a step's return value into `{ok, reason}`. A step that answers with
 * nothing is a REFUSAL, not a success: assuming "no news is good news" for the
 * save is exactly how a push reports green while the mapping never reached disk.
 */
function normalizeStepResult(result, step) {
  if (!result || typeof result.ok !== 'boolean') {
    throw new Error(`the ${PUSH_STEP_LABELS[step]} step returned no {ok} result — ` +
      'refusing to assume it worked');
  }
  return result.ok ? { ok: true } : { ok: false, reason: result.reason || 'no reason reported' };
}

/**
 * Persist the scene (patches.yaml + controllers.yaml + the engine model) and
 * THEN notify the sACN bridge so it re-reads the routes. The notify is chained on
 * the save's resolution — never on a timer — because a bridge told to reload
 * before the save lands re-reads the STALE patches.yaml.
 *
 * Never throws. Returns `{ save: {ok, reason?}, notify: {ok, reason?}|null }`;
 * `notify` stays null when the save failed (notifying after a failed save would
 * only make the bridge re-read the old file and look like progress).
 *
 * @param {Object} io - the injectable io bag (persistScene / notifyBridge).
 */
export async function persistAndNotifyAfterPush(io) {
  const steps = { save: null, notify: null };
  try {
    if (typeof io.persistScene !== 'function') {
      throw new Error('the push io bag has no persistScene() — the mapping cannot reach disk');
    }
    steps.save = normalizeStepResult(await io.persistScene(), 'save');
  } catch (err) {
    steps.save = { ok: false, reason: err.message };
  }
  if (!steps.save.ok) return steps;
  try {
    if (typeof io.notifyBridge !== 'function') {
      throw new Error('the push io bag has no notifyBridge() — the sACN bridge cannot be told ' +
        'to reload its routes');
    }
    steps.notify = normalizeStepResult(await io.notifyBridge(), 'notify');
  } catch (err) {
    steps.notify = { ok: false, reason: err.message };
  }
  return steps;
}

/**
 * Render the per-step truth of a completed push. Pure — the dialog, the toast and
 * the tests all read the same sentence.
 *
 * Success: `✓ device written + verified · ✓ scene saved (patches projected) ·
 * ✓ bridge notified — routes follow`. Any failure names the stale layer and
 * states that the device write stands.
 *
 * @returns {{ok: boolean, failedStep: string|null, text: string}}
 */
export function describePushCompletion(steps, {
  lead = '✓ device written + verified',
  deviceNote = 'the device WAS written (cannot be rolled back)',
} = {}) {
  const parts = [lead];
  let failedStep = null;
  if (steps.save.ok) {
    parts.push('✓ scene saved (patches projected)');
  } else {
    parts.push(`✋ scene NOT saved: ${steps.save.reason}`);
    failedStep = PUSH_STEP_LABELS.save;
  }
  if (!steps.save.ok) {
    parts.push('⏸ bridge not notified (the save failed first)');
  } else if (steps.notify.ok) {
    parts.push('✓ bridge notified — routes follow');
  } else {
    parts.push(`✋ bridge NOT notified: ${steps.notify.reason}`);
    failedStep = PUSH_STEP_LABELS.notify;
  }
  const text = parts.join(' · ');
  if (!failedStep) return { ok: true, failedStep: null, text };
  return {
    ok: false,
    failedStep,
    text: `${text} — ${deviceNote}; the sACN feed was NOT updated: ${failedStep} — ` +
      'LEDs will not follow until a successful save.',
  };
}

/**
 * BLOCKING refusal dialog for a per-output plan that would take a universe
 * another controller already owns (slice S2). No override path — the push never
 * happens; the operator edits the card's port universes and pushes again
 * (codex P0: fail loud, never a silent re-map of operator-declared state).
 */
function showPerOutputCollisionRefusal(ctx, controller, collisions) {
  const overlay = el('div', 'vm-modal-overlay');
  const card = el('div', 'vm-modal-card led-push-card');
  overlay.appendChild(card);
  card.appendChild(el('div', 'vm-modal-title',
    `✋ Push refused — invalid per-output plan on '${controller.name}'`));
  card.appendChild(el('div', 'led-push-warn',
    'The device was NOT written. Each line below is a plan this card cannot push: an output that ' +
    'would stream on a universe another controller already owns (two sources on one universe ' +
    'fight, and the sim would route that universe to the wrong hardware), two port rows driving ' +
    'ONE physical output, a port driving an output this board does not have, or no free universe ' +
    'left to park an unmapped output on. Fix the card, then push again.'));
  const list = el('div', 'led-push-diff');
  for (const c of collisions) {
    list.appendChild(el('div', 'led-push-diff-line', `• ${c.message}`));
  }
  card.appendChild(list);
  const actions = el('div', 'vm-modal-actions');
  const closeBtn = el('button', 'vm-modal-btn', 'Close');
  closeBtn.onclick = () => overlay.remove();
  actions.appendChild(closeBtn);
  card.appendChild(actions);
  overlay.onkeydown = (e) => { if (e.key === 'Escape') closeBtn.click(); };
  document.body.appendChild(overlay);
  closeBtn.focus();
  ctx.showToast(`✋ '${controller.name}': push refused — ${collisions.length} blocking finding(s)`,
    { error: true, ttl: 10000 });
}

async function startPerOutputPush(ctx, controller, snapshot, status) {
  setDeviceOutputs(ctx, controller.id, snapshot.strands); // feeds the output selector
  let plan;
  try {
    plan = derivePerOutputPlan(controller, ctx.strandLedCounts(), snapshot,
      claimedUniversesFor(ctx, controller));
  } catch (err) {
    ctx.showToast(`✋ cannot derive per-output plan: ${err.message}`, { error: true, ttl: 10000 });
    return;
  }
  // Pre-flight gate (slice S2, widened by report 20260725_70 §4) — runs BEFORE
  // the device write so a push can never mint a cross-controller universe
  // collision, a duplicate port→output association, an out-of-range output, or a
  // park outside the firmware's window.
  if (plan.collisions.length) {
    setSyncState(ctx, controller.id, { state: 'drift', detail: describeCollisions(plan.collisions) });
    showPerOutputCollisionRefusal(ctx, controller, plan.collisions);
    ctx.refresh();
    return;
  }

  // Build the EXACT strands payload (RMW preview) and validate the APPLIED array
  // — the intended POST-push state, which is the only array that can express an
  // enable transition. A bad plan is blocked here, not at the device.
  let payloadStrands;
  try {
    payloadStrands = applyPerOutputPlan(snapshot.strands, plan);
    validatePerOutputPlan(payloadStrands, plan.universeByOutputIndex);
  } catch (err) {
    ctx.showToast(`✋ per-output plan rejected: ${err.message}`, { error: true, ttl: 10000 });
    return;
  }
  const payload = {
    strands: payloadStrands,
    dmx: { enabled: true, protocol: 0, timeoutMs: 3000 },
  };
  showPerOutputPushConfirm(ctx, controller, plan, payload, status);
}

function showPerOutputPushConfirm(ctx, controller, plan, payload, status) {
  const overlay = el('div', 'vm-modal-overlay');
  const card = el('div', 'vm-modal-card led-push-card');
  overlay.appendChild(card);
  card.appendChild(el('div', 'vm-modal-title',
    `Push per-output universes to '${controller.name}' (${controller.ip})`));

  card.appendChild(el('div', 'led-push-warn',
    '⚠ This writes strands + dmx (per-output sACN universe on every enabled output) and the device ' +
    `WILL REBOOT (~11 s measured; the push waits up to ${REBOOT_WAIT_SECONDS} s for it to answer, ` +
    'and reads the mapping back before calling it done). Keep the sACN source streaming across ' +
    'the reboot.'));

  // Declared UP FRONT (slice S1): the save is part of the push, not a surprise.
  card.appendChild(el('div', 'led-push-warn led-push-saves-scene',
    'Push writes the device AND saves the scene (mapping must land on disk for the sACN feed to ' +
    'follow). The whole scene is saved — the same save the 💾 buttons run — then the sACN bridge ' +
    'is told to reload its routes.'));

  // (2) Per-output mapping — one line per output a CARD PORT drives, naming the
  // port so a crossed mapping is impossible to misread.
  card.appendChild(el('div', 'led-push-subhead', 'Per-output mapping'));
  const mapBox = el('div', 'led-push-diff');
  for (const a of plan.assignments) {
    const line = el('div', 'led-push-diff-line');
    line.textContent = `output ${a.outputIndex + 1}  ←  port ${a.portNum}  ·  U${a.universe}  ·  ` +
      `start 1  ·  ${a.pixelCount} px`;
    mapBox.appendChild(line);
  }
  if (plan.assignments.length === 0) {
    mapBox.appendChild(el('div', 'led-push-diff-line', '(no port drives any output on this board)'));
  }
  card.appendChild(mapBox);

  // (3) Parked outputs — enabled on the board, nothing routed here. This is the
  // whole point of the park: it is declared, not silent.
  if (plan.parked.length) {
    card.appendChild(el('div', 'led-push-subhead', 'Parked outputs (no port maps them)'));
    const parkBox = el('div', 'led-push-diff');
    for (const p of plan.parked) {
      const line = el('div', 'led-push-diff-line');
      line.textContent = `output ${p.outputIndex + 1}  ·  U${p.universe}  ·  no port maps it — ` +
        'stays ENABLED on the board, nothing routes here, so it stays dark' +
        (p.reused ? '  (unchanged)' : '');
      parkBox.appendChild(line);
    }
    card.appendChild(parkBox);
  }

  // (4) The ONE asymmetric write. The push may switch an output ON, never off —
  // and it says so, per output, before anything is written.
  if (plan.enables.length) {
    const enableBlock = el('div', 'led-push-warn led-push-enables');
    enableBlock.appendChild(el('div', 'led-push-enables-head',
      `⚠ ${plan.enables.length} output(s) this push will ENABLE (it never disables anything):`));
    for (const e of plan.enables) {
      enableBlock.appendChild(el('div', 'led-push-enables-line',
        `output ${e.outputIndex + 1}: DISABLED on the device → will be ENABLED ` +
        `(port ${e.portNum} drives it, ${e.count} px, U${e.universe})`));
    }
    card.appendChild(enableBlock);
  }

  // (5) Warnings — re-parks, repaired universes, count mismatches.
  if (plan.warnings.length) {
    const warnBlock = el('div', 'led-push-warn led-push-unhonorable');
    warnBlock.appendChild(el('div', 'led-push-unhonorable-head',
      `⚠ ${plan.warnings.length} note(s) on this plan:`));
    for (const w of plan.warnings) warnBlock.appendChild(el('div', 'led-push-unhonorable-line', w));
    card.appendChild(warnBlock);
  }

  card.appendChild(el('div', 'led-push-subhead', 'Payload (POST /api/config)'));
  const pre = el('pre', 'led-push-pre');
  pre.textContent = JSON.stringify(payload, null, 2);
  card.appendChild(pre);

  const statusLine = el('div', 'led-push-status');
  card.appendChild(statusLine);

  const actions = el('div', 'vm-modal-actions');
  const cancelBtn = el('button', 'vm-modal-btn', 'Cancel');
  cancelBtn.onclick = () => overlay.remove();
  const confirmBtn = el('button', 'vm-modal-btn vm-modal-btn-primary', 'Push + reboot');
  confirmBtn.onclick = () => runPerOutputPush(ctx, controller, plan, DEFAULT_DEVICE_IO, {
    overlay, statusLine, confirmBtn, cancelBtn,
  });
  actions.appendChild(cancelBtn);
  actions.appendChild(confirmBtn);
  card.appendChild(actions);

  overlay.onkeydown = (e) => { if (e.key === 'Escape' && !confirmBtn.disabled) cancelBtn.click(); };
  document.body.appendChild(overlay);
  confirmBtn.focus();
}

/**
 * Run a confirmed per-output push to completion: device write + verify, then the
 * slice-S1 completion (save the scene, then notify the bridge). Exported for the
 * unit tests — `ui` only needs `{statusLine, confirmBtn, cancelBtn}` objects with
 * `textContent` / `className` / `disabled`, so the whole flow runs without a DOM.
 */
export async function runPerOutputPush(ctx, controller, plan, io, ui) {
  const { statusLine, confirmBtn, cancelBtn } = ui;
  confirmBtn.disabled = true;
  cancelBtn.disabled = true;
  const setStatus = (msg, cls) => {
    statusLine.textContent = msg;
    statusLine.className = 'led-push-status' + (cls ? ` ${cls}` : '');
  };

  let pushResult;
  try {
    pushResult = await pushPerOutputVerifyRecord(ctx, controller, plan, io,
      (m) => setStatus(m));
  } catch (err) {
    setStatus(`✋ per-output push failed: ${err.message}` +
      (err.field ? ` (field=${err.field})` : ''), 'led-push-error');
    setSyncState(ctx, controller.id, err.perOutputMismatch
      ? { state: 'drift', detail: err.message }
      : { state: 'unreachable', detail: err.message });
    cancelBtn.disabled = false;
    cancelBtn.textContent = 'Close';
    ctx.refresh();
    return;
  }

  // The device is written and verified — and NOTHING the sim feeds it has moved yet.
  // Complete the loop (slice S1): save the scene so the mapping lands in
  // patches.yaml + the engine model, then tell the bridge to re-read it.
  const deviceStep = describeDeviceStep(pushResult);
  setStatus(`${deviceStep} · saving the scene (mapping → patches.yaml)…`);
  const steps = await persistAndNotifyAfterPush(io);
  const outcome = describePushCompletion(steps, { lead: deviceStep });
  setStatus(outcome.text, outcome.ok ? 'led-push-ok' : 'led-push-error');
  // The chip measures device ≡ plan, which IS true here — but say so honestly
  // when the feed behind it is stale.
  setSyncState(ctx, controller.id, outcome.ok
    ? { state: 'in-sync' }
    : { state: 'in-sync',
      detail: `device ≡ plan, but the sACN feed is STALE — ${outcome.failedStep} failed: ` +
        `${(steps.notify && !steps.notify.ok ? steps.notify.reason : steps.save.reason)}` });
  cancelBtn.disabled = false;
  cancelBtn.textContent = outcome.ok ? 'Done' : 'Close';
  ctx.showToast(outcome.ok
    ? `✓ '${controller.name}': device confirmed, scene saved, bridge notified` +
      (pushResult.responseLost ? ' (the write reply was lost — the read-back confirmed it)' : '')
    : `✋ '${controller.name}': the device WAS written but the sACN feed was NOT updated ` +
      `(${outcome.failedStep} failed) — LEDs will not follow until a successful save`,
  { error: !outcome.ok, ttl: outcome.ok ? 7000 : 14000 });
  ctx.refresh();
}

// ── Push-all (every LED controller with a valid IP, sequential; FORCE) ───────

/**
 * Push every LED controller in the registry that carries a syntactically valid
 * IP, SEQUENTIALLY (each device reboots ~10 s, so they must serialize). This is
 * a FORCE push (addendum #2): each controller runs the SAME per-output path as
 * the single push — derive the plan from the CURRENT port state, push,
 * awaitReboot, verify the `sacn.perOutput` read-back — with NO in-sync
 * short-circuit (sync state never gates a push). An UNBOUND card that answers is
 * bound on success (addendum #3). Firmware without per-output DMX gets the loud
 * firmware-too-old refusal, counted as a failure (no legacy fallback, codex P0).
 * A failure on one is reported but does NOT abort the rest (fail loud per
 * controller). A controller with no valid IP is SKIPPED with a note.
 *
 * DEVICE LAYER ONLY. The slice-S1 completion (save the scene, then notify the
 * bridge) runs ONCE for the whole sequence in the caller — `startPushAll` —
 * because a save per controller would rewrite the same files N times and, on a
 * long fleet, notify the bridge against a half-updated registry.
 *
 * @param {Object} ctx - the editor bridge (registry/mutate/strandLedCounts/…).
 * @param {Object} [io] - injectable device I/O (defaults to the real client).
 * @returns {Promise<Array<{name, id, state, detail?}>>} state ∈
 *   'pushed' | 'skipped' | 'failed'.
 */
export async function pushAllLedControllers(ctx, io = DEFAULT_DEVICE_IO) {
  const registry = ctx.registry();
  const controllers = (registry && Array.isArray(registry.controllers))
    ? registry.controllers.filter(isLedController) : [];
  const results = [];
  for (const controller of controllers) {
    const base = { name: controller.name, id: controller.id };
    if (!isValidIp(controller.ip)) {
      results.push({ ...base, state: 'skipped', detail: `no valid device IP ('${controller.ip}')` });
      continue;
    }
    try {
      // Repair any port left without a universe from CURRENT state before derive.
      ensurePortUniverses(ctx, controller);
      const status = await io.getStatus(controller.ip);
      // Per-output DMX is the only push style — refuse stale firmware loudly.
      if (!deviceSupportsPerOutput(status)) {
        const detail = 'firmware too old — update MarsinLED to a per-output build';
        setSyncState(ctx, controller.id, { state: 'drift', detail });
        results.push({ ...base, state: 'failed', detail });
        continue;
      }
      const snapshot = await io.getConfig(controller.ip);
      setDeviceOutputs(ctx, controller.id, snapshot.strands);
      const plan = derivePerOutputPlan(controller, ctx.strandLedCounts(), snapshot,
        claimedUniversesFor(ctx, controller));
      // Registry-aware gate (slice S2, widened by report 20260725_70 §4) — a plan
      // that would take another controller's universe, drive one output from two
      // ports, address an output the board does not have, or park outside the
      // firmware window is REFUSED before the device write, per controller.
      if (plan.collisions.length) {
        const detail = describeCollisions(plan.collisions);
        setSyncState(ctx, controller.id, { state: 'drift', detail });
        results.push({ ...base, state: 'failed', detail });
        continue;
      }
      // FORCE: always push + reboot + verify, even when the device already
      // matches. Same three phase budgets and the same "a lost write reply is
      // settled by the read-back, not by a timeout" rule as the single push.
      const pushResult = await pushPerOutputVerifyRecord(ctx, controller, plan, io, null);
      setSyncState(ctx, controller.id, { state: 'in-sync' });
      results.push(pushResult.responseLost
        ? { ...base, state: 'pushed',
          detail: 'the write reply was lost (device rebooted before answering) — the read-back ' +
            'confirms the mapping applied' }
        : { ...base, state: 'pushed' });
    } catch (err) {
      // Fail loud PER controller — record the state, keep going.
      setSyncState(ctx, controller.id, err.perOutputMismatch
        ? { state: 'drift', detail: err.message }
        : { state: 'unreachable', detail: err.message });
      results.push({ ...base, state: 'failed', detail: err.message });
    }
  }
  ctx.refresh();
  return results;
}

/**
 * Operator entry point for "Push all MarsinLED controllers" (the MarsinLED group
 * header button). One up-front confirm summarizing the count + the reboot
 * warning; then runs pushAllLedControllers and reports a per-controller summary.
 */
export function startPushAll(ctx) {
  const registry = ctx.registry();
  const ledControllers = (registry && Array.isArray(registry.controllers))
    ? registry.controllers.filter(isLedController) : [];
  if (ledControllers.length === 0) {
    ctx.showToast('No MarsinLED controllers to push — add or discover one first',
      { error: true, ttl: 6000 });
    return;
  }
  const pushable = ledControllers.filter((c) => isValidIp(c.ip));
  const overlay = el('div', 'vm-modal-overlay');
  const card = el('div', 'vm-modal-card led-push-card');
  overlay.appendChild(card);
  card.appendChild(el('div', 'vm-modal-title', `Push all MarsinLED controllers (${pushable.length})`));
  card.appendChild(el('div', 'led-push-warn',
    `⚠ This FORCE-pushes ${pushable.length} controller(s) SEQUENTIALLY — each is written and REBOOTS ` +
    `(~11 s measured, waited out to ${REBOOT_WAIT_SECONDS} s each), even if already in sync. ` +
    'Keep every sACN source streaming across the reboots.'));
  card.appendChild(el('div', 'led-push-warn led-push-saves-scene',
    'Push writes the device AND saves the scene (mapping must land on disk for the sACN feed to ' +
    'follow). One scene save + bridge notify runs once, after the last controller.'));
  const list = el('div', 'led-push-diff');
  for (const c of ledControllers) {
    const line = el('div', 'led-push-diff-line');
    line.textContent = isValidIp(c.ip)
      ? `• ${c.name} (${c.ip})`
      : `• ${c.name} — SKIPPED (no valid IP)`;
    list.appendChild(line);
  }
  card.appendChild(list);
  const statusLine = el('div', 'led-push-status');
  card.appendChild(statusLine);

  const actions = el('div', 'vm-modal-actions');
  const cancelBtn = el('button', 'vm-modal-btn', 'Cancel');
  cancelBtn.onclick = () => overlay.remove();
  const confirmBtn = el('button', 'vm-modal-btn vm-modal-btn-primary', 'Push all + reboot');
  confirmBtn.disabled = pushable.length === 0;
  confirmBtn.onclick = async () => {
    confirmBtn.disabled = true;
    cancelBtn.disabled = true;
    statusLine.textContent = `pushing ${pushable.length} controller(s) sequentially…`;
    statusLine.className = 'led-push-status';
    const results = await pushAllLedControllers(ctx, DEFAULT_DEVICE_IO);
    const pushed = results.filter((r) => r.state === 'pushed').length;
    const skipped = results.filter((r) => r.state === 'skipped').length;
    const failed = results.filter((r) => r.state === 'failed');
    const lostReply = results.filter((r) => r.state === 'pushed' && r.detail);
    const summary =
      `done — ${pushed} pushed · ${skipped} skipped · ${failed.length} failed` +
      (lostReply.length
        ? ` (${lostReply.length} write reply(ies) lost to the reboot, confirmed by read-back: ` +
          `${lostReply.map((r) => r.name).join(', ')})` : '') +
      (failed.length ? `: ${failed.map((f) => `${f.name} (${f.detail})`).join('; ')}` : '');
    // ONE completion for the whole sequence (slice S1): the per-controller
    // failures are already reported above; this is the feed side of the loop.
    statusLine.textContent = `${summary} · saving the scene (mapping → patches.yaml)…`;
    const steps = await persistAndNotifyAfterPush(DEFAULT_DEVICE_IO);
    const outcome = describePushCompletion(steps, {
      lead: summary,
      deviceNote: 'the device(s) WERE written (cannot be rolled back)',
    });
    statusLine.className = 'led-push-status' +
      (failed.length || !outcome.ok ? ' led-push-error' : ' led-push-ok');
    statusLine.textContent = outcome.text;
    cancelBtn.disabled = false;
    cancelBtn.textContent = 'Close';
    ctx.showToast(outcome.ok
      ? `Push all: ${pushed} pushed, ${failed.length} failed · scene saved, bridge notified`
      : `Push all: ${pushed} pushed, ${failed.length} failed · ✋ the sACN feed was NOT updated ` +
        `(${outcome.failedStep} failed)`,
    { error: failed.length > 0 || !outcome.ok, ttl: outcome.ok ? 9000 : 14000 });
  };
  actions.appendChild(cancelBtn);
  actions.appendChild(confirmBtn);
  card.appendChild(actions);
  overlay.onkeydown = (e) => { if (e.key === 'Escape' && !confirmBtn.disabled) cancelBtn.click(); };
  document.body.appendChild(overlay);
  confirmBtn.focus();
}
