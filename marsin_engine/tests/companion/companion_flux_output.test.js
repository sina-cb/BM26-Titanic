// companion_flux_output.test.js — the FLUX publisher regression guard.
//
// THE BUG (report 20260806_184, root cause from recon 20260806_183): the Audio
// Companion never published `micFlux`. `CURATED_OUTPUTS` — the map that lets a
// designed signal keep its canonical engine-bound address — was hand-typed and
// omitted flux, and the default/persisted designs had no flux signal at all.
// So `/marsin/mic/flux` was never on the wire; `micFlux` sat at its default 0
// in the engine's CPC; and because `applyModulations` only SKIPS a mapping
// whose source key is ABSENT, all 32 patterns and 11 saved playlist mappings
// bound to micFlux in `override` mode were pinned at range[0] every frame.
//
// This file pins the whole chain OFFLINE and IN-PROCESS: no sockets are bound,
// no engine or Companion is started, no state file is written.
//
// Run:  cd marsin_engine && node --test tests/companion/companion_flux_output.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CURATED_OUTPUTS, RAW_SOURCES, loadCompanionConfig, defaultCompanionConfig,
  validateCompanionConfig, missingCuratedOutputs, outputCpcKeyOf, oscOutTapOf,
  resolveOscOut,
} from '../../audio/companion/companion_config.js';
import { audioSignalDescriptors, descriptorByKey } from '../../audio/postproc/audio_signals.js';
import { SignalPostProcessor } from '../../audio/postproc/signal_post_processor.js';
import { OscListener, GAIN_BY_KEY } from '../../lib/osc_listener.js';
import { ParamCenter } from '../../lib/param_center.js';
import { applyModulations } from '../../lib/modulation_engine.js';

/** { cpcKey: address } for the OUTPUT signals a validated design publishes. */
function publishedOutputs(cfg) {
  const out = {};
  for (const sig of cfg.signals) {
    const key = outputCpcKeyOf(sig);
    if (key === null) continue;
    const tap = oscOutTapOf(sig);
    out[key] = resolveOscOut(tap.params.name, tap.params.address).address;
  }
  return out;
}

// ── the curated map is DERIVED, not transcribed ─────────────────────────────

test('CURATED_OUTPUTS mirrors the registry descriptors it claims to mirror', () => {
  const expected = {};
  for (const d of audioSignalDescriptors()) {
    if (typeof d.oscAddress !== 'string') continue;
    if (!d.oscAddress.startsWith('/marsin/mic/') && !d.oscAddress.startsWith('/marsin/dom/')) continue;
    expected[d.key] = d.oscAddress;
  }
  assert.deepEqual({ ...CURATED_OUTPUTS }, expected);
  assert.equal(CURATED_OUTPUTS.micFlux, '/marsin/mic/flux');
});

test('every designable RAW SOURCE has a curated output to publish on', () => {
  // The invariant the FLUX gap violated: an operator could design a signal
  // FROM rawFlux but had nowhere canonical to send it TO, so `micFlux` got
  // slug-mangled into a NEW dynamic key `micflux` on /marsin/audio/micflux.
  const curatedKeys = new Set(Object.keys(CURATED_OUTPUTS));
  assert.equal(Object.keys(RAW_SOURCES).length, curatedKeys.size,
    'one curated output per designable raw source');
  assert.ok(RAW_SOURCES.rawFlux, 'rawFlux is a designable source');
});

test('a curated name resolves to the canonical key + address, never a slug', () => {
  assert.deepEqual(resolveOscOut('micFlux'),
    { name: 'micFlux', cpcKey: 'micFlux', address: '/marsin/mic/flux' });
  // Pre-fix this returned { cpcKey: 'micflux', address: '/marsin/audio/micflux' }
  // — a brand-new dynamic key no pattern or playlist references.
  assert.notEqual(resolveOscOut('micFlux').cpcKey, 'micflux');
});

// ── the designs actually publish it ─────────────────────────────────────────

test('the BUILT-IN default design publishes /marsin/mic/flux as micFlux', () => {
  const cfg = validateCompanionConfig(defaultCompanionConfig());
  assert.equal(publishedOutputs(cfg).micFlux, '/marsin/mic/flux');
  assert.deepEqual(missingCuratedOutputs(cfg), []);
});

test('the PERSISTED design publishes every curated output (incl. flux)', () => {
  // companion_config.yaml is TRACKED config. If an operator "Export config"
  // drops a curated signal, this fails loudly here rather than silently on the
  // playa as a dead meter and a pinned slider.
  const cfg = loadCompanionConfig();
  assert.deepEqual(missingCuratedOutputs(cfg), [],
    'companion_config.yaml must publish every curated engine-bound signal');
  assert.equal(publishedOutputs(cfg).micFlux, '/marsin/mic/flux');
});

test('missingCuratedOutputs NAMES an omitted signal (it does not repair it)', () => {
  const cfg = validateCompanionConfig(defaultCompanionConfig());
  const withoutFlux = { ...cfg, signals: cfg.signals.filter(s => s.id !== 'flux') };
  assert.deepEqual(missingCuratedOutputs(withoutFlux), ['micFlux']);
});

// ── the engine end of the wire ──────────────────────────────────────────────

test('micFlux is gain-wired like every other band (gain + raw mirror alive)', () => {
  // Was deliberately excluded from GAIN_BY_KEY back when the engine ran its own
  // analyzer. Under the sole-analyzer contract that left micFluxGain dead, the
  // micFlux post-chain unrun, and micFluxRaw pinned at 0 — which
  // audio_structure_detector.js reads as its build-score flux input.
  assert.equal(GAIN_BY_KEY.micFlux, 'micFluxGain');
  assert.equal(descriptorByKey('micFluxRaw').live, true);
});

/** A listener wired to a fresh in-memory CPC. Never started: the constructor
 *  binds nothing, and we drive `_dispatchMessage` directly, so no port on this
 *  machine is touched (Codex P0 / operator-safety: the show stack is live). */
function makeWire() {
  const paramCenter = new ParamCenter(null);
  const spp = new SignalPostProcessor({ paramCenter });
  const listener = new OscListener({ port: 59999, paramCenter, signalPostProcessor: spp });
  return { paramCenter, listener };
}

/** Feed `value` on an address for ~`ms` of REAL time. The micFlux post-chain
 *  ends in a smoothing LPF whose dt comes from wall-clock packet spacing, so a
 *  single dispatch (dt = 0) can never move it — the signal has to actually be
 *  streamed, exactly as the Companion streams it. */
async function pump(listener, address, value, ms = 240) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    listener._dispatchMessage({ address, args: [value] }, 'test', '127.0.0.1');
    await new Promise(r => setTimeout(r, 5));
  }
}

test('an injected /marsin/mic/flux packet reaches a bound pattern parameter', async () => {
  // Full chain, in-process, no socket: OSC dispatch -> post-chain (gain+LPF)
  // -> ParamCenter micFlux -> applyModulations -> the pattern slider moves.
  const { paramCenter, listener } = makeWire();

  assert.equal(paramCenter.get('micFlux'), 0, 'starts at the silent default');

  await pump(listener, '/marsin/mic/flux', 1.0);
  const flux = paramCenter.get('micFlux');
  assert.ok(flux > 0, `micFlux must rise off 0 once flux is streamed, got ${flux}`);
  // The PRE-gain mirror the structure detector reads is published too.
  assert.equal(paramCenter.get('micFluxRaw'), 1.0);

  // …and it moves a parameter bound to it, in the mode the show uses.
  const mapping = {
    id: 'mod_sliderStarCount_micFlux', type: 'continuous', enabled: true,
    source: { scope: 'cpc', key: 'micFlux' },
    target: { scope: 'pattern', parameter: 'sliderStarCount' },
    mode: 'override', polarity: 'unipolar', range: [0.12, 0.86], curve: 'ease',
  };
  const result = applyModulations({
    baseParams: { sliderStarCount: 0.5 },
    targetDefs: [{ name: 'sliderStarCount', kind: 1, id: 3 }],
    modulations: [mapping],
    sourceValues: paramCenter.getAll(),
  });
  const target = result.values.sliderStarCount;
  assert.equal(target.source, 'micFlux');
  assert.ok(target.modulated > 0.12,
    `a live flux value must lift the target off range[0], got ${target.modulated}`);
});

test('the micFluxGain knob is no longer dead — it scales the received value', async () => {
  const full = makeWire();
  await pump(full.listener, '/marsin/mic/flux', 1.0);

  const muted = makeWire();
  muted.paramCenter.set('micFluxGain', 0.0, 'test');
  await pump(muted.listener, '/marsin/mic/flux', 1.0);

  assert.ok(full.paramCenter.get('micFlux') > 0, 'gain 1.0 passes the signal');
  assert.equal(muted.paramCenter.get('micFlux'), 0, 'gain 0 mutes the post value');
  // The RAW mirror is PRE-gain, so it still carries the analyzer's value —
  // which is why the structure detector reads micFluxRaw, not micFlux.
  assert.equal(muted.paramCenter.get('micFluxRaw'), 1.0);
});
