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
  readConfiguredPerOutput,
  buildForcedConfigBody,
  pushForcedConfig,
  diffForcedConfig,
  swarmEnabledNote,
  buildDmxToggleBody,
  diffDmxToggle,
  pushDmxToggle,
  buildGammaPushBody,
  diffGammaPush,
  pushGammaPush,
  readWithRetryOnTimeout,
  deviceNameRepairForPush,
  PER_OUTPUT_WRITE_TIMEOUT_MS,
  REBOOT_WAIT_TIMEOUT_MS,
} from '../dmx/led/marsinled_client.js';
import { readGammaMirror, formatGamma } from '../dmx/led/led_gamma.js';
import {
  derivePerOutputPlan,
} from '../dmx/led/device_config_mapper.js';
import { projectLedStrandSegments } from '../dmx/led/led_patch_projection.js';
import {
  buildRouteExpectation,
  confirmBridgeRoutes,
} from '../dmx/led/bridge_route_confirm.js';
import {
  isLedController,
  isBoundLedController,
  isProvisionalLedController,
  isVerifiedLedController,
  addLedControllerFromDevice,
  bindControllerDevice,
  markControllerProvisional,
  promoteProvisionalBinding,
  controllerBoundToDeviceId,
  unbindControllerDevice,
  recordDevicePush,
  recordDeviceGammaPush,
  ledOutputIndexForPort,
  entryFixtureName,
  LED_DEVICE_VENDOR_MARSINLED,
  LED_MAX_OUTPUTS,
  noteUniverseUsed,
  isValidIp,
} from '../dmx/controller_registry.js';
import {
  reconcileProvisionalContact,
  describeProvisionalReconcile,
  PROVISIONAL_HARD_BLOCKERS,
} from '../dmx/led/provisional_binding.js';
import { ledBindingBadgeModel, canMarkProvisional } from '../dmx/controller_status.js';
import {
  assertResolvableOverlaps,
  overlapsForController,
  describeOverlapsForController,
} from '../dmx/address_merge.js';

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

export function syncChipModel(ctx, controllerId, hasLastPush = true) {
  const sync = getSyncState(ctx, controllerId) || {
    state: hasLastPush ? 'checking' : 'never',
  };
  return {
    state: sync.state,
    className: `led-sync-chip led-sync-${sync.state}`,
    label: SYNC_LABELS[sync.state] || sync.state,
    title: describeSyncChipTooltip(sync),
  };
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

// ── DMX flag label state (display-only; NEVER persisted, NEVER polled) ───────
// key → the board's `dmx.enabled` as LAST OBSERVED. Written ONLY from reads the
// panel already performs (the sync sweep, the push verify, the toggle's own
// read-back) — report `_363` §3: "a plain last-observation label", no polling,
// no timer, no TTL, no background sweep. An absent entry is the honest `?`: the
// panel has not read this board in this scene yet and refuses to guess.
const dmxStateCache = new Map();

function noteDmxState(ctx, controllerId, enabled) {
  if (typeof enabled !== 'boolean') return;
  dmxStateCache.set(cacheKey(ctx, controllerId), enabled);
}

/** Forget the label — every toggle FAILURE lands here (the read-back is the only truth). */
function clearDmxState(ctx, controllerId) {
  dmxStateCache.delete(cacheKey(ctx, controllerId));
}

/** The board's last-observed `dmx.enabled`, or null when it was never read. */
export function getDmxState(ctx, controllerId) {
  const key = cacheKey(ctx, controllerId);
  return dmxStateCache.has(key) ? dmxStateCache.get(key) : null;
}

/** Seed the label from any `GET /api/config` document the panel already read. */
function noteDmxStateFromConfig(ctx, controllerId, config) {
  if (!config || typeof config !== 'object' || !config.dmx || typeof config.dmx !== 'object') return;
  noteDmxState(ctx, controllerId, config.dmx.enabled === true);
}

const DMX_TOGGLE_TOOLTIP =
  'writes the board\'s DMX flag and reboots it (~11 s)';

/**
 * The per-card DMX ⏻ control's model. PURE (no DOM, no I/O) so the label rule is
 * asserted without a browser (report `_363` §3).
 *
 * The label states the LAST CONFIRMED observation and nothing else — `DMX: on`,
 * `DMX: off`, or `DMX: ?` before this scene ever read the board (or after a
 * failed toggle). The click target is the OPPOSITE of a known state; from `?` it
 * asks for ON, because that is the state a show needs and the same state the
 * config push forces — never a silent guess about what the board holds, since
 * the toggle re-reads the board before it writes anything.
 */
export function dmxToggleModel(ctx, controller) {
  const state = getDmxState(ctx, controller.id);
  const known = state === true || state === false;
  const label = `⏻ DMX: ${known ? (state ? 'on' : 'off') : '?'}`;
  const target = state === true ? false : true;
  const intent = state === true
    ? 'Click to switch DMX (sACN) input OFF on this board.'
    : (state === false
      ? 'Click to switch DMX (sACN) input ON on this board.'
      : 'The board\'s DMX flag has not been read in this scene yet — clicking switches it ON.');
  return {
    state: known ? state : null,
    label,
    target,
    className: `cm-btn led-device-dmx-toggle led-dmx-${known ? (state ? 'on' : 'off') : 'unknown'}`,
    title: `${intent} It ${DMX_TOGGLE_TOOLTIP}. Nothing else is written — strands, swarm and ` +
      'gamma are untouched.',
  };
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
      // FORCE semantics (report `_362`): a push enables exactly the outputs a
      // port maps and DISABLES every other one. `owner === undefined` here means
      // no OTHER port row drives output n, so the only question left is whether
      // THIS row does.
      const devDesc = `${dev.count !== null ? `, ${dev.count} px` : ''}` +
        `${dev.universe !== null ? `, U${dev.universe}` : ''}`;
      if (dev.enabled) {
        label = port.output === n
          ? `${n} — enabled${devDesc}`
          : `${n} — enabled${devDesc} · push will DISABLE it`;
      } else {
        label = port.output === n
          ? `${n} — disabled · push will ENABLE it`
          : `${n} — disabled`;
      }
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
  pushForcedConfig,
  // The DMX ⏻ toggle's transport (report `_363` §3) — the same injectable seam,
  // so the toggle tests drive it against a mock board too.
  pushDmxToggle,
  // The gamma push's transport (report `_363` §11) — PUSH ONLY. There is no
  // gamma READ member here and there never will be: the sim states the curve,
  // the board confirms it, and nothing ever mirrors a curve back off a device.
  pushGammaPush,
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
  // ── _127: the third check is a MEASUREMENT ────────────────────────────────
  // "✓ bridge notified — routes follow" trusted the notify; this reads the
  // bridge's ACTIVE route table back over the same WS the notify travelled and
  // renders ✓ only when the expected (universe → controller IP) pairs exist.
  // Injectable like the other steps.
  confirmBridgeRoutes: (expectations) => {
    if (!window.sacnInput || typeof window.sacnInput.queryRoutes !== 'function') {
      throw new Error('window.sacnInput.queryRoutes is not installed — the bridge route table ' +
        'cannot be read back');
    }
    return confirmBridgeRoutes({
      expectations,
      readRoutes: () => window.sacnInput.queryRoutes(),
    });
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
 * The port-universe repairs a DERIVED PLAN implies: one entry per port whose
 * registry universe is invalid (≤0) and which the plan nevertheless assigned a
 * universe to (`derivePerOutputPlan`'s auto-assign leg, which skips every
 * universe claimed across the registry). PURE — it reads, it never writes.
 *
 * WHY THIS SHAPE (this slice; the old `ensurePortUniverses` is gone). The
 * repair used to run inside `startPush` / `pushAllLedControllers` BEFORE the
 * operator confirmed anything, so opening the confirm dialog and pressing
 * Cancel left the registry mutated (and the scene dirty) for a push that never
 * happened. Deriving it from the plan instead means:
 *
 *  1. the PREVIEW is pure — the dialog's payload is computed from the card as
 *     it stands, and the plan's own auto-assign leg is what repairs an invalid
 *     universe, exactly as it always did for the sync chip;
 *  2. the COMMIT happens only on FORCE (`commitPlanPortUniverses`), and it
 *     writes the SAME universe the previewed body carries — the old path could
 *     hand the port `nextFreeUniverse(registry)` while the plan independently
 *     chose "max used + 1, skipping claims", i.e. the registry could end up
 *     stating a universe the board was never told about.
 *
 * A port the plan did NOT assign (it maps no pixels, so the push disables its
 * output) is deliberately NOT repaired: allocating a universe to an output
 * about to go dark is a claim on the rig that nothing is streaming to.
 */
function planPortUniverseRepairs(controller, plan) {
  const repairs = [];
  for (const assignment of plan.assignments || []) {
    const port = (controller.ports || []).find((p) => p.port === assignment.portNum);
    if (!port) continue;
    if (Number.isInteger(port.universe) && port.universe >= 1) continue;   // manual value stands
    repairs.push({ port, portNum: assignment.portNum, universe: assignment.universe });
  }
  return repairs;
}

/**
 * COMMIT the repairs above onto the registry. Call this ONLY on the accept path
 * — after the operator pressed FORCE, before the write — never while merely
 * previewing a plan. Returns the repairs it applied (empty when there were
 * none, in which case the registry is not touched and no undo entry is made).
 */
function commitPlanPortUniverses(ctx, controller, plan) {
  const repairs = planPortUniverseRepairs(controller, plan);
  if (repairs.length === 0) return repairs;
  const registry = ctx.registry();
  ctx.mutate(`Allocated universe(s) for ${controller.name}`, () => {
    for (const repair of repairs) {
      repair.port.universe = repair.universe;
      noteUniverseUsed(registry, repair.universe);
    }
  });
  return repairs;
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
 * can never tell different stories.
 *
 * The old `universe_owned` lead ("universe collision") is GONE with the kind
 * itself (operator order 2026-07-31): a shared universe is a warning now, and
 * every collision that remains is structural — a duplicate output, an
 * out-of-range output, a card that would leave every output dark.
 */
function describeCollisions(collisions) {
  return `push REFUSED — ${collisions.map((c) => c.message).join('; ')}`;
}

/**
 * One sentence for the ALLOWED overlaps on a plan — the shared-address warning
 * text reused by the sync-chip tooltip, the confirm dialog and the fleet push's
 * per-controller detail. Never a refusal: it always reads as "allowed, and here
 * is who wins".
 */
function describeSharedUniverses(shared) {
  return `⚠ shared address (allowed) — ${shared.map((s) => s.message).join('; ')}`;
}

/**
 * The registry-wide shared-address plan, or null when the editor did not thread
 * one in. Used for the CARD BANNER and for the pre-push ambiguity gate.
 *
 * Optional on purpose: `ctx.addressMergePlan` is supplied by
 * controller_map_editor's ledCtx, but several unit-test contexts build a minimal
 * ctx and must not be forced to fake a whole projection just to push. A missing
 * plan means "no overlap information" — the pane simply shows no banner. It is
 * NOT a silent fallback for a BROKEN plan: a provider that throws still throws.
 */
function addressMergePlanFor(ctx) {
  if (typeof ctx.addressMergePlan !== 'function') return null;
  const plan = ctx.addressMergePlan();
  if (!plan) return null;
  if (!Array.isArray(plan.overlaps) || !Array.isArray(plan.ambiguities)) {
    throw new Error('[LedPanel] ctx.addressMergePlan() must return a planUnifiedOutput result ' +
      '({destinations, overlaps, ambiguities, suppressions})');
  }
  return plan;
}

/**
 * The BLOCKING half of the shared-address feature, in the same shape the rest of
 * the push path already refuses on. An overlap the higher-IP rule cannot rank
 * (two claims from the same IP, or a claimant with no usable IP) has no
 * deterministic winner, so it is a hard error — the operator's rule covers
 * IP-bearing conflicts only, and inventing a tie-break would be exactly the
 * fallback codex P0 forbids.
 *
 * Only ambiguities this controller is PART OF block this controller's push: one
 * card must not be held hostage by an unrelated pair elsewhere in the rig.
 * `assertResolvableOverlaps` is still the single source of the refusal text.
 */
function unrankableCollisionsFor(ctx, controller) {
  const plan = addressMergePlanFor(ctx);
  if (!plan) return [];
  const view = overlapsForController(plan, controller);
  if (view.ambiguous.length === 0) return [];
  let reason;
  try {
    assertResolvableOverlaps({ ambiguities: view.ambiguous });
    return [];
  } catch (err) {
    reason = err.message;
  }
  return view.ambiguous.map((a) => ({
    kind: 'unrankable_shared_address',
    outputIndex: undefined,
    port: undefined,
    universe: a.universe,
    owner: undefined,
    message: a.message,
    reason,
  }));
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
      // Say WHICH state it is in — three distinct ones now. "added" (a card with
      // this IP exists) is not "provisional" (declared, patched, fingerprint
      // still unknown) is not "verified" (fingerprint read off this board). A
      // hand-typed card matches by IP while still unbound — calling that a plain
      // ✓ is what made the missing Bind button read as "the sim can't see my
      // controller".
      if (isProvisionalLedController(existing)) {
        actions.appendChild(el('div', 'cm-warn-chip',
          `⚑ '${existing.name}' is PROVISIONAL at this IP — this scan is its FIRST CONTACT`));
        // The scan already carries the board's identity: promote right here.
        const promoteBtn = el('button', 'cm-btn', `Promote '${existing.name}' → verified`);
        promoteBtn.title = 'Reconcile this board against the declared binding and, if they ' +
          'agree, record its fingerprint. Any disagreement stops and shows you what differs.';
        promoteBtn.onclick = () => {
          const outcome = attemptFirstContactPromote(ctx, existing, device, { interactive: true });
          if (outcome.promoted) done();
          else ctx.refresh();
        };
        actions.appendChild(promoteBtn);
      } else {
        actions.appendChild(el('div', 'cm-fully-patched',
          isBoundLedController(existing)
            ? `✓ already added as '${existing.name}'`
            : `✓ added as '${existing.name}' — NOT bound yet`));
      }
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
  'Measures the DEVICE against the FORCED plan this page would push (device ≡ plan) — which ' +
  'outputs would be enabled and on which universe, which would be DISABLED, which counts would ' +
  'be rewritten, and whether the board is DMX-driven at all — NOT the sACN feed: green does ' +
  'not prove frames are reaching the strands, which needs the scene saved (patches.yaml) and ' +
  'the sACN bridge notified.';

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
 * caller paints only the affected read-state nodes. No background loop and no
 * replacement of the controller pane: a late board response must not move the
 * operator away from the controls they are using.
 */
export function refreshSyncChips(ctx) {
  const registry = ctx.registry();
  if (!registry || !Array.isArray(registry.controllers)) return;
  // VERIFIED cards only. A provisional card has never spoken to a board, so
  // there is no device to compare a plan against — its card shows the
  // PROVISIONAL badge instead, and a sync chip there would invent a
  // hardware-vs-plan verdict out of nothing.
  const bound = registry.controllers.filter(isVerifiedLedController);
  for (const controller of bound) {
    if (!controller.device.lastPush) {
      setSyncState(ctx, controller.id, { state: 'never' });
      continue;
    }
    setSyncState(ctx, controller.id, { state: 'checking' });
    computeSyncState(ctx, controller)
      .then((res) => {
        setSyncState(ctx, controller.id, res);
        ctx.refreshReadState(controller.id);
      })
      .catch((err) => {
        setSyncState(ctx, controller.id, { state: 'unreachable', detail: err.message });
        ctx.refreshReadState(controller.id);
      });
  }
  ctx.refreshReadState();
}

export async function computeSyncState(ctx, controller) {
  const snapshot = await getConfig(controller.ip);
  const status = await getStatus(controller.ip);
  setLiveMac(ctx, controller.id, status.mac); // display-only — never persisted
  setDeviceOutputs(ctx, controller.id, snapshot.strands); // feeds the output selector
  noteDmxStateFromConfig(ctx, controller.id, snapshot); // seeds the ⏻ label — ZERO new reads
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
  const reported = readConfiguredPerOutput(snapshot);
  const changes = perOutputChanges(reported, plan);
  // MODE DRIFT, NARROWED (report `_363` §2.3-3, superseding `_362` §2.3-9). The
  // push forces `dmx.enabled:true`, so a board that is not DMX-driven still reads
  // drift — that IS a pending change the operator must see before pressing Push.
  //
  // The `_362` swarm clause is GONE: the narrowed push never mentions swarm, so a
  // swarm-enabled board with a correct mapping and DMX on is genuinely IN SYNC
  // (swarm is operator-managed on the controller's own UI, ruling 6/7). Claiming
  // drift there would promise a push that changes something — and this push
  // would change nothing.
  if (!snapshot.dmx || snapshot.dmx.enabled !== true) {
    return {
      state: 'drift',
      detail: 'board is not DMX-driven — push will force DMX ON',
      changes,
    };
  }
  if (changes.length) return { state: 'drift', changes };
  // A SHARED universe does not make the device differ from the plan, so the chip
  // stays IN-SYNC — that is exactly what it measures. It still carries the
  // warning in its detail (and therefore its tooltip) so the fact is never only
  // in the card banner (operator 2026-07-31: the UI must SHOW that it's a warning).
  if (plan.sharedUniverses.length) {
    return { state: 'in-sync', detail: describeSharedUniverses(plan.sharedUniverses) };
  }
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
/**
 * The persistent ⚠ shared-address banner for ONE controller card, or null when
 * this card contests nothing. PURE-ish: reads the registry-wide merge plan off
 * ctx and returns a detached element, so a DOM-less unit test can call
 * `sharedAddressBannerModel` (below) for the same content without a document.
 *
 * Two visual grades, and they are deliberately different:
 *  - WARNING (amber) — a resolvable overlap. The push proceeds; the higher IP
 *    wins on the contested channels and the banner says which.
 *  - ERROR (red) — an overlap the higher-IP rule cannot rank (same IP, or a
 *    claimant with no usable IP). That is still a hard stop (codex P0), and the
 *    banner must not look like the amber case.
 */
export function sharedAddressBannerModel(plan, controller) {
  if (!plan) return null;
  const view = overlapsForController(plan, controller);
  if (view.total === 0) return null;
  const lines = describeOverlapsForController(view);
  const blocking = view.ambiguous.length > 0;
  const shareCount = view.wins.length + view.loses.length;
  const parts = [];
  if (shareCount) parts.push(`${shareCount} shared address${shareCount === 1 ? '' : 'es'}`);
  if (view.ambiguous.length) {
    parts.push(`${view.ambiguous.length} UNRESOLVABLE`);
  }
  return {
    blocking,
    lines,
    headline: (blocking ? '✋ ' : '⚠ ') + parts.join(' · ') +
      (blocking
        ? ' — the higher-IP rule cannot rank these; the push is REFUSED until one address moves'
        : ' — allowed: frames are unified into one packet per destination, higher IP overrides'),
  };
}

function renderSharedAddressBanner(ctx, controller) {
  const model = sharedAddressBannerModel(addressMergePlanFor(ctx), controller);
  if (!model) return null;
  const box = el('div', `led-shared-address ${model.blocking ? 'led-shared-address-error' : 'led-shared-address-warn'}`);
  box.appendChild(el('div', 'led-shared-address-head', model.headline));
  for (const line of model.lines) {
    box.appendChild(el('div', 'led-shared-address-line', line));
  }
  box.title = model.blocking
    ? 'Two claims land on the same channels and neither outranks the other, so there is no ' +
      'deterministic winner. Give the claimant a real device IP, or move one address.'
    : 'Sending to the same address is allowed. The sim composes ONE packet per (universe, ' +
      'destination) and the numerically higher controller IP overrides on the contested ' +
      'channels — nothing races on the wire.';
  return box;
}

export function renderDeviceBindingSection(ctx, controller) {
  if (!isLedController(controller)) return null;
  const section = el('div', 'led-device-section');
  const verified = isVerifiedLedController(controller);
  const provisional = isProvisionalLedController(controller);
  const validIp = isValidIp(controller.ip);

  // Binding GRADE badge — always first, always visible, never a hidden flag
  // (operator ruling 2026-07-31). A provisional card must announce itself: it
  // patches the whole chain on the operator's word alone, and the pane is the
  // only place that fact can be seen.
  const badge = ledBindingBadgeModel(controller);
  if (badge) {
    const badgeChip = el('span', `led-binding-badge ${badge.cls}`, badge.label);
    badgeChip.title = badge.title;
    section.appendChild(badgeChip);
  }

  // SHARED-ADDRESS BANNER — persistent, right on the card, for as long as the
  // overlap exists (operator 2026-07-31: *"the UI must show that that's a
  // warning"*). Not a toast: a toast is gone in 8 seconds and the operator maps
  // controllers for an hour. It names every claimant this card contests with,
  // the exact (universe, channel-range), and who wins.
  const banner = renderSharedAddressBanner(ctx, controller);
  if (banner) section.appendChild(banner);

  if (provisional) {
    const dev = controller.device;
    const declared = el('div', 'led-device-id led-device-provisional');
    const expectations = [dev.deviceName, dev.boardId].filter(Boolean).join(' · ');
    declared.textContent = `declared at ${controller.ip || 'no IP'}` +
      (expectations ? ` — expecting ${expectations}` : '') + ' · fingerprint not read yet';
    declared.title = 'Patched and routed. Only the board fingerprint is missing — it arrives on ' +
      'first contact.';
    section.appendChild(declared);

    const verifyBtn = el('button', 'cm-btn led-device-verify', '🔗 Verify against board now');
    if (validIp) {
      verifyBtn.title = `Contact ${controller.ip} now, read its identity, and PROMOTE this ` +
        'binding to verified if the board agrees with what you declared. Any disagreement ' +
        'stops and shows you exactly what differs — nothing is overwritten either way.';
      verifyBtn.onclick = () => verifyProvisionalNow(ctx, controller);
    } else {
      verifyBtn.disabled = true;
      verifyBtn.title = 'set a valid device IP first';
    }
    section.appendChild(verifyBtn);

    const dropBtn = el('button', 'cm-btn led-device-drop-provisional', '✕ Drop provisional');
    dropBtn.title = 'Withdraw the board claim. Patching is unaffected — only the first-contact ' +
      'identity check goes away.';
    dropBtn.onclick = () => {
      ctx.mutate(`Dropped the provisional binding on '${controller.name}'`, () => {
        unbindControllerDevice(controller);
      });
      ctx.showToast(`'${controller.name}' no longer claims a board — its strands stay patched`,
        { ttl: 8000 });
    };
    section.appendChild(dropBtn);
  }

  if (!verified && !provisional) {
    // An UNBOUND card that carries chains IS PATCHED (operator ruling
    // 2026-08-03, report 20260725_123): chaining is the patch and the typed IP is
    // the destination. ONE quiet tag says the only thing that is actually
    // outstanding — nobody has checked the board (operator addendum 2026-08-03:
    // *"the warning and patch without board button is okay. Just make sure it's
    // not too noisy."*). No banner, no red, nothing repeated per port row. The
    // chained-with-NO-IP case is the loud one and the card-level banner owns it.
    const chainedCount = (controller.ports || []).reduce(
      (n, p) => n + (p.chain || []).filter((e) => entryFixtureName(e) !== null).length, 0);
    if (chainedCount > 0 && validIp) {
      // NOT `.led-binding-badge` — an unbound card still carries no grade badge
      // (report `_96` §6.2, and agent_tools/provisional_status_verify.cjs pins it).
      const tag = el('span', 'led-device-tag led-device-unverified', '⚑ board unverified');
      tag.title = `Patched and routed to ${controller.ip}. The board itself has not been read ` +
        'yet — first contact checks it.';
      section.appendChild(tag);
    }

    // The OPTIONAL-DISCOVERY entry point (operator ruling 2026-07-31). Under the
    // 2026-08-03 ruling it is a CONVENIENCE, never a prerequisite: it records the
    // claim now so first contact can promote/reconcile against it instead of
    // meeting an unclaimed card. Patching happens with or without it. Kept under
    // the operator's own name for it, with the tooltip carrying the meaning.
    const gate = canMarkProvisional(controller);
    const markBtn = el('button', 'cm-btn led-device-mark-provisional', '⚑ Patch without the board');
    if (gate.allowed) {
      markBtn.title = `Optional — already patched. Claims the board at ${controller.ip} so first ` +
        'contact verifies it instead of adopting whatever answers.';
      markBtn.onclick = () => {
        ctx.mutate(`Declared a provisional binding on '${controller.name}'`, () => {
          markControllerProvisional(controller);
        });
        ctx.showToast(`⚑ '${controller.name}' claims the board at ${controller.ip}`, { ttl: 7000 });
      };
    } else {
      markBtn.disabled = true;
      markBtn.title = `Cannot declare a provisional binding: ${gate.reason}`;
    }
    section.appendChild(markBtn);
  }

  if (verified) {
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
    const sync = syncChipModel(ctx, controller.id, !!dev.lastPush);
    const chip = el('span', sync.className, sync.label);
    chip.dataset.cmControllerId = controller.id;
    // Every chip states what it measures (slice S5) — device ≡ plan, never the feed.
    chip.title = sync.title;
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
    pushBtn.title = "FORCE the sim panel's settings onto the board: strands + per-output " +
      'universes as mapped here, every unmapped output DISABLED, and the board switched to ' +
      'DMX-driven (sACN). Then save the scene and notify the sACN bridge.';
    pushBtn.onclick = () => startPush(ctx, controller);
  } else {
    pushBtn.disabled = true;
    pushBtn.title = 'set the device IP first';
  }
  section.appendChild(pushBtn);

  // The DMX ⏻ toggle (report `_363` §3) — right next to ⬆ Push, because it is
  // the manual lever BETWEEN pushes (the push forces DMX ON; this switches it
  // either way without touching anything else). NO confirm dialog by operator
  // ruling; the tooltip carries the whole contract, including the reboot.
  const dmxModel = dmxToggleModel(ctx, controller);
  const dmxBtn = el('button', dmxModel.className, dmxModel.label);
  if (validIp) {
    dmxBtn.title = dmxModel.title;
    dmxBtn.onclick = () => toggleDmx(ctx, controller, dmxModel.target, DEFAULT_DEVICE_IO, dmxBtn);
  } else {
    dmxBtn.disabled = true;
    dmxBtn.title = 'set the device IP first';
  }
  section.appendChild(dmxBtn);

  const bindBtn = el('button', 'cm-btn led-device-rebind',
    verified ? 'Re-bind…' : '🔍 Discover / bind device');
  bindBtn.title = verified
    ? 'Bind this controller to a different discovered device'
    : 'Find a MarsinLED on the network and bind it to this controller';
  bindBtn.onclick = () => openLedDiscoveryPanel(ctx, { controller });
  section.appendChild(bindBtn);

  return section;
}

// ── PROVISIONAL → VERIFIED: first contact, reconcile, promote ────────────────

/**
 * Operator-initiated first contact ("Verify against board now"). Reads the
 * board, reconciles, and either promotes or opens the reconcile dialog. The
 * ONLY device HTTP in this path is the read.
 */
async function verifyProvisionalNow(ctx, controller) {
  let status;
  let config = null;
  try {
    status = await getStatus(controller.ip);
    config = await getConfig(controller.ip);
  } catch (err) {
    ctx.showToast(`✋ ${controller.ip} did not answer: ${err.message} — '${controller.name}' ` +
      'stays PROVISIONAL (its strands remain patched)', { error: true, ttl: 9000 });
    return;
  }
  const device = {
    ip: controller.ip,
    controllerId: status.controllerId,
    boardId: status.boardId,
    deviceName: (config && config.deviceName) || status.deviceName,
    strands: status.strands,
    mac: status.mac,
    raw: status,
  };
  attemptFirstContactPromote(ctx, controller, device, { interactive: true });
}

/**
 * FIRST CONTACT for a provisional card. Shared by the operator's "Verify now"
 * button, the discovery panel's promote action, and the automatic status sweep
 * (controller_map_editor) — one reconcile, one promote, one dialog, so all three
 * entry points behave identically.
 *
 * Promotes ONLY on a clean reconcile. A contradiction leaves the card exactly as
 * it was, on both sides of the wire, and raises the dialog (codex P0 — never
 * auto-pick a side).
 *
 * @returns {{promoted: boolean, result: Object}}
 */
export function attemptFirstContactPromote(ctx, controller, device, { interactive = true } = {}) {
  const registry = ctx.registry();
  const result = reconcileProvisionalContact(controller, device, { registry });
  if (result.ok) {
    ctx.mutate(`Promoted '${controller.name}' to VERIFIED (${result.identity.controllerId})`, () => {
      promoteProvisionalBinding(controller, result.identity, { registry });
    });
    setLiveMac(ctx, controller.id, device.mac); // display-only — never persisted
    if (Array.isArray(device.strands)) setDeviceOutputs(ctx, controller.id, device.strands);
    ctx.showToast(`✓ ${describeProvisionalReconcile(controller, result)}`, { ttl: 10000 });
    console.log(`[LED Binding] ${describeProvisionalReconcile(controller, result)}`);
    refreshSyncChips(ctx);
    return { promoted: true, result };
  }
  console.warn(`[LED Binding] ✋ ${describeProvisionalReconcile(controller, result)}`);
  for (const m of result.mismatches) console.warn(`[LED Binding]   • ${m.code}: ${m.message}`);
  if (interactive) showProvisionalReconcileDialog(ctx, controller, result, device);
  return { promoted: false, result };
}

/**
 * The reconcile dialog — the loud stop when the board contradicts a declared
 * binding. It states every disagreement with both sides spelled out, and offers
 * the operator TWO explicit choices and no default:
 *
 *   "Keep provisional"  — change nothing. The card stays patched exactly as
 *                         declared; go fix the card (or the IP) yourself.
 *   "Promote anyway"    — accept the board's identity, knowingly. Disabled for
 *                         the hard blockers (an unidentifiable box, or a
 *                         fingerprint another card already owns), because
 *                         promoting past those cannot produce a coherent scene.
 *
 * There is deliberately NO "make the board match the card" button here: that is
 * a PUSH, it reboots hardware, and it has its own confirm dialog.
 */
export function showProvisionalReconcileDialog(ctx, controller, result, device) {
  const overlay = el('div', 'vm-modal-overlay');
  const card = el('div', 'vm-modal-card led-reconcile-card');
  overlay.appendChild(card);
  card.appendChild(el('div', 'vm-modal-title',
    `⚠ '${controller.name}' — the board disagrees with the declared binding`));

  card.appendChild(el('div', 'led-reconcile-lead',
    `${controller.ip} answered, but it is not the board this card describes. NOTHING has been ` +
    'changed — not on the card, not on the device. The strands stay patched exactly as you ' +
    'declared them.'));

  const list = el('div', 'led-reconcile-list');
  for (const m of result.mismatches) {
    const row = el('div', 'led-reconcile-row' +
      (PROVISIONAL_HARD_BLOCKERS.includes(m.code) ? ' led-reconcile-blocker' : ''));
    row.appendChild(el('div', 'led-reconcile-code', m.code));
    row.appendChild(el('div', 'led-reconcile-msg', m.message));
    row.appendChild(el('div', 'led-reconcile-diff',
      `declared: ${m.expected}    ·    board: ${m.actual}`));
    list.appendChild(row);
  }
  card.appendChild(list);

  const actions = el('div', 'vm-modal-actions');
  const keepBtn = el('button', 'vm-modal-btn vm-modal-btn-primary', 'Keep provisional (change nothing)');
  const promoteBtn = el('button', 'vm-modal-btn', 'Promote anyway — accept the board identity');
  if (result.hardBlocked) {
    promoteBtn.disabled = true;
    promoteBtn.title = 'Blocked: this box cannot be identified as a MarsinLED, or its ' +
      'fingerprint already belongs to another controller card. Promoting past that cannot ' +
      'produce a coherent scene.';
  } else {
    promoteBtn.title = `Record device '${result.identity.controllerId}'` +
      `${result.identity.boardId ? ` (${result.identity.boardId})` : ''} on this card and mark ` +
      'the binding VERIFIED. Your port/output/universe config is NOT touched — the ' +
      'disagreements above remain, they just stop blocking the binding.';
    promoteBtn.onclick = () => {
      ctx.mutate(`Promoted '${controller.name}' despite ${result.mismatches.length} mismatch(es)`,
        () => {
          promoteProvisionalBinding(controller, result.identity, { registry: ctx.registry() });
        });
      if (device) setLiveMac(ctx, controller.id, device.mac);
      ctx.showToast(`'${controller.name}' promoted to VERIFIED with ` +
        `${result.mismatches.length} unresolved mismatch(es) — you accepted the board identity`,
      { ttl: 11000 });
      overlay.remove();
      refreshSyncChips(ctx);
    };
  }
  keepBtn.onclick = () => overlay.remove();
  actions.appendChild(keepBtn);
  actions.appendChild(promoteBtn);
  card.appendChild(actions);

  overlay.onkeydown = (e) => { if (e.key === 'Escape') overlay.remove(); };
  document.body.appendChild(overlay);
  keepBtn.focus();
}

// ── Pre-write identity gate (report `_363` §2.3-1) ──────────────────────────

/**
 * The refusal sentence for a bound card whose board answers as a DIFFERENT
 * controllerId, or null when there is nothing to refuse. PURE.
 *
 * Closes `docs/MARSINLED_API.md` "Known integration gaps" item 1: every write in
 * this panel (the forced push and the DMX toggle) is preceded by this gate, so a
 * card whose IP now belongs to another board can never be written before the
 * post-write identity assert notices — the write would already have landed on
 * the wrong hardware.
 *
 * An UNBOUND card is not gated: pushing it is how it binds (addendum #3), and it
 * claims no identity to contradict.
 */
export function identityGateRefusal(controller, status) {
  const bound = controller && controller.device && controller.device.controllerId;
  if (!bound) return null;
  const live = status && status.controllerId;
  if (live === bound) return null;
  return `'${controller.name}' is bound to board '${bound}', but ${controller.ip} answers as ` +
    `'${live === undefined || live === null ? 'no controllerId' : live}' — REFUSED before any ` +
    'write. Nothing was sent to the device: re-bind this card to the board that actually ' +
    'answers, or fix the IP.';
}

// ── Push flow (per-output DMX is the ONLY supported push style) ──────────────

/**
 * The single-card ⬆ Push entry point. Reads the board ONCE (config + status),
 * applies the pre-write identity gate, then hands off to the per-output confirm
 * dialog. Exported for the unit tests — the gate must be provable to refuse
 * BEFORE any POST exists.
 */
export async function startPush(ctx, controller) {
  if (!isValidIp(controller.ip)) {
    ctx.showToast(`✋ ${controller.name}: set a valid device IP before pushing`, { error: true, ttl: 7000 });
    return;
  }
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

  noteDmxStateFromConfig(ctx, controller.id, snapshot); // seeds the ⏻ label — ZERO new reads

  // PRE-WRITE IDENTITY GATE (report `_363` §2.3-1) — after the reads, BEFORE the
  // dialog. A bound card whose IP now answers as a different board must never
  // reach a confirm dialog: the operator would be approving a write aimed at
  // hardware this card does not describe.
  const identityRefusal = identityGateRefusal(controller, status);
  if (identityRefusal) {
    ctx.showToast(`✋ ${identityRefusal}`, { error: true, ttl: 15000 });
    setSyncState(ctx, controller.id, { state: 'drift', detail: identityRefusal });
    ctx.refresh();
    return;
  }

  // NO MODE GATE (report `_362` §2.3-2). A push targets ANY reachable per-output
  // MarsinLED in ANY show mode — the narrowed push simply never mentions swarm
  // (ruling 6/7), so a swarm board is written without being switched.
  //
  // NOTHING IS MUTATED ON THIS PATH. The port-universe repair that used to run
  // here now rides on the plan and is committed only when the operator presses
  // FORCE (`commitPlanPortUniverses`) — cancelling the dialog must leave the
  // registry exactly as it was.

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
 * Structured drift between the device's saved strands and the FORCED plan, for
 * the sync-chip tooltip. Each change is `{path:'output N', from, to}`.
 *
 * The chip compares the FULL forced array — every output the push would enable,
 * every output it would DISABLE, and every count it would rewrite — with the
 * same claims and the same derive as the push, so the chip and the push can
 * never disagree (report `_362` §2.3-9). Consequence to expect: a board carrying
 * an enabled output no port maps reads ▲ Drift (`enabled · U27 → disabled`)
 * until one push darkens it. That is the pending change becoming visible.
 */
function perOutputChanges(reported, plan) {
  const byIndex = new Map();
  for (const entry of reported || []) byIndex.set(Number(entry.index), entry);
  const changes = [];
  for (const [indexStr, universe] of Object.entries(plan.universeByOutputIndex)) {
    const index = Number(indexStr);
    const got = byIndex.get(index);
    const matches = got && got.universe === universe && got.startAddress === 1
      && got.enabled === true;
    if (matches) continue;
    const from = !got || got.enabled !== true
      ? 'disabled'
      : `enabled · ${Number.isInteger(got.universe) ? `U${got.universe}` : 'unset'}`;
    changes.push({ path: `output ${index}`, from, to: `enabled · U${universe}` });
  }
  // Outputs the push will DARKEN — the half the old chip was blind to.
  for (const entry of plan.disables || []) {
    const got = byIndex.get(entry.outputIndex);
    changes.push({
      path: `output ${entry.outputIndex}`,
      from: `enabled · ${got && Number.isInteger(got.universe) ? `U${got.universe}` : 'unset'}`,
      to: 'disabled',
    });
  }
  // Counts the push will rewrite (forced, both directions).
  for (const entry of plan.countChanges || []) {
    changes.push({
      path: `output ${entry.outputIndex} count`,
      from: `${entry.from} px`,
      to: `${entry.to} px`,
    });
  }
  return changes;
}

/**
 * The COMPACT per-output receipt persisted with a push (`device.lastPush
 * .perOutput`). PURE.
 *
 * Built from the device's own post-reboot read-back — never from the plan — so
 * the receipt states what the BOARD confirmed, not what the sim intended. One
 * entry per output: `{index, enabled}` always, plus `universe` and `count` on
 * the enabled ones (a disabled output carries neither: the push deleted its
 * universe keys, D1). `startAddress` is dropped — it is 1 on every enabled
 * output by contract, and a receipt is not the place to restate a constant.
 *
 * WHY IT IS KEPT AT ALL (this slice, gap 5's companion): the push already
 * hashed the full body into `configHash`, which proves *that* a push happened
 * but says nothing a human or a later session can read. When a fleet push
 * leaves part of the rig written and the scene deliberately UNSAVED, this is
 * the record of which boards carry which universes and counts — the difference
 * between recovering a partial fleet and re-reading every board by hand.
 *
 * @param {Object} verifyConfig - post-reboot GET /api/config (the count source).
 * @param {Array} reported - `readConfiguredPerOutput(verifyConfig)`.
 */
function pushReceiptOutputs(verifyConfig, reported) {
  return reported.map((output) => {
    const entry = { index: output.index, enabled: output.enabled === true };
    if (!entry.enabled) return entry;
    if (Number.isInteger(output.universe)) entry.universe = output.universe;
    const strand = verifyConfig.strands[output.index];
    if (strand && Number.isInteger(strand.count)) entry.count = strand.count;
    return entry;
  });
}

// ── The retrying READ pair (the verify-race fix) ────────────────────────────
//
// LIVE EVIDENCE (2026-08-23, hit TWICE while the operator pushed 4 real boards):
// after a needs-reboot write, `awaitReboot` returns as soon as ONE /api/status
// probe answers — but the board finishes re-associating to WiFi AFTER that
// first reply and drops reads for a few seconds. The verify's getStatus +
// getConfig had ONE 8 s attempt each, so they timed out and the push (and the
// fleet's per-board verify, and the per-board snapshot reads a fleet run opens
// with) declared a FALSE FAIL over a write that had applied — proven by a later
// manual read-back.
//
// The fix is deliberately the smallest one that can be true: retry the READ
// PAIR, and only on a TIMEOUT. Nothing about the write changes — the body is
// never rebuilt, the POST is never repeated, and the one-snapshot rule stands.
// An ANSWERED failure (400/409/5xx) is still an immediate loud failure.
//
// Both reads are retried as ONE unit: they are a matched pair (the identity in
// the status and the config it describes), and re-reading both is cheaper to
// reason about than half-fresh evidence.

/**
 * `getStatus` + `getConfig` for one board as ONE retried unit.
 *
 * `io.readRetry` is an optional injected override of the client's
 * `{attempts, budgetMs, retryDelayMs}` — the unit tests set `retryDelayMs: 0`
 * so a retry case does not sleep. Production `DEFAULT_DEVICE_IO` carries no
 * `readRetry`, so it runs on the client's measured defaults.
 *
 * @returns {Promise<{status: Object, config: Object}>}
 */
async function readVerifyPair(io, ip, { label = 'read-back', onRetry } = {}) {
  return readRetrying(io, `${label} of ${ip}`, async () => {
    const status = await io.getStatus(ip);
    const config = await io.getConfig(ip);
    return { status, config };
  }, onRetry);
}

/**
 * One read (or read pair), retried on TIMEOUT only, with the panel's phase copy.
 * The single place `io.readRetry` is threaded into the client helper.
 */
function readRetrying(io, label, read, onRetry) {
  return readWithRetryOnTimeout(read, {
    ...(io.readRetry || {}),
    label,
    onRetry: ({ attempt, attempts, message }) => {
      // The operator must see WHY a read is taking longer than the reboot wait
      // implied — a silent retry would look identical to a hang.
      if (onRetry) {
        onRetry(`the board is not serving reads yet (${message}) — re-reading, attempt ` +
          `${attempt + 1} of ${attempts}…`);
      }
    },
  });
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

// The ONE paragraph both push dialogs lead with (report `_362` §2.5, rewritten to
// the NARROWED truth by `_363` §2.3-2 — binding copy). It states exactly what the
// push overwrites, what goes dark, what it deliberately LEAVES ALONE, and how
// long it is willing to wait. Singular for one board, pluralized for the fleet.
// Exported so the copy is asserted in ONE place (same rule as the sync-chip
// tooltip) and can never drift from what the push actually writes.
export const FORCE_PUSH_WARNING =
  '⚠ FORCE push — the sim panel is the source of truth for the mapping. This overwrites the ' +
  'board\'s strand counts, enables and per-output DMX universes: outputs P-mapped here are ' +
  'enabled with the mapped counts and universes, every other output is DISABLED, and DMX input ' +
  '(sACN) is switched ON. Strand type, color order, swarm and gamma settings are NOT touched. ' +
  `The device reboots (~11 s); the push waits up to ${REBOOT_WAIT_SECONDS} s and reads the ` +
  'config back before calling it done.';

export const FORCE_PUSH_ALL_WARNING =
  '⚠ FORCE push — the sim panel is the source of truth for the mapping. This overwrites each ' +
  'board\'s strand counts, enables and per-output DMX universes: outputs P-mapped here are ' +
  'enabled with the mapped counts and universes, every other output is DISABLED, and DMX input ' +
  '(sACN) is switched ON. Strand type, color order, swarm and gamma settings are NOT touched. ' +
  `Each device reboots (~11 s); the push waits up to ${REBOOT_WAIT_SECONDS} s per board and ` +
  'reads the config back before calling it done.';

/**
 * Shared FORCED push core (single-push + push-all use the SAME path). POST the
 * ONE body the confirm dialog previewed, wait out the reboot, then VERIFY the
 * FULL contract by re-reading config + status (`diffForcedConfig`), and record
 * push provenance through the undo pipeline. THROWS on any failure (fail loud): a
 * network/device error propagates verbatim; a verify mismatch throws an Error
 * carrying `.perOutputMismatch` so the caller can render the drift. Takes an
 * injectable `io` bag so tests mock the device. `onStatus(msg)` is an optional
 * progress sink — BOTH paths now pass one (push-all renders it on that
 * controller's own line, report `_362` §2.3-6).
 *
 * ONE READ PER ATTEMPT: the body was built from the SAME `getConfig` snapshot the
 * plan was derived from, and the transport does no GET of its own — the old
 * derive-from-A / apply-to-B window is closed. The PLAN is deliberately not a
 * parameter: everything this function writes or verifies comes from `body` (the
 * exact object the dialog previewed) or from the device's own read-back, so a
 * plan argument could only ever disagree with the body and never be believed.
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
 * @returns {Promise<{needsReboot, reply, reported, responseLost, writeError,
 *   swarmNote: (string|null)}>} `swarmNote` is the NON-failing informational
 *   line for a board that also reports SWARM enabled (`_363` §2.2).
 */
async function pushPerOutputVerifyRecord(ctx, controller, body, io, onStatus) {
  const report = onStatus || (() => {});
  const prePushControllerId = controller.device && controller.device.controllerId;
  report(`forcing the sim's config onto the board… (the device may take up to ` +
    `${WRITE_BUDGET_SECONDS}s to answer the write)`);
  let reply = null;
  let writeError = null;
  try {
    reply = await io.pushForcedConfig(controller.ip, body);
  } catch (err) {
    // `writeResponseLost` = the device gave us NO answer (timeout / dropped
    // socket). Anything else — a 400, any other HTTP status, a rejected plan, a
    // failed pre-write read — is a device that spoke, and stays a hard failure.
    if (!err.writeResponseLost) throw err;
    writeError = err;
  }
  // Any outcome other than applied / needs-reboot is a HARD failure quoting the
  // device verbatim — a MISSING outcome included, because a 2xx body the sim
  // cannot read is not agreement. There is no deferred path any more: a forced
  // push owns the board's show mode, so nothing can legitimately suppress it.
  if (reply && reply.outcome !== 'applied' && reply.outcome !== 'needs-reboot') {
    throw new Error(`the device refused the forced write — it answered ` +
      (reply.outcome === undefined ? 'a 2xx body with NO outcome field'
        : `outcome='${reply.outcome}'`) +
      (reply.suppressedBy ? ` (suppressedBy='${reply.suppressedBy}')` : '') +
      (reply.message ? `: ${reply.message}` : '') +
      '. The write is NOT retried; read the board\'s own web UI before pushing again.');
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

  report('reading the full saved config back…');
  // RETRIED READS (the verify-race fix). A board that just answered the reboot
  // probe can still drop reads while its WiFi re-associates; one 8 s attempt
  // per read turned that into a FALSE FAIL twice on the live rig. Timeouts are
  // retried, answered errors are not, and NOTHING is re-written.
  const { status: verifyStatus, config: verifyConfig } =
    await readVerifyPair(io, controller.ip, { label: 'post-write read-back', onRetry: report });
  setDeviceOutputs(ctx, controller.id, verifyConfig.strands); // feeds the output selector
  noteDmxStateFromConfig(ctx, controller.id, verifyConfig);   // seeds the ⏻ label — ZERO new reads
  // The NON-failing informational note (report `_363` §2.2): the push does not
  // touch swarm, so a board that also reports SWARM enabled is not a mismatch —
  // it is a fact the operator owns on the controller's own UI, and it rides on
  // the outcome line instead of the verdict array.
  const swarmNote = swarmEnabledNote(verifyConfig);
  const reported = readConfiguredPerOutput(verifyConfig);
  const mismatches = diffForcedConfig(verifyConfig, verifyStatus, body,
    prePushControllerId !== undefined ? { controllerId: prePushControllerId } : {});
  if (mismatches.length) {
    const lostNote = writeError
      ? 'the device did not answer the write AND the read-back shows a DIFFERENT config — ' : '';
    const err = new Error(`${lostNote}device config mismatch — ${mismatches.join('; ')}`);
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

  // One fingerprint, one card (docs/41 bind-by-controllerId). This push is about
  // to bind/promote THIS card onto the board it just wrote — refuse loudly if
  // another card is already verified against the same device, rather than
  // quietly creating two cards that will fight over one box on every push.
  if (!isVerifiedLedController(controller)) {
    const claimed = controllerBoundToDeviceId(ctx.registry(), verifyStatus.controllerId, controller);
    if (claimed) {
      throw new Error(`the device at ${controller.ip} identifies as ` +
        `'${verifyStatus.controllerId}', which is ALREADY bound to controller '${claimed.name}' — ` +
        `two cards cannot own one board. The write applied, but '${controller.name}' was NOT ` +
        'bound; re-check the IP on both cards.');
    }
  }

  // Provenance hashes the FULL body (report `_362` §2.4) — under the narrowed
  // contract that is strands + dmx + the deviceName repair, and nothing else
  // (`_363` §2.1: no swarm key is ever carried) — not just the universe map, so
  // a receipt can never claim a push that wrote something else.
  const configHash = await sha256Hex(JSON.stringify(body));
  const firmwareSHA = verifyStatus.firmwareSHA;
  ctx.mutate(`Forced config onto '${controller.name}'`, () => {
    // Pushing an UNBOUND card binds it: adopt the device identity from the
    // confirmed status so provenance + sync chips work from now on (addendum #3).
    // A PROVISIONAL card is the same story one grade up — the push IS first
    // contact, and it just read the fingerprint off the confirmed status, so the
    // binding is promoted here rather than left claiming it never met the board
    // (a provisional block may not carry a push receipt, by construction).
    if (!isVerifiedLedController(controller)) {
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
      perOutput: pushReceiptOutputs(verifyConfig, reported),
    });
  });
  setLiveMac(ctx, controller.id, verifyStatus.mac); // display-only — never persisted
  return { needsReboot, reply, reported, responseLost: !!writeError, writeError, swarmNote };
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

const PUSH_STEP_LABELS = {
  save: 'scene save',
  notify: 'bridge notify',
  confirm: 'bridge route read-back',
};

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
 * Persist the scene (patches.yaml + controllers.yaml + the engine model),
 * THEN notify the sACN bridge so it re-reads the routes, THEN read the
 * bridge's ACTIVE route table back and check it against what this push must
 * have produced (report 20260725_127). Each step is chained on the previous
 * one's resolution — never on a timer — because a bridge told to reload
 * before the save lands re-reads the STALE patches.yaml, and a route table
 * read before the notify measures the old world.
 *
 * Never throws. Returns `{ save, notify, confirm }`, each `{ok, reason?}`
 * (confirm additionally carries `detail` naming the confirmed routes, or
 * `skipped: true` when `routeExpectations` is the EXPLICIT empty list — a
 * push-all where nothing was pushed). `notify`/`confirm` stay null when an
 * earlier step failed. Omitting `routeExpectations` entirely is a confirm
 * FAILURE, not a skip — no caller gets an unmeasured ✓ by forgetting to state
 * what it expects.
 *
 * @param {Object} io - the injectable io bag
 *        (persistScene / notifyBridge / confirmBridgeRoutes).
 * @param {Array} routeExpectations - buildRouteExpectation results for every
 *        controller this push wrote; [] only when nothing was pushed.
 */
export async function persistAndNotifyAfterPush(io, routeExpectations) {
  const steps = { save: null, notify: null, confirm: null };
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
  if (!steps.notify.ok) return steps;
  try {
    if (!Array.isArray(routeExpectations)) {
      throw new Error('the push stated no route expectation — refusing to render an unmeasured ' +
        '✓ (pass [] only when nothing was pushed)');
    }
    if (routeExpectations.length === 0) {
      steps.confirm = { ok: true, skipped: true };
    } else {
      if (typeof io.confirmBridgeRoutes !== 'function') {
        throw new Error('the push io bag has no confirmBridgeRoutes() — the bridge route table ' +
          'cannot be read back');
      }
      const result = await io.confirmBridgeRoutes(routeExpectations);
      if (!result || typeof result.ok !== 'boolean') {
        throw new Error('the bridge route read-back returned no {ok} result — refusing to ' +
          'assume the routes landed');
      }
      if (result.ok && !(typeof result.detail === 'string' && result.detail.length > 0)) {
        throw new Error('the bridge route read-back reported ok without naming the confirmed ' +
          'routes — refusing an unnamed ✓');
      }
      steps.confirm = result.ok
        ? { ok: true, detail: result.detail }
        : { ok: false, reason: result.reason || 'no reason reported' };
    }
  } catch (err) {
    steps.confirm = { ok: false, reason: err.message };
  }
  return steps;
}

// ── The FLEET SAVE GATE (known gap 5) ───────────────────────────────────────

/**
 * PURE: may a fleet push save the scene? Only when NO board failed.
 *
 * THE DEFECT THIS CLOSES. `startPushAll` ran the completion (save → notify →
 * route read-back) unconditionally after the loop, so a fleet where one board
 * failed still wrote patches.yaml + the engine model for the WHOLE registry and
 * told the bridge to stream it. The hardware and the saved mapping then
 * disagreed on exactly the board that failed, and nothing on disk recorded
 * which one — the split the whole push campaign exists to prevent.
 *
 * SKIPPED boards do not block: a card with no valid IP was never attempted, so
 * it can neither agree nor disagree with the file. A FAILED board did have a
 * conversation with hardware that did not end where the sim thinks it did.
 *
 * There is deliberately NO "save anyway" override (codex P0 — fail loud, and
 * keep the recovery one obvious action): fix the board and push all again.
 *
 * @param {Array} results - `pushAllLedControllers`' return value.
 * @returns {{allowed: boolean, failed: Array, reason: (string|null)}}
 */
export function fleetSaveGate(results) {
  if (!Array.isArray(results)) {
    throw new Error('[LedPanel] fleetSaveGate: results must be pushAllLedControllers\' array');
  }
  const failed = results.filter((r) => r && r.state === 'failed');
  if (failed.length === 0) return { allowed: true, failed, reason: null };
  return {
    allowed: false,
    failed,
    reason: `✋ the scene was NOT saved and the sACN bridge was NOT notified — ` +
      `${failed.length} board(s) FAILED (${failed.map((f) => f.name).join(', ')}). The boards ` +
      'that DID take the push are written and cannot be rolled back, but saving now would put a ' +
      'mapping on disk that only PART of the fleet carries. Fix the failed board(s) from their ' +
      'reasons above and push all again — a clean run saves.',
  };
}

/**
 * The fleet push's completion, GATED (gap 5). Runs the save + notify + route
 * read-back ONLY when every attempted board passed; otherwise it runs nothing
 * and hands back the refusal sentence. Exported so the gate is provable without
 * a DOM — the dialog below only renders what this returns.
 *
 * @returns {Promise<{saved: boolean, steps: (Object|null), gate: Object}>}
 */
export async function completeFleetPush(io, results) {
  const gate = fleetSaveGate(results);
  if (!gate.allowed) return { saved: false, steps: null, gate };
  // The route read-back (_127) checks the UNION of every pushed controller's
  // expectation; a fleet where nothing pushed passes [] — an explicit
  // "nothing to confirm", never a silent skip.
  const expectations = results
    .filter((r) => r.state === 'pushed' && r.expectation)
    .map((r) => r.expectation);
  return { saved: true, steps: await persistAndNotifyAfterPush(io, expectations), gate };
}

/**
 * Render the per-step truth of a completed push. Pure — the dialog, the toast and
 * the tests all read the same sentence.
 *
 * Success: `✓ device written + verified · ✓ scene saved (patches projected) ·
 * ✓ bridge routes confirmed (U30,U31→10.1.1.60)`. The third check is a READ of
 * the bridge's active route table (report 20260725_127), never a trusted
 * notify: a `steps.confirm` that is missing or failed renders ✋ with the
 * missing/extra routes named. Any failure names the stale layer and states
 * that the device write stands.
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
  } else if (!steps.notify.ok) {
    parts.push(`✋ bridge NOT notified: ${steps.notify.reason}`);
    failedStep = PUSH_STEP_LABELS.notify;
  } else if (!steps.confirm) {
    // The notify landed but nothing measured the routes. Rendering the old
    // "routes follow" here would be exactly the unmeasured ✓ this check ended.
    parts.push('✋ bridge routes NOT confirmed: the route table was never read back');
    failedStep = PUSH_STEP_LABELS.confirm;
  } else if (steps.confirm.ok) {
    parts.push(steps.confirm.skipped
      ? '✓ bridge notified — nothing was pushed, no routes to confirm'
      : `✓ bridge routes confirmed (${steps.confirm.detail})`);
  } else {
    parts.push(`✋ bridge routes NOT confirmed: ${steps.confirm.reason}`);
    failedStep = PUSH_STEP_LABELS.confirm;
  }
  const text = parts.join(' · ');
  if (!failedStep) return { ok: true, failedStep: null, text };
  // A failed CONFIRM is a different claim from a failed save/notify: the file
  // and the notify landed, but the bridge's measured state does not show this
  // push — so say "not confirmed", not "not updated", and point at the bridge.
  const tail = failedStep === PUSH_STEP_LABELS.confirm
    ? `the sACN feed is NOT CONFIRMED: ${failedStep} — LEDs may not follow; check the sACN ` +
      'bridge log.'
    : `the sACN feed was NOT updated: ${failedStep} — LEDs will not follow until a successful ` +
      'save.';
  return { ok: false, failedStep, text: `${text} — ${deviceNote}; ${tail}` };
}

/**
 * BLOCKING refusal dialog for a per-output plan a merge cannot rescue. No
 * override path — the push never happens; the operator edits the card and pushes
 * again (codex P0: fail loud, never a silent re-map of operator-declared state).
 *
 * A SHARED universe is no longer one of these (operator order 2026-07-31) — it
 * warns and proceeds. What still lands here: two port rows on ONE physical
 * output, a port driving an output the board does not have, a card that would
 * leave every output dark, and an overlap the higher-IP rule cannot rank (same
 * IP / no usable IP).
 */
function showPerOutputCollisionRefusal(ctx, controller, collisions) {
  const overlay = el('div', 'vm-modal-overlay');
  const card = el('div', 'vm-modal-card led-push-card');
  overlay.appendChild(card);
  card.appendChild(el('div', 'vm-modal-title',
    `✋ Push refused — invalid per-output plan on '${controller.name}'`));
  card.appendChild(el('div', 'led-push-warn',
    'The device was NOT written. Each line below is a plan this card cannot push: two port rows ' +
    'driving ONE physical output, a port driving an output this board does not have, a card ' +
    'that maps nothing at all (a MarsinLED needs at least one enabled output), a port chaining ' +
    'a strand the sim cannot size next to one it can (the pushed count would be short and the ' +
    'rest of the rope would go dark), or two claims on the same channels that the higher-IP ' +
    'rule cannot rank. (Sharing an address with another controller is ALLOWED — that one is a ' +
    'warning, not this dialog.) Fix the card, then push again.'));
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
  // Pre-flight gate (slice S2, widened by report 20260725_70 §4 and again by
  // _102) — runs BEFORE the device write so a push can never mint a duplicate
  // port→output association, an out-of-range output, an all-dark card, or a
  // shared address with no deterministic winner. A RESOLVABLE shared address is
  // deliberately NOT here: it warns and proceeds.
  const blocking = [...plan.collisions, ...unrankableCollisionsFor(ctx, controller)];
  if (blocking.length) {
    setSyncState(ctx, controller.id, { state: 'drift', detail: describeCollisions(blocking) });
    showPerOutputCollisionRefusal(ctx, controller, blocking);
    ctx.refresh();
    return;
  }

  // Loud on the way past, even though it does not stop: the log line names the
  // winner so a "why is that strand the wrong colour" question is one grep away.
  if (plan.sharedUniverses.length) {
    console.warn(`[LedPanel] ${describeSharedUniverses(plan.sharedUniverses)}`);
  }

  // Build the ONE body this push will POST, from the SAME snapshot the plan was
  // derived from (report `_362` §2.3-3 — no second read, no drift window). The
  // builder validates the APPLIED array and decides the deviceName repair, so a
  // bad plan or an unusable card name is refused HERE, before the operator
  // confirms a write that cannot land.
  let body;
  try {
    body = buildForcedConfigBody({ snapshot, plan, ip: controller.ip });
  } catch (err) {
    ctx.showToast(`✋ forced push refused: ${err.message}`, { error: true, ttl: 20000 });
    setSyncState(ctx, controller.id, { state: 'drift', detail: err.message });
    ctx.refresh();
    return;
  }
  // Same decision the builder made, recomputed for the DIALOG's own declaration
  // of the name repair (it cannot throw here — the builder already ran it).
  const nameRepair = deviceNameRepairForPush({
    ip: controller.ip, storedName: snapshot.deviceName, controllerName: plan.controllerName,
  });
  showPerOutputPushConfirm(ctx, controller, plan, body, status, nameRepair);
}

/**
 * The FORCE-push confirm dialog. Exported for the unit tests: the warning copy
 * and the payload preview are operator-facing contract text (report `_363`
 * §2.3-2 / §5), and they are asserted on the rendered dialog rather than on a
 * paraphrase of it.
 */
export function showPerOutputPushConfirm(ctx, controller, plan, body, status, nameRepair) {
  const overlay = el('div', 'vm-modal-overlay');
  const card = el('div', 'vm-modal-card led-push-card');
  overlay.appendChild(card);
  card.appendChild(el('div', 'vm-modal-title',
    `FORCE push to '${controller.name}' (${controller.ip})`));

  card.appendChild(el('div', 'led-push-warn', FORCE_PUSH_WARNING));

  // SHARED ADDRESSES — declared before anything else on the dialog, because it
  // is the one thing on this plan that changes what OTHER hardware sees
  // (operator 2026-07-31: the warning must be visible where he maps things AND
  // in the push dialog). Never buried in the generic notes block below.
  if (plan.sharedUniverses && plan.sharedUniverses.length) {
    const shareBlock = el('div', 'led-push-warn led-shared-address led-shared-address-warn');
    shareBlock.appendChild(el('div', 'led-shared-address-head',
      `⚠ ${plan.sharedUniverses.length} SHARED ADDRESS${plan.sharedUniverses.length === 1 ? '' : 'ES'} ` +
      '— allowed, and pushed as declared. The sim composes ONE packet per (universe, destination); ' +
      'on any contested channel the numerically HIGHER controller IP overrides.'));
    for (const s of plan.sharedUniverses) {
      shareBlock.appendChild(el('div', 'led-shared-address-line', `• ${s.message}`));
    }
    card.appendChild(shareBlock);
  }

  // Declared UP FRONT (slice S1): the save is part of the push, not a surprise.
  card.appendChild(el('div', 'led-push-warn led-push-saves-scene',
    'Push writes the device AND saves the scene (mapping must land on disk for the sACN feed to ' +
    'follow). The whole scene is saved — the same save the 💾 buttons run — then the sACN bridge ' +
    'is told to reload its routes and its route table is READ BACK to confirm they exist.'));

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

  // (3) DISABLES — outputs lit on the board today that this push will DARKEN.
  // MANDATORY and loud (report `_362` §6): force semantics supersede the old
  // "the push never disables anything" protection, so a strand somebody wired
  // outside the sim WILL go dark, and the operator has to see it first.
  if (plan.disables.length) {
    const disableBlock = el('div', 'led-push-warn led-push-disables');
    disableBlock.appendChild(el('div', 'led-push-disables-head',
      `⚠ ${plan.disables.length} output(s) this push will DISABLE (no card port maps them):`));
    for (const d of plan.disables) {
      disableBlock.appendChild(el('div', 'led-push-disables-line',
        `output ${d.outputIndex + 1}: ENABLED on the device` +
        `${Number.isInteger(d.deviceCount) ? ` (${d.deviceCount} px` : ' ('}` +
        `${Number.isInteger(d.deviceUniverse) ? `, U${d.deviceUniverse}` : ''}) → will be ` +
        'DISABLED and go dark'));
    }
    card.appendChild(disableBlock);
  }

  // (4) COUNT CHANGES — the other superseded protection. The sim's mapping now
  // overwrites the board's pixel count in BOTH directions, so every rewrite is
  // named before the write, never discovered after it.
  if (plan.countChanges.length) {
    const countBlock = el('div', 'led-push-warn led-push-count-changes');
    countBlock.appendChild(el('div', 'led-push-count-changes-head',
      `⚠ ${plan.countChanges.length} output(s) whose PIXEL COUNT this push will rewrite:`));
    for (const c of plan.countChanges) {
      countBlock.appendChild(el('div', 'led-push-count-changes-line',
        `output ${c.outputIndex + 1}: device ${c.from} px → ${c.to} px (this card's mapping wins)`));
    }
    card.appendChild(countBlock);
  }

  // (4b) The deviceName repair — declared on its own, because it is the one key
  // outside strands/dmx this push may write, and it CHANGES THE DEVICE'S NAME
  // (and its mDNS/AP SSID). It only appears when the board's stored name is
  // invalid, i.e. when the board would otherwise reject the write outright.
  if (nameRepair) {
    const nameBlock = el('div', 'led-push-warn led-push-enables');
    nameBlock.appendChild(el('div', 'led-push-enables-head',
      `⚠ This push also sets the device's NAME to '${nameRepair.to}'`));
    nameBlock.appendChild(el('div', 'led-push-enables-line',
      `the board stores deviceName ${JSON.stringify(nameRepair.from)}, which its own firmware ` +
      'rejects — and it re-validates the whole config on every apply, so NO config write can ' +
      'land until the name is legal. The push writes this card\'s name verbatim (it is never ' +
      'sanitized); it also becomes the device\'s mDNS/AP name.'));
    card.appendChild(nameBlock);
  }

  // (5) Warnings — repaired universes, unknown strand counts, shared addresses.
  if (plan.warnings.length) {
    const warnBlock = el('div', 'led-push-warn led-push-unhonorable');
    warnBlock.appendChild(el('div', 'led-push-unhonorable-head',
      `⚠ ${plan.warnings.length} note(s) on this plan:`));
    for (const w of plan.warnings) warnBlock.appendChild(el('div', 'led-push-unhonorable-line', w));
    card.appendChild(warnBlock);
  }

  card.appendChild(el('div', 'led-push-subhead', 'Payload (POST /api/config)'));
  const pre = el('pre', 'led-push-pre');
  // This IS the object that gets posted — not a rendering of it (report `_362`
  // §2.6-3): `runPerOutputPush` hands the same `body` straight to the transport.
  pre.textContent = JSON.stringify(body, null, 2);
  card.appendChild(pre);

  const statusLine = el('div', 'led-push-status');
  card.appendChild(statusLine);

  const actions = el('div', 'vm-modal-actions');
  const cancelBtn = el('button', 'vm-modal-btn', 'Cancel');
  cancelBtn.onclick = () => overlay.remove();
  const confirmBtn = el('button', 'vm-modal-btn vm-modal-btn-primary', 'FORCE push');
  confirmBtn.onclick = () => runPerOutputPush(ctx, controller, plan, body, DEFAULT_DEVICE_IO, {
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
 * Run a confirmed FORCED push to completion: device write + full verify, then the
 * slice-S1 completion (save the scene, then notify the bridge). `body` is the
 * EXACT object the confirm dialog previewed. Exported for the unit tests — `ui`
 * only needs `{statusLine, confirmBtn, cancelBtn}` objects with `textContent` /
 * `className` / `disabled`, so the whole flow runs without a DOM.
 */
export async function runPerOutputPush(ctx, controller, plan, body, io, ui) {
  const { statusLine, confirmBtn, cancelBtn } = ui;
  confirmBtn.disabled = true;
  cancelBtn.disabled = true;
  const setStatus = (msg, cls) => {
    statusLine.textContent = msg;
    statusLine.className = 'led-push-status' + (cls ? ` ${cls}` : '');
  };

  // _127: state what this push must produce on the bridge BEFORE the device is
  // written — a plan whose route expectation cannot even be built must refuse
  // here, not discover it after an irreversible write.
  let routeExpectation;
  try {
    routeExpectation = buildRouteExpectation({
      plan,
      ip: controller.ip,
      stride: (controller.led && controller.led.stride) || 4,
    });
  } catch (err) {
    setStatus(`✋ push refused — cannot state the bridge route expectation: ${err.message}`,
      'led-push-error');
    cancelBtn.disabled = false;
    cancelBtn.textContent = 'Close';
    return;
  }

  // THE ACCEPT PATH. The operator pressed FORCE, so this is where the registry
  // may be mutated: commit the port-universe repairs the previewed plan implies
  // (the exact universes `body` carries). Cancelling the dialog never reaches
  // here, which is the whole point — a cancelled push leaves the card alone.
  commitPlanPortUniverses(ctx, controller, plan);

  let pushResult;
  try {
    pushResult = await pushPerOutputVerifyRecord(ctx, controller, body, io,
      (m) => setStatus(m));
  } catch (err) {
    setStatus(`✋ forced push failed: ${err.message}` +
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
  const steps = await persistAndNotifyAfterPush(io, [routeExpectation]);
  const outcome = describePushCompletion(steps, { lead: deviceStep });
  // The informational swarm note (`_363` §2.2) rides on the outcome line and
  // NEVER changes the verdict — the push did not touch swarm, so it cannot fail
  // on it; the operator is simply told the board runs both.
  const swarmNote = pushResult.swarmNote ? ` · ${pushResult.swarmNote}` : '';
  setStatus(`${outcome.text}${swarmNote}`, outcome.ok ? 'led-push-ok' : 'led-push-error');
  // The chip measures device ≡ plan, which IS true here — but say so honestly
  // when the feed behind it is stale.
  const failedReason = !outcome.ok
    ? (!steps.save.ok ? steps.save.reason
      : steps.notify && !steps.notify.ok ? steps.notify.reason
        : steps.confirm && !steps.confirm.ok ? steps.confirm.reason
          : 'the route table was never read back')
    : null;
  setSyncState(ctx, controller.id, outcome.ok
    ? { state: 'in-sync' }
    : { state: 'in-sync',
      detail: `device ≡ plan, but the sACN feed is STALE — ${outcome.failedStep} failed: ` +
        `${failedReason}` });
  cancelBtn.disabled = false;
  cancelBtn.textContent = outcome.ok ? 'Done' : 'Close';
  ctx.showToast(outcome.ok
    ? `✓ '${controller.name}': device confirmed, scene saved, bridge routes confirmed` +
      (pushResult.responseLost ? ' (the write reply was lost — the read-back confirmed it)' : '')
    : `✋ '${controller.name}': the device WAS written but the sACN feed was NOT updated ` +
      `(${outcome.failedStep} failed) — LEDs will not follow until a successful save`,
  { error: !outcome.ok, ttl: outcome.ok ? 7000 : 14000 });
  ctx.refresh();
}

// ── The DMX ⏻ toggle (report `_363` §3 — the anti-switch) ───────────────────
//
// ONE button, ONE write, ONE read-back. NO confirm dialog (operator: *"use the
// API to do that simply. No hassle, please simple process."*), no fleet toggle,
// no status sweep, no DMX⇄SWARM mode model, no swarm write, no save-server route
// (browser-direct like the push), no polling, no timer, no cache TTL, and
// nothing about the live flag is ever persisted into the scene.
//
// The label is a plain LAST-OBSERVATION display (dmxToggleModel): it says `?`
// until a read the panel already performs sets it, and it falls back to `?` the
// moment anything fails — the read-back is the only truth source.

/** The toggle's phase copy — the operator must be able to tell a reboot from a hang. */
const DMX_TOGGLE_PHASES = {
  reading: '⏻ reading…',
  writing: '⏻ writing…',
  rebooting: '⏻ rebooting…',
  verifying: '⏻ verifying…',
};

/**
 * Flip one board's DMX (sACN) input flag and CONFIRM it by reading the board
 * back. Exported for the unit tests — `button` only needs
 * `{textContent, disabled, title}` so the whole flow runs without a DOM.
 *
 * Sequence (identical discipline to the push, minus the dialog):
 *  pre-write identity gate → ONE `getStatus`+`getConfig` → `buildDmxToggleBody`
 *  → `pushDmxToggle` → on `needs-reboot`/a LOST reply `awaitReboot` → re-read →
 *  `diffDmxToggle` → label + toast.
 *
 * Every failure is a LOUD toast and the label falls to `?` (codex P0 — a label
 * that kept its old value after a failed write would be a fallback claiming
 * knowledge the sim does not have).
 *
 * @returns {Promise<boolean>} true only when the board CONFIRMED the new state.
 */
export async function toggleDmx(ctx, controller, targetEnabled, io = DEFAULT_DEVICE_IO,
  button = null) {
  if (typeof targetEnabled !== 'boolean') {
    throw new Error('[LedPanel] toggleDmx: targetEnabled must be a boolean — the toggle states ' +
      'the target state explicitly');
  }
  const want = targetEnabled ? 'ON' : 'OFF';
  if (!isValidIp(controller.ip)) {
    ctx.showToast(`✋ ${controller.name}: set a valid device IP before switching DMX`,
      { error: true, ttl: 7000 });
    return false;
  }
  const setPhase = (text) => { if (button) button.textContent = text; };
  if (button) button.disabled = true;
  try {
    setPhase(DMX_TOGGLE_PHASES.reading);
    const status = await io.getStatus(controller.ip);
    const identityRefusal = identityGateRefusal(controller, status);
    if (identityRefusal) throw new Error(identityRefusal);
    const snapshot = await io.getConfig(controller.ip);
    // The pre-write read is itself an observation — the label tells the truth
    // about the board even if the write below fails.
    noteDmxStateFromConfig(ctx, controller.id, snapshot);
    setDeviceOutputs(ctx, controller.id, snapshot.strands);
    const body = buildDmxToggleBody({
      snapshot, enabled: targetEnabled, controllerName: controller.name, ip: controller.ip,
    });

    setPhase(DMX_TOGGLE_PHASES.writing);
    let reply = null;
    let writeError = null;
    try {
      reply = await io.pushDmxToggle(controller.ip, body);
    } catch (err) {
      // Same arbitration as the push: NO answer at all is ambiguous (a `dmx`
      // change reboots the board, which can drop the reply) and is settled by the
      // read-back; a device that ANSWERED non-2xx is a definite failure (D2).
      if (!err.writeResponseLost) throw err;
      writeError = err;
    }
    if (reply && reply.outcome !== 'applied' && reply.outcome !== 'needs-reboot') {
      throw new Error('the device refused the DMX write — it answered ' +
        (reply.outcome === undefined ? 'a 2xx body with NO outcome field'
          : `outcome='${reply.outcome}'`) +
        (reply.message ? `: ${reply.message}` : '') + '. The write is NOT retried.');
    }
    const needsReboot = !!writeError || reply.reboot === true || reply.outcome === 'needs-reboot';
    if (needsReboot) {
      setPhase(DMX_TOGGLE_PHASES.rebooting);
      try {
        await io.awaitReboot(controller.ip);
      } catch (err) {
        if (!writeError) throw err;
        throw new Error(`${writeError.message}; and the device never answered again within ` +
          `${REBOOT_WAIT_SECONDS}s — the DMX write is UNCONFIRMED: it may or may not have ` +
          'applied. Power-cycle the controller and read the card again.');
      }
    }

    setPhase(DMX_TOGGLE_PHASES.verifying);
    // RETRIED READS — same verify-race fix as the config push: the board can
    // answer the reboot probe and still drop reads for a few seconds.
    const { status: verifyStatus, config: verifyConfig } =
      await readVerifyPair(io, controller.ip, { label: 'post-toggle read-back' });
    setLiveMac(ctx, controller.id, verifyStatus.mac);   // display-only — never persisted
    setDeviceOutputs(ctx, controller.id, verifyConfig.strands);
    const prePushControllerId = controller.device && controller.device.controllerId;
    const mismatches = diffDmxToggle(verifyConfig, verifyStatus, targetEnabled,
      prePushControllerId !== undefined ? { controllerId: prePushControllerId } : {});
    if (mismatches.length) {
      throw new Error(`the board did NOT confirm DMX ${want} — ${mismatches.join('; ')}`);
    }
    noteDmxState(ctx, controller.id, targetEnabled);
    ctx.showToast(`✓ '${controller.name}': DMX input is ${want} — confirmed by read-back` +
      (writeError ? ' (the write reply was lost to the reboot; the read-back settled it)' : ''),
    { ttl: 7000 });
    return true;
  } catch (err) {
    // The label must never keep a value the board has not confirmed.
    clearDmxState(ctx, controller.id);
    ctx.showToast(`✋ '${controller.name}': DMX ${want} FAILED — ${err.message}`,
      { error: true, ttl: 14000 });
    return false;
  } finally {
    if (button) {
      const model = dmxToggleModel(ctx, controller);
      button.textContent = model.label;
      button.title = model.title;
      button.className = model.className;
      button.disabled = false;
    }
    ctx.refresh();
  }
}

// ── The GAMMA push (report `_363` §11 — PUSH ONLY, re-enabled by operator order)
//
// The sim's per-card gamma sliders are the CURVE SOURCE: they hold the scene
// mirror (`led.wire.controllerGamma`) — the same values the preview models — and
// ⬆ Push gamma states that curve to the board. The board is then asked to
// CONFIRM it (read-back, float32 epsilon compare) and nothing else happens.
//
// NO PULL, in any form: there is no refresh, no mirror-from-device, no cache and
// no fleet source harvest. That includes the SUCCESS path — a verified push does
// NOT write the device's float32 read-back into the scene (2.2 would become
// 2.200000047683716 in controllers.yaml, and reading a value off a board to keep
// it is exactly the pull the operator retired). The mirror is the source; the
// device confirms it; provenance records the curve that was SENT.
//
// Gamma is LIVE-APPLY: the expected reply is `{outcome:'applied'}` with no
// reboot. A `needs-reboot` reply is still HONORED if a firmware ever sends one.

/** The gamma push's phase copy — same discipline as the ⏻ toggle's. */
const GAMMA_PUSH_PHASES = {
  reading: '⬆ reading…',
  writing: '⬆ writing…',
  rebooting: '⬆ rebooting…',
  verifying: '⬆ verifying…',
};

/**
 * Push ONE controller's curve to its board and CONFIRM it by reading the board
 * back. Exported for the unit tests — `button` only needs
 * `{textContent, disabled, title}` so the whole flow runs without a DOM.
 *
 * Sequence (the proven machinery, minus the reboot):
 *  pre-write identity gate → ONE `getStatus`+`getConfig` → `buildGammaPushBody`
 *  → `pushGammaPush` → (only if the device asks) `awaitReboot` → retried
 *  read-back → `diffGammaPush` → provenance + toast.
 *
 * Never throws — returns `{ok, detail}` so a fleet run can carry on and report
 * every board. A single-card caller renders the toast this already raised.
 */
export async function pushGammaToDevice(ctx, controller, gamma, io = DEFAULT_DEVICE_IO,
  button = null, onStatus = null) {
  const report = onStatus || (() => {});
  const setPhase = (text) => { if (button) button.textContent = text; };
  if (!isValidIp(controller.ip)) {
    const detail = `set a valid device IP before pushing gamma (got '${controller.ip}')`;
    ctx.showToast(`✋ ${controller.name}: ${detail}`, { error: true, ttl: 7000 });
    return { ok: false, detail };
  }
  const originalLabel = button ? button.textContent : null;
  if (button) button.disabled = true;
  try {
    setPhase(GAMMA_PUSH_PHASES.reading);
    report('reading the board…');
    const status = await readRetrying(io, `GET /api/status ${controller.ip}`,
      () => io.getStatus(controller.ip), report);
    // PRE-WRITE IDENTITY GATE (`_363` §2.3-1) — before the snapshot read, so no
    // body is ever built for hardware this card does not describe.
    const identityRefusal = identityGateRefusal(controller, status);
    if (identityRefusal) throw new Error(identityRefusal);
    const snapshot = await readRetrying(io, `GET /api/config ${controller.ip}`,
      () => io.getConfig(controller.ip), report);
    noteDmxStateFromConfig(ctx, controller.id, snapshot);   // free observation, zero new reads
    const body = buildGammaPushBody({
      snapshot, gamma, controllerName: controller.name, ip: controller.ip,
    });

    setPhase(GAMMA_PUSH_PHASES.writing);
    report(`writing gamma ${formatGamma(body.gamma)}…`);
    let reply = null;
    let writeError = null;
    try {
      reply = await io.pushGammaPush(controller.ip, body);
    } catch (err) {
      // Same arbitration as every other writer here: NO answer at all is
      // ambiguous and is settled by the read-back; an ANSWERED non-2xx is a
      // definite failure (D2).
      if (!err.writeResponseLost) throw err;
      writeError = err;
    }
    if (reply && reply.outcome !== 'applied' && reply.outcome !== 'needs-reboot') {
      throw new Error('the device refused the gamma write — it answered ' +
        (reply.outcome === undefined ? 'a 2xx body with NO outcome field'
          : `outcome='${reply.outcome}'`) +
        (reply.message ? `: ${reply.message}` : '') + '. The write is NOT retried.');
    }
    // Gamma is LIVE-APPLY, so this is normally FALSE and no reboot is waited
    // for. It is honored — not assumed away — because a firmware that says it
    // needs a reboot is telling us something we must believe.
    const needsReboot = !!writeError || (reply && (reply.reboot === true
      || reply.outcome === 'needs-reboot'));
    if (needsReboot) {
      setPhase(GAMMA_PUSH_PHASES.rebooting);
      report(writeError
        ? `the device did not answer the gamma write (${writeError.message}) — waiting up to ` +
          `${REBOOT_WAIT_SECONDS}s in case it rebooted, then reading it back…`
        : `the device asked for a reboot to apply gamma — waiting up to ${REBOOT_WAIT_SECONDS}s…`);
      try {
        await io.awaitReboot(controller.ip);
      } catch (err) {
        if (!writeError) throw err;
        throw new Error(`${writeError.message}; and the device never answered again within ` +
          `${REBOOT_WAIT_SECONDS}s — the gamma write is UNCONFIRMED: it may or may not have ` +
          'applied. Power-cycle the controller and push again.');
      }
    }

    setPhase(GAMMA_PUSH_PHASES.verifying);
    report('reading the curve back…');
    const { status: verifyStatus, config: verifyConfig } =
      await readVerifyPair(io, controller.ip, { label: 'post-gamma read-back', onRetry: report });
    setLiveMac(ctx, controller.id, verifyStatus.mac);   // display-only — never persisted
    const prePushControllerId = controller.device && controller.device.controllerId;
    const mismatches = diffGammaPush(verifyConfig, verifyStatus, body.gamma,
      prePushControllerId !== undefined ? { controllerId: prePushControllerId } : {});
    if (mismatches.length) {
      throw new Error(`the board did NOT confirm the curve — ${mismatches.join('; ')}`);
    }

    // G8 — the same liveness guard the config push carries: a card deleted (or a
    // scene switched) mid-flow must not receive provenance on a detached object.
    if (!controllerIsLive(ctx, controller)) {
      throw new Error(`'${controller.name}' was removed (or the scene changed) during the gamma ` +
        'push — the device WAS written, but the receipt is discarded');
    }
    ctx.mutate(`Pushed gamma to '${controller.name}'`, () => {
      // An UNBOUND card that answered is bound from the confirmed status, the
      // same rule the config push follows — `recordDeviceGammaPush` refuses an
      // unbound or provisional card outright.
      if (!isVerifiedLedController(controller)) {
        bindControllerDevice(controller, {
          vendor: LED_DEVICE_VENDOR_MARSINLED,
          controllerId: verifyStatus.controllerId,
          deviceName: verifyStatus.deviceName,
          boardId: verifyStatus.boardId,
        });
      }
      recordDeviceGammaPush(controller, {
        at: new Date().toISOString(),
        outcome: needsReboot ? 'needs-reboot' : ((reply && reply.outcome) || 'applied'),
        // The curve that was SENT and the board confirmed within epsilon — NOT
        // the float32 read-back (recording that would be a pull).
        gamma: body.gamma,
        firmwareSHA: verifyStatus.firmwareSHA,
      });
    });
    ctx.showToast(`✓ '${controller.name}': gamma ${formatGamma(body.gamma)} confirmed by ` +
      `read-back${writeError ? ' (the write reply was lost; the read-back settled it)' : ''}`,
    { ttl: 7000 });
    return { ok: true, gamma: body.gamma, responseLost: !!writeError };
  } catch (err) {
    ctx.showToast(`✋ '${controller.name}': gamma push FAILED — ${err.message}`,
      { error: true, ttl: 14000 });
    return { ok: false, detail: err.message };
  } finally {
    if (button) {
      button.textContent = originalLabel;
      button.disabled = false;
    }
    ctx.refresh();
  }
}

/**
 * Fleet gamma: every LED controller with a valid IP, SEQUENTIALLY, each pushing
 * ITS OWN card's curve (the scene mirror the card's sliders show). There is NO
 * shared "fleet curve" and no source selection — that was the last place a curve
 * was harvested from somewhere else, and it stays deleted (`_364` §2).
 *
 * NO SCENE SAVE: gamma is not part of the mapping, so unlike ⬆ Push all this
 * writes no files and notifies no bridge. One board's failure never aborts the
 * rest; every board gets its own row.
 *
 * @returns {Promise<Array<{name, id, ip, state, detail?}>>} state ∈
 *   'pushed' | 'skipped' | 'failed'.
 */
export async function pushGammaAllControllers(ctx, io = DEFAULT_DEVICE_IO, onProgress = null) {
  const registry = ctx.registry();
  const controllers = (registry && Array.isArray(registry.controllers))
    ? registry.controllers.filter(isLedController) : [];
  const results = [];
  for (const controller of controllers) {
    const base = { name: controller.name, id: controller.id, ip: controller.ip };
    const phase = (text) => {
      if (onProgress) onProgress({ id: controller.id, name: controller.name, phase: text });
    };
    if (!isValidIp(controller.ip)) {
      results.push({ ...base, state: 'skipped', detail: `no valid device IP ('${controller.ip}')` });
      phase(`SKIPPED — no valid device IP ('${controller.ip}')`);
      continue;
    }
    let gamma;
    try {
      gamma = readGammaMirror(controller);   // SCENE read — no I/O, no device pull
    } catch (err) {
      results.push({ ...base, state: 'failed', detail: err.message });
      phase(`FAILED — ${err.message}`);
      continue;
    }
    const outcome = await pushGammaToDevice(ctx, controller, gamma, io, null, phase);
    if (outcome.ok) {
      results.push({ ...base, state: 'pushed', detail: `gamma ${formatGamma(gamma)}` });
      phase(`PUSHED — gamma ${formatGamma(gamma)} confirmed`);
    } else {
      results.push({ ...base, state: 'failed', detail: outcome.detail });
      phase(`FAILED — ${outcome.detail}`);
    }
  }
  ctx.refresh();
  return results;
}

// ── Fleet DMX OFF (operator-ordered exception to `_363` §3's no-fleet rule) ──
//
// `_363` §3 says "NOT built: no fleet toggle". The operator overrode that after
// the config push was live-validated: *"like the push all button, but DMX off —
// no swarm, boards run their pattern"*. This is the ONE fleet toggle, and it is
// deliberately one-directional: OFF. DMX comes back through ⬆ Push / ⬆ Push all
// / the per-card ⏻ toggle, all of which already force or state DMX ON.
//
// It writes exactly what the per-card toggle writes — the board's own `dmx`
// object with `enabled:false` — so: no swarm key, no strands, no gamma, and
// NOTHING is persisted into the scene (the live mode is runtime state, `_363`
// §3). Boards fall back to their own local pattern, which is the point.

/**
 * Switch DMX (sACN) input OFF on every LED controller with a valid IP,
 * SEQUENTIALLY (each write reboots its board, so they must serialize).
 *
 * Per board: identity gate → ONE `getStatus`+`getConfig` → `buildDmxToggleBody`
 * → `pushDmxToggle` → `awaitReboot` → RETRIED read-back → `diffDmxToggle(false)`.
 * A failure is recorded and the loop CONTINUES (fail loud per board). No
 * retries of the write, ever. The ⏻ labels are seeded from the results.
 *
 * @returns {Promise<Array<{name, id, ip, state, detail?}>>} state ∈
 *   'off' | 'skipped' | 'failed'.
 */
export async function dmxOffAllControllers(ctx, io = DEFAULT_DEVICE_IO, onProgress = null) {
  const registry = ctx.registry();
  const controllers = (registry && Array.isArray(registry.controllers))
    ? registry.controllers.filter(isLedController) : [];
  const results = [];
  for (const controller of controllers) {
    const base = { name: controller.name, id: controller.id, ip: controller.ip };
    const phase = (text) => {
      if (onProgress) onProgress({ id: controller.id, name: controller.name, phase: text });
    };
    if (!isValidIp(controller.ip)) {
      results.push({ ...base, state: 'skipped', detail: `no valid device IP ('${controller.ip}')` });
      phase(`SKIPPED — no valid device IP ('${controller.ip}')`);
      continue;
    }
    try {
      phase('reading the board…');
      const status = await readRetrying(io, `GET /api/status ${controller.ip}`,
        () => io.getStatus(controller.ip), phase);
      const identityRefusal = identityGateRefusal(controller, status);
      if (identityRefusal) {
        clearDmxState(ctx, controller.id);
        setSyncState(ctx, controller.id, { state: 'drift', detail: identityRefusal });
        results.push({ ...base, state: 'failed', detail: identityRefusal });
        phase(`FAILED — ${identityRefusal}`);
        continue;
      }
      const snapshot = await readRetrying(io, `GET /api/config ${controller.ip}`,
        () => io.getConfig(controller.ip), phase);
      noteDmxStateFromConfig(ctx, controller.id, snapshot);
      setDeviceOutputs(ctx, controller.id, snapshot.strands);
      const body = buildDmxToggleBody({
        snapshot, enabled: false, controllerName: controller.name, ip: controller.ip,
      });

      phase('writing DMX OFF…');
      let reply = null;
      let writeError = null;
      try {
        reply = await io.pushDmxToggle(controller.ip, body);
      } catch (err) {
        if (!err.writeResponseLost) throw err;
        writeError = err;
      }
      if (reply && reply.outcome !== 'applied' && reply.outcome !== 'needs-reboot') {
        throw new Error('the device refused the DMX write — it answered ' +
          (reply.outcome === undefined ? 'a 2xx body with NO outcome field'
            : `outcome='${reply.outcome}'`) +
          (reply.message ? `: ${reply.message}` : '') + '. The write is NOT retried.');
      }
      const needsReboot = !!writeError || reply.reboot === true || reply.outcome === 'needs-reboot';
      if (needsReboot) {
        phase(`rebooting — waiting up to ${REBOOT_WAIT_SECONDS}s…`);
        try {
          await io.awaitReboot(controller.ip);
        } catch (err) {
          if (!writeError) throw err;
          throw new Error(`${writeError.message}; and the device never answered again within ` +
            `${REBOOT_WAIT_SECONDS}s — the DMX write is UNCONFIRMED: it may or may not have ` +
            'applied. Power-cycle the controller and read the card again.');
        }
      }

      phase('verifying…');
      const { status: verifyStatus, config: verifyConfig } =
        await readVerifyPair(io, controller.ip, { label: 'post-toggle read-back', onRetry: phase });
      setLiveMac(ctx, controller.id, verifyStatus.mac);
      const prePushControllerId = controller.device && controller.device.controllerId;
      const mismatches = diffDmxToggle(verifyConfig, verifyStatus, false,
        prePushControllerId !== undefined ? { controllerId: prePushControllerId } : {});
      if (mismatches.length) {
        throw new Error(`the board did NOT confirm DMX OFF — ${mismatches.join('; ')}`);
      }
      noteDmxState(ctx, controller.id, false);          // seeds this card's ⏻ label
      const lostNote = writeError
        ? 'the write reply was lost (device rebooted before answering) — the read-back confirms it'
        : null;
      const row = { ...base, state: 'off' };
      if (lostNote) { row.detail = lostNote; row.responseLost = true; }
      results.push(row);
      phase('DMX OFF — confirmed by read-back');
    } catch (err) {
      // The label must never keep a value the board has not confirmed.
      clearDmxState(ctx, controller.id);
      results.push({ ...base, state: 'failed', detail: err.message });
      phase(`FAILED — ${err.message}`);
    }
  }
  ctx.refresh();
  return results;
}

// ── Push-all (every LED controller with a valid IP, sequential; FORCE) ───────

/**
 * Push every LED controller in the registry that carries a syntactically valid
 * IP, SEQUENTIALLY (a forced write reboots the board, so writes must serialize).
 * Each controller runs the SAME forced path as the single push — derive the plan
 * from the CURRENT port state, build the ONE body, push, awaitReboot, verify the
 * FULL config read-back — with NO in-sync short-circuit (sync state never gates a
 * push). An UNBOUND card that answers is bound on success (addendum #3). Firmware
 * without per-output DMX gets the loud firmware-too-old refusal, counted as a
 * failure (no legacy fallback, codex P0). A failure on one is reported but does
 * NOT abort the rest (fail loud per controller). A controller with no valid IP is
 * SKIPPED with a note. NO RETRIES, ever — the operator re-pushes after reading
 * the reason (report `_362` §2.3-8).
 *
 * `onProgress({id, name, phase})` fires for every phase change on every board, so
 * the dialog can render ONE LIVE LINE PER CONTROLLER (report `_362` §2.3-6). A
 * fleet push is up to ~65 s per board; without it a rebooting controller is
 * indistinguishable from a hang.
 *
 * DEVICE LAYER ONLY. The slice-S1 completion (save the scene, then notify the
 * bridge) runs ONCE for the whole sequence in the caller — `startPushAll` —
 * because a save per controller would rewrite the same files N times and, on a
 * long fleet, notify the bridge against a half-updated registry.
 *
 * @param {Object} ctx - the editor bridge (registry/mutate/strandLedCounts/…).
 * @param {Object} [io] - injectable device I/O (defaults to the real client).
 * @param {Function} [onProgress] - `({id, name, phase}) => void`.
 * @returns {Promise<Array<{name, id, ip, state, detail?, responseLost?}>>} state ∈
 *   'pushed' | 'skipped' | 'failed'.
 */
export async function pushAllLedControllers(ctx, io = DEFAULT_DEVICE_IO, onProgress = null) {
  const registry = ctx.registry();
  const controllers = (registry && Array.isArray(registry.controllers))
    ? registry.controllers.filter(isLedController) : [];
  const results = [];
  for (const controller of controllers) {
    const base = { name: controller.name, id: controller.id, ip: controller.ip };
    const phase = (text) => {
      if (onProgress) onProgress({ id: controller.id, name: controller.name, phase: text });
    };
    if (!isValidIp(controller.ip)) {
      results.push({ ...base, state: 'skipped', detail: `no valid device IP ('${controller.ip}')` });
      phase(`SKIPPED — no valid device IP ('${controller.ip}')`);
      continue;
    }
    try {
      phase('reading the board…');
      // RETRIED on timeout (the verify-race fix): a fleet run reaches this board
      // seconds after the PREVIOUS board rebooted, and a board that is still
      // settling its WiFi drops reads — which used to fail this board before it
      // was ever written. Answered errors are still immediate failures.
      const status = await readRetrying(io, `GET /api/status ${controller.ip}`,
        () => io.getStatus(controller.ip), phase);
      // PRE-WRITE IDENTITY GATE (report `_363` §2.3-1), per controller: a bound
      // card whose IP answers as a different board FAILS here — before any body
      // exists — and the loop moves on to the next board.
      const identityRefusal = identityGateRefusal(controller, status);
      if (identityRefusal) {
        setSyncState(ctx, controller.id, { state: 'drift', detail: identityRefusal });
        results.push({ ...base, state: 'failed', detail: identityRefusal });
        phase(`FAILED — ${identityRefusal}`);
        continue;
      }
      // Per-output DMX is the only push style — refuse stale firmware loudly.
      if (!deviceSupportsPerOutput(status)) {
        const detail = 'firmware too old — update MarsinLED to a per-output build';
        setSyncState(ctx, controller.id, { state: 'drift', detail });
        results.push({ ...base, state: 'failed', detail });
        phase(`FAILED — ${detail}`);
        continue;
      }
      // ONE read per controller per attempt: this snapshot derives the plan AND
      // builds the body (report `_362` §2.3-3). There is no mode gate — a forced
      // push targets a board in ANY show mode, by design.
      const snapshot = await readRetrying(io, `GET /api/config ${controller.ip}`,
        () => io.getConfig(controller.ip), phase);
      setDeviceOutputs(ctx, controller.id, snapshot.strands);
      noteDmxStateFromConfig(ctx, controller.id, snapshot); // seeds the ⏻ label
      const plan = derivePerOutputPlan(controller, ctx.strandLedCounts(), snapshot,
        claimedUniversesFor(ctx, controller));
      // Registry-aware gate (slice S2, widened by 20260725_70 §4 and _102) — a
      // plan that drives one output from two ports, addresses an output the board
      // does not have, would leave the board all-dark, or carries a shared
      // address with no deterministic winner is REFUSED before the device write,
      // per controller. A RESOLVABLE shared address pushes, loudly.
      const blocking = [...plan.collisions, ...unrankableCollisionsFor(ctx, controller)];
      if (blocking.length) {
        const detail = describeCollisions(blocking);
        setSyncState(ctx, controller.id, { state: 'drift', detail });
        results.push({ ...base, state: 'failed', detail });
        phase(`FAILED — ${detail}`);
        continue;
      }
      const body = buildForcedConfigBody({ snapshot, plan, ip: controller.ip });
      const shareNote = plan.sharedUniverses.length
        ? describeSharedUniverses(plan.sharedUniverses) : null;
      if (shareNote) console.warn(`[LedPanel] '${controller.name}': ${shareNote}`);
      // _127: the route expectation is stated BEFORE the write (same rule as
      // the single push) and rides on the result, so startPushAll's ONE
      // completion can read the bridge's route table back for the whole fleet.
      const expectation = buildRouteExpectation({
        plan,
        ip: controller.ip,
        stride: (controller.led && controller.led.stride) || 4,
      });
      // The fleet's ONE confirm was accepted before this loop started, so this
      // IS the accept path: commit the port-universe repairs the plan implies
      // (the same universes `body` carries) before the write, and before the
      // NEXT board's claim index is built — otherwise board 2 could be handed a
      // universe board 1 is about to be written with.
      commitPlanPortUniverses(ctx, controller, plan);
      // FORCE: always push + verify, even when the device already
      // matches. Same three phase budgets and the same "a lost write reply is
      // settled by the read-back, not by a timeout" rule as the single push.
      const pushResult = await pushPerOutputVerifyRecord(ctx, controller, body, io,
        (m) => phase(m));
      setSyncState(ctx, controller.id,
        shareNote ? { state: 'in-sync', detail: shareNote } : { state: 'in-sync' });
      const lostNote = pushResult.responseLost
        ? 'the write reply was lost (device rebooted before answering) — the read-back ' +
          'confirms the mapping applied'
        : null;
      // The informational swarm note (`_363` §2.2) rides on this board's row —
      // non-failing, exactly like the shared-address warning beside it.
      const detail = [lostNote, shareNote, pushResult.swarmNote].filter(Boolean).join(' · ');
      const row = { ...base, state: 'pushed', expectation };
      if (detail) row.detail = detail;
      if (pushResult.responseLost) row.responseLost = true;
      results.push(row);
      phase('PUSHED — device written + verified');
    } catch (err) {
      // Fail loud PER controller — record the state, keep going. NO retry.
      setSyncState(ctx, controller.id, err.perOutputMismatch
        ? { state: 'drift', detail: err.message }
        : { state: 'unreachable', detail: err.message });
      results.push({ ...base, state: 'failed', detail: err.message });
      phase(`FAILED — ${err.message}`);
    }
  }
  ctx.refresh();
  return results;
}

const PUSH_ALL_STATE_LABELS = { pushed: 'PUSHED', failed: 'FAILED', skipped: 'SKIPPED' };
const GAMMA_ALL_STATE_LABELS = { pushed: 'GAMMA SET', failed: 'FAILED', skipped: 'SKIPPED' };
const DMX_OFF_ALL_STATE_LABELS = { off: 'DMX OFF', failed: 'FAILED', skipped: 'SKIPPED' };

/**
 * PURE: turn any fleet run's results into the rows its dialog renders. Shared by
 * ⬆ Push all, ⬆ Push gamma to all and ⏻ DMX all: off so three fleet tables can
 * never drift into three different honesty standards.
 *
 * THROWS on a state it does not recognize — a row it cannot classify must not
 * quietly render as anything.
 */
export function fleetRowsModel(results, labels) {
  if (!Array.isArray(results)) {
    throw new Error('[LedPanel] fleetRowsModel: results must be an array');
  }
  return results.map((r) => {
    const state = labels[r && r.state];
    if (!state) {
      throw new Error(`[LedPanel] fleetRowsModel: unknown result state '${r && r.state}' ` +
        `for '${r && r.name}'`);
    }
    const row = { name: r.name, ip: r.ip || null, state };
    if (r.detail) row.reason = r.detail;
    if (r.responseLost) row.responseLost = true;
    return row;
  });
}

/** PURE: the fleet gamma table's rows. */
export function gammaPushAllResultsModel(results) {
  return fleetRowsModel(results, GAMMA_ALL_STATE_LABELS);
}

/** PURE: the fleet DMX-off table's rows. */
export function dmxOffAllResultsModel(results) {
  return fleetRowsModel(results, DMX_OFF_ALL_STATE_LABELS);
}

/**
 * PURE: turn `pushAllLedControllers`' results into the rows the dialog's
 * per-controller table renders (report `_362` §2.3-7). A fleet push used to
 * compress every failure into ONE summary sentence, which is unreadable the
 * moment two boards fail for different reasons.
 *
 * THROWS on a state it does not recognize — a row it cannot classify must not
 * quietly render as anything.
 *
 * @param {Array} results - pushAllLedControllers' return value.
 * @returns {Array<{name:string, ip:(string|null), state:string, reason?:string,
 *   responseLost?:boolean}>}
 */
export function pushAllResultsModel(results) {
  if (!Array.isArray(results)) {
    throw new Error('[LedPanel] pushAllResultsModel: results must be an array');
  }
  return results.map((r) => {
    const state = PUSH_ALL_STATE_LABELS[r && r.state];
    if (!state) {
      throw new Error(`[LedPanel] pushAllResultsModel: unknown result state '${r && r.state}' ` +
        `for '${r && r.name}'`);
    }
    const row = { name: r.name, ip: r.ip || null, state };
    if (r.detail) row.reason = r.detail;
    if (r.responseLost) row.responseLost = true;
    return row;
  });
}

/**
 * Operator entry point for "Push all MarsinLED controllers" (the MarsinLED group
 * header button). One up-front confirm summarizing the count + the FORCE warning;
 * then runs pushAllLedControllers with a LIVE per-controller progress line, and
 * reports a per-controller results table plus the summary sentence.
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
  card.appendChild(el('div', 'vm-modal-title',
    `FORCE push all MarsinLED controllers (${pushable.length})`));
  card.appendChild(el('div', 'led-push-warn',
    `${FORCE_PUSH_ALL_WARNING} The ${pushable.length} controller(s) are written SEQUENTIALLY ` +
    '(reboots must serialize), even the ones already in sync; one failure never aborts the rest, ' +
    'and nothing is ever retried automatically.'));
  card.appendChild(el('div', 'led-push-warn led-push-saves-scene',
    'Push writes the device AND saves the scene (mapping must land on disk for the sACN feed to ' +
    'follow). One scene save + bridge notify + route read-back runs once, after the last ' +
    'controller — and ONLY if every board passed. If any board fails, the scene is NOT saved ' +
    'and the bridge is NOT notified: the boards that took the push stay written, and you fix ' +
    'the failures and push all again.'));
  // ONE LIVE LINE PER CONTROLLER (report `_362` §2.3-6): `name · phase` while it
  // runs, then its final verdict. A fleet push is up to ~65 s per board — a
  // single shared status line cannot tell "rebooting" from "hung".
  const list = el('div', 'led-push-diff');
  const lineByControllerId = new Map();
  for (const c of ledControllers) {
    const line = el('div', 'led-push-diff-line');
    line.textContent = isValidIp(c.ip)
      ? `• ${c.name} (${c.ip}) — waiting`
      : `• ${c.name} — SKIPPED (no valid IP)`;
    lineByControllerId.set(c.id, line);
    list.appendChild(line);
  }
  card.appendChild(list);
  const resultsBox = el('div', 'led-push-diff led-push-results');
  card.appendChild(resultsBox);
  const statusLine = el('div', 'led-push-status');
  card.appendChild(statusLine);

  const actions = el('div', 'vm-modal-actions');
  const cancelBtn = el('button', 'vm-modal-btn', 'Cancel');
  cancelBtn.onclick = () => overlay.remove();
  const confirmBtn = el('button', 'vm-modal-btn vm-modal-btn-primary', 'Push all mappings');
  confirmBtn.disabled = pushable.length === 0;
  confirmBtn.onclick = async () => {
    confirmBtn.disabled = true;
    cancelBtn.disabled = true;
    statusLine.textContent = `pushing ${pushable.length} controller(s) sequentially…`;
    statusLine.className = 'led-push-status';
    const results = await pushAllLedControllers(ctx, DEFAULT_DEVICE_IO, ({ id, name, phase }) => {
      const line = lineByControllerId.get(id);
      if (line) line.textContent = `• ${name} · ${phase}`;
    });
    // The per-controller verdict table — every board named with its own outcome,
    // failures kept red and never compressed into the summary sentence.
    for (const row of pushAllResultsModel(results)) {
      const line = el('div', 'led-push-diff-line' +
        (row.state === 'FAILED' ? ' led-push-result-failed' : ''));
      line.textContent = `${row.state}  ·  ${row.name}${row.ip ? ` (${row.ip})` : ''}` +
        `${row.responseLost ? '  ·  write reply LOST, confirmed by read-back' : ''}` +
        `${row.reason ? `  ·  ${row.reason}` : ''}`;
      resultsBox.appendChild(line);
    }
    const pushed = results.filter((r) => r.state === 'pushed').length;
    const skipped = results.filter((r) => r.state === 'skipped').length;
    const failed = results.filter((r) => r.state === 'failed');
    const lostReply = results.filter((r) => r.responseLost);
    const summary =
      `done — ${pushed} pushed · ${skipped} skipped · ${failed.length} failed` +
      (lostReply.length
        ? ` (${lostReply.length} write reply(ies) lost to the reboot, confirmed by read-back: ` +
          `${lostReply.map((r) => r.name).join(', ')})` : '') +
      (failed.length ? `: ${failed.map((f) => `${f.name} (${f.detail})`).join('; ')}` : '');
    // ONE completion for the whole sequence (slice S1), GATED on a clean fleet
    // (gap 5): the per-controller failures are already reported above, and a
    // fleet that failed anywhere does NOT get its mapping written to disk —
    // that would leave the file describing a rig the hardware only half
    // carries. `completeFleetPush` owns that decision.
    statusLine.textContent = `${summary} · saving the scene (mapping → patches.yaml)…`;
    const completion = await completeFleetPush(DEFAULT_DEVICE_IO, results);
    if (!completion.saved) {
      // LOUD, and in the results box next to the failures it names — not just
      // in the status line, which the operator may have scrolled past.
      const refusal = el('div', 'led-push-diff-line led-push-result-failed',
        completion.gate.reason);
      resultsBox.appendChild(refusal);
      statusLine.className = 'led-push-status led-push-error';
      statusLine.textContent = `${summary} · ${completion.gate.reason}`;
      cancelBtn.disabled = false;
      cancelBtn.textContent = 'Close';
      ctx.showToast(`Push all: ${pushed} pushed, ${failed.length} failed · ✋ the scene was NOT ` +
        'saved and the bridge was NOT notified — fix the failed board(s) and push all again',
      { error: true, ttl: 16000 });
      return;
    }
    const steps = completion.steps;
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
      ? `Push all: ${pushed} pushed, ${failed.length} failed · scene saved, bridge routes confirmed`
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

// ── Fleet dialogs for the two device-only fleet runs (gamma, DMX off) ───────
//
// ⬆ Push all owns a bespoke dialog because it ALSO saves the scene and confirms
// bridge routes. These two touch the DEVICE only — no files, no bridge — so they
// share one small runner: confirm → one live line per board → a per-board
// verdict table → an honest summary. Nothing here compresses a failure into a
// count: every failed board keeps its own red row with its own reason.

/**
 * Open a fleet dialog for a device-only fleet run.
 *
 * @param {Object} ctx
 * @param {{title:string, warnings:string[], confirmLabel:string,
 *          controllers:Array, run:Function, rows:Function,
 *          summary:Function}} spec
 *   `run(onProgress)` performs the fleet run; `rows(results)` is the PURE row
 *   model; `summary(results)` returns `{text, ok, toast}`.
 */
function openDeviceFleetDialog(ctx, spec) {
  const { title, warnings, confirmLabel, controllers, run, rows, summary } = spec;
  const runnable = controllers.filter((c) => isValidIp(c.ip));
  const overlay = el('div', 'vm-modal-overlay');
  const card = el('div', 'vm-modal-card led-push-card');
  overlay.appendChild(card);
  card.appendChild(el('div', 'vm-modal-title', title));
  for (const warning of warnings) card.appendChild(el('div', 'led-push-warn', warning));

  const list = el('div', 'led-push-diff');
  const lineByControllerId = new Map();
  for (const c of controllers) {
    const line = el('div', 'led-push-diff-line');
    line.textContent = isValidIp(c.ip)
      ? `• ${c.name} (${c.ip}) — waiting`
      : `• ${c.name} — SKIPPED (no valid IP)`;
    lineByControllerId.set(c.id, line);
    list.appendChild(line);
  }
  card.appendChild(list);
  const resultsBox = el('div', 'led-push-diff led-push-results');
  card.appendChild(resultsBox);
  const statusLine = el('div', 'led-push-status');
  card.appendChild(statusLine);

  const actions = el('div', 'vm-modal-actions');
  const cancelBtn = el('button', 'vm-modal-btn', 'Cancel');
  cancelBtn.onclick = () => overlay.remove();
  const confirmBtn = el('button', 'vm-modal-btn vm-modal-btn-primary', confirmLabel);
  confirmBtn.disabled = runnable.length === 0;
  confirmBtn.onclick = async () => {
    confirmBtn.disabled = true;
    cancelBtn.disabled = true;
    statusLine.className = 'led-push-status';
    statusLine.textContent = `running on ${runnable.length} controller(s) sequentially…`;
    const results = await run(({ id, name, phase }) => {
      const line = lineByControllerId.get(id);
      if (line) line.textContent = `• ${name} · ${phase}`;
    });
    for (const row of rows(results)) {
      const line = el('div', 'led-push-diff-line' +
        (row.state === 'FAILED' ? ' led-push-result-failed' : ''));
      line.textContent = `${row.state}  ·  ${row.name}${row.ip ? ` (${row.ip})` : ''}` +
        `${row.responseLost ? '  ·  write reply LOST, confirmed by read-back' : ''}` +
        `${row.reason ? `  ·  ${row.reason}` : ''}`;
      resultsBox.appendChild(line);
    }
    const verdict = summary(results);
    statusLine.className = 'led-push-status' + (verdict.ok ? ' led-push-ok' : ' led-push-error');
    statusLine.textContent = verdict.text;
    cancelBtn.disabled = false;
    cancelBtn.textContent = verdict.ok ? 'Done' : 'Close';
    ctx.showToast(verdict.toast, { error: !verdict.ok, ttl: verdict.ok ? 9000 : 14000 });
  };
  actions.appendChild(cancelBtn);
  actions.appendChild(confirmBtn);
  card.appendChild(actions);
  overlay.onkeydown = (e) => { if (e.key === 'Escape' && !confirmBtn.disabled) cancelBtn.click(); };
  document.body.appendChild(overlay);
  confirmBtn.focus();
}

/**
 * The fleet gamma warning (binding copy). Gamma is LIVE-APPLY, so unlike every
 * other fleet write on this panel nothing reboots and no scene file changes.
 * Exported so the copy is asserted in ONE place.
 */
export const GAMMA_PUSH_ALL_WARNING =
  '⬆ Push gamma to all — each board receives ITS OWN card\'s curve (the sliders on that card), ' +
  'not one shared curve. The controllers are written SEQUENTIALLY; gamma is applied LIVE (no ' +
  'reboot) and each board is read back and confirmed per channel. Nothing else is written: ' +
  'strand counts, universes, DMX input, swarm and the mapping are all untouched, and the scene ' +
  'is NOT saved. The sim never reads a curve back off a device — these values stay the source.';

/**
 * The fleet DMX-off warning (binding copy). This one is SHOW-VISIBLE: it takes
 * sACN control away from every board at once, so the dialog says exactly what
 * goes dark, what does not change, and how DMX comes back.
 */
export const DMX_OFF_ALL_WARNING =
  '⏻ DMX all: OFF — this switches DMX (sACN) input OFF on every bound and reachable MarsinLED ' +
  'board, SEQUENTIALLY. Each board reboots (~11 s) and then runs its own local pattern: the sim ' +
  'stops driving them. Swarm and the mapping are NOT touched, and nothing is saved into the ' +
  'scene (the live mode is runtime state). DMX comes back with ⬆ Push, ⬆ Push all, or a card\'s ' +
  'own ⏻ DMX toggle. Each board is read back and confirmed; one failure never aborts the rest.';

/**
 * Operator entry point for "⬆ Push gamma to all" (the MarsinLED group header).
 * One confirm, then a sequential per-board run with a live line each.
 */
export function startGammaPushAll(ctx) {
  const registry = ctx.registry();
  const ledControllers = (registry && Array.isArray(registry.controllers))
    ? registry.controllers.filter(isLedController) : [];
  if (ledControllers.length === 0) {
    ctx.showToast('No MarsinLED controllers to push gamma to — add or discover one first',
      { error: true, ttl: 6000 });
    return;
  }
  const pushable = ledControllers.filter((c) => isValidIp(c.ip));
  openDeviceFleetDialog(ctx, {
    title: `Push gamma to all MarsinLED controllers (${pushable.length})`,
    warnings: [GAMMA_PUSH_ALL_WARNING],
    confirmLabel: 'Push gamma to all',
    controllers: ledControllers,
    run: (onProgress) => pushGammaAllControllers(ctx, DEFAULT_DEVICE_IO, onProgress),
    rows: gammaPushAllResultsModel,
    summary: (results) => {
      const pushed = results.filter((r) => r.state === 'pushed').length;
      const skipped = results.filter((r) => r.state === 'skipped').length;
      const failed = results.filter((r) => r.state === 'failed');
      const text = `done — ${pushed} confirmed · ${skipped} skipped · ${failed.length} failed` +
        (failed.length ? `: ${failed.map((f) => `${f.name} (${f.detail})`).join('; ')}` : '');
      return {
        text,
        ok: failed.length === 0 && pushed > 0,
        toast: `Push gamma to all: ${pushed} confirmed, ${failed.length} failed` +
          (skipped ? `, ${skipped} skipped` : ''),
      };
    },
  });
}

/**
 * Operator entry point for "⏻ DMX all: off" (the MarsinLED group header).
 * ONE confirm — this is show-visible — then a sequential per-board run.
 */
export function startDmxOffAll(ctx) {
  const registry = ctx.registry();
  const ledControllers = (registry && Array.isArray(registry.controllers))
    ? registry.controllers.filter(isLedController) : [];
  if (ledControllers.length === 0) {
    ctx.showToast('No MarsinLED controllers to switch off — add or discover one first',
      { error: true, ttl: 6000 });
    return;
  }
  const targets = ledControllers.filter((c) => isValidIp(c.ip));
  openDeviceFleetDialog(ctx, {
    title: `Switch DMX input OFF on all MarsinLED controllers (${targets.length})`,
    warnings: [DMX_OFF_ALL_WARNING],
    confirmLabel: 'Switch DMX off on all',
    controllers: ledControllers,
    run: (onProgress) => dmxOffAllControllers(ctx, DEFAULT_DEVICE_IO, onProgress),
    rows: dmxOffAllResultsModel,
    summary: (results) => {
      const off = results.filter((r) => r.state === 'off').length;
      const skipped = results.filter((r) => r.state === 'skipped').length;
      const failed = results.filter((r) => r.state === 'failed');
      const text = `done — ${off} switched OFF · ${skipped} skipped · ${failed.length} failed` +
        (failed.length ? `: ${failed.map((f) => `${f.name} (${f.detail})`).join('; ')}` : '');
      return {
        text,
        ok: failed.length === 0 && off > 0,
        toast: `DMX all off: ${off} confirmed OFF, ${failed.length} failed` +
          (skipped ? `, ${skipped} skipped` : '') +
          (failed.length === 0 && off > 0 ? ' — the boards are running their own patterns' : ''),
      };
    },
  });
}
