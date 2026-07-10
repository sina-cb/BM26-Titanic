/**
 * device_config_mapper.js — PURE derivation of a MarsinLED device's PER-OUTPUT
 * universe plan from the sim's LED controller state. NO I/O: every function is a
 * deterministic transform of its inputs.
 *
 * Per-output firmware contract (docs/41; `sacn.perOutput`; per-output-only
 * ruling 2026-07-10/11): each physical output is an INDEPENDENT sACN receiver on
 * its own `{universe, startAddress:1}`. The device does NOT stream one
 * contiguous layout across outputs, so this module only derives WHICH universe
 * each output takes (`derivePerOutputPlan`, `autoAssignPerOutputUniverses`). The
 * per-output BYTE layout within an output lives in led_patch_projection.js
 * (`projectLedStrandSegments`, the single source of truth). The legacy
 * single-base linear layout (`computeLinearLayout`/`synthLinearConfig`) was
 * removed when per-output became the only device model.
 *
 * Fail-loud everywhere (codex P0): a bad controller or a missing device snapshot
 * THROWS with a precise message — never a silent re-map or a fabricated field.
 */

import {
  MAX_UNIVERSE,
  CONTROLLER_TYPE_LED,
  entryFixtureName,
} from '../controller_registry.js';

const PER_OUTPUT_SPAN_MAX = 16;   // ≤16-universe window per controller (firmware rule)

// ── Per-output universe plan (device-per-output DMX) ─────────────────────────

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
