/**
 * address_merge.js — SHARED ADDRESSES: overlap detection, the deterministic
 * higher-IP override, and packet unification. PURE (no DOM, no I/O, no
 * registry mutation) so every rule below is unit-testable byte for byte.
 *
 * ── WHY THIS EXISTS (operator order 2026-07-31) ─────────────────────────────
 * *"make controllers allow sending to the same address with a warning instead
 * of an error — and for those, make sure you unify the packets and then send;
 * if conflicting, prioritize higher IPs and override."*
 *
 * Before this module a second controller landing on a universe another
 * controller already owned was a BLOCKING push refusal (`universe_owned`, see
 * device_config_mapper.js). Two boxes wired to one universe is a legitimate rig
 * shape — a splitter, a mirrored strand, a stand-in board — so it is now a
 * WARNING that names both claimants, the exact contested channel range, and who
 * wins. The refusals that remain are the ones a merge cannot rescue: two port
 * rows on ONE physical output, an output the board does not have, a card that
 * would leave every output dark.
 *
 * ── THE THREE RULES ────────────────────────────────────────────────────────
 *
 * 1. OVERLAP = same universe AND intersecting channel range. Two claims on the
 *    same universe at disjoint channels are not an overlap at all; they merge
 *    into one frame with nothing to resolve. The contested region is the
 *    INTERSECTION, never the whole claim: a 4-ch fixture at ch10–13 and a strand
 *    at ch12–20 contest ch12–13 only, and the strand keeps ch14–20 outright.
 *
 * 2. HIGHER IP WINS, and the comparison is NUMERIC OCTET-WISE — each dotted
 *    quad is folded to the unsigned 32-bit value `a·2²⁴ + b·2¹⁶ + c·2⁸ + d` and
 *    those integers are compared. This is NOT string ordering, and the
 *    difference is not academic on this rig: as strings `'10.0.0.9' > '10.0.0.10'`
 *    (because '9' > '1'), while numerically `10.0.0.10` is the higher address
 *    and therefore the winner. Every controller IP on the show LAN sits in one
 *    /24, so the last octet is what actually decides — exactly the number the
 *    operator reads off the controller's label.
 *
 * 3. AMBIGUITY IS STILL A HARD ERROR (codex P0, no fallbacks). The operator's
 *    rule ranks IP-BEARING claimants. When it cannot rank — two claims from the
 *    SAME IP (one controller mapped over itself, or two cards sharing an
 *    address), or a claim whose IP is missing / malformed / the `0.0.0.0`
 *    placeholder — there is no winner to pick and this module refuses to invent
 *    one. `planUnifiedOutput` returns those as `ambiguities` and
 *    `assertResolvableOverlaps` throws on them with the reason named.
 *
 * ── PACKET UNIFICATION ─────────────────────────────────────────────────────
 * A destination is a (universe, IP) pair, and it gets exactly ONE outgoing
 * packet per frame — never one packet per claimant racing another. The frame is
 * composed by applying every contribution in ASCENDING IP order, so the highest
 * IP's bytes are written last and win the contested channels by construction
 * (`composeUnifiedFrame`). The runtime shares one 512-byte universe buffer
 * already; `suppressionIndex` is the equivalent statement for that path — the
 * losing claim is told which absolute channels it must not write, so the result
 * is identical no matter what order the render list happens to be in.
 */

const IPV4_OCTETS = 4;

/** The placeholder that means "not wired yet" — never a rankable address. */
const PLACEHOLDER_IP = '0.0.0.0';

/**
 * Fold a dotted-quad IPv4 string into its unsigned 32-bit numeric value.
 *
 * STRICT: four decimal octets, each 0–255, no leading '+'/'-', no hostnames, no
 * IPv6. Anything else — including `0.0.0.0`, the sim's "no controller wired
 * here" placeholder — returns null, which is what makes it UNRANKABLE upstream
 * rather than silently the lowest address in the rig.
 *
 * `a * 2**24` (not `a << 24`): the shift operator is signed 32-bit in JS, so
 * every address at or above 128.x.x.x would come out NEGATIVE and compare below
 * every 10.x.x.x address. That bug would be invisible on this rig's 10/8 LAN and
 * would surface the first time somebody plugged in a 192.168.x.x controller.
 *
 * @param {string} ip
 * @returns {number|null} 0…4294967295, or null when `ip` is not a rankable IPv4.
 */
export function ipToNumber(ip) {
  if (typeof ip !== 'string') return null;
  const trimmed = ip.trim();
  if (!trimmed.length || trimmed === PLACEHOLDER_IP) return null;
  const parts = trimmed.split('.');
  if (parts.length !== IPV4_OCTETS) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return null;
    value = (value * 256) + octet;
  }
  return value;
}

/**
 * Rank two claimant IPs. Positive = `a` is the higher address (and therefore the
 * winner), negative = `b` is, 0 = the two are the SAME address.
 *
 * @returns {number|null} null when either side is unrankable (see ipToNumber) —
 *   the caller must treat that as an ambiguity, never as a tie.
 */
export function compareClaimantIp(a, b) {
  const na = ipToNumber(a);
  const nb = ipToNumber(b);
  if (na === null || nb === null) return null;
  return na === nb ? 0 : (na > nb ? 1 : -1);
}

/** Do two inclusive channel ranges intersect? */
export function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart <= bEnd && bStart <= aEnd;
}

/** A stable, human-readable id for a claim (used as the suppression key). */
export function claimKey(claim) {
  return `${claim.label}|U${claim.universe}|${claim.start}-${claim.end}`;
}

/**
 * Validate one claim record. THROWS on a structurally broken claim (a caller bug
 * — a missing universe or an inverted range is never operator state), which is
 * deliberately different from an UNRANKABLE IP: that one is operator state and
 * flows through as a named ambiguity the pane can render.
 */
function assertClaimShape(claim, index) {
  if (!claim || typeof claim !== 'object') {
    throw new Error(`[AddressMerge] claim #${index} is not an object`);
  }
  if (!Number.isInteger(claim.universe) || claim.universe < 1) {
    throw new Error(`[AddressMerge] claim #${index} ('${claim.label}') has no valid universe ` +
      `(got ${claim.universe})`);
  }
  if (!Number.isInteger(claim.start) || !Number.isInteger(claim.end) || claim.start < 1 ||
      claim.end < claim.start) {
    throw new Error(`[AddressMerge] claim #${index} ('${claim.label}') has an invalid channel ` +
      `range ${claim.start}–${claim.end}`);
  }
  if (typeof claim.label !== 'string' || !claim.label.length) {
    throw new Error(`[AddressMerge] claim #${index} has no label — every overlap warning must be ` +
      'able to name its claimants');
  }
}

/**
 * Find every pair of claims that contest the same channels.
 *
 * @param {Array<{label:string, ip:(string|undefined), universe:number,
 *   start:number, end:number, controllerId:(number|undefined),
 *   portNum:(number|undefined), kind:(string|undefined)}>} claims
 * @returns {{overlaps: Array<Object>, ambiguities: Array<Object>}}
 *   `overlaps` are RESOLVED (a winner and a loser, decided by IP);
 *   `ambiguities` are the ones the operator's rule cannot rank — same IP, or a
 *   claimant with no usable IP. Both carry the exact contested range.
 */
export function findAddressOverlaps(claims) {
  if (!Array.isArray(claims)) {
    throw new Error('[AddressMerge] findAddressOverlaps(claims): claims must be an array');
  }
  claims.forEach(assertClaimShape);

  const byUniverse = new Map();
  for (const claim of claims) {
    if (!byUniverse.has(claim.universe)) byUniverse.set(claim.universe, []);
    byUniverse.get(claim.universe).push(claim);
  }

  const overlaps = [];
  const ambiguities = [];
  for (const [universe, list] of [...byUniverse].sort((a, b) => a[0] - b[0])) {
    // Deterministic pair order: by start channel, then label. Two runs over the
    // same registry must produce the same warning list in the same order, or the
    // pane's banner would reshuffle itself on every render.
    const sorted = [...list].sort((a, b) => a.start - b.start || a.label.localeCompare(b.label));
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const a = sorted[i];
        const b = sorted[j];
        if (b.start > a.end) break;   // sorted by start: nothing further can reach back
        if (!rangesOverlap(a.start, a.end, b.start, b.end)) continue;
        const start = Math.max(a.start, b.start);
        const end = Math.min(a.end, b.end);
        const rank = compareClaimantIp(a.ip, b.ip);
        if (rank === null) {
          const which = ipToNumber(a.ip) === null ? a : b;
          ambiguities.push({
            universe, start, end, claims: [a, b],
            reason: 'unrankable_ip',
            message: `U${universe} ch ${start}–${end}: '${a.label}' (${describeIp(a.ip)}) and ` +
              `'${b.label}' (${describeIp(b.ip)}) claim the same channels, but ` +
              `'${which.label}' has no usable controller IP (${describeIp(which.ip)}) — the ` +
              'higher-IP rule cannot rank them. Give it a real device IP, or move one address.',
          });
          continue;
        }
        if (rank === 0) {
          ambiguities.push({
            universe, start, end, claims: [a, b],
            reason: 'same_ip',
            message: `U${universe} ch ${start}–${end}: '${a.label}' and '${b.label}' claim the ` +
              `same channels on the SAME controller IP ${a.ip} — one box cannot outrank itself, ` +
              'so there is no winner to pick. Move one address.',
          });
          continue;
        }
        const winner = rank > 0 ? a : b;
        const loser = rank > 0 ? b : a;
        overlaps.push({
          universe, start, end, winner, loser,
          message: `U${universe} ch ${start}–${end}: '${winner.label}' (${winner.ip}) and ` +
            `'${loser.label}' (${loser.ip}) both send here — frames are UNIFIED into one packet ` +
            `per destination and ${winner.ip} wins the contested channels (higher IP overrides).`,
        });
      }
    }
  }
  return { overlaps, ambiguities };
}

/** Operator-facing text for an IP that may be absent or a placeholder. */
function describeIp(ip) {
  if (typeof ip !== 'string' || !ip.trim().length) return 'no IP';
  if (ip.trim() === PLACEHOLDER_IP) return `${PLACEHOLDER_IP} — placeholder`;
  return ipToNumber(ip) === null ? `'${ip}' — malformed` : ip;
}

/**
 * The full unification plan for a claim set.
 *
 * @param {Array<Object>} claims - see findAddressOverlaps.
 * @returns {{destinations: Array<{universe:number, ip:string, claims:Array}>,
 *   overlaps: Array<Object>, ambiguities: Array<Object>,
 *   suppressions: Array<{claim:Object, universe:number, start:number, end:number,
 *     winnerLabel:string, winnerIp:string}>}}
 *
 *   `destinations` is the ONE-PACKET-PER-(universe, IP) statement: whatever the
 *   claim count, a destination appears exactly once, so two claimants can never
 *   race two packets at one box.
 *   `suppressions` is the loser's side of every resolved overlap — the absolute
 *   channels it must not write.
 *
 * Does NOT throw on ambiguity: the pane has to RENDER those (as errors) next to
 * the resolved warnings. Call assertResolvableOverlaps() on any path that is
 * about to write hardware.
 */
export function planUnifiedOutput(claims) {
  const { overlaps, ambiguities } = findAddressOverlaps(claims);

  const destinations = new Map();
  for (const claim of claims) {
    const ip = typeof claim.ip === 'string' ? claim.ip.trim() : '';
    if (!ip.length || ip === PLACEHOLDER_IP) continue;   // nothing is sent to a placeholder
    const key = `${claim.universe}:${ip}`;
    if (!destinations.has(key)) destinations.set(key, { universe: claim.universe, ip, claims: [] });
    destinations.get(key).claims.push(claim);
  }

  const suppressions = overlaps.map((o) => ({
    claim: o.loser,
    universe: o.universe,
    start: o.start,
    end: o.end,
    winnerLabel: o.winner.label,
    winnerIp: o.winner.ip,
  }));

  return {
    destinations: [...destinations.values()]
      .sort((a, b) => a.universe - b.universe || a.ip.localeCompare(b.ip)),
    overlaps,
    ambiguities,
    suppressions,
  };
}

/**
 * The hard gate. Anything the higher-IP rule could not rank stops the caller
 * LOUDLY with every reason named — no fallback, no "pick the first one"
 * (codex P0). Resolved overlaps pass straight through; they are warnings.
 */
export function assertResolvableOverlaps(plan) {
  if (!plan || !Array.isArray(plan.ambiguities)) {
    throw new Error('[AddressMerge] assertResolvableOverlaps(plan): pass a planUnifiedOutput result');
  }
  if (plan.ambiguities.length === 0) return;
  throw new Error('[AddressMerge] ✋ UNRESOLVABLE shared address' +
    (plan.ambiguities.length > 1 ? 'es' : '') + ' — the higher-IP rule ranks IP-bearing ' +
    'claimants only:\n' + plan.ambiguities.map((a) => `  • ${a.message}`).join('\n'));
}

/**
 * `claimKey(loser)` → the absolute channel ranges that claim LOST. Built once
 * per projection (never per frame) and consulted by the write path.
 *
 * @param {Object} plan - a planUnifiedOutput result.
 * @returns {Map<string, Array<{universe:number, start:number, end:number,
 *   winnerLabel:string, winnerIp:string}>>}
 */
export function suppressionIndex(plan) {
  const index = new Map();
  for (const s of plan.suppressions) {
    const key = claimKey(s.claim);
    if (!index.has(key)) index.set(key, []);
    index.get(key).push({
      universe: s.universe, start: s.start, end: s.end,
      winnerLabel: s.winnerLabel, winnerIp: s.winnerIp,
    });
  }
  return index;
}

/**
 * The same suppressions, re-keyed the way the RUNTIME write path can look them
 * up: `universe → losingIp → [{start, end, winnerIp, winnerLabel}]`.
 *
 * WHY BY IP, not by claim label: the render list is per PIXEL, and a pixel knows
 * its fixture's `controllerIp` and its own (universe, channel) — it does not know
 * which projection claim record it came from. Aggregating a controller's losses
 * per universe is exactly equivalent, because a channel where one IP loses to a
 * HIGHER IP is a channel that IP must never write, whichever of its fixtures is
 * standing on it. (Two fixtures of the SAME controller contesting one channel
 * cannot reach here at all — that is a `same_ip` ambiguity and a hard error.)
 *
 * @returns {Map<number, Map<string, Array<{start:number, end:number,
 *   winnerIp:string, winnerLabel:string}>>>}
 */
export function lostChannelIndex(plan) {
  const index = new Map();
  for (const s of plan.suppressions) {
    const ip = typeof s.claim.ip === 'string' ? s.claim.ip.trim() : '';
    if (!ip.length) continue;   // unrankable claims never get here (they are ambiguities)
    if (!index.has(s.universe)) index.set(s.universe, new Map());
    const perIp = index.get(s.universe);
    if (!perIp.has(ip)) perIp.set(ip, []);
    perIp.get(ip).push({
      start: s.start, end: s.end, winnerIp: s.winnerIp, winnerLabel: s.winnerLabel,
    });
  }
  return index;
}

/**
 * The ranges `ip` LOST on `universe`, or null. Returns null fast for the
 * overwhelmingly common uncontested case so the per-frame write path pays one
 * Map lookup per fixture and nothing per channel.
 */
export function lostRangesFor(index, universe, ip) {
  if (!index || !index.size) return null;
  const perIp = index.get(universe);
  if (!perIp) return null;
  const ranges = perIp.get(typeof ip === 'string' ? ip.trim() : ip);
  return (ranges && ranges.length) ? ranges : null;
}

/** Is this 1-based absolute channel inside any of `ranges`? */
export function channelIsLost(ranges, channel) {
  if (!ranges) return false;
  for (const r of ranges) {
    if (channel >= r.start && channel <= r.end) return true;
  }
  return false;
}

/**
 * Is this 1-based absolute channel one the claim lost? `ranges` is one entry of
 * a suppressionIndex (or undefined/empty for an uncontested claim, the common
 * case — which is why the write path checks the Map ONCE per fixture and only
 * pays per-channel when something is actually contested).
 */
export function channelIsSuppressed(ranges, universe, channel) {
  if (!ranges || !ranges.length) return false;
  for (const r of ranges) {
    if (r.universe === universe && channel >= r.start && channel <= r.end) return true;
  }
  return false;
}

/**
 * Compose ONE outgoing 512-byte frame for a destination from every claimant that
 * feeds it — the byte-level statement of "unify the packets and then send".
 *
 * Contributions are applied in ASCENDING IP order, so the HIGHEST IP writes last
 * and owns every contested channel. A claimant with an unrankable IP is refused
 * here rather than ordered arbitrarily (the same P0 as assertResolvableOverlaps:
 * this function is on the write path).
 *
 * @param {{universe:number, ip:string}} destination
 * @param {Array<{claim:{label:string, ip:string, universe:number, start:number,
 *   end:number}, bytes:(Uint8Array|number[])}>} contributions - `bytes` is the
 *   claim's own payload, `bytes[0]` landing on `claim.start`.
 * @returns {Uint8Array} 512 bytes, channel 1 at index 0.
 */
export function composeUnifiedFrame(destination, contributions) {
  if (!destination || !Number.isInteger(destination.universe)) {
    throw new Error('[AddressMerge] composeUnifiedFrame: destination {universe, ip} is required');
  }
  const ordered = [...contributions].sort((x, y) => {
    const nx = ipToNumber(x.claim.ip);
    const ny = ipToNumber(y.claim.ip);
    if (nx === null || ny === null) {
      throw new Error(`[AddressMerge] composeUnifiedFrame: '${(nx === null ? x : y).claim.label}' ` +
        `has no rankable controller IP (${describeIp((nx === null ? x : y).claim.ip)}) — refusing ` +
        'to order contributions arbitrarily on a frame that goes to hardware');
    }
    // Ties are legal here (one controller contributing several fixtures to its
    // OWN universe): they never contest channels, or findAddressOverlaps already
    // raised a same_ip ambiguity. Order them by start channel for determinism.
    return nx - ny || x.claim.start - y.claim.start;
  });

  const frame = new Uint8Array(512);
  for (const c of ordered) {
    if (c.claim.universe !== destination.universe) continue;
    const bytes = c.bytes;
    for (let i = 0; i < bytes.length; i++) {
      const channel = c.claim.start + i;          // 1-based
      if (channel < 1 || channel > 512) continue;  // spill belongs to the NEXT universe's frame
      frame[channel - 1] = bytes[i] & 0xff;
    }
  }
  return frame;
}

/**
 * Build the unified claim list from the two projections the rig already
 * produces. Kept HERE (rather than importing the projections) so this module
 * stays pure and free of the controller_registry import cycle — the caller
 * passes exactly the same `sources` object `collectClaimedUniverses` takes.
 *
 * THE ID TRAP (docs/33 decision 20, restated in device_config_mapper.js): the
 * two claim sources key their owner DIFFERENTLY.
 *  - `dmxUniverseMaps` claims carry the owner's STABLE `controller.id`.
 *  - `ledClaims` claims carry the owner's 1-based PANEL ORDINAL.
 * Resolving a claimant's IP therefore has to go through the matching lookup, and
 * getting it wrong would attribute a controller's address to its neighbour — the
 * exact defect report 20260725_70 §1.4 fixed in the collision text.
 *
 * @param {{dmxUniverseMaps: Map<number, Array>, ledClaims: Map<number, Array>,
 *   controllers: Array<Object>}} sources
 * @returns {Array<Object>} claims, ready for planUnifiedOutput.
 */
export function collectAddressClaims(sources) {
  if (!sources || typeof sources !== 'object') {
    throw new Error('[AddressMerge] collectAddressClaims: sources ' +
      '{dmxUniverseMaps, ledClaims, controllers} is required');
  }
  const { dmxUniverseMaps, ledClaims, controllers } = sources;
  if (!(dmxUniverseMaps instanceof Map)) {
    throw new Error('[AddressMerge] collectAddressClaims: dmxUniverseMaps must be a Map ' +
      '(computeProjection().universeMaps)');
  }
  if (!(ledClaims instanceof Map)) {
    throw new Error('[AddressMerge] collectAddressClaims: ledClaims must be a Map ' +
      '(computeLedUniverseClaims())');
  }
  if (!Array.isArray(controllers)) {
    throw new Error('[AddressMerge] collectAddressClaims: controllers must be the registry ' +
      'controllers array');
  }

  const byStableId = new Map(controllers.map((c) => [c.id, c]));
  const claims = [];

  for (const [universe, list] of dmxUniverseMaps) {
    for (const c of list || []) {
      // Global-effect pins gang-fire on one address BY DESIGN (operator decision
      // 2026-06-12, "same address to start multiple foggers at the same time,
      // always"). They are not a contest and must never produce a warning.
      if (c.effect) continue;
      const owner = byStableId.get(c.controllerId);
      claims.push({
        label: c.name ? `${c.name}` : `gap on ${c.controllerName} P${c.portNum}`,
        ip: owner ? owner.ip : undefined,
        universe,
        start: c.start,
        end: Math.min(c.end, 512),
        controllerId: c.controllerId,
        controllerName: c.controllerName,
        portNum: c.portNum,
        kind: 'dmx',
      });
    }
  }

  for (const [universe, list] of ledClaims) {
    for (const c of list || []) {
      const owner = controllers[c.controllerId - 1];   // ORDINAL, not stable id
      claims.push({
        label: c.name,
        ip: owner ? owner.ip : undefined,
        universe,
        start: c.start,
        end: Math.min(c.end, 512),
        controllerId: c.controllerId,
        controllerName: owner ? owner.name : `controller #${c.controllerId}`,
        portNum: c.portNum,
        kind: 'led',
      });
    }
  }

  return claims;
}

/**
 * The overlaps + ambiguities that touch ONE controller — what its card banner
 * renders. A controller is "touched" when it owns either side of the contest.
 *
 * @param {Object} plan - a planUnifiedOutput result.
 * @param {Object} controller - the registry controller whose card is rendering.
 * @returns {{wins: Array, loses: Array, ambiguous: Array, total: number}}
 */
export function overlapsForController(plan, controller) {
  const ip = controller && typeof controller.ip === 'string' ? controller.ip.trim() : '';
  const mine = (claim) => typeof claim.ip === 'string' && claim.ip.trim() === ip && ip.length > 0;
  const wins = plan.overlaps.filter((o) => mine(o.winner));
  const loses = plan.overlaps.filter((o) => mine(o.loser));
  const ambiguous = plan.ambiguities.filter((a) => a.claims.some(mine));
  return { wins, loses, ambiguous, total: wins.length + loses.length + ambiguous.length };
}

/**
 * One line per contest for a controller card / push dialog. Written from the
 * card's point of view ("you win" / "you are overridden") because that is the
 * question the operator is actually asking when he opens the pane.
 */
export function describeOverlapsForController(view) {
  const lines = [];
  for (const o of view.wins) {
    lines.push(`U${o.universe} ch ${o.start}–${o.end} — shared with '${o.loser.label}' ` +
      `(${o.loser.ip}); THIS card wins (higher IP ${o.winner.ip} overrides).`);
  }
  for (const o of view.loses) {
    lines.push(`U${o.universe} ch ${o.start}–${o.end} — shared with '${o.winner.label}' ` +
      `(${o.winner.ip}); '${o.winner.label}' WINS and overrides this card here (higher IP).`);
  }
  for (const a of view.ambiguous) lines.push(`✋ ${a.message}`);
  return lines;
}
