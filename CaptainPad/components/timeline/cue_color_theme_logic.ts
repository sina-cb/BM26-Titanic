import type {
  ColorPairChannel,
  ColorPaletteEntry,
  DeckColorAutopilotConfig,
  DeckFollowNoteConfig,
} from '@/utils/api';
import type {
  ActionColorAutopilot,
  ActionColorAutopilotFollowNote,
  ActionColorAutopilotPalettes,
} from '@/utils/timelineApi';
import {
  SCHEME_IDS,
  asHsv,
  crossfadeAutopilotPatch,
  followNoteAutopilotPatch,
  turnsAutopilotPatch,
} from '@/components/deck/colors_window_logic';

export type CueColorThemeMode = 'twoTone' | 'fiveTone' | 'followNote' | 'savedPalettes';
export type TwoToneBehavior = 'fixed' | 'crossfade';

const FIVE_TONE_HUES = [0.08, 0.19, 0.36, 0.58, 0.82] as const;
const DEFAULT_PALETTE_HOLD_S = 5;
const DEFAULT_PALETTE_FADE_S = 0.8;
const DEFAULT_NOTE_FADE_S = 0.12;

function cloneChannel(channel: ColorPairChannel): ColorPairChannel {
  return typeof channel === 'number' ? channel : { ...channel };
}

function clonePaletteEntry(entry: ColorPaletteEntry): ColorPaletteEntry {
  if (typeof entry === 'string') return entry;
  return {
    c1: cloneChannel(entry.c1),
    c2: cloneChannel(entry.c2),
  };
}

function finiteNumber(value: unknown, label: string, minimum: number): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum) {
    throw new Error(`${label} must be at least ${minimum}.`);
  }
  return number;
}

export function cueColorThemeMode(config: ActionColorAutopilot): CueColorThemeMode {
  if (config.mode === 'followNote') return 'followNote';
  if (config.behavior === 'fixed') return 'twoTone';
  if (config.palettes.every((entry) => typeof entry === 'string')) return 'savedPalettes';
  if (config.palettes.length === 2) return 'twoTone';
  if (config.palettes.length === 5) return 'fiveTone';
  throw new Error(
    `Unsupported inline cue color theme with ${config.palettes.length} palettes. `
      + 'Choose a two-tone, five-tone, follow-note, or saved-palette theme.',
  );
}

export function normalizeCueColorAutopilot(
  config: ActionColorAutopilot | DeckColorAutopilotConfig,
): ActionColorAutopilot {
  if (config.mode === 'followNote') {
    if (!config.followNote) {
      throw new Error('Follow Note color themes require sampling settings.');
    }
    const normalized = followNoteAutopilotPatch({
      schemes: config.followNote.schemes as (typeof SCHEME_IDS)[number][],
      methodHoldS: config.followNote.methodHoldS,
      methodFadeS: config.followNote.methodFadeS,
      noteFadeMs: config.followNote.noteFadeMs,
      sel: config.followNote.sel,
      shuffle: config.followNote.shuffle,
    });
    return {
      active: !!config.active,
      mode: 'followNote',
      followNote: { ...normalized.followNote },
    } as ActionColorAutopilotFollowNote;
  }

  if (!Array.isArray(config.palettes) || config.palettes.length === 0) {
    throw new Error('Autopilot color themes require at least one palette.');
  }
  const delay_s = finiteNumber(config.delay_s, 'Color hold', 0);
  const transitionMs = finiteNumber(config.transitionMs ?? 0, 'Color fade', 0);
  const behavior = config.behavior ?? 'rotate';
  if (behavior !== 'rotate' && behavior !== 'fixed') {
    throw new Error(`Color behavior must be "rotate" or "fixed", got ${String(behavior)}.`);
  }
  if (behavior === 'fixed') {
    if (config.palettes.length !== 1 || typeof config.palettes[0] === 'string') {
      throw new Error('Fixed two-tone themes require exactly one authored color pair.');
    }
    if (config.shuffle) {
      throw new Error('Fixed two-tone themes cannot shuffle.');
    }
  }
  if (behavior !== 'fixed' && delay_s === 0 && transitionMs < 100) {
    throw new Error('Continuous color themes require a fade of at least 0.1 seconds.');
  }
  const normalized: ActionColorAutopilotPalettes = {
    active: !!config.active,
    mode: 'palettes',
    palettes: config.palettes.map(clonePaletteEntry),
    delay_s,
    shuffle: !!config.shuffle,
    transitionMs,
  };
  if (behavior === 'fixed') normalized.behavior = 'fixed';
  return normalized;
}

export function defaultCueColorTheme(
  mode: CueColorThemeMode,
  firstSavedPalette?: string,
): ActionColorAutopilot {
  if (mode === 'twoTone') {
    return normalizeCueColorAutopilot(crossfadeAutopilotPatch(
      FIVE_TONE_HUES[0],
      FIVE_TONE_HUES[3],
      DEFAULT_PALETTE_HOLD_S,
      DEFAULT_PALETTE_FADE_S,
    ));
  }
  if (mode === 'fiveTone') {
    return normalizeCueColorAutopilot(turnsAutopilotPatch(
      FIVE_TONE_HUES.map((h) => ({ h, s: 1, v: 1 })),
      DEFAULT_PALETTE_HOLD_S,
      DEFAULT_PALETTE_FADE_S,
      [0, 1],
    ));
  }
  if (mode === 'followNote') {
    return normalizeCueColorAutopilot(followNoteAutopilotPatch({
      schemes: [...SCHEME_IDS],
      sel: [0, 1],
      methodHoldS: DEFAULT_PALETTE_HOLD_S,
      methodFadeS: DEFAULT_PALETTE_FADE_S,
      noteFadeMs: DEFAULT_NOTE_FADE_S * 1000,
      shuffle: false,
    }));
  }
  if (!firstSavedPalette) {
    throw new Error('Choose a saved palette before using Saved Set mode.');
  }
  return normalizeCueColorAutopilot({
    active: true,
    mode: 'palettes',
    palettes: [firstSavedPalette],
    delay_s: DEFAULT_PALETTE_HOLD_S,
    shuffle: false,
    transitionMs: DEFAULT_PALETTE_FADE_S * 1000,
  });
}

export function paletteConfigHues(config: ActionColorAutopilotPalettes): number[] {
  return config.palettes
    .filter((entry): entry is Exclude<ColorPaletteEntry, string> => typeof entry !== 'string')
    .map((entry) => asHsv(entry.c1).h);
}

export function twoToneHues(config: ActionColorAutopilotPalettes): [number, number] {
  const first = config.palettes[0];
  if (!first || typeof first === 'string') {
    throw new Error('Two-tone themes require an inline color pair.');
  }
  return [asHsv(first.c1).h, asHsv(first.c2).h];
}

export function twoToneBehavior(config: ActionColorAutopilotPalettes): TwoToneBehavior {
  return config.behavior === 'fixed' ? 'fixed' : 'crossfade';
}

export function fixedTwoToneTheme(
  firstHue: number,
  secondHue: number,
  transitionMs = 800,
  active = true,
): ActionColorAutopilotPalettes {
  return normalizeCueColorAutopilot({
    active,
    mode: 'palettes',
    behavior: 'fixed',
    palettes: [{ c1: firstHue, c2: secondHue }],
    delay_s: 0,
    shuffle: false,
    transitionMs,
  }) as ActionColorAutopilotPalettes;
}

export function followNoteWith(
  current: ActionColorAutopilotFollowNote,
  followNote: DeckFollowNoteConfig,
): ActionColorAutopilotFollowNote {
  return normalizeCueColorAutopilot({
    active: current.active,
    mode: 'followNote',
    followNote,
  }) as ActionColorAutopilotFollowNote;
}

export function cueColorThemeSummary(config: ActionColorAutopilot): string {
  const mode = cueColorThemeMode(config);
  if (mode === 'twoTone') {
    return config.mode !== 'followNote' && config.behavior === 'fixed'
      ? '2-tone fixed pair'
      : '2-tone crossfade';
  }
  if (mode === 'fiveTone') return '5-tone rotation';
  if (mode === 'followNote') return 'Follow Note sampling';
  return `${config.mode === 'palettes' ? config.palettes.length : 0} saved palettes`;
}
