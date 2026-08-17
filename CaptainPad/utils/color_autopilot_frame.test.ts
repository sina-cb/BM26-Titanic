import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { colorAutopilotFrame } from './color_autopilot_frame';

describe('colorAutopilotFrame', () => {
  it('parses a follow-note broadcast with NO palettes key at all', () => {
    const frame = colorAutopilotFrame({
      type: 'colorAutopilot',
      active: true,
      mode: 'followNote',
      nextSwapAtMs: 123456,
      followNote: {
        schemes: ['triadic'],
        methodHoldS: 20,
        methodFadeS: 3,
        noteFadeMs: 400,
        sel: [0, 1],
        shuffle: false,
      },
      currentScheme: 'triadic',
      notePc: 7,
      noteHue: 0.5,
      nextMethodAtMs: 999999,
    });
    expect(frame).not.toBeNull();
    expect(frame!.mode).toBe('followNote');
    expect(frame!.active).toBe(true);
    expect('palettes' in frame!).toBe(false);
    expect('delay_s' in frame!).toBe(false);
    expect('shuffle' in frame!).toBe(false);
    expect(frame!.notePc).toBe(7);
  });

  it('parses a palettes broadcast with `palettes` present', () => {
    const frame = colorAutopilotFrame({
      type: 'colorAutopilot',
      active: true,
      mode: 'palettes',
      nextSwapAtMs: 111,
      palettes: ['sunset', 'ocean'],
      delay_s: 30,
      shuffle: false,
      transitionMs: 800,
    });
    expect(frame).not.toBeNull();
    expect(frame!.mode).toBe('palettes');
    expect(frame!.palettes).toEqual(['sunset', 'ocean']);
    expect(frame!.delay_s).toBe(30);
    expect(frame!.shuffle).toBe(false);
  });

  it('returns null when `active` is missing', () => {
    expect(colorAutopilotFrame({ type: 'colorAutopilot', mode: 'palettes' })).toBeNull();
  });

  it('returns null when `active` is not a boolean', () => {
    expect(colorAutopilotFrame({ type: 'colorAutopilot', active: 'yes' })).toBeNull();
    expect(colorAutopilotFrame({ type: 'colorAutopilot', active: 1 })).toBeNull();
  });

  it('returns null for a non-object message', () => {
    expect(colorAutopilotFrame(null)).toBeNull();
    expect(colorAutopilotFrame(undefined)).toBeNull();
    expect(colorAutopilotFrame('colorAutopilot')).toBeNull();
    expect(colorAutopilotFrame(42)).toBeNull();
  });

  it('returns null for an array', () => {
    expect(colorAutopilotFrame([{ type: 'colorAutopilot', active: true }])).toBeNull();
  });

  it('returns null for the wrong message type', () => {
    expect(colorAutopilotFrame({ type: 'mixer', active: true })).toBeNull();
    expect(colorAutopilotFrame({ active: true })).toBeNull();
  });

  it('never merges across calls: a palettes frame followed by a follow-note frame carries no stale palettes', () => {
    const first = colorAutopilotFrame({
      type: 'colorAutopilot',
      active: true,
      mode: 'palettes',
      palettes: ['sunset', 'ocean'],
      delay_s: 30,
      shuffle: false,
    });
    expect(first).not.toBeNull();
    expect(first!.palettes).toEqual(['sunset', 'ocean']);

    // A later, independent call for a follow-note frame — the parser is pure
    // and stateless, so nothing from `first` may leak into `second`.
    const second = colorAutopilotFrame({
      type: 'colorAutopilot',
      active: true,
      mode: 'followNote',
      currentScheme: 'triadic',
      notePc: 2,
    });
    expect(second).not.toBeNull();
    expect('palettes' in second!).toBe(false);
    expect('delay_s' in second!).toBe(false);
    expect('shuffle' in second!).toBe(false);
    expect(second!.mode).toBe('followNote');
  });
});

// ── W4 no-write guard (docs/61 §8 W4 accept) ────────────────────────────────
//
// `components/ui/color_mode_chip.tsx` is a READ-ONLY surface: it may name
// what's driving the colours and navigate to the Deck tab, but it must NEVER
// write to the engine — a chip that lives on every tab is not the surface
// that can show what a STOP would freeze (docs/61 §4.4). This is a source-text
// scan (same idiom as `components/no_raw_alerts.test.ts`) rather than a
// runtime test so a new write call fails CI on the day it's written.
describe('color_mode_chip has zero engine writes', () => {
  const CHIP_PATH = join(
    dirname(dirname(fileURLToPath(import.meta.url))),
    'components', 'ui', 'color_mode_chip.tsx',
  );

  it('contains none of the banned write call sites', () => {
    const src = readFileSync(CHIP_PATH, 'utf8');
    const banned = [
      'setDeckColorAutopilot',
      'patchDeckColorAutopilot',
      'updateParamCenter',
      'fetch(',
    ];
    for (const needle of banned) {
      expect(src.includes(needle), `color_mode_chip.tsx must not contain "${needle}"`).toBe(false);
    }
  });

  it('contains no POST or PATCH method strings', () => {
    const src = readFileSync(CHIP_PATH, 'utf8');
    expect(/['"`]POST['"`]/.test(src), 'color_mode_chip.tsx must not POST').toBe(false);
    expect(/['"`]PATCH['"`]/.test(src), 'color_mode_chip.tsx must not PATCH').toBe(false);
  });
});
