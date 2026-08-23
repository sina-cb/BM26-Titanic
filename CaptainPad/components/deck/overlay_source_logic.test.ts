import { describe, expect, it } from 'vitest';

import { hexToHue, hueToHex, overlaySourceMode } from './overlay_source_logic';

describe('Deck overlay source UI logic', () => {
  it('defaults old overlay frames to playlist mode', () => {
    expect(overlaySourceMode({ id: 'old' } as any)).toBe('playlist');
    expect(overlaySourceMode({ id: 'solid', sourceMode: 'solid' } as any)).toBe('solid');
  });

  it('round-trips the six primary hue points', () => {
    for (const hue of [0, 1 / 6, 2 / 6, 3 / 6, 4 / 6, 5 / 6]) {
      expect(hexToHue(hueToHex(hue))).toBeCloseTo(hue, 2);
    }
  });

  it('normalizes hue turns and invalid colors safely for local drafts', () => {
    expect(hueToHex(1)).toBe('#FF0000');
    expect(hueToHex(-0.5)).toBe('#00FFFF');
    expect(hexToHue('invalid')).toBe(0);
  });
});
