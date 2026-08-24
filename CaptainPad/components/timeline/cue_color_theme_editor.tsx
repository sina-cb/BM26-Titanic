import React, { useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { usePalette } from '@/hooks/use-theme';
import type { ActionColorAutopilot, ActionColorAutopilotFollowNote, ActionColorAutopilotPalettes } from '@/utils/timelineApi';
import type { SchemeId } from '@/components/deck/colors_window_logic';
import {
  SCHEME_IDS,
  crossfadeAutopilotPatch,
  followNoteAutopilotPatch,
  turnsAutopilotPatch,
} from '@/components/deck/colors_window_logic';
import { HorizontalFader } from '@/components/ui/HorizontalFader';
import { ColorAutopilotPanel } from '@/components/deck/ColorAutopilotPanel';
import { FieldLabel, Segmented, Stepper } from './makerControls';
import {
  CueColorThemeMode,
  cueColorThemeMode,
  defaultCueColorTheme,
  fixedTwoToneTheme,
  normalizeCueColorAutopilot,
  paletteConfigHues,
  twoToneBehavior,
  twoToneHues,
} from './cue_color_theme_logic';

interface CueColorThemeEditorProps {
  value: ActionColorAutopilot;
  onChange: (value: ActionColorAutopilot) => void;
  paletteOptions: { id: string; label: string }[];
}

const SCHEME_LABELS: Record<SchemeId, string> = {
  master: 'MASTER',
  hue: 'HUE',
  complement: 'COMPLEMENT',
  contrast: 'CONTRAST',
  analogous: 'NEAR',
  triadic: 'TRIAD',
  split: 'SPLIT',
  tetrad: 'TETRAD',
  golden: 'GOLDEN',
};

function hueColor(hue: number): string {
  return `hsl(${Math.round(hue * 360)}, 82%, 56%)`;
}

function HueFader({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  const C = usePalette();
  return (
    <View style={{ gap: 5 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={{
          width: 14,
          height: 14,
          borderRadius: 7,
          backgroundColor: hueColor(value),
          borderWidth: 1,
          borderColor: C.ghostBorder,
        }} />
        <Text style={{
          fontFamily: 'SpaceGrotesk_700Bold',
          fontSize: 10,
          color: C.icon,
          letterSpacing: 0.8,
        }}>
          {label} · {Math.round(value * 360)}°
        </Text>
      </View>
      <HorizontalFader
        value={value}
        onChange={onChange}
        trackStyle={{
          height: 24,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: C.ghostBorder,
          backgroundColor: C.surfaceContainerLowest,
          justifyContent: 'center',
        }}
        fillStyle={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          borderRadius: 12,
          backgroundColor: hueColor(value),
        }}
        thumbStyle={{
          width: 6,
          height: 28,
          borderRadius: 3,
          backgroundColor: C.text,
          marginTop: -2,
        }}
      />
    </View>
  );
}

function TimingControls({
  config,
  onChange,
}: {
  config: ActionColorAutopilotPalettes;
  onChange: (config: ActionColorAutopilot) => void;
}) {
  const fade_s = (config.transitionMs ?? 0) / 1000;
  return (
    <View style={{ flexDirection: 'row', gap: 12, flexWrap: 'wrap' }}>
      <View style={{ flex: 1, minWidth: 190, gap: 4 }}>
        <FieldLabel>HOLD BETWEEN COLORS</FieldLabel>
        <Stepper
          value={config.delay_s}
          onChange={(delay_s) => onChange(normalizeCueColorAutopilot({ ...config, delay_s }))}
          step={0.5}
          min={0}
          max={60}
          format={(value) => value === 0 ? 'CONTINUOUS' : `${value.toFixed(1)}s`}
        />
      </View>
      <View style={{ flex: 1, minWidth: 190, gap: 4 }}>
        <FieldLabel>CROSSFADE</FieldLabel>
        <Stepper
          value={fade_s}
          onChange={(value) => onChange(normalizeCueColorAutopilot({
            ...config,
            transitionMs: Math.round(value * 1000),
          }))}
          step={0.1}
          min={config.delay_s === 0 ? 0.1 : 0}
          max={10}
          format={(value) => `${value.toFixed(1)}s`}
        />
      </View>
    </View>
  );
}

function ThemeRunControl({
  active,
  runLabel,
  onChange,
}: {
  active: boolean;
  runLabel: string;
  onChange: (active: boolean) => void;
}) {
  const C = usePalette();
  return (
    <View style={{ gap: 5 }}>
      <FieldLabel>WHEN THIS CUE FIRES</FieldLabel>
      <Segmented
        value={active ? 'run' : 'pause'}
        onChange={(value) => onChange(value === 'run')}
        options={[
          { id: 'run', label: runLabel },
          { id: 'pause', label: 'PAUSE COLORS' },
        ]}
      />
      <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 11, lineHeight: 16, color: C.secondary }}>
        {active
          ? 'This cue applies and controls the selected color theme.'
          : 'This cue stops color automation. The edited colors stay saved here but are not applied.'}
      </Text>
    </View>
  );
}

function PaletteThemeEditor({
  mode,
  config,
  onChange,
}: {
  mode: 'twoTone' | 'fiveTone';
  config: ActionColorAutopilotPalettes;
  onChange: (config: ActionColorAutopilot) => void;
}) {
  const hues = mode === 'twoTone' ? twoToneHues(config) : paletteConfigHues(config);
  const behavior = mode === 'twoTone' ? twoToneBehavior(config) : null;
  const hold_s = config.delay_s;
  const fade_s = (config.transitionMs ?? 0) / 1000;
  const rebuild = (nextHues: number[]) => {
    const patch = mode === 'twoTone' && behavior === 'fixed'
      ? fixedTwoToneTheme(nextHues[0], nextHues[1], config.transitionMs ?? 800, config.active)
      : mode === 'twoTone'
        ? crossfadeAutopilotPatch(nextHues[0], nextHues[1], hold_s, fade_s)
      : turnsAutopilotPatch(
        nextHues.map((h) => ({ h, s: 1, v: 1 })),
        hold_s,
        fade_s,
        [0, 1],
      );
    onChange(normalizeCueColorAutopilot({ ...patch, active: config.active }));
  };
  return (
    <View style={{ gap: 14 }}>
      {mode === 'twoTone' ? (
        <View style={{ gap: 5 }}>
          <FieldLabel>2-TONE BEHAVIOR</FieldLabel>
          <Segmented
            value={behavior ?? 'crossfade'}
            onChange={(nextBehavior) => {
              const next = nextBehavior === 'fixed'
                ? fixedTwoToneTheme(hues[0], hues[1], config.transitionMs ?? 800, config.active)
                : normalizeCueColorAutopilot({
                  ...crossfadeAutopilotPatch(
                    hues[0],
                    hues[1],
                    config.delay_s > 0 ? config.delay_s : 5,
                    Math.max((config.transitionMs ?? 800) / 1000, 0.1),
                  ),
                  active: config.active,
                });
              onChange(next);
            }}
            options={[
              { id: 'fixed', label: 'FIXED PAIR' },
              { id: 'crossfade', label: 'CROSSFADE' },
            ]}
          />
        </View>
      ) : null}
      <ThemeRunControl
        active={config.active}
        runLabel={behavior === 'fixed' ? 'APPLY FIXED PAIR' : mode === 'twoTone' ? 'RUN CROSSFADE' : 'RUN ROTATION'}
        onChange={(active) => onChange({ ...config, active })}
      />
      <View style={{ gap: 12 }}>
        {hues.map((hue, index) => (
          <HueFader
            key={`${mode}-${index}`}
            label={mode === 'twoTone' ? `TONE ${index + 1}` : `ROTATION ${index + 1}`}
            value={hue}
            onChange={(nextHue) => {
              const nextHues = [...hues];
              nextHues[index] = nextHue;
              rebuild(nextHues);
            }}
          />
        ))}
      </View>
      {behavior === 'fixed' ? (
        <View style={{ gap: 4 }}>
          <FieldLabel>ENTRY FADE</FieldLabel>
          <Stepper
            value={(config.transitionMs ?? 0) / 1000}
            onChange={(value) => onChange(normalizeCueColorAutopilot({
              ...config,
              transitionMs: Math.round(value * 1000),
            }))}
            step={0.1}
            min={0}
            max={10}
            format={(value) => value === 0 ? 'HARD CUT' : `${value.toFixed(1)}s`}
          />
        </View>
      ) : (
        <TimingControls config={config} onChange={onChange} />
      )}
    </View>
  );
}

function FollowNoteThemeEditor({
  config,
  onChange,
}: {
  config: ActionColorAutopilotFollowNote;
  onChange: (config: ActionColorAutopilot) => void;
}) {
  const C = usePalette();
  const [error, setError] = useState<string | null>(null);
  const follow = config.followNote;
  const rebuild = (next: typeof follow) => {
    onChange(normalizeCueColorAutopilot({
      ...followNoteAutopilotPatch({
        schemes: next.schemes as SchemeId[],
        methodHoldS: next.methodHoldS,
        methodFadeS: next.methodFadeS,
        noteFadeMs: next.noteFadeMs,
        sel: next.sel,
        shuffle: next.shuffle,
      }),
      active: config.active,
    }));
  };
  const toggleScheme = (scheme: SchemeId) => {
    const nextSchemes = follow.schemes.includes(scheme)
      ? follow.schemes.filter((id) => id !== scheme)
      : [...follow.schemes, scheme];
    if (nextSchemes.length === 0) {
      setError('Keep at least one sampling method selected.');
      return;
    }
    setError(null);
    rebuild({ ...follow, schemes: nextSchemes });
  };
  return (
    <View style={{ gap: 14 }}>
      <ThemeRunControl
        active={config.active}
        runLabel="FOLLOW NOTES"
        onChange={(active) => onChange({ ...config, active })}
      />
      <View style={{ gap: 7 }}>
        <FieldLabel>SAMPLING METHODS</FieldLabel>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
          {SCHEME_IDS.map((scheme) => {
            const selected = follow.schemes.includes(scheme);
            return (
              <TouchableOpacity
                key={scheme}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => toggleScheme(scheme)}
                style={{
                  minHeight: 38,
                  justifyContent: 'center',
                  paddingHorizontal: 12,
                  borderRadius: 8,
                  borderWidth: 1,
                  borderColor: selected ? C.primary : C.ghostBorder,
                  backgroundColor: selected ? C.sidebarActiveBackground : 'transparent',
                }}
              >
                <Text style={{
                  fontFamily: 'SpaceGrotesk_700Bold',
                  fontSize: 10,
                  letterSpacing: 0.6,
                  color: selected ? C.primary : C.secondary,
                }}>
                  {SCHEME_LABELS[scheme]}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        {error ? (
          <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 11, color: C.error }}>
            {error}
          </Text>
        ) : null}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
        <View style={{ flex: 1, minWidth: 180, gap: 4 }}>
          <FieldLabel>SCHEME HOLD</FieldLabel>
          <Stepper
            value={follow.methodHoldS}
            onChange={(methodHoldS) => rebuild({ ...follow, methodHoldS })}
            step={0.5}
            min={0}
            max={60}
            format={(value) => value === 0 ? 'CONTINUOUS' : `${value.toFixed(1)}s`}
          />
        </View>
        <View style={{ flex: 1, minWidth: 180, gap: 4 }}>
          <FieldLabel>SCHEME FADE</FieldLabel>
          <Stepper
            value={follow.methodFadeS}
            onChange={(methodFadeS) => rebuild({ ...follow, methodFadeS })}
            step={0.1}
            min={follow.methodHoldS === 0 ? 0.1 : 0}
            max={10}
            format={(value) => `${value.toFixed(1)}s`}
          />
        </View>
        <View style={{ flex: 1, minWidth: 180, gap: 4 }}>
          <FieldLabel>NOTE FADE</FieldLabel>
          <Stepper
            value={follow.noteFadeMs / 1000}
            onChange={(noteFade_s) => rebuild({ ...follow, noteFadeMs: Math.round(noteFade_s * 1000) })}
            step={0.05}
            min={0}
            max={2}
            format={(value) => `${value.toFixed(2)}s`}
          />
        </View>
      </View>
    </View>
  );
}

export function CueColorThemeEditor({
  value,
  onChange,
  paletteOptions,
}: CueColorThemeEditorProps) {
  const C = usePalette();
  const [modeError, setModeError] = useState<string | null>(null);
  let mode: CueColorThemeMode;
  try {
    mode = cueColorThemeMode(value);
  } catch (error) {
    return (
      <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 12, color: C.error }}>
        {error instanceof Error ? error.message : 'Unsupported color theme.'}
      </Text>
    );
  }
  const selectMode = (nextMode: CueColorThemeMode) => {
    try {
      onChange(defaultCueColorTheme(nextMode, paletteOptions[0]?.id));
      setModeError(null);
    } catch (error) {
      setModeError(error instanceof Error ? error.message : 'Could not change color theme.');
    }
  };
  return (
    <View style={{ gap: 14 }}>
      <Segmented
        value={mode}
        onChange={selectMode}
        options={[
          { id: 'twoTone', label: '2 TONE' },
          { id: 'fiveTone', label: '5 TONE' },
          { id: 'followNote', label: 'FOLLOW NOTE' },
          { id: 'savedPalettes', label: 'SAVED SET' },
        ]}
      />
      <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 11, lineHeight: 16, color: C.secondary }}>
        {mode === 'twoTone'
          ? twoToneBehavior(value as ActionColorAutopilotPalettes) === 'fixed'
            ? 'Apply one authored two-color pair and keep it fixed for the cue.'
            : 'Crossfade continuously between two authored colors.'
          : mode === 'fiveTone'
            ? 'Rotate five authored colors as adjacent two-tone looks.'
            : mode === 'followNote'
              ? 'Sample note activity and change color schemes with the music.'
              : 'Cycle palettes already saved in the engine library.'}
      </Text>
      {modeError ? (
        <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 11, color: C.error }}>
          {modeError}
        </Text>
      ) : null}
      {mode === 'twoTone' || mode === 'fiveTone' ? (
        <PaletteThemeEditor mode={mode} config={value as ActionColorAutopilotPalettes} onChange={onChange} />
      ) : mode === 'followNote' ? (
        <FollowNoteThemeEditor config={value as ActionColorAutopilotFollowNote} onChange={onChange} />
      ) : (
        <ColorAutopilotPanel
          bare
          title=""
          config={{
            ...(value as ActionColorAutopilotPalettes),
            shuffle: !!(value as ActionColorAutopilotPalettes).shuffle,
          }}
          onChange={(patch) => onChange(normalizeCueColorAutopilot({
            ...(value as ActionColorAutopilotPalettes),
            ...patch,
            mode: 'palettes',
            shuffle: patch.shuffle ?? !!(value as ActionColorAutopilotPalettes).shuffle,
          }))}
        />
      )}
    </View>
  );
}
