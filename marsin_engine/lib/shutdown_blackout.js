/**
 * shutdown_blackout.js — the LAST DMX frame the engine ever sends.
 *
 * WHY THIS EXISTS (report 20260823_361 §8, "out of scope"):
 * `shutdown()` used to build its blackout by zeroing `model.pixels` and
 * running `mapPixelsToSacn()`. That mapper only writes the channel slots
 * belonging to a PATCHED PIXEL. Every other byte of a universe buffer is
 * written by somebody else and simply survives:
 *
 *   - DMX-only fixtures (fogger / haze / horn / fire) are raw-byte writes
 *     made by `GlobalEffectsController.applyDmx()` (and Live Touch's private
 *     controller) directly onto the outgoing frame — the router buffer keeps
 *     whatever those wrote last. `applyDmx` is a per-render-frame call and the
 *     shutdown path does not render a frame, so a fogger or horn latched at
 *     255 stayed at 255 in the "blackout" frame — and that frame is the LAST
 *     packet the rig ever receives, so it holds. Fog keeps pumping; the horn
 *     keeps sounding. That is a physical safety issue, not a lighting bug.
 *   - Channels orphaned by a model re-patch (a fixture that moved address)
 *     are no longer owned by any pixel and are likewise never re-zeroed.
 *
 * So the blackout is not derived from the show state at all any more: EVERY
 * channel of EVERY universe is zeroed outright, then PROVEN zero before it is
 * allowed on the wire. Nothing about a fixture's type, patch or owner can
 * exclude it. If the blackout cannot be built or cannot be proven, these
 * functions THROW — the caller reports it loudly and exits non-zero. There is
 * deliberately no best-effort path: a blackout you cannot confirm is exactly
 * the failure mode this module exists to remove.
 */

/** Channels in one DMX universe. A router buffer of any other size is a bug. */
export const DMX_UNIVERSE_SIZE = 512;

/** Cap on how many offending channels an error message enumerates. */
const MAX_REPORTED_CHANNELS = 8;

/**
 * Zero every channel of every universe the engine could still be driving.
 *
 * The universe set is the UNION of the transmit list (`universeIds`) and every
 * universe the router still holds a buffer for. They are normally identical;
 * they diverge exactly when a model reload pruned a universe from the transmit
 * list, and a universe we might still be transmitting is worth one extra
 * all-zero datagram at shutdown.
 *
 * @param {object} args
 * @param {{ getFullFrame: Function, listUniverses?: Function }} args.dmxRouter
 * @param {number[]} args.universeIds — universes the engine transmits.
 * @returns {{ frames: Object<number, Uint8Array>, universes: number[] }}
 * @throws {Error} if the router is unusable, a universe has no buffer, or a
 *   buffer is not a full 512-channel frame.
 */
export function buildBlackoutFrames({ dmxRouter, universeIds } = {}) {
  if (!dmxRouter || typeof dmxRouter.getFullFrame !== 'function') {
    throw new Error('[blackout] no DMX router with getFullFrame() — cannot build a blackout frame');
  }
  if (!Array.isArray(universeIds)) {
    throw new Error('[blackout] universeIds must be an array of universe numbers');
  }

  const universeSet = new Set(universeIds);
  if (typeof dmxRouter.listUniverses === 'function') {
    for (const uid of dmxRouter.listUniverses()) universeSet.add(uid);
  }
  const universes = [...universeSet].sort((a, b) => a - b);
  if (universes.length === 0) {
    throw new Error('[blackout] no universes to black out — the engine has no DMX output mapping, ' +
      'so no shutdown blackout can be sent');
  }

  const frames = {};
  for (const uid of universes) {
    const frame = dmxRouter.getFullFrame(uid);
    if (!frame) {
      throw new Error(`[blackout] universe ${uid} has no router buffer — its channels ` +
        '(which may include a fogger, horn or fire relay) cannot be zeroed');
    }
    if (frame.length !== DMX_UNIVERSE_SIZE) {
      throw new Error(`[blackout] universe ${uid} buffer is ${frame.length} channels, ` +
        `expected ${DMX_UNIVERSE_SIZE} — refusing to send a partial blackout`);
    }
    // Whole-frame, type-blind. Pixel channels, per-fixture master dimmers,
    // native strobe channels and DMX-only relays all go to 0 together.
    frame.fill(0);
    frames[uid] = frame;
  }

  return { frames, universes };
}

/**
 * Prove the frames about to be sent are all-zero on every channel.
 *
 * `getFullFrame()` hands back the router's live read buffer, so anything still
 * writing into it after `buildBlackoutFrames()` (a late render tick, an
 * in-flight effect apply) would re-light a channel between the zeroing and the
 * send. This is the check that turns "we zeroed it" into "it IS zero".
 *
 * @param {{ frames: Object<number, Uint8Array>, universes: number[] }} blackout
 * @throws {Error} naming the universe and channels that are not zero.
 */
export function verifyBlackoutFrames({ frames, universes } = {}) {
  if (!frames || !Array.isArray(universes)) {
    throw new Error('[blackout] verify called without a built blackout — nothing was proven dark');
  }
  for (const uid of universes) {
    const frame = frames[uid];
    if (!frame) {
      throw new Error(`[blackout] universe ${uid} is missing from the blackout frame set`);
    }
    const hot = [];
    for (let ch = 0; ch < frame.length; ch++) {
      if (frame[ch] !== 0) {
        // Report 1-based DMX addresses — what a patch sheet and a fixture
        // display both use.
        hot.push(`ch${ch + 1}=${frame[ch]}`);
        if (hot.length >= MAX_REPORTED_CHANNELS) break;
      }
    }
    if (hot.length > 0) {
      throw new Error(`[blackout] universe ${uid} is NOT dark: ${hot.join(', ')}` +
        `${hot.length >= MAX_REPORTED_CHANNELS ? ', …' : ''} — refusing to call this a blackout`);
    }
  }
}

/**
 * Every universe in the blackout must have a live sACN sender, or its zeros
 * never reach the wire. `sendFrameChecked` reports a missing sender too, but
 * checking first means the failure is named BEFORE anything is transmitted.
 *
 * @param {{ universes: number[] }} blackout
 * @param {{ hasUniverse: Function }} sacnOut
 * @throws {Error} naming the universes with no sender.
 */
export function assertBlackoutSenders({ universes } = {}, sacnOut) {
  if (!Array.isArray(universes)) {
    throw new Error('[blackout] sender check called without a built blackout');
  }
  if (!sacnOut || typeof sacnOut.hasUniverse !== 'function') {
    throw new Error('[blackout] sACN output has no hasUniverse() — cannot confirm the blackout ' +
      'has a transport for every universe');
  }
  const orphaned = universes.filter((uid) => !sacnOut.hasUniverse(uid));
  if (orphaned.length > 0) {
    throw new Error(`[blackout] no sACN sender for universe(s) ${orphaned.join(', ')} — ` +
      'their channels would stay at their last value after shutdown');
  }
}

/**
 * The loud report. Printed to stderr with a banner because this is the one
 * engine failure that can leave a physical device running unattended.
 *
 * @param {Error|string} problem
 * @param {object} [detail] — extra key/value context for the operator.
 */
export function reportBlackoutFailure(problem, detail = {}) {
  const message = problem instanceof Error ? problem.message : String(problem);
  console.error('\n  ╔══════════════════════════════════════════════════════════════════╗');
  console.error('  ║  🚨 SHUTDOWN BLACKOUT NOT CONFIRMED — CHECK THE RIG PHYSICALLY   ║');
  console.error('  ╚══════════════════════════════════════════════════════════════════╝');
  console.error(`  ${message}`);
  for (const [key, value] of Object.entries(detail)) {
    console.error(`    ${key}: ${value}`);
  }
  console.error('  A fogger, horn or fire relay may still be ENERGIZED. Kill power at the ' +
    'controller / disconnect the device before walking away.\n');
}
