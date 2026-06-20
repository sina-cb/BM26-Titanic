// Shared audio-signal helpers used across the deck/mixer (CPCControls),
// the AUDIO tab (audio.tsx), and the modulation popup (Modulation.tsx).
//
// WHY THIS EXISTS
//   Three surfaces need the same two derived facts about the dynamic
//   audio-signal set the Companion routes into the CPC:
//
//     1. A signal's IDENTITY COLOUR (so a band reads the same teal/blue/red
//        everywhere — deck meter, audio-tab trace, modulation source trail).
//        Previously this lived only in audio.tsx (COMPANION_ACCENT /
//        accentFor); the deck row had no accent and the modulation popup
//        had no trace at all.
//
//     2. The CURATED DECK SUBSET — the best-practice at-a-glance cues the
//        dense deck/mixer screens should show (LOW / MID / HIGH / KICK +
//        a BEAT cue), as opposed to the FULL dynamic set which stays on the
//        AUDIO tab. Centralising the curation list here makes it one
//        documented constant rather than an inline slice.
//
//   Codex P0 (no fallback behaviours): the curation GRACEFULLY DEGRADES —
//   it filters the live set to the curated keys IN CURATED ORDER and simply
//   omits any curated cue the Companion isn't currently publishing. It never
//   invents a signal that isn't live, and if NONE of the curated keys are
//   present it returns an empty list (the caller renders its "no live audio"
//   state) rather than dumping the full set back.

import type { AudioSignalDescriptor } from '@/hooks/useEngineState';

// ── identity colours ────────────────────────────────────────────────
//
// MIRRORS the Audio Companion's SOURCE_ACCENT (companion_app.js) so a band
// reads the SAME colour on the iPad as it does in the desktop designer.
// Fixed hex (a signal's identity colour shouldn't flip with the light/dark
// theme — same posture the Companion takes), chosen to read on every
// palette's surfaces. Keyed by the trailing band token so `micLow` and
// `audioLow` both resolve to the same teal.
export const COMPANION_ACCENT: Record<string, string> = {
  low:   '#34d3b5', // teal
  mid:   '#4ea1ff', // blue
  high:  '#8b9bff', // periwinkle
  kick:  '#ff5d6c', // red
  flux:  '#c084fc', // violet
  dom1:  '#f0a23b', // amber
  dom2:  '#c084fc', // violet
  bpm:   '#f0a23b', // amber
  energy: '#1b9e77', // live-green
  slow:  '#5ac8fa', // cyan
  build: '#f0a23b', // amber
  party: '#ff7ac8', // pink
};

// "Auto-driven / live" green fallback accent (mirrors C.tertiary / the
// Companion's neutral source colour). Returned when a signal matches no
// known band token and isn't a frequency source.
export const ACCENT_AUTO = '#1b9e77';

// ── genre classifier (audioGenre) ───────────────────────────────────
//
// The Companion's genre classifier routes a single `audioGenre` CPC key
// whose live value is an INDEX into this list (index-aligned with the
// engine/Companion classifier — keep in lockstep). A raw integer in a
// meter reads as noise ("3"), so the AUDIO tab resolves the index to the
// human name. This list is the canonical contract order; do NOT reorder
// without matching the analyzer side.
export const AUDIO_GENRE_NAMES: readonly string[] = [
  'ambient',
  'deep_house',
  'melodic_house',
  'tech_house',
  'techno',
  'melodic_techno',
  'downtempo',
];

/**
 * Resolve an `audioGenre` CPC value (a float index) to its genre name for
 * display. Rounds to the nearest index and looks it up in
 * AUDIO_GENRE_NAMES; an out-of-range / negative index returns null so the
 * caller can render a neutral placeholder rather than INVENT a label
 * (Codex P0 — no fallback fabrication).
 */
export function audioGenreName(value: number): string | null {
  if (!Number.isFinite(value) || value < 0) return null;
  const idx = Math.round(value);
  if (idx < 0 || idx >= AUDIO_GENRE_NAMES.length) return null;
  return AUDIO_GENRE_NAMES[idx];
}

/**
 * Whether an audio CPC key is the genre classifier output. Matched by the
 * `genre` token (case-insensitive) so a `audioGenre` / `micGenre` / a
 * dynamic Companion key carrying "genre" all resolve. Used by the AUDIO
 * tab to switch a signal column from a numeric readout to the genre name.
 */
export function isGenreKey(key: string): boolean {
  return /genre/i.test(key);
}

/**
 * Identity colour (resolved hex) for a dynamic audio signal. Match the
 * Companion's source colour when we recognise the band token; KICK red,
 * dominant-frequency violet, otherwise the live-green auto accent.
 */
export function audioAccentHex(signal: AudioSignalDescriptor): string {
  const k = signal.key.toLowerCase();
  for (const token of Object.keys(COMPANION_ACCENT)) {
    if (k.includes(token)) return COMPANION_ACCENT[token];
  }
  if (/kick/i.test(signal.key)) return '#ff5d6c';
  if (signal.kind === 'frequency') return '#c084fc';
  return ACCENT_AUTO;
}

// ── curated deck/mixer subset ───────────────────────────────────────
//
// The deck/mixer "AUDIO SIGNALS" row is the densest screen in the app; the
// full dynamic set (low/mid/high/kick, dom1/dom2, energy, slow, build,
// party, …) overflows it and reads as noise. Best practice for a perform-
// time glance is the four spectral bands the operator actually choreographs
// to plus a transient/beat cue:
//
//   LOW · MID · HIGH   — the spectral picture (is the track bassy? bright?)
//   KICK               — the transient that drives most beat-locked looks
//   BEAT cue           — KICK already covers the transient; if the Companion
//                        also publishes a dedicated beat/energy pulse we
//                        prefer it. (BPM rides its own dedicated tile on the
//                        deck — see BpmTile — so it's intentionally NOT in
//                        this bar to avoid a duplicate readout.)
//
// Matching is by trailing band TOKEN (substring, case-insensitive) so a
// `micLow` / `audioLow` both qualify as the LOW cue. Order here is the
// on-screen order; the first live signal matching each token wins.
export const CURATED_DECK_TOKENS: readonly string[] = [
  'low',
  'mid',
  'high',
  'kick',
  // Beat/energy pulse cue — only shown if the Companion publishes one.
  'beat',
  'energy',
];

/**
 * Filter the full dynamic signal set down to the curated deck subset, in
 * curated order, de-duplicated by token (so `energy` doesn't also surface a
 * second time if both `beat` and `energy` matched the same descriptor).
 *
 * Gracefully degrades: a curated token with no live signal is simply
 * skipped — never faked. Returns at most one descriptor per curated token.
 */
export function curateDeckSignals(
  signals: AudioSignalDescriptor[],
): AudioSignalDescriptor[] {
  const out: AudioSignalDescriptor[] = [];
  const used = new Set<string>();
  for (const token of CURATED_DECK_TOKENS) {
    const hit = signals.find(
      (s) => !used.has(s.key) && s.key.toLowerCase().includes(token),
    );
    if (hit) {
      out.push(hit);
      used.add(hit.key);
    }
  }
  return out;
}
