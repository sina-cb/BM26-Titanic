/**
 * output_config_guard.js — the engine has ONE output path: the sACN bridge.
 *
 * WHY THIS FILE EXISTS (operator ruling 2026-08-05). The engine used to support
 * a `controllers:` config block that unicast declared universes STRAIGHT TO
 * HARDWARE — sACN or Art-Net — bypassing the simulation's input bridge entirely.
 * That is an exception to the project's single routing authority, and it cost
 * real debugging time twice over:
 *
 *   - the bridge cannot suspend, suppress, gate or even SEE a route the engine
 *     unicasts itself, so any invariant of the form "exactly one writer per
 *     (universe, controller)" became unprovable the moment such a block existed;
 *   - ownership was compared by ADDRESS while hardware is a BOARD, so a box that
 *     answered on two addresses could be double-driven with every check green
 *     (report 20260805_153 F4).
 *
 * The mechanism is gone. `lib/output_dispatch.js` and `lib/artnet_output.js` are
 * deleted; `lib/sacn_output.js` streams to the flat `sacn.destinations` list and
 * nothing else. All sACN toward hardware flows through the bridge, which is the
 * single router.
 *
 * A REMOVED KEY MUST NOT BE SILENTLY IGNORED (codex P0). An operator or an agent
 * who reintroduces `controllers:` — by copying an old config, by restoring a
 * backup, by following a stale doc — would otherwise get a config that LOOKS
 * like it routes to hardware and does nothing, which is a worse failure than the
 * one being removed. So the engine REFUSES TO BOOT and names the key.
 */

/** Config keys whose whole mechanism was removed. Each names its own refusal. */
const FORBIDDEN_KEYS = [
  {
    key: 'controllers',
    why: 'declared per-controller routes that the engine unicast STRAIGHT TO HARDWARE, ' +
      'bypassing the simulation\'s sACN bridge',
  },
];

/** Per-controller keys that only ever meant something inside `controllers:`. */
const FORBIDDEN_NESTED = ['alsoFlat', 'protocol'];

/**
 * Refuse to start if the config still declares a removed direct-to-hardware
 * route. Throws with the key named and the replacement stated.
 *
 * @param {Object} config the parsed config.yaml tree
 * @param {string} [where] the file it came from, for the message
 */
export function assertNoDirectHardwareRoutes(config, where = 'config.yaml') {
  if (!config || typeof config !== 'object') return;
  for (const { key, why } of FORBIDDEN_KEYS) {
    if (!(key in config)) continue;
    throw new Error(
      `[Output] ${where} still declares '${key}:', which ${why}. That mechanism has been ` +
      'REMOVED: the engine now has exactly one output path — sACN to `sacn.destinations` ' +
      '(127.0.0.1 by default), where the simulation\'s input bridge is the single router to ' +
      'every controller. Direct-to-hardware routes from the engine are forbidden: the bridge ' +
      'cannot suspend, gate or account for a stream it never sees, so one-writer-per-' +
      '(universe, controller) stops being provable. DELETE the ' +
      `'${key}:' block from ${where}. Refusing to boot rather than ignore it, because a ` +
      'silently-ignored routing key is a config that looks like it reaches hardware and does ' +
      'not.');
  }
  // A stray `alsoFlat:` / `protocol:` anywhere at the top level is the same
  // breadcrumb wearing a different hat.
  for (const key of FORBIDDEN_NESTED) {
    if (!(key in config)) continue;
    throw new Error(
      `[Output] ${where} declares '${key}:' at the top level. That key only ever existed inside ` +
      'the removed `controllers:` block (per-controller transport / dual-send). There is no ' +
      'per-controller transport any more — all engine output is sACN to `sacn.destinations` and ' +
      `the bridge routes it. Remove '${key}:'.`);
  }
}

export { FORBIDDEN_KEYS, FORBIDDEN_NESTED };
