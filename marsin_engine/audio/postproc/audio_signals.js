/**
 * audio_signals.js — the SINGLE SOURCE OF TRUTH for the AUDIO signal family.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Until this commit, adding ONE audio live signal meant editing FIVE
 * places in lockstep — and they drifted:
 *   1. `KNOWN_SIGNALS` in `signal_post_processor.js`
 *   2. the hand-written CPC registry array in `param_center.js`
 *      (the signal + its `*Raw` mirror + its `*Gain`)
 *   3. `DEFAULT_CHAINS` in `signal_post_processor.js`
 *   4. the raw-mirror + gain-by-key derivation in `osc_listener.js`
 *   5. the hardcoded `liveKeys` Set in `CaptainPad/hooks/useEngineState.ts`
 *
 * Every one of those was a transcription of the SAME facts (key, range,
 * broadcast rate, persistence policy, OSC address, whether it has a gain
 * knob / raw mirror). This table holds those facts ONCE; the consumers
 * DERIVE their structures from it instead of re-listing them.
 *
 * HOW EACH CONSUMER DERIVES FROM THIS TABLE
 * -----------------------------------------
 *   - `param_center.js`         — splices `audioRegistryEntries()` into
 *                                 PARAM_REGISTRY in place of the old
 *                                 hand-listed audio block. NON-audio
 *                                 entries (colors / speed / size / BPM
 *                                 sync / global effects) stay hand-listed.
 *   - `signal_post_processor.js`— `KNOWN_SIGNALS` is `processedSignalKeys()`
 *                                 and the gain-only `DEFAULT_CHAINS` entries
 *                                 come from `defaultChainFor(key)`. The
 *                                 special micKick Envelope→Schmitt→Hold
 *                                 default and the op catalog stay in
 *                                 signal_post_processor.js (they are not
 *                                 family metadata, they are DSP behaviour).
 *   - `osc_listener.js`         — `GAIN_BY_KEY` and the `<key>Raw` mirror
 *                                 map are derived from the descriptors that
 *                                 carry `gainKey` / `hasRawMirror`.
 *   - CaptainPad                — seeds its live-key set from the engine's
 *                                 `GET /param-center/schema` (`live:true`
 *                                 entries), which is itself generated from
 *                                 this table — so the iPad can never drift.
 *
 * INVARIANT: this is a REFACTOR. The generated registry entries are
 * byte-identical to the pre-refactor hand-written ones — same keys, same
 * `broadcastHz` per key (15 for bands/stems/flux, 30 for kick, 5 for
 * tempoBpm, 10/5 for the detector keys), same persist/portWatch/oscAddress/
 * sharedFnName, same registry ORDER. `tests/audio_signals.test.js` pins the
 * generated shape against a hand-written snapshot of those values so any
 * future "tidy" that changes a value fails loudly.
 *
 * Descriptor fields (see DESCRIPTORS below):
 *   key            — CPC key, also the SignalPostProcessor signal key.
 *   label          — human label for the CaptainPad UI.
 *   type           — CPC value type ('float'); the audio family is all floats.
 *   range          — [min, max] for clamping.
 *   default        — seed value.
 *   persist        — persisted to param_center_state.yaml?
 *   live           — high-rate, ephemeral live-param policy (docs/24 §7.4)?
 *   broadcastHz    — throttle rate for the WS liveParams broadcast.
 *   portWatch      — eligible for PortWatch global-param mirroring?
 *   oscAddress     — canonical OSC inbound address (omitted = no binding;
 *                    raw mirrors and gains-without-OSC have none).
 *   sharedFnName   — pattern shared-fn name (== key for the audio family).
 *   processed      — does this key flow through SignalPostProcessor.process()?
 *                    (the mic bands + kick + flux + stems — NOT gains, raw
 *                    mirrors, tempoBpm, or detector outputs). Drives
 *                    KNOWN_SIGNALS + DEFAULT_CHAINS.
 *   hasRawMirror   — does a `<key>Raw` companion live key exist?
 *   gainKey        — the `<key>Gain` CPC key that scales this signal, or null.
 *   defaultChainKind — 'gain' (single Gain op on gainKey) or 'kickTrigger'
 *                    (the documented Envelope→Schmitt→Hold default). Only set
 *                    on `processed` descriptors.
 */

// ── The audio signal family ──────────────────────────────────────────────────
//
// Order matters: the registry, /param-center/schema, and OSC-binding
// construction all walk this in array order. It mirrors the pre-refactor
// hand-written order in PARAM_REGISTRY EXACTLY (stems gains → stems live →
// stems raw → tempoBpm → mic bands → mic raw → mic gains → detector keys).

// NOTE: the `stems*` family (stemsBass/Drums/Vocals + *Gain + *Raw) was
// REMOVED on 2026-06-17 (operator brief — stems retired entirely). The
// Audio Companion is now the sole analyzer and emits the curated mic/dom/
// derived OSC set; there is no stem-separation source any more.
const MIC_BANDS = [
  { key: 'micLow',  label: 'Mic · Low',  gainLabel: 'Mic Low Gain',  osc: 'low',  hz: 15 },
  { key: 'micMid',  label: 'Mic · Mid',  gainLabel: 'Mic Mid Gain',  osc: 'mid',  hz: 15 },
  { key: 'micHigh', label: 'Mic · High', gainLabel: 'Mic High Gain', osc: 'high', hz: 15 },
  { key: 'micKick', label: 'Mic · Kick', gainLabel: 'Mic Kick Gain', osc: 'kick', hz: 30 },
  { key: 'micFlux', label: 'Mic · Flux', gainLabel: 'Mic Flux Gain', osc: 'flux', hz: 15 },
];

// Per-key broadcast rates for the detector outputs (docs/30 §Data shape).
// `osc` (optional) = the inbound OSC address the Audio Companion (sole
// analyzer, 2026-06-17 contract) feeds this key from. The detector outputs
// the companion emits carry a binding; the rest stay engine-internal.
const DETECTORS = [
  { key: 'audioStructure',   label: 'Audio · Structure',    range: [0, 2], hz: 10 },
  { key: 'audioBuildScore',  label: 'Audio · Build Score',  range: [0, 1], hz: 10, osc: '/marsin/audio/build' },
  { key: 'audioEnergyRatio', label: 'Audio · Energy Ratio', range: [0, 1], hz: 10, osc: '/marsin/audio/energy' },
  { key: 'audioVocalsHot',   label: 'Audio · Vocals Hot',   range: [0, 1], hz: 5  },
  { key: 'audioDropPulse',   label: 'Audio · Drop Pulse',   range: [0, 1], hz: 15 },
  { key: 'audioSlowZone',    label: 'Audio · Slow Zone',    range: [0, 1], hz: 10, osc: '/marsin/audio/slow' },
];

// Derived signals (BPM / beat / party / note / switch cues) — observe-and-publish.
const DERIVED = [
  { key: 'audioBpm',           label: 'Audio · BPM',            range: [0, 300], hz: 5,  osc: '/marsin/audio/bpm' },
  { key: 'audioBeat',          label: 'Audio · Beat',           range: [0, 1],   hz: 30 },
  { key: 'audioParty',         label: 'Audio · Party',          range: [0, 1],   hz: 5,  osc: '/marsin/audio/party' },
  { key: 'audioNote',          label: 'Audio · Note',           range: [0, 11],  hz: 10 },
  { key: 'audioNoteHue',       label: 'Audio · Note Hue',       range: [0, 1],   hz: 10 },
  { key: 'audioSwitchPattern', label: 'Audio · Switch Pattern', range: [0, 1],   hz: 15 },
  { key: 'audioSwitchColor',   label: 'Audio · Switch Color',   range: [0, 1],   hz: 15 },
  { key: 'audioBeatInBar',     label: 'Audio · Beat In Bar',    range: [0, 4],   hz: 30 },
  { key: 'audioBarPhase',      label: 'Audio · Bar Phase',      range: [0, 1],   hz: 30 },
  { key: 'audioDownbeat',      label: 'Audio · Downbeat',       range: [0, 1],   hz: 30 },
];

function gainDescriptor(key, label) {
  return {
    key, label, type: 'float',
    range: [0, 2], default: 1.0, clamp: true,
    persist: true, live: false, broadcastHz: 30, portWatch: true,
    oscAddress: `/marsin/param/${key}`, sharedFnName: key,
    processed: false, hasRawMirror: false, gainKey: null, defaultChainKind: null,
  };
}

function rawMirrorDescriptor(key, label, hz) {
  return {
    key, label, type: 'float',
    range: [0, 1], default: 0.0, clamp: true,
    persist: false, live: true, broadcastHz: hz, portWatch: false,
    // No OSC inbound binding — engine-internal mirror only.
    oscAddress: undefined, sharedFnName: key,
    processed: false, hasRawMirror: false, gainKey: null, defaultChainKind: null,
  };
}

function detectorDescriptor(d) {
  return {
    key: d.key, label: d.label, type: 'float',
    range: d.range, default: 0.0, clamp: true,
    persist: false, live: true, broadcastHz: d.hz, portWatch: false,
    // Inbound OSC binding only for the keys the Audio Companion emits
    // (build / energy / slow / bpm / party — 2026-06-17 contract).
    oscAddress: d.osc !== undefined ? d.osc : undefined, sharedFnName: d.key,
    processed: false, hasRawMirror: false, gainKey: null, defaultChainKind: null,
  };
}

// Dominant-frequency analyzer outputs (dom1/dom2 + their energy). Live,
// engine-internal (no OSC inbound), not chain-processed, no gain/raw mirror.
// Freq keys carry Hz (range up to Nyquist); energy keys are [0,1] on the
// same softCompress scale as the bands.
const DOM_NYQUIST_MAX = 22050;
const DOM_FREQS = [
  { key: 'micDomFreq1',   label: 'Mic · Dom Freq 1',   range: [0, DOM_NYQUIST_MAX], osc: '/marsin/dom/freq1' },
  { key: 'micDomEnergy1', label: 'Mic · Dom Energy 1', range: [0, 1], osc: '/marsin/dom/energy1' },
  { key: 'micDomFreq2',   label: 'Mic · Dom Freq 2',   range: [0, DOM_NYQUIST_MAX], osc: '/marsin/dom/freq2' },
  { key: 'micDomEnergy2', label: 'Mic · Dom Energy 2', range: [0, 1], osc: '/marsin/dom/energy2' },
];

function domDescriptor(d) {
  return {
    key: d.key, label: d.label, type: 'float',
    range: d.range, default: 0.0, clamp: true,
    persist: false, live: true, broadcastHz: 15, portWatch: false,
    // dom freq1/freq2 carry the inbound binding the Companion emits to
    // (2026-06-17 contract); the energy companions stay engine-internal.
    oscAddress: d.osc !== undefined ? d.osc : undefined, sharedFnName: d.key,
    processed: false, hasRawMirror: false, gainKey: null, defaultChainKind: null,
  };
}

function buildDescriptors() {
  const out = [];

  // (Stems removed 2026-06-17 — the old steps 1–3 built the stems gains /
  // live signals / raw mirrors. The family is gone; the mic bands below
  // are now the only chain-processed audio signals.)

  // 4) tempoBpm — live BPM scalar on the LX Studio /lx/tempo/bpm address.
  //    No gain, no raw mirror, not chain-processed (it's a tempo reference).
  out.push({
    key: 'tempoBpm', label: 'Tempo · BPM', type: 'float',
    range: [0, 300], default: 0.0, clamp: true,
    persist: false, live: true, broadcastHz: 5, portWatch: false,
    oscAddress: '/lx/tempo/bpm', sharedFnName: 'tempoBpm',
    processed: false, hasRawMirror: false, gainKey: null, defaultChainKind: null,
  });

  // 5) Mic bands + kick + flux (live). Processed; gained; raw-mirrored.
  //    micKick gets the Envelope→Schmitt→Hold trigger-shaper default.
  for (const b of MIC_BANDS) {
    out.push({
      key: b.key, label: b.label, type: 'float',
      range: [0, 1], default: 0.0, clamp: true,
      persist: false, live: true, broadcastHz: b.hz, portWatch: false,
      oscAddress: `/marsin/mic/${b.osc}`, sharedFnName: b.key,
      processed: true, hasRawMirror: true, gainKey: `${b.key}Gain`,
      defaultChainKind: b.key === 'micKick' ? 'kickTrigger' : 'gain',
    });
  }

  // 6) Raw (pre-gain) mic mirrors — same broadcast rate as their band.
  for (const b of MIC_BANDS) {
    out.push(rawMirrorDescriptor(`${b.key}Raw`, `${b.label} (raw)`, b.hz));
  }

  // 7) Per-band mic gains (persistent).
  for (const b of MIC_BANDS) {
    out.push(gainDescriptor(`${b.key}Gain`, b.gainLabel));
  }

  // 8) Audio structure detector outputs (observe-and-publish).
  for (const d of DETECTORS) {
    out.push(detectorDescriptor(d));
  }

  // 9) Dominant-frequency analyzer outputs (dom1/dom2 freq + energy).
  for (const d of DOM_FREQS) {
    out.push(domDescriptor(d));
  }

  // 10) Derived signals (BPM / beat / party / note / switch cues).
  for (const d of DERIVED) {
    out.push(detectorDescriptor(d));
  }

  return out;
}

const DESCRIPTORS = Object.freeze(buildDescriptors().map(d => Object.freeze(d)));

// ── Public derivations ───────────────────────────────────────────────────────

/** Every audio-family descriptor, in registry order. */
function audioSignalDescriptors() {
  return DESCRIPTORS;
}

/** Look up one descriptor by key (or null). */
function descriptorByKey(key) {
  return DESCRIPTORS.find(d => d.key === key) || null;
}

/**
 * CPC registry entries for the audio family, in registry order. The
 * `processed` / `hasRawMirror` / `gainKey` / `defaultChainKind` family
 * flags are stripped — they are SignalPostProcessor / osc_listener
 * concerns, not CPC schema fields. Persisted-default omissions (live
 * keys never set `clamp:false`) match the hand-written entries exactly.
 */
function audioRegistryEntries() {
  return DESCRIPTORS.map((d) => {
    const entry = {
      key: d.key,
      label: d.label,
      type: d.type,
      default: d.default,
      range: d.range,
      clamp: d.clamp,
      persist: d.persist,
    };
    // Live keys carry the live-param policy fields; persisted gains do not
    // (they ride the REGISTRY_DEFAULTS in param_center.js, exactly as the
    // hand-written gain entries did — they only set persist:true).
    if (d.live) {
      entry.live = true;
      entry.broadcastHz = d.broadcastHz;
      entry.portWatch = d.portWatch;
    }
    if (d.oscAddress !== undefined) entry.oscAddress = d.oscAddress;
    entry.sharedFnName = d.sharedFnName;
    return entry;
  });
}

/**
 * Set of LIVE audio-family `sharedFnName`s (mic bands/flux, dom freq+energy,
 * tempoBpm, detector + derived outputs — every descriptor with `live:true`).
 *
 * MODULATORS-ONLY POLICY (operator decision 2026-06-17): patterns must NOT
 * read these live CPC audio signals natively via a matching `export var`.
 * All audio reactivity goes through the MODULATION engine, which writes
 * pattern SLIDER params. `ParamCenter.registerChannel` uses this set to
 * refuse binding these keys into pattern globals — see param_center.js.
 *
 * The persistent `*Gain` params are intentionally EXCLUDED (they are
 * `live:false` operator knobs, not signals a pattern would ever name).
 */
const LIVE_AUDIO_SHARED_FN_NAMES = Object.freeze(
  new Set(DESCRIPTORS.filter(d => d.live).map(d => d.sharedFnName)),
);

/** Whether `name` is a LIVE audio-family shared-fn name (modulators-only). */
function isLiveAudioSharedFnName(name) {
  return LIVE_AUDIO_SHARED_FN_NAMES.has(name);
}

/**
 * Signal keys that flow through SignalPostProcessor.process() — i.e.
 * KNOWN_SIGNALS. Mic bands + kick + flux + stems, in their family order
 * (mic first, then stems) to match the pre-refactor KNOWN_SIGNALS array.
 */
function processedSignalKeys() {
  // The mic bands are the only chain-processed signals (stems removed
  // 2026-06-17). Order pinned explicitly so the derived set is stable.
  const MIC_ORDER = ['micLow', 'micMid', 'micHigh', 'micKick', 'micFlux'];
  const order = [...MIC_ORDER];
  const processed = new Set(DESCRIPTORS.filter(d => d.processed).map(d => d.key));
  // Guard: the explicit order must cover exactly the processed descriptors.
  for (const k of order) {
    if (!processed.has(k)) throw new Error(`audio_signals: ordered key "${k}" is not a processed descriptor`);
  }
  if (order.length !== processed.size) {
    throw new Error('audio_signals: processed-descriptor / ordered-key count mismatch');
  }
  return order;
}

/**
 * Built-in default chain for one processed signal. 'gain' → a single Gain
 * op tied to the signal's `<key>Gain` paramKey (the op id is `<short>_gain`
 * to match the pre-refactor DEFAULT_CHAINS). 'kickTrigger' is handled by
 * signal_post_processor.js itself (it carries extra envelope/schmitt/hold
 * params that are DSP behaviour, not family metadata) — this helper returns
 * null for it so the caller keeps that special case explicit.
 */
function defaultGainChainFor(key) {
  const d = descriptorByKey(key);
  if (!d || !d.processed) return null;
  if (d.defaultChainKind !== 'gain') return null;
  return [
    { id: `${gainOpIdFor(key)}`, type: 'gain', enabled: true, params: { paramKey: d.gainKey } },
  ];
}

// Op-id stems matching the pre-refactor DEFAULT_CHAINS ids exactly.
const GAIN_OP_ID = Object.freeze({
  micLow: 'low_gain',
  micMid: 'mid_gain',
  micHigh: 'high_gain',
  micKick: 'kick_gain',
  micFlux: 'flux_gain',
});

function gainOpIdFor(key) {
  const id = GAIN_OP_ID[key];
  if (!id) throw new Error(`audio_signals: no gain op id for "${key}"`);
  return id;
}

/**
 * { liveKey: gainKey } for every processed signal that has a gain knob —
 * i.e. osc_listener.js's GAIN_BY_KEY. micFlux is processed and HAS a
 * gainKey but its gain is applied in the analyzer, not the OSC path — so
 * it is excluded here. (Stems removed 2026-06-17; the mic bands are now
 * the only OSC-gained signals.)
 */
function gainByKeyForOsc() {
  const out = {};
  const order = ['micLow', 'micMid', 'micHigh', 'micKick'];
  for (const key of order) {
    const d = descriptorByKey(key);
    if (d && d.gainKey) out[key] = d.gainKey;
  }
  return out;
}

export {
  audioSignalDescriptors,
  descriptorByKey,
  audioRegistryEntries,
  isLiveAudioSharedFnName,
  processedSignalKeys,
  defaultGainChainFor,
  gainOpIdFor,
  gainByKeyForOsc,
};
