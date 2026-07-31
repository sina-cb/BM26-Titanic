/**
 * artnet_output.js — Art-Net (ArtDMX) output sender for MarsinEngine.
 *
 * The sibling transport to sacn_output.js. Art-Net is a standard
 * DMX-over-IP UDP protocol (Artistic Licence); the engine emits ArtDMX
 * (OpOutput, opcode 0x5000) packets carrying the SAME 512-channel DMX
 * universe data the sACN path sends — only the framing and UDP port
 * (6454) differ. Uses Node's built-in `dgram` only (offline-safe, no new
 * dependency; codex P0 — playa has no internet).
 *
 * ArtDMX packet layout (Art-Net 4 spec, all multi-byte fields little-
 * endian EXCEPT OpCode which the spec transmits lo-byte-first too):
 *
 *   Offset  Field        Bytes  Value
 *   0       ID           8      'Art-Net\0'  (ASCII + null terminator)
 *   8       OpCode       2      0x5000        (OpOutput / ArtDMX, lo,hi)
 *   10      ProtVerHi    1      0             (protocol version 14)
 *   11      ProtVerLo    1      14
 *   12      Sequence     1      0–255, wraps  (0 disables ordering)
 *   13      Physical     1      informational input port (0 here)
 *   14      SubUni       1      low 8 bits of the 15-bit Port-Address
 *   15      Net          1      top 7 bits of the 15-bit Port-Address
 *   16      LengthHi     1      DMX slot count, BIG-endian (hi,lo)
 *   17      LengthLo     1
 *   18..    Data         N      DMX channel data (N ≤ 512, even per spec)
 *
 * The 15-bit Port-Address is composed from net (7 bits) / subnet (4 bits)
 * / universe (4 bits): address = (net << 8) | (subnet << 4) | universe.
 * For the common single-net rig we map a controller's universe number
 * directly onto that 15-bit address (net/subnet 0) — see toPortAddress.
 */

import dgram from 'dgram';

import { createSendErrorThrottle } from './send_error_throttle.js';

// ── Constants ─────────────────────────────────────────────────────────────
export const ARTNET_PORT = 6454;
export const ARTNET_OPCODE_OUTPUT = 0x5000; // OpOutput / ArtDMX
export const ARTNET_PROTOCOL_VERSION = 14;
export const ARTNET_ID = 'Art-Net\0';       // 8 bytes incl. null terminator
const ARTDMX_HEADER_LENGTH = 18;
const DMX_UNIVERSE_SIZE = 512;
const PORT_ADDRESS_MAX = 0x7fff;             // 15-bit Port-Address ceiling

/**
 * Compose a 15-bit Art-Net Port-Address from net / subnet / universe, or
 * accept an already-flat universe number. THROWS on out-of-range input —
 * a bad universe must hard-stop, never silently wrap to a wrong fixture
 * (codex P0).
 *
 * @param {number} universe - flat universe (0–32767) OR the low part when
 *                            net/subnet are supplied.
 * @param {number} [net=0]    - top 7 bits (0–127)
 * @param {number} [subnet=0] - middle 4 bits (0–15); when used, `universe`
 *                              is the low 4 bits (0–15).
 * @returns {number} 15-bit Port-Address
 */
export function toPortAddress(universe, net = 0, subnet = 0) {
  if (!Number.isInteger(universe) || universe < 0) {
    throw new Error(`[Art-Net] universe ${universe} must be a non-negative integer`);
  }
  if (net === 0 && subnet === 0) {
    if (universe > PORT_ADDRESS_MAX) {
      throw new Error(`[Art-Net] universe ${universe} exceeds the 15-bit Port-Address ` +
        `ceiling (${PORT_ADDRESS_MAX})`);
    }
    return universe;
  }
  if (!Number.isInteger(net) || net < 0 || net > 0x7f) {
    throw new Error(`[Art-Net] net ${net} must be in 0–127`);
  }
  if (!Number.isInteger(subnet) || subnet < 0 || subnet > 0xf) {
    throw new Error(`[Art-Net] subnet ${subnet} must be in 0–15`);
  }
  if (universe > 0xf) {
    throw new Error(`[Art-Net] universe ${universe} must be in 0–15 when net/subnet are set`);
  }
  return (net << 8) | (subnet << 4) | universe;
}

/**
 * Build one ArtDMX packet Buffer for a universe's DMX data.
 *
 * @param {Object} opts
 * @param {number} opts.universe         - flat universe / low Port-Address part
 * @param {Uint8Array|number[]} opts.data - DMX channel bytes (≤ 512)
 * @param {number} [opts.sequence=0]     - 1–255 rolling sequence, 0 = disabled
 * @param {number} [opts.physical=0]     - informational physical input port
 * @param {number} [opts.net=0]
 * @param {number} [opts.subnet=0]
 * @returns {Buffer}
 */
export function buildArtDmxPacket({
  universe,
  data,
  sequence = 0,
  physical = 0,
  net = 0,
  subnet = 0,
} = {}) {
  if (!data) {
    throw new Error('[Art-Net] buildArtDmxPacket: data is required');
  }
  const slotCount = data.length;
  if (slotCount > DMX_UNIVERSE_SIZE) {
    throw new Error(`[Art-Net] DMX data length ${slotCount} exceeds ${DMX_UNIVERSE_SIZE}`);
  }
  if (!Number.isInteger(sequence) || sequence < 0 || sequence > 255) {
    throw new Error(`[Art-Net] sequence ${sequence} must be in 0–255`);
  }
  // Art-Net requires an EVEN slot count of at least 2; pad odd payloads up
  // by one zero slot (the standard packing rule, not a fallback).
  const paddedCount = Math.max(2, slotCount + (slotCount % 2));
  const portAddress = toPortAddress(universe, net, subnet);

  const packet = Buffer.alloc(ARTDMX_HEADER_LENGTH + paddedCount);
  packet.write(ARTNET_ID, 0, 'latin1');                  // 0..7  'Art-Net\0'
  packet.writeUInt16LE(ARTNET_OPCODE_OUTPUT, 8);         // 8..9  0x5000 (lo,hi)
  packet.writeUInt8(0, 10);                              // 10    ProtVerHi
  packet.writeUInt8(ARTNET_PROTOCOL_VERSION, 11);        // 11    ProtVerLo = 14
  packet.writeUInt8(sequence & 0xff, 12);                // 12    Sequence
  packet.writeUInt8(physical & 0xff, 13);                // 13    Physical
  packet.writeUInt8(portAddress & 0xff, 14);             // 14    SubUni (low 8)
  packet.writeUInt8((portAddress >> 8) & 0x7f, 15);      // 15    Net (top 7)
  packet.writeUInt16BE(paddedCount, 16);                 // 16..17 Length (BE)
  for (let i = 0; i < slotCount; i++) {
    packet.writeUInt8(data[i] & 0xff, ARTDMX_HEADER_LENGTH + i);
  }
  // Padding slots (if any) are already zero from Buffer.alloc.
  return packet;
}

/**
 * Create an Art-Net output sender. Mirrors createSacnOutput's surface
 * (start / stop / sendFrame / addUniverse / frameCount) so the engine's
 * output dispatch can treat both transports identically.
 *
 * @param {Object} opts
 * @param {number[]} opts.universes        - universe IDs this sender owns
 * @param {string|string[]} opts.destinations - unicast host(s)
 * @param {number} [opts.port=6454]
 * @returns {ArtnetOutput}
 */
export function createArtnetOutput({
  universes,
  destinations = ['127.0.0.1'],
  port = ARTNET_PORT,
} = {}) {
  const destArray = Array.isArray(destinations) ? destinations : [destinations];
  const universeSet = new Set((universes || []).map(u => parseInt(u, 10)));
  // One rolling ArtDMX sequence per (universe) so receivers can reorder.
  const sequences = new Map();
  const socket = dgram.createSocket('udp4');
  // Same per-destination transmit-error rate limiter the sACN path uses — an
  // unreachable node must not fill the disk at 40 fps (report 20260725_16).
  const sendErrors = createSendErrorThrottle({ prefix: '[Art-Net Out]' });
  let _started = false;
  let _frameCount = 0;

  function addUniverse(uid) {
    universeSet.add(parseInt(uid, 10));
  }

  function nextSequence(uid) {
    // Sequence rolls 1..255 (0 means "ordering disabled" per the spec).
    const cur = sequences.get(uid) || 0;
    const next = cur >= 255 ? 1 : cur + 1;
    sequences.set(uid, next);
    return next;
  }

  /**
   * Send DMX buffers for all owned universes.
   * @param {Object} buffers - { [universeId]: Uint8Array(512) }
   */
  async function sendFrame(buffers) {
    if (!_started) return;
    const promises = [];
    for (const [uidStr, data] of Object.entries(buffers)) {
      const uid = parseInt(uidStr, 10);
      if (!universeSet.has(uid)) continue;
      const packet = buildArtDmxPacket({
        universe: uid,
        data,
        sequence: nextSequence(uid),
      });
      for (const dest of destArray) {
        const key = `U${uid} → ${dest}`;
        promises.push(new Promise((resolve) => {
          socket.send(packet, port, dest, (err) => {
            if (err) {
              if (_started) sendErrors.noteError(key, err.message);
            } else if (sendErrors.hasFailures()) {
              sendErrors.noteSuccess(key);
            }
            resolve();
          });
        }));
      }
    }
    await Promise.all(promises);
    _frameCount++;
  }

  function start() {
    _started = true;
    _frameCount = 0;
    console.log(`[Art-Net Out] Sender started — ${universeSet.size} universe(s), port ${port}, ` +
      `destinations [${destArray.join(', ')}]`);
  }

  function stop() {
    _started = false;
    sendErrors.reset();
    try { socket.close(); } catch (_) {}
    console.log(`[Art-Net Out] Sender stopped after ${_frameCount} frames`);
  }

  return { start, stop, sendFrame, addUniverse, get frameCount() { return _frameCount; } };
}
