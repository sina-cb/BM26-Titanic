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
  Modal, Pressable, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { usePalette } from '@/hooks/use-theme';
import { HorizontalFader } from '@/components/ui/HorizontalFader';
import { engineEvents } from '@/utils/engineEvents';
import { engineParamsEvents } from '@/utils/engineParamsEvents';
import {
  deleteModulation, fetchPlaylist, ModulationCurve, ModulationMapping,
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
      setMappings(Array.isArray(entry?.modulations) ? entry!.modulations! : []);
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

// Clamp to [-1, 1] — engine schema range. We pre-clamp on the popover
// so a typo'd 99 in the range box becomes 1 instead of bouncing the
// whole save with a 400 from validateModulationMapping.
function clamp01Signed(x: number): number {
  if (!Number.isFinite(x)) return 0;
  if (x < -1) return -1;
  if (x > 1) return 1;
  return x;
}

// ── ModulationBadges — shared ◎ON / ✕ button row ────────────────────
//
// Both the deck (interactive) and mixer (readonly) variants render
// the same green pill so the operator scans for "mapped" the same
// way on both surfaces. `onEdit` / `onClear` are only wired on the
// deck — the mixer passes nothing and the buttons collapse to a
// static badge.

function ModulationBadges({
  hasMapping, editable, showAddHint, onEdit, onClear,
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
          transitionDuration: '0s' as any,
        }}
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
            transitionDuration: '0s' as any,
          }}
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

// ── shared ghost-overlay fill bar on a slider track ──────────────────
//
// History:
//   - Original: 3 px vertical line (May 2026 → unreadable on the green wash)
//   - Then: hollow square handle (May 2026, ugly + sat at left=0% any
//     time the engine reported modulated=0)
//   - Now: a slider-style green fill running from 0 to ghost-position,
//     mimicking the primary fader fill underneath but in MOD_GREEN.
//     Reads as "the engine is currently driving the parameter to HERE."
//     A 2 px solid green right edge anchors the endpoint so it stays
//     visible even when ghost ≈ 0.
//
// Renders inside a `position: relative` container that's sized to the
// slider track (height + width). The translucent fill composites over
// the operator-set base fill so both values stay visible.
function GhostMarker({
  ghost,
  borderRadius = 12,
}: { ghost: number | null; borderRadius?: number }) {
  if (ghost === null) return null;
  const pct = Math.min(100, Math.max(0, ghost * 100));
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        bottom: 0,
        width: `${pct}%`,
        backgroundColor: 'rgba(0,168,107,0.45)',
        borderRightWidth: 2,
        borderRightColor: MOD_GREEN,
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
function modulationBandRange(
  base: number,
  mode: 'offset' | 'scale',
  polarity: 'unipolar' | 'bipolar',
  range: [number, number],
): { lo: number; hi: number } {
  const clamp = (x: number) => Math.min(1, Math.max(0, x));
  const [minD, maxD] = range;
  if (polarity === 'bipolar') {
    const peak = Math.max(Math.abs(minD), Math.abs(maxD));
    if (mode === 'scale') {
      return { lo: clamp(base * (1 - peak)), hi: clamp(base * (1 + peak)) };
    }
    return { lo: clamp(base - peak), hi: clamp(base + peak) };
  }
  // unipolar
  if (mode === 'scale') {
    const a = clamp(base * (1 + minD));
    const b = clamp(base * (1 + maxD));
    return { lo: Math.min(a, b), hi: Math.max(a, b) };
  }
  const a = clamp(base + minD);
  const b = clamp(base + maxD);
  return { lo: Math.min(a, b), hi: Math.max(a, b) };
}

function ModulationRangeBand({
  base, mode, polarity, range,
}: {
  base: number;
  mode: 'offset' | 'scale';
  polarity: 'unipolar' | 'bipolar';
  range: [number, number];
}) {
  const { lo, hi } = modulationBandRange(base, mode, polarity, range);
  const width = Math.max(0, hi - lo);
  // Don't paint a hairline / zero-width band — looks like a glitch.
  if (width < 0.005) return null;
  return (
    <View
      pointerEvents="none"
      style={{
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
  const base = exportItem.v0 ?? 0.5;
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
          />
        ) : null}
        <GhostMarker ghost={ghost} />
      </View>
      {popoverOpen && enabled ? (
        <ModulationPopover
          paramName={niceName}
          targetParameter={exportItem.name}
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
export function ModulationReadonlyBadge({ hasMapping }: { hasMapping: boolean }) {
  return (
    <ModulationBadges
      hasMapping={hasMapping}
      editable={false}
      showAddHint={false}
    />
  );
}

// Export the ghost marker + green so the mixer's MiniFader can paint
// a matching overlay/badge without re-deriving the look.
export { GhostMarker, MOD_GREEN, MOD_GREEN_SOFT };

// ── ModulationPopover — editor ──────────────────────────────────────

// Two source groups so the picker reads as `MIC <band>` and
// `STEM <track>`. The OSC stem keys are zero when the OSC pipeline
// is OFF (resolveModulationSources defaults missing keys to 0) —
// so picking a stem with OSC disabled simply leaves the parameter
// at base, which matches the operator's "default behavior is no
// change" requirement.
const SOURCE_OPTIONS: { key: ModulationSourceKey; label: string }[] = [
  { key: 'micLow', label: 'MIC LOW' },
  { key: 'micMid', label: 'MIC MID' },
  { key: 'micHigh', label: 'MIC HIGH' },
  { key: 'micKick', label: 'MIC KICK' },
  { key: 'stemsBass', label: 'STEM BASS' },
  { key: 'stemsDrums', label: 'STEM DRUMS' },
  { key: 'stemsVocals', label: 'STEM VOCALS' },
];
const CURVE_OPTIONS: ModulationCurve[] = ['linear', 'easeIn', 'easeOut', 'exp'];

type PopoverProps = {
  paramName: string;
  targetParameter: string;
  playlistName: string;
  entryId: string;
  existing: ModulationMapping | null;
  onClose: () => void;
  onChanged: () => void;
};

export function ModulationPopover({
  paramName, targetParameter, playlistName, entryId, existing, onClose, onChanged,
}: PopoverProps) {
  const C = usePalette();
  const [source, setSource] = useState<ModulationSourceKey>(existing?.source.key ?? 'micLow');
  const [mode, setMode] = useState<ModulationMode>(existing?.mode ?? 'offset');
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

  const save = async () => {
    if (busy) return; // double-tap guard
    setBusy(true); setError(null);
    // Bipolar uses a single SWING ± magnitude — collapse it into a
    // symmetric range so the engine's `max(|min|, |max|)` resolves to
    // exactly the magnitude the operator typed (no silent sign loss).
    // Unipolar keeps independent min/max as before.
    const finalRange: [number, number] = polarity === 'bipolar'
      ? (() => {
          const mag = Math.abs(clamp01Signed(Number(swing) || 0));
          return [-mag, mag];
        })()
      : [
          clamp01Signed(Number(rangeMin) || 0),
          clamp01Signed(Number(rangeMax) || 0),
        ];
    const mapping: ModulationMapping = {
      id: mappingId,
      type: 'continuous',
      enabled,
      source: { scope: 'cpc', key: source },
      target: { scope: 'pattern', parameter: targetParameter },
      mode, polarity,
      // Defensive parse: `Number('foo')` is NaN, NaN || 0 = 0. The
      // engine validates -1 ≤ value ≤ 1 strictly; clamp here so the
      // operator gets immediate visual feedback instead of a 400.
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
            width: 360,
            backgroundColor: C.surfaceContainerLowest, padding: 20,
            borderRadius: 12, borderWidth: 1, borderColor: C.ghostBorder,
            gap: 14,
          }}
        >
          <Text style={{
            fontFamily: 'SpaceGrotesk_700Bold', color: C.primary, fontSize: 14,
            textTransform: 'uppercase', letterSpacing: 1,
          }}>
            MAP {paramName}
          </Text>

          <PickerRow label="SOURCE">
            {SOURCE_OPTIONS.map((opt) => (
              <Chip key={opt.key} active={source === opt.key} onPress={() => setSource(opt.key)}>
                {opt.label}
              </Chip>
            ))}
          </PickerRow>

          <PickerRow label="MODE">
            <Chip active={mode === 'offset'} onPress={() => setMode('offset')}>OFFSET</Chip>
            <Chip active={mode === 'scale'} onPress={() => setMode('scale')}>SCALE</Chip>
          </PickerRow>

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

          {polarity === 'bipolar' ? (
            // D4a: bipolar collapses to a single SWING ± magnitude.
            // The engine's bipolar math already does
            // `max(|min|, |max|)` on the saved range, so showing min
            // → max separately silently discarded the sign of one
            // value. One field makes that explicit.
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10, color: C.secondary, width: 70 }}>SWING ±</Text>
              <NumberInput value={swing} onChange={setSwing} placeholder="0.25" />
              <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 10, color: C.secondary, flex: 1 }}>
                ± from base (centred on 0.5 source)
              </Text>
            </View>
          ) : (
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10, color: C.secondary, width: 70 }}>RANGE</Text>
              <NumberInput value={rangeMin} onChange={setRangeMin} placeholder="min" />
              <Text style={{ color: C.secondary }}>→</Text>
              <NumberInput value={rangeMax} onChange={setRangeMax} placeholder="max" />
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

          {error ? (
            <Text style={{ color: '#c44', fontFamily: 'Inter_400Regular', fontSize: 11 }}>
              {error}
            </Text>
          ) : null}

          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
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
