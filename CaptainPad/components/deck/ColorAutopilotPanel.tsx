import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { usePalette } from '@/hooks/use-theme';
import { useGlobalStyles } from '@/styles/globalStyles';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { TimerPillBar } from '@/components/DeckTransitionControls';
import { getCachedColorPalettes, warmColorPalettesCache } from '@/utils/api';
import type { DeckColorAutopilotConfig } from '@/utils/api';

// ── ColorAutopilotPanel ────────────────────────────────────────────────
// DECK color autopilot (operator request: "in the autopilot, select a set of
// palettes that switch on their own timer"). Sits in the deck's autopilot
// area, next to the pattern AUTOPILOT card, and is its visual analogue:
//   ON/OFF toggle · multi-select palette chips · delay stepper · SHUFFLE.
//
// Presentational only — the parent (deck screen) owns the fetch-on-focus +
// optimistic-POST plumbing (same pattern as handleDeckTxChange) and hands us
// the live config + an onChange(patch). Palette ids come from the engine's
// color-palette library (config.colorPalettes {id,name}); we read the SAME
// cached list the COLORS picker uses (getCachedColorPalettes) and warm it on
// mount so the chips render immediately.
//
// Delay presets mirror the pattern autopilot's cadence pills.
const COLOR_AUTOPILOT_DELAY_PRESETS = [5, 10, 15, 30, 60, 120, 180];

export interface ColorAutopilotPanelProps {
  config: DeckColorAutopilotConfig;
  onChange: (patch: Partial<DeckColorAutopilotConfig>) => void;
  /** Disable every control (offline, or the soft PLAN lock is engaged). The
   *  panel still RENDERS (read-only) so the operator can see the live state. */
  disabled?: boolean;
}

export const ColorAutopilotPanel: React.FC<ColorAutopilotPanelProps> = ({ config, onChange, disabled }) => {
  const C = usePalette();
  const globalStyles = useGlobalStyles();

  // Read the cached palette library; warm it on mount so the chips are
  // populated even on a cold open (same self-healing cache the COLORS picker
  // relies on). A version bump forces a re-render once the warm lands.
  const [, setPaletteVersion] = useState(0);
  useEffect(() => {
    let alive = true;
    void warmColorPalettesCache().then(() => {
      if (alive) setPaletteVersion((v) => v + 1);
    });
    return () => { alive = false; };
  }, []);
  const palettes = getCachedColorPalettes();

  const selected = new Set(config.palettes);
  // Toggling a chip never lets the operator clear the LAST selected palette —
  // the engine contract requires >=1 palette id, so a tap that would empty the
  // set is a no-op (the chip stays selected). Mirrors the deck's fail-loud
  // posture: we don't post an invalid empty set.
  const togglePalette = (id: string) => {
    if (disabled) return;
    const next = new Set(selected);
    if (next.has(id)) {
      if (next.size <= 1) return; // keep at least one
      next.delete(id);
    } else {
      next.add(id);
    }
    onChange({ palettes: Array.from(next) });
  };

  return (
    <View style={{ marginBottom: 12, paddingHorizontal: 8, paddingTop: 6, paddingBottom: 8, borderRadius: 8, backgroundColor: C.surfaceContainerHigh, ...globalStyles.ghostBorder, gap: 8, opacity: disabled ? 0.6 : 1 }}>
      {/* Header row: label + ON/PAUSE + SHUFFLE — same recipe as the pattern
          AUTOPILOT card so the two read as a matched pair. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 }}>
          <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10, letterSpacing: 1.2, color: C.secondary, textTransform: 'uppercase' }}>COLOR AUTOPILOT</Text>
          <TouchableOpacity
            disabled={disabled}
            onPress={() => onChange({ active: !config.active })}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: config.active ? C.primary : 'transparent', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 6, borderWidth: 1, borderColor: config.active ? 'transparent' : C.ghostBorder }}
            accessibilityRole="switch"
            accessibilityState={{ checked: config.active, disabled: !!disabled }}
            accessibilityLabel={config.active ? 'Pause color autopilot' : 'Play color autopilot'}
          >
            <IconSymbol name={config.active ? 'pause.fill' : 'play.fill'} size={16} color={config.active ? '#FFF' : C.text} />
            <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: config.active ? '#FFF' : C.text, fontSize: 12 }}>
              {config.active ? 'PAUSE' : 'PLAY'}
            </Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity
          disabled={disabled}
          onPress={() => onChange({ shuffle: !config.shuffle })}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 8, paddingVertical: 8 }}
          accessibilityRole="switch"
          accessibilityState={{ checked: config.shuffle, disabled: !!disabled }}
          accessibilityLabel={config.shuffle ? 'Disable color shuffle' : 'Enable color shuffle'}
        >
          <IconSymbol name="shuffle" size={16} color={config.shuffle ? C.primary : C.icon} />
          <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: config.shuffle ? C.primary : C.icon, fontSize: 12, letterSpacing: 0.5 }}>SHUFFLE</Text>
        </TouchableOpacity>
      </View>

      {/* Palette multi-select chips. Tap to add/remove; the active chips carry
          the primary fill (matching the pattern list's selection language). */}
      <View style={{ gap: 4 }}>
        <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 9, letterSpacing: 1.2, color: C.icon, textTransform: 'uppercase' }}>PALETTES</Text>
        {palettes.length === 0 ? (
          <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 11, color: C.secondary, fontStyle: 'italic' }}>
            No palettes in the rig library.
          </Text>
        ) : (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {palettes.map((p) => {
              const isOn = selected.has(p.id);
              return (
                <TouchableOpacity
                  key={p.id}
                  disabled={disabled}
                  onPress={() => togglePalette(p.id)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isOn, disabled: !!disabled }}
                  accessibilityLabel={`${isOn ? 'Remove' : 'Add'} palette ${p.name}`}
                  style={{
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                    borderRadius: 8,
                    borderWidth: isOn ? 2 : 1,
                    borderColor: isOn ? C.primary : C.ghostBorder,
                    backgroundColor: isOn ? C.primary : 'transparent',
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  {/* Twin swatches preview the palette's c1/c2 hues so the
                      operator can recognize a palette by color, not name alone. */}
                  <View style={{ flexDirection: 'row' }}>
                    <View style={{ width: 10, height: 10, borderTopLeftRadius: 3, borderBottomLeftRadius: 3, backgroundColor: `hsl(${Math.round(p.c1)}, 80%, 55%)` }} />
                    <View style={{ width: 10, height: 10, borderTopRightRadius: 3, borderBottomRightRadius: 3, backgroundColor: `hsl(${Math.round(p.c2)}, 80%, 55%)` }} />
                  </View>
                  <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11, color: isOn ? '#FFF' : C.text, letterSpacing: 0.4 }}>
                    {p.name.toUpperCase()}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </View>

      {/* Delay stepper — how long each palette holds before the next switches
          in. Reuses the same compact cadence pills as the pattern autopilot. */}
      <TimerPillBar
        label="SWITCH EVERY"
        compact
        presets={COLOR_AUTOPILOT_DELAY_PRESETS}
        value={config.delay_s}
        onChange={(v) => { if (!disabled) onChange({ delay_s: v }); }}
        formatter={(v) => (v < 60 ? `${v}s` : `${v % 60 === 0 ? v / 60 : (v / 60).toFixed(1)}m`)}
      />
    </View>
  );
};
