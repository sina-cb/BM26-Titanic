/**
 * signal_metrics.mjs — objective "feel" metrics for a post-chain signal
 * series, so chain tuning (DEFAULT_CHAINS) is measured, not eyeballed.
 *
 * The operator intent for the pattern-facing signals is:
 *   - low / mid / high  → SMOOTH, dance-like (low flicker, but still a
 *     deep beat-locked PULSE — smooth is not the same as flat).
 *   - kick              → SUDDEN (sharp attack, short decay, no smear).
 *
 * These metrics make those qualities numeric so a before/after tuning
 * comparison is defensible:
 *   - flickerRate : direction reversals per second. Jittery signals wiggle
 *                   constantly; smooth ones don't. LOWER = smoother.
 *   - meanAbsDelta: mean |Δ| per hop — micro-jerkiness. LOWER = smoother.
 *   - variance    : overall spread.
 *   - pulseDepth  : p95 − p05 — how much the signal actually pumps. We want
 *                   this PRESERVED while flicker drops (danceable, not flat).
 *   - attackTime  : for transient signals (kick) — median 10%→90% rise time
 *                   of onset events (ms). LOWER = more sudden.
 *   - decayTime   : median 90%→10% fall time after a peak (ms). For the
 *                   kick we want this SHORT (no long release smear).
 *
 * Pure functions over a numeric array + hop interval. No I/O, no deps.
 */

function mean(a) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return a.length ? s / a.length : 0; }

function variance(a) {
  if (a.length < 2) return 0;
  const m = mean(a);
  let s = 0; for (let i = 0; i < a.length; i++) { const d = a[i] - m; s += d * d; }
  return s / (a.length - 1);
}

function percentile(a, q) {
  if (!a.length) return 0;
  const s = Array.from(a).sort((x, y) => x - y);
  const idx = Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))));
  return s[idx];
}

/**
 * Direction reversals per second. A reversal is a sign change in the first
 * difference larger than `eps` (ignores flat micro-noise). Smooth signals
 * have few; flickery signals have many.
 */
function flickerRate(a, hopMs, eps = 1e-4) {
  if (a.length < 3) return 0;
  let prevDir = 0, reversals = 0;
  for (let i = 1; i < a.length; i++) {
    const d = a[i] - a[i - 1];
    if (Math.abs(d) < eps) continue;
    const dir = d > 0 ? 1 : -1;
    if (prevDir !== 0 && dir !== prevDir) reversals++;
    prevDir = dir;
  }
  const durSec = (a.length * hopMs) / 1000;
  return durSec > 0 ? reversals / durSec : 0;
}

function meanAbsDelta(a) {
  if (a.length < 2) return 0;
  let s = 0; for (let i = 1; i < a.length; i++) s += Math.abs(a[i] - a[i - 1]);
  return s / (a.length - 1);
}

/**
 * Onset attack/decay timing for a transient signal. Finds peaks (local
 * maxima above `peakMin` that rise from below `peakMin·0.5`), then for each
 * measures the 10%→90% rise time before the peak and 90%→10% fall after.
 * Returns medians in ms (null if no clean onsets found).
 */
function transientTiming(a, hopMs, { peakMin = 0.15 } = {}) {
  const rises = [], falls = [];
  const lo = peakMin * 0.1, hi = peakMin * 0.9;
  let i = 1;
  while (i < a.length - 1) {
    // local maximum above threshold
    if (a[i] >= peakMin && a[i] >= a[i - 1] && a[i] > a[i + 1]) {
      const peak = a[i];
      const t10 = peak * 0.1, t90 = peak * 0.9;
      // rise: walk back to last crossing of 10% then to 90%
      let j = i; while (j > 0 && a[j] > t90) j--; const f90 = j;
      while (j > 0 && a[j] > t10) j--; const f10 = j;
      if (f90 > f10) rises.push((f90 - f10) * hopMs);
      // fall: walk forward from peak to 90% then 10%
      let k = i; while (k < a.length - 1 && a[k] > t90) k++; const d90 = k;
      while (k < a.length - 1 && a[k] > t10) k++; const d10 = k;
      if (d10 > d90) falls.push((d10 - d90) * hopMs);
      // skip past this peak's decay to avoid double-counting
      i = Math.max(i + 1, d10);
    } else i++;
    void lo; void hi;
  }
  const median = (arr) => arr.length ? arr.slice().sort((x, y) => x - y)[arr.length >> 1] : null;
  return { riseMs: median(rises), fallMs: median(falls), onsets: rises.length };
}

/** Full feel report for one signal series. */
export function signalFeel(series, hopMs, { transient = false, peakMin = 0.15 } = {}) {
  const a = Array.isArray(series) ? series : Array.from(series);
  const out = {
    n: a.length,
    flickerHz: flickerRate(a, hopMs),
    meanAbsDelta: meanAbsDelta(a),
    variance: variance(a),
    pulseDepth: percentile(a, 0.95) - percentile(a, 0.05),
    mean: mean(a),
    max: a.length ? Math.max(...a) : 0,
  };
  if (transient) {
    const t = transientTiming(a, hopMs, { peakMin });
    out.attackMs = t.riseMs;
    out.decayMs = t.fallMs;
    out.onsets = t.onsets;
  }
  return out;
}

export { flickerRate, meanAbsDelta, variance, percentile, transientTiming };
