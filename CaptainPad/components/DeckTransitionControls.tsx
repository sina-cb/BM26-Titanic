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
import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Modal, Pressable, useWindowDimensions } from 'react-native';
import { usePalette } from '@/hooks/use-theme';
import { useGlobalStyles } from '@/styles/globalStyles';
import { IconSymbol } from '@/components/ui/icon-symbol';

// ── SwapCountdown ───────────────────────────────────────────────────────
// A "🕐 M:SS" chip counting down to the next autopilot swap. Self-contained:
// it owns its OWN 1 Hz ticker so ONLY this tiny node re-renders each second —
// NOT the whole deck screen. (An earlier version drove the ticker from the deck
// screen's top-level state, which re-rendered the entire heavy deck tree every
// second and made the autopilot controls feel laggy — 2026-07-04.) Ticks only
// while a swap is scheduled (targetMs != null); renders null otherwise, so an
// idle deck runs no interval. `targetMs` is the absolute wall-clock ms the
// engine stamped for the next swap (re-broadcast on every cycle), so the chip
// stays accurate whether the operator or a plan cue drives the cadence.
export const SwapCountdown: React.FC<{ targetMs: number | null }> = React.memo(({ targetMs }) => {
  const C = usePalette();
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const active = targetMs !== null && Number.isFinite(targetMs);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  if (!active) return null;
  const total = Math.max(0, Math.round(((targetMs as number) - nowMs) / 1000));
  const label = `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <IconSymbol name="clock" size={11} color={C.primary} />
      <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11, color: C.primary, letterSpacing: 0.5 }}>
        {label}
      </Text>
    </View>
  );
});
SwapCountdown.displayName = 'SwapCountdown';

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
  const { width, height } = useWindowDimensions();
  const isPortrait = width < height;
  const pillMinWidth = compact ? 36 : 48;
  const pillPaddingX = compact ? 8 : 12;
  const pillPaddingY = compact ? 6 : 8;
  const pillFontSize = compact ? 11 : 12;

  // One pill renderer for both orientations so the active-pill fill +
  // contrast token are identical landscape and portrait (QA #19: the teal
  // active fill must read the same in both). The active state uses the
  // primary fill with white text PLUS a thicker primary border so it stays
  // legible even in the tighter portrait column.
  const renderPill = (preset: number) => {
    const active = preset === value;
    return (
      <TouchableOpacity
        key={preset}
        onPress={() => onChange(preset)}
        accessibilityRole="button"
        accessibilityState={{ selected: active }}
        accessibilityLabel={`Set to ${formatter(preset)}`}
        style={{
          minWidth: pillMinWidth,
          paddingHorizontal: pillPaddingX,
          paddingVertical: pillPaddingY,
          borderRadius: 8,
          borderWidth: active ? 2 : 1,
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
  };

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
      {/* Portrait: the full preset row is wider than the narrow deck column,
          so a horizontal ScrollView would slice the rightmost chip into an
          unreachable sliver (QA #10). Wrap to multiple lines instead — every
          chip stays fully visible and tappable. Landscape has the width to
          lay the row out flat, so keep the single-line scroll there. */}
      {isPortrait ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: compact ? 4 : 6 }}>
          {presets.map(renderPill)}
        </View>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: compact ? 4 : 6, paddingRight: 8 }}
        >
          {presets.map(renderPill)}
        </ScrollView>
      )}
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
  bare = false,
}: {
  enabled: boolean;
  mode: string;
  durationMs: number;
  shuffle: boolean;
  onChange: (patch: { enabled?: boolean; mode?: string; durationMs?: number; shuffle?: boolean }) => void;
  /** Render WITHOUT the outer surfaceContainerHigh card — for nesting inside
   *  another card (e.g. the AUTOPILOT PATTERNS card) so it reads as a
   *  sub-section, not a card-in-card. The parent supplies the padding + bg. */
  bare?: boolean;
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
    <View style={bare ? { paddingTop: 6, gap: 6 } : {
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

      {/* Row 2: crossfade-duration pill-bar.
          When DECK TX is OFF the duration is moot, so the row is disabled.
          QA #9: the old treatment (a flat 0.5 opacity over the whole row) read
          as "broken" — the greyed pills were barely distinguishable from a
          normal enabled-unselected pill elsewhere, and there was no hint that
          the toggle controls it. We now (a) show an explicit one-line hint in
          place of the pills when OFF, and (b) only render the pill-bar when ON,
          so the enabled state is unambiguous (live, full-contrast pills) and
          the disabled state reads as intentional rather than failed. */}
      {enabled ? (
        <TimerPillBar
          label="CROSSFADE TIME"
          presets={TRANSITION_DURATION_PRESETS_MS}
          value={durationMs}
          onChange={(v) => onChange({ durationMs: v })}
          formatter={formatMs}
        />
      ) : (
        <View style={{ paddingVertical: 6 }}>
          {/* QA round8 #6: the disabled treatment used C.icon (the faint
              outline-variant token) which dropped below the contrast floor and
              read as a rendering artifact. Use C.secondary — a dim-but-legible
              disabled token — for both the label and the hint so the OFF state
              reads as intentional, not broken. */}
          <Text style={{
            fontFamily: 'SpaceGrotesk_700Bold', fontSize: 9, letterSpacing: 1.2,
            color: C.secondary, marginBottom: 3, textTransform: 'uppercase',
          }}>
            CROSSFADE TIME
          </Text>
          <Text style={{
            fontFamily: 'Inter_400Regular', fontSize: 11, color: C.secondary,
          }}>
            Turn DECK TX on to set crossfade time.
          </Text>
        </View>
      )}

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
          // QA round8 #6: the old 0.5 opacity on the disabled row dropped it
          // below the contrast floor and read as an artifact. Lift to 0.8 so
          // it stays clearly readable (dim, but intentional) when DECK TX is
          // OFF; the colors below also use C.secondary instead of the faint
          // C.icon for the same reason.
          opacity: enabled ? 1 : 0.8,
        }}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <IconSymbol name="shuffle" size={14} color={shuffle ? C.primary : C.secondary} />
        {/* QA #9: the full caption was clipped to an unreadable
            "…STYLE — …DROP MAP" in the narrow portrait column. Let it wrap
            (flex + no truncation) so the whole label stays legible. */}
        <Text style={{
          flex: 1,
          fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11,
          color: shuffle ? C.primary : C.secondary, letterSpacing: 0.5,
        }}>
          SHUFFLE STYLE — RANDOMIZE EACH SWAP
        </Text>
      </TouchableOpacity>
    </View>
  );
}
