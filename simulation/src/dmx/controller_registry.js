/**
 * controller_registry.js — scene-owned controller mapping registry.
 *
 * The simulation is the source of truth for the physical control
 * hardware topology (docs/33): controllers (IP + stable id) → ports
 * (universe) → chains (which jack each fixture hangs off). The
 * registry lives in the scene's `controllers.yaml`, rides the config
 * tree through save/load, and PROJECTS every fixture's patch fields
 * (`controllerIp`, `dmxUniverse`, `dmxAddress`, `controllerId`) plus
 * metadata (`sectionId`, `fixtureId`) — replacing both hand-typed patch
 * fields and the auto-patcher. The projected `controllerId` is the
 * controller's 1-based ORDINAL in the panel list (docs/33 decision 20),
 * not the internal stable id.
 *
 * ALLOCATION MODEL (docs/33 decision 19, operator 2026-06-12): every
 * entry stores its ABSOLUTE address, assigned once at add time from
 * the end of the universe's occupancy map and sticky thereafter.
 * Ports are pure cable topology — chain order never influences
 * addresses, exactly like the physical rig. Holes from removals stay
 * (waste, never reshuffle); the panel's universe bars expose the
 * fragmentation.
 *
 * Shape (mirrors controllers.yaml):
 *   {
 *     nextControllerId: <int>,            // monotonic — ids never reused
 *     nextUniverse: <int>,                // monotonic — universes never reused either
 *     controllers: [
 *       { id, name, ip, ports: [
 *           { port, universe, chain: [
 *               { fixture, at }            // fixture at absolute address
 *               | { gap: <channels>, at }  // absolute channel reservation
 *           ] },
 *       ] },
 *     ],
 *   }
 *
 * Legacy files (packed string entries + per-port startAddress) are
 * converted once by migrateLegacyChains() at exactly their previously
 * derived addresses — upgrading moves nothing.
 *
 * The projection contract (docs/33 "Projection under invalid state"):
 * a fixture whose derived address cannot be proven valid projects to
 * the unpatched state (''/0/0) with a loud violation — patches.yaml can
 * never contain an out-of-range address. Valid fixtures around a
 * violation keep their addresses (loud-but-recoverable). ONE deliberate
 * exception (decision 18): MANUAL pins may carry a conflicting (never
 * out-of-range) address — flagged with a manual_overlap warning, the
 * operator's explicit override always stands.
 */

import { getFootprint, isGlobalEffect } from './auto_patcher.js';
import { normalizeLedWireConfig } from './led_wire.js';
import { getDefinition } from './fixture_definition_registry.js';

// ── Constants ───────────────────────────────────────────────────────────

export const DMX_UNIVERSE_SIZE = 512;   // full budget, channels 1–512 (docs/33 decision 1)
export const EFFECTS_UNIVERSE = 1;      // reserved for global effects (docs/33 decision 2)
export const MAX_UNIVERSE = 63999;      // sACN (E1.31) universe ceiling
export const DEFAULT_PORT_COUNT = 4;

// Maximum number of outputs a MarsinLED controller can carry. The device's own
// /api/config validation accepts a `strands` array of 1–16 entries
// (docs/41_led_controller_onboarding.md §4.2), and every LED port DECLARES the
// physical output it drives (`port.output`, 1-based; report 20260725_70 §1.2).
// A 17th output could therefore never be addressed, so neither the port-row
// numbering nor the output selector goes past 16.
export const LED_MAX_OUTPUTS = 16;

const IP_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

// ── Controller type (DMX vs LED) ────────────────────────────────────────
// Every controller carries an explicit `type`. DMX controllers patch
// DMX fixtures (sACN unicast to fixed addresses, host-synthesised white).
// LED controllers patch LED strands (sequential pixel addressing over the
// same sACN/E1.31 transport, RGBW stride, native white pass-through). The
// type is EXPLICIT — un-typed legacy files default to DMX at load with a
// one-time loud log (a schema-migration default, never a runtime fallback;
// codex P0). LED parity design: report 20260618_6 §D.1.
export const CONTROLLER_TYPE_DMX = 'DMX';
export const CONTROLLER_TYPE_LED = 'LED';
export const CONTROLLER_TYPES = [CONTROLLER_TYPE_DMX, CONTROLLER_TYPE_LED];

// ── Output transport (sACN vs Art-Net) ──────────────────────────────────
// Independent of `type` (DMX/LED): both controller types stream their DMX
// universes over a network transport, and that transport is selectable per
// controller. The DMX channel data is IDENTICAL on either wire — only the
// packet framing and UDP port differ (sACN/E1.31 → :5568, Art-Net ArtDMX
// opcode 0x5000 → :6454). Transport tops out at these two (operator
// decision 2026-06-19: NO DDP / WLED-native). The protocol is EXPLICIT —
// un-protocol'd legacy files default to sACN at load with a one-time loud
// log (a schema-migration default, never a runtime fallback; codex P0); an
// unrecognized protocol is structural corruption and hard-stops the boot.
export const CONTROLLER_PROTOCOL_SACN = 'sACN';
export const CONTROLLER_PROTOCOL_ARTNET = 'artnet';
export const CONTROLLER_PROTOCOLS = [CONTROLLER_PROTOCOL_SACN, CONTROLLER_PROTOCOL_ARTNET];
export const DEFAULT_CONTROLLER_PROTOCOL = CONTROLLER_PROTOCOL_SACN;

// LED channel-order presets → per-pixel channel offset maps (1-based,
// relative to the pixel's start). `stride` is bytes-per-pixel. White
// lanes carry the rendered W byte raw (native pass-through). Used by the
// exporter to derive each strand pixel's `channels` map and by the LED
// output mapper.
export const LED_CHANNEL_ORDERS = {
  RGB: { r: 1, g: 2, b: 3 },
  GRB: { r: 2, g: 1, b: 3 },
  BGR: { r: 3, g: 2, b: 1 },
  RGBW: { r: 1, g: 2, b: 3, w: 4 },
  GRBW: { r: 2, g: 1, b: 3, w: 4 },
  RGBWA: { r: 1, g: 2, b: 3, w: 4, a: 5 },
};
export const DEFAULT_LED_ORDER = 'RGBW';
export const DEFAULT_LED_STRIDE = 4;
export const DEFAULT_LED_WHITE_MODE = 'native';
export const LED_WHITE_MODES = ['native', 'synth'];

// ── LED device binding (physical controller identity + push provenance) ──
// An LED controller MAY be bound to a physical device discovered on the
// network (plan 20260709_0 P4). The binding records WHICH device backs this
// controller (identity key = ip, but the fingerprint is stored too) plus the
// provenance of the last config push. Recognized vendors are an explicit
// allow-list — an unknown vendor in a loaded controllers.yaml is structural
// corruption and hard-stops the boot (codex P0), never a silent migration. An
// ABSENT device block is the legitimate "unbound controller" state.
export const LED_DEVICE_VENDOR_MARSINLED = 'marsinled';
export const LED_DEVICE_VENDORS = [LED_DEVICE_VENDOR_MARSINLED];
export const LED_DEVICE_PUSH_OUTCOMES = ['applied', 'needs-reboot'];

/**
 * Normalize a controller's `device:` binding block (or undefined) to a
 * complete, validated shape. Undefined/null → undefined (unbound — fine). Any
 * structural problem THROWS: an LED controller whose binding block is
 * malformed or names an unknown vendor must hard-stop the boot, exactly like a
 * malformed port (codex P0 — no silent migration). Returns
 *   { vendor, controllerId, deviceName?, boardId?,
 *     lastPush?: { at, outcome, firmwareSHA?, configHash? } }.
 *
 * NOTE: the device MAC address is deliberately NEVER part of this shape. This
 * repo is public and a persisted MAC trips the gitleaks security gate
 * (rule bm26-mac-address). The MAC is a live, display-only value read from
 * the device's runtime status (see led_discovery_panel.js) — it must never be
 * written to controllers.yaml. A `raw.mac` (old caller payload, or a legacy
 * on-disk block from before this rule) is silently ignored here: loading and
 * re-saving a legacy scene drops it, which is the intended migration.
 */
export function normalizeDeviceBlock(raw, controllerName) {
  if (raw === undefined || raw === null) return undefined; // unbound — legitimate
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`[Controllers] LED controller '${controllerName}': device block must be a ` +
      'mapping (vendor, controllerId, …)');
  }
  const vendor = raw.vendor;
  if (typeof vendor !== 'string' || !LED_DEVICE_VENDORS.includes(vendor)) {
    throw new Error(`[Controllers] LED controller '${controllerName}': device.vendor ` +
      `'${vendor}' is not a recognized LED vendor (expected one of ${LED_DEVICE_VENDORS.join(', ')})`);
  }
  if (typeof raw.controllerId !== 'string' || raw.controllerId.length === 0) {
    throw new Error(`[Controllers] LED controller '${controllerName}': device.controllerId must ` +
      'be a non-empty string (the device fingerprint)');
  }
  const device = { vendor, controllerId: raw.controllerId };
  for (const opt of ['deviceName', 'boardId']) {
    if (raw[opt] !== undefined && raw[opt] !== null) {
      if (typeof raw[opt] !== 'string') {
        throw new Error(`[Controllers] LED controller '${controllerName}': device.${opt} must be ` +
          'a string');
      }
      device[opt] = raw[opt];
    }
  }
  if (raw.lastPush !== undefined && raw.lastPush !== null) {
    const lp = raw.lastPush;
    if (typeof lp !== 'object' || Array.isArray(lp)) {
      throw new Error(`[Controllers] LED controller '${controllerName}': device.lastPush must be ` +
        'a mapping');
    }
    if (typeof lp.at !== 'string' || lp.at.length === 0) {
      throw new Error(`[Controllers] LED controller '${controllerName}': device.lastPush.at must ` +
        'be a non-empty ISO8601 timestamp string');
    }
    if (typeof lp.outcome !== 'string' || !LED_DEVICE_PUSH_OUTCOMES.includes(lp.outcome)) {
      throw new Error(`[Controllers] LED controller '${controllerName}': device.lastPush.outcome ` +
        `'${lp.outcome}' must be one of ${LED_DEVICE_PUSH_OUTCOMES.join(', ')}`);
    }
    const lastPush = { at: lp.at, outcome: lp.outcome };
    for (const opt of ['firmwareSHA', 'configHash']) {
      if (lp[opt] !== undefined && lp[opt] !== null) {
        if (typeof lp[opt] !== 'string') {
          throw new Error(`[Controllers] LED controller '${controllerName}': ` +
            `device.lastPush.${opt} must be a string`);
        }
        lastPush[opt] = lp[opt];
      }
    }
    device.lastPush = lastPush;
  }
  // Provenance of the last GAMMA push — a separate stamp from lastPush because
  // it describes a different write (the per-channel curve, docs/41 §4.1c) that
  // the device applies live, without the strand/dmx reboot. The gamma it
  // carries is what the hardware CONFIRMED on read-back, so scene mirror vs
  // hardware divergence is always visible (led_gamma.js).
  if (raw.lastGammaPush !== undefined && raw.lastGammaPush !== null) {
    const lg = raw.lastGammaPush;
    if (typeof lg !== 'object' || Array.isArray(lg)) {
      throw new Error(`[Controllers] LED controller '${controllerName}': device.lastGammaPush must ` +
        'be a mapping');
    }
    if (typeof lg.at !== 'string' || lg.at.length === 0) {
      throw new Error(`[Controllers] LED controller '${controllerName}': device.lastGammaPush.at ` +
        'must be a non-empty ISO8601 timestamp string');
    }
    if (typeof lg.outcome !== 'string' || !LED_DEVICE_PUSH_OUTCOMES.includes(lg.outcome)) {
      throw new Error(`[Controllers] LED controller '${controllerName}': device.lastGammaPush.outcome ` +
        `'${lg.outcome}' must be one of ${LED_DEVICE_PUSH_OUTCOMES.join(', ')}`);
    }
    const lastGammaPush = { at: lg.at, outcome: lg.outcome };
    if (lg.gamma !== undefined && lg.gamma !== null) {
      // Validated by the SAME rules as the scene mirror (led_wire.js) — a
      // stamp the mirror would reject is corruption, not a curiosity.
      const verified = normalizeLedWireConfig({ controllerGamma: lg.gamma },
        `LED controller '${controllerName}' device.lastGammaPush`).controllerGamma;
      lastGammaPush.gamma = { ...verified };
    }
    if (lg.firmwareSHA !== undefined && lg.firmwareSHA !== null) {
      if (typeof lg.firmwareSHA !== 'string') {
        throw new Error(`[Controllers] LED controller '${controllerName}': ` +
          'device.lastGammaPush.firmwareSHA must be a string');
      }
      lastGammaPush.firmwareSHA = lg.firmwareSHA;
    }
    device.lastGammaPush = lastGammaPush;
  }
  return device;
}

/** Stride (bytes per pixel) for a channel order, or its explicit override. */
export function ledStrideForOrder(order, overrideStride) {
  if (Number.isInteger(overrideStride) && overrideStride >= 1) return overrideStride;
  const map = LED_CHANNEL_ORDERS[order];
  if (!map) return DEFAULT_LED_STRIDE;
  return Math.max(...Object.values(map));
}

/**
 * Normalize a controller's LED config (or undefined) to a complete,
 * validated shape. Range/type problems THROW — an LED controller with a
 * broken config must hard-stop the boot, exactly like a malformed port,
 * rather than silently emit garbage pixels (codex P0).
 */
export function normalizeLedConfig(raw, controllerName) {
  const src = (raw && typeof raw === 'object') ? raw : {};
  const order = typeof src.order === 'string' ? src.order : DEFAULT_LED_ORDER;
  if (!LED_CHANNEL_ORDERS[order]) {
    throw new Error(`[Controllers] LED controller '${controllerName}': unknown channel order ` +
      `'${order}' (expected one of ${Object.keys(LED_CHANNEL_ORDERS).join(', ')})`);
  }
  const stride = ledStrideForOrder(order, src.stride);
  const minStride = Math.max(...Object.values(LED_CHANNEL_ORDERS[order]));
  if (!Number.isInteger(stride) || stride < minStride) {
    throw new Error(`[Controllers] LED controller '${controllerName}': stride ${src.stride} must ` +
      `be an integer ≥ ${minStride} (the channel order '${order}' needs ${minStride} bytes/pixel)`);
  }
  const baseUniverse = Number.isInteger(src.baseUniverse) ? src.baseUniverse : 0;
  if (baseUniverse !== 0 && (baseUniverse < 1 || baseUniverse > MAX_UNIVERSE)) {
    throw new Error(`[Controllers] LED controller '${controllerName}': baseUniverse ${baseUniverse} ` +
      `must be 0 (auto-allocate) or in 1–${MAX_UNIVERSE}`);
  }
  const startAddr = Number.isInteger(src.startAddr) ? src.startAddr : 1;
  if (startAddr < 1 || startAddr > DMX_UNIVERSE_SIZE) {
    throw new Error(`[Controllers] LED controller '${controllerName}': startAddr ${startAddr} must ` +
      `be in 1–${DMX_UNIVERSE_SIZE}`);
  }
  const whiteMode = typeof src.whiteMode === 'string' ? src.whiteMode : DEFAULT_LED_WHITE_MODE;
  if (!LED_WHITE_MODES.includes(whiteMode)) {
    throw new Error(`[Controllers] LED controller '${controllerName}': whiteMode '${whiteMode}' must ` +
      `be one of ${LED_WHITE_MODES.join(', ')}`);
  }
  // ── LED wire settings (colour translation, LED path only) ──────────
  // Optional per-controller overrides for the strand colour encode:
  //   foldAmber        - fold the amber render lane into strand RGB
  //   amberRgb         - the amber → RGB weights used for that fold
  //   controllerGamma  - MIRROR of the per-channel gamma configured on
  //                      the LED controller itself, used by the sim
  //                      preview so screen matches strand. It is NOT
  //                      applied to any wire byte (the controller owns
  //                      the one and only gamma curve in the chain).
  // Absent ⇒ null, and the mapper's defaults apply; present ⇒ validated
  // here so a typo hard-stops the boot (see led_wire.js).
  // Accepted BOTH nested (`led.wire: {...}` — the form the registry writes
  // back on save, so a saved scene round-trips) and flat on `led` (handy
  // when hand-editing controllers.yaml). Nested wins if both are present.
  const wireKeys = ['foldAmber', 'amberRgb', 'controllerGamma', 'controllerWhite', 'gamma'];
  const flat = Object.fromEntries(wireKeys.filter(k => src[k] !== undefined).map(k => [k, src[k]]));
  const nested = (src.wire && typeof src.wire === 'object') ? src.wire : null;
  const rawWire = nested || (Object.keys(flat).length ? flat : null);
  const wire = rawWire
    ? normalizeLedWireConfig(rawWire, `LED controller '${controllerName}'`)
    : null;

  const out = { baseUniverse, startAddr, order, stride, whiteMode };
  if (wire) out.wire = wire;
  return out;
}

export function isValidIp(ip) {
  const m = IP_RE.exec(String(ip || ''));
  if (!m) return false;
  return m.slice(1).every(octet => Number(octet) <= 255);
}

// ── Chain entry helpers ─────────────────────────────────────────────────

export function isGapEntry(entry) {
  return !!entry && typeof entry === 'object' && typeof entry.gap === 'number';
}

export function isPinnedEntry(entry) {
  return !!entry && typeof entry === 'object' && typeof entry.fixture === 'string';
}

/** Fixture name of a chain entry, or null for gaps. */
export function entryFixtureName(entry) {
  if (typeof entry === 'string') return entry;
  if (isPinnedEntry(entry)) return entry.fixture;
  return null;
}

// ── Registry creation / schema validation ──────────────────────────────

/**
 * Normalize a parsed controllers.yaml tree (or undefined) into a
 * registry. THROWS on structural invalidity (bad ids, malformed ports,
 * invalid gaps/startAddress, a fixture in two chains): a structurally
 * broken file must hard-stop the boot — continuing would let the next
 * auto-save rewrite controllers.yaml from garbage (codex P0). A missing
 * tree (no mapping yet) is the legitimate empty case. OPERATIONAL
 * problems (overflow, overlap, orphans, bad IPs, pin mismatches) are
 * NOT thrown here — they are violations from computeProjection() so
 * work-in-progress always loads and renders, loudly flagged.
 */
export function createControllerRegistry(tree) {
  const src = (tree && typeof tree === 'object') ? tree : {};
  const registry = { nextControllerId: 1, nextUniverse: 2, controllers: [] };
  // Ids of controllers that loaded with no explicit `type` and were
  // schema-migrated to DMX. Surfaced (not swallowed) so the caller logs
  // the migration once — codex P0: no silent defaults. NON-ENUMERABLE so
  // it never serializes into controllers.yaml (the registry IS the saved
  // config tree node; yaml.dump must not emit a Set).
  Object.defineProperty(registry, '_untypedControllers', {
    value: new Set(),
    enumerable: false,
    writable: true,
    configurable: true,
  });
  // Same contract as _untypedControllers, for controllers that loaded with
  // no explicit `protocol` and were schema-migrated to sACN. Surfaced (not
  // swallowed) so the caller logs the migration once — codex P0: no silent
  // defaults. NON-ENUMERABLE so it never serializes into controllers.yaml.
  Object.defineProperty(registry, '_unprotocolledControllers', {
    value: new Set(),
    enumerable: false,
    writable: true,
    configurable: true,
  });
  // LED port rows that loaded with no explicit `output` and were schema-migrated
  // to the IDENTITY mapping (`output = port`) — the exact rule in force before
  // report 20260725_70, so nothing moves on load. Keyed by controller id →
  // {name, ports:[portNum,…]} so the caller logs ONE line per card (not per
  // port). Same contract as _untypedControllers: surfaced, never swallowed, and
  // NON-ENUMERABLE so it never serializes into controllers.yaml.
  Object.defineProperty(registry, '_ledOutputMigrations', {
    value: new Map(),
    enumerable: false,
    writable: true,
    configurable: true,
  });

  const rawControllers = src.controllers;
  if (rawControllers !== undefined && !Array.isArray(rawControllers)) {
    throw new Error('[Controllers] controllers.yaml: `controllers` must be a list');
  }

  const seenIds = new Set();
  const seenFixtures = new Map(); // name -> 'controller/port' for duplicate reporting

  for (const rawCtl of rawControllers || []) {
    if (!rawCtl || typeof rawCtl !== 'object') {
      throw new Error(`[Controllers] Invalid controller entry: ${JSON.stringify(rawCtl)}`);
    }
    const id = rawCtl.id;
    if (!Number.isInteger(id) || id < 1) {
      throw new Error(`[Controllers] Controller '${rawCtl.name || '?'}' has invalid id ${id} — ` +
        'must be a positive integer');
    }
    if (seenIds.has(id)) {
      throw new Error(`[Controllers] Duplicate controller id ${id} in controllers.yaml`);
    }
    seenIds.add(id);

    // Type is EXPLICIT. An un-typed legacy controller loads as DMX (a
    // one-time schema-migration default, logged loudly by the caller via
    // the returned `_untypedControllers` set) — never a silent runtime
    // fallback (codex P0). An unrecognized type is structural corruption
    // and hard-stops the boot, like a malformed port.
    let type = rawCtl.type;
    if (type === undefined || type === null) {
      type = CONTROLLER_TYPE_DMX;
      registry._untypedControllers.add(id);
    } else if (!CONTROLLER_TYPES.includes(type)) {
      throw new Error(`[Controllers] Controller '${rawCtl.name || id}' has invalid type ` +
        `'${type}' — must be one of ${CONTROLLER_TYPES.join(', ')}`);
    }

    // Output transport is EXPLICIT, exactly like `type`. An un-protocol'd
    // legacy controller loads as sACN (a one-time schema-migration default,
    // logged loudly by the caller via `_unprotocolledControllers`) — never a
    // silent runtime fallback (codex P0). An unrecognized protocol is
    // structural corruption and hard-stops the boot, like a malformed port.
    let protocol = rawCtl.protocol;
    if (protocol === undefined || protocol === null) {
      protocol = DEFAULT_CONTROLLER_PROTOCOL;
      registry._unprotocolledControllers.add(id);
    } else if (!CONTROLLER_PROTOCOLS.includes(protocol)) {
      throw new Error(`[Controllers] Controller '${rawCtl.name || id}' has invalid protocol ` +
        `'${protocol}' — must be one of ${CONTROLLER_PROTOCOLS.join(', ')}`);
    }

    const controller = {
      id,
      name: typeof rawCtl.name === 'string' ? rawCtl.name : `Controller ${id}`,
      ip: typeof rawCtl.ip === 'string' ? rawCtl.ip : '',
      type,
      protocol,
      ports: [],
    };
    if (type === CONTROLLER_TYPE_LED) {
      controller.led = normalizeLedConfig(rawCtl.led, controller.name);
    }
    // Optional device binding (LED controllers only). Absent = unbound; a
    // block on a non-LED controller, or a malformed/unknown-vendor block, is
    // structural corruption and hard-stops the boot (codex P0).
    if (rawCtl.device !== undefined && rawCtl.device !== null) {
      if (type !== CONTROLLER_TYPE_LED) {
        throw new Error(`[Controllers] Controller '${controller.name}': a device binding block is ` +
          'only valid on an LED controller');
      }
      controller.device = normalizeDeviceBlock(rawCtl.device, controller.name);
    }

    if (rawCtl.ports !== undefined && !Array.isArray(rawCtl.ports)) {
      throw new Error(`[Controllers] Controller '${controller.name}': ports must be a list`);
    }
    const seenPortNums = new Set();
    for (const rawPort of rawCtl.ports || []) {
      if (!rawPort || typeof rawPort !== 'object') {
        throw new Error(`[Controllers] Controller '${controller.name}': invalid port entry`);
      }
      const portNum = rawPort.port;
      if (!Number.isInteger(portNum) || portNum < 1) {
        throw new Error(`[Controllers] Controller '${controller.name}': port number ${portNum} ` +
          'must be a positive integer');
      }
      if (seenPortNums.has(portNum)) {
        throw new Error(`[Controllers] Controller '${controller.name}': duplicate port ${portNum}`);
      }
      seenPortNums.add(portNum);

      const universe = rawPort.universe;
      // Range problems (e.g. > MAX_UNIVERSE) are OPERATIONAL — the
      // projection flags them loudly and unpatches the port; treating
      // them as corruption would brick the boot off a panel typo
      // (cold review 2026-06-12, same class as the at: 0 fix).
      if (!Number.isInteger(universe) || universe < 1) {
        throw new Error(`[Controllers] Controller '${controller.name}' port ${portNum}: ` +
          `universe ${universe} must be a positive integer`);
      }
      const startAddress = rawPort.startAddress === undefined ? 1 : rawPort.startAddress;
      if (!Number.isInteger(startAddress) || startAddress < 1 || startAddress > DMX_UNIVERSE_SIZE) {
        throw new Error(`[Controllers] Controller '${controller.name}' port ${portNum}: ` +
          `startAddress ${startAddress} must be in 1–${DMX_UNIVERSE_SIZE}`);
      }

      const port = { port: portNum, universe, startAddress, chain: [] };

      // ── LED only: the PHYSICAL board output this row drives (report
      // 20260725_70 §1.2). 1-based to match the `port:` key beside it and every
      // operator-facing string ("output 3"); the device's 0-based strands[]
      // index is DERIVED at the device boundary only (ledOutputIndexForPort).
      // DMX port numbers are chain labels, not hardware indices — the field is
      // never stamped on a DMX card, because it would invent meaning there.
      if (type === CONTROLLER_TYPE_LED) {
        const rawOutput = rawPort.output;
        if (rawOutput === undefined || rawOutput === null) {
          // Schema migration, materialized at load: identity (output = port) is
          // exactly the rule in force before this field existed, so nothing on
          // the wire moves. Logged once per card by the caller, then the file
          // becomes explicit on the next save. NOT a runtime fallback (codex P0).
          port.output = portNum;
          if (!registry._ledOutputMigrations.has(id)) {
            registry._ledOutputMigrations.set(id, { name: controller.name, ports: [] });
          }
          registry._ledOutputMigrations.get(id).ports.push(portNum);
        } else if (!Number.isInteger(rawOutput) ||
                   rawOutput < 1 || rawOutput > LED_MAX_OUTPUTS) {
          // Structural corruption — a non-integer or unaddressable output makes
          // the row's TARGET meaningless. Same treatment as a malformed `port:`.
          // (A DUPLICATE output is different: identity stays intact and only the
          // mapping is invalid, so it LOADS and is caught by the chips + the
          // push gate — see validateLedManualUniverses / derivePerOutputPlan.)
          throw new Error(`[Controllers] Controller '${controller.name}' port ${portNum}: ` +
            `output ${JSON.stringify(rawOutput)} must be an integer in 1–${LED_MAX_OUTPUTS} ` +
            '(the physical board output this port drives)');
        } else {
          port.output = rawOutput;
        }
      }

      if (rawPort.chain !== undefined && !Array.isArray(rawPort.chain)) {
        throw new Error(`[Controllers] Controller '${controller.name}' port ${portNum}: ` +
          'chain must be a list');
      }
      for (const entry of rawPort.chain || []) {
        if (typeof entry === 'string') {
          if (entry.length === 0) {
            throw new Error(`[Controllers] Controller '${controller.name}' port ${portNum}: ` +
              'empty fixture name in chain');
          }
        } else if (isGapEntry(entry)) {
          if (!Number.isInteger(entry.gap) || entry.gap < 1) {
            throw new Error(`[Controllers] Controller '${controller.name}' port ${portNum}: ` +
              `gap width ${entry.gap} must be an integer ≥ 1`);
          }
          // `at` is the gap's absolute address; absent = legacy packed
          // gap (migrated at boot). Range problems are operational
          // (projection flags them), only a broken TYPE is structural.
          if (entry.at !== undefined && !Number.isInteger(entry.at)) {
            throw new Error(`[Controllers] Controller '${controller.name}' port ${portNum}: ` +
              `gap address ${entry.at} must be an integer`);
          }
        } else if (isPinnedEntry(entry)) {
          // at: 0 is the legitimate "no pin known" state — the panel
          // writes it when config.yaml has no pin for the type yet.
          // It must LOAD (the projection flags it loudly as no_pin /
          // pin_mismatch); treating it as corruption bricked the boot
          // off a normal UI flow (cold review B1, 2026-06-12).
          if (!Number.isInteger(entry.at) || entry.at < 0 || entry.at > DMX_UNIVERSE_SIZE) {
            throw new Error(`[Controllers] Controller '${controller.name}' port ${portNum}: ` +
              `pinned entry '${entry.fixture}' address ${entry.at} must be in ` +
              `1–${DMX_UNIVERSE_SIZE} (or 0 = unpinned)`);
          }
        } else {
          throw new Error(`[Controllers] Controller '${controller.name}' port ${portNum}: ` +
            `unrecognized chain entry ${JSON.stringify(entry)}`);
        }
        const name = entryFixtureName(entry);
        if (name !== null) {
          const where = `${controller.name} port ${portNum}`;
          if (seenFixtures.has(name)) {
            throw new Error(`[Controllers] Fixture '${name}' appears in two chains ` +
              `(${seenFixtures.get(name)} and ${where}) — a fixture may be mapped at most once`);
          }
          seenFixtures.set(name, where);
        }
        port.chain.push(entry);
      }
      controller.ports.push(port);
    }

    // ── LED only: STICKY parked outputs (report 20260725_70 §2.2) ─────────
    // A board output that no card port drives is not disabled — it is PARKED on
    // a universe nobody routes to, so it sits enabled, subscribed and dark. The
    // universe is PERSISTED here so it is stable across pushes: a re-derived
    // park would move whenever any other card took a universe, and the sync chip
    // would then report drift on a card nobody touched.
    if (rawCtl.parkedOutputs !== undefined && rawCtl.parkedOutputs !== null) {
      if (type !== CONTROLLER_TYPE_LED) {
        throw new Error(`[Controllers] Controller '${controller.name}': parkedOutputs is only ` +
          'valid on an LED controller (a DMX port number is a chain label, not a board output)');
      }
      if (!Array.isArray(rawCtl.parkedOutputs)) {
        throw new Error(`[Controllers] Controller '${controller.name}': parkedOutputs must be a list`);
      }
      const seenParked = new Set();
      controller.parkedOutputs = [];
      for (const rawParked of rawCtl.parkedOutputs) {
        if (!rawParked || typeof rawParked !== 'object') {
          throw new Error(`[Controllers] Controller '${controller.name}': invalid parkedOutputs ` +
            `entry ${JSON.stringify(rawParked)} — expected {output, universe}`);
        }
        const output = rawParked.output;
        if (!Number.isInteger(output) || output < 1 || output > LED_MAX_OUTPUTS) {
          throw new Error(`[Controllers] Controller '${controller.name}': parkedOutputs output ` +
            `${JSON.stringify(output)} must be an integer in 1–${LED_MAX_OUTPUTS}`);
        }
        if (seenParked.has(output)) {
          throw new Error(`[Controllers] Controller '${controller.name}': duplicate parkedOutputs ` +
            `entry for output ${output}`);
        }
        seenParked.add(output);
        const parkedUniverse = rawParked.universe;
        if (!Number.isInteger(parkedUniverse) || parkedUniverse < 1 ||
            parkedUniverse > MAX_UNIVERSE) {
          throw new Error(`[Controllers] Controller '${controller.name}': parkedOutputs output ` +
            `${output} universe ${JSON.stringify(parkedUniverse)} must be an integer in ` +
            `1–${MAX_UNIVERSE}`);
        }
        // A park that collides with a port's declared output is OPERATIONAL, not
        // structural: it LOADS (so the operator can fix it in the UI) and is
        // flagged by validateLedManualUniverses + re-derived by the push.
        controller.parkedOutputs.push({ output, universe: parkedUniverse });
      }
    }
    registry.controllers.push(controller);
  }

  const maxId = registry.controllers.reduce((m, c) => Math.max(m, c.id), 0);
  const rawNext = src.nextControllerId;
  registry.nextControllerId = Number.isInteger(rawNext) && rawNext > maxId ? rawNext : maxId + 1;

  // Universe high-water mark: like controller ids, universes are NEVER
  // reused — deleting a controller must not let its old universes be
  // handed to later gear, silently re-meaning addresses the engine,
  // models and patterns may still reference. Wasting universe numbers
  // is fine; reshuffling the system for a small change is not
  // (operator decision 2026-06-12).
  let maxU = 1; // U1 (effects) never counts as allocatable
  for (const controller of registry.controllers) {
    for (const port of controller.ports) maxU = Math.max(maxU, port.universe);
    // A PARKED universe is real gear's neighbour: the device subscribes to it.
    // It must move the high-water mark or a later addPort would hand the same
    // number to a strand somebody actually routes.
    for (const parked of controller.parkedOutputs || []) maxU = Math.max(maxU, parked.universe);
  }
  const rawNextU = src.nextUniverse;
  registry.nextUniverse = Math.max(
    Number.isInteger(rawNextU) ? rawNextU : 2, maxU + 1, 2);

  return registry;
}

/** True when a mapping exists — the mapper owns ALL patch fields then. */
export function registryIsActive(registry) {
  return !!registry && Array.isArray(registry.controllers) && registry.controllers.length > 0;
}

// ── Queries ─────────────────────────────────────────────────────────────

/** Map of fixture name → { controller, port } across the whole registry. */
export function mappedFixtures(registry) {
  const out = new Map();
  for (const controller of registry.controllers) {
    for (const port of controller.ports) {
      for (const entry of port.chain) {
        const name = entryFixtureName(entry);
        if (name !== null) out.set(name, { controller, port });
      }
    }
  }
  return out;
}

/** Sorted unique universes carried by any port (the derived sACN listen list). */
export function derivedUniverses(registry) {
  const set = new Set();
  for (const controller of registry.controllers) {
    for (const port of controller.ports) set.add(port.universe);
  }
  return [...set].sort((a, b) => a - b);
}

/**
 * Next universe to allocate — MONOTONIC, never a freed one. The
 * high-water mark only moves forward (createControllerRegistry
 * normalizes it past every in-use universe at load; addPort and
 * noteUniverseUsed bump it live), so removing a controller can never
 * cause a later addition to reclaim its universes and silently
 * re-mean existing addresses. U1 is effects-only and never allocated.
 */
export function nextFreeUniverse(registry) {
  return Math.max(registry.nextUniverse || 2, 2);
}

/** Record a manually-entered universe so allocation never hands it out again. */
export function noteUniverseUsed(registry, universe) {
  if (Number.isInteger(universe) && universe <= MAX_UNIVERSE &&
      universe + 1 > (registry.nextUniverse || 2)) {
    registry.nextUniverse = universe + 1;
  }
}

// ── Mutations (panel operations) ────────────────────────────────────────

export function addController(registry, { name, ip, type, protocol }) {
  const ctlType = CONTROLLER_TYPES.includes(type) ? type : CONTROLLER_TYPE_DMX;
  const ctlProtocol = CONTROLLER_PROTOCOLS.includes(protocol)
    ? protocol : DEFAULT_CONTROLLER_PROTOCOL;
  const controller = {
    id: registry.nextControllerId,
    name: String(name || `Controller ${registry.nextControllerId}`),
    ip: String(ip || ''),
    type: ctlType,
    protocol: ctlProtocol,
    ports: [],
  };
  if (ctlType === CONTROLLER_TYPE_LED) {
    controller.led = normalizeLedConfig(null, controller.name);
  }
  registry.nextControllerId += 1;
  registry.controllers.push(controller);
  for (let i = 0; i < DEFAULT_PORT_COUNT; i++) addPort(registry, controller);
  return controller;
}

/** True when the controller patches LED strands (vs DMX fixtures). */
export function isLedController(controller) {
  return !!controller && controller.type === CONTROLLER_TYPE_LED;
}

// ── Strict type gating (LED strands ↔ LED controllers, DMX ↔ DMX) ────────
// A controller accepts exactly ONE kind of mappable name: an LED controller
// takes LED strands, a DMX controller takes DMX fixtures. Cross-type mapping
// is meaningless hardware-wise (an LED strand has no DMX footprint; a moving
// head is not a pixel run) and is refused loudly at every add path (codex P0 —
// never silently mis-map). The `kind` string is 'strand' | 'fixture'.

/** The single kind of mappable name a controller accepts: 'strand' | 'fixture'. */
export function controllerFixtureKind(controller) {
  return isLedController(controller) ? 'strand' : 'fixture';
}

/** True when a name of `kind` ('strand'|'fixture') may be mapped onto this controller. */
export function controllerAcceptsKind(controller, kind) {
  return controllerFixtureKind(controller) === kind;
}

/**
 * Split fixture + strand name lists into the still-unmapped ones. The default
 * (non-picking) tray shows BOTH so an unmapped LED strand is visible even when
 * no LED controller exists yet (operator requirement, Round 2 R1). Pure so the
 * tray-content decision is unit-testable without the DOM.
 *
 * @param {Object} registry
 * @param {string[]} fixtureNames - all DMX fixture config names.
 * @param {string[]} strandNames - all LED strand names.
 * @returns {{ fixtures: string[], strands: string[] }} unmapped by kind.
 */
export function unmappedNamesByKind(registry, fixtureNames, strandNames) {
  const mapped = mappedFixtures(registry);
  const keep = (name) => typeof name === 'string' && name.length > 0 && !mapped.has(name);
  return {
    fixtures: (fixtureNames || []).filter(keep),
    strands: (strandNames || []).filter(keep),
  };
}

/**
 * Switch a controller's type in place. DMX→LED installs a default LED
 * config (preserving any existing one); LED→DMX drops it. The chain
 * entries (fixture/strand names) are NOT cleared — the operator may have
 * mis-toggled; the projection flags entries that no longer resolve to a
 * member of the new tray, loudly, rather than silently discarding work.
 */
export function setControllerType(controller, type) {
  if (!CONTROLLER_TYPES.includes(type)) {
    throw new Error(`[Controllers] setControllerType: invalid type '${type}'`);
  }
  controller.type = type;
  if (type === CONTROLLER_TYPE_LED) {
    if (!controller.led) controller.led = normalizeLedConfig(null, controller.name);
    // On an LED card every port DECLARES the physical board output it drives
    // (report 20260725_70). A card flipped over from DMX has none, and every
    // consumer refuses to guess an output index — materialize the identity
    // mapping here, the same default the loader applies. A row past the 16-output
    // device ceiling cannot be addressed at all, so it takes the lowest free one.
    for (const port of controller.ports || []) {
      if (Number.isInteger(port.output)) continue;
      port.output = (port.port >= 1 && port.port <= LED_MAX_OUTPUTS &&
        !(controller.ports || []).some((p) => p.output === port.port))
        ? port.port
        : nextLedOutputNumber(controller);
    }
  } else {
    delete controller.led;
    // DMX port numbers are chain labels, not hardware indices — carrying an
    // `output` (or a park) across would invent meaning that does not exist there,
    // and the loader would refuse to re-parse it on a DMX card.
    delete controller.parkedOutputs;
    for (const port of controller.ports || []) delete port.output;
  }
  return controller;
}

/** True when the LED controller is bound to a physical device (has a device block). */
export function isBoundLedController(controller) {
  return isLedController(controller) && !!controller.device;
}

/**
 * Bind an LED controller to a discovered device: records the identity block
 * (vendor + controllerId fingerprint + optional deviceName/boardId),
 * preserving any existing push provenance. The identity key stays the
 * controller's `ip` (operator decision) — the block is the fingerprint the
 * scene remembers. THROWS on a non-LED controller or an invalid identity.
 * `identity.mac`, if present, is IGNORED — the MAC is never persisted (see
 * normalizeDeviceBlock).
 */
export function bindControllerDevice(controller, identity) {
  if (!isLedController(controller)) {
    throw new Error(`[Controllers] bindControllerDevice: '${controller && controller.name}' is ` +
      'not an LED controller — only LED controllers bind to a device');
  }
  const raw = {
    vendor: identity.vendor || LED_DEVICE_VENDOR_MARSINLED,
    controllerId: identity.controllerId,
    deviceName: identity.deviceName,
    boardId: identity.boardId,
    lastPush: controller.device ? controller.device.lastPush : undefined,
    lastGammaPush: controller.device ? controller.device.lastGammaPush : undefined,
  };
  controller.device = normalizeDeviceBlock(raw, controller.name);
  return controller.device;
}

/** Drop an LED controller's device binding (return it to the unbound state). */
export function unbindControllerDevice(controller) {
  if (controller) delete controller.device;
  return controller;
}

/**
 * Record the provenance of a config push onto a bound controller's device
 * block: { at (ISO8601), outcome, firmwareSHA?, configHash? }. THROWS on an
 * unbound controller or an invalid push record (codex P0 — a push we can't
 * describe must not be silently recorded).
 */
export function recordDevicePush(controller, push) {
  if (!controller || !controller.device) {
    throw new Error(`[Controllers] recordDevicePush: controller '${controller && controller.name}' ` +
      'is not bound to a device — bind it before recording a push');
  }
  const lastPush = { at: push.at, outcome: push.outcome };
  if (push.firmwareSHA !== undefined && push.firmwareSHA !== null) lastPush.firmwareSHA = push.firmwareSHA;
  if (push.configHash !== undefined && push.configHash !== null) lastPush.configHash = push.configHash;
  // Round-trip through the validator so an invalid outcome/shape throws.
  controller.device = normalizeDeviceBlock({ ...controller.device, lastPush }, controller.name);
  return controller.device;
}

/**
 * Record the provenance of a GAMMA push onto a bound controller's device
 * block: { at (ISO8601), outcome, gamma (the HARDWARE-VERIFIED curve),
 * firmwareSHA? }. Separate from recordDevicePush — a gamma write is a
 * different config key with different apply semantics. THROWS on an unbound
 * controller or an invalid record (codex P0 — never stamp a push we can't
 * describe, and never stamp a curve the mirror would reject).
 */
export function recordDeviceGammaPush(controller, push) {
  if (!controller || !controller.device) {
    throw new Error(`[Controllers] recordDeviceGammaPush: controller ` +
      `'${controller && controller.name}' is not bound to a device — bind it before recording`);
  }
  const lastGammaPush = { at: push.at, outcome: push.outcome, gamma: push.gamma };
  if (push.firmwareSHA !== undefined && push.firmwareSHA !== null) {
    lastGammaPush.firmwareSHA = push.firmwareSHA;
  }
  controller.device = normalizeDeviceBlock({ ...controller.device, lastGammaPush }, controller.name);
  return controller.device;
}

/**
 * Add a new LED controller pre-populated from a discovered device: `portCount`
 * ports (= the board's output count), the given channel order, and the device
 * binding block. Mirrors addController's port allocation. Returns the new
 * controller.
 */
export function addLedControllerFromDevice(registry, { name, ip, portCount, order, device }) {
  const controller = {
    id: registry.nextControllerId,
    name: String(name || `LED ${registry.nextControllerId}`),
    ip: String(ip || ''),
    type: CONTROLLER_TYPE_LED,
    protocol: DEFAULT_CONTROLLER_PROTOCOL,
    ports: [],
  };
  controller.led = normalizeLedConfig({ order: order || DEFAULT_LED_ORDER }, controller.name);
  if (device) controller.device = normalizeDeviceBlock(device, controller.name);
  registry.nextControllerId += 1;
  registry.controllers.push(controller);
  const n = Number.isInteger(portCount) && portCount > 0 ? portCount : DEFAULT_PORT_COUNT;
  for (let i = 0; i < n; i++) addPort(registry, controller);
  return controller;
}

/** True when the controller streams its universes over Art-Net (vs sACN). */
export function isArtnetController(controller) {
  return !!controller && controller.protocol === CONTROLLER_PROTOCOL_ARTNET;
}

/**
 * Switch a controller's output transport in place (sACN ⇄ Art-Net). The
 * DMX universe data is identical on either wire — only packet framing and
 * UDP port change — so nothing else about the controller is touched. An
 * invalid protocol THROWS loudly (codex P0 — never a silent fallback).
 */
export function setControllerProtocol(controller, protocol) {
  if (!CONTROLLER_PROTOCOLS.includes(protocol)) {
    throw new Error(`[Controllers] setControllerProtocol: invalid protocol '${protocol}' — ` +
      `must be one of ${CONTROLLER_PROTOCOLS.join(', ')}`);
  }
  controller.protocol = protocol;
  return controller;
}

// ── Test auto-patch / clear-all (operator TEST utilities) ───────────────
// These two are the panel's "patch the whole rig in one click" and "wipe
// every patch" actions. They are deliberately SIMPLE and DETERMINISTIC —
// a smoke utility to get the rig streaming/visualizing without hand
// patching, NOT a production hardware-accurate addressing scheme
// (operator request 2026-06-19, report 20260619_2). Real production
// addressing stays the per-fixture panel flow.

const TEST_DMX_CONTROLLER_NAME = 'TEST DMX';
const TEST_LED_CONTROLLER_NAME = 'TEST LEDs';
const TEST_DMX_CONTROLLER_IP = '10.0.0.1';
const TEST_LED_CONTROLLER_IP = '10.0.0.2';

/** First controller of `type` whose IP is valid, or null. */
function firstUsableController(registry, type) {
  for (const controller of registry.controllers) {
    if (controller.type === type && isValidIp(controller.ip)) return controller;
  }
  return null;
}

/** A single empty port on `controller`, creating one if every port has a chain. */
function firstEmptyOrNewPort(registry, controller) {
  for (const port of controller.ports) {
    if (port.chain.length === 0) return port;
  }
  return addPort(registry, controller);
}

/**
 * TEST auto-patch: assign controllers to EVERY fixture and patch the whole
 * rig with a simple, deterministic, sequential mapping. Mutates the
 * registry in place; every fixture/strand ends up mapped (zero unpatched)
 * or the call THROWS loudly (codex P0 — no silent skip).
 *
 * Scheme (TEST, not production):
 *  - DMX fixtures (pars/bars/vintage/special, NON-effect): packed in the
 *    order given, footprint after footprint, starting at U2:ch1. When the
 *    next fixture's footprint would run past channel 512 the cursor wraps
 *    to the next universe at ch1 — so a fixture never straddles a universe.
 *    Each universe becomes its own port on the test DMX controller (ports
 *    are pure cable topology; the port carries the universe).
 *  - Global effects (foggers/hazers/horns/fire): pinned at their
 *    config.yaml global_effects address on the effects universe (U1),
 *    exactly like the panel's "+ effects" flow. A type with no pin lands
 *    at at:0 and the projection flags it loudly (never silently dropped).
 *  - LED strands: bound in order to one port of the test LED controller;
 *    computeLedProjection lays them out as sequential per-pixel patches.
 *
 * Controllers are REUSED when a usable (valid-IP) one of the right type
 * already exists; otherwise a default test controller is CREATED (loudly,
 * via the returned `created` list). Fixtures already mapped anywhere are
 * left where they are (their chain entries stand) and re-patched into the
 * test layout only if currently unmapped — re-running is idempotent-ish:
 * it tops up whatever is unmapped.
 *
 * @param {Object} registry
 * @param {Map<string,Object>|Array<Object>} dmxConfigs - DMX fixture configs
 *        (by name → config, or an array of configs with `.name`).
 * @param {Map<string,number>|Array<{name,ledCount}>} strands - LED strands.
 * @param {Object} pins - config.yaml global_effects pin table.
 * @returns {{ created: string[], dmxPatched: number, effectsPatched: number,
 *             strandsPatched: number, universesUsed: number[] }}
 */
export function testAutoPatch(registry, dmxConfigs, strands, pins) {
  const configsByName = dmxConfigs instanceof Map
    ? dmxConfigs
    : new Map((dmxConfigs || [])
      .filter(c => c && typeof c.name === 'string' && c.name.length > 0)
      .map(c => [c.name, c]));
  const strandCounts = strands instanceof Map
    ? strands
    : new Map((strands || [])
      .filter(s => s && typeof s.name === 'string' && s.name.length > 0)
      .map(s => [s.name, s.ledCount || 10]));
  const pinTable = pins || {};

  const created = [];
  const alreadyMapped = mappedFixtures(registry);
  const universesUsed = new Set();

  // ── DMX fixtures ──────────────────────────────────────────────────────
  const dmxNames = [...configsByName.keys()].filter(n => !alreadyMapped.has(n));
  let dmxPatched = 0;
  let effectsPatched = 0;
  if (dmxNames.length > 0) {
    let dmxController = firstUsableController(registry, CONTROLLER_TYPE_DMX);
    if (!dmxController) {
      dmxController = addController(registry,
        { name: TEST_DMX_CONTROLLER_NAME, ip: TEST_DMX_CONTROLLER_IP, type: CONTROLLER_TYPE_DMX });
      created.push(`DMX controller '${dmxController.name}' (${dmxController.ip})`);
    }

    // Effects pin onto an effects (U1) port; normal fixtures pack
    // sequentially onto per-universe ports. Both live on the same test
    // controller — the effects universe is just another port there.
    let effectsPort = dmxController.ports.find(p => p.universe === EFFECTS_UNIVERSE) || null;
    const ensureEffectsPort = () => {
      if (!effectsPort) {
        effectsPort = firstEmptyOrNewPort(registry, dmxController);
        effectsPort.universe = EFFECTS_UNIVERSE;
      }
      return effectsPort;
    };

    // Sequential DMX cursor: pack footprint-after-footprint, wrap at 512.
    // Each universe is one port. We grab the port FIRST and take its
    // universe (reusing the controller's pre-made empty ports — universes
    // 2,3,4,…); a new port allocates the next free universe itself. A
    // never-effects port carries the pack.
    let packPort = null;
    let cursor = 1; // next free channel in packPort's universe
    const nextPackPort = () => {
      const port = firstEmptyOrNewPort(registry, dmxController);
      if (port.universe === EFFECTS_UNIVERSE) {
        // The effects universe is pins-only — never pack normal fixtures
        // there. Re-home this port to the next free universe.
        port.universe = nextFreeUniverse(registry);
        noteUniverseUsed(registry, port.universe);
      }
      packPort = port;
      cursor = 1;
      return port;
    };

    for (const name of dmxNames) {
      const config = configsByName.get(name);
      const fixtureType = (config && (config.fixtureType || config.type)) || '';
      if (isGlobalEffect(fixtureType)) {
        const pin = pinTable[fixtureType];
        ensureEffectsPort().chain.push({ fixture: name, at: pin ? pin.address : 0 });
        universesUsed.add(EFFECTS_UNIVERSE);
        effectsPatched += 1;
        continue;
      }
      const footprint = getFootprint(config || { fixtureType });
      if (footprint > DMX_UNIVERSE_SIZE) {
        throw new Error(`[Controllers] testAutoPatch: fixture '${name}' footprint ${footprint} ` +
          `exceeds a full universe (${DMX_UNIVERSE_SIZE}) — cannot patch it on one universe`);
      }
      // First fixture, or this footprint runs past 512 → open a new port
      // (its own universe). A fixture never straddles a universe.
      if (!packPort || cursor + footprint - 1 > DMX_UNIVERSE_SIZE) nextPackPort();
      const at = cursor;
      packPort.chain.push({ fixture: name, at });
      universesUsed.add(packPort.universe);
      cursor += footprint;
      dmxPatched += 1;
    }
  }

  // ── LED strands ───────────────────────────────────────────────────────
  const strandNames = [...strandCounts.keys()].filter(n => !alreadyMapped.has(n));
  let strandsPatched = 0;
  if (strandNames.length > 0) {
    let ledController = firstUsableController(registry, CONTROLLER_TYPE_LED);
    if (!ledController) {
      ledController = addController(registry,
        { name: TEST_LED_CONTROLLER_NAME, ip: TEST_LED_CONTROLLER_IP, type: CONTROLLER_TYPE_LED });
      created.push(`LED controller '${ledController.name}' (${ledController.ip})`);
    }
    const ledPort = firstEmptyOrNewPort(registry, ledController);
    for (const name of strandNames) {
      ledPort.chain.push(name);
      strandsPatched += 1;
    }
    universesUsed.add(ledPort.universe);
  }

  // ── Loud completeness check (codex P0): NOTHING may be left unmapped ──
  const mappedAfter = mappedFixtures(registry);
  const stillUnmapped = [];
  for (const name of configsByName.keys()) if (!mappedAfter.has(name)) stillUnmapped.push(name);
  for (const name of strandCounts.keys()) if (!mappedAfter.has(name)) stillUnmapped.push(name);
  if (stillUnmapped.length > 0) {
    throw new Error(`[Controllers] testAutoPatch left ${stillUnmapped.length} fixture(s) unmapped — ` +
      `this is a bug, not a fallback: ${stillUnmapped.slice(0, 10).join(', ')}` +
      (stillUnmapped.length > 10 ? ` …(+${stillUnmapped.length - 10})` : ''));
  }

  return {
    created,
    dmxPatched,
    effectsPatched,
    strandsPatched,
    universesUsed: [...universesUsed].sort((a, b) => a - b),
  };
}

/**
 * Clear EVERY patch assignment: strip all chain entries (fixtures, strands,
 * gaps) from every port of every controller, returning the rig to the
 * fully-unpatched state. Controllers and their ports are KEPT (the
 * topology stands); only the bindings are wiped. Returns the count of
 * removed chain entries plus the named fixtures/strands that became
 * unmapped, for a loud confirmation (codex P0 — no silent wipe).
 *
 * @param {Object} registry
 * @returns {{ entriesCleared: number, freed: string[] }}
 */
export function clearAllPatches(registry) {
  let entriesCleared = 0;
  const freed = [];
  if (!registry || !Array.isArray(registry.controllers)) return { entriesCleared, freed };
  for (const controller of registry.controllers) {
    for (const port of controller.ports) {
      for (const entry of port.chain) {
        entriesCleared += 1;
        const name = entryFixtureName(entry);
        if (name !== null) freed.push(name);
      }
      port.chain.length = 0;
    }
  }
  return { entriesCleared, freed };
}

// ── LED port → physical board output (report 20260725_70) ───────────────
// `port.output` is the 1-based PHYSICAL board output a port row drives. The
// device's `strands[]` array is 0-based, and the conversion happens in EXACTLY
// one place — here — so no caller ever re-invents a `- 1`.

/**
 * The device `strands[]` index for an LED port row: `port.output - 1`.
 *
 * THROWS on a port with no integer `output`. Every port that came through
 * `createControllerRegistry` carries one (absent = identity-migrated at load),
 * so a missing field means a hand-built object bypassed the loader — guessing
 * an index there would silently address the wrong physical strand (codex P0).
 *
 * @param {Object} port
 * @returns {number} 0-based device output index
 */
export function ledOutputIndexForPort(port) {
  if (!port || typeof port !== 'object' || !Number.isInteger(port.output)) {
    throw new Error('[Controllers] ledOutputIndexForPort: LED port ' +
      `${JSON.stringify(port && port.port)} has no integer 'output' — the physical board output ` +
      'it drives is unknown; load the controller through createControllerRegistry (which ' +
      'materializes the identity default) rather than guessing an index');
  }
  return port.output - 1;
}

/**
 * The 1-based board output a NEW port row on an LED card should drive: the
 * lowest output not already claimed by another port on this card. On a fresh
 * card this reproduces the pre-selector behaviour exactly (port N → output N).
 * Throws when every output up to the device ceiling is claimed.
 */
export function nextLedOutputNumber(controller) {
  if (!controller || !Array.isArray(controller.ports)) {
    throw new Error('[Controllers] nextLedOutputNumber: controller.ports must be an array');
  }
  const taken = new Set(controller.ports.map((p) => p && p.output).filter(Number.isInteger));
  for (let n = 1; n <= LED_MAX_OUTPUTS; n++) {
    if (!taken.has(n)) return n;
  }
  throw new Error(`[Controllers] '${controller.name || 'LED controller'}' already drives all ` +
    `${LED_MAX_OUTPUTS} board output(s) — a MarsinLED addresses at most ${LED_MAX_OUTPUTS} ` +
    'outputs (docs/41 §4.2). Free one before adding a port.');
}

/**
 * The persisted parked universe for a 0-based device output index, or null.
 * A parked output is ENABLED on the board with no card port driving it: it
 * carries a universe nobody routes to, so it receives no packets and sits dark.
 */
export function parkedUniverseFor(controller, outputIndex) {
  if (!Number.isInteger(outputIndex) || outputIndex < 0) {
    throw new Error(`[Controllers] parkedUniverseFor: outputIndex ${outputIndex} must be a ` +
      'non-negative integer (0-based device strands[] index)');
  }
  const entry = (controller && controller.parkedOutputs || [])
    .find((p) => p.output === outputIndex + 1);
  return entry ? entry.universe : null;
}

/** Persist (or move) a parked universe for a 0-based device output index. */
export function setParkedUniverse(controller, outputIndex, universe) {
  if (!Number.isInteger(outputIndex) || outputIndex < 0 || outputIndex >= LED_MAX_OUTPUTS) {
    throw new Error(`[Controllers] setParkedUniverse: outputIndex ${outputIndex} must be in ` +
      `0–${LED_MAX_OUTPUTS - 1}`);
  }
  if (!Number.isInteger(universe) || universe < 1 || universe > MAX_UNIVERSE) {
    throw new Error(`[Controllers] setParkedUniverse: universe ${universe} must be an integer ` +
      `in 1–${MAX_UNIVERSE}`);
  }
  if (!Array.isArray(controller.parkedOutputs)) controller.parkedOutputs = [];
  const output = outputIndex + 1;
  const existing = controller.parkedOutputs.find((p) => p.output === output);
  if (existing) existing.universe = universe;
  else controller.parkedOutputs.push({ output, universe });
  controller.parkedOutputs.sort((a, b) => a.output - b.output);
  return controller.parkedOutputs;
}

/** Drop the parked entry for a 0-based device output index (a port now drives it). */
export function clearParkedUniverse(controller, outputIndex) {
  if (!Array.isArray(controller.parkedOutputs)) return false;
  const output = outputIndex + 1;
  const at = controller.parkedOutputs.findIndex((p) => p.output === output);
  if (at === -1) return false;
  controller.parkedOutputs.splice(at, 1);
  if (controller.parkedOutputs.length === 0) delete controller.parkedOutputs;
  return true;
}

/**
 * The port number the next `+port` on an LED controller should take: the LOWEST
 * free port-ROW slot in 1…LED_MAX_OUTPUTS, not `max + 1`.
 *
 * WHY (operator report 2026-07-29: "I can remove, but not add one back in").
 * The port number used to BE the physical device output, so deleting output 2 of
 * [1,2,3] and pressing `+port` minted port 4 — which on a 4-output board
 * addressed the FOURTH output while output 2 stayed permanently unreachable.
 * Since report 20260725_70 the physical output is `port.output` (its own
 * selector) and the port number is just a stable ROW IDENTITY — but the
 * lowest-free rule stays: it keeps the rows tidy, keeps `P1 P2 P3` stable across
 * a delete + re-add, and on a fresh card it still lands port N on output N.
 *
 * Throws when every slot up to the device ceiling is taken — a 17th output cannot
 * be addressed by any MarsinLED, and silently minting a dead port is exactly the
 * kind of quiet clamp the codex forbids (P0).
 *
 * Pure (no registry, no allocation) so it is unit-testable directly.
 *
 * @param {Object} controller
 * @returns {number} 1-based output slot
 */
export function nextLedOutputPortNumber(controller) {
  if (!controller || !Array.isArray(controller.ports)) {
    throw new Error('[Controllers] nextLedOutputPortNumber: controller.ports must be an array');
  }
  const taken = new Set(controller.ports.map((p) => p && p.port));
  for (let n = 1; n <= LED_MAX_OUTPUTS; n++) {
    if (!taken.has(n)) return n;
  }
  throw new Error(`[Controllers] '${controller.name || 'LED controller'}' already has all ` +
    `${LED_MAX_OUTPUTS} output(s) — a MarsinLED addresses at most ${LED_MAX_OUTPUTS} outputs ` +
    '(device /api/config accepts 1–16 strands, docs/41 §4.2). Delete an output before adding one.');
}

export function addPort(registry, controller) {
  // LED controllers: a port is a physical device OUTPUT, so re-fill the lowest
  // free slot (and refuse past the device ceiling). DMX controllers keep the
  // append-only `max + 1` numbering — their port numbers are chain labels, not
  // hardware output indices, and holes there are harmless by design.
  const portNum = isLedController(controller)
    ? nextLedOutputPortNumber(controller)
    : controller.ports.reduce((m, p) => Math.max(m, p.port), 0) + 1;
  const universe = nextFreeUniverse(registry);
  if (universe > MAX_UNIVERSE) {
    throw new Error(`[Controllers] Universe allocation exhausted (next would be ` +
      `${universe} > ${MAX_UNIVERSE})`);
  }
  registry.nextUniverse = universe + 1;
  const port = { port: portNum, universe, startAddress: 1, chain: [] };
  // LED cards: the new row drives the lowest board output no other port claims
  // (report 20260725_70 §1.4) — identical to the pre-selector behaviour on a
  // fresh card, and never a duplicate on a card with a crossed mapping.
  if (isLedController(controller)) port.output = nextLedOutputNumber(controller);
  // Insert in port-number order so a re-filled LED output slot renders where the
  // hardware output actually sits (P1 P2 P3, not P1 P3 P2). Appending is still
  // exactly what happens for the append-only DMX numbering, and for a fresh
  // controller seeded 1..n — the scan finds no larger port and falls through.
  const at = controller.ports.findIndex((p) => p && p.port > portNum);
  if (at === -1) controller.ports.push(port);
  else controller.ports.splice(at, 0, port);
  return port;
}

/** Remove a controller; returns the fixture names that became unmapped. */
export function removeController(registry, controller) {
  const freed = [];
  for (const port of controller.ports) {
    for (const entry of port.chain) {
      const name = entryFixtureName(entry);
      if (name !== null) freed.push(name);
    }
  }
  const i = registry.controllers.indexOf(controller);
  if (i >= 0) registry.controllers.splice(i, 1);
  return freed;
}

/** Remove a port; returns the fixture names that became unmapped. */
export function removePort(registry, controller, port) {
  const freed = [];
  for (const entry of port.chain) {
    const name = entryFixtureName(entry);
    if (name !== null) freed.push(name);
  }
  const i = controller.ports.indexOf(port);
  if (i >= 0) controller.ports.splice(i, 1);
  return freed;
}

/**
 * Append fixtures to a port's chain, in the given order. Names already
 * mapped anywhere are REJECTED, never silently skipped or moved
 * (docs/33 Flow A). Returns { added, rejected: [{name, where}] }.
 */
export function appendFixtures(registry, port, names) {
  const mapped = mappedFixtures(registry);
  const added = [];
  const rejected = [];
  for (const name of names) {
    const hit = mapped.get(name);
    if (hit) {
      rejected.push({ name, where: `${hit.controller.name} · Port ${hit.port.port}` });
      continue;
    }
    port.chain.push(name);
    mapped.set(name, { controller: null, port });
    added.push(name);
  }
  return { added, rejected };
}

/** Remove one fixture (by name) from whatever chain holds it. */
export function unmapFixture(registry, name) {
  for (const controller of registry.controllers) {
    for (const port of controller.ports) {
      const i = port.chain.findIndex(e => entryFixtureName(e) === name);
      if (i >= 0) {
        port.chain.splice(i, 1);
        return true;
      }
    }
  }
  return false;
}

/**
 * Rename hygiene, step 1 of 2 — ENUMERATE (read-only) everything the
 * registry maps under a set of fixture names. This is what makes a rename
 * *checkable*: the caller can print one line per fixture naming exactly
 * what is about to be freed (controller, IP, port, universe, address)
 * before anything is mutated (operator ruling 2026-07-29).
 *
 * `names` is any iterable of strings. Order follows the registry walk
 * (controller → port → chain position), which is the operator's cable
 * order — not the order the caller happened to pass.
 *
 * @returns {Array<{fixture: string, controllerName: string, controllerIp: string,
 *   port: number, universe: number, address: number}>}
 */
export function describeFixtureMappings(registry, names) {
  const wanted = new Set(names);
  const rows = [];
  if (!registryIsActive(registry) || wanted.size === 0) return rows;
  for (const controller of registry.controllers) {
    for (const port of controller.ports) {
      for (const entry of port.chain) {
        const name = entryFixtureName(entry);
        if (name === null || !wanted.has(name)) continue;
        rows.push({
          fixture: name,
          controllerName: controller.name || '',
          controllerIp: controller.ip || '',
          port: port.port,
          universe: port.universe || 0,
          address: isPinnedEntry(entry) && Number.isInteger(entry.at) ? entry.at : 0,
        });
      }
    }
  }
  return rows;
}

/**
 * Rename hygiene, step 2 of 2 — INVALIDATE the mapping of every listed
 * fixture name and return the rows describing what was freed, so the
 * caller reports it fixture by fixture.
 *
 * This is the DEFAULT rename policy (operator ruling 2026-07-29): a
 * renamed fixture comes out honestly UNMAPPED. Addresses are absolute
 * (docs/33 decision 19), so each entry simply drops and the freed
 * channels become a visible hole in the universe map — nothing else
 * shifts, and nothing is silently carried to the new name. The opt-in
 * migrate escape hatch is `renameFixtureInChains` below, still gated.
 *
 * THROWS if an enumerated entry cannot be removed — an enumerate/remove
 * disagreement means the registry moved under us, and half an
 * invalidation is exactly the silent-partial state the codex forbids.
 */
export function invalidateFixtureMappings(registry, names) {
  const rows = describeFixtureMappings(registry, names);
  for (const row of rows) {
    if (!unmapFixture(registry, row.fixture)) {
      throw new Error(`invalidateFixtureMappings: '${row.fixture}' was enumerated in a ` +
        'chain but could not be unmapped — the registry changed mid-invalidation.');
    }
  }
  return rows;
}

/** Reorder a chain entry within its port. */
export function moveChainEntry(port, fromIndex, toIndex) {
  if (fromIndex === toIndex) return;
  const [entry] = port.chain.splice(fromIndex, 1);
  port.chain.splice(toIndex, 0, entry);
}

/**
 * Rename MIGRATION (opt-in, NOT the default): moves a fixture's chain
 * reference to a new name atomically, keeping its address byte-identical.
 *
 * STILL NO PRODUCTION CALLER, and that is deliberate. The operator's
 * ruling (2026-07-29) makes CHECK + INVALIDATE the default rename
 * policy — see `invalidateFixtureMappings` above, which every rename
 * path in gui_builder now calls. Silently carrying an address to a new
 * name is exactly what the ruling forbids.
 *
 * This function is the machinery for the explicit, operator-gated
 * "⇄ Migrate addresses to new name" affordance (plan 20260725_44 step
 * 11b, gate §5 Q4 — unanswered, so unbuilt). Wire it ONLY behind that
 * opt-in; never into the default path.
 */
export function renameFixtureInChains(registry, oldName, newName) {
  if (!registryIsActive(registry) || oldName === newName) return false;
  for (const controller of registry.controllers) {
    for (const port of controller.ports) {
      for (let i = 0; i < port.chain.length; i++) {
        const entry = port.chain[i];
        if (typeof entry === 'string' && entry === oldName) {
          port.chain[i] = newName;
          return true;
        }
        if (isPinnedEntry(entry) && entry.fixture === oldName) {
          entry.fixture = newName;
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * One-time conversion of LEGACY packed chains (string entries and gaps
 * without `at`, addressed by chain order from the port's old
 * startAddress) into the allocation model's absolute entries
 * ({fixture, at} / {gap, at}) — at exactly the addresses the old
 * packing derived, so upgrading moves nothing. Idempotent: ports with
 * no legacy entries are untouched beyond dropping the now-meaningless
 * startAddress. An entry whose footprint cannot be proven (missing
 * fixture or definition) STOPS migration for the rest of its chain —
 * addresses after it were always undefined; the projection flags the
 * stragglers loudly (`unallocated`) and the next call retries. Effects
 * strings convert to their config.yaml pin (or at: 0 → loud no_pin),
 * mirroring what the panel would write.
 * Returns the migrated fixture names for the caller to log.
 */
export function migrateLegacyChains(registry, configsByName, pins) {
  const migrated = [];
  for (const controller of registry.controllers) {
    for (const port of controller.ports) {
      const isEffectsPort = port.universe === EFFECTS_UNIVERSE;
      const hasLegacy = port.chain.some(e =>
        typeof e === 'string' || (isGapEntry(e) && !Number.isInteger(e.at)));
      if (!hasLegacy) {
        delete port.startAddress;
        continue;
      }
      if (isEffectsPort) continue; // packed entries on U1 were invalid then and now

      // ATOMIC per port: resolve EVERY legacy entry first, apply only
      // if all succeed. A partial conversion would poison a later
      // retry — the packing cursor cannot resume past converted
      // entries without misreading operator manual pins (which never
      // advanced the old cursor).
      let cursor = Number.isInteger(port.startAddress) ? port.startAddress : 1;
      const plan = []; // [index, replacementEntry, label]
      let resolvable = true;
      for (let i = 0; i < port.chain.length; i++) {
        const entry = port.chain[i];
        if (isGapEntry(entry)) {
          if (Number.isInteger(entry.at)) continue; // already absolute — no cursor effect then
          plan.push([i, { gap: entry.gap, at: cursor }, `(${entry.gap}-ch gap @${cursor})`]);
          cursor += entry.gap;
          continue;
        }
        if (typeof entry === 'string') {
          const config = configsByName.get(entry);
          const fixtureType = config ? (config.fixtureType || config.type || '') : '';
          if (isGlobalEffect(fixtureType)) {
            // Packed effects were invalid in the old model too — pin
            // them the way the panel would (they held no packed
            // channels, so the cursor is unaffected).
            const pin = pins ? pins[fixtureType] : undefined;
            plan.push([i, { fixture: entry, at: pin ? pin.address : 0 }, entry]);
            continue;
          }
          if (!config || !getDefinition(fixtureType)) {
            // Footprint unknowable — old packing addresses after it
            // were always undefined. Never guess: leave the WHOLE port
            // legacy and retry on the next call.
            resolvable = false;
            break;
          }
          plan.push([i, { fixture: entry, at: cursor }, entry]);
          cursor += getFootprint(config);
          continue;
        }
        // Pinned entries held no packed channels in the old model.
      }
      if (!resolvable) continue;
      for (const [i, replacement, label] of plan) {
        port.chain[i] = replacement;
        migrated.push(label);
      }
      delete port.startAddress;
    }
  }
  return migrated;
}

// ── LED projection (strand → sequential pixel addressing) ───────────────

/**
 * Project every LED controller's bound strands onto sequential sACN
 * pixel addresses. Each strand pixel `k` lands at
 *   universe = base + floor((startAddr-1 + (pixelOffset+k)*stride) / 512)
 *   addr     = ((startAddr-1 + (pixelOffset+k)*stride) % 512) + 1
 * where `pixelOffset` accumulates across the strands earlier in the
 * controller's chain. A strand whose pixel would straddle a 512-byte
 * universe boundary is bumped to the next universe wholesale (LED
 * controllers address pixels, never split one across universes) — the
 * straightforward WLED/E1.31 layout.
 *
 * The strand's `at` from the chain entry (if present) pins its START
 * address explicitly; otherwise it packs after the previous strand.
 *
 * Returns Map<strandName, {
 *   controllerId, controllerIp, universe, addr, stride, order, whiteMode,
 *   footprint, ledCount
 * }> for every strand bound to an LED controller. Strands on a bad-IP
 * controller still project (so the sim can show them) but are flagged via
 * `violations`. UNBOUND strands are simply absent from the map — the
 * exporter turns that into a LOUD unpatched marker (never a silent skip).
 *
 * @param {Object} registry
 * @param {Map<string, number>} strandLedCounts - strand name → ledCount
 */
export function computeLedProjection(registry, strandLedCounts) {
  const out = new Map();
  const violations = [];
  if (!registryIsActive(registry)) return { fields: out, violations };

  const counts = strandLedCounts instanceof Map
    ? strandLedCounts
    : new Map(Object.entries(strandLedCounts || {}));

  for (const controller of registry.controllers) {
    if (!isLedController(controller)) continue;
    const led = controller.led || normalizeLedConfig(null, controller.name);
    const ipOk = isValidIp(controller.ip);
    if (!ipOk) {
      violations.push({
        code: 'led_bad_ip',
        controllerId: controller.id,
        message: `LED controller '${controller.name}' has a malformed or missing IP ` +
          `('${controller.ip}') — its strands project unpatched`,
      });
    }
    const ordinal = registry.controllers.indexOf(controller) + 1;

    for (const port of controller.ports) {
      // Each port resets to the controller's base/startAddr lane unless
      // the port carries its own universe — a port IS a physical data
      // line on the LED controller, so its universe is the lane base.
      const baseUniverse = (led.baseUniverse && led.baseUniverse > 0)
        ? led.baseUniverse
        : (Number.isInteger(port.universe) ? port.universe : 2);
      let cursorByte = (led.startAddr - 1); // 0-based channel offset within baseUniverse
      let universeOffset = 0;

      for (const entry of port.chain) {
        const name = entryFixtureName(entry);
        if (name === null) continue;
        const ledCount = counts.get(name);
        if (!Number.isInteger(ledCount) || ledCount < 1) {
          violations.push({
            code: 'led_unknown_strand',
            controllerId: controller.id,
            message: `LED controller '${controller.name}': chain entry '${name}' is not a known ` +
              'LED strand (or has no ledCount) — it projects unpatched',
          });
          continue;
        }
        // Explicit per-strand START pin (chain entry `at`, absolute byte
        // within its universe). Otherwise pack after the previous strand.
        let startUniverse = baseUniverse + universeOffset;
        let startByte = cursorByte;
        if (isPinnedEntry(entry) && Number.isInteger(entry.at) && entry.at > 0) {
          startByte = entry.at - 1;
        }
        // A strand never splits a pixel across a universe: if the whole
        // run won't fit from startByte, advance to the next universe.
        const footprint = ledCount * led.stride;
        if (startByte + led.stride > DMX_UNIVERSE_SIZE) {
          startUniverse += 1;
          universeOffset += 1;
          startByte = 0;
        }
        out.set(name, {
          controllerId: ordinal,
          controllerIp: ipOk ? controller.ip : '',
          universe: startUniverse,
          addr: startByte + 1, // 1-based start address
          stride: led.stride,
          order: led.order,
          whiteMode: led.whiteMode,
          // Scene-level LED colour-encode overrides (null unless the
          // controller sets one) — ride through to the exported pixels.
          wire: led.wire || null,
          footprint,
          ledCount,
        });
        noteUniverseUsed(registry, startUniverse);
        // Advance the cursor across this strand, wrapping universes by
        // whole pixels (a pixel that won't fit rolls to the next universe).
        let byte = startByte;
        let uni = startUniverse - baseUniverse; // relative
        for (let k = 0; k < ledCount; k++) {
          if (byte + led.stride > DMX_UNIVERSE_SIZE) {
            uni += 1;
            byte = 0;
          }
          byte += led.stride;
        }
        universeOffset = uni;
        cursorByte = byte;
      }
    }
  }
  return { fields: out, violations };
}

// ── Projection (allocation model) ───────────────────────────────────────

/**
 * Compute the full projection of a registry onto a set of fixture
 * configs (allocation model, docs/33 decision 19).
 *
 * @param {Object} registry
 * @param {Map<string, Object>} configsByName - fixture name → config
 * @param {Object} pins - config.yaml global_effects table:
 *                        { <fixtureType>: { universe, address } }
 * @returns {{
 *   fields: Map<string, {controllerIp, dmxUniverse, dmxAddress, controllerId}>,
 *   violations: Array<{code, message, controllerId, port}>,
 *   portLayouts: Map<string, Array<{entry, name, address, footprint, valid}>>,
 *   universeEnds: Map<number, number>,
 *   universeMaps: Map<number, Array<{start, end, name, item, controllerId, portNum, effect}>>,
 * }}
 *
 * Every MAPPED fixture gets a `fields` entry — its stored absolute
 * address when provably sendable, unpatched (''/0/0) otherwise. The
 * `fields` controllerId is the owning controller's PANEL ORDINAL
 * (1-based array position, decision 20); everywhere else in this
 * result (violations, portLayouts keys, universeMaps claims) the
 * stable internal id is used.
 * `portLayouts` (key `<controllerId>:<portNum>`) carries per-entry
 * validity for the panel UI; `universeMaps` is the full per-universe
 * occupancy (sorted, valid claims only) for the universe bars and the
 * allocator; `universeEnds` is its running end per universe.
 */
export function computeProjection(registry, configsByName, pins) {
  const fields = new Map();
  const violations = new Map(); // key → violation (dedup)
  const portLayouts = new Map();

  const addViolation = (code, message, controller, port) => {
    const key = `${code}|${controller ? controller.id : ''}|${port ? port.port : ''}|${message}`;
    if (!violations.has(key)) {
      violations.set(key, {
        code,
        message,
        controllerId: controller ? controller.id : 0,
        port: port ? port.port : 0,
      });
    }
  };

  const unpatch = (name) => {
    fields.set(name, { controllerIp: '', dmxUniverse: 0, dmxAddress: 0, controllerId: 0 });
  };

  // ── Projected controllerId: the PANEL ORDINAL, not the stable id ─────
  // The operator matches fixture cards / patches.yaml / the engine model
  // against the Controller Mapping panel BY EYE, so the projected
  // controllerId is the controller's 1-based position in the panel list
  // (registry.controllers array order) — docs/33 decision 20 (operator
  // 2026-06-12). Deleting or reordering controllers renumbers projected
  // ids on the next projection; that is the intent. The stable internal
  // `controller.id` (monotonic, never reused) still keys portLayouts,
  // violations, universeMaps claims, and panel collapse state.
  const ordinalOf = new Map(registry.controllers.map((controller, i) => [controller, i + 1]));

  // ── Controller-level checks: IP format + uniqueness ──────────────────
  const badControllers = new Set();
  const ipOwners = new Map();
  for (const controller of registry.controllers) {
    if (!isValidIp(controller.ip)) {
      addViolation('bad_ip', `Controller '${controller.name}' has a malformed or missing IP ` +
        `('${controller.ip}') — its fixtures project unpatched`, controller, null);
      badControllers.add(controller);
      continue;
    }
    if (ipOwners.has(controller.ip)) {
      const other = ipOwners.get(controller.ip);
      addViolation('dup_ip', `Controllers '${other.name}' and '${controller.name}' share IP ` +
        `${controller.ip} — '${controller.name}' projects unpatched`, controller, null);
      badControllers.add(controller);
      continue;
    }
    ipOwners.set(controller.ip, controller);
  }

  // ── Port iteration order ─────────────────────────────────────────────
  // The SAME universe carried by two different controllers is explicitly
  // ALLOWED (operator decision 2026-06-15): controllers are independent
  // sACN unicast targets, so a shared universe number is not a conflict.
  // The only real hazard — two claims landing on overlapping CHANNELS
  // within a universe — is caught by the per-universe overlap sweep
  // below, which aggregates occupancy across ALL controllers. Ports are
  // iterated in stable id order purely for deterministic claim ordering.
  // LED controllers patch strands via computeLedProjection, NOT the DMX
  // allocation model — their chain entries are strand names, not DMX
  // fixtures, so they must not flow through the DMX overlap/footprint
  // sweep (they would all surface as 'orphan' against the fixture set).
  const allPortsSorted = [];
  for (const controller of [...registry.controllers].sort((a, b) => a.id - b.id)) {
    if (isLedController(controller)) continue;
    for (const port of controller.ports) allPortsSorted.push({ controller, port });
  }

  // ── Per-entry projection (allocation model, docs/33 decision 19) ────
  // Every fixture entry carries its ABSOLUTE address ({fixture, at});
  // gaps carry {gap, at}. Nothing is derived from chain order — ports
  // are pure cable topology, exactly like the physical rig (addresses
  // live on the fixtures, the daisy chain only carries signal). The
  // projection validates each entry, builds the FULL per-universe
  // occupancy map (rendered as the universe bar on every port), and
  // flags overlaps as WARNINGS — every address is explicit operator
  // state, so a conflict paints red and stands, it is never silently
  // unpatched. Hard unpatches that remain: outside 1–512, U1 rules,
  // missing definition, orphan, bad/duplicate IP, and unmigrated legacy
  // entries.
  const occupancy = new Map();  // universe → claims for the map + overlap sweep
  const pinnedOccupancy = [];   // valid effects pins (gang-fire-aware check)

  const claim = (universe, start, end, name, item, controller, port, effect) => {
    if (!occupancy.has(universe)) occupancy.set(universe, []);
    occupancy.get(universe).push({
      start, end, name, item,
      controllerId: controller.id, controllerName: controller.name, portNum: port.port,
      effect: !!effect,
    });
  };

  for (const { controller, port } of allPortsSorted) {
    const layoutKey = `${controller.id}:${port.port}`;
    const layout = [];
    portLayouts.set(layoutKey, layout);

    const universeOutOfRange = port.universe > MAX_UNIVERSE;
    if (universeOutOfRange) {
      addViolation('universe_range', `${controller.name} port ${port.port}: universe ` +
        `${port.universe} is outside 1–${MAX_UNIVERSE} (the sACN limit) — its fixtures ` +
        'project unpatched; fix the universe number', controller, port);
    }
    const portDead = badControllers.has(controller) || universeOutOfRange;
    const isEffectsPort = port.universe === EFFECTS_UNIVERSE;

    for (const entry of port.chain) {
      const name = entryFixtureName(entry);

      // ── Gaps: absolute channel reservations ({gap, at}) for real
      // hardware not modeled in the sim ─────────────────────────────
      if (isGapEntry(entry)) {
        if (isEffectsPort) {
          addViolation('non_effect_on_u1', `${controller.name} port ${port.port}: a ` +
            `${entry.gap}-ch gap on universe ${EFFECTS_UNIVERSE} (effects-only, pinned ` +
            'addresses) reserves nothing', controller, port);
          layout.push({ entry, name: null, address: entry.at || 0, footprint: entry.gap, valid: false });
          continue;
        }
        if (!Number.isInteger(entry.at)) {
          addViolation('unallocated', `${controller.name} port ${port.port}: a ${entry.gap}-ch ` +
            'gap has no allocated address (legacy packed entry) — boot migration assigns one; ' +
            'if this persists, remove and re-add the gap', controller, port);
          layout.push({ entry, name: null, address: 0, footprint: entry.gap, valid: false });
          continue;
        }
        const gapEnd = entry.at + entry.gap - 1;
        if (entry.at < 1 || gapEnd > DMX_UNIVERSE_SIZE) {
          addViolation('pin_overflow', `${controller.name} port ${port.port}: gap @${entry.at} ` +
            `spans ch ${entry.at}–${gapEnd} — outside 1–${DMX_UNIVERSE_SIZE}; it reserves nothing`,
          controller, port);
          layout.push({ entry, name: null, address: entry.at, footprint: entry.gap, valid: false });
          continue;
        }
        const gapItem = { entry, name: null, address: entry.at, footprint: entry.gap, valid: !portDead };
        layout.push(gapItem);
        if (!portDead) claim(port.universe, entry.at, gapEnd, null, gapItem, controller, port);
        continue;
      }

      // ── Legacy packed (string) entries: the old model derived their
      // addresses from chain order; migrateLegacyChains() converts
      // them at boot. One surviving here means migration could not
      // prove its footprint (missing fixture/definition) or the file
      // was hand-edited mid-session. Loud + unpatched, never guessed.
      if (typeof entry === 'string') {
        addViolation('unallocated', `'${entry}' on ${controller.name} port ${port.port} has no ` +
          'allocated address (legacy packed entry) — migration runs at boot; if this persists ' +
          'the fixture or its definition is missing: fix it or re-add via the panel',
        controller, port);
        layout.push({ entry, name, address: 0, footprint: 0, valid: false });
        unpatch(name);
        continue;
      }

      // ── Pinned entries ({fixture, at}) ────────────────────────────
      const config = configsByName.get(name);
      if (!config) {
        addViolation('orphan', `'${name}' on ${controller.name} port ${port.port} does not ` +
          'resolve to a fixture — drop the entry or fix the name', controller, port);
        layout.push({ entry, name, address: entry.at || 0, footprint: 0, valid: false });
        continue;
      }

      const footprint = getFootprint(config);
      const fixtureType = config.fixtureType || config.type || '';
      const isEffect = isGlobalEffect(fixtureType);

      // Effects: the address is ALWAYS the config.yaml pin on the
      // effects universe — the entry records the physical cabling
      // (operator decision 2026-06-11). Identical pin addresses
      // gang-fire by design; the dedicated check below flags only
      // genuine config errors.
      if (isEffect) {
        const pin = pins ? pins[fixtureType] : undefined;
        if (!pin || !Number.isInteger(pin.address)) {
          addViolation('no_pin', `'${name}' (${fixtureType}) has no pin in config.yaml ` +
            'global_effects — it projects unpatched', controller, port);
          layout.push({ entry, name, address: 0, footprint, valid: false, pinned: true });
          unpatch(name);
          continue;
        }
        if (entry.at !== pin.address) {
          addViolation('pin_mismatch', `'${name}' (${fixtureType}) must be pinned at ` +
            `U${pin.universe}:${pin.address} (config.yaml global_effects), found @${entry.at} — ` +
            'it projects unpatched', controller, port);
          layout.push({ entry, name, address: 0, footprint, valid: false, pinned: true });
          unpatch(name);
          continue;
        }
        // Only a controller-level IP problem invalidates an effects
        // pin — its universe is independent of the port's.
        if (badControllers.has(controller)) {
          layout.push({ entry, name, address: pin.address, footprint, valid: false, pinned: true });
          unpatch(name);
          continue;
        }
        const pinItem = {
          entry, name, address: pin.address, footprint, valid: true,
          pinned: true, pinUniverse: pin.universe,
        };
        layout.push(pinItem);
        fields.set(name, {
          controllerIp: controller.ip,
          dmxUniverse: pin.universe,
          dmxAddress: pin.address,
          controllerId: ordinalOf.get(controller),
        });
        pinnedOccupancy.push({
          controller, port, name, item: pinItem,
          universe: pin.universe, start: pin.address, end: pin.address + footprint - 1,
        });
        claim(pin.universe, pin.address, pin.address + footprint - 1, name, pinItem,
          controller, port, true);
        continue;
      }

      // Normal fixtures.
      if (isEffectsPort) {
        addViolation('non_effect_on_u1', `'${name}' is not a global effect but is mapped on ` +
          `universe ${EFFECTS_UNIVERSE} (effects-only) — it projects unpatched`, controller, port);
        layout.push({ entry, name, address: 0, footprint, valid: false, pinned: true, manual: true });
        unpatch(name);
        continue;
      }
      // The footprint must be REAL to know what the address occupies —
      // the no-guess rule (the silent 10-channel fallback scrambled a
      // real mapping once, 2026-06-12).
      if (!getDefinition(fixtureType)) {
        addViolation('no_definition', `'${name}' (${fixtureType || 'unknown type'}) has no ` +
          'registered fixture definition — footprint unknown, it projects unpatched. If this ' +
          'appears at boot, the definition registry was not initialized before projection.',
        controller, port);
        layout.push({ entry, name, address: entry.at, footprint: 0, valid: false, pinned: true, manual: true });
        unpatch(name);
        continue;
      }
      if (!Number.isInteger(entry.at) || entry.at < 1 ||
          entry.at + footprint - 1 > DMX_UNIVERSE_SIZE) {
        addViolation('pin_overflow', `'${name}' @${entry.at} spans ` +
          `ch ${entry.at}–${entry.at + footprint - 1} — outside 1–${DMX_UNIVERSE_SIZE}; ` +
          'it projects unpatched', controller, port);
        layout.push({ entry, name, address: entry.at, footprint, valid: false, pinned: true, manual: true });
        unpatch(name);
        continue;
      }
      // An address on a dead controller (bad/duplicate IP, or an
      // out-of-range universe) is unsendable — unlike a CONFLICT, this
      // is a hard unpatch.
      if (portDead) {
        layout.push({ entry, name, address: entry.at, footprint, valid: false, pinned: true, manual: true });
        unpatch(name);
        continue;
      }
      const item = {
        entry, name, address: entry.at, footprint, valid: true,
        pinned: true, manual: true, pinUniverse: port.universe,
      };
      layout.push(item);
      fields.set(name, {
        controllerIp: controller.ip,
        dmxUniverse: port.universe,
        dmxAddress: entry.at,
        controllerId: ordinalOf.get(controller),
      });
      claim(port.universe, entry.at, entry.at + footprint - 1, name, item, controller, port);
    }
  }

  // ── Effects-universe pin occupancy ────────────────────────────────────
  // IDENTICAL start addresses are ALLOWED by design: one address
  // gang-fires several effects at once (operator decision 2026-06-12,
  // "same address to start multiple foggers at the same time, always").
  // What IS flagged: a pin whose footprint runs past the universe end
  // (pin_overflow) and pins at DIFFERENT addresses whose footprints
  // collide (pin_overlap) — both are config.yaml global_effects errors.
  // Deterministic loser: the higher address (sorted, ties by name).
  pinnedOccupancy.sort((a, b) =>
    a.universe - b.universe || a.start - b.start || a.name.localeCompare(b.name));
  for (let i = 0; i < pinnedOccupancy.length; i++) {
    const p = pinnedOccupancy[i];
    if (p.end > DMX_UNIVERSE_SIZE) {
      addViolation('pin_overflow', `'${p.name}' pin U${p.universe}:${p.start} spans ` +
        `ch ${p.start}–${p.end}, past ${DMX_UNIVERSE_SIZE} — fix config.yaml global_effects; ` +
        'it projects unpatched', p.controller, p.port);
      p.item.valid = false;
      unpatch(p.name);
      continue;
    }
    for (let j = i - 1; j >= 0; j--) {
      const q = pinnedOccupancy[j];
      if (q.universe !== p.universe) break; // sorted: earlier universes only
      if (!q.item.valid || q.start === p.start) continue; // shared trigger address = gang-fire
      if (p.start <= q.end) {
        addViolation('pin_overlap', `U${p.universe}: '${p.name}' pin @${p.start} lands inside ` +
          `'${q.name}' (ch ${q.start}–${q.end}) — fix config.yaml global_effects; ` +
          `'${p.name}' projects unpatched`, p.controller, p.port);
        p.item.valid = false;
        unpatch(p.name);
        break;
      }
    }
  }

  // ── Full universe maps + overlap sweep (WARN, never unpatch) ─────────
  // The complete occupancy of every universe across ALL controllers —
  // the operator's "universe map": rendered as the bar on every port,
  // the allocator's source of truth (universeEnds = one past the last
  // claim), and the overlap detector. Addresses are explicit, so an
  // overlap marks BOTH claims conflicted (red) and raises a violation,
  // but everything keeps projecting — the operator resolves it
  // (operator decision 2026-06-12). Effects claims are exempt here
  // (gang-fire); they have their own check above.
  const universeMaps = new Map();
  const universeEnds = new Map();
  for (const [universe, claims] of occupancy) {
    const live = claims.filter(c => c.item.valid);
    live.sort((a, b) => a.start - b.start || (a.name || '').localeCompare(b.name || ''));
    universeMaps.set(universe, live);
    let end = 0;
    let runEnd = 0;
    let runClaim = null;
    for (const c of live) {
      end = Math.max(end, Math.min(c.end, DMX_UNIVERSE_SIZE));
      if (c.effect) continue;
      if (runClaim && c.start <= runEnd) {
        c.item.conflict = true;
        runClaim.item.conflict = true;
        const what = c.name ? `'${c.name}'` : `a ${c.end - c.start + 1}-ch gap`;
        const other = runClaim.name ? `'${runClaim.name}'` : `a gap`;
        addViolation('overlap', `U${universe}: ${what} (ch ${c.start}–${c.end}, ` +
          `${c.controllerName} P${c.portNum}) overlaps ${other} (ch ${runClaim.start}–` +
          `${runClaim.end}, ${runClaim.controllerName} P${runClaim.portNum}) — BOTH KEPT; ` +
          'fix one address', { id: c.controllerId }, { port: c.portNum });
      }
      if (c.end > runEnd) {
        runEnd = c.end;
        runClaim = c;
      }
    }
    if (end > 0) universeEnds.set(universe, end);
  }

  return { fields, violations: [...violations.values()], portLayouts, universeEnds, universeMaps };
}


/**
 * Project a registry onto live fixture configs (mutated in place) and
 * assign metadata. Only acts when the registry is active (≥1
 * controller) — with no mapping, stored patches.yaml fields stand.
 *
 * Metadata assignment (absorbed from the retired auto-patcher):
 *  - sectionId: per group, existing positive ids kept, new groups get
 *    the next free id;
 *  - fixtureId: existing positive ids kept, missing ones get the next
 *    free monotonic id;
 *  - controllerId: derived (mapped → controller's panel ordinal,
 *    1-based array position per docs/33 decision 20, unmapped → 0).
 *
 * section/fixture ids live in ONE id space SHARED with the LED strands:
 * `led_metadata.js::assignLedStrandMetadata` floors its counters at the
 * DMX max precisely so the two passes cannot mint the same id. That
 * makes `ledStrands` REQUIRED here — this pass has to floor over the
 * SAME union (DMX configs ∪ LED strands). Computing the max over DMX
 * configs alone is what produced report 20260725_4's secondary finding
 * 1: test_bench's TE Sign V3 A was minted at `sectionId 5 / fixtureId
 * 11`, byte-identical to LED_0's, so every consumer keyed on section or
 * fixture metadata (Dimmer Rack, per-section saved state, engine
 * section masks) treated two distinct fixtures as one. Handing in an
 * empty array for a scene that HAS strands silently re-opens that bug,
 * so a non-array argument throws (codex P0: fail loud, no fallback).
 *
 * Returns { violations, drift, migrated, collisions } — `drift` lists
 * fixtures whose stored fields differed from the projection;
 * `migrated` lists legacy packed entries converted to absolute
 * addresses this pass; `collisions` lists ids repaired because the
 * pre-fix pass had already baked a DMX id on top of a strand id (all
 * three logged loudly by callers).
 *
 * @param {Object} registry - the controller registry
 * @param {Array<Object>} configs - DMX fixture configs (mutated in place)
 * @param {Object} pins - global_effects pin table
 * @param {Array<Object>} ledStrands - params.ledStrands, READ ONLY here;
 *   the LED half of the shared section/fixture id space
 */
export function projectOntoConfigs(registry, configs, pins, ledStrands) {
  if (!Array.isArray(ledStrands)) {
    throw new Error(
      '[controller_registry] projectOntoConfigs: `ledStrands` is required and must be ' +
      'an array (pass [] only when the scene genuinely has no LED strands). DMX and LED ' +
      'section/fixture ids share ONE id space — without the strands this pass mints ids ' +
      'that collide with them (codex P0: fail loud, no fallback)');
  }
  if (!registryIsActive(registry)) {
    return { violations: [], drift: [], migrated: [], collisions: [] };
  }

  const configsByName = new Map();
  for (const config of configs) {
    if (config && typeof config.name === 'string' && config.name.length > 0) {
      configsByName.set(config.name, config);
    }
  }

  // Legacy packed chains convert (once, at their previously derived
  // addresses) before projecting — see migrateLegacyChains. The change
  // persists with the next normal save; until then every boot
  // re-migrates deterministically.
  const migrated = migrateLegacyChains(registry, configsByName, pins);

  const { fields, violations } = computeProjection(registry, configsByName, pins);
  const drift = [];

  for (const [name, config] of configsByName) {
    const projected = fields.get(name) ||
      { controllerIp: '', dmxUniverse: 0, dmxAddress: 0, controllerId: 0 };
    const before = {
      controllerIp: config.controllerIp || '',
      dmxUniverse: config.dmxUniverse || 0,
      dmxAddress: config.dmxAddress || 0,
      controllerId: config.controllerId || 0,
    };
    if (before.controllerIp !== projected.controllerIp ||
        before.dmxUniverse !== projected.dmxUniverse ||
        before.dmxAddress !== projected.dmxAddress ||
        before.controllerId !== projected.controllerId) {
      drift.push({ name, before, after: projected });
    }
    config.controllerIp = projected.controllerIp;
    config.dmxUniverse = projected.dmxUniverse;
    config.dmxAddress = projected.dmxAddress;
    config.controllerId = projected.controllerId;
  }

  // ── Metadata: sectionId per group, fixtureId monotonic ───────────────
  // Floors are the max over the DMX ∪ LED union — the SAME union
  // assignLedStrandMetadata floors on — so neither pass can mint an id
  // the other already owns. A gap is respected: the floor is the MAX,
  // never a count.
  const ledSectionOwner = new Map(); // sectionId -> owning strand name
  const ledFixtureOwner = new Map(); // fixtureId -> owning strand name
  let maxSectionId = 0;
  let maxFixtureId = 0;
  for (const strand of ledStrands) {
    if (!strand) continue;
    if (strand.sectionId > 0) {
      maxSectionId = Math.max(maxSectionId, strand.sectionId);
      if (!ledSectionOwner.has(strand.sectionId)) {
        ledSectionOwner.set(strand.sectionId, strand.name);
      }
    }
    if (strand.fixtureId > 0) {
      maxFixtureId = Math.max(maxFixtureId, strand.fixtureId);
      if (!ledFixtureOwner.has(strand.fixtureId)) {
        ledFixtureOwner.set(strand.fixtureId, strand.name);
      }
    }
  }
  for (const config of configsByName.values()) {
    if (config.sectionId > 0) maxSectionId = Math.max(maxSectionId, config.sectionId);
    if (config.fixtureId > 0) maxFixtureId = Math.max(maxFixtureId, config.fixtureId);
  }

  // One-time repair of collisions the PRE-FIX pass already baked into
  // stored scene data (test_bench TE Sign V3 A/B vs LED_0/LED_1).
  // Stickiness alone would preserve them forever, so a stored DMX id
  // that lands on a strand id is moved above the union max and REPORTED
  // — never silently kept, never silently swapped. The DMX side yields
  // because the LED pass mints with full knowledge of the DMX ids
  // (call order), so only the DMX side can ever have minted blind: the
  // repair undoes exactly the damage the bug caused. A whole section
  // moves together (keyed by group) so group↔section stays bijective;
  // a group-less config moves alone. Idempotent: once repaired the
  // intersection is empty and re-runs change nothing.
  const collisions = [];
  const repairedSections = new Map();
  for (const config of configsByName.values()) {
    if (config.sectionId > 0 && ledSectionOwner.has(config.sectionId)) {
      const key = config.group ? `g:${config.group}` : `f:${config.name}`;
      if (!repairedSections.has(key)) {
        maxSectionId += 1;
        repairedSections.set(key, maxSectionId);
      }
      const after = repairedSections.get(key);
      collisions.push({
        name: config.name, field: 'sectionId', before: config.sectionId,
        after, strand: ledSectionOwner.get(config.sectionId),
      });
      config.sectionId = after;
    }
    if (config.fixtureId > 0 && ledFixtureOwner.has(config.fixtureId)) {
      maxFixtureId += 1;
      collisions.push({
        name: config.name, field: 'fixtureId', before: config.fixtureId,
        after: maxFixtureId, strand: ledFixtureOwner.get(config.fixtureId),
      });
      config.fixtureId = maxFixtureId;
    }
  }

  // Seed the group→section map AFTER the repair, so a repaired group
  // hands its NEW id to every later member instead of resurrecting the
  // colliding one.
  const groupToSectionId = new Map();
  for (const config of configsByName.values()) {
    if (config.group && config.sectionId > 0 && !groupToSectionId.has(config.group)) {
      groupToSectionId.set(config.group, config.sectionId);
    }
  }
  for (const config of configsByName.values()) {
    if (config.group && (!config.sectionId || config.sectionId <= 0)) {
      if (!groupToSectionId.has(config.group)) {
        maxSectionId += 1;
        groupToSectionId.set(config.group, maxSectionId);
      }
      config.sectionId = groupToSectionId.get(config.group);
    }
    if (!config.fixtureId || config.fixtureId <= 0) {
      maxFixtureId += 1;
      config.fixtureId = maxFixtureId;
    }
  }

  return { violations, drift, migrated, collisions };
}
