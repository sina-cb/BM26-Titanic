// op_tone — the notice/dialog palette mapping, swept over all five themes.
//
// In components/ for the same reason design_tokens.test.ts is: vitest's include
// globs are `utils/*.test.ts`, `utils/midi/**`, `components/**/*.test.ts` and
// `hooks/**`, so a `styles/*.test.ts` would never run.

import { describe, expect, it } from 'vitest';

import { Colors, THEME_ORDER, type Palette } from '@/constants/theme';
import { contrastRatio, isLightSurface } from '@/styles/design_recipes';
import { opToneColors } from '@/styles/op_tone';
import { OP_NOTICE_DURATION_MS, type OpTone } from '@/utils/op_dialog';

const TONES: OpTone[] = ['error', 'warning', 'info'];

/** WCAG AA for normal text. The toast body is 13pt Inter and the title is an
 *  11pt bold cap — small text, so 4.5 is the honest bar, not 3. */
const AA_TEXT = 4.5;
/** WCAG 1.4.11 non-text contrast: the card hairline and the 3px accent bar are
 *  UI-component boundaries. */
const AA_NON_TEXT = 3;

function palettes(): [string, Palette][] {
  return THEME_ORDER.map((t) => [t, Colors[t]]);
}

describe('op_tone covers every tone on every theme', () => {
  it('the tone list matches the notice-duration table', () => {
    expect([...TONES].sort()).toEqual(Object.keys(OP_NOTICE_DURATION_MS).sort());
  });

  it('resolves a complete colour set for every tone x theme', () => {
    for (const [name, C] of palettes()) {
      for (const tone of TONES) {
        const t = opToneColors(C, tone);
        for (const key of ['background', 'border', 'accent', 'title', 'body', 'icon', 'label'] as const) {
          expect(t[key], `${name}/${tone}.${key}`).toBeTruthy();
        }
      }
    }
  });
});

describe('the toast card is an OPAQUE, UNTINTED panel', () => {
  it('every tone background is a flat 6-digit hex, never a wash', () => {
    // A toast floats over arbitrary show content. A translucent container
    // token there would let the deck's pattern grid bleed through and destroy
    // the contrast the tokens were measured for.
    for (const [name, C] of palettes()) {
      for (const tone of TONES) {
        expect(opToneColors(C, tone).background, `${name}/${tone}`).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });

  it('every tone sits on the SAME panel surface', () => {
    // This is the constraint that killed the tinted-card design: filling the
    // card with `errorContainer` put gruvbox's error red at 3.23:1 against its
    // own wash. See the header of styles/op_tone.ts.
    for (const [name, C] of palettes()) {
      for (const tone of TONES) {
        expect(opToneColors(C, tone).background, `${name}/${tone}`).toBe(C.surfaceContainerLow);
      }
    }
  });

  it('the tone still shows in the BORDER, so the card is not anonymous', () => {
    for (const [name, C] of palettes()) {
      expect(opToneColors(C, 'error').border, name).toBe(C.errorContainerBorder);
      expect(opToneColors(C, 'warning').border, name).toBe(C.warningContainerBorder);
    }
  });
});

describe('contrast', () => {
  it('title ink clears AA on its own card in every theme', () => {
    for (const [name, C] of palettes()) {
      for (const tone of TONES) {
        const t = opToneColors(C, tone);
        expect(contrastRatio(t.title, t.background), `${name}/${tone} title on card`)
          .toBeGreaterThanOrEqual(AA_TEXT);
      }
    }
  });

  it('the accent is NEVER used as text ink', () => {
    // The reason the title is `text` and not the tone colour: gruvbox's error
    // red measures 3.82:1 here, and the token layer has never promised `error`
    // as AA text on any surface. Pin the separation so a future "make the
    // title pop" edit has to argue with a failing test.
    for (const [name, C] of palettes()) {
      for (const tone of TONES) {
        const t = opToneColors(C, tone);
        expect(t.title, `${name}/${tone}`).toBe(C.text);
        expect(t.body, `${name}/${tone}`).toBe(C.text);
      }
    }
  });

  it('body ink clears AA on its own card in every theme', () => {
    for (const [name, C] of palettes()) {
      for (const tone of TONES) {
        const t = opToneColors(C, tone);
        expect(contrastRatio(t.body, t.background), `${name}/${tone} body on card`)
          .toBeGreaterThanOrEqual(AA_TEXT);
      }
    }
  });

  it('the accent bar clears the non-text bar against its card', () => {
    for (const [name, C] of palettes()) {
      for (const tone of TONES) {
        const t = opToneColors(C, tone);
        expect(contrastRatio(t.accent, t.background), `${name}/${tone} bar`)
          .toBeGreaterThanOrEqual(AA_NON_TEXT);
      }
    }
  });
});

describe('the tones stay distinguishable', () => {
  it('error and warning never resolve to the same accent', () => {
    // Colour is not the only carrier, but it must still carry.
    for (const [name, C] of palettes()) {
      expect(opToneColors(C, 'error').accent, name)
        .not.toBe(opToneColors(C, 'warning').accent);
    }
  });

  it('every tone names itself in words, for the accessibility label', () => {
    for (const [, C] of palettes()) {
      const labels = TONES.map((t) => opToneColors(C, t).label);
      expect(new Set(labels).size).toBe(TONES.length);
    }
  });

  it('only icon names that exist in the IconSymbol mapping are used', () => {
    // An unmapped SF name renders a blank 0x0 glyph on web — the tone's
    // non-colour carrier would silently disappear on the podium.
    const MAPPED = ['exclamationmark.triangle.fill', 'checkmark.circle.fill'];
    for (const [, C] of palettes()) {
      for (const tone of TONES) {
        expect(MAPPED).toContain(opToneColors(C, tone).icon);
      }
    }
  });
});

describe('the card reads as a panel on light and dark grounds alike', () => {
  it('the tone background tracks the theme, not a fixed dark card', () => {
    for (const [name, C] of palettes()) {
      for (const tone of TONES) {
        const t = opToneColors(C, tone);
        expect(isLightSurface(t.background), `${name}/${tone}`)
          .toBe(isLightSurface(C.surfaceContainerLow));
      }
    }
  });
});
