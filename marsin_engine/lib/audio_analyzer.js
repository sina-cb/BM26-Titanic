/**
 * AudioAnalyzer — FFT, band energy + kick detection.
 *
 * Reads Int16 PCM frames via `pushSamples(int16)` and emits per-hop
 * analysis results to `onAnalysis({ low, mid, high, kick })`.
 *
 * Design: docs/25_marsin_audio_analysis.md §4. Summary:
 *
 *   - Ring buffer of `fftSize` float32 samples. Each call to
 *     pushSamples() walks an internal cursor; once we have enough
 *     samples since the last analysis to advance by `hopSize`, we
 *     run an FFT and emit one analysis result.
 *   - Hann window pre-baked at construction.
 *   - Bands defined as `[loHz, hiHz]` ranges, converted to bin
 *     indices at construction / reconfigure. Per-band sum-of-magnitudes.
 *   - Soft compression `x / (1 + x)` plus a pre-clamp gain so quiet
 *     rooms still produce visible movement. The per-band operator
 *     gain (`mic*Gain` CPC params) is applied HERE, in the analyzer,
 *     immediately before the post-envelope band value is written to
 *     CPC. This makes the CPC band value the single authoritative
 *     read for every downstream consumer (patterns, modulation
 *     controller, CaptainPad meters, OSC echo) — one truth. The
 *     gained value is clamped to [0, 1] so the live-key contract
 *     (normalized) is preserved even when an operator pushes the
 *     gain above 1×.
 *
 *     Architectural rationale (2026-05-26 — operator brief
 *     "live signals must show data after gain"): before this change
 *     gain was multiplied client-side in CaptainPad's <BandMeter>
 *     for display only — the raw value was still on the wire, so
 *     patterns / modulation / OSC saw the un-gained value while the
 *     operator's meter showed something else. That's a fiction the
 *     UI is selling. Gain at the SOURCE means the knob actually
 *     moves what the rig responds to, and the meter shows what the
 *     rig sees.
 *   - Per-band asymmetric attack/release envelope (VU-meter
 *     convention): fast attack so peaks register, slow release so
 *     visuals don't flicker. Configurable via `bands.attackMs` /
 *     `bands.releaseMs`. Shared across all three bands — one
 *     envelope primitive parameterized once, per .agent/00_gol/00
 *     "smallest patch that works".
 *   - Per-band noise gate (`bands.noiseGate`): post-compression
 *     floor, below which the band reads as 0. Compensates for
 *     ambient HVAC / clip-noise so quiet rooms stay quiet on the
 *     meters. Values above the gate are rescaled to span the
 *     full [0, 1] range (`(v - gate) / (1 - gate)`).
 *   - Kick detector: instantaneous magnitude in a configurable
 *     narrow band; fires when `instant > ema * threshold` outside
 *     the refractory period. On fire we start an envelope that
 *     decays over `decayMs` and feeds `micKick`.
 *   - `reconfigure({...})` lets the operator retune at runtime from
 *     CaptainPad without restarting the analyzer.
 *
 * EDM-tuned defaults (config.yaml, 2026-05-25 retune):
 *   - bands: low ≤ 200 Hz, mid ≤ 4000 Hz. Splits sub/bass (≤200 Hz)
 *     from synth/vocal mids (200 Hz–4 kHz), with hats / air going
 *     to HIGH. Bob Katz, "Mastering Audio" (3rd ed., 2014, ch. 11)
 *     treats 50–100 Hz as kick-fundamental territory and 200 Hz
 *     as the low/low-mid hinge — picking 200 Hz keeps the kick
 *     and the sub-bass synth pulse together in LOW.
 *   - kick window 50–110 Hz: tightens around the EDM kick
 *     fundamental (50–80 Hz) plus the click transient (90–110 Hz);
 *     excludes the bass synth body (120 Hz+) which used to leak
 *     false positives into the detector on basslines.
 *   - attack 8 ms / release 180 ms: VU-meter convention; ~1/3 of a
 *     quarter note at 120 BPM gives the release a musical anchor.
 *   - noise gate 0.04: empirical floor for room HVAC + mic self-noise.
 */

import FFT from 'fft.js';

// Maps the FFT magnitude scale (post sum-of-magnitudes / fftSize, where
// a single tone at amplitude A lands around A/2) into something useful
// for visual reactivity once soft-compressed: gain*input ≈ 1 → softCompress
// → 0.5. With this default a moderate tone at ~0.4 amplitude already
// produces a ~0.5 band value, which is what an operator expects to
// see on the meter.
const PRE_CLAMP_GAIN = 8.0;

function softCompress(x) {
  // Maps [0, +∞) → [0, 1). Identity-ish near zero, asymptotes at 1.
  return x / (1 + x);
}

function clamp01(x) {
  if (!(x > 0)) return 0;
  return x < 1 ? x : 1;
}

/** Build a real Hann window of `n` samples. */
function hannWindow(n) {
  const w = new Float32Array(n);
  if (n <= 1) { w[0] = 1; return w; }
  for (let i = 0; i < n; i++) {
    w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
  }
  return w;
}

function hzToBin(hz, sampleRate, fftSize) {
  // Bin k corresponds to frequency k * sampleRate / fftSize.
  return Math.round((hz * fftSize) / sampleRate);
}

export class AudioAnalyzer {
  /**
   * @param {object} opts
   * @param {number} opts.sampleRate
   * @param {number} opts.fftSize       — must be power of two for fft.js
   * @param {number} [opts.hopSize]     — defaults to fftSize/2
   * @param {object} opts.bands         — { lowMaxHz, midMaxHz, attackMs, releaseMs, noiseGate }
   * @param {object} opts.kick          — { minHz, maxHz, threshold, refractoryMs, decayMs }
   * @param {(r: {low, mid, high, kick}) => void} opts.onAnalysis
   * @param {object} [opts.paramCenter] — CPC instance; required when `gainKeys` is set. Used to read per-band gains every hop.
   * @param {{low:string, mid:string, high:string, kick:string}} [opts.gainKeys]
   *        — CPC keys for the per-band operator gains. When set, the
   *          analyzer multiplies each post-envelope band value by the
   *          current gain and clamps to [0, 1] before emitting. When
   *          omitted (e.g. unit tests that don't care about gain) the
   *          analyzer behaves as before — raw post-envelope values.
   *          Codex P0: if `gainKeys` is set, every listed key must
   *          resolve via `paramCenter.get(key)` at construction or
   *          construction throws — no silent zero-gain fallbacks.
   * @param {() => number} [opts.nowFn] — DI hook for tests (default: Date.now)
   */
  constructor(opts) {
    if (!opts || typeof opts !== 'object') {
      throw new TypeError('AudioAnalyzer requires options');
    }
    if (typeof opts.onAnalysis !== 'function') {
      throw new TypeError('AudioAnalyzer requires onAnalysis callback');
    }
    const fftSize = opts.fftSize | 0;
    if (fftSize <= 0 || (fftSize & (fftSize - 1)) !== 0) {
      throw new RangeError('fftSize must be a positive power of two');
    }

    this.sampleRate  = opts.sampleRate || 44100;
    this.fftSize     = fftSize;
    this.hopSize     = (opts.hopSize | 0) || (fftSize >> 1);
    this._onAnalysis = opts.onAnalysis;
    this._nowFn      = opts.nowFn || (() => Date.now());

    // Per-band gain hookup. Either both `paramCenter` AND `gainKeys`
    // are present (production / gain-aware tests) or both absent
    // (analyzer-only unit tests for FFT correctness). Half-configured
    // is a programmer error — fail loud at construction.
    if (opts.gainKeys || opts.paramCenter) {
      if (!opts.gainKeys || typeof opts.gainKeys !== 'object') {
        throw new TypeError('AudioAnalyzer: gainKeys required when paramCenter is provided');
      }
      if (!opts.paramCenter || typeof opts.paramCenter.get !== 'function') {
        throw new TypeError('AudioAnalyzer: paramCenter with .get(key) required when gainKeys is provided');
      }
      const required = ['low', 'mid', 'high', 'kick'];
      for (const band of required) {
        const key = opts.gainKeys[band];
        if (typeof key !== 'string' || key.length === 0) {
          throw new TypeError(`AudioAnalyzer: gainKeys.${band} must be a non-empty CPC key`);
        }
        // Probe — paramCenter.get throws on unknown keys (Codex P0).
        // This converts a future "phantom gain key" bug at runtime
        // into a boot-time crash.
        const probe = opts.paramCenter.get(key);
        if (typeof probe !== 'number') {
          throw new TypeError(
            `AudioAnalyzer: paramCenter.get(${key}) returned ${typeof probe}; expected number`,
          );
        }
      }
      this._paramCenter = opts.paramCenter;
      this._gainKeys = {
        low:  opts.gainKeys.low,
        mid:  opts.gainKeys.mid,
        high: opts.gainKeys.high,
        kick: opts.gainKeys.kick,
      };
    } else {
      this._paramCenter = null;
      this._gainKeys = null;
    }

    this._fft = new FFT(fftSize);
    this._window = hannWindow(fftSize);

    // Time-domain ring buffer; head wraps; we keep the most recent
    // fftSize samples at all times so each analysis is windowed.
    this._ring = new Float32Array(fftSize);
    this._ringHead = 0;
    this._samplesSinceHop = 0;
    this._totalSamples = 0;

    // Pre-allocated workspace for the FFT (real input → complex output
    // as a flat [re0, im0, re1, im1, ...] array of length 2 * fftSize).
    this._inputRe = new Float64Array(fftSize);
    this._output  = this._fft.createComplexArray();

    // Per-band smoothing state.
    this._smoothed = { low: 0, mid: 0, high: 0 };

    // Kick state. EMA is "what does the kick band typically look
    // like right now"; we compare the instant read against it. To
    // avoid a phantom kick at boot before EMA has settled, we seed
    // it from the first 50 hops' running mean.
    //
    // Asymmetric attack/release + slow-trailing ceiling clamp
    // (hot-fix per .agent/02_reports/202605/20260526_1_audio_analysis_report.md
    // Concern 5, "BLOCKER for the playa"):
    //
    //   Symptom — under sustained loud kick-band content (e.g. a
    //   continuous loud bassline for 30+ s) the original symmetric
    //   EMA tracks the loud baseline UP toward instant level. The
    //   fire test `instant > ema * threshold` requires an extra
    //   1.5–1.8× HEADROOM above whatever the EMA has settled at,
    //   so once EMA == loud baseline a normal kick transient can't
    //   clear it and the detector stops firing.
    //
    //   Fix #1 (asymmetric one-pole IIR) — the EMA tracks the
    //   sustained baseline slowly upward (so it lags behind a loud
    //   bassline and leaves headroom for transients to fire) but
    //   releases faster downward (so it recovers when the bass
    //   drops). This is the OPPOSITE of an audio-meter envelope
    //   (which goes fast-attack/slow-release for visual smoothness);
    //   for a detection THRESHOLD we want the reference to stay LOW
    //   relative to peaks. Standard envelope-follower / "leaky
    //   integrator above peak floor" trick from kick-detection
    //   literature (cf. Zölzer "DAFX" 2nd ed. §4.3 on adaptive
    //   thresholds for onset detection).
    //
    //   Fix #2 (ceiling clamp, belt-and-suspenders) — a second EMA
    //   (`_kickEmaTrail`) with very slow tracking is a coarse-time
    //   baseline. `_kickEma` is clamped to ≤ trail × CEILING_RATIO
    //   so even pathological sustained loudness can't push the
    //   operating threshold more than 1.5× above its several-second
    //   average. Bounds drift regardless of which way the input
    //   pathology pushes.
    this._kickEma = 0;
    this._kickEmaAlphaUp   = 0.005;  // slow attack — don't chase loud bass
    this._kickEmaAlphaDown = 0.05;   // faster release — recover quickly
    this._kickEmaTrail = 0;          // slow-trailing reference for ceiling clamp
    this._kickEmaTrailAlpha = 0.0005;
    this._kickEmaCeilingRatio = 1.5; // EMA may not exceed trail × this
    this._kickEmaWarmedUp = false;
    this._kickEmaWarmupSum = 0;
    this._kickEmaWarmupHops = 0;
    this._kickValue = 0;
    this._lastKickAt = -Infinity;

    this.reconfigure({ bands: opts.bands, kick: opts.kick });
  }

  /**
   * Partially update tunable params at runtime. Anything you omit is
   * left at its current value. Throws on invalid combinations.
   *
   * @param {object} updates
   * @param {object} [updates.bands]
   * @param {object} [updates.kick]
   */
  reconfigure(updates = {}) {
    const next = {
      bands: { ...(this.bands || {}), ...(updates.bands || {}) },
      kick:  { ...(this.kick  || {}), ...(updates.kick  || {}) },
    };
    const nyquist = this.sampleRate / 2;
    const lowMaxHz = +next.bands.lowMaxHz;
    const midMaxHz = +next.bands.midMaxHz;
    const attackMs  = +next.bands.attackMs;
    const releaseMs = +next.bands.releaseMs;
    const noiseGate = +next.bands.noiseGate;
    if (!(lowMaxHz > 20 && lowMaxHz < midMaxHz && midMaxHz <= nyquist)) {
      throw new RangeError(
        `bands invalid: require 20 < lowMaxHz (${lowMaxHz}) < midMaxHz (${midMaxHz}) <= nyquist (${nyquist})`,
      );
    }
    // No fallback behaviors (codex P0): the merged config must carry
    // attackMs/releaseMs/noiseGate explicitly. config.yaml seeds them
    // at boot, so this only fires when someone PATCHes a malformed
    // bands payload or starts the analyzer without going through the
    // engine boot path.
    if (!(attackMs > 0 && attackMs <= 5000)) {
      throw new RangeError(`bands.attackMs must be in (0, 5000] ms; got ${attackMs}`);
    }
    if (!(releaseMs > 0 && releaseMs <= 5000)) {
      throw new RangeError(`bands.releaseMs must be in (0, 5000] ms; got ${releaseMs}`);
    }
    if (!(noiseGate >= 0 && noiseGate < 1)) {
      throw new RangeError(`bands.noiseGate must be in [0, 1); got ${noiseGate}`);
    }

    const kMin = +next.kick.minHz, kMax = +next.kick.maxHz;
    if (!(kMin > 0 && kMin < kMax && kMax <= nyquist)) {
      throw new RangeError(
        `kick band invalid: require 0 < minHz (${kMin}) < maxHz (${kMax}) <= nyquist (${nyquist})`,
      );
    }
    if (!(next.kick.threshold > 1)) {
      throw new RangeError(`kick.threshold must be > 1; got ${next.kick.threshold}`);
    }
    if (!(next.kick.refractoryMs >= 0)) {
      throw new RangeError(`kick.refractoryMs must be >= 0`);
    }
    if (!(next.kick.decayMs > 0)) {
      throw new RangeError(`kick.decayMs must be > 0`);
    }

    this.bands = next.bands;
    this.kick  = next.kick;

    // Pre-compute bin ranges so the hot path doesn't multiply.
    this._binLow  = [hzToBin(20,         this.sampleRate, this.fftSize), hzToBin(lowMaxHz, this.sampleRate, this.fftSize)];
    this._binMid  = [hzToBin(lowMaxHz,   this.sampleRate, this.fftSize), hzToBin(midMaxHz, this.sampleRate, this.fftSize)];
    this._binHigh = [hzToBin(midMaxHz,   this.sampleRate, this.fftSize), Math.floor(this.fftSize / 2)];
    this._binKick = [hzToBin(kMin,       this.sampleRate, this.fftSize), hzToBin(kMax,     this.sampleRate, this.fftSize)];
  }

  /** Push a chunk of Int16 mono samples; emits analyses as hops fill. */
  pushSamples(int16) {
    const n = int16.length;
    for (let i = 0; i < n; i++) {
      // Int16 → Float32 in [-1, 1).
      this._ring[this._ringHead] = int16[i] / 32768;
      this._ringHead = (this._ringHead + 1) % this.fftSize;
    }
    this._samplesSinceHop += n;
    this._totalSamples    += n;

    // After we've ingested at least one fftSize of samples total, we
    // can emit analyses every hopSize from then on. Before that the
    // ring still has zeros in the unfilled positions.
    while (this._samplesSinceHop >= this.hopSize) {
      this._samplesSinceHop -= this.hopSize;
      this._analyzeOnce();
    }
  }

  /** Reset all internal state (smoothing, kick envelope, ring buffer). */
  reset() {
    this._ring.fill(0);
    this._ringHead = 0;
    this._samplesSinceHop = 0;
    this._totalSamples = 0;
    this._smoothed.low = this._smoothed.mid = this._smoothed.high = 0;
    this._kickEma = 0;
    this._kickEmaTrail = 0;
    this._kickEmaWarmedUp = false;
    this._kickEmaWarmupSum = 0;
    this._kickEmaWarmupHops = 0;
    this._kickValue = 0;
    this._lastKickAt = -Infinity;
  }

  // ── Internal ────────────────────────────────────────────────────────────

  _analyzeOnce() {
    // Linearize the ring into _inputRe in causal order (oldest first),
    // applying the Hann window.
    const N = this.fftSize;
    const win = this._window;
    const ring = this._ring;
    const head = this._ringHead;
    for (let i = 0; i < N; i++) {
      // Sample at position (head + i) mod N is the (i+1)th-oldest sample.
      const v = ring[(head + i) % N];
      this._inputRe[i] = v * win[i];
    }
    this._fft.realTransform(this._output, this._inputRe);
    // (We don't call completeSpectrum — the left half has everything
    // we need for energy in the positive-frequency bins.)

    const out = this._output;
    const lowE  = this._bandEnergy(out, this._binLow);
    const midE  = this._bandEnergy(out, this._binMid);
    const highE = this._bandEnergy(out, this._binHigh);
    const kickE = this._bandEnergy(out, this._binKick);

    // Per-band soft-compression + noise gate + asymmetric envelope.
    //
    // The envelope picks `attackMs` when the new sample is louder
    // than the previous smoothed value, `releaseMs` otherwise. This
    // gives the classic VU/level-meter feel — snap up on peaks,
    // smooth fall on releases — without flickering. Same primitive
    // shared across all three bands (single helper, three calls)
    // per .agent/00_gol/00 "smallest patch that works".
    //
    // The noise gate is applied to the post-compression value (in
    // [0, 1)), not the raw FFT energy: it's a perceptual floor for
    // "how visible is this band". Values above the gate are
    // rescaled so the operator's [0, 1] meter still uses the full
    // range above the gate (otherwise raising the gate would just
    // dim the whole band).
    const frameMs = (this.hopSize * 1000) / this.sampleRate;
    const gate = this.bands.noiseGate;
    const gateScale = 1 - gate;
    const applyGate = (v) => (v <= gate ? 0 : (v - gate) / gateScale);
    const lowTarget  = applyGate(softCompress(PRE_CLAMP_GAIN * lowE));
    const midTarget  = applyGate(softCompress(PRE_CLAMP_GAIN * midE));
    const highTarget = applyGate(softCompress(PRE_CLAMP_GAIN * highE));
    const attackAlpha  = 1 - Math.exp(-frameMs / this.bands.attackMs);
    const releaseAlpha = 1 - Math.exp(-frameMs / this.bands.releaseMs);
    const env = (prev, target) => {
      const a = target > prev ? attackAlpha : releaseAlpha;
      return a * target + (1 - a) * prev;
    };
    const low  = (this._smoothed.low  = env(this._smoothed.low,  lowTarget));
    const mid  = (this._smoothed.mid  = env(this._smoothed.mid,  midTarget));
    const high = (this._smoothed.high = env(this._smoothed.high, highTarget));

    // Kick: instant vs slow EMA. The first KICK_WARMUP_HOPS hops are
    // used to seed the EMA so a single loud first frame doesn't fire
    // a phantom kick before we have any context for "normal".
    //
    // Asymmetric attack/release prevents the reference from drifting
    // up under sustained loud bass (see constructor comment for the
    // diagnosis + citation). Slow attack so the EMA lags loud
    // baselines; faster release so it recovers quickly. The trailing
    // EMA + ceiling clamp is a second line of defense: even if the
    // asymmetric coefficients get retuned, the threshold can never
    // sit more than CEILING_RATIO × a several-second baseline.
    const instant = kickE;
    if (this._kickEmaWarmedUp) {
      const alpha = instant > this._kickEma
        ? this._kickEmaAlphaUp     // slow attack — lag loud baselines
        : this._kickEmaAlphaDown;  // faster release — recover in quiet
      this._kickEma = alpha * instant + (1 - alpha) * this._kickEma;
      // Slow-trailing reference — always uses the slow alpha so a
      // brief loud section can't lift the ceiling significantly.
      this._kickEmaTrail = this._kickEmaTrailAlpha * instant
                         + (1 - this._kickEmaTrailAlpha) * this._kickEmaTrail;
      // Ceiling clamp: the operating EMA may not exceed the
      // slow-trailing reference times the ceiling ratio. Belt-and-
      // suspenders against pathological sustained loudness.
      const ceiling = this._kickEmaTrail * this._kickEmaCeilingRatio;
      if (this._kickEma > ceiling) this._kickEma = ceiling;
    } else {
      // Seed EMA with the running mean of the first warmup hops.
      this._kickEmaWarmupSum += instant;
      this._kickEmaWarmupHops++;
      if (this._kickEmaWarmupHops >= 50) {
        const seed = this._kickEmaWarmupSum / this._kickEmaWarmupHops;
        this._kickEma = seed;
        this._kickEmaTrail = seed;
        this._kickEmaWarmedUp = true;
      }
    }
    const now = this._nowFn();
    const refractoryOk = (now - this._lastKickAt) >= this.kick.refractoryMs;
    const hot = this._kickEmaWarmedUp
             && this._kickEma > 0
             && instant > this._kickEma * this.kick.threshold;
    if (hot && refractoryOk) {
      this._kickValue = 1.0;
      this._lastKickAt = now;
    } else if (this._kickValue > 0) {
      // Exponential envelope. Per-frame decay factor = exp(-dt / tau).
      // We treat one analysis frame as hopSize/sampleRate seconds —
      // `frameMs` was computed above for the band envelope, reuse it.
      const decay = Math.exp(-frameMs / this.kick.decayMs);
      this._kickValue *= decay;
      if (this._kickValue < 1e-3) this._kickValue = 0;
    }

    // Apply per-band operator gain at the source so every downstream
    // consumer sees one consistent value. See the header comment for
    // the architectural rationale. When the analyzer was constructed
    // without paramCenter+gainKeys (test-only path) gains are 1.0 —
    // the raw envelope values flow through unchanged.
    let lowOut  = low;
    let midOut  = mid;
    let highOut = high;
    let kickOut = this._kickValue;
    if (this._gainKeys) {
      // paramCenter.get() throws on unknown keys (Codex P0). We
      // validated all four at construction, so misses here would mean
      // someone unregistered a gain key at runtime — let it throw.
      const gLow  = this._paramCenter.get(this._gainKeys.low);
      const gMid  = this._paramCenter.get(this._gainKeys.mid);
      const gHigh = this._paramCenter.get(this._gainKeys.high);
      const gKick = this._paramCenter.get(this._gainKeys.kick);
      lowOut  *= gLow;
      midOut  *= gMid;
      highOut *= gHigh;
      kickOut *= gKick;
    }

    try {
      this._onAnalysis({
        low:  clamp01(lowOut),
        mid:  clamp01(midOut),
        high: clamp01(highOut),
        kick: clamp01(kickOut),
      });
    } catch (e) {
      console.warn(`[AudioAnalyzer] onAnalysis threw: ${e && e.message}`);
    }
  }

  /**
   * Sum of per-bin magnitudes over [binStart, binEnd), normalized by
   * fftSize so the absolute scale is independent of FFT window length.
   *
   * Why sum-of-magnitudes (not RMS per bin):
   *   - A single tone concentrates energy in 1–2 bins. With per-bin
   *     RMS, a wide band that happens to contain the tone reports
   *     `tone / sqrt(bandWidth)` — wider bands look quieter, which
   *     contradicts what the operator expects from a band meter.
   *   - Sum-of-magnitudes gives "total energy present in the band",
   *     which is monotonic with the loudness of the signal in that
   *     range and feels right on a level meter.
   */
  _bandEnergy(complex, [binStart, binEnd]) {
    if (binEnd <= binStart) return 0;
    let sum = 0;
    for (let k = binStart; k < binEnd; k++) {
      const re = complex[k * 2];
      const im = complex[k * 2 + 1];
      sum += Math.hypot(re, im);
    }
    return sum / this.fftSize;
  }
}
