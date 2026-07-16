/**
 * led_patch_projection.js — PURE projection of a bound MarsinLED controller's
 * strands onto the PER-OUTPUT sACN layout, for the scene patch records
 * (plan 20260709_0 P4; per-output-only ruling 2026-07-10/11). NO I/O, NO DOM.
 *
 * PER-OUTPUT firmware contract (docs/41; `sacn.perOutput`): a MarsinLED runs one
 * INDEPENDENT sACN receiver per physical output. Each output listens on its own
 * `{universe, startAddress}` with startAddress ALWAYS 1 — output 0 on ITS
 * universe channel 1, output 1 on ITS universe channel 1, and so on. There is
 * NO single contiguous stream across outputs. So this projection RESETS the
 * channel cursor to (port.universe, channel 1) at the START of every port: each
 * controller port IS one device output. Strands chained on ONE port pack
 * contiguously (stride × count, spilling by whole pixels via the shared walker);
 * an empty/disabled port simply contributes nothing.
 *
 * The legacy single-base DEVICE-LINEAR model (one contiguous cursor across the
 * enabled outputs, skipping disabled ones — device_config_mapper.computeLinear-
 * Layout) was REMOVED on the operator's per-output-only ruling (2026-07-10/11):
 * it addressed output 1 as a continuation of output 0, which darkened every
 * output past the first on real per-output firmware (output 2 listens on ITS
 * own universe, never on output 0's tail bytes). `projectLedStrandPixels` /
 * `projectLedStrandSegments` remain the ONE source of truth for the byte layout
 * WITHIN a single output.
 *
 * A strand is "patched" exactly when it appears in the returned map; unbound
 * or unassigned strands are simply absent (the caller turns that into a LOUD
 * unpatched marker, never a silent skip — codex P0).
 */

import {
  DMX_UNIVERSE_SIZE,
  MAX_UNIVERSE,
  entryFixtureName,
  isLedController,
  isBoundLedController,
  isValidIp,
  ledStrideForOrder,
  normalizeLedConfig,
} from '../controller_registry.js';

/**
 * Walk one LED strand's pixels from a starting (universe, channel) with a
 * fixed byte `stride`, wrapping universes by WHOLE pixels (a pixel never
 * straddles a universe: when it would cross channel 512 the cursor jumps to
 * channel 1 of the next universe, leaving the tail bytes of the old universe
 * unused). This is the ONE source of truth for the firmware's per-output byte
 * layout WITHIN one device output — `computeLedStrandPatches` walks it to place
 * each strand's start, and the scene exporter walks it to emit each pixel's
 * `{universe, addr}` patch, so the engine model is byte-for-byte identical to
 * both the device and patches.yaml.
 *
 * @param {number} universe - 1-based start universe.
 * @param {number} channel - 1-based start channel within `universe`.
 * @param {number} stride - bytes per pixel (≥1).
 * @param {number} count - pixel count (≥0).
 * @returns {{ pixels: Array<{universe: number, addr: number}>,
 *   universe: number, channel: number, overflow: boolean }}
 *   `pixels` is one entry per placed pixel; `universe`/`channel` are the cursor
 *   AFTER the last placed pixel (the contiguous start for the next strand);
 *   `overflow` is true when the layout ran past the sACN universe ceiling
 *   (placement stops at the overflowing pixel — codex P0: never wrap silently).
 */
export function projectLedStrandPixels(universe, channel, stride, count) {
  const pixels = [];
  let overflow = false;
  for (let k = 0; k < count; k++) {
    if (channel + stride - 1 > DMX_UNIVERSE_SIZE) {
      universe += 1;
      channel = 1;
    }
    if (universe > MAX_UNIVERSE) {
      overflow = true;
      break;
    }
    pixels.push({ universe, addr: channel });
    channel += stride;
  }
  return { pixels, universe, channel, overflow };
}

/**
 * The SAME contiguous walk as `projectLedStrandPixels`, aggregated into the
 * per-universe SEGMENTS a strand occupies as it spills across universes — the
 * DMX-parity view the operator asked for (universe + start channel per run).
 * Derived directly from the single-source pixel walker above (it groups that
 * walk's pixels by universe), so it is byte-identical BY CONSTRUCTION — no
 * re-derived layout math. Each segment is a contiguous run inside one universe:
 * `startChannel` = the run's first pixel address, `endChannel` = the run's last
 * pixel's LAST byte (`lastAddr + stride - 1`), `pixelCount` = pixels in the run.
 * A strand fully inside one universe returns a single segment.
 *
 * @param {number} universe - 1-based start universe.
 * @param {number} channel - 1-based start channel within `universe`.
 * @param {number} stride - bytes per pixel (≥1).
 * @param {number} count - pixel count (≥0).
 * @returns {{ segments: Array<{universe: number, startChannel: number,
 *   endChannel: number, pixelCount: number}>,
 *   universe: number, channel: number, overflow: boolean }}
 *   `universe`/`channel` are the cursor AFTER the last placed pixel (the
 *   contiguous start for the next strand); `overflow` matches the pixel walker
 *   (segments cover only the pixels placed before the sACN ceiling was hit).
 */
export function projectLedStrandSegments(universe, channel, stride, count) {
  const walk = projectLedStrandPixels(universe, channel, stride, count);
  const segments = [];
  let current = null;
  for (const pixel of walk.pixels) {
    const endChannel = pixel.addr + stride - 1;
    if (current && current.universe === pixel.universe) {
      current.endChannel = endChannel;
      current.pixelCount += 1;
    } else {
      current = {
        universe: pixel.universe,
        startChannel: pixel.addr,
        endChannel,
        pixelCount: 1,
      };
      segments.push(current);
    }
  }
  return {
    segments,
    universe: walk.universe,
    channel: walk.channel,
    overflow: walk.overflow,
  };
}

/**
 * Project every DEVICE-BOUND LED controller's strands onto the firmware's
 * PER-OUTPUT sACN layout: each controller port IS an independent device output
 * whose cursor STARTS at (port.universe, channel 1). Strands chained on one
 * port pack contiguously (spilling by whole pixels); an empty/disabled port
 * contributes nothing.
 *
 * @param {Object} registry - the controller registry.
 * @param {Map<string, number>|Object} strandLedCounts - strand name → ledCount.
 * @returns {{ fields: Map<string, {
 *   controllerIp: string, controllerId: number, dmxUniverse: number,
 *   dmxAddress: number, pixelCount: number, outputIndex: number,
 *   segments: Array<{universe: number, startChannel: number,
 *     endChannel: number, pixelCount: number}>,
 *   endUniverse: number, endChannel: number }>,
 *   violations: Array<{ code: string, controllerId: number, message: string }> }}
 *   `controllerId` is the controller's 1-based PANEL ORDINAL (docs/33
 *   decision 20), matching computeProjection/computeLedProjection.
 *   `dmxUniverse`/`dmxAddress` are the strand's START — for the FIRST strand on
 *   an output that is (port.universe, 1); `segments`/`endUniverse`/`endChannel`
 *   are the derived DMX-parity view of the same walk (a 200 px RGBW strand
 *   alone on an output at U6 → `[U6 ch1–512 ×128, U7 ch1–288 ×72]`, endUniverse
 *   7, endChannel 288 — the spill stays within THAT output's stream).
 */
export function computeLedStrandPatches(registry, strandLedCounts) {
  const fields = new Map();
  const violations = [];
  if (!registry || !Array.isArray(registry.controllers)) return { fields, violations };

  const counts = strandLedCounts instanceof Map
    ? strandLedCounts
    : new Map(Object.entries(strandLedCounts || {}));

  registry.controllers.forEach((controller, index) => {
    // ONLY device-bound LED controllers use the per-output device layout. Unbound
    // LED controllers keep the sim's generic per-port projection
    // (computeLedProjection) — they have no hardware to agree with.
    if (!isLedController(controller) || !isBoundLedController(controller)) return;

    const led = controller.led || normalizeLedConfig(null, controller.name);
    const ordinal = index + 1;
    const ipOk = isValidIp(controller.ip);
    const stride = ledStrideForOrder(led.order, led.stride);

    if (!ipOk) {
      violations.push({
        code: 'led_bad_ip',
        controllerId: controller.id,
        message: `Bound LED controller '${controller.name}' has a malformed or missing IP ` +
          `('${controller.ip}') — its strands project unpatched`,
      });
    }

    // Each physical output (port) is an INDEPENDENT sACN receiver: the firmware
    // listens on (port.universe, channel 1) per output (docs/41; startAddress is
    // always 1). Visit ports in physical index order so outputIndex is stable
    // and each output's cursor starts fresh at its OWN universe.
    const sortedPorts = [...controller.ports].sort((a, b) => a.port - b.port);
    for (const port of sortedPorts) {
      const outputIndex = port.port - 1;
      const carriesStrand = (port.chain || []).some((e) => entryFixtureName(e) !== null);
      if (!carriesStrand) continue; // empty/disabled output — nothing to patch

      // Each output declares its OWN universe; a 0/out-of-range one can't be
      // addressed. Flag it loudly and leave THIS output's strands unpatched —
      // other outputs are independent receivers and still project.
      if (!Number.isInteger(port.universe) || port.universe < 1 || port.universe > MAX_UNIVERSE) {
        violations.push({
          code: 'led_unallocated_base',
          controllerId: controller.id,
          message: `LED controller '${controller.name}' output ${port.port} carries strands but has ` +
            `no valid universe (${port.universe}) — set that output's universe before patching; ` +
            'its strands project unpatched',
        });
        continue;
      }

      // Per-output cursor: START at this output's universe, channel 1.
      let universe = port.universe;
      let channel = 1;
      let capViolation = false;
      for (const entry of port.chain) {
        if (capViolation) break;
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
        // Walk the strand's pixels from the running cursor with the shared
        // byte-layout walker, then advance the cursor so the next strand on THIS
        // output packs immediately after (one contiguous chain per output).
        const walk = projectLedStrandSegments(universe, channel, stride, ledCount);
        if (walk.overflow) {
          violations.push({
            code: 'led_universe_overflow',
            controllerId: controller.id,
            message: `LED controller '${controller.name}': strand '${name}' on output ${port.port} ` +
              `spills past the sACN universe ceiling ${MAX_UNIVERSE} — layout does not fit; ` +
              'strands from here on this output project unpatched',
          });
          capViolation = true;
          break;
        }
        const start = walk.segments[0];
        const end = walk.segments[walk.segments.length - 1];
        universe = walk.universe;
        channel = walk.channel;
        fields.set(name, {
          controllerIp: ipOk ? controller.ip : '',
          controllerId: ordinal,
          dmxUniverse: start.universe,
          dmxAddress: start.startChannel,
          pixelCount: ledCount,
          outputIndex,
          segments: walk.segments,
          endUniverse: end.universe,
          endChannel: end.endChannel,
        });
      }
    }
  });

  return { fields, violations };
}

/** Normalize a Map | plain-object | null of strand records into a Map. */
function asRecordMap(records) {
  if (records instanceof Map) return records;
  return new Map(Object.entries(records || {}));
}

/**
 * The per-universe channel-occupancy map for ALL LED strands — the LED mirror of
 * `computeProjection().universeMaps` (controller_registry.js:1570-1598): the
 * first-class claim map the operator's universe bars and later spill-reservation
 * read. PURE (no registry mutation, no DOM, no I/O).
 *
 * A strand that spills across universes contributes ONE claim per segment, so a
 * 200 px RGBW strand at U6:1 claims `U6 ch1–512` AND `U7 ch1–288` — collisions
 * on a spill universe become visible exactly like DMX overlaps.
 *
 * Both inputs are optional (pass whichever projections exist):
 *  - `boundFields`  = `computeLedStrandPatches(...).fields` — records already
 *    carry `segments` (the device-linear walk), used verbatim.
 *  - `genericFields` = `computeLedProjection(...).fields` — START-only records
 *    `{universe, addr, stride, ledCount, controllerId}`; walked here with the
 *    SAME `projectLedStrandSegments` so bound and unbound claims are identical
 *    by construction. Taken as input (not imported) to avoid a cycle with
 *    controller_registry.js.
 *
 * @param {Map|Object|null} boundFields
 * @param {Map|Object|null} [genericFields]
 * @returns {Map<number, Array<{start: number, end: number, name: string,
 *   controllerId: number, portNum: (number|undefined), led: true}>>}
 *   keyed by universe; each list sorted by start channel then name (like the
 *   DMX universeMaps sort).
 */
export function computeLedUniverseClaims(boundFields, genericFields) {
  const claims = new Map();
  const addClaim = (universe, claim) => {
    if (!claims.has(universe)) claims.set(universe, []);
    claims.get(universe).push(claim);
  };

  // Bound strands: segments already walked by computeLedStrandPatches.
  for (const [name, rec] of asRecordMap(boundFields)) {
    if (!rec || !Array.isArray(rec.segments)) continue;
    for (const seg of rec.segments) {
      addClaim(seg.universe, {
        start: seg.startChannel,
        end: seg.endChannel,
        name,
        controllerId: rec.controllerId,
        portNum: Number.isInteger(rec.outputIndex) ? rec.outputIndex + 1 : undefined,
        led: true,
      });
    }
  }

  // Unbound (generic) strands: START-only records — walk them with the shared
  // segment walker so their claims match the bound path exactly.
  for (const [name, rec] of asRecordMap(genericFields)) {
    if (!rec) continue;
    const walk = projectLedStrandSegments(rec.universe, rec.addr, rec.stride, rec.ledCount);
    for (const seg of walk.segments) {
      addClaim(seg.universe, {
        start: seg.startChannel,
        end: seg.endChannel,
        name,
        controllerId: rec.controllerId,
        portNum: Number.isInteger(rec.portNum) ? rec.portNum : undefined,
        led: true,
      });
    }
  }

  for (const list of claims.values()) {
    list.sort((a, b) => a.start - b.start || (a.name || '').localeCompare(b.name || ''));
  }
  return claims;
}

// ── Manual per-output universe validation (WARN, never block) ─────────────────

/**
 * Validate every BOUND LED controller's per-output universes against the rest
 * of the rig. PURE (no DOM, no I/O). Returns LOUD, NON-BLOCKING warnings only —
 * projection and push always proceed; the operator declared the universes and
 * owns the choice (docs/41; codex P0: "loud" here means a visible warning,
 * never a silent rewrite).
 *
 * Per-output firmware (2026-07-10/11 ruling): each output streams from its own
 * universe channel 1, so the legacy "unhonorable" warning (declared universe vs
 * a single-base linear landing) no longer exists — a declared universe is
 * ALWAYS honored. What CAN still go wrong:
 *
 *  - `led_universe_duplicate`: two enabled outputs on ONE controller declare the
 *    SAME universe. Each streams from that universe channel 1, so they overwrite
 *    each other — a real conflict; give each output its own universe.
 *  - `led_universe_collision`: a universe a controller ACTUALLY streams (start +
 *    spill, from the per-output projection) also carries DMX fixtures (from
 *    `dmxUniverseMaps`) or another bound LED controller's stream — two sources
 *    on one universe fight.
 *
 * @param {Object} registry - the controller registry.
 * @param {Map|Object} strandCounts - strand name → ledCount.
 * @param {Map<number, Array>} [dmxUniverseMaps] - computeProjection().universeMaps.
 * @returns {Array<{code: string, controllerId: number, port: number, message: string}>}
 */
export function validateLedManualUniverses(registry, strandCounts, dmxUniverseMaps) {
  const warnings = [];
  if (!registry || !Array.isArray(registry.controllers)) return warnings;
  const dmxMaps = dmxUniverseMaps instanceof Map ? dmxUniverseMaps : new Map();
  const counts = strandCounts instanceof Map
    ? strandCounts : new Map(Object.entries(strandCounts || {}));

  // Duplicate declared universes across a controller's enabled (strand-carrying)
  // outputs — a real per-output collision (both stream from channel 1).
  for (const controller of registry.controllers) {
    if (!isLedController(controller) || !isBoundLedController(controller)) continue;
    const byUniverse = new Map(); // universe → [portNum, …]
    for (const port of controller.ports || []) {
      const carriesStrand = (port.chain || []).some((e) => entryFixtureName(e) !== null);
      if (!carriesStrand) continue;
      if (!Number.isInteger(port.universe)) continue;
      if (!byUniverse.has(port.universe)) byUniverse.set(port.universe, []);
      byUniverse.get(port.universe).push(port.port);
    }
    for (const [universe, ports] of byUniverse) {
      if (ports.length < 2) continue;
      warnings.push({
        code: 'led_universe_duplicate',
        controllerId: controller.id,
        port: ports[0],
        message: `outputs ${ports.map((n) => `P${n}`).join(' & ')} all declare U${universe} — each ` +
          `device output streams from U${universe} channel 1, so they overwrite each other; give ` +
          'each output its own universe',
      });
    }
  }

  // Streamed universes per controller, from the ONE canonical per-output
  // projection (start + every spill), for cross-source collision checks.
  const { fields } = computeLedStrandPatches(registry, counts);
  const ordinalToController = new Map();
  registry.controllers.forEach((c, i) => ordinalToController.set(i + 1, c));
  const universesByOrdinal = new Map();
  for (const rec of fields.values()) {
    if (!universesByOrdinal.has(rec.controllerId)) universesByOrdinal.set(rec.controllerId, new Set());
    const set = universesByOrdinal.get(rec.controllerId);
    for (const seg of rec.segments) set.add(seg.universe);
  }
  const ledSpans = []; // { controller, universes:Set<number> }
  for (const [ordinal, universes] of universesByOrdinal) {
    const controller = ordinalToController.get(ordinal);
    if (controller) ledSpans.push({ controller, universes });
  }

  // LED-vs-DMX collisions (real streamed universes vs DMX occupancy).
  for (const { controller, universes } of ledSpans) {
    for (const u of universes) {
      const dmxClaims = dmxMaps.get(u);
      if (!Array.isArray(dmxClaims) || dmxClaims.length === 0) continue;
      const names = dmxClaims.map((c) => c && c.name).filter(Boolean).slice(0, 3).join(', ');
      warnings.push({
        code: 'led_universe_collision',
        controllerId: controller.id,
        port: 0,
        message: `LED controller '${controller.name}' streams U${u}, already used by DMX ` +
          `fixtures (${names || 'DMX claims'}) — two sources on one universe will fight`,
      });
    }
  }
  // LED-vs-LED collisions (each unordered pair once).
  for (let i = 0; i < ledSpans.length; i++) {
    for (let j = i + 1; j < ledSpans.length; j++) {
      const shared = [...ledSpans[i].universes].filter((u) => ledSpans[j].universes.has(u));
      for (const u of shared) {
        warnings.push({
          code: 'led_universe_collision',
          controllerId: ledSpans[i].controller.id,
          port: 0,
          message: `LED controller '${ledSpans[i].controller.name}' streams U${u}, which also ` +
            `carries LED controller '${ledSpans[j].controller.name}' — the two devices will fight on U${u}`,
        });
      }
    }
  }
  return warnings;
}
