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
import { Colors } from '@/constants/theme';
import { HorizontalFader } from '@/components/ui/HorizontalFader';
import { engineEvents } from '@/utils/engineEvents';
import {
  deleteModulation, fetchPlaylistByName, ModulationCurve, ModulationMapping,
  ModulationMode, ModulationPolarity, ModulationSourceKey, patchModulation, putModulation,
} from '@/utils/api';

const C = Colors.light;

// ── modulationState frame subscription ──────────────────────────────
//
// engineEvents broadcasts every WS message. We filter for
// `modulationState` and keep the most recent per-target snapshot.

type ModulationParamLive = {
  base: number;
  modulated: number;
  source?: string;
  mappingId?: string;
};

export function useModulationState(): Record<string, ModulationParamLive> {
  const [state, setState] = useState<Record<string, ModulationParamLive>>({});
  useEffect(() => {
    return engineEvents.subscribe((m) => {
      if (m && m.type === 'modulationState' && m.parameters && typeof m.parameters === 'object') {
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
    fetchPlaylistByName(playlistName).then((r) => {
      if (cancelled) return;
      if (!r.ok || !r.data) { setMappings([]); return; }
      const entry = Array.isArray(r.data.entries)
        ? r.data.entries.find((e: any) => e && e.id === entryId)
        : null;
      setMappings(Array.isArray(entry?.modulations) ? entry.modulations : []);
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

function prettySliderName(name: string): string {
  return name
    .replace(/^(slider|toggle|trigger|hsvPicker)/i, '')
    .replace(/([A-Z])/g, ' $1')
    .trim()
    .toUpperCase()
    .substring(0, 15);
}

// ── ModulatedSlider — drop-in wrapper ───────────────────────────────

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

export function ModulatedSlider({
  exportItem, onChangeBase, playlistName, entryId, mapping, live, onChanged,
}: ModulatedSliderProps) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const niceName = prettySliderName(exportItem.name);
  const base = exportItem.v0 ?? 0.5;
  // Ghost only when there's a live modulationState frame for this
  // target — i.e. mapping is enabled and engine is actively writing.
  const ghost = live && live.modulated !== undefined && live.modulated !== base ? live.modulated : null;
  const hasMapping = !!mapping;
  const enabled = !!(playlistName && entryId);

  return (
    <View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4, alignItems: 'center' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
          <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10, color: C.secondary, textTransform: 'uppercase' }}>{niceName}</Text>
          <TouchableOpacity
            onPress={() => enabled && setPopoverOpen(true)}
            disabled={!enabled}
            style={{
              paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6,
              backgroundColor: hasMapping ? C.primary : 'transparent',
              borderWidth: 1, borderColor: hasMapping ? C.primary : C.ghostBorder,
              opacity: enabled ? 1 : 0.4,
            }}
            accessibilityLabel={hasMapping ? 'Edit modulation' : 'Add modulation'}
          >
            <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 9, color: hasMapping ? C.surfaceContainerLowest : C.secondary, letterSpacing: 0.5 }}>
              {hasMapping ? '◎ ON' : '◎'}
            </Text>
          </TouchableOpacity>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
          {ghost !== null ? (
            <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 9, color: C.primary }}>
              →{ghost.toFixed(2)}
            </Text>
          ) : null}
          <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 11, color: C.text }}>{base.toFixed(2)}</Text>
        </View>
      </View>
      <View style={{ position: 'relative' }}>
        <HorizontalFader
          value={base}
          onChange={onChangeBase}
          trackStyle={{ height: 24, backgroundColor: C.surfaceContainerHigh, borderRadius: 12, justifyContent: 'center' }}
          fillStyle={{ position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: C.primary, borderRadius: 12 }}
        />
        {ghost !== null ? (
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: `${Math.min(100, Math.max(0, ghost * 100))}%`,
              top: 0, bottom: 0,
              width: 3,
              marginLeft: -1.5,
              backgroundColor: C.primaryFixedDim,
              borderRadius: 2,
              opacity: 0.85,
            }}
          />
        ) : null}
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

// ── ModulationPopover — editor ──────────────────────────────────────

const SOURCE_OPTIONS: { key: ModulationSourceKey; label: string }[] = [
  { key: 'micLow', label: 'MIC LOW' },
  { key: 'micMid', label: 'MIC MID' },
  { key: 'micHigh', label: 'MIC HIGH' },
  { key: 'micKick', label: 'MIC KICK' },
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

function ModulationPopover({
  paramName, targetParameter, playlistName, entryId, existing, onClose, onChanged,
}: PopoverProps) {
  const [source, setSource] = useState<ModulationSourceKey>(existing?.source.key ?? 'micLow');
  const [mode, setMode] = useState<ModulationMode>(existing?.mode ?? 'offset');
  const [polarity, setPolarity] = useState<ModulationPolarity>(existing?.polarity ?? 'unipolar');
  const [rangeMin, setRangeMin] = useState<string>(String(existing?.range[0] ?? 0));
  const [rangeMax, setRangeMax] = useState<string>(String(existing?.range[1] ?? 0.35));
  const [curve, setCurve] = useState<ModulationCurve>(existing?.curve ?? 'linear');
  const [enabled, setEnabled] = useState<boolean>(existing?.enabled ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mappingId = useMemo(
    () => existing?.id ?? `mod_${targetParameter}_${source}`,
    [existing, targetParameter, source],
  );

  const save = async () => {
    setBusy(true); setError(null);
    const mapping: ModulationMapping = {
      id: mappingId,
      type: 'continuous',
      enabled,
      source: { scope: 'cpc', key: source },
      target: { scope: 'pattern', parameter: targetParameter },
      mode, polarity,
      range: [Number(rangeMin) || 0, Number(rangeMax) || 0],
      curve,
    };
    const r = existing
      ? await patchModulation(playlistName, entryId, mappingId, mapping)
      : await putModulation(playlistName, entryId, mapping);
    setBusy(false);
    if (!r.ok) { setError(r.error || 'unknown error'); return; }
    onChanged();
    onClose();
  };

  const remove = async () => {
    if (!existing) { onClose(); return; }
    setBusy(true); setError(null);
    const r = await deleteModulation(playlistName, entryId, existing.id);
    setBusy(false);
    if (!r.ok) { setError(r.error || 'unknown error'); return; }
    onChanged();
    onClose();
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
            <Chip active={polarity === 'unipolar'} onPress={() => setPolarity('unipolar')}>UNIPOLAR</Chip>
            <Chip active={polarity === 'bipolar'} onPress={() => setPolarity('bipolar')}>BIPOLAR</Chip>
          </PickerRow>

          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <Text style={{ fontFamily: 'SpaceGrotesk_700Bold', fontSize: 10, color: C.secondary, width: 70 }}>RANGE</Text>
            <NumberInput value={rangeMin} onChange={setRangeMin} placeholder="min" />
            <Text style={{ color: C.secondary }}>→</Text>
            <NumberInput value={rangeMax} onChange={setRangeMax} placeholder="max" />
          </View>

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
            {existing ? (
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
