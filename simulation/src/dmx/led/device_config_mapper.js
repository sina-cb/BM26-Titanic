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

  // The universe a device SUBSCRIBES to that no strand patch projects, and which
  // the claim index would otherwise be blind to (report 20260725_70 §4): an LED
  // port row carrying NO strand still DECLARES a universe, and the moment a
  // strand lands on it the device listens there.
  //
  // (Parked outputs used to be a second source here. Parking is retired — a
  // forced push DISABLES every output no port maps, so there is no such thing as
  // "an enabled output nobody routes to" holding a universe hostage.)
  //
  // This is read straight off the `controllers` array this function already
  // receives, and ownership is trivial (skip the controller being planned), so
  // the ordinal-vs-id trap above does not apply to it.
  for (const other of controllers) {
    if (other === controller) continue;
    if (!isLedController(other)) continue;
    for (const port of other.ports || []) {
      note(port.universe, `${other.name} port ${port.port} → output ${port.output}`);
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

/**
 * A port chain's pixel accounting, split by whether the sim could resolve each
 * entry's `ledCount`.
 *
 * The split is the point (known gap 4, closed here): summing only the RESOLVED
 * entries and pushing that total is how a chain of two strands where the sim
 * knows one of them writes a SHORT `count` onto the board — an output that
 * looks configured and silently truncates half its pixels. The caller turns a
 * MIXED chain into a blocking collision; a chain nothing resolves stays the
 * older "nothing to enable it with, so the push DISABLES it" case.
 *
 * @returns {{total: number, resolved: string[], unresolved: string[]}}
 *   `total` counts the resolved entries only.
 */
function portPixelCount(port, counts) {
  let total = 0;
  const resolved = [];
  const unresolved = [];
  for (const entry of port.chain || []) {
    const name = entryFixtureName(entry);
    if (name === null) continue;
    const ledCount = counts.get(name);
    if (Number.isInteger(ledCount) && ledCount > 0) {
      total += ledCount;
      resolved.push(name);
    } else {
      unresolved.push(name);
    }
  }
  return { total, resolved, unresolved };
}

/**
 * Derive the PER-OUTPUT universe plan for a controller whose firmware supports
 * per-output DMX: each physical board output is an INDEPENDENT sACN receiver on
 * its own `{universe, startAddress: 1}` (docs/41). Which output a card port
 * drives is DECLARED by `port.output` (1-based; report 20260725_70 §1) — the
 * 0-based `strands[]` index is derived at this boundary only.
 *
 * FORCE SEMANTICS (operator ruling, report `_362`). The sim's controller panel
 * is the SINGLE SOURCE OF TRUTH; a push is a one-way full overwrite, so there
 * are only TWO cases per device output slot `i`:
 *
 *  1. A card port DECLARES it (`port.output - 1 === i`) AND that port maps ≥1
 *     pixel → the output is ASSIGNED: the push enables it, forces its `count`
 *     to the port's mapped pixel count, and stamps the port's universe with
 *     `dmxStartAddress: 1`. A port left at an invalid universe (≤0) keeps the
 *     old repair: the next universe free across the whole registry, with a
 *     warning. If the port's chain is MIXED — some entries the sim can size,
 *     some it cannot — the count would be short, so the plan raises a BLOCKING
 *     `unknown_strand_count` collision instead (known gap 4).
 *  2. Anything else → the push writes `enabled: false`. An output the board has
 *     enabled today and no port maps is reported in `disables` so the confirm
 *     dialog can name it before it goes dark.
 *
 * This SUPERSEDES two earlier rulings that shaped the old three-case model:
 * "the push NEVER writes `enabled: false`" (parking, report 20260725_70) and
 * "count on an already-enabled output is never rewritten". Both are gone —
 * unmapped outputs are DISABLED and counts are FORCED — and the confirm dialog
 * carries mandatory DISABLES and COUNT CHANGES sections so nothing goes dark or
 * gets resized silently.
 *
 * REGISTRY-AWARE (slice S2, report 20260725_58 §4): "free" means free across the
 * WHOLE registry. `claimedUniverses` carries the universes owned by OTHER
 * controllers (`collectClaimedUniverses`); the repair path skips them.
 *
 * SHARED ADDRESSES (operator order 2026-07-31, report 20260725_102): an EXPLICIT
 * port universe that lands on another controller's claim is NO LONGER a blocking
 * collision — it is a `sharedUniverses` entry plus a ⚠ warning, and the actual
 * resolution happens on the wire (src/dmx/address_merge.js: one unified packet
 * per destination, higher controller IP overrides). Only claims the higher-IP
 * rule cannot rank (same IP, or a claimant with no usable IP) are still hard
 * errors, raised by address_merge.assertResolvableOverlaps on the push path.
 *
 * PURE (no I/O, no mutation): the sync chip and the push both call this, so both
 * see the same plan.
 *
 * @param {Object} controller - sim LED controller (registry shape).
 * @param {Map|Object|Array} strandFixtures - strand name → ledCount. The source
 *   of the `count` FORCED onto every assigned output.
 * @param {Object} deviceSnapshot - GET /api/config result (its strands[] define
 *   how many outputs the board has and which are enabled today).
 * @param {Set<number>|Map<number,string>} claimedUniverses - universes owned by
 *   OTHER controllers (Map values are owner labels used in the refusal text).
 *   REQUIRED — deriving without it is exactly the defect this gate closes.
 * @returns {{controllerName: string,
 *   universeByOutputIndex: Object<number,number>,
 *   assignments: Array<{outputIndex: number, portNum: number, universe: number,
 *     pixelCount: number}>,
 *   disables: Array<{outputIndex: number, deviceCount: number,
 *     deviceUniverse: (number|undefined)}>,
 *   countChanges: Array<{outputIndex: number, from: number, to: number}>,
 *   warnings: string[],
 *   sharedUniverses: Array<{outputIndex: number, port: number, universe: number,
 *     owner: string, message: string}>,
 *   collisions: Array<{kind: string, outputIndex: (number|undefined),
 *     port: (number|undefined), universe: (number|undefined),
 *     owner: (string|undefined), message: string}>}}
 *   `universeByOutputIndex` covers EXACTLY the outputs the push will enable —
 *   every other output slot is written `enabled:false`. `disables` names the
 *   outputs the board has ON today that the push will turn OFF; `countChanges`
 *   names every already-enabled output whose `count` the push will rewrite.
 *   `warnings` are loud but informational; `sharedUniverses` are the ALLOWED
 *   overlaps (also mirrored into `warnings`, so no caller can surface the plan
 *   without surfacing them); `collisions` are BLOCKING — the caller refuses
 *   before any device write.
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
  const disables = [];
  const countChanges = [];
  const warnings = [];
  const collisions = [];
  const sharedUniverses = [];   // allowed overlaps — WARNING, never a refusal

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
        // SHARED ADDRESS — a WARNING since the operator's 2026-07-31 order
        // ("make controllers allow sending to the same address with a warning
        // instead of an error"). This used to be a BLOCKING `universe_owned`
        // collision that refused the whole push. Two boxes on one universe is a
        // real rig shape (a splitter, a mirrored strand, a stand-in board), and
        // what actually resolves it now lives in src/dmx/address_merge.js:
        // frames are unified into ONE packet per (universe, destination) and the
        // numerically higher controller IP overrides on contested channels.
        //
        // NOTE the asymmetry, and it is deliberate: an EXPLICIT operator-declared
        // universe may now be shared, but the auto-assign path below (the
        // invalid-universe repair) still SKIPS every claimed universe. The sim
        // never *chooses* to create a shared address — it only honours one the
        // operator declared.
        const owner = claimOwner(claimedUniverses, universe);
        const share = {
          outputIndex: i,
          port: port.port,
          universe,
          owner,
          message: `output ${i + 1} (port ${port.port}) shares U${universe} with ${owner} — ` +
            'allowed: the frames are UNIFIED into one packet per destination and the higher ' +
            'controller IP overrides on any contested channel',
        };
        sharedUniverses.push(share);
        warnings.push(`⚠ ${share.message}`);
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
  // its universe, and note the COUNT rewrites the force semantics imply.
  for (let i = 0; i < outputCount; i++) {
    const port = portByOutput.get(i);
    if (!port || universeByOutputIndex[i] === undefined) continue;
    const { total: pixelCount, resolved, unresolved } = portPixelCount(port, counts);
    const strand = strands[i];

    // MIXED CHAIN — BLOCKING (known gap 4). Some entries resolved, some did
    // not: the sum below counts only the resolved ones, so pushing it would
    // force a count SHORTER than the rope actually carries and the tail would
    // go dark while every chip and dialog reported success. There is no honest
    // number to write, so the plan refuses and names the strands to fix. (A
    // chain NOTHING resolves is a different case — see below.)
    if (unresolved.length && resolved.length) {
      collisions.push({
        kind: 'unknown_strand_count',
        outputIndex: i,
        port: port.port,
        universe: universeByOutputIndex[i],
        owner: undefined,
        message: `output ${i + 1} (port ${port.port}) chains strand(s) the sim has NO pixel count ` +
          `for (${unresolved.join(', ')}) alongside strand(s) it does know ` +
          `(${resolved.join(', ')} = ${pixelCount} px) — pushing would force that SHORT count ` +
          'onto the output and silently truncate the rest; give the unknown strand(s) a fixture ' +
          'with a pixel count, or take them off this port',
      });
    }

    // A port row that maps NOTHING has no count to write, and the firmware
    // requires `count ≥ 1` on an enabled output. Such an output is NOT assigned
    // — which, under force semantics, means the push DISABLES it (the `disables`
    // pass below names it when the board has it on today).
    if (pixelCount < 1) {
      delete universeByOutputIndex[i];
      used.delete(port.universe);
      if (unresolved.length) {
        // It DOES carry chain entries — the sim just has no pixel count for
        // ANY of them. Say so; do not quietly push a 0-px output. This one is
        // deliberately NOT a collision: the output is disabled, which the
        // confirm dialog's DISABLES section states outright, so nothing lands
        // on the board claiming a length nobody measured.
        warnings.push(`output ${i + 1} (port ${port.port}) maps strand(s) the sim has no pixel ` +
          `count for (${unresolved.join(', ')}) — nothing to enable it with, so the push ` +
          'DISABLES it');
      }
      continue;
    }

    assignments.push({
      outputIndex: i, portNum: port.port, universe: universeByOutputIndex[i], pixelCount,
    });
    // FORCED COUNT (report `_362` §2.1): the sim's mapping wins in BOTH
    // directions, superseding the older "count on an already-enabled output is
    // hardware truth" rule. Every rewrite is named so the confirm dialog can
    // show it before the write, never after.
    if (strand && strand.enabled === true
        && Number.isInteger(strand.count) && strand.count !== pixelCount) {
      countChanges.push({ outputIndex: i, from: strand.count, to: pixelCount });
    }
  }

  // ── Pass 2 — every output the plan does not assign is DISABLED by the push ──
  // Only the ones the board has ON today are worth naming: turning an already
  // disabled output off again changes nothing the operator can see.
  for (let i = 0; i < outputCount; i++) {
    if (universeByOutputIndex[i] !== undefined) continue;
    const strand = strands[i];
    if (!strand || strand.enabled !== true) continue;
    disables.push({
      outputIndex: i,
      deviceCount: strand.count,
      deviceUniverse: strand.dmxUniverse,
    });
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
    // The CARD's name travels with the plan because the push may have to write
    // it as the device's `deviceName`: a board whose stored name is invalid
    // rejects every config write until it is repaired (report 20260725_124,
    // `deviceNameRepairForPush`). It is carried verbatim — the repair either
    // uses it as-is or refuses.
    controllerName: controller.name,
    universeByOutputIndex,
    assignments,
    disables,
    countChanges,
    warnings,
    sharedUniverses,
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
