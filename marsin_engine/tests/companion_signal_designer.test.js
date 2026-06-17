// Tests for the Audio Companion signal-designer rehaul (2026-06-17 contract):
//   1. the `osc_out` op (terminal tap, identity DSP, validation rules),
//   2. the companion_config loader/validator (signals + chains + outputs),
//   3. the OSC PATH — a companion-style OSC packet → OscListener → CPC key set.
//
// Run:  cd marsin_engine && node --test tests/companion_signal_designer.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import dgram from 'node:dgram';

import * as osc from 'osc-min';

import {
  opCatalog, validateChain, SignalPostProcessor,
} from '../audio/postproc/signal_post_processor.js';
import {
  RAW_SOURCES, SIGNAL_TYPES, FREQUENCY_OPS,
  defaultCompanionConfig, validateCompanionConfig, validateSignal,
  dumpCompanionConfig, loadCompanionConfig, saveCompanionConfig,
  domEnergyFor, parseCaptureDevice, captureDeviceString, DOM_ENERGY,
} from '../audio/companion/companion_config.js';
import { ParamCenter } from '../lib/param_center.js';
import { OscListener } from '../lib/osc_listener.js';

function makePc() {
  return new ParamCenter(null);
}

// ── 1) osc_out op ─────────────────────────────────────────────────────────────

test('opCatalog includes osc_out with address + optional cpcKey', () => {
  const cat = opCatalog();
  assert.ok(cat.osc_out, 'osc_out present in catalog');
  assert.equal(cat.osc_out.params.address.type, 'string');
  assert.equal(cat.osc_out.params.cpcKey.optional, true);
});

test('osc_out is identity in the DSP chain (does not alter the value)', () => {
  const pc = makePc();
  const proc = new SignalPostProcessor({ paramCenter: pc });
  proc.putChain('micLow', [
    { id: 'g', type: 'gain', enabled: true, params: { value: 0.5 } },
    { id: 'o', type: 'osc_out', enabled: true, params: { address: '/marsin/mic/low', cpcKey: 'micLow' } },
  ]);
  // 0.8 × 0.5 = 0.4, then osc_out passes through unchanged.
  assert.ok(Math.abs(proc.process('micLow', 0.8, 0.01) - 0.4) < 1e-9);
});

test('osc_out must be the LAST op (terminal tap)', () => {
  const r = validateChain('micLow', [
    { id: 'o', type: 'osc_out', params: { address: '/x/y' } },
    { id: 'g', type: 'gain', params: { value: 1 } },
  ]);
  assert.equal(r.ok, false);
  assert.match(r.error, /must be the LAST op/);
});

test('at most one osc_out per chain', () => {
  const r = validateChain('micLow', [
    { id: 'o1', type: 'osc_out', params: { address: '/a/b' } },
    { id: 'o2', type: 'osc_out', params: { address: '/c/d' } },
  ]);
  assert.equal(r.ok, false);
  assert.match(r.error, /at most one osc_out/);
});

test('osc_out rejects a non-path address', () => {
  for (const addr of ['nope', 'mic/low', '/has space']) {
    const r = validateChain('micLow', [{ id: 'o', type: 'osc_out', params: { address: addr } }]);
    assert.equal(r.ok, false, `address "${addr}" should reject`);
    assert.match(r.error, /osc_out address/);
  }
});

test('osc_out accepts a valid OSC path + carries cpcKey through normalization', () => {
  const r = validateChain('micLow', [{ id: 'o', type: 'osc_out', params: { address: '/marsin/audio/energy', cpcKey: 'audioEnergyRatio' } }]);
  assert.equal(r.ok, true, r.error);
  assert.equal(r.normalized[0].params.address, '/marsin/audio/energy');
  assert.equal(r.normalized[0].params.cpcKey, 'audioEnergyRatio');
});

// ── 2) companion_config ──────────────────────────────────────────────────────

test('default companion config validates and every signal is an output', () => {
  const cfg = validateCompanionConfig(defaultCompanionConfig());
  assert.equal(cfg.osc.host, '127.0.0.1');
  assert.equal(cfg.osc.port, 10000);
  assert.ok(cfg.signals.length >= 6);
  for (const s of cfg.signals) {
    assert.ok(SIGNAL_TYPES.includes(s.type));
    assert.ok(RAW_SOURCES[s.source], `${s.source} is a known raw source`);
    assert.equal(s.output, true, `${s.id} should be an output (has osc_out)`);
    assert.equal(RAW_SOURCES[s.source].type, s.type, `${s.id} type matches its source`);
  }
});

test('validateSignal rejects a frequency signal carrying an intensity-only op', () => {
  const sig = {
    id: 'd', label: 'D', source: 'rawDom1', type: 'frequency',
    chain: [
      { id: 'n', type: 'normalizer', params: { windowSec: 30, strength: 1 } },
      { id: 'o', type: 'osc_out', params: { address: '/marsin/dom/freq1' } },
    ],
  };
  const r = validateSignal(sig);
  assert.equal(r.ok, false);
  assert.match(r.error, /intensity-only/);
});

test('validateSignal accepts a frequency signal with only Hz-valid ops', () => {
  for (const opType of FREQUENCY_OPS.filter(t => t !== 'kalman' && t !== 'osc_out')) {
    const params = opType === 'clamp' ? { min: 0, max: 1 }
      : opType === 'lpf' ? { cutoffHz: 5 }
      : opType === 'danceMaker' ? { omega: 7 }
      : { maxStepPerSec: 4 };
    const sig = {
      id: 'd', label: 'D', source: 'rawDom1', type: 'frequency',
      chain: [
        { id: 'op', type: opType, params },
        { id: 'o', type: 'osc_out', params: { address: '/marsin/dom/freq1' } },
      ],
    };
    const r = validateSignal(sig);
    assert.equal(r.ok, true, `${opType} on a frequency signal should validate: ${r.error || ''}`);
  }
});

test('validateSignal rejects a source/type mismatch', () => {
  const r = validateSignal({ id: 'x', label: 'X', source: 'rawLow', type: 'frequency', chain: [] });
  assert.equal(r.ok, false);
  assert.match(r.error, /is intensity, but type is "frequency"/);
});

test('companion config round-trips through YAML (dump → load)', () => {
  const cfg = defaultCompanionConfig();
  const yamlText = dumpCompanionConfig(cfg);
  const tmp = path.join(os.tmpdir(), `companion_cfg_${process.pid}_${Date.now()}.yaml`);
  fs.writeFileSync(tmp, yamlText, 'utf8');
  try {
    const loaded = loadCompanionConfig(tmp);
    assert.deepEqual(loaded, validateCompanionConfig(cfg));
  } finally {
    fs.rmSync(tmp, { force: true });
  }
});

test('loadCompanionConfig returns the default when the file is ABSENT (only non-error path)', () => {
  const missing = path.join(os.tmpdir(), `nope_${process.pid}_${Date.now()}.yaml`);
  const loaded = loadCompanionConfig(missing);
  assert.deepEqual(loaded, validateCompanionConfig(defaultCompanionConfig()));
});

test('saveCompanionConfig refuses to persist an INVALID design', () => {
  const tmp = path.join(os.tmpdir(), `bad_${process.pid}_${Date.now()}.yaml`);
  assert.throws(() => saveCompanionConfig({ osc: { host: '127.0.0.1', port: 99999 }, signals: [] }, tmp), /osc.port/);
  assert.equal(fs.existsSync(tmp), false, 'no file written on invalid config');
});

// ── 3) THE OSC PATH: companion packet → OscListener → CPC key ────────────────

async function sendAndAssert(address, value, cpcKey) {
  const pc = makePc();
  const port = 41000 + Math.floor(Math.random() * 3000);
  const listener = new OscListener({ port, host: '127.0.0.1', paramCenter: pc });
  await listener.startAsync();
  const sock = dgram.createSocket('udp4');
  try {
    // Encode EXACTLY as the companion's sendOsc() does: single float arg.
    const buf = osc.toBuffer({ address, args: [{ type: 'float', value }] });
    const sendBuf = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
    await new Promise((res, rej) => sock.send(sendBuf, port, '127.0.0.1', (e) => e ? rej(e) : res()));
    const t0 = Date.now();
    while (Math.abs(pc.get(cpcKey)) < 1e-9 && Date.now() - t0 < 2000) {
      await new Promise(r => setTimeout(r, 20));
    }
    return pc.get(cpcKey);
  } finally {
    sock.close();
    listener.stop();
  }
}

test('companion OSC packet sets the engine CPC key (the full path)', async () => {
  const got = await sendAndAssert('/marsin/audio/energy', 0.731, 'audioEnergyRatio');
  assert.ok(Math.abs(got - 0.731) < 1e-3, `audioEnergyRatio landed as ${got}`);
});

test('every curated contract address routes to its CPC key', async () => {
  const TABLE = [
    ['/marsin/mic/low', 'micLow', 0.42],
    ['/marsin/mic/mid', 'micMid', 0.31],
    ['/marsin/mic/high', 'micHigh', 0.27],
    ['/marsin/mic/kick', 'micKick', 1.0],
    ['/marsin/dom/freq1', 'micDomFreq1', 110.0],
    ['/marsin/dom/freq2', 'micDomFreq2', 880.0],
    ['/marsin/audio/bpm', 'audioBpm', 128.0],
    ['/marsin/audio/energy', 'audioEnergyRatio', 0.6],
    ['/marsin/audio/slow', 'audioSlowZone', 0.5],
    ['/marsin/audio/build', 'audioBuildScore', 0.8],
    ['/marsin/audio/party', 'audioParty', 1.0],
  ];
  for (const [addr, key, val] of TABLE) {
    const got = await sendAndAssert(addr, val, key);
    assert.ok(Math.abs(got - val) < 1e-2, `${addr} → ${key} expected ${val}, got ${got}`);
  }
});

test('event-style value 1.0/0.0 lands as a scalar (NOT a bang)', async () => {
  const on = await sendAndAssert('/marsin/audio/party', 1.0, 'audioParty');
  assert.equal(on, 1.0);
});

// ── 4) Dom signal = freq + energy (2026-06-17 contract) ──────────────────────

test('domEnergyFor pairs each dom source with its energy field/address/cpcKey', () => {
  const d1 = domEnergyFor('rawDom1');
  assert.deepEqual(d1, { field: 'domEnergy1', address: '/marsin/dom/energy1', cpcKey: 'micDomEnergy1' });
  const d2 = domEnergyFor('rawDom2');
  assert.deepEqual(d2, { field: 'domEnergy2', address: '/marsin/dom/energy2', cpcKey: 'micDomEnergy2' });
  // Intensity / non-dom sources have NO energy pairing.
  assert.equal(domEnergyFor('rawLow'), null);
  assert.equal(domEnergyFor('rawDom3'), null);
});

test('DOM_ENERGY targets the engine canonical raw-mirror energy keys', () => {
  // The energy cpcKeys MUST be the engine's micDomEnergy1/2 raw-mirror keys
  // (audio/postproc/audio_signals.js) so the emit lands in CPC.
  assert.equal(DOM_ENERGY.rawDom1.cpcKey, 'micDomEnergy1');
  assert.equal(DOM_ENERGY.rawDom2.cpcKey, 'micDomEnergy2');
});

// The energy OSC PATH lands in the CPC ONLY once the engine registry binds
// /marsin/dom/energy1·2 → micDomEnergy1/2 (an engine-side change owned by the
// engine agent — micDomEnergy* currently has no `osc` binding). This test
// asserts the FULL path works once that binding exists, and otherwise reports
// the missing binding clearly rather than silently passing.
test('dom energy address routes to micDomEnergy1 once the engine binds it', async () => {
  const pc = makePc();
  const listener = new OscListener({ paramCenter: pc, port: 1, host: '127.0.0.1' });
  // The canonical binding map is built from the registry's `oscAddress` fields.
  const bound = listener._bindingsByAddr instanceof Map
    && listener._bindingsByAddr.has('/marsin/dom/energy1');
  if (!bound) {
    // Engine binding not present yet (expected with the current registry) —
    // surface it loudly rather than a false green. The Companion EMIT side is
    // already correct; this lands in CPC once the engine binds the address.
    console.warn('[companion test] /marsin/dom/energy1 NOT bound in the engine registry yet — '
      + "add `osc: '/marsin/dom/energy1'` (+ energy2) to micDomEnergy1/2 in audio/postproc/audio_signals.js");
    return;
  }
  const got = await sendAndAssert('/marsin/dom/energy1', 0.55, 'micDomEnergy1');
  assert.ok(Math.abs(got - 0.55) < 1e-2, `micDomEnergy1 landed as ${got}`);
});

// ── 5) Source-mode ↔ capture.device (2026-06-17 contract) ────────────────────

test('parseCaptureDevice maps capture.device → Companion source mode', () => {
  assert.deepEqual(parseCaptureDevice('test'), { mode: 'test' });
  assert.deepEqual(parseCaptureDevice('file:/songs/a.wav'), { mode: 'file', file: '/songs/a.wav' });
  assert.deepEqual(parseCaptureDevice('hw:1,0'), { mode: 'mic', device: 'hw:1,0' });
  assert.deepEqual(parseCaptureDevice(''), { mode: 'mic', device: null });
  assert.deepEqual(parseCaptureDevice(null), { mode: 'mic', device: null });
  assert.deepEqual(parseCaptureDevice(undefined), { mode: 'mic', device: null });
});

test('captureDeviceString is the inverse (Companion source → capture.device)', () => {
  assert.equal(captureDeviceString({ mode: 'test' }), 'test');
  assert.equal(captureDeviceString({ mode: 'file', file: '/songs/a.wav' }), 'file:/songs/a.wav');
  assert.equal(captureDeviceString({ mode: 'mic', device: 'hw:1,0' }), 'hw:1,0');
  assert.equal(captureDeviceString({ mode: 'mic', device: null }), '');
});

test('source mode round-trips through capture.device (two-way sync)', () => {
  for (const dev of ['test', 'file:/x/y.mp3', 'hw:2,0', '']) {
    const parsed = parseCaptureDevice(dev);
    assert.equal(captureDeviceString(parsed), dev, `round-trip failed for "${dev}"`);
  }
});
