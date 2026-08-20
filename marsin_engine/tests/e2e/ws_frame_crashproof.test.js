/*
 * ws_frame_crashproof.test.js — regression for the CRITICAL (reports _116 /
 * _108, Family A): a single malformed WebSocket frame killed the whole engine
 * → dark ship with no self-heal.
 *
 * None of the four `/ws/*` servers (nor the `/` alias) attached a per-CONNECTION
 * `ws.on('error')`. The `ws` library emits 'error' on the SOCKET INSTANCE for
 * every protocol/frame violation (invalid-UTF-8 text, reserved opcode, RSV1,
 * bad close code, oversize control frame); an EventEmitter 'error' with no
 * listener THROWS → uncaughtException → process.exit. A WiFi-corrupted frame
 * does it with zero malice, and playa RF is hostile.
 *
 * This drives a REAL engine.js subprocess (black-holed at the config per the
 * harness — the `_97` §4.4 trap is closed and ASSERTED at boot) and fires each
 * hostile frame at each topic + the `/` alias, proving the engine STAYS UP and
 * keeps answering /status after every one. It also proves the process-level
 * backstops (Fix 2) don't turn a survivable per-socket error into an exit.
 *
 * Flipped from the red-team repro ~/tmp/redteam_api/ws_crash.mjs into a GREEN
 * committed regression.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import crypto from 'node:crypto';

// MANDATORY for any suite that spawns an engine (_95 §4.3).
import '../helpers/setup_config_guard.mjs';

import { createTimelineE2E, buildE2EPlan, sleep } from './timeline_e2e_harness.mjs';

function wsHandshake(sock, path) {
  const key = crypto.randomBytes(16).toString('base64');
  sock.write(
    `GET ${path} HTTP/1.1\r\n`
    + 'Host: 127.0.0.1\r\n'
    + 'Upgrade: websocket\r\n'
    + 'Connection: Upgrade\r\n'
    + `Sec-WebSocket-Key: ${key}\r\n`
    + 'Sec-WebSocket-Version: 13\r\n\r\n',
  );
}

// A CLIENT→SERVER frame is MASKED (RFC 6455). opcode/rsv1 let us craft the
// protocol violations `ws` rejects with an 'error' on the socket instance.
function maskedFrame(opcode, payload, { fin = true, rsv1 = false } = {}) {
  const mask = crypto.randomBytes(4);
  const len = payload.length;
  const b0 = (fin ? 0x80 : 0) | (rsv1 ? 0x40 : 0) | (opcode & 0x0f);
  let header;
  if (len < 126) header = Buffer.from([b0, 0x80 | len, ...mask]);
  else header = Buffer.from([b0, 0x80 | 126, (len >> 8) & 0xff, len & 0xff, ...mask]);
  const masked = Buffer.alloc(len);
  for (let i = 0; i < len; i += 1) masked[i] = payload[i] ^ mask[i % 4];
  return Buffer.concat([header, masked]);
}

function attack(port, wsPath, frameBytes) {
  return new Promise((resolve) => {
    const sock = net.connect(port, '127.0.0.1');
    let got101 = false;
    sock.on('data', (d) => {
      if (!got101 && d.toString('latin1').includes('101')) {
        got101 = true;
        setTimeout(() => { try { sock.write(frameBytes); } catch { /* closed */ } }, 40);
        setTimeout(() => { try { sock.destroy(); } catch { /* closed */ } resolve(); }, 300);
      }
    });
    sock.on('error', () => resolve());
    sock.on('connect', () => wsHandshake(sock, wsPath));
    setTimeout(() => { try { sock.destroy(); } catch { /* closed */ } resolve(); }, 3000);
  });
}

test('a malformed WS frame on ANY topic (or the / alias) does NOT kill the engine', async () => {
  const h = createTimelineE2E({
    prefix: 'ws_crashproof',
    plans: { zoom_e2e: buildE2EPlan(Date.now()) },
    activePlan: 'zoom_e2e',
  });
  const alive = async () => {
    try { return (await fetch(`${h.base()}/status`)).ok; } catch { return false; }
  };

  try {
    await h.start();
    assert.equal(await alive(), true, 'engine should be up before the attacks');

    const attacks = [
      // invalid UTF-8 in a TEXT frame → WS_ERR_INVALID_UTF8
      { path: '/ws/params', frame: maskedFrame(0x1, Buffer.from([0xff, 0xff])) },
      { path: '/ws/viz', frame: maskedFrame(0x1, Buffer.from([0xff, 0xff])) },
      // reserved opcode 0x3 → WS_ERR_INVALID_OPCODE
      { path: '/ws/control', frame: maskedFrame(0x3, Buffer.from('x')) },
      // RSV1 set with no negotiated extension → WS_ERR_UNEXPECTED_RSV_1
      { path: '/ws/signals', frame: maskedFrame(0x1, Buffer.from('x'), { rsv1: true }) },
      // invalid close code 1005 in a close frame
      { path: '/ws/control', frame: maskedFrame(0x8, Buffer.from([0x03, 0xed])) },
      // control frame payload > 125 → WS_ERR_INVALID_CONTROL_PAYLOAD_LENGTH
      { path: '/ws/control', frame: maskedFrame(0x9, Buffer.alloc(200, 0x61)) },
      // the transitional `/` alias routes to control — it must be armed too
      { path: '/', frame: maskedFrame(0x1, Buffer.from([0xff, 0xff])) },
    ];

    for (const a of attacks) {
      await attack(h.port, a.path, a.frame);
      await sleep(200);
      assert.equal(await alive(), true,
        `engine died after a malformed frame on ${a.path}\n${h.stdout.slice(-2500)}`);
    }

    // The per-connection handler classified these as non-fatal (logged, socket
    // dropped) rather than letting them reach the process backstops.
    assert.match(h.stdout, /non-fatal per-connection error/,
      'the per-socket ws error handler should have logged the frame violations');
    // And nothing tripped the fatal process backstops.
    assert.doesNotMatch(h.stdout, /ENGINE FATAL/,
      'a survivable frame error must not reach the uncaughtException backstop');

    // A well-formed client still works after the storm (the sockets are healthy).
    const good = await h.client('post-storm');
    assert.ok(good.latest(), 'a normal /ws/control client still connects + replays after the attacks');
    good.close();
  } finally {
    await h.teardown();
  }
});
