// Tests for the shared view-selection picker logic (BM readiness W1).
//
// Covers: namedViews validation/parse, family classification, apply-path
// resolution (group vs viewMask), active-row detection, sectioning + ordering,
// search filtering, and the fail-loud `missing` flag when the engine payload
// omits `namedViews`. Pure logic, no react-native — runs under vitest's
// `components/**/*.test.ts` glob.
//
// Catalog vocabulary follows report 20260804_145: LEFT/RIGHT are the
// exhaustive whole-ship halves, FRONT/BACK the ends, `Strands` / `TE Signs` /
// `@PAR` / `@BAR` / `@VINTAGE` the fixture types. PORT/STARBOARD, FORE/AFT,
// BAND_* and `<base>_BOTH` no longer exist anywhere in the catalog.
//
// The STRUCTURE cases below are CLASSIFIER tests over a synthetic payload —
// they pin that a `WALLS`/`CHIMNEYS` row lands in STRUCTURE if an engine
// sends one. Titanic itself sends none: report 20260804_148 retired its
// WALLS/AUDITORIUM as exact duplicates of `Hull Canvas`/`Auditoriums`.

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
// GET /model/view-selection-options shape: base groups (kind:'group'),
// composites (kind:'composite'), and the Tier-A auto-view pixelSets
// (kind:'pixelSet', bit:0).
function makeNamedViews(): NamedView[] {
  return [
    { name: 'ParLights', kind: 'group', bit: 1, memberCount: 4 },
    { name: 'Left_Front_Wall', kind: 'group', bit: 2, memberCount: 40 },
    { name: 'Right_Front_Wall', kind: 'group', bit: 4, memberCount: 40 },
    { name: 'ParsBars', kind: 'composite', bit: 8, memberCount: 40 },
    { name: 'LEFT', kind: 'pixelSet', bit: 0, memberCount: 482 },
    { name: 'RIGHT', kind: 'pixelSet', bit: 0, memberCount: 482 },
    { name: 'FRONT', kind: 'pixelSet', bit: 0, memberCount: 388 },
    { name: 'BACK', kind: 'pixelSet', bit: 0, memberCount: 388 },
    { name: 'WALLS', kind: 'composite', bit: 0, memberCount: 320 },
    { name: 'CHIMNEYS', kind: 'composite', bit: 0, memberCount: 80 },
    { name: '@PAR', kind: 'pixelSet', bit: 0, memberCount: 4 },
    { name: '@BAR', kind: 'pixelSet', bit: 0, memberCount: 36 },
    { name: 'Strands', kind: 'pixelSet', bit: 0, memberCount: 320 },
    { name: 'TE Signs', kind: 'pixelSet', bit: 0, memberCount: 148 },
    { name: 'CTRL_1', kind: 'pixelSet', bit: 0, memberCount: 52 },
    { name: 'CTRL_2', kind: 'pixelSet', bit: 0, memberCount: 80 },
  ];
}

describe('isValidNamedView', () => {
  it('accepts a well-formed entry', () => {
    expect(isValidNamedView({ name: 'LEFT', kind: 'pixelSet', bit: 0, memberCount: 10 })).toBe(true);
  });

  it('rejects entries missing a name, kind, or numeric fields', () => {
    expect(isValidNamedView({ name: '', kind: 'group', bit: 0, memberCount: 1 })).toBe(false);
    expect(isValidNamedView({ name: 'X', kind: 5, bit: 0, memberCount: 1 })).toBe(false);
    expect(isValidNamedView({ name: 'X', kind: 'group', bit: 'nope', memberCount: 1 })).toBe(false);
    expect(isValidNamedView({ name: 'X', kind: 'group', bit: 0, memberCount: null })).toBe(false);
    expect(isValidNamedView(null)).toBe(false);
    expect(isValidNamedView('LEFT')).toBe(false);
  });
});

describe('classifyNamedView', () => {
  const cases: [string, string, string][] = [
    // [name, kind, expectedFamily]
    ['CTRL_5', 'pixelSet', 'controllers'],
    ['@VINTAGE', 'pixelSet', 'types'],
    ['Strands', 'pixelSet', 'types'],
    ['TE Signs', 'pixelSet', 'types'],
    ['LEFT', 'pixelSet', 'sides'],
    ['RIGHT', 'pixelSet', 'sides'],
    ['FRONT', 'pixelSet', 'sides'],
    ['BACK', 'pixelSet', 'sides'],
    ['WALLS', 'composite', 'structure'],
    ['AUDITORIUM', 'composite', 'structure'],
    ['Left_Front_Wall', 'group', 'groups'],
    ['ParsBars', 'composite', 'composites'],
    ['weird', 'pixelSet', 'other'],
  ];
  it.each(cases)('classifies %s (%s) → %s', (name, kind, fam) => {
    expect(classifyNamedView({ name, kind, bit: 0, memberCount: 1 })).toBe(fam);
  });

  it('name pattern beats kind (a composite named WALLS is structure, not a composite)', () => {
    expect(classifyNamedView({ name: 'WALLS', kind: 'composite', bit: 0, memberCount: 1 })).toBe('structure');
  });

  it('retired families have no section — a stale name from an old engine lands in OTHER', () => {
    for (const stale of ['PORT', 'STARBOARD', 'FORE', 'AFT', 'BAND_LOW', 'Front_Wall_BOTH']) {
      expect(classifyNamedView({ name: stale, kind: 'pixelSet', bit: 0, memberCount: 1 })).toBe('other');
    }
  });
});

describe('viewSelectionForNamedView', () => {
  it('routes base groups through type:group (unchanged behavior)', () => {
    const v = viewSelectionForNamedView({ name: 'Left_Front_Wall', kind: 'group', bit: 2, memberCount: 40 });
    expect(v).toEqual({ type: 'group', target: 'Left_Front_Wall', invert: false });
  });

  it('routes composites/pixelSets through type:viewMask by name', () => {
    expect(viewSelectionForNamedView({ name: 'LEFT', kind: 'pixelSet', bit: 0, memberCount: 5 }))
      .toEqual({ type: 'viewMask', target: 'LEFT', invert: false });
    expect(viewSelectionForNamedView({ name: 'ParsBars', kind: 'composite', bit: 8, memberCount: 40 }))
      .toEqual({ type: 'viewMask', target: 'ParsBars', invert: false });
  });
});

describe('isNamedViewActive', () => {
  const group: NamedView = { name: 'Left_Front_Wall', kind: 'group', bit: 2, memberCount: 40 };
  const auto: NamedView = { name: 'LEFT', kind: 'pixelSet', bit: 0, memberCount: 5 };

  it('matches a group only via type:group', () => {
    expect(isNamedViewActive(group, { type: 'group', target: 'Left_Front_Wall' })).toBe(true);
    expect(isNamedViewActive(group, { type: 'viewMask', target: 'Left_Front_Wall' })).toBe(false);
  });

  it('matches an auto-view only via type:viewMask', () => {
    expect(isNamedViewActive(auto, { type: 'viewMask', target: 'LEFT' })).toBe(true);
    expect(isNamedViewActive(auto, { type: 'group', target: 'LEFT' })).toBe(false);
  });

  it('is false for null / mismatched target', () => {
    expect(isNamedViewActive(auto, null)).toBe(false);
    expect(isNamedViewActive(auto, { type: 'viewMask', target: 'RIGHT' })).toBe(false);
  });
});

describe('isAllActive', () => {
  it('treats null/undefined and {type:all} as ALL', () => {
    expect(isAllActive(null)).toBe(true);
    expect(isAllActive(undefined)).toBe(true);
    expect(isAllActive({ type: 'all', target: null })).toBe(true);
  });
  it('is false for a real selection', () => {
    expect(isAllActive({ type: 'viewMask', target: 'LEFT' })).toBe(false);
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
    expect(keys).toContain('types');
    expect(keys).toContain('controllers');
    expect(keys).toContain('groups');
    expect(keys).toContain('composites');
    expect(model.totalCount).toBe(16);
    expect(model.totalUnfiltered).toBe(16);
  });

  it('orders SIDES & ENDS LEFT→RIGHT→FRONT→BACK, not alphabetically', () => {
    const model = buildViewPickerSections(makeNamedViews());
    const sides = model.sections.find((s) => s.key === 'sides')!;
    expect(sides.entries.map((e) => e.name)).toEqual(['LEFT', 'RIGHT', 'FRONT', 'BACK']);
  });

  it('groups the un-prefixed fixture-type views with the @-prefixed ones', () => {
    const model = buildViewPickerSections(makeNamedViews());
    const types = model.sections.find((s) => s.key === 'types')!;
    expect(types.entries.map((e) => e.name)).toEqual(['@BAR', '@PAR', 'Strands', 'TE Signs']);
  });

  it('filters by case-insensitive substring and keeps totalUnfiltered', () => {
    const model = buildViewPickerSections(makeNamedViews(), { query: 'ctrl' });
    expect(model.totalCount).toBe(2);
    expect(model.totalUnfiltered).toBe(16);
    expect(model.sections.map((s) => s.key)).toEqual(['controllers']);
  });

  it('drops malformed entries', () => {
    const dirty = [
      { name: 'LEFT', kind: 'pixelSet', bit: 0, memberCount: 5 },
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
    expect(namedViewMemberLabel({ name: 'LEFT', kind: 'pixelSet', bit: 0, memberCount: 482 })).toBe('482 px');
  });
  it('renders EMPTY for a zero-member (dead) view', () => {
    expect(namedViewMemberLabel({ name: 'DEAD', kind: 'pixelSet', bit: 0, memberCount: 0 })).toBe('EMPTY');
  });
});
