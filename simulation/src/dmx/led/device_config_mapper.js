/**
 * device_config_mapper.js — PURE derivation of a MarsinLED device config from
 * the sim's LED controller state, plus the firmware's exact linear channel
 * layout. NO I/O: every function is a deterministic transform of its inputs.
 *
 * This is the correctness core of the LED integration (plan 20260709_0, phase
 * P2). The firmware maps incoming sACN channels LINEARLY across enabled strands
 * from a single `(dmx.universe, dmx.startAddress)` — there is NO per-output
 * universe on the device (docs/41 §3). computeLinearLayout reproduces that
 * algorithm byte-for-byte so the sim's sACN model and the hardware agree.
 *
 * Fail-loud everywhere (codex P0): a non-representable layout, a cap violation,
 * or a missing device snapshot THROWS with a precise message — never a silent
 * re-map or a fabricated hardware field.
 */

import {
  LED_CHANNEL_ORDERS,
  DMX_UNIVERSE_SIZE,
  MAX_UNIVERSE,
  CONTROLLER_TYPE_LED,
  entryFixtureName,
} from '../controller_registry.js';

const PER_OUTPUT_SPAN_MAX = 16;   // ≤16-universe window per controller (firmware rule)

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Bytes per pixel for a device colorOrder, from the shared LED_CHANNEL_ORDERS
 * table (single source of truth with the registry). THROWS on an unknown order
 * — never a silent default stride (that would mis-address every pixel).
 */
function bytesPerPixel(colorOrder, where) {
  const map = LED_CHANNEL_ORDERS[colorOrder];
  if (!map) {
    throw new Error(`[DeviceMapper] ${where}: unknown colorOrder '${colorOrder}' — expected one ` +
      `of ${Object.keys(LED_CHANNEL_ORDERS).join(', ')}`);
  }
  return Math.max(...Object.values(map));
}

// ── Device base universe (the ONE semantic change of Slice D) ─────────────────

/**
 * The device-linear BASE universe for a MarsinLED controller = the FIRST
 * ENABLED output's `port.universe` (ports in physical index order; "enabled" =
 * the port's chain carries ≥1 strand entry). The firmware streams one
 * contiguous linear layout from this base across the enabled outputs (docs/41
 * §3), so a manual per-output universe only re-anchors the BASE — it is the
 * operator's declared intent, and the linear layout stays the single truth for
 * patches/export/engine. This is the single source both the patch projection
 * and the device push read, so sim, patches.yaml, the engine model and the
 * hardware stay byte-for-byte in agreement.
 *
 * @param {Object} controller - sim LED controller (registry shape).
 * @returns {{universe: number, port: Object}|null} the first enabled port and
 *   its universe, or null when no output carries a strand (caller reports it).
 */
export function firstEnabledPortUniverse(controller) {
  if (!controller || !Array.isArray(controller.ports)) return null;
  const sorted = [...controller.ports].sort((a, b) => a.port - b.port);
  for (const port of sorted) {
    const hasStrand = (port.chain || []).some((e) => entryFixtureName(e) !== null);
    if (hasStrand) return { universe: port.universe, port };
  }
  return null;
}

/**
 * Build the synthetic `{strands, dmx}` the firmware would receive for a
 * controller — one strand entry per output (0..maxPort-1), enabled when the
 * port carries ≥1 strand with a known ledCount and count = Σ ledCounts, base
 * universe from `firstEnabledPortUniverse`. Shared by the per-port layout
 * preview (the derived line) and the manual-universe validation so both read
 * the exact same device-linear layout. Returns null when no output is enabled
 * (nothing to lay out).
 *
 * @param {Object} controller - sim LED controller (must carry a normalized led).
 * @param {Map|Object} strandCounts - strand name → ledCount.
 * @returns {{strands: Array<{colorOrder, count, enabled}>, dmx: {universe, startAddress}}|null}
 */
export function synthLinearConfig(controller, strandCounts) {
  const led = controller && controller.led;
  if (!led) return null;
  const base = firstEnabledPortUniverse(controller);
  if (!base) return null;
  const counts = strandCounts instanceof Map
    ? strandCounts : new Map(Object.entries(strandCounts || {}));
  const maxOutput = controller.ports.reduce((m, p) => Math.max(m, p.port), 0);
  const strands = [];
  for (let i = 0; i < maxOutput; i++) {
    const port = controller.ports.find((p) => p.port - 1 === i);
    let assigned = 0;
    if (port) {
      for (const entry of port.chain || []) {
        const name = entryFixtureName(entry);
        if (name === null) continue;
        const c = counts.get(name);
        if (Number.isInteger(c) && c > 0) assigned += c;
      }
    }
    strands.push({ colorOrder: led.order, count: assigned > 0 ? assigned : 1, enabled: assigned > 0 });
  }
  return { strands, dmx: { universe: base.universe, startAddress: led.startAddr } };
}

// ── Per-output universe plan (device-per-output DMX, not the linear model) ───

/**
 * Derive the PER-OUTPUT universe plan for a controller whose firmware supports
 * per-output DMX: each ENABLED device output (from the `/api/config` snapshot)
 * takes its controller port's `port.universe` (Slice S4), with start=1. Unlike
 * the linear model this assigns a DISTINCT universe per output — the firmware
 * addresses each strand from its own universe, channel 1.
 *
 * ALL-OR-NONE (firmware rule): every enabled device output MUST carry a universe.
 * A card can have FEWER port rows than the device has outputs, or a port left at
 * an invalid universe (≤0). Rather than fail, this AUTO-EXTENDS the plan: each
 * such enabled output is given the next free universe above the highest one
 * already assigned (contiguous), and a note is recorded in `warnings` so the UI
 * can surface it in the confirm dialog (addendum #4). `led.baseUniverse` is
 * ignored — per-output only. Pure (no I/O); `validatePerOutputPlan` is the hard
 * gate before any POST.
 *
 * @param {Object} controller - sim LED controller (registry shape).
 * @param {Map|Object|Array} strandFixtures - strand name → ledCount (unused for
 *   the mapping itself; accepted for signature parity + future use).
 * @param {Object} deviceSnapshot - GET /api/config result (its strands[] define
 *   which output slots are enabled on the hardware).
 * @returns {{universeByOutputIndex: Object<number,number>, warnings: string[]}}
 *   `warnings` are informational auto-assign notes, NOT errors.
 */
export function derivePerOutputPlan(controller, strandFixtures, deviceSnapshot) {
  if (!controller || typeof controller !== 'object') {
    throw new Error('[DeviceMapper] derivePerOutputPlan: controller is required');
  }
  if (controller.type !== CONTROLLER_TYPE_LED) {
    throw new Error(`[DeviceMapper] controller '${controller.name || controller.id}' is not an ` +
      `LED controller (type='${controller.type}') — cannot derive a per-output plan`);
  }
  if (!deviceSnapshot || typeof deviceSnapshot !== 'object' || !Array.isArray(deviceSnapshot.strands)) {
    throw new Error('[DeviceMapper] derivePerOutputPlan: deviceSnapshot with a strands[] array is ' +
      'required (GET /api/config)');
  }

  const portByOutput = new Map();
  for (const port of controller.ports || []) {
    portByOutput.set(port.port - 1, port);
  }

  // First pass — enabled outputs whose mapping port already carries a valid
  // universe. Track the used set so auto-extension never collides.
  const universeByOutputIndex = {};
  const enabledIndices = [];
  const used = new Set();
  deviceSnapshot.strands.forEach((strand, i) => {
    if (!strand || strand.enabled !== true) return;   // only enabled outputs carry a universe
    enabledIndices.push(i);
    const port = portByOutput.get(i);
    const universe = port ? port.universe : undefined;
    if (Number.isInteger(universe) && universe >= 1 && universe <= MAX_UNIVERSE) {
      universeByOutputIndex[i] = universe;
      used.add(universe);
    }
  });

  // Second pass — auto-extend every enabled output still missing a universe with
  // the next free universe above the highest already used (all-or-none).
  const warnings = [];
  let next = used.size ? Math.max(...used) + 1 : 1;
  const pickFree = () => {
    while (used.has(next)) next += 1;
    const chosen = next;
    used.add(chosen);
    next += 1;
    return chosen;
  };
  for (const i of enabledIndices) {
    if (universeByOutputIndex[i] !== undefined) continue;
    const chosen = pickFree();
    if (chosen > MAX_UNIVERSE) {
      warnings.push(`output ${i + 1} could not be auto-assigned a universe ` +
        `(ran past ${MAX_UNIVERSE}) — free up universes before pushing`);
      continue;
    }
    universeByOutputIndex[i] = chosen;
    const port = portByOutput.get(i);
    warnings.push(port
      ? `output ${i + 1} (port ${port.port}) had no valid universe — auto-assigned U${chosen}`
      : `output ${i + 1} has no controller port row — auto-assigned U${chosen}`);
  }

  return { universeByOutputIndex, warnings };
}

/**
 * Pure auto-assign helper: give each ENABLED output (a port carrying ≥1 strand
 * entry, in physical port order) a CONTIGUOUS universe starting at `base`, with
 * start=1. The operator's default scheme is a globally-unique run per device
 * (e.g. base 3 → out1→U3, out2→U4). The UI calls this to seed the per-output
 * universes; the operator can still override any output's universe manually.
 *
 * @param {Object} controller - sim LED controller (registry shape).
 * @param {number} base - the first universe (1–63999); enabled outputs get
 *   base, base+1, … in port order.
 * @returns {Object<number, number>} output slot index (0-based) → universe.
 */
export function autoAssignPerOutputUniverses(controller, base) {
  if (!controller || !Array.isArray(controller.ports)) {
    throw new Error('[DeviceMapper] autoAssignPerOutputUniverses: controller with a ports[] array ' +
      'is required');
  }
  if (!Number.isInteger(base) || base < 1 || base > MAX_UNIVERSE) {
    throw new Error(`[DeviceMapper] autoAssignPerOutputUniverses: base universe ${base} out of range ` +
      `1–${MAX_UNIVERSE}`);
  }
  const sorted = [...controller.ports].sort((a, b) => a.port - b.port);
  const universeByOutputIndex = {};
  let n = 0;
  for (const port of sorted) {
    const hasStrand = (port.chain || []).some((e) => entryFixtureName(e) !== null);
    if (!hasStrand) continue;
    universeByOutputIndex[port.port - 1] = base + n;
    n += 1;
  }
  if (n === 0) {
    throw new Error(`[DeviceMapper] autoAssignPerOutputUniverses: controller ` +
      `'${controller.name || controller.id}' has no enabled output to assign a universe to`);
  }
  if (n > PER_OUTPUT_SPAN_MAX) {
    throw new Error(`[DeviceMapper] autoAssignPerOutputUniverses: ${n} enabled outputs exceed the ` +
      `${PER_OUTPUT_SPAN_MAX}-universe window`);
  }
  return universeByOutputIndex;
}

// ── computeLinearLayout ──────────────────────────────────────────────────────

/**
 * Reproduce the firmware's linear sACN layout for a device config (docs/41 §3).
 * Pixel 0 lands at `(dmx.universe, dmx.startAddress)`; pixels advance
 * `bytesPerPixel` channels each, skipping DISABLED outputs entirely, and spill
 * into `universe+1` when the next pixel would cross channel 512 (a pixel never
 * straddles a universe — each new universe starts fresh at channel 1). The
 * cursor carries ACROSS enabled outputs (one contiguous stream), so output N's
 * start is determined by the cumulative pixels of enabled outputs before it.
 *
 * @param {{strands: Array<Object>, dmx: Object}} config
 * @returns {Array<{outputIndex, enabled, universe, startChannel, endUniverse,
 *   endChannel, pixelCount, pixelSpan, bytesPerPixel,
 *   segments: Array<{universe, startChannel, endChannel, pixelCount}>}>}
 *   one entry per output (disabled entries carry enabled:false and null spans).
 * @throws on a missing config, a bad startAddress/universe, or a layout that
 *   spills past the sACN universe ceiling (cap violation).
 */
export function computeLinearLayout(config) {
  if (!config || !Array.isArray(config.strands) || !config.dmx || typeof config.dmx !== 'object') {
    throw new Error('[DeviceMapper] computeLinearLayout: config with strands[] and dmx{} required');
  }
  const baseUniverse = config.dmx.universe;
  const startAddress = config.dmx.startAddress;
  if (!Number.isInteger(baseUniverse) || baseUniverse < 1 || baseUniverse > MAX_UNIVERSE) {
    throw new Error(`[DeviceMapper] computeLinearLayout: dmx.universe ${baseUniverse} out of ` +
      `range 1–${MAX_UNIVERSE}`);
  }
  if (!Number.isInteger(startAddress) || startAddress < 1 || startAddress > DMX_UNIVERSE_SIZE) {
    throw new Error(`[DeviceMapper] computeLinearLayout: dmx.startAddress ${startAddress} out of ` +
      `range 1–${DMX_UNIVERSE_SIZE}`);
  }

  const layouts = [];
  // Single contiguous cursor across all enabled outputs.
  let universe = baseUniverse;
  let channel = startAddress; // 1-based next free channel

  config.strands.forEach((strand, i) => {
    if (!strand || strand.enabled !== true) {
      layouts.push({
        outputIndex: i,
        enabled: false,
        universe: null,
        startChannel: null,
        endUniverse: null,
        endChannel: null,
        pixelCount: strand ? (strand.count || 0) : 0,
        pixelSpan: 0,
        bytesPerPixel: null,
        segments: [],
      });
      return;
    }

    const bpp = bytesPerPixel(strand.colorOrder, `output ${i + 1}`);
    const pixelCount = strand.count;
    if (!Number.isInteger(pixelCount) || pixelCount < 1) {
      throw new Error(`[DeviceMapper] computeLinearLayout: output ${i + 1} enabled with invalid ` +
        `count ${pixelCount}`);
    }

    const segments = [];
    let startUniverse = universe;
    let startChannel = channel;
    let segUniverse = universe;
    let segStartChannel = channel;
    let segPixels = 0;
    let endUniverse = universe;
    let endChannel = channel;
    let firstPixelPlaced = false;

    for (let p = 0; p < pixelCount; p++) {
      // A pixel must fit whole within the current universe (no straddling).
      if (channel + bpp - 1 > DMX_UNIVERSE_SIZE) {
        segments.push({
          universe: segUniverse,
          startChannel: segStartChannel,
          endChannel: channel - 1,
          pixelCount: segPixels,
        });
        universe += 1;
        if (universe > MAX_UNIVERSE) {
          throw new Error(`[DeviceMapper] computeLinearLayout: output ${i + 1} spills past the ` +
            `sACN universe ceiling ${MAX_UNIVERSE} — layout does not fit`);
        }
        channel = 1;
        segUniverse = universe;
        segStartChannel = channel;
        segPixels = 0;
      }
      if (!firstPixelPlaced) {
        startUniverse = universe;
        startChannel = channel;
        segUniverse = universe;
        segStartChannel = channel;
        firstPixelPlaced = true;
      }
      endUniverse = universe;
      endChannel = channel + bpp - 1;
      channel += bpp;
      segPixels += 1;
    }
    segments.push({
      universe: segUniverse,
      startChannel: segStartChannel,
      endChannel,
      pixelCount: segPixels,
    });

    layouts.push({
      outputIndex: i,
      enabled: true,
      universe: startUniverse,
      startChannel,
      endUniverse,
      endChannel,
      pixelCount,
      pixelSpan: pixelCount * bpp,
      bytesPerPixel: bpp,
      segments,
    });
  });

  return layouts;
}
