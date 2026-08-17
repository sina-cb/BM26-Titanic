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

export type PartySignalDisplay = {
  label: 'PARTY SIGNAL ON' | 'PARTY SIGNAL OFF' | 'PARTY SIGNAL …';
  tone: 'on' | 'off';
};

/**
 * Describe the engine's held `audioParty` gate for the operator UI.
 *
 * `audioParty` is published as a binary 0/1 signal, and engine consumers use
 * 0.5 as the boundary. Keep the CaptainPad pill on that same contract. A
 * missing or non-finite value is UNKNOWN, not OFF: during startup or a broken
 * live-param link the UI must not claim that the detector has declared calm.
 */
export function describePartySignal(value: number | null | undefined): PartySignalDisplay {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return { label: 'PARTY SIGNAL …', tone: 'off' };
  }
  if (value >= 0.5) return { label: 'PARTY SIGNAL ON', tone: 'on' };
  return { label: 'PARTY SIGNAL OFF', tone: 'off' };
}

// ── party-signal truth gate (link + arrival) ────────────────────────
//
// describePartySignal turns ONE value into a label. It cannot tell an engine
// reading from the value the UI happened to be HOLDING when the live-signal
// link went away — and the live-param cache is deliberately NOT cleared on
// disconnect (every meter keeps its last frame rather than snapping to zero).
// So the pill went on claiming "PARTY SIGNAL ON" with no engine behind it.
//
// This reducer is the missing piece. It folds each render's OBSERVATION of the
// live bus — is the /ws/signals transport up, which live document is in hand,
// what `audioParty` does that document carry — into the only value the pill is
// allowed to display. Two rules:
//
//   1. Transport down → UNKNOWN immediately. Never a stale ON/OFF. While the
//      link is down the engine's held gate is simply not observable.
//   2. Transport back up → still UNKNOWN until a live document ARRIVES that is
//      not the one we were holding through the outage. Documents are compared
//      by IDENTITY (each WS frame is parsed into a fresh object), which is what
//      distinguishes "the engine just told us" from "React still has the old
//      frame in state". The engine replays its last cached liveParams payload
//      to every fresh /ws/signals connection (api_server.js,
//      `wssSignals.on('connection')`), so that arrival normally lands within
//      milliseconds and the pill resumes from the engine's CURRENT held gate.
//
// Deliberately NOT here: any age/no-message timeout. `liveParams` is
// CHANGE-driven — a calm room produces no frames at all — so "nothing arrived
// recently" is not evidence of lost truth, and a timeout would flip a healthy
// calm rig to unknown. And no second threshold / no re-tuned detection: the
// ON/OFF boundary stays entirely in describePartySignal. This decides only
// whether we are entitled to show a boundary verdict at all.

export type PartySignalTruth = {
  /** The value the pill may display. `null` means UNKNOWN ("PARTY SIGNAL …"). */
  value: number | null;
  /**
   * The live document this truth is bound to, compared by IDENTITY. When
   * `value` is null this is the document we refuse to trust (held through an
   * outage), so the same object reappearing after a reconnect stays untrusted.
   */
  doc: object | null;
};

/** Startup state: nothing observed, nothing claimed. */
export const PARTY_SIGNAL_UNKNOWN: PartySignalTruth = { value: null, doc: null };

export type PartySignalObservation = {
  /** Is the live-signal transport that carries `audioParty` connected NOW? */
  connected: boolean;
  /** The live document in hand (identity-compared), or `null` when there is none. */
  doc: object | null;
  /** `audioParty` from that document, or `null` when it doesn't carry one. */
  value: number | null;
};

/**
 * Fold one observation of the live-signal bus into the party-signal truth.
 *
 * Idempotent for a repeated observation, and returns the PREVIOUS object
 * identity whenever nothing changed — so a caller can hold it in a ref and
 * re-run it on every render without churn.
 *
 * @param prev current truth (start from PARTY_SIGNAL_UNKNOWN)
 * @param obs  what the live bus looks like right now
 * @returns the value the pill may display, for describePartySignal
 */
export function nextPartySignalTruth(
  prev: PartySignalTruth,
  obs: PartySignalObservation,
): PartySignalTruth {
  // Drop to unknown while REMEMBERING the document in hand, so that exact
  // document cannot be re-read as truth once the link comes back.
  const unknownHolding = (doc: object | null): PartySignalTruth =>
    (prev.value === null && prev.doc === doc) ? prev : { value: null, doc };

  // 1. No transport → no truth.
  if (!obs.connected) return unknownHolding(obs.doc);

  // 2. Connected, but nothing usable in hand (cold start, or the Companion
  //    isn't publishing audioParty) → unknown, never a manufactured OFF.
  if (obs.doc === null || obs.value === null || !Number.isFinite(obs.value)) {
    return unknownHolding(obs.doc);
  }

  // 3. Connected again, but still holding the very document we distrusted —
  //    nothing has arrived yet. Stay unknown.
  if (prev.value === null && prev.doc !== null && prev.doc === obs.doc) return prev;

  // 4. A document that arrived on a live link: authoritative. (Same value as
  //    before → keep `prev` so a 30 Hz stream doesn't allocate per frame; the
  //    stored `doc` only matters while `value` is null.)
  if (prev.value === obs.value) return prev;
  return { value: obs.value, doc: obs.doc };
}

// ── pulse signals (one-frame transients) ────────────────────────────
//
// A growing class of Companion CPC keys are NOT continuous [0,1] levels —
// they are 30 Hz, one-frame PULSES that snap to 1 for a single analyser hop
// on an event (an onset, a beat, a phrase boundary) and sit at 0 otherwise.
// Rendered as a normal intensity BAR they flatline at ~0 and the single-hop
// spike almost always falls BETWEEN the CaptainPad ~20 Hz param polls, so the
// operator sees a dead bar that imperceptibly twitches — the bug Adv-D P2-A
// flagged.
//
// The Audio Companion desktop UI already solved this with an
// arm-on-rising-edge / decay envelope (companion_app.js: armPulse / tickFlash
// / tickLit) so a one-hop pulse HOLDS a visible flash for ~150-250 ms. We
// mirror that posture on the iPad: a pulse key renders a flashing DOT driven
// by a hold+decay envelope instead of a flatlined bar.
//
// This set is the single source of truth for which dynamic keys are pulses
// (matched by a TRAILING band token as a word segment, so the Companion's
// `audio*` / `mic*` prefixes both resolve). Keep it in lockstep with the
// Companion's pulse-routed signals. Tokens are lowercase word segments as
// produced by keyHasBandToken's camelCase/underscore split:
//   micOnsetLow  → ['mic','onset','low']        → 'onsetlow'   (joined below)
//   audioChestHit→ ['audio','chest','hit']      → 'chesthit'
// We therefore match on a JOINED multi-word token where the split would break
// the pair (onsetLow / chestHit), and on a single segment for the rest.
//
// Continuous keys (low/mid/high/kick bands, dom1/dom2, energy, climax, the
// genre/Hz/bpm specials) are NOT pulses and keep their bar + trace.
export const PULSE_KEY_TOKENS: readonly string[] = [
  'onsetlow',   // micOnsetLow      — per-band low onset
  'onsetmid',   // micOnsetMid      — per-band mid onset
  'onsethigh',  // micOnsetHigh     — per-band high onset
  'chesthit',   // audioChestHit    — sub-bass chest thump
  'dropcountdown', // audioDropCountdown — drop imminent
  'beat',       // audioBeat        — beat tick
  'downbeat',   // audioDownbeat    — fires true only on the hop beat-1 lands
  'phraseboundary', // audioPhraseBoundary — 4/8/16-bar phrase edge
  'trackchange',    // audioTrackChange    — new track detected
  'switchcolor',    // audioSwitchColor    — auto colour-switch cue
  'switchpattern',  // audioSwitchPattern  — auto pattern-switch cue
];

/**
 * Whether an audio CPC key is a one-frame PULSE (an onset / beat / boundary /
 * switch cue) rather than a continuous [0,1] level. Matched by stripping the
 * camelCase/underscore separators and testing whether the resulting lower
 * key CONTAINS one of the known pulse tokens as a contiguous run — so
 * `micOnsetLow`, `audioChestHit`, `audioDropCountdown`, `audioBeat`,
 * `audioPhraseBoundary`, `audioTrackChange`, `audioSwitchColor`,
 * `audioSwitchPattern` all resolve regardless of the `mic`/`audio` prefix.
 *
 * Used by the AUDIO tab to render these as a flashing dot (hold+decay
 * envelope) instead of a flatlined bar — a one-hop pulse otherwise blinks
 * imperceptibly between the ~20 Hz param polls (Adv-D P2-A).
 *
 * The genre/Hz/bpm specials are NOT pulses (they have their own readouts), so
 * a pulse key is necessarily an `intensity`-kind signal; callers should still
 * guard on kind === 'intensity' before treating a match as a pulse.
 */
export function isPulseKey(key: string): boolean {
  // Join the word segments so multi-word tokens (onsetLow, chestHit) match a
  // contiguous run: 'micOnsetLow' → 'mic onset low' → 'miconsetlow'.
  const joined = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .toLowerCase()
    .replace(/\s+/g, '');
  // A key is a pulse iff its joined form ENDS WITH a known pulse token. Suffix
  // (not substring) matching keeps the mic/audio prefix flexibility while
  // EXCLUDING continuous keys that merely contain a token mid-word — notably
  // `audioBeatInBar` (a 1–4 bar counter) ends with "inbar", not "beat", so it
  // correctly stays a bar; `audioBeat`/`audioDownbeat` still match.
  return PULSE_KEY_TOKENS.some((token) => joined.endsWith(token));
}

/**
 * Whether an audio CPC key is the genre classifier NAME output (the float
 * INDEX into AUDIO_GENRE_NAMES) — not its companion `audioGenreConf` key.
 * Matched by the `genre` token (case-insensitive) so `audioGenre` / `micGenre`
 * / a dynamic Companion key carrying "genre" all resolve, but the sibling
 * CONFIDENCE key (`audioGenreConf`, a real [0,1] level) is EXCLUDED — otherwise
 * its 0..1 confidence would be misread through audioGenreName() and rendered
 * as a fake genre name (e.g. 0 → "AMBIENT") instead of a numeric readout.
 */
export function isGenreKey(key: string): boolean {
  return /genre/i.test(key) && !/conf/i.test(key);
}

/**
 * Identity colour (resolved hex) for a dynamic audio signal. Match the
 * Companion's source colour when we recognise the band token; KICK red,
 * dominant-frequency violet, otherwise the live-green auto accent.
 *
 * Matching is by band TOKEN as a WORD SEGMENT of the camelCase/lower key
 * (via keyHasBandToken) — NOT a bare substring. A bare `includes('low')`
 * mis-coloured `audioSlowZone` (which contains "low" inside "s-low-zone")
 * as the LOW band's teal; the word-segment match resolves it to its own
 * `slow` cyan instead. Same fragility applied to mid/high.
 */
export function audioAccentHex(signal: AudioSignalDescriptor): string {
  for (const token of Object.keys(COMPANION_ACCENT)) {
    if (keyHasBandToken(signal.key, token)) return COMPANION_ACCENT[token];
  }
  if (/kick/i.test(signal.key)) return '#ff5d6c';
  if (signal.kind === 'frequency') return '#c084fc';
  return ACCENT_AUTO;
}

/**
 * Accent for a bare CPC key, with no live descriptor in hand. Same band-token
 * resolution as `audioAccentHex` — used by the AUDIO SUGGESTION badge, which
 * describes a signal the pattern RECOMMENDS and which may not be live (or even
 * published) at the moment the operator is looking at the parameter.
 */
export function audioAccentHexForKey(key: string): string {
  for (const token of Object.keys(COMPANION_ACCENT)) {
    if (keyHasBandToken(key, token)) return COMPANION_ACCENT[token];
  }
  if (/kick/i.test(key)) return '#ff5d6c';
  return ACCENT_AUTO;
}

/**
 * The short badge word for a CPC signal key: `micFlux` → "FLUX",
 * `micLow` → "LOW". Strips the family prefix the engine namespaces with and
 * upper-cases the rest; a key with no prefix keeps its whole name.
 */
export function shortSignalLabel(key: string): string {
  const stripped = key.replace(/^(mic|audio|stems|dom)/, '');
  return (stripped || key).toUpperCase();
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
// Matching is by band TOKEN as a WORD SEGMENT of the camelCase/lower key (NOT a
// bare substring) so `micLow` / `audioLow` qualify as the LOW cue but
// `audioSlowZone` (which contains the substring "low" inside "s-low-zone") does
// NOT — a bare `includes('low')` mis-curated the slow-zone signal as a band cue.
// Same fragility applied to mid/high. Order here is the on-screen order; the
// first live signal matching each token wins.
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
 * Whether `key` contains `token` as a discrete WORD SEGMENT — anchored to a
 * camelCase boundary or the key edges — rather than as a loose substring. This
 * is what lets LOW match `micLow`/`audioLow`/`low` while rejecting the embedded
 * "low" in `audioSlowZone`. The token boundary on each side is: the key edge, a
 * non-letter, or a case transition (lower↔Upper). Case-insensitive.
 */
export function keyHasBandToken(key: string, token: string): boolean {
  // Split the camelCase/underscore key into lowercase word segments:
  // 'audioSlowZone' → ['audio','slow','zone']; 'micLow' → ['mic','low'].
  const segments = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  return segments.includes(token.toLowerCase());
}

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
      (s) => !used.has(s.key) && keyHasBandToken(s.key, token),
    );
    if (hit) {
      out.push(hit);
      used.add(hit.key);
    }
  }
  return out;
}
