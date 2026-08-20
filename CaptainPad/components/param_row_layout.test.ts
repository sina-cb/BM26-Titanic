/**
 * param_row_layout.test.ts — the parameter row's layout contract.
 *
 * The row is the deck's and the mixer's densest control, and _190 collapsed it
 * from four stacked lines (KNOB pill / name + badges / author's note / slider)
 * to two: ONE header line, then the slider full width. These tests pin the
 * parts of that contract that can be asserted without a renderer — which is all
 * of the decisions, because the components deliberately hold none of them
 * (CaptainPad's vitest env is plain node and excludes RN `.tsx`).
 *
 * Row widths quoted below were MEASURED against a fresh dist with puppeteer,
 * not guessed — see the report for the capture.
 */
import { describe, it, expect } from 'vitest';
import {
  PARAM_NAME_LEGACY_CAP,
  PARAM_NAME_NUMBER_OF_LINES,
  PARAM_ROW_COMPACT_WIDTH,
  PARAM_ROW_FLEX_WRAP,
  PARAM_ROW_NOTE_WIDTH,
  PARAM_ROW_SLOT_ORDER,
  contrastRatio,
  estimatedChipWidth,
  estimatedNameWidth,
  knobChipAccessibilityLabel,
  knobChipLabel,
  paramChipColors,
  paramDisplayName,
  paramRowMetrics,
  paramRowNameBudget,
  paramRowNameFits,
  paramRowSlots,
  readableInk,
  suggestionChipAccessibilityLabel,
  type ParamRowContent,
} from './param_row_layout';

// The real surfaces, measured.
const DECK_IPAD_LANDSCAPE = 244;   // deck PARAMETERS column @ 1194×834
const DECK_IPAD_12_9 = 295;        // deck PARAMETERS column @ 1366×1024
const DECK_NARROW_TABLET = 155;    // deck PARAMETERS column @ 900×700
const MIXER_STRIP = 329;           // mixer LOCAL PARAMS row @ 1194 and 1366

/** A fully-loaded deck row: knob, name, ◎ add-hint, ♪ chip, ⊞ add-hint, value. */
function fullRow(over: Partial<ParamRowContent> = {}): ParamRowContent {
  return {
    knobNumber: 8,
    name: 'CROSSING',
    statusLabel: '◎',
    suggestionLabel: 'FLUX',
    midiLabel: '⊞',
    trailing: '0.50',
    ...over,
  };
}

describe('the header holds every chip in ONE container', () => {
  it('renders knob, name, status, suggestion and MIDI as slots of one row', () => {
    const slots = paramRowSlots(fullRow(), paramRowMetrics(DECK_IPAD_LANDSCAPE));
    // All five live in the same ordered slot list — there is no second line for
    // any of them, and no surface may reorder them.
    expect(slots).toEqual(['knob', 'name', 'status', 'suggestion', 'midi', 'trailing']);
  });

  it('never emits a slot outside the canonical order', () => {
    const slots = paramRowSlots(fullRow(), paramRowMetrics(MIXER_STRIP));
    const positions = slots.map((s) => PARAM_ROW_SLOT_ORDER.indexOf(s));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(positions.every((p) => p >= 0)).toBe(true);
  });

  it('the name is always present — every other slot is conditional', () => {
    const bare = paramRowSlots({ name: 'AFTERGLOW' }, paramRowMetrics(DECK_IPAD_LANDSCAPE));
    expect(bare).toEqual(['name']);
  });
});

describe('a parameter with no audioSuggestion gets NO placeholder', () => {
  it('omits the suggestion slot entirely', () => {
    const m = paramRowMetrics(DECK_IPAD_LANDSCAPE);
    const slots = paramRowSlots(fullRow({ suggestionLabel: null }), m);
    expect(slots).not.toContain('suggestion');
    expect(slots).toEqual(['knob', 'name', 'status', 'midi', 'trailing']);
  });

  it('gives the freed room back to the NAME rather than holding it empty', () => {
    const m = paramRowMetrics(DECK_IPAD_LANDSCAPE);
    const withSuggestion = paramRowNameBudget(DECK_IPAD_LANDSCAPE, m, fullRow());
    const without = paramRowNameBudget(DECK_IPAD_LANDSCAPE, m, fullRow({ suggestionLabel: null }));
    expect(without).toBeGreaterThan(withSuggestion);
  });

  it('treats an empty-string label as absent (no zero-width chip)', () => {
    const m = paramRowMetrics(DECK_IPAD_LANDSCAPE);
    expect(paramRowSlots(fullRow({ suggestionLabel: '' }), m)).not.toContain('suggestion');
  });
});

describe('FLUX — and every band — reads correctly on the chip', () => {
  // micFlux was the signal that had been silently dead until _184; the chip is
  // the operator's only view of the recommendation, so it gets pinned per band.
  const BANDS = [
    { label: 'LOW', accent: '#34d3b5' },
    { label: 'MID', accent: '#4ea1ff' },
    { label: 'HIGH', accent: '#8b9bff' },
    { label: 'KICK', accent: '#ff5d6c' },
    { label: 'FLUX', accent: '#c084fc' },
  ];

  it('paints FLUX as a loud, filled chip with its own identity colour', () => {
    const colors = paramChipColors('loud', '#c084fc');
    expect(colors.background).toBe('#c084fcff'); // solid, not a 12 % wash
    expect(colors.border).toBe('#c084fc');
  });

  it('keeps every band legible — WCAG AA or better against its own fill', () => {
    for (const { label, accent } of BANDS) {
      const colors = paramChipColors('loud', accent);
      expect(contrastRatio(colors.background.slice(0, 7), colors.text)).toBeGreaterThanOrEqual(4.5);
      // …and the label is never colour-alone: the band word is in the text.
      expect(suggestionChipAccessibilityLabel(label)).toContain(label);
    }
  });

  it('spells the recommendation out for assistive tech, note included', () => {
    expect(suggestionChipAccessibilityLabel('FLUX', 'opens the grand X'))
      .toBe('Pattern suggests audio source FLUX — opens the grand X');
    // No note ⇒ no dangling separator.
    expect(suggestionChipAccessibilityLabel('FLUX')).toBe('Pattern suggests audio source FLUX');
  });

  it('makes the suggestion LOUDER than the KNOB and MIDI chips', () => {
    const m = paramRowMetrics(DECK_IPAD_LANDSCAPE);
    const loud = paramChipColors('loud', '#c084fc');
    const quiet = paramChipColors('quiet', '#7c5cff');
    // Filled vs. an 8 % wash with a 40 % border — the hierarchy is structural.
    expect(loud.background.endsWith('ff')).toBe(true);
    expect(quiet.background.endsWith('14')).toBe(true);
    expect(quiet.border.endsWith('66')).toBe(true);
    // And the loud chip's text is one point larger.
    expect(estimatedChipWidth('♪ FLUX', m, true)).toBeGreaterThan(estimatedChipWidth('♪ FLUX', m));
  });
});

describe('long names ellipsize — they never force a second line', () => {
  it('is structurally incapable of wrapping', () => {
    expect(PARAM_ROW_FLEX_WRAP).toBe('nowrap');
    expect(PARAM_NAME_NUMBER_OF_LINES).toBe(1);
  });

  it('leaves the name real room at standard iPad landscape width', () => {
    const m = paramRowMetrics(DECK_IPAD_LANDSCAPE);
    const budget = paramRowNameBudget(DECK_IPAD_LANDSCAPE, m, fullRow());
    expect(budget).toBeGreaterThan(m.nameMinWidth);
    // The real parameter names on the live deck fit outright — measured
    // against a fully-loaded row (knob + ◎ add-hint + ♪ chip + ⊞ + value).
    for (const name of ['LEVEL', 'CROSSING', 'BEAM WIDTH', 'LOCAL SPEED', 'SAFETY FLOOR']) {
      expect(paramRowNameFits(DECK_IPAD_LANDSCAPE, m, fullRow({ name }))).toBe(true);
    }
  });

  it('gives the widest status chip its room by SHRINKING the name, not wrapping', () => {
    // '◎ ON' + '! OVERRIDE' + '✕' is the widest a mapped, editable deck row
    // gets. The name ellipsizes; nothing else moves.
    const m = paramRowMetrics(DECK_IPAD_LANDSCAPE);
    const mapped = fullRow({ name: 'SAFETY FLOOR', statusLabel: '◎ ON' });
    expect(paramRowNameBudget(DECK_IPAD_LANDSCAPE, m, mapped)).toBeGreaterThan(0);
    expect(paramRowSlots(mapped, m)).toEqual(['knob', 'name', 'status', 'suggestion', 'midi', 'trailing']);
  });

  it('ellipsizes a deliberately long name instead of wrapping or clipping chips', () => {
    const m = paramRowMetrics(DECK_IPAD_LANDSCAPE);
    const long = fullRow({ name: 'CHROMATIC ABERRATION DEPTH 2' });
    expect(paramRowNameFits(DECK_IPAD_LANDSCAPE, m, long)).toBe(false);
    expect(estimatedNameWidth(long.name, m)).toBeGreaterThan(paramRowNameBudget(DECK_IPAD_LANDSCAPE, m, long));
    // The chips are unaffected — they keep their full width and the name is the
    // only slot that gives ground.
    const short = fullRow({ name: 'LEVEL' });
    const fixedLong = DECK_IPAD_LANDSCAPE - paramRowNameBudget(DECK_IPAD_LANDSCAPE, m, long);
    const fixedShort = DECK_IPAD_LANDSCAPE - paramRowNameBudget(DECK_IPAD_LANDSCAPE, m, short);
    expect(fixedLong).toBe(fixedShort);
  });

  it('holds on the 12.9" deck column and the mixer strip too', () => {
    for (const w of [DECK_IPAD_12_9, MIXER_STRIP]) {
      const m = paramRowMetrics(w);
      expect(m.compact).toBe(false);
      expect(paramRowNameBudget(w, m, fullRow())).toBeGreaterThan(m.nameMinWidth);
    }
  });
});

describe('the compact variant — deliberate, not accidental', () => {
  it('engages only below the measured narrow threshold', () => {
    expect(paramRowMetrics(DECK_NARROW_TABLET).compact).toBe(true);
    expect(paramRowMetrics(DECK_IPAD_LANDSCAPE).compact).toBe(false);
    expect(paramRowMetrics(PARAM_ROW_COMPACT_WIDTH).compact).toBe(false);
    expect(paramRowMetrics(PARAM_ROW_COMPACT_WIDTH - 1).compact).toBe(true);
  });

  it('an UNMEASURED row (first paint) resolves regular, so rows do not jitter', () => {
    expect(paramRowMetrics(0).compact).toBe(false);
    expect(paramRowMetrics(-1).compact).toBe(false);
  });

  it('shortens the knob chip but never the spoken label', () => {
    expect(knobChipLabel(7, paramRowMetrics(DECK_IPAD_LANDSCAPE))).toBe('KNOB 7');
    expect(knobChipLabel(7, paramRowMetrics(DECK_NARROW_TABLET))).toBe('K7');
    expect(knobChipAccessibilityLabel(7)).toBe('MIDI knob 7');
  });

  it('still fits the whole row on the narrow tablet deck column', () => {
    const m = paramRowMetrics(DECK_NARROW_TABLET);
    expect(paramRowNameBudget(DECK_NARROW_TABLET, m, fullRow())).toBeGreaterThan(0);
  });

  it('drops the note and the live ghost readout rather than crowd the name', () => {
    const compact = paramRowMetrics(DECK_NARROW_TABLET);
    expect(compact.showNote).toBe(false);
    expect(compact.showGhostReadout).toBe(false);
  });
});

describe('the author’s note rides the header slack, or nothing', () => {
  it('is omitted on every row too narrow to hold it', () => {
    for (const w of [DECK_NARROW_TABLET, DECK_IPAD_LANDSCAPE, DECK_IPAD_12_9, MIXER_STRIP]) {
      const m = paramRowMetrics(w);
      expect(paramRowSlots(fullRow({ note: 'opens the grand X' }), m)).not.toContain('note');
    }
  });

  it('appears once the row is genuinely wide', () => {
    const m = paramRowMetrics(PARAM_ROW_NOTE_WIDTH);
    expect(m.showNote).toBe(true);
    expect(paramRowSlots(fullRow({ note: 'opens the grand X' }), m)).toContain('note');
  });

  it('never appears without a note to show', () => {
    const m = paramRowMetrics(PARAM_ROW_NOTE_WIDTH);
    expect(paramRowSlots(fullRow(), m)).not.toContain('note');
  });
});

describe('paramDisplayName — the uncapped display transform', () => {
  it('renders the migrated 13_sparkle names as plain words', () => {
    expect(paramDisplayName('sliderStarCount')).toBe('STAR COUNT');
    expect(paramDisplayName('sliderLevel')).toBe('LEVEL');
    expect(paramDisplayName('sliderBrilliance')).toBe('BRILLIANCE');
  });

  it('strips the _vN suffix and splits a trailing index', () => {
    expect(paramDisplayName('sliderColorVariation_v2')).toBe('COLOR VARIATION');
    expect(paramDisplayName('sliderColorPalette1')).toBe('COLOR PALETTE 1');
  });

  it('does NOT chop mid-word at 15 characters the way the legacy namer does', () => {
    // The legacy fixed-width form is still exported for the surfaces that need
    // a predictable label length; the ROW uses the full name and lets the
    // layout ellipsize, so a long parameter reads as far as the row allows.
    const raw = 'sliderChromaticAberrationDepth';
    expect(paramDisplayName(raw)).toBe('CHROMATIC ABERRATION DEPTH');
    expect(paramDisplayName(raw).substring(0, PARAM_NAME_LEGACY_CAP)).toBe('CHROMATIC ABERR');
  });

  it('is byte-identical to the legacy namer once capped (no behaviour drift)', () => {
    // Mirrors utils/audio_suggestion_labels.test.ts, which pins the capped form.
    const cap = (s: string) => paramDisplayName(s).substring(0, PARAM_NAME_LEGACY_CAP);
    expect(cap('sliderFLUX_StarCount')).toBe('F L U X_ STAR C');
    expect(cap('sliderLOW_Level')).toBe('L O W_ LEVEL');
    expect(cap('sliderKICK_Burst')).toBe('K I C K_ BURST');
    expect(cap('sliderStarCount')).toBe('STAR COUNT');
  });
});

describe('readable ink on a filled chip', () => {
  it('picks the higher-contrast of near-black / white', () => {
    // A bright band gets dark ink; a dark fill gets white.
    expect(readableInk('#34d3b5')).toBe('#0b0f10');
    expect(readableInk('#00a86b')).toBe('#0b0f10');
    expect(readableInk('#003640')).toBe('#ffffff');
  });

  it('refuses a malformed colour loudly rather than guessing (codex P0)', () => {
    expect(() => readableInk('teal')).toThrow(/#rrggbb/);
    expect(() => paramChipColors('ghost', '#000000')).toThrow(/palette colours/);
  });

  it('clears WCAG AA for the modulation green the ◎ ON pill fills with', () => {
    expect(contrastRatio('#00a86b', readableInk('#00a86b'))).toBeGreaterThanOrEqual(4.5);
  });
});
