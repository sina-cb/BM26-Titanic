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
  isLedController,
  ledOutputIndexForPort,
  parkedUniverseFor,
} from '../controller_registry.js';

const PER_OUTPUT_SPAN_MAX = 16;   // ≤16-universe window per controller (firmware rule)

// ── Registry-wide universe claims (the cross-controller plan gate) ───────────

/**
 * True iff `value` can answer `has(universe)` — a Set of claimed universes or a
 * Map universe → owner label (what `collectClaimedUniverses` returns). Kept
 * permissive on purpose: the gate only needs membership, the label only sharpens
 * the refusal text.
 */
function isClaimIndex(value) {
  return !!value && typeof value.has === 'function';
}

/** The owner label for a claimed universe ('another controller' from a bare Set). */
function claimOwner(claimedUniverses, universe) {
  const label = typeof claimedUniverses.get === 'function'
    ? claimedUniverses.get(universe) : null;
  return (typeof label === 'string' && label.length) ? label : 'another controller';
}

/**
 * Build the registry-wide claim index for the per-output plan gate: every
 * universe claimed by a controller OTHER than `controller`, mapped to a label
 * naming the owner ("LeftFrontDeck port 1"). PURE — the caller supplies the two
 * projections so this module stays free of registry/projection imports (and of
 * the import cycle they would create).
 *
 * WHY (report 20260725_58 §4): `derivePerOutputPlan`'s auto-extender used to
 * track only the universes of the device it was planning, so a push silently
 * minted cross-controller collisions — the live `.60` push auto-assigned output
 * 3 to U23, which LeftFrontDeck already owns for the Left Front Rails DMX chain.
 *
 * The two claim sources key their owner DIFFERENTLY (docs/33 decision 20), so
 * "is this MY claim?" is answered per source:
 *  - `dmxUniverseMaps` (`computeProjection().universeMaps`) claims carry the
 *    owner's STABLE `controller.id` plus `controllerName`.
 *  - `ledClaims` (`computeLedUniverseClaims()`) claims carry the owner's 1-based
 *    PANEL ORDINAL, resolved against `controllers` for the name.
 *
 * @param {Object} controller - the controller being planned (its OWN claims are
 *   excluded; otherwise a card would collide with itself).
 * @param {{dmxUniverseMaps: Map<number, Array>, ledClaims: Map<number, Array>,
 *   controllers: Array<Object>}} sources
 * @returns {Map<number, string>} universe → owner label.
 */
export function collectClaimedUniverses(controller, sources) {
  if (!controller || typeof controller !== 'object') {
    throw new Error('[DeviceMapper] collectClaimedUniverses: controller is required');
  }
  if (!sources || typeof sources !== 'object') {
    throw new Error('[DeviceMapper] collectClaimedUniverses: sources ' +
      '{dmxUniverseMaps, ledClaims, controllers} is required');
  }
  const { dmxUniverseMaps, ledClaims, controllers } = sources;
  if (!(dmxUniverseMaps instanceof Map)) {
    throw new Error('[DeviceMapper] collectClaimedUniverses: dmxUniverseMaps must be a Map ' +
      '(computeProjection().universeMaps)');
  }
  if (!(ledClaims instanceof Map)) {
    throw new Error('[DeviceMapper] collectClaimedUniverses: ledClaims must be a Map ' +
      '(computeLedUniverseClaims())');
  }
  if (!Array.isArray(controllers)) {
    throw new Error('[DeviceMapper] collectClaimedUniverses: controllers must be the registry ' +
      'controllers array (ordinal → owner name)');
  }
  const ownOrdinal = controllers.indexOf(controller) + 1;
  if (ownOrdinal === 0) {
    throw new Error(`[DeviceMapper] collectClaimedUniverses: controller ` +
      `'${controller.name || controller.id}' is not in the registry controllers array — its own ` +
      'claims could not be excluded; refusing to build a claim index that would collide with itself');
  }

  const claimed = new Map();
  const note = (universe, label) => {
    if (!Number.isInteger(universe) || universe < 1) return;
    if (!claimed.has(universe)) claimed.set(universe, label);
  };

  for (const [universe, claims] of dmxUniverseMaps) {
    for (const claim of claims || []) {
      if (claim.controllerId === controller.id) continue;   // own DMX claims (an LED card has none)
      const owner = claim.controllerName || `controller #${claim.controllerId}`;
      note(universe, Number.isInteger(claim.portNum) ? `${owner} port ${claim.portNum}` : owner);
    }
  }

  for (const [universe, claims] of ledClaims) {
    for (const claim of claims || []) {
      if (claim.controllerId === ownOrdinal) continue;      // own strands
      const ownerController = controllers[claim.controllerId - 1];
      const owner = ownerController ? ownerController.name : `controller #${claim.controllerId}`;
      const port = Number.isInteger(claim.portNum) ? ` port ${claim.portNum}` : '';
      note(universe, `${owner}${port} (LED strand '${claim.name}')`);
    }
  }

  // The two universes a device SUBSCRIBES to that no strand patch projects, and
  // which the claim index therefore used to be blind to (report 20260725_70 §4):
  //
  //  1. an LED port row carrying NO strand — the port still declares a universe,
  //     and the moment a strand lands on it the device listens there;
  //  2. a PARKED output — enabled on the board with no port driving it, sitting
  //     on a universe the sim allocated precisely so nobody else takes it.
  //
  // Both are read straight off the `controllers` array this function already
  // receives, and ownership is trivial (skip the controller being planned), so
  // the ordinal-vs-id trap above does not apply to either source.
  for (const other of controllers) {
    if (other === controller) continue;
    if (!isLedController(other)) continue;
    for (const port of other.ports || []) {
      note(port.universe, `${other.name} port ${port.port} → output ${port.output}`);
    }
    for (const parked of other.parkedOutputs || []) {
      note(parked.universe, `${other.name} output ${parked.output} (parked)`);
    }
  }

  return claimed;
}

// ── Per-output universe plan (device-per-output DMX) ─────────────────────────

/** strand name → ledCount, from a Map / plain object / entry array. */
function strandCountMap(strandFixtures) {
  if (strandFixtures instanceof Map) return strandFixtures;
  if (Array.isArray(strandFixtures)) return new Map(strandFixtures);
  return new Map(Object.entries(strandFixtures || {}));
}

/** Total mapped pixels on a port's chain (0 when it carries no known strand). */
function portPixelCount(port, counts) {
  let total = 0;
  for (const entry of port.chain || []) {
    const name = entryFixtureName(entry);
    if (name === null) continue;
    const ledCount = counts.get(name);
    if (Number.isInteger(ledCount) && ledCount > 0) total += ledCount;
  }
  return total;
}

/**
 * Is a stored PARKED universe still usable? A park is sticky (report 20260725_70
 * §2.2) — it moves ONLY when it stops being valid, because a park that drifts on
 * its own makes the sync chip report drift on a card nobody touched.
 */
function parkedUniverseIsValid(stored, planned, claimedUniverses, cardUniverses) {
  if (!Number.isInteger(stored) || stored < 1 || stored > MAX_UNIVERSE) return false;
  if (claimedUniverses.has(stored)) return false;   // another controller took it
  if (cardUniverses.has(stored)) return false;      // collides with one of this card's ports
  if (planned.has(stored)) return false;            // already handed to another output
  const all = [...planned, stored];
  return (Math.max(...all) - Math.min(...all) + 1) <= PER_OUTPUT_SPAN_MAX;
}

/**
 * Allocate a parked universe: the LOWEST universe free across the whole registry
 * at or above the plan's anchor that still fits the ≤16-universe window
 * (`validatePerOutputPlan`'s SPAN rule, measured across assigned AND parked
 * universes). Returns null when the window is exhausted — the caller turns that
 * into a BLOCKING refusal rather than parking outside the window and earning a
 * device 400 with a cryptic message.
 */
function allocateParkedUniverse(planned, claimedUniverses, cardUniverses) {
  const anchor = planned.size ? Math.min(...planned) : 2;   // U1 is effects-only
  const ceiling = Math.min(MAX_UNIVERSE, anchor + PER_OUTPUT_SPAN_MAX - 1);
  for (let u = anchor; u <= ceiling; u++) {
    if (planned.has(u) || claimedUniverses.has(u) || cardUniverses.has(u)) continue;
    return u;
  }
  return null;
}

/** The inclusive window a park must fall inside, for the refusal text. */
function parkWindowText(planned) {
  const anchor = planned.size ? Math.min(...planned) : 2;
  return `U${anchor}–U${Math.min(MAX_UNIVERSE, anchor + PER_OUTPUT_SPAN_MAX - 1)}`;
}

/**
 * Derive the PER-OUTPUT universe plan for a controller whose firmware supports
 * per-output DMX: each physical board output is an INDEPENDENT sACN receiver on
 * its own `{universe, startAddress: 1}` (docs/41). Which output a card port
 * drives is DECLARED by `port.output` (1-based; report 20260725_70 §1) — the
 * 0-based `strands[]` index is derived at this boundary only.
 *
 * THE THREE CASES, per device output slot `i`:
 *
 *  1. A card port DECLARES it (`port.output - 1 === i`) → the output takes that
 *     port's universe. If the board has the output DISABLED, the push ENABLES it
 *     (§2.3) — the one asymmetric write, declared in the confirm dialog. A port
 *     left at an invalid universe (≤0) keeps the old repair: the next universe
 *     free across the whole registry, with a warning.
 *  2. No card port declares it, and the board has it ENABLED → it is PARKED: it
 *     keeps a universe proven free across the whole registry, so it stays
 *     enabled and subscribed and receives ZERO packets (relay routes are unicast
 *     per (universe, IP) and no patch record points at it) — dark, held there by
 *     the device's own `dmx.timeoutMs` blackout. Parking REPLACES the old
 *     anonymous "auto-extend" (report 20260725_59): same claims-gated mechanism,
 *     now a first-class, PERSISTED, sticky concept with its own UI surface.
 *  3. No card port declares it, and the board has it disabled → untouched. No
 *     universe, no enable, not in the plan.
 *
 * THE PUSH NEVER WRITES `enabled: false`, for any output, ever. Nothing the sim
 * does can dark a strand somebody wired outside it (operator ruling: "the
 * controller can have all 4 ports enabled at all times, and we just direct data
 * to the port we need"). "Off" means "no data routed here", not "output
 * disabled".
 *
 * REGISTRY-AWARE (slice S2, report 20260725_58 §4): "free" means free across the
 * WHOLE registry. `claimedUniverses` carries the universes owned by OTHER
 * controllers (`collectClaimedUniverses`); parks and repairs skip them, and an
 * EXPLICIT port universe that lands on one is a BLOCKING collision.
 *
 * PURE (no I/O, no mutation): the sync chip and the push both call this, so both
 * see the same plan. Persisting a newly-allocated park is the PUSH's job.
 *
 * @param {Object} controller - sim LED controller (registry shape).
 * @param {Map|Object|Array} strandFixtures - strand name → ledCount. Used for
 *   the pixel count written when an output is newly ENABLED, and for the
 *   count-mismatch warning on an already-enabled one.
 * @param {Object} deviceSnapshot - GET /api/config result (its strands[] define
 *   how many outputs the board has and which are enabled today).
 * @param {Set<number>|Map<number,string>} claimedUniverses - universes owned by
 *   OTHER controllers (Map values are owner labels used in the refusal text).
 *   REQUIRED — deriving without it is exactly the defect this gate closes.
 * @returns {{universeByOutputIndex: Object<number,number>,
 *   assignments: Array<{outputIndex: number, portNum: number, universe: number,
 *     pixelCount: number}>,
 *   parked: Array<{outputIndex: number, universe: number, reused: boolean}>,
 *   enableOutputIndices: number[],
 *   enables: Array<{outputIndex: number, portNum: number, universe: number,
 *     count: number}>,
 *   warnings: string[],
 *   collisions: Array<{kind: string, outputIndex: (number|undefined),
 *     port: (number|undefined), universe: (number|undefined),
 *     owner: (string|undefined), message: string}>}}
 *   `universeByOutputIndex` covers EVERY output that will be enabled after the
 *   push (assigned + parked). `warnings` are loud but informational;
 *   `collisions` are BLOCKING — the caller refuses before any device write.
 */
export function derivePerOutputPlan(controller, strandFixtures, deviceSnapshot, claimedUniverses) {
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
  if (!isClaimIndex(claimedUniverses)) {
    throw new Error('[DeviceMapper] derivePerOutputPlan: claimedUniverses is required — pass the ' +
      'registry-wide claim index from collectClaimedUniverses(); planning without it is what ' +
      'auto-assigned a universe another controller already owns');
  }

  const counts = strandCountMap(strandFixtures);
  const strands = deviceSnapshot.strands;
  const outputCount = strands.length;
  const ports = [...(controller.ports || [])].sort((a, b) => a.port - b.port);

  const universeByOutputIndex = {};
  const assignments = [];
  const parked = [];
  const enables = [];
  const warnings = [];
  const collisions = [];

  // ── Port → output declarations, and the two structural refusals ────────────
  // A DUPLICATE output is loadable (the row's identity is intact, only the
  // mapping is invalid) but never pushable: one physical output cannot take two
  // universes. Out-of-range is measured against the DEVICE's own output count.
  const portByOutput = new Map();
  const cardUniverses = new Set();      // every universe this card's ports declare
  const duplicates = new Map();         // outputIndex → [portNum, …]
  for (const port of ports) {
    const outputIndex = ledOutputIndexForPort(port);
    if (Number.isInteger(port.universe) && port.universe >= 1) cardUniverses.add(port.universe);
    if (!duplicates.has(outputIndex)) duplicates.set(outputIndex, []);
    duplicates.get(outputIndex).push(port.port);
    if (!portByOutput.has(outputIndex)) portByOutput.set(outputIndex, port);
  }
  for (const [outputIndex, portNums] of duplicates) {
    if (portNums.length < 2) continue;
    collisions.push({
      kind: 'duplicate_output',
      outputIndex,
      port: portNums[0],
      universe: undefined,
      owner: undefined,
      message: `ports ${portNums.join(' and ')} both drive output ${outputIndex + 1} — one ` +
        'physical output cannot take two universes; give each port its own output',
    });
  }
  for (const [outputIndex, port] of portByOutput) {
    if (outputIndex < outputCount) continue;
    collisions.push({
      kind: 'output_out_of_range',
      outputIndex,
      port: port.port,
      universe: port.universe,
      owner: undefined,
      message: `port ${port.port} drives output ${outputIndex + 1}, but the device reports only ` +
        `${outputCount} output(s)`,
    });
  }

  // ── Pass 1 — every output a card port DECLARES takes that port's universe ──
  const used = new Set();
  const repairNeeded = [];
  for (let i = 0; i < outputCount; i++) {
    const port = portByOutput.get(i);
    if (!port) continue;
    const universe = port.universe;
    if (Number.isInteger(universe) && universe >= 1 && universe <= MAX_UNIVERSE) {
      universeByOutputIndex[i] = universe;
      used.add(universe);
      if (claimedUniverses.has(universe)) {
        const owner = claimOwner(claimedUniverses, universe);
        collisions.push({
          kind: 'universe_owned',
          outputIndex: i,
          port: port.port,
          universe,
          owner,
          message: `output ${i + 1} would take U${universe} — owned by ${owner}`,
        });
      }
    } else {
      repairNeeded.push(i);
    }
  }

  // Repair: a port left at an invalid universe (≤0) is auto-assigned the next
  // universe free ACROSS THE REGISTRY, above the highest already used. Unchanged
  // from slice S2 — `ensurePortUniverses` normally runs first, this catches the
  // survivors (and the sync chip, which never repairs the registry).
  let next = used.size ? Math.max(...used) + 1 : 1;
  for (const i of repairNeeded) {
    while (next <= MAX_UNIVERSE && (used.has(next) || claimedUniverses.has(next))) next += 1;
    const port = portByOutput.get(i);
    if (next > MAX_UNIVERSE) {
      warnings.push(`output ${i + 1} could not be auto-assigned a universe ` +
        `(ran past ${MAX_UNIVERSE} with every candidate used or claimed by another controller) — ` +
        'free up universes before pushing');
      continue;
    }
    const chosen = next;
    used.add(chosen);
    cardUniverses.add(chosen);
    next += 1;
    universeByOutputIndex[i] = chosen;
    warnings.push(`output ${i + 1} (port ${port.port}) had no valid universe — ` +
      `auto-assigned U${chosen}`);
  }

  // Record the assignments (in output order) now that every declared output has
  // its universe, and note the ENABLE transitions + the count policy.
  for (let i = 0; i < outputCount; i++) {
    const port = portByOutput.get(i);
    if (!port || universeByOutputIndex[i] === undefined) continue;
    const pixelCount = portPixelCount(port, counts);
    const strand = strands[i];

    // A port row that maps NOTHING, pointed at an output the board has OFF, is
    // the everyday shape of a 4-row card driving two strands. There is nothing
    // to enable it with and nothing to send it, so the output stays exactly as
    // the board has it: out of the plan entirely (case 3). Enabling it would be
    // the sim deciding to drive hardware nobody mapped.
    if ((!strand || strand.enabled !== true) && pixelCount < 1) {
      delete universeByOutputIndex[i];
      used.delete(port.universe);
      if ((port.chain || []).some((e) => entryFixtureName(e) !== null)) {
        // It DOES carry chain entries — the sim just has no pixel count for
        // them (an unknown strand). Say so; do not quietly enable a 0-px output.
        warnings.push(`output ${i + 1} (port ${port.port}) is disabled on the device and the sim ` +
          'has no pixel count for the strand(s) mapped to it — left disabled, nothing pushed');
      }
      continue;
    }

    assignments.push({
      outputIndex: i, portNum: port.port, universe: universeByOutputIndex[i], pixelCount,
    });
    if (strand && strand.enabled === true) {
      // ALREADY ENABLED — the push NEVER rewrites `count`. The physical strand
      // length is hardware truth and the sim's model is a belief (the open
      // 20-vs-40 px question); re-counting a live output could dark pixels that
      // are lit today. A mismatch is REPORTED, never written.
      if (pixelCount > 0 && Number.isInteger(strand.count) && strand.count !== pixelCount) {
        warnings.push(`output ${i + 1}: device count ${strand.count} px, this card maps ` +
          `${pixelCount} px — count NOT changed`);
      }
      continue;
    }
    // DISABLED on the board, and a port with real pixels drives it → the push
    // ENABLES it, writing the mapped pixel count (the firmware requires
    // count ≥ 1 on an enabled output). This is the operator's "drive output 4
    // from one row" case, and the ONLY write that changes an enable flag.
    enables.push({
      outputIndex: i, portNum: port.port, universe: universeByOutputIndex[i], count: pixelCount,
    });
  }

  // ── Pass 2 — every ENABLED output no port declares is PARKED, never disabled ─
  const planned = new Set(Object.values(universeByOutputIndex));
  for (let i = 0; i < outputCount; i++) {
    if (universeByOutputIndex[i] !== undefined) continue;
    const strand = strands[i];
    if (!strand || strand.enabled !== true) continue;   // disabled + unmapped: untouched
    const stored = parkedUniverseFor(controller, i);
    if (parkedUniverseIsValid(stored, planned, claimedUniverses, cardUniverses)) {
      universeByOutputIndex[i] = stored;
      planned.add(stored);
      parked.push({ outputIndex: i, universe: stored, reused: true });
      continue;
    }
    const chosen = allocateParkedUniverse(planned, claimedUniverses, cardUniverses);
    if (chosen === null) {
      collisions.push({
        kind: 'parked_span',
        outputIndex: i,
        port: undefined,
        universe: undefined,
        owner: undefined,
        message: `no free universe in the window ${parkWindowText(planned)} for output ${i + 1} — ` +
          'free one up, or unpark it by mapping a port to it',
      });
      continue;
    }
    universeByOutputIndex[i] = chosen;
    planned.add(chosen);
    parked.push({ outputIndex: i, universe: chosen, reused: false });
    warnings.push(Number.isInteger(stored)
      ? `output ${i + 1}: parked universe U${stored} is no longer free — re-parked on U${chosen}`
      : `output ${i + 1} has no controller port row — PARKED on U${chosen} (enabled on the ` +
        'board, nothing routes here, so it stays dark)');
  }

  // ── The firmware's own floor ──────────────────────────────────────────────
  // `validatePerOutputPlan` throws "no enabled strand to assign a universe to";
  // catching it here gives the operator a sentence he can act on.
  if (Object.keys(universeByOutputIndex).length === 0) {
    collisions.push({
      kind: 'no_enabled_output',
      outputIndex: undefined,
      port: undefined,
      universe: undefined,
      owner: undefined,
      message: `'${controller.name || controller.id}' would leave every output dark — a ` +
        'MarsinLED requires at least one enabled output; map a strand to a port first',
    });
  }

  return {
    universeByOutputIndex,
    assignments,
    parked,
    enableOutputIndices: enables.map((e) => e.outputIndex),
    enables,
    warnings,
    collisions,
  };
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
    // Keyed by the PHYSICAL output the port declares (report 20260725_70), not
    // by the port row number — the two differ under a crossed mapping.
    universeByOutputIndex[ledOutputIndexForPort(port)] = base + n;
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
