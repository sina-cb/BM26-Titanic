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
  const seed = Number.isInteger(opts.seed) ? opts.seed : 0xC0FFEE;
  const rnd = mulberry32(seed);

  const n = samples.length;
  // → float
  const sig = new Float64Array(n);
  for (let i = 0; i < n; i++) sig[i] = samples[i] / I16_MAX;

  // 1) band-limit (speaker + air + distance + capsule).
  onePoleHighPass(sig, spec.hpHz, sampleRate);
  onePoleLowPass(sig, spec.lpHz, sampleRate);

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

  // 4) mix + re-quantize (hard clamp at full scale — a real ADC clips).
  const out = new Int16Array(n);
  let sumSigSq = 0;
  let sumMixSq = 0;
  for (let i = 0; i < n; i++) {
    const s = sig[i] * sigGain;
    sumSigSq += s * s;
    const mix = s + noise[i];
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
