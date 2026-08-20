/**
 * KnobPill — the "KNOB N" badge naming the physical MFT encoder that drives an
 * on-screen control.
 *
 * SINCE _190 THIS IS A THIN ALIAS. The pill is one of the chips in the shared
 * parameter-row header, so its paint moved into that chip family
 * (`components/ui/param_chips.tsx` → `KnobChip`) where it shares a box, a
 * baseline and a responsive compact variant with the ♪ suggestion and ⊞ MIDI
 * chips. This alias stays for the callers OUTSIDE a parameter row:
 *   - the GLOBALS row SPEED fader (CPCControls.tsx — MFT knob 1),
 *   - the hue controls (deck DeckHueRow, mixer focused strip's HUE trim —
 *     MFT knob 2 always drives the FOCUSED channel's hue).
 * Outside a ParamRow the chip resolves to the regular (non-compact) metrics,
 * which is exactly what those standalone pills want.
 *
 * Prefer `KnobChip` directly in new code. Both render the same component, so
 * the pill cannot drift between surfaces.
 */
export { KnobChip as KnobPill, PARAM_CHIP_MIDI_ACCENT as KNOB_PILL_ACCENT } from '@/components/ui/param_chips';
