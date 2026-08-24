import type { DeckOverlay, DeckOverlaySourceMode } from '@/utils/deckOverlaysApi';

export function overlaySourceMode(overlay: DeckOverlay): DeckOverlaySourceMode {
  return overlay.sourceMode === 'solid' ? 'solid' : 'playlist';
}

export function hueToHex(hue: number): string {
  const h = ((Number.isFinite(hue) ? hue : 0) % 1 + 1) % 1;
  const segment = h * 6;
  const x = Math.round(255 * (1 - Math.abs((segment % 2) - 1)));
  const colors = [
    [255, x, 0],
    [x, 255, 0],
    [0, 255, x],
    [0, x, 255],
    [x, 0, 255],
    [255, 0, x],
  ];
  return `#${colors[Math.floor(segment) % 6]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()}`;
}

export function hexToHue(hex: string | null | undefined): number {
  if (typeof hex !== 'string' || !/^#[0-9A-Fa-f]{6}$/.test(hex)) return 0;
  const r = Number.parseInt(hex.slice(1, 3), 16) / 255;
  const g = Number.parseInt(hex.slice(3, 5), 16) / 255;
  const b = Number.parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (delta === 0) return 0;
  let turns;
  if (max === r) turns = ((g - b) / delta) % 6;
  else if (max === g) turns = (b - r) / delta + 2;
  else turns = (r - g) / delta + 4;
  return ((turns / 6) % 1 + 1) % 1;
}
