import { describe, it, expect } from 'vitest';

import {
  PATTERN_CATALOG,
  FAMILY_ORDER,
  buildPatternRows,
  groupPatternRows,
  filterPatternRows,
  patternInfo,
  titleFromName,
  colorSupportNote,
} from './pattern_catalog';

describe('pattern catalog data', () => {
  it('has no duplicate pattern ids', () => {
    const names = PATTERN_CATALOG.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('gives every entry a real title and a real description', () => {
    for (const p of PATTERN_CATALOG) {
      expect(p.title.trim().length, `${p.name} title`).toBeGreaterThan(0);
      expect(p.blurb.trim().length, `${p.name} blurb`).toBeGreaterThan(20);
    }
  });

  it('only the patterns that declare sliderHue3/4/5 claim all five colours', () => {
    // The badge must not overpromise: a pattern is 'five' only if it declares
    // sliderHue3/4/5. If another pattern gains them, add it here deliberately.
    const five = PATTERN_CATALOG.filter((p) => p.colors === 'five').map((p) => p.name).sort();
    expect(five).toEqual(['66_five_colour_prism', '67_five_colour_stations']);
  });

  it('uses only families that FAMILY_ORDER renders', () => {
    for (const p of PATTERN_CATALOG) {
      expect(FAMILY_ORDER, `${p.name} family`).toContain(p.family);
    }
  });

  it('looks an entry up by its engine id', () => {
    expect(patternInfo('01_cylon_sweep')?.title).toBe('Cylon Sweep');
    expect(patternInfo('no_such_pattern')).toBeNull();
  });
});

describe('buildPatternRows — the engine is the source of truth', () => {
  it('lists a pattern the catalog has never heard of, without inventing a blurb', () => {
    const rows = buildPatternRows(['99_brand_new_pattern']);
    expect(rows).toHaveLength(1);
    expect(rows[0].known).toBe(false);
    expect(rows[0].blurb).toBe('');
    expect(rows[0].colors).toBeNull();
    expect(rows[0].title).toBe('99 Brand New Pattern');
  });

  it('drops a catalogued pattern the engine does not report', () => {
    const rows = buildPatternRows(['01_cylon_sweep']);
    expect(rows.map((r) => r.name)).toEqual(['01_cylon_sweep']);
  });

  it('preserves the engine order and fills known rows from the catalog', () => {
    const rows = buildPatternRows(['07_shimmer', '01_cylon_sweep']);
    expect(rows.map((r) => r.name)).toEqual(['07_shimmer', '01_cylon_sweep']);
    expect(rows[0].known).toBe(true);
    expect(rows[0].colors).toBe('two');
  });
});

describe('groupPatternRows', () => {
  it('groups in FAMILY_ORDER and drops empty families', () => {
    const rows = buildPatternRows(['01_cylon_sweep', '66_five_colour_prism', '60_white_wash']);
    const groups = groupPatternRows(rows);
    expect(groups.map((g) => g.family)).toEqual(['signature', 'beat', 'white']);
    expect(groups[0].rows.map((r) => r.name)).toEqual(['66_five_colour_prism']);
  });

  it('returns nothing for no rows', () => {
    expect(groupPatternRows([])).toEqual([]);
  });
});

describe('filterPatternRows', () => {
  const rows = buildPatternRows(['01_cylon_sweep', '60_white_wash', '08_ocean_liner']);

  it('returns everything for an empty or blank query', () => {
    expect(filterPatternRows(rows, '')).toHaveLength(3);
    expect(filterPatternRows(rows, '   ')).toHaveLength(3);
  });

  it('matches the engine id, the title and the description, case-insensitively', () => {
    expect(filterPatternRows(rows, 'CYLON').map((r) => r.name)).toEqual(['01_cylon_sweep']);
    expect(filterPatternRows(rows, 'white wash').map((r) => r.name)).toEqual(['60_white_wash']);
    // 'porthole' appears only in the ocean liner blurb.
    expect(filterPatternRows(rows, 'porthole').map((r) => r.name)).toEqual(['08_ocean_liner']);
  });

  it('returns nothing when nothing matches', () => {
    expect(filterPatternRows(rows, 'zzzz')).toEqual([]);
  });
});

describe('titleFromName', () => {
  it('keeps leading numbers and capitalises words', () => {
    expect(titleFromName('31_strobe_lattice')).toBe('31 Strobe Lattice');
    expect(titleFromName('rainbow')).toBe('Rainbow');
    expect(titleFromName('calib_swipe_left_right')).toBe('Calib Swipe Left Right');
  });
});

describe('colorSupportNote', () => {
  it('says nothing when the pattern is unknown, rather than guessing', () => {
    expect(colorSupportNote(null)).toBeNull();
  });

  it('warns that dots 3-5 do not reach a two-colour pattern', () => {
    expect(colorSupportNote('two')).toContain('3-5');
  });

  it('states plainly that a fixed pattern takes no colours', () => {
    expect(colorSupportNote('fixed')).toContain('will not change it');
  });

  it('confirms all five for a five-colour pattern', () => {
    expect(colorSupportNote('five')).toContain('five');
  });
});
