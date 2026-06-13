/**
 * DeckTransitionControls — operator UI for autopilot timer + deck transitions.
 *
 * Lives in the deck tab, under the existing AUTOPILOT TRANSITIONS row.
 * Two visual blocks share the same surfaceContainerHigh card theme as
 * the autopilot row, so the operator reads them as one cohesive panel:
 *
 *   AUTOPILOT TRANSITIONS         (existing, in index.tsx)
 *     PLAY / PAUSE   [TimerPillBar]   SHUFFLE       ← cycles patterns
 *
 *   DECK TRANSITIONS              (this component)
 *     ON / OFF       [STYLE picker ▾]                ← chooses transition
 *     DURATION [TimerPillBar — seconds, finer]
 *     SHUFFLE STYLE  toggle                          ← random style per swap
 *
 * The two-row layout for deck transitions keeps line lengths shorter than
 * cramming everything horizontally — important on the iPad's deck pane
 * where the right column is narrower than the mixer tab.
 *
 * State is owned by the parent (index.tsx) so a single WS-driven update
 * can re-render both blocks in lockstep. This file is purely a controlled
 * component.
 */
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Modal, Pressable } from 'react-native';
import { usePalette } from '@/hooks/use-theme';
import { useGlobalStyles } from '@/styles/globalStyles';
import { IconSymbol } from '@/components/ui/icon-symbol';

// ── TimerPillBar ────────────────────────────────────────────────────────
// Horizontal scrollable row of preset pills. Replaces the system Picker
// (which renders as a giant native wheel on iOS and is ugly + slow). Each
// pill is a self-contained button; the active one inverts to primary.
//
// Preset list is fixed and curated to match the operator's mental model
// of "show timing": short for tight cuts (1–5s), medium for sequenced
// changes (10–30s), long for set-and-forget (60–180s).
export const AUTOPILOT_TIMER_PRESETS_S = [1, 2, 3, 4, 5, 10, 15, 20, 30, 60, 120, 180];
export const TRANSITION_DURATION_PRESETS_MS = [200, 500, 1000, 1500, 2000, 3000, 5000, 8000, 15000];

function formatSeconds(s: number): string {
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r === 0 ? `${m}m` : `${m}m${r}s`;
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  return s % 1 === 0 ? `${s}s` : `${s.toFixed(1)}s`;
}

export function TimerPillBar({
  presets,
  value,
  onChange,
  formatter,
  label,
  compact = false,
}: {
  presets: number[];
  value: number;
  onChange: (v: number) => void;
  formatter: (v: number) => string;
  label?: string;
  // Compact = mixer-strip variant: smaller pills so the row fits next to
  // the Transition button + style picker without horizontal-scroll
  // overshoot. Default false preserves the deck panel's roomier sizing.
  compact?: boolean;
}) {
  const C = usePalette();
  const pillMinWidth = compact ? 36 : 48;
  const pillPaddingX = compact ? 8 : 12;
  const pillPaddingY = compact ? 6 : 8;
  const pillFontSize = compact ? 11 : 12;
  return (
    <View style={{ width: '100%' }}>
      {label ? (
        <Text style={{
          fontFamily: 'SpaceGrotesk_700Bold', fontSize: 9, letterSpacing: 1.2,
          color: C.icon, marginBottom: 3, textTransform: 'uppercase',
        }}>
          {label}
        </Text>
      ) : null}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: compact ? 4 : 6, paddingRight: 8 }}
      >
        {presets.map((preset) => {
          const active = preset === value;
          return (
            <TouchableOpacity
              key={preset}
              onPress={() => onChange(preset)}
              accessibilityRole="button"
              accessibilityLabel={`Set to ${formatter(preset)}`}
              style={{
                minWidth: pillMinWidth,
                paddingHorizontal: pillPaddingX,
                paddingVertical: pillPaddingY,
                borderRadius: 8,
                borderWidth: 1,
                borderColor: active ? C.primary : C.ghostBorder,
                backgroundColor: active ? C.primary : 'transparent',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text style={{
                fontFamily: 'SpaceGrotesk_700Bold',
                fontSize: pillFontSize,
                color: active ? '#FFF' : C.text,
                letterSpacing: 0.5,
              }}>
                {formatter(preset)}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

// Convenience wrappers so callers don't repeat the formatter argument.
export function AutopilotTimerPills({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <TimerPillBar
      presets={AUTOPILOT_TIMER_PRESETS_S}
      value={value}
      onChange={onChange}
      formatter={formatSeconds}
    />
  );
}

// ── TransitionStylePicker ───────────────────────────────────────────────
// Tap-to-open modal listing every trans_* blend script the engine knows
// about. We keep this list explicit (instead of fetching /transitions on
// open) so the operator sees the same names every time and there's no
// flash-of-empty while the request flies. The engine ignores any name
// it doesn't recognise (falls back to crossfade), so adding a name here
// without engine support is safe.
const TRANSITION_OPTIONS: { id: string; label: string; hint: string }[] = [
  { id: 'trans_crossfade',       label: 'CROSSFADE', hint: 'Smooth blend (default)' },
  { id: 'trans_flash',           label: 'FLASH',     hint: 'Full-white pop at midpoint' },
  { id: 'trans_color_burst',     label: 'BURST',     hint: 'Bursts through a saturated color' },
  { id: 'trans_dissolve',        label: 'DISSOLVE',  hint: 'Per-pixel random A or B' },
  { id: 'trans_wipe_right',      label: 'WIPE →',    hint: 'Reveal from left to right' },
  { id: 'trans_wipe_left',       label: 'WIPE ←',    hint: 'Reveal from right to left' },
  { id: 'trans_wipe_down',       label: 'WIPE ↓',    hint: 'Reveal from top to bottom' },
  { id: 'trans_diagonal_wipe',   label: 'DIAGONAL',  hint: 'Sweep from bottom-left to top-right' },
  { id: 'trans_wave_sweep',      label: 'WAVE',      hint: 'Wavy edge sweeping across' },
  { id: 'trans_iris',            label: 'IRIS OPEN', hint: 'Circular reveal from center' },
  { id: 'trans_iris_close',      label: 'IRIS CLOSE',hint: 'Circular reveal collapsing inward' },
  { id: 'trans_diamond_wipe',    label: 'DIAMOND',   hint: 'Diamond expanding from center' },
  { id: 'trans_split_horizontal',label: 'BAY DOORS', hint: 'Opens from horizontal centerline' },
  { id: 'trans_split_vertical',  label: 'CURTAIN',   hint: 'Opens from vertical centerline' },
  { id: 'trans_ripple_in',       label: 'RIPPLE',    hint: 'Concentric water rings' },
  { id: 'trans_morse_blink',     label: 'SOS',       hint: 'Morse SOS blink reveal' },
];

export function TransitionStylePicker({
  current,
  onSelect,
  disabled,
}: {
  current: string;
  onSelect: (id: string) => void;
  disabled?: boolean;
}) {
  const C = usePalette();
  const [open, setOpen] = useState(false);
  const currentMeta = TRANSITION_OPTIONS.find((o) => o.id === current) || TRANSITION_OPTIONS[0];

  return (
    <>
      <TouchableOpacity
        onPress={() => !disabled && setOpen(true)}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={`Transition style: ${currentMeta.label}`}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          paddingHorizontal: 12,
          paddingVertical: 10,
          borderRadius: 8,
          borderWidth: 1,
          borderColor: disabled ? C.ghostBorder : C.primary,
          backgroundColor: disabled ? 'transparent' : 'rgba(95, 35, 199, 0.10)',
          opacity: disabled ? 0.4 : 1,
          flex: 1,
        }}
      >
        <Text style={{
          fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11,
          color: disabled ? C.icon : C.primary, letterSpacing: 0.8, flex: 1,
        }}>
          {currentMeta.label}
        </Text>
        <Text style={{
          fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11,
          color: disabled ? C.icon : C.primary,
        }}>▾</Text>
      </TouchableOpacity>
      <Modal transparent visible={open} animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center' }}
          onPress={() => setOpen(false)}
        >
          <Pressable
            onPress={(e) => e.stopPropagation()}
            style={{
              width: 320, maxHeight: '80%',
              backgroundColor: C.surfaceContainerLowest, padding: 20,
              borderRadius: 12, borderWidth: 1, borderColor: C.ghostBorder,
            }}
          >
            <Text style={{
              fontFamily: 'SpaceGrotesk_700Bold', color: C.primary, fontSize: 14,
              textTransform: 'uppercase', letterSpacing: 1, marginBottom: 14,
            }}>
              Transition Style
            </Text>
            <ScrollView style={{ maxHeight: 400 }}>
              {TRANSITION_OPTIONS.map((opt) => {
                const active = opt.id === current;
                return (
                  <TouchableOpacity
                    key={opt.id}
                    onPress={() => { onSelect(opt.id); setOpen(false); }}
                    style={{
                      paddingHorizontal: 14, paddingVertical: 12,
                      borderRadius: 8, marginBottom: 6,
                      backgroundColor: active ? 'rgba(95, 35, 199, 0.15)' : 'transparent',
                      borderWidth: 1, borderColor: active ? C.primary : C.ghostBorder,
                    }}
                  >
                    <Text style={{
                      fontFamily: 'SpaceGrotesk_700Bold', fontSize: 13,
                      color: active ? C.primary : C.text, letterSpacing: 0.8,
                    }}>
                      {opt.label}
                    </Text>
                    <Text style={{
                      fontFamily: 'Inter_400Regular', fontSize: 11,
                      color: C.secondary, marginTop: 2,
                    }}>
                      {opt.hint}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

// ── DeckTransitionControls ──────────────────────────────────────────────
// The full panel — ON/OFF, style picker, duration pill-bar, shuffle.
// Layout matches the AUTOPILOT TRANSITIONS row's surfaceContainerHigh
// card so the two read as a single panel.
export function DeckTransitionControls({
  enabled,
  mode,
  durationMs,
  shuffle,
  onChange,
}: {
  enabled: boolean;
  mode: string;
  durationMs: number;
  shuffle: boolean;
  onChange: (patch: { enabled?: boolean; mode?: string; durationMs?: number; shuffle?: boolean }) => void;
}) {
  const globalStyles = useGlobalStyles();
  const C = usePalette();
  const styleDisabled = shuffle; // when shuffle is on, the picked mode is ignored

  // Card-internal header — moved INSIDE the card (May 2026 compaction)
  // to reclaim the vertical space the freestanding label used to occupy
  // above the card. Reuses the same SpaceGrotesk_700Bold / secondary /
  // uppercase recipe that `labelCaps` codifies elsewhere in the UI; the
  // value is duplicated inline (no new style export) to keep the
  // component self-contained.
  return (
    <View style={{
      paddingHorizontal: 8, paddingTop: 6, paddingBottom: 8,
      borderRadius: 8, gap: 6,
      backgroundColor: C.surfaceContainerHigh,
      ...globalStyles.ghostBorder,
      marginBottom: 16,
    }}>
      {/* Row 1: header label + ON/OFF + Style picker on the same line.
          Hoisting the "DECK TRANSITIONS" label onto the controls row
          (May 2026 compaction) eliminates the dedicated header row's
          ~24px and lets the card breathe horizontally instead. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text style={{
          fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10,
          letterSpacing: 1.2, color: C.secondary,
          textTransform: 'uppercase',
        }}>
          DECK TX
        </Text>
        <TouchableOpacity
          onPress={() => onChange({ enabled: !enabled })}
          accessibilityRole="switch"
          accessibilityLabel={enabled ? 'Disable deck transitions' : 'Enable deck transitions'}
          style={{
            flexDirection: 'row', alignItems: 'center', gap: 6,
            paddingHorizontal: 12, paddingVertical: 8, borderRadius: 6,
            borderWidth: 1,
            borderColor: enabled ? 'transparent' : C.ghostBorder,
            backgroundColor: enabled ? C.primary : 'transparent',
            minWidth: 70,
          }}
        >
          <IconSymbol
            name={enabled ? 'checkmark.circle.fill' : 'circle'}
            size={14}
            color={enabled ? '#FFF' : C.icon}
          />
          <Text style={{
            fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11,
            color: enabled ? '#FFF' : C.text, letterSpacing: 0.5,
          }}>
            {enabled ? 'ON' : 'OFF'}
          </Text>
        </TouchableOpacity>
        <TransitionStylePicker
          current={mode}
          onSelect={(m) => onChange({ mode: m })}
          disabled={styleDisabled || !enabled}
        />
      </View>

      {/* Row 2: duration pill-bar */}
      <View style={{ opacity: enabled ? 1 : 0.5, pointerEvents: enabled ? 'auto' : 'none' }}>
        <TimerPillBar
          label="DURATION"
          presets={TRANSITION_DURATION_PRESETS_MS}
          value={durationMs}
          onChange={(v) => onChange({ durationMs: v })}
          formatter={formatMs}
        />
      </View>

      {/* Row 3: shuffle style — paddingVertical 6 is the original spec.
          The IconSymbol + label together stand ~24pt tall; the surrounding
          TouchableOpacity's hit-slop in RN expands the actual touch
          target. We accept the visual height in service of compaction. */}
      <TouchableOpacity
        onPress={() => enabled && onChange({ shuffle: !shuffle })}
        disabled={!enabled}
        accessibilityRole="switch"
        accessibilityLabel={shuffle ? 'Disable transition style shuffle' : 'Enable transition style shuffle'}
        style={{
          flexDirection: 'row', alignItems: 'center', gap: 8,
          paddingHorizontal: 8, paddingVertical: 6,
          opacity: enabled ? 1 : 0.5,
        }}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <IconSymbol name="shuffle" size={14} color={shuffle ? C.primary : C.icon} />
        <Text style={{
          fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11,
          color: shuffle ? C.primary : C.icon, letterSpacing: 0.5,
        }}>
          SHUFFLE STYLE — RANDOMIZE EACH SWAP
        </Text>
      </TouchableOpacity>
    </View>
  );
}
