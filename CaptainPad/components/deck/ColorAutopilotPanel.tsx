import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { usePalette } from '@/hooks/use-theme';
import { useGlobalStyles } from '@/styles/globalStyles';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { TimerPillBar, SwapCountdown } from '@/components/DeckTransitionControls';
import { DualSwatch } from '@/components/ColorPickerModal';
import { getCachedColorPalettes, warmColorPalettesCache } from '@/utils/api';
import type { DeckColorAutopilotConfig } from '@/utils/api';

// ── ColorAutopilotPanel ────────────────────────────────────────────────
// DECK color autopilot (operator request: "in the autopilot, select a set of
// palettes that switch on their own timer"). Sits in the deck's autopilot
// area, next to the pattern AUTOPILOT card, and is its visual analogue:
//   ON/OFF toggle · SELECTED palette chips (+ add) · delay · TRANSITION · SHUFFLE.
//
// Presentational only — the parent (deck screen) owns the fetch-on-focus +
// live `colorAutopilot` /ws/control reconcile + optimistic-POST plumbing (same
// pattern as handleDeckTxChange) and hands us the live config + an
// onChange(patch). Because the config is kept live from the broadcast, this
// panel faithfully DISPLAYS a PLAN-driven cue's palettes/shuffle/delay/
// transition even while `disabled` (the soft plan lock) — read-only sync. Palette ids come from the engine's
// color-palette library (config.colorPalettes {id,name,c1,c2}); we read the
// SAME cached list the COLORS picker uses (getCachedColorPalettes) and warm it
// on mount so the chips render immediately. Palette swatches reuse the COLORS
// picker's `DualSwatch` so a chip shows the palette's REAL c1/c2 hues (operator
// feedback: the chips were rendering red).
//
// COMPACT, SELECTED-ONLY list (operator feedback): by default we render only
// the currently-selected palettes as removable chips plus an "+ ADD" affordance
// that expands the full library inline; we never dump the whole 20-palette grid.
//
// Delay presets mirror the pattern autopilot's cadence pills; the TRANSITION
// pill-bar mirrors the DECK TX "crossfade time" idiom (ms under the hood).
const COLOR_AUTOPILOT_DELAY_PRESETS = [5, 10, 15, 30, 60, 120, 180];
// Crossfade presets: 0 (hard cut) + a few smooth ramps. ms under the hood.
const COLOR_AUTOPILOT_TRANSITION_PRESETS_MS = [0, 500, 1000, 2000, 3000];

function formatTransition(ms: number): string {
  if (ms <= 0) return 'CUT';
  return ms % 1000 === 0 ? `${ms / 1000}s` : `${(ms / 1000).toFixed(1)}s`;
}

export interface ColorAutopilotPanelProps {
  config: DeckColorAutopilotConfig;
  onChange: (patch: Partial<DeckColorAutopilotConfig>) => void;
  /** Disable every control (offline, or the soft PLAN lock is engaged). The
   *  panel still RENDERS (read-only) so the operator can see the live state. */
  disabled?: boolean;
  /** Absolute wall-clock ms of the next palette swap, or null when none is
   *  scheduled. Rendered by the self-ticking <SwapCountdown> (which owns its own
   *  1 Hz interval), so it ticks the same whether the operator or a plan cue
   *  drives the cadence — without re-rendering the deck screen. */
  countdownTargetMs?: number | null;
  /** Render WITHOUT the outer surfaceContainerHigh card chrome, for embedding in
   *  another card (e.g. the cue editor). Default = full card wrapper. Mirrors the
   *  sibling PatternAutopilotPanel's `bare`. */
  bare?: boolean;
  /** Card header label. Default "AUTOPILOT COLORS". */
  title?: string;
}

export const ColorAutopilotPanel: React.FC<ColorAutopilotPanelProps> = ({ config, onChange, disabled, countdownTargetMs, bare = false, title = 'AUTOPILOT COLORS' }) => {
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
  const byId = new Map(palettes.map((p) => [p.id, p]));

  // "+ ADD" popover state: when open, the full library is shown inline so the
  // operator can pick more palettes; collapsed by default to stay compact.
  const [adding, setAdding] = useState(false);

  const selectedIds = config.palettes;
  const selectedSet = new Set(selectedIds);
  const transitionMs = config.transitionMs ?? 0;
  // The engine contract requires >=1 palette id on EVERY write (the POST is
  // merged over the live config, then validated strictly), so with an empty
  // selection a delay/transition tap would 400 + roll back — the pills looked
  // alive but "did nothing" (operator report 2026-07-03). Grey those rows out
  // with an explicit hint until a palette is added.
  const noPalettes = selectedIds.length === 0;

  // Remove a selected palette. The engine contract requires >=1 palette id, so
  // a removal that would empty the set is a no-op (mirrors the deck's fail-loud
  // posture: we don't post an invalid empty set).
  const removePalette = (id: string) => {
    if (disabled) return;
    if (selectedSet.size <= 1) return; // keep at least one
    onChange({ palettes: selectedIds.filter((x) => x !== id) });
  };
  // Add a palette from the library popover (idempotent — already-selected is a
  // no-op so a double-tap can't duplicate).
  const addPalette = (id: string) => {
    if (disabled) return;
    if (selectedSet.has(id)) return;
    onChange({ palettes: [...selectedIds, id] });
  };

  return (
    <View style={bare
      ? { gap: 8, opacity: disabled ? 0.6 : 1 }
      : { marginBottom: 12, paddingHorizontal: 8, paddingTop: 6, paddingBottom: 8, borderRadius: 8, backgroundColor: C.surfaceContainerHigh, ...globalStyles.ghostBorder, gap: 8, opacity: disabled ? 0.6 : 1 }}>
      {/* Header row: label + ON/PAUSE + SHUFFLE — same recipe as the pattern
          AUTOPILOT card so the two read as a matched pair. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 }}>
          <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10, letterSpacing: 1.2, color: C.secondary, textTransform: 'uppercase' }}>{title}</Text>
          {/* Next-palette-swap countdown — matched pair with the pattern
              autopilot's timer chip; self-ticking, only shows while a swap is
              scheduled. */}
          <SwapCountdown targetMs={countdownTargetMs ?? null} />
          {/* PLAY/PAUSE + SHUFFLE are DISABLED (greyed) until >=1 palette is
              selected: the engine rejects an active/empty color autopilot, so
              tapping PLAY with no palettes just 400'd + snapped back. Same
              no-palettes gate as the timer/transition rows below. */}
          <TouchableOpacity
            disabled={disabled || noPalettes}
            onPress={() => { if (!noPalettes) onChange({ active: !config.active }); }}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: config.active ? C.primary : 'transparent', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 6, borderWidth: 1, borderColor: config.active ? 'transparent' : C.ghostBorder, opacity: noPalettes ? 0.4 : 1 }}
            accessibilityRole="switch"
            accessibilityState={{ checked: config.active, disabled: !!disabled || noPalettes }}
            accessibilityLabel={noPalettes ? 'Add a palette to play color autopilot' : (config.active ? 'Pause color autopilot' : 'Play color autopilot')}
          >
            <IconSymbol name={config.active ? 'pause.fill' : 'play.fill'} size={16} color={config.active ? '#FFF' : C.text} />
            <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: config.active ? '#FFF' : C.text, fontSize: 12 }}>
              {config.active ? 'PAUSE' : 'PLAY'}
            </Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity
          disabled={disabled || noPalettes}
          onPress={() => { if (!noPalettes) onChange({ shuffle: !config.shuffle }); }}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 8, paddingVertical: 8, opacity: noPalettes ? 0.4 : 1 }}
          accessibilityRole="switch"
          accessibilityState={{ checked: config.shuffle, disabled: !!disabled || noPalettes }}
          accessibilityLabel={noPalettes ? 'Add a palette to enable color shuffle' : (config.shuffle ? 'Disable color shuffle' : 'Enable color shuffle')}
        >
          <IconSymbol name="shuffle" size={16} color={config.shuffle ? C.primary : C.icon} />
          <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: config.shuffle ? C.primary : C.icon, fontSize: 12, letterSpacing: 0.5 }}>SHUFFLE</Text>
        </TouchableOpacity>
      </View>

      {/* SELECTED palettes — compact, removable chips with REAL c1/c2 swatches,
          plus a "+ ADD" affordance that expands the full library inline. We
          never render the entire library grid by default (operator feedback). */}
      <View style={{ gap: 4 }}>
        <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 9, letterSpacing: 1.2, color: C.icon, textTransform: 'uppercase' }}>PALETTES</Text>
        {palettes.length === 0 ? (
          <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 11, color: C.secondary, fontStyle: 'italic' }}>
            No palettes in the rig library.
          </Text>
        ) : (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
            {selectedIds.map((id) => {
              const p = byId.get(id);
              if (!p) return null;
              const canRemove = selectedSet.size > 1;
              return (
                <TouchableOpacity
                  key={id}
                  disabled={disabled || !canRemove}
                  onPress={() => removePalette(id)}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: !!disabled || !canRemove }}
                  accessibilityLabel={`Remove palette ${p.name}`}
                  style={{
                    paddingLeft: 8, paddingRight: 8, paddingVertical: 6,
                    borderRadius: 8, borderWidth: 2, borderColor: C.primary,
                    backgroundColor: C.primary, flexDirection: 'row',
                    alignItems: 'center', gap: 6,
                  }}
                >
                  {/* Real c1/c2 hues — same split swatch the COLORS picker uses. */}
                  <DualSwatch h1={p.c1} h2={p.c2} size={14} />
                  <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11, color: '#FFF', letterSpacing: 0.4 }}>
                    {p.name.toUpperCase()}
                  </Text>
                  {canRemove ? (
                    <IconSymbol name="xmark" size={11} color="#FFF" />
                  ) : null}
                </TouchableOpacity>
              );
            })}
            {/* "+ ADD" — toggles the inline library popover below. */}
            <TouchableOpacity
              disabled={disabled}
              onPress={() => setAdding((v) => !v)}
              accessibilityRole="button"
              accessibilityState={{ expanded: adding, disabled: !!disabled }}
              accessibilityLabel={adding ? 'Close palette picker' : 'Add palettes'}
              style={{
                paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8,
                borderWidth: 1, borderColor: C.ghostBorder, borderStyle: 'dashed',
                flexDirection: 'row', alignItems: 'center', gap: 4,
              }}
            >
              <IconSymbol name={adding ? 'chevron.up' : 'plus'} size={12} color={C.text} />
              <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11, color: C.text, letterSpacing: 0.4 }}>
                {adding ? 'DONE' : 'ADD'}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Inline library popover — only the UNSELECTED palettes, tap to add.
            Collapsed by default so the panel stays compact. */}
        {adding && palettes.length > 0 ? (
          <View style={{ marginTop: 6, padding: 8, borderRadius: 8, backgroundColor: C.surfaceContainerLow, borderWidth: 1, borderColor: C.ghostBorder }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {palettes.filter((p) => !selectedSet.has(p.id)).length === 0 ? (
                <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 11, color: C.secondary, fontStyle: 'italic' }}>
                  All palettes selected.
                </Text>
              ) : (
                palettes.filter((p) => !selectedSet.has(p.id)).map((p) => (
                  <TouchableOpacity
                    key={p.id}
                    disabled={disabled}
                    onPress={() => addPalette(p.id)}
                    accessibilityRole="button"
                    accessibilityLabel={`Add palette ${p.name}`}
                    style={{
                      paddingHorizontal: 8, paddingVertical: 6, borderRadius: 8,
                      borderWidth: 1, borderColor: C.ghostBorder, backgroundColor: 'transparent',
                      flexDirection: 'row', alignItems: 'center', gap: 6,
                    }}
                  >
                    <DualSwatch h1={p.c1} h2={p.c2} size={14} />
                    <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11, color: C.text, letterSpacing: 0.4 }}>
                      {p.name.toUpperCase()}
                    </Text>
                  </TouchableOpacity>
                ))
              )}
            </View>
          </View>
        ) : null}
      </View>

      {/* Delay stepper — how long each palette holds before the next switches
          in. Reuses the same compact cadence pills as the pattern autopilot.
          With ZERO palettes selected the row is replaced by an explicit hint
          (same disabled idiom as DECK TX's crossfade-time row — QA #9 ruled
          that flat-opacity greyed pills read as "broken"): every write needs
          >=1 palette, so live-looking pills here would just 400 + snap back. */}
      {noPalettes ? (
        <View style={{ paddingVertical: 2 }}>
          <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 9, letterSpacing: 1.2, color: C.secondary, marginBottom: 3, textTransform: 'uppercase' }}>
            SWITCH EVERY
          </Text>
          <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 11, color: C.secondary }}>
            Add at least one palette to set the switch timer.
          </Text>
        </View>
      ) : (
        <TimerPillBar
          label="SWITCH EVERY"
          compact
          presets={COLOR_AUTOPILOT_DELAY_PRESETS}
          value={config.delay_s}
          onChange={(v) => { if (!disabled) onChange({ delay_s: v }); }}
          formatter={(v) => (v < 60 ? `${v}s` : `${v % 60 === 0 ? v / 60 : (v / 60).toFixed(1)}m`)}
        />
      )}

      {/* Transition (crossfade) time — the palette analogue of DECK TX crossfade
          time. CUT = hard switch; otherwise the engine ramps the palette params
          over this window (ADDITIVE to the hold: delay_s + transition per
          cycle). ms under the hood. Same no-palettes gating as SWITCH EVERY. */}
      {noPalettes ? (
        <View style={{ paddingVertical: 2 }}>
          <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 9, letterSpacing: 1.2, color: C.secondary, marginBottom: 3, textTransform: 'uppercase' }}>
            TRANSITION
          </Text>
          <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 11, color: C.secondary }}>
            Add at least one palette to set the transition time.
          </Text>
        </View>
      ) : (
        <TimerPillBar
          label="TRANSITION"
          compact
          presets={COLOR_AUTOPILOT_TRANSITION_PRESETS_MS}
          value={transitionMs}
          onChange={(v) => { if (!disabled) onChange({ transitionMs: v }); }}
          formatter={formatTransition}
        />
      )}
    </View>
  );
};
