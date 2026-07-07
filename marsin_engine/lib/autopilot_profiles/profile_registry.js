/**
 * profile_registry.js — the autopilot PROFILE registry.
 *
 * A profile is a named behaviour for the deck autopilot: it decides WHEN to
 * advance (timer vs event-driven) and WHAT to pick. Today's behaviour is the
 * `random` profile (byte-identical to the pre-profile engine); `audio_reactive`
 * drives advance/color/speed from live Audio Companion signals.
 *
 * The registry is the single source of truth for:
 *   - AUTOPILOT_PROFILES        — the wire/UI list of valid profile names
 *   - AUTOPILOT_PROFILE_DEFAULT — the ONE documented default ('random')
 *   - normalizeAutopilotProfile — absent → default; present-but-unknown → throw
 *   - createAutopilotProfile    — construct a FRESH profile instance by name
 *
 * FAIL LOUD (codex P0): an unknown profile name is never silently coerced to a
 * default. `normalizeAutopilotProfile` throws, and `createAutopilotProfile`
 * throws, so a typo surfaces as a 400 at the route / a warn+clear at restore —
 * never as a wrong-behaviour-that-looks-fine.
 */

import { RandomProfile } from './random_profile.js';
import { AudioReactiveProfile } from './audio_reactive_profile.js';

// name → zero-arg constructor. Each armed profile gets its OWN instance
// (profiles hold subscription/CPC-restore state, so they can't be shared
// singletons across arms).
const PROFILE_CTORS = Object.freeze({
  random: RandomProfile,
  audio_reactive: AudioReactiveProfile,
});

// The ONE documented default — mirrors the `autoGroupFields` normalizer posture
// (absent field → documented default, never a silent coercion of a bad value).
export const AUTOPILOT_PROFILE_DEFAULT = 'random';

// The wire/UI list. Ordering is stable so the CaptainPad dropdown renders
// deterministically (random first — it is the default and today's behaviour).
export const AUTOPILOT_PROFILES = Object.freeze(['random', 'audio_reactive']);

/**
 * Resolve a wire `profile` value to a canonical profile name.
 *   - undefined / null / '' → the documented default ('random').
 *   - a known name          → that name.
 *   - anything else         → THROW (codex P0, no silent fallback).
 *
 * @param {*} profile
 * @returns {string}
 */
export function normalizeAutopilotProfile(profile) {
  if (profile === undefined || profile === null || profile === '') {
    return AUTOPILOT_PROFILE_DEFAULT;
  }
  if (typeof profile !== 'string' || !Object.prototype.hasOwnProperty.call(PROFILE_CTORS, profile)) {
    throw new Error(
      `unknown autopilot profile '${profile}' — known: ${AUTOPILOT_PROFILES.join(', ')}`,
    );
  }
  return profile;
}

/**
 * Construct a FRESH profile instance for the given name. Throws on an unknown
 * name (via normalizeAutopilotProfile). The absent-default case yields a
 * `random` instance.
 *
 * @param {*} profile
 * @returns {object} a profile instance ({ name, attach, detach, nextDelayMs,
 *   pickNextEntry, validateState })
 */
export function createAutopilotProfile(profile) {
  const name = normalizeAutopilotProfile(profile);
  const Ctor = PROFILE_CTORS[name];
  return new Ctor();
}
