import {
  hueOf,
  isTurnsConfig,
  type Hsv,
  type PaletteEntry,
  type RotationKind,
} from './colors_window_logic';

/**
 * The RUN button must begin from the colours the operator currently selected,
 * not an inactive crossfade ring left behind by a previous run. While a
 * crossfade is actually driving, its own first pair remains the authoritative
 * endpoints for the scrubber and live readout.
 */
export function crossfadeEndpoints(
  kind: RotationKind,
  palettes: readonly PaletteEntry[] | undefined,
  h1: number,
  h2: number,
): [number, number] {
  if (kind === 'crossfade' && Array.isArray(palettes) && palettes.length === 2 && isTurnsConfig(palettes)) {
    const first = palettes[0] as { c1: number | Hsv; c2: number | Hsv };
    return [hueOf(first.c1), hueOf(first.c2)];
  }
  return [h1, h2];
}
