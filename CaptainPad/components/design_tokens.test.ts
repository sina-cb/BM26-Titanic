// design_tokens — the contract behind the docs/54 restyle token layer.
//
// WHY THIS FILE IS IN components/. It tests `constants/theme.ts`,
// `constants/identity.ts` and `styles/design_recipes.ts`, none of which live
// here — but vitest's include globs are `utils/*.test.ts`,
// `utils/midi/**`, `components/**/*.test.ts` and `hooks/**` (see
// vitest.config.ts), so a `constants/*.test.ts` would never run. It sits
// beside `param_row_layout.test.ts`, which is the same kind of file: the
// pinned design contract for a system whose components cannot be
// render-tested in a node env.
//
// WHAT IT PINS
//   1. Palette completeness — every theme carries every key. A missing key
//      is a crash at paint time (Codex P0: no fallbacks), so it is caught
//      here instead.
//   2. The NEW tokens clear WCAG AA on every theme: `warning` +
//      `warningContainer`/`warningContainerBorder` as text (4.5:1), and
//      `borderStrong` as a UI-component boundary (3:1, WCAG 1.4.11).
//   3. The accentWash/accentFill contrast table over all five palettes.
//   4. The identity hexes have not drifted from the component literals they
//      document.
//   5. The shape/rhythm/type scales — notably chip radius 4, frozen by _190.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Colors, Fonts, Radius, Space, THEME_ORDER, Type, type Palette } from '@/constants/theme';
import { AUDIO_BAND_ACCENT, MIDI_ACCENT, PANIC_AMBER, PLAN_ACCENT } from '@/constants/identity';
import { ACCENT_AUTO, COMPANION_ACCENT } from '@/utils/audioSignals';
import {
  accentFill, accentWash, alphaSuffix, contrastRatio, flattenOver, glowFor,
  identityDot, isLightSurface, readableInk, withAlpha,
  GLOW_ALPHA, GLOW_BLUR, WASH_BORDER_ALPHA, WASH_FILL_ALPHA,
} from '@/styles/design_recipes';

// ── fixtures ────────────────────────────────────────────────────────

const THEMES = THEME_ORDER;

/** Every OPAQUE ground a chip / label / border can land on. Contrast is a
 *  question about a composite, so the surface list is the axis every colour
 *  assertion below sweeps. */
const SURFACE_KEYS = [
  'background', 'surface', 'surfaceContainerLow', 'surfaceContainerLowest',
  'surfaceContainerHigh', 'surfaceDim',
] as const;

function surfacesOf(p: Palette): { key: string; hex: string }[] {
  return SURFACE_KEYS.map((k) => ({ key: k, hex: p[k] }));
}

/** WCAG AA for normal text. Chip labels are 8–10 pt bold caps — small text,
 *  so 4.5 is the honest bar, not 3. */
const AA_TEXT = 4.5;
/** WCAG 1.4.11 non-text contrast: UI component boundaries and state borders. */
const AA_NON_TEXT = 3;

// ── 1. palette completeness ─────────────────────────────────────────

describe('palette completeness', () => {
  it('the theme registry and the palette map agree', () => {
    expect([...THEMES].sort()).toEqual(Object.keys(Colors).sort());
  });

  it('every theme carries exactly the light theme’s key set', () => {
    const reference = Object.keys(Colors.light).sort();
    for (const t of THEMES) {
      expect(Object.keys(Colors[t]).sort(), `theme ${t}`).toEqual(reference);
    }
  });

  it('every token is a non-empty colour string', () => {
    for (const t of THEMES) {
      for (const [k, v] of Object.entries(Colors[t])) {
        expect(typeof v, `${t}.${k}`).toBe('string');
        expect(v.length, `${t}.${k}`).toBeGreaterThan(0);
        // Parseable by the recipe layer — an unparseable token throws.
        expect(() => flattenOver(v, '#ffffff'), `${t}.${k}`).not.toThrow();
      }
    }
  });

  it('carries the docs/54 additions on every theme', () => {
    for (const t of THEMES) {
      const p = Colors[t];
      expect(p.warning, `${t}.warning`).toMatch(/^#[0-9a-f]{6}$/i);
      expect(p.warningContainer, `${t}.warningContainer`).toMatch(/^rgba\(/);
      expect(p.warningContainerBorder, `${t}.warningContainerBorder`).toMatch(/^rgba\(/);
      expect(p.borderStrong, `${t}.borderStrong`).toMatch(/^rgba\(/);
    }
  });
});

// ── 2. the warning family clears AA everywhere ──────────────────────

/** The rgb triple of an `rgba(...)`/hex colour, as `r,g,b`. */
function rgbOf(color: string): string {
  const flat = flattenOver(color.replace(/,\s*[\d.]+\s*\)$/, ', 1)'), '#000000');
  return flat;
}

describe('warning family (docs/54 §1.1)', () => {
  it('warning reads as text on every surface of every theme', () => {
    for (const t of THEMES) {
      const p = Colors[t];
      for (const s of surfacesOf(p)) {
        expect(contrastRatio(p.warning, s.hex), `${t}.warning on ${s.key}`)
          .toBeGreaterThanOrEqual(AA_TEXT);
      }
    }
  });

  it('warning reads as text ON its own container, on every surface', () => {
    for (const t of THEMES) {
      const p = Colors[t];
      for (const s of surfacesOf(p)) {
        const filled = flattenOver(p.warningContainer, s.hex);
        expect(contrastRatio(p.warning, filled), `${t}.warning on warningContainer/${s.key}`)
          .toBeGreaterThanOrEqual(AA_TEXT);
      }
    }
  });

  it('a filled warning derives readable ink', () => {
    for (const t of THEMES) {
      const fill = accentFill(Colors[t].warning);
      expect(contrastRatio(fill.backgroundColor, fill.color), `${t} filled warning`)
        .toBeGreaterThanOrEqual(AA_TEXT);
    }
  });

  it('the container pair is the warning colour at two alphas — never a third hue', () => {
    for (const t of THEMES) {
      const p = Colors[t];
      // Same rgb as `warning` (composited on black at full alpha = the rgb).
      expect(rgbOf(p.warningContainer), `${t}.warningContainer rgb`).toBe(p.warning.toLowerCase());
      expect(rgbOf(p.warningContainerBorder), `${t}.warningContainerBorder rgb`).toBe(p.warning.toLowerCase());
      // The border is the louder of the two, as with the error pair.
      const alpha = (c: string) => Number(/,\s*([\d.]+)\s*\)$/.exec(c)![1]);
      expect(alpha(p.warningContainerBorder), `${t} border alpha`)
        .toBeGreaterThan(alpha(p.warningContainer));
    }
  });

  it('warning is not a restatement of primary or error', () => {
    for (const t of THEMES) {
      const p = Colors[t];
      expect(contrastRatio(p.warning, p.primary) !== 1 || p.warning !== p.primary, t).toBe(true);
      expect(p.warning.toLowerCase(), `${t}.warning vs primary`).not.toBe(p.primary.toLowerCase());
      expect(p.warning.toLowerCase(), `${t}.warning vs error`).not.toBe(p.error.toLowerCase());
    }
  });
});

// ── 3. borderStrong is a signal, ghostBorder is decoration ──────────

describe('borderStrong (docs/54 §1.1)', () => {
  it('clears non-text contrast against every surface of every theme', () => {
    for (const t of THEMES) {
      const p = Colors[t];
      for (const s of surfacesOf(p)) {
        const composited = flattenOver(p.borderStrong, s.hex);
        expect(contrastRatio(composited, s.hex), `${t}.borderStrong on ${s.key}`)
          .toBeGreaterThanOrEqual(AA_NON_TEXT);
      }
    }
  });

  it('is strictly stronger than ghostBorder on every surface', () => {
    for (const t of THEMES) {
      const p = Colors[t];
      for (const s of surfacesOf(p)) {
        const strong = contrastRatio(flattenOver(p.borderStrong, s.hex), s.hex);
        const ghost = contrastRatio(flattenOver(p.ghostBorder, s.hex), s.hex);
        expect(strong, `${t} borderStrong vs ghostBorder on ${s.key}`).toBeGreaterThan(ghost);
      }
    }
  });
});

// ── 4. the accentWash / accentFill contrast table ───────────────────

/** Every accent a wash or fill is legitimately built from: the palette's own
 *  accents plus the fixed identity hexes (which can land on ANY theme —
 *  that is what makes them identity). */
function accentsFor(t: (typeof THEMES)[number]): Record<string, string> {
  const p = Colors[t];
  return {
    primary: p.primary, tertiary: p.tertiary, error: p.error, warning: p.warning,
    midi: MIDI_ACCENT, plan: PLAN_ACCENT, panic: PANIC_AMBER,
    ...AUDIO_BAND_ACCENT,
  };
}

/** The accents that are allowed to FILL a small-text control. MIDI violet is
 *  excluded on measurement, not taste — see the quiet-only test below. */
function fillEligibleAccents(t: (typeof THEMES)[number]): Record<string, string> {
  const { midi, ...rest } = accentsFor(t);
  void midi;
  return rest;
}

describe('accentWash / accentFill', () => {
  it('washes at the documented alphas and keeps the accent as ink', () => {
    const w = accentWash('#22c1d6');
    expect(w.backgroundColor).toBe(`#22c1d6${alphaSuffix(WASH_FILL_ALPHA)}`);
    expect(w.borderColor).toBe(`#22c1d6${alphaSuffix(WASH_BORDER_ALPHA)}`);
    expect(w.color).toBe('#22c1d6');
    expect(alphaSuffix(WASH_FILL_ALPHA)).toBe('24');   // 14 %
    expect(alphaSuffix(WASH_BORDER_ALPHA)).toBe('73'); // 45 %
  });

  it('rejects an accent that is not a plain #rrggbb — loudly', () => {
    expect(() => accentWash('rgba(34, 193, 214, 0.4)')).toThrow();
    expect(() => withAlpha('#22c1d6ff', 0.5)).toThrow();
  });

  it('EVERY fill-eligible accent clears AA when filled, on EVERY theme', () => {
    for (const t of THEMES) {
      for (const [name, accent] of Object.entries(fillEligibleAccents(t))) {
        const fill = accentFill(accent);
        expect(fill.color, `${t}/${name} ink`).toBe(readableInk(accent));
        expect(contrastRatio(fill.backgroundColor, fill.color), `${t}/${name} filled`)
          .toBeGreaterThanOrEqual(AA_TEXT);
      }
    }
  });

  // MEASURED, not stylistic: '#7c5cff' sits in the band where neither
  // near-black nor white reaches 4.5:1 — its best derived ink is ~4.43:1. The
  // _190 system already only ever paints it QUIET (outlined KNOB / ⊞ MIDI
  // chips), where the ink is the violet itself on the surface. This pins that
  // rule so a future filled violet chip fails here instead of on the playa.
  it('MIDI violet is quiet-only — it cannot carry small text as a fill', () => {
    expect(contrastRatio(MIDI_ACCENT, readableInk(MIDI_ACCENT))).toBeLessThan(AA_TEXT);
    expect(contrastRatio(MIDI_ACCENT, readableInk(MIDI_ACCENT))).toBeGreaterThanOrEqual(AA_NON_TEXT);
  });

  // The wash keeps the ACCENT as its ink, so its contrast is the accent's own
  // against the surface — a tint, not a repaint. What must never happen is a
  // wash turning an AA-clearing accent into unreadable text. Where an accent
  // does NOT clear AA raw on a surface (light-theme identity hexes are the
  // known case — see DESIGN.md "known contrast gaps"), the loud/filled tone
  // is the one to use, which is what the _190 chips already do.
  it('the wash never drops an AA-clearing accent below the large-text floor', () => {
    for (const t of THEMES) {
      const p = Colors[t];
      for (const [name, accent] of Object.entries(accentsFor(t))) {
        for (const s of surfacesOf(p)) {
          const raw = contrastRatio(accent, s.hex);
          if (raw < AA_TEXT) continue;
          const washed = flattenOver(accentWash(accent).backgroundColor, s.hex);
          expect(contrastRatio(accent, washed), `${t}/${name} washed on ${s.key}`)
            .toBeGreaterThanOrEqual(AA_NON_TEXT);
        }
      }
    }
  });

  it('glowFor is the one sanctioned glow shape', () => {
    expect(glowFor('#5ae0ee')).toBe(`0px 0px ${GLOW_BLUR}px #5ae0ee${alphaSuffix(GLOW_ALPHA)}`);
  });
});

// ── 5. identity hexes have not drifted ──────────────────────────────

/** Read a component's source and prove the identity constant it declares is
 *  still the value `constants/identity.ts` documents — OR that the file has
 *  already been migrated to import from the identity module (which is what
 *  docs/54 slice R1 does). Either state is correct; a THIRD value is drift,
 *  and drift is exactly what a documentation module is supposed to prevent. */
function expectIdentityAnchor(relPath: string, localName: string, expected: string): void {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), relPath), 'utf8');
  if (/from ['"](?:@\/|\.\.?\/)[^'"]*constants\/identity['"]/.test(src)) return;
  const m = new RegExp(`${localName}\\s*=\\s*'(#[0-9a-fA-F]{6})'`).exec(src);
  expect(m, `${relPath} should declare ${localName} or import constants/identity`).not.toBeNull();
  expect((m as RegExpExecArray)[1].toLowerCase(), `${relPath}:${localName}`).toBe(expected.toLowerCase());
}

describe('identity colours (constants/identity.ts)', () => {
  it('re-exports the audio bands rather than copying them', () => {
    expect(AUDIO_BAND_ACCENT).toBe(COMPANION_ACCENT);
    expect(ACCENT_AUTO).toBe('#1b9e77');
  });

  it('MIDI violet matches the shipped param-chip accent', () => {
    expect(MIDI_ACCENT).toBe('#7c5cff');
    expectIdentityAnchor('./ui/param_chips.tsx', 'PARAM_CHIP_MIDI_ACCENT', MIDI_ACCENT);
  });

  it('plan cyan matches the shipped plan pill', () => {
    expectIdentityAnchor('./timeline/PlanIndicatorPill.tsx', 'PLAN_CYAN', PLAN_ACCENT);
  });

  it('keeps panic amber reserved without exposing a Deck or Mixer PANIC control', () => {
    const root = dirname(fileURLToPath(import.meta.url));
    const deck = readFileSync(join(root, '../app/(tabs)/index.tsx'), 'utf8');
    const mixer = readFileSync(join(root, '../app/(tabs)/mixer.tsx'), 'utf8');
    expect(PANIC_AMBER).toMatch(/^#[0-9A-F]{6}$/i);
    expect(deck).not.toContain('PANIC_AMBER');
    expect(mixer).not.toContain('PANIC_AMBER');
  });

  it('the plan-lock banner is on the theme-aware warning family, not a fixed amber', () => {
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), './PlanLockBanner.tsx'),
      'utf8',
    );
    expect(src, 'banner uses the warning token').toMatch(/C\.warning\b/);
    expect(src, 'banner derives its ink').toMatch(/readableInk\(/);
    // The specific literals R1 retired: the loud amber, its hand-picked
    // darker rule, and the ten '#1a1a1a' inks (plus their rgba twin).
    // A plain black DROP SHADOW is not a palette colour and is allowed —
    // `globalStyles.panel` spells one too.
    for (const dead of [/#f5a623/i, /#9a6a12/i, /#8a6a1f/i, /#1a1a1a/i, /rgba\(\s*245\s*,/i, /rgba\(\s*26\s*,\s*26\s*,\s*26/i]) {
      expect(src, `banner still carries ${dead}`).not.toMatch(dead);
    }
  });

  it('is a CLOSED list — identity hexes are fixed, so their ink is derived', () => {
    const identity = { PLAN_ACCENT, PANIC_AMBER, ...AUDIO_BAND_ACCENT };
    for (const [name, hex] of Object.entries(identity)) {
      expect(hex, name).toMatch(/^#[0-9a-f]{6}$/i);
      expect(contrastRatio(hex, readableInk(hex)), `${name} derived ink`)
        .toBeGreaterThanOrEqual(AA_TEXT);
    }
    // MIDI violet is in the list but is quiet-only (see above).
    expect(MIDI_ACCENT).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

// ── 6. shape, rhythm and type scales ────────────────────────────────

describe('Radius / Space / Type scales', () => {
  it('keeps the chip radius the _190 tests froze', () => {
    expect(Radius.chip).toBe(4);
  });

  it('is a strictly ascending scale in both axes', () => {
    const radii = [Radius.chip, Radius.control, Radius.card, Radius.panel, Radius.shell];
    const spaces = [Space.xs, Space.sm, Space.md, Space.lg, Space.xl];
    for (const scale of [radii, spaces]) {
      for (let i = 1; i < scale.length; i += 1) {
        expect(scale[i]).toBeGreaterThan(scale[i - 1]);
      }
    }
    // 4-based: every step is a multiple of 4.
    for (const v of [...radii, ...spaces]) expect(v % 4).toBe(0);
  });

  it('codifies the recipes the app already converged on', () => {
    expect(Type.labelCaps).toEqual({
      fontFamily: Fonts.headline, fontSize: 10, letterSpacing: 1.2, textTransform: 'uppercase',
    });
    expect(Type.microCaps).toEqual({
      fontFamily: Fonts.headline, fontSize: 9, letterSpacing: 1.5, textTransform: 'uppercase',
    });
    expect(Type.headline).toEqual({
      fontFamily: Fonts.headline, fontSize: 20, letterSpacing: 1, textTransform: 'uppercase',
    });
    expect(Type.valueText.fontFamily).toBe(Fonts.bodySemibold);
    // docs/54 §4 big-button scale for the Events tab.
    expect(Type.bigButton.fontSize).toBe(16);
    expect(Type.ceremonial.fontSize).toBe(20);
  });

  it('only SpaceGrotesk and Inter — no third family sneaks in', () => {
    for (const recipe of Object.values(Type)) {
      expect(Object.values(Fonts)).toContain(recipe.fontFamily);
    }
  });
});

// ── 7. the recipe primitives ────────────────────────────────────────

describe('design recipe primitives', () => {
  it('flattens translucent colours over an opaque backdrop', () => {
    expect(flattenOver('#ffffff', '#000000')).toBe('#ffffff');
    expect(flattenOver('rgba(255, 255, 255, 0.5)', '#000000')).toBe('#808080');
    expect(flattenOver('#00000080', '#ffffff')).toBe('#7f7f7f');
    expect(flattenOver('#fff', '#000000')).toBe('#ffffff');
  });

  it('refuses a translucent backdrop instead of guessing what is behind it', () => {
    expect(() => flattenOver('#ffffff', 'rgba(0,0,0,0.5)')).toThrow();
    expect(() => flattenOver('not-a-colour', '#ffffff')).toThrow();
  });

  it('knows a light base from a dark one', () => {
    expect(isLightSurface(Colors.light.background)).toBe(true);
    for (const t of ['dark', 'midnight', 'sunset', 'gruvbox'] as const) {
      expect(isLightSurface(Colors[t].background), t).toBe(false);
    }
  });

  it('draws a round identity dot', () => {
    expect(identityDot('#7c5cff')).toEqual({
      width: 8, height: 8, borderRadius: 4, backgroundColor: '#7c5cff',
    });
    expect(identityDot('#7c5cff', 12).borderRadius).toBe(6);
  });
});
