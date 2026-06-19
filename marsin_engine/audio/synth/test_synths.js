/*
 * audio/synth/test_synths.js — a bank of test SYNTHESIZERS for the Audio
 * Companion's "test" source and the offline pattern audio-reactivity harness.
 *
 * Each synth is a deterministic, dependency-free generator: given an absolute
 * sample index `n`, the sample rate `SR`, and a params object, it returns one
 * float sample in [-1, 1]. Determinism (a pure function of `n`) makes captures
 * reproducible and unit-testable.
 *
 * These feed the engine's REAL DSP (AudioAnalyzer → SignalPostProcessor), so a
 * synth designed to hit the kick band actually drives `micKick`, a bassline
 * drives `micLow`, hats drive `micHigh`, etc. That is what makes them useful
 * for exercising audio-reactive (modulators-only) patterns end to end.
 *
 * Used by:
 *   - audio/companion/companion_server.js  (the selectable 'test' source)
 *   - tools/pattern_audio_harness.mjs      (offline synth → DSP → pattern)
 */

// ── small deterministic helpers ──────────────────────────────────────────────
const TAU = Math.PI * 2;
// Cheap deterministic value-noise in [-1,1] from an integer index (hash-based,
// no global RNG state so captures are reproducible).
function noise(n) {
  let x = (n * 1103515245 + 12345) & 0x7fffffff;
  x = (x ^ (x >> 15)) * 0x2c1b3c6d & 0x7fffffff;
  x = (x ^ (x >> 12)) & 0x7fffffff;
  return (x / 0x3fffffff) - 1.0;
}
// One percussive hit: exp-decaying tone of `hz` starting at the beat, given the
// phase (0..1) within the beat and the beat length in samples.
function hit(phase, beatLen, n, SR, hz, decayFrac) {
  if (phase >= decayFrac) return 0;
  const tSec = (phase * beatLen) / SR;
  const env = Math.exp(-phase / (decayFrac * 0.35));
  return Math.sin(TAU * hz * tSec) * env;
}
// Beat bookkeeping for a BPM.
function beatInfo(n, SR, bpm) {
  const beatLen = (60 / bpm) * SR;            // samples per beat
  const beatIdx = Math.floor(n / beatLen);
  const phase = (n % beatLen) / beatLen;      // 0..1 within the beat
  return { beatLen, beatIdx, phase };
}

// ── the synthesizers ─────────────────────────────────────────────────────────
// Each: { label, description, defaults, sample(n, SR, p) -> float [-1,1] }.
export const SYNTHS = {
  // Legacy compatibility — the original companion test generator. Steady tones
  // in each band plus a periodic kick. Kept so the default 'test' look is
  // unchanged for anyone relying on it.
  tone: {
    label: 'Tones + kick',
    description: 'Steady sub/mid/high tones + periodic kick (the classic test source).',
    defaults: { subLevel: 0.5, midLevel: 0.3, highLevel: 0.25, kickLevel: 0.8, kickHz: 2.0, noiseLevel: 0.02 },
    sample(n, SR, p) {
      const t = n / SR;
      let s = Math.sin(TAU * 55 * t) * (p.subLevel ?? 0.5)
            + Math.sin(TAU * 1000 * t) * (p.midLevel ?? 0.3)
            + Math.sin(TAU * 9000 * t) * (p.highLevel ?? 0.25)
            + noise(n) * (p.noiseLevel ?? 0.02);
      const kHz = p.kickHz ?? 2.0;
      if (kHz > 0) {
        const period = SR / kHz, phase = n % period;
        if (phase < period * 0.12) s += Math.sin(TAU * 80 * t) * (p.kickLevel ?? 0.8) * Math.exp(-phase / (period * 0.03));
      }
      return Math.max(-1, Math.min(1, s));
    },
  },

  // Isolated 4-on-the-floor kick — the cleanest way to exercise micKick.
  kick_4floor: {
    label: 'Kick · 4-on-floor',
    description: 'Punchy 60→40 Hz kicks on every beat at BPM. Drives micKick + micLow.',
    defaults: { bpm: 128, level: 0.95 },
    sample(n, SR, p) {
      const { beatLen, phase } = beatInfo(n, SR, p.bpm ?? 128);
      // pitch-swept kick: 90 Hz → 45 Hz over the decay
      if (phase > 0.25) return 0;
      const tSec = (phase * beatLen) / SR;
      const hz = 90 - 45 * Math.min(1, phase / 0.25);
      const env = Math.exp(-phase / 0.06);
      return Math.sin(TAU * hz * tSec) * env * (p.level ?? 0.95);
    },
  },

  // Stepping sub bassline — sustained low energy, drives micLow without much kick.
  bassline: {
    label: 'Bassline (sub)',
    description: 'Stepping 45–110 Hz sustained notes. Drives micLow steadily.',
    defaults: { bpm: 128, level: 0.8 },
    sample(n, SR, p) {
      const { beatIdx, phase } = beatInfo(n, SR, p.bpm ?? 128);
      const notes = [55, 55, 82.4, 73.4]; // simple riff
      const hz = notes[beatIdx % notes.length];
      const t = n / SR;
      const env = 0.6 + 0.4 * Math.sin(TAU * (phase - 0.25)); // gentle pump per beat
      return Math.sin(TAU * hz * t) * env * (p.level ?? 0.8);
    },
  },

  // 16th-note hats — broadband highs, drives micHigh.
  hats: {
    label: 'Hi-hats (16ths)',
    description: 'Filtered-noise ticks on 16ths. Drives micHigh.',
    defaults: { bpm: 128, level: 0.5 },
    sample(n, SR, p) {
      const sixteenth = (60 / (p.bpm ?? 128)) * SR / 4;
      const phase = (n % sixteenth) / sixteenth;
      if (phase > 0.18) return 0;
      const env = Math.exp(-phase / 0.04);
      // high-passed-ish noise: noise minus a slow-moving average approximation
      return (noise(n) - 0.5 * noise(n - 1)) * env * (p.level ?? 0.5);
    },
  },

  // Mid chord stabs — drives micMid.
  chord_stab: {
    label: 'Chord stabs (mid)',
    description: 'Sawish mid chord stabs on the beat. Drives micMid.',
    defaults: { bpm: 128, level: 0.55 },
    sample(n, SR, p) {
      const { beatLen, phase } = beatInfo(n, SR, p.bpm ?? 128);
      if (phase > 0.4) return 0;
      const t = n / SR;
      const env = Math.exp(-phase / 0.18);
      const chord = [330, 415, 494]; // A major-ish triad in the mid band
      let s = 0; for (const f of chord) s += Math.sin(TAU * f * t) + 0.4 * Math.sin(TAU * 2 * f * t);
      return (s / chord.length) * 0.5 * env * (p.level ?? 0.55);
    },
  },

  // Build-up riser — rising noise sweep + accelerating ticks over `barBeats`.
  riser: {
    label: 'Riser / build',
    description: 'Rising noise sweep + accelerating snare ticks over a bar. Drives micFlux/micHigh.',
    defaults: { bpm: 128, barBeats: 16, level: 0.7 },
    sample(n, SR, p) {
      const beatLen = (60 / (p.bpm ?? 128)) * SR;
      const barLen = beatLen * (p.barBeats ?? 16);
      const u = (n % barLen) / barLen;            // 0..1 across the build
      const t = n / SR;
      // sweeping band-noise that climbs in level + brightness
      const sweep = Math.sin(TAU * (400 + 3000 * u) * t) * (0.2 + 0.5 * u);
      const tick = (noise(n) - 0.5 * noise(n - 1)) * (0.2 + 0.6 * u);
      return Math.max(-1, Math.min(1, (sweep + tick) * (p.level ?? 0.7)));
    },
  },

  // Full structured EDM loop: build bars then a drop with everything slamming.
  edm_drop: {
    label: 'EDM build → drop',
    description: 'Loops a build then a drop (kick+bass+hats+chord). Exercises the whole arc.',
    defaults: { bpm: 128, level: 0.9 },
    sample(n, SR, p) {
      const bpm = p.bpm ?? 128;
      const beatLen = (60 / bpm) * SR;
      const loopBeats = 32;                       // 16 build + 16 drop
      const beatInLoop = Math.floor(n / beatLen) % loopBeats;
      const dropped = beatInLoop >= 16;
      let s = 0;
      if (dropped) {
        s += SYNTHS.kick_4floor.sample(n, SR, { bpm, level: 1.0 });
        s += 0.7 * SYNTHS.bassline.sample(n, SR, { bpm, level: 0.8 });
        s += 0.5 * SYNTHS.hats.sample(n, SR, { bpm, level: 0.5 });
        s += 0.5 * SYNTHS.chord_stab.sample(n, SR, { bpm, level: 0.5 });
      } else {
        s += SYNTHS.riser.sample(n, SR, { bpm, barBeats: 16, level: 0.7 });
      }
      return Math.max(-1, Math.min(1, s * (p.level ?? 0.9)));
    },
  },

  // Continuous realistic groove — all elements together, no drop structure.
  full_track: {
    label: 'Full groove',
    description: 'Kick + bass + hats + chords together at BPM. A general realistic mix.',
    defaults: { bpm: 124, level: 0.9 },
    sample(n, SR, p) {
      const bpm = p.bpm ?? 124;
      let s = SYNTHS.kick_4floor.sample(n, SR, { bpm, level: 0.95 })
            + 0.7 * SYNTHS.bassline.sample(n, SR, { bpm, level: 0.7 })
            + 0.45 * SYNTHS.hats.sample(n, SR, { bpm, level: 0.5 })
            + 0.45 * SYNTHS.chord_stab.sample(n, SR, { bpm, level: 0.5 });
      return Math.max(-1, Math.min(1, s * (p.level ?? 0.9)));
    },
  },

  // Log frequency sweep — walks energy across the bands (and dom-freq tracker).
  sine_sweep: {
    label: 'Sine sweep',
    description: 'Slow log sweep 50→9000 Hz. Walks micLow→micMid→micHigh + dom freq.',
    defaults: { periodSec: 8, level: 0.7 },
    sample(n, SR, p) {
      const period = (p.periodSec ?? 8) * SR;
      const u = (n % period) / period;
      const hz = 50 * Math.pow(9000 / 50, u);     // log sweep
      return Math.sin(TAU * hz * (n / SR)) * (p.level ?? 0.7);
    },
  },

  white_noise: {
    label: 'White noise',
    description: 'Broadband noise — robustness / noise-floor test.',
    defaults: { level: 0.3 },
    sample(n, SR, p) { return noise(n) * (p.level ?? 0.3); },
  },

  silence: {
    label: 'Silence',
    description: 'Near-zero — confirms the noise gate holds (no phantom kicks).',
    defaults: { level: 0.0 },
    sample(n, SR, p) { return noise(n) * 0.0008; },
  },
};

export const SYNTH_NAMES = Object.keys(SYNTHS);

/**
 * Fill an Int16Array frame from a named synth. `cursor` is the absolute sample
 * index of buf[0]. params overrides the synth's defaults. Returns the synth's
 * merged params (so callers can surface defaults).
 */
export function fillFrame(buf, name, cursor, SR, params = {}) {
  // Fail loud on an unknown synth instead of silently substituting `tone`
  // (codex P0: no silent fallback). Callers validate, but this is the contract.
  const synth = SYNTHS[name];
  if (!synth) {
    throw new Error(`fillFrame: unknown synth "${name}" (have: ${Object.keys(SYNTHS).join(', ')})`);
  }
  const p = { ...synth.defaults, ...params };
  for (let i = 0; i < buf.length; i++) {
    const s = synth.sample(cursor + i, SR, p);
    buf[i] = Math.max(-1, Math.min(1, s)) * 32767;
  }
  return p;
}
