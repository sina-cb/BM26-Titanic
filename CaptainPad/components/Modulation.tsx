// Modulation UI (Phase 1C, docs/26).
//
// One file because the three pieces are tightly coupled:
//
//   - useModulationState : engineEvents bus subscription, returns the
//                          latest modulationState frame's per-target map.
//   - useEntryModulations : on-demand fetch of the active deck entry's
//                          mappings, refreshed on `playlistSaved` WS.
//   - ModulatedSlider    : drop-in wrapper for the local-slider row in
//                          GlobalParams. Adds the [◎] badge, a colored
//                          ghost-handle overlay on the track when the
//                          slider is mapped, and the popover trigger.
//   - ModulationPopover  : Source / Mode / Polarity / Range / Curve
//                          editor with [Save] / [Remove] / [Cancel].

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Modal, Pressable, ScrollView, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import Svg, { Path, Line, Circle } from 'react-native-svg';
import { usePalette } from '@/hooks/use-theme';
import { useAudioSignals, useLiveParams, type AudioSignalDescriptor } from '@/hooks/useEngineState';
import { HorizontalFader } from '@/components/ui/HorizontalFader';
import { AudioTraceCanvas } from '@/components/audio/AudioTraceCanvas';
import { audioAccentHex } from '@/utils/audioSignals';
import { engineEvents } from '@/utils/engineEvents';
import { engineParamsEvents } from '@/utils/engineParamsEvents';
import {
  deleteModulation, fetchPlaylist, migrateModulationMode, ModulationCurve, ModulationMapping,
  ModulationMode, ModulationPolarity, ModulationSourceKey, patchModulation, putModulation,
} from '@/utils/api';

// ── modulationState frame subscription ──────────────────────────────
//
// `modulationState` rides /ws/params alongside sharedParams (it's a
// "values changing live" delta, not a UI/state event). The ws_topic
// routing table pins this — keep this subscription on
// `engineParamsEvents` or the deck's ghost-slider overlay goes dark.
// Subscribing to engineEvents (the /ws/control bus) here was the May
// 2026 regression that made "Save" feel like a no-op: the engine WAS
// modulating the pattern, but the ghost never animated because the
// frames were on a different socket.

type ModulationParamLive = {
  base: number;
  modulated: number;
  source?: string;
  mappingId?: string;
};

export function useModulationState(): Record<string, ModulationParamLive> {
  const [state, setState] = useState<Record<string, ModulationParamLive>>({});
  useEffect(() => {
    return engineParamsEvents.subscribe((m) => {
      if (m && m.type === 'modulationState' && m.parameters && typeof m.parameters === 'object') {
        // Engine emits a final empty-parameters frame the instant a
        // mapping is deleted (modulation_controller's >0 → 0
        // transition gate), so adopting whole-state-replacement here
        // is enough to clear the green ghost without any local
        // bookkeeping.
        setState(m.parameters as Record<string, ModulationParamLive>);
      }
    });
  }, []);
  return state;
}

// ── per-entry mapping fetch ─────────────────────────────────────────

export function useEntryModulations(
  playlistName: string | null | undefined,
  entryId: string | null | undefined,
): { mappings: ModulationMapping[]; refresh: () => void } {
  const [mappings, setMappings] = useState<ModulationMapping[]>([]);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!playlistName || !entryId) { setMappings([]); return; }
    let cancelled = false;
    // Use the cached `fetchPlaylist` (5 s TTL, deduped, primed by
    // engine WS broadcasts) — `useEntryModulations` may be called
    // from N mixer channel strips simultaneously, so an uncached
    // fetch per strip would hammer the engine on channel-add bursts.
    fetchPlaylist(playlistName).then((r) => {
      if (cancelled) return;
      if (!r.ok || !r.data) { setMappings([]); return; }
      const entries = r.data.entries as { id?: string; modulations?: ModulationMapping[] }[] | undefined;
      const entry = Array.isArray(entries)
        ? entries.find((e) => e && e.id === entryId)
        : null;
      // Migrate the legacy 'scale' mode → 'multiply' on read (mirrors the
      // engine's validateModulationMapping back-compat) so a stored mapping
      // never surfaces an unknown mode to the picker / preview math.
      const loaded = Array.isArray(entry?.modulations) ? entry!.modulations! : [];
      setMappings(loaded.map((m) => ({ ...m, mode: migrateModulationMode(m.mode) })));
    });
    return () => { cancelled = true; };
  }, [playlistName, entryId, tick]);

  // Re-fetch on playlistSaved for our playlist so external mutations
  // (other CaptainPad sessions, PortWatch, REST) update the panel.
  useEffect(() => {
    return engineEvents.subscribe((m) => {
      if (m && m.type === 'playlistSaved' && m.name === playlistName) {
        refresh();
      }
    });
  }, [playlistName, refresh]);

  return { mappings, refresh };
}

// ── slider name helpers ─────────────────────────────────────────────

export function prettySliderName(name: string): string {
  return name
    // Strip optional `_vN` version suffix some patterns put on exports
    // (e.g. `sliderColorVariation_v2`). Deck stripped these via
    // `prettySliderName`; mixer LOCAL PARAMS used a different inline
    // regex that kept them. Unify here so both surfaces read the same
    // (operator request 2026-05-28).
    .replace(/_v\d+$/, '')
    .replace(/^(slider|toggle|trigger|hsvPicker)/i, '')
    .replace(/([A-Z])/g, ' $1')
    .trim()
    .toUpperCase()
    .substring(0, 15);
}

// Single green accent used everywhere modulation is "live" — matches
// the "✓ SAVED" pill in PlaylistPanel so the operator sees one
// recurring "engine is doing the right thing" color rather than the
// blue primary which also means "interactive control".
const MOD_GREEN = '#00a86b';
// Subtle wash for surfaces that need to read as "mapped" without
// fighting the slider track for attention.
const MOD_GREEN_SOFT = 'rgba(0,168,107,0.12)';

// Clamp to the engine's widened modulation range [-4, 4] (RANGE_MIN /
// RANGE_MAX in modulation_engine.js). We pre-clamp on the popover so a
// typo'd 99 in the range box becomes 4 instead of bouncing the whole save
// with a 400 from validateModulationMapping. The window must be wide enough
// for a multiply boost (>1, default [1.0, 1.2]) and for inverting ranges
// like [-1, 0].
const RANGE_LIMIT = 4;
function clampRange(x: number): number {
  if (!Number.isFinite(x)) return 0;
  if (x < -RANGE_LIMIT) return -RANGE_LIMIT;
  if (x > RANGE_LIMIT) return RANGE_LIMIT;
  return x;
}

// ── ModulationBadges — shared ◎ON / ✕ button row ────────────────────
//
// Both the deck (interactive) and mixer (readonly) variants render
// the same green pill so the operator scans for "mapped" the same
// way on both surfaces. `onEdit` / `onClear` are only wired on the
// deck — the mixer passes nothing and the buttons collapse to a
// static badge.

// ── OverrideBadge — the `!` "this param is overridden" indicator ─────
//
// An override mapping REPLACES the static slider value with the live
// signal. That's a meaningfully different relationship than offset /
// multiply (which still respect the operator's set value), so it gets
// a distinct, can't-miss `!` badge. Same green family + bold pill
// styling as the ◎ ON badge so the row reads as one coherent set of
// modulation affordances.
function OverrideBadge() {
  return (
    <View
      style={{
        paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6,
        backgroundColor: MOD_GREEN,
        borderWidth: 1, borderColor: MOD_GREEN,
        transitionDuration: '0s',
      } as any}
      accessibilityLabel="Override: signal replaces the static value"
    >
      <Text style={{
        fontFamily: 'SpaceGrotesk_700Bold', fontSize: 9,
        color: '#fff', letterSpacing: 0.5,
      }}>
        ! OVERRIDE
      </Text>
    </View>
  );
}

function ModulationBadges({
  hasMapping, editable, showAddHint, isOverride, onEdit, onClear,
}: {
  hasMapping: boolean;
  // `editable` means the operator can OPEN the popover (deck only).
  // The badge itself is always rendered at full opacity when there's
  // a mapping — the green ◎ ON pill must read as "live signal" even
  // on read-only surfaces like the mixer.
  editable: boolean;
  // Whether to render the empty `◎` add-hint when no mapping exists.
  // The deck shows it; the mixer hides it so unmapped sliders aren't
  // cluttered with an affordance the operator can't act on there.
  showAddHint: boolean;
  // Whether the mapping is in OVERRIDE mode — shows the `!` badge so the
  // operator reads "this param is driven by the signal, not the slider".
  isOverride?: boolean;
  onEdit?: () => void;
  onClear?: () => void;
}) {
  const C = usePalette();
  if (!hasMapping && !showAddHint) return null;
  const canEdit = editable && !!onEdit;
  const canClear = hasMapping && editable && !!onClear;
  const bgColor = hasMapping ? MOD_GREEN : 'transparent';
  const bColor = hasMapping ? MOD_GREEN : C.ghostBorder;
  const fgColor = hasMapping ? '#fff' : C.secondary;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <TouchableOpacity
        onPress={canEdit ? onEdit : undefined}
        disabled={!canEdit}
        style={{
          paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6,
          backgroundColor: bgColor,
          borderWidth: 1, borderColor: bColor,
          // Stable colour: no fade animation while React rerenders
          // (the toggle would otherwise look "flashy" on a live deck).
          transitionDuration: '0s',
        } as any}
        activeOpacity={canEdit ? 0.7 : 1}
        accessibilityLabel={hasMapping ? (canEdit ? 'Edit modulation' : 'Modulation active') : 'Add modulation'}
      >
        <Text style={{
          fontFamily: 'SpaceGrotesk_700Bold', fontSize: 9,
          color: fgColor, letterSpacing: 0.5,
        }}>
          {hasMapping ? '◎ ON' : '◎'}
        </Text>
      </TouchableOpacity>
      {hasMapping && isOverride ? <OverrideBadge /> : null}
      {canClear ? (
        <TouchableOpacity
          onPress={onClear}
          // Same size as the ◎ pill so the row reads as a paired
          // {edit, clear} control. Outlined-green to signal
          // "destructive but reversible" without screaming red.
          style={{
            paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6,
            backgroundColor: 'transparent',
            borderWidth: 1, borderColor: MOD_GREEN,
            transitionDuration: '0s',
          } as any}
          activeOpacity={0.7}
          accessibilityLabel="Clear modulation"
        >
          <Text style={{
            fontFamily: 'SpaceGrotesk_700Bold', fontSize: 9,
            color: MOD_GREEN, letterSpacing: 0.5,
          }}>
            ✕
          </Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

// ── shared ghost-overlay marker on a slider track ────────────────────
//
// Shows where the engine is CURRENTLY driving the parameter, drawn as a
// deviation bar from the parameter's BASE value to the live modulated value
// (`ghost`). The solid 2 px edge sits at the live end, so you read the push
// direction at a glance: a bar to the RIGHT of base = the signal is pushing
// the param up, to the LEFT = down (the natural read for a bipolar swing or a
// unipolar offset). It rides inside the translucent range-envelope band.
//
// (It used to fill 0→ghost like a fader level, which made the green start from
// 0 instead of the parameter's value and read wrong for bipolar.)
function GhostMarker({
  ghost,
  base,
  borderRadius = 12,
}: { ghost: number | null; base: number; borderRadius?: number }) {
  if (ghost === null) return null;
  const g = Math.min(1, Math.max(0, ghost));
  const b = Math.min(1, Math.max(0, base));
  const lo = Math.min(g, b);
  const width = Math.abs(g - b);
  const pushUp = g >= b;   // live value above the base → pushing up
  return (
    <View
      style={{
        pointerEvents: 'none',
        position: 'absolute',
        left: `${lo * 100}%`,
        top: 0,
        bottom: 0,
        width: `${width * 100}%`,
        backgroundColor: 'rgba(0,168,107,0.45)',
        // Anchor the solid edge at the LIVE end (the side away from base).
        ...(pushUp
          ? { borderRightWidth: 2, borderRightColor: MOD_GREEN }
          : { borderLeftWidth: 2, borderLeftColor: MOD_GREEN }),
        borderRadius,
      }}
    />
  );
}

// ── range-envelope band — visualises the modulation swing ─────────
//
// Faint translucent band on the slider track showing the range a
// modulation can sweep, in the SAME normalised space as the
// modulationState frame. The ghost handle (above) rides inside
// this band. Maths must mirror modulation_engine.js
// applyContinuousModulation so what the operator sees matches what
// the engine fires.
//
// Rather than re-derive closed-form bounds per mode (which drifts the
// moment the engine math changes), we sweep the SHARED transfer
// function `applyContinuousModulation` across the signal domain [0,1]
// and take the min/max of the resulting clamped output. Because the
// curve is monotonic on [0,1] and override/multiply/offset are all
// monotonic-or-V-shaped in the signal, a coarse sweep captures the
// true envelope. This is the same function the curve plot and ghost
// use, so the band can never disagree with them.
function modulationBandRange(
  base: number,
  mode: ModulationMode,
  polarity: ModulationPolarity,
  range: [number, number],
  curve: ModulationCurve,
): { lo: number; hi: number } {
  const N = 24;
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i <= N; i++) {
    const s = i / N;
    const out = applyContinuousModulation(s, base, mode, polarity, range, curve);
    if (out < lo) lo = out;
    if (out > hi) hi = out;
  }
  return { lo, hi };
}

function ModulationRangeBand({
  base, mode, polarity, range, curve,
}: {
  base: number;
  mode: ModulationMode;
  polarity: ModulationPolarity;
  range: [number, number];
  curve: ModulationCurve;
}) {
  const { lo, hi } = modulationBandRange(base, mode, polarity, range, curve);
  const width = Math.max(0, hi - lo);
  // Don't paint a hairline / zero-width band — looks like a glitch.
  if (width < 0.005) return null;
  return (
    <View
      style={{
        pointerEvents: 'none',
        position: 'absolute',
        left: `${lo * 100}%`,
        width: `${width * 100}%`,
        top: 0, bottom: 0,
        backgroundColor: 'rgba(0,168,107,0.18)',
        borderLeftWidth: 1,
        borderRightWidth: 1,
        borderColor: 'rgba(0,168,107,0.4)',
      }}
    />
  );
}

// ── ModulatedSlider — drop-in wrapper (DECK, interactive) ────────────

type ModulatedSliderProps = {
  exportItem: { id: number; name: string; v0?: number };
  onChangeBase: (v: number) => void;
  // Active deck entry context. When either is null/undefined the
  // [◎] badge still renders but in disabled form so the operator
  // gets a tooltip rather than a no-op.
  playlistName: string | null | undefined;
  entryId: string | null | undefined;
  mapping: ModulationMapping | null;
  live: ModulationParamLive | null;
  onChanged: () => void;
};

function ModulatedSliderImpl({
  exportItem, onChangeBase, playlistName, entryId, mapping, live, onChanged,
}: ModulatedSliderProps) {
  const C = usePalette();
  const [popoverOpen, setPopoverOpen] = useState(false);
  const niceName = prettySliderName(exportItem.name);
  // The ANCHOR (operator's set value). When a modulation is live the engine
  // writes the MODULATED value back into the export every frame, so
  // exportItem.v0 is the moving modulated value, NOT the base — using it would
  // slide the range band + live bar around. The modulationState frame carries
  // the engine's true base (captured from localControls, not the WASM export),
  // so prefer it; fall back to the export value only when nothing is live.
  const base = (live && typeof live.base === 'number') ? live.base : (exportItem.v0 ?? 0.5);
  // Ghost only when the engine ACTUALLY reports modulated ≠ base.
  // Operator report 2026-05-28: pre-fix the gate compared engine
  // `modulated` against the local UI `base`. With a silent audio
  // input the engine sent `{base:0, modulated:0}` (no real
  // modulation) and the box parked at left:0% because abs(0 - 0.5)
  // crossed the threshold against the local 0.5 base. The fix:
  // also require the engine's own `live.base` to diverge from
  // `live.modulated`, so a silent / not-yet-driven mapping never
  // paints a ghost.
  const ghost = live
    && live.modulated !== undefined
    && live.base !== undefined
    && Math.abs(live.modulated - live.base) >= 0.01
    && Math.abs(live.modulated - base) >= 0.01
    ? live.modulated
    : null;
  const hasMapping = !!mapping;
  const enabled = !!(playlistName && entryId);

  const clearMapping = useCallback(async () => {
    if (!mapping || !playlistName || !entryId) return;
    const r = await deleteModulation(playlistName, entryId, mapping.id);
    if (r.ok) onChanged();
  }, [mapping, playlistName, entryId, onChanged]);

  // Delta from base — useful for the operator to read at a glance
  // ("LOCAL SPEED 0.30 → 0.52 (+0.22)" tells them how much audio
  // is currently pushing the value).
  const deltaText = useMemo(() => {
    if (ghost === null) return null;
    const d = ghost - base;
    const sign = d >= 0 ? '+' : '';
    return `${sign}${d.toFixed(2)}`;
  }, [ghost, base]);

  return (
    <View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4, alignItems: 'center' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
          <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10, color: C.secondary, textTransform: 'uppercase' }}>{niceName}</Text>
          <ModulationBadges
            hasMapping={hasMapping}
            editable={enabled}
            showAddHint={true}
            isOverride={mapping?.mode === 'override'}
            onEdit={() => setPopoverOpen(true)}
            onClear={clearMapping}
          />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
          {ghost !== null ? (
            <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 9, color: MOD_GREEN }}>
              →{ghost.toFixed(2)}{deltaText ? `  ${deltaText}` : ''}
            </Text>
          ) : null}
          <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11, color: C.text }}>{base.toFixed(2)}</Text>
        </View>
      </View>
      {/* D3 (May 2026): track keeps the standard surfaceContainerHigh
          colour even when mapped — the full-track green wash competed
          with the D2 range-envelope band. The ◎ ON badge + the band
          itself communicate "this slider is mapped." */}
      <View style={{ position: 'relative' }}>
        <HorizontalFader
          value={base}
          onChange={onChangeBase}
          trackStyle={{
            height: 24,
            backgroundColor: C.surfaceContainerHigh,
            borderRadius: 12,
            justifyContent: 'center',
          }}
          fillStyle={{ position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: C.primary, borderRadius: 12 }}
        />
        {hasMapping && mapping ? (
          <ModulationRangeBand
            base={base}
            mode={mapping.mode}
            polarity={mapping.polarity}
            range={mapping.range}
            curve={mapping.curve}
          />
        ) : null}
        <GhostMarker ghost={ghost} base={base} />
      </View>
      {popoverOpen && enabled ? (
        <ModulationPopover
          paramName={niceName}
          targetParameter={exportItem.name}
          targetBase={base}
          playlistName={playlistName!}
          entryId={entryId!}
          existing={mapping}
          onClose={() => setPopoverOpen(false)}
          onChanged={onChanged}
        />
      ) : null}
    </View>
  );
}

// D7: React.memo with a custom equality check. With 20+ mapped
// sliders any modulationState frame previously re-rendered every
// ModulatedSlider on the page; we now skip re-render when neither
// the export's id/v0, the mapping shape, nor this target's live
// modulated value changed.
export const ModulatedSlider = React.memo(
  ModulatedSliderImpl,
  (prev, next) => (
    prev.exportItem.id === next.exportItem.id
    && prev.exportItem.v0 === next.exportItem.v0
    && prev.exportItem.name === next.exportItem.name
    && prev.playlistName === next.playlistName
    && prev.entryId === next.entryId
    && (prev.mapping?.id ?? null) === (next.mapping?.id ?? null)
    && (prev.mapping?.enabled ?? null) === (next.mapping?.enabled ?? null)
    && (prev.mapping?.range[0] ?? null) === (next.mapping?.range[0] ?? null)
    && (prev.mapping?.range[1] ?? null) === (next.mapping?.range[1] ?? null)
    && (prev.mapping?.mode ?? null) === (next.mapping?.mode ?? null)
    && (prev.mapping?.polarity ?? null) === (next.mapping?.polarity ?? null)
    && (prev.mapping?.curve ?? null) === (next.mapping?.curve ?? null)
    && (prev.mapping?.source.key ?? null) === (next.mapping?.source.key ?? null)
    && (prev.live?.modulated ?? null) === (next.live?.modulated ?? null)
    && prev.onChangeBase === next.onChangeBase
    && prev.onChanged === next.onChanged
  ),
);

// ── ModulationReadonlyBadge — for the MIXER (no popover, no clear) ──
//
// The mixer renders its own MiniFader-based channel strip; we don't
// want to replace that with the deck's full HorizontalFader. Instead
// the mixer drops this badge into the strip header so the operator
// can see "this slider has a modulation defined on its active
// playlist entry" without leaving the mixer. Editing the mapping
// stays on the deck per design (one source of truth for modulation
// CRUD — the deck's currently-active entry).
export function ModulationReadonlyBadge({ hasMapping, isOverride }: { hasMapping: boolean; isOverride?: boolean }) {
  return (
    <ModulationBadges
      hasMapping={hasMapping}
      editable={false}
      showAddHint={false}
      isOverride={isOverride}
    />
  );
}

// Export the ghost marker + green so the mixer's MiniFader can paint
// a matching overlay/badge without re-deriving the look.
export { GhostMarker, MOD_GREEN, MOD_GREEN_SOFT };

// ── ModulationPopover — editor ──────────────────────────────────────

// The modulation SOURCE list is DYNAMIC — built from the live audio CPC
// keys the Audio Companion routes in (useAudioSignals). The legacy
// hand-listed `stems*` sources were removed engine-side, so they no
// longer appear here. A source whose pipeline is OFF reads 0 and the
// mapping evaluates as a no-op (operator's "no change when source
// disabled" expectation). See useModulationSourceOptions below.
const CURVE_OPTIONS: ModulationCurve[] = ['linear', 'easeIn', 'easeOut', 'exp'];

// ── engine-mirrored modulation math (for the transfer-function viz) ──
//
// These MUST match marsin_engine/lib/modulation_engine.js exactly
// (applyCurve / applyContinuousModulation) so the curve the operator dials
// in the popup is the curve the engine fires. Pure, dependency-free, and
// kept tiny so the mapping plot below is the same transfer function the
// lights see. If the engine math changes, change this in lockstep.
function modClamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

function applyCurve(value: number, curve: ModulationCurve): number {
  if (curve === 'easeIn') return value * value;
  if (curve === 'easeOut') return 1 - (1 - value) * (1 - value);
  if (curve === 'exp') return value * value * value;
  return value;
}

// The output param value for a given normalised source input, mirroring
// marsin_engine/lib/modulation_engine.js applyContinuousModulation EXACTLY.
// `range` is the saved [min,max] (bipolar offset uses the symmetric
// [-mag,mag] the popover collapses SWING into).
//
// Contract (keep in lockstep with the engine):
//   sc     = applyCurve(clamp01(signal), curve)   — curve shapes the SIGNAL.
//   scaled = min + sc*(max-min)                   — range may be inverted.
//   override : clamp01(scaled)                    — ignores the base value.
//   multiply : clamp01(base * scaled)             — scaled signal is a mult;
//                                                   polarity does NOT apply.
//   offset/unipolar : clamp01(base + scaled).
//   offset/bipolar  : bs = sc*2-1;
//                     offset = bs>=0 ? bs*max : bs*(-min);
//                     clamp01(base + offset)      — spans [base+min, base+max].
function applyContinuousModulation(
  source: number,
  base: number,
  mode: ModulationMode,
  polarity: ModulationPolarity,
  range: [number, number],
  curve: ModulationCurve,
): number {
  const baseClamped = modClamp01(base);
  const sc = applyCurve(modClamp01(source), curve);
  const [min, max] = range;
  const scaled = min + sc * (max - min);

  // OVERRIDE — drive the param directly from the scaled signal (the `!`).
  if (mode === 'override') {
    return modClamp01(scaled);
  }

  // MULTIPLY — the scaled signal is a multiplier. Polarity does not apply.
  if (mode === 'multiply') {
    return modClamp01(baseClamped * scaled);
  }

  // OFFSET — add to the static value.
  if (polarity === 'bipolar') {
    // SYMMETRIC ±swing: 0.5 = static, swings by mag = max(|min|,|max|).
    const bs = sc * 2 - 1; // [-1, 1]
    const mag = Math.max(Math.abs(min), Math.abs(max));
    return modClamp01(baseClamped + bs * mag);
  }
  // OFFSET / unipolar — one-sided: base + scaled signal.
  return modClamp01(baseClamped + scaled);
}

// ── normalise a live CPC value to [0,1] for a given source signal ────
// Mirrors normalizeAudio in CPCControls: intensities are already [0,1];
// frequency / bpm signals normalise by their schema max. A source we can't
// describe (not in the live set) is treated as already-normalised.
function normalizeSourceValue(signal: AudioSignalDescriptor | null, value: number): number {
  if (!signal) return modClamp01(value);
  if (signal.kind === 'intensity') return modClamp01(value);
  if (signal.max > 0) return modClamp01(value / signal.max);
  return modClamp01(value);
}

// ── ModulationCurvePlot — the transfer-function visualisation ────────
//
// Plots the mapping as an input→output curve: X is the (normalised) SOURCE
// signal [0,1], Y is the resulting TARGET param value [0,1] under the
// current depth/range/curve/mode/polarity. A faint diagonal marks the
// base (no-modulation) level for reference, and a LIVE marker rides the
// curve at the source's current value so the operator SEES where the audio
// is landing right now and what value it's driving the param to.
//
// SVG (react-native-svg, already a vendored CaptainPad dep — same as
// AudioTraceCanvas). No animation loop here: it re-renders only when a
// setting changes or the throttled live source value ticks (the parent
// already consumes that bus), so it adds zero new high-rate subscriptions.
const CURVE_VIEW_W = 200;
const CURVE_VIEW_H = 120;

function ModulationCurvePlot({
  base, mode, polarity, range, curve, liveSource, accent,
}: {
  base: number;
  mode: ModulationMode;
  polarity: ModulationPolarity;
  range: [number, number];
  curve: ModulationCurve;
  // Live normalised source value [0,1], or null when no signal is live.
  liveSource: number | null;
  accent: string;
}) {
  const C = usePalette();
  // Sample the transfer function across the source domain.
  const N = 48;
  const pathD = useMemo(() => {
    let d = '';
    for (let i = 0; i <= N; i++) {
      const s = i / N;
      const out = applyContinuousModulation(s, base, mode, polarity, range, curve);
      const x = s * CURVE_VIEW_W;
      const y = (1 - out) * CURVE_VIEW_H;
      d += `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)} `;
    }
    return d.trim();
  }, [base, mode, polarity, range, curve]);

  // Base reference line (flat — the value with no modulation applied).
  const baseY = (1 - modClamp01(base)) * CURVE_VIEW_H;

  // Live marker — where the current source value lands on the curve.
  const live = liveSource === null ? null : (() => {
    const s = modClamp01(liveSource);
    const out = applyContinuousModulation(s, base, mode, polarity, range, curve);
    return { x: s * CURVE_VIEW_W, y: (1 - out) * CURVE_VIEW_H, out };
  })();

  return (
    <View style={{
      height: 140, borderRadius: 6, overflow: 'hidden',
      borderWidth: 1, borderColor: C.ghostBorder, backgroundColor: C.surfaceContainerLowest,
    }}>
      <Svg width="100%" height="100%" viewBox={`0 0 ${CURVE_VIEW_W} ${CURVE_VIEW_H}`} preserveAspectRatio="none">
        {/* quarter grid */}
        {[0.25, 0.5, 0.75].map((g) => (
          <Line key={`h${g}`} x1={0} y1={g * CURVE_VIEW_H} x2={CURVE_VIEW_W} y2={g * CURVE_VIEW_H} stroke={C.ghostBorder} strokeWidth={0.5} />
        ))}
        {[0.25, 0.5, 0.75].map((g) => (
          <Line key={`v${g}`} x1={g * CURVE_VIEW_W} y1={0} x2={g * CURVE_VIEW_W} y2={CURVE_VIEW_H} stroke={C.ghostBorder} strokeWidth={0.5} />
        ))}
        {/* base reference (no-mod level) */}
        <Line x1={0} y1={baseY} x2={CURVE_VIEW_W} y2={baseY} stroke={C.secondary} strokeWidth={0.75} strokeDasharray="3,3" />
        {/* transfer function */}
        <Path d={pathD} fill="none" stroke={MOD_GREEN} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {/* live marker */}
        {live ? (
          <>
            <Line x1={live.x} y1={0} x2={live.x} y2={CURVE_VIEW_H} stroke={accent} strokeWidth={0.75} strokeOpacity={0.5} />
            <Circle cx={live.x} cy={live.y} r={4} fill={accent} stroke={C.surfaceContainerLowest} strokeWidth={1} />
          </>
        ) : null}
      </Svg>
    </View>
  );
}

// Derive the modulation source options from the engine schema. Includes
// the intensity + frequency audio signals (a frequency source is still a
// valid modulation input). Falls back to an empty list before the schema
// lands — the popover guards against an empty source (keeps the operator's
// current value selectable).
function useModulationSourceOptions(currentKey: string): { key: string; label: string }[] {
  const signals = useAudioSignals();
  return useMemo(() => {
    const opts = signals.map((s) => ({ key: s.key, label: s.label }));
    // Keep a previously-saved source selectable even if it's no longer in
    // the live set (e.g. a retired stem on an old mapping) so editing the
    // mapping doesn't silently drop its source.
    if (currentKey && !opts.some((o) => o.key === currentKey)) {
      // Mark it clearly as retired so the operator knows this source is no
      // longer live (the Companion removed it) — it's kept only so editing the
      // mapping doesn't silently drop the source.
      opts.unshift({ key: currentKey, label: `${currentKey.toUpperCase()} · retired` });
    }
    return opts;
  }, [signals, currentKey]);
}

type PopoverProps = {
  paramName: string;
  targetParameter: string;
  // The target param's current base value [0,1] — drives the TARGET
  // preview + the transfer-function plot's no-mod reference. Defaults to
  // 0.5 when the caller (e.g. a future readonly surface) can't supply it.
  targetBase?: number;
  playlistName: string;
  entryId: string;
  existing: ModulationMapping | null;
  onClose: () => void;
  onChanged: () => void;
};

export function ModulationPopover({
  paramName, targetParameter, targetBase = 0.5, playlistName, entryId, existing, onClose, onChanged,
}: PopoverProps) {
  const C = usePalette();
  // The full live audio-signal descriptors — used both to seed a sensible
  // default source and to resolve the selected source's label / kind / max /
  // rawKey for its live trail + accent.
  const audioSignals = useAudioSignals();
  // Default source for a NEW mapping. Prefer the existing mapping's saved
  // source; else `micLow` if that built-in is live; else the FIRST live
  // signal (covers a pure-Companion engine whose only sources are dynamic
  // keys like `low_test` — Codex P0: never hard-pin a key that may not
  // exist). Captured once (useState initializer) so later schema shifts
  // don't yank the operator's in-progress selection out from under them.
  const [source, setSource] = useState<ModulationSourceKey>(() => {
    if (existing?.source.key) return existing.source.key;
    if (audioSignals.some((s) => s.key === 'micLow')) return 'micLow';
    return audioSignals[0]?.key ?? 'micLow';
  });
  // Dynamic source options from the live audio CPC keys (Companion-routed).
  const sourceOptions = useModulationSourceOptions(source);
  const sourceSignal = useMemo(
    () => audioSignals.find((s) => s.key === source) ?? null,
    [audioSignals, source],
  );
  const sourceAccent = sourceSignal ? audioAccentHex(sourceSignal) : MOD_GREEN;
  // Live source value off the throttled live bus (whole doc — the source
  // key is dynamic, so we can't pin it via useLiveParamValues). The trace +
  // curve marker consume the SAME bus the rest of the app already pulls, so
  // no new high-rate subscription is added (Codex P0 congestion-aware).
  const liveDoc = useLiveParams();
  const liveSourceRaw = useMemo((): number | null => {
    const slot = source ? liveDoc?.params?.[source] : null;
    return slot && typeof slot.value === 'number' ? slot.value : null;
  }, [liveDoc, source]);
  const liveSourceRawMirror = useMemo((): number | null => {
    const rk = sourceSignal?.rawKey;
    const slot = rk ? liveDoc?.params?.[rk] : null;
    return slot && typeof slot.value === 'number' ? slot.value : null;
  }, [liveDoc, sourceSignal]);
  const liveSourceNorm = liveSourceRaw === null
    ? null
    : normalizeSourceValue(sourceSignal, liveSourceRaw);
  // Migrate a legacy 'scale' mode to 'multiply' when editing an existing
  // mapping (mirrors the engine's back-compat in validateModulationMapping).
  const [mode, setMode] = useState<ModulationMode>(
    existing ? migrateModulationMode(existing.mode) : 'offset',
  );
  const [polarity, setPolarity] = useState<ModulationPolarity>(existing?.polarity ?? 'unipolar');
  const [rangeMin, setRangeMin] = useState<string>(String(existing?.range[0] ?? 0));
  const [rangeMax, setRangeMax] = useState<string>(String(existing?.range[1] ?? 0.35));
  // SWING ± magnitude for bipolar mode. Initialised from the existing
  // mapping (max(|min|, |max|) — what the engine collapses to) so the
  // popover round-trips cleanly. Kept separate from rangeMin/rangeMax
  // so swapping unipolar ↔ bipolar restores the operator's previous
  // unipolar values without losing them.
  const initialSwing = existing && existing.polarity === 'bipolar'
    ? String(Math.max(Math.abs(existing.range[0]), Math.abs(existing.range[1])))
    : '0.25';
  const [swing, setSwing] = useState<string>(initialSwing);
  const [curve, setCurve] = useState<ModulationCurve>(existing?.curve ?? 'linear');
  const [enabled, setEnabled] = useState<boolean>(existing?.enabled ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Live (pre-save) range resolved the SAME way `save()` does, so the
  // transfer-function plot + TARGET preview reflect exactly what would be
  // written. Bipolar collapses SWING into a symmetric [-mag, mag].
  const previewRange = useMemo<[number, number]>(() => {
    // SWING ↔ symmetric [-mag, mag] only applies to BIPOLAR OFFSET. Polarity
    // is meaningless for multiply/override (the engine ignores it), so those
    // modes always read the raw [min, max] range box.
    if (mode === 'offset' && polarity === 'bipolar') {
      const mag = Math.abs(clampRange(Number(swing) || 0));
      return [-mag, mag];
    }
    return [clampRange(Number(rangeMin) || 0), clampRange(Number(rangeMax) || 0)];
  }, [mode, polarity, swing, rangeMin, rangeMax]);

  // The value the engine would currently drive the target to, given the
  // live source value + the operator's in-progress settings. Null when no
  // source is live (the trail/marker hide and the preview reads "—").
  const liveModulated = liveSourceNorm === null
    ? null
    : applyContinuousModulation(liveSourceNorm, targetBase, mode, polarity, previewRange, curve);

  // Stable id strategy:
  //
  //   - NEW mapping  → derive from target+source so two different
  //                    sources on the same param produce distinct ids.
  //   - EXISTING     → ALWAYS keep the on-disk id, even if the
  //                    operator changes the source (PATCH semantics).
  //
  // Operator-reported bug: changing source from MIC LOW → MIC MID
  // on an existing mapping used to make the save round-trip succeed
  // BUT a transient network glitch could leave the popover thinking
  // the save failed (and locked out subsequent edits). The fix here
  // is to keep `mappingId` STABLE across the popover lifetime — the
  // server-side merge already replaces source.key from the request
  // body, so the URL path never needs to track the new key.
  //
  // We capture existing.id ONCE at mount so a parent re-render that
  // briefly nulls `existing` (e.g. while the cache refreshes after a
  // playlistSaved broadcast) can't strip our handle out from under
  // the live PATCH.
  const initialIdRef = React.useRef<string | null>(existing?.id ?? null);
  const mappingId = useMemo(
    () => initialIdRef.current ?? `mod_${targetParameter}_${source}`,
    [targetParameter, source],
  );
  const isExisting = initialIdRef.current !== null;

  // Track whether the operator has hand-edited the range box this popover
  // lifetime. Switching MODE seeds a sensible default range for the new mode
  // (multiply → [1.0, 1.2]; override → [0, 1]; offset keeps the existing
  // default), but only when the operator has NOT already dialed in a range —
  // editing an existing mapping (which arrives with a saved range) or a
  // manual range edit both suppress the clobber.
  const rangeTouchedRef = React.useRef<boolean>(isExisting);
  const setRangeMinTouched = useCallback((v: string) => {
    rangeTouchedRef.current = true;
    setRangeMin(v);
  }, []);
  const setRangeMaxTouched = useCallback((v: string) => {
    rangeTouchedRef.current = true;
    setRangeMax(v);
  }, []);
  const setSwingTouched = useCallback((v: string) => {
    rangeTouchedRef.current = true;
    setSwing(v);
  }, []);

  const selectMode = useCallback((next: ModulationMode) => {
    if (next === mode) return;
    // Seed a sensible default range for the new mode when the operator hasn't
    // dialed one in (never clobber an existing mapping's saved range or a value
    // they just typed) — AND, regardless of "touched", reseed when the current
    // visible range is DEGENERATE for the target mode, so a stale range can't
    // silently turn into a param-killer on a mode switch:
    //   - multiply by a max ≤ 0 pins the param to 0 (e.g. carrying a [0,0.x]
    //     offset or a bipolar swing into multiply) → reseed to [1.0, 1.2].
    const curMax = Number(rangeMax);
    const multiplyDegenerate = !(Number.isFinite(curMax) && curMax > 0);
    if (next === 'multiply') {
      if (!rangeTouchedRef.current || multiplyDegenerate) { setRangeMin('1.0'); setRangeMax('1.2'); }
    } else if (next === 'override') {
      if (!rangeTouchedRef.current) { setRangeMin('0'); setRangeMax('1'); }
    } else { // offset — restore the offset default (was missing: a multiply
      // [1.0,1.2] would otherwise strand in the offset boxes as a +1.0 slam).
      if (!rangeTouchedRef.current) { setRangeMin('0'); setRangeMax('0.35'); }
    }
    // Polarity only applies to offset; drop a stale `bipolar` when leaving
    // offset so it can't ride along into multiply/override.
    if (next !== 'offset' && polarity === 'bipolar') setPolarity('unipolar');
    setMode(next);
  }, [mode, rangeMax, polarity]);

  const save = async () => {
    if (busy) return; // double-tap guard
    // Range inputs must be real numbers — an empty/blank box previously
    // coerced to 0 (via `Number('') || 0`), silently saving a no-op or a
    // param-killer (e.g. multiply range [1.0, 0] fades the param to black).
    // Fail loud instead: block the save with an inline error.
    const rangeFieldsOk = (mode === 'offset' && polarity === 'bipolar')
      ? Number.isFinite(Number(swing)) && swing.trim() !== ''
      : Number.isFinite(Number(rangeMin)) && rangeMin.trim() !== ''
        && Number.isFinite(Number(rangeMax)) && rangeMax.trim() !== '';
    if (!rangeFieldsOk) {
      setError('Enter a numeric range before saving.');
      return;
    }
    setBusy(true); setError(null);
    // Write EXACTLY what the preview computed — `previewRange` already
    // resolves bipolar-offset SWING into a symmetric [-mag, mag], reads the
    // raw [min, max] box for unipolar offset / multiply / override, and
    // clamps each value into the engine's [-4, 4] window. Reusing it keeps
    // the saved mapping in lockstep with the curve plot / band the operator
    // just looked at (no second, drift-prone clamp path).
    const finalRange: [number, number] = previewRange;
    const mapping: ModulationMapping = {
      id: mappingId,
      type: 'continuous',
      enabled,
      source: { scope: 'cpc', key: source },
      target: { scope: 'pattern', parameter: targetParameter },
      // Polarity only affects offset; for multiply/override the engine
      // ignores it, but we persist the current value harmlessly.
      mode, polarity,
      range: finalRange,
      curve,
    };
    try {
      const r = isExisting
        ? await patchModulation(playlistName, entryId, mappingId, mapping)
        : await putModulation(playlistName, entryId, mapping);
      if (!r.ok) {
        setError(r.error || 'unknown error');
        return;
      }
      // Server accepted — now "existing" semantics apply for the
      // rest of this popover lifetime (subsequent saves use PATCH
      // against the same id).
      initialIdRef.current = mappingId;
      onChanged();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      // ALWAYS clear busy — even on thrown errors — so the operator
      // can retry without hard-reloading the popover. This is the
      // root cause of the "I cannot even delete or edit it anymore"
      // report: a previously thrown error left busy=true on the
      // happy-path setBusy(false), making the SAVE/REMOVE buttons
      // permanently disabled.
      setBusy(false);
    }
  };

  const remove = async () => {
    if (busy) return; // double-tap guard
    // REMOVE is always allowed when there's a server-side mapping
    // even if a prior SAVE failed — fall back to the captured id so
    // the operator can always recover from a half-edited state.
    const idToDelete = initialIdRef.current ?? existing?.id;
    if (!idToDelete) { onClose(); return; }
    setBusy(true); setError(null);
    try {
      const r = await deleteModulation(playlistName, entryId, idToDelete);
      if (!r.ok) {
        setError(r.error || 'unknown error');
        return;
      }
      // Engine's modulation_controller will emit a final empty
      // modulationState frame on the >0 → 0 transition gate, which
      // clears the green ghost overlay automatically. No need to
      // poke modulationLive locally.
      onChanged();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal transparent visible animationType="fade" onRequestClose={onClose}>
      <Pressable
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center' }}
        onPress={onClose}
      >
        <Pressable
          onPress={(e) => e.stopPropagation()}
          style={{
            width: 440, maxHeight: '92%',
            backgroundColor: C.surfaceContainerLowest,
            borderRadius: 12, borderWidth: 1, borderColor: C.ghostBorder,
          }}
        >
          {/* Title bar — stays pinned above the scrolling body. */}
          <View style={{
            paddingHorizontal: 20, paddingTop: 18, paddingBottom: 10,
            borderBottomWidth: 1, borderBottomColor: C.ghostBorder,
          }}>
            <Text style={{
              fontFamily: 'SpaceGrotesk_700Bold', color: C.primary, fontSize: 14,
              textTransform: 'uppercase', letterSpacing: 1,
            }}>
              MAP {paramName}
            </Text>
          </View>

          <ScrollView
            style={{ flexGrow: 0 }}
            contentContainerStyle={{ padding: 20, gap: 16 }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* ── SECTION 1 · SOURCE + its live trail ─────────────────── */}
            <SectionLabel accent={sourceAccent}>SOURCE</SectionLabel>

            <PickerRow label="SIGNAL">
              {sourceOptions.map((opt) => (
                <Chip key={opt.key} active={source === opt.key} onPress={() => setSource(opt.key)}>
                  {opt.label}
                </Chip>
              ))}
            </PickerRow>

            {/* Live trail of the selected source — what the operator is
                mapping. Reuses AudioTraceCanvas (self-animating, rAF-
                interpolated, congestion-aware). RAW ghost shows when the
                signal has a pre-gain mirror. */}
            <View style={{ gap: 4 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 10, color: C.secondary }}>
                  {sourceSignal ? `${sourceSignal.label} · live` : 'source not live'}
                </Text>
                <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11, color: sourceAccent }}>
                  {liveSourceNorm === null ? '—' : `${Math.round(liveSourceNorm * 100)}%`}
                </Text>
              </View>
              {sourceSignal ? (
                <AudioTraceCanvas
                  post={liveSourceNorm ?? 0}
                  raw={liveSourceRawMirror === null ? null : normalizeSourceValue(sourceSignal, liveSourceRawMirror)}
                  color={sourceAccent}
                  background={C.surfaceContainerLowest}
                  gridColor={C.ghostBorder}
                  height={64}
                  active
                />
              ) : (
                <View style={{
                  height: 64, borderRadius: 4, borderWidth: 1, borderColor: C.ghostBorder,
                  alignItems: 'center', justifyContent: 'center', backgroundColor: C.surfaceContainerLowest,
                }}>
                  <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 10, color: C.icon }}>
                    This source is not in the live set — it evaluates as 0.
                  </Text>
                </View>
              )}
            </View>

            {/* ── SECTION 2 · MAPPING · transfer curve + controls ─────── */}
            <SectionLabel accent={MOD_GREEN}>MAPPING</SectionLabel>

            {/* Transfer function: source [0,1] → param value [0,1] under
                the current depth/range/curve. The live marker rides the
                curve at the source's current value so the operator SEES
                the effect of what they're dialing. */}
            <ModulationCurvePlot
              base={targetBase}
              mode={mode}
              polarity={polarity}
              range={previewRange}
              curve={curve}
              liveSource={liveSourceNorm}
              accent={sourceAccent}
            />
            <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 9, color: C.icon, textAlign: 'center' }}>
              X = source · Y = {paramName} value · dashed = base ({targetBase.toFixed(2)})
            </Text>

            <PickerRow label="MODE">
              <Chip active={mode === 'offset'} onPress={() => selectMode('offset')}>OFFSET</Chip>
              <Chip active={mode === 'multiply'} onPress={() => selectMode('multiply')}>MULTIPLY</Chip>
              <Chip active={mode === 'override'} onPress={() => selectMode('override')}>OVERRIDE</Chip>
            </PickerRow>

            {/* The `!` override affordance: OVERRIDE replaces the static
                value entirely, so call it out explicitly in the editor. */}
            {mode === 'override' ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <OverrideBadge />
                <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 10, color: C.secondary, flex: 1 }}>
                  Override: the signal DRIVES this param directly — the static slider value is ignored.
                </Text>
              </View>
            ) : null}

            {/* POLARITY only affects OFFSET. For multiply/override the engine
                ignores it, so the toggle is hidden to avoid a no-op control. */}
            {mode === 'offset' ? (
              <PickerRow label="POLARITY">
                <Chip
                  active={polarity === 'unipolar'}
                  onPress={() => {
                    if (polarity === 'unipolar') return;
                    // bipolar → unipolar: seed min=0, max from current
                    // swing magnitude so the operator's amplitude
                    // intent carries across.
                    const mag = Math.abs(Number(swing) || 0);
                    setRangeMin('0');
                    setRangeMax(String(mag || 0.35));
                    setPolarity('unipolar');
                  }}
                >UNIPOLAR</Chip>
                <Chip
                  active={polarity === 'bipolar'}
                  onPress={() => {
                    if (polarity === 'bipolar') return;
                    // unipolar → bipolar: seed swing from the larger
                    // |min|, |max| so the visible band stays roughly the
                    // same width across the toggle.
                    const mag = Math.max(
                      Math.abs(Number(rangeMin) || 0),
                      Math.abs(Number(rangeMax) || 0),
                    );
                    setSwing(String(mag || 0.25));
                    setPolarity('bipolar');
                  }}
                >BIPOLAR</Chip>
              </PickerRow>
            ) : null}

            {mode === 'offset' && polarity === 'bipolar' ? (
              // D4a: bipolar offset collapses to a single SWING ± magnitude.
              // The engine's bipolar math already does
              // `max(|min|, |max|)` on the saved range, so showing min
              // → max separately silently discarded the sign of one
              // value. One field makes that explicit.
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10, color: C.secondary, width: 70 }}>SWING ±</Text>
                <NumberInput value={swing} onChange={setSwingTouched} placeholder="0.25" />
                <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 10, color: C.secondary, flex: 1 }}>
                  ± from base (centred on 0.5 source)
                </Text>
              </View>
            ) : (
              <View style={{ gap: 4 }}>
                <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                  <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10, color: C.secondary, width: 70 }}>RANGE</Text>
                  <NumberInput value={rangeMin} onChange={setRangeMinTouched} placeholder="min" />
                  <Text style={{ color: C.secondary }}>→</Text>
                  <NumberInput value={rangeMax} onChange={setRangeMaxTouched} placeholder="max" />
                </View>
                <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 9, color: C.icon, marginLeft: 78 }}>
                  {mode === 'multiply'
                    ? 'multiplier on the static value (e.g. 1.0 → 1.2). [-4, 4]'
                    : mode === 'override'
                      ? 'param value the signal sweeps between (e.g. 0 → 1). [-4, 4]'
                      : 'offset added to the static value. [-4, 4]'}
                </Text>
              </View>
            )}

            <PickerRow label="CURVE">
              {CURVE_OPTIONS.map((c) => (
                <Chip key={c} active={curve === c} onPress={() => setCurve(c)}>{c.toUpperCase()}</Chip>
              ))}
            </PickerRow>

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Chip active={enabled} onPress={() => setEnabled(!enabled)}>
                {enabled ? 'ENABLED' : 'DISABLED'}
              </Chip>
            </View>

            {/* ── SECTION 3 · TARGET preview ──────────────────────────── */}
            <SectionLabel accent={C.primary}>TARGET</SectionLabel>
            <TargetPreview
              paramName={paramName}
              base={targetBase}
              modulated={liveModulated}
            />

            {error ? (
              <Text style={{ color: '#c44', fontFamily: 'Inter_400Regular', fontSize: 11 }}>
                {error}
              </Text>
            ) : null}
          </ScrollView>

          {/* Action bar — pinned below the scrolling body. */}
          <View style={{
            flexDirection: 'row', justifyContent: 'flex-end', gap: 8,
            paddingHorizontal: 20, paddingVertical: 14,
            borderTopWidth: 1, borderTopColor: C.ghostBorder,
          }}>
            {isExisting ? (
              <TouchableOpacity
                onPress={remove}
                disabled={busy}
                style={{
                  paddingHorizontal: 14, paddingVertical: 8,
                  borderRadius: 8, borderWidth: 1, borderColor: '#c44',
                  opacity: busy ? 0.5 : 1,
                }}
              >
                <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: '#c44', fontSize: 11 }}>REMOVE</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              onPress={onClose}
              disabled={busy}
              style={{
                paddingHorizontal: 14, paddingVertical: 8,
                borderRadius: 8, borderWidth: 1, borderColor: C.ghostBorder,
                opacity: busy ? 0.5 : 1,
              }}
            >
              <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: C.text, fontSize: 11 }}>CANCEL</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={save}
              disabled={busy}
              style={{
                paddingHorizontal: 14, paddingVertical: 8,
                borderRadius: 8, backgroundColor: C.primary,
                opacity: busy ? 0.5 : 1,
              }}
            >
              <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', color: C.surfaceContainerLowest, fontSize: 11 }}>SAVE</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function PickerRow({ label, children }: { label: string; children: React.ReactNode }) {
  const C = usePalette();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10, color: C.secondary, width: 70 }}>{label}</Text>
      <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', flex: 1 }}>
        {children}
      </View>
    </View>
  );
}

// Section header — an accent dot + uppercase title + a hairline rule, so
// the popup reads as three clear zones (SOURCE / MAPPING / TARGET).
function SectionLabel({ accent, children }: { accent: string; children: React.ReactNode }) {
  const C = usePalette();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 }}>
      <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: accent }} />
      <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11, color: C.text, textTransform: 'uppercase', letterSpacing: 1.2 }}>
        {children}
      </Text>
      <View style={{ flex: 1, height: 1, backgroundColor: C.ghostBorder }} />
    </View>
  );
}

// TARGET preview — base value, live modulated value, and the delta the
// audio is currently pushing, plus a base→modulated bar so the operator
// sees the result on the target param at a glance.
function TargetPreview({ paramName, base, modulated }: {
  paramName: string;
  base: number;
  modulated: number | null;
}) {
  const C = usePalette();
  const b = Math.max(0, Math.min(1, base));
  const m = modulated === null ? null : Math.max(0, Math.min(1, modulated));
  const delta = m === null ? null : m - b;
  const lo = m === null ? b : Math.min(b, m);
  const hi = m === null ? b : Math.max(b, m);
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <Text numberOfLines={1} style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11, color: C.secondary, textTransform: 'uppercase', letterSpacing: 0.6, flex: 1, marginRight: 8 }}>
          {paramName}
        </Text>
        <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11, color: C.text }}>
          {b.toFixed(2)}
          {m !== null ? (
            <Text style={{ color: MOD_GREEN }}>{`  →${m.toFixed(2)}`}{delta !== null ? `  ${delta >= 0 ? '+' : ''}${delta.toFixed(2)}` : ''}</Text>
          ) : (
            <Text style={{ color: C.icon }}>{'  → —'}</Text>
          )}
        </Text>
      </View>
      {/* base→modulated bar: base fill in primary, the modulation swing in
          MOD_GREEN from base to the live modulated value. */}
      <View style={{ height: 14, borderRadius: 7, backgroundColor: C.surfaceContainerHigh, overflow: 'hidden' }}>
        <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${b * 100}%`, backgroundColor: C.primary, opacity: 0.55 }} />
        {m !== null ? (
          <View style={{
            position: 'absolute', top: 0, bottom: 0,
            left: `${lo * 100}%`, width: `${Math.max(0, hi - lo) * 100}%`,
            backgroundColor: MOD_GREEN, opacity: 0.85,
          }} />
        ) : null}
        {/* base tick */}
        <View style={{ position: 'absolute', top: 0, bottom: 0, left: `${b * 100}%`, width: 2, backgroundColor: C.text, opacity: 0.5 }} />
      </View>
    </View>
  );
}

function Chip({ active, onPress, children }: { active: boolean; onPress: () => void; children: React.ReactNode }) {
  const C = usePalette();
  return (
    <TouchableOpacity
      onPress={onPress}
      style={{
        paddingHorizontal: 10, paddingVertical: 6,
        borderRadius: 6,
        backgroundColor: active ? C.primary : 'transparent',
        borderWidth: 1, borderColor: active ? C.primary : C.ghostBorder,
      }}
    >
      <Text style={{
        fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10,
        color: active ? C.surfaceContainerLowest : C.text,
        letterSpacing: 0.5,
      }}>
        {children}
      </Text>
    </TouchableOpacity>
  );
}

function NumberInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const C = usePalette();
  return (
    <TextInput
      value={value}
      onChangeText={onChange}
      placeholder={placeholder}
      placeholderTextColor={C.secondary}
      keyboardType="numbers-and-punctuation"
      style={{
        flex: 1, paddingHorizontal: 10, paddingVertical: 8,
        borderRadius: 6, borderWidth: 1, borderColor: C.ghostBorder,
        color: C.text, fontFamily: 'SpaceGrotesk_700Bold', fontSize: 12,
      }}
    />
  );
}
