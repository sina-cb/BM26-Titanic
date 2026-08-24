// sacn_black_hole.mjs — the ONE definition of "a test engine's sACN can never
// reach anything", plus the assertion that proves it.
//
// WHY (report `_361` BLOCKER 1). The production `config.yaml` points
// `sacn.destinations` at `127.0.0.1`, which is not an abstraction — it is the
// operator's LIVE simulation input bridge on UDP 5568. `npm test` spawns real
// `engine.js` subprocesses (89 test files reference it) at
// `--test-concurrency=4`, so an unwalled test config puts up to four extra
// `MarsinEngine` sACN sources on the running show. They share the `sacn`
// package's hardcoded E1.31 CID with the operator's engine, so the sim's
// receiver — which keys its sequence tracking on CID+universe — thrashes one
// counter across two streams and silently discards frames
// (`|Δseq| > 20`). The visible result is a patchwork of stale colours on the
// ship: exactly the anomaly `_361` was opened to explain.
//
// A LOOPBACK DESTINATION IS NOT A BLACK HOLE. The sim's sACN receiver binds
// every local interface, so it receives loopback-destined frames and relays
// them onward to the real rig. Neither is any address that a NIC could route.
// The only safe destinations are the RFC 5737 documentation blocks, which are
// reserved and never routed:
//
//   192.0.2.0/24    TEST-NET-1  ← what this project uses
//   198.51.100.0/24 TEST-NET-2
//   203.0.113.0/24  TEST-NET-3
//
// Consumers: `setup_config_guard.mjs` (the global `--import` guard, which
// covers every test file), `tests/e2e/timeline_e2e_harness.mjs` (its own
// asserted wall), and the suites that pass `--dest 192.0.2.9` explicitly.
//
// Not a `*.test.*` module, so no runner picks it up.

/** The project's canonical black hole: TEST-NET-1 (RFC 5737), never routed. */
export const SACN_BLACK_HOLE_HOST = '192.0.2.9';

/** RFC 5737 documentation blocks — the ONLY destinations a test may transmit to. */
const RESERVED_TEST_PREFIXES = ['192.0.2.', '198.51.100.', '203.0.113.'];

/**
 * Classify one sACN destination. Returns `'black-hole'` only for an RFC 5737
 * documentation address; every other well-formed IPv4 literal is named for
 * why it is unsafe. A non-IPv4 string (a hostname, an empty value) is
 * `'unresolvable'` — a test must never hand the sender something whose route
 * depends on DNS.
 *
 * @param {unknown} dest
 * @returns {'black-hole'|'loopback'|'multicast'|'broadcast'|'routable'|'unresolvable'}
 */
export function classifySacnDestination(dest) {
  if (typeof dest !== 'string') return 'unresolvable';
  const octets = dest.trim().split('.');
  if (octets.length !== 4) return 'unresolvable';
  const nums = octets.map((o) => (/^\d{1,3}$/.test(o) ? Number(o) : NaN));
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return 'unresolvable';

  if (RESERVED_TEST_PREFIXES.some((p) => dest.startsWith(p))) return 'black-hole';
  if (nums[0] === 127) return 'loopback';
  if (nums[0] >= 224 && nums[0] <= 239) return 'multicast';
  if (dest === '255.255.255.255' || nums[0] === 0) return 'broadcast';
  return 'routable';
}

/**
 * Refuse loudly unless EVERY destination is a black hole. No fallback: a
 * config that cannot be proven safe must stop the run, not degrade to a
 * warning, because the failure mode is invisible frames on a live show.
 *
 * @param {unknown} destinations the `sacn.destinations` value
 * @param {string} [where] what produced it, for the message
 */
export function assertSacnDestinationsBlackHoled(destinations, where = 'test sACN config') {
  if (!Array.isArray(destinations) || destinations.length === 0) {
    throw new Error(
      `[sACN wall] ${where}: expected a non-empty sacn.destinations array, got ` +
      `${JSON.stringify(destinations)}. An absent list means the engine falls back to its ` +
      'production destination — refusing rather than guessing.');
  }
  for (const dest of destinations) {
    const kind = classifySacnDestination(dest);
    if (kind === 'black-hole') continue;
    throw new Error(
      `[sACN wall] ${where}: destination ${JSON.stringify(dest)} is ${kind}, not a black hole. ` +
      `Test engines must transmit ONLY to an RFC 5737 documentation address (use ` +
      `${SACN_BLACK_HOLE_HOST}). A loopback destination is NOT safe: the simulation's sACN ` +
      'receiver binds every local interface, so it receives the frames and relays them to the ' +
      "operator's live rig (report _361 BLOCKER 1).");
  }
}
