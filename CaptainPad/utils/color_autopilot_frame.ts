// color_autopilot_frame — pure parser for the /ws/control `colorAutopilot`
// broadcast (docs/61_colors_interaction_model.md §4.4, W4).
//
// WHY THIS FILE EXISTS SEPARATELY. `hooks/useEngineState.ts`'s `_onMessage`
// reducer is not exported, so the parse has to live somewhere vitest can
// reach it directly — this module sits under the `utils/*.test.ts` glob
// (see vitest.config.ts) and has ZERO React / React Native imports, so it is
// trivially unit-testable and trivially reusable by anything else that ever
// needs to interpret a raw broadcast the same way the hook does.
//
// MODE-SCOPED, NEVER MERGED. The engine's `colorAutopilotState()`
// (marsin_engine/lib/api_server.js) sends a DIFFERENT SHAPE per mode: a
// follow-note frame carries `followNote` + the runtime facts (currentScheme/
// notePc/noteHue/nextMethodAtMs) and NO `palettes`/`delay_s`/`shuffle`/
// `transitionMs` at all; a palettes frame is the reverse. This parser copies
// each broadcast THROUGH WHOLESALE — never merged on top of a previous
// frame — because carrying a stale `palettes` array across a mode change
// would let the app-wide chip (or anything else reading this frame) name a
// rotation family the daemon is no longer running. Each call is independent;
// there is no retained state in this module.

import type { DeckColorAutopilotConfig } from '@/utils/api';

// The exact field set this app is allowed to read off the broadcast. Kept as
// a const list (rather than spreading the whole message) so an unrelated
// field the engine adds later cannot leak into the control frame unnoticed.
const COPY_KEYS = [
  'active',
  'mode',
  'palettes',
  'delay_s',
  'shuffle',
  'transitionMs',
  'followNote',
  'currentScheme',
  'notePc',
  'noteHue',
  'nextMethodAtMs',
] as const;

/**
 * Parse a `/ws/control` `colorAutopilot` broadcast into the read-only
 * control frame the app-wide chip (and anything else that wants to know
 * "is a colour mode driving") reads.
 *
 * Returns `null` for anything that isn't a well-formed broadcast — never a
 * half-built config. Codex P0 (no fallback behaviors): an unusable frame
 * means "nothing is known", not "assume the last shape".
 *
 * Only `msg.type === 'colorAutopilot'` on a non-array object with a boolean
 * `active` is accepted; every other field is copied through AS-IS (no
 * coercion, no defaulting) because the caller must be able to tell "the
 * engine didn't send this field this time" (mode-scoped) apart from "the
 * engine sent a falsy value".
 */
export function colorAutopilotFrame(msg: unknown): DeckColorAutopilotConfig | null {
  if (msg === null || typeof msg !== 'object' || Array.isArray(msg)) return null;
  const raw = msg as Record<string, unknown>;
  if (raw.type !== 'colorAutopilot') return null;
  if (typeof raw.active !== 'boolean') return null;

  const out: Record<string, unknown> = {};
  for (const key of COPY_KEYS) {
    if (key in raw) out[key] = raw[key];
  }
  // The engine's wire shape is mode-scoped (see the module header) and
  // therefore does not literally satisfy DeckColorAutopilotConfig's
  // `palettes`/`delay_s`/`shuffle` as *required* fields in follow-note mode
  // — that type describes the REST config shape, which is the same
  // `colorAutopilotState()` output this broadcast mirrors. The cast is
  // deliberate, not a type-safety hole: `active` is verified above, and
  // every other field is copied verbatim from a payload this module has
  // already confirmed comes from the engine's own `colorAutopilot` message.
  return out as unknown as DeckColorAutopilotConfig;
}
