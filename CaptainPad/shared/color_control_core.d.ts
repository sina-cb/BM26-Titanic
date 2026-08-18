export type Hsv = { h: number; s: number; v: number };
export type ColorChannel = number | Hsv;
export type ColorPair = { c1: ColorChannel; c2: ColorChannel };
export type SchemePairSel = readonly [number, number];
export type SchemeId = (typeof SCHEME_IDS)[number];
export type ColorAutopilotMode = 'palettes' | 'followNote';

export type ColorAutopilotState = {
  active: boolean;
  mode?: ColorAutopilotMode;
  palettes: unknown[];
  delay_s?: number;
  transitionMs?: number;
  shuffle?: boolean;
  nextSwapAtMs?: number | null;
  followNote?: Record<string, unknown>;
  currentScheme?: string | null;
  notePc?: number | null;
  noteHue?: number | null;
  nextMethodAtMs?: number | null;
  [key: string]: unknown;
};

export const COLOUR_EPS: number;
export const CORE_API_VERSION: 1;
export const SCHEME_IDS: readonly [
  'master', 'hue', 'complement', 'contrast',
  'analogous', 'triadic', 'split', 'tetrad', 'golden',
];
export const SCHEME_BASE_S: number;
export const MONO_STEPS: readonly number[];
export const COMP_OFFSETS: readonly number[];
export const SCHEME_MIN_V: number;
export const SCHEME_ROTATION_MIN_V: number;
export const ANALOGOUS_STEPS: readonly (readonly [number, number])[];
export const TRIADIC_STEPS: readonly (readonly [number, number])[];
export const SPLIT_STEPS: readonly (readonly [number, number])[];
export const TETRAD_STEPS: readonly (readonly [number, number])[];
export const GOLDEN_ANGLE_DEG: number;
export const MIN_CONTINUOUS_FADE_S: number;
export const MIN_CONTINUOUS_METHOD_FADE_S: number;

export function colour(h: number, s: number, v: number): Hsv;
export function asHsv(channel: ColorChannel): Hsv;
export function channelForWire(value: Hsv): ColorChannel;
export function rotateHue(h: number, deg: number): number;
export function schemeFromSteps(
  steps: readonly (readonly [number, number])[],
  baseH: number,
): Hsv[];
export function generateScheme(scheme: SchemeId, baseH: number): Hsv[];
export function orbitDistance(selection: SchemePairSel, ringLength: number): number;
export function orbitStep(distance: number, ringLength: number): number;
export function orbitPairs(colours: Hsv[], selection: SchemePairSel): ColorPair[];
export function turnsPairs(colours: Hsv[]): ColorPair[];
export function assertRotationTiming(holdS: number, fadeS: number): void;
export function rotationAutopilotPatch(
  colours: Hsv[], holdS: number, fadeS: number, selection?: SchemePairSel,
): {
  active: true;
  shuffle: false;
  delay_s: number;
  transitionMs: number;
  palettes: ColorPair[];
};
export function turnsAutopilotPatch(
  colours: Hsv[], holdS: number, fadeS: number, selection?: SchemePairSel,
): ReturnType<typeof rotationAutopilotPatch>;
export function crossfadeAutopilotPatch(
  hA: number, hB: number, holdS: number, fadeS: number,
): ReturnType<typeof rotationAutopilotPatch>;
export function assertMethodTiming(holdS: number, fadeS: number): void;
export function assertSchemeSubset(schemes: readonly SchemeId[]): SchemeId[];
export function followNoteAutopilotPatch(args: {
  schemes: readonly SchemeId[];
  methodHoldS: number;
  methodFadeS: number;
  noteFadeMs: number;
  sel: SchemePairSel;
  shuffle?: boolean;
}): {
  active: true;
  mode: 'followNote';
  followNote: {
    schemes: SchemeId[];
    methodHoldS: number;
    methodFadeS: number;
    noteFadeMs: number;
    sel: [number, number];
    shuffle: boolean;
  };
};
export function paletteWritePayload(h1: number, h2: number): {
  colorPalette1: Hsv;
  colorPalette2: Hsv;
};
export function reduceColorControlState<T extends ColorAutopilotState>(
  previous: T,
  payload: Record<string, unknown>,
): T;
