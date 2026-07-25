// Tests for the shared view-selection picker logic (BM readiness W1).
//
// Covers: namedViews validation/parse, family classification, apply-path
// resolution (group vs viewMask), active-row detection, sectioning + ordering,
// search filtering, and the fail-loud `missing` flag when the engine payload
// omits `namedViews`. Pure logic, no react-native — runs under vitest's
// `components/**/*.test.ts` glob.

import { describe, it, expect } from 'vitest';
import {
  NamedView,
  isValidNamedView,
  classifyNamedView,
  viewSelectionForNamedView,
  isNamedViewActive,
  isAllActive,
  buildViewPickerSections,
  namedViewMemberLabel,
  VIEW_FAMILY_ORDER,
} from './view_selection_picker_logic';

// A trimmed stand-in for a titanic-scale namedViews payload. Mirrors the real
// GET /model/view-selection-options shape (verified live against test_bench):
// base groups (kind:'group'), composites (kind:'composite'), and the Tier-A
// auto-view pixelSets (kind:'pixelSet', bit:0).
function makeNamedViews(): NamedView[] {
  return [
    { name: 'ParLights', kind: 'group', bit: 1, memberCount: 4 },
    { name: 'Left_Front_Wall', kind: 'group', bit: 2, memberCount: 40 },
    { name: 'Right_Front_Wall', kind: 'group', bit: 4, memberCount: 40 },
    { name: 'ParsBars', kind: 'composite', bit: 8, memberCount: 40 },
    { name: 'PORT', kind: 'pixelSet', bit: 0, memberCount: 560 },
    { name: 'STARBOARD', kind: 'pixelSet', bit: 0, memberCount: 560 },
    { name: 'LEFT', kind: 'pixelSet', bit: 0, memberCount: 35 },
    { name: 'RIGHT', kind: 'pixelSet', bit: 0, memberCount: 45 },
    { name: 'WALLS', kind: 'pixelSet', bit: 0, memberCount: 320 },
    { name: 'CHIMNEYS', kind: 'pixelSet', bit: 0, memberCount: 80 },
    { name: '@PAR', kind: 'pixelSet', bit: 0, memberCount: 4 },
    { name: '@BAR', kind: 'pixelSet', bit: 0, memberCount: 36 },
    { name: 'BAND_LOW', kind: 'pixelSet', bit: 0, memberCount: 52 },
    { name: 'BAND_MID', kind: 'pixelSet', bit: 0, memberCount: 40 },
    { name: 'BAND_HIGH', kind: 'pixelSet', bit: 0, memberCount: 40 },
    { name: 'Front_Wall_BOTH', kind: 'composite', bit: 0, memberCount: 80 },
    { name: 'CTRL_1', kind: 'pixelSet', bit: 0, memberCount: 52 },
    { name: 'CTRL_2', kind: 'pixelSet', bit: 0, memberCount: 80 },
  ];
}

describe('isValidNamedView', () => {
  it('accepts a well-formed entry', () => {
    expect(isValidNamedView({ name: 'PORT', kind: 'pixelSet', bit: 0, memberCount: 10 })).toBe(true);
  });

  it('rejects entries missing a name, kind, or numeric fields', () => {
    expect(isValidNamedView({ name: '', kind: 'group', bit: 0, memberCount: 1 })).toBe(false);
    expect(isValidNamedView({ name: 'X', kind: 5, bit: 0, memberCount: 1 })).toBe(false);
    expect(isValidNamedView({ name: 'X', kind: 'group', bit: 'nope', memberCount: 1 })).toBe(false);
    expect(isValidNamedView({ name: 'X', kind: 'group', bit: 0, memberCount: null })).toBe(false);
    expect(isValidNamedView(null)).toBe(false);
    expect(isValidNamedView('PORT')).toBe(false);
  });
});

describe('classifyNamedView', () => {
  const cases: [string, string, string][] = [
    // [name, kind, expectedFamily]
    ['CTRL_5', 'pixelSet', 'controllers'],
    ['@VINTAGE', 'pixelSet', 'types'],
    ['BAND_HIGH', 'pixelSet', 'bands'],
    ['Front_Wall_BOTH', 'composite', 'pairs'],
    ['PORT', 'pixelSet', 'sides'],
    ['LEFT', 'pixelSet', 'sides'],
    ['WALLS', 'pixelSet', 'structure'],
    ['AUDITORIUM', 'pixelSet', 'structure'],
    ['Left_Front_Wall', 'group', 'groups'],
    ['ParsBars', 'composite', 'composites'],
    ['weird', 'pixelSet', 'other'],
  ];
  it.each(cases)('classifies %s (%s) → %s', (name, kind, fam) => {
    expect(classifyNamedView({ name, kind, bit: 0, memberCount: 1 })).toBe(fam);
  });

  it('name pattern beats kind (a composite named _BOTH is a pair, not a composite)', () => {
    expect(classifyNamedView({ name: 'X_BOTH', kind: 'composite', bit: 0, memberCount: 1 })).toBe('pairs');
  });
});

describe('viewSelectionForNamedView', () => {
  it('routes base groups through type:group (unchanged behavior)', () => {
    const v = viewSelectionForNamedView({ name: 'Left_Front_Wall', kind: 'group', bit: 2, memberCount: 40 });
    expect(v).toEqual({ type: 'group', target: 'Left_Front_Wall', invert: false });
  });

  it('routes composites/pixelSets through type:viewMask by name', () => {
    expect(viewSelectionForNamedView({ name: 'PORT', kind: 'pixelSet', bit: 0, memberCount: 5 }))
      .toEqual({ type: 'viewMask', target: 'PORT', invert: false });
    expect(viewSelectionForNamedView({ name: 'ParsBars', kind: 'composite', bit: 8, memberCount: 40 }))
      .toEqual({ type: 'viewMask', target: 'ParsBars', invert: false });
  });
});

describe('isNamedViewActive', () => {
  const group: NamedView = { name: 'Left_Front_Wall', kind: 'group', bit: 2, memberCount: 40 };
  const auto: NamedView = { name: 'PORT', kind: 'pixelSet', bit: 0, memberCount: 5 };

  it('matches a group only via type:group', () => {
    expect(isNamedViewActive(group, { type: 'group', target: 'Left_Front_Wall' })).toBe(true);
    expect(isNamedViewActive(group, { type: 'viewMask', target: 'Left_Front_Wall' })).toBe(false);
  });

  it('matches an auto-view only via type:viewMask', () => {
    expect(isNamedViewActive(auto, { type: 'viewMask', target: 'PORT' })).toBe(true);
    expect(isNamedViewActive(auto, { type: 'group', target: 'PORT' })).toBe(false);
  });

  it('is false for null / mismatched target', () => {
    expect(isNamedViewActive(auto, null)).toBe(false);
    expect(isNamedViewActive(auto, { type: 'viewMask', target: 'STARBOARD' })).toBe(false);
  });
});

describe('isAllActive', () => {
  it('treats null/undefined and {type:all} as ALL', () => {
    expect(isAllActive(null)).toBe(true);
    expect(isAllActive(undefined)).toBe(true);
    expect(isAllActive({ type: 'all', target: null })).toBe(true);
  });
  it('is false for a real selection', () => {
    expect(isAllActive({ type: 'viewMask', target: 'PORT' })).toBe(false);
  });
});

describe('buildViewPickerSections', () => {
  it('sections a full catalog in family order, dropping empty families', () => {
    const model = buildViewPickerSections(makeNamedViews());
    expect(model.missing).toBe(false);
    const keys = model.sections.map((s) => s.key);
    // Only families with entries appear, and they follow VIEW_FAMILY_ORDER.
    expect(keys).toEqual([...VIEW_FAMILY_ORDER].filter((k) => keys.includes(k)));
    expect(keys).toContain('sides');
    expect(keys).toContain('structure');
    expect(keys).toContain('bands');
    expect(keys).toContain('types');
    expect(keys).toContain('pairs');
    expect(keys).toContain('controllers');
    expect(keys).toContain('groups');
    expect(keys).toContain('composites');
    expect(model.totalCount).toBe(18);
    expect(model.totalUnfiltered).toBe(18);
  });

  it('orders HEIGHT BANDS LOW→MID→HIGH, not alphabetically', () => {
    const model = buildViewPickerSections(makeNamedViews());
    const bands = model.sections.find((s) => s.key === 'bands')!;
    expect(bands.entries.map((e) => e.name)).toEqual(['BAND_LOW', 'BAND_MID', 'BAND_HIGH']);
  });

  it('filters by case-insensitive substring and keeps totalUnfiltered', () => {
    const model = buildViewPickerSections(makeNamedViews(), { query: 'band' });
    expect(model.totalCount).toBe(3);
    expect(model.totalUnfiltered).toBe(18);
    expect(model.sections.map((s) => s.key)).toEqual(['bands']);
  });

  it('drops malformed entries', () => {
    const dirty = [
      { name: 'PORT', kind: 'pixelSet', bit: 0, memberCount: 5 },
      { name: '', kind: 'group', bit: 0, memberCount: 1 },
      { foo: 'bar' },
    ] as unknown as NamedView[];
    const model = buildViewPickerSections(dirty);
    expect(model.totalUnfiltered).toBe(1);
  });

  it('flags a missing namedViews field loudly (fail-visible)', () => {
    expect(buildViewPickerSections(undefined).missing).toBe(true);
    expect(buildViewPickerSections(null).missing).toBe(true);
    expect(buildViewPickerSections([]).missing).toBe(false);
    // An empty (but present) array is a legitimate "no views" state.
    expect(buildViewPickerSections([]).sections).toEqual([]);
  });
});

describe('namedViewMemberLabel', () => {
  it('renders a pixel count when the mask has members', () => {
    expect(namedViewMemberLabel({ name: 'LEFT', kind: 'pixelSet', bit: 0, memberCount: 35 })).toBe('35 px');
  });
  it('renders EMPTY for a zero-member (dead) view', () => {
    expect(namedViewMemberLabel({ name: 'DEAD', kind: 'pixelSet', bit: 0, memberCount: 0 })).toBe('EMPTY');
  });
});
