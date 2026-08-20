/**
 * mic_model.mjs — a "virtual playa microphone" degradation stage for the
 * audio-analysis integration harness.
 *
 * WHY THIS EXISTS:
 *   On the playa the analysis mic does NOT hear clean line-in. It hears
 *   music radiated from speakers, through air + distance + crowd, captured
 *   by a cheap capsule in a loud, windy, noisy room. Tuning the analyzer /
 *   signal chains / structure detector against pristine audio over-fits to
 *   a signal we will never actually receive. This module degrades a clean
 *   PCM clip (synthetic OR a decoded real track) into something that
 *   resembles what the mic feeds the engine, at configurable severity, so
 *   every tuning pass is stressed across realistic SNR tiers.
 *
 * THE PHYSICAL CHAIN WE MODEL (in signal order):
 *   1. speaker + air + distance  → band-limiting (deep sub and extreme
 *      air are lost over distance / through a cheap speaker + capsule):
 *      one-pole high-pass + one-pole low-pass.
 *   2. loud-room capsule         → soft saturation / compression: a loud
 *      SPL into a cheap capsule does not stay linear; tanh soft-clip with
 *      a configurable drive models the gentle limiting + harmonic crud.
 *   3. distance / level          → SNR: the captured signal is attenuated
 *      relative to the ambient + electrical noise floor. We set the
 *      signal gain so the post-chain signal-to-noise ratio hits the tier's
 *      target dB.
 *   4. room + crowd + HVAC       → low-level PINK noise (energy weighted to
 *      the lows, like real room rumble / crowd murmur / wind on the
 *      capsule).
 *   5. mic self-noise            → WHITE noise floor (the capsule + preamp
 *      hiss).
 *   6. mains hum                 → optional 50/60 Hz tone (+ a little 2nd
 *      harmonic) for cheap-PSU / ground-loop realism.
 *   7. WIND GUSTS                → transient low-frequency rumble bursts on
 *      the capsule (a real playa night). Steady pink noise (step 4) does NOT
 *      model these — a gust is an occasional 0.6–1.5 s raised-cosine envelope
 *      of sub-100 Hz noise that slams the low band and looks, to a naive
 *      detector, exactly like a kick or a drop edge. Gated by `windLevel>0`.
 *   8. NEIGHBOR BLEED            → a competing 4-on-the-floor kick+bass from
 *      the camp next door, at a DIFFERENT tempo than the captured track, low
 *      level but enough to plant phantom beats / drops uncorrelated with our
 *      music. Gated by `bleedLevel>0`.
 *
 * Steps 7–8 are ADDED to the output mix AFTER the SNR balance (steps 3–6),
 * so they are absolute contaminants the analyzer must reject rather than
 * noise the SNR target quietly compensates for — that is the whole point of
 * the on-playa hardening they exist to stress. They are OFF in every legacy
 * tier (windLevel/bleedLevel default 0), so clean/moderate/heavy degrade
 * byte-for-byte as before; only the new `playa` tier turns them on.
 *
 * Codex P0 — NO FALLBACK BEHAVIORS: every public entry validates its
 * inputs and throws loudly on anything malformed (wrong array type, bad
 * sample rate, unknown tier). A degraded fixture that silently passes
 * garbage would invalidate the tuning it feeds.
 *
 * DETERMINISM: all randomness comes from a seeded mulberry32 PRNG (shared
 * with synth_dataset.mjs), so a given (clip, tier, seed) degrades
 * byte-for-byte identically — the degraded corpus is reproducible.
 *
 * I/O CONTRACT: operates on Int16 mono PCM (the harness's lingua franca —
 * what wav_io decodes and what the analyzer's file-replay path consumes).
 * Internally it works in float [-1, 1] and re-quantizes once at the end.
 */

import { mulberry32 } from './synth_dataset.mjs';

const I16_MAX = 32767;

/**
 * Named SNR tiers. Each tier is a full degradation spec; `applyMicModel`
 * merges any per-call overrides on top. The numbers are deliberately
 * conservative-to-aggressive so a tuning pass can prove behavior from a
 * near-line-in capture (`clean`) to a far, loud, windy night (`heavy`).
 *
 *   snrDb          target post-chain signal-to-noise ratio (dB), where
 *                  "noise" is room+self+hum combined. Lower = noisier.
 *   roomNoise      pink-noise RMS as a fraction of full scale (room/crowd).
 *   selfNoise      white-noise RMS as a fraction of full scale (capsule).
 *   humLevel       mains-hum amplitude as a fraction of full scale (0 = off).
 *   humHz          mains frequency (50 or 60).
 *   drive          soft-clip drive (1 = unity/near-linear; >1 compresses).
 *   hpHz / lpHz    band-limit corners (Hz). hpHz=0 disables the HP.
 *
 * `snrDb: null` means "do not re-balance to a target SNR" — use the raw
 * roomNoise/selfNoise levels as-is (used by the `clean` tier, which is
 * essentially line-in with a whisper of floor).
 */
export const MIC_TIERS = {
  clean: {
    snrDb: null,
    roomNoise: 0.002,
    selfNoise: 0.0008,
    humLevel: 0.0,
    humHz: 60,
    drive: 1.0,
    hpHz: 35,
    lpHz: 18000,
  },
  moderate: {
    snrDb: 18,
    roomNoise: 0.010,
    selfNoise: 0.002,
    humLevel: 0.0015,
    humHz: 60,
    drive: 1.6,
    hpHz: 45,
    lpHz: 15000,
  },
  heavy: {
    snrDb: 9,
    roomNoise: 0.025,
    selfNoise: 0.004,
    humLevel: 0.004,
    humHz: 60,
    drive: 2.4,
    hpHz: 55,
    lpHz: 13000,
  },
  // The full on-playa case: a far, loud, windy night next to a neighbor camp.
  // Same band-limit / saturation / SNR as `heavy`, PLUS wind gusts and a
  // competing 4-on-the-floor bleed from the next sound system. This is the
  // tier the noise-floor subtraction + wind guard exist to survive.
  playa: {
    snrDb: 9,
    roomNoise: 0.025,
    selfNoise: 0.004,
    humLevel: 0.004,
    humHz: 60,
    drive: 2.4,
    hpHz: 30,            // wind energy lives below the heavy-tier 55 Hz HP — let it through
    lpHz: 13000,
    // Wind: ~0.18 gusts/s (one every ~5.5 s), each a fat low-freq rumble that
    // slams the low band. windLevel is the peak gust amplitude (full-scale frac).
    windLevel: 0.12,
    windGustHz: 0.18,
    windLpHz: 90,
    // Neighbor bleed: a 124-BPM kick+bass from the next camp (our tracks are a
    // mix of tempos, so it is deliberately uncorrelated), low but audible.
    bleedLevel: 0.05,
    bleedBpm: 124,
    bleedKickHz: 55,
  },
  adversarial: {
    snrDb: 5,
    roomNoise: 0.040,
    selfNoise: 0.006,
    humLevel: 0.008,
    humHz: 60,
    drive: 3.5,
    hpHz: 25,
    lpHz: 10000,
    inputGain: 1.8,
    hardClip: 0.65,
    roomEchoMs: 85,
    roomEchoGain: 0.28,
    windLevel: 0.18,
    windGustHz: 0.25,
    windLpHz: 100,
    bleedLevel: 0.08,
    bleedBpm: 124,
    bleedKickHz: 55,
    speechLevel: 0.08,
  },
};

/** RMS of a float array. */
function rms(buf) {
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  return Math.sqrt(sum / Math.max(1, buf.length));
}

/**
 * Paul Kellet's economy pink-noise filter (public domain). Turns a white
 * sample into an approximately -3 dB/oct pink sample using a small IIR
 * state. Deterministic given the white input.
 */
function makePinkGen(rnd) {
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  return function nextPink() {
    const white = rnd() * 2 - 1;
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.96900 * b2 + white * 0.1538520;
    b3 = 0.86650 * b3 + white * 0.3104856;
    b4 = 0.55000 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.0168980;
    const pink = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
    b6 = white * 0.115926;
    // Kellet's sum has ~ ±5 range; scale to roughly unit RMS.
    return pink * 0.11;
  };
}

/**
 * Build a WIND-GUST bed: an array of length n carrying occasional fat
 * low-frequency rumble bursts. Each gust is a raised-cosine envelope
 * (smooth attack+decay, no click) over low-passed white noise. Gusts are
 * scheduled at ~`gustHz` per second with ±40% jitter; durations 0.6–1.5 s.
 * Deterministic given `rnd`. Returns a Float64Array (full-scale fractions).
 */
function makeWindBed(n, sampleRate, rnd, { windLevel, windGustHz, windLpHz }) {
  const bed = new Float64Array(n);
  if (!(windLevel > 0) || !(windGustHz > 0)) return bed;
  const meanGapS = 1 / windGustHz;
  let tS = meanGapS * (0.3 + 0.7 * rnd());          // first gust offset
  while (tS < n / sampleRate) {
    const durS = 0.6 + 0.9 * rnd();                  // 0.6–1.5 s
    const amp = windLevel * (0.6 + 0.4 * rnd());     // gust-to-gust variation
    const start = Math.floor(tS * sampleRate);
    const len = Math.floor(durS * sampleRate);
    for (let i = 0; i < len && start + i < n; i++) {
      // raised cosine 0→1→0 over the gust
      const env = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / len);
      bed[start + i] += amp * env * (rnd() * 2 - 1);
    }
    tS += meanGapS * (0.6 + 0.8 * rnd());            // ±40% jittered gap
  }
  // Low-pass the whole bed so it is rumble (sub-windLpHz), not hiss.
  onePoleLowPass(bed, windLpHz, sampleRate);
  return bed;
}

/**
 * Build a NEIGHBOR-BLEED bed: a steady 4-on-the-floor kick + bass at
 * `bleedBpm`, deliberately uncorrelated with our captured track. Each kick
 * is a fast pitch-dropping sine "thump" (bleedKickHz) with an exponential
 * decay; a quieter sustained bass tone fills between hits. `bleedLevel`
 * scales the whole bed. Deterministic (phase only; no PRNG needed, but we
 * accept rnd for a small per-run phase offset so it is not lock-stepped).
 */
function makeBleedBed(n, sampleRate, rnd, { bleedLevel, bleedBpm, bleedKickHz }) {
  const bed = new Float64Array(n);
  if (!(bleedLevel > 0) || !(bleedBpm > 0)) return bed;
  const beatS = 60 / bleedBpm;
  const phase0 = rnd() * beatS;                       // where the neighbor "is"
  const bassHz = bleedKickHz / 2;                     // a low bass under the kick
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const tb = ((t + phase0) % beatS);                // time since last kick
    // Kick: pitch sweeps from 2× down to 1× over the first 60 ms, fast decay.
    const kEnv = Math.exp(-tb / 0.09);
    const kHz = bleedKickHz * (1 + Math.exp(-tb / 0.02));
    const kick = kEnv * Math.sin(2 * Math.PI * kHz * tb);
    // Sustained bass under it (quieter, steady).
    const bass = 0.35 * Math.sin(2 * Math.PI * bassHz * t);
    bed[i] = bleedLevel * (0.8 * kick + bass);
  }
  return bed;
}

function makeSpeechBed(n, sampleRate, rnd, { speechLevel = 0 }) {
  const bed = new Float64Array(n);
  if (!(speechLevel > 0)) return bed;
  let nextStart = Math.floor((0.5 + rnd()) * sampleRate);
  while (nextStart < n) {
    const duration = Math.floor((0.7 + 1.1 * rnd()) * sampleRate);
    const f0 = 105 + 95 * rnd();
    for (let i = 0; i < duration && nextStart + i < n; i++) {
      const phase = i / sampleRate;
      const syllable = 0.35 + 0.65 * Math.max(0, Math.sin(2 * Math.PI * (3.2 + rnd() * 0.01) * phase));
      const edge = Math.sin(Math.PI * i / duration) ** 2;
      bed[nextStart + i] += speechLevel * edge * syllable * (
        0.65 * Math.sin(2 * Math.PI * f0 * phase) +
        0.25 * Math.sin(2 * Math.PI * f0 * 2 * phase) +
        0.10 * Math.sin(2 * Math.PI * f0 * 3 * phase)
      );
    }
    nextStart += Math.floor((2.0 + 3.0 * rnd()) * sampleRate);
  }
  return bed;
}

/** One-pole high-pass (DC/low cut). corner in Hz; sampleRate in Hz. */
function onePoleHighPass(buf, cornerHz, sampleRate) {
  if (cornerHz <= 0) return;
  const rc = 1 / (2 * Math.PI * cornerHz);
  const dt = 1 / sampleRate;
  const a = rc / (rc + dt);
  let prevIn = buf[0];
  let prevOut = 0;
  for (let i = 0; i < buf.length; i++) {
    const x = buf[i];
    const y = a * (prevOut + x - prevIn);
    buf[i] = y;
    prevIn = x;
    prevOut = y;
  }
}

/** One-pole low-pass (air/HF roll-off). corner in Hz. */
function onePoleLowPass(buf, cornerHz, sampleRate) {
  if (cornerHz <= 0 || cornerHz >= sampleRate / 2) return;
  const rc = 1 / (2 * Math.PI * cornerHz);
  const dt = 1 / sampleRate;
  const a = dt / (rc + dt);
  let prevOut = buf[0];
  for (let i = 0; i < buf.length; i++) {
    prevOut = prevOut + a * (buf[i] - prevOut);
    buf[i] = prevOut;
  }
}

/**
 * Degrade a clean Int16 mono clip through the virtual playa mic.
 *
 * @param {Int16Array} samples — clean mono PCM in [-32768, 32767].
 * @param {number} sampleRate — Hz (e.g. 44100).
 * @param {object} opts
 * @param {keyof typeof MIC_TIERS} [opts.tier='moderate'] — base tier.
 * @param {number} [opts.seed=0xC0FFEE] — PRNG seed (determinism).
 * @param {object} [opts.overrides] — per-field overrides merged over tier.
 * @returns {{ samples: Int16Array, sampleRate: number, meta: object }}
 *   meta carries the realized levels (signalRms, noiseRms, measuredSnrDb,
 *   tier, spec) so the harness can report what the mic actually did.
 */
export function applyMicModel(samples, sampleRate, opts = {}) {
  if (!(samples instanceof Int16Array)) {
    throw new TypeError('applyMicModel: samples must be an Int16Array');
  }
  if (!Number.isInteger(sampleRate) || sampleRate <= 0) {
    throw new RangeError(`applyMicModel: sampleRate must be a positive integer (got ${sampleRate})`);
  }
  const tierName = opts.tier || 'moderate';
  const base = MIC_TIERS[tierName];
  if (!base) {
    throw new RangeError(`applyMicModel: unknown tier '${tierName}' (have: ${Object.keys(MIC_TIERS).join(', ')})`);
  }
  const spec = { ...base, ...(opts.overrides || {}) };
  for (const key of ['roomNoise', 'selfNoise', 'humLevel', 'humHz', 'drive', 'hpHz', 'lpHz']) {
    if (!Number.isFinite(spec[key]) || spec[key] < 0) {
      throw new RangeError(`applyMicModel: ${key} must be finite and >= 0`);
    }
  }
  const seed = Number.isInteger(opts.seed) ? opts.seed : 0xC0FFEE;
  const rnd = mulberry32(seed);

  const n = samples.length;
  // → float
  const sig = new Float64Array(n);
  const inputGain = spec.inputGain ?? 1;
  if (!Number.isFinite(inputGain) || inputGain <= 0) {
    throw new RangeError('applyMicModel: inputGain must be finite and > 0');
  }
  for (let i = 0; i < n; i++) sig[i] = samples[i] / I16_MAX * inputGain;

  // 1) band-limit (speaker + air + distance + capsule).
  onePoleHighPass(sig, spec.hpHz, sampleRate);
  onePoleLowPass(sig, spec.lpHz, sampleRate);

  const echoMs = spec.roomEchoMs ?? 0;
  const echoGain = spec.roomEchoGain ?? 0;
  if (!Number.isFinite(echoMs) || echoMs < 0 || !Number.isFinite(echoGain) || echoGain < 0 || echoGain >= 1) {
    throw new RangeError('applyMicModel: room echo must have ms >= 0 and gain in [0,1)');
  }
  const echoSamples = Math.round(echoMs * sampleRate / 1000);
  if (echoSamples > 0 && echoGain > 0) {
    for (let i = echoSamples; i < n; i++) sig[i] += echoGain * sig[i - echoSamples];
  }

  // 2) capsule soft saturation. tanh(drive·x)/tanh(drive) keeps unity
  //    peak while compressing loud passages; drive=1 ≈ linear.
  if (spec.drive > 1.0) {
    const norm = Math.tanh(spec.drive);
    for (let i = 0; i < n; i++) sig[i] = Math.tanh(spec.drive * sig[i]) / norm;
  }

  // 3) SNR balance. Build the noise bed first (room pink + self white +
  //    hum), measure its RMS and the signal RMS, then scale the SIGNAL so
  //    the post-mix SNR hits the tier target. (We attenuate the signal
  //    rather than amplify noise so we never clip the bed.)
  const pink = makePinkGen(rnd);
  const noise = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    noise[i] = pink() * spec.roomNoise + (rnd() * 2 - 1) * spec.selfNoise;
  }
  if (spec.humLevel > 0) {
    const w = 2 * Math.PI * spec.humHz;
    for (let i = 0; i < n; i++) {
      const t = i / sampleRate;
      noise[i] += spec.humLevel * (Math.sin(w * t) + 0.3 * Math.sin(2 * w * t));
    }
  }

  const noiseRms = rms(noise);
  let sigGain = 1.0;
  if (spec.snrDb !== null && spec.snrDb !== undefined) {
    const sigRms = rms(sig);
    if (sigRms > 1e-9 && noiseRms > 1e-12) {
      const targetSigRms = noiseRms * Math.pow(10, spec.snrDb / 20);
      sigGain = targetSigRms / sigRms;
    }
  }

  // 3b) post-SNR contaminants (steps 7–8): wind gusts + neighbor bleed. These
  //     are ABSOLUTE additions on top of the SNR-balanced signal+noise — they
  //     deliberately do NOT participate in the SNR target (a gust should be
  //     able to swamp the low band regardless of how loud our music is).
  const wind  = makeWindBed(n, sampleRate, rnd, spec);
  const bleed = makeBleedBed(n, sampleRate, rnd, spec);
  const speech = makeSpeechBed(n, sampleRate, rnd, spec);
  const hardClip = spec.hardClip ?? 1;
  if (!Number.isFinite(hardClip) || hardClip <= 0 || hardClip > 1) {
    throw new RangeError('applyMicModel: hardClip must be in (0,1]');
  }

  // 4) mix + re-quantize (hard clamp at full scale — a real ADC clips).
  const out = new Int16Array(n);
  let sumSigSq = 0;
  let sumMixSq = 0;
  for (let i = 0; i < n; i++) {
    const s = sig[i] * sigGain;
    sumSigSq += s * s;
    const mix = Math.max(-hardClip, Math.min(hardClip, s + noise[i] + wind[i] + bleed[i] + speech[i]));
    sumMixSq += mix * mix;
    let q = Math.round(mix * I16_MAX);
    if (q > I16_MAX) q = I16_MAX; else if (q < -I16_MAX) q = -I16_MAX;
    out[i] = q;
  }

  const realizedSigRms = Math.sqrt(sumSigSq / Math.max(1, n));
  const measuredSnrDb = noiseRms > 1e-12
    ? 20 * Math.log10(Math.max(1e-12, realizedSigRms) / noiseRms)
    : Infinity;

  return {
    samples: out,
    sampleRate,
    meta: {
      tier: tierName,
      spec,
      seed,
      signalRms: realizedSigRms,
      noiseRms,
      mixRms: Math.sqrt(sumMixSq / Math.max(1, n)),
      measuredSnrDb,
    },
  };
}

/** Convenience: degrade a {samples, sampleRate} clip, returning the same shape. */
export function degradeClip(clip, opts = {}) {
  const { samples, sampleRate, meta } = applyMicModel(clip.samples, clip.sampleRate, opts);
  return { ...clip, samples, sampleRate, micMeta: meta };
}
