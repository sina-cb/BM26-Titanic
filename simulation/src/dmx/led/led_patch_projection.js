/**
 * led_patch_projection.js — PURE projection of a bound MarsinLED controller's
 * strands onto the DEVICE-LINEAR sACN layout, for the scene patch records
 * (plan 20260709_0 P4). NO I/O, NO DOM.
 *
 * Why a separate projection from the registry's `computeLedProjection`:
 * `computeLedProjection` resets the channel cursor at the START of every PORT
 * (each port is an independent lane in the sim's generic LED model). A physical
 * MarsinLED does NOT — its firmware maps incoming channels LINEARLY and
 * CONTIGUOUSLY across the ENABLED outputs from a single (dmx.universe,
 * dmx.startAddress): output 0's pixels, then output 1 CONTINUES where output 0
 * ended (docs/41 §3, device_config_mapper.computeLinearLayout). For a device-
 * BOUND controller the patch records must match the hardware byte-for-byte, so
 * this projection walks one contiguous cursor across the outputs — the same
 * algorithm computeLinearLayout uses, but reported per STRAND (a port may chain
 * several strands) so each strand gets its own patch record.
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
import {
  firstEnabledPortUniverse,
  synthLinearConfig,
  computeLinearLayout,
} from './device_config_mapper.js';

/**
 * Walk one LED strand's pixels from a starting (universe, channel) with a
 * fixed byte `stride`, wrapping universes by WHOLE pixels (a pixel never
 * straddles a universe: when it would cross channel 512 the cursor jumps to
 * channel 1 of the next universe, leaving the tail bytes of the old universe
 * unused). This is the ONE source of truth for the firmware's contiguous
 * linear byte layout — `computeLedStrandPatches` walks it to place each
 * strand's start, and the scene exporter walks it to emit each pixel's
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
 * contiguous linear layout.
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
 *   `dmxUniverse`/`dmxAddress` stay the strand's START (bytes unchanged);
 *   `segments`/`endUniverse`/`endChannel` are the derived DMX-parity view of the
 *   SAME walk (a 200 px RGBW strand at U6:1 → `[U6 ch1–512 ×128, U7 ch1–288 ×72]`,
 *   endUniverse 7, endChannel 288).
 */
export function computeLedStrandPatches(registry, strandLedCounts) {
  const fields = new Map();
  const violations = [];
  if (!registry || !Array.isArray(registry.controllers)) return { fields, violations };

  const counts = strandLedCounts instanceof Map
    ? strandLedCounts
    : new Map(Object.entries(strandLedCounts || {}));

  registry.controllers.forEach((controller, index) => {
    // ONLY device-bound LED controllers use the device-linear model. Unbound
    // LED controllers keep the sim's generic per-port projection
    // (computeLedProjection) — they have no hardware to agree with.
    if (!isLedController(controller) || !isBoundLedController(controller)) return;

    const led = controller.led || normalizeLedConfig(null, controller.name);
    const ordinal = index + 1;
    const ipOk = isValidIp(controller.ip);
    const stride = ledStrideForOrder(led.order, led.stride);

    // Base universe = the FIRST ENABLED output's manual per-output universe
    // (Slice D — the device-linear model; led.baseUniverse is no longer read
    // for bound controllers). A controller with no strand-carrying output has
    // nothing to patch — return quietly, exactly like an empty DMX controller.
    const base = firstEnabledPortUniverse(controller);
    if (!base) return;
    // A 0/out-of-range base can't be rendered contiguously; flag it loudly and
    // leave the strands unpatched (same recovery contract as before).
    if (!Number.isInteger(base.universe) || base.universe < 1 || base.universe > MAX_UNIVERSE) {
      violations.push({
        code: 'led_unallocated_base',
        controllerId: controller.id,
        message: `LED controller '${controller.name}' is bound but its first enabled output ` +
          `(port ${base.port.port}) has no valid universe (${base.universe}) — set that output's ` +
          'universe before patching; its strands project unpatched',
      });
      return;
    }
    if (!ipOk) {
      violations.push({
        code: 'led_bad_ip',
        controllerId: controller.id,
        message: `Bound LED controller '${controller.name}' has a malformed or missing IP ` +
          `('${controller.ip}') — its strands project unpatched`,
      });
    }

    let universe = base.universe;
    let channel = led.startAddr; // 1-based next free channel
    let capViolation = false;

    // Device outputs run in physical index order (port 1 = output 0, …). Sort
    // by port number so the contiguous cursor visits outputs in device order.
    const sortedPorts = [...controller.ports].sort((a, b) => a.port - b.port);
    for (const port of sortedPorts) {
      if (capViolation) break;
      const outputIndex = port.port - 1;
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
        // Walk the strand's pixels with the shared contiguous-layout walker,
        // then advance the running cursor to where it ended so the next strand
        // packs immediately after (the firmware's single contiguous stream).
        const walk = projectLedStrandSegments(universe, channel, stride, ledCount);
        if (walk.overflow) {
          violations.push({
            code: 'led_universe_overflow',
            controllerId: controller.id,
            message: `LED controller '${controller.name}': strand '${name}' spills past the ` +
              `sACN universe ceiling ${MAX_UNIVERSE} — layout does not fit; strands from here ` +
              'project unpatched',
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

// ── Manual per-output universe validation (WARN, never block — Slice D) ───────

/** Human-readable universe:channel span for one linear-layout output entry. */
function outputSpanText(out) {
  return out.universe === out.endUniverse
    ? `U${out.universe} ch ${out.startChannel}–${out.endChannel}`
    : `U${out.universe} ch ${out.startChannel} → U${out.endUniverse} ch ${out.endChannel}`;
}

/**
 * Per-controller honorability of the manual per-output universes, given the
 * controller's already-computed device-linear layout (computeLinearLayout).
 * PURE. Emits LOUD, NON-BLOCKING warnings — the operator owns universe matching
 * (docs/41 §3); this never rewrites a universe and never blocks a push.
 *
 *  - `led_universe_unhonorable`: an enabled output's declared `port.universe`
 *    is not where the single-base linear device actually drives its pixels;
 *    the message spells out the REAL span the device will use.
 *  - `led_universe_duplicate`: two enabled outputs declare the SAME universe
 *    but the device lands them at different channels (only one output can start
 *    at a given universe:channel on a single-base linear device).
 *
 * @param {Object} controller - the bound LED controller (registry shape).
 * @param {Array} layout - computeLinearLayout(...) result for this controller.
 * @returns {Array<{code: string, controllerId: number, port: number, message: string}>}
 */
export function ledUniverseHonorability(controller, layout) {
  const warnings = [];
  if (!controller || !Array.isArray(layout)) return warnings;
  const portByOutput = new Map();
  for (const port of controller.ports || []) portByOutput.set(port.port - 1, port);

  for (const out of layout) {
    if (!out || !out.enabled) continue;
    const port = portByOutput.get(out.outputIndex);
    if (!port) continue;
    const declared = port.universe;
    // Honorable iff the whole output stays inside the declared universe.
    if (out.universe === declared && out.endUniverse === declared) continue;
    warnings.push({
      code: 'led_universe_unhonorable',
      controllerId: controller.id,
      port: port.port,
      message: `P${port.port} is set to U${declared}, but the device is single-base linear and ` +
        `will drive these pixels at ${outputSpanText(out)} — align the earlier outputs to a ` +
        'universe boundary (128 px RGBW) or accept the device layout',
    });
  }

  // Duplicate declared universes across enabled outputs that land differently.
  const byDeclared = new Map();
  for (const out of layout) {
    if (!out || !out.enabled) continue;
    const port = portByOutput.get(out.outputIndex);
    if (!port) continue;
    if (!byDeclared.has(port.universe)) byDeclared.set(port.universe, []);
    byDeclared.get(port.universe).push({ port, out });
  }
  for (const [declared, group] of byDeclared) {
    if (group.length < 2) continue;
    const starts = new Set(group.map((g) => `${g.out.universe}:${g.out.startChannel}`));
    if (starts.size < 2) continue;
    const list = group.map((g) => `P${g.port.port}→${outputSpanText(g.out)}`).join(', ');
    warnings.push({
      code: 'led_universe_duplicate',
      controllerId: controller.id,
      port: group[0].port.port,
      message: `outputs ${group.map((g) => `P${g.port.port}`).join(' & ')} all declare U${declared}, ` +
        `but the single-base linear device places them at different channels (${list}) — only one ` +
        'output can start at a given universe:channel',
    });
  }
  return warnings;
}

/**
 * Validate every BOUND LED controller's manual per-output universes against the
 * device-linear reality AND against the rest of the rig. PURE (no DOM, no I/O).
 * Returns LOUD, NON-BLOCKING warnings only — projection and push always proceed;
 * the operator declared the universes and owns the choice (docs/41 §3, codex P0:
 * fail loud, but here "loud" means a visible warning, never a silent rewrite).
 *
 *  - `led_universe_unhonorable` / `led_universe_duplicate` (per controller, from
 *    ledUniverseHonorability).
 *  - `led_universe_collision`: the universes a controller ACTUALLY streams
 *    (derived spans, spills included) overlap a DMX universe (from
 *    `dmxUniverseMaps`) or another bound LED controller's streamed universes —
 *    two sources on one universe fight.
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

  const ledSpans = []; // { controller, universes:Set<number> }
  for (const controller of registry.controllers) {
    if (!isLedController(controller) || !isBoundLedController(controller)) continue;
    const synth = synthLinearConfig(controller, strandCounts);
    if (!synth) continue; // no enabled output — nothing to validate
    let layout;
    try {
      layout = computeLinearLayout(synth);
    } catch {
      // A cap overflow / out-of-range base surfaces as its OWN projection
      // violation (computeLedStrandPatches) — don't duplicate it here.
      continue;
    }
    warnings.push(...ledUniverseHonorability(controller, layout));
    const universes = new Set();
    for (const out of layout) {
      if (!out || !out.enabled) continue;
      for (let u = out.universe; u <= out.endUniverse; u++) universes.add(u);
    }
    ledSpans.push({ controller, universes });
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
