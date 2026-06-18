// Unit tests for lib/audio_signals.js — the single source of truth for
// the AUDIO signal family (slot 3, declarative_signal_table).
//
// This is a REFACTOR guard, not a behaviour test: it pins the DERIVED
// audio-family registry entries against a hand-written snapshot of the
// PRE-refactor values (copied verbatim from the old hand-listed block in
// param_center.js). If a future "tidy" changes any value — a broadcastHz,
// a persist flag, an oscAddress — this fails loudly. It also pins the
// derived KNOWN_SIGNALS / DEFAULT_CHAINS / GAIN_BY_KEY so the three engine
// consumers stay byte-identical to their old hand-written forms.
//
// Run:  cd marsin_engine && node --test tests/audio_signals.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  audioRegistryEntries,
  processedSignalKeys,
} from '../audio/postproc/audio_signals.js';
import { ParamCenter } from '../lib/param_center.js';
import {
  KNOWN_SIGNALS,
  DEFAULT_CHAINS,
} from '../audio/postproc/signal_post_processor.js';
import { GAIN_BY_KEY } from '../lib/osc_listener.js';

// ── Pre-refactor snapshot ────────────────────────────────────────────────────
//
// The exact audio block from PARAM_REGISTRY before this slice, in registry
// order. Hand-transcribed from git HEAD~ so the test is an INDEPENDENT pin,
// not a self-referential echo of the generator.

const LIVE = (extra) => ({
  type: 'float', default: 0.0, range: [0, 1], clamp: true,
  persist: false, live: true, portWatch: false, ...extra,
});
const GAIN = (key, label) => ({
  key, label, type: 'float', default: 1.0, range: [0, 2], clamp: true,
  persist: true, oscAddress: `/marsin/param/${key}`, sharedFnName: key,
});

// NOTE: the `stems*` family was REMOVED on 2026-06-17 (operator brief — stems
// retired entirely; the Audio Companion is the sole analyzer). The contract's
// curated inbound OSC set added oscAddresses to micDomFreq1/2 + audioBpm/
// audioBuildScore/audioEnergyRatio/audioSlowZone/audioParty.
const EXPECTED_AUDIO_ENTRIES = [
  { key: 'tempoBpm', label: 'Tempo · BPM', ...LIVE({ default: 0.0, range: [0, 300], broadcastHz: 5, oscAddress: '/lx/tempo/bpm', sharedFnName: 'tempoBpm' }) },
  { key: 'micLow', label: 'Mic · Low', ...LIVE({ broadcastHz: 15, oscAddress: '/marsin/mic/low', sharedFnName: 'micLow' }) },
  { key: 'micMid', label: 'Mic · Mid', ...LIVE({ broadcastHz: 15, oscAddress: '/marsin/mic/mid', sharedFnName: 'micMid' }) },
  { key: 'micHigh', label: 'Mic · High', ...LIVE({ broadcastHz: 15, oscAddress: '/marsin/mic/high', sharedFnName: 'micHigh' }) },
  { key: 'micKick', label: 'Mic · Kick', ...LIVE({ broadcastHz: 30, oscAddress: '/marsin/mic/kick', sharedFnName: 'micKick' }) },
  { key: 'micFlux', label: 'Mic · Flux', ...LIVE({ broadcastHz: 15, oscAddress: '/marsin/mic/flux', sharedFnName: 'micFlux' }) },
  { key: 'micLowRaw', label: 'Mic · Low (raw)', ...LIVE({ broadcastHz: 15, sharedFnName: 'micLowRaw' }) },
  { key: 'micMidRaw', label: 'Mic · Mid (raw)', ...LIVE({ broadcastHz: 15, sharedFnName: 'micMidRaw' }) },
  { key: 'micHighRaw', label: 'Mic · High (raw)', ...LIVE({ broadcastHz: 15, sharedFnName: 'micHighRaw' }) },
  { key: 'micKickRaw', label: 'Mic · Kick (raw)', ...LIVE({ broadcastHz: 30, sharedFnName: 'micKickRaw' }) },
  { key: 'micFluxRaw', label: 'Mic · Flux (raw)', ...LIVE({ broadcastHz: 15, sharedFnName: 'micFluxRaw' }) },
  GAIN('micLowGain', 'Mic Low Gain'),
  GAIN('micMidGain', 'Mic Mid Gain'),
  GAIN('micHighGain', 'Mic High Gain'),
  GAIN('micKickGain', 'Mic Kick Gain'),
  GAIN('micFluxGain', 'Mic Flux Gain'),
  { key: 'audioStructure', label: 'Audio · Structure', ...LIVE({ default: 0.0, range: [0, 2], broadcastHz: 10, sharedFnName: 'audioStructure' }) },
  { key: 'audioBuildScore', label: 'Audio · Build Score', ...LIVE({ broadcastHz: 10, oscAddress: '/marsin/audio/build', sharedFnName: 'audioBuildScore' }) },
  { key: 'audioEnergyRatio', label: 'Audio · Energy Ratio', ...LIVE({ broadcastHz: 10, oscAddress: '/marsin/audio/energy', sharedFnName: 'audioEnergyRatio' }) },
  { key: 'audioVocalsHot', label: 'Audio · Vocals Hot', ...LIVE({ broadcastHz: 5, sharedFnName: 'audioVocalsHot' }) },
  { key: 'audioDropPulse', label: 'Audio · Drop Pulse', ...LIVE({ broadcastHz: 15, sharedFnName: 'audioDropPulse' }) },
  { key: 'audioSlowZone', label: 'Audio · Slow Zone', ...LIVE({ broadcastHz: 10, oscAddress: '/marsin/audio/slow', sharedFnName: 'audioSlowZone' }) },
  { key: 'micDomFreq1', label: 'Mic · Dom Freq 1', ...LIVE({ range: [0, 22050], broadcastHz: 15, oscAddress: '/marsin/dom/freq1', sharedFnName: 'micDomFreq1' }) },
  { key: 'micDomEnergy1', label: 'Mic · Dom Energy 1', ...LIVE({ broadcastHz: 15, oscAddress: '/marsin/dom/energy1', sharedFnName: 'micDomEnergy1' }) },
  { key: 'micDomFreq2', label: 'Mic · Dom Freq 2', ...LIVE({ range: [0, 22050], broadcastHz: 15, oscAddress: '/marsin/dom/freq2', sharedFnName: 'micDomFreq2' }) },
  { key: 'micDomEnergy2', label: 'Mic · Dom Energy 2', ...LIVE({ broadcastHz: 15, oscAddress: '/marsin/dom/energy2', sharedFnName: 'micDomEnergy2' }) },
  { key: 'audioBpm', label: 'Audio · BPM', ...LIVE({ range: [0, 300], broadcastHz: 5, oscAddress: '/marsin/audio/bpm', sharedFnName: 'audioBpm' }) },
  { key: 'audioBeat', label: 'Audio · Beat', ...LIVE({ broadcastHz: 30, sharedFnName: 'audioBeat' }) },
  { key: 'audioParty', label: 'Audio · Party', ...LIVE({ broadcastHz: 5, oscAddress: '/marsin/audio/party', sharedFnName: 'audioParty' }) },
  { key: 'audioNote', label: 'Audio · Note', ...LIVE({ range: [0, 11], broadcastHz: 10, sharedFnName: 'audioNote' }) },
  { key: 'audioNoteHue', label: 'Audio · Note Hue', ...LIVE({ broadcastHz: 10, sharedFnName: 'audioNoteHue' }) },
  { key: 'audioSwitchPattern', label: 'Audio · Switch Pattern', ...LIVE({ broadcastHz: 15, sharedFnName: 'audioSwitchPattern' }) },
  { key: 'audioSwitchColor', label: 'Audio · Switch Color', ...LIVE({ broadcastHz: 15, sharedFnName: 'audioSwitchColor' }) },
  { key: 'audioBeatInBar', label: 'Audio · Beat In Bar', ...LIVE({ range: [0, 4], broadcastHz: 30, sharedFnName: 'audioBeatInBar' }) },
  { key: 'audioBarPhase', label: 'Audio · Bar Phase', ...LIVE({ broadcastHz: 30, sharedFnName: 'audioBarPhase' }) },
  { key: 'audioDownbeat', label: 'Audio · Downbeat', ...LIVE({ broadcastHz: 30, sharedFnName: 'audioDownbeat' }) },
];

// Normalize: sort object keys so deep-equal ignores literal key ORDER (the
// generator and the snapshot may order fields differently). Values, key
// presence, and array order are still strictly compared.
function sortKeys(obj) {
  if (Array.isArray(obj)) return obj.map(sortKeys);
  if (obj && typeof obj === 'object') {
    const out = {};
    for (const k of Object.keys(obj).sort()) out[k] = sortKeys(obj[k]);
    return out;
  }
  return obj;
}

// ── Tests ────────────────────────────────────────────────────────────────────

test('audioRegistryEntries() deep-equals the pre-refactor hand-written audio block', () => {
  const got = audioRegistryEntries();
  assert.equal(got.length, EXPECTED_AUDIO_ENTRIES.length,
    `audio entry count: got ${got.length}, expected ${EXPECTED_AUDIO_ENTRIES.length}`);
  for (let i = 0; i < EXPECTED_AUDIO_ENTRIES.length; i++) {
    assert.deepEqual(
      sortKeys(got[i]), sortKeys(EXPECTED_AUDIO_ENTRIES[i]),
      `audio entry[${i}] (${got[i] && got[i].key}) drifted from snapshot`,
    );
  }
});

test('registry ORDER is preserved (schema sequence is load-bearing for OSC bindings)', () => {
  const got = audioRegistryEntries().map(e => e.key);
  assert.deepEqual(got, EXPECTED_AUDIO_ENTRIES.map(e => e.key));
});

test('ParamCenter schema contains the derived audio family with identical fields', () => {
  const schema = new ParamCenter(null).getSchema();
  const byKey = Object.fromEntries(schema.map(e => [e.key, e]));
  for (const exp of EXPECTED_AUDIO_ENTRIES) {
    const e = byKey[exp.key];
    assert.ok(e, `${exp.key} present in /param-center/schema`);
    assert.equal(e.persist, exp.persist, `${exp.key}.persist`);
    assert.equal(e.live, exp.live === true, `${exp.key}.live`);
    assert.equal(e.portWatch, exp.portWatch !== false, `${exp.key}.portWatch`);
    assert.deepEqual(e.range, exp.range, `${exp.key}.range`);
    // broadcastHz: live keys pin their own; gains ride the 30 Hz default.
    const expHz = exp.broadcastHz ?? 30;
    assert.equal(e.broadcastHz, expHz, `${exp.key}.broadcastHz`);
    assert.equal(e.oscAddress, exp.oscAddress, `${exp.key}.oscAddress`);
  }
});

test('KNOWN_SIGNALS is unchanged as a set (and as the pre-refactor ordered list)', () => {
  const expected = [
    'micLow', 'micMid', 'micHigh', 'micKick', 'micFlux',
  ];
  assert.deepEqual([...KNOWN_SIGNALS], expected, 'KNOWN_SIGNALS ordered list');
  assert.deepEqual(
    new Set(KNOWN_SIGNALS), new Set(expected), 'KNOWN_SIGNALS as a set',
  );
  // And it equals the table-derived processed-key list.
  assert.deepEqual([...KNOWN_SIGNALS], processedSignalKeys());
});

test('DEFAULT_CHAINS = Gain + tuned smoothing LPF per signal, sudden micKick trigger chain', () => {
  // Corpus-tuning pass (report 202606/..._audio_corpus_tuning.md §Task C):
  // each non-kick signal gained a per-character smoothing LPF; the kick
  // chain was retuned SUDDEN (release 180→60 ms, hold decay 120→60 ms).
  const expected = {
    micLow: [{ id: 'low_gain', type: 'gain', enabled: true, params: { paramKey: 'micLowGain' } },
             { id: 'low_lpf', type: 'lpf', enabled: true, params: { cutoffHz: 5.5 } }],
    micMid: [{ id: 'mid_gain', type: 'gain', enabled: true, params: { paramKey: 'micMidGain' } },
             { id: 'mid_lpf', type: 'lpf', enabled: true, params: { cutoffHz: 8.0 } }],
    micHigh: [{ id: 'high_gain', type: 'gain', enabled: true, params: { paramKey: 'micHighGain' } },
              { id: 'high_lpf', type: 'lpf', enabled: true, params: { cutoffHz: 14.0 } }],
    micKick: [
      { id: 'kick_gain', type: 'gain', enabled: true, params: { paramKey: 'micKickGain' } },
      { id: 'kick_envelope', type: 'envelope', enabled: true, params: { attackMs: 4, releaseMs: 50 } },
      { id: 'kick_schmitt', type: 'schmitt', enabled: true, params: { tHigh: 0.6, tLow: 0.3, refractoryMs: 180 } },
      { id: 'kick_hold', type: 'hold', enabled: true, params: { timeoutMs: 50, decayMs: 50 } },
    ],
    micFlux: [{ id: 'flux_gain', type: 'gain', enabled: true, params: { paramKey: 'micFluxGain' } },
              { id: 'flux_lpf', type: 'lpf', enabled: true, params: { cutoffHz: 4.5 } }],
  };
  assert.deepEqual(DEFAULT_CHAINS, expected);
});

test('GAIN_BY_KEY matches the pre-refactor osc_listener map (byte-identical, ordered)', () => {
  const expected = {
    micLow: 'micLowGain',
    micMid: 'micMidGain',
    micHigh: 'micHighGain',
    micKick: 'micKickGain',
  };
  assert.deepEqual(GAIN_BY_KEY, expected);
  // Key order matters for deterministic boot-time iteration.
  assert.deepEqual(Object.keys(GAIN_BY_KEY), Object.keys(expected));
});
