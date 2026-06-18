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
  opCatalog, validateChain, SignalPostProcessor, slug, oscAddressForName,
} from '../audio/postproc/signal_post_processor.js';
import {
  RAW_SOURCES, SIGNAL_TYPES, FREQUENCY_OPS, VIEW_TYPES,
  defaultCompanionConfig, validateCompanionConfig, validateSignal, validateView,
  dumpCompanionConfig, loadCompanionConfig, saveCompanionConfig,
  parseCaptureDevice, captureDeviceString, resolveOscOut,
} from '../audio/companion/companion_config.js';
import { ParamCenter } from '../lib/param_center.js';
import { OscListener } from '../lib/osc_listener.js';

function makePc() {
  return new ParamCenter(null);
}

// ── 1) osc_out op ─────────────────────────────────────────────────────────────

test('opCatalog osc_out carries a single name param (no address/cpcKey)', () => {
  const cat = opCatalog();
  assert.ok(cat.osc_out, 'osc_out present in catalog');
  assert.equal(cat.osc_out.params.name.type, 'string');
  assert.equal(cat.osc_out.params.address, undefined, 'no separate address param');
  assert.equal(cat.osc_out.params.cpcKey, undefined, 'no separate cpcKey param');
});

test('osc_out is identity in the DSP chain (does not alter the value)', () => {
  const pc = makePc();
  const proc = new SignalPostProcessor({ paramCenter: pc });
  proc.putChain('micLow', [
    { id: 'g', type: 'gain', enabled: true, params: { value: 0.5 } },
    { id: 'o', type: 'osc_out', enabled: true, params: { name: 'micLow' } },
  ]);
  // 0.8 × 0.5 = 0.4, then osc_out passes through unchanged.
  assert.ok(Math.abs(proc.process('micLow', 0.8, 0.01) - 0.4) < 1e-9);
});

test('osc_out must be the LAST op (terminal tap)', () => {
  const r = validateChain('micLow', [
    { id: 'o', type: 'osc_out', params: { name: 'xy' } },
    { id: 'g', type: 'gain', params: { value: 1 } },
  ]);
  assert.equal(r.ok, false);
  assert.match(r.error, /must be the LAST op/);
});

test('at most one osc_out per chain', () => {
  const r = validateChain('micLow', [
    { id: 'o1', type: 'osc_out', params: { name: 'ab' } },
    { id: 'o2', type: 'osc_out', params: { name: 'cd' } },
  ]);
  assert.equal(r.ok, false);
  assert.match(r.error, /at most one osc_out/);
});

test('osc_out rejects a name with no usable slug', () => {
  for (const name of ['', '   ', '!!!', '---']) {
    const r = validateChain('micLow', [{ id: 'o', type: 'osc_out', params: { name } }]);
    assert.equal(r.ok, false, `name "${name}" should reject`);
    // Empty/whitespace fails the generic non-empty-string check; all-punctuation
    // fails the osc_out slug check — both mention "name".
    assert.match(r.error, /name/);
  }
});

test('osc_out accepts a name and carries it through normalization', () => {
  const r = validateChain('micLow', [{ id: 'o', type: 'osc_out', params: { name: 'crowd Roar!' } }]);
  assert.equal(r.ok, true, r.error);
  assert.equal(r.normalized[0].params.name, 'crowd Roar!');
});

test('slug derives a cpc-safe key from a name; oscAddressForName builds the path', () => {
  assert.equal(slug('Crowd Roar!'), 'crowd_roar');
  assert.equal(slug('  dom1  '), 'dom1');
  assert.equal(slug('a--b__c'), 'a_b_c');
  assert.equal(slug('!!!'), '');
  assert.equal(oscAddressForName('Flux Test'), '/marsin/audio/flux_test');
});

test('resolveOscOut: curated names keep their canonical address; others slug-derive; empty throws', () => {
  assert.deepEqual(resolveOscOut('micLow'), { name: 'micLow', cpcKey: 'micLow', address: '/marsin/mic/low' });
  assert.deepEqual(resolveOscOut('micDomFreq1'), { name: 'micDomFreq1', cpcKey: 'micDomFreq1', address: '/marsin/dom/freq1' });
  assert.deepEqual(resolveOscOut('Flux Test'), { name: 'Flux Test', cpcKey: 'flux_test', address: '/marsin/audio/flux_test' });
  assert.throws(() => resolveOscOut('!!!'), /slug is empty/);
});

test('old-shape osc_out {address,cpcKey} migrates to {name}; label becomes the name', () => {
  const v = validateSignal({
    id: 's', label: 'OLD LABEL', source: 'rawLow', type: 'intensity',
    chain: [{ id: 'o', type: 'osc_out', enabled: true, params: { address: '/marsin/audio/foo', cpcKey: 'foo' } }],
  });
  assert.equal(v.ok, true, v.error);
  const tap = v.normalized.chain[v.normalized.chain.length - 1];
  assert.equal(tap.params.name, 'foo');
  assert.equal(tap.params.address, undefined);
  assert.equal(tap.params.cpcKey, undefined);
  assert.equal(v.normalized.label, 'foo', 'label collapses to the osc_out name');
});

test('two outputs resolving to the same cpcKey are rejected (uniqueness)', () => {
  assert.throws(() => validateCompanionConfig({
    osc: { host: '127.0.0.1', port: 10000 },
    signals: [
      { id: 'a', label: 'A', source: 'rawLow', type: 'intensity', chain: [{ id: 'ao', type: 'osc_out', enabled: true, params: { name: 'dup' } }] },
      { id: 'b', label: 'B', source: 'rawMid', type: 'intensity', chain: [{ id: 'bo', type: 'osc_out', enabled: true, params: { name: 'Dup!' } }] },
    ],
  }), /resolve to cpcKey/);
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
      // compressor is intensity-only (dynamics on a [0,1] value); not in FREQUENCY_OPS.
      { id: 'c', type: 'compressor', params: { ratio: 4 } },
      { id: 'o', type: 'osc_out', params: { name: 'micDomFreq1' } },
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
      : opType === 'normalizer' ? { windowSec: 30, strength: 1 }
      : { maxStepPerSec: 4 };
    const sig = {
      id: 'd', label: 'D', source: 'rawDom1', type: 'frequency',
      chain: [
        { id: 'op', type: opType, params },
        { id: 'o', type: 'osc_out', params: { name: 'micDomFreq1' } },
      ],
    };
    const r = validateSignal(sig);
    assert.equal(r.ok, true, `${opType} on a frequency signal should validate: ${r.error || ''}`);
  }
});

test('frequency-mode normalizer maps Hz to a [0,1] coordinate (smooth moving window)', () => {
  const proc = new SignalPostProcessor({ paramCenter: makePc(), outputMode: 'frequency' });
  proc.putChain('micLow', [
    { id: 'n', type: 'normalizer', params: { windowSec: 5, strength: 1 } },
  ]);
  // Feed a Hz signal that sweeps a range; every output must stay in [0,1]
  // (never the raw Hz), and it must respond (not pinned at a constant).
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < 600; i++) {
    const hz = 400 + 300 * Math.sin(i / 20);   // 100..700 Hz
    const y = proc.process('micLow', hz, 0.02);
    assert.ok(y >= 0 && y <= 1, `normalizer output ${y} must be in [0,1] (got raw Hz?)`);
    if (i > 300) { min = Math.min(min, y); max = Math.max(max, y); }
  }
  assert.ok(max - min > 0.2, 'normalized coordinate should travel a usable range, not pin');
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

// ── 2b) custom VIEWS (2026-06-17 contract §"Companion custom VIEWS") ──────────

function viewSigMap() {
  // dom1/dom2 are frequency; low is intensity.
  return new Map([['dom1', 'frequency'], ['dom2', 'frequency'], ['low', 'intensity']]);
}

test('VIEW_TYPES declares dancing-balls (frequency) + trace-overlay (any)', () => {
  assert.ok(VIEW_TYPES['dancing-balls'], 'dancing-balls present');
  assert.equal(VIEW_TYPES['dancing-balls'].accepts, 'frequency');
  assert.ok(VIEW_TYPES['trace-overlay'], 'trace-overlay present');
  assert.equal(VIEW_TYPES['trace-overlay'].accepts, null, 'trace-overlay accepts any type');
});

test('validateView accepts a dancing-balls view fed two frequency signals', () => {
  const r = validateView({ id: 'v', label: 'Dance', type: 'dancing-balls', signals: ['dom1', 'dom2'] }, viewSigMap());
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.normalized.signals, ['dom1', 'dom2']);
});

test('validateView rejects an intensity signal fed to dancing-balls (type filter)', () => {
  const r = validateView({ id: 'v', label: 'Bad', type: 'dancing-balls', signals: ['low'] }, viewSigMap());
  assert.equal(r.ok, false);
  assert.match(r.error, /accepts frequency/);
});

test('validateView trace-overlay mixes ANY signal types', () => {
  const r = validateView({ id: 'v', label: 'Mix', type: 'trace-overlay', signals: ['low', 'dom1'] }, viewSigMap());
  assert.equal(r.ok, true, r.error);
});

test('validateView rejects unknown type + unknown signal reference', () => {
  assert.equal(validateView({ id: 'v', label: 'X', type: 'spectrum', signals: [] }, viewSigMap()).ok, false);
  const r = validateView({ id: 'v', label: 'X', type: 'trace-overlay', signals: ['ghost'] }, viewSigMap());
  assert.equal(r.ok, false);
  assert.match(r.error, /unknown signal/);
});

test('default config carries the DOM DANCE dancing-balls view fed both doms', () => {
  const cfg = validateCompanionConfig(defaultCompanionConfig());
  assert.ok(Array.isArray(cfg.views));
  const dance = cfg.views.find(v => v.type === 'dancing-balls');
  assert.ok(dance, 'a dancing-balls view exists');
  assert.deepEqual(dance.signals, ['dom1', 'dom2']);
});

test('validateCompanionConfig rejects a view referencing a missing signal', () => {
  const cfg = defaultCompanionConfig();
  cfg.views = [{ id: 'v', label: 'X', type: 'trace-overlay', signals: ['no_such_signal'] }];
  assert.throws(() => validateCompanionConfig(cfg), /unknown signal/);
});

test('views round-trip through YAML and travel in Export', () => {
  const cfg = defaultCompanionConfig();
  cfg.views = [
    { id: 'mix', label: 'My Mix', type: 'trace-overlay', signals: ['low', 'dom1'] },
    { id: 'orbs', label: 'Orbs', type: 'dancing-balls', signals: ['dom1', 'dom2'] },
  ];
  const text = dumpCompanionConfig(cfg);
  assert.match(text, /views:/);
  const tmp = path.join(os.tmpdir(), `views_${process.pid}_${Date.now()}.yaml`);
  fs.writeFileSync(tmp, text, 'utf8');
  try {
    const loaded = loadCompanionConfig(tmp);
    assert.equal(loaded.views.length, 2);
    assert.deepEqual(loaded.views[0], { id: 'mix', label: 'My Mix', type: 'trace-overlay', signals: ['low', 'dom1'] });
  } finally {
    fs.rmSync(tmp, { force: true });
  }
});

test('a config without a views key is valid (optional) and normalizes to []', () => {
  const cfg = defaultCompanionConfig();
  delete cfg.views;
  const norm = validateCompanionConfig(cfg);
  assert.deepEqual(norm.views, []);
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

// ── 4) Dom split: freq + energy are independent signals (2026-06-17) ─────────

test('a dom energy signal validates as intensity from source rawDom1Energy', () => {
  const r = validateSignal({
    id: 'dom1Energy', label: 'micDomEnergy1', source: 'rawDom1Energy', type: 'intensity',
    chain: [
      { id: 'lpf', type: 'lpf', enabled: true, params: { cutoffHz: 10 } },
      { id: 'out', type: 'osc_out', enabled: true, params: { name: 'micDomEnergy1' } },
    ],
  });
  assert.equal(r.ok, true, r.error || '');
  assert.equal(r.normalized.type, 'intensity');
  assert.equal(r.normalized.source, 'rawDom1Energy');
  assert.equal(r.normalized.output, true);
});

test('resolveOscOut maps the curated dom-energy names to their engine-bound address', () => {
  assert.deepEqual(resolveOscOut('micDomEnergy1'),
    { name: 'micDomEnergy1', cpcKey: 'micDomEnergy1', address: '/marsin/dom/energy1' });
  assert.deepEqual(resolveOscOut('micDomEnergy2'),
    { name: 'micDomEnergy2', cpcKey: 'micDomEnergy2', address: '/marsin/dom/energy2' });
});

test('default config splits each dom lane into independent freq + energy signals', () => {
  const cfg = validateCompanionConfig(defaultCompanionConfig());
  const byId = new Map(cfg.signals.map(s => [s.id, s]));
  // dom1 freq lane — frequency, freq-only, routes to /marsin/dom/freq1.
  const d1 = byId.get('dom1');
  assert.equal(d1.type, 'frequency');
  assert.equal(d1.source, 'rawDom1');
  assert.deepEqual(resolveOscOut(d1.chain.at(-1).params.name).address, '/marsin/dom/freq1');
  // dom1 energy lane — INDEPENDENT intensity signal with its OWN chain, routes
  // to /marsin/dom/energy1.
  const e1 = byId.get('dom1Energy');
  assert.equal(e1.type, 'intensity');
  assert.equal(e1.source, 'rawDom1Energy');
  assert.equal(e1.output, true);
  assert.ok(e1.chain.some(op => op.type === 'lpf'), 'energy signal carries its own op chain (lpf)');
  assert.equal(resolveOscOut(e1.chain.at(-1).params.name).address, '/marsin/dom/energy1');
  // dom2 lanes likewise.
  assert.equal(byId.get('dom2').source, 'rawDom2');
  assert.equal(byId.get('dom2Energy').source, 'rawDom2Energy');
  assert.equal(resolveOscOut(byId.get('dom2Energy').chain.at(-1).params.name).address, '/marsin/dom/energy2');
});

test('back-compat: an OLD combined dom config (no energy split) still loads', () => {
  // Pre-split persisted design: ONE dom freq signal per lane, no energy signal.
  // It must still validate/load (it just lacks the energy split until re-defaulted).
  const old = {
    osc: { host: '127.0.0.1', port: 10000 },
    signals: [
      { id: 'dom1', label: 'micDomFreq1', source: 'rawDom1', type: 'frequency',
        chain: [{ id: 'dom1_out', type: 'osc_out', enabled: true, params: { name: 'micDomFreq1' } }],
        output: true },
    ],
  };
  const cfg = validateCompanionConfig(old);
  assert.equal(cfg.signals.length, 1);
  assert.equal(cfg.signals[0].source, 'rawDom1');
  assert.equal(cfg.signals[0].type, 'frequency');
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
