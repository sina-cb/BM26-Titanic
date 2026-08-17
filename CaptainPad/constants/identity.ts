// identity — the colours that are deliberately NOT theme tokens.
//
// The rule in this app is "tokens, not literals" (`.agent/os/ui_design.md`,
// docs/54 §1.1): chrome colour comes from `constants/theme.ts` and flips with
// the operator's theme. This file is the SHORT, CLOSED list of exceptions —
// hexes that must read the SAME on light, dark, midnight, sunset and gruvbox,
// because their job is to identify a THING rather than to paint chrome.
//
// A colour earns a place here only if it satisfies all three:
//
//   1. It identifies something that exists OUTSIDE this app's theme — a
//      physical control, an audio band the desktop Companion also draws, a
//      subsystem the operator learns by colour.
//   2. Flipping it with the theme would break recognition ("the violet
//      knob chips" must be violet at 3 a.m. and at noon).
//   3. Every surface that fills with it derives its ink through
//      `readableInk()` (`components/param_row_layout.ts`), so the fixed hex
//      can never fail contrast on a palette it was not picked against.
//
// Anything that fails those tests is a token, not an identity. If you are
// about to add a hex here, the answer is almost certainly `theme.ts`.
//
// docs/54 §1 calls these out by name: audio bands, MIDI violet, plan cyan,
// panic amber.

// ── audio bands ─────────────────────────────────────────────────────
//
// RE-EXPORTED, not redeclared. The band hexes MIRROR the Audio Companion's
// SOURCE_ACCENT (`marsin_engine/audio/companion/companion_app.js`) so a band
// reads the same teal/blue/red on the iPad as it does in the desktop
// designer — that mirror is the whole reason they are fixed. Their owning
// module stays `utils/audioSignals.ts` (it also owns the key→band resolution
// and the curated deck subset); this module only DOCUMENTS that they are a
// deliberate identity family. Two declarations would be two things to drift.

export {
  COMPANION_ACCENT as AUDIO_BAND_ACCENT,
  ACCENT_AUTO as AUDIO_BAND_FALLBACK,
} from '@/utils/audioSignals';

// ── MIDI violet ─────────────────────────────────────────────────────
//
// The app-wide "this is a physical control" family: the KNOB chip, the ⊞ MIDI
// chip, MidiMap's own MIDI_VIOLET, the knob pill. Violet is not in any
// palette on purpose — a mapped encoder is the same encoder whatever the
// operator's theme, and the MIDI surfaces are the ones read by muscle memory.
//
// The live declaration is still `PARAM_CHIP_MIDI_ACCENT` in
// `components/ui/param_chips.tsx`; docs/54 slice R1 flips that file to
// re-export this constant (a .tsx cannot be imported by the node-env vitest
// suite, so R0 declares the value here and `design_tokens.test.ts` reads the
// component's source text to prove the two have not drifted).

export const MIDI_ACCENT = '#7c5cff';

// ── plan cyan ───────────────────────────────────────────────────────
//
// The timeline/plan subsystem's accent — "the SHOW PLAN is driving the rig",
// worn by PlanIndicatorPill, the deck's plan-live chip and the timeline
// surfaces. Same reasoning as MIDI violet: the plan is one subsystem across
// five themes, and on the deck it has to be told apart from `primary` at a
// glance, which a theme-following accent cannot guarantee.
//
// Live declaration: `PLAN_CYAN` in `components/timeline/PlanIndicatorPill.tsx`
// (re-exported there as `PLAN_INDICATOR_CYAN`). R1 flips it to this constant.

export const PLAN_ACCENT = '#22c1d6';

// ── panic amber ─────────────────────────────────────────────────────
//
// The loud amber of the PANIC bar and the plan-takeover banner. This one is
// the subtle case, because the palette ALSO gained a `warning` token in R0 —
// and they are not the same thing:
//
//   `Colors[theme].warning`  chrome amber: caution chips, takeover chips,
//                            the PLAN banner. Theme-aware, and per-theme
//                            contrast-picked (the light theme's is a deep
//                            gold — the loud hex below is ~2:1 on white).
//   `PANIC_AMBER`            the ONE control docs/54 row 17 freezes: "the
//                            deliberate loud-amber identity is PRESERVED —
//                            this button must read identically forever". The
//                            operator finds PANIC by colour, in the dark,
//                            under pressure. It never moves.
//
// Its ink is derived with `readableInk()`, so the fixed fill is safe on every
// theme. Do not reach for it for anything that is merely "cautionary" —
// that is `warning`.

export const PANIC_AMBER = '#f5a623';
