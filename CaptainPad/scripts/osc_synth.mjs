#!/usr/bin/env node
// osc_synth.mjs — synthetic OSC signal generator for testing the CaptainPad
// audio UI (signal meters, modulation band + live ghost, BPM, etc.).
//
// It sends a moving float on an OSC address to the engine's OSC listener
// (the SAME path the Audio Companion uses), which writes it into the CPC key
// bound to that address. Drive e.g. /marsin/mic/low and watch the LOW meter +
// any modulation sourced from micLow react live — no mic/Companion needed.
//
// Dependency-free (built-in dgram + a tiny hand-rolled OSC encoder) so it runs
// offline with plain `node`, no install.
//
// Usage:
//   node scripts/osc_synth.mjs [--address /marsin/mic/low] [--shape sine]
//        [--freq 0.25] [--min 0] [--max 1] [--rate 30]
//        [--host 127.0.0.1] [--port 10000] [--duration 0]
//
//   --address   OSC path the engine binds to a CPC key. Common ones:
//                 /marsin/mic/low|mid|high|kick|flux   (intensity 0..1)
//                 /marsin/dom/energy1|energy2          (intensity 0..1)
//                 /marsin/dom/freq1|freq2              (Hz — use --max 8000)
//                 /marsin/audio/bpm                    (use --min 60 --max 180)
//   --shape     sine | triangle | square | ramp | random | hold   (default sine)
//   --freq      cycles/sec of the shape (default 0.25 = one sweep / 4s)
//   --min,--max output value range (default 0..1)
//   --rate      sends/sec (default 30, matches the analyser cadence)
//   --host,--port  engine OSC endpoint (default 127.0.0.1:10000)
//   --duration  seconds to run, 0 = forever (Ctrl-C to stop)
//   --value     with --shape hold, the constant value to hold
//
// Examples:
//   node scripts/osc_synth.mjs --address /marsin/mic/low --shape sine
//   node scripts/osc_synth.mjs --address /marsin/dom/freq1 --max 8000 --shape ramp
//   node scripts/osc_synth.mjs --address /marsin/mic/kick --shape random --rate 20

import dgram from 'node:dgram';

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}

const ADDRESS = arg('address', '/marsin/mic/low');
const SHAPE = arg('shape', 'sine');
const FREQ = parseFloat(arg('freq', '0.25'));
const MIN = parseFloat(arg('min', '0'));
const MAX = parseFloat(arg('max', '1'));
const RATE = Math.max(1, parseFloat(arg('rate', '30')));
const HOST = arg('host', '127.0.0.1');
const PORT = parseInt(arg('port', '10000'), 10);
const DURATION = parseFloat(arg('duration', '0'));
const HOLD_VALUE = parseFloat(arg('value', '0.75'));

const SHAPES = new Set(['sine', 'triangle', 'square', 'ramp', 'random', 'hold']);
if (!SHAPES.has(SHAPE)) {
  console.error(`osc_synth: unknown --shape "${SHAPE}" (expected ${[...SHAPES].join(', ')})`);
  process.exit(1);
}
if (!Number.isFinite(MIN) || !Number.isFinite(MAX)) {
  console.error('osc_synth: --min/--max must be finite numbers');
  process.exit(1);
}

// ── minimal OSC: one message, one float32 arg ────────────────────────────────
// address (null-terminated, padded to 4) + ",f" type tag (padded) + float32 BE.
function pad4(buf) {
  const rem = buf.length % 4;
  return rem === 0 ? buf : Buffer.concat([buf, Buffer.alloc(4 - rem)]);
}
function oscFloatMessage(address, value) {
  const addr = pad4(Buffer.concat([Buffer.from(address, 'ascii'), Buffer.from([0])]));
  const tags = pad4(Buffer.concat([Buffer.from(',f', 'ascii'), Buffer.from([0])]));
  const f = Buffer.alloc(4);
  f.writeFloatBE(Number.isFinite(value) ? value : 0, 0);
  return Buffer.concat([addr, tags, f]);
}

// ── shape → [0,1] phase value ────────────────────────────────────────────────
function shapeValue(shape, t) {
  const phase = (t * FREQ) % 1;             // 0..1 within one cycle
  switch (shape) {
    case 'sine': return 0.5 - 0.5 * Math.cos(phase * 2 * Math.PI);
    case 'triangle': return phase < 0.5 ? phase * 2 : 2 - phase * 2;
    case 'square': return phase < 0.5 ? 1 : 0;
    case 'ramp': return phase;
    case 'random': return Math.random();
    case 'hold': return null;               // handled separately
    default: return 0;
  }
}

const sock = dgram.createSocket('udp4');
sock.on('error', (e) => { console.error(`osc_synth: socket error: ${e.message}`); process.exit(1); });

const startMs = Date.now();
let sent = 0;
const intervalMs = 1000 / RATE;

console.log(`osc_synth → ${HOST}:${PORT}  ${ADDRESS}  shape=${SHAPE} freq=${FREQ}Hz range=[${MIN},${MAX}] rate=${RATE}/s${DURATION ? ` for ${DURATION}s` : ''}`);
console.log('(Ctrl-C to stop)');

const timer = setInterval(() => {
  const t = (Date.now() - startMs) / 1000;
  const unit = SHAPE === 'hold'
    ? Math.max(0, Math.min(1, (HOLD_VALUE - MIN) / (MAX - MIN || 1)))
    : shapeValue(SHAPE, t);
  const value = MIN + unit * (MAX - MIN);
  sock.send(oscFloatMessage(ADDRESS, value), PORT, HOST, (err) => {
    if (err) console.error(`osc_synth: send failed: ${err.message}`);
  });
  sent++;
  if (sent % RATE === 0) process.stdout.write(`\r  t=${t.toFixed(1)}s  value=${value.toFixed(3)}   `);
  if (DURATION > 0 && t >= DURATION) stop();
}, intervalMs);

function stop() {
  clearInterval(timer);
  try { sock.close(); } catch { /* ignore */ }
  console.log(`\nosc_synth: done (${sent} messages sent).`);
  process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
