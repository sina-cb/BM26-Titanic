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

const STEMS = ['Vocals', 'Bass', 'Drums'];
const MIC_BANDS = [
  { key: 'micLow',  label: 'Mic · Low',  gainLabel: 'Mic Low Gain',  osc: 'low',  hz: 15 },
  { key: 'micMid',  label: 'Mic · Mid',  gainLabel: 'Mic Mid Gain',  osc: 'mid',  hz: 15 },
  { key: 'micHigh', label: 'Mic · High', gainLabel: 'Mic High Gain', osc: 'high', hz: 15 },
  { key: 'micKick', label: 'Mic · Kick', gainLabel: 'Mic Kick Gain', osc: 'kick', hz: 30 },
  { key: 'micFlux', label: 'Mic · Flux', gainLabel: 'Mic Flux Gain', osc: 'flux', hz: 15 },
];

// Per-key broadcast rates for the detector outputs (docs/30 §Data shape).
const DETECTORS = [
  { key: 'audioStructure',   label: 'Audio · Structure',    range: [0, 2], hz: 10 },
  { key: 'audioBuildScore',  label: 'Audio · Build Score',  range: [0, 1], hz: 10 },
  { key: 'audioEnergyRatio', label: 'Audio · Energy Ratio', range: [0, 1], hz: 10 },
  { key: 'audioVocalsHot',   label: 'Audio · Vocals Hot',   range: [0, 1], hz: 5  },
  { key: 'audioDropPulse',   label: 'Audio · Drop Pulse',   range: [0, 1], hz: 15 },
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
    oscAddress: undefined, sharedFnName: d.key,
    processed: false, hasRawMirror: false, gainKey: null, defaultChainKind: null,
  };
}

function buildDescriptors() {
  const out = [];

  // 1) Per-stem operator gains (persistent). Order: Vocals, Bass, Drums.
  for (const s of STEMS) {
    out.push(gainDescriptor(`stems${s}Gain`, `${s} Gain`));
  }

  // 2) Live OSC stems (Vocals, Bass, Drums). Processed through the chain;
  //    gained by `stems<S>Gain`; mirrored by `stems<S>Raw`.
  for (const s of STEMS) {
    out.push({
      key: `stems${s}`, label: `Stems · ${s}`, type: 'float',
      range: [0, 1], default: 0.0, clamp: true,
      persist: false, live: true, broadcastHz: 15, portWatch: false,
      oscAddress: `/marsin/stems/${s.toLowerCase()}`, sharedFnName: `stems${s}`,
      processed: true, hasRawMirror: true, gainKey: `stems${s}Gain`,
      defaultChainKind: 'gain',
    });
  }

  // 3) Raw (pre-gain) stem mirrors.
  for (const s of STEMS) {
    out.push(rawMirrorDescriptor(`stems${s}Raw`, `Stems · ${s} (raw)`, 15));
  }

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
 * Signal keys that flow through SignalPostProcessor.process() — i.e.
 * KNOWN_SIGNALS. Mic bands + kick + flux + stems, in their family order
 * (mic first, then stems) to match the pre-refactor KNOWN_SIGNALS array.
 */
function processedSignalKeys() {
  // Pre-refactor KNOWN_SIGNALS order: mic bands in band order, then stems
  // in Bass→Drums→Vocals order (NOT the registry's Vocals-first order —
  // the legacy array listed stems alphabetically-ish). Pin both explicitly
  // so the derived set is BYTE-identical to the hand-written one.
  const MIC_ORDER = ['micLow', 'micMid', 'micHigh', 'micKick', 'micFlux'];
  const STEMS_ORDER = ['stemsBass', 'stemsDrums', 'stemsVocals'];
  const order = [...MIC_ORDER, ...STEMS_ORDER];
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
  stemsBass: 'stems_bass_gain',
  stemsDrums: 'stems_drums_gain',
  stemsVocals: 'stems_vocals_gain',
});

function gainOpIdFor(key) {
  const id = GAIN_OP_ID[key];
  if (!id) throw new Error(`audio_signals: no gain op id for "${key}"`);
  return id;
}

/**
 * { liveKey: gainKey } for every processed signal that has a gain knob —
 * i.e. osc_listener.js's GAIN_BY_KEY. Order: stems first, then mic
 * (matching the pre-refactor hand-written GAIN_BY_KEY object). micFlux is
 * processed and HAS a gainKey but was NOT in the legacy GAIN_BY_KEY (its
 * gain is applied in the analyzer, not the OSC path) — so we exclude it
 * here to stay byte-identical. The `oscGained` flag marks which signals
 * the OSC listener gains.
 */
function gainByKeyForOsc() {
  const out = {};
  // Pre-refactor order: stemsBass, stemsDrums, stemsVocals, then
  // micLow, micMid, micHigh, micKick.
  const order = [
    'stemsBass', 'stemsDrums', 'stemsVocals',
    'micLow', 'micMid', 'micHigh', 'micKick',
  ];
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
  processedSignalKeys,
  defaultGainChainFor,
  gainOpIdFor,
  gainByKeyForOsc,
};
