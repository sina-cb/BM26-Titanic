/**
 * sacn_output.js — sACN (E1.31) output sender for MarsinEngine.
 *
 * Wraps the `sacn` npm package Sender to transmit DMX universe buffers
 * over the network to the sACN bridge (or directly to fixtures).
 */

import { Sender } from 'sacn';

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
    senders[uid] = [];
    for (const dest of destArray) {
      senders[uid].push(new Sender({
        universe: uid,
        port: 5568,
        reuseAddr: true,
        useUnicastDestination: dest,
        defaultPacketOptions: {
          sourceName,
          priority,
        },
      }));
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

      for (const sender of uSenders) {
        promises.push(
          sender.send({
            payload,
            sourceName,
            priority,
          }).catch(err => {
            if (_started) console.error(`[sACN Out] Send error (U${uid}):`, err.message);
          })
        );
      }
    }
    await Promise.all(promises);
    _frameCount++;
  }

  function start() {
    _started = true;
    _frameCount = 0;
    console.log(`[sACN Out] Sender started — ${universes.length} universe(s), priority ${priority}, destinations [${destArray.join(', ')}]`);
  }

  function stop() {
    _started = false;
    for (const uSenders of Object.values(senders)) {
      for (const sender of uSenders) {
        try { sender.close(); } catch (_) {}
      }
    }
    console.log(`[sACN Out] Sender stopped after ${_frameCount} frames`);
  }

  return { start, stop, sendFrame, get frameCount() { return _frameCount; } };
}
