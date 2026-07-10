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
  applyPerOutputUniverses,
} from '../dmx/led/marsinled_client.js';
import {
  computeLinearLayout,
  synthLinearConfig,
  derivePerOutputPlan,
} from '../dmx/led/device_config_mapper.js';
import {
  isLedController,
  isBoundLedController,
  addLedControllerFromDevice,
  bindControllerDevice,
  recordDevicePush,
  LED_DEVICE_VENDOR_MARSINLED,
  nextFreeUniverse,
  noteUniverseUsed,
  isValidIp,
} from '../dmx/controller_registry.js';

// ── Sync-chip cache (computed on panel open + after push; no polling) ───────
// controller.id → { state: 'in-sync'|'drift'|'unreachable'|'never'|'checking',
//                    detail?: string, changes?: Array }
const syncCache = new Map();

export function getSyncState(controllerId) {
  return syncCache.get(controllerId) || null;
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
};

// ── Layout preview (no device I/O) ──────────────────────────────────────────

/**
 * Compute the firmware's contiguous linear layout for the per-port derived line
 * from registry state (base universe = the first enabled output's port.universe,
 * Slice D — via synthLinearConfig, the shared builder). Returns { perOutput:
 * Map<outputIndex, layoutEntry>, universes: number[], error: string|null }.
 * Needs NO device snapshot (layout only depends on the enabled outputs, their
 * pixel counts, colorOrder, and the derived base universe).
 */
export function deriveLayoutPreview(controller, strandCounts) {
  const synth = synthLinearConfig(controller, strandCounts);
  if (!synth) {
    return { perOutput: new Map(), universes: [], error: 'no enabled output (assign a strand first)' };
  }
  try {
    const layout = computeLinearLayout(synth);
    const perOutput = new Map();
    const universes = new Set();
    for (const out of layout) {
      perOutput.set(out.outputIndex, out);
      if (out.enabled) for (const seg of out.segments) universes.add(seg.universe);
    }
    return { perOutput, universes: [...universes].sort((a, b) => a - b), error: null };
  } catch (err) {
    return { perOutput: new Map(), universes: [], error: err.message };
  }
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
      actions.appendChild(el('div', 'cm-fully-patched',
        `✓ already added as '${existing.name}'`));
    } else {
      const createBtn = el('button', 'cm-btn', '+ Create controller from device');
      createBtn.onclick = () => createFromDevice(ctx, device, done);
      actions.appendChild(createBtn);
    }
    // Offer "Bind" only when opened from a specific controller that ISN'T
    // already this device (rebinding an existing controller to this device).
    if (controller && (!existing || existing.id !== controller.id)) {
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
        mac: device.mac,
      },
    });
    // Auto-allocate the base universe so the derived layout + strand patches
    // resolve immediately (the operator can still override the field).
    const u = nextFreeUniverse(registry);
    created.led.baseUniverse = u;
    noteUniverseUsed(registry, u);
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
    const registry = ctx.registry();
    controller.ip = device.ip; // identity key
    bindControllerDevice(controller, {
      vendor: LED_DEVICE_VENDOR_MARSINLED,
      controllerId: device.controllerId,
      deviceName: config.deviceName,
      boardId: device.boardId,
      mac: device.mac,
    });
    if (!controller.led.baseUniverse || controller.led.baseUniverse < 1) {
      const u = nextFreeUniverse(registry);
      controller.led.baseUniverse = u;
      noteUniverseUsed(registry, u);
    }
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
      syncCache.set(controller.id, { state: 'never' });
      continue;
    }
    syncCache.set(controller.id, { state: 'checking' });
    computeSyncState(ctx, controller)
      .then((res) => { syncCache.set(controller.id, res); ctx.refresh(); })
      .catch((err) => {
        syncCache.set(controller.id, { state: 'unreachable', detail: err.message });
        ctx.refresh();
      });
  }
  ctx.refresh();
}

async function computeSyncState(ctx, controller) {
  const snapshot = await getConfig(controller.ip);
  const status = await getStatus(controller.ip);
  // Per-output DMX is the only supported mapping. Firmware without it is stale —
  // report drift so the operator updates it (no silent legacy fallback, codex P0).
  if (!deviceSupportsPerOutput(status)) {
    return { state: 'drift', detail: 'firmware predates per-output DMX' };
  }
  let plan;
  try {
    plan = derivePerOutputPlan(controller, ctx.strandLedCounts(), snapshot);
  } catch (err) {
    return { state: 'drift', detail: err.message };
  }
  const { universeByOutputIndex } = plan;
  const reported = readPerOutput(status);
  const changes = perOutputChanges(reported, universeByOutputIndex);
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
    const idLine = el('div', 'led-device-id');
    idLine.textContent =
      `${dev.deviceName || dev.controllerId} · ${dev.boardId || 'board ?'}` +
      (dev.mac ? ` · ${dev.mac}` : '');
    section.appendChild(idLine);

    const chipRow = el('div', 'led-device-chip-row');
    const sync = getSyncState(controller.id) || { state: dev.lastPush ? 'checking' : 'never' };
    const chip = el('span', `led-sync-chip led-sync-${sync.state}`, SYNC_LABELS[sync.state] || sync.state);
    if (sync.detail) chip.title = sync.detail;
    else if (sync.changes && sync.changes.length) {
      chip.title = sync.changes.map((c) => `${c.path}: ${c.from} → ${c.to}`).join('\n');
    }
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
    pushBtn.title = 'Read device status, derive the per-output plan, and (after confirm) push + reboot';
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
    syncCache.set(controller.id, { state: 'unreachable', detail: err.message });
    ctx.refresh();
    return;
  }

  // Per-output DMX is the only push style. Firmware without it is too old — LOUD
  // refusal, never a legacy fallback (operator decision + codex P0).
  if (!deviceSupportsPerOutput(status)) {
    const detail = 'firmware too old — update MarsinLED to a per-output build';
    ctx.showToast(`✋ '${controller.name}': ${detail}`, { error: true, ttl: 10000 });
    syncCache.set(controller.id, { state: 'drift', detail });
    ctx.refresh();
    return;
  }
  await startPerOutputPush(ctx, controller, snapshot, status);
}

// ── Per-output DMX push flow (firmware advertises capabilitiesExt.perOutputDmx) ─

/**
 * Expected `sacn.perOutput` shape the device should report back after a
 * per-output push, from the plan we sent. Used to render the confirmed mapping
 * (green on match). Each entry: {index, universe, startAddress:1, enabled:true}.
 */
function expectedPerOutput(universeByOutputIndex) {
  return Object.entries(universeByOutputIndex)
    .map(([index, universe]) => ({ index: Number(index), universe, startAddress: 1, enabled: true }))
    .sort((a, b) => a.index - b.index);
}

/**
 * Compare the device-reported `sacn.perOutput` to the plan we pushed. Returns an
 * array of human-readable mismatch strings ([] ⇒ the device confirmed the plan).
 */
function diffPerOutput(reported, universeByOutputIndex) {
  const mismatches = [];
  const byIndex = new Map();
  for (const entry of reported || []) byIndex.set(Number(entry.index), entry);
  for (const [indexStr, universe] of Object.entries(universeByOutputIndex)) {
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
      mismatches.push(`output ${index}: device reports enabled=${got.enabled}`);
    }
  }
  return mismatches;
}

/**
 * Structured drift between the device-reported `sacn.perOutput` and the plan, for
 * the sync-chip tooltip. Each change is `{path:'output N', from, to}` (from = the
 * device's current universe, `unset` when it carries no entry; to = the planned
 * universe). [] ⇒ every planned output already matches (universe + start 1 +
 * enabled).
 */
function perOutputChanges(reported, universeByOutputIndex) {
  const byIndex = new Map();
  for (const entry of reported || []) byIndex.set(Number(entry.index), entry);
  const changes = [];
  for (const [indexStr, universe] of Object.entries(universeByOutputIndex)) {
    const index = Number(indexStr);
    const got = byIndex.get(index);
    const matches = got && got.universe === universe && got.startAddress === 1 && got.enabled === true;
    if (matches) continue;
    const from = got ? `U${got.universe}` : 'unset';
    changes.push({ path: `output ${index}`, from, to: `U${universe}` });
  }
  return changes;
}

/**
 * Shared per-output push core (single-push + push-all use the SAME path). POST
 * the per-output plan (full read-modify-write), wait out the reboot, then VERIFY
 * by re-reading `sacn.perOutput` and asserting it matches the plan, and record
 * push provenance through the undo pipeline. THROWS on any failure (fail loud): a
 * network/device error propagates verbatim; a verify mismatch throws an Error
 * carrying `.perOutputMismatch` so the caller can render the drift. Takes an
 * injectable `io` bag so tests mock the device. `onStatus(msg)` is an optional
 * progress sink (single-push status line; push-all passes null).
 */
async function pushPerOutputVerifyRecord(ctx, controller, universeByOutputIndex, io, onStatus) {
  const report = onStatus || (() => {});
  report('pushing per-output universes…');
  const reply = await io.pushPerOutputUniverses(controller.ip, { universeByOutputIndex });
  const needsReboot = reply.reboot === true || reply.outcome === 'needs-reboot';
  if (needsReboot) {
    report('device rebooting — waiting for it to come back…');
    await io.awaitReboot(controller.ip);
  }

  report('reading confirmed mapping…');
  const verifyStatus = await io.getStatus(controller.ip);
  const reported = readPerOutput(verifyStatus);
  const mismatches = diffPerOutput(reported, universeByOutputIndex);
  if (mismatches.length) {
    const err = new Error(`device mapping mismatch — ${mismatches.join('; ')}`);
    err.perOutputMismatch = mismatches;
    throw err;
  }

  const configHash = await sha256Hex(JSON.stringify(universeByOutputIndex));
  const firmwareSHA = verifyStatus.firmwareSHA;
  ctx.mutate(`Pushed per-output universes to '${controller.name}'`, () => {
    // Pushing an UNBOUND card binds it: adopt the device identity from the
    // confirmed status so provenance + sync chips work from now on (addendum #3).
    if (!controller.device) {
      bindControllerDevice(controller, {
        vendor: LED_DEVICE_VENDOR_MARSINLED,
        controllerId: verifyStatus.controllerId,
        deviceName: verifyStatus.deviceName,
        boardId: verifyStatus.boardId,
        mac: verifyStatus.mac,
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
  return { needsReboot, reply, reported };
}

async function startPerOutputPush(ctx, controller, snapshot, status) {
  let plan;
  try {
    plan = derivePerOutputPlan(controller, ctx.strandLedCounts(), snapshot);
  } catch (err) {
    ctx.showToast(`✋ cannot derive per-output plan: ${err.message}`, { error: true, ttl: 10000 });
    return;
  }
  const { universeByOutputIndex, warnings } = plan;

  // Validate + build the EXACT strands payload (RMW preview) before the dialog —
  // a bad plan is blocked here, not at the device.
  let payloadStrands;
  try {
    validatePerOutputPlan(snapshot.strands, universeByOutputIndex);
    payloadStrands = applyPerOutputUniverses(snapshot.strands, universeByOutputIndex);
  } catch (err) {
    ctx.showToast(`✋ per-output plan rejected: ${err.message}`, { error: true, ttl: 10000 });
    return;
  }
  const payload = {
    strands: payloadStrands,
    dmx: { enabled: true, protocol: 0, timeoutMs: 3000 },
  };
  showPerOutputPushConfirm(ctx, controller, universeByOutputIndex, payload, warnings, status);
}

function showPerOutputPushConfirm(ctx, controller, universeByOutputIndex, payload, warnings, status) {
  const overlay = el('div', 'vm-modal-overlay');
  const card = el('div', 'vm-modal-card led-push-card');
  overlay.appendChild(card);
  card.appendChild(el('div', 'vm-modal-title',
    `Push per-output universes to '${controller.name}' (${controller.ip})`));

  card.appendChild(el('div', 'led-push-warn',
    '⚠ This writes strands + dmx (per-output sACN universe on every enabled output) and the device ' +
    'WILL REBOOT (~10 s). Keep the sACN source streaming across the reboot.'));

  if (warnings && warnings.length) {
    const warnBlock = el('div', 'led-push-warn led-push-unhonorable');
    warnBlock.appendChild(el('div', 'led-push-unhonorable-head',
      `⚠ ${warnings.length} note(s) — the plan was auto-extended so every enabled output gets a universe:`));
    for (const w of warnings) warnBlock.appendChild(el('div', 'led-push-unhonorable-line', w));
    card.appendChild(warnBlock);
  }

  card.appendChild(el('div', 'led-push-subhead', 'Per-output mapping'));
  const mapBox = el('div', 'led-push-diff');
  for (const { index, universe } of expectedPerOutput(universeByOutputIndex)) {
    const line = el('div', 'led-push-diff-line');
    line.textContent = `output ${index}:  universe ${universe}  ·  start 1`;
    mapBox.appendChild(line);
  }
  card.appendChild(mapBox);

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
  confirmBtn.onclick = () => runPerOutputPush(ctx, controller, universeByOutputIndex, DEFAULT_DEVICE_IO, {
    overlay, statusLine, confirmBtn, cancelBtn,
  });
  actions.appendChild(cancelBtn);
  actions.appendChild(confirmBtn);
  card.appendChild(actions);

  overlay.onkeydown = (e) => { if (e.key === 'Escape' && !confirmBtn.disabled) cancelBtn.click(); };
  document.body.appendChild(overlay);
  confirmBtn.focus();
}

async function runPerOutputPush(ctx, controller, universeByOutputIndex, io, ui) {
  const { statusLine, confirmBtn, cancelBtn } = ui;
  confirmBtn.disabled = true;
  cancelBtn.disabled = true;
  const setStatus = (msg, cls) => {
    statusLine.textContent = msg;
    statusLine.className = 'led-push-status' + (cls ? ` ${cls}` : '');
  };

  try {
    await pushPerOutputVerifyRecord(ctx, controller, universeByOutputIndex, io, (m) => setStatus(m));
    syncCache.set(controller.id, { state: 'in-sync' });
    setStatus('✓ pushed, rebooted, verified — per-output mapping confirmed', 'led-push-ok');
    cancelBtn.disabled = false;
    cancelBtn.textContent = 'Done';
    ctx.showToast(`✓ '${controller.name}' per-output universes confirmed`, { ttl: 7000 });
    ctx.refresh();
  } catch (err) {
    setStatus(`✋ per-output push failed: ${err.message}` +
      (err.field ? ` (field=${err.field})` : ''), 'led-push-error');
    syncCache.set(controller.id, err.perOutputMismatch
      ? { state: 'drift', detail: err.message }
      : { state: 'unreachable', detail: err.message });
    cancelBtn.disabled = false;
    cancelBtn.textContent = 'Close';
    ctx.refresh();
  }
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
        syncCache.set(controller.id, { state: 'drift', detail });
        results.push({ ...base, state: 'failed', detail });
        continue;
      }
      const snapshot = await io.getConfig(controller.ip);
      const { universeByOutputIndex } =
        derivePerOutputPlan(controller, ctx.strandLedCounts(), snapshot);
      // FORCE: always push + reboot + verify, even when the device already matches.
      await pushPerOutputVerifyRecord(ctx, controller, universeByOutputIndex, io, null);
      syncCache.set(controller.id, { state: 'in-sync' });
      results.push({ ...base, state: 'pushed' });
    } catch (err) {
      // Fail loud PER controller — record the state, keep going.
      syncCache.set(controller.id, err.perOutputMismatch
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
    '(~10 s), even if already in sync. Keep every sACN source streaming across the reboots.'));
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
    statusLine.className = 'led-push-status' + (failed.length ? ' led-push-error' : ' led-push-ok');
    statusLine.textContent =
      `done — ${pushed} pushed · ${skipped} skipped · ${failed.length} failed` +
      (failed.length ? `: ${failed.map((f) => `${f.name} (${f.detail})`).join('; ')}` : '');
    cancelBtn.disabled = false;
    cancelBtn.textContent = 'Close';
    ctx.showToast(`Push all: ${pushed} pushed, ${failed.length} failed`,
      { error: failed.length > 0, ttl: 9000 });
  };
  actions.appendChild(cancelBtn);
  actions.appendChild(confirmBtn);
  card.appendChild(actions);
  overlay.onkeydown = (e) => { if (e.key === 'Escape' && !confirmBtn.disabled) cancelBtn.click(); };
  document.body.appendChild(overlay);
  confirmBtn.focus();
}
