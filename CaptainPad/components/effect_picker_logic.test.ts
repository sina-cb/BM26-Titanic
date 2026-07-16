/**
 * Tests for the Global-Effects PICKER logic (party 2026-07-11):
 *   1. FAVORITES — the operator's 8 starred party picks (incl. the strobe
 *      wildcard that survives the engine's preset collapse).
 *   2. GROUPING — named section headers over the engine registry, with
 *      feature-detect of the pending color_replace rename, and NO effect ever
 *      dropped (auto-discovery: everything the engine ships renders).
 *   3. ENCODER-DISABLE — fogger consumes valueParam:'none' when the engine
 *      threads it, else the hardcoded fallback table.
 *   4. UNKNOWN-ID guard — a bound slot on a renamed/removed effect warns loudly
 *      ("lost strobe" guard) and still resolves to a generic card.
 *
 * Pure logic, no react-native — runs under vitest's `components/**\/*.test.ts`.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  PARTY_FAVORITES,
  isFavoritePreset,
  buildPickerSections,
  slotDisablesEncoder,
  resolveSlotEffectName,
  ENCODER_DISABLED_EFFECT_IDS,
  PickerLibrary,
} from './effect_picker_logic';

// A trimmed stand-in for the engine's describeLibrary() output. Preset ids &
// effect ids mirror marsin_engine/lib/global_effect_library.js as of the party
// spec. `strobe` is shown here in its PRE-collapse 5-preset shape to prove the
// wildcard favorite still works; the post-collapse single-preset shape is
// covered by a dedicated case.
function makeLibrary(): PickerLibrary {
  return {
    vintageWhite: { id: 'vintageWhite', name: 'Vintage White Boost', presets: {
      default: { id: 'default', label: 'Vintage White', defaultBehavior: 'toggle' },
    } },
    blastWhite: { id: 'blastWhite', name: 'Blast White', presets: {
      default: { id: 'default', label: 'Blast White', defaultBehavior: 'toggle' },
    } },
    fogger: { id: 'fogger', name: 'Fogger / Haze', valueParam: 'none', presets: {
      default: { id: 'default', label: 'Fogger', defaultBehavior: 'toggle' },
    } },
    strobe: { id: 'strobe', name: 'Strobe', presets: {
      pulse_2hz: { id: 'pulse_2hz', label: '2 Hz Pulse', defaultBehavior: 'toggle' },
      sync_4hz: { id: 'sync_4hz', label: '4 Hz Sync', defaultBehavior: 'toggle' },
      max_20hz: { id: 'max_20hz', label: '20 Hz Max', defaultBehavior: 'toggle' },
    } },
    dropHit: { id: 'dropHit', name: 'Drop Hit / Whiteout', presets: {
      white_drop: { id: 'white_drop', label: 'White Flash', defaultBehavior: 'trigger' },
      iceberg_flash: { id: 'iceberg_flash', label: 'Iceberg Flash', defaultBehavior: 'trigger' },
      vintage_burst: { id: 'vintage_burst', label: 'Vintage Burst', defaultBehavior: 'trigger' },
    } },
    colorWash: { id: 'colorWash', name: 'Color Wash Takeover', presets: {
      ocean_blue: { id: 'ocean_blue', label: 'Ocean Blue', defaultBehavior: 'toggle' },
      iceberg_cyan: { id: 'iceberg_cyan', label: 'Iceberg Cyan', defaultBehavior: 'toggle' },
      emergency_red: { id: 'emergency_red', label: 'Emergency Red', defaultBehavior: 'toggle' },
    } },
    beatPump: { id: 'beatPump', name: 'Beat Pump', presets: {
      soft: { id: 'soft', label: 'Soft Pump', defaultBehavior: 'toggle' },
      deep: { id: 'deep', label: 'Deep Pump', defaultBehavior: 'toggle' },
    } },
    feedbackTrails: { id: 'feedbackTrails', name: 'Feedback Trails / Ghost Trails', presets: {
      soft_afterimage: { id: 'soft_afterimage', label: 'Soft Afterimage', defaultBehavior: 'toggle' },
      cosmic_trails: { id: 'cosmic_trails', label: 'Cosmic Trails', defaultBehavior: 'toggle' },
    } },
    freeze: { id: 'freeze', name: 'Freeze Frame', presets: {
      hold: { id: 'hold', label: 'Hold', defaultBehavior: 'toggle' },
      fade_2s: { id: 'fade_2s', label: 'Fade 2s', defaultBehavior: 'toggle' },
    } },
    sparkle: { id: 'sparkle', name: 'Frost Sparkle', presets: {
      fizz: { id: 'fizz', label: 'Fizz', defaultBehavior: 'toggle' },
      blizzard: { id: 'blizzard', label: 'Blizzard', defaultBehavior: 'toggle' },
    } },
  };
}

// Count every (effectId, presetId) pair across a library — the invariant that
// buildPickerSections must never drop one.
function totalPresetCount(lib: PickerLibrary): number {
  return Object.values(lib).reduce((n, fx) => n + Object.keys(fx.presets).length, 0);
}

describe('favorites (party picks)', () => {
  it('has exactly the 8 documented party picks', () => {
    expect(PARTY_FAVORITES).toHaveLength(8);
  });

  it('stars each of the 8 picks and nothing else', () => {
    // The 7 exact-id picks.
    expect(isFavoritePreset('blastWhite', 'default')).toBe(true);
    expect(isFavoritePreset('dropHit', 'white_drop')).toBe(true);
    expect(isFavoritePreset('dropHit', 'iceberg_flash')).toBe(true);
    expect(isFavoritePreset('beatPump', 'soft')).toBe(true);
    expect(isFavoritePreset('feedbackTrails', 'cosmic_trails')).toBe(true);
    expect(isFavoritePreset('freeze', 'hold')).toBe(true);
    expect(isFavoritePreset('sparkle', 'fizz')).toBe(true);
    // Non-picks in the same effects are NOT starred.
    expect(isFavoritePreset('dropHit', 'vintage_burst')).toBe(false);
    expect(isFavoritePreset('beatPump', 'deep')).toBe(false);
    expect(isFavoritePreset('freeze', 'fade_2s')).toBe(false);
    expect(isFavoritePreset('sparkle', 'blizzard')).toBe(false);
    expect(isFavoritePreset('colorWash', 'ocean_blue')).toBe(false);
    expect(isFavoritePreset('vintageWhite', 'default')).toBe(false);
  });

  it('strobe wildcard stars ANY strobe preset (survives the 5→1 collapse)', () => {
    // Pre-collapse: every per-Hz preset is starred.
    expect(isFavoritePreset('strobe', 'pulse_2hz')).toBe(true);
    expect(isFavoritePreset('strobe', 'max_20hz')).toBe(true);
    // Post-collapse: whatever single id the engine ships is still starred.
    expect(isFavoritePreset('strobe', 'strobe')).toBe(true);
    expect(isFavoritePreset('strobe', 'default')).toBe(true);
  });

  it('renders the ⭐ on favorite rows and not on others (via buildPickerSections)', () => {
    const rows = buildPickerSections(makeLibrary(), () => {}).flatMap((s) => s.rows);
    const fav = rows.filter((r) => r.favorite);
    const favKeys = fav.map((r) => `${r.effectId}/${r.presetId}`).sort();
    // blastWhite/default, dropHit/white_drop, dropHit/iceberg_flash, beatPump/soft,
    // feedbackTrails/cosmic_trails, freeze/hold, sparkle/fizz + all 3 strobe presets.
    expect(favKeys).toEqual([
      'beatPump/soft',
      'blastWhite/default',
      'dropHit/iceberg_flash',
      'dropHit/white_drop',
      'feedbackTrails/cosmic_trails',
      'freeze/hold',
      'sparkle/fizz',
      'strobe/max_20hz',
      'strobe/pulse_2hz',
      'strobe/sync_4hz',
    ]);
  });
});

describe('picker section grouping', () => {
  it('renders the three named groups first, in order', () => {
    const sections = buildPickerSections(makeLibrary(), () => {});
    const titles = sections.map((s) => s.title);
    expect(titles.slice(0, 3)).toEqual(['Blast Effects', 'Flashes', 'Color Replacement']);
  });

  it('Blast Effects holds vintageWhite + blastWhite presets', () => {
    const s = buildPickerSections(makeLibrary(), () => {}).find((x) => x.title === 'Blast Effects')!;
    expect(s.rows.map((r) => r.effectId)).toEqual(['vintageWhite', 'blastWhite']);
  });

  it('Flashes holds every dropHit preset (White Flash / Iceberg Flash / Vintage Burst)', () => {
    const s = buildPickerSections(makeLibrary(), () => {}).find((x) => x.title === 'Flashes')!;
    expect(s.rows.map((r) => r.presetId)).toEqual(['white_drop', 'iceberg_flash', 'vintage_burst']);
  });

  it('Color Replacement feature-detects the CURRENT colorWash ids (pre-rename)', () => {
    const s = buildPickerSections(makeLibrary(), () => {}).find((x) => x.title === 'Color Replacement')!;
    expect(s.rows.map((r) => r.effectId)).toEqual(['colorWash', 'colorWash', 'colorWash']);
    expect(s.rows.map((r) => r.presetId)).toEqual(['ocean_blue', 'iceberg_cyan', 'emergency_red']);
  });

  it('Color Replacement follows the pending color_replace rename automatically', () => {
    const lib = makeLibrary();
    delete lib.colorWash;
    lib.color_replace = { id: 'color_replace', name: 'Color Replace', presets: {
      oceanBlue: { id: 'oceanBlue', label: 'Ocean Blue', defaultBehavior: 'toggle' },
      icebergCyan: { id: 'icebergCyan', label: 'Iceberg Cyan', defaultBehavior: 'toggle' },
      purple: { id: 'purple', label: 'Purple', defaultBehavior: 'toggle' },
      emergencyRed: { id: 'emergencyRed', label: 'Emergency Red', defaultBehavior: 'toggle' },
    } };
    const s = buildPickerSections(lib, () => {}).find((x) => x.title === 'Color Replacement')!;
    expect(s.rows.map((r) => r.presetId)).toEqual(['oceanBlue', 'icebergCyan', 'purple', 'emergencyRed']);
  });

  it('ungrouped effects render under their ENGINE name (Pulse→Strobe rename flows through)', () => {
    const sections = buildPickerSections(makeLibrary(), () => {});
    const titles = sections.map((s) => s.title);
    // Strobe keeps its engine display name as an ungrouped section header.
    expect(titles).toContain('Strobe');
    expect(titles).toContain('Beat Pump');
    expect(titles).toContain('Frost Sparkle');
  });

  it('AUTO-DISCOVERY: never drops a preset — every library pair lands in exactly one section', () => {
    const lib = makeLibrary();
    const rows = buildPickerSections(lib, () => {}).flatMap((s) => s.rows);
    expect(rows).toHaveLength(totalPresetCount(lib));
    // No duplicates.
    const keys = rows.map((r) => `${r.effectId}/${r.presetId}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('a brand-new UNKNOWN effect still renders (generic card), never filtered', () => {
    const lib = makeLibrary();
    lib.brand_new_fx = { id: 'brand_new_fx', name: 'Mystery FX', presets: {
      wow: { id: 'wow', label: 'Wow', defaultBehavior: 'toggle' },
    } };
    const sections = buildPickerSections(lib, () => {});
    const s = sections.find((x) => x.title === 'Mystery FX');
    expect(s).toBeDefined();
    expect(s!.rows).toHaveLength(1);
  });

  it('warns loudly when a group matches NOTHING in the library', () => {
    // Strip every effect a group could claim.
    const lib = makeLibrary();
    delete lib.vintageWhite; delete lib.blastWhite;
    const warn = vi.fn();
    buildPickerSections(lib, warn);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("group 'Blast Effects' matched no engine effects"));
  });

  it('returns [] for a null/absent library (loading state) without throwing', () => {
    expect(buildPickerSections(null, () => {})).toEqual([]);
    expect(buildPickerSections(undefined, () => {})).toEqual([]);
  });
});

describe('encoder-disable (fogger & friends)', () => {
  it('disables when the engine threads valueParam:none', () => {
    expect(slotDisablesEncoder({ effectId: 'fogger', valueParam: 'none' })).toBe(true);
  });

  it('trusts the engine when valueParam names a real knob', () => {
    expect(slotDisablesEncoder({ effectId: 'fogger', valueParam: 'intensity' })).toBe(false);
    expect(slotDisablesEncoder({ effectId: 'strobe', valueParam: 'intensity' })).toBe(false);
  });

  it('falls back to the UI override table when valueParam is absent', () => {
    expect(slotDisablesEncoder({ effectId: 'fogger' })).toBe(true);
    expect(slotDisablesEncoder({ effectId: 'strobe' })).toBe(false);
    expect(ENCODER_DISABLED_EFFECT_IDS.has('fogger')).toBe(true);
  });

  it('is false for an empty / null slot', () => {
    expect(slotDisablesEncoder({})).toBe(false);
    expect(slotDisablesEncoder(null)).toBe(false);
    expect(slotDisablesEncoder(undefined)).toBe(false);
  });
});

describe('resolveSlotEffectName ("lost strobe" guard)', () => {
  it('resolves a known bound slot to its engine name, no warning', () => {
    const warn = vi.fn();
    const r = resolveSlotEffectName({ effectId: 'strobe', label: 'Strobe' }, makeLibrary(), warn);
    expect(r).toEqual({ known: true, name: 'Strobe' });
    expect(warn).not.toHaveBeenCalled();
  });

  it('warns loudly for an unknown (renamed/removed) effectId and still returns a generic name', () => {
    const warn = vi.fn();
    const r = resolveSlotEffectName({ effectId: 'pulse_20hz', label: '20 Hz Burst' }, makeLibrary(), warn);
    expect(r.known).toBe(false);
    expect(r.name).toBe('20 Hz Burst'); // generic card = the slot's own label
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("unknown effectId 'pulse_20hz'"));
  });

  it('does NOT warn before the library has loaded (null library)', () => {
    const warn = vi.fn();
    resolveSlotEffectName({ effectId: 'strobe', label: 'Strobe' }, null, warn);
    expect(warn).not.toHaveBeenCalled();
  });
});
