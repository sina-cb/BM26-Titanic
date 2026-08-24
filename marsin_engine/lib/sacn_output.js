/**
 * sacn_output.js — sACN (E1.31) output sender for MarsinEngine.
 *
 * Wraps the `sacn` npm package Sender to transmit DMX universe buffers
 * over the network to the sACN bridge (or directly to fixtures).
 */

import { Sender } from 'sacn';

import { createSendErrorThrottle } from './send_error_throttle.js';

/**
 * Create an sACN output sender.
 * @param {Object} opts
 * @param {number[]} opts.universes - Universe IDs to send
 * @param {number} [opts.priority=100] - sACN source priority
 * @param {string} [opts.sourceName='MarsinEngine'] - Source name
 * @param {string} [opts.destination='127.0.0.1'] - Unicast destination
 * @returns {SacnOutput}
 */
export function createSacnOutput({
  universes,
  priority = 100,
  sourceName = 'MarsinEngine',
  destinations = ['127.0.0.1'],
} = {}) {
  const destArray = Array.isArray(destinations) ? destinations : [destinations];
  // Create one sender per universe/destination pairing
  const senders = {};
  for (const uid of universes) {
    addUniverse(uid);
  }

  // Per-(universe,destination) transmit-error rate limiter. A downed
  // controller used to log every failed send at 40 fps × N universes (88 MB
  // in 4 h on titanic-ext — report 20260725_16); errors still surface, they
  // just don't repeat 80×/second. See send_error_throttle.js.
  const sendErrors = createSendErrorThrottle({ prefix: '[sACN Out]' });

  /**
   * The E1.31 sequence carried by EVERY universe of one engine frame.
   *
   * The `sacn` package gives each Sender its own counter starting at 0
   * (sender.js `this.sequence = (this.sequence + 1) % 256`), so universes stay
   * mutually aligned only by the accident of having been constructed together
   * and fed on every frame since. A model reload breaks all three legs of that
   * accident at once (report 20260814_212):
   *   - `addUniverse` builds a NEW Sender mid-run, starting at 0 while its
   *     siblings are at whatever ~40 fps has reached — a permanent offset, since
   *     both wrap mod 256 at the same rate and the delta never closes;
   *   - a universe pruned from `universeIds` keeps its Sender but stops being
   *     fed, so its counter freezes and it returns offset by the frames it
   *     missed;
   *   - the 3× blackout burst on a de-mapped universe skews that one by +3.
   *
   * The bench mirror composes one destination out of several universes and
   * proves they belong to the SAME engine frame by requiring their sequences to
   * be equal. Under any of the above that proof refuses every frame forever and
   * the only remedy was an engine restart.
   *
   * So the sequence is made an ENGINE-FRAME identity rather than a per-sender
   * one: one counter, stamped onto every sender at send time. Alignment stops
   * being an accident of sender lifetime and becomes true by construction —
   * immune to when a Sender was built, how long it was dark, and how many
   * out-of-band frames it took. Per-universe values still advance strictly
   * forward and wrap mod 256, which is all E1.31 receivers require (a forward
   * jump is legal; only a repeat or a small backward step is discarded).
   */
  let _frameSequence = 0;

  function addUniverse(uid) {
    if (senders[uid]) return;
    senders[uid] = [];
    for (const dest of destArray) {
      senders[uid].push({ dest, sender: new Sender({
        universe: parseInt(uid, 10),
        // Destination port only — never pass reuseAddr here. With reuseAddr
        // the sacn lib binds the sender socket to *:5568 and steals inbound
        // datagrams from the sim bridge receiver on the same host (see the
        // "sACN senders bind UDP :5568" card on the Notion task tracker).
        port: 5568,
        useUnicastDestination: dest,
        defaultPacketOptions: {
          sourceName,
          priority,
          // RAW DMX ON THE WIRE (report 20260805_170 — `_157` D1 / `_153` F1b).
          // `sendFrame` below writes the DMX router's 0-255 bytes straight into
          // `payload`, but the `sacn` package reads that field as a 0..100
          // PERCENT and emits `inRange(value * 2.55)` unless this flag is set —
          // so before this, EVERY value the engine rendered above DMX 100 left
          // as 255 and colour was crushed toward white on every controller.
          // `defaultPacketOptions` is spread first inside `Sender.send()`
          // (sender.js:56) and `sendFrame` never passes the flag, so it applies
          // to every frame, including the shutdown blackout.
          useRawDmxValues: true,
        },
      }) });
    }
    // The stamping below reaches into the `sacn` package's own counter. That
    // property is `private` in the TypeScript source but plain and writable in
    // the shipped JS, so the reach is sound — but it is exactly the kind of
    // thing a package upgrade removes or renames. If it ever does, frame
    // identity silently stops being carried and the mirror's composition proof
    // starts passing frames that are NOT the same engine frame. Crash instead.
    for (const { sender } of senders[uid]) {
      if (typeof sender.sequence !== 'number') {
        throw new Error('[sACN Out] the sacn package Sender no longer exposes a numeric ' +
          '`sequence` property — engine-frame sequence stamping cannot work, and without it ' +
          "the bench mirror's all-sequences-equal proof is not a proof. Pin/repair the sacn " +
          'dependency (see report 20260814_212).');
      }
    }
  }

  let _started = false;
  let _frameCount = 0;

  /**
   * Send DMX buffers for all universes.
   * @param {Object} buffers - { [universeId]: Uint8Array(512) }
   */
  async function sendFrame(buffers) {
    if (!_started) return;

    // Every datagram of THIS frame carries THIS number, whatever universes the
    // frame happens to contain and whenever their senders were built.
    const seq = _frameSequence;
    _frameSequence = (seq + 1) % 256;

    const promises = [];
    for (const [uid, data] of Object.entries(buffers)) {
      const uSenders = senders[parseInt(uid, 10)];
      if (!uSenders || uSenders.length === 0) continue;

      const payload = {};
      for (let ch = 0; ch < 512; ch++) {
        if (data[ch] !== 0) {
          payload[ch + 1] = data[ch]; // sACN uses 1-indexed channels
        }
      }

      for (const { sender, dest } of uSenders) {
        const key = `U${uid} → ${dest}`;
        // `Sender.send()` builds its Packet synchronously inside the promise
        // executor, reading `this.sequence` before it increments — so setting it
        // here is read by THIS datagram and cannot be raced by a sibling
        // universe's send in the same loop.
        sender.sequence = seq;
        promises.push(
          sender.send({
            payload,
            sourceName,
            priority,
          }).then(() => {
            // Only touch the throttle when something is actually failing —
            // keeps the all-healthy 40 fps path free of a map lookup.
            if (sendErrors.hasFailures()) sendErrors.noteSuccess(key);
          }, err => {
            if (_started) sendErrors.noteError(key, err.message);
          })
        );
      }
    }
    await Promise.all(promises);
    _frameCount++;
  }

  /**
   * Does this universe have at least one live sender?
   *
   * `sendFrame` silently skips a universe it has no sender for — fine on the
   * 40 fps hot path, fatal for a shutdown blackout, where a skipped universe
   * means those channels keep their last value forever. The shutdown path asks
   * this first so a missing transport is NAMED instead of shrugged off.
   *
   * @param {number|string} uid
   * @returns {boolean}
   */
  function hasUniverse(uid) {
    const uSenders = senders[parseInt(uid, 10)];
    return Array.isArray(uSenders) && uSenders.length > 0;
  }

  /**
   * Send ONE frame and REPORT what actually happened to every datagram.
   *
   * `sendFrame` is deliberately fire-and-forget: a failed send is rate-limited
   * into a log line and the frame is forgotten, because at 40 fps the next
   * frame is 25 ms away. The shutdown blackout has no next frame, so it needs
   * the opposite contract — every rejection surfaced to the caller so an
   * unconfirmed blackout can be reported loudly instead of assumed.
   *
   * @param {Object} buffers - { [universeId]: Uint8Array(512) }
   * @returns {Promise<{attempted: number, delivered: number,
   *   failures: Array<{universe: number, destination: string|null, error: string}>}>}
   */
  async function sendFrameChecked(buffers) {
    if (!_started) {
      throw new Error('[sACN Out] sendFrameChecked() called on a stopped sender — the frame ' +
        'would be dropped silently');
    }

    const seq = _frameSequence;
    _frameSequence = (seq + 1) % 256;

    const failures = [];
    const promises = [];
    let attempted = 0;
    let delivered = 0;

    for (const [uid, data] of Object.entries(buffers)) {
      const universe = parseInt(uid, 10);
      const uSenders = senders[universe];
      if (!uSenders || uSenders.length === 0) {
        failures.push({ universe, destination: null, error: 'no sender for this universe' });
        continue;
      }

      const payload = {};
      for (let ch = 0; ch < 512; ch++) {
        if (data[ch] !== 0) {
          payload[ch + 1] = data[ch]; // sACN uses 1-indexed channels
        }
      }

      for (const { sender, dest } of uSenders) {
        attempted++;
        sender.sequence = seq;
        promises.push(
          sender.send({ payload, sourceName, priority }).then(() => {
            delivered++;
          }, err => {
            failures.push({ universe, destination: dest, error: err && err.message ? err.message : String(err) });
          })
        );
      }
    }

    await Promise.all(promises);
    _frameCount++;
    return { attempted, delivered, failures };
  }

  function start() {
    _started = true;
    _frameCount = 0;
    console.log(`[sACN Out] Sender started — ${universes.length} universe(s), priority ${priority}, destinations [${destArray.join(', ')}]`);
  }

  function stop() {
    _started = false;
    sendErrors.reset();
    for (const uSenders of Object.values(senders)) {
      for (const { sender } of uSenders) {
        try { sender.close(); } catch (_) {}
      }
    }
    console.log(`[sACN Out] Sender stopped after ${_frameCount} frames`);
  }

  return {
    start,
    stop,
    sendFrame,
    sendFrameChecked,
    addUniverse,
    hasUniverse,
    get frameCount() { return _frameCount; },
  };
}
