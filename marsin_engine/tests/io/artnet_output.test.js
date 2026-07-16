/**
 * artnet_output.test.js — ArtDMX packet format + UDP send proof.
 *
 * Art-Net cannot be validated against real hardware here; the packet-byte
 * assertions ARE the proof of correctness (header / opcode / protver /
 * port-address / length / payload), plus a loopback UDP socket that
 * receives a real datagram to prove createArtnetOutput actually sends.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';

import {
  buildArtDmxPacket,
  toPortAddress,
  createArtnetOutput,
  ARTNET_PORT,
  ARTNET_OPCODE_OUTPUT,
  ARTNET_PROTOCOL_VERSION,
} from '../../lib/artnet_output.js';

// ── toPortAddress ─────────────────────────────────────────────────────────

test('toPortAddress — flat universe maps straight through', () => {
  assert.equal(toPortAddress(2), 2);
  assert.equal(toPortAddress(0), 0);
  assert.equal(toPortAddress(0x7fff), 0x7fff);
});

test('toPortAddress — net/subnet/universe composition', () => {
  // net=1, subnet=2, universe=3 → (1<<8)|(2<<4)|3 = 0x123
  assert.equal(toPortAddress(3, 1, 2), 0x123);
});

test('toPortAddress — out-of-range throws (no silent wrap)', () => {
  assert.throws(() => toPortAddress(0x8000), /15-bit Port-Address/);
  assert.throws(() => toPortAddress(-1), /non-negative/);
  assert.throws(() => toPortAddress(16, 0, 1), /must be in 0–15/);
  assert.throws(() => toPortAddress(0, 128, 0), /net 128/);
});

// ── buildArtDmxPacket — exact bytes for a known universe + data ─────────────

test('buildArtDmxPacket — header / opcode / protver / port-address / length / payload', () => {
  const data = new Uint8Array(512);
  data[0] = 255;   // ch 1
  data[1] = 128;   // ch 2
  data[511] = 7;   // ch 512
  const pkt = buildArtDmxPacket({ universe: 2, data, sequence: 1 });

  // Total length: 18-byte header + 512 data = 530.
  assert.equal(pkt.length, 18 + 512);

  // 0..7 — 'Art-Net\0'
  assert.equal(pkt.toString('latin1', 0, 8), 'Art-Net\0');

  // 8..9 — OpCode 0x5000, transmitted lo-byte first.
  assert.equal(pkt[8], 0x00);
  assert.equal(pkt[9], 0x50);
  assert.equal(pkt.readUInt16LE(8), ARTNET_OPCODE_OUTPUT);

  // 10..11 — ProtVer big-endian, value 14.
  assert.equal(pkt[10], 0);
  assert.equal(pkt[11], ARTNET_PROTOCOL_VERSION);
  assert.equal(pkt[11], 14);

  // 12 — Sequence; 13 — Physical.
  assert.equal(pkt[12], 1);
  assert.equal(pkt[13], 0);

  // 14..15 — Port-Address: SubUni (low 8) then Net (top 7). Universe 2.
  assert.equal(pkt[14], 2);
  assert.equal(pkt[15], 0);

  // 16..17 — Length, BIG-endian, = 512.
  assert.equal(pkt.readUInt16BE(16), 512);
  assert.equal(pkt[16], 0x02);
  assert.equal(pkt[17], 0x00);

  // 18.. — DMX payload starts at offset 18.
  assert.equal(pkt[18], 255);      // ch 1
  assert.equal(pkt[19], 128);      // ch 2
  assert.equal(pkt[18 + 511], 7);  // ch 512
});

test('buildArtDmxPacket — odd payload is padded up to an even slot count', () => {
  const data = new Uint8Array(3); // odd
  data[0] = 1; data[1] = 2; data[2] = 3;
  const pkt = buildArtDmxPacket({ universe: 5, data });
  // Padded to 4 slots → 18 + 4 = 22.
  assert.equal(pkt.length, 22);
  assert.equal(pkt.readUInt16BE(16), 4);
  assert.equal(pkt[18], 1);
  assert.equal(pkt[19], 2);
  assert.equal(pkt[20], 3);
  assert.equal(pkt[21], 0); // padding slot
});

test('buildArtDmxPacket — universe wide port-address splits across bytes', () => {
  const data = new Uint8Array(2);
  const pkt = buildArtDmxPacket({ universe: 0x0123, data });
  assert.equal(pkt[14], 0x23); // SubUni low byte
  assert.equal(pkt[15], 0x01); // Net high byte
});

test('buildArtDmxPacket — over-512 data throws', () => {
  assert.throws(() => buildArtDmxPacket({ universe: 1, data: new Uint8Array(513) }),
    /exceeds 512/);
});

test('buildArtDmxPacket — bad sequence throws', () => {
  assert.throws(() => buildArtDmxPacket({ universe: 1, data: new Uint8Array(2), sequence: 999 }),
    /sequence/);
});

// ── createArtnetOutput — real UDP send to a loopback receiver ───────────────

test('createArtnetOutput — sends a real ArtDMX datagram a socket receives', async () => {
  const rx = dgram.createSocket('udp4');
  const received = new Promise((resolve) => rx.once('message', (msg) => resolve(msg)));
  await new Promise((resolve) => rx.bind(0, '127.0.0.1', resolve));
  const port = rx.address().port;

  const out = createArtnetOutput({
    universes: [7],
    destinations: ['127.0.0.1'],
    port,
  });
  out.start();

  const data = new Uint8Array(512);
  data[0] = 42;
  data[10] = 200;
  await out.sendFrame({ 7: data });

  const msg = await received;
  out.stop();
  rx.close();

  assert.equal(msg.toString('latin1', 0, 8), 'Art-Net\0');
  assert.equal(msg.readUInt16LE(8), ARTNET_OPCODE_OUTPUT);
  assert.equal(msg[14], 7);          // universe 7
  assert.equal(msg[18], 42);         // ch 1
  assert.equal(msg[18 + 10], 200);   // ch 11
  assert.equal(out.frameCount, 1);
});

test('createArtnetOutput — does not send for unowned universes', async () => {
  const rx = dgram.createSocket('udp4');
  let gotMessage = false;
  rx.on('message', () => { gotMessage = true; });
  await new Promise((resolve) => rx.bind(0, '127.0.0.1', resolve));
  const port = rx.address().port;

  const out = createArtnetOutput({ universes: [7], destinations: ['127.0.0.1'], port });
  out.start();
  // Universe 9 is NOT owned — must be skipped silently (routing handles it).
  await out.sendFrame({ 9: new Uint8Array(512) });
  await new Promise((resolve) => setTimeout(resolve, 30));
  out.stop();
  rx.close();

  assert.equal(gotMessage, false);
});

test('createArtnetOutput — defaults to the standard Art-Net port 6454', () => {
  assert.equal(ARTNET_PORT, 6454);
});
